import type { toSaveType } from '../risuSave'
import type { UnitType } from './format'
import type { SplitMsField, SplitPutSection, SplitRecorder } from './codec/types'
import type { CharSignals, NetSignalHandle, SignalGlobals } from '../netSignalMeter'
import type { InFlightKind } from '../../process/inFlightWork'
import { peekTextReadCount } from '../tauriByteTransport'

/**
 * The save-pass meter of a measurement build: per encode pass the kind, whether the modules were encoded, how many
 * characters were encoded and the pass's wall time; per committed pass the identity and key of every unit the commit
 * wrote (a unit that was not reused). It exists only in a measurement build: `saveEncoder.ts` calls it only under
 * `if (MEASURE)`, so a normal build folds the calls away and drops this module and the global name with it.
 *
 * Use: set localStorage `risu-measure-savepass` to `on`, reload, and in the console of a store2 page call
 * `__risuSavePassMeter.last()`, `.all()`, `.units()` and `.reset()`. Every pass also reaches a `risu-measure-savepass`
 * console line, but the build strips `console.*` in every vite build, so that line exists only under `pnpm dev`; on a
 * measurement build the global is the only output.
 *
 * `ms` is the wall time of the whole planning pass, the waits at its yields included. It is not the longest
 * main-thread slice: the loop's budget decides whether a call to the pass's `yield` really yields, and the real
 * yield function is private to that budget, so a slice cannot be measured here without changing the loop. The slice
 * criterion is judged from a device trace.
 *
 * `units()` holds one record per committed pass, in commit order, written when the pass is acknowledged: only the
 * attempt that landed is recorded, and a plan that was never acknowledged leaves no record.
 *
 * The meter never throws into the save path: every entry point swallows its own failures.
 *
 * Split timers (`record.split`, CHORE-205 stage 0): each pass also records where its synchronous planning time went.
 * `scopeMs` is `scopeOf`, `sinkMs` the encoder and its sink (the previous key-set copy), `listMs` the character-list
 * copy and the shared-id scan, `frontMs` presets/plugins/plugin storage, `modulesMs` the module set (the sum of each
 * module's turn and the index; or the carried copy), `characters[]` one entry per named character split into
 * `normalizeMs` (the read of the live character) and `emitMs`, `carriedMs` every carried character's entry (the lazy
 * `previousEntriesMs` build is inside the first of them), `carriedUnitsMs`, `finishTreeMs` (with `finish.shardsMs`,
 * `fixedMs`, `configMs` and `manifestMs` inside it) and `planTailMs`. `syncMs` is the sum of those top-level sections,
 * so `ms - syncMs` is the yield waits plus untimed glue. `module` (only for a module-scoped pass) holds `readMs` (the
 * proxy read), `listsMs` (the list derivations of the modules whose lists were not carried), and the framing and digest
 * time of the module section's puts. `unitEncodeMs`/`unitDigestMs`/`puts` cover every put of the pass, and
 * `sections` repeats them for `front`, `modules`, `characters` and `finish` (the shards, the fixed units, the config
 * units and the manifest). `characters[]` keeps the first 50 entries; `charactersCount` and `charactersMs` cover all.
 * A skipped character's entry has `skipped: true` and its whole block under `normalizeMs`.
 *
 * Every pass record has `seq` (monotonic per page, the join key to the commit record) and `at` (`performance.now()` at
 * the pass start). A stub retry plans twice for one tick: the first plan throws before it finishes, so it leaves no
 * record and no `ticks` count (only a skipped `seq`), and the second plan, which carries `retry: true`, is that tick's
 * only record and counts as the tick. `crossOriginIsolated` is recorded because it sets the timer resolution:
 * about 100 microseconds without cross-origin isolation, so a short span reads as 0 or one step. The timers sit
 * inside the work they time, so a switch-on pass is slower than a switch-off one by the meter's own overhead (about two
 * clock reads per unit put); switch-on numbers are not comparable with a build that has no timers.
 *
 * The commit record adds `seq`, `acknowledgeMs`, `commitBuildMs` (the sum of `finalize` over every build call of the
 * plan, `builds` being the call count; the acknowledged tree is the last build's) and, for a tick, `found`.
 *
 * Net-found counter (`netFound()`, U1): at acknowledge of an idle-net tick every non-reused unit except the manifest is
 * grouped into an entity (a character by entity id, a module by handle, a fixed group) and given the save-mark state
 * the loop's tracker shows, read without writing (`peekMarks`). `marked`: a mark existed at the pass start. `front`:
 * the character is the tracker's sticky front (index 0 stays after a snapshot and is not evidence of a pending mark;
 * `frontChanged` is set when the front differs at acknowledge). `markedLater`: absent at the start, present at
 * acknowledge. `unmarked`: no mark at either point. `unknown`: the request carried no peek. A character find lists every
 * rule that named it (`reasons`: `marked`, `unheld`, `ambiguous`, `net`) and counts under one summary reason (marked,
 * then unheld, then ambiguous, then net); only a find whose sole reason is `net` is a U1 finding, so
 * `entities.character.net` is the U1 count. Module and fixed-group finds are "the tick came first": every pass encodes
 * the fixed group and a due tick encodes the modules, so they are not "only the net catches it". `shard:` units are
 * their own kind (moved fields and stub overlays rewrite a shard without a body change). `ticks` counts every tick
 * plan, `ticksCommitted` the ones that were acknowledged. A tick that ends `unknown` and is later adopted is not
 * counted (its plan is never acknowledged).
 *
 * Verdict tally (`verdicts()`, CHORE-205 stage 1c): the idle net's slot ends in exactly one way, counted in `slotEnds`
 * (their sum is `slots`); a slot that reached a verdict also counts in `outcomes`. `unknown` there includes a
 * resident in the unsavable set and a `verdictOf` that threw, which the encoder logs and returns as `unknown`, so a
 * throw is not told apart from a primitive `unknown`. Every pass an idle-net slot runs, a full-tick fallback or a
 * verdict-named silent pass, is a stage 0 `tick`; `slotEnds` tells which reason sent it. `decisionMs` is the wall
 * time of each slot's decision part; `slotPassMs` the pass a slot went on to run. `slotTimings` (CHORE-205 stage 1d) holds
 * one record per slot, aligned with `decisionMs`, with the slot's end reason and where its decision time went (see
 * `NetSlotTiming`).
 *
 * Verdict shadow (`shadowTally()` and `shadowSlots()`, CHORE-205 stage 2b): the encoder keeps a value shadow of each
 * clean resident (see `SaveEncoder.verdictOf`). `shadowTally()` counts hits, misses, refusals, drops and the tripwire's
 * runs and disagreements; `shadowSlots()` holds one record per slot, aligned with `slotTimings`, with the slot's tag and
 * its tripwire time. The tripwire re-judges every eighth hit with the full primitive on the live character; the phone
 * run requires zero disagreements. All of it records only while the `risu-measure-savepass` switch is on.
 *
 * Signal slots (`signalSlots()` and `signalAcks()`, CHORE-205 counter experiment): one self-contained record per slot, in
 * its own ring, with the slot's timing fields copied in and the judged character's signal counters (see
 * `netSignalMeter.ts`) copied at the instant the verdict returned (`endAt`; a slot that left before a verdict uses the
 * decision's end). The counters come through `globalThis.__risuNetSignals`, typed here by an `import type` only: this
 * module is in the `saveLoop` chunk and must not import the signal module at runtime. Without the handle the signal
 * fields are null. A dirty slot also registers a late watch: `lateAt` is set when a signal for the character arrives
 * within 10 s after `endAt`, and `watchRefused` when the handle's watch cap refused the registration. `signalAcks()`
 * holds the points at which a character's saved state became current: `ack` (a commit, with the pass start and the
 * characters it encoded), `unchanged` (a pass that found nothing to write), `adopted` (a pending attempt that proved
 * to be current) and `init` (reserved: boot seeds no entry yet). Only `ack` is the primary baseline.
 */

