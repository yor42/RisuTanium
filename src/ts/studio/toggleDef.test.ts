import { describe, expect, test } from 'vitest'
import {
    appendPosition,
    buildDefinition,
    lineById,
    lineOf,
    parseDefinition,
    roleOf,
    rowsOf,
    sameStructure,
    spanOf,
    structureOf,
    textOf,
    type Definition,
    type DiagnosticCode,
    type LineForm,
    type LineId,
} from './toggleDef'
import { corpus, crlf } from './toggleDefFixtures.test-helpers'

/**
 * The read model of a toggle text. Every case is a new-behaviour guard: the module is new, so the unchanged base cannot
 * run it, and the red proof of each is the named mutant. Expectations are literals; the real engine parser is compared
 * in toggleDef.oracle.test.ts only.
 */

const id = (n: number): LineId => n as LineId
const raws = (def: Definition): string[] => def.lines.map((line) => line.raw)
const ids = (def: Definition): number[] => def.lines.map((line) => line.id)
const codes = (def: Definition, n: number): DiagnosticCode[] => (def.diagnostics.get(id(n)) ?? []).map((diagnostic) => diagnostic.code)
const build = (rawLines: string[], flag: boolean, nextId = rawLines.length): Definition =>
    buildDefinition(rawLines.map((raw, index) => lineOf(id(index), raw)), flag, nextId)

describe('1-1 line model and canonical form', () => {
    test('textOf reproduces the parsed text byte for byte', () => {
        const texts = ['', '\n', '\n\n', 'a', 'a\n', 'a\n\n', 'a\r\nb\r\n', 'a\r\n\nb\n', 'a\rb', '\r', '\r\n', 'a\n ', 'a\n\r', '﻿a=b', '😀\n']
        for (const text of [...texts, ...corpus.map((entry) => entry.text), ...corpus.map((entry) => crlf(entry.text))]) {
            expect(textOf(parseDefinition(text))).toBe(text)
        }
    })

    test('split on LF only keeps CR and records the trailing newline', () => {
        const def = parseDefinition('a\r\n\nb\n')
        expect(raws(def)).toEqual(['a\r', '', 'b'])
        expect(def.trailingNewline).toBe(true)
        expect(raws(parseDefinition('a\rb'))).toEqual(['a\rb'])
    })

    test('ids follow line order and nextId is the line count (W-P)', () => {
        const def = parseDefinition('a\n\n')
        expect(raws(def)).toEqual(['a', ''])
        expect(def.trailingNewline).toBe(true)
        expect(ids(def)).toEqual([0, 1])
        expect(def.nextId).toBe(2)
        const empty = parseDefinition('')
        expect(empty.lines).toEqual([])
        expect(empty.trailingNewline).toBe(false)
        expect(raws(parseDefinition('\n'))).toEqual([''])
    })

    test('W-CF1 a trailing empty line without the flag is dropped and the flag set', () => {
        const a = lineOf(id(0), 'a')
        const def = buildDefinition([a, lineOf(id(1), '')], false, 2)
        expect(def.lines).toHaveLength(1)
        expect(def.lines[0]).toBe(a)
        expect(def.trailingNewline).toBe(true)
        expect(def.nextId).toBe(2)
        expect(textOf(def)).toBe('a\n')
    })

    test('W-CF2 a lone empty line without the flag leaves no lines and no flag', () => {
        const def = buildDefinition([lineOf(id(0), '')], false, 1)
        expect(def.lines).toEqual([])
        expect(def.trailingNewline).toBe(false)
        expect(def.nextId).toBe(1)
        expect(textOf(def)).toBe('')
    })

    test('W-CF3 only one trailing empty line drops', () => {
        const def = build(['a', '', ''], false)
        expect(raws(def)).toEqual(['a', ''])
        expect(def.trailingNewline).toBe(true)
        expect(textOf(def)).toBe('a\n\n')
    })

    test('W-CF4 whitespace-only and CR-only last lines are user bytes', () => {
        const spaced = build(['a', ' '], false)
        expect(raws(spaced)).toEqual(['a', ' '])
        expect(spaced.trailingNewline).toBe(false)
        expect(textOf(spaced)).toBe('a\n ')
        const carriage = build(['a', '\r'], false)
        expect(raws(carriage)).toEqual(['a', '\r'])
        expect(carriage.trailingNewline).toBe(false)
        expect(textOf(carriage)).toBe('a\n\r')
        for (const text of ['a\n ', 'a\n\r']) {
            const parsed = parseDefinition(text)
            expect(textOf(parsed)).toBe(text)
            expect(parsed.trailingNewline).toBe(false)
        }
    })

    test('W-CF5 a trailing empty line with the flag set is canonical', () => {
        const def = build(['a', ''], true)
        expect(raws(def)).toEqual(['a', ''])
        expect(def.trailingNewline).toBe(true)
        expect(textOf(def)).toBe('a\n\n')
    })

    test('W-CF6 no lines means no flag', () => {
        const def = build([], true)
        expect(def.lines).toEqual([])
        expect(def.trailingNewline).toBe(false)
        expect(textOf(def)).toBe('')
    })

    test('every constructed model reparses to itself', () => {
        const cases: [string[], boolean][] = [[['a', ''], false], [[''], false], [['a', '', ''], false], [['a', ' '], false], [[], true], [['', ''], true]]
        for (const [rawLines, flag] of cases) {
            const def = build(rawLines, flag)
            const again = parseDefinition(textOf(def))
            expect(raws(again)).toEqual(raws(def))
            expect(again.trailingNewline).toBe(def.trailingNewline)
        }
    })
})

