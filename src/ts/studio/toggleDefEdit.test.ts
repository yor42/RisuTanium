import { describe, expect, test } from 'vitest'
import { lineOf, parseDefinition, structureOf, textOf, type Definition, type LineId } from './toggleDef'
import {
    canonicalEndLine,
    canonicalLine,
    closeGroup,
    draftOf,
    insertRow,
    insertText,
    moveRow,
    removeRow,
    replaceText,
    rewriteLoss,
    setRaw,
    setRow,
    type EditResult,
    type Refusal,
} from './toggleDefEdit'

/**
 * The canonical writer and the edit operations. Every case is a new-behaviour guard: the module is new, so the unchanged
 * base cannot run it, and the red proof of each is the named mutant. Expectations are literals; the real engine parser is
 * compared in toggleDef.oracle.test.ts only.
 */

const id = (n: number): LineId => n as LineId
const raws = (def: Definition): string[] => def.lines.map((line) => line.raw)
const ids = (def: Definition): number[] => def.lines.map((line) => line.id)
const parse = parseDefinition

function ok(result: EditResult): Definition {
    if (result.ok === false) {
        throw new Error(`refused: ${result.refusal.code}`)
    }
    return result.def
}

function refused(result: EditResult): Refusal {
    if (result.ok === true) {
        throw new Error('expected a refusal')
    }
    return result.refusal
}

/** Every model is a fixed point of parse(textOf(·)) on raws and flag. */
function expectFixedPoint(def: Definition) {
    const again = parse(textOf(def))
    expect(raws(again)).toEqual(raws(def))
    expect(again.trailingNewline).toBe(def.trailingNewline)
}

const check = (key: string, label: string) => ({ kind: 'check', key, label }) as const

// ids are line positions in the parsed text
const T = 'g=G=group\na=A\ng_end=G=groupEnd\nb=B'
const S4 = 'g=G=group\na=A\ng_end=G=groupEnd'
const NEST_END = 'g1=G1=group\na=A\ng2=G2=group\nb=B\ne=E=groupEnd\nc=C'
const NEST_OPEN = 'g1=G1=group\na=A\ng2=G2=group\nb=B'
const UNCLOSED = 'g1=G1=group\na=A'
const STRAY = 'a=A\nx_end=X=groupEnd\nb=B\ng=G=group\nc=C\ng_end=G=groupEnd'

describe('2-1 canonical forms', () => {
    test('one line per draft kind', () => {
        expect(canonicalLine(check('k', 'l'))).toBe('k=l')
        expect(canonicalLine({ kind: 'text', key: 'k', label: 'l' })).toBe('k=l=text')
        expect(canonicalLine({ kind: 'textarea', key: 'k', label: 'l' })).toBe('k=l=textarea')
        expect(canonicalLine({ kind: 'select', key: 'k', label: 'l', options: ['a', 'b'] })).toBe('k=l=select=a,b')
        expect(canonicalLine({ kind: 'group', key: 'g', label: 'G' })).toBe('g=G=group')
        expect(canonicalLine({ kind: 'divider', label: 'Sec' })).toBe('=Sec=divider')
        expect(canonicalLine({ kind: 'caption', text: 'note' })).toBe('=note=caption')
    })

    test('select with no options writes no fourth part, and one empty option writes an empty one', () => {
        expect(canonicalLine({ kind: 'select', key: 'k', label: 'l', options: [] })).toBe('k=l=select')
        expect(canonicalLine({ kind: 'select', key: 'k', label: 'l', options: [''] })).toBe('k=l=select=')
        expect(canonicalLine({ kind: 'select', key: 'k', label: 'l', options: ['', ''] })).toBe('k=l=select=,')
    })

    test('empty divider and group labels and an empty group key are allowed; spaces are kept', () => {
        expect(canonicalLine({ kind: 'divider', label: '' })).toBe('==divider')
        expect(canonicalLine({ kind: 'group', key: 'g', label: '' })).toBe('g==group')
        expect(canonicalLine({ kind: 'group', key: '', label: '' })).toBe('==group')
        expect(canonicalLine(check(' k ', ' l '))).toBe(' k = l ')
    })

    test('the end line is <key>_end with the group label, without CRs, and has no key when the group has none', () => {
        expect(canonicalEndLine(lineOf(id(0), 'g=G=group'))).toBe('g_end=G=groupEnd')
        expect(canonicalEndLine(lineOf(id(0), '=G=group'))).toBe('=G=groupEnd')
        expect(canonicalEndLine(lineOf(id(0), 'g\r=G\r=group'))).toBe('g_end=G=groupEnd')
        expect(canonicalEndLine(lineOf(id(0), 'g==group'))).toBe('g_end==groupEnd')
    })
})

