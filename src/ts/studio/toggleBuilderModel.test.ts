import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import {
    caretOffsetOf,
    convertDraft,
    createCompositionGate,
    diagnosticKeyOf,
    displayTextOf,
    dropsOptions,
    fieldErrorKeyOf,
    flagsOf,
    followDefault,
    hasInteriorCr,
    lineIndexAtOffset,
    lineMarksOf,
    moveOutOfGroup,
    moveStep,
    moveToGroup,
    newDraft,
    outlineRowsOf,
    positionAfter,
    rowAtLine,
    rowViewOf,
    typeKeyOf,
    withKeptCr,
} from './toggleBuilderModel'
import { corpus, crlf, textArb } from './toggleDefFixtures.test-helpers'
import { lineById, parseDefinition, textOf, type Definition, type LineId } from './toggleDef'
import { canonicalLine, draftOf, replaceText } from './toggleDefEdit'

// Lines: 0 a, 1 b, 2 blank, 3 group g, 4 c, 5 d (select), 6 g_end, 7 e.
const TEXT = 'a=A\nb=B\n\ng=G=group\nc=C\nd=D=select=x,y\ng_end=G=groupEnd\ne=E\n'
const idAt = (def: Definition, index: number): LineId => def.lines[index].id

describe('rowViewOf', () => {
    test('reads the type, name, key and option count of each form of line', () => {
        const def = parseDefinition('k=Mode\r\nj=Pick=select=a,b,c\r\ns=Say=text\ng=Grp=group\n=Line=divider\n=Hello=caption\nbroken\n')
        const view = (index: number) => rowViewOf(def.lines[index])
        expect(view(0)).toEqual({ type: 'check', label: 'Mode', key: 'k', optionCount: 0 })
        expect(view(1)).toMatchObject({ type: 'select', label: 'Pick', optionCount: 3 })
        expect(view(2).type).toBe('text')
        expect(view(3)).toMatchObject({ type: 'group', label: 'Grp', key: 'g' })
        expect(view(4)).toMatchObject({ type: 'divider', label: 'Line', key: '' })
        expect(view(5)).toMatchObject({ type: 'caption', label: 'Hello' })
        expect(view(6).type).toBe('unreadable')
    })

    test('a select with no options part has none, and a trailing carriage return is not part of the name', () => {
        const def = parseDefinition('k=Pick=select\r\nm=Name\r\n')
        expect(rowViewOf(def.lines[0]).optionCount).toBe(0)
        expect(rowViewOf(def.lines[1]).label).toBe('Name')
    })

    test('flagsOf lists the diagnostic codes of a line', () => {
        const def = parseDefinition('a=A\na=B\nbroken\n')
        expect(flagsOf(def, idAt(def, 0))).toBe('duplicateKey')
        expect(flagsOf(def, idAt(def, 2))).toBe('unreadable')
        expect(flagsOf(parseDefinition('a=A\n'), idAt(def, 0))).toBe('')
    })
})

describe('outlineRowsOf', () => {
    test('blank lines and the end line of a group are hidden; members sit one level down', () => {
        const def = parseDefinition(TEXT)
        const rows = outlineRowsOf(def, new Set())
        expect(rows.map((row) => row.id)).toEqual([0, 1, 3, 4, 5, 7])
        expect(rows.map((row) => row.level)).toEqual([1, 1, 1, 2, 2, 1])
        expect(rows[2]).toMatchObject({ expandable: true, expanded: true, memberCount: 2 })
        expect(rows[3].parentId).toBe(idAt(def, 3))
    })

    test('a collapsed group hides its members', () => {
        const def = parseDefinition(TEXT)
        const rows = outlineRowsOf(def, new Set([idAt(def, 3)]))
        expect(rows.map((row) => row.id)).toEqual([0, 1, 3, 7])
        expect(rows[2].expanded).toBe(false)
    })

    test('an unreadable line and a stray group end are rows; a group closed by the next group has no end line', () => {
        const def = parseDefinition('broken\nx_end==groupEnd\ng=G=group\nc=C\nh=H=group\nd=D\n')
        expect(outlineRowsOf(def, new Set()).map((row) => row.id)).toEqual([0, 1, 2, 3, 4, 5])
    })
})

