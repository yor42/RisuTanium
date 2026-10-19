/**
 * The regions of the store2 replay: the races and fault combinations that the PCT runs sample. A region is data (its
 * actors and their programs, the start state, the backends, the fault plan, the PCT depth, the step limit) and
 * `runRegion` is the one driver that runs a region under a seed on a backend, so the in-tree smoke file and a long
 * runner read the same configs and judge a run the same way.
 *
 * A run ends in exactly one of the kinds of `RunKind`, and the kinds are kept apart (plan E1): only a checker violation
 * is red. A throw, a refusal the library reports, a stall, the step limit and a crash the fault plan injected are
 * reported as what they are and never counted as a pass or as a catch.
 *
 * Faults and compound operations. A fault plan that spends its budget in the first calls ends most runs inside `open`
 * and never reaches a restore or the final write of a bulk commit. A region therefore starts its faults after a step
 * count (`startAfterSteps`, past the opening of every page) and draws them with a modest probability per write; the
 * scheduler reads the plan's probability at every decision, and the driver raises it from zero when the step count is
 * reached. `floors` then name the operations (and outcomes) a region must reach in a share of its exercised runs, so a
 * region cannot degrade into early crashes without a test failing.
 *
 * Recovery runs on the commit key read the page made when it booted (plan v3.4 row 6), so an actor that recovers after
 * other activity, its own or a peer's, makes its marker write at a stale token and the write conflicts. The library then
 * either abandons the exit (the key now holds a `current`) or answers `conflict` with the key it found; the screen re-runs
 * from the start at that key, up to `SCREEN_ATTEMPTS` runs, and a step that is still in conflict then ends
 * `rerun-exhausted`. A recovery that must not be made stale by its own page's earlier activity (R14) runs as an actor of
 * a page of its own.
 *
 * A region that needs a rig a backend does not have is written with `pending` reasons and is skipped with that reason,
 * never run on another backend in their place. A region runs on IndexedDB only where its program has no restart or flush step
 * (those are Tauri's) and where one tab per actor is the page model: a tab has a connection of its own, as a Node actor has a
 * client of its own, so the region's `page` names do not apply.
 */
import type { FirstLifeLabel } from 'src/ts/storage/store2/firstLife'
import { COMMIT_KEY, FENCE_KEY } from 'src/ts/storage/store2/format/keys'
import type { PickResult } from 'src/ts/storage/store2/recoveryPick'
import {
    FOREIGN_OWNER, outcomeLabel, PageUnavailableError, type ReplayActor, type ReplayRig, type ReplayRigOptions, type StartState, type StepMatch,
} from './actors'
import { createIdbReplayRig } from './idbRig'
import { createNodeReplayRig } from './nodeRig'
import type { EnvFault, FaultPlan, StepInfo } from './scheduler'
import { createTauriReplayRig } from './tauriRig'
import { GARBAGE, plantCandidateTree, plantForeignBulk, plantGarbageUnits, type CandidateShape } from './replayFixtures'

// ---- The format of a region ----

/** `indexeddb` schedules at the `Store2Backend` layer; its steps are backend calls, not byte-store calls. */
export type RegionBackend = 'node' | 'tauri' | 'indexeddb'

/** One operation of an actor's program: the `ReplayActor` operation of that name, run over the library. */
export type RegionStep =
    | { do: 'open' }
    | { do: 'commit', extra?: number }
    | { do: 'bulk' }
    | { do: 'saveMine' }
    | { do: 'admit' }
    /** Restores the first retained manifest; nothing is restored (and the step is `no-target`) when nothing is retained. */
    | { do: 'restore' }
    | { do: 'pin' }
    | { do: 'unpin' }
    | { do: 'gc' }
    | { do: 'exit', kind: 'convert' | 'import' | 'seed' }
    /**
     * First-life install on the page's boot facts: the unfenced marker and the staged install (`refused` when the boot is not first life).
     * `label` is a boot restore (`convert`) or a boot `.bin` import (`import`): the marker carries it, so a crash classifies as row 10 or 11.
     */
    | { do: 'firstLife', label?: FirstLifeLabel }
    /** The fenced exit of that kind, and the shared installer on its marker. */
    | { do: 'exitInstall', kind: 'convert' | 'import' | 'seed' }
    /** Lists the candidates and picks and installs the newest, or the planted candidate with `candidate: true`. */
    | { do: 'recover', candidate?: boolean }
    | { do: 'fenceExit' }
    | { do: 'discardFence' }
    | { do: 'clearMarker' }
    | { do: 'abandonClear' }
    /** Tauri: the page restarts on the same device; the unflushed writes are dropped first unless `drop` is false. */
    | { do: 'restart', drop?: boolean }
    | { do: 'readKey' }

export interface RegionActor {
    id: string
    /** At least `FIRST_ACTOR_SEED` and unique within a region. */
    seed: number
    program: RegionStep[]
    /** The answer of the Q3 hook for another owner's marker; no hook when absent. */
    foreignClear?: 'yes' | 'no'
    /** Tauri: the page the actor runs on; the region's single page `P` by default. */
    page?: string
    device?: string
    upstreamMainFile?: boolean
    present?: { assets?: boolean, inlays?: boolean }
}

export interface RegionFaults {
    /** Per write that can fault, once the faults have started. */
    probability: number
    /** Lost responses, lost requests and partial removals together, per actor; `Infinity` is unbounded. */
    lostPerActor: number
    crashPerActor: number
    /** Faults start once this many steps have been applied. */
    startAfterSteps: number
    /** The least share of the exercised runs in which a fault was injected; 0.5 when absent. A plan that never fires proves nothing. */
    minFaulted?: number
    /** Replaces `minFaulted` on Tauri, where a page shares one session and a crash retires every actor of it. */
    tauriMinFaulted?: number
    /** Replaces `minFaulted` on IndexedDB, where a write is one backend call and a run has far fewer writes to fault. */
    idbMinFaulted?: number
    /** Tauri: a durable write can also be reported not flushed (the flush fault, which spends the lost-call budget); the other kinds keep their draws without it. */
    flush?: boolean
}

export interface RegionDamage {
    /** A restart is an actor's step (`restart`), never a registered environment step. */
    name: Exclude<EnvFault, 'restart'>
    /** Registered once a step the match selects has been judged; at the start when absent. */
    after?: StepMatch
    /** The same step on IndexedDB, where the calls are the backend's; `after` when absent. */
    idbAfter?: StepMatch
}

export interface RegionConfig {
    id: string
    name: string
    /** What the region stands for: the model's region or the plan section it samples. */
    covers: string
    backends: readonly RegionBackend[]
    /** Why a backend of `backends` does not run yet. */
    pending?: Partial<Record<RegionBackend, string>>
    start: StartState
    /** Unreferenced units planted before the run; more than one batch of a collection pass. Zero only for a first-life region: any store2 unit makes boot row 2, not row 1. */
    garbage: number
    /** Another owner's unfinished bulk commit stands at the start, with this many staged units. */
    foreignBulkUnits?: number
    /** A recovery candidate planted besides the seeded tree. */
    candidate?: CandidateShape
    /** The planted candidate is the tree of the foreign unfinished bulk: its keys stand inside that marker's prefix. */
    stagedCandidate?: boolean
    actors: RegionActor[]
    faults?: RegionFaults
    damage?: RegionDamage[]
    pct: { depth: number, horizon: number }
    maxSteps: number
    /** How many fixed seeds the smoke file runs: 1 to `seeds`. */
    seeds: number
    /** Replaces the smoke file's IndexedDB seed count (at most `seeds`). */
    idbSeeds?: number
    /** Operation keys (`restore`, `restore:committed`, ...) to the least share of the exercised runs that must reach them. */
    floors: Record<string, number>
    /** Replaces `floors` on Tauri, where one crash retires the whole page. */
    tauriFloors?: Record<string, number>
    /** Replaces `floors` on IndexedDB, where a commit is one atomic call and a tab's conflicts are decided by bytes. */
    idbFloors?: Record<string, number>
    /** The least share of runs that are not `not-exercised`. */
    minExercised?: number
    /** Each actor's outcome labels in order, asserted for every run; only for a region that injects nothing. */
    outcomes?: Record<string, string[]>
}