describe('2-2 refusals', () => {
    test('field refusals name the code and the field', () => {
        expect(canonicalLine(check('a=b', 'l'))).toEqual({ code: 'fieldHasEquals', field: 'key' })
        expect(canonicalLine(check('k', 'a\nb'))).toEqual({ code: 'fieldHasNewline', field: 'label' })
        expect(canonicalLine(check('k', 'a\rb'))).toEqual({ code: 'fieldHasCr', field: 'label' })
        expect(canonicalLine({ kind: 'select', key: 'k', label: 'l', options: ['a', 'b=c'] })).toEqual({ code: 'fieldHasEquals', field: 'option', optionIndex: 1 })
        expect(canonicalLine({ kind: 'select', key: 'k', label: 'l', options: ['a', 'b\n'] })).toEqual({ code: 'fieldHasNewline', field: 'option', optionIndex: 1 })
        expect(canonicalLine({ kind: 'select', key: 'k', label: 'l', options: ['a,b'] })).toEqual({ code: 'optionHasComma', optionIndex: 0 })
        expect(canonicalLine({ kind: 'caption', text: 'a=b' })).toEqual({ code: 'fieldHasEquals', field: 'text' })
        expect(canonicalLine({ kind: 'divider', label: 'a\r' })).toEqual({ code: 'fieldHasCr', field: 'label' })
        expect(canonicalLine({ kind: 'group', key: 'g=', label: 'G' })).toEqual({ code: 'fieldHasEquals', field: 'key' })
    })

    test('empty required fields are refused; an empty option is not', () => {
        expect(canonicalLine(check('', 'l'))).toEqual({ code: 'emptyKey' })
        expect(canonicalLine({ kind: 'text', key: 'k', label: '' })).toEqual({ code: 'emptyLabel' })
        expect(canonicalLine({ kind: 'select', key: '', label: 'l', options: [] })).toEqual({ code: 'emptyKey' })
        expect(canonicalLine({ kind: 'caption', text: '' })).toEqual({ code: 'captionNeedsText' })
        expect(typeof canonicalLine({ kind: 'select', key: 'k', label: 'l', options: [''] })).toBe('string')
    })

    test('a refused draft returns no model and leaves the input unchanged', () => {
        const def = parse('a=A\nb=B')
        const before = [...def.lines]
        expect(refused(setRow(def, id(0), check('a=', 'X')))).toEqual({ code: 'fieldHasEquals', field: 'key' })
        expect(refused(insertRow(def, 'end', check('', 'X')))).toEqual({ code: 'emptyKey' })
        expect(textOf(def)).toBe('a=A\nb=B')
        expect(def.lines.every((line, index) => line === before[index])).toBe(true)
    })

    test('setRaw refuses a newline before it classifies, and a CR before the role check', () => {
        const def = parse('junk\nb=B')
        for (const raw of ['a\nb', '\n', 'a\r\nb', 'a=b\nx=y=group']) {
            expect(refused(setRaw(def, id(0), raw))).toEqual({ code: 'rawHasNewline' })
        }
        for (const raw of ['a\r', 'x=y=group\r']) {
            expect(refused(setRaw(def, id(0), raw))).toEqual({ code: 'rawHasCr' })
        }
        expect(textOf(def)).toBe('junk\nb=B')
        expect(def.lines[0].raw).toBe('junk')
    })

    test('an unknown target id is refused by every op that takes one', () => {
        const def = parse(T)
        const missing = { code: 'unknownLine', id: id(99) }
        expect(refused(setRow(def, id(99), check('a', 'A')))).toEqual(missing)
        expect(refused(setRaw(def, id(99), 'x=y'))).toEqual(missing)
        expect(refused(removeRow(def, id(99)))).toEqual(missing)
        expect(refused(moveRow(def, id(99), 'end'))).toEqual(missing)
        expect(refused(closeGroup(def, id(99)))).toEqual(missing)
    })

    test('setRaw with an empty raw on the last line of an unflagged text drops that line', () => {
        const def = parse('a\nb')
        const next = ok(setRaw(def, id(1), ''))
        expect(next.lines).toHaveLength(1)
        expect(next.lines[0]).toBe(def.lines[0])
        expect(next.trailingNewline).toBe(true)
        expect(textOf(next)).toBe('a\n')
        expect(ids(next)).toEqual([0])
    })
})

