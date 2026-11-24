// Pure block rules for a trigger event's V2 effect list: which rows an opener owns, and how append, insert, edit,
// delete, copy, paste and move rewrite the list. Each rule reproduces what the classic editor writes, down to key
// order and to the arithmetic it runs on a stored indent. A rule returns a new array of new rows, or `null` when
// the classic editor would change nothing (or, for the Else toggle, would corrupt the list).
//
// A row that is not an object (`null`, a string, a number, a boolean) is a typeless row. It reads as a row with no
// type and no indent, counts as present, owns no block, and is never written to.
import type { triggerEffect, triggerEffectV2 } from '../../process/triggers'

export interface EffectElseOption { readonly addElse: boolean }
export interface BlockRange { readonly start: number, readonly end: number }

/** Each rule uses classic's own set for that rule; the sets are not interchangeable. */
const OPENER_TYPES: ReadonlySet<unknown> = new Set(['v2If', 'v2IfAdvanced', 'v2Loop', 'v2LoopNTimes'])
const CLOSING_TYPES: ReadonlySet<unknown> = new Set(['v2If', 'v2IfAdvanced', 'v2Loop', 'v2LoopNTimes', 'v2Else'])
const DELETE_UNWRAP_TYPES: ReadonlySet<unknown> = CLOSING_TYPES
const IF_TYPES: ReadonlySet<unknown> = new Set(['v2If', 'v2IfAdvanced'])

const isObject = (row: unknown): row is object => typeof row === 'object' && row !== null

const typeOf = (row: unknown): unknown => isObject(row) ? (row as { type?: unknown }).type : undefined

/**
 * The stored indent as it is. Classic does arithmetic on it as stored, so a string concatenates and a missing
 * value gives `NaN`; the declared type is `number` only so that the same arithmetic type-checks.
 */
const indentOf = (row: unknown): number => (isObject(row) ? (row as { indent?: number }).indent : undefined) as number

/** Writes an indent into a row of the result. A typeless row keeps its value. */
function setIndent(row: unknown, indent: number): void {
    if (isObject(row)) (row as { indent: number }).indent = indent
}

/** A deep copy of plain data in `Object.keys` order that keeps `NaN`, `undefined` values and primitives. */
function copyValue<T>(value: T): T {
    if (Array.isArray(value)) {
        const out: unknown[] = []
        for (let i = 0; i < value.length; i++) out.push(copyValue(value[i]))
        return out as T
    }
    if (isObject(value)) {
        const out: Record<string, unknown> = {}
        for (const key of Object.keys(value)) {
            Object.defineProperty(out, key, {
                value: copyValue((value as Record<string, unknown>)[key]),
                writable: true,
                enumerable: true,
                configurable: true,
            })
        }
        return out as T
    }
    return value
}

const copyRows = (effects: readonly triggerEffect[]): triggerEffect[] => copyValue(effects as triggerEffect[])

const isRowIndex = (effects: readonly triggerEffect[], index: number): boolean =>
    Number.isInteger(index) && index >= 0 && index < effects.length

const endRow = (indent: number, endOfLoop?: boolean): triggerEffectV2 =>
    endOfLoop === undefined ? { type: 'v2EndIndent', indent } : { type: 'v2EndIndent', indent, endOfLoop }

const elseRow = (indent: number): triggerEffectV2 => ({ type: 'v2Else', indent })

const isLoopType = (type: unknown): boolean => type === 'v2Loop' || type === 'v2LoopNTimes'

export function isBlockOpener(effect: triggerEffect): boolean {
    return OPENER_TYPES.has(typeOf(effect))
}

/**
 * The rows an opener owns, up to its closing `v2EndIndent` (and through an Else branch that follows at the same
 * indent). Any other row, and an opener with no matching End, is a block of its own.
 */
export function getBlockRange(effects: readonly triggerEffect[], index: number): BlockRange {
    const start = effects[index]
    if (!OPENER_TYPES.has(typeOf(start))) return { start: index, end: index }
    const indent = indentOf(start)
    let pointer = index + 1
    while (pointer < effects.length) {
        const current = effects[pointer]
        if (typeOf(current) === 'v2EndIndent' && indentOf(current) === indent + 1) {
            let endIndex = pointer
            if (pointer + 1 < effects.length) {
                const next = effects[pointer + 1]
                if (typeOf(next) === 'v2Else' && indentOf(next) === indent) {
                    pointer += 2
                    while (pointer < effects.length) {
                        const inElse = effects[pointer]
                        if (typeOf(inElse) === 'v2EndIndent' && indentOf(inElse) === indent + 1) {
                            endIndex = pointer
                            break
                        }
                        pointer++
                    }
                }
            }
            return { start: index, end: endIndex }
        }
        pointer++
    }
    return { start: index, end: index }
}

