/**
 * The actors of the store2 replay. An actor is a program of operations over one
 * `Store2Session`, every operation being the real library call: nothing of the
 * protocol is re-implemented here. The operations are the interface (`ReplayActor`)
 * that a later stage can point at the wired save step; a backend variant supplies
 * only a `RigParts` (its scheduled store, raw state, state hooks and the opening
 * of a page's backend), and `assembleRig` builds the rig around it.
 *
 * Rules every actor keeps, so that a run is deterministic and the checker can judge it:
 *  - an actor injects a seeded `KeyEnv` (`rig.envOf`), so keys and owner ids do not
 *    depend on the clock or `Math.random`; two actors of a rig use different seeds,
 *    because the same seed mints the same keys;
 *  - an operation declares what it is doing before its first call, and the
 *    commit-key writes whose label depends on the value written (the bulk marker and
 *    its final write or clear, the recovery marker and its install, a clear of a standing
 *    marker) are labelled by the decorator over the page's backend from the actor's
 *    declared intent. A clear of the page's own marker is a start-up clear; a clear of
 *    another owner's marker is a foreign clear only when the page's foreign-clear hook
 *    consented to that very marker (owner and prefix), and otherwise it keeps the
 *    operation's own context and is reported. The fence keeps each operation's own
 *    context (an exit writes it, a discard removes it, boot only re-flushes it); the one
 *    relabel is a non-null fence write under a recovery exit, which is a fence exit;
 *  - the boot re-flush of a Tauri page is never labelled `fence-exit`;
 *  - a deleter reads before it deletes (`gcPass` reads the commit key and the fence);
 *  - the backends that write unconditionally (Tauri) make the `commitExpect` and
 *    `fenceExpect` of a step vacuous;
 *  - actors of one Tauri page share one session, hence one backend and one
 *    registration with the page gate: a second registration on the same store makes
 *    the first page stale, by design;
 *  - a hold (`ReplayRigOptions.holds`) keeps one call of an actor from reaching the
 *    scheduler until a step has been applied, which is how a schedule fixes an
 *    interleaving inside a library operation. A held call is not pending, so a run in
 *    which every way forward waits for a hold ends `stalled`, and a schedule whose
 *    hold can never be released says so instead of passing. A hold whose `until` lacks
 *    a context can be released by an earlier, unintended step of the same op and target.
 *
 * A start state is planted straight into the store before the checker takes its
 * first snapshot.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { ByteStore, GuardedCapabilities, GuardedOperations, PageGateOperations } from 'src/ts/storage/store/contract'
import { isStore2Key } from 'src/ts/storage/store/keyRules'
import { BULK_UNIT_THRESHOLD, Store2BackendError, type Store2Backend, type Store2Read } from 'src/ts/storage/store2/backend'
import { ADMISSION_INTERVAL_MS, type AbandonResult, type CommitResult, type WriteResult } from 'src/ts/storage/store2/commit'
import { classifyCommitRead, nextCommitKey } from 'src/ts/storage/store2/commitKey'
import { discardFence, fenceExit, readFenceVerdict, type FenceDiscardResult, type FenceExitResult } from 'src/ts/storage/store2/fence'
import { encodeUnit, newStagingId, readUnit, stagingPrefix, tailOfKey, UNIT_TYPE, type CommitKey, type KeyEnv, type Manifest, type StagingLabel } from 'src/ts/storage/store2/format'
import { COMMIT_KEY, FENCE_KEY } from 'src/ts/storage/store2/format/keys'
import { gcPass, type GcResult } from 'src/ts/storage/store2/gc/pass'
import { freshOwnerId, isOwnerId, type ForeignClearHook, type OwnerIdStore } from 'src/ts/storage/store2/owner'
import { listRecoveryCandidates, runExit, type CandidateListing, type ExitKind, type ExitResult } from 'src/ts/storage/store2/recovery'
import { firstLifeGrant, firstLifeInstall, installBuilt, type FirstLifeLabel, type FirstLifeRefusal, type FirstLifeResult } from 'src/ts/storage/store2/firstLife'
import { installPick, pickCandidate, type InstallResult, type PickReady, type PickResult } from 'src/ts/storage/store2/recoveryPick'
import { Store2Session } from 'src/ts/storage/store2/session'
import { createClock, treeRequest, testEnv, type BuildRecord, type TestClock } from '../commitFixtures'
import { createChecker, type Checker } from './checker'
import { GARBAGE } from './replayFixtures'
import {
    createScheduler, type ActorContext, type ActorHandle, type OperationKind, type RawState, type RunResult, type Scheduler, type SchedulerOptions, type StepInfo,
} from './scheduler'

// ---- Start states ----

export type MarkerLabel = Extract<StagingLabel, 'convert' | 'seed' | 'import'>

/**
 * What the store holds when the run starts (plan v3.4 section 6, V1):
 *  - `healthy`: a first complete tree and the commit key naming it;
 *  - `no-commit-key`: an empty store (first start);
 *  - `marker-*`: the tree, and a standing marker of that label over a commit key that names no `current`;
 *  - `standing-fence`: the healthy tree and a fence listing every key stored;
 *  - `damaged-commit`, `damaged-fence`, `both-damaged`: silent damage, bytes that parse as nothing.
 */
export type StartState =
    | 'healthy' | 'no-commit-key'
    | 'marker-convert' | 'marker-seed' | 'marker-import'
    | 'standing-fence' | 'damaged-commit' | 'damaged-fence' | 'both-damaged'

export const START_STATES: readonly StartState[] = [
    'healthy', 'no-commit-key', 'marker-convert', 'marker-seed', 'marker-import', 'standing-fence', 'damaged-commit', 'damaged-fence', 'both-damaged',
]

/** An owner id that no page of a rig has. */
export const FOREIGN_OWNER = 'a'.repeat(26)