describe('2-3 setRow locality', () => {
    test('a CRLF neighbour keeps its CR and its object, and the trailing newline is kept', () => {
        const def = parse('a=A\r\nb=B\r\n')
        const next = ok(setRow(def, id(0), check('a', 'X')))
        expect(textOf(next)).toBe('a=X\nb=B\r\n')
        expect(next.lines[1]).toBe(def.lines[1])
        expect(next.trailingNewline).toBe(true)
        expect(next.lines[0].id).toBe(id(0))
    })

    test('tails and unknown types on untouched lines survive, and only the target line is rewritten', () => {
        const def = parse('a=A=select=x,y=tail\nb=B=weird\nc=C=text\r\nd=D')
        const next = ok(setRow(def, id(3), check('d', 'E')))
        expect(raws(next)).toEqual(['a=A=select=x,y=tail', 'b=B=weird', 'c=C=text\r', 'd=E'])
        for (const index of [0, 1, 2]) {
            expect(next.lines[index]).toBe(def.lines[index])
        }
    })
})

describe('2-4 draftOf and rewriteLoss', () => {
    test('a CR-suffixed type is a check row: the draft is a check and the loss names the type', () => {
        const line = lineOf(id(0), 'k=v=text\r')
        expect(draftOf(line)).toEqual({ kind: 'check', key: 'k', label: 'v' })
        expect(rewriteLoss(line).unknownType).toBe('text\r')
        expect(rewriteLoss(line).trailingCr).toBe(true)
        const def = parse('k=v=text\r')
        const draft = draftOf(def.lines[0])
        if (draft?.kind !== 'check') {
            throw new Error('expected a check draft')
        }
        const next = ok(setRow(def, id(0), { ...draft, label: 'x' }))
        expect(raws(next)).toEqual(['k=x'])
        expect(next.lines[0].form).toEqual({ kind: 'value', valueKind: 'check' })
        expect(draftOf(lineOf(id(0), 'k=v=select\r'))).toEqual({ kind: 'check', key: 'k', label: 'v' })
    })

    test('a trailing CR is stripped from the last field only, and an interior CR is kept so a write refuses it', () => {
        expect(draftOf(lineOf(id(0), 'k=v\r'))).toEqual({ kind: 'check', key: 'k', label: 'v' })
        expect(draftOf(lineOf(id(0), 'k=v=select=a,b\r'))).toEqual({ kind: 'select', key: 'k', label: 'v', options: ['a', 'b'] })
        const def = parse('k\r=v')
        const draft = draftOf(def.lines[0])
        expect(draft).toEqual({ kind: 'check', key: 'k\r', label: 'v' })
        if (!draft) {
            throw new Error('expected a draft')
        }
        expect(refused(setRow(def, id(0), draft))).toEqual({ code: 'fieldHasCr', field: 'key' })
    })

    test('options on a non-select are dropped and reported; a divider key is reported', () => {
        const text = lineOf(id(0), 'k=v=text=opts')
        expect(draftOf(text)).toEqual({ kind: 'text', key: 'k', label: 'v' })
        expect(rewriteLoss(text).strayOptions).toBe('opts')
        const divider = lineOf(id(1), 'd=Sec=divider')
        expect(draftOf(divider)).toEqual({ kind: 'divider', label: 'Sec' })
        expect(rewriteLoss(divider).structuralKey).toBe('d')
        expect(rewriteLoss(lineOf(id(2), '=Sec=divider')).structuralKey).toBeNull()
        expect(rewriteLoss(lineOf(id(3), 'a=A=select=x,y=tail=more')).tail).toEqual(['tail', 'more'])
    })

    test('blank, dropped and group-end lines have no draft', () => {
        for (const raw of ['', '  ', 'junk', '=x', 'g_end=G=groupEnd']) {
            expect(draftOf(lineOf(id(0), raw))).toBeNull()
        }
        expect(draftOf(lineOf(id(0), 'g=G=group'))).toEqual({ kind: 'group', key: 'g', label: 'G' })
        expect(draftOf(lineOf(id(0), '=note=caption'))).toEqual({ kind: 'caption', text: 'note' })
    })

    test('W-I6: an unknown type survives on an untouched line and the loss names it', () => {
        const def = parse('k=v=weird\nb=B')
        const next = ok(setRow(def, id(1), check('b', 'X')))
        expect(next.lines[0]).toBe(def.lines[0])
        expect(next.lines[0].raw).toBe('k=v=weird')
        expect(rewriteLoss(def.lines[0]).unknownType).toBe('weird')
    })
})