/** The indent a row gets when it lands before position `at` (`effects.length` means the end). */
export function getInsertIndent(effects: readonly triggerEffect[], at: number): number {
    if (at === 0) return 0
    if (at >= effects.length) {
        if (effects.length === 0) return 0
        const last = effects[effects.length - 1]
        if (typeOf(last) === 'v2EndIndent') return indentOf(last) - 1
        return indentOf(last)
    }
    const target = effects[at]
    const previous = effects[at - 1]
    const targetType = typeOf(target)
    if (targetType === 'v2EndIndent' || targetType === 'v2Else') return indentOf(target)
    const previousType = typeOf(previous)
    if (OPENER_TYPES.has(previousType)) return indentOf(previous) + 1
    if (previousType === 'v2Else') return indentOf(previous) + 1
    if (previousType === 'v2EndIndent') return indentOf(previous) - 1
    return indentOf(previous)
}

export function canMoveEffect(effects: readonly triggerEffect[], from: number, to: number): boolean {
    if (!Number.isInteger(from) || !Number.isInteger(to)) return false
    if (from === to) return false
    if (from < 0 || to < 0) return false
    if (from >= effects.length || to > effects.length) return false

    const fromType = typeOf(effects[from])
    if (fromType === 'v2EndIndent' || fromType === 'v2Else') return false

    if (OPENER_TYPES.has(fromType)) {
        const range = getBlockRange(effects, from)
        if (to > range.start && to <= range.end + 1) return false
    }

    if (to < effects.length && typeOf(effects[to]) === 'v2Else' && to > 0) {
        const previous = effects[to - 1]
        if (typeOf(previous) === 'v2EndIndent') {
            const blockIndent = indentOf(previous) - 1
            for (let i = to - 2; i >= 0; i--) {
                const check = effects[i]
                if (indentOf(check) === blockIndent) {
                    if (IF_TYPES.has(typeOf(check))) return false
                    break
                }
            }
        }
    }

    if (to > 0 && to < effects.length && typeOf(effects[to - 1]) === 'v2EndIndent' && typeOf(effects[to]) === 'v2Else') {
        return false
    }

    const targetIndent = getInsertIndent(effects, to)
    if (targetIndent < 0 || targetIndent > 10) return false
    return true
}

/**
 * Appends `effect`. An opener or Else is followed by its closing End, and an Else option adds the Else branch
 * after it.
 */
export function appendEffect(effects: readonly triggerEffect[], effect: triggerEffectV2, option: EffectElseOption): triggerEffect[] | null {
    const rows = copyRows(effects)
    const added = copyValue(effect)
    rows.push(added)
    if (CLOSING_TYPES.has(added.type)) {
        const indent = indentOf(added)
        rows.push(endRow(indent + 1, isLoopType(added.type)))
        if (option.addElse) {
            rows.push(elseRow(indent))
            rows.push(endRow(indent + 1))
        }
    }
    return rows
}

/** Inserts `effect` above row `index`, taking that row's indent as it is. */
export function insertEffectBefore(effects: readonly triggerEffect[], index: number, effect: triggerEffectV2, option: EffectElseOption): triggerEffect[] | null {
    if (!isRowIndex(effects, index)) return null
    const rows = copyRows(effects)
    const added = copyValue(effect)
    setIndent(added, indentOf(rows[index]))
    if (CLOSING_TYPES.has(added.type)) {
        const indent = indentOf(added)
        rows.splice(index, 0, endRow(indent + 1, isLoopType(added.type)))
        if (option.addElse) {
            rows.splice(index, 0, elseRow(indent))
            rows.splice(index, 0, endRow(indent + 1))
        }
    }
    rows.splice(index, 0, added)
    return rows
}

/**
 * Replaces row `index` with the edited row. On an If row, `option.addElse` adds or removes the Else branch.
 * Returns `null` when the toggle would add an Else to an opener with no matching `v2EndIndent` (MC-4117): classic
 * splices the pair in at the wrong place and then overwrites the row at the edited index, which can lose an
 * unrelated effect.
 */
export function replaceEffect(effects: readonly triggerEffect[], index: number, edited: triggerEffectV2, option: EffectElseOption): triggerEffect[] | null {
    if (!isRowIndex(effects, index)) return null
    const rows = copyRows(effects)
    const replacement = copyValue(edited)
    if (IF_TYPES.has(replacement.type)) {
        const indent = indentOf(effects[index])
        let endIndentIndex = -1
        for (let pointer = index + 1; pointer < rows.length; pointer++) {
            if (typeOf(rows[pointer]) === 'v2EndIndent' && indentOf(rows[pointer]) === indent + 1) {
                endIndentIndex = pointer
                break
            }
        }
        let hasExistingElse = false
        let elseIndex = -1
        if (endIndentIndex !== -1 && endIndentIndex + 1 < rows.length) {
            const next = rows[endIndentIndex + 1]
            if (typeOf(next) === 'v2Else' && indentOf(next) === indent) {
                hasExistingElse = true
                elseIndex = endIndentIndex + 1
            }
        }
        if (option.addElse && !hasExistingElse) {
            if (endIndentIndex === -1) return null
            rows.splice(endIndentIndex + 1, 0, elseRow(indent))
            rows.splice(endIndentIndex + 2, 0, endRow(indent + 1))
        }
        else if (!option.addElse && hasExistingElse) {
            let elseEndIndex = -1
            for (let pointer = elseIndex + 1; pointer < rows.length; pointer++) {
                if (typeOf(rows[pointer]) === 'v2EndIndent' && indentOf(rows[pointer]) === indent + 1) {
                    elseEndIndex = pointer
                    break
                }
            }
            if (elseEndIndex !== -1) rows.splice(elseIndex, elseEndIndex - elseIndex + 1)
        }
    }
    rows[index] = replacement
    return rows
}