export type SavePassKind = 'rewriteAll' | 'whole' | 'tick' | 'edit'

export interface SavePassRecord {
    kind: SavePassKind
    /** Whether the pass encoded the modules. */
    modules: boolean
    /** How many characters the pass encoded. */
    characters: number
    ms: number
    /** Monotonic per page; the commit record of the same plan carries the same value. Present when the split was taken. */
    seq?: number
    /** `performance.now()` at the pass start. */
    at?: number
    /** The second plan of one tick after a stub was loaded. */
    retry?: boolean
    /** Null when the page does not report it. Without isolation timers resolve to about 100 microseconds. */
    crossOriginIsolated?: boolean | null
    split?: SavePassSplit
}

export interface SplitCharacterRecord {
    chaId: string
    ms: number
    normalizeMs: number
    emitMs: number
    skipped: boolean
}

export interface SplitSectionRecord {
    puts: number
    unitEncodeMs: number
    unitDigestMs: number
}

export interface SavePassSplit {
    scopeMs: number
    sinkMs: number
    listMs: number
    frontMs: number
    modulesMs: number
    moduleCount: number
    /** Only for a pass that encoded the modules. */
    module: { readMs: number, listsMs: number, unitEncodeMs: number, unitDigestMs: number } | null
    characters: SplitCharacterRecord[]
    charactersCount: number
    charactersMs: number
    carriedMs: number
    previousEntriesMs: number
    carriedUnitsMs: number
    finishTreeMs: number
    finish: { shardsMs: number, fixedMs: number, configMs: number, manifestMs: number }
    planTailMs: number
    unitEncodeMs: number
    unitDigestMs: number
    puts: number
    sections: Record<SplitPutSection, SplitSectionRecord>
    /** The sum of the top-level sections (scope, sink, list, front, modules, characters, carried, carriedUnits, finishTree, planTail). */
    syncMs: number
}

export interface SavePassUnitRecord {
    identity: string
    key: string
    type: UnitType
    bytes: number
}

/** The tracker's marks as the loop shows them, copied without writing. */
export interface SaveMarkPeek {
    /** `tracker.character[0]`, the sticky front. */
    front: string | null
    /** The chaId of `tracker.chat[0]`. */
    frontChat: string | null
    /** The chaIds at index 1 and above of the character marks and of the chat marks. */
    character: ReadonlySet<string>
    flags: { botPreset: boolean, modules: boolean, loadouts: boolean, plugins: boolean, pluginCustomStorage: boolean }
    /** `port.isDirty()`. */
    dirty: boolean
}

export type FindKind = 'character' | 'module' | 'fixed'
export type FixedGroup = 'botPreset' | 'plugins' | 'pluginCustomStorage' | 'loadouts' | 'configLists' | 'none'
export type FindMark = 'marked' | 'front' | 'markedLater' | 'unmarked' | 'unknown'
export type FindReason = 'marked' | 'unheld' | 'ambiguous' | 'net'
export type FindSummaryReason = FindReason | 'unattributed'

/** One entity (or fixed group) the commit of a tick wrote. */
export interface SavePassFind {
    kind: FindKind
    /** The chaId of a character, the handle of a module, the group name of a fixed group. */
    entity: string
    mark: FindMark
    /** Characters only: every rule that named it, and the one it counts under. */
    reasons?: FindReason[]
    reason?: FindSummaryReason
    frontChanged?: boolean
    units: number
}

export interface SavePassUnitCounts {
    character: number
    module: number
    shard: number
    fixed: number
    /** An identity the grouping does not know; a nonzero count means the grouping is out of date. */
    other: number
}

export interface SavePassCommitRecord {
    kind: SavePassKind
    units: SavePassUnitRecord[]
    seq?: number
    acknowledgeMs?: number
    commitBuildMs?: number
    builds?: number
    /** Ticks only: the entities the commit wrote. */
    found?: SavePassFind[]
    unitCounts?: SavePassUnitCounts
}

export interface MarkCounts {
    marked: number
    front: number
    markedLater: number
    unmarked: number
    unknown: number
    /** Finds whose start front differs from the front at acknowledge (also counted under their state). */
    frontChanged: number
}

export interface NetFoundRecent {
    seq: number
    at: number
    kind: FindKind
    entity: string
    mark: FindMark
    reason?: FindSummaryReason
    frontChanged?: boolean
}

export interface NetFoundSummary {
    ticks: number
    ticksCommitted: number
    units: SavePassUnitCounts
    entities: {
        /** By summary reason; `net` is the U1 count. */
        character: Record<FindSummaryReason, MarkCounts>
        module: MarkCounts
        fixed: Partial<Record<FixedGroup, MarkCounts>>
    }
    /** The finds that were not `marked`, newest last, at most 200. */
    recent: NetFoundRecent[]
}

export interface SavePassMeterHandle {
    last(): SavePassRecord | null
    all(): SavePassRecord[]
    units(): SavePassCommitRecord[]
    netFound(): NetFoundSummary
    verdicts(): NetVerdictSummary
    shadowTally(): NetShadowTally
    shadowSlots(): NetShadowSlot[]
    signalSlots(): SignalSlotRecord[]
    signalAcks(): SignalAckRecord[]
    /** The `read_range_text` invokes since the page started (the transport's counter; neither `reset()` nor an export's take clears it). */
    textReads(): number
    reset(): void
}

/**
 * Whether a slot's verdict came from the encoder's value shadow: `hit` the live character equalled the shadow and the
 * primitive was not run, `miss` the primitive ran on the character, `none` the prologue or a fault answered before the
 * shadow was consulted.
 */
export type NetShadowTag = 'hit' | 'miss' | 'none'

/**
 * The shadow's counters since the page started or the last `reset()`, counted only while the switch is on. `shadowHits`
 * and `shadowMisses` count verdicts by tag; a tripwire slot is a hit. `shadowRefused` counts clean characters that
 * admission turned away, `shadowClears` the shadows dropped (a commit, an adoption, a pending attempt, a put-back, a
 * non-clean verdict or a fault), `shadowTripwireRuns` the hits that were re-judged by the full primitive and
 * `shadowDisagreements` those where it did not say clean.
 */
export interface NetShadowTally {
    shadowHits: number
    shadowMisses: number
    shadowRefused: number
    shadowClears: number
    shadowTripwireRuns: number
    shadowDisagreements: number
}

/** What one idle-net slot ended in; every slot has exactly one. */
export type NetSlotReason =
    | 'modulesDue' | 'consent' | 'readFailed' | 'parked' | 'dueAfterRead' | 'pending' | 'unheld' | 'stub' | 'unsavableAbsent'
    | 'verdictClean' | 'verdictDirty' | 'verdictUnknown' | 'slotMissing' | 'guardThrow' | 'noResident'
    | 'dueAfterYield' | 'dbChanged' | 'verdictSkipped'

/** What the judged character's verdict said. A `verdictOf` that threw reads as `unknown`: the encoder logs the throw and returns it. */
export type NetVerdictOutcome = 'clean' | 'dirty' | 'unknown'