describe('2-5 role rule', () => {
    test('a change of role is refused with both roles', () => {
        const def = parse(T)
        expect(refused(setRow(def, id(3), { kind: 'group', key: 'h', label: 'H' }))).toEqual({ code: 'changesRole', from: 'leaf', to: 'group' })
        expect(refused(setRaw(def, id(1), 'x_end=X=groupEnd'))).toEqual({ code: 'changesRole', from: 'leaf', to: 'groupEnd' })
        expect(refused(setRow(def, id(0), check('g', 'G')))).toEqual({ code: 'changesRole', from: 'group', to: 'leaf' })
        expect(refused(setRow(def, id(2), check('g', 'G')))).toEqual({ code: 'changesRole', from: 'groupEnd', to: 'leaf' })
        expect(refused(setRaw(parse('junk'), id(0), 'x=y=group'))).toEqual({ code: 'changesRole', from: 'leaf', to: 'group' })
        expect(refused(setRaw(def, id(0), 'g=G'))).toEqual({ code: 'changesRole', from: 'group', to: 'leaf' })
    })

    test('a group rename and a value-to-caption change keep the structure, and the end line is untouched', () => {
        const def = parse(T)
        const renamed = ok(setRow(def, id(0), { kind: 'group', key: 'g', label: 'Other' }))
        expect(raws(renamed)).toEqual(['g=Other=group', 'a=A', 'g_end=G=groupEnd', 'b=B'])
        expect(renamed.lines[2]).toBe(def.lines[2])
        expect(structureOf(renamed)).toEqual(structureOf(def))
        const caption = ok(setRow(def, id(1), { kind: 'caption', text: 't' }))
        expect(raws(caption)).toEqual(['g=G=group', '=t=caption', 'g_end=G=groupEnd', 'b=B'])
        expect(structureOf(caption)).toEqual(structureOf(def))
    })
})

describe('2-6 insertRow', () => {
    test('a leaf goes inside or outside a group, taking the group open at the position', () => {
        const def = parse(T)
        const inside = ok(insertRow(def, { before: id(2) }, check('x', 'X')))
        expect(raws(inside)).toEqual(['g=G=group', 'a=A', 'x=X', 'g_end=G=groupEnd', 'b=B'])
        expect(inside.outline.parentOf.get(id(4))).toBe(id(0))
        const outside = ok(insertRow(def, { before: id(3) }, check('x', 'X')))
        expect(outside.outline.parentOf.has(id(4))).toBe(false)
        expect(ids(outside)).toEqual([0, 1, 2, 4, 3])
    })

    test('a group is inserted as a closed pair at top level, and is closed by its own end', () => {
        const def = parse(T)
        const next = ok(insertRow(def, { before: id(3) }, { kind: 'group', key: 'h', label: 'H' }))
        expect(raws(next)).toEqual(['g=G=group', 'a=A', 'g_end=G=groupEnd', 'h=H=group', 'h_end=H=groupEnd', 'b=B'])
        const info = next.outline.groups.find((group) => group.group === id(4))
        expect(info?.end).toBe(id(5))
        expect(next.nextId).toBe(6)
    })

    test('a pair directly before the group line that closes an open group is legal', () => {
        const def = parse('g=G=group\na=A\nh=H=group\nb=B\nh_end=H=groupEnd')
        const next = ok(insertRow(def, { before: id(2) }, { kind: 'group', key: 'n', label: 'N' }))
        expect(raws(next)).toEqual(['g=G=group', 'a=A', 'n=N=group', 'n_end=N=groupEnd', 'h=H=group', 'b=B', 'h_end=H=groupEnd'])
    })

    test('a pair inside a group is refused with the first legal position', () => {
        const draft = { kind: 'group', key: 'h', label: 'H' } as const
        expect(refused(insertRow(parse(S4), { before: id(1) }, draft))).toEqual({ code: 'changesStructure', affected: [id(0), id(1), id(2)], firstLegal: 'end' })
        const withTail = refused(insertRow(parse(T), { before: id(1) }, draft))
        expect(withTail).toMatchObject({ code: 'changesStructure', firstLegal: { before: id(3) } })
    })

    test('a pair before an end line is refused, and a pair after a group left open is refused with no position', () => {
        expect(refused(insertRow(parse(T), { before: id(2) }, { kind: 'group', key: 'h', label: 'H' }))).toMatchObject({ code: 'changesStructure' })
        expect(refused(insertRow(parse(UNCLOSED), 'end', { kind: 'group', key: 'h', label: 'H' }))).toEqual({ code: 'changesStructure', affected: [id(0)], firstLegal: null })
        expect(refused(insertRow(parse(UNCLOSED), { before: id(1) }, { kind: 'group', key: 'h', label: 'H' }))).toMatchObject({ firstLegal: null })
    })

    test('an unknown anchor is refused, and a leaf is placed at the end', () => {
        const def = parse(T)
        expect(refused(insertRow(def, { before: id(42) }, check('x', 'X')))).toEqual({ code: 'unknownLine', id: id(42) })
        expect(refused(insertRow(def, { before: id(42) }, { kind: 'group', key: 'h', label: 'H' }))).toEqual({ code: 'unknownLine', id: id(42) })
        expect(raws(ok(insertRow(def, 'end', check('x', 'X'))))).toEqual([...raws(def), 'x=X'])
    })
})