// ---- Garbage and the actors of the regions ----

/** More than one batch (25 keys) of a collection pass. */
const GARBAGE_UNITS = 60

/** Many batches, so a fence written by another actor can land between two batches of one pass. */
const FENCE_GC_GARBAGE_UNITS = 600

const A = 10
const B = 11
const G = 12
const C = 13

function actor(id: string, seed: number, program: RegionStep[], extra: Partial<RegionActor> = {}): RegionActor {
    return { id, seed, program, ...extra }
}

const open: RegionStep = { do: 'open' }
const commit: RegionStep = { do: 'commit' }
const bulk: RegionStep = { do: 'bulk' }
const admit: RegionStep = { do: 'admit' }
const restore: RegionStep = { do: 'restore' }
const saveMine: RegionStep = { do: 'saveMine' }
const pin: RegionStep = { do: 'pin' }
const unpin: RegionStep = { do: 'unpin' }
const gc: RegionStep = { do: 'gc' }
const recover: RegionStep = { do: 'recover' }
const exitSeed: RegionStep = { do: 'exit', kind: 'seed' }
const clearMarker: RegionStep = { do: 'clearMarker' }
const firstLife: RegionStep = { do: 'firstLife' }
const fenceExit: RegionStep = { do: 'fenceExit' }
const discardFence: RegionStep = { do: 'discardFence' }

function faults(probability: number, lostPerActor: number, crashPerActor: number, startAfterSteps: number): RegionFaults {
    return { probability, lostPerActor, crashPerActor, startAfterSteps }
}

// ---- The regions ----

