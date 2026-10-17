import type { AppStoreKind } from '../store/appStore'
import type { ByteStore } from '../store/contract'
import { ServerLacksCapabilityError } from '../store/errors'
import {
    createIndexedDbBackend, createNodeBackend, createTauriBackend, Store2BackendError,
    type Store2Backend, type Store2Read, type Store2WriteResult,
} from './backend'
import {
    classifyBoot, openDeleterGate, probeStore2Presence, runBootClear, type BootDecision, type DeleterKind, type GateResult,
    type Store2Presence,
} from './boot'
import { createCommitter, type AbandonResult, type Committer } from './commit'
import { classifyCommitRead, type CommitRead } from './commitKey'
import { readFenceVerdict, type FenceVerdict } from './fence'
import { trackFlushes } from './flushTracker'
import { defaultKeyEnv, type KeyEnv } from './format'
import { freshOwnerId, persistedOwnerId, type ForeignClearHook, type OwnerIdStore } from './owner'
import { readTree, type TreeRead } from './tree'

/**
 * One page load's opening of the store2 protocol over the page's byte store: the
 * backend of the store's kind, the Tauri re-flush, the reads boot classifies and
 * the committer the rest of the page uses. Nothing outside `store2/` imports it.
 */

// ---- Tauri re-flush ----

export type ReflushKeyResult = 'absent' | 'flushed' | 'failed'

export interface ReflushResult {
    /** Both keys are absent or confirmed flushed. */
    ok: boolean
    commit: ReflushKeyResult
    fence: ReflushKeyResult
}

const REFLUSH_ATTEMPTS = 3

/**
 * Rewrites one top-level key with the bytes it holds, compare-and-write at the
 * token just read, so a peer's write in between is never overwritten and the
 * bytes (hence `seq` and `epoch` of a commit key) never change. Only a reported
 * `flushed === true` counts; a conflict re-reads, a failure or a missing flush
 * report retries, and the last attempt's failure stands.
 */
async function reflushKey(
    read: () => Promise<Store2Read>,
    write: (current: Store2Read) => Promise<Store2WriteResult>,
    attempts: number,
): Promise<ReflushKeyResult> {
    for (let attempt = 0; attempt < attempts; attempt++) {
        let current: Store2Read
        try {
            current = await read()
        } catch (error) {
            if (error instanceof Store2BackendError) {
                continue
            }
            throw error
        }
        if (current.bytes === null) {
            return 'absent'
        }
        try {
            if ((await write(current)).flushed === true) {
                return 'flushed'
            }
        } catch (error) {
            if (!(error instanceof Store2BackendError)) {
                throw error
            }
        }
    }
    return 'failed'
}

/**
 * The Tauri boot re-flush of `store2-commit` and `store2-fence`, run on every
 * page load before anything else and before any deleter. The durable write
 * command flushes a directory's parent only in the call that created the
 * directory, so a first unit write that created `store2/` and failed that parent
 * flush is not repeated by a retry. The commit-key write flushes the app data
 * directory, which holds the `store2` entry, so a commit key reported flushed
 * also covers the `store2` directory entry every unit path goes through; each
 * unit's own entry inside `store2/` is covered by that unit's write (the
 * command's own report is the only evidence; none exists for power loss).
 * Absent keys have nothing to re-flush.
 */
export async function reflushTopLevel(backend: Store2Backend, attempts: number = REFLUSH_ATTEMPTS): Promise<ReflushResult> {
    const commit = await reflushKey(() => backend.readCommit(), (current) => backend.casCommit(current.token, current.bytes as Uint8Array), attempts)
    const fence = await reflushKey(() => backend.readFence(), (current) => backend.casFence(current.token, current.bytes), attempts)
    return { ok: commit !== 'failed' && fence !== 'failed', commit, fence }
}

// ---- Session ----

export type SessionReadOnlyReason = 'opfs-transitional' | 'backend-unavailable' | 'server-capability'

/** A boot decision, or the read-only state of a page whose store2 backend is not available. */
export type SessionDecision =
    | BootDecision
    | { row: null, mode: 'read-only', reason: SessionReadOnlyReason, detail: string }

/** Something the page should tell the user; the screen is UI and comes later. */
export interface SessionNotice {
    reason: 'reflush-failed'
    detail: string
}