describe('2-7 removeRow', () => {
    test('a group goes with its members and its end, or up to the next group, or to the end of the text', () => {
        expect(raws(ok(removeRow(parse(T), id(0))))).toEqual(['b=B'])
        expect(raws(ok(removeRow(parse('g=G=group\na=A\nh=H=group\nb=B\nh_end=H=groupEnd'), id(0))))).toEqual(['h=H=group', 'b=B', 'h_end=H=groupEnd'])
        expect(raws(ok(removeRow(parse('a=A\ng=G=group\nb=B'), id(1))))).toEqual(['a=A'])
    })

    test('a removal that would re-parent a later line or leave an earlier group open is refused', () => {
        const withEnd = refused(removeRow(parse(NEST_END), id(2)))
        expect(withEnd).toEqual({ code: 'changesStructure', affected: [id(0), id(5)], firstLegal: null })
        const open = refused(removeRow(parse(NEST_OPEN), id(2)))
        expect(open).toMatchObject({ code: 'changesStructure', firstLegal: null, affected: expect.arrayContaining([id(0)]) })
    })

    test('after the earlier group is closed the same removal succeeds', () => {
        const closed = ok(closeGroup(parse(NEST_END), id(0)))
        expect(raws(ok(removeRow(closed, id(2))))).toEqual(['g1=G1=group', 'a=A', 'g1_end=G1=groupEnd', 'c=C'])
        const closedOpen = ok(closeGroup(parse(NEST_OPEN), id(0)))
        expect(raws(ok(removeRow(closedOpen, id(2))))).toEqual(['g1=G1=group', 'a=A', 'g1_end=G1=groupEnd'])
    })

    test('a paired end is refused, a stray end is removed', () => {
        expect(refused(removeRow(parse(T), id(2)))).toEqual({ code: 'pairedEnd' })
        expect(raws(ok(removeRow(parse('a=A\nx_end=X=groupEnd\nb=B'), id(1))))).toEqual(['a=A', 'b=B'])
    })

    test('removing the last line gives the empty text', () => {
        for (const text of ['a', 'a\n']) {
            const next = ok(removeRow(parse(text), id(0)))
            expect(next.lines).toHaveLength(0)
            expect(next.trailingNewline).toBe(false)
            expect(textOf(next)).toBe('')
        }
        const first = ok(removeRow(parse('a\n\nb'), id(0)))
        const second = ok(removeRow(first, id(2)))
        expect(second.lines).toHaveLength(0)
        expect(second.trailingNewline).toBe(false)
        expect(textOf(second)).toBe('')
    })

    test('W-I3b: removing the last line after a blank line drops the blank line and sets the flag', () => {
        const def = parse('a\n\nb')
        const next = ok(removeRow(def, id(2)))
        expect(textOf(next)).toBe('a\n')
        expect(next.lines).toHaveLength(1)
        expect(next.lines[0]).toBe(def.lines[0])
        expect(next.trailingNewline).toBe(true)
        expect(ids(next)).toEqual([0])
        expectFixedPoint(next)
        const two = ok(removeRow(parse('a\n\n\nb'), id(3)))
        expect(textOf(two)).toBe('a\n\n')
        expect(raws(two)).toEqual(['a', ''])
        expect(two.trailingNewline).toBe(true)
        expectFixedPoint(two)
    })

    test('every result is a fixed point of parse(textOf(·))', () => {
        for (const [text, target] of [[T, 0], [T, 1], [NEST_END, 0], [STRAY, 1], [STRAY, 3], ['a\n\nb\n', 2]] as const) {
            expectFixedPoint(ok(removeRow(parse(text), id(target))))
        }
    })
})