describe('moveStep, moveToGroup, moveOutOfGroup, positionAfter', () => {
    const moved = (def: Definition | null): string | null => (def === null ? null : textOf(def))

    test('a leaf moves one visible slot; blank lines do not count as slots', () => {
        const def = parseDefinition(TEXT)
        expect(moved(moveStep(def, idAt(def, 0), 'down'))).toBe('b=B\na=A\n\ng=G=group\nc=C\nd=D=select=x,y\ng_end=G=groupEnd\ne=E\n')
    })

    test('a leaf moving down enters the group that follows and moving up leaves it; a position that changes nothing is skipped', () => {
        const def = parseDefinition(TEXT)
        expect(moved(moveStep(def, idAt(def, 1), 'down'))).toBe('a=A\n\ng=G=group\nb=B\nc=C\nd=D=select=x,y\ng_end=G=groupEnd\ne=E\n')
        const up = moveStep(def, idAt(def, 4), 'up')
        expect(up).not.toBeNull()
        expect(up?.outline.parentOf.get(idAt(def, 4))).toBeUndefined()
        const out = moveStep(def, idAt(def, 7), 'up')
        expect(out?.outline.parentOf.get(idAt(def, 7))).toBe(idAt(def, 3))
    })

    test('a group moves as one span', () => {
        const def = parseDefinition(TEXT)
        expect(moved(moveStep(def, idAt(def, 3), 'down'))).toBe('a=A\nb=B\n\ne=E\ng=G=group\nc=C\nd=D=select=x,y\ng_end=G=groupEnd\n')
    })

    test('the first and last rows have no step further out', () => {
        const def = parseDefinition(TEXT)
        expect(moveStep(def, idAt(def, 0), 'up')).toBeNull()
        expect(moveStep(def, idAt(def, 7), 'down')).toBeNull()
        expect(moveStep(def, 999 as LineId, 'down')).toBeNull()
    })

    test('moveToGroup appends to the group and moveOutOfGroup puts the member after it', () => {
        const def = parseDefinition(TEXT)
        expect(moved(moveToGroup(def, idAt(def, 1), idAt(def, 3)))).toBe('a=A\n\ng=G=group\nc=C\nd=D=select=x,y\nb=B\ng_end=G=groupEnd\ne=E\n')
        expect(moved(moveOutOfGroup(def, idAt(def, 5)))).toBe('a=A\nb=B\n\ng=G=group\nc=C\ng_end=G=groupEnd\nd=D=select=x,y\ne=E\n')
        expect(moveOutOfGroup(def, idAt(def, 0))).toBeNull()
        expect(moveToGroup(def, idAt(def, 5), idAt(def, 3))).toBeNull()
    })

    test('positionAfter names the line after a row, or after a whole group', () => {
        const def = parseDefinition(TEXT)
        expect(positionAfter(def, idAt(def, 0))).toEqual({ before: idAt(def, 1) })
        expect(positionAfter(def, idAt(def, 3))).toEqual({ before: idAt(def, 7) })
        expect(positionAfter(def, idAt(def, 7))).toBe('end')
        expect(positionAfter(def, 999 as LineId)).toBeNull()
    })
})

describe('drafts', () => {
    test('newDraft builds each kind and canonicalLine accepts every one', () => {
        for (const kind of ['check', 'select', 'text', 'textarea', 'group', 'divider', 'caption'] as const) {
            expect(typeof canonicalLine(newDraft(kind, 'k', 'Name'))).toBe('string')
        }
    })

    test('a kind change keeps the name and key and takes a fallback key where the row had none', () => {
        const select = draftOf(parseDefinition('k=Pick=select=a,b\n').lines[0])
        expect(select).not.toBeNull()
        const check = convertDraft(select!, 'check', 'fallback')
        expect(check).toEqual({ kind: 'check', key: 'k', label: 'Pick' })
        expect(dropsOptions(select!, check)).toBe(true)
        expect(dropsOptions(check, select!)).toBe(false)
        expect(convertDraft({ kind: 'caption', text: 'Hi' }, 'check', 'fallback')).toEqual({ kind: 'check', key: 'fallback', label: 'Hi' })
        expect(convertDraft({ kind: 'check', key: 'k', label: 'L' }, 'caption', 'x')).toEqual({ kind: 'caption', text: 'L' })
    })
})