export interface Store2SessionOptions {
    /** The page store's kind; defaults to `getAppStoreKind()`. */
    kind?: AppStoreKind
    /**
     * Replaces the backend built for `kind` (the tests' seam); never consulted for `opfs-transitional`.
     * A Tauri backend arrives already registered with the generation gate (`createTauriBackend` registers it): the
     * caller owns that, and `open` registers nothing for an injected backend.
     */
    backend?: Store2Backend
    /** Where the Tauri build keeps its owner id; without it a Tauri page uses a fresh id per load and has no device marker. */
    ownerStore?: OwnerIdStore
    /** Whether the upstream main file exists; asked only when the decision needs it. A rejection is read as unknown. */
    upstreamMainFile: () => Promise<boolean>
    foreignClear?: ForeignClearHook
    env?: KeyEnv
    reflushAttempts?: number
}

export interface Store2Session {
    readonly kind: AppStoreKind
    readonly decision: SessionDecision
    /** The backend; `null` on a read-only page that has none. */
    readonly backend: Store2Backend | null
    readonly committer: Committer | null
    readonly ownerId: string
    /** Whether the owner id is persisted on this device. */
    readonly deviceOwner: boolean
    /** The Tauri re-flush; `null` on every other kind. */
    readonly reflush: ReflushResult | null
    /** Why every deleter is idle right now, or `null`; read live, so a later unflushed Tauri top-level write sets it and a flushed one clears it. */
    readonly idleReason: string | null
    readonly notice: SessionNotice | null
    /** The commit key as classified for the decision; re-read after a start-up clear. */
    readonly commitRead: Store2Read | null
    readonly commit: CommitRead | null
    readonly fence: FenceVerdict | null
    readonly presence: Store2Presence | null
    readonly tree: TreeRead | null
    /** The row 9 start-up clear of the device's own marker, when one ran. */
    readonly startupClear: AbandonResult | null
    /** Opens a deleter's gate on fresh reads; a closed session refuses. */
    openGate(deleter: DeleterKind, closure?: readonly TreeRead[]): Promise<GateResult>
}

const IDLE_REFLUSH = 'The commit key or the fence could not be flushed to stable storage this page load.'

async function createBackend(kind: AppStoreKind, store: ByteStore): Promise<Store2Backend | { unavailable: string }> {
    switch (kind) {
        case 'tauri':
            // The one store object of the page: its mutex serialises every step of this backend. The factory also
            // registers the page with the native generation gate, so this runs before the re-flush and every read.
            try {
                return await createTauriBackend(store)
            } catch (error) {
                if (error instanceof Store2BackendError) {
                    return { unavailable: error.message }
                }
                throw error
            }
        case 'node':
            try {
                return createNodeBackend(store)
            } catch (error) {
                if (error instanceof Store2BackendError) {
                    return { unavailable: error.message }
                }
                throw error
            }
        case 'indexeddb':
            return createIndexedDbBackend()
        case 'opfs-transitional':
            return { unavailable: 'The page runs from the transitional OPFS store.' }
    }
}

async function ownerOf(kind: AppStoreKind, options: Store2SessionOptions, env: KeyEnv): Promise<{ id: string, device: boolean }> {
    if (kind === 'tauri' && options.ownerStore !== undefined) {
        try {
            return { id: await persistedOwnerId(options.ownerStore, env), device: true }
        } catch {
            // A marker is never started under an id a restart would not know.
        }
    }
    return { id: freshOwnerId(env), device: false }
}

function readOnlySession(kind: AppStoreKind, reason: SessionReadOnlyReason, detail: string, owner: { id: string, device: boolean }): Store2Session {
    return {
        kind,
        decision: { row: null, mode: 'read-only', reason, detail },
        backend: null,
        committer: null,
        ownerId: owner.id,
        deviceOwner: owner.device,
        reflush: null,
        idleReason: detail,
        notice: null,
        commitRead: null,
        commit: null,
        fence: null,
        presence: null,
        tree: null,
        startupClear: null,
        openGate: async () => ({ status: 'refused', reason: 'idle', detail }),
    }
}

/**
 * The Node server's capability probe at open. The store2 writes and the collector need the server's check-only and retire
 * routes (the same predicate the collector's own probe applies). A server without them (the probe says so, or refuses
 * with `ServerLacksCapabilityError`) opens read-only with `server-capability`. A probe that fails any other way cannot
 * show the capability is there, so the page is read-only as for any unreachable backend (`backend-unavailable`).
 * Returns the read-only reason, or `null` when the capability is present.
 */
