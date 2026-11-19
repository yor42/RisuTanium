// The carry applier: which stored toggle values move when a definition's keys change, and the all-or-nothing write of
// them over a port. The planner is pure; the port owns where values live (the global value and each chat's own entries).
// Stored values are addressed by `toggle_` + key. Nothing here touches History, the owner text or a saved loadout.
import { recordCaughtError } from '../caughtErrors'
import type { CarryItem } from './toggleCarry'
import { keysOfText } from './toggleKeys'

// The engine's stored-value name for a toggle key (togglePanel's `toggleVarKey`, which this pure module cannot import
// without loading the app graph); edit/tests/toggleCarryDb.svelte.test.ts holds the two equal.
const toggleVarKey = (key: string): string => `toggle_${key}`

export type PlaceRef =
    | { readonly kind: 'global' }
    | { readonly kind: 'chat', readonly chaId: string, readonly chatId: string }
export type PlaceEntries = { readonly ref: PlaceRef, readonly entries: Readonly<Record<string, string>> | undefined }
/** Another readable source of toggle definitions: its own text is parsed alone, never joined with another. */
export type OtherSource = { readonly id: string, readonly name: string, readonly text: string }
export type CarryReach = { readonly places: readonly PlaceEntries[], readonly others: readonly OtherSource[] }
export type CarryWrite = { readonly ref: PlaceRef, readonly varKey: string, readonly before: string | undefined, readonly after: string }
export type CarryNotice = {
    /** Toggle keys whose target already holds a different value at some place; the carry replaces it. */
    readonly overwrite: readonly string[]
    /** Written toggle keys that another source also defines, with the names of those sources. */
    readonly shared: readonly { readonly key: string, readonly sources: readonly string[] }[]
}
export type CarryPlanned = {
    readonly writes: readonly CarryWrite[]
    /** One entry per rename: the favourites star on `from` follows the key. */
    readonly star: readonly { readonly from: string, readonly to: string }[]
    readonly notice: CarryNotice
    /** The canonical text of the items and the notice: what the shown question was about. */
    readonly signature: string
}
export type CarryJournal = { readonly writes: readonly CarryWrite[] }

export interface CarryValuePort {
    /** The stored value, undefined when absent, or 'gone' when the place no longer exists or is not eligible. */
    read(ref: PlaceRef, varKey: string): string | undefined | 'gone'
    /** Undefined deletes (rollback and undo only). Throws when the place no longer exists or is not eligible. */
    write(ref: PlaceRef, varKey: string, value: string | undefined): void
    mark(refs: readonly PlaceRef[]): void
}

const INDEX_PATTERN = /^(0|[1-9][0-9]*)$/

/**
 * Whether a stored select value is an in-range option index: canonical decimal digits below the option count. Both
 * writers store `String(i)` and CBS compares strings, so anything else (`' 1'`, `'1.0'`, `'01'`, `''`) is never
 * rewritten.
 */
export function isIndexValue(value: string, length: number): boolean {
    return INDEX_PATTERN.test(value) && Number(value) < length
}

export function remapValue(value: string, remap: readonly number[], length: number): string {
    return isIndexValue(value, length) ? String(remap[Number(value)]) : value
}

const refKeyOf = (ref: PlaceRef): string => (ref.kind === 'global' ? 'global' : `chat:${ref.chaId}\u0000${ref.chatId}`)

type Flow = { readonly from: string, to: string, remap: readonly number[] | undefined }

function flowsOf(items: readonly CarryItem[]): readonly Flow[] {
    const flows = new Map<string, Flow>()
    const flowOf = (key: string): Flow => {
        let flow = flows.get(key)
        if (!flow) {
            flow = { from: key, to: key, remap: undefined }
            flows.set(key, flow)
        }
        return flow
    }
    for (const item of items) {
        if (item.kind === 'rename') {
            flowOf(item.from).to = item.to
        } else if (item.kind === 'optionRemap') {
            flowOf(item.key).remap = item.remap
        }
    }
    return [...flows.values()]
}

/**
 * The writes one carry makes. Only `rename` and `optionRemap` carry; every other item writes nothing. For each place
 * that holds a value under the old key, the value (renumbered first when its options were reordered) is written under
 * the new key and the old key stays as it is. An absent value moves nothing, an equal target is not written, and a
 * different target is replaced and named in `notice.overwrite`.
 */
