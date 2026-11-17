import { describe, expect, test } from 'vitest'
import { createMacroIndex, type MacroEntry } from './macroIndex'
import { MACRO_ROWS, type MacroRow } from './macroGroups'
import { filterPicks, insertionFor, insertionForName, macroTrigger, pickItems, stripBottom, type PickItem } from './macroPick'

function entry(name: string, extra: Partial<MacroEntry> = {}): MacroEntry {
    return { name, aliases: [], summary: `${name} summary`, usage: null, docOnly: false, internalOnly: false, blockSyntax: name.startsWith('#') || name.startsWith(':'), deprecated: null, ...extra }
}

function item(name: string, label: string, aliases: readonly string[] = []): PickItem {
    return { key: name, name, aliases, label, usage: null, insertion: { text: name, caret: name.length }, group: null }
}

function row(id: string): MacroRow {
    const found = MACRO_ROWS.find((candidate) => candidate.id === id)
    if (!found) throw new Error(`no row ${id}`)
    return found
}

describe('macroTrigger', () => {
    test('C2-U1 the open {{ before the caret and the name typed after it', () => {
        expect(macroTrigger('abc {{')).toEqual({ start: 4, query: '' })
        expect(macroTrigger('{{ge')).toEqual({ start: 0, query: 'ge' })
        expect(macroTrigger('x {{#i')).toEqual({ start: 2, query: '#i' })
        expect(macroTrigger('{{ㅂ')).toEqual({ start: 0, query: 'ㅂ' })
    })

    test('C2-U1 no trigger once an argument, a closer or a space follows', () => {
        expect(macroTrigger('{{get::')).toBeNull()
        expect(macroTrigger('{{a}}')).toBeNull()
        expect(macroTrigger('{{a b')).toBeNull()
        expect(macroTrigger('{{#if x')).toBeNull()
        expect(macroTrigger('plain')).toBeNull()
    })

    test('the nearest {{ wins', () => {
        expect(macroTrigger('{{a}} {{b')).toEqual({ start: 6, query: 'b' })
    })
})

describe('insertionFor', () => {
    test('C2-U3 plain, args, else and comment', () => {
        expect(insertionFor(row('char'))).toEqual({ text: '{{char}}', caret: 8 })
        expect(insertionFor(row('getvar'))).toEqual({ text: '{{getvar::}}', caret: 10 })
        expect(insertionFor(row('else'))).toEqual({ text: '{{:else}}', caret: 9 })
        expect(insertionFor(row('comment'))).toEqual({ text: '{{// }}', caret: 5 })
    })

    test('C2-U3 a block keeps its closer; the caret is at the condition when the head ends with a space', () => {
        expect(insertionFor(row('if'))).toEqual({ text: '{{#if }}{{/if}}', caret: 6 })
        expect(insertionFor(row('when'))).toEqual({ text: '{{#when }}{{/when}}', caret: 8 })
    })

    test('C2-U3 a head without a condition puts the caret after the opener, not inside it', () => {
        expect(insertionFor(row('pure'))).toEqual({ text: '{{#pure}}{{/pure}}', caret: 9 })
        expect(insertionFor(row('pure_display'))).toEqual({ text: '{{#pure_display}}{{/pure_display}}', caret: 17 })
    })

    test('C2-x33 the if_pure row closes with its own name', () => {
        expect(insertionFor(row('if_pure'))).toEqual({ text: '{{#if_pure }}{{/if_pure}}', caret: 11 })
    })

    test('an entry no row covers inserts its name between braces', () => {
        expect(insertionForName('tex')).toEqual({ text: '{{tex}}', caret: 7 })
    })
})

describe('filterPicks', () => {
    const items = [
        item('getvar', 'Read a variable'),
        item('setvar', 'Write a variable'),
        item('char', 'Character name', ['bot']),
        item('trim', '변수 값 읽기'),
        item('upper', 'Upper case'),
    ]

    test('an empty query keeps everything in order', () => {
        expect(filterPicks(items, '').map((entry) => entry.name)).toEqual(['getvar', 'setvar', 'char', 'trim', 'upper'])
    })

    test('C2-U2 name prefix, alias prefix and label text', () => {
        expect(filterPicks(items, 'get').map((entry) => entry.name)).toEqual(['getvar'])
        expect(filterPicks(items, 'bo').map((entry) => entry.name)).toEqual(['char'])
        expect(filterPicks(items, 'variable').map((entry) => entry.name)).toEqual(['getvar', 'setvar'])
    })

    test('C2-U2 initial consonants match a Korean label; a lone jamo only at a word start', () => {
        expect(filterPicks(items, 'ㅂㅅ').map((entry) => entry.name)).toEqual(['trim'])
        expect(filterPicks(items, 'ㅅ')).toEqual([])
    })

    test('C2-U2 rank: exact, name prefix, alias prefix, label; equal ranks keep their order', () => {
        const ranked = [
            item('later', 'has ab inside'),
            item('abc', 'x'),
            item('xx', 'x', ['abz']),
            item('ab', 'x'),
            item('abd', 'x'),
        ]
        expect(filterPicks(ranked, 'ab').map((entry) => entry.name)).toEqual(['ab', 'abc', 'abd', 'xx', 'later'])
    })

    test('C2-x22 an exact alias ranks before a name prefix', () => {
        const ranked = [item('gearbox', 'x'), item('other', 'x', ['ge'])]
        expect(filterPicks(ranked, 'ge').map((entry) => entry.name)).toEqual(['other', 'gearbox'])
    })

    test('the match is case-insensitive', () => {
        expect(filterPicks(items, 'GET').map((entry) => entry.name)).toEqual(['getvar'])
    })
})

