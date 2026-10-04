import { alertClear, alertConfirm, alertError, alertSelect, alertWait } from "../alert";
import { dbWriteLock, tabPresenceLockAcquired, acquireExclusiveStorageMigrationLock, locksSupported } from "../globalApi.svelte";
import { markAppInitiatedReload, isAppInitiatedReload } from "../reloadGuard";
import { isTauri } from "src/ts/platform"
import { decodeRisuSave, salvageRisuSave, RisuSaveEncoder, type SalvageOmittedBlock, type toSaveType } from "../storage/risuSave";
import type { Database } from "../storage/database.svelte";
import { DBState } from "../stores.svelte";
import { noteMainFileBytes } from "../storage/mainFileRecord";
import { getAppStore, writeMainFile, MAIN_FILE_KEY } from "../storage/store/appStore";
import { getStartupCleanup } from "../storage/startupCleanupState";
import { relaunch } from "@tauri-apps/plugin-process";
import { language } from "src/lang";
import { refuseBackupLoadWhileBusy } from "./backupWorkGuard";
import { beginBusy, type BusyHandle } from "../process/memory/busyActions";
import { RESTORE_EXCLUSIVE_LOCK_TIMEOUT_MS } from "./backuplocal";

const SNAPSHOT_KEY_PREFIX = 'database/dbbackup-'

/** What the snapshot yields: its exact bytes, or the intact part of it to be rebuilt into a main file. */
type SnapshotReading =
    | { kind: 'complete', bytes: Uint8Array }
    | { kind: 'partial', tree: Database, omitted: Map<string, SalvageOmittedBlock> }

