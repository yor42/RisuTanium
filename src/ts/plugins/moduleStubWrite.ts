import type { RisuModule } from '../process/modules'
import { isModuleStub } from '../storage/moduleStub'
import { payloadIsStored } from '../storage/store2/codec'
import type { StoredPayloadPrint } from '../storage/store2/codec/payloadPrint'
import { keyOfRef, type ModuleEntry } from '../storage/store2/format'
import { slotIsRecordedStub } from '../storage/store2/moduleStubMatch'
import { getResidency } from '../storage/store2/residencyActive'
import type { Residency } from '../storage/store2/residency'
import { ASSET_RETAINED_KEY } from '../studio/assets/assetOwnerKeys'
import { pluginWriteYield } from './pluginWriteTurns'
import { isPlainObject, withRetainedOf } from './retainedCarry'

/**
 * What a plugin write may say about a module that is a stub in the live list.
 *
 * Retained paths: a stub holds no value, but a module read from its stored unit does, and `noteStoredRetained` records
 * that value against the unit it came from. While the module's entry still names that unit, the recorded value is the
 * live value of the stub, so a plugin write carries it as it carries the value of a resident module. A unit that has
 * moved, or a module this page never read, has no recorded value and carries nothing.
 *
 * Keeping the stub: a plugin that read a module and writes it back unchanged hands this write a full copy. When the live
 * slot is the recorded stub of the module and the copy is exactly what the stored unit and lists would be reused for, the
 * copy is replaced by the live stub, so nothing of the module is rewritten and it stays unloaded. The residency proves
 * "exactly what the stored unit would be reused for" from the payload print it recorded when the module was read.
 *
 * This module is shared by `plugins.svelte.ts` (the write) and `apiV3/moduleStubCopy.svelte.ts` (the read) and imports neither.
 */

export interface StoredRetained {
    unitKey: string
    present: boolean
    value: unknown
}

const records = new WeakMap<Residency, Map<string, StoredRetained>>()

/** Records the retained-paths field of the stored body `body` read for module `id` from the unit `entry` names. */
export function noteStoredRetained(residency: Residency, id: string, entry: ModuleEntry, body: object): void {
    const present = Object.hasOwn(body, ASSET_RETAINED_KEY)
    const held: StoredRetained = {
        unitKey: keyOfRef(entry.unit),
        present,
        value: present ? structuredClone(Reflect.get(body, ASSET_RETAINED_KEY)) : undefined,
    }
    let ids = records.get(residency)
    if (ids === undefined) {
        ids = new Map()
        records.set(residency, ids)
    }
    ids.set(id, held)
}

function idOf(module: unknown): string | undefined {
    if (typeof module !== 'object' || module === null || Array.isArray(module)) {
        return undefined
    }
    const id = Reflect.get(module, 'id')
    return typeof id === 'string' ? id : undefined
}

/** The record held for module `id`, only when it was taken from the unit `unitKey`; the one rule the carry and the proof select by. */
export function storedRetainedFor(residency: Residency, id: string, unitKey: string): StoredRetained | undefined {
    const held = records.get(residency)?.get(id)
    return held !== undefined && held.unitKey === unitKey ? held : undefined
}

/**
 * The object a plugin write carries the retained field from for the live stub `stub`: a fresh object holding a fresh copy
 * of the recorded value, or lacking the key when the stored body lacked it. Null when no value was recorded for the unit
 * the stub's module names now.
 */
export function retainedSourceOfStub(stub: object): object | null {
    const residency = getResidency()
    const id = idOf(stub)
    if (residency === null || id === undefined) {
        return null
    }
    const entry = residency.moduleEntryOf(`${id}#0`)
    const held = entry === null ? undefined : storedRetainedFor(residency, id, keyOfRef(entry.unit))
    if (held === undefined) {
        return null
    }
    const source: Record<string, unknown> = {}
    if (held.present) {
        source[ASSET_RETAINED_KEY] = structuredClone(held.value)
    }
    return source
}

