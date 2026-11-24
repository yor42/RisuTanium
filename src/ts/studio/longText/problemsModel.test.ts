import { describe, expect, test } from 'vitest'
import type { CbsCheckResult, CbsProblem, CbsProblemKind } from './cbsCheck'
import { editBetween } from './highlightSpans'
import { fixApplies, PROBLEM_KINDS, problemRows, shiftRows, withExtraRows, type ExtraProblem, type ProblemCopy, type ProblemRow } from './problemsModel'

const copy: ProblemCopy = {
    'unclosed-macro': () => 'unclosed-macro',
    'stray-macro-close': () => 'stray-macro-close',
    'unclosed-block': (p) => `unclosed-block(${p.name ?? ''})`,
    'stray-block-close': (p) => `stray-block-close(${p.name ?? ''})`,
    'unknown-macro': () => 'unknown-macro',
    'not-a-block': (p) => `not-a-block(${p.name ?? ''})`,
    'misplaced-else': () => 'misplaced-else',
    'slot-outside': () => 'slot-outside',
    'deprecated': () => 'deprecated',
    'not-static': () => 'not-static',
}

function problem(kind: CbsProblemKind, start: number, end: number, extra: Partial<CbsProblem> = {}): CbsProblem {
    return { kind, severity: 'warning', start, end, line: 1, ...extra }
}

describe('C1-U1 problem rows', () => {
    test('every kind has a message, in source order, and a fix only when the problem has one', () => {
        expect(PROBLEM_KINDS).toHaveLength(10)
        const problems = PROBLEM_KINDS.map((kind, k) => problem(kind, k * 10, k * 10 + 2, { name: 'N', ...(kind === 'deprecated' ? { fix: { start: k * 10, end: k * 10 + 2, text: '{{char}}' } } : {}) }))
        const rows = problemRows(problems, copy)
        expect(rows.map((row) => row.start)).toEqual(problems.map((p) => p.start))
        expect(rows.map((row) => row.message)).toEqual(PROBLEM_KINDS.map((kind) => copy[kind](problem(kind, 0, 0, { name: 'N' }))))
        expect(rows.filter((row) => row.fix !== null).map((row) => row.kind)).toEqual(['deprecated'])
        expect(rows.find((row) => row.kind === 'deprecated')?.fix).toEqual({ start: 80, end: 82, text: '{{char}}' })
    })

    test('the key is kind:start:end, and a repeat of the same triple gets an occurrence suffix', () => {
        const rows = problemRows([problem('deprecated', 3, 9), problem('deprecated', 3, 9), problem('deprecated', 3, 9), problem('unknown-macro', 3, 9)], copy)
        expect(rows.map((row) => row.key)).toEqual(['deprecated:3:9', 'deprecated:3:9#2', 'deprecated:3:9#3', 'unknown-macro:3:9'])
    })

    test('the name is empty text when the problem has none', () => {
        expect(problemRows([problem('unclosed-block', 0, 4)], copy)[0].message).toBe('unclosed-block()')
    })
})

describe('C1-U2 a fix applies only to the text it was computed on', () => {
    const result: CbsCheckResult = { problems: [], valueDependent: false, judgedUntil: 5 }
    const withFix: ProblemRow = { key: 'k', kind: 'deprecated', severity: 'info', line: 1, start: 0, end: 6, message: 'm', fix: { start: 0, end: 6, text: '{{char}}' } }
    const noFix: ProblemRow = { ...withFix, fix: null }

    test('false on stale text or a missing fix, true on the same text', () => {
        expect(fixApplies({ text: '<char>', result }, '<char>', withFix)).toBe(true)
        expect(fixApplies({ text: '<char>', result }, '<char>x', withFix)).toBe(false)
        expect(fixApplies({ text: '<char>', result }, '<char>', noFix)).toBe(false)
    })
})