// Floors are fitted to the shipped seed set (seeds 1 to N, a deterministic run): they stop a region from degrading, and a longer seed
// run can sit below one. R19d's `restart:cleared` floor is 0.3 because the share over 80 seeds is 0.37.
export const REGIONS: readonly RegionConfig[] = [
    {
        id: 'R1', name: 'reload-any-order-gc', covers: 'S0-5a: reload remedy, any-order collection and both devices committing (N_reload0, f_full_reload_any)',
        backends: ['node', 'tauri', 'indexeddb'], start: 'healthy', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, commit, commit, admit, restore, commit]),
            actor('b', B, [open, commit, commit, commit]),
            actor('g', G, [open, gc, gc, gc]),
        ],
        faults: { ...faults(0.06, Infinity, 0, 14), idbMinFaulted: 0.4 }, pct: { depth: 3, horizon: 140 }, maxSteps: 4000, seeds: 18, idbSeeds: 14, minExercised: 0.85,
        floors: { 'commit:committed': 0.7, 'gc:done': 0.7, 'restore:committed': 0.6 },
        idbFloors: { 'commit:committed': 0.75, 'gc:done': 0.75, 'restore:committed': 0.6 },
    },
    {
        id: 'R2', name: 'crash-a-any-order-gc', covers: 'S0-5a: a crash of any actor, including a writer, and any-order collection (a superset of the crash of one writer)',
        backends: ['node', 'tauri', 'indexeddb'], start: 'healthy', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, bulk, commit, admit]),
            actor('b', B, [open, commit, commit]),
            actor('g', G, [open, gc, gc]),
        ],
        faults: { ...faults(0.01, 0, 1, 14), idbMinFaulted: 0.3 }, pct: { depth: 3, horizon: 140 }, maxSteps: 4000, seeds: 18, idbSeeds: 14, minExercised: 0.85,
        floors: { 'bulk:committed': 0.3, 'gc:done': 0.5 },
        idbFloors: { 'bulk:committed': 0.35, 'gc:done': 0.65 },
        tauriFloors: { 'bulk:committed': 0.2, 'gc:done': 0.4 },
    },
    {
        id: 'R3', name: 'writers-and-gc-crash-union', covers: 'S0-5a: the crash and loss union of two writers and a collector (ABGQ); samples a superset, a crash of any actor',
        backends: ['node', 'tauri', 'indexeddb'], start: 'healthy', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, commit, bulk, commit]),
            actor('b', B, [open, commit, admit, commit]),
            actor('g', G, [open, gc, gc]),
        ],
        faults: { ...faults(0.03, 2, 1, 14), idbMinFaulted: 0.6 }, pct: { depth: 4, horizon: 140 }, maxSteps: 4000, seeds: 20, idbSeeds: 16, minExercised: 0.85,
        floors: { 'admit:committed': 0.3, 'bulk': 0.4, 'gc:done': 0.6 },
        idbFloors: { 'admit:committed': 0.7, 'bulk': 0.3, 'gc:done': 0.7 },
        tauriFloors: { 'admit:committed': 0.35, 'bulk': 0.3, 'gc:done': 0.5 },
    },
    {
        id: 'R4', name: 'foreign-clear-any-order-gc', covers: 'S0-5a: the clear of another owner\'s marker and any-order collection',
        backends: ['node', 'tauri'], start: 'healthy', garbage: GARBAGE_UNITS, foreignBulkUnits: 6,
        actors: [
            actor('a', A, [open, clearMarker, commit, commit], { foreignClear: 'yes' }),
            actor('b', B, [open, commit, commit]),
            actor('g', G, [open, gc, gc]),
        ],
        pct: { depth: 3, horizon: 120 }, maxSteps: 4000, seeds: 18, minExercised: 0.85,
        floors: { 'clearMarker:clear': 0.8, 'commit:committed': 0.8, 'gc:done': 0.8 },
    },
    {
        id: 'R5', name: 'foreign-clear-crash', covers: 'S0-5a: the clear of another owner\'s marker and a crash of any actor, including the clearing page (a superset)',
        backends: ['node', 'tauri'], start: 'healthy', garbage: GARBAGE_UNITS, foreignBulkUnits: 6,
        actors: [
            actor('a', A, [open, clearMarker, commit, commit], { foreignClear: 'yes' }),
            actor('b', B, [open, commit, commit]),
            actor('g', G, [open, gc, gc]),
        ],
        faults: { ...faults(0.02, 0, 1, 10), minFaulted: 0.35 }, pct: { depth: 3, horizon: 120 }, maxSteps: 4000, seeds: 18, minExercised: 0.85,
        floors: { 'clearMarker:clear': 0.5, 'commit:committed': 0.6 },
        tauriFloors: { 'clearMarker:clear': 0.5, 'gc:done': 0.5 },
    },
    {
        id: 'R6', name: 'bulk-final-unknown-then-crash', covers: 'plan v3.4 section 6: an uncertain final write of a bulk commit, then a crash of its owner before it reads back',
        backends: ['node', 'tauri'], start: 'healthy', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, bulk, bulk, commit]),
            actor('b', B, [open, commit, admit, gc]),
        ],
        faults: faults(0.025, Infinity, 1, 14), pct: { depth: 3, horizon: 140 }, maxSteps: 4000, seeds: 20,
        floors: { 'bulk:committed': 0.25, 'gc:done': 0.5 },
        tauriFloors: { 'bulk:committed': 0.15, 'gc:done': 0.5 },
    },
    {
        id: 'R7', name: 'recovery-marker-lost-then-crash', covers: 'plan v3.4 section 6: a lost response on the marker write of a recovery, then a crash of the recovering page',
        backends: ['node', 'tauri'], start: 'damaged-commit', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, recover, commit], { foreignClear: 'yes' }),
            actor('b', B, [open, recover], { foreignClear: 'yes' }),
            actor('g', G, [open, gc, gc]),
        ],
        faults: { ...faults(0.025, Infinity, 1, 10), tauriMinFaulted: 0.35 }, pct: { depth: 3, horizon: 120 }, maxSteps: 4000, seeds: 18, minExercised: 0.85,
        floors: { 'commit:committed': 0.4, 'recover:installed': 0.6 },
        tauriFloors: { 'commit:committed': 0.4, 'recover:installed': 0.5 },
    },
    {
        id: 'R8', name: 'two-fault-combinations', covers: 'plan v3.4 section 6: every pair of faults (d_f2_bulk, d_f2_rec, f2)',
        backends: ['node', 'tauri'], start: 'healthy', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, commit, admit, restore, bulk, commit]),
            actor('b', B, [open, recover, commit], { foreignClear: 'yes' }),
            actor('g', G, [open, gc, gc]),
        ],
        faults: faults(0.04, 1, 1, 14), pct: { depth: 4, horizon: 160 }, maxSteps: 4000, seeds: 26,
        floors: { 'bulk': 0.35, 'recover:installed': 0.5, 'restore:committed': 0.2 },
        tauriFloors: { 'bulk': 0.15, 'recover:installed': 0.25, 'restore:committed': 0.2 },
    },
    {
        id: 'R9', name: 'bulk-damage-recovery', covers: 'plan v3.4 section 6: damage of the commit key during a bulk commit, then recovery (q_bulk)',
        backends: ['node', 'tauri'], start: 'healthy', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, bulk, commit]),
            actor('b', B, [open, recover, commit], { foreignClear: 'yes' }),
            actor('g', G, [open, gc, gc]),
        ],
        damage: [{ name: 'damage-commit', after: { actor: 'a', op: ['writeChecked', 'writeTop'], target: '$commit', context: 'bulk-begin' } }],
        pct: { depth: 3, horizon: 140 }, maxSteps: 4000, seeds: 18, minExercised: 0.85,
        floors: { 'bulk': 0.75, 'commit:committed': 0.7, 'recover:installed': 0.7 },
        tauriFloors: { 'bulk': 0.75, 'commit:committed': 0.55, 'recover:installed': 0.55 },
    },
    {
        id: 'R10', name: 'recovery-one-fault', covers: 'plan v3.4 section 6: a recovery with one fault (N_rec_f1)',
        backends: ['node', 'tauri'], start: 'damaged-commit', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, recover, commit, gc], { foreignClear: 'yes' }),
            actor('b', B, [open, recover], { foreignClear: 'yes' }),
        ],
        faults: faults(0.15, 1, 0, 8), pct: { depth: 3, horizon: 120 }, maxSteps: 4000, seeds: 18, minExercised: 0.85,
        floors: { 'commit:committed': 0.4, 'recover:installed': 0.8 },
        tauriFloors: { 'commit:committed': 0.3, 'recover:installed': 0.8 },
    },
    {
        id: 'R11', name: 'indexeddb-bump-damage', covers: 'plan v3.4 section 6: IndexedDB, damage of the commit key with no state-machine help (I_nosm_f1)',
        backends: ['indexeddb'], start: 'healthy', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, commit, commit]),
            actor('b', B, [open, recover, commit], { foreignClear: 'yes' }),
        ],
        faults: { ...faults(0.1, 1, 0, 8), idbMinFaulted: 0.6 }, damage: [{ name: 'damage-commit' }], pct: { depth: 3, horizon: 120 }, maxSteps: 4000, seeds: 14, minExercised: 0.85,
        floors: {},
        idbFloors: { 'commit:committed': 0.55, 'recover:installed': 0.45 },
    },
    {
        id: 'R12', name: 'refused-foreign-clear', covers: 'plan v3.4 section 6: a refused foreign clear with two lost calls (W_refuse_fclear_L2)',
        backends: ['node', 'tauri'], start: 'healthy', garbage: GARBAGE_UNITS, foreignBulkUnits: 6,
        actors: [
            actor('a', A, [open, clearMarker, commit], { foreignClear: 'no' }),
            actor('b', B, [open, clearMarker, commit, gc], { foreignClear: 'yes' }),
            actor('g', G, [open, gc, gc]),
        ],
        faults: faults(0.1, 2, 0, 10), pct: { depth: 3, horizon: 120 }, maxSteps: 4000, seeds: 20,
        floors: { 'clearMarker:clear': 0.8, 'commit:committed': 0.3, 'gc:done': 0.8 },
        tauriFloors: { 'commit:committed': 0.2, 'gc:done': 0.8 },
    },
    {
        id: 'R13', name: 'refused-recoveries', covers: 'plan v3.4 section 6: two recoveries over a foreign marker, one refused (W_refuse_rec2_L2)',
        backends: ['node', 'tauri'], start: 'marker-seed', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, exitSeed], { foreignClear: 'no' }),
            actor('b', B, [open, exitSeed, recover], { foreignClear: 'yes' }),
            actor('g', G, [open, gc]),
        ],
        // b's recovery follows its own exit: its first run is at a stale token, conflicts, and the screen re-runs it at the key the conflict carried.
        faults: faults(0.1, 2, 0, 8), pct: { depth: 3, horizon: 100 }, maxSteps: 4000, seeds: 18, minExercised: 0.85,
        floors: { 'exit:marked': 0.8, 'recover:installed': 0.5 },
        tauriFloors: { 'exit:marked': 0.8, 'recover:installed': 0.4 },
    },
    {
        id: 'R14', name: 'staged-manifest-candidates', covers: 'plan v3.4 section 6: manifests of an abandoned stage offered as candidates, wide refusals (W_ri_refuse_wide)',
        backends: ['node', 'tauri'], start: 'healthy', garbage: GARBAGE_UNITS, foreignBulkUnits: 6, candidate: {}, stagedCandidate: true,
        actors: [
            actor('a', A, [open, clearMarker], { foreignClear: 'yes' }),
            // a2 recovers on a page of its own, so its boot read is not made stale by a's clear of the marker; it picks the planted
            // staged manifest, which a listing taken while the foreign marker stands would not offer first.
            actor('a2', 14, [open, { do: 'recover', candidate: true }], { foreignClear: 'yes', page: 'P2' }),
            actor('b', B, [open, bulk, commit]),
            actor('g', G, [open, gc, gc]),
        ],
        faults: faults(0.03, 2, 1, 10), pct: { depth: 3, horizon: 140 }, maxSteps: 4000, seeds: 40,
        // The planted install is the region's intent: a2 must install the abandoned stage's manifest, not whichever candidate is newest.
        // 'recover:invalid' is the run that reaches the outcome label 'recover:invalid:missing' (a2's picked candidate lacks a unit);
        // it occurs on few seeds, so the 40 seeds are what give its floor a margin of at least 2 seeds on both backends.
        floors: { 'bulk': 0.6, 'clearMarker:clear': 0.6, 'commit:committed': 0.2, 'recover:installed': 0.3, 'recover:installed:planted': 0.3, 'recover:invalid': 0.1 },
        // On Tauri a2's page registers after the others, which makes their page stale: their commits fail too often for a commit floor.
        tauriFloors: { 'bulk': 0.6, 'clearMarker:clear': 0.45, 'recover:installed': 0.3, 'recover:installed:planted': 0.3, 'recover:invalid': 0.075 },
    },
    {
        id: 'R15', name: 'refused-two-faults', covers: 'plan v3.4 section 6: a refusal with two faults (W_refuse_f2_L2)',
        backends: ['node', 'tauri'], start: 'healthy', garbage: GARBAGE_UNITS, foreignBulkUnits: 6,
        actors: [
            actor('a', A, [open, commit, bulk, commit], { foreignClear: 'no' }),
            actor('b', B, [open, exitSeed], { foreignClear: 'no' }),
            actor('g', G, [open, gc, gc]),
        ],
        faults: faults(0.03, 2, 1, 10), pct: { depth: 3, horizon: 120 }, maxSteps: 4000, seeds: 18, minExercised: 0.85,
        floors: { 'bulk': 0.6, 'commit:committed': 0.5, 'gc:done': 0.6 },
    },
    {
        id: 'R16', name: 'node-lost-and-crash-all', covers: 'plan v3.4 section 6: Node, every actor loses responses and may crash (lost_all, c_all)',
        backends: ['node'], start: 'healthy', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, commit, bulk, admit, restore, commit]),
            actor('b', B, [open, commit, saveMine, pin, unpin, commit]),
            actor('g', G, [open, gc, gc, gc]),
        ],
        faults: faults(0.02, Infinity, 1, 14), pct: { depth: 4, horizon: 180 }, maxSteps: 4000, seeds: 26,
        // bulk:committed is reached in about a fifth of the 26 runs; 0.1 is the highest floor that leaves two seeds of margin.
        floors: { 'bulk:committed': 0.1, 'gc:done': 0.6, 'restore:committed': 0.4, 'saveMine': 0.6 },
    },
    {
        id: 'R17a', name: 'first-start-no-commit-key', covers: 'plan v3.4 section 6, V1: a start with no commit key',
        backends: ['node', 'tauri', 'indexeddb'], start: 'no-commit-key', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, exitSeed, commit]),
            actor('b', B, [open, exitSeed, gc]),
        ],
        faults: { ...faults(0.3, Infinity, 1, 5), idbMinFaulted: 0.4 }, pct: { depth: 3, horizon: 100 }, maxSteps: 4000, seeds: 18, idbSeeds: 14, minExercised: 0.85,
        floors: { 'exit:marked': 0.6, 'gc': 0.7 },
        idbFloors: { 'exit:marked': 0.6, 'gc': 0.65 },
    },
    {
        id: 'R17b', name: 'convert-marker', covers: 'plan v3.4 section 6, V1: a standing convert marker',
        backends: ['node', 'tauri', 'indexeddb'], start: 'marker-convert', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, { do: 'exit', kind: 'convert' }, clearMarker], { foreignClear: 'yes', upstreamMainFile: true }),
            actor('b', B, [open, clearMarker, gc], { foreignClear: 'yes', upstreamMainFile: true }),
        ],
        // On Tauri both actors share one session and its boot read, so a's exit meets b's clear at a stale token; the screen re-runs it at the key the conflict carried.
        faults: { ...faults(0.2, Infinity, 1, 5), idbMinFaulted: 0.35, minFaulted: 0.4, tauriMinFaulted: 0.5 }, pct: { depth: 3, horizon: 100 }, maxSteps: 4000, seeds: 18, idbSeeds: 16, minExercised: 0.85,
        floors: { 'clearMarker:clear': 0.7, 'exit:marked': 0.5 },
        idbFloors: { 'clearMarker:clear': 0.75, 'exit:marked': 0.65 },
        tauriFloors: { 'clearMarker:clear': 0.7, 'exit:marked': 0.3 },
    },
    {
        id: 'R17c', name: 'seed-marker', covers: 'plan v3.4 section 6, V1: a standing seed marker',
        backends: ['node', 'tauri', 'indexeddb'], start: 'marker-seed', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, exitSeed, recover], { foreignClear: 'yes' }),
            actor('b', B, [open, clearMarker, gc], { foreignClear: 'yes' }),
        ],
        // a's recovery follows its own exit: its first run is at a stale token, conflicts, and the screen re-runs it at the key the conflict carried.
        faults: { ...faults(0.06, Infinity, 1, 8), idbMinFaulted: 0.5, minFaulted: 0.45 }, pct: { depth: 3, horizon: 100 }, maxSteps: 4000, seeds: 20, idbSeeds: 18, minExercised: 0.85,
        floors: { 'clearMarker:clear': 0.7, 'exit:marked': 0.7, 'recover:installed': 0.35 },
        idbFloors: { 'clearMarker:clear': 0.7, 'exit:marked': 0.75, 'recover:installed': 0.25 },
        tauriFloors: { 'clearMarker:clear': 0.7, 'exit:marked': 0.6, 'recover:installed': 0.3 },
    },
    {
        id: 'R17d', name: 'fresh-start-damaged-commit', covers: 'plan v3.4 section 6, V1: a fresh start from a damaged commit key',
        backends: ['node', 'tauri', 'indexeddb'], start: 'damaged-commit', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, recover, commit, admit], { foreignClear: 'yes' }),
            actor('g', G, [open, gc, gc]),
        ],
        faults: { ...faults(0.03, Infinity, 1, 8), idbMinFaulted: 0.3 }, pct: { depth: 3, horizon: 100 }, maxSteps: 4000, seeds: 18, idbSeeds: 14, minExercised: 0.85,
        floors: { 'admit:committed': 0.3, 'commit:committed': 0.3, 'recover:installed': 0.6 },
        idbFloors: { 'admit:committed': 0.5, 'commit:committed': 0.5, 'recover:installed': 0.5 },
        tauriFloors: { 'admit:committed': 0.25, 'commit:committed': 0.25, 'recover:installed': 0.5 },
    },
    {
        id: 'R17e', name: 'fresh-start-both-damaged', covers: 'plan v3.4 section 6, V1: a fresh start with the commit key and the fence both damaged',
        backends: ['node', 'tauri', 'indexeddb'], start: 'both-damaged', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, recover, commit], { foreignClear: 'yes' }),
            actor('b', B, [open, fenceExit, recover], { foreignClear: 'yes' }),
            actor('g', G, [open, gc, gc]),
        ],
        faults: { ...faults(0.03, Infinity, 1, 8), idbMinFaulted: 0.4 }, pct: { depth: 3, horizon: 120 }, maxSteps: 4000, seeds: 18, idbSeeds: 14, minExercised: 0.85,
        floors: { 'commit:committed': 0.35, 'fenceExit': 0.8, 'recover:installed': 0.6 },
        idbFloors: { 'commit:committed': 0.5, 'fenceExit': 0.75, 'recover:installed': 0.6 },
        tauriFloors: { 'commit:committed': 0.3, 'fenceExit': 0.65, 'recover:installed': 0.45 },
    },
    {
        id: 'R17f', name: 'fresh-start-damaged-fence', covers: 'plan v3.4 section 6, V1: a fresh start from a damaged fence',
        backends: ['node', 'tauri', 'indexeddb'], start: 'damaged-fence', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, fenceExit, discardFence, commit]),
            actor('g', G, [open, gc, gc]),
        ],
        faults: { ...faults(0.05, Infinity, 1, 8), idbMinFaulted: 0.15 }, pct: { depth: 3, horizon: 100 }, maxSteps: 4000, seeds: 18, minExercised: 0.85,
        // idbMinFaulted is about half of the IndexedDB faulted share at 18 seeds; 0.15 is the highest value that leaves two seeds of margin.
        floors: { 'commit:committed': 0.25, 'discardFence': 0.8, 'fenceExit': 0.8 },
        idbFloors: { 'commit:committed': 0.75, 'discardFence': 0.75, 'fenceExit': 0.75 },
        tauriFloors: { 'commit:committed': 0.3, 'discardFence': 0.65, 'fenceExit': 0.65 },
    },
    // The N2 shape itself rests on `corpus/v1N2Shape.json` and the long runs of stage 2f-7; this region samples the damage around recoveries.
    {
        id: 'R17g', name: 'fence-and-commit-key-damage', covers: 'plan v3.4 section 6, V1: fence and commit-key damage around recoveries',
        backends: ['node', 'tauri', 'indexeddb'], start: 'standing-fence', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, recover, commit], { foreignClear: 'yes' }),
            actor('b', B, [open, fenceExit, recover], { foreignClear: 'yes' }),
            actor('g', G, [open, gc, gc]),
        ],
        damage: [{ name: 'damage-fence' }, { name: 'damage-commit', after: { op: ['writeChecked', 'writeTop'], target: '$fence' }, idbAfter: { op: 'casFence' } }],
        faults: { ...faults(0.04, 1, 1, 8), idbMinFaulted: 0.45 }, pct: { depth: 4, horizon: 120 }, maxSteps: 4000, seeds: 20, idbSeeds: 14, minExercised: 0.85,
        floors: { 'commit:committed': 0.2, 'fenceExit': 0.8, 'recover:installed': 0.5 },
        idbFloors: { 'commit:committed': 0.35, 'fenceExit': 0.65, 'recover:installed': 0.45 },
        tauriFloors: { 'commit:committed': 0.2, 'fenceExit': 0.6, 'recover:installed': 0.35 },
    },
    {
        id: 'R18a', name: 'fence-and-gc', covers: 'plan v3.4 section 6: the fence of 3.4c, its discard and rewrite, against collection (passes of several batches are R18a2\'s)',
        backends: ['node', 'tauri', 'indexeddb'], start: 'standing-fence', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, fenceExit, discardFence, fenceExit]),
            actor('b', B, [open, commit, commit]),
            actor('g', G, [open, gc, gc]),
            actor('c', C, [open, gc]),
        ],
        faults: { ...faults(0.05, Infinity, 1, 10), idbMinFaulted: 0.25 }, pct: { depth: 4, horizon: 140 }, maxSteps: 4000, seeds: 18, idbSeeds: 16, minExercised: 0.85,
        floors: { 'commit:committed': 0.3, 'discardFence': 0.6, 'fenceExit': 0.6, 'gc:done': 0.7 },
        idbFloors: { 'commit:committed': 0.7, 'discardFence': 0.7, 'fenceExit': 0.75, 'gc:done': 0.75 },
        tauriFloors: { 'commit:committed': 0.3, 'discardFence': 0.4, 'fenceExit': 0.4, 'gc:done': 0.55 },
    },
    {
        id: 'R18a2', name: 'fence-between-gc-batches', covers: 'plan v3.4 section 6: a fence written while collection passes of several batches are between batches (G1)',
        backends: ['node', 'tauri', 'indexeddb'], start: 'healthy', garbage: FENCE_GC_GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, fenceExit]),
            actor('g', G, [open, gc, gc]),
        ],
        // No discard: on Tauri a discard restores the absent bytes the pass compares against, so the next batch proceeds; on Node the removal
        // moves the revision, so a later batch still conflicts. Without a discard the fence stays and the pass conflicts on both. Few change points leave a
        // window for the fence to land between two batches of the first pass; faults matter less here than the window, so fewer runs need one.
        // The fence-conflict share and the faulted share of the IndexedDB run are the rarest events of the smoke file: their floors sit
        // where the 24 IndexedDB seeds leave two seeds of margin, and so is the Node faulted share at 28 seeds (0.1, two seeds of margin; any higher floor leaves one).
        faults: { ...faults(0.03, Infinity, 0, 10), idbMinFaulted: 0.08, minFaulted: 0.1, tauriMinFaulted: 0.2 }, pct: { depth: 2, horizon: 45 }, maxSteps: 4000, seeds: 28,
        floors: { 'fenceExit': 0.7, 'gc:done': 0.7, 'gc:multi-batch': 0.2, 'gc:done:fence-conflict': 0.1 },
        idbFloors: { 'fenceExit': 0.75, 'gc:done': 0.75, 'gc:multi-batch': 0.3, 'gc:done:fence-conflict': 0.08 },
    },
    {
        id: 'R18b', name: 'concurrent-recoveries', covers: 'plan v3.4 section 6: two pages recovering at once (separate pages on Node; on Tauri the second page makes the first stale)',
        backends: ['node', 'tauri', 'indexeddb'], start: 'damaged-commit', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, recover, commit], { foreignClear: 'yes', page: 'pa' }),
            actor('b', B, [open, recover, commit], { foreignClear: 'yes', page: 'pb' }),
            actor('g', G, [open, gc, gc], { page: 'pb' }),
        ],
        faults: { ...faults(0.025, Infinity, 1, 10), idbMinFaulted: 0.4 }, pct: { depth: 3, horizon: 120 }, maxSteps: 4000, seeds: 18, idbSeeds: 14, minExercised: 0.85,
        floors: { 'commit:committed': 0.5, 'recover:installed': 0.6 },
        idbFloors: { 'commit:committed': 0.6, 'recover:installed': 0.6 },
    },
    {
        id: 'R18c', name: 'tauri-bulk', covers: 'plan v3.4 section 6: Tauri bulk commits under the page mutex with a collector on the page',
        backends: ['tauri'], start: 'healthy', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, bulk, bulk, commit]),
            actor('b', B, [open, commit, admit, restore]),
            actor('g', G, [open, gc, gc]),
        ],
        faults: { ...faults(0.02, Infinity, 1, 12), flush: true }, pct: { depth: 3, horizon: 160 }, maxSteps: 4000, seeds: 20,
        // A bulk whose staged unit reports an unflushed write is abandoned, so the share that commits sits below what it would be if that
        // report were ignored.
        floors: { 'bulk:committed': 0.15, 'gc:done': 0.6, 'restore:committed': 0.45 },
    },
    {
        id: 'R18d', name: 'tauri-recovery', covers: 'plan v3.4 section 6: Tauri recovery, a restart of the page and the start-up clear',
        backends: ['tauri'], start: 'both-damaged', garbage: GARBAGE_UNITS,
        actors: [
            // a's seed exit leaves its own marker. The first restart drops the unflushed writes, retires g (the old page is gone), hands the
            // new page a store object and so a backend mutex of its own, and the new page's start-up clear removes the marker. The new page
            // recovers and commits (the writes whose flush the fault can fail) and restarts again, and the page after that collects.
            actor('a', A, [open, exitSeed, { do: 'restart' }, recover, commit, commit, { do: 'restart' }, gc, commit], { foreignClear: 'yes', device: 'phone' }),
            actor('g', G, [open, gc, gc]),
        ],
        faults: { ...faults(0.08, Infinity, 1, 10), flush: true }, pct: { depth: 3, horizon: 160 }, maxSteps: 4000, seeds: 30,
        // A run is not exercised when any page registration with the gate is faulted (the page's, the new page's, or the one after a
        // restart), whether the fault is a crash after the write or a lost request or response: about a quarter of the runs.
        // A recovery install whose staged unit reports an unflushed write stops, and a commit key never names such a unit, so
        // recover:installed and commit:committed sit below what they would be if that report were ignored.
        // Three floors sit below the 70 to 80 percent band of their measured rate, each at the highest value that leaves two seeds of margin
        // at 23 exercised runs: commit:committed (0.2 against 0.3) is cut by the unflushed-write report and the crashes,
        // and gc:done (0.15 against 0.26) the share where the collector's pass finishes after the last restart; a handful of seeds decide both.
        minExercised: 0.6,
        floors: { 'exit:marked': 0.55, 'restart': 0.7, 'restart:cleared': 0.55, 'restart:dropped': 0.25, 'recover:installed': 0.45, 'commit:committed': 0.2, 'gc:done': 0.15 },
    },
    {
        id: 'R18e', name: 'two-recoveries-one-tauri-page', covers: 'plan v3.4 section 6: two actors of one Tauri page both recovering',
        backends: ['tauri'], start: 'damaged-commit', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, recover, commit], { foreignClear: 'yes' }),
            actor('b', B, [open, recover, commit], { foreignClear: 'yes' }),
        ],
        faults: faults(0.03, Infinity, 1, 10), pct: { depth: 3, horizon: 120 }, maxSteps: 4000, seeds: 18, minExercised: 0.85,
        floors: { 'commit:committed': 0.35, 'recover:installed': 0.45, 'a:recover': 0.4, 'b:recover': 0.45 },
    },
    {
        id: 'R18f', name: 'pick-all-present', covers: 'MC-291: a candidate whose lists name assets and inlays that are all present is picked and installed with no warning',
        backends: ['node', 'tauri', 'indexeddb'], start: 'damaged-commit', garbage: GARBAGE_UNITS, candidate: { assets: ['a-one.png', 'a-two.png'], inlays: ['inlay-one', 'inlay-two'] },
        actors: [actor('a', A, [open, { do: 'recover', candidate: true }, commit], { foreignClear: 'yes' })],
        pct: { depth: 2, horizon: 80 }, maxSteps: 4000, seeds: 6,
        floors: { 'recover:installed': 1 },
        outcomes: { a: ['open', 'recover:ready:img0:inl0/installed', 'commit:committed'] },
    },
    {
        id: 'R18g', name: 'pick-missing-images', covers: 'MC-291: missing asset files are counted in a warning and the recovery continues',
        backends: ['node', 'tauri', 'indexeddb'], start: 'damaged-commit', garbage: GARBAGE_UNITS, candidate: { assets: ['a-one.png', 'a-two.png'], inlays: ['inlay-one', 'inlay-two'] },
        actors: [actor('a', A, [open, { do: 'recover', candidate: true }, commit], { foreignClear: 'yes', present: { assets: false } })],
        pct: { depth: 2, horizon: 80 }, maxSteps: 4000, seeds: 6,
        floors: { 'recover:installed': 1 },
        outcomes: { a: ['open', 'recover:ready:img2:inl0/installed', 'commit:committed'] },
    },
    {
        id: 'R18h', name: 'pick-missing-inlays', covers: 'MC-291: missing inlay records are counted in a warning and the recovery continues',
        backends: ['node', 'tauri', 'indexeddb'], start: 'damaged-commit', garbage: GARBAGE_UNITS, candidate: { assets: ['a-one.png', 'a-two.png'], inlays: ['inlay-one', 'inlay-two'] },
        actors: [actor('a', A, [open, { do: 'recover', candidate: true }, commit], { foreignClear: 'yes', present: { inlays: false } })],
        pct: { depth: 2, horizon: 80 }, maxSteps: 4000, seeds: 6,
        floors: { 'recover:installed': 1 },
        outcomes: { a: ['open', 'recover:ready:img0:inl2/installed', 'commit:committed'] },
    },
    {
        id: 'R18i', name: 'pick-missing-unit', covers: 'MC-291: a candidate whose tree lacks a unit fails loudly and nothing is installed',
        backends: ['node', 'tauri', 'indexeddb'], start: 'damaged-commit', garbage: GARBAGE_UNITS, candidate: { missingUnit: true },
        actors: [actor('a', A, [open, { do: 'recover', candidate: true }, commit], { foreignClear: 'yes' })],
        pct: { depth: 2, horizon: 80 }, maxSteps: 4000, seeds: 6,
        floors: { 'recover:invalid': 1 },
        // The marker stands after the failed pick, so the commit that follows names no current to commit over.
        outcomes: { a: ['open', 'recover:invalid:missing', 'commit:refused:no-current'] },
    },
    {
        id: 'R19a', name: 'first-life-two-tabs', covers: 'plan v3.4 amendment 7 (R1): two tabs racing first life on an absent commit key; the unfenced marker, one install wins',
        backends: ['node', 'tauri', 'indexeddb'], start: 'no-commit-key', garbage: 0,
        // The loser's outcome is a marker conflict or the row-1 re-check refusing because the winner's units are already stored; both are `not-marked`.
        // A deeper PCT schedule with change points in the first 30 steps interleaves the two opens with the first writes; at the default depth
        // the loser always boots after the winner's marker and only the foreign-marker refusal is sampled.
        actors: [
            actor('a', A, [open, firstLife, commit]),
            actor('b', B, [open, firstLife, gc]),
        ],
        faults: { ...faults(0.03, Infinity, 1, 5), minFaulted: 0.35, idbMinFaulted: 0.3 }, pct: { depth: 6, horizon: 30 }, maxSteps: 4000, seeds: 30, idbSeeds: 24, minExercised: 0.85,
        floors: { 'firstLife:installed': 0.3, 'firstLife:not-marked': 0.2 },
        tauriFloors: { 'firstLife:installed': 0.3, 'firstLife:not-marked': 0.6 },
    },
    {
        id: 'R19b', name: 'first-life-seed-after-marker', covers: 'plan v3.4 amendment 7 (R1): the shared installer on the fenced marker of a seed exit over a standing seed marker',
        backends: ['node', 'tauri', 'indexeddb'], start: 'marker-seed', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, { do: 'exitInstall', kind: 'seed' }, commit], { foreignClear: 'yes' }),
            actor('b', B, [open, clearMarker, gc], { foreignClear: 'yes' }),
        ],
        faults: { ...faults(0.02, Infinity, 1, 8), minFaulted: 0.3, idbMinFaulted: 0.25 }, pct: { depth: 3, horizon: 100 }, maxSteps: 4000, seeds: 18, idbSeeds: 14, minExercised: 0.85,
        floors: { 'exitInstall:installed': 0.3, 'exitInstall:abandoned': 0.1 },
    },
    {
        id: 'R19c', name: 'first-life-convert-after-marker', covers: 'plan v3.4 amendment 7 (R1): the shared installer on the fenced marker of a convert exit over a standing convert marker',
        backends: ['node', 'tauri', 'indexeddb'], start: 'marker-convert', garbage: GARBAGE_UNITS,
        actors: [
            actor('a', A, [open, { do: 'exitInstall', kind: 'convert' }, commit], { foreignClear: 'yes', upstreamMainFile: true }),
            actor('b', B, [open, clearMarker, gc], { foreignClear: 'yes', upstreamMainFile: true }),
        ],
        faults: { ...faults(0.02, Infinity, 1, 8), minFaulted: 0.3, idbMinFaulted: 0.25 }, pct: { depth: 3, horizon: 100 }, maxSteps: 4000, seeds: 18, idbSeeds: 14, minExercised: 0.85,
        floors: { 'exitInstall:installed': 0.3, 'exitInstall:abandoned': 0.1 },
    },
    {
        id: 'R19d', name: 'first-life-tauri-crash-mid-install', covers: 'plan v3.4 amendment 7 (R1): Tauri first life interrupted by an unflushed write and a restart that drops it; the new page clears its own marker and installs again',
        backends: ['tauri'], start: 'no-commit-key', garbage: 0,
        actors: [
            actor('a', A, [open, firstLife, { do: 'restart' }, firstLife, commit], { device: 'phone' }),
        ],
        faults: { ...faults(0.08, Infinity, 1, 6), flush: true }, pct: { depth: 3, horizon: 140 }, maxSteps: 4000, seeds: 24, minExercised: 0.6,
        floors: { 'restart:cleared': 0.3, 'firstLife:installed': 0.25, 'firstLife:upload-failed': 0.4 },
    },
    {
        id: 'R19e', name: 'boot-import-tauri-crash-mid-install', covers: 'B3c: a Tauri boot .bin import (first-life marker labelled import) interrupted by an unflushed write and a restart that drops it classifies as row 11 and is never cleared and re-run as a seed (row 9)',
        backends: ['tauri'], start: 'no-commit-key', garbage: 0,
        actors: [
            // After the restart the page holds the import's own marker (or the finished install): a grant is refused either way, and the
            // start-up clear of the new page never removes the marker, which only a row-9 seed or convert marker would allow.
            actor('a', A, [open, { do: 'firstLife', label: 'import' }, { do: 'restart' }, firstLife], { device: 'phone' }),
        ],
        faults: { ...faults(0.08, Infinity, 1, 6), flush: true }, pct: { depth: 3, horizon: 140 }, maxSteps: 4000, seeds: 24, minExercised: 0.6,
        floors: { 'restart': 0.7, 'firstLife:upload-failed': 0.4, 'firstLife:refused': 0.7 },
    },
    {
        id: 'R19f', name: 'boot-restore-tauri-crash-mid-install', covers: 'B3c: a Tauri boot restore of the newest backup (first-life marker labelled convert, no main file) interrupted by an unflushed write and a restart that drops it classifies as row 10 and is never cleared and re-run as a seed (row 9)',
        backends: ['tauri'], start: 'no-commit-key', garbage: 0,
        actors: [
            actor('a', A, [open, { do: 'firstLife', label: 'convert' }, { do: 'restart' }, firstLife], { device: 'phone' }),
        ],
        faults: { ...faults(0.08, Infinity, 1, 6), flush: true }, pct: { depth: 3, horizon: 140 }, maxSteps: 4000, seeds: 24, minExercised: 0.6,
        floors: { 'restart': 0.7, 'firstLife:upload-failed': 0.4, 'firstLife:refused': 0.7 },
    },
]

