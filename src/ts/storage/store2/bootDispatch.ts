import { markAppInitiatedReload } from '../../reloadGuard'
import type { Database } from '../database.svelte'
import { disablePageBlockOwner } from '../pageBlockOwner'
import { setPageStorageMode } from '../pageStorageMode'
import type { AppStoreKind } from '../store/appStore'
import type { Store2Backend } from './backend/types'
import type { SessionDecision } from './session'
import { reflushTopLevel, Store2Session } from './session'
import { activateStore2Save } from './saveActive'
import type { Store2PeerHandler } from './saveLoop'
import { assembleDatabase, CodecAssembleError, type ListDerivation } from './codec'
import { createListDerivation } from './lists/derive'
import { defaultKeyEnv, type KeyEnv } from './format'
import { firstLifeGrant } from './firstLife'
import type { Staging } from './owner'
import { previousOfTree } from './previousOfTree'
import { probeNumberedBackups, seedStore2Profile } from './bootSeed'
import { setStore2BootSession, type Store2BootEnv, type Store2BootNotice, type Store2BootResult } from './bootActive'
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

/** What the dispatch shows. W3 supplies the screens; the dispatch only calls these. */
export interface Store2BootUi {
    /** Informational: never awaited. */
    notice(notice: Store2BootNotice): void
    /** A boot that cannot continue and has nothing to offer: the page stays on its loading screen. */
    blocked(blocked: { reason: string, detail: string }): Promise<void>
    /** No main file but numbered backups: the backups are the profile, never seeded over. */
    offerRestoreOrImport(backups: readonly number[]): Promise<void>
    /**
     * A tree whose listed leaves are damaged or missing. `continue` opens the profile with those parts empty (the first
     * save keeps that state); `decline` stops and asks again at the next start; `earlier` shows the recovery screen with
     * the whole current session so an older saved version can be picked before anything is saved over.
     */
    confirmFlaggedOpen(items: readonly FlaggedItem[]): Promise<'continue' | 'decline' | 'earlier'>
    /** A marker of another owner stands: wait for it, or clear it. */
    foreignMarker(marker: Staging): Promise<'wait' | 'clear'>
    /** The recovery screen, with the whole current session. */
    recovery(request: { decision: SessionDecision, session: Store2Session }): Promise<void>
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
}

/** The state a round hands the next: open a new session and classify again. */
interface Reclassify {
    kind: 'reclassify'
}

type Round = Store2BootResult | Reclassify

const RECLASSIFY: Reclassify = { kind: 'reclassify' }

const STORE2_COMMIT_KEY = 'store2-commit'