export interface NetVerdictSummary {
    /** Every slot the tally saw; the sum of `slotEnds`. */
    slots: number
    slotEnds: Record<NetSlotReason, number>
    /** The slots that reached a verdict, by what it said (`unknown` includes an unsavable resident and a throw). */
    outcomes: Record<NetVerdictOutcome, number>
    /** Wall time of the decision part of each slot, newest last, at most 1000. */
    decisionMs: number[]
    /** One record per slot, aligned with `decisionMs` (same length, same order), at most 1000. */
    slotTimings: NetSlotTiming[]
    /** Wall time of the pass a slot went on to run, newest last, at most 1000; slots that ran no pass add none. */
    slotPassMs: number[]
}

/** The parts of one slot's decision that are timed apart; a part the slot's path did not take stays null. */
export type NetSlotPart = 'lockWaitMs' | 'readMs' | 'judgeMs' | 'checksMs' | 'scanMs' | 'unsavableMs' | 'pruneMs' | 'findMs' | 'verdictMs' | 'primitiveMs' | 'movedMs'
    | 'spanAMs' | 'yieldMs' | 'spanBMs'

/**
 * Where one slot's `decisionMs` went. `lockWaitMs` is the wait for the write lock and `readMs` the `readCommit` inside
 * it (recorded also when the read throws). `judgeMs` is `judge`. `checksMs` is everything between `judge` and the verdict:
 * the fused scan, the unsavable and prune steps and the resident lookup; a check that throws before the yield leaves it null. Its
 * sub-parts are `scanMs` (`SaveEncoder.netScan`: the unheld, stub and resident checks in one pass), `unsavableMs` (the
 * unsavable-absent scan, run only when something is unsavable), `pruneMs` (the shadow prune) and
 * `findMs` (the final resident lookup, timed from the resume after the yield, so it also covers the two re-checks
 * and the round-robin advance);
 * each is null when the slot did not run it, and those it ran sum to `checksMs`. When a check throws before the yield,
 * the sub-parts finished before it are recorded while `checksMs` stays null; a throw after the yield (a faulting step or
 * a rejecting yield) finds `checksMs` already closed at the yield. On a slot that yielded, `pruneMs` ends at the yield and
 * `checksMs` is the time to the yield plus `findMs`; an exit after the yield that runs no `find` (`dueAfterYield`,
 * `dbChanged`, an unsavable resident) leaves `findMs` null and `checksMs` at the time to the yield.
 * `spanAMs` is `judge` start to the yield (or to the end of the decision when the slot left before it), `yieldMs` the
 * wait, and `spanBMs` the resume to the end of the decision; all three are null when the slot left before `judge`, and
 * the last two when it left before the yield. Their sum plus `lockWaitMs` and `readMs` is at most `decisionMs`.
 * `verdictMs` is `verdictOf` as a whole, split into `primitiveMs` (the prologue, the plain read, and either the shadow
 * compare or the plain-entry primitive) and `movedMs` (the moved-field compare, only after a `clean` verdict). On a
 * tripwire slot `verdictMs` and `decisionMs` also include `shadowTripwireMs` (see `NetShadowSlot`), which `primitiveMs`
 * leaves out. `reason` is how the slot ended. The switch is read on every
 * call: a slot begun with the switch off and ended with it on is recorded with `reason` null and every part null, and a
 * slot begun with it on and ended with it off is not recorded at all.
 */
export interface NetSlotTiming {
    reason: NetSlotReason | null
    decisionMs: number
    lockWaitMs: number | null
    readMs: number | null
    judgeMs: number | null
    checksMs: number | null
    scanMs: number | null
    unsavableMs: number | null
    pruneMs: number | null
    findMs: number | null
    verdictMs: number | null
    primitiveMs: number | null
    movedMs: number | null
    spanAMs: number | null
    yieldMs: number | null
    spanBMs: number | null
}

/**
 * The shadow's record of one slot, in `shadowSlots()`, aligned with `slotTimings` (same length, same order). `verdictShadow`
 * is null for a slot that did not reach `verdictOf`. `shadowTripwire` marks a hit that the full primitive re-judged and
 * `shadowTripwireMs` is the time of that re-judging, kept apart from `primitiveMs`. Such a slot counts as a hit, and a
 * timing median leaves it out: its `verdictMs` and `decisionMs` include the re-judging.
 */
export interface NetShadowSlot {
    verdictShadow: NetShadowTag | null
    shadowTripwire: boolean
    shadowTripwireMs: number | null
}

/** One idle-net slot with the signal counters of the character it judged, self-contained (no join to `slotTimings`). */
export interface SignalSlotRecord {
    /** Monotonic per page, counted by this ring. */
    seq: number
    /** `performance.now()` at the slot's decision start; null when the loop gave no start. */
    at: number | null
    /** The instant `verdictOf` returned, or the decision's end for a slot that left before a verdict. */
    endAt: number
    reason: NetSlotReason | null
    decisionMs: number
    spanAMs: number | null
    spanBMs: number | null
    shadow: NetShadowTag | null
    hidden: boolean | null
    selectedChaId: string | null
    /** The resident count after the shadow prune; null when the slot left before it. */
    residents: number | null
    /** The change in the resident count since the previous slot that had one; null for the first. */
    residentsDelta: number | null
    chaId: string | null
    outcome: NetVerdictOutcome | null
    /** Consecutive dirty verdicts for `chaId` including this one; 0 for any other outcome. */
    dirtyRun: number
    /** Copies taken at `endAt`; null without the handle or without a judged character. */
    signals: CharSignals | null
    signalGlobals: SignalGlobals | null
    inFlightKinds: InFlightKind[] | null
    /** Commits acknowledged by this ring's owner so far (cumulative). */
    commits: number
    /** Set when a signal for `chaId` arrived within 10 s after `endAt` (dirty slots only). */
    lateAt: number | null
    /** The handle's watch cap refused this dirty slot's late check. */
    watchRefused: boolean
}

export type SignalAckKind = 'ack' | 'unchanged' | 'adopted' | 'init'

/** A point at which the saved state of `chaIds` became current. */
export interface SignalAckRecord {
    kind: SignalAckKind
    /** The start of the pass that produced the state. */
    passStartAt: number
    /** When the loop noted it. */
    ackAt: number
    chaIds: string[]
}

/** The part of a save request that decides the kind. */
export interface SavePassShape {
    whole: boolean
    rewriteAll?: boolean
    net?: object
}

/** The part of a save request the split and the net-found counter read. */
export interface SavePassSplitShape extends SavePassShape {
    marked?: ReadonlySet<string>
    net?: { chaId?: string | null }
    peekMarks?: () => SaveMarkPeek
    retry?: boolean
}

/** What the save encoder keeps of a pass and hands back at acknowledge. */
export interface SavePassSplitRecorder extends SplitRecorder {
    noteUnheld(chaIds: readonly string[]): void
    /** One `finalize` call of the commit's build, in milliseconds. */
    commitBuildMs(ms: number): void
}

/** What the save encoder hands to `noteSavePassCommit` for a plan that took a split. */
export interface SavePassCommitExtra {
    split: SavePassSplitRecorder
    acknowledgeMs: number
    /** `built.index.entities`: character handle (`chaId#occurrence`) to entity id. */
    entities: ReadonlyMap<string, string>
}

/** The part of an encoded unit the meter reads. */
export type MeteredUnit = {
    identity: string
    key: string
    type: UnitType
    bytes: Uint8Array
    reused: false
} | {
    identity: string
    key: string
    type: UnitType
    reused: true
}

const RECORD_LIMIT = 1000
const RECENT_LIMIT = 200
const CHARACTER_LIMIT = 50
const SWITCH_KEY = 'risu-measure-savepass'

const passes: SavePassRecord[] = []
const commits: SavePassCommitRecord[] = []

const REASONS: readonly FindSummaryReason[] = ['marked', 'unheld', 'ambiguous', 'net', 'unattributed']

