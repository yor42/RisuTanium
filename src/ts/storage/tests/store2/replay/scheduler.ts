/**
 * The step gate of the store2 replay. Every call an actor makes to a scheduled
 * layer (a `ByteStore` under the Node and Tauri backends, a `Store2Backend` for
 * IndexedDB and memory) becomes a pending request. The scheduler grants exactly
 * one request per step, chosen by a seeded generator or by a PCT policy, runs it
 * against the layer underneath and only then lets the actor continue. The library
 * code under test runs unmodified: only the layer it calls is wrapped.
 *
 * Faults are decisions taken when a write is granted:
 *  - crash after own write: the write applies, the actor's call never resolves and
 *    the actor is retired. Calls of the actor that were granted earlier stay
 *    applied; calls it had pending and not yet granted are dropped and never apply.
 *  - lost response: the write applies, then the call fails with the layer's
 *    unknown-outcome error. A conflict the write would have reported is hidden by
 *    the loss, as a dropped reply hides it on the wire.
 *  - lost request: the write does NOT apply and the call fails with the same
 *    unknown-outcome error, so the "did not land" branches are reached directly.
 *  - damage of the commit key or the fence is an environment action taken in its
 *    own step.
 *  - partial removal (a `deleteMany` only): a seeded subset of its keys is removed
 *    and the rest are reported failed, in a `StoreDeleteManyError` like the one the
 *    Tauri store throws after a rejected file removal.
 * Only writes fault; a failing read is a definite failure and is not modelled
 * here, so a checker branch that needs an unreadable key is reached only through
 * damage. `deleteMany` is called by the Tauri backend's `removeBatch`: its lost
 * response and lost request both surface as a `StoreDeleteManyError` whose keys
 * are all `failed`, which the backend maps to an unknown outcome.
 *
 * A store's `pageGate` capability (Tauri page generation) is wrapped like the other
 * write paths: `registerPage` and `writeTop` can be lost, lost-response or crash,
 * and `removeTop` behaves as a `deleteMany` (lost, partial removal, crash).
 *
 * Delayed landing (scripted only): a crash that keeps the actor's decisive call
 * instead of applying it, the way a native command outlives the page that sent it.
 * The call lands in a step of its own, chosen like any other request, once its
 * `landWhen` predicate holds, attributed to the dead actor and its operation.
 *  - `ghost-queued`: the call has not reached the native lock. Its landing runs the
 *    store's own call, so a gate that checks and applies as one step refuses it
 *    when a later registration made it stale.
 *  - `ghost-held`: the call took the lock and passed its check (`beginWriteTop` /
 *    `beginRemoveTop` of a `TwoStepPageGate`) and applies at its landing.
 * A plain `write`, `delete` or `deleteMany` can only be `ghost-queued`: it takes no
 * lock, which is how the ungated paths are modelled.
 *
 * The native lock is modelled here as well as in the store: while a `ghost-held`
 * call holds it, a granted call that takes it (`registerPage`, `writeTop`,
 * `removeTop`, whatever fault it carries but a lost request) is parked without
 * being started, and a queued landing of such a call is not offered. The lock is
 * taken in arrival order: a lock-taking call granted while others wait parks
 * behind them too. Once no held ghost has the lock the oldest parked call is a
 * candidate step like any other request, so other actors' steps can come between
 * the landing and the call: the state it changes is judged under its own actor
 * and operation on a step number of its own, never under the landing's. A run in
 * which every way forward waits for a held lock ends `stalled`, whatever overlap
 * of held ghosts caused it, and so does a registration that waits for a landing
 * that never comes.
 *
 * Actors of one Tauri page share one scheduled `ByteStore` per inner store (the
 * `page` option of `spawn`), so the backend's in-process mutex, which is keyed by
 * the store object, is shared as it is in the app. Each call is attributed to its
 * actor through an `AsyncLocalStorage` entered when the actor is spawned. A crash
 * retires every actor of the page: a mutex held by a crashed call is never
 * released, and its waiters would otherwise read as a stall.
 *
 * The same seed and options give the same call log: the generator decides every
 * choice, requests are listed in arrival order, and the scheduler drains the
 * microtasks of every actor between steps. Actors therefore must not wait on real
 * timers or on I/O outside the scheduled layer, and must inject a seeded `KeyEnv`
 * into the library code they run: the default environment reads the clock and
 * `Math.random`, and the call log would differ between runs.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { crc32 } from 'src/ts/storage/blockFrame'
import type { ByteStore, CheckOnlyEntry, DeleteEntry, GuardedOperations, PageGateOperations, StoreCondition } from 'src/ts/storage/store/contract'
import { StoreDeleteManyError, StoreInvalidKeyError, StoreOutcomeUnknownError, type DeleteReportEntry } from 'src/ts/storage/store/errors'
import { versionOf } from 'src/ts/storage/store/guards'
import { Store2BackendError, Store2CommitConflictError, Store2UnknownOutcomeError, checkUnitKeys, type CompareToken, type Store2Backend } from 'src/ts/storage/store2/backend'
import { COMMIT_KEY, FENCE_KEY } from 'src/ts/storage/store2/format/keys'

/** A seeded generator in [0, 1). */
export function createRng(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6D2B79F5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

// ---- Raw state, shared with the checker ----

/** One key as stored. `revision` is null on a layer that reports none (the backends that compare bytes). */
export interface RawEntry {
    bytes: Uint8Array | null
    revision: number | null
}

export type RawState = ReadonlyMap<string, RawEntry>

// ---- What a step reports ----

export type FaultKind = 'lost-response' | 'lost-request' | 'crash-after-write' | 'partial-removal' | 'ghost-queued' | 'ghost-held'

function isGhostKind(kind: FaultKind | null): kind is 'ghost-queued' | 'ghost-held' {
    return kind === 'ghost-queued' || kind === 'ghost-held'
}

/** The landing of a decisive call that holds the native lock: it applies the call and releases the lock; a one-shot. */
export type Landing = () => Promise<unknown>

/**
 * A page gate whose decisive calls can also run in two steps, which is how a call
 * that outlives its page is modelled: `begin*` takes the lock and makes the
 * generation check in one step (rejecting with the stale-generation error when the
 * check fails, with the lock released), and the returned landing applies and releases.
 */
export interface TwoStepPageGate extends PageGateOperations {
    beginWriteTop(generation: number, key: string, bytes: Uint8Array): Promise<Landing>
    beginRemoveTop(generation: number, keys: readonly string[]): Promise<Landing>
}

function isTwoStepGate(gate: PageGateOperations): gate is TwoStepPageGate {
    return 'beginWriteTop' in gate && 'beginRemoveTop' in gate
}
/**
 * An environment step: silent damage of the commit key or the fence, or the loss of a unit
 * (`remove-unit`: a file that is gone from the store without any actor removing it). Only a
 * `remove-unit` step excuses the stored state from the I1 walk, and only for the keys it removed.
 */
export type EnvFault = 'damage-commit' | 'damage-fence' | 'remove-unit'

/** What the actor is doing, declared by the actor; the checker judges transitions of the commit key against it. */
export type OperationKind =
    | 'commit' | 'bulk-begin' | 'bulk-final' | 'save-mine' | 'restore' | 'pin' | 'unpin'
    | 'start-clear' | 'foreign-clear' | 'abandon-clear' | 'recovery-begin' | 'recovery-install'
    | 'fence-exit' | 'fence-discard' | 'gc' | 'read'

export interface ActorContext {
    kind: OperationKind
    /** The actor's owner id. */
    owner?: string
    /** For an abandon-clear: the marker the actor means to clear. */
    abandon?: { owner: string, prefix: string }
}

/** The compare basis a write presented for the commit key or the fence. */
export type Expect = { kind: 'bytes', bytes: Uint8Array | null } | { kind: 'revision', revision: number | null }

export interface StepInfo {
    step: number
    actor: string
    kind: 'call' | 'env'
    op: string
    target: string
    /** False only for a lost request. */
    applied: boolean
    fault: FaultKind | EnvFault | null
    context: ActorContext | null
    commitExpect: Expect | null
    /** The fence basis the call presented; the checker compares it with the stored fence. */
    fenceExpect: Expect | null
    /**
     * Set on a backend-layer call that failed with a commit conflict the actor saw: the commit key bytes the conflict carried
     * (null for an absent key). The backend reads the key inside the compare, so no call of its own shows the actor this value,
     * and the checker counts it as the actor's commit read. Absent on every other step, and on a conflict a lost reply hid.
     */
    commitConflictRead?: Uint8Array | null
}

export interface LogEntry {
    step: number
    actor: string
    op: string
    target: string
    fault: FaultKind | EnvFault | null
    outcome: string
}

// ---- Configuration ----

export type PolicyConfig =
    | { kind: 'random' }
    /** Priorities plus `depth` change points. Explicit `changePoints` are 1-based step numbers; otherwise `depth` distinct steps in [1, horizon] are drawn. */
    | { kind: 'pct', depth: number, horizon: number, changePoints?: readonly number[] }

export interface FaultBudget {
    /** Lost responses, lost requests and partial removals together, per actor. `Infinity` is unbounded. */
    lostPerActor: number
    crashPerActor: number
}

/** Which call a scripted fault hits: the actor's nth granted write that can fault (1-based), or its nth call (1-based, the first by default) of an op (or of any op listed) and, when given, a target and the operation the actor declared. */
export type ScriptedSelector = { write: number } | { op: string | readonly string[], target?: string, context?: OperationKind, nth?: number }

export type ScriptedFault = ScriptedSelector & {
    actor: string
    kind: FaultKind
    /** A ghost kind only: the landing is a candidate step once this holds; absent means at once. */
    landWhen?: () => boolean
}

export type FaultPlan =
    | { mode: 'none' }
    | { mode: 'random', probability: number, budget: FaultBudget }
    /** `budget`, when given, is enforced over the entries when the scheduler is built. */
    | { mode: 'script', entries: readonly ScriptedFault[], budget?: FaultBudget }

export interface SchedulerOptions {
    seed: number
    policy?: PolicyConfig
    faults?: FaultPlan
    /** Called after each step has applied and before the actor continues. */
    onStep?: (info: StepInfo) => void
}

export interface SpawnOptions {
    /** Actors with the same page share one scheduled `ByteStore` per inner store, and a crash of one retires them all. */
    page?: string
}

export interface ActorHandle {
    readonly id: string
    /** The operation the actor is in; attached to every request it makes from now on. */
    setContext(context: ActorContext | null): void
    backend(inner: Store2Backend): Store2Backend
    byteStore(inner: ByteStore): ByteStore
}

export interface ActorReport {
    state: 'running' | 'done' | 'failed' | 'crashed'
    error?: string
    /** Granted calls. */
    calls: number
    /** Granted writes that can fault. */
    writes: number
}

export interface RunResult {
    status: 'finished' | 'stalled' | 'max-steps'
    steps: number
    actors: Record<string, ActorReport>
}

export interface Scheduler {
    spawn(id: string, body: (actor: ActorHandle) => Promise<void>, options?: SpawnOptions): void
    /** A one-shot environment step (damage) that competes with the actors' requests until it is taken. */
    environment(name: string, fault: EnvFault, apply: () => void): void
    run(limit?: { maxSteps?: number }): Promise<RunResult>
    readonly log: readonly LogEntry[]
    /** The PCT change points in force; empty for the random policy. */
    readonly changePoints: readonly number[]
    /** Key set, revisions, commit-key bytes, fence bytes and every actor's program counter, as a short string. */
    fingerprint(raw: RawState): string
}

// ---- Internals ----

interface LossSpec {
    lost(kind: 'response' | 'request'): Error
    hides(error: unknown): boolean
}

interface CallSpec {
    op: string
    target: string
    /** A write: the call can crash its actor. */
    write: boolean
    loss: LossSpec | null
    commitExpect: Expect | null
    fenceExpect: Expect | null
    /** A `deleteMany`: its entries and the call that removes only a subset of them, so a partial removal can happen. */
    removal: { entries: readonly DeleteEntry[], runSubset: (entries: readonly DeleteEntry[]) => Promise<void> } | null
    /** A decisive write or removal: how it can outlive its actor. `begin` is null where the call takes no native lock. */
    ghost: { queued: () => Promise<unknown>, begin: (() => Promise<Landing>) | null } | null
    /** The call takes the native lock of the page gate: it cannot start while a held ghost has it. */
    lock: boolean
}

/** A decisive call kept after its actor crashed, waiting for its landing step. */
interface Ghost {
    id: number
    actor: string
    spec: CallSpec
    context: ActorContext | null
    kind: 'ghost-queued' | 'ghost-held'
    land: () => Promise<unknown>
    landWhen: () => boolean
}

/** A granted call waiting for the lock a held ghost has: once the lock is free its `resume` is a candidate step of its own. */
interface Parked {
    id: number
    actor: string
    op: string
    target: string
    resume: () => Promise<void>
}

interface Pending {
    id: number
    actor: string
    spec: CallSpec
    context: ActorContext | null
    run: () => Promise<unknown>
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
}

interface EnvAction {
    id: number
    name: string
    fault: EnvFault
    apply: () => void
}

interface Candidate {
    id: number
    actor: string
}

interface Policy {
    pick(candidates: readonly Candidate[], step: number): Candidate
    readonly changePoints: readonly number[]
}

function randomPolicy(rng: () => number): Policy {
    return {
        changePoints: [],
        pick: (candidates) => candidates[Math.floor(rng() * candidates.length)],
    }
}

/**
 * `orderRng` is a stream of its own: choosing among one actor's pending requests
 * never shifts the draws of the priorities and change points.
 */
function pctPolicy(rng: () => number, orderRng: () => number, config: Extract<PolicyConfig, { kind: 'pct' }>): Policy {
    let changePoints: number[]
    if (config.changePoints !== undefined) {
        changePoints = [...config.changePoints]
    } else {
        const drawn = new Set<number>()
        while (drawn.size < Math.min(config.depth, config.horizon)) {
            drawn.add(1 + Math.floor(rng() * config.horizon))
        }
        changePoints = [...drawn].sort((a, b) => a - b)
    }
    const priorities = new Map<string, number>()
    const priorityOf = (actor: string): number => {
        let priority = priorities.get(actor)
        if (priority === undefined) {
            // Initial priorities sit above every value a change point assigns.
            priority = changePoints.length + 1 + rng()
            priorities.set(actor, priority)
        }
        return priority
    }
    const best = (candidates: readonly Candidate[]): Candidate => {
        let chosen = candidates[0]
        for (const candidate of candidates) {
            if (priorityOf(candidate.actor) > priorityOf(chosen.actor)) {
                chosen = candidate
            }
        }
        return chosen
    }
    return {
        changePoints,
        pick(candidates, step) {
            let chosen = best(candidates)
            const index = changePoints.indexOf(step)
            if (index >= 0) {
                // The actor that would run is lowered below every other one.
                priorities.set(chosen.actor, index + 1)
                chosen = best(candidates)
            }
            // Which of that actor's concurrent requests is granted first is not fixed by arrival.
            const own = candidates.filter((candidate) => candidate.actor === chosen.actor)
            return own.length === 1 ? own[0] : own[Math.floor(orderRng() * own.length)]
        },
    }
}

function yieldMacrotask(): Promise<void> {
    return new Promise<void>((resolve) => setImmediate(resolve))
}

function errorName(error: unknown): string {
    return error instanceof Error ? error.constructor.name : typeof error
}

function tokenExpect(token: CompareToken): Expect {
    return token.kind === 'bytes' ? { kind: 'bytes', bytes: token.bytes } : { kind: 'revision', revision: token.revision }
}

function hex(bytes: Uint8Array): string {
    let out = ''
    for (const byte of bytes) {
        out += byte.toString(16).padStart(2, '0')
    }
    return out
}

function fnv1a(text: string, seed: number): number {
    let hash = seed >>> 0
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i)
        hash = Math.imul(hash, 16777619) >>> 0
    }
    return hash
}

