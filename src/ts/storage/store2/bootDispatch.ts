import type { Database } from '../database.svelte'
import { disablePageBlockOwner } from '../pageBlockOwner'
import { setPageStorageMode } from '../pageStorageMode'
import type { AppStoreKind } from '../store/appStore'
import type { CompareToken, Store2Backend, UnitWrite } from './backend/types'
import type { SessionDecision } from './session'
import { reflushTopLevel, Store2Session } from './session'
import { activateStore2Save, type Store2SaveContext } from './saveActive'
import type { Store2PeerHandler } from './saveLoop'
import { createSaveEncoder, type SaveEncoder } from './saveEncoder'
import { createResidency } from './residency'
import { registerResidency } from './residencyActive'
import { residentSetOf } from './residencyPolicy'
import { assembleCharacter, assembleDatabase, CodecAssembleError, stubFromEntry, type ListDerivation } from './codec'
import { createListDerivation } from './lists/derive'
import { defaultKeyEnv, type KeyEnv } from './format'
import { firstLifeGrant, type FirstLifeLabel, type GrantResult } from './firstLife'
import type { Staging } from './owner'
import { previousOfTree } from './previousOfTree'
import { probeNumberedBackups, seedStore2Profile } from './bootSeed'
import { setStore2BootSession, type BlockedReason, type Store2BootEnv, type Store2BootNotice, type Store2BootResult, type Store2LegacyReadOnlyReason } from './bootActive'
import { createBootImportTarget, type BootImportEnd, type BootImportTarget } from './legacy/bootImport'
import { convertLegacyProfile, convertLegacyWithout, type LegacyDecoders } from './legacy/convert'
import type { SkippedLegacyEntry } from './legacy/lenient'
import type { IncompleteItem, ResolveOptions } from './legacy/resolve'
import { createLeafFallback, type FlaggedItem, type LeafFallback } from './leafFallback'
import { createOwnerIdStore } from './ownerStore'
import { CommitKeyRecheckError, readTreeBytes } from './treeBytes'

/**
 * The store2 boot dispatch: one classifier result, one row, one action. The rows are the boot table of the plan; each
 * says what it writes (most nothing) and what it shows, through the typed `Store2BootUi` port. Strings and screens are
 * the port's business, not the dispatch's.
 *
 * Invariants:
 *  - The dispatch never writes the legacy store, never prunes a backup and never opens a legacy block owner or archive
 *    pass; a page it cannot open as store2 either stops or hands the legacy profile back read-only.
 *  - It holds exactly one current session. Opening the next (a re-classification) drops the earlier one first, because
 *    the native gate makes an earlier backend stale the moment a later one registers. Activation, the recovery request
 *    and `getStore2BootSession()` only ever see the newest session.
 *  - A re-classification happens at most `MAX_ROUNDS` times per boot; running out is a named block, never a loop.
 *  - `activateStore2Save` is called only when the database is about to be handed back as the open profile. A tree with
 *    damaged or missing leaves is opened only after the user answers `continue`: the save loop re-encodes on its own
 *    schedule and would otherwise persist the fallback unasked. `decline` and `earlier` write nothing, open nothing and
 *    never activate the loop.
 */

/** Sessions the dispatch opens at most in one boot. */
const MAX_ROUNDS = 3

/**
 * What the recovery screen is given: the whole current session, and everything a pick, a conversion or a seed over it
 * needs. The staged-unit and marker clock is `keyEnv.now`; the owner id is `session.ownerId`.
 */
export interface Store2RecoveryRequest {
    decision: SessionDecision
    session: Store2Session
    env: Store2BootEnv
    lists: ListDerivation
    keyEnv: KeyEnv
    /** The tests' seam of a conversion. */
    decoders?: LegacyDecoders
    /** The tests' seam of a conversion. */
    resolve?: ResolveOptions
    /** Runs the picker and the file flow of a `.bin` import with the given installer; absent, the boot offers no import. */
    importBackup?: (target: BootImportTarget) => Promise<BootImportEnd>
}