/** The extra units of a bulk commit: more than the bulk threshold, so the commit is bulk before any key exists. */
export const BULK_EXTRA = BULK_UNIT_THRESHOLD - 8

/** Seeds below this are the rig's own (the first tree, the start state); an actor's seed is at least this. */
export const FIRST_ACTOR_SEED = 10

/**
 * The page could not get its backend (the Tauri page gate refused or lost its registration). The real
 * `Store2Session.open` answers a read-only session there; an actor has nothing to run on one, so its
 * `open` throws this instead, and a run reports it as what it is.
 */
export class PageUnavailableError extends Error {
    constructor(readonly cause: Store2BackendError) {
        super(`The page has no backend: ${cause.message}`)
        this.name = 'PageUnavailableError'
    }
}

// ---- The rig a backend variant supplies ----

export type ReplayVariant = 'node' | 'tauri'

/** The variants a rig can have: the two ByteStore backends, and IndexedDB, which is scheduled at the `Store2Backend` layer. */
export type RigVariant = ReplayVariant | 'indexeddb'

/** Direct access to the stored state, with no request and no wrapper: how a test plants and reads. */
export interface StateHooks {
    peek(key: string): Uint8Array | null
    /** Puts the bytes in place; a Node key keeps its revision, which is how silent damage looks. */
    plant(key: string, bytes: Uint8Array): void
    list(prefix: string): string[]
    /** Takes the key out of the store as the loss of a file would (the `remove-unit` environment step); the key reads as absent afterwards. */
    remove(key: string): void
}

/** What a rig that schedules at the `Store2Backend` layer is given to build a page's backend. */
export interface BackendScheduling {
    readonly handle: ActorHandle
    /** Puts the schedule's holds between the scheduler and the caller; the identity when the rig has none. Wrap the scheduled backend with it. */
    hold(scheduled: Store2Backend): Store2Backend
}

export interface RigParts {
    readonly variant: RigVariant
    readonly raw: () => RawState
    readonly hooks: StateHooks
    /** The page's scheduled byte store: the actor's own on Node, the one the actors of a page share on Tauri. Never used by a backend-layer rig. */
    pageStore(handle: ActorHandle): ByteStore
    /** Opens the backend of one page on its scheduled store: the Tauri variant registers with the page gate. A backend-layer rig schedules through `scheduling`. */
    openBackend(store: ByteStore, scheduling: BackendScheduling): Promise<Store2Backend>
    /** The guarded probe of the page's scheduled store, where the variant has one (Node). */
    probe(store: ByteStore): (() => Promise<GuardedCapabilities>) | undefined
    /** Whether a page keeps its owner id on the device (Tauri). */
    readonly deviceOwner: boolean
    /** Tauri: what a restart does to the store (drop the unflushed writes when asked, hand out a new store object); the dropped keys. */
    readonly restart?: (drop: boolean) => string[]
    /** Tauri: the store learns that a durable write was reported not flushed. */
    readonly unflushed?: (key: string) => void
}

/**
 * Selects calls or applied steps by what they were: the actor, the layer's op, the key (or `n=<count>` of a batch)
 * they targeted and the operation the actor had declared. `target` also takes the classes `$commit`, `$fence` and `$unit`
 * (any store2 unit key). `nth` (1-based, the first by default) picks the nth match, and is ignored by `stepMatches`.
 */
export interface StepMatch {
    actor?: string
    op?: string | readonly string[]
    target?: string
    context?: OperationKind
    nth?: number
}

/** Whether an applied step is one `match` selects; `nth` is the caller's to count. */
export function stepMatches(info: StepInfo, match: StepMatch): boolean {
    return info.applied && selects(match, info.actor, info.op, info.target, info.context === null ? null : info.context.kind)
}

function selects(match: StepMatch, actor: string, op: string, target: string, context: OperationKind | null): boolean {
    if (match.actor !== undefined && match.actor !== actor) {
        return false
    }
    if (match.op !== undefined && !(typeof match.op === 'string' ? [match.op] : match.op).includes(op)) {
        return false
    }
    if (match.target !== undefined) {
        const wanted = match.target
        const hit = wanted === '$commit' ? target === COMMIT_KEY
            : wanted === '$fence' ? target === FENCE_KEY
                : wanted === '$unit' ? isStore2Key(target)
                    : wanted === target
        if (!hit) {
            return false
        }
    }
    return match.context === undefined || match.context === context
}

/** One call of an actor that waits, before the scheduler sees it, for the `until` step to have been applied. */
export interface CallHold {
    call: StepMatch & { actor: string }
    until: StepMatch
}

export interface ReplayRigOptions {
    /** The scheduler's seed, policy and fault plan; the rig supplies `onStep`. */
    scheduler: Omit<SchedulerOptions, 'onStep'>
    start?: StartState
    /** Calls kept back until a step has been applied; each hold applies to one call. */
    holds?: readonly CallHold[]
    /** The owner of a standing marker; a foreign one by default. */
    markerOwner?: string
    /** Plants state before the start state and before the checker takes its first snapshot; the env is the rig's own. */
    prepare?: (hooks: StateHooks, env: KeyEnv) => void
    /** Called with every step after the checker judged it. */
    observe?: (info: StepInfo) => void
}

export interface ActorOptions {
    /** Tauri: the actors of a page share one session; the actor's own id by default. */
    page?: string
    /** Tauri: the device whose owner store the page uses; pages of one device find the same owner id after a restart. The page's own by default. */
    device?: string
    /** Whether the upstream main file exists, as the boot reads it; false by default. */
    upstreamMainFile?: boolean
    /** The Q3 question for another owner's marker; absent means a foreign marker is never cleared. */
    foreignClear?: ForeignClearHook
    /**
     * What the page's presence probes (MC-291) answer for the asset files and inlay records a candidate's lists name:
     * everything is present unless a kind is set to false, in which case none of it is.
     */
    present?: { assets?: boolean, inlays?: boolean }
}