function emptyMarkCounts(): MarkCounts {
    return { marked: 0, front: 0, markedLater: 0, unmarked: 0, unknown: 0, frontChanged: 0 }
}

function emptyUnitCounts(): SavePassUnitCounts {
    return { character: 0, module: 0, shard: 0, fixed: 0, other: 0 }
}

interface NetFoundState {
    ticks: number
    ticksCommitted: number
    units: SavePassUnitCounts
    character: Record<FindSummaryReason, MarkCounts>
    module: MarkCounts
    fixed: Partial<Record<FixedGroup, MarkCounts>>
    recent: NetFoundRecent[]
}

function freshNetFound(): NetFoundState {
    const character = {} as Record<FindSummaryReason, MarkCounts>
    for (const reason of REASONS) {
        character[reason] = emptyMarkCounts()
    }
    return { ticks: 0, ticksCommitted: 0, units: emptyUnitCounts(), character, module: emptyMarkCounts(), fixed: {}, recent: [] }
}

// Created on first use, not at module load: a top-level call is a side effect that keeps this module in a normal build.
let netFoundStore: NetFoundState | null = null

function netFoundNow(): NetFoundState {
    netFoundStore ??= freshNetFound()
    return netFoundStore
}

const NET_SLOT_REASONS: readonly NetSlotReason[] = [
    'modulesDue', 'consent', 'readFailed', 'parked', 'dueAfterRead', 'pending', 'unheld', 'stub', 'unsavableAbsent',
    'verdictClean', 'verdictDirty', 'verdictUnknown', 'slotMissing', 'guardThrow', 'noResident', 'dueAfterYield', 'dbChanged', 'verdictSkipped',
]

interface NetVerdictState {
    slotEnds: Record<NetSlotReason, number>
    outcomes: Record<NetVerdictOutcome, number>
    decisionMs: number[]
    slotTimings: NetSlotTiming[]
    slotPassMs: number[]
}

function freshVerdicts(): NetVerdictState {
    const slotEnds = {} as Record<NetSlotReason, number>
    for (const reason of NET_SLOT_REASONS) {
        slotEnds[reason] = 0
    }
    return { slotEnds, outcomes: { clean: 0, dirty: 0, unknown: 0 }, decisionMs: [], slotTimings: [], slotPassMs: [] }
}

// Created on first use, for the same reason as the net-found state.
let verdictStore: NetVerdictState | null = null
// The record of the slot in flight: begun by `noteNetSlotBegin`, closed by `noteNetSlotMs`. Parts noted outside a slot
// (the encoder's verdict called by anything else) find it null and record nothing.
let slotInFlight: NetSlotTiming | null = null

function verdictsNow(): NetVerdictState {
    verdictStore ??= freshVerdicts()
    return verdictStore
}

function verdictSummary(): NetVerdictSummary {
    const state = verdictsNow()
    let slots = 0
    for (const reason of NET_SLOT_REASONS) {
        slots += state.slotEnds[reason]
    }
    return { slots, slotEnds: { ...state.slotEnds }, outcomes: { ...state.outcomes }, decisionMs: [...state.decisionMs],
        slotTimings: state.slotTimings.map(timing => ({ ...timing })), slotPassMs: [...state.slotPassMs],
    }
}

/** The idle net calls this once per slot, with the way the slot ended and, for a slot that reached a verdict, what it said. */
export function noteNetSlotEnd(reason: NetSlotReason, outcome: NetVerdictOutcome | null = null): void {
    try {
        if (!switchedOn()) {
            return
        }
        installGlobal(globalThis)
        verdictsNow().slotEnds[reason]++
        if (outcome !== null) {
            verdictsNow().outcomes[outcome]++
        }
        if (slotInFlight !== null) {
            slotInFlight.reason = reason
        }
    } catch {
        // A measurement failure never reaches the save.
    }
}

/** The idle net calls this at the start of each slot; the parts and the end reason noted until `noteNetSlotMs` belong to it. */
export function noteNetSlotBegin(): void {
    try {
        slotInFlight = null
        shadowSlotInFlight = null
        signalDraftInFlight = null
        if (switchedOn()) {
            shadowSlotInFlight = blankShadowSlot()
            signalDraftInFlight = blankSignalDraft()
            slotInFlight = {
                reason: null, decisionMs: 0, lockWaitMs: null, readMs: null, judgeMs: null, checksMs: null,
                scanMs: null, unsavableMs: null, pruneMs: null, findMs: null,
                verdictMs: null, primitiveMs: null, movedMs: null, spanAMs: null, yieldMs: null, spanBMs: null,
            }
        }
    } catch {
        // A measurement failure never reaches the save.
    }
}

/** One timed part of the slot in flight; a part noted twice keeps the last. */
export function noteNetSlotPart(part: NetSlotPart, ms: number): void {
    try {
        if (slotInFlight !== null) {
            slotInFlight[part] = ms
        }
    } catch {
        // A measurement failure never reaches the save.
    }
}

/** The wall time of one slot's decision part; it also closes the slot's timing record. */
export function noteNetSlotMs(ms: number): void {
    try {
        const timing = slotInFlight
        const shadowSlot = shadowSlotInFlight
        const signalDraft = signalDraftInFlight
        slotInFlight = null
        shadowSlotInFlight = null
        signalDraftInFlight = null
        if (switchedOn()) {
            shadowSlotStore ??= []
            pushLimited(shadowSlotStore, shadowSlot ?? blankShadowSlot())
            pushLimited(verdictsNow().decisionMs, ms)
            pushLimited(verdictsNow().slotTimings, { ...(timing ?? { reason: null, lockWaitMs: null, readMs: null, judgeMs: null, checksMs: null, scanMs: null, unsavableMs: null, pruneMs: null, findMs: null, verdictMs: null, primitiveMs: null, movedMs: null, spanAMs: null, yieldMs: null, spanBMs: null }), decisionMs: ms })
            closeSignalSlot(signalDraft, timing, ms, shadowSlot)
        }
    } catch {
        // A measurement failure never reaches the save.
    }
}

/** The wall time of the pass a slot went on to run. */
export function noteNetSlotPassMs(ms: number): void {
    try {
        if (switchedOn()) {
            pushLimited(verdictsNow().slotPassMs, ms)
        }
    } catch {
        // A measurement failure never reaches the save.
    }
}

// Created on first use, for the same reason as the net-found state.
let shadowStore: NetShadowTally | null = null
let shadowSlotStore: NetShadowSlot[] | null = null
// The shadow record of the slot in flight, begun and closed with `slotInFlight`.
let shadowSlotInFlight: NetShadowSlot | null = null

function shadowNow(): NetShadowTally {
    shadowStore ??= { shadowHits: 0, shadowMisses: 0, shadowRefused: 0, shadowClears: 0, shadowTripwireRuns: 0, shadowDisagreements: 0 }
    return shadowStore
}

function blankShadowSlot(): NetShadowSlot {
    return { verdictShadow: null, shadowTripwire: false, shadowTripwireMs: null }
}

/** Every this many shadow hits, one is re-judged by the full primitive. */
const SHADOW_TRIPWIRE_EVERY = 8

/**
 * The encoder calls this once per `verdictOf` that got past the pending guard, with where the verdict came from. The
 * result is true for every eighth hit since the tally started: the caller then re-judges that hit with the full
 * primitive. False with the switch off, so the tripwire never runs unless the meter records it.
 */