const BACKEND_LOSS: LossSpec = {
    lost: (kind) => new Store2UnknownOutcomeError(`Injected lost ${kind}.`),
    // A lost reply hides what the call reported, exactly as the memory backend's own fault mode does.
    hides: (error) => error instanceof Store2BackendError,
}

/** A lost reply hides every reply the server gave; only the client's own refusal of a key happens before a request exists. */
function hidesServerReply(error: unknown): boolean {
    return !(error instanceof StoreInvalidKeyError)
}

function guardedLoss(operation: 'write-checked' | 'remove-checked'): LossSpec {
    return {
        lost: () => new StoreOutcomeUnknownError(operation, new TypeError('fetch failed')),
        hides: hidesServerReply,
    }
}

const PLAIN_LOSS: LossSpec = {
    lost: () => new TypeError('fetch failed'),
    hides: hidesServerReply,
}

/** What the Tauri store throws when a removal request fails: every key `failed`, whether or not the file went. */
function deleteManyLoss(entries: readonly DeleteEntry[]): LossSpec {
    return {
        lost: () => new StoreDeleteManyError(entries.map((entry): DeleteReportEntry => ({ key: entry.key, outcome: 'failed', error: new TypeError('fetch failed') }))),
        hides: hidesServerReply,
    }
}

