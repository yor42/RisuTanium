// The pure rules of the token bias list in Studio: how a typed value becomes a stored one, which rows repeat a token,
// and the row operations. Every builder returns fresh rows and never touches its input.
import type { BiasRow } from '../history/fieldRegistry'

export const BIAS_MIN = -100
export const BIAS_MAX = 100

export type BiasNote = 'clamp' | 'zeroed' | null

// A typed value as the number that is stored. Empty (or unreadable) text is stored as 0 and says so; a number outside
// -100..100 is clamped and says so; anything else is stored as typed, with no rounding.
export function clampBias(raw: string): { value: number; note: BiasNote } {
    if (raw.trim() === '') {
        return { value: 0, note: 'zeroed' }
    }
    const parsed = Number(raw)
    if (Number.isNaN(parsed)) {
        return { value: 0, note: 'zeroed' }
    }
    if (parsed > BIAS_MAX) {
        return { value: BIAS_MAX, note: 'clamp' }
    }
    if (parsed < BIAS_MIN) {
        return { value: BIAS_MIN, note: 'clamp' }
    }
    // `-0` is stored as 0.
    return { value: parsed === 0 ? 0 : parsed, note: null }
}

// The indexes of the rows whose token is the exact same string as another row's. No trimming and no case folding.
export function duplicateIndexes(rows: readonly BiasRow[]): Set<number> {
    const seen = new Map<string, number>()
    for (const [token] of rows) {
        seen.set(token, (seen.get(token) ?? 0) + 1)
    }
    const out = new Set<number>()
    rows.forEach(([token], index) => {
        if ((seen.get(token) ?? 0) > 1) {
            out.add(index)
        }
    })
    return out
}

function copyRows(rows: readonly BiasRow[]): BiasRow[] {
    return rows.map((row) => [row[0], row[1]])
}

export function addRow(rows: readonly BiasRow[]): BiasRow[] {
    return [...copyRows(rows), ['', 0]]
}

export function editToken(rows: readonly BiasRow[], index: number, token: string): BiasRow[] {
    const next = copyRows(rows)
    if (index >= 0 && index < next.length) {
        next[index] = [token, next[index][1]]
    }
    return next
}

export function editValue(rows: readonly BiasRow[], index: number, value: number): BiasRow[] {
    const next = copyRows(rows)
    if (index >= 0 && index < next.length) {
        next[index] = [next[index][0], value]
    }
    return next
}

export function deleteRow(rows: readonly BiasRow[], index: number): BiasRow[] {
    return copyRows(rows).filter((_, i) => i !== index)
}

// The row that takes focus after row `index` was deleted from a list that now has `remaining` rows: the next row (which
// now sits at `index`), else the previous one, else none (the Add button).
export function focusAfterDelete(index: number, remaining: number): number | null {
    if (index < remaining) {
        return index
    }
    return remaining > 0 ? remaining - 1 : null
}