/** What the dispatch shows. W3 supplies the screens; the dispatch only calls these. */
export interface Store2BootUi {
    /** Informational: never awaited. */
    notice(notice: Store2BootNotice): void
    /**
     * A boot that cannot continue and has nothing to offer: the port says why and the page stays where it is.
     * `mayHaveWritten` is true when this boot may already have written: any mutating call on the session's backend made
     * through the dispatch (an install included), a later classification round (it follows an action of an earlier one) and
     * a re-run that follows this page's own cleared marker. "Nothing was changed" is shown only when it is false.
     */
    blocked(blocked: { reason: BlockedReason, detail: string, mayHaveWritten: boolean }): Promise<void>
    /**
     * No main file but numbered backups: the backups are the profile, never seeded over. The person restores the newest
     * backup or a backup file; the screen is asked again after either backs out.
     */
    offerRestoreOrImport(backups: readonly number[]): Promise<'restore-newest' | 'import'>
    /** A legacy profile is about to be converted. `false` declines: nothing is written. */
    confirmConvert(): Promise<boolean>
    /** After a decline: convert after all, or import a backup file instead. `importAvailable` is false when the boot cannot import (a re-run of this page's own conversion). */
    declined(importAvailable: boolean): Promise<'convert' | 'import'>
    /**
     * Nothing decodes strictly. Converting from a lenient read leaves out the blocks named here (possibly none); the person
     * must agree before the marker. `decline` writes nothing and the question comes back at the next start.
     */
    confirmConvertWithout(skipped: readonly SkippedLegacyEntry[]): Promise<'convert' | 'decline'>
    /**
     * The main file does not decode strictly and the numbered backup `backup` (its time) does. Asked before the marker and before the incomplete-data question; `decline` writes nothing and the question comes back at the next start.
     */
    confirmFromBackup(backup: number): Promise<'convert' | 'decline'>
    /** What the conversion could not bring in, asked before the marker. `false` declines: nothing is written. */
    confirmIncomplete(items: readonly IncompleteItem[]): Promise<boolean>
    /**
     * A tree whose listed leaves are damaged or missing. `continue` opens the profile with those parts empty (the first
     * save keeps that state); `decline` stops and asks again at the next start; `earlier` shows the recovery screen with
     * the whole current session so an older saved version can be picked before anything is saved over.
     */
    confirmFlaggedOpen(items: readonly FlaggedItem[]): Promise<'continue' | 'decline' | 'earlier'>
    /** A marker of another owner stands: wait for it, or clear it. */
    foreignMarker(marker: Staging): Promise<'wait' | 'clear'>
    /** The recovery screen, with the whole current session. */
    recovery(request: Store2RecoveryRequest): Promise<void>
    peer: Store2PeerHandler
}

export interface Store2DispatchDeps {
    ui: Store2BootUi
    /** The store kind; defaults to the page store's own. */
    kind?: AppStoreKind
    /** A backend per opened session, in place of the one built for `kind` (the tests' seam). Called once per round. */
    backend?: () => Promise<Store2Backend>
    keyEnv?: KeyEnv
    lists?: ListDerivation
    reflushAttempts?: number
    maxRounds?: number
    /** The clock that stamps a load-error message; the wall clock by default. */
    now?: () => number
    /** The decoders of a conversion, in place of the real ones (the tests' seam). */
    decoders?: LegacyDecoders
    /** The ids and clock of a conversion's placeholder characters (the tests' seam). */
    resolve?: ResolveOptions
    /** The page's file flow for a `.bin` import (`loadBackupAtBoot`); absent, no import is offered. */
    importBackup?: (target: BootImportTarget) => Promise<BootImportEnd>
}

/** The state a round hands the next: open a new session and classify again. */
interface Reclassify {
    kind: 'reclassify'
}

type Round = Store2BootResult | Reclassify

const RECLASSIFY: Reclassify = { kind: 'reclassify' }

const STORE2_COMMIT_KEY = 'store2-commit'

/**
 * The save loop's `loadStub`: loads every stub that holds `chaId` through the restore facade, which reads the units
 * through the registered residency. The restore and character modules load on first use, so a page that never meets a
 * stub does not load them. True when no stub of that id is left in the list.
 */
async function loadStubsOf(chaId: string): Promise<boolean> {
    const [{ DBState }, { restoreColdCharacter }] = await Promise.all([import('../../stores.svelte'), import('../../process/coldCharacterRestore')])
    const stubsOf = () => (DBState.db?.characters ?? []).filter((cha) => cha?.chaId === chaId && cha.coldstorage)
    for (const stub of stubsOf()) {
        await restoreColdCharacter(stub, { quiet: true })
    }
    return stubsOf().length === 0
}