describe('1-2 form and drop reason', () => {
    test('lineOf classifies each line as the engine reads it', () => {
        const table: [string, LineForm][] = [
            ['a=A', { kind: 'value', valueKind: 'check' }],
            ['a=A=select', { kind: 'value', valueKind: 'select' }],
            ['a=A=select=x,y', { kind: 'value', valueKind: 'select' }],
            ['a=A=text', { kind: 'value', valueKind: 'text' }],
            ['a=A=textarea', { kind: 'value', valueKind: 'textarea' }],
            ['a=A=weird', { kind: 'value', valueKind: 'check' }],
            ['a=A=text\r', { kind: 'value', valueKind: 'check' }],
            ['g=G=group', { kind: 'group' }],
            ['g_end=G=groupEnd', { kind: 'groupEnd' }],
            ['g_end==groupEnd', { kind: 'groupEnd' }],
            ['==group', { kind: 'group' }],
            ['==divider', { kind: 'divider' }],
            ['k=v=divider', { kind: 'divider' }],
            ['=note=caption', { kind: 'caption' }],
            ['k=v=caption', { kind: 'caption' }],
            ['', { kind: 'blank' }],
            [' ', { kind: 'blank' }],
            ['\t', { kind: 'blank' }],
            ['\r', { kind: 'blank' }],
            [' \t\r', { kind: 'blank' }],
            ['==caption', { kind: 'dropped', reason: 'captionNeedsText' }],
            ['x==caption', { kind: 'dropped', reason: 'captionNeedsText' }],
            ['abc', { kind: 'dropped', reason: 'noSeparator' }],
            [' ', { kind: 'dropped', reason: 'noSeparator' }],
            ['=x', { kind: 'dropped', reason: 'emptyKey' }],
            ['=', { kind: 'dropped', reason: 'emptyKey' }],
            ['x=', { kind: 'dropped', reason: 'emptyLabel' }],
        ]
        for (const [raw, form] of table) {
            expect(lineOf(id(0), raw).form, raw).toEqual(form)
        }
    })

    test('parseDefinition gives the same forms, a blank line is not unreadable and an empty-label end is valid', () => {
        const def = parseDefinition('a=A\n\nabc\n=x\nx=\ng_end==groupEnd')
        expect(def.lines.map((line) => line.form.kind)).toEqual(['value', 'blank', 'dropped', 'dropped', 'dropped', 'groupEnd'])
        expect(codes(def, 1)).toEqual([])
        expect(codes(def, 2)).toEqual(['unreadable'])
        expect(codes(def, 5)).not.toContain('unreadable')
    })

    test('roleOf follows the form only', () => {
        expect(roleOf(lineOf(id(0), 'g=G=group'))).toBe('group')
        expect(roleOf(lineOf(id(0), 'g_end=G=groupEnd'))).toBe('groupEnd')
        for (const raw of ['a=A', '==divider', '=n=caption', '', 'junk', 'g=G=group\r']) {
            expect(roleOf(lineOf(id(0), raw)), raw).toBe('leaf')
        }
    })

    test('lineOf freezes its result', () => {
        const line = lineOf(id(3), 'a=A=select=x,y')
        expect(line.id).toBe(3)
        expect(line.parts).toEqual(['a', 'A', 'select', 'x,y'])
        expect(Object.isFrozen(line)).toBe(true)
    })
})