describe('2-8 moveRow', () => {
    test('a position is the line the moved line lands immediately before', () => {
        const def = parse('a=A\nb=B\nc=C')
        expect(raws(ok(moveRow(def, id(2), { before: id(0) })))).toEqual(['c=C', 'a=A', 'b=B'])
        expect(raws(ok(moveRow(def, id(0), { before: id(2) })))).toEqual(['b=B', 'a=A', 'c=C'])
        expect(raws(ok(moveRow(def, id(0), 'end')))).toEqual(['b=B', 'c=C', 'a=A'])
    })

    test('a group moves with its members and its end', () => {
        const def = parse('x=X\ng=G=group\na=A\ng_end=G=groupEnd\ny=Y')
        expect(raws(ok(moveRow(def, id(1), 'end')))).toEqual(['x=X', 'y=Y', 'g=G=group', 'a=A', 'g_end=G=groupEnd'])
        expect(raws(ok(moveRow(def, id(1), { before: id(0) })))).toEqual(['g=G=group', 'a=A', 'g_end=G=groupEnd', 'x=X', 'y=Y'])
    })

    test('a group moved into another group is refused with no relocation', () => {
        const def = parse('g=G=group\na=A\ng_end=G=groupEnd\nh=H=group\nb=B\nh_end=H=groupEnd')
        expect(refused(moveRow(def, id(3), { before: id(1) }))).toEqual({ code: 'changesStructure', affected: [id(0), id(1), id(2)], firstLegal: null })
    })

    test('a leaf moves into and out of a group', () => {
        const def = parse(T)
        const into = ok(moveRow(def, id(3), { before: id(2) }))
        expect(raws(into)).toEqual(['g=G=group', 'a=A', 'b=B', 'g_end=G=groupEnd'])
        expect(into.outline.parentOf.get(id(3))).toBe(id(0))
        const out = ok(moveRow(def, id(1), 'end'))
        expect(out.outline.parentOf.has(id(1))).toBe(false)
    })

    test('a target inside the moved span and a paired end are refused', () => {
        const def = parse(T)
        expect(refused(moveRow(def, id(0), { before: id(1) }))).toEqual({ code: 'moveIntoOwnSpan' })
        expect(refused(moveRow(def, id(0), { before: id(2) }))).toEqual({ code: 'moveIntoOwnSpan' })
        expect(refused(moveRow(def, id(2), 'end'))).toEqual({ code: 'pairedEnd' })
    })

    test('a move that changes nothing returns the input model itself', () => {
        const def = parse('a=A\nb=B\nc=C')
        expect(ok(moveRow(def, id(0), { before: id(0) }))).toBe(def)
        expect(ok(moveRow(def, id(0), { before: id(1) }))).toBe(def)
        expect(ok(moveRow(def, id(2), 'end'))).toBe(def)
        const grouped = parse(T)
        expect(ok(moveRow(grouped, id(0), { before: id(3) }))).toBe(grouped)
    })

    test('a stray end may not be moved to where a group is open, and may be moved elsewhere', () => {
        const def = parse(STRAY)
        expect(refused(moveRow(def, id(1), { before: id(4) }))).toMatchObject({ code: 'changesStructure', firstLegal: null })
        const next = ok(moveRow(def, id(1), { before: id(3) }))
        expect(raws(next)).toEqual(['a=A', 'b=B', 'x_end=X=groupEnd', 'g=G=group', 'c=C', 'g_end=G=groupEnd'])
    })

    test('an unknown target or anchor is refused', () => {
        const def = parse(T)
        expect(refused(moveRow(def, id(1), { before: id(77) }))).toEqual({ code: 'unknownLine', id: id(77) })
        expect(refused(moveRow(def, id(77), { before: id(1) }))).toEqual({ code: 'unknownLine', id: id(77) })
    })

    test('moving the blank line of an unflagged text to the end drops it and sets the flag', () => {
        const def = parse('a\n\nb')
        const next = ok(moveRow(def, id(1), 'end'))
        expect(textOf(next)).toBe('a\nb\n')
        expect(raws(next)).toEqual(['a', 'b'])
        expect(next.lines[0]).toBe(def.lines[0])
        expect(next.lines[1]).toBe(def.lines[2])
        expect(ids(next)).toEqual([0, 2])
        expect(next.trailingNewline).toBe(true)
        expectFixedPoint(next)
    })
})