// ---- Running a region ----

/** How a run ended. Only `violation` is red. */
export type RunKind = 'violation' | 'stalled' | 'max-steps' | 'threw' | 'not-exercised' | 'crashed' | 'complete'

export interface RegionRun {
    region: string
    backend: RegionBackend
    seed: number
    kind: RunKind
    steps: number
    /** Checker violations, `property: detail`. */
    violations: string[]
    /** Operation keys reached: `restore`, and `restore:committed` for the outcome it ended in. */
    reached: string[]
    /** Each actor's outcome labels in order. */
    outcomes: Record<string, string[]>
    /** Errors of failed actors, `actor: Name: message`. */
    errors: string[]
    /** Faults the scheduler injected, by kind. */
    faults: Record<string, number>
    /** The step of the first injected fault (not the damage steps), or null. */
    firstFaultStep: number | null
    /** The step of the first applied commit-key write under a recovery marker (`recovery-begin`), or null when the run wrote none. */
    markerStep: number | null
    /** Faults the scheduler injected after that marker write; null when the run wrote none. */
    faultsAfterMarker: number | null
}

function pickLabel(picked: PickResult): { label: string, kind: string, ready: boolean } {
    switch (picked.status) {
        case 'ready':
            return {
                label: picked.counts.checked ? `ready:img${picked.counts.missingImages}:inl${picked.counts.missingInlays}` : 'ready:unchecked',
                kind: 'ready',
                ready: true,
            }
        case 'invalid':
            return { label: `invalid:${picked.problem.kind}`, kind: 'invalid', ready: false }
        case 'exit':
            return { label: `exit:${outcomeLabel(picked.exit)}`, kind: 'exit', ready: false }
    }
}