function callSpec(
    op: string, target: string, write: boolean, loss: LossSpec | null,
    expects: Pick<CallSpec, 'commitExpect' | 'fenceExpect'> = { commitExpect: null, fenceExpect: null },
    removal: CallSpec['removal'] = null,
    ghost: CallSpec['ghost'] = null,
    lock = false,
): CallSpec {
    return { op, target, write, loss, ...expects, removal, ghost, lock }
}

function keysTarget(keys: readonly string[]): string {
    return keys.length === 1 ? keys[0] : `n=${keys.length}`
}

function conditionExpect(condition: StoreCondition): Expect {
    return { kind: 'revision', revision: versionOf(condition) }
}

/** What a byte-store write of `key` presents for the commit key or the fence. */
function keyExpects(key: string, expect: Expect): Pick<CallSpec, 'commitExpect' | 'fenceExpect'> {
    return {
        commitExpect: key === COMMIT_KEY ? expect : null,
        fenceExpect: key === FENCE_KEY ? expect : null,
    }
}

function checkOnlyExpects(entries: readonly DeleteEntry[], checkOnly: readonly CheckOnlyEntry[]): Pick<CallSpec, 'commitExpect' | 'fenceExpect'> {
    let commitExpect: Expect | null = null
    let fenceExpect: Expect | null = null
    for (const entry of entries) {
        const expect = conditionExpect(entry.condition)
        commitExpect = entry.key === COMMIT_KEY ? expect : commitExpect
        fenceExpect = entry.key === FENCE_KEY ? expect : fenceExpect
    }
    for (const entry of checkOnly) {
        const expect: Expect = { kind: 'revision', revision: entry.version }
        commitExpect = entry.key === COMMIT_KEY ? expect : commitExpect
        fenceExpect = entry.key === FENCE_KEY ? expect : fenceExpect
    }
    return { commitExpect, fenceExpect }
}