describe('2-9 insertText', () => {
    test('a final newline ends the last line and adds no blank line', () => {
        const next = ok(insertText(parse('x=X'), 'end', 'a=A\nb=B\n'))
        expect(raws(next)).toEqual(['x=X', 'a=A', 'b=B'])
        expect(ids(next)).toEqual([0, 1, 2])
    })

    test('lines are kept as written, CRs included', () => {
        const next = ok(insertText(parse('x=X'), 'end', 'a=A\r\nb=B\r\n'))
        expect(raws(next)).toEqual(['x=X', 'a=A\r', 'b=B\r'])
    })

    test('a fragment group left open gets an end line', () => {
        const next = ok(insertText(parse('x=X'), 'end', 'g=G=group\ny=Y'))
        expect(raws(next)).toEqual(['x=X', 'g=G=group', 'y=Y', 'g_end=G=groupEnd'])
    })

    test('a paste at the end of an existing open group leaves it open', () => {
        const next = ok(insertText(parse('g=G=group\na=A'), 'end', 'b=B\nc=C'))
        expect(raws(next)).toEqual(['g=G=group', 'a=A', 'b=B', 'c=C'])
        expect(next.outline.openAtEnd).toBe(id(0))
    })

    test('a group fragment pasted inside a group is placed at the first legal position', () => {
        const def = parse(T)
        const result = insertText(def, { before: id(1) }, 'h=H=group\nx=X\nh_end=H=groupEnd')
        expect(result).toMatchObject({ ok: true, relocatedTo: { before: id(3) } })
        expect(raws(ok(result))).toEqual(['g=G=group', 'a=A', 'g_end=G=groupEnd', 'h=H=group', 'x=X', 'h_end=H=groupEnd', 'b=B'])
        const direct = insertText(def, { before: id(3) }, 'h=H=group\nx=X\nh_end=H=groupEnd')
        expect(direct.ok && direct.relocatedTo).toBeUndefined()
    })

    test('with no legal position the paste is refused', () => {
        const refusal = refused(insertText(parse(UNCLOSED), { before: id(1) }, 'h=H=group\nx=X'))
        expect(refusal).toMatchObject({ code: 'changesStructure', firstLegal: null })
    })

    test('an empty fragment and an unknown anchor are refused', () => {
        expect(refused(insertText(parse(T), 'end', ''))).toEqual({ code: 'emptyFragment' })
        expect(refused(insertText(parse(T), { before: id(50) }, 'a=A'))).toEqual({ code: 'unknownLine', id: id(50) })
    })

    test('W-SI3: a fragment of blank lines at the end of an unflagged text drops the last one', () => {
        const next = ok(insertText(parse('a'), 'end', '\n\n'))
        expect(raws(next)).toEqual(['a', ''])
        expect(next.trailingNewline).toBe(true)
        expect(textOf(next)).toBe('a\n\n')
        expect(next.nextId).toBe(3)
        expect(ids(next)).toEqual([0, 1])
        expectFixedPoint(next)
    })

    test('W-ID-c: a single newline into the empty text leaves the empty text and consumes an id', () => {
        const next = ok(insertText(parse(''), 'end', '\n'))
        expect(next.lines).toHaveLength(0)
        expect(textOf(next)).toBe('')
        expect(next.nextId).toBe(1)
    })
})

describe('2-9b a fragment closes only the group open at its end', () => {
    test('two fragment groups get one end line, for the second', () => {
        const def = parse('x=X')
        const next = ok(insertText(def, 'end', 'a=A=group\nx=X\nb=B=group\ny=Y'))
        expect(raws(next)).toEqual(['x=X', 'a=A=group', 'x=X', 'b=B=group', 'y=Y', 'b_end=B=groupEnd'])
        expect(next.lines).toHaveLength(def.lines.length + 5)
        const a = next.outline.groups.find((group) => group.group === id(1))
        const b = next.outline.groups.find((group) => group.group === id(3))
        expect(a).toMatchObject({ end: null, closer: 'nextGroup', members: [id(2)] })
        expect(b).toMatchObject({ end: id(5), members: [id(4)] })
        expect(raws(next)).not.toContain('a_end=A=groupEnd')
        expect(next.nextId).toBe(6)
    })
})