describe('C1-U3 shiftRows', () => {
    const rowAt = (start: number, end: number, line: number): ProblemRow & { kind: CbsProblemKind } => ({ key: '', kind: 'unknown-macro', severity: 'warning', line, start, end, message: 'm', fix: null })

    test('rows before the edit stay, rows after it move with their line recomputed, rows it touches are dropped', () => {
        const before = 'ab\n{{x}}\n{{y}}\n{{z}}'
        const rows = problemRows([rowAt(3, 8, 2), rowAt(9, 14, 3), rowAt(15, 20, 4)].map((r) => problem(r.kind, r.start, r.end, { line: r.line })), copy)
        expect(rows.map((r) => r.line)).toEqual([2, 3, 4])
        const after = 'ab\n{{x}}\nNEW\nLINE\n{{y}}\n{{z}}'
        const kept = shiftRows(rows, editBetween(before, after), after)
        expect(kept.map((r) => [r.start, r.line])).toEqual([[3, 2], [18, 5], [24, 6]])
        expect(kept.map((r) => r.key)).toEqual(['unknown-macro:3:8', 'unknown-macro:18:23', 'unknown-macro:24:29'])
        const touched = 'ab\n{{xy}}\n{{y}}\n{{z}}'
        expect(shiftRows(rows, editBetween(before, touched), touched).map((r) => r.start)).toEqual([10, 16])
    })

    test('C1-x02 a line feed at the row start belongs to the line it ends', () => {
        const before = 'ab\ncd'
        const rows = problemRows([problem('unknown-macro', 2, 3, { line: 1 })], copy)
        const after = 'ab\ncdX'
        expect(shiftRows(rows, editBetween(before, after), after).map((r) => r.line)).toEqual([1])
    })
})

describe('T64 withExtraRows', () => {
    const extraAt = (start: number, end: number, message = 'x'): ExtraProblem => ({ kind: 'x-deco-unknown', severity: 'warning', start, end, message })

    test('merged by start with the checker row first at an equal start, lines from the text, no fix, unique keys', () => {
        const text = 'ab\n{{x}}\ncd\n{{y}}'
        const rows = problemRows([problem('unknown-macro', 3, 8, { line: 2, fix: { start: 3, end: 8, text: 'f' } }), problem('unknown-macro', 13, 18, { line: 4 })], copy)
        const merged = withExtraRows(rows, [extraAt(13, 14, 'late'), extraAt(0, 2, 'first'), extraAt(3, 8, 'same'), extraAt(3, 8, 'again')], text)
        expect(merged.map((row) => [row.kind, row.start, row.message === 'unknown-macro' ? 'cbs' : row.message])).toEqual([
            ['x-deco-unknown', 0, 'first'],
            ['unknown-macro', 3, 'cbs'],
            ['x-deco-unknown', 3, 'same'],
            ['x-deco-unknown', 3, 'again'],
            ['unknown-macro', 13, 'cbs'],
            ['x-deco-unknown', 13, 'late'],
        ])
        expect(merged.map((row) => row.line)).toEqual([1, 2, 2, 2, 4, 4])
        expect(merged.map((row) => row.fix !== null)).toEqual([false, true, false, false, false, false])
        expect(new Set(merged.map((row) => row.key)).size).toBe(merged.length)
        expect(merged.filter((row) => row.start === 3 && row.end === 8).map((row) => row.key)).toEqual(['unknown-macro:3:8', 'x-deco-unknown:3:8', 'x-deco-unknown:3:8#2'])
    })

    test('no extra problems leaves the rows as they were', () => {
        const rows = problemRows([problem('unknown-macro', 3, 8)], copy)
        expect(withExtraRows(rows, [], 'ab\n{{x}}')).toEqual(rows)
    })

    test('shiftRows moves and drops extra rows like checker rows', () => {
        const before = 'ab\n{{x}}\n{{y}}'
        const rows = withExtraRows(problemRows([problem('unknown-macro', 3, 8)], copy), [extraAt(9, 14)], before)
        const after = 'ab\n{{x}}\nNEW\n{{y}}'
        expect(shiftRows(rows, editBetween(before, after), after).map((row) => [row.kind, row.start, row.line])).toEqual([['unknown-macro', 3, 2], ['x-deco-unknown', 13, 4]])
        const touched = 'ab\n{{x}}\n{{yy}}'
        expect(shiftRows(rows, editBetween(before, touched), touched).map((row) => row.kind)).toEqual(['unknown-macro'])
    })
})