describe('1-3 no trimming and no case folding', () => {
    test('spaces and case change the reading', () => {
        expect(lineOf(id(0), 'g=G=Group').form).toEqual({ kind: 'value', valueKind: 'check' })
        expect(lineOf(id(0), 'g=G=group ').form).toEqual({ kind: 'value', valueKind: 'check' })
        expect(lineOf(id(0), 'a=A=Select').form).toEqual({ kind: 'value', valueKind: 'check' })
        expect(lineOf(id(0), 'a=A=select ').form).toEqual({ kind: 'value', valueKind: 'check' })
        expect(lineOf(id(0), ' =A').form).toEqual({ kind: 'value', valueKind: 'check' })
        expect(lineOf(id(0), 'a= ').form).toEqual({ kind: 'value', valueKind: 'check' })
        expect(lineOf(id(0), ' k = v ').parts).toEqual([' k ', ' v '])
    })
})

describe('1-4 outline and structure', () => {
    test('a group closed by its end line', () => {
        const def = parseDefinition('g=G=group\na=A\ng_end=G=groupEnd\nb=B')
        expect(def.outline.groups).toEqual([{ group: 0, end: 2, closer: 'end', members: [1] }])
        expect(def.outline.openAtEnd).toBeNull()
        expect(def.outline.strayEnds).toEqual([])
        expect(def.outline.parentOf.get(id(1))).toBe(0)
        expect(def.outline.parentOf.has(id(3))).toBe(false)
    })

    test('a group replaced by the next group has no end line', () => {
        const def = parseDefinition('g=G=group\na=A\nh=H=group\nb=B\nh_end=H=groupEnd\nc=C')
        expect(def.outline.groups).toEqual([
            { group: 0, end: null, closer: 'nextGroup', members: [1] },
            { group: 2, end: 4, closer: 'end', members: [3] },
        ])
        expect(def.outline.openAtEnd).toBeNull()
        expect(def.outline.parentOf.has(id(5))).toBe(false)
    })

    test('a group open at the end of the text', () => {
        const def = parseDefinition('g=G=group\na=A\nh=H=group\nb=B')
        expect(def.outline.groups).toEqual([
            { group: 0, end: null, closer: 'nextGroup', members: [1] },
            { group: 2, end: null, closer: 'textEnd', members: [3] },
        ])
        expect(def.outline.openAtEnd).toBe(2)
    })

    test('a stray end is recorded and a divider does not close a group', () => {
        const stray = parseDefinition('a=A\nx_end=X=groupEnd\nb=B')
        expect(stray.outline.strayEnds).toEqual([1])
        expect(stray.outline.groups).toEqual([])
        const divided = parseDefinition('g=G=group\n==divider\n=n=caption\n\njunk\na=A')
        expect(divided.outline.groups).toEqual([{ group: 0, end: null, closer: 'textEnd', members: [1, 2, 3, 4, 5] }])
    })

    test('a second end line after a closed group is stray', () => {
        const def = parseDefinition('g=G=group\na=A\ne=E=groupEnd\ne=E=groupEnd')
        expect(def.outline.groups).toEqual([{ group: 0, end: 2, closer: 'end', members: [1] }])
        expect(def.outline.strayEnds).toEqual([3])
    })

    test('structureOf lists parent, end, stray and open-at-end (W-SI1)', () => {
        const def = parseDefinition('g=G=group\na=A\nh=H=group\nb=B')
        const structure = structureOf(def)
        expect(structure.parentOf.get(id(1))).toBe(0)
        expect(structure.parentOf.get(id(3))).toBe(2)
        expect(structure.parentOf.get(id(0))).toBeNull()
        expect(structure.parentOf.get(id(2))).toBeNull()
        expect(structure.endOf.get(id(0))).toBeNull()
        expect(structure.endOf.get(id(2))).toBeNull()
        expect([...structure.endOf.keys()]).toEqual([0, 2])
        expect(structure.openAtEnd).toBe(2)
        const stray = structureOf(parseDefinition('a=A\nx_end=X=groupEnd'))
        expect([...stray.stray]).toEqual([1])
    })
})