describe('2-10 closeGroup', () => {
    test('a group open at the end of the text gets the end line appended', () => {
        expect(raws(ok(closeGroup(parse('g=G=group\na=A'), id(0))))).toEqual(['g=G=group', 'a=A', 'g_end=G=groupEnd'])
    })

    test('a group replaced by the next group gets the end line before that group', () => {
        expect(raws(ok(closeGroup(parse('g=G=group\na=A\nh=H=group\nb=B'), id(0))))).toEqual(['g=G=group', 'a=A', 'g_end=G=groupEnd', 'h=H=group', 'b=B'])
    })

    test('a closed group and a non-group are refused', () => {
        expect(refused(closeGroup(parse(T), id(0)))).toEqual({ code: 'alreadyClosed' })
        expect(refused(closeGroup(parse(T), id(1)))).toEqual({ code: 'notAGroup' })
        expect(refused(closeGroup(parse(T), id(2)))).toEqual({ code: 'notAGroup' })
    })
})

describe('2-11 ids', () => {
    test('setRow and setRaw keep the id of the edited line', () => {
        const def = parse('a\nb')
        const row = ok(setRow(def, id(0), check('c', 'C')))
        expect(ids(row)).toEqual([0, 1])
        expect(row.lines[1]).toBe(def.lines[1])
        expect(ids(ok(setRaw(def, id(0), 'c')))).toEqual([0, 1])
        expect(ok(setRaw(def, id(0), 'c')).nextId).toBe(2)
    })

    test('W-ID-b: moveRow keeps every id and every line object, a group span included', () => {
        const def = parse('a\nb')
        const next = ok(moveRow(def, id(1), { before: id(0) }))
        expect(ids(next)).toEqual([1, 0])
        expect(next.lines[0]).toBe(def.lines[1])
        expect(next.lines[1]).toBe(def.lines[0])
        expect(next.nextId).toBe(2)
        const grouped = parse('x=X\ng=G=group\na=A\ng_end=G=groupEnd')
        expect(ids(ok(moveRow(grouped, id(1), { before: id(0) })))).toEqual([1, 2, 3, 0])
    })

    test('W-ID-a and W-ID-d: fresh ids come from nextId and a removed id never returns', () => {
        const one = ok(insertRow(parse('a'), 'end', check('b', 'B')))
        expect(raws(one)).toEqual(['a', 'b=B'])
        expect(ids(one)).toEqual([0, 1])
        expect(one.nextId).toBe(2)
        const base = parse('a\nb')
        const removed = ok(removeRow(base, id(1)))
        expect(removed.nextId).toBe(2)
        const again = ok(insertRow(removed, 'end', check('c', 'C')))
        expect(ids(again)).toEqual([0, 2])
        expect(again.nextId).toBe(3)
    })
})

describe('2-12 replaceText', () => {
    test('equal lines keep their ids by prefix and suffix, never twice', () => {
        const grown = replaceText(parse('a\na'), 'a\na\na')
        expect(ids(grown)).toEqual([0, 1, 2])
        expect(grown.nextId).toBe(3)
        const shrunk = replaceText(parse('x\n\n\ny'), 'x\n\ny')
        expect(ids(shrunk)).toEqual([0, 1, 3])
        expect(shrunk.nextId).toBe(4)
    })

    test('a one-line edit keeps that id, and a change of line count gives fresh ids to the middle', () => {
        const edited = replaceText(parse('a\nb\nc'), 'a\nB\nc')
        expect(ids(edited)).toEqual([0, 1, 2])
        expect(edited.nextId).toBe(3)
        const longer = replaceText(parse('a\nb\nc'), 'a\nX\nY\nc')
        expect(ids(longer)).toEqual([0, 3, 4, 2])
        expect(longer.nextId).toBe(5)
        expect(raws(longer)).toEqual(['a', 'X', 'Y', 'c'])
    })

    test('the written text is the text given', () => {
        for (const text of ['', '\n', 'a', 'a\n', 'a\n\n', 'a\r\nb\r\n', T, 'x\n\n']) {
            const next = replaceText(parse('p\nq\nr\n'), text)
            expect(textOf(next)).toBe(text)
            expectFixedPoint(next)
        }
    })
})

describe('2-14 timing of a 1000-line case (diagnostic)', () => {
    test('a refused group insert tries every later position on 1000 lines', () => {
        const lines = ['g=G=group']
        for (let index = 0; index < 999; index++) {
            lines.push(`k${index}=K${index}`)
        }
        const def = parse(lines.join('\n'))
        const started = performance.now()
        const refusal = refused(insertRow(def, { before: id(1) }, { kind: 'group', key: 'h', label: 'H' }))
        const elapsed = performance.now() - started
        expect(refusal).toMatchObject({ code: 'changesStructure', firstLegal: null })
        console.info(`2-14 refused insertRow on 1000 lines: ${Math.round(elapsed)} ms`)
    })
})
