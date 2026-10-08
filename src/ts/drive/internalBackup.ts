import { alertClear, alertConfirm, alertError, alertNormalWait, alertSelect, alertStore, alertWait } from "../alert";
import { dbWriteLock, tabPresenceLockAcquired, acquireExclusiveStorageMigrationLock, locksSupported } from "../globalApi.svelte";
import { markAppInitiatedReload, isAppInitiatedReload } from "../reloadGuard";
import { isTauri } from "src/ts/platform"
import { decodeRisuSave, salvageRisuSave, type SalvageOmittedBlock } from "../storage/risuSave";
import type { Database } from "../storage/database.svelte";
import { repairBotPresetsId } from "../storage/botPresetRepair";
import { assembleLegacyFile, type BlockSetInput } from "../storage/blockStore";
import { describeOmitted, layoutFileBytes } from "../storage/bootBlockLoad";
import { NODE_BODY_LIMIT_BYTES } from "../storage/nodeBodyLimit";
import { getPageBlockOwner } from "../storage/pageBlockOwner";
import { getAppStore, MAIN_FILE_KEY } from "../storage/store/appStore";
import { getStartupCleanup } from "../storage/startupCleanupState";
import { relaunch } from "@tauri-apps/plugin-process";
import { language } from "src/lang";
import { refuseBackupLoadWhileBusy } from "./backupWorkGuard";
import { refuseOnReadOnlyPage } from "../storage/readOnlyPage";
import { beginBusy, type BusyHandle } from "../process/memory/busyActions";
import { RESTORE_EXCLUSIVE_LOCK_TIMEOUT_MS } from "./backuplocal";
import { buildRestoreSet, completeRestoredTree, currentCharacterNames, repairRestoredCharacters, replaceWithRestoredSet } from "./restoreReplace";
import { describeBlockForPerson } from "../globalApi.svelte";

const SNAPSHOT_KEY_PREFIX = 'database/dbbackup-'

/** What the snapshot yields: its decoded tree, whole, or the intact part of it and the blocks left out. */
type SnapshotReading =
    | { kind: 'complete', tree: Database }
    | { kind: 'partial', tree: Database, omitted: Map<string, SalvageOmittedBlock> }

