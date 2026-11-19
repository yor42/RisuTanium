// @vitest-environment node
import fc from 'fast-check'
import { afterEach, describe, expect, test } from 'vitest'
import {
    colourWindow,
    createUpdateBudget,
    editBetween,
    measureUpdate,
    segmentsOf,
    setUpdateClockForTests,
    shiftSpans,
    tokenSpans,
    WINDOW_LIMIT,
    type Mark,
    type Note,
    type Span,
} from './highlightSpans'

const pieces = ['{{', '}}', '::', '\r\n', '\n', 'a', 'b ', '#if ', '/if', '{{//', '<char>', '<user>', '<bot>', '😀', '\ud83d', 'x']
const soup = fc.array(fc.constantFrom(...pieces), { maxLength: 40 }).map((parts) => parts.join(''))

function expectWellFormed(spans: readonly Span[], len: number): void {
    let last = 0
    for (const s of spans) {
        expect(s.start).toBeGreaterThanOrEqual(last)
        expect(s.end).toBeGreaterThan(s.start)
        expect(s.end).toBeLessThanOrEqual(len)
        last = s.end
    }
}

afterEach(() => setUpdateClockForTests(null))

describe('tokenSpans and segmentsOf', () => {
    test('B2-U1 Invariant S: the pieces concatenate to the text, and spans are sorted, disjoint and in bounds', () => {
        fc.assert(fc.property(soup, (text) => {
            const spans = tokenSpans(text, 0, text.length)
            expectWellFormed(spans, text.length)
            expect(segmentsOf(text, spans, []).map((s) => s.text).join('')).toBe(text)
        }), { numRuns: 300 })
    })

    test('B2-U1 gap text between spans is kept, and stale or out-of-range items still cut the same text', () => {
        const text = 'plain {{char}} tail'
        const joined = segmentsOf(text, tokenSpans(text, 0, text.length), []).map((s) => s.text).join('')
        expect(joined).toBe(text)
        const stale = segmentsOf('abc', [{ start: 1, end: 99, kind: 'name' }], [{ start: -5, end: 2, severity: 'error' }])
        expect(stale.map((s) => s.text).join('')).toBe('abc')
        expect(segmentsOf('', [], [])).toEqual([])
    })

    test('B2-U2 literal macros, blocks, comments and role tags get their kinds', () => {
        const kinds = (text: string): string[] => tokenSpans(text, 0, text.length).map((s) => `${s.kind}:${text.slice(s.start, s.end)}`)
        expect(kinds('{{char}}')).toEqual(['brace:{{', 'name:char', 'brace:}}'])
        expect(kinds('{{getvar::hp}}')).toEqual(['brace:{{', 'name:getvar', 'sep:::', 'arg:hp', 'brace:}}'])
        expect(kinds('{{#if x}}a{{/if}}')).toEqual(['brace:{{', 'block:#if', 'arg: x', 'brace:}}', 'brace:{{', 'block:/if', 'brace:}}'])
        expect(kinds('{{// n}}')).toEqual(['comment:{{// n}}'])
        expect(kinds('<char> and <USER> and <bot>')).toEqual(['name:<char>', 'name:<USER>', 'name:<bot>'])
        expect(kinds('{{a::{{b}}}}')).toEqual(['brace:{{', 'name:a', 'sep:::', 'brace:{{', 'name:b', 'brace:}}', 'brace:}}'])
    })

    test('B2-x19 a head that starts with a colon is a block head, not a macro name', () => {
        const text = '{{:else}}'
        expect(tokenSpans(text, 0, text.length).map((s) => `${s.kind}:${text.slice(s.start, s.end)}`)).toEqual(['brace:{{', 'block::else', 'brace:}}'])
    })

    test('B2-U2 marks cut the text and the highest severity wins where they overlap', () => {
        const marks: Mark[] = [{ start: 0, end: 4, severity: 'info' }, { start: 2, end: 6, severity: 'error' }]
        const segments = segmentsOf('abcdefgh', [], marks)
        expect(segments.map((s) => `${s.text}:${s.severity}`)).toEqual(['ab:info', 'cd:error', 'ef:error', 'gh:null'])
    })

    test('S5 notes cut the text and tag each piece with its note; spans, marks and notes combine', () => {
        const notes: Note[] = [{ start: 0, end: 3, note: 'speaker' }, { start: 5, end: 8, note: 'notUsed' }]
        const segments = segmentsOf('abcdefgh', [{ start: 1, end: 6, kind: 'name' }], [{ start: 2, end: 7, severity: 'warning' }], notes)
        expect(segments.map((s) => `${s.text}:${s.note}:${s.kind}:${s.severity}`)).toEqual([
            'a:speaker:null:null',
            'b:speaker:name:null',
            'c:speaker:name:warning',
            'de:null:name:warning',
            'f:notUsed:name:warning',
            'g:notUsed:null:warning',
            'h:notUsed:null:null',
        ])
    })

    test('S5 without notes every segment carries a null note, and stale or out-of-range notes still cut the same text', () => {
        expect(segmentsOf('abc', [], []).every((s) => s.note === null)).toBe(true)
        const stale = segmentsOf('abc', [], [], [{ start: -4, end: 2, note: 'speaker' }, { start: 2, end: 99, note: 'notUsed' }])
        expect(stale.map((s) => `${s.text}:${s.note}`)).toEqual(['ab:speaker', 'c:notUsed'])
        expect(segmentsOf('', [], [], [{ start: 0, end: 3, note: 'speaker' }])).toEqual([])
    })

    test('S5 Invariant S holds with notes: the pieces concatenate to the text', () => {
        fc.assert(fc.property(soup, fc.array(fc.tuple(fc.integer({ min: -3, max: 50 }), fc.integer({ min: -3, max: 50 })), { maxLength: 6 }), (text, ranges) => {
            const notes: Note[] = ranges.map(([a, b], k) => ({ start: Math.min(a, b), end: Math.max(a, b), note: k % 2 === 0 ? 'speaker' : 'notUsed' }))
            expect(segmentsOf(text, tokenSpans(text, 0, text.length), [], notes).map((s) => s.text).join('')).toBe(text)
        }), { numRuns: 200 })
    })

    test('S5 shiftSpans moves notes after an edit, keeps those before it and drops those it touches', () => {
        const notes: Note[] = [{ start: 0, end: 4, note: 'speaker' }, { start: 6, end: 10, note: 'notUsed' }]
        expect(shiftSpans(notes, { start: 0, removed: 0, inserted: 2 })).toEqual([{ start: 2, end: 6, note: 'speaker' }, { start: 8, end: 12, note: 'notUsed' }])
        expect(shiftSpans(notes, { start: 4, removed: 0, inserted: 2 })).toEqual([{ start: 0, end: 4, note: 'speaker' }, { start: 8, end: 12, note: 'notUsed' }])
        expect(shiftSpans(notes, { start: 7, removed: 1, inserted: 1 })).toEqual([{ start: 0, end: 4, note: 'speaker' }])
    })

    test('B2-U4 at or below the limit the whole text is the window; above it only the visible part and a viewport each side', () => {
        expect(colourWindow(WINDOW_LIMIT, { scrollTop: 0, scrollHeight: 100, clientHeight: 10 })).toEqual({ from: 0, to: WINDOW_LIMIT })
        const len = WINDOW_LIMIT * 10
        const view = { scrollTop: 5000, scrollHeight: 10_000, clientHeight: 500 }
        const win = colourWindow(len, view)
        expect(win.from).toBeGreaterThan(0)
        expect(win.to).toBeLessThan(len)
        expect(win.from).toBeLessThanOrEqual(5000 * 20)
        expect(win.to).toBeGreaterThanOrEqual(5500 * 20)
        expect(colourWindow(len, { scrollTop: 0, scrollHeight: 0, clientHeight: 0 })).toEqual({ from: 0, to: WINDOW_LIMIT })
        const text = '{{a}}'.repeat(10)
        expect(tokenSpans(text, 5, 10).every((s) => s.start >= 5 && s.end <= 10)).toBe(true)
        expect(tokenSpans(text, 5, 10).length).toBeGreaterThan(0)
    })

    test('B2-x04 B2-x05 the window starts one viewport above and ends two viewports below the scroll top, in characters', () => {
        expect(colourWindow(40_000, { scrollTop: 1000, scrollHeight: 4000, clientHeight: 500 })).toEqual({ from: 5000, to: 20_000 })
    })
})