interface ActorState {
    status: ActorReport['state']
    error?: string
    calls: number
    writes: number
    lost: number
    crashes: number
    context: ActorContext | null
    page: string | null
}

export function createScheduler(options: SchedulerOptions): Scheduler {
    const policyConfig = options.policy ?? { kind: 'random' }
    const policy = policyConfig.kind === 'random'
        ? randomPolicy(createRng(options.seed))
        : pctPolicy(createRng(options.seed), createRng(options.seed ^ 0x85EBCA6B), policyConfig)
    const faultRng = createRng(options.seed ^ 0x9E3779B9)
    const plan: FaultPlan = options.faults ?? { mode: 'none' }
    if (plan.mode === 'script' && plan.budget !== undefined) {
        const lost = new Map<string, number>()
        const crashes = new Map<string, number>()
        for (const entry of plan.entries) {
            const counts = entry.kind === 'crash-after-write' || isGhostKind(entry.kind) ? crashes : lost
            counts.set(entry.actor, (counts.get(entry.actor) ?? 0) + 1)
        }
        for (const count of lost.values()) {
            if (count > plan.budget.lostPerActor) {
                throw new RangeError('A scripted fault plan exceeds the lost-call budget of an actor.')
            }
        }
        for (const count of crashes.values()) {
            if (count > plan.budget.crashPerActor) {
                throw new RangeError('A scripted fault plan exceeds the crash budget of an actor.')
            }
        }
    }

    const actors = new Map<string, ActorState>()
    const order: string[] = []
    let pending: Pending[] = []
    const envActions: EnvAction[] = []
    const ghosts: Ghost[] = []
    const parked: Parked[] = []
    /** Per call-selected scripted fault, how many calls it matched so far. */
    const selected = new Map<ScriptedFault, number>()
    /** The scripted entry behind the fault `decideFault` last returned, or null. */
    let scriptedHit: ScriptedFault | null = null
    const log: LogEntry[] = []
    const attribution = new AsyncLocalStorage<string>()
    const pageStores = new Map<string, WeakMap<ByteStore, ByteStore>>()
    let nextId = 0
    let stepNo = 0

    function stateOf(id: string): ActorState {
        const state = actors.get(id)
        if (state === undefined) {
            throw new RangeError(`Unknown actor ${id}.`)
        }
        return state
    }

    /** `who` is the actor, or a function naming it per call: a store shared by the actors of a page. */
    function request<T>(who: string | (() => string), spec: CallSpec, run: () => Promise<T>): Promise<T> {
        const actor = typeof who === 'string' ? who : who()
        const state = stateOf(actor)
        if (state.status === 'crashed') {
            return new Promise<T>(() => {})
        }
        return new Promise<T>((resolve, reject) => {
            pending.push({
                id: ++nextId, actor, spec, context: state.context, run,
                resolve: resolve as (value: unknown) => void, reject,
            })
        })
    }

    function backendFor(actor: string, inner: Store2Backend): Store2Backend {
        const loss = BACKEND_LOSS
        return {
            readCommit: () => request(actor, callSpec('readCommit', '', false, null), () => inner.readCommit()),
            readFence: () => request(actor, callSpec('readFence', '', false, null), () => inner.readFence()),
            casCommit: (expected, next) => request(actor, callSpec('casCommit', '', true, loss, { commitExpect: tokenExpect(expected), fenceExpect: null }), () => inner.casCommit(expected, next)),
            casFence: (expected, next) => request(actor, callSpec('casFence', '', true, loss, { commitExpect: null, fenceExpect: tokenExpect(expected) }), () => inner.casFence(expected, next)),
            readUnits: (keys) => request(actor, callSpec('readUnits', keysTarget(keys), false, null), () => inner.readUnits(keys)),
            listStore2: () => request(actor, callSpec('listStore2', '', false, null), () => inner.listStore2()),
            countPrefix: (prefix) => request(actor, callSpec('countPrefix', prefix, false, null), () => inner.countPrefix(prefix)),
            commitOrdinary: (expected, units, next) => request(actor, callSpec('commitOrdinary', `n=${units.length}`, true, loss, { commitExpect: tokenExpect(expected), fenceExpect: null }), () => inner.commitOrdinary(expected, units, next)),
            putUnit: (key, bytes) => request(actor, callSpec('putUnit', key, true, loss), () => inner.putUnit(key, bytes)),
            removeBatch: (keys, expectedCommit, expectedFence) => request(actor, callSpec('removeBatch', keysTarget(keys), true, loss, { commitExpect: tokenExpect(expectedCommit), fenceExpect: tokenExpect(expectedFence) }), () => inner.removeBatch(keys, expectedCommit, expectedFence)),
        }
    }

    function byteStoreFor(actor: string | (() => string), inner: ByteStore): ByteStore {
        const innerGuarded = inner.guarded
        const guarded: GuardedOperations | undefined = innerGuarded === undefined ? undefined : {
            probe: () => request(actor, callSpec('probe', '', false, null), () => innerGuarded.probe()),
            writeChecked: (key, bytes, condition, checkOnly) => request(
                actor,
                callSpec('writeChecked', key, true, guardedLoss('write-checked'), keyExpects(key, conditionExpect(condition))),
                () => innerGuarded.writeChecked(key, bytes, condition, checkOnly),
            ),
            removeChecked: (entries, checkOnly) => request(
                actor,
                callSpec('removeChecked', keysTarget(entries.map((entry) => entry.key)), true, guardedLoss('remove-checked'), checkOnlyExpects(entries, checkOnly)),
                () => innerGuarded.removeChecked(entries, checkOnly),
            ),
            retireChecked: (entries, checkOnly) => request(
                actor,
                callSpec('retireChecked', keysTarget(entries.map((entry) => entry.key)), true, guardedLoss('remove-checked'), checkOnlyExpects(entries, checkOnly)),
                () => innerGuarded.retireChecked(entries, checkOnly),
            ),
        }
        const innerGate = inner.pageGate
        const twoStep = innerGate !== undefined && isTwoStepGate(innerGate) ? innerGate : null
        const gate: PageGateOperations | undefined = innerGate === undefined ? undefined : {
            registerPage: () => request(actor, callSpec('registerPage', '', true, PLAIN_LOSS, undefined, null, null, true), () => innerGate.registerPage()),
            writeTop: (generation, key, bytes) => request(
                actor,
                callSpec('writeTop', key, true, PLAIN_LOSS, keyExpects(key, conditionExpect('unconditional')), null, {
                    queued: () => innerGate.writeTop(generation, key, bytes),
                    begin: twoStep === null ? null : () => twoStep.beginWriteTop(generation, key, bytes),
                }, true),
                () => innerGate.writeTop(generation, key, bytes),
            ),
            removeTop: (generation, keys) => {
                const entries = keys.map((key): DeleteEntry => ({ key, condition: 'unconditional' }))
                return request(
                    actor,
                    callSpec('removeTop', keysTarget(keys), true, deleteManyLoss(entries), { commitExpect: null, fenceExpect: keys.includes(FENCE_KEY) ? conditionExpect('unconditional') : null }, {
                        entries,
                        runSubset: (subset) => innerGate.removeTop(generation, subset.map((entry) => entry.key)),
                    }, {
                        queued: () => innerGate.removeTop(generation, keys),
                        begin: twoStep === null ? null : () => twoStep.beginRemoveTop(generation, keys),
                    }, true),
                    () => innerGate.removeTop(generation, keys),
                )
            },
        }
        const store: ByteStore = {
            capabilities: inner.capabilities,
            read: (key) => request(actor, callSpec('read', key, false, null), () => inner.read(key)),
            write: (key, bytes, condition) => request(actor, callSpec('write', key, true, PLAIN_LOSS, keyExpects(key, conditionExpect(condition)), null, { queued: () => inner.write(key, bytes, condition), begin: null }), () => inner.write(key, bytes, condition)),
            delete: (key, condition) => request(actor, callSpec('delete', key, true, PLAIN_LOSS, keyExpects(key, conditionExpect(condition)), null, { queued: () => inner.delete(key, condition), begin: null }), () => inner.delete(key, condition)),
            deleteMany: (entries) => request(
                actor,
                callSpec('deleteMany', keysTarget(entries.map((entry) => entry.key)), true, deleteManyLoss(entries), undefined, {
                    entries,
                    runSubset: (subset) => inner.deleteMany(subset),
                }, { queued: () => inner.deleteMany(entries), begin: null }),
                () => inner.deleteMany(entries),
            ),
            list: (prefix) => request(actor, callSpec('list', prefix, false, null), () => inner.list(prefix)),
            has: (key) => request(actor, callSpec('has', key, false, null), () => inner.has(key)),
        }
        const innerCount = inner.countPrefix
        if (innerCount !== undefined) {
            store.countPrefix = (prefix) => request(actor, callSpec('countPrefix', prefix, false, null), () => innerCount.call(inner, prefix))
        }
        if (guarded !== undefined) {
            store.guarded = guarded
        }
        if (gate !== undefined) {
            store.pageGate = gate
        }
        return store
    }

    function decideFault(entry: Pending, state: ActorState): FaultKind | null {
        scriptedHit = null
        if (plan.mode === 'none') {
            return null
        }
        if (plan.mode === 'script') {
            const hit = plan.entries.find((scripted) => {
                if (scripted.actor !== entry.actor) {
                    return false
                }
                if ('write' in scripted) {
                    return scripted.write === state.writes
                }
                if (!(typeof scripted.op === 'string' ? [scripted.op] : scripted.op).includes(entry.spec.op)
                    || (scripted.target !== undefined && scripted.target !== entry.spec.target)
                    || (scripted.context !== undefined && scripted.context !== entry.context?.kind)) {
                    return false
                }
                const seen = (selected.get(scripted) ?? 0) + 1
                selected.set(scripted, seen)
                return seen === (scripted.nth ?? 1)
            })
            if (hit === undefined) {
                return null
            }
            scriptedHit = hit
            const impossible = hit.kind === 'crash-after-write' ? !entry.spec.write
                : hit.kind === 'partial-removal' ? entry.spec.removal === null
                    : hit.kind === 'ghost-queued' ? entry.spec.ghost === null
                        : hit.kind === 'ghost-held' ? entry.spec.ghost === null || entry.spec.ghost.begin === null
                            : entry.spec.loss === null
            if (impossible) {
                throw new RangeError(`The scripted ${hit.kind} of ${entry.actor} write ${state.writes} (${entry.spec.op}) cannot happen on that call.`)
            }
            return hit.kind
        }
        const kinds: FaultKind[] = []
        if (entry.spec.loss !== null && state.lost < plan.budget.lostPerActor) {
            kinds.push('lost-response', 'lost-request')
            if (entry.spec.removal !== null) {
                kinds.push('partial-removal')
            }
        }
        if (entry.spec.write && state.crashes < plan.budget.crashPerActor) {
            kinds.push('crash-after-write')
        }
        // Both draws are always taken so that a changed budget leaves the later draws where they were.
        const roll = faultRng()
        const which = faultRng()
        if (kinds.length === 0 || roll >= plan.probability) {
            return null
        }
        return kinds[Math.floor(which * kinds.length)]
    }

    /** Retires the actor and every actor of its page. */
    function retire(actor: string): void {
        const page = stateOf(actor).page
        const retired = new Set<string>([actor])
        if (page !== null) {
            for (const [id, state] of actors) {
                if (state.page === page) {
                    retired.add(id)
                }
            }
        }
        for (const id of retired) {
            stateOf(id).status = 'crashed'
        }
        pending = pending.filter((entry) => !retired.has(entry.actor))
    }

    async function grant(entry: Pending): Promise<void> {
        const state = stateOf(entry.actor)
        pending = pending.filter((other) => other !== entry)
        state.calls++
        if (entry.spec.write) {
            state.writes++
        }
        const fault = entry.spec.write ? decideFault(entry, state) : null
        if (fault === 'lost-response' || fault === 'lost-request' || fault === 'partial-removal') {
            state.lost++
        }
        if (fault === 'crash-after-write' || isGhostKind(fault)) {
            state.crashes++
        }
        stepNo++
        const info: StepInfo = {
            step: stepNo, actor: entry.actor, kind: 'call', op: entry.spec.op, target: entry.spec.target,
            applied: fault !== 'lost-request' && !isGhostKind(fault), fault, context: entry.context,
            commitExpect: entry.spec.commitExpect, fenceExpect: entry.spec.fenceExpect,
        }
        const logEntry: LogEntry = { step: stepNo, actor: entry.actor, op: entry.spec.op, target: entry.spec.target, fault, outcome: 'ok' }
        log.push(logEntry)

        if (fault === 'lost-request' && entry.spec.loss !== null) {
            logEntry.outcome = 'lost-request'
            options.onStep?.(info)
            entry.reject(entry.spec.loss.lost('request'))
            return
        }
        // The rest of the step: what the call does once it holds the lock, when it takes one.
        const proceed = async (): Promise<void> => {
            if (fault === 'partial-removal' && entry.spec.removal !== null) {
                // One key is always reported failed; each of the others is removed or not by a seeded coin.
                const { entries, runSubset } = entry.spec.removal
                const failedIndex = Math.floor(faultRng() * entries.length)
                const removed = entries.filter((_, index) => index !== failedIndex && faultRng() < 0.5)
                try {
                    if (removed.length > 0) {
                        await runSubset(removed)
                    }
                } catch {
                    // The subset is the part that went through; a refusal there leaves it untouched.
                }
                logEntry.outcome = 'partial-removal'
                options.onStep?.(info)
                entry.reject(new StoreDeleteManyError(entries.map((each): DeleteReportEntry => removed.includes(each)
                    ? { key: each.key, outcome: 'removed' }
                    : { key: each.key, outcome: 'failed', error: new TypeError('remove failed') })))
                return
            }
            if ((fault === 'ghost-queued' || fault === 'ghost-held') && entry.spec.ghost !== null) {
                const landWhen = scriptedHit?.landWhen ?? (() => true)
                let landing: (() => Promise<unknown>) | null
                if (fault === 'ghost-held' && entry.spec.ghost.begin !== null) {
                    try {
                        landing = await entry.spec.ghost.begin()
                    } catch (error) {
                        // The check at the lock failed: the call is over and nothing of it lands later.
                        landing = null
                        logEntry.outcome = `error:${errorName(error)}`
                    }
                } else {
                    landing = entry.spec.ghost.queued
                }
                if (landing !== null) {
                    logEntry.outcome = fault
                    ghosts.push({ id: ++nextId, actor: entry.actor, spec: entry.spec, context: entry.context, kind: fault, land: landing, landWhen })
                }
                options.onStep?.(info)
                retire(entry.actor)
                return
            }
            const finish = (settled: { failed: false, value: unknown } | { failed: true, failure: unknown }): void => {
                if (fault === 'crash-after-write') {
                    logEntry.outcome = 'crash'
                    options.onStep?.(info)
                    retire(entry.actor)
                    return
                }
                if (fault === 'lost-response' && entry.spec.loss !== null) {
                    logEntry.outcome = 'lost-response'
                    options.onStep?.(info)
                    entry.reject('failure' in settled && !entry.spec.loss.hides(settled.failure) ? settled.failure : entry.spec.loss.lost('response'))
                    return
                }
                if ('failure' in settled) {
                    logEntry.outcome = `error:${errorName(settled.failure)}`
                    if (settled.failure instanceof Store2CommitConflictError) {
                        info.commitConflictRead = settled.failure.current.bytes
                    }
                    options.onStep?.(info)
                    entry.reject(settled.failure)
                    return
                }
                options.onStep?.(info)
                entry.resolve(settled.value)
            }
            let started: Promise<unknown>
            try {
                started = entry.run()
            } catch (error) {
                started = Promise.reject(error)
            }
            finish(await started.then(
                (value): { failed: false, value: unknown } => ({ failed: false, value }),
                (failure: unknown): { failed: true, failure: unknown } => ({ failed: true, failure }),
            ))
        }

        // A call that needs the lock waits behind a held ghost, and behind every call that already waits: the native lock is
        // taken in arrival order. It runs as a step of its own once the lock is free and it is the oldest waiter.
        if (entry.spec.lock && fault !== 'ghost-queued' && (heldGhosts() > 0 || parked.length > 0)) {
            logEntry.outcome = 'parked'
            parked.push({
                id: ++nextId,
                actor: entry.actor,
                op: entry.spec.op,
                target: entry.spec.target,
                resume: async () => {
                    logEntry.outcome = 'ok-after-wait'
                    // The resumption is a step of its own: judged on its own number, after everything applied before it.
                    info.step = stepNo
                    await proceed()
                },
            })
            return
        }
        await proceed()
    }

    function heldGhosts(): number {
        return ghosts.filter((ghost) => ghost.kind === 'ghost-held').length
    }

    /** The oldest waiting call, once no held ghost has the lock: the only parked call that can start. */
    function resumable(): Parked | null {
        return parked.length > 0 && heldGhosts() === 0 ? parked[0] : null
    }

    async function land(ghost: Ghost): Promise<void> {
        ghosts.splice(ghosts.indexOf(ghost), 1)
        stepNo++
        const logEntry: LogEntry = { step: stepNo, actor: ghost.actor, op: ghost.spec.op, target: ghost.spec.target, fault: ghost.kind, outcome: 'landed' }
        log.push(logEntry)
        let applied = true
        try {
            await ghost.land()
        } catch (error) {
            applied = false
            logEntry.outcome = `refused:${errorName(error)}`
        }
        options.onStep?.({
            step: stepNo, actor: ghost.actor, kind: 'call', op: ghost.spec.op, target: ghost.spec.target, applied, fault: ghost.kind,
            context: ghost.context, commitExpect: ghost.spec.commitExpect, fenceExpect: ghost.spec.fenceExpect,
        })
    }

    /** Starts the oldest waiting call as a step of its own; the landing that freed the lock was judged before, under its own actor. */
    async function resumeParked(call: Parked): Promise<void> {
        parked.splice(parked.indexOf(call), 1)
        stepNo++
        await call.resume()
    }

    function takeEnvironment(action: EnvAction): void {
        envActions.splice(envActions.indexOf(action), 1)
        stepNo++
        action.apply()
        log.push({ step: stepNo, actor: '$env', op: action.name, target: '', fault: action.fault, outcome: 'env' })
        options.onStep?.({
            step: stepNo, actor: '$env', kind: 'env', op: action.name, target: '', applied: true, fault: action.fault,
            context: null, commitExpect: null, fenceExpect: null,
        })
    }

    function report(): Record<string, ActorReport> {
        const out: Record<string, ActorReport> = {}
        for (const id of order) {
            const state = stateOf(id)
            out[id] = { state: state.status, calls: state.calls, writes: state.writes, ...(state.error === undefined ? {} : { error: state.error }) }
        }
        return out
    }

    return {
        spawn(id, body, spawnOptions = {}) {
            if (actors.has(id) || id === '$env') {
                throw new RangeError(`Actor ${id} is already registered or reserved.`)
            }
            const page = spawnOptions.page ?? null
            const state: ActorState = { status: 'running', calls: 0, writes: 0, lost: 0, crashes: 0, context: null, page }
            actors.set(id, state)
            order.push(id)
            const handle: ActorHandle = {
                id,
                setContext(context) {
                    state.context = context === null ? null : { ...context }
                },
                backend: (inner) => backendFor(id, inner),
                byteStore(inner) {
                    if (page === null) {
                        return byteStoreFor(id, inner)
                    }
                    let shared = pageStores.get(page)
                    if (shared === undefined) {
                        shared = new WeakMap<ByteStore, ByteStore>()
                        pageStores.set(page, shared)
                    }
                    let store = shared.get(inner)
                    if (store === undefined) {
                        store = byteStoreFor(() => {
                            const caller = attribution.getStore()
                            if (caller === undefined) {
                                throw new Error('A call on a shared page store was made outside every actor.')
                            }
                            return caller
                        }, inner)
                        shared.set(inner, store)
                    }
                    return store
                },
            }
            attribution.run(id, () => body(handle)).then(
                () => {
                    if (state.status === 'running') {
                        state.status = 'done'
                    }
                },
                (error: unknown) => {
                    if (state.status === 'running') {
                        state.status = 'failed'
                        state.error = error instanceof Error ? `${error.constructor.name}: ${error.message}` : String(error)
                    }
                },
            )
        },

        environment(name, fault, apply) {
            envActions.push({ id: ++nextId, name, fault, apply })
        },

        async run(limit = {}) {
            const maxSteps = limit.maxSteps ?? 100_000
            for (;;) {
                await yieldMacrotask()
                // A ghost still to land, or a granted call still to start, keeps the run going after every actor is over.
                const live = ghosts.length > 0 || parked.length > 0 || [...actors.values()].some((state) => state.status === 'running')
                if (!live) {
                    return { status: 'finished', steps: stepNo, actors: report() }
                }
                // A queued landing that needs the lock waits while a held ghost has it and behind the calls already waiting for it;
                // a held landing is what frees it.
                const landable = ghosts.filter((ghost) => ghost.landWhen() && !(ghost.kind === 'ghost-queued' && ghost.spec.lock && (heldGhosts() > 0 || parked.length > 0)))
                const waiting = resumable()
                // A registered environment step is a way forward: it is taken even when no call is pending.
                if (pending.length === 0 && landable.length === 0 && envActions.length === 0 && waiting === null) {
                    return { status: 'stalled', steps: stepNo, actors: report() }
                }
                if (stepNo >= maxSteps) {
                    return { status: 'max-steps', steps: stepNo, actors: report() }
                }
                const candidates: Candidate[] = [
                    ...pending.map((entry) => ({ id: entry.id, actor: entry.actor })),
                    ...landable.map((ghost) => ({ id: ghost.id, actor: '$ghost' })),
                    ...envActions.map((action) => ({ id: action.id, actor: '$env' })),
                    ...(waiting === null ? [] : [{ id: waiting.id, actor: waiting.actor }]),
                ]
                const chosen = policy.pick(candidates, stepNo + 1)
                if (waiting !== null && chosen.id === waiting.id) {
                    await resumeParked(waiting)
                } else if (chosen.actor === '$env') {
                    takeEnvironment(envActions.find((action) => action.id === chosen.id)!)
                } else if (chosen.actor === '$ghost') {
                    await land(ghosts.find((ghost) => ghost.id === chosen.id)!)
                } else {
                    await grant(pending.find((entry) => entry.id === chosen.id)!)
                }
            }
        },

        log,
        changePoints: policy.changePoints,

        fingerprint(raw) {
            const parts: string[] = []
            for (const key of [...raw.keys()].sort()) {
                const entry = raw.get(key)!
                const top = key === COMMIT_KEY || key === FENCE_KEY
                const content = entry.bytes === null ? '-' : top ? hex(entry.bytes) : crc32(entry.bytes).toString(16)
                parts.push(`${key}|${entry.revision ?? 'n'}|${content}`)
            }
            for (const id of order) {
                const state = stateOf(id)
                parts.push(`@${id}=${state.calls}:${state.status}`)
            }
            for (const ghost of ghosts) {
                parts.push(`^${ghost.actor}:${ghost.spec.op}:${ghost.spec.target}:${ghost.kind}`)
            }
            for (const call of parked) {
                parts.push(`~${call.actor}:${call.op}:${call.target}`)
            }
            const text = parts.join('\n')
            return `${fnv1a(text, 0x811C9DC5).toString(16).padStart(8, '0')}${fnv1a(text, 0x01000193).toString(16).padStart(8, '0')}`
        },
    }
}

// ---- Pass-through decorators over a `Store2Backend` (scheduled or not) ----

/**
 * The IndexedDB adapter reads units as a pool of per-key transactions. This
 * decorator issues one `readUnits([key])` per key, all at once, so that wrapped
 * by the scheduler each key is a separate request whose order the scheduler picks.
 */
export function splitReadUnits(inner: Store2Backend): Store2Backend {
    return {
        ...inner,
        async readUnits(keys) {
            checkUnitKeys(keys)
            const parts = await Promise.all(keys.map((key) => inner.readUnits([key])))
            const out = new Map<string, Uint8Array | null>()
            keys.forEach((key, index) => {
                out.set(key, parts[index].get(key) ?? null)
            })
            return out
        },
    }
}

/** A seeded permutation of every `listStore2` answer: nothing may rely on the sorted order the real backends happen to give. */
export function shuffleListing(inner: Store2Backend, rng: () => number): Store2Backend {
    return {
        ...inner,
        async listStore2() {
            const keys = [...await inner.listStore2()]
            for (let i = keys.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1))
                const held = keys[i]
                keys[i] = keys[j]
                keys[j] = held
            }
            return keys
        },
    }
}