export function noteNetShadow(tag: NetShadowTag): boolean {
    try {
        if (!switchedOn()) {
            return false
        }
        installGlobal(globalThis)
        if (shadowSlotInFlight !== null) {
            shadowSlotInFlight.verdictShadow = tag
        }
        if (tag === 'miss') {
            shadowNow().shadowMisses++
        } else if (tag === 'hit') {
            shadowNow().shadowHits++
            return shadowNow().shadowHits % SHADOW_TRIPWIRE_EVERY === 0
        }
    } catch {
        // A measurement failure never reaches the save.
    }
    return false
}

/** One tripwire re-judging: its time on the slot in flight, which it tags. */
export function noteNetShadowTripwire(ms: number): void {
    try {
        if (switchedOn()) {
            shadowNow().shadowTripwireRuns++
            if (shadowSlotInFlight !== null) {
                shadowSlotInFlight.shadowTripwire = true
                shadowSlotInFlight.shadowTripwireMs = ms
            }
        }
    } catch {
        // A measurement failure never reaches the save.
    }
}

/** A shadow event other than a verdict tag: `count` shadows dropped, a clean character refused admission, or a tripwire disagreement. */
export function noteNetShadowEvent(event: 'cleared' | 'refused' | 'disagreed', count: number = 1): void {
    try {
        if (switchedOn()) {
            installGlobal(globalThis)
            const tally = shadowNow()
            if (event === 'cleared') {
                tally.shadowClears += count
            } else if (event === 'refused') {
                tally.shadowRefused += count
            } else {
                tally.shadowDisagreements += count
            }
        }
    } catch {
        // A measurement failure never reaches the save.
    }
}

const SIGNAL_SLOT_LIMIT = 1500
const SIGNAL_ACK_LIMIT = 500
/** A dirty slot's late check: a signal for its character within this long after `endAt` marks it. */
const SIGNAL_LATE_WINDOW_MS = 10000

interface SignalSlotDraft {
    at: number | null
    clockEnd: number | null
    residents: number | null
    chaId: string | null
    outcome: NetVerdictOutcome | null
    endAt: number | null
    signals: CharSignals | null
    signalGlobals: SignalGlobals | null
    kinds: InFlightKind[] | null
    selected: string | null
}

// Created on first use, for the same reason as the net-found state.
let signalSlotStore: SignalSlotRecord[] | null = null
let signalAckStore: SignalAckRecord[] | null = null
// The signal draft of the slot in flight, begun and closed with `slotInFlight`.
let signalDraftInFlight: SignalSlotDraft | null = null
let signalSlotSeq = 0
let signalCommits = 0
let signalLastResidents: number | null = null
let signalDirtyRuns: Map<string, number> | null = null
// The start of the pass in flight (null outside a pass or with the switch off), and the attempt kept as pending.
let signalPassStartAt: number | null = null
let signalKept: { passStartAt: number, chaIds: string[] } | null = null

function blankSignalDraft(): SignalSlotDraft {
    return { at: null, clockEnd: null, residents: null, chaId: null, outcome: null, endAt: null, signals: null, signalGlobals: null, kinds: null, selected: null }
}

function signalHandle(): NetSignalHandle | null {
    return (globalThis as { __risuNetSignals?: NetSignalHandle }).__risuNetSignals ?? null
}

function readOrNull<T>(read: () => T): T | null {
    try {
        return read()
    } catch {
        return null
    }
}

function takeSignalSnapshot(draft: SignalSlotDraft, endAt: number): void {
    draft.endAt = endAt
    const signals = signalHandle()
    if (signals === null) {
        return
    }
    const chaId = draft.chaId
    draft.signals = chaId === null ? null : readOrNull(() => signals.signals(chaId))
    draft.signalGlobals = readOrNull(() => signals.globals())
    draft.kinds = readOrNull(() => signals.inFlightKinds())
    draft.selected = readOrNull(() => signals.selected())
}

/** The idle net calls this once per slot with the resident count after the shadow prune. */
export function noteSignalResidents(count: number): void {
    try {
        if (signalDraftInFlight !== null) {
            signalDraftInFlight.residents = count
        }
    } catch {
        // A measurement failure never reaches the save.
    }
}

/**
 * The idle net calls this at a verdict with the instant `verdictOf` returned, and at an unsavable or missing resident as
 * `unknown` with a null instant: the counters are then copied when the slot closes, at the decision's end.
 */
export function noteSignalVerdict(chaId: string, outcome: NetVerdictOutcome, endAt: number | null): void {
    try {
        const draft = signalDraftInFlight
        if (draft !== null) {
            draft.chaId = chaId
            draft.outcome = outcome
            if (endAt !== null) {
                takeSignalSnapshot(draft, endAt)
            }
        }
    } catch {
        // A measurement failure never reaches the save.
    }
}

/** A slot that took a resident's turn but skipped its verdict names the resident, with no outcome, so its slot record still carries the judged `chaId`. */
export function noteSignalSkipped(chaId: string): void {
    try {
        if (signalDraftInFlight !== null) {
            signalDraftInFlight.chaId = chaId
        }
    } catch {
        // A measurement failure never reaches the save.
    }
}

/** The decision's start and end instants, noted just before the slot closes; the end serves a slot that left before a verdict. */
export function noteSignalSlotClock(startAt: number, endAt: number): void {
    try {
        if (signalDraftInFlight !== null) {
            signalDraftInFlight.at = startAt
            signalDraftInFlight.clockEnd = endAt
        }
    } catch {
        // A measurement failure never reaches the save.
    }
}

function closeSignalSlot(draft: SignalSlotDraft | null, timing: NetSlotTiming | null, decisionMs: number, shadowSlot: NetShadowSlot | null): void {
    const current = draft ?? blankSignalDraft()
    if (current.endAt === null) {
        takeSignalSnapshot(current, current.clockEnd ?? performance.now())
    }
    const endAt = current.endAt ?? 0
    let residentsDelta: number | null = null
    if (current.residents !== null) {
        residentsDelta = signalLastResidents === null ? null : current.residents - signalLastResidents
        signalLastResidents = current.residents
    }
    signalDirtyRuns ??= new Map()
    let dirtyRun = 0
    if (current.chaId !== null) {
        if (current.outcome === 'dirty') {
            dirtyRun = (signalDirtyRuns.get(current.chaId) ?? 0) + 1
            signalDirtyRuns.set(current.chaId, dirtyRun)
        } else {
            signalDirtyRuns.delete(current.chaId)
        }
    }
    signalSlotSeq++
    const record: SignalSlotRecord = {
        seq: signalSlotSeq, at: current.at, endAt, reason: timing?.reason ?? null, decisionMs,
        spanAMs: timing?.spanAMs ?? null, spanBMs: timing?.spanBMs ?? null, shadow: shadowSlot?.verdictShadow ?? null,
        hidden: typeof document === 'undefined' ? null : document.hidden,
        selectedChaId: current.selected, residents: current.residents, residentsDelta,
        chaId: current.chaId, outcome: current.outcome, dirtyRun,
        signals: current.signals, signalGlobals: current.signalGlobals, inFlightKinds: current.kinds,
        commits: signalCommits, lateAt: null, watchRefused: false,
    }
    signalSlotStore ??= []
    pushLimited(signalSlotStore, record, SIGNAL_SLOT_LIMIT)
    const signals = signalHandle()
    if (record.outcome === 'dirty' && record.chaId !== null && signals !== null) {
        const chaId = record.chaId
        record.watchRefused = !(readOrNull(() => signals.watch(chaId, endAt + SIGNAL_LATE_WINDOW_MS, () => {
            record.lateAt ??= performance.now()
        })) ?? false)
    }
}