describe('editBetween and shiftSpans', () => {
    test('editBetween names the one replaced range', () => {
        expect(editBetween('abcdef', 'abXYdef')).toEqual({ start: 2, removed: 1, inserted: 2 })
        expect(editBetween('abc', 'abc')).toEqual({ start: 3, removed: 0, inserted: 0 })
        expect(editBetween('aaa', 'aaaa')).toEqual({ start: 3, removed: 0, inserted: 1 })
        expect(editBetween('', 'x')).toEqual({ start: 0, removed: 0, inserted: 1 })
    })

    test('B2-U3 items before the edit stay, items after it move, items it touches are dropped', () => {
        const items = [{ start: 0, end: 2 }, { start: 3, end: 6 }, { start: 8, end: 10 }]
        expect(shiftSpans(items, { start: 4, removed: 1, inserted: 3 })).toEqual([{ start: 0, end: 2 }, { start: 10, end: 12 }])
        expect(shiftSpans(items, { start: 3, removed: 0, inserted: 2 })).toEqual([{ start: 0, end: 2 }, { start: 5, end: 8 }, { start: 10, end: 12 }])
        expect(shiftSpans([{ start: 0, end: 2, kind: 'name' as const }], { start: 2, removed: 0, inserted: 1 })).toEqual([{ start: 0, end: 2, kind: 'name' }])
    })

    test('B2-U3 Invariant S and well-formedness hold after random edits, and kept spans still cover the same text', () => {
        fc.assert(fc.property(soup, soup, (before, after) => {
            const spans = tokenSpans(before, 0, before.length)
            const edit = editBetween(before, after)
            const shifted = shiftSpans(spans, edit)
            expectWellFormed(shifted, after.length)
            expect(segmentsOf(after, shifted, []).map((s) => s.text).join('')).toBe(after)
            for (const s of shifted) {
                const idx = spans.findIndex((o) => o.kind === s.kind && o.end - o.start === s.end - s.start && after.slice(s.start, s.end) === before.slice(o.start, o.end))
                expect(idx).toBeGreaterThanOrEqual(0)
            }
        }), { numRuns: 300 })
    })
})

describe('the update budget', () => {
    test('two consecutive slow updates trip it, a quick one in between resets it, and it stays tripped', () => {
        const budget = createUpdateBudget(32, 2)
        expect(budget.record(40)).toBe(false)
        expect(budget.record(10)).toBe(false)
        expect(budget.record(40)).toBe(false)
        expect(budget.record(40)).toBe(true)
        expect(budget.record(1)).toBe(true)
        expect(budget.tripped).toBe(true)
    })

    test('B2-x08 an update exactly at the limit is quick; just over it is slow', () => {
        const budget = createUpdateBudget()
        budget.record(32)
        budget.record(32)
        expect(budget.tripped).toBe(false)
        budget.record(32.5)
        expect(budget.tripped).toBe(false)
        budget.record(32.5)
        expect(budget.tripped).toBe(true)
    })

    test('measureUpdate reads only the update clock', () => {
        let now = 100
        setUpdateClockForTests(() => (now += 40))
        expect(measureUpdate(() => undefined)).toBe(40)
    })
})
