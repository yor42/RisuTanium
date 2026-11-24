import type { CbsCheckResult, CbsFix, CbsProblem, CbsProblemKind } from './cbsCheck'
import { shiftSpans, type Edit } from './highlightSpans'

/**
 * The problems list of one long-text field, free of the DOM.
 *
 * Invariants:
 * - A row is made from one checker problem and keeps its source order; its key is unique within the list, so a keyed
 *   list never sees a duplicate.
 * - A row that an edit touches is dropped, never stretched: the list never points at text that has been replaced. The
 *   next check brings it back if the problem is still there.
 * - A fix is offered for the text it was computed on only. `fixApplies` is the one place that decides it.
 */

export type ProblemRow = {
    key: string
    kind: CbsProblemKind | ExtraProblemKind
    severity: CbsProblem['severity']
    line: number
    start: number
    end: number
    message: string
    fix: CbsFix | null
}

/** A problem another module reports for the same text (for example lore decorators); the kind prefix keeps it apart from the checker's. */
export type ExtraProblemKind = `x-${string}`

export type ExtraProblem = {
    kind: ExtraProblemKind
    severity: CbsProblem['severity']
    start: number
    end: number
    message: string
}

// One message per kind. The mapped type fails the type check when the checker gains a kind.
export type ProblemCopy = { [K in CbsProblemKind]: (problem: CbsProblem) => string }

const KIND_TABLE: Record<CbsProblemKind, true> = {
    'unclosed-macro': true,
    'stray-macro-close': true,
    'unclosed-block': true,
    'stray-block-close': true,
    'unknown-macro': true,
    'not-a-block': true,
    'misplaced-else': true,
    'slot-outside': true,
    'deprecated': true,
    'not-static': true,
}

export const PROBLEM_KINDS = Object.keys(KIND_TABLE) as CbsProblemKind[]

// `kind:start:end`, with `#2`, `#3` on a repeat of the same triple.
function keyed<T extends { kind: CbsProblemKind | ExtraProblemKind; start: number; end: number }>(items: readonly T[]): (T & { key: string })[] {
    const seen = new Map<string, number>()
    return items.map((item) => {
        const base = `${item.kind}:${item.start}:${item.end}`
        const count = (seen.get(base) ?? 0) + 1
        seen.set(base, count)
        return { ...item, key: count === 1 ? base : `${base}#${count}` }
    })
}

export function problemRows(problems: readonly CbsProblem[], copy: ProblemCopy): ProblemRow[] {
    return keyed(problems.map((problem) => ({
        kind: problem.kind,
        severity: problem.severity,
        line: problem.line,
        start: problem.start,
        end: problem.end,
        message: copy[problem.kind](problem),
        fix: problem.fix ?? null,
    })))
}

// 1-based line of an offset in `text`: the line feeds before it, plus one.
function lineAt(text: string, offset: number): number {
    let line = 1
    for (let at = text.indexOf('\n'); at >= 0 && at < offset; at = text.indexOf('\n', at + 1)) line++
    return line
}

/**
 * The checker's rows merged with another module's problems for the same `text`, ordered by `start`. At an equal start
 * the checker's row comes first; each side keeps its own order. Extra rows have no fix, and every key is made again so
 * the merged list stays unique.
 */
export function withExtraRows(rows: readonly ProblemRow[], extra: readonly ExtraProblem[], text: string): ProblemRow[] {
    const added: ProblemRow[] = extra.map((problem) => ({ ...problem, key: '', line: lineAt(text, problem.start), fix: null })).sort((a, b) => a.start - b.start)
    const merged: ProblemRow[] = []
    let from = 0
    for (const row of rows) {
        while (from < added.length && added[from].start < row.start) merged.push(added[from++])
        merged.push(row)
    }
    while (from < added.length) merged.push(added[from++])
    return keyed(merged)
}

/** The rows after `edit` turned the checked text into `text`: later rows move, touched rows are dropped, lines and keys follow. */
export function shiftRows(rows: readonly ProblemRow[], edit: Edit, text: string): ProblemRow[] {
    return keyed(shiftSpans(rows, edit).map((row) => ({ ...row, line: lineAt(text, row.start) })))
}

export type CheckedText = { text: string; result: CbsCheckResult }

/** A fix is applied only to the very text it was computed on. */
export function fixApplies(checked: CheckedText, current: string, row: ProblemRow): boolean {
    return checked.text === current && row.fix !== null
}