export function planCarryWrites(items: readonly CarryItem[], reach: CarryReach): CarryPlanned {
    const flows = flowsOf(items)
    const writes: CarryWrite[] = []
    const overwrite = new Set<string>()
    const writtenKeys = new Set<string>()
    for (const place of reach.places) {
        for (const flow of flows) {
            const old = place.entries?.[toggleVarKey(flow.from)]
            if (old === undefined) {
                continue
            }
            const next = flow.remap ? remapValue(old, flow.remap, flow.remap.length) : old
            if (flow.to === flow.from) {
                if (next !== old) {
                    writes.push({ ref: place.ref, varKey: toggleVarKey(flow.from), before: old, after: next })
                    writtenKeys.add(flow.from)
                }
                continue
            }
            const target = place.entries?.[toggleVarKey(flow.to)]
            if (target === next) {
                continue
            }
            if (target !== undefined) {
                overwrite.add(flow.to)
            }
            writes.push({ ref: place.ref, varKey: toggleVarKey(flow.to), before: target, after: next })
            writtenKeys.add(flow.to)
        }
    }
    const otherKeys = reach.others.map((other) => ({ name: other.name, keys: keysOfText(other.text) }))
    const shared = [...writtenKeys].flatMap((key) => {
        const sources = otherKeys.filter((other) => other.keys.has(key)).map((other) => other.name)
        return sources.length > 0 ? [{ key, sources }] : []
    })
    const notice: CarryNotice = { overwrite: [...overwrite], shared }
    return {
        writes,
        star: flows.filter((flow) => flow.to !== flow.from).map((flow) => ({ from: flow.from, to: flow.to })),
        notice,
        signature: JSON.stringify({ items, notice }),
    }
}

function touchedOf(writes: readonly { readonly ref: PlaceRef }[]): readonly PlaceRef[] {
    const refs = new Map<string, PlaceRef>()
    for (const write of writes) {
        refs.set(refKeyOf(write.ref), write.ref)
    }
    return [...refs.values()]
}

type Put = { readonly ref: PlaceRef, readonly varKey: string, readonly value: string | undefined }

/** Writes the entries back, last first, then marks their places. Every failure is recorded and the rest still runs. */
function putBack(entries: readonly Put[], port: CarryValuePort, site: string): void {
    for (let index = entries.length - 1; index >= 0; index--) {
        try {
            port.write(entries[index].ref, entries[index].varKey, entries[index].value)
        } catch (error) {
            recordCaughtError(site, error)
        }
    }
    try {
        port.mark(touchedOf(entries))
    } catch (error) {
        recordCaughtError(site, error)
    }
}

/**
 * Writes the plan in one synchronous task. A signature that differs from the one the user was shown is `stale` with
 * nothing written. A throw anywhere (a write or the mark) puts the earlier writes back, marks them, and is `failed`.
 */
export function applyCarry(
    planned: CarryPlanned,
    shownSignature: string,
    port: CarryValuePort,
): { readonly ok: true, readonly journal: CarryJournal } | { readonly ok: false, readonly reason: 'stale' | 'failed' } {
    if (planned.signature !== shownSignature) {
        return { ok: false, reason: 'stale' }
    }
    const done: CarryWrite[] = []
    try {
        for (const write of planned.writes) {
            port.write(write.ref, write.varKey, write.after)
            done.push(write)
        }
        port.mark(touchedOf(planned.writes))
    } catch (error) {
        recordCaughtError('studio.toggleCarry.apply', error)
        putBack(done.map((write) => ({ ref: write.ref, varKey: write.varKey, value: write.before })), port, 'studio.toggleCarry.rollback')
        return { ok: false, reason: 'failed' }
    }
    return { ok: true, journal: { writes: planned.writes } }
}

/**
 * Restores every `before`, all or nothing: each place must still resolve and still read the value this carry wrote,
 * otherwise nothing is written and the result is `changed`.
 */
export function undoCarry(journal: CarryJournal, port: CarryValuePort): { readonly ok: true } | { readonly ok: false, readonly reason: 'changed' } {
    for (const write of journal.writes) {
        if (port.read(write.ref, write.varKey) !== write.after) {
            return { ok: false, reason: 'changed' }
        }
    }
    const restored: CarryWrite[] = []
    try {
        for (let index = journal.writes.length - 1; index >= 0; index--) {
            const write = journal.writes[index]
            port.write(write.ref, write.varKey, write.before)
            restored.push(write)
        }
        port.mark(touchedOf(journal.writes))
    } catch (error) {
        recordCaughtError('studio.toggleCarry.undo', error)
        putBack(restored.map((write) => ({ ref: write.ref, varKey: write.varKey, value: write.after })), port, 'studio.toggleCarry.undoRollback')
        return { ok: false, reason: 'changed' }
    }
    return { ok: true }
}