export interface ReplayRig {
    readonly variant: RigVariant
    readonly scheduler: Scheduler
    readonly checker: Checker
    readonly raw: () => RawState
    readonly hooks: StateHooks
    readonly clock: TestClock
    readonly start: StartState
    /** The manifest key of the seeded tree, or null for an unseeded store. */
    readonly seedManifest: string | null
    envOf(seed: number): KeyEnv
    /** Resolves once a step satisfying `predicate` has been applied and judged by the checker. */
    when(predicate: (info: StepInfo) => boolean): Promise<void>
    /** Resolves once the `match.nth`th applied step `match` selects has been judged by the checker; at once when it already has. */
    reached(match: StepMatch): Promise<void>
    spawn(id: string, seed: number, program: (actor: ReplayActor) => Promise<void>, options?: ActorOptions): ReplayActor
    run(limit?: { maxSteps?: number }): Promise<RunResult>
}

// ---- The actor interface ----

export interface CommitOutcome {
    result: CommitResult
    /** The units the commit uploaded, manifest included; empty when it built nothing. */
    keys: string[]
}

export interface ClearOutcome {
    decision: 'none' | 'clear' | 'leave'
    cleared: AbandonResult | null
}

export type FirstLifeOutcome = { status: 'refused', reason: FirstLifeRefusal } | FirstLifeResult

/** The operations of an actor. Each declares its context first and returns the library's own result. */
export interface ReplayActor {
    readonly id: string
    readonly env: KeyEnv
    readonly rig: ReplayRig
    /** The page's session; throws before `open`. */
    readonly session: Store2Session

    /** `Store2Session.open` on the page's scheduled store: registration, re-flush, boot reads and the start-up clear. Once per page. */
    open(options?: { upstreamMainFile?: boolean }): Promise<Store2Session>
    /**
     * Tauri: the page is gone and a new one opens on the same device with the same owner store, which runs the start-up clear.
     * One environment step comes first: the page's other actors are retired, the unflushed writes are dropped from the store
     * (unless `drop` is false: a restart with no power loss) and the new page gets a byte store object of its own, so its backend has a
     * mutex of its own. Per-page state the old page held is gone with it: the recovery screen's read is discarded, and the
     * screen of the new page runs on the new page's boot read (`session.commitRead`, taken after its start-up clear).
     * The checker's record of the actor's own last reads stays and is replaced by the boot's, which reads the commit key and the
     * fence before any deleter can run.
     */
    restart(options?: { drop?: boolean }): Promise<Store2Session>

    // Commits.
    /** One ordinary commit of a complete tree of `10 + extra` units besides the manifest. */
    commit(tag: string, extra?: number): Promise<CommitOutcome>
    /** A bulk commit: its marker, the staged upload, the final write. */
    bulkCommit(tag: string): Promise<CommitOutcome>
    /** An ordinary commit that replaces the whole profile (`force`): the previous `current` enters `retained` whatever the admission interval says. */
    forcedCommit(tag: string, extra?: number): Promise<CommitOutcome>
    /** A bulk commit with `force`, as the commit of a `.bin` import is. */
    forcedBulkCommit(tag: string): Promise<CommitOutcome>
    /** The save-mine commit over a fresh read; refused on Node. */
    saveMine(tag: string, extra?: number): Promise<CommitOutcome>
    restore(manifestKey: string): Promise<WriteResult>
    pin(key: string, reason?: string): Promise<WriteResult>
    unpin(key: string): Promise<WriteResult>
    /** The clock moves past the retention admission interval and an ordinary commit follows: the previous current enters `retained`. */
    admit(tag: string, extra?: number): Promise<CommitOutcome>
    /** The commit key as a fresh read parses, or null when it does not parse. */
    readKey(): Promise<CommitKey | null>

    // Clears.
    /** The abandon-clear the page means for its own marker with `prefix`; `owner` is what it asks the committer to clear and defaults to the page's, so another owner's is a wrong clear that the checker reports. */
    abandonClear(prefix: string, owner?: string): Promise<AbandonResult>
    /** Clears the standing marker when this page's own, or when the foreign-clear hook says yes. */
    clearMarker(): Promise<ClearOutcome>

    // Garbage collection.
    gcPass(): Promise<GcResult>

    // Recovery.
    listRecoveryCandidates(): Promise<CandidateListing>
    runExit(kind: Extract<ExitKind, 'convert' | 'import' | 'seed'>): Promise<ExitResult>
    /** Picks a candidate up to the confirmation; the newest listed one by default. */
    pickCandidate(manifestKey?: string): Promise<PickResult>
    installPick(ready: PickReady): Promise<InstallResult>
    /**
     * First-life install on the page's boot facts: the unfenced marker and the staged install of a complete tree of `10 + extra` units
     * (the seed or convert label comes from the boot decision). A boot that is not first life answers `refused`.
     */
    firstLife(tag: string, extra?: number, convertedFrom?: string, label?: FirstLifeLabel): Promise<FirstLifeOutcome>
    /** The shared installer on a marker a fenced `runExit` wrote: the same tree shape as `firstLife`. */
    installAfterExit(marked: Extract<ExitResult, { status: 'marked' }>, tag: string, extra?: number): Promise<InstallResult>

    /**
     * A call the library never makes, under a declared operation and intent: how a test proves that the
     * labelling leaves the checker's guards armed (a fence removed under an exit, a marker cleared without consent).
     */
    declared<T>(context: ActorContext, intent: OperationIntent, run: (session: Store2Session) => Promise<T>): Promise<T>

    // Fence.
    fenceExit(): Promise<FenceExitResult>
    discardFence(): Promise<FenceDiscardResult>
}