/**
 * `module` as the write would carry it over a stub whose recorded value is `record`: the module itself when nothing is
 * recorded or it already holds the value, else a shallow copy holding the recorded value by reference. It is only
 * encoded for the proof, never installed, so the value is not cloned.
 */
function retainedViewOf(module: Record<string, unknown>, record: StoredRetained | undefined): Record<string, unknown> {
    if (record === undefined) {
        return module
    }
    const source: Record<string, unknown> = {}
    if (record.present) {
        source[ASSET_RETAINED_KEY] = record.value
    }
    return withRetainedOf(module, source) ?? module
}

function countIds(list: readonly unknown[]): Map<string, number> {
    const counts = new Map<string, number>()
    for (const module of list) {
        const id = idOf(module)
        if (id !== undefined) {
            counts.set(id, (counts.get(id) ?? 0) + 1)
        }
    }
    return counts
}

/** One incoming module a recorded live stub may stand in for. */
interface StubCandidate {
    module: Record<string, unknown>
    id: string
    holder: RisuModule
    liveIndex: number
}

/**
 * The incoming plain non-stub modules whose id is held once in each list and whose live holder is a stub. Empty when no
 * residency exists, when `incoming` is not an array or is the live array itself, or when no live slot is a stub.
 */
function stubCandidates(live: readonly RisuModule[] | undefined, incoming: unknown): StubCandidate[] {
    if (getResidency() === null || !Array.isArray(incoming) || incoming === live || live === undefined || !live.some(isModuleStub)) {
        return []
    }
    const list: readonly unknown[] = incoming
    const liveCounts = countIds(live)
    const incomingCounts = countIds(list)
    // The live slot of each id; only an id held once is looked up below, so the slot is that id's single holder.
    const holders = new Map<string, { slot: RisuModule, index: number }>()
    live.forEach((slot, index) => {
        const slotId = idOf(slot)
        if (slotId !== undefined) {
            holders.set(slotId, { slot, index })
        }
    })
    const found: StubCandidate[] = []
    for (const module of list) {
        const id = idOf(module)
        if (id === undefined || !isPlainObject(module) || isModuleStub(module) || liveCounts.get(id) !== 1 || incomingCounts.get(id) !== 1) {
            continue
        }
        const holder = holders.get(id)
        if (holder !== undefined && isModuleStub(holder.slot)) {
            found.push({ module, id, holder: holder.slot, liveIndex: holder.index })
        }
    }
    return found
}

/** Whether the proof has anything to prove for this write; the Lite fast path and the proof ask the same predicate. */
export function hasRecordedStubCandidate(live: readonly RisuModule[] | undefined, incoming: unknown): boolean {
    return stubCandidates(live, incoming).length > 0
}

/** What the proof established for one incoming module: the live stub it may replace and the print it was proved against. */
interface StubVerdict {
    stub: RisuModule
    liveIndex: number
    print: StoredPayloadPrint
}

/** The positive verdicts of one write, keyed by the incoming module object. They live for one write only. */
export interface StubVerdicts {
    residency: Residency | null
    byModule: Map<object, StubVerdict>
}

export function noStubVerdicts(): StubVerdicts {
    return { residency: null, byModule: new Map() }
}

/** How the proof is cut into slices: a slice ends after `maxPerSlice` proofs, or after the first proof ending `budgetMs` after it began. */
export interface ProofSchedule {
    now: () => number
    budgetMs: number
    maxPerSlice: number
}

const PROOF_SCHEDULE: ProofSchedule = { now: () => performance.now(), budgetMs: 12, maxPerSlice: 8 }

/**
 * Proves, in slices separated by message yields, which incoming modules are exactly the stored unit of the live stub they
 * replace, and returns the positive verdicts. No task carries more than one slice, and a module is never split. A module
 * the proof cannot establish gets no verdict. Nothing is installed here; `withRecordedStubs` accepts a verdict only while
 * the state it was proved against still holds.
 */
