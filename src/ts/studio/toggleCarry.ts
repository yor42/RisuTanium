// The carry planner: from two texts of one toggle definition, which stored toggle values still belong to which keys.
// Pure and string-only. Stored values are addressed by key (`toggle_` + key), so identity is decided over keys, never
// over line ids, and the plan depends on the two texts alone: a reload recomputes the same items.
import type { Definition, DefLine, ValueKind } from './toggleDef'

export type ValueClass = 'check' | 'select' | 'text'
export type AmbiguityReason = 'manyCandidates' | 'unmatched' | 'duplicateKey' | 'options'
/** Every item names the OLD (baseline) key. */
export type CarryItem =
    | { readonly kind: 'rename', readonly from: string, readonly to: string }
    | { readonly kind: 'optionRemap', readonly key: string, readonly remap: readonly number[], readonly removed: readonly number[] }
    | { readonly kind: 'kindChange', readonly key: string, readonly from: ValueClass, readonly to: ValueClass }
    | { readonly kind: 'drop', readonly key: string, readonly to: 'divider' | 'caption' }
    | { readonly kind: 'ambiguous', readonly key: string, readonly reason: AmbiguityReason }

type Row = { readonly key: string, readonly label: string, readonly cls: ValueClass, readonly options: readonly string[], readonly index: number }

const classOf = (kind: ValueKind): ValueClass => (kind === 'textarea' ? 'text' : kind)

const withoutCr = (text: string): string => (text.endsWith('\r') ? text.slice(0, -1) : text)

function optionsOf(line: DefLine): readonly string[] {
    const part = line.parts[3]
    if (part === undefined) {
        return []
    }
    const options = part.split(',')
    options[options.length - 1] = withoutCr(options[options.length - 1])
    return options
}

function rowsOf(def: Definition): readonly Row[] {
    const rows: Row[] = []
    def.lines.forEach((line, index) => {
        if (line.form.kind !== 'value') {
            return
        }
        const cls = classOf(line.form.valueKind)
        rows.push({ key: line.parts[0], label: withoutCr(line.parts[1]), cls, options: cls === 'select' ? optionsOf(line) : [], index })
    })
    return rows
}

function groupByKey(rows: readonly Row[]): Map<string, Row[]> {
    const byKey = new Map<string, Row[]>()
    for (const row of rows) {
        const list = byKey.get(row.key)
        if (list) {
            list.push(row)
        } else {
            byKey.set(row.key, [row])
        }
    }
    return byKey
}

const signatureOf = (row: Row): string => JSON.stringify([row.label, row.cls])
const readingOf = (row: Row): string => (row.cls === 'select' ? JSON.stringify([row.cls, row.options]) : row.cls)

function distinctReadings(rows: readonly Row[]): Map<string, Row> {
    const readings = new Map<string, Row>()
    for (const row of rows) {
        const reading = readingOf(row)
        if (!readings.has(reading)) {
            readings.set(reading, row)
        }
    }
    return readings
}

function linesWithText(def: Definition, kind: 'divider' | 'caption'): Map<string, number> {
    const counts = new Map<string, number>()
    for (const line of def.lines) {
        if (line.form.kind === kind) {
            const text = withoutCr(line.parts[1])
            counts.set(text, (counts.get(text) ?? 0) + 1)
        }
    }
    return counts
}

function hasDuplicates(values: readonly string[]): boolean {
    return new Set(values).size !== values.length
}

type OptionOutcome = 'nothing' | 'ambiguous' | { readonly remap: readonly number[], readonly removed: readonly number[] }

/** Option identity is the option string; a permutation of distinct strings is a remap, anything else unclear asks. */
function optionOutcome(b: readonly string[], c: readonly string[]): OptionOutcome {
    if (c.length === 0) {
        return 'ambiguous'
    }
    if (b.length <= c.length && b.every((option, index) => option === c[index])) {
        return 'nothing'
    }
    if (b.length === c.length) {
        const differing = b.flatMap((option, index) => (option === c[index] ? [] : [index]))
        if (differing.length === 1 && !c.includes(b[differing[0]])) {
            return 'nothing'
        }
    }
    if (hasDuplicates(b) || b.some((option) => c.filter((candidate) => candidate === option).length > 1)) {
        return 'ambiguous'
    }
    const remap: number[] = []
    const removed: number[] = []
    b.forEach((option, index) => {
        const target = c.indexOf(option)
        if (target === -1) {
            removed.push(index)
            remap.push(0)
        } else {
            remap.push(target)
        }
    })
    if (removed.length > 0 && c.some((option) => !b.includes(option))) {
        return 'ambiguous'
    }
    if (removed.length === 0 && remap.every((target, index) => target === index)) {
        return 'nothing'
    }
    return { remap, removed }
}