describe('pickItems', () => {
    const label = (id: string): string => `label:${id}`

    test('every table row is offered in order, with its usage from the registry', () => {
        const index = createMacroIndex([entry('char', { usage: '{{char}}' }), entry('#if', { usage: '{{#if x}}' }), entry(':else', { usage: '{{:else}}' }), entry('//', { docOnly: true, usage: '{{// n}}' })])
        const items = pickItems(MACRO_ROWS, index, label)
        expect(items.slice(0, MACRO_ROWS.length).map((entry) => entry.key)).toEqual(MACRO_ROWS.map((candidate) => `row:${candidate.id}`))
        expect(items.find((entry) => entry.key === 'row:char')?.usage).toBe('{{char}}')
        expect(items.find((entry) => entry.key === 'row:if')?.usage).toBe('{{#if x}}')
        expect(items.find((entry) => entry.key === 'row:else')?.usage).toBe('{{:else}}')
        expect(items.find((entry) => entry.key === 'row:comment')?.usage).toBe('{{// n}}')
        expect(items.find((entry) => entry.key === 'row:func')?.usage).toBeNull()
        expect(items.find((entry) => entry.key === 'row:if')?.label).toBe('label:if')
    })

    test('C2-U5 other items: not deprecated, not doc-only, not a block entry, once, none a row reaches', () => {
        const index = createMacroIndex([
            entry('char'),
            entry('tex', { aliases: ['latex'] }),
            entry('old', { deprecated: { message: 'gone' } }),
            entry('asset', { docOnly: true }),
            entry('#each', { aliases: [':each'] }),
            entry('time'),
            entry('time', { summary: 'the later time' }),
            entry('Odd'),
        ])
        const others = pickItems(MACRO_ROWS, index, label).filter((candidate) => candidate.group === null)
        expect(others.map((candidate) => candidate.name)).toEqual(['tex'])
        expect(others[0].label).toBe('tex summary')
        expect(others[0].insertion).toEqual({ text: '{{tex}}', caret: 7 })
    })

    test('M65 an entry flagged as written in block syntax is not offered as another macro, even when typing its name works', () => {
        const index = createMacroIndex([
            entry('zz', { blockSyntax: true }),
            entry('good'),
        ])
        expect(index.typedNameWorks(index.entries[0])).toBe(true)
        const others = pickItems(MACRO_ROWS, index, label).filter((candidate) => candidate.group === null)
        expect(others.map((candidate) => candidate.key)).toEqual(['other:good'])
    })

    test('C2-x17 a macro row carries the aliases of its registry entry, so the alias finds it', () => {
        const index = createMacroIndex([entry('user', { aliases: ['u'] })])
        const items = pickItems(MACRO_ROWS, index, label)
        expect(items.find((candidate) => candidate.key === 'row:user')?.aliases).toEqual(['u'])
        expect(filterPicks(items, 'u').map((candidate) => candidate.key)[0]).toBe('row:user')
    })

    test('C2-x20 a block row is named by its trimmed head', () => {
        const items = pickItems(MACRO_ROWS, createMacroIndex([]), label)
        expect(items.find((candidate) => candidate.key === 'row:if')?.name).toBe('#if')
        expect(items.find((candidate) => candidate.key === 'row:pure')?.name).toBe('#pure')
    })

    test('C2-U5 a shadowed entry is not offered; the one the engine runs is reached by its row', () => {
        const index = createMacroIndex([entry('time', { summary: 'first' }), entry('time', { summary: 'second' })])
        expect(pickItems(MACRO_ROWS, index, label).filter((candidate) => candidate.group === null)).toEqual([])
    })
})

describe('stripBottom', () => {
    test('C2-C5 the strip sits above the part of the window the keyboard covers', () => {
        expect(stripBottom(800, { height: 400, offsetTop: 0 })).toBe(400)
        expect(stripBottom(800, { height: 800, offsetTop: 0 })).toBe(0)
        expect(stripBottom(800, { height: 400, offsetTop: 100 })).toBe(300)
        expect(stripBottom(800, { height: 900, offsetTop: 0 })).toBe(0)
    })
})