export async function proveRecordedStubCopies(live: readonly RisuModule[] | undefined, incoming: unknown, schedule: ProofSchedule = PROOF_SCHEDULE): Promise<StubVerdicts> {
    const candidates = stubCandidates(live, incoming)
    const residency = getResidency()
    if (residency === null || candidates.length === 0) {
        return noStubVerdicts()
    }
    const verdicts: StubVerdicts = { residency, byModule: new Map() }
    let inSlice = 0
    let sliceStart = 0
    for (const candidate of candidates) {
        if (inSlice === 0) {
            await pluginWriteYield()
            sliceStart = schedule.now()
        }
        inSlice += 1
        try {
            const print = residency.storedPrintOf(`${candidate.id}#0`)
            if (print !== null) {
                const view = retainedViewOf(candidate.module, storedRetainedFor(residency, candidate.id, print.unitKey))
                if (payloadIsStored(view, print)) {
                    verdicts.byModule.set(candidate.module, { stub: candidate.holder, liveIndex: candidate.liveIndex, print })
                }
            }
        } catch {
            // A module this cannot view gets no verdict and installs as written.
        }
        if (inSlice >= schedule.maxPerSlice || schedule.now() - sliceStart >= schedule.budgetMs) {
            inSlice = 0
        }
    }
    return verdicts
}

/** Whether the verdict `proved` still holds for the live slot `holder` of module `id`; never proves and never throws. */
function keepsStub(residency: Residency, id: string, live: readonly RisuModule[], holder: RisuModule, proved: StubVerdict): boolean {
    try {
        const handle = `${id}#0`
        const entry = residency.moduleEntryOf(handle)
        return entry !== null
            && holder === proved.stub && live[proved.liveIndex] === proved.stub
            && isModuleStub(holder) && slotIsRecordedStub(holder, entry)
            && residency.storedPrintOf(handle) === proved.print
    } catch {
        return false
    }
}

/**
 * The module list a plugin write installs, with each module that carries a verdict replaced by the live stub it was
 * proved against. A verdict applies only while its residency, its live stub and slot, its print record and the single
 * holding of its id in both lists still hold; anything else installs as written. The incoming value is returned as it is
 * when it is not an array, when it is the live array itself, when no verdict exists or when no residency matches;
 * otherwise a changed list is a new array and the plugin's own objects are never mutated. A resident slot is never
 * turned into a stub.
 */
export function withRecordedStubs<T>(live: readonly RisuModule[] | undefined, incoming: T, verdicts: StubVerdicts): T {
    if (!Array.isArray(incoming) || incoming === live || live === undefined || verdicts.byModule.size === 0) {
        return incoming
    }
    const residency = getResidency()
    if (residency === null || verdicts.residency !== residency) {
        return incoming
    }
    const list: readonly unknown[] = incoming
    const liveCounts = countIds(live)
    const incomingCounts = countIds(list)
    // The live slot of each id; only an id held once is looked up below, so the slot is that id's single holder.
    const holders = new Map<string, RisuModule>()
    for (const slot of live) {
        const slotId = idOf(slot)
        if (slotId !== undefined) {
            holders.set(slotId, slot)
        }
    }
    let changed: unknown[] | null = null
    list.forEach((module, index) => {
        const id = idOf(module)
        if (id === undefined || typeof module !== 'object' || module === null || isModuleStub(module) || liveCounts.get(id) !== 1 || incomingCounts.get(id) !== 1) {
            return
        }
        const proved = verdicts.byModule.get(module)
        const holder = holders.get(id)
        if (proved !== undefined && holder !== undefined && keepsStub(residency, id, live, holder, proved)) {
            changed ??= list.slice()
            changed[index] = holder
        }
    })
    return changed === null ? incoming : changed as T
}