describe('message keys', () => {
    test('a refused field value names the rule it broke', () => {
        expect(fieldErrorKeyOf({ code: 'fieldHasEquals', field: 'label' })).toBe('studioTgErrEq')
        expect(fieldErrorKeyOf({ code: 'optionHasComma', optionIndex: 0 })).toBe('studioTgErrComma')
        expect(fieldErrorKeyOf({ code: 'fieldHasNewline', field: 'key' })).toBe('studioTgErrNewline')
        expect(fieldErrorKeyOf({ code: 'emptyKey' })).toBe('studioTgErrEmptyKey')
        expect(fieldErrorKeyOf({ code: 'emptyLabel' })).toBe('studioTgErrEmptyLabel')
        expect(fieldErrorKeyOf({ code: 'captionNeedsText' })).toBe('studioTgErrCaption')
        expect(fieldErrorKeyOf({ code: 'changesRole', from: 'leaf', to: 'group' })).toBe('studioTgStructure')
        expect(fieldErrorKeyOf({ code: 'pairedEnd' })).toBe('studioTgNotWritten')
    })

    test('every diagnostic code and row type has a message', () => {
        const codes = ['unreadable', 'partsBeyondFour', 'partsBeyondFive', 'defaultNotOption', 'ignoredDefault', 'unknownType', 'ignoredOptions', 'crInLine', 'duplicateKey', 'keyLookalike', 'keyEdgeSpace', 'keyInteriorSpace', 'selectFewOptions', 'emptyGroup', 'groupReplaced', 'groupOpenAtEnd', 'strayGroupEnd'] as const
        for (const code of codes) expect(diagnosticKeyOf(code)).toMatch(/^studioTg/)
        expect(diagnosticKeyOf('partsBeyondFive')).toBe('studioTgMarkPartsBeyondFive')
        expect(diagnosticKeyOf('defaultNotOption')).toBe('studioTgMarkDefaultNotOption')
        expect(diagnosticKeyOf('ignoredDefault')).toBe('studioTgMarkIgnoredDefault')
        expect(fieldErrorKeyOf({ code: 'defaultNotOption' })).toBe('studioTgErrDefaultNotOption')
        for (const type of ['check', 'select', 'text', 'textarea', 'group', 'divider', 'caption'] as const) expect(typeKeyOf(type)).toMatch(/^studioTgType/)
        expect(lineById(parseDefinition('a=A\n'), 0 as LineId)).not.toBeNull()
    })
})

describe('T4.8 followDefault and kind changes', () => {
    test('the default follows its option by text', () => {
        expect(followDefault(['calm', 'angry'], ['angry', 'calm'], 'angry')).toBe('angry')
        expect(followDefault(['calm', 'angry'], ['calm', 'angry', 'sad'], 'angry')).toBe('angry')
        expect(followDefault(['calm', 'angry'], ['happy', 'angry'], 'angry')).toBe('angry')
        expect(followDefault(['calm', 'angry', 'sad'], ['calm', 'angry'], 'angry')).toBe('angry')
        expect(followDefault(['a', 'a'], ['a', 'a', 'b'], 'a')).toBe('a')
    })

    test('renaming the default option renames the default; a rename to empty gives empty', () => {
        expect(followDefault(['calm', 'angry'], ['calm', 'furious'], 'angry')).toBe('furious')
        expect(followDefault(['calm', 'angry'], ['calm', ''], 'angry')).toBe('')
    })

    test('removing the default, or changing several options at once, clears it', () => {
        expect(followDefault(['calm', 'angry'], ['calm'], 'angry')).toBeUndefined()
        expect(followDefault(['calm', 'angry', 'sad'], ['calm', 'furious', 'glad'], 'angry')).toBeUndefined()
        expect(followDefault(['calm', 'angry'], ['calm', 'sad', 'x'], 'angry')).toBeUndefined()
        expect(followDefault(['calm', 'angry'], ['x', 'y'], 'angry')).toBeUndefined()
        expect(followDefault(['calm', 'angry'], ['calm', 'angry'], undefined)).toBeUndefined()
    })

    test('a new draft has no default and a kind change drops it', () => {
        expect(newDraft('check', 'k', 'K')).toEqual({ kind: 'check', key: 'k', label: 'K' })
        expect(newDraft('select', 'k', 'K')).toEqual({ kind: 'select', key: 'k', label: 'K', options: [] })
        expect(convertDraft({ kind: 'check', key: 'k', label: 'K', default: '1' }, 'text', 'x')).toEqual({ kind: 'text', key: 'k', label: 'K' })
        expect(convertDraft({ kind: 'select', key: 'k', label: 'K', options: ['a', 'b'], default: 'a' }, 'check', 'x')).toEqual({ kind: 'check', key: 'k', label: 'K' })
        expect(convertDraft({ kind: 'check', key: 'k', label: 'K', default: '1' }, 'select', 'x')).toEqual({ kind: 'select', key: 'k', label: 'K', options: [] })
    })
})