/** A short name of a result: its status, and the reason or stop it carries. */
export function outcomeLabel(result: {
    status: string
    reason?: string
    stopped?: string
    fence?: { status: string }
    exit?: { status: string, reason?: string, fence?: { status: string } }
}): string {
    let label = result.status
    if (result.reason !== undefined) {
        label += `:${result.reason}`
    }
    if (result.stopped !== undefined) {
        label += `:${result.stopped}`
    }
    if (result.fence !== undefined) {
        label += `:${result.fence.status}`
    }
    if (result.exit !== undefined) {
        label += `:${outcomeLabel(result.exit)}`
    }
    return label
}

// ---- Labelling the writes whose kind depends on the value ----

/** What an operation is for, which decides how the decorator labels the commit-key writes whose kind depends on the value. */
export type OperationIntent = 'boot' | 'plain' | 'bulk' | 'recovery' | 'abandon' | 'clear'

interface ActorCore {
    readonly id: string
    readonly handle: ActorHandle
    /** The owner id of the page; known before the page opens, because the start-up clear is judged against it. */
    owner: string
    context: ActorContext | null
    intent: OperationIntent
    /** The marker prefix this actor set as a bulk commit's own. */
    ownPrefix: string | null
    /** The marker an explicit abandon-clear names. */
    abandon: { owner: string, prefix: string } | null
    /** The commit key as this actor's last read or own write left it, when it parsed. */
    lastKey: CommitKey | null
    /** The markers (owner|prefix) the foreign-clear hook said yes to. */
    consents: Set<string>
    /** The highest `seq` of a manifest this actor has read, 0 when it read none: what a recovery exit carries as `highestSeqRead`. */
    highestSeq: number
}

function markerId(marker: { owner: string, prefix: string }): string {
    return `${marker.owner}|${marker.prefix}`
}

function declare(core: ActorCore, context: ActorContext | null): void {
    core.context = context
    core.handle.setContext(context === null ? null : { ...context })
}

async function labelled<T>(core: ActorCore, context: ActorContext | null, run: () => Promise<T>): Promise<T> {
    if (context === null) {
        return run()
    }
    const previous = core.context
    declare(core, context)
    try {
        return await run()
    } finally {
        declare(core, previous)
    }
}

function sameStaging(a: CommitKey['staging'], b: CommitKey['staging']): boolean {
    return JSON.stringify(a) === JSON.stringify(b)
}

/** The context of a commit-key write whose staging changes, from what the actor declared it was doing; null where staging stays. */
function contextOfCommitWrite(core: ActorCore, next: CommitKey): ActorContext | null {
    const before = core.lastKey
    const old = before === null ? null : before.staging
    if (sameStaging(old, next.staging)) {
        return null
    }
    const owner = core.owner
    // An operation that declared no transition keeps its own context, so a staging change it has no right to is reported.
    if (next.staging !== null) {
        if (core.intent === 'recovery') {
            return { kind: 'recovery-begin', owner }
        }
        if (core.intent === 'bulk') {
            core.ownPrefix = next.staging.prefix
            return { kind: 'bulk-begin', owner }
        }
        return null
    }
    switch (core.intent) {
        case 'recovery':
            return { kind: 'recovery-install', owner }
        case 'boot':
        case 'clear':
            if (old !== null && old.owner === owner) {
                return { kind: 'start-clear', owner }
            }
            // Another owner's marker is cleared only with the consent recorded for that marker.
            return old !== null && core.consents.has(markerId(old)) ? { kind: 'foreign-clear', owner } : null
        case 'abandon':
            return { kind: 'abandon-clear', owner, ...(core.abandon === null ? {} : { abandon: core.abandon }) }
        case 'bulk':
            if (before !== null && next.current?.key !== before.current?.key) {
                return { kind: 'bulk-final', owner }
            }
            // A bulk commit that did not land clears its own marker; an actor that set none names no prefix.
            return { kind: 'abandon-clear', owner, abandon: { owner, prefix: core.ownPrefix ?? '' } }
        case 'plain':
            return null
    }
}

/** The backend a page's session and committer use: the library's own backend with the labelled writes. */
function labelWrites(inner: Store2Backend, current: () => ActorCore): Store2Backend {
    return {
        ...inner,
        async readCommit() {
            const read = await inner.readCommit()
            const parsed = classifyCommitRead(read)
            current().lastKey = parsed.status === 'parsed' ? parsed.value : null
            return read
        },
        async readUnits(keys) {
            const units = await inner.readUnits(keys)
            const core = current()
            for (const bytes of units.values()) {
                if (bytes === null) {
                    continue
                }
                // Only a manifest has a `seq`; a unit of another type reads as damaged for this type and is skipped.
                const unit = readUnit(bytes, UNIT_TYPE.manifest)
                if (unit.status === 'ok' || unit.status === 'stale') {
                    core.highestSeq = Math.max(core.highestSeq, (unit.value.body as Manifest).seq)
                }
            }
            return units
        },
        async casCommit(expected, next) {
            const core = current()
            const parsed = classifyCommitRead({ bytes: next })
            const context = parsed.status === 'parsed' ? contextOfCommitWrite(core, parsed.value) : null
            const result = await labelled(core, context, () => inner.casCommit(expected, next))
            if (parsed.status === 'parsed') {
                core.lastKey = parsed.value
            }
            return result
        },
        casFence(expected, next) {
            const core = current()
            // Each operation keeps its own context, so a fence written outside an exit or removed outside a discard is
            // reported; only the exit inside a recovery exit is not declared by the operation, so only a write under
            // the recovery marker's own context becomes a fence exit.
            const context: ActorContext | null = core.context?.kind === 'recovery-begin' && next !== null ? { kind: 'fence-exit', owner: core.owner } : null
            return labelled(core, context, () => inner.casFence(expected, next))
        },
    }
}

// ---- Holding calls back ----

type Gate = (op: string, target: string) => Promise<void> | null

async function waiting<T>(wait: Promise<void> | null, run: () => Promise<T>): Promise<T> {
    if (wait !== null) {
        await wait
    }
    return run()
}