function isDatabaseObject(value: unknown): value is Database {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reads the snapshot. A snapshot that decodes strictly is `complete`. One that
 * does not is read by `salvageRisuSave`, which takes nothing from the block
 * cache: framing, version and root damage still throw, so such a snapshot is
 * refused whole, and any other damage comes back as the intact tree plus the
 * blocks left out.
 */
async function readSnapshot(snapshotKey: string): Promise<SnapshotReading> {
    const { bytes: stored } = await (await getAppStore()).read(snapshotKey)
    if (!stored) {
        throw new Error(`The backup ${snapshotKey} is not in storage`)
    }
    // A store may hand back a Buffer (a Uint8Array subclass); the copy makes
    // the value decoded a plain Uint8Array.
    const bytes: Uint8Array = Object.getPrototypeOf(stored) === Uint8Array.prototype ? stored : new Uint8Array(stored)

    try {
        const decoded = await decodeRisuSave(bytes, { strict: true })
        if (!isDatabaseObject(decoded)) {
            throw new Error(`The backup ${snapshotKey} does not hold a database`)
        }
        return { kind: 'complete', tree: decoded }
    } catch (strictError) {
        console.error(strictError)
    }
    const { db, omitted } = await salvageRisuSave(bytes)
    if (!isDatabaseObject(db)) {
        throw new Error(`The backup ${snapshotKey} does not hold a database`)
    }
    return { kind: 'partial', tree: db, omitted }
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

/**
 * The tree as the block set the restore writes: a fresh encoder frames every
 * block (nothing is read from or written to storage), then the framed file is
 * strictly decoded and an identity summary compared with the tree's: the
 * ordered chaIds, each kind's presence and size, and the root keys. Structural
 * loss is refused; content fidelity comes from the encoder serialising the
 * same objects, not from this check. A tree that names no preset keeps its
 * working settings as a new one. Throws when the encode, the decode or the
 * comparison fails; nothing has been written yet.
 */
async function rebuildBlockSet(tree: Database): Promise<{ set: BlockSetInput, notice: string | null } | { refusal: string }> {
    const characterRepair = await repairRestoredCharacters(tree)
    if ('refusal' in characterRepair) {
        return characterRepair
    }
    completeRestoredTree(tree)
    repairBotPresetsId(tree)

    const built = await buildRestoreSet(tree)
    if ('refusal' in built) {
        return built
    }
    const set = built.set
    let bytes: Uint8Array = layoutFileBytes(set.layout)
    if (rebuiltBytesTamper) {
        bytes = rebuiltBytesTamper(bytes)
    }

    const expected = identitySummary(tree)
    const rebuilt = await decodeRisuSave(bytes, { strict: true })
    if (!isDatabaseObject(rebuilt) || identitySummary(rebuilt) !== expected) {
        throw new Error('The rebuilt save does not match the intact part of the backup.')
    }
    return { set, notice: characterRepair.notice }
}

/** Whether the current state was kept as a numbered backup, and when it was not, why there was nothing to keep. */
type UndoCopy =
    | { kind: 'kept' }
    | { kind: 'nothing', reason: 'damaged' | 'absent' | 'too-large' }

/**
 * Stores the profile's current state as a new numbered backup, so the load can
 * be undone from the same list. A page with a block head keeps the committed
 * state, assembled as the main file a legacy reader would read; a page with no
 * head keeps its main file as it is, read through the store itself. Damaged
 * committed state, no state at all, or a copy the Node server would refuse
 * leave nothing to keep, and the caller asks the person before going on. The
 * key is one no backup uses.
 */
async function keepCurrentState(): Promise<UndoCopy> {
    const store = await getAppStore()
    const owner = await getPageBlockOwner()
    if (owner === null) {
        throw new Error('This page has no block store to restore into.')
    }
    const current = await owner.readCommitted()
    if (current.kind === 'damaged') {
        return { kind: 'nothing', reason: 'damaged' }
    }
    let bytes: Uint8Array | null
    if (current.kind === 'loaded') {
        bytes = assembleLegacyFile(current.loaded)
    } else {
        bytes = (await store.read(MAIN_FILE_KEY)).bytes
    }
    if (!bytes) {
        return { kind: 'nothing', reason: 'absent' }
    }
    if (store.capabilities.conditionalWrites && bytes.length > NODE_BODY_LIMIT_BYTES) {
        return { kind: 'nothing', reason: 'too-large' }
    }
    let number = Number((Date.now() / 100).toFixed())
    let key = `${SNAPSHOT_KEY_PREFIX}${number}.bin`
    while (await store.has(key)) {
        number++
        key = `${SNAPSHOT_KEY_PREFIX}${number}.bin`
    }
    await store.write(key, bytes, 'unconditional')
    return { kind: 'kept' }
}

export async function loadInternalBackup() {

    // Refused before anything is asked, again when the picker returns, and
    // again immediately before the write: work can start during any wait
    // between.
    if (refuseBackupLoadWhileBusy()) {
        return
    }

    // A page that runs from OPFS this time writes nothing: the load is refused before anything is asked.
    if (await refuseOnReadOnlyPage()) {
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

    // Every exit that never lands the restored state shows one message and
    // then releases what was taken above. An exit after it landed, or after its
    // outcome could not be confirmed, keeps the write lock closed: a save from
    // this page's pre-load state must never overwrite the restored profile.
    let releaseDbWriteLock: (() => void) | null = null
    let replaceStarted = false
    let restoreLanded = false
    let writeLockStaysClosed = false
    // Which step a failure belongs to, for the message shown. The replace itself
    // is told apart by `replaceStarted`.
    let stage: 'read' | 'rebuild' | 'keep' = 'read'
    try {
        if (!releaseExclusiveHold) {
            releaseDbWriteLock = await dbWriteLock.acquire()
        }

        alertWait('Loading backup...')
        const reading = await readSnapshot(selectedBackup)

        if (reading.kind === 'partial') {
            // Nothing has been written. The locks stay held across the confirm,
            // so no other page of this app on this browser origin (or, on Tauri,
            // this instance) changes the profile between validation and the
            // replace. Another device on a Node server can still save; the
            // replace then ends without winning and the load does not happen.
            const leftOut = describeOmitted(reading.omitted, currentCharacterNames())
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
        }
        stage = 'rebuild'
        const rebuilt = await rebuildBlockSet(reading.tree)
        if ('refusal' in rebuilt) {
            alertError(rebuilt.refusal)
            return
        }
        const restoredSet = rebuilt.set

        stage = 'keep'
        const undoCopy = await keepCurrentState()
        if (undoCopy.kind === 'nothing') {
            // The load is never silent about having no way back.
            if (!await alertConfirm(language.restoreNoUndoCopyConfirm(undoCopy.reason))) {
                return
            }
            alertWait('Loading backup...')
        }

        // The same busy check is asked again at the flip, inside the replace.
        if (refuseBackupLoadWhileBusy(busy)) {
            return
        }

        replaceStarted = true
        const written = await replaceWithRestoredSet(restoredSet, () => !refuseBackupLoadWhileBusy(busy))
        if (written.kind === 'not-happened') {
            // The busy guard has already said why when it was the one that refused.
            if (!written.aborted) {
                alertError(language.restoreNotHappenedNotice)
            }
            return
        }
        if (written.kind === 'too-large') {
            alertError(language.restoreTooLargeBlock(describeBlockForPerson(written.blockName), written.limit))
            return
        }
        if (written.kind === 'unsavable') {
            alertError(language.restoreRefusedUnsavable(describeBlockForPerson(written.blockName)))
            return
        }
        if (written.kind === 'unconfirmed') {
            // Which state is current is unknown: nothing may save from this
            // page until a reload shows it.
            writeLockStaysClosed = true
            alertStore.set({ type: 'wait', msg: language.saveDamagedUnconfirmed })
            if (releaseExclusiveHold) {
                await releaseExclusiveHold(true)
            }
            return
        }
        restoreLanded = true
        writeLockStaysClosed = true

        // Awaited, so it is read before the reload takes the page away; only a load that landed gets here.
        if (rebuilt.notice !== null) {
            await alertNormalWait(rebuilt.notice)
        }
        alertWait(undoCopy.kind === 'kept' ? language.internalBackupLoaded : language.internalBackupLoadedNoCopy)
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
        if (restoreLanded) {
            alertWait(language.restoreSavedReloadOrRestart)
        } else if (replaceStarted) {
            alertError(language.internalBackupWriteFailed)
        } else if (stage === 'rebuild') {
            alertError(language.internalBackupNotRebuilt)
        } else if (stage === 'keep') {
            alertError(language.internalBackupCopyFailed)
        } else {
            alertError(language.internalBackupUnreadable)
        }
    } finally {
        if (!writeLockStaysClosed) {
            if (releaseDbWriteLock) {
                releaseDbWriteLock()
            }
            if (releaseExclusiveHold) {
                await releaseExclusiveHold()
            }
        }
    }
}
