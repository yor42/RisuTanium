import type { toSaveType } from '../risuSave'
import type { UnitType } from './format'
import type { SplitMsField, SplitPutSection, SplitRecorder } from './codec/types'

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
    reset(): void
}

/** What one idle-net slot ended in; every slot has exactly one. */
export type NetSlotReason =
    | 'modulesDue' | 'consent' | 'readFailed' | 'parked' | 'dueAfterRead' | 'pending' | 'unheld' | 'stub' | 'unsavableAbsent'
    | 'verdictClean' | 'verdictDirty' | 'verdictUnknown' | 'slotMissing' | 'guardThrow' | 'noResident'

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
export type NetSlotPart = 'lockWaitMs' | 'readMs' | 'judgeMs' | 'checksMs' | 'unheldMs' | 'stubsMs' | 'unsavableMs' | 'residentsMs' | 'findMs' | 'verdictMs' | 'primitiveMs' | 'movedMs'

/**
 * Where one slot's `decisionMs` went. `lockWaitMs` is the wait for the write lock and `readMs` the `readCommit` inside
 * it (recorded also when the read throws). `judgeMs` is `judge`. `checksMs` is everything between `judge` and the verdict:
 * `unheldChaIds`, `stubsNeedFullPass`, the unsavable and resident lookups; a check that throws leaves it null. Its
 * sub-parts are `unheldMs` (`unheldChaIds`), `stubsMs` (`stubsNeedFullPass`), `unsavableMs` (the unsavable-absent scan,
 * run only when something is unsavable), `residentsMs` (`residentChaIds`) and `findMs` (the final resident lookup);
 * each is null when the slot did not run it, and those it ran sum to `checksMs`. When a check throws, the sub-parts
 * finished before it are recorded while `checksMs` stays null.
 * `verdictMs` is `verdictOf` as a whole, split into `primitiveMs` (`characterMatchesAcknowledged`) and `movedMs` (the
 * moved-field compare, only after a `clean` primitive). `reason` is how the slot ended. The switch is read on every
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
    unheldMs: number | null
    stubsMs: number | null
    unsavableMs: number | null
    residentsMs: number | null
    findMs: number | null
    verdictMs: number | null
    primitiveMs: number | null
    movedMs: number | null
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
export interface MeteredUnit {
    identity: string
    key: string
    type: UnitType
    bytes: Uint8Array
    reused: boolean
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
    'verdictClean', 'verdictDirty', 'verdictUnknown', 'slotMissing', 'guardThrow', 'noResident',
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
        if (switchedOn()) {
            slotInFlight = {
                reason: null, decisionMs: 0, lockWaitMs: null, readMs: null, judgeMs: null, checksMs: null,
                unheldMs: null, stubsMs: null, unsavableMs: null, residentsMs: null, findMs: null,
                verdictMs: null, primitiveMs: null, movedMs: null,
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
        slotInFlight = null
        if (switchedOn()) {
            pushLimited(verdictsNow().decisionMs, ms)
            pushLimited(verdictsNow().slotTimings, { ...(timing ?? { reason: null, lockWaitMs: null, readMs: null, judgeMs: null, checksMs: null, unheldMs: null, stubsMs: null, unsavableMs: null, residentsMs: null, findMs: null, verdictMs: null, primitiveMs: null, movedMs: null }), decisionMs: ms })
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
    reset: () => {
        verdictStore = null
        slotInFlight = null
        passes.length = 0
        commits.length = 0
        netFoundStore = null
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
            if (!unit.reused) {
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