export async function dispatchStore2Boot(env: Store2BootEnv, deps: Store2DispatchDeps): Promise<Store2BootResult> {
    const { ui } = deps
    const keyEnv = deps.keyEnv ?? defaultKeyEnv
    const lists = deps.lists ?? createListDerivation()
    const rounds = deps.maxRounds ?? MAX_ROUNDS
    const notices: Store2BootNotice[] = []
    // The user's answer to the foreign-marker question, read by the committer's hook when the dispatch asks it to clear.
    const foreign = { clear: false }

    function raise(notice: Store2BootNotice): void {
        notices.push(notice)
        ui.notice(notice)
    }

    async function stop(reason: string, detail: string): Promise<Store2BootResult> {
        await ui.blocked({ reason, detail })
        return { kind: 'stopped' }
    }

    function legacyReadOnly(reason: 'opfs-transitional' | 'server-capability' | 'backend-unavailable'): Store2BootResult {
        // No later caller may build a block owner: the legacy profile is only read.
        disablePageBlockOwner()
        return { kind: 'legacy-readonly', reason }
    }

    /** Reads the tree of `manifestKey` and opens it: the load path shared by a normal boot and a fresh install. */
    async function openStored(session: Store2Session, manifestKey: string, decision: { fence: 'absent' | 'fenced' | 'blocked' }): Promise<Round> {
        const backend = session.backend
        if (backend === null) {
            return stop('no-backend', 'The session has no backend.')
        }
        let read
        try {
            read = await readTreeBytes(backend, manifestKey)
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
                await ui.recovery({
                    decision: { row: 6, mode: 'recovery', tree: read.tree, keys: read.keys },
                    session,
                })
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
                database = assembleDatabase(read.tree.manifest, read.tree.source, { character: fallback.character })
            } else {
                database = assembleDatabase(read.tree.manifest, read.tree.source)
            }
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
                await ui.recovery({
                    decision: { row: 6, mode: 'recovery', tree: read.flagged.every(leaf => leaf.why === 'missing') ? 'missing' : 'damaged', keys: read.flagged.map(leaf => leaf.key) },
                    session,
                })
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
        disablePageBlockOwner()
        activateStore2Save({ session, previous, lists, env: keyEnv, peer: ui.peer })
        setPageStorageMode({ kind: 'store2' })
        return { kind: 'store2', database, session, notices }
    }

    /** The first-life seed: the backups are looked at first, and only an empty store is ever seeded. */
    async function seed(session: Store2Session, allowBackupOffer: boolean): Promise<Round> {
        const backend = session.backend
        if (backend === null) {
            return stop('no-backend', 'The session has no backend.')
        }
        if (allowBackupOffer) {
            const probe = await probeNumberedBackups(env.listBackupTimes)
            if (probe.status === 'unknown') {
                return stop('backups-unlistable', probe.reason)
            }
            if (probe.status === 'some') {
                await ui.offerRestoreOrImport(probe.backups)
                return { kind: 'stopped' }
            }
        }
        const granted = firstLifeGrant(session)
        if (granted.status === 'refused') {
            return stop('first-life-refused', granted.detail)
        }
        const outcome = await seedStore2Profile(backend, granted.grant, { owner: session.ownerId, lists, env: keyEnv })
        switch (outcome.status) {
            case 'reclassify':
                return RECLASSIFY
            case 'blocked':
                return stop(outcome.reason, outcome.detail)
            case 'installed':
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
                    raise({ name: 'convert-unavailable' })
                    return { kind: 'stopped' }
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
                if (decision.operation === 'convert') {
                    raise({ name: 'convert-unavailable' })
                    return { kind: 'stopped' }
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
                await ui.recovery({ decision, session })
                return { kind: 'stopped' }
        }
    }

    for (let number = 1; number <= rounds; number++) {
        // The earlier session, with its backend and committer, is dropped before the next registers.
        setStore2BootSession(null)
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

/**
 * The port of a build that has no screens yet: notices are logged, every prompt stays open and so leaves the page on
 * its loading screen with nothing written, and the reload action is the real one. Unshippable by design.
 */
export function createProductionBootUi(): Store2BootUi {
    const open = <T>(): Promise<T> => new Promise<T>(() => { })
    return {
        notice: (notice) => console.warn('[store2 boot]', notice),
        blocked: (blocked) => {
            console.error('[store2 boot] blocked', blocked)
            return open<void>()
        },
        offerRestoreOrImport: (backups) => {
            console.warn('[store2 boot] backups exist', backups)
            return open<void>()
        },
        confirmFlaggedOpen: (items) => {
            console.warn('[store2 boot] incomplete profile', items)
            return open<'continue' | 'decline' | 'earlier'>()
        },
        foreignMarker: () => open<'wait' | 'clear'>(),
        recovery: (request) => {
            console.warn('[store2 boot] recovery', request.decision)
            return open<void>()
        },
        peer: {
            parkedClean: (prompt) => console.warn('[store2 boot] parked', prompt),
            decide: () => open(),
            exportThisTab: () => Promise.reject(new Error('The export is not available in this build.')),
            reload: () => {
                markAppInitiatedReload()
                location.reload()
            },
        },
    }
}
