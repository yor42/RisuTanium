// The block-rule corpus shared by the classic-parity tests of `triggerV2Blocks.ts`. Every array is stored as JSON
// text and parsed afresh for each use, so a test can never see another test's mutation, and so the rows carry
// exactly what a saved list carries. Opener and leaf rows take every key from the pinned default effects.
import type { triggerEffect } from '../../../process/triggers'
import { v2DefaultEffect } from '../triggerV2Defaults'

type Row = Record<string, unknown>

const setVar = (value: string, indent: number | string): Row => ({ ...v2DefaultEffect('v2SetVar'), value, indent })
const comment = (value: string, indent: number): Row => ({ ...v2DefaultEffect('v2Comment'), value, indent })
const opener = (type: 'v2If' | 'v2IfAdvanced' | 'v2Loop' | 'v2LoopNTimes', indent: number): Row => ({ ...v2DefaultEffect(type), indent })
const end = (indent: number, endOfLoop?: boolean): Row =>
    endOfLoop === undefined ? { type: 'v2EndIndent', indent } : { type: 'v2EndIndent', indent, endOfLoop }
const otherwise = (indent: number): Row => ({ type: 'v2Else', indent })
const withoutIndent = (row: Row): Row => {
    const copy = { ...row }
    delete copy.indent
    return copy
}

const ARRAYS: Readonly<Record<string, unknown[]>> = {
    W0: [],
    W1: [setVar('a', 0), setVar('b', 0), comment('c', 0)],
    W2: [opener('v2IfAdvanced', 0), setVar('a', 1), end(1), comment('c', 0)],
    W3: [opener('v2IfAdvanced', 0), setVar('a', 1), end(1), otherwise(0), setVar('b', 1), end(1), setVar('c', 0)],
    W4: [opener('v2Loop', 0), opener('v2IfAdvanced', 1), setVar('a', 2), end(2), end(1, true), comment('c', 0)],
    W5: [opener('v2IfAdvanced', 0), end(1), opener('v2LoopNTimes', 0), end(1, true)],
    W6: [opener('v2LoopNTimes', 0), opener('v2IfAdvanced', 1), setVar('a', 2), end(2), otherwise(1), setVar('b', 2), end(2), end(1), comment('c', 0)],
    W7: [opener('v2If', 0), setVar('a', 1), end(1), otherwise(0), end(1)],
    M1: [opener('v2IfAdvanced', 0), setVar('a', 1), setVar('b', 1)],
    M2: [opener('v2IfAdvanced', 0), setVar('a', 0), end(1), setVar('b', 0)],
    M3: [setVar('a', '1'), withoutIndent(opener('v2IfAdvanced', 0)), end(0), setVar('b', 0)],
    M4: [setVar('a', 0), otherwise(0), setVar('b', 1), end(1)],
    M5: [opener('v2IfAdvanced', 0), setVar('a', 1), otherwise(0), setVar('b', 1), end(1)],
    M6: [setVar('a', 0), setVar('b', 0), opener('v2IfAdvanced', 0), setVar('c', 1)],
    M7: [opener('v2IfAdvanced', 0), setVar('a', 1), end(1), otherwise(1), setVar('b', 1)],
}

/** M3's `v2EndIndent` carries a `null` indent, which `JSON.stringify` keeps and a spread default would not. */
const TEXTS: Record<string, string> = Object.fromEntries(
    Object.entries(ARRAYS).map(([id, rows]) => [id, JSON.stringify(rows)]),
)
TEXTS.M3 = TEXTS.M3.replace('"type":"v2EndIndent","indent":0', '"type":"v2EndIndent","indent":null')

/** The typeless-row arrays (MC-4116): classic throws on these values, so they have hand-written expectations only. */
const TYPELESS_TEXTS: Readonly<Record<string, string>> = {
    N1: JSON.stringify([setVar('a', 0), null, 'x', opener('v2IfAdvanced', 0), setVar('b', 1), end(1), 7]),
    N2: JSON.stringify([opener('v2IfAdvanced', 0), null, setVar('a', 1), end(1)]),
}

export const WELL_FORMED_IDS = ['W0', 'W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7'] as const
export const MALFORMED_IDS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7'] as const
export const CORPUS_IDS: readonly string[] = [...WELL_FORMED_IDS, ...MALFORMED_IDS]
export const TYPELESS_IDS = ['N1', 'N2'] as const