/**
 * The backend with every mutating method announcing itself first, so that "this boot may have written" follows from the
 * writes made through it and not from a list of the paths that write. Reads pass straight through. A new mutating method on
 * `Store2Backend` must be added here.
 */
export function recordingBackend(backend: Store2Backend, onWrite: () => void): Store2Backend {
    return {
        readCommit: () => backend.readCommit(),
        readFence: () => backend.readFence(),
        readUnits: (keys: readonly string[]) => backend.readUnits(keys),
        listStore2: () => backend.listStore2(),
        countPrefix: (prefix: string) => backend.countPrefix(prefix),
        casCommit: (expected: CompareToken, next: Uint8Array) => {
            onWrite()
            return backend.casCommit(expected, next)
        },
        casFence: (expected: CompareToken, next: Uint8Array | null) => {
            onWrite()
            return backend.casFence(expected, next)
        },
        commitOrdinary: (expectedCommit: CompareToken, units: readonly UnitWrite[], nextCommit: Uint8Array) => {
            onWrite()
            return backend.commitOrdinary(expectedCommit, units, nextCommit)
        },
        putUnit: (key: string, bytes: Uint8Array) => {
            onWrite()
            return backend.putUnit(key, bytes)
        },
        removeBatch: (keys: readonly string[], expectedCommit: CompareToken, expectedFence: CompareToken) => {
            onWrite()
            return backend.removeBatch(keys, expectedCommit, expectedFence)
        },
    }
}