interface StepResult {
    label: string
    /** The outcome class, for the reached keys. */
    kind: string
    /** More reached keys of the step, each recorded as `<op>:<key>` besides `<op>:<kind>`. */
    also?: string[]
}

/** A collection pass that deleted more than one batch (25 keys) of garbage before it ended. */
const GC_MULTI_BATCH_KEYS = 25

/**
 * A recovery exit or pick that answers `conflict` is run again from the start at the key the conflict carried (the library's
 * contract for that result); the screen gives up after this many runs and the step ends `rerun-exhausted`, never as a pass.
 */
const SCREEN_ATTEMPTS = 3

interface RunContext {
    candidate: string | null
    variant: RegionBackend
}

async function runStep(actor: ReplayActor, spec: RegionActor, step: RegionStep, index: number, ctx: RunContext): Promise<StepResult> {
    const tag = `${spec.id}${index}`
    switch (step.do) {
        case 'open':
            await actor.open({ upstreamMainFile: spec.upstreamMainFile })
            return { label: 'open', kind: 'done' }
        case 'commit': {
            const { result } = await actor.commit(tag, step.extra)
            return { label: `commit:${outcomeLabel(result)}`, kind: result.status }
        }
        case 'bulk': {
            const { result } = await actor.bulkCommit(tag)
            return { label: `bulk:${outcomeLabel(result)}`, kind: result.status }
        }
        case 'saveMine': {
            const { result } = await actor.saveMine(tag)
            return { label: `saveMine:${outcomeLabel(result)}`, kind: result.status }
        }
        case 'admit': {
            const { result } = await actor.admit(tag)
            return { label: `admit:${outcomeLabel(result)}`, kind: result.status }
        }
        case 'restore': {
            const target = (await actor.readKey())?.retained[0]?.key
            if (target === undefined) {
                return { label: 'restore:no-target', kind: 'no-target' }
            }
            const result = await actor.restore(target)
            return { label: `restore:${outcomeLabel(result)}`, kind: result.status }
        }
        case 'pin': {
            const target = (await actor.readKey())?.current?.key
            if (target === undefined) {
                return { label: 'pin:no-target', kind: 'no-target' }
            }
            const result = await actor.pin(target)
            return { label: `pin:${outcomeLabel(result)}`, kind: result.status }
        }
        case 'unpin': {
            const target = (await actor.readKey())?.pins[0]?.key
            if (target === undefined) {
                return { label: 'unpin:no-target', kind: 'no-target' }
            }
            const result = await actor.unpin(target)
            return { label: `unpin:${outcomeLabel(result)}`, kind: result.status }
        }
        case 'gc': {
            const result = await actor.gcPass()
            // `gc:done:<stop>` is a pass a conflict ended between batches; `gc:multi-batch` one that deleted past the first batch.
            const also: string[] = []
            if (result.status === 'done') {
                if (result.stopped !== undefined) {
                    also.push(`done:${result.stopped}`)
                }
                if (result.deleted > GC_MULTI_BATCH_KEYS) {
                    also.push('multi-batch')
                }
            }
            return { label: `gc:${result.status === 'done' ? `${outcomeLabel(result)}:${result.deleted}` : outcomeLabel(result)}`, kind: result.status, also }
        }
        case 'exit': {
            let result = await actor.runExit(step.kind)
            for (let attempt = 1; attempt < SCREEN_ATTEMPTS && result.status === 'conflict'; attempt++) {
                result = await actor.runExit(step.kind)
            }
            if (result.status === 'conflict') {
                return { label: `exit:${outcomeLabel(result)}:rerun-exhausted`, kind: 'rerun-exhausted' }
            }
            return { label: `exit:${outcomeLabel(result)}`, kind: result.status }
        }
        case 'firstLife': {
            const result = await actor.firstLife(tag, undefined, undefined, step.label)
            if (result.status === 'refused') {
                return { label: `firstLife:refused:${result.reason}`, kind: 'refused' }
            }
            if (result.status === 'not-marked') {
                return { label: `firstLife:not-marked:${result.marker.status}`, kind: 'not-marked', also: [`not-marked:${result.marker.status}`] }
            }
            return { label: `firstLife:${outcomeLabel(result)}`, kind: result.status }
        }
        case 'exitInstall': {
            let exit = await actor.runExit(step.kind)
            for (let attempt = 1; attempt < SCREEN_ATTEMPTS && exit.status === 'conflict'; attempt++) {
                exit = await actor.runExit(step.kind)
            }
            if (exit.status !== 'marked') {
                return { label: `exitInstall:${outcomeLabel(exit)}`, kind: exit.status }
            }
            const installed = await actor.installAfterExit(exit, tag)
            return { label: `exitInstall:marked/${installed.status}`, kind: installed.status }
        }
        case 'recover': {
            let target: string | undefined
            if (step.candidate === true) {
                if (ctx.candidate === null) {
                    throw new Error('The region names a planted candidate and plants none.')
                }
                target = ctx.candidate
            } else {
                const listed = await actor.listRecoveryCandidates()
                if (listed.status !== 'listed' || listed.candidates.length === 0) {
                    return { label: 'recover:no-candidate', kind: 'no-candidate' }
                }
            }
            let picked = await actor.pickCandidate(target)
            for (let attempt = 1; attempt < SCREEN_ATTEMPTS && picked.status === 'exit' && picked.exit.status === 'conflict'; attempt++) {
                picked = await actor.pickCandidate(target)
            }
            if (picked.status === 'exit' && picked.exit.status === 'conflict') {
                return { label: `recover:${pickLabel(picked).label}:rerun-exhausted`, kind: 'rerun-exhausted' }
            }
            const described = pickLabel(picked)
            if (picked.status !== 'ready') {
                return { label: `recover:${described.label}`, kind: described.kind }
            }
            const installed = await actor.installPick(picked)
            // `recover:installed:planted` is reached only by an install of the planted candidate, so a region can require that one.
            return { label: `recover:${described.label}/${installed.status}`, kind: installed.status, also: installed.status === 'installed' && picked.manifestKey === ctx.candidate ? ['installed:planted'] : [] }
        }
        case 'fenceExit': {
            const result = await actor.fenceExit()
            return { label: `fenceExit:${outcomeLabel(result)}`, kind: result.status }
        }
        case 'discardFence': {
            const result = await actor.discardFence()
            return { label: `discardFence:${outcomeLabel(result)}`, kind: result.status }
        }
        case 'clearMarker': {
            const outcome = await actor.clearMarker()
            return { label: `clearMarker:${outcome.decision}${outcome.cleared === null ? '' : `:${outcomeLabel(outcome.cleared)}`}`, kind: outcome.decision }
        }
        case 'abandonClear': {
            const prefix = (await actor.readKey())?.staging?.prefix
            if (prefix === undefined) {
                return { label: 'abandonClear:no-target', kind: 'no-target' }
            }
            const result = await actor.abandonClear(prefix)
            return { label: `abandonClear:${outcomeLabel(result)}`, kind: result.status }
        }
        case 'restart': {
            if (ctx.variant !== 'tauri') {
                return { label: 'restart:not-tauri', kind: 'skipped' }
            }
            // The kind is what the new page's start-up clear came to, so a floor can require that it ran.
            const session = await actor.restart({ drop: step.drop })
            const cleared = session.startupClear === null ? 'none' : outcomeLabel(session.startupClear)
            return { label: `restart:${cleared}`, kind: cleared }
        }
        case 'readKey': {
            const key = await actor.readKey()
            return { label: `readKey:${key === null ? 'unparsed' : 'parsed'}`, kind: key === null ? 'unparsed' : 'parsed' }
        }
    }
}