async function probeNodeCapability(store: ByteStore): Promise<{ reason: SessionReadOnlyReason, detail: string } | null> {
    if (store.guarded === undefined) {
        return { reason: 'backend-unavailable', detail: 'The byte store has no guarded operations; the store2 Node backend needs them.' }
    }
    try {
        const caps = await store.guarded.probe()
        if (!caps.checkOnly || !caps.retire) {
            return { reason: 'server-capability', detail: 'The Node server lacks check-only or retire.' }
        }
    } catch (error) {
        const detail = error instanceof Error ? error.message : 'The capability probe failed.'
        return { reason: error instanceof ServerLacksCapabilityError ? 'server-capability' : 'backend-unavailable', detail }
    }
    return null
}

async function readCommitOrNull(backend: Store2Backend): Promise<{ read: Store2Read, commit: CommitRead } | { reason: string }> {
    try {
        const read = await backend.readCommit()
        return { read, commit: classifyCommitRead(read) }
    } catch (error) {
        if (error instanceof Store2BackendError) {
            return { reason: error.message }
        }
        throw error
    }
}

async function open(store: ByteStore, options: Store2SessionOptions): Promise<Store2Session> {
    const env = options.env ?? defaultKeyEnv
    // The page store module is loaded only when the caller names no kind: it drags in the app's boot chain, which a protocol test must not.
    const kind = options.kind ?? await (await import('../store/appStore')).getAppStoreKind()
    const owner = await ownerOf(kind, options, env)

    let backend: Store2Backend
    if (kind === 'opfs-transitional') {
        return readOnlySession(kind, 'opfs-transitional', 'The page runs from the transitional OPFS store.', owner)
    }
    if (options.backend !== undefined) {
        backend = options.backend
    } else {
        const made = await createBackend(kind, store)
        if ('unavailable' in made) {
            return readOnlySession(kind, 'backend-unavailable', made.unavailable, owner)
        }
        backend = made
    }
    if (kind === 'node') {
        const missing = await probeNodeCapability(store)
        if (missing !== null) {
            return readOnlySession(kind, missing.reason, missing.detail, owner)
        }
    }

    // Before any other read or write: a commit key or fence that never reached stable storage is made durable first.
    const reflush = kind === 'tauri' ? await reflushTopLevel(backend, options.reflushAttempts) : null
    const bootIdleReason = reflush !== null && !reflush.ok ? IDLE_REFLUSH : null
    // From here every protocol write of a Tauri page goes through the tracker, so the idle state follows later unflushed writes.
    const tracker = reflush === null ? null : trackFlushes(backend, { commit: reflush.commit === 'failed', fence: reflush.fence === 'failed' })
    if (tracker !== null) {
        backend = tracker.backend
    }
    const liveIdleReason = (): string | null => tracker !== null && tracker.unflushed() ? IDLE_REFLUSH : null

    const committer = createCommitter(backend, { owner: owner.id, env, foreignClear: options.foreignClear })
    const fence = await readFenceVerdict(backend)
    let read = await readCommitOrNull(backend)
    const commit: BootCommit = 'reason' in read ? { status: 'unreadable', reason: read.reason } : read.commit

    const presence = commit.status === 'absent' ? await probeStore2Presence(backend) : null

    const current = commit.status === 'parsed' ? commit.value.current : null
    const tree = current === null ? null : await readTree(backend, current.key)

    const needsMainFile = commit.status === 'absent'
        || (commit.status === 'parsed' && commit.value.current === null && commit.value.staging?.label === 'convert')
    let upstreamMainFile: boolean | null = null
    if (needsMainFile) {
        try {
            upstreamMainFile = await options.upstreamMainFile()
        } catch {
            upstreamMainFile = null
        }
    }

    const decision = classifyBoot({
        commit,
        fence,
        presence,
        tree,
        upstreamMainFile,
        ownerId: owner.id,
        deviceOwner: owner.device,
    })

    let startupClear: AbandonResult | null = null
    if (bootIdleReason === null && 'read' in read) {
        startupClear = await runBootClear(committer, read.read, decision, owner.id)
        if (startupClear !== null) {
            read = await readCommitOrNull(backend)
        }
    }

    return {
        kind,
        decision,
        backend,
        committer,
        ownerId: owner.id,
        deviceOwner: owner.device,
        reflush,
        get idleReason() {
            return liveIdleReason()
        },
        notice: bootIdleReason === null ? null : { reason: 'reflush-failed', detail: bootIdleReason },
        commitRead: 'read' in read ? read.read : null,
        commit: 'read' in read ? read.commit : null,
        fence,
        presence,
        tree,
        startupClear,
        openGate: (deleter, closure) => openDeleterGate(backend, deleter, { idleReason: liveIdleReason(), closure }),
    }
}

type BootCommit = CommitRead | { status: 'unreadable', reason: string }

export const Store2Session = { open }