/** The loop calls this when a pass attempt starts: a marked pass at its snapshot, a tick pass at its plan start. */
export function noteSignalPassStart(): void {
    try {
        signalPassStartAt = switchedOn() ? performance.now() : null
    } catch {
        // A measurement failure never reaches the save.
    }
}

function pushSignalAck(kind: SignalAckKind, passStartAt: number, chaIds: readonly string[]): void {
    signalAckStore ??= []
    pushLimited(signalAckStore, { kind, passStartAt, ackAt: performance.now(), chaIds: [...chaIds] }, SIGNAL_ACK_LIMIT)
}

/** A commit landed and was acknowledged: `chaIds` is the set the plan encoded. Also drops an attempt kept as pending. */
export function noteSignalAck(chaIds: readonly string[]): void {
    try {
        if (signalPassStartAt !== null) {
            signalCommits++
            signalKept = null
            pushSignalAck('ack', signalPassStartAt, chaIds)
        }
    } catch {
        // A measurement failure never reaches the save.
    }
}

/** A pass found nothing to write: the characters it encoded equal their saved state. */
export function noteSignalUnchanged(chaIds: readonly string[]): void {
    try {
        if (signalPassStartAt !== null) {
            pushSignalAck('unchanged', signalPassStartAt, chaIds)
        }
    } catch {
        // A measurement failure never reaches the save.
    }
}

/** The pass in flight was kept as the pending attempt; an adoption makes its encoding current. */
export function noteSignalKept(chaIds: readonly string[]): void {
    try {
        signalKept = signalPassStartAt === null ? null : { passStartAt: signalPassStartAt, chaIds: [...chaIds] }
    } catch {
        // A measurement failure never reaches the save.
    }
}

/** The pending attempt was adopted as current. */
export function noteSignalAdopted(): void {
    try {
        if (signalKept !== null && switchedOn()) {
            pushSignalAck('adopted', signalKept.passStartAt, signalKept.chaIds)
        }
        signalKept = null
    } catch {
        // A measurement failure never reaches the save.
    }
}

let passSeq = 0
let splitClock: (() => number) | null = null

/** Replaces the split clock (a test's counting clock); null restores `performance.now()`. */
export function setSplitClockForTest(clock: (() => number) | null): void {
    splitClock = clock
}

function copyCounts(counts: MarkCounts): MarkCounts {
    return { ...counts }
}

function netFoundSummary(): NetFoundSummary {
    const character = {} as Record<FindSummaryReason, MarkCounts>
    for (const reason of REASONS) {
        character[reason] = copyCounts(netFoundNow().character[reason])
    }
    const fixed: Partial<Record<FixedGroup, MarkCounts>> = {}
    for (const group of Object.keys(netFoundNow().fixed) as FixedGroup[]) {
        const counts = netFoundNow().fixed[group]
        if (counts !== undefined) {
            fixed[group] = copyCounts(counts)
        }
    }
    return {
        ticks: netFoundNow().ticks,
        ticksCommitted: netFoundNow().ticksCommitted,
        units: { ...netFoundNow().units },
        entities: { character, module: copyCounts(netFoundNow().module), fixed },
        recent: netFoundNow().recent.map(entry => ({ ...entry })),
    }
}

const handle: SavePassMeterHandle = {
    last: () => passes.length === 0 ? null : passes[passes.length - 1],
    all: () => [...passes],
    units: () => [...commits],
    netFound: netFoundSummary,
    verdicts: verdictSummary,
    shadowTally: () => ({ ...shadowNow() }),
    shadowSlots: () => (shadowSlotStore ?? []).map(slot => ({ ...slot })),
    signalSlots: () => (signalSlotStore ?? []).map(slot => ({ ...slot })),
    signalAcks: () => (signalAckStore ?? []).map(entry => ({ ...entry, chaIds: [...entry.chaIds] })),
    textReads: () => peekTextReadCount() ?? 0,
    reset: () => {
        verdictStore = null
        shadowStore = null
        shadowSlotStore = null
        shadowSlotInFlight = null
        slotInFlight = null
        signalDraftInFlight = null
        signalSlotStore = null
        signalAckStore = null
        signalSlotSeq = 0
        signalCommits = 0
        signalLastResidents = null
        signalDirtyRuns = null
        signalPassStartAt = null
        signalKept = null
        passes.length = 0
        commits.length = 0
        netFoundStore = null
        readOrNull(() => signalHandle()?.reset())
    },
}

const PUT_SECTIONS: readonly SplitPutSection[] = ['front', 'modules', 'characters', 'finish']

/**
 * The recorder of one planning pass. Every method is total (a failure is swallowed), so the codec calling it cannot
 * be made to fail by the meter; a clock that throws reads as 0.
 */
class SplitState implements SavePassSplitRecorder {
    section: SplitPutSection | null = null
    readonly seq: number
    readonly at: number
    marksAtStart: SaveMarkPeek | null = null
    ambiguous: ReadonlySet<string> = new Set()
    unheld: readonly string[] = []
    commitBuildTotalMs = 0
    builds = 0
    private readonly ms: Record<SplitMsField, number> = {
        splitScopeMs: 0, splitSinkMs: 0, splitListMs: 0, splitFrontMs: 0, splitModulesMs: 0, splitCarriedMs: 0,
        splitPreviousEntriesMs: 0, splitCarriedUnitsMs: 0, splitFinishTreeMs: 0, splitPlanTailMs: 0,
        splitModuleReadMs: 0, splitModuleListsMs: 0,
        splitFinishShardsMs: 0, splitFinishFixedMs: 0, splitFinishConfigMs: 0, splitFinishManifestMs: 0,
    }
    private readonly sections: Record<SplitPutSection, SplitSectionRecord> = {
        front: { puts: 0, unitEncodeMs: 0, unitDigestMs: 0 },
        modules: { puts: 0, unitEncodeMs: 0, unitDigestMs: 0 },
        characters: { puts: 0, unitEncodeMs: 0, unitDigestMs: 0 },
        finish: { puts: 0, unitEncodeMs: 0, unitDigestMs: 0 },
    }
    private moduleCount = 0
    private readonly characters: SplitCharacterRecord[] = []
    private charactersCount = 0
    private charactersMs = 0

    constructor(seq: number, at: number, readonly retry: boolean) {
        this.seq = seq
        this.at = at
    }

    now(): number {
        try {
            return (splitClock ?? (() => performance.now()))()
        } catch {
            return 0
        }
    }

    addMs(field: SplitMsField, ms: number): void {
        try {
            this.ms[field] += ms
        } catch {
            // A measurement failure never reaches the save.
        }
    }

    splitUnitCost(encodeMs: number, digestMs: number): void {
        try {
            if (this.section !== null) {
                const bucket = this.sections[this.section]
                bucket.puts++
                bucket.unitEncodeMs += encodeMs
                bucket.unitDigestMs += digestMs
            }
        } catch {
            // A measurement failure never reaches the save.
        }
    }

    splitModuleCount(): void {
        try {
            this.moduleCount++
        } catch {
            // A measurement failure never reaches the save.
        }
    }

    splitCharacter(chaId: string, normalizeMs: number, emitMs: number, skipped: boolean): void {
        try {
            this.charactersCount++
            this.charactersMs += normalizeMs + emitMs
            if (this.characters.length < CHARACTER_LIMIT) {
                this.characters.push({ chaId, ms: normalizeMs + emitMs, normalizeMs, emitMs, skipped })
            }
        } catch {
            // A measurement failure never reaches the save.
        }
    }

    splitAmbiguous(ambiguous: ReadonlySet<string>): void {
        try {
            this.ambiguous = new Set(ambiguous)
        } catch {
            // A measurement failure never reaches the save.
        }
    }