describe('1-5 diagnostics', () => {
    test('duplicateKey covers value rows with the exact same key only', () => {
        const def = parseDefinition('k=A\nk=B\nj=J\nk=C=text')
        expect(codes(def, 0)).toContain('duplicateKey')
        expect(def.diagnostics.get(id(0))?.find((d) => d.code === 'duplicateKey')?.related).toEqual([1, 3])
        expect(codes(def, 2)).not.toContain('duplicateKey')
        expect(codes(parseDefinition('K=A\nk=B'), 0)).not.toContain('duplicateKey')
        expect(codes(parseDefinition('k=G=group\nk=K'), 1)).not.toContain('duplicateKey')
        expect(codes(parseDefinition('k=G=group\nk=K'), 0)).not.toContain('duplicateKey')
    })

    test('keyLookalike folds case, whitespace, underscore, BOM and NBSP', () => {
        for (const text of ['Key=A\nkey=B', 'k_y=A\nky=B', 'k y=A\nky=B', '﻿k=A\nk=B', 'k y=A\nky=B']) {
            const def = parseDefinition(text)
            expect(codes(def, 0), text).toContain('keyLookalike')
            expect(def.diagnostics.get(id(0))?.find((d) => d.code === 'keyLookalike')?.related, text).toEqual([1])
            expect(codes(def, 1), text).toContain('keyLookalike')
        }
        expect(codes(parseDefinition('k=A\nk=B'), 0)).not.toContain('keyLookalike')
        expect(codes(parseDefinition('a=A\nb=B'), 0)).not.toContain('keyLookalike')
    })

    test('key edge and interior spaces', () => {
        expect(codes(parseDefinition(' k=A'), 0)).toEqual(['keyEdgeSpace'])
        expect(codes(parseDefinition('k =A'), 0)).toEqual(['keyEdgeSpace'])
        expect(codes(parseDefinition('k y=A'), 0)).toEqual(['keyInteriorSpace'])
        expect(codes(parseDefinition(' k y =A'), 0)).toEqual(['keyEdgeSpace', 'keyInteriorSpace'])
        expect(codes(parseDefinition('ky=A'), 0)).toEqual([])
    })

    test('selectFewOptions counts the options the engine reads', () => {
        const cases: [string, boolean][] = [['a=A=select', true], ['a=A=select=', true], ['a=A=select=x', true], ['a=A=select=x,y', false], ['a=A=select=,', false], ['a=A=text', false]]
        for (const [text, few] of cases) {
            expect(codes(parseDefinition(text), 0).includes('selectFewOptions'), text).toBe(few)
        }
    })

    test('emptyGroup: a group without a value row, captions and dividers do not count', () => {
        expect(codes(parseDefinition('g=G=group\ng_end=G=groupEnd'), 0)).toEqual(['emptyGroup'])
        expect(codes(parseDefinition('g=G=group\n=note=caption\n==divider\ng_end=G=groupEnd'), 0)).toEqual(['emptyGroup'])
        expect(codes(parseDefinition('g=G=group\na=A\ng_end=G=groupEnd'), 0)).toEqual([])
        const plain = parseDefinition('g=G=group\ng_end=G=groupEnd')
        expect(plain.diagnostics.get(id(0))?.[0]).not.toHaveProperty('related')
    })

    test('emptyGroup names the value rows that share the group key', () => {
        const def = parseDefinition('k=G=group\nk_end=G=groupEnd\nk=K')
        expect(def.diagnostics.get(id(0))?.find((d) => d.code === 'emptyGroup')?.related).toEqual([2])
    })

    test('partsBeyondFour, unknownType, ignoredOptions and crInLine', () => {
        expect(codes(parseDefinition('a=A=select=x,y=tail'), 0)).toContain('partsBeyondFour')
        expect(codes(parseDefinition('g=G=group=1=2=3\na=A\n'), 0)).toContain('partsBeyondFour')
        expect(codes(parseDefinition('a=A=select=x,y'), 0)).not.toContain('partsBeyondFour')
        expect(codes(parseDefinition('a=A=weird'), 0)).toContain('unknownType')
        expect(codes(parseDefinition('a=A=text\r'), 0)).toContain('unknownType')
        for (const text of ['a=A', 'a=A=', 'a=A=text', 'a=A=select=x,y']) {
            expect(codes(parseDefinition(text), 0), text).not.toContain('unknownType')
        }
        expect(codes(parseDefinition('a=A=text=x'), 0)).toContain('ignoredOptions')
        expect(codes(parseDefinition('a=A=weird=x'), 0)).toContain('ignoredOptions')
        expect(codes(parseDefinition('a=A=select=x,y'), 0)).not.toContain('ignoredOptions')
        expect(codes(parseDefinition('a=A=text'), 0)).not.toContain('ignoredOptions')
        expect(codes(parseDefinition('k=v=text\r'), 0)).toContain('crInLine')
        expect(codes(parseDefinition('g=G=group\r'), 0)).toContain('crInLine')
        expect(codes(parseDefinition('a=A\r\nb=B\r\n'), 0)).not.toContain('crInLine')
        expect(codes(parseDefinition('a=A\r\n\r\n'), 1)).toEqual([])
    })

    test('unreadable, stray end, replaced and open-at-end groups', () => {
        const unreadable = parseDefinition('abc')
        expect(unreadable.diagnostics.get(id(0))).toEqual([{ code: 'unreadable', severity: 'error' }])
        expect(codes(parseDefinition('a=A\nx_end=X=groupEnd'), 1)).toEqual(['strayGroupEnd'])
        const def = parseDefinition('g=G=group\na=A\nh=H=group\nb=B')
        expect(codes(def, 0)).toEqual(['groupReplaced'])
        expect(def.diagnostics.get(id(0))?.[0].related).toEqual([2])
        expect(codes(def, 2)).toEqual(['groupOpenAtEnd'])
    })
})