/** The fault plan of a region. The scheduler reads `probability` at every decision; it stays zero until `startAfterSteps` steps are applied. */
function faultPlanOf(region: RegionConfig): Extract<FaultPlan, { mode: 'random' }> | null {
    const spec = region.faults
    if (spec === undefined) {
        return null
    }
    return { mode: 'random', probability: 0, budget: { lostPerActor: spec.lostPerActor, crashPerActor: spec.crashPerActor }, ...(spec.flush === true ? { flushFaults: true } : {}) }
}

function rigOptionsOf(region: RegionConfig, seed: number, plan: Extract<FaultPlan, { mode: 'random' }> | null, ctx: RunContext, observe: (info: StepInfo) => void): ReplayRigOptions {
    return {
        scheduler: {
            seed,
            policy: { kind: 'pct', depth: region.pct.depth, horizon: region.pct.horizon },
            faults: plan ?? { mode: 'none' },
        },
        start: region.start,
        observe,
        prepare: (hooks, env) => {
            plantGarbageUnits(hooks.plant, env, region.garbage)
            let markerPrefix: string | null = null
            if (region.foreignBulkUnits !== undefined) {
                markerPrefix = plantForeignBulk(hooks.peek, hooks.plant, env, FOREIGN_OWNER, region.foreignBulkUnits)
            }
            if (region.candidate !== undefined) {
                if (region.stagedCandidate === true && markerPrefix === null) {
                    throw new Error('A staged candidate needs the foreign bulk marker of its prefix.')
                }
                // The staging id sits between `store2/g-` and the closing dash of the marker's prefix.
                const stagingId = region.stagedCandidate === true && markerPrefix !== null ? markerPrefix.slice('store2/g-'.length, -1) : undefined
                ctx.candidate = plantCandidateTree(hooks.plant, env, { ...region.candidate, stagingId })
            }
        },
    }
}