/** A fresh, independent parse of a corpus array. */
export function corpusArray(id: string): triggerEffect[] {
    const text = TEXTS[id] ?? TYPELESS_TEXTS[id]
    if (text === undefined) throw new Error('unknown corpus array: ' + id)
    return JSON.parse(text) as triggerEffect[]
}

/** A `W4` opener block supplies the paste source for the empty `W0` target, which has nothing to copy. */
export const COPY_SOURCE_OF: Readonly<Record<string, string>> = { W0: 'W4' }

export const typeOfRow = (row: unknown): unknown =>
    typeof row === 'object' && row !== null ? (row as { type?: unknown }).type : undefined

export const indentOfRow = (row: unknown): unknown =>
    typeof row === 'object' && row !== null ? (row as { indent?: unknown }).indent : undefined

const OPENERS: readonly unknown[] = ['v2If', 'v2IfAdvanced', 'v2Loop', 'v2LoopNTimes']
export const isOpenerRow = (row: unknown): boolean => OPENERS.includes(typeOfRow(row))

/**
 * The copy sources of an array: its first leaf, its first opener and its first nested opener (an opener with a
 * positive indent). A source is absent when the array has no such row.
 */
export function copySources(effects: readonly triggerEffect[]): Array<{ label: string, index: number }> {
    const found: Array<{ label: string, index: number }> = []
    const leaf = effects.findIndex((row) => !isOpenerRow(row) && typeOfRow(row) !== 'v2EndIndent' && typeOfRow(row) !== 'v2Else')
    if (leaf !== -1) found.push({ label: 'leaf', index: leaf })
    const first = effects.findIndex(isOpenerRow)
    if (first !== -1) found.push({ label: 'opener', index: first })
    const nested = effects.findIndex((row) => isOpenerRow(row) && typeof indentOfRow(row) === 'number' && (indentOfRow(row) as number) > 0)
    if (nested !== -1) found.push({ label: 'nested', index: nested })
    return found
}

/**
 * The last row of each opener's block, derived by hand from the array shapes above and keyed by row index. An opener
 * with no matching End (M1, M3, M6) is its own block. These are the expected ranges for `getBlockRange` and the
 * drop targets for the classic Move-down cells; no Studio function computes them.
 */
export const BLOCK_END: Readonly<Record<string, Readonly<Record<number, number>>>> = {
    W2: { 0: 2 },
    W3: { 0: 5 },
    W4: { 0: 4, 1: 3 },
    W5: { 0: 1, 2: 3 },
    W6: { 0: 7, 1: 6 },
    W7: { 0: 4 },
    M1: { 0: 0 },
    M2: { 0: 2 },
    M3: { 1: 1 },
    M5: { 0: 4 },
    M6: { 2: 2 },
    M7: { 0: 2 },
}

export type AppendVariant = { label: string, type: 'v2SetVar' | 'v2IfAdvanced' | 'v2Loop' | 'v2LoopNTimes' | 'v2If', addElse: boolean }
export const APPEND_VARIANTS: readonly AppendVariant[] = [
    { label: 'SetVar', type: 'v2SetVar', addElse: false },
    { label: 'IfAdvanced', type: 'v2IfAdvanced', addElse: false },
    { label: 'IfAdvanced+Else', type: 'v2IfAdvanced', addElse: true },
    { label: 'Loop', type: 'v2Loop', addElse: false },
    { label: 'LoopNTimes', type: 'v2LoopNTimes', addElse: false },
    { label: 'If+Else', type: 'v2If', addElse: true },
]

export const INSERT_VARIANTS: readonly AppendVariant[] = APPEND_VARIANTS.filter((variant) =>
    ['SetVar', 'IfAdvanced', 'IfAdvanced+Else', 'LoopNTimes'].includes(variant.label))

/** The picker category each type lives in (a manual event's picker). */
export const CATEGORY_OF_TYPE: Readonly<Record<AppendVariant['type'], string>> = {
    v2SetVar: 'Control',
    v2IfAdvanced: 'Control',
    v2Loop: 'Control',
    v2LoopNTimes: 'Control',
    v2If: 'Deprecated',
}

/** The three Else-toggle edits whose classic golden corrupts the list and which Studio refuses (MC-4117). */
export const MC4117_CELLS: ReadonlyArray<{ id: string, index: number }> = [
    { id: 'M1', index: 0 },
    { id: 'M3', index: 1 },
    { id: 'M6', index: 2 },
]