    noteUnheld(chaIds: readonly string[]): void {
        try {
            this.unheld = [...chaIds]
        } catch {
            // A measurement failure never reaches the save.
        }
    }

    commitBuildMs(ms: number): void {
        try {
            this.commitBuildTotalMs += ms
            this.builds++
        } catch {
            // A measurement failure never reaches the save.
        }
    }

    summary(): SavePassSplit {
        const put = { puts: 0, unitEncodeMs: 0, unitDigestMs: 0 }
        const sections = {} as Record<SplitPutSection, SplitSectionRecord>
        for (const name of PUT_SECTIONS) {
            sections[name] = { ...this.sections[name] }
            put.puts += this.sections[name].puts
            put.unitEncodeMs += this.sections[name].unitEncodeMs
            put.unitDigestMs += this.sections[name].unitDigestMs
        }
        const ms = this.ms
        return {
            scopeMs: ms.splitScopeMs,
            sinkMs: ms.splitSinkMs,
            listMs: ms.splitListMs,
            frontMs: ms.splitFrontMs,
            modulesMs: ms.splitModulesMs,
            moduleCount: this.moduleCount,
            module: this.sections.modules.puts === 0 ? null : {
                readMs: ms.splitModuleReadMs,
                listsMs: ms.splitModuleListsMs,
                unitEncodeMs: this.sections.modules.unitEncodeMs,
                unitDigestMs: this.sections.modules.unitDigestMs,
            },
            characters: this.characters.map(entry => ({ ...entry })),
            charactersCount: this.charactersCount,
            charactersMs: this.charactersMs,
            carriedMs: ms.splitCarriedMs,
            previousEntriesMs: ms.splitPreviousEntriesMs,
            carriedUnitsMs: ms.splitCarriedUnitsMs,
            finishTreeMs: ms.splitFinishTreeMs,
            finish: {
                shardsMs: ms.splitFinishShardsMs,
                fixedMs: ms.splitFinishFixedMs,
                configMs: ms.splitFinishConfigMs,
                manifestMs: ms.splitFinishManifestMs,
            },
            planTailMs: ms.splitPlanTailMs,
            unitEncodeMs: put.unitEncodeMs,
            unitDigestMs: put.unitDigestMs,
            puts: put.puts,
            sections,
            syncMs: ms.splitScopeMs + ms.splitSinkMs + ms.splitListMs + ms.splitFrontMs + ms.splitModulesMs + this.charactersMs
                + ms.splitCarriedMs + ms.splitCarriedUnitsMs + ms.splitFinishTreeMs + ms.splitPlanTailMs,
        }
    }
}

/**
 * A copy of the live tracker's marks for the net-found counter. It only reads: it assigns, trims, takes and merges
 * nothing, so the marks reach the next real snapshot exactly as they would without it. The entry at index 0 is the
 * sticky front that a snapshot leaves behind and is reported apart from the later marks. It lives here, not in the
 * save loop, so a normal build drops it with this module.
 */
export function peekSaveMarks(port: { tracker: toSaveType, isDirty(): boolean }): SaveMarkPeek {
    const { tracker } = port
    return {
        front: tracker.character.length > 0 ? tracker.character[0] : null,
        frontChat: tracker.chat.length > 0 ? tracker.chat[0][0] : null,
        character: new Set([...tracker.character.slice(1), ...tracker.chat.slice(1).map(([chaId]) => chaId)]),
        flags: {
            botPreset: tracker.botPreset,
            modules: tracker.modules,
            loadouts: tracker.loadouts,
            plugins: tracker.plugins,
            pluginCustomStorage: tracker.pluginCustomStorage,
        },
        dirty: port.isDirty(),
    }
}

function peekOf(request: SavePassSplitShape): SaveMarkPeek | null {
    try {
        return request.peekMarks?.() ?? null
    } catch {
        return null
    }
}

function switchedOn(): boolean {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(SWITCH_KEY) === 'on'
    } catch {
        return false
    }
}

function installGlobal(target: object): void {
    ;(target as { __risuSavePassMeter?: SavePassMeterHandle }).__risuSavePassMeter = handle
}

function pushLimited<T>(ring: T[], record: T, limit: number = RECORD_LIMIT): void {
    ring.push(record)
    if (ring.length > limit) {
        ring.shift()
    }
}

/** The kind of a pass: a save-mine pass is `rewriteAll`, then a whole-resident pass, then an idle-net tick, else an edit. */
export function savePassKindOf(request: SavePassShape): SavePassKind {
    if (request.rewriteAll === true) {
        return 'rewriteAll'
    }
    if (request.whole) {
        return 'whole'
    }
    return request.net !== undefined ? 'tick' : 'edit'
}

/** The clock reading to hand to `finishSavePass`, or null when the meter is off or failed. Installs the global when on. */
export function startSavePass(target: object = globalThis): number | null {
    try {
        if (!switchedOn()) {
            return null
        }
        installGlobal(target)
        return performance.now()
    } catch {
        return null
    }
}

/**
 * The recorder of one planning pass, or null when the meter is off or failed. Takes `seq` and `at`, and the marks at the
 * pass start (read, never written, through the request's `peekMarks`).
 */
export function startSplit(request: SavePassSplitShape, target: object = globalThis): SavePassSplitRecorder | null {
    try {
        if (!switchedOn()) {
            return null
        }
        installGlobal(target)
        passSeq++
        const split = new SplitState(passSeq, performance.now(), request.retry === true)
        split.marksAtStart = peekOf(request)
        return split
    } catch {
        return null
    }
}