/** The items of one flow: baseline key `source` continues as current key `target` (the same key for a kept key). */
function flowItems(source: string, target: string, baseRows: readonly Row[], currentRows: readonly Row[]): readonly CarryItem[] {
    const rename: readonly CarryItem[] = source === target ? [] : [{ kind: 'rename', from: source, to: target }]
    const baseReadings = distinctReadings(baseRows)
    const currentReadings = distinctReadings(currentRows)
    if ([...currentReadings.keys()].every((reading) => baseReadings.has(reading))) {
        return rename
    }
    if (baseReadings.size !== 1 || currentReadings.size !== 1) {
        return [{ kind: 'ambiguous', key: source, reason: 'duplicateKey' }]
    }
    const before = baseRows[0]
    const after = currentRows[0]
    if (before.cls !== after.cls) {
        return [...rename, { kind: 'kindChange', key: source, from: before.cls, to: after.cls }]
    }
    const outcome = optionOutcome(before.options, after.options)
    if (outcome === 'ambiguous') {
        return [{ kind: 'ambiguous', key: source, reason: 'options' }]
    }
    if (outcome === 'nothing') {
        return rename
    }
    return [...rename, { kind: 'optionRemap', key: source, remap: outcome.remap, removed: outcome.removed }]
}

/**
 * What a change of one definition does to the stored values of its toggles. A key kept in both texts continues as
 * itself; a removed key continues as an added key only when one removed and one added row share label and class and
 * both keys are read by a single row; every other unclear case is `ambiguous`, which carries nothing. Output is ordered
 * by the baseline position of each old key's first row. Keys in `added` were created by the list in this window: they are
 * never a rename target and never an unmatched addition. An entry that is not an added key of `current` is inert, and an
 * empty set gives the two-argument plan.
 */
export function planCarry(baseline: Definition, current: Definition, added?: ReadonlySet<string>): readonly CarryItem[] {
    const baseRows = rowsOf(baseline)
    const currentRows = rowsOf(current)
    const baseByKey = groupByKey(baseRows)
    const currentByKey = groupByKey(currentRows)
    const removedKeys = new Set([...baseByKey.keys()].filter((key) => !currentByKey.has(key)))
    const addedKeys = new Set([...currentByKey.keys()].filter((key) => !baseByKey.has(key) && !(added?.has(key) ?? false)))

    const removedBySignature = new Map<string, Row[]>()
    for (const row of baseRows.filter((candidate) => removedKeys.has(candidate.key))) {
        removedBySignature.set(signatureOf(row), [...(removedBySignature.get(signatureOf(row)) ?? []), row])
    }
    const addedBySignature = new Map<string, Row[]>()
    for (const row of currentRows.filter((candidate) => addedKeys.has(candidate.key))) {
        addedBySignature.set(signatureOf(row), [...(addedBySignature.get(signatureOf(row)) ?? []), row])
    }

    const renames = new Map<string, string>()
    for (const [signature, removedRows] of removedBySignature) {
        const addedRows = addedBySignature.get(signature) ?? []
        if (removedRows.length === 1 && addedRows.length === 1
            && baseByKey.get(removedRows[0].key)?.length === 1 && currentByKey.get(addedRows[0].key)?.length === 1) {
            renames.set(removedRows[0].key, addedRows[0].key)
        }
    }
    const pairedTargets = new Set(renames.values())
    const unpairedAdded = [...addedKeys].filter((key) => !pairedTargets.has(key))
    const dividersBase = linesWithText(baseline, 'divider')
    const dividersCurrent = linesWithText(current, 'divider')
    const captionsBase = linesWithText(baseline, 'caption')
    const captionsCurrent = linesWithText(current, 'caption')
    const grew = (before: Map<string, number>, after: Map<string, number>, label: string): boolean =>
        (after.get(label) ?? 0) > (before.get(label) ?? 0)

    const entries: { readonly index: number, readonly items: readonly CarryItem[] }[] = []
    for (const [key, rows] of baseByKey) {
        const index = rows[0].index
        const target = currentByKey.has(key) ? key : renames.get(key)
        if (target !== undefined) {
            const items = flowItems(key, target, rows, currentByKey.get(target) ?? [])
            if (items.length > 0) {
                entries.push({ index, items })
            }
            continue
        }
        const labels = [...new Set(rows.map((row) => row.label))]
        if (rows.some((row) => (addedBySignature.get(signatureOf(row))?.length ?? 0) > 0)) {
            entries.push({ index, items: [{ kind: 'ambiguous', key, reason: 'manyCandidates' }] })
        } else if (labels.some((label) => grew(dividersBase, dividersCurrent, label))) {
            entries.push({ index, items: [{ kind: 'drop', key, to: 'divider' }] })
        } else if (labels.some((label) => grew(captionsBase, captionsCurrent, label))) {
            entries.push({ index, items: [{ kind: 'drop', key, to: 'caption' }] })
        } else if (unpairedAdded.some((added) => (currentByKey.get(added) ?? []).some((row) => rows.some((own) => own.cls === row.cls)))) {
            entries.push({ index, items: [{ kind: 'ambiguous', key, reason: 'unmatched' }] })
        }
    }
    return entries.sort((left, right) => left.index - right.index).flatMap((entry) => entry.items)
}