describe('1-6 UTF-16 spans', () => {
    test('spans index the written text in UTF-16 units, CR included', () => {
        const def = parseDefinition('a=A\r\n😀=x\nb=B\n')
        const text = textOf(def)
        expect(spanOf(def, id(0))).toEqual({ start: 0, end: 4 })
        expect(spanOf(def, id(1))).toEqual({ start: 5, end: 9 })
        expect(spanOf(def, id(2))).toEqual({ start: 10, end: 13 })
        for (const line of def.lines) {
            const span = spanOf(def, line.id)
            expect(text.slice(span?.start, span?.end)).toBe(line.raw)
        }
        expect(spanOf(def, id(99))).toBeNull()
    })

    test('lineById finds a line and its index', () => {
        const def = parseDefinition('a=A\nb=B')
        expect(lineById(def, id(1))?.index).toBe(1)
        expect(lineById(def, id(1))?.line).toBe(def.lines[1])
        expect(lineById(def, id(9))).toBeNull()
    })
})

describe('1-12 appendPosition', () => {
    test('a group with an end line', () => {
        const def = parseDefinition('g=G=group\na=A\ng_end=G=groupEnd')
        expect(appendPosition(def, id(0))).toEqual({ before: 2 })
        expect(appendPosition(def, null)).toBe('end')
    })

    test('a group closed by the next group', () => {
        const def = parseDefinition('g=G=group\na=A\nh=H=group\nb=B\nh_end=H=groupEnd')
        expect(appendPosition(def, id(0))).toEqual({ before: 2 })
        expect(appendPosition(def, id(2))).toEqual({ before: 4 })
        expect(appendPosition(def, null)).toBe('end')
    })

    test('a group open at the end of the text, and the top level while one is open', () => {
        const def = parseDefinition('g=G=group\na=A')
        expect(appendPosition(def, id(0))).toBe('end')
        expect(appendPosition(def, null)).toBeNull()
        const replaced = parseDefinition('g=G=group\na=A\nh=H=group')
        expect(appendPosition(replaced, id(2))).toBe('end')
        expect(appendPosition(replaced, null)).toBeNull()
    })

    test('an unknown id or a non-group gives null', () => {
        const def = parseDefinition('g=G=group\na=A')
        expect(appendPosition(def, id(1))).toBeNull()
        expect(appendPosition(def, id(9))).toBeNull()
    })
})