/**
 * Deletes row `index`. Deleting an opener or an Else unwraps it: its children are dedented, its closing End goes,
 * and an Else directly after that End goes too, whatever its indent.
 */
export function deleteEffect(effects: readonly triggerEffect[], index: number): triggerEffect[] | null {
    if (!isRowIndex(effects, index)) return null
    const rows = copyRows(effects)
    const [removed] = rows.splice(index, 1)
    if (DELETE_UNWRAP_TYPES.has(typeOf(removed))) {
        const indent = indentOf(removed)
        let pointer = index
        while (pointer < rows.length) {
            const row = rows[pointer]
            if (typeOf(row) === 'v2EndIndent' && indentOf(row) === indent + 1) {
                rows.splice(pointer, 1)
                if (typeOf(rows[pointer]) === 'v2Else') {
                    rows.splice(pointer, 1)
                    continue
                }
                break
            }
            setIndent(row, indentOf(row) - 1)
            pointer += 1
        }
    }
    return rows
}

/** The rows a copy of row `index` holds: an opener's whole block, any other row alone. An Else cannot be copied. */
export function copyEffects(effects: readonly triggerEffect[], index: number): triggerEffect[] | null {
    if (!isRowIndex(effects, index)) return null
    const row = effects[index]
    if (OPENER_TYPES.has(typeOf(row))) {
        const range = getBlockRange(effects, index)
        return copyRows(effects.slice(range.start, range.end + 1))
    }
    if (typeOf(row) === 'v2Else') return null
    return [copyValue(row)]
}

/**
 * Pastes the copied rows above position `at`. A copied block keeps its shape and is rebased to the target indent;
 * any other row takes the target indent.
 */
export function pasteEffects(effects: readonly triggerEffect[], at: number, copied: readonly triggerEffect[]): triggerEffect[] | null {
    if (copied.length === 0) return null
    if (!Number.isInteger(at) || at < 0 || at > effects.length) return null
    const rows = copyRows(effects)
    const targetIndent = getInsertIndent(effects, at)
    const isBlock = OPENER_TYPES.has(typeOf(copied[0]))
    const difference = targetIndent - indentOf(copied[0])
    let insertIndex = at
    for (const effect of copied) {
        const cloned = copyValue(effect)
        setIndent(cloned, isBlock ? indentOf(effect) + difference : targetIndent)
        rows.splice(insertIndex, 0, cloned)
        insertIndex += 1
    }
    return rows
}

/** Moves row `from` (an opener takes its whole block) to the drop zone before row `to`. */
export function moveEffect(effects: readonly triggerEffect[], from: number, to: number): triggerEffect[] | null {
    if (!canMoveEffect(effects, from, to)) return null
    const rows = copyRows(effects)
    if (OPENER_TYPES.has(typeOf(effects[from]))) {
        const range = getBlockRange(effects, from)
        const blockSize = range.end - range.start + 1
        const targetIndent = getInsertIndent(effects, to)
        const movedBlock = rows.splice(range.start, blockSize)
        const adjustedTo = range.start < to ? to - blockSize : to
        const difference = targetIndent - indentOf(movedBlock[0])
        for (const row of movedBlock) setIndent(row, indentOf(row) + difference)
        rows.splice(adjustedTo, 0, ...movedBlock)
        return rows
    }
    const targetIndent = getInsertIndent(effects, to)
    const [moved] = rows.splice(from, 1)
    const adjustedTo = from < to ? to - 1 : to
    setIndent(moved, targetIndent)
    rows.splice(adjustedTo, 0, moved)
    return rows
}

export function moveEffectUp(effects: readonly triggerEffect[], index: number): triggerEffect[] | null {
    const range = getBlockRange(effects, index)
    return moveEffect(effects, range.start, range.start - 1)
}

export function moveEffectDown(effects: readonly triggerEffect[], index: number): triggerEffect[] | null {
    const range = getBlockRange(effects, index)
    return moveEffect(effects, range.start, range.end + 2)
}