export async function dispatchStore2Boot(env: Store2BootEnv, deps: Store2DispatchDeps): Promise<Store2BootResult> {
    const { ui } = deps
    const keyEnv = deps.keyEnv ?? defaultKeyEnv
    const lists = deps.lists ?? createListDerivation()
    const rounds = deps.maxRounds ?? MAX_ROUNDS
    const notices: Store2BootNotice[] = []
    // The user's answer to the foreign-marker question, read by the committer's hook when the dispatch asks it to clear.
    const foreign = { clear: false }
    // Set by any mutating call through `backendOf`, by an earlier round and by this page clearing its own standing marker; never reset within a boot.
    let mayHaveWritten = false

    function raise(notice: Store2BootNotice): void {
        notices.push(notice)
        ui.notice(notice)
    }

    async function stop(reason: BlockedReason, detail: string): Promise<Store2BootResult> {
        await ui.blocked({ reason, detail, mayHaveWritten })
        return { kind: 'stopped' }
    }

    function legacyReadOnly(reason: Store2LegacyReadOnlyReason): Store2BootResult {
        // No later caller may build a block owner: the legacy profile is only read.
        disablePageBlockOwner()
        return { kind: 'legacy-readonly', reason, notices: [...notices] }
    }

    function recoveryRequest(decision: SessionDecision, session: Store2Session): Store2RecoveryRequest {
        return { decision, session, env, lists, keyEnv, decoders: deps.decoders, resolve: deps.resolve, importBackup: deps.importBackup }
    }

    /** The session's backend as every dispatch path uses it: a mutating call on it sets `mayHaveWritten`. */
    function backendOf(session: Store2Session): Store2Backend | null {
        return session.backend === null ? null : recordingBackend(session.backend, () => { mayHaveWritten = true })
    }

    /** Reads the tree of `manifestKey` and opens it: the load path shared by a normal boot and a fresh install. */
    async function openStored(session: Store2Session, manifestKey: string, decision: { fence: 'absent' | 'fenced' | 'blocked' }): Promise<Round> {
        const backend = backendOf(session)
        if (backend === null) {
            return stop('no-backend', 'The session has no backend.')
        }
        // What the resident planner decided: the entities it left resident.
        const planned: { resident: ReadonlySet<string> | null } = { resident: null }
        let read
        try {
            read = await readTreeBytes(backend, manifestKey, {
                resident: (input) => {
                    planned.resident = residentSetOf(input)
                    return planned.resident
                },
            })
        } catch (error) {
            if (error instanceof CommitKeyRecheckError) {
                return stop('commit-key-unreadable', error.message)
            }
            throw error
        }
        switch (read.status) {
            case 'moved':
                return RECLASSIFY
            case 'unreadable':
                return stop('tree-unreadable', read.cause.message)
            case 'too-new':
                setPageStorageMode({ kind: 'read-only' })
                raise({ name: 'too-new', source: 'tree', detail: read.reason })
                return { kind: 'stopped' }
            case 'structure':
                await ui.recovery(recoveryRequest({ row: 6, mode: 'recovery', tree: read.tree, keys: read.keys }, session))
                return { kind: 'stopped' }
            case 'ok':
                break
        }
        let database: Database
        let previous
        let fallback: LeafFallback | null = null
        try {
            if (read.flagged.length > 0) {
                fallback = createLeafFallback(read.flagged, deps.now ?? Date.now)
            }
            // An entity the planner left out is a stub that names its units; its units were not read, so nothing of it is assembled.
            const resident = planned.resident
            const assembleWhole = fallback?.character ?? assembleCharacter
            database = assembleDatabase(read.tree.manifest, read.tree.source, {
                character: (entry, source) => resident === null || resident.has(entry.u) ? assembleWhole(entry, source) : stubFromEntry(entry),
            })
            previous = previousOfTree(read.tree)
        } catch (error) {
            if (error instanceof CodecAssembleError) {
                return stop('assemble-failed', error.message)
            }
            throw error
        }
        if (fallback !== null) {
            const answer = await ui.confirmFlaggedOpen(fallback.items())
            if (answer === 'earlier') {
                await ui.recovery(recoveryRequest(
                    { row: 6, mode: 'recovery', tree: read.flagged.every(leaf => leaf.why === 'missing') ? 'missing' : 'damaged', keys: read.flagged.map(leaf => leaf.key) },
                    session,
                ))
            }
            if (answer !== 'continue') {
                return { kind: 'stopped' }
            }
        }
        if (session.notice !== null) {
            raise({ name: 'reflush-failed', detail: session.notice.detail })
        }
        if (decision.fence === 'blocked') {
            raise({ name: 'cleanup-blocked' })
        }
        if (fallback === null && database.archiveCharacters === undefined) {
            // The first boot where the setting is absent turns archiving on and says so once, whether or not any character became a stub (MC-149 3);
            // an explicit false stays false and is not told. A boot that opened over damaged leaves is not a complete reading, as the block store's
            // pass does not run on a decode that was not strict, so it neither writes the setting nor tells. The next pass saves the setting.
            database.archiveCharacters = true
            raise({ name: 'archive-enabled' })
        }
        disablePageBlockOwner()
        // One context object serves the residency and the save loop, so the encoding a verdict is judged by is the one the
        // next pass compares with. The residency is registered before the loop is activated and before the database is
        // handed back, and neither the encoder, the lists nor the environment are replaced afterwards.
        const context: Store2SaveContext & { encoder: SaveEncoder } = {
            session,
            previous,
            encoder: createSaveEncoder({ previous, lists, env: keyEnv }),
            lists,
            env: keyEnv,
            peer: ui.peer,
            loadStub: loadStubsOf,
        }
        registerResidency(createResidency({ backend, context }))
        activateStore2Save(context)
        setPageStorageMode({ kind: 'store2' })
        return { kind: 'store2', database, session, notices }
    }

    /**
     * The row-1 grant with a label override. Only a row-1 decision can carry one: a restore or an import that crashes
     * after its marker must classify as row 10 or row 11, never as the row 9 re-run that seeds an empty profile.
     */
    function labelledGrant(session: Store2Session, label: FirstLifeLabel): GrantResult {
        const decision = session.decision
        if (!(decision.row === 1 && decision.mode === 'first-life')) {
            return { status: 'refused', reason: 'label-not-row-1', detail: `Boot row ${decision.row ?? 'none'} cannot restore or import under a first-life marker.` }
        }
        return firstLifeGrant({ decision, commitRead: session.commitRead, startupClear: session.startupClear }, { label })
    }

    /** After an install: the re-flush a Tauri page owes when the write was not confirmed, then the installed profile opens. */
    async function openInstalled(session: Store2Session, backend: Store2Backend, installed: { manifestKey: string, flushed: boolean | undefined }): Promise<Round> {
        mayHaveWritten = true
        if (installed.flushed !== true && session.reflush !== null) {
            const reflushed = await reflushTopLevel(backend)
            if (!reflushed.ok) {
                raise({ name: 'flush-unconfirmed' })
            }
        }
        return openStored(session, installed.manifestKey, { fence: 'absent' })
    }

    /**
     * A `.bin` import at row 1 (the offer screen, the declined conversion). The marker is labelled `import`. `null`:
     * the person backed out or a refusal was shown, nothing was installed, and the caller asks again.
     */
    async function importFromFile(session: Store2Session, backend: Store2Backend): Promise<Round | null> {
        if (deps.importBackup === undefined) {
            return { kind: 'stopped' }
        }
        const granted = labelledGrant(session, 'import')
        if (granted.status === 'refused') {
            return stop('first-life-refused', granted.detail)
        }
        const target = createBootImportTarget({
            backend, entry: { kind: 'first-life', grant: granted.grant }, owner: session.ownerId, lists, env: keyEnv,
            resolve: deps.resolve, oldData: { store: env.store, listBackupTimes: env.listBackupTimes }, upstreamMainFile: env.upstreamMainFile,
        }, env.readColdStorageItem)
        const end = await deps.importBackup(target)
        if (end.kind === 'cancelled') {
            // The picked file's assets may already be copied.
            mayHaveWritten = true
            return null
        }
        const result = end.result
        switch (result.status) {
            case 'reclassify':
                return RECLASSIFY
            case 'blocked':
                return stop(result.reason, result.detail)
            case 'exit':
                throw new TypeError('A first-life import has no exit outcome.')
            case 'installed':
                return openInstalled(session, backend, result)
        }
    }

    /**
     * "Restore the newest backup" when there is no main file: the strict conversion of the newest numbered backup that
     * decodes, under a marker labelled `convert` (a crash classifies as row 10). The person chose the newest backup
     * already, so only what could not be brought in is asked; the notice names the backup that was used, and says so when
     * it is not the newest. Nothing decodes strictly: that is a stop, never the lenient read of a main file that is not there.
     * `null`: declined, ask again.
     */
    async function restoreNewest(session: Store2Session, backend: Store2Backend, backups: readonly number[]): Promise<Round | null> {
        const granted = labelledGrant(session, 'convert')
        if (granted.status === 'refused') {
            return stop('first-life-refused', granted.detail)
        }
        const newest = Math.max(...backups)
        const result = await convertLegacyProfile({
            store: env.store,
            listBackupTimes: env.listBackupTimes,
            readColdStorageItem: env.readColdStorageItem,
            backend,
            entry: { kind: 'first-life', grant: granted.grant },
            owner: session.ownerId,
            lists,
            env: keyEnv,
            decoders: deps.decoders,
            resolve: deps.resolve,
        }, {
            confirmIncomplete: (items) => ui.confirmIncomplete(items),
            confirmFromBackup: async () => true,
        })
        switch (result.status) {
            case 'declined':
                return null
            case 'all-failed':
                return stop('convert-read-failed', 'No numbered backup decodes strictly.')
            case 'reclassify':
                return RECLASSIFY
            case 'blocked':
                return stop(result.reason, result.detail)
            case 'exit':
                throw new TypeError('A first-life restore has no exit outcome.')
            case 'installed':
                if (result.fromBackup !== null) {
                    raise({ name: 'restored-from-backup', backup: result.fromBackup, newest })
                }
                return openInstalled(session, backend, result)
        }
    }

    /** The first-life seed: the backups are looked at first, and only an empty store is ever seeded. */
    async function seed(session: Store2Session, allowBackupOffer: boolean): Promise<Round> {
        const backend = backendOf(session)
        if (backend === null) {
            return stop('no-backend', 'The session has no backend.')
        }
        if (allowBackupOffer) {
            const probe = await probeNumberedBackups(env.listBackupTimes)
            if (probe.status === 'unknown') {
                return stop('backups-unlistable', probe.reason)
            }
            if (probe.status === 'some') {
                // The person restores the newest backup or a backup file; backing out of either asks again.
                for (;;) {
                    const answer = await ui.offerRestoreOrImport(probe.backups)
                    const next = answer === 'import'
                        ? await importFromFile(session, backend)
                        : await restoreNewest(session, backend, probe.backups)
                    if (next !== null) {
                        return next
                    }
                }
            }
        }
        const granted = firstLifeGrant(session)
        if (granted.status === 'refused') {
            return stop('first-life-refused', granted.detail)
        }
        const outcome = await seedStore2Profile(backend, { kind: 'first-life', grant: granted.grant }, {
            owner: session.ownerId, lists, env: keyEnv, oldData: { store: env.store, listBackupTimes: env.listBackupTimes },
        })
        switch (outcome.status) {
            case 'reclassify':
                return RECLASSIFY
            case 'blocked':
                return stop(outcome.reason, outcome.detail)
            case 'exit':
                throw new TypeError('A first-life seed has no exit outcome.')
            case 'installed':
                mayHaveWritten = true
                break
        }
        if (outcome.flushed !== true && session.reflush !== null) {
            const reflushed = await reflushTopLevel(backend)
            if (!reflushed.ok) {
                raise({ name: 'flush-unconfirmed' })
            }
        }
        raise({ name: 'seeded' })
        return openStored(session, outcome.manifestKey, { fence: 'absent' })
    }

    /**
     * The conversion of a legacy profile. Row 1 asks first; an own row-9 re-run does not (the standing marker records the
     * earlier consent). A decline writes nothing and is offered again; the question about what could not be brought in is
     * asked in both cases, before the marker.
     */
    async function convertRow(session: Store2Session, ask: boolean): Promise<Round> {
        const backend = backendOf(session)
        if (backend === null) {
            return stop('no-backend', 'The session has no backend.')
        }
        const granted = firstLifeGrant(session)
        if (granted.status === 'refused') {
            return stop('first-life-refused', granted.detail)
        }
        const hooks = {
            confirmIncomplete: (items: readonly IncompleteItem[]) => ui.confirmIncomplete(items),
            confirmFromBackup: async (backup: number) => await ui.confirmFromBackup(backup) === 'convert',
        }
        /** After a decline: `null` converts after all; an import that backs out shows the question again. */
        async function declinedFlow(): Promise<Round | null> {
            for (;;) {
                // A re-run of this page's own conversion (row 9) is not row 1, so it cannot import under a first-life marker.
                if (await ui.declined(ask && deps.importBackup !== undefined) === 'convert') {
                    return null
                }
                const next = ask ? await importFromFile(session, backend) : { kind: 'stopped' as const }
                if (next !== null) {
                    return next
                }
            }
        }
        for (;;) {
            if (ask && !(await ui.confirmConvert())) {
                const next = await declinedFlow()
                if (next !== null) {
                    return next
                }
                continue
            }
            const request = {
                store: env.store,
                listBackupTimes: env.listBackupTimes,
                readColdStorageItem: env.readColdStorageItem,
                backend,
                entry: { kind: 'first-life' as const, grant: granted.grant },
                owner: session.ownerId,
                lists,
                env: keyEnv,
                decoders: deps.decoders,
                resolve: deps.resolve,
            }
            let result = await convertLegacyProfile(request, hooks)
            if (result.status === 'all-failed') {
                // Nothing decodes strictly: converting from a lenient read is the person's choice, asked with every skipped block named.
                result = await convertLegacyWithout(request, {
                    ...hooks,
                    confirmSkipped: async (skipped) => await ui.confirmConvertWithout(skipped) === 'convert',
                })
            }
            switch (result.status) {
                case 'declined': {
                    const next = await declinedFlow()
                    if (next !== null) {
                        return next
                    }
                    continue
                }
                case 'reclassify':
                    return RECLASSIFY
                case 'blocked':
                    return stop(result.reason, result.detail)
                case 'exit':
                    throw new TypeError('A first-life conversion has no exit outcome.')
                case 'installed':
                    mayHaveWritten = true
                    if (result.flushed !== true && session.reflush !== null) {
                        const reflushed = await reflushTopLevel(backend)
                        if (!reflushed.ok) {
                            raise({ name: 'flush-unconfirmed' })
                        }
                    }
                    if (result.fromBackup !== null) {
                        raise({ name: 'converted-from-backup', backup: result.fromBackup })
                    }
                    return openStored(session, result.manifestKey, { fence: 'absent' })
            }
        }
    }

    /** A page whose store2 backend is not available: the legacy profile may be read, never written, and never over a store2 profile. */
    async function readOnlyRow(session: Store2Session, reason: 'opfs-transitional' | 'server-capability' | 'backend-unavailable', detail: string): Promise<Round> {
        if (reason === 'opfs-transitional') {
            return legacyReadOnly(reason)
        }
        raise({ name: reason, detail })
        let commitKeyBytes: Uint8Array | null
        try {
            commitKeyBytes = (await env.store.read(STORE2_COMMIT_KEY)).bytes
        } catch (error) {
            return stop('commit-key-unreadable', error instanceof Error ? error.message : String(error))
        }
        if (commitKeyBytes !== null) {
            return stop('store2-profile-unwritable', 'A store2 profile exists on a store this page cannot write.')
        }
        let mainFile: boolean
        try {
            mainFile = await env.upstreamMainFile()
        } catch (error) {
            return stop('main-file-unknown', error instanceof Error ? error.message : String(error))
        }
        if (!mainFile) {
            return stop('no-profile-unwritable', 'No profile exists and this page cannot write the store.')
        }
        return legacyReadOnly(reason)
    }

    async function foreignRow(session: Store2Session): Promise<Round> {
        const staging = session.commit?.status === 'parsed' ? session.commit.value.staging : null
        const read = session.commitRead
        const committer = session.committer
        if (staging === null || read === null || committer === null) {
            return stop('foreign-marker-unreadable', 'The standing marker could not be read back.')
        }
        if (await ui.foreignMarker(staging) === 'wait') {
            return { kind: 'stopped' }
        }
        foreign.clear = true
        let result
        try {
            result = await committer.clearMarker(read)
        } finally {
            foreign.clear = false
        }
        const status = result.cleared?.status
        if (status === 'cleared' || status === 'nothing' || status === 'conflict') {
            return RECLASSIFY
        }
        return stop('foreign-clear-failed', 'The standing marker could not be cleared.')
    }

    async function round(session: Store2Session): Promise<Round> {
        const decision = session.decision
        // The decisions that carry a `reason`: a blocked classification (row 1 or none) and a read-only session.
        if ('reason' in decision) {
            if (decision.mode === 'read-only') {
                return readOnlyRow(session, decision.reason, decision.detail)
            }
            return stop(decision.reason, decision.detail)
        }
        switch (decision.row) {
            case 1:
                if (decision.action === 'convert') {
                    return convertRow(session, true)
                }
                return seed(session, true)
            case 3:
                setPageStorageMode({ kind: 'read-only' })
                raise({ name: 'too-new', source: decision.source, detail: decision.detail })
                return { kind: 'stopped' }
            case 5: {
                const tree = session.tree
                if (tree === null || tree.status !== 'ok') {
                    return stop('tree-unreadable', 'The boot decision names a tree that was not read.')
                }
                return openStored(session, tree.manifestKey, { fence: decision.fence })
            }
            case 9: {
                if (decision.clear === 'foreign-path') {
                    return foreignRow(session)
                }
                const cleared = session.startupClear
                if (cleared !== null && (cleared.status === 'nothing' || cleared.status === 'conflict')) {
                    return RECLASSIFY
                }
                if (cleared === null || cleared.status !== 'cleared') {
                    if (session.notice !== null) {
                        raise({ name: 'reflush-failed', detail: session.notice.detail })
                    }
                    return stop('own-marker-not-cleared', 'This page\'s own marker could not be cleared, so nothing is re-run.')
                }
                mayHaveWritten = true
                if (decision.operation === 'convert') {
                    return convertRow(session, false)
                }
                return seed(session, false)
            }
            case 2:
            case 4:
            case 6:
            case 7:
            case 8:
            case 10:
            case 11:
                await ui.recovery(recoveryRequest(decision, session))
                return { kind: 'stopped' }
        }
    }

    for (let number = 1; number <= rounds; number++) {
        // The earlier session, with its backend and committer, is dropped before the next registers.
        setStore2BootSession(null)
        if (number > 1) {
            mayHaveWritten = true
        }
        const session = await Store2Session.open(env.store, {
            kind: deps.kind,
            backend: deps.backend === undefined ? undefined : await deps.backend(),
            ownerStore: createOwnerIdStore(env.store),
            upstreamMainFile: env.upstreamMainFile,
            foreignClear: async () => foreign.clear,
            env: keyEnv,
            reflushAttempts: deps.reflushAttempts,
        })
        setStore2BootSession(session)
        const outcome = await round(session)
        if (outcome.kind !== 'reclassify') {
            return outcome
        }
    }
    return stop('reclassify-exhausted', `The boot was classified ${rounds} times and the store kept moving.`)
}