describe('createCompositionGate', () => {
    test('a plain input writes at once', () => {
        const written: string[] = []
        const gate = createCompositionGate((value) => written.push(value))
        gate.input('a', false)
        gate.input('ab', false)
        expect(written).toEqual(['a', 'ab'])
    })

    test('nothing is written while composing; the end writes the composed value once', () => {
        const written: string[] = []
        const gate = createCompositionGate((value) => written.push(value))
        gate.start()
        gate.input('ㅎ', true)
        gate.input('하', true)
        expect(written).toEqual([])
        gate.end('한')
        expect(written).toEqual(['한'])
        expect(gate.composing).toBe(false)
    })

    test('an input flagged as composing is held even before the start event', () => {
        const written: string[] = []
        const gate = createCompositionGate((value) => written.push(value))
        gate.input('ㅎ', true)
        expect(written).toEqual([])
    })

    test('a flush writes a held value once and a second flush writes nothing', () => {
        const written: string[] = []
        const gate = createCompositionGate((value) => written.push(value))
        gate.start()
        gate.input('하', true)
        gate.flush()
        gate.flush()
        expect(written).toEqual(['하'])
        expect(gate.composing).toBe(false)
    })
})

const FAST_CHECK = { seed: 20261116, numRuns: 300 }
const withoutInteriorCr = textArb.filter((text) => !hasInteriorCr(parseDefinition(text)))
// The text a textarea reports for a value: every line break is a bare LF.
const fieldValueOf = (text: string): string => text.replace(/\r\n?/g, '\n')

describe('T-1 withKeptCr and displayTextOf', () => {
    test('the display text of a CRLF text has no carriage return; the keep map writes the original back', () => {
        const def = parseDefinition(crlf('a=A\nb=B\n'))
        expect(displayTextOf(def)).toBe('a=A\nb=B\n')
        expect(withKeptCr(def, displayTextOf(def))).toBe('a=A\r\nb=B\r\n')
    })

    test('T1: showing and writing back changes no byte, for every text without an interior carriage return', () => {
        fc.assert(fc.property(withoutInteriorCr, (text) => {
            const def = parseDefinition(text)
            return withKeptCr(def, displayTextOf(def)) === textOf(def)
        }), FAST_CHECK)
        for (const entry of corpus) {
            for (const text of [entry.text, crlf(entry.text)]) {
                const def = parseDefinition(text)
                if (!hasInteriorCr(def)) {
                    expect(withKeptCr(def, displayTextOf(def)), entry.name).toBe(textOf(def))
                }
            }
        }
    })

    test('T2: editing one line of a CRLF text changes only that line, its ending included', () => {
        const def = parseDefinition('a=A\r\nb=B\r\nc=C\r\n')
        expect(withKeptCr(def, 'a=A\nb=Changed\nc=C\n')).toBe('a=A\r\nb=Changed\r\nc=C\r\n')
        expect(withKeptCr(def, 'a=A\nb=B\nx=X\nc=C\n')).toBe('a=A\r\nb=B\r\nx=X\r\nc=C\r\n')
        expect(withKeptCr(def, 'a=A\nb=B\nc=C\nd=D')).toBe('a=A\r\nb=B\r\nc=C\r\nd=D')
    })

    test('T2: an edit of one line of an LF text, or of a mixed text, adds no carriage return', () => {
        expect(withKeptCr(parseDefinition('a=A\nb=B\n'), 'a=A\nb=X\n')).toBe('a=A\nb=X\n')
        expect(withKeptCr(parseDefinition('a=A\r\nb=B\nc=C\n'), 'a=A\nb=X\nc=C\n')).toBe('a=A\r\nb=X\nc=C\n')
        expect(withKeptCr(parseDefinition('a=A'), 'a=A\nb=B')).toBe('a=A\nb=B')
    })

    test('T2 property: one changed line leaves every other line byte for byte', () => {
        fc.assert(fc.property(withoutInteriorCr, fc.nat(), fc.constantFrom('x=X', 'zz', '', 'q=Q=text'), (text, at, replacement) => {
            const def = parseDefinition(text)
            const shown = displayTextOf(def).split('\n')
            const original = textOf(def).split('\n')
            const index = at % shown.length
            const edited = shown.map((line, i) => (i === index ? replacement : line)).join('\n')
            if (edited === displayTextOf(def)) return true
            const result = withKeptCr(def, edited).split('\n')
            return result.length === original.length && result.every((line, i) => i === index || line === original[i])
        }), FAST_CHECK)
    })

    test('a text with a carriage return inside a line is flagged; a final one is not', () => {
        expect(hasInteriorCr(parseDefinition('a=A\rb\nc=C\n'))).toBe(true)
        expect(hasInteriorCr(parseDefinition('a=A\r\nb=B\r'))).toBe(false)
        expect(displayTextOf(parseDefinition('a=A\r\nb=B\r'))).toBe('a=A\nb=B')
    })

    test('a field value holding line breaks of any kind is read as LF lines', () => {
        const def = parseDefinition('a=A\r\n')
        expect(withKeptCr(def, fieldValueOf('a=A\r\nb=B\r\n'))).toBe('a=A\r\nb=B\r\n')
    })
})