const oldKeyOf = (item: CarryItem): string => (item.kind === 'rename' ? item.from : item.key)

/** The items that touch one of the keys the open visit started with: the interim write guard and the ask filter. */
export function detachingItems(items: readonly CarryItem[], visitKeys: ReadonlySet<string>): readonly CarryItem[] {
    return items.filter((item) => visitKeys.has(oldKeyOf(item)))
}

/** The exact keys the engine reads (`toggle_` + key) from the value rows of one definition. */
export function valueKeysOf(def: Definition): ReadonlySet<string> {
    return new Set(rowsOf(def).map((row) => row.key))
}

/** The keys the list created: a key is in the set only while every current row with that key has `new` origin. */
export function addedFromRows(rows: readonly { readonly key: string, readonly origin: 'base' | 'new' }[]): ReadonlySet<string> {
    const keys = new Set(rows.map((row) => row.key))
    return new Set([...keys].filter((key) => rows.every((row) => row.key !== key || row.origin === 'new')))
}

/**
 * The baseline keys whose readings (class, and the ordered options of a select) in the baseline differ, as a set, from
 * those in `t0`, the text this builder instance started the window with. A key absent from `t0` has no readings, so it
 * is dirty. Labels are not readings.
 */
export function windowDirty(baseline: Definition, t0: Definition): ReadonlySet<string> {
    const baseByKey = groupByKey(rowsOf(baseline))
    const t0ByKey = groupByKey(rowsOf(t0))
    const dirty = new Set<string>()
    for (const [key, rows] of baseByKey) {
        const before = new Set(distinctReadings(rows).keys())
        const after = new Set(distinctReadings(t0ByKey.get(key) ?? []).keys())
        if (before.size !== after.size || [...before].some((reading) => !after.has(reading))) {
            dirty.add(key)
        }
    }
    return dirty
}

/**
 * The old keys whose stored values cannot be renumbered safely: they have an option renumbering in the plan and part of
 * their change since the baseline predates this window. Pure; nothing about lateness is stored.
 */
export function lateOldKeys(baseline: Definition, t0: Definition, current: Definition, added?: ReadonlySet<string>): ReadonlySet<string> {
    const dirty = windowDirty(baseline, t0)
    const late = new Set<string>()
    for (const item of planCarry(baseline, current, added)) {
        if (item.kind === 'optionRemap' && dirty.has(item.key)) {
            late.add(item.key)
        }
    }
    return late
}