describe('sameStructure predicate', () => {
    const structureWith = (entries: [number, string][]) => structureOf(buildDefinition(entries.map(([lineId, raw]) => lineOf(id(lineId), raw)), false, 20))

    test('W-OAE removing the last group makes the earlier group open at the end', () => {
        const before = structureOf(parseDefinition('g=G=group\na=A\nh=H=group\nb=B'))
        const after = structureWith([[0, 'g=G=group'], [1, 'a=A'], [3, 'b=B']])
        expect(after.openAtEnd).toBe(0)
        expect(sameStructure(before, after, {})).toBe(false)
    })

    test('an exemption lets the named line change parent or end', () => {
        const before = structureOf(parseDefinition('g=G=group\na=A\nb=B'))
        const reordered = structureWith([[0, 'g=G=group'], [2, 'b=B'], [1, 'a=A']])
        expect(sameStructure(before, reordered, {})).toBe(true)
        const outside = structureWith([[1, 'a=A'], [0, 'g=G=group'], [2, 'b=B']])
        expect(sameStructure(before, outside, {})).toBe(false)
        expect(sameStructure(before, outside, { parentOf: id(1) })).toBe(true)
        const closed = structureWith([[0, 'g=G=group'], [1, 'a=A'], [2, 'b=B'], [9, 'g_end=G=groupEnd']])
        expect(sameStructure(before, closed, {})).toBe(false)
        expect(sameStructure(before, closed, { endOf: id(0) })).toBe(true)
    })

    test('a line present on one side only is not constrained', () => {
        const before = structureOf(parseDefinition('a=A\nb=B'))
        expect(sameStructure(before, structureWith([[0, 'a=A'], [5, 'c=C'], [1, 'b=B']]), {})).toBe(true)
    })
})

describe('rowsOf literal shapes', () => {
    test('value, caption and structural rows (W-I1)', () => {
        const def = parseDefinition('k=v\n=c=caption\ng=G=group\n==divider\nd=D=select=x,y\nt=T=text')
        expect(rowsOf(def)).toStrictEqual([
            { key: 'k', value: 'v', type: undefined, options: [] },
            { key: '', value: 'c', type: 'caption' },
            { key: 'g', value: 'G', type: 'group', children: [] },
            { key: '', value: '', type: 'divider', children: [] },
            { key: 'd', value: 'D', type: 'select', options: ['x', 'y'] },
            { key: 't', value: 'T', type: 'text', options: [] },
        ])
        expect(rowsOf(parseDefinition(''))).toStrictEqual([])
    })
})