export function finishSavePass(
    started: number | null, request: SavePassShape, modules: boolean, characters: number, split: SavePassSplitRecorder | null = null,
): void {
    try {
        if (started === null) {
            return
        }
        const record: SavePassRecord = { kind: savePassKindOf(request), modules, characters, ms: performance.now() - started }
        if (record.kind === 'tick') {
            netFoundNow().ticks++
        }
        if (split instanceof SplitState) {
            record.seq = split.seq
            record.at = split.at
            record.retry = split.retry
            record.crossOriginIsolated = (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated ?? null
            record.split = split.summary()
        }
        pushLimited(passes, record)
        console.log('risu-measure-savepass', record)
    } catch {
        // A measurement failure never reaches the save.
    }
}

const ENTITY_ID_PREFIXES: readonly string[] = ['char:', 'chat:']
const FIXED_GROUP_BY_PREFIX: readonly (readonly [string, FixedGroup])[] = [
    ['preset:', 'botPreset'], ['plugin:', 'plugins'], ['psv:', 'pluginCustomStorage'], ['bucket:', 'pluginCustomStorage'],
    ['al:config', 'configLists'], ['il:config', 'configLists'],
]
const FIXED_GROUP_BY_IDENTITY: Readonly<Record<string, FixedGroup>> = { loadouts: 'loadouts', config: 'none', statics: 'none', order: 'none' }

/** What one written unit belongs to: a character's entity id, a module's handle, a fixed group, a shard, or unknown. */
type UnitOwner =
    | { kind: 'character', u: string }
    | { kind: 'module', handle: string | null }
    | { kind: 'shard' }
    | { kind: 'fixed', group: FixedGroup }
    | { kind: 'other' }

function ownerOfIdentity(identity: string): UnitOwner {
    for (const prefix of ENTITY_ID_PREFIXES) {
        if (identity.startsWith(prefix)) {
            return { kind: 'character', u: identity.slice(prefix.length).split(':')[0] }
        }
    }
    if (identity.startsWith('al:char:') || identity.startsWith('il:char:')) {
        return { kind: 'character', u: identity.slice('al:char:'.length) }
    }
    if (identity === 'moduleIndex') {
        return { kind: 'module', handle: null }
    }
    if (identity.startsWith('module:')) {
        return { kind: 'module', handle: identity.slice('module:'.length) }
    }
    if (identity.startsWith('al:module:') || identity.startsWith('il:module:')) {
        return { kind: 'module', handle: identity.slice('al:module:'.length) }
    }
    if (identity.startsWith('shard:')) {
        return { kind: 'shard' }
    }
    for (const [prefix, group] of FIXED_GROUP_BY_PREFIX) {
        if (identity.startsWith(prefix)) {
            return { kind: 'fixed', group }
        }
    }
    const group = Object.hasOwn(FIXED_GROUP_BY_IDENTITY, identity) ? FIXED_GROUP_BY_IDENTITY[identity] : undefined
    return group === undefined ? { kind: 'other' } : { kind: 'fixed', group }
}

function flagGroupOf(group: FixedGroup): keyof SaveMarkPeek['flags'] | null {
    return group === 'configLists' || group === 'none' ? null : group
}

function flagMark(flag: keyof SaveMarkPeek['flags'] | null, start: SaveMarkPeek | null, ack: SaveMarkPeek | null): FindMark {
    if (start === null || ack === null) {
        return 'unknown'
    }
    if (flag === null) {
        return 'unmarked'
    }
    return start.flags[flag] ? 'marked' : ack.flags[flag] ? 'markedLater' : 'unmarked'
}

function characterMark(chaId: string, start: SaveMarkPeek | null, ack: SaveMarkPeek | null): { mark: FindMark, frontChanged: boolean } {
    if (start === null || ack === null) {
        return { mark: 'unknown', frontChanged: false }
    }
    const frontChanged = start.front !== ack.front || start.frontChat !== ack.frontChat
    if (start.character.has(chaId)) {
        return { mark: 'marked', frontChanged }
    }
    if (chaId === start.front || chaId === start.frontChat) {
        return { mark: 'front', frontChanged }
    }
    if (ack.character.has(chaId) || chaId === ack.front || chaId === ack.frontChat) {
        return { mark: 'markedLater', frontChanged }
    }
    return { mark: 'unmarked', frontChanged }
}

function reasonsOf(chaId: string, request: SavePassSplitShape, split: SplitState): FindReason[] {
    const reasons: FindReason[] = []
    if (request.marked?.has(chaId) === true) {
        reasons.push('marked')
    }
    if (split.unheld.includes(chaId)) {
        reasons.push('unheld')
    }
    if (split.ambiguous.has(chaId)) {
        reasons.push('ambiguous')
    }
    if (request.net?.chaId === chaId) {
        reasons.push('net')
    }
    return reasons
}

function bumpMark(counts: MarkCounts, mark: FindMark, frontChanged: boolean): void {
    counts[mark]++
    if (frontChanged) {
        counts.frontChanged++
    }
}

/** Groups the written units of a tick into finds and counts them. Reads the tracker again for the marks at acknowledge. */
function recordFinds(
    request: SavePassSplitShape, written: readonly SavePassUnitRecord[], extra: SavePassCommitExtra, split: SplitState,
): { found: SavePassFind[], unitCounts: SavePassUnitCounts } {
    const start = split.marksAtStart
    const ack = peekOf(request)
    const chaIdOfU = new Map<string, string>()
    for (const [handleName, u] of extra.entities) {
        chaIdOfU.set(u, handleName.slice(0, handleName.lastIndexOf('#')))
    }
    const unitCounts = emptyUnitCounts()
    const characters = new Map<string, number>()
    const modules = new Map<string, number>()
    const groups = new Map<FixedGroup, number>()
    for (const unit of written) {
        if (unit.identity === 'manifest') {
            continue
        }
        const owner = ownerOfIdentity(unit.identity)
        switch (owner.kind) {
            case 'character':
                unitCounts.character++
                characters.set(owner.u, (characters.get(owner.u) ?? 0) + 1)
                break
            case 'module':
                // The module index is a unit of the module kind with no entity of its own.
                unitCounts.module++
                if (owner.handle !== null) {
                    modules.set(owner.handle, (modules.get(owner.handle) ?? 0) + 1)
                }
                break
            case 'shard':
                unitCounts.shard++
                break
            case 'fixed':
                unitCounts.fixed++
                groups.set(owner.group, (groups.get(owner.group) ?? 0) + 1)
                break
            default:
                unitCounts.other++
        }
    }
    const found: SavePassFind[] = []
    for (const [u, count] of characters) {
        const chaId = chaIdOfU.get(u) ?? u
        const { mark, frontChanged } = characterMark(chaId, start, ack)
        const reasons = reasonsOf(chaId, request, split)
        const reason: FindSummaryReason = reasons[0] ?? 'unattributed'
        bumpMark(netFoundNow().character[reason], mark, frontChanged)
        found.push({ kind: 'character', entity: chaId, mark, reasons, reason, frontChanged, units: count })
        noteRecent(split, { kind: 'character', entity: chaId, mark, reason, frontChanged })
    }
    for (const [handleName, count] of modules) {
        const mark = flagMark('modules', start, ack)
        bumpMark(netFoundNow().module, mark, false)
        found.push({ kind: 'module', entity: handleName, mark, units: count })
        noteRecent(split, { kind: 'module', entity: handleName, mark })
    }
    for (const [group, count] of groups) {
        const mark = flagMark(flagGroupOf(group), start, ack)
        const counts = netFoundNow().fixed[group] ?? emptyMarkCounts()
        netFoundNow().fixed[group] = counts
        bumpMark(counts, mark, false)
        found.push({ kind: 'fixed', entity: group, mark, units: count })
        noteRecent(split, { kind: 'fixed', entity: group, mark })
    }
    netFoundNow().units.character += unitCounts.character
    netFoundNow().units.module += unitCounts.module
    netFoundNow().units.shard += unitCounts.shard
    netFoundNow().units.fixed += unitCounts.fixed
    netFoundNow().units.other += unitCounts.other
    return { found, unitCounts }
}

function noteRecent(split: SplitState, entry: Omit<NetFoundRecent, 'seq' | 'at'>): void {
    if (entry.mark === 'marked') {
        return
    }
    pushLimited(netFoundNow().recent, { seq: split.seq, at: split.at, ...entry }, RECENT_LIMIT)
}

/**
 * At acknowledge: the identity and key of every unit of the committed tree that was written. With the split's
 * `extra` it also records `seq`, the acknowledge and build times, and for a tick the net-found grouping.
 */
export function noteSavePassCommit(request: SavePassShape, units: readonly MeteredUnit[], extra: SavePassCommitExtra | null = null): void {
    try {
        if (!switchedOn()) {
            return
        }
        const written: SavePassUnitRecord[] = []
        for (const unit of units) {
            if (unit.reused === false) {
                written.push({ identity: unit.identity, key: unit.key, type: unit.type, bytes: unit.bytes.length })
            }
        }
        const record: SavePassCommitRecord = { kind: savePassKindOf(request), units: written }
        if (extra !== null && extra.split instanceof SplitState) {
            const split = extra.split
            record.seq = split.seq
            record.acknowledgeMs = extra.acknowledgeMs
            record.commitBuildMs = split.commitBuildTotalMs
            record.builds = split.builds
            if (record.kind === 'tick') {
                netFoundNow().ticksCommitted++
                try {
                    const finds = recordFinds(request, written, extra, split)
                    record.found = finds.found
                    record.unitCounts = finds.unitCounts
                } catch {
                    // The grouping failed; the commit record without it still stands.
                }
            }
        }
        pushLimited(commits, record)
    } catch {
        // A measurement failure never reaches the save.
    }
}