function isDatabaseObject(value: unknown): value is Database {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reads the snapshot. A snapshot that decodes strictly is `complete` and is
 * written as the bytes stored. One that does not is read by `salvageRisuSave`,
 * which takes nothing from the block cache: framing, version and root damage
 * still throw, so such a snapshot is refused whole, and any other damage comes
 * back as the intact tree plus the blocks left out.
 */
async function readSnapshot(snapshotKey: string): Promise<SnapshotReading> {
    const { bytes: stored } = await (await getAppStore()).read(snapshotKey)
    if (!stored) {
        throw new Error(`The backup ${snapshotKey} is not in storage`)
    }
    // A store may hand back a Buffer (a Uint8Array subclass); the copy keeps
    // the same bytes and makes the value written a plain Uint8Array.
    const bytes: Uint8Array = Object.getPrototypeOf(stored) === Uint8Array.prototype ? stored : new Uint8Array(stored)

    try {
        const decoded = await decodeRisuSave(bytes, { strict: true })
        if (!isDatabaseObject(decoded)) {
            throw new Error(`The backup ${snapshotKey} does not hold a database`)
        }
        return { kind: 'complete', bytes }
    } catch (strictError) {
        console.error(strictError)
    }
    const { db, omitted } = await salvageRisuSave(bytes)
    if (!isDatabaseObject(db)) {
        throw new Error(`The backup ${snapshotKey} does not hold a database`)
    }
    return { kind: 'partial', tree: db, omitted }
}

/** The lines of the confirm: every kind or character the intact tree lacks. Empty when nothing the user cares about was left out. */
function describeLeftOut(omitted: Map<string, SalvageOmittedBlock>): string[] {
    const names = new Map<string, string>()
    for (const character of DBState.db?.characters ?? []) {
        if (character?.chaId !== undefined && typeof character.name === 'string' && character.name !== '') {
            names.set(String(character.chaId), character.name)
        }
    }
    const lines: string[] = []
    const kinds = new Set<string>()
    let unreadable = 0
    for (const [blockName, block] of omitted) {
        switch (block.kind) {
            case 'character':
                lines.push(names.get(blockName) ?? blockName)
                break
            case 'other':
                unreadable++
                break
            case 'ignored':
                break
            default:
                kinds.add(block.kind)
        }
    }
    if (kinds.has('presets')) lines.push(language.internalBackupLeftOutPresets)
    if (kinds.has('modules')) lines.push(language.internalBackupLeftOutModules)
    if (kinds.has('loadouts')) lines.push(language.internalBackupLeftOutLoadouts)
    if (kinds.has('plugins')) lines.push(language.internalBackupLeftOutPlugins)
    if (kinds.has('pluginStorage')) lines.push(language.internalBackupLeftOutPluginData)
    if (unreadable > 0) lines.push(`${unreadable} ${language.internalBackupLeftOutUnreadable}`)
    return lines
}

const KIND_FIELDS = ['characters', 'botPresets', 'modules', 'loadouts', 'plugins', 'pluginCustomStorage']

/**
 * What a rebuilt file must still say about the intact tree. Both sides are
 * normalised the same way: absent characters, modules, loadouts and plugins
 * count as empty lists. Presets are compared as decoded, after the decoder's
 * template substitution. Absent plugin storage counts as -1, which is distinct
 * from an empty object.
 */
function identitySummary(db: Database): string {
    const lengthOf = (value: unknown): number => Array.isArray(value) ? value.length : -1
    const storage: unknown = db.pluginCustomStorage
    return JSON.stringify({
        characterIds: (db.characters ?? []).map((character) => String(character.chaId)),
        presets: lengthOf(db.botPresets),
        modules: lengthOf(db.modules ?? []),
        loadouts: lengthOf(db.loadouts ?? []),
        plugins: lengthOf(db.plugins ?? []),
        pluginStorageKeys: typeof storage === 'object' && storage !== null ? Object.keys(storage).length : -1,
        rootKeys: Object.keys(db).filter((key) => !key.startsWith('__') && !KIND_FIELDS.includes(key)).sort(),
    })
}

let rebuiltBytesTamper: ((bytes: Uint8Array) => Uint8Array) | null = null

/** Test seam: replaces the rebuilt bytes between the encode and the verify. Pass null to remove it. */
export function setRebuiltBytesTamperForTests(tamper: ((bytes: Uint8Array) => Uint8Array) | null): void {
    rebuiltBytesTamper = tamper
}

function emptyToSave(): toSaveType {
    return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

/**
 * Encodes the intact tree into a main file the way a save does, with no block
 * cache writes, then strictly decodes the bytes (no cache) and compares an
 * identity summary with the tree's: the ordered chaIds, each kind's presence and
 * size, and the root keys. Structural loss is refused; content fidelity comes
 * from the encoder serialising the same objects, not from this check. Throws
 * when the encode, a remote-file write, the decode or the comparison fails; the
 * caller has written no main file yet.
 */
async function rebuildMainFile(tree: Database): Promise<Uint8Array> {
    // The live database holds an empty list for each of these when it has none.
    tree.characters ??= []
    tree.modules ??= []
    tree.loadouts ??= []
    tree.plugins ??= []

    const encoder = new RisuSaveEncoder()
    await encoder.init(tree, { compression: false, enableRemoteSaving: !!tree.enableRemoteSaving, writeBlockCache: false })
    await encoder.set(tree, emptyToSave())
    const encoded = encoder.encode()
    if (!encoded) {
        throw new Error('The encoder produced no file.')
    }
    let bytes: Uint8Array = new Uint8Array(encoded)
    if (rebuiltBytesTamper) {
        bytes = rebuiltBytesTamper(bytes)
    }

    const expected = identitySummary(tree)
    const rebuilt = await decodeRisuSave(bytes, { strict: true })
    if (!isDatabaseObject(rebuilt) || identitySummary(rebuilt) !== expected) {
        throw new Error('The rebuilt main file does not match the intact part of the backup.')
    }
    return bytes
}

/**
 * Stores the main file as it is on disk as a new numbered backup, so the load
 * can be undone from the same list. Reads through the store itself, not
 * `readMainFile`, so the version the page last saw of the main file does not
 * move. An absent main file has nothing to keep. The key is one no backup uses.
 */
async function keepCurrentMainFile(): Promise<void> {
    const store = await getAppStore()
    const { bytes } = await store.read(MAIN_FILE_KEY)
    if (!bytes) {
        return
    }
    let number = Number((Date.now() / 100).toFixed())
    let key = `${SNAPSHOT_KEY_PREFIX}${number}.bin`
    while (await store.has(key)) {
        number++
        key = `${SNAPSHOT_KEY_PREFIX}${number}.bin`
    }
    await store.write(key, bytes, 'unconditional')
}

export async function loadInternalBackup() {

    // Refused before anything is asked, again when the picker returns, and
    // again immediately before the write: work can start during any wait
    // between.
    if (refuseBackupLoadWhileBusy()) {
        return
    }

    let selectedBackup: string | undefined
    try {
        const internalBackups = await (await getAppStore()).list(SNAPSHOT_KEY_PREFIX)

        const selectOptions = [
            'Cancel',
            ...(internalBackups.map((a) => {
                return (new Date(parseInt(a.slice(SNAPSHOT_KEY_PREFIX.length)) * 100)).toLocaleString()
            }))
        ]

        const alertResult = parseInt(
            await alertSelect(selectOptions)
        ) - 1

        selectedBackup = internalBackups[alertResult]
    } catch (error) {
        console.error(error)
        alertError(language.internalBackupListFailed)
        return
    }

    if (selectedBackup === undefined) {
        return
    }

    // Registered once a snapshot is chosen, and ended however the load leaves.
    const busy = beginBusy('backupLoad')
    try {
        await loadSelectedBackup(selectedBackup, busy)
    } finally {
        busy.end()
    }
}

async function loadSelectedBackup(selectedBackup: string, busy: BusyHandle) {
    if (refuseBackupLoadWhileBusy(busy)) {
        return
    }

    // The startup clean-up can delete a remote block that the snapshot
    // references while this load runs, so nothing is read until it settles.
    // The cancelable wait is shown only while a recorded clean-up is pending,
    // and is replaced by a wait without Cancel as soon as it settles: from
    // there on the load takes locks and cannot be cancelled.
    const startupCleanup = getStartupCleanup()
    if (startupCleanup) {
        let cancelWait: () => void = () => { }
        const cancelled = new Promise<'cancelled'>((resolve) => {
            cancelWait = () => resolve('cancelled')
        })
        alertWait(language.internalBackupWaitingForCleanup, () => cancelWait())
        const outcome = await Promise.race([startupCleanup.then(() => 'settled' as const), cancelled])
        if (outcome === 'cancelled') {
            alertClear()
            return
        }
        alertWait('Loading backup...')
    }

    // Nothing else on this browser origin may write the database while the
    // snapshot is validated and written (MC-093). Tauri is single-instance and
    // skips this check. Once granted, `releaseExclusiveHold` already holds
    // `dbWriteLock` internally -- the write below must NOT acquire it a second
    // time, which would deadlock against this same hold.
    let releaseExclusiveHold: ((keepWriteLock?: boolean) => Promise<void>) | null = null
    if (!isTauri) {
        if (locksSupported === false) {
            if (!await alertConfirm(language.restoreNoLockWarningConfirm)) {
                return
            }
        } else {
            await tabPresenceLockAcquired
            alertWait(language.restoreCheckingOtherTabs)
            releaseExclusiveHold = await acquireExclusiveStorageMigrationLock(RESTORE_EXCLUSIVE_LOCK_TIMEOUT_MS)
            if (!releaseExclusiveHold) {
                // A reload already in flight needs no message: this page is
                // already on its way out. Otherwise another tab is open.
                if (!isAppInitiatedReload()) {
                    alertError(language.restoreOtherTabRefused)
                }
                return
            }
        }
    }

    // Every exit that never lands the write shows one message and then
    // releases what was taken above. An exit after the write landed keeps the
    // write lock closed: the main file now holds the snapshot, and a save from
    // this page's pre-load state must never overwrite it.
    let releaseDbWriteLock: (() => void) | null = null
    let writeAttempted = false
    let writeLanded = false
    // Which step a failure belongs to, for the message shown. The write itself
    // is told apart by `writeAttempted`.
    let stage: 'read' | 'rebuild' | 'keep' = 'read'
    try {
        if (!releaseExclusiveHold) {
            releaseDbWriteLock = await dbWriteLock.acquire()
        }

        alertWait('Loading backup...')
        const reading = await readSnapshot(selectedBackup)

        let bytes: Uint8Array
        if (reading.kind === 'complete') {
            bytes = reading.bytes
        } else {
            // Nothing has been written. The locks stay held across the confirm,
            // so no other page of this app on this browser origin (or, on Tauri,
            // this instance) changes the main file, the numbered backups or the
            // remote files between validation and the write. Another device on a
            // Node server can still save; the conditional main-file write refuses
            // the load then.
            const leftOut = describeLeftOut(reading.omitted)
            if (leftOut.length > 0) {
                const question = `${language.internalBackupPartialConfirm}\n\n${leftOut.map((item) => `- ${item}`).join('\n')}\n\n${language.internalBackupPartialConfirmKeep}`
                if (!await alertConfirm(question)) {
                    return
                }
                alertWait('Loading backup...')
                // Work can start while the confirm is up.
                if (refuseBackupLoadWhileBusy(busy)) {
                    return
                }
            }
            stage = 'rebuild'
            bytes = await rebuildMainFile(reading.tree)
        }

        stage = 'keep'
        await keepCurrentMainFile()

        // No await between this check and the write.
        if (refuseBackupLoadWhileBusy(busy)) {
            return
        }

        writeAttempted = true
        await writeMainFile(bytes)
        writeLanded = true
        noteMainFileBytes(bytes)

        alertWait(language.internalBackupLoaded)
        // The hold's Web Lock part is released first so other tabs can
        // proceed, and before the reload is marked app-initiated: the release
        // can queue behind another tab's exclusive request for longer than the
        // mark lives, and an expired mark lets the "Leave site?" guard stop the
        // reload. The write lock part stays closed (`keepWriteLock`).
        if (releaseExclusiveHold) {
            await releaseExclusiveHold(true)
        }
        markAppInitiatedReload()
        if (isTauri) {
            await relaunch()
        } else {
            // replaceState drops any query string and keeps the fragment;
            // location.reload() always performs a full reload.
            history.replaceState(null, '', location.pathname + location.hash)
            location.reload()
        }
    } catch (error) {
        console.error(error)
        if (writeLanded) {
            alertWait(language.restoreSavedReloadOrRestart)
        } else if (writeAttempted) {
            alertError(language.internalBackupWriteFailed)
        } else if (stage === 'rebuild') {
            alertError(language.internalBackupNotRebuilt)
        } else if (stage === 'keep') {
            alertError(language.internalBackupCopyFailed)
        } else {
            alertError(language.internalBackupUnreadable)
        }
    } finally {
        if (!writeLanded) {
            if (releaseDbWriteLock) {
                releaseDbWriteLock()
            }
            if (releaseExclusiveHold) {
                await releaseExclusiveHold()
            }
        }
    }
}