export async function runRegion(region: RegionConfig, backend: RegionBackend, seed: number): Promise<RegionRun> {
    const plan = faultPlanOf(region)
    const ctx: RunContext = { candidate: null, variant: backend }
    let markerStep: number | null = null
    const observe = (info: StepInfo): void => {
        // A byte-store layer names the commit key as the target of its write; the backend layer's commit-key write is its own op.
        const commitWrite = backend === 'indexeddb' ? info.op === 'casCommit' : info.target === COMMIT_KEY && (info.op === 'writeChecked' || info.op === 'writeTop')
        if (markerStep === null && info.applied && info.kind === 'call' && commitWrite && info.context?.kind === 'recovery-begin') {
            markerStep = info.step
        }
        if (plan !== null && region.faults !== undefined && info.step >= region.faults.startAfterSteps) {
            plan.probability = region.faults.probability
        }
    }
    const options = rigOptionsOf(region, seed, plan, ctx, observe)
    const rig: ReplayRig = backend === 'node' ? await createNodeReplayRig(options) : backend === 'tauri' ? await createTauriReplayRig(options) : await createIdbReplayRig(options)

    const outcomes: Record<string, string[]> = {}
    const reached = new Set<string>()
    for (const spec of region.actors) {
        outcomes[spec.id] = []
        const ask = spec.foreignClear === undefined ? undefined : async (): Promise<boolean> => spec.foreignClear === 'yes'
        rig.spawn(spec.id, spec.seed, async (running) => {
            for (let index = 0; index < spec.program.length; index++) {
                const step = spec.program[index]
                const done = await runStep(running, spec, step, index, ctx)
                outcomes[spec.id].push(done.label)
                reached.add(step.do)
                reached.add(`${step.do}:${done.kind}`)
                for (const key of done.also ?? []) {
                    reached.add(`${step.do}:${key}`)
                }
                // Per actor, so a floor can require that each of two actors with the same program got that far.
                reached.add(`${spec.id}:${step.do}`)
            }
        }, { foreignClear: ask, page: spec.page ?? 'P', device: spec.device, present: spec.present })
    }
    for (const damage of region.damage ?? []) {
        const register = (): void => {
            rig.scheduler.environment(damage.name, damage.name, () => {
                rig.hooks.plant(damage.name === 'damage-commit' ? COMMIT_KEY : FENCE_KEY, GARBAGE)
            })
        }
        const after = backend === 'indexeddb' ? damage.idbAfter ?? damage.after : damage.after
        if (after === undefined) {
            register()
        } else {
            void rig.reached(after).then(register)
        }
    }
    const result = await rig.run({ maxSteps: region.maxSteps })

    const violations = rig.checker.violations.map((violation) => `${violation.property}: ${violation.detail}`)
    const errors: string[] = []
    let threw = false
    let unavailable = false
    let crashed = false
    for (const [id, report] of Object.entries(result.actors)) {
        if (report.state === 'failed') {
            errors.push(`${id}: ${report.error ?? ''}`)
            if (report.error?.startsWith(PageUnavailableError.name) === true) {
                unavailable = true
            } else {
                threw = true
            }
        }
        crashed = crashed || report.state === 'crashed'
    }
    const log = rig.scheduler.log
    // `restart:dropped` is a restart that took at least one unflushed write out of the store: the fault and the restart met.
    if (log.some((entry) => entry.op === 'restart' && entry.outcome !== 'env:dropped=0')) {
        reached.add('restart:dropped')
    }
    const faultCounts: Record<string, number> = {}
    let firstFaultStep: number | null = null
    for (const entry of log) {
        if (entry.fault !== null && entry.actor !== '$env') {
            faultCounts[entry.fault] = (faultCounts[entry.fault] ?? 0) + 1
            firstFaultStep = firstFaultStep === null ? entry.step : Math.min(firstFaultStep, entry.step)
        }
    }
    const markedAt = markerStep as number | null
    const faultsAfterMarker = markedAt === null ? null : log.filter((entry) => entry.fault !== null && entry.actor !== '$env' && entry.step > markedAt).length
    // A faulted registration with the page gate may leave a page read-only: the run did not exercise the operations asked for.
    // An actor that failed with anything but the unavailable page is a throw, whether or not a registration faulted.
    const registrationFaulted = log.some((entry) => entry.op === 'registerPage' && entry.fault !== null)
    let kind: RunKind
    if (violations.length > 0) {
        kind = 'violation'
    } else if (result.status === 'stalled') {
        kind = 'stalled'
    } else if (result.status === 'max-steps') {
        kind = 'max-steps'
    } else if (threw) {
        kind = 'threw'
    } else if (registrationFaulted || unavailable) {
        kind = 'not-exercised'
    } else if (crashed) {
        kind = 'crashed'
    } else {
        kind = 'complete'
    }
    return { region: region.id, backend, seed, kind, steps: result.steps, violations, reached: [...reached].sort(), outcomes, errors, faults: faultCounts, firstFaultStep, markerStep: markedAt, faultsAfterMarker }
}