describe('lineMarksOf, caretOffsetOf, lineIndexAtOffset and rowAtLine', () => {
    test('R-D3: an unreadable line has an error mark at its own line number, and a mark follows an edit', () => {
        const def = parseDefinition('a=A\nbroken\nc=C=select=x\n')
        expect(lineMarksOf(def).filter((mark) => mark.severity === 'error')).toEqual([{ line: 2, code: 'unreadable', severity: 'error' }])
        expect(lineMarksOf(def).find((mark) => mark.code === 'selectFewOptions')?.line).toBe(3)
        const grown = replaceText(def, 'new=N\na=A\nbroken\nc=C=select=x\n')
        expect(lineMarksOf(grown).find((mark) => mark.code === 'unreadable')?.line).toBe(3)
    })

    test('R-D3: a line beyond four parts has a warning mark', () => {
        const marks = lineMarksOf(parseDefinition('a=A=text=x=tail\n'))
        expect(marks).toContainEqual({ line: 1, code: 'partsBeyondFour', severity: 'warning' })
    })

    test('T4.1 a valid default has no mark, and a bad one has a mark of its own', () => {
        expect(lineMarksOf(parseDefinition('a=A===1\nb=B=select=x,y=y\n'))).toEqual([])
        const marks = lineMarksOf(parseDefinition('a=A===1=x\nb=B=select=x,y=z\nc=C===yes\n'))
        expect(marks).toEqual([
            { line: 1, code: 'partsBeyondFive', severity: 'warning' },
            { line: 2, code: 'defaultNotOption', severity: 'warning' },
            { line: 3, code: 'ignoredDefault', severity: 'warning' },
        ])
    })

    test('the caret offset of a row is its start in the display text, carriage returns not counted', () => {
        const def = parseDefinition('a=A\r\nbb=B\r\nc=C\r\n')
        expect(caretOffsetOf(def, def.lines[0].id)).toBe(0)
        expect(caretOffsetOf(def, def.lines[2].id)).toBe(displayTextOf(def).indexOf('c=C'))
        expect(caretOffsetOf(def, 99 as LineId)).toBe(0)
    })

    test('the line under an offset counts the line breaks before it', () => {
        expect(lineIndexAtOffset('ab\ncd\n\nef', 0)).toBe(0)
        expect(lineIndexAtOffset('ab\ncd\n\nef', 2)).toBe(0)
        expect(lineIndexAtOffset('ab\ncd\n\nef', 3)).toBe(1)
        expect(lineIndexAtOffset('ab\ncd\n\nef', 7)).toBe(3)
    })

    test('R-D5: the row of a line is its own row, else the nearest row above', () => {
        const def = parseDefinition('a=A\n\ng=G=group\nc=C\ng_end=G=groupEnd\nd=D\n')
        const id = (index: number) => def.lines[index].id
        expect(rowAtLine(def, 0)).toBe(id(0))
        expect(rowAtLine(def, 1)).toBe(id(0))
        expect(rowAtLine(def, 3)).toBe(id(3))
        expect(rowAtLine(def, 4)).toBe(id(3))
        expect(rowAtLine(def, 5)).toBe(id(5))
        expect(rowAtLine(parseDefinition('\n\na=A\n'), 0)).toBeNull()
    })
})