function batchTarget(keys: readonly string[]): string {
    return keys.length === 1 ? keys[0] : `n=${keys.length}`
}

/**
 * A page's scheduled store with every call passed through `gate` first: a call the gate holds is not requested from the
 * scheduler until the gate's promise resolves. Ops and targets are named as the scheduler names them.
 */
function holdCalls(inner: ByteStore, gate: Gate): ByteStore {
    const innerGuarded = inner.guarded
    const guarded: GuardedOperations | undefined = innerGuarded === undefined ? undefined : {
        probe: () => waiting(gate('probe', ''), () => innerGuarded.probe()),
        writeChecked: (key, bytes, condition, checkOnly) => waiting(gate('writeChecked', key), () => innerGuarded.writeChecked(key, bytes, condition, checkOnly)),
        removeChecked: (entries, checkOnly) => waiting(gate('removeChecked', batchTarget(entries.map((entry) => entry.key))), () => innerGuarded.removeChecked(entries, checkOnly)),
        retireChecked: (entries, checkOnly) => waiting(gate('retireChecked', batchTarget(entries.map((entry) => entry.key))), () => innerGuarded.retireChecked(entries, checkOnly)),
    }
    const innerGate = inner.pageGate
    const pageGate: PageGateOperations | undefined = innerGate === undefined ? undefined : {
        registerPage: () => waiting(gate('registerPage', ''), () => innerGate.registerPage()),
        writeTop: (generation, key, bytes) => waiting(gate('writeTop', key), () => innerGate.writeTop(generation, key, bytes)),
        removeTop: (generation, keys) => waiting(gate('removeTop', batchTarget(keys)), () => innerGate.removeTop(generation, keys)),
    }
    const store: ByteStore = {
        ...inner,
        read: (key) => waiting(gate('read', key), () => inner.read(key)),
        write: (key, bytes, condition) => waiting(gate('write', key), () => inner.write(key, bytes, condition)),
        delete: (key, condition) => waiting(gate('delete', key), () => inner.delete(key, condition)),
        deleteMany: (entries) => waiting(gate('deleteMany', batchTarget(entries.map((entry) => entry.key))), () => inner.deleteMany(entries)),
        list: (prefix) => waiting(gate('list', prefix), () => inner.list(prefix)),
        has: (key) => waiting(gate('has', key), () => inner.has(key)),
    }
    const innerCount = inner.countPrefix
    if (innerCount !== undefined) {
        store.countPrefix = (prefix) => waiting(gate('countPrefix', prefix), () => innerCount.call(inner, prefix))
    }
    if (guarded !== undefined) {
        store.guarded = guarded
    }
    if (pageGate !== undefined) {
        store.pageGate = pageGate
    }
    return store
}

/**
 * A scheduled backend with every call passed through `gate` first, as `holdCalls` does for a byte store. Ops and targets are
 * named as the scheduler names backend calls: a batch is `n=<count>` (a single key is the key), a commit-key or fence step has
 * no target, and `readUnits` is named per key because the split under the hold has already made it one call per key.
 */
function holdBackendCalls(inner: Store2Backend, gate: Gate): Store2Backend {
    return {
        ...inner,
        readCommit: () => waiting(gate('readCommit', ''), () => inner.readCommit()),
        readFence: () => waiting(gate('readFence', ''), () => inner.readFence()),
        casCommit: (expected, next) => waiting(gate('casCommit', ''), () => inner.casCommit(expected, next)),
        casFence: (expected, next) => waiting(gate('casFence', ''), () => inner.casFence(expected, next)),
        readUnits: (keys) => waiting(gate('readUnits', batchTarget(keys)), () => inner.readUnits(keys)),
        listStore2: () => waiting(gate('listStore2', ''), () => inner.listStore2()),
        countPrefix: (prefix) => waiting(gate('countPrefix', prefix), () => inner.countPrefix(prefix)),
        commitOrdinary: (expected, units, next) => waiting(gate('commitOrdinary', `n=${units.length}`), () => inner.commitOrdinary(expected, units, next)),
        putUnit: (key, bytes) => waiting(gate('putUnit', key), () => inner.putUnit(key, bytes)),
        removeBatch: (keys, expectedCommit, expectedFence) => waiting(gate('removeBatch', batchTarget(keys)), () => inner.removeBatch(keys, expectedCommit, expectedFence)),
    }
}

// ---- Assembly ----

function plantStartState(parts: RigParts, state: StartState, env: KeyEnv, markerOwner: string): void {
    const { hooks } = parts
    if (state === 'marker-convert' || state === 'marker-seed' || state === 'marker-import') {
        const read = classifyCommitRead({ bytes: hooks.peek(COMMIT_KEY) })
        if (read.status !== 'parsed') {
            throw new Error('A marker start state needs the seeded commit key.')
        }
        const label: MarkerLabel = state === 'marker-convert' ? 'convert' : state === 'marker-seed' ? 'seed' : 'import'
        const key = nextCommitKey(read.value, {
            current: null,
            retained: [],
            pins: [],
            staging: { owner: markerOwner, prefix: stagingPrefix(newStagingId(env)), startedAt: env.now(), label },
        }, env)
        hooks.plant(COMMIT_KEY, encodeUnit(UNIT_TYPE.commit, key))
    }
    if (state === 'standing-fence') {
        hooks.plant(FENCE_KEY, encodeUnit(UNIT_TYPE.fenceRecord, { v: 1, at: env.now(), priorCommits: [], keys: hooks.list('store2/').map(tailOfKey) }))
    }
    if (state === 'damaged-commit' || state === 'both-damaged') {
        hooks.plant(COMMIT_KEY, GARBAGE)
    }
    if (state === 'damaged-fence' || state === 'both-damaged') {
        hooks.plant(FENCE_KEY, GARBAGE)
    }
}

/** The seeds the rig plants its states with; the seeding page uses 1. */
const PREPARE_SEED = 3
const START_SEED = 2

export function seededStart(state: StartState): boolean {
    return state !== 'no-commit-key'
}

export interface AssembleInput {
    parts: RigParts
    clock: TestClock
    seedManifest: string | null
    options: ReplayRigOptions
}

export function assembleRig(input: AssembleInput): ReplayRig {
    const { parts, clock, seedManifest, options } = input
    const start = options.start ?? 'healthy'
    const envOf = (seed: number): KeyEnv => testEnv(clock, seed)
    options.prepare?.(parts.hooks, envOf(PREPARE_SEED))
    plantStartState(parts, start, envOf(START_SEED), options.markerOwner ?? FOREIGN_OWNER)

    const checker = createChecker(parts.raw)
    const watchers: Array<{ predicate: (info: StepInfo) => boolean, resolve: () => void }> = []
    const judged: StepInfo[] = []
    const reached = (match: StepMatch): Promise<void> => {
        const wanted = match.nth ?? 1
        const seen = (): boolean => judged.filter((info) => stepMatches(info, match)).length >= wanted
        return seen() ? Promise.resolve() : new Promise<void>((resolve) => { watchers.push({ predicate: seen, resolve }) })
    }
    const scheduler = createScheduler({
        ...options.scheduler,
        ...(parts.unflushed === undefined ? {} : { unflushed: parts.unflushed }),
        onStep: (info) => {
            checker.observe(info)
            options.observe?.(info)
            judged.push(info)
            for (const watcher of watchers.filter((each) => each.predicate(info))) {
                watchers.splice(watchers.indexOf(watcher), 1)
                watcher.resolve()
            }
        },
    })
    const calling = new AsyncLocalStorage<ActorCore>()
    const currentCore = (): ActorCore => {
        const core = calling.getStore()
        if (core === undefined) {
            throw new Error('A page call was made outside every actor.')
        }
        return core
    }
    const sessions = new Map<string, Promise<Store2Session>>()
    const stores = new Map<string, ByteStore>()
    const ownerStores = new Map<string, { store: OwnerIdStore, value: () => string | null }>()
    const seeds = new Set<number>()
    // Per hold, how many calls it has matched so far; it holds the call numbered `call.nth` (the first by default).
    const holdCounts = (options.holds ?? []).map((hold) => ({ hold, seen: 0 }))
    const gate: Gate = (op, target) => {
        const core = currentCore()
        const context = core.context === null ? null : core.context.kind
        for (const state of holdCounts) {
            if (!selects(state.hold.call, core.id, op, target, context)) {
                continue
            }
            state.seen++
            if (state.seen === (state.hold.call.nth ?? 1)) {
                return reached(state.hold.until)
            }
        }
        return null
    }

    function ownerStoreOf(page: string): { store: OwnerIdStore, value: () => string | null } {
        let held = ownerStores.get(page)
        if (held === undefined) {
            let stored: string | null = null
            held = {
                store: { read: async () => stored, write: async (id) => { stored = id } },
                value: () => stored,
            }
            ownerStores.set(page, held)
        }
        return held
    }

    const rig: ReplayRig = {
        variant: parts.variant,
        scheduler,
        checker,
        raw: parts.raw,
        hooks: parts.hooks,
        clock,
        start,
        seedManifest,
        envOf,
        when: (predicate) => new Promise<void>((resolve) => { watchers.push({ predicate, resolve }) }),
        reached,
        run: (limit) => scheduler.run(limit),
        spawn(id, seed, program, actorOptions = {}) {
            if (seed < FIRST_ACTOR_SEED) {
                throw new RangeError(`Seed ${seed} is the rig's own: an actor's seed is at least ${FIRST_ACTOR_SEED}.`)
            }
            if (seeds.has(seed)) {
                throw new RangeError(`Seed ${seed} is used by another actor: the same seed mints the same keys.`)
            }
            seeds.add(seed)
            const page = parts.variant === 'tauri' ? actorOptions.page ?? id : id
            const env = envOf(seed)
            // An actor of a rig sees its own core and its page's session; the core exists once the scheduler starts the actor.
            let core: ActorCore | null = null
            const coreOf = (): ActorCore => {
                if (core === null) {
                    throw new Error(`Actor ${id} is not running.`)
                }
                return core
            }
            // The user's yes is recorded per marker, so a clear is labelled a foreign clear only for a marker that was consented to.
            const ask = actorOptions.foreignClear
            const foreignClear: ForeignClearHook | undefined = ask === undefined ? undefined : async (marker) => {
                const answer = await ask(marker)
                if (answer) {
                    // The actor whose call is running asked, which on a shared Tauri page is not always the actor that opened it.
                    const asking = currentCore()
                    asking.consents.add(markerId(marker))
                    checker.consent({ page: asking.id, owner: marker.owner, prefix: marker.prefix })
                }
                return answer
            }
            const sessionOf = async (): Promise<Store2Session> => {
                const opened = sessions.get(page)
                if (opened === undefined) {
                    throw new Error(`The page ${page} is not open: call open first.`)
                }
                return opened
            }
            let resolved: Store2Session | null = null
            const pageStoreOf = (handle: ActorHandle): ByteStore => {
                let held = stores.get(page)
                if (held === undefined) {
                    const scheduled = parts.pageStore(handle)
                    held = holdCounts.length === 0 ? scheduled : holdCalls(scheduled, gate)
                    stores.set(page, held)
                }
                return held
            }
            const need = (): Store2Session => {
                if (resolved === null) {
                    throw new Error(`Actor ${id} has not opened its page.`)
                }
                return resolved
            }
            const committerOf = (): NonNullable<Store2Session['committer']> => {
                const committer = need().committer
                if (committer === null) {
                    throw new Error('The page opened read-only.')
                }
                return committer
            }
            const backendOf = (): Store2Backend => {
                const backend = need().backend
                if (backend === null) {
                    throw new Error('The page opened read-only.')
                }
                return backend
            }
            const begin = (context: ActorContext, intent: OperationIntent): void => {
                const own = coreOf()
                own.intent = intent
                own.abandon = null
                declare(own, { ...context, owner: own.owner })
            }
            const finish = (): void => {
                const own = coreOf()
                own.intent = 'plain'
                declare(own, null)
            }
            async function operation<T>(context: ActorContext, intent: OperationIntent, run: () => Promise<T>): Promise<T> {
                begin(context, intent)
                try {
                    return await run()
                } finally {
                    finish()
                }
            }
            async function commitOf(kind: 'commit' | 'save-mine' | 'bulk-begin', intent: OperationIntent, tag: string, extra: number, fresh: boolean, force = false): Promise<CommitOutcome> {
                return operation({ kind }, intent, async () => {
                    const committer = committerOf()
                    const record: BuildRecord[] = []
                    const read = await committer.readCommit()
                    const request = { ...treeRequest(extra, { tag, record }), ...(force ? { force: true } : {}) }
                    const result = fresh ? await committer.saveMine(read, request) : await committer.commit(read, request)
                    return { result, keys: record.length === 0 ? [] : record[record.length - 1].keys }
                })
            }
            async function freshKey(): Promise<{ read: Store2Read, key: CommitKey | null }> {
                const read = await backendOf().readCommit()
                const parsed = classifyCommitRead(read)
                return { read, key: parsed.status === 'parsed' ? parsed.value : null }
            }
            /**
             * The commit key the recovery screen runs on: the read the page made when it booted (or after its start-up clear), which is
             * what the app's screen holds while the user decides. The exit's marker write is then made at that read's token, so a key
             * that moved since the boot conflicts there. An exit or pick that answers `conflict` hands the screen the key the conflict
             * carried, and the screen's next run starts from that read. A page whose boot read failed booted `blocked`: it has no
             * recovery screen, so there is nothing to run.
             */
            let screen: Store2Read | null = null
            async function screenRead(): Promise<Store2Read> {
                const held = screen ?? need().commitRead
                if (held === null) {
                    throw new Error('The page\'s boot read failed: there is no recovery screen.')
                }
                return held
            }
            const actor: ReplayActor = {
                id,
                env,
                rig,
                get session() {
                    return need()
                },
                async open(openOptions = {}) {
                    const own = coreOf()
                    own.intent = 'boot'
                    declare(own, { kind: 'read', owner: own.owner })
                    try {
                        if (sessions.has(page)) {
                            resolved = await sessionOf()
                            own.owner = resolved.ownerId
                            return resolved
                        }
                        const held = ownerStoreOf(actorOptions.device ?? page)
                        const expected = parts.deviceOwner && held.value() !== null && isOwnerId(held.value() as string) ? held.value() as string : freshOwnerId(envOf(seed))
                        own.owner = expected
                        const opening = (async (): Promise<Store2Session> => {
                            const store = pageStoreOf(own.handle)
                            let opened: Store2Backend
                            try {
                                opened = await parts.openBackend(store, { handle: own.handle, hold: (scheduled) => (holdCounts.length === 0 ? scheduled : holdBackendCalls(scheduled, gate)) })
                            } catch (error) {
                                if (error instanceof Store2BackendError) {
                                    throw new PageUnavailableError(error)
                                }
                                throw error
                            }
                            const backend = labelWrites(opened, currentCore)
                            return Store2Session.open(store, {
                                kind: parts.variant,
                                backend,
                                env,
                                ownerStore: parts.deviceOwner ? held.store : undefined,
                                upstreamMainFile: async () => openOptions.upstreamMainFile ?? actorOptions.upstreamMainFile ?? false,
                                foreignClear,
                            })
                        })()
                        sessions.set(page, opening)
                        try {
                            resolved = await opening
                        } catch (error) {
                            sessions.delete(page)
                            throw error
                        }
                        if (resolved.ownerId !== expected) {
                            throw new Error(`The page's owner id ${resolved.ownerId} is not the expected ${expected}.`)
                        }
                        return resolved
                    } finally {
                        own.intent = 'plain'
                        declare(own, null)
                    }
                },
                async restart(restartOptions = {}) {
                    const restartDevice = parts.restart
                    if (!parts.deviceOwner || restartDevice === undefined) {
                        throw new RangeError('A restart keeps the owner id of the device: Tauri only.')
                    }
                    await coreOf().handle.restartPage(() => `dropped=${restartDevice(restartOptions.drop ?? true).length}`)
                    sessions.delete(page)
                    stores.delete(page)
                    resolved = null
                    screen = null
                    return actor.open()
                },

                commit: (tag, extra = 0) => commitOf('commit', 'plain', tag, extra, false),
                bulkCommit: (tag) => commitOf('bulk-begin', 'bulk', tag, BULK_EXTRA, false),
                forcedCommit: (tag, extra = 0) => commitOf('commit', 'plain', tag, extra, false, true),
                forcedBulkCommit: (tag) => commitOf('bulk-begin', 'bulk', tag, BULK_EXTRA, false, true),
                saveMine: (tag, extra = 0) => commitOf('save-mine', 'plain', tag, extra, true),
                restore: (manifestKey) => operation({ kind: 'restore' }, 'plain', async () => committerOf().restore(await committerOf().readCommit(), manifestKey)),
                pin: (key, reason = 'keep') => operation({ kind: 'pin' }, 'plain', async () => committerOf().pin(await committerOf().readCommit(), key, reason)),
                unpin: (key) => operation({ kind: 'unpin' }, 'plain', async () => committerOf().unpin(await committerOf().readCommit(), key)),
                async admit(tag, extra = 0) {
                    rig.clock.advance(ADMISSION_INTERVAL_MS + 1)
                    return actor.commit(tag, extra)
                },
                readKey: () => operation({ kind: 'read' }, 'plain', async () => (await freshKey()).key),

                abandonClear: (prefix, owner) => operation({ kind: 'abandon-clear' }, 'abandon', async () => {
                    const own = coreOf()
                    // The page means to clear its own marker; what it asks the committer to clear is the owner it was given.
                    own.abandon = { owner: own.owner, prefix }
                    declare(own, { kind: 'abandon-clear', owner: own.owner, abandon: own.abandon })
                    return committerOf().abandonClear(await committerOf().readCommit(), owner ?? own.owner, prefix)
                }),
                clearMarker: () => operation({ kind: 'read' }, 'clear', async () => {
                    // Which kind of clear it is depends on whose marker stands and on the hook's answer: the backend labels it.
                    const { read } = await freshKey()
                    const outcome = await committerOf().clearMarker(read)
                    return { decision: outcome.decision.decision, cleared: outcome.cleared }
                }),

                gcPass: () => operation({ kind: 'gc' }, 'plain', async () => {
                    const session = need()
                    return gcPass({ backend: backendOf(), kind: parts.variant, idleReason: () => session.idleReason, probe: parts.probe(pageStoreOf(coreOf().handle)) })
                }),

                listRecoveryCandidates: () => operation({ kind: 'read' }, 'plain', async () => {
                    return listRecoveryCandidates(backendOf(), classifyCommitRead((await freshKey()).read))
                }),
                runExit: (kind) => operation({ kind: 'recovery-begin' }, 'recovery', async () => {
                    const read = await screenRead()
                    const exit = await runExit(backendOf(), read, { kind, highestSeqRead: coreOf().highestSeq }, { owner: need().ownerId, env, foreignClear })
                    if (exit.status === 'conflict') {
                        screen = exit.current
                    }
                    return exit
                }),
                pickCandidate: (manifestKey) => operation({ kind: 'recovery-begin' }, 'recovery', async () => {
                    const read = await screenRead()
                    let target = manifestKey
                    if (target === undefined) {
                        const listed = await listRecoveryCandidates(backendOf(), classifyCommitRead(read))
                        if (listed.status !== 'listed' || listed.candidates.length === 0) {
                            throw new Error('There is no candidate to pick.')
                        }
                        target = listed.candidates[0]
                    }
                    const picked = await pickCandidate(backendOf(), read, target, {
                        owner: need().ownerId,
                        env,
                        foreignClear,
                        assetsPresent: async (asked) => (actorOptions.present?.assets === false ? new Set<string>() : new Set(asked)),
                        inlaysPresent: async (asked) => (actorOptions.present?.inlays === false ? new Set<string>() : new Set(asked)),
                        inlayPrefixesPresent: async (asked) => (actorOptions.present?.inlays === false ? new Set<string>() : new Set(asked)),
                    })
                    if (picked.status === 'exit' && picked.exit.status === 'conflict') {
                        screen = picked.exit.current
                    }
                    return picked
                }),
                installPick: (ready) => operation({ kind: 'recovery-install' }, 'recovery', async () => {
                    const result = await installPick(ready, { confirm: true })
                    // An install reported as done must be a write the checker saw this actor make, naming the manifest it installed, and the result's own bytes must name it too.
                    if (result.status === 'installed') {
                        checker.installed(id, result.manifestKey, result.bytes)
                    }
                    return result
                }),

                firstLife: (tag, extra = 0, convertedFrom = 'seed', label) => operation({ kind: 'recovery-begin' }, 'recovery', async () => {
                    const session = need()
                    const facts = { decision: session.decision, commitRead: session.commitRead, startupClear: session.startupClear }
                    // A label override (a boot restore or import) is accepted by the grant on a row-1 decision only.
                    const decision = session.decision
                    const grant = label === undefined ? firstLifeGrant(facts)
                        : decision.row === 1 && decision.mode === 'first-life' ? firstLifeGrant({ ...facts, decision }, { label })
                            : { status: 'refused' as const, reason: 'label-not-row-1' as const, detail: 'A label override is accepted only on a boot row 1 grant.' }
                    if (grant.status === 'refused') {
                        return { status: 'refused', reason: grant.reason }
                    }
                    const result = await firstLifeInstall(backendOf(), grant.grant, { ...treeRequest(extra, { tag }), convertedFrom }, { owner: session.ownerId, env })
                    if (result.status === 'installed') {
                        checker.installed(id, result.manifestKey, result.bytes)
                    }
                    return result
                }),
                installAfterExit: (marked, tag, extra = 0) => operation({ kind: 'recovery-install' }, 'recovery', async () => {
                    const result = await installBuilt({ backend: backendOf(), env, marked }, { ...treeRequest(extra, { tag }), convertedFrom: 'seed' })
                    if (result.status === 'installed') {
                        checker.installed(id, result.manifestKey, result.bytes)
                    }
                    return result
                }),

                declared: (context, intent, run) => operation(context, intent, () => run(need())),

                fenceExit: () => operation({ kind: 'fence-exit' }, 'plain', async () => {
                    const { key, read } = await freshKey()
                    return fenceExit(backendOf(), { damagedCommitBytes: key === null ? read.bytes : null, now: env.now })
                }),
                discardFence: () => operation({ kind: 'fence-discard' }, 'plain', async () => {
                    const verdict = await readFenceVerdict(backendOf())
                    if (verdict.token === null) {
                        throw new Error('The fence could not be read.')
                    }
                    return discardFence(backendOf(), verdict.token)
                }),
            }
            scheduler.spawn(id, async (handle) => {
                core = { id, handle, owner: '', context: null, intent: 'plain', ownPrefix: null, abandon: null, lastKey: null, consents: new Set<string>(), highestSeq: 0 }
                await calling.run(core, () => program(actor))
                handle.setContext(null)
            }, parts.variant === 'tauri' ? { page } : {})
            return actor
        },
    }
    return rig
}
