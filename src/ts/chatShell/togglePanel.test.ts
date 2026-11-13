import { writable } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * The toggles panel model (UI-S1b stage F2, TOGGLES_SPEC §3-§4). Every case is a guard by construction: the module is
 * new, so the unchanged base cannot run it; its red proof is the mutants in the stage report. The key source of the
 * chat-only scope (`currentScopeKeys`) is the real one, fed the same texts.
 */

const h = vi.hoisted(() => ({
    moduleToggles: '',
    db: { globalChatVariables: {} as Record<string, string>, customPromptTemplateToggle: '', jailbreakToggle: false } as Record<string, unknown>,
}))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    appVer: '1234.5.67',
    getCurrentCharacter: () => undefined,
    getCurrentChat: () => undefined,
    getDatabase: () => ({}),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
    readImage: () => Promise.resolve(undefined),
}))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: h.db },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))
vi.mock(import('src/ts/process/modules'), () => ({
    getModuleToggles: () => h.moduleToggles,
}) as unknown as typeof import('src/ts/process/modules'))

import { currentScopeKeys } from 'src/ts/parser/chatToggleScope'
import {
    buildPanelModel,
    defaultOpenSections,
    duplicateBadges,
    isOn,
    panelKeys,
    rememberSourceOpen,
    resetTogglePanelSession,
    resetValue,
    selectControl,
    selectedIndex,
    shownText,
    sourceCounts,
    sourceOpenChoice,
    takeSavedFlash,
    toggleVarKey,
    uniqueCounts,
    valueRowsOf,
    type PanelSource,
    type SourceInput,
} from './togglePanel'

const input = (id: string, text: string, kind: SourceInput['kind'] = 'module'): SourceInput => ({ id, kind, name: id, text })
const none = () => 'null'

beforeEach(() => {
    resetTogglePanelSession()
})

describe('sources and groups', () => {
    test('each source is parsed on its own and an unclosed group ends with its source', () => {
        const model = buildPanelModel([
            input('prompt', 'a=A\nopen=Open group=group\ng1=In group', 'prompt'),
            input('module:m', 'b=B\nc=C=select=x,y'),
        ])
        const [prompt, module] = model.sources
        expect(prompt.items.map((item) => item.type)).toEqual(['row', 'group'])
        const group = prompt.items[1]
        expect(group.type === 'group' && group.children.map((child) => child.type === 'row' && child.key)).toEqual(['g1'])
        // The module's rows stay outside the prompt's still-open group.
        expect(module.items.map((item) => item.type)).toEqual(['row', 'row'])
        expect(valueRowsOf(module).map((row) => row.key)).toEqual(['b', 'c'])
    })

    test('rows keep their kind and options; captions and dividers are items; repeated dividers show once; an empty group is dropped', () => {
        const model = buildPanelModel([input('s', [
            'a=Check',
            'b=Pick=select=one,two,three',
            'c=Say=text',
            'd=Long=textarea',
            'x=Note=caption',
            '-=Part=divider',
            '-=Part=divider',
            'e=Empty group=group',
            'e=end=groupEnd',
        ].join('\n'))])
        const items = model.sources[0].items
        expect(items.map((item) => item.type)).toEqual(['row', 'row', 'row', 'row', 'caption', 'divider'])
        const rows = valueRowsOf(model.sources[0])
        expect(rows.map((row) => row.kind)).toEqual(['check', 'select', 'text', 'textarea'])
        expect(rows[1].options).toEqual(['one', 'two', 'three'])
    })

    test('a same-label divider repeated around an empty group shows once', () => {
        const model = buildPanelModel([input('s', [
            '-=Part=divider',
            'e=Empty group=group',
            'e=end=groupEnd',
            '-=Part=divider',
            'a=Check',
        ].join('\n'))])
        expect(model.sources[0].items.map((item) => item.type)).toEqual(['divider', 'row'])
    })

    test('a same-label divider repeated around a caption-only group shows once', () => {
        const model = buildPanelModel([input('s', [
            '-=Part=divider',
            'g=Note group=group',
            'x=Note=caption',
            'g=end=groupEnd',
            '-=Part=divider',
            'a=Check',
        ].join('\n'))])
        expect(model.sources[0].items.map((item) => item.type)).toEqual(['divider', 'row'])
    })

    test('dividers with different labels around an empty group both show', () => {
        const model = buildPanelModel([input('s', [
            '-=One=divider',
            'e=Empty group=group',
            'e=end=groupEnd',
            '-=Two=divider',
        ].join('\n'))])
        expect(model.sources[0].items.map((item) => item.type === 'divider' && item.label)).toEqual(['One', 'Two'])
    })

    test('a group with a toggle row between two same-label dividers keeps both dividers', () => {
        const model = buildPanelModel([input('s', [
            '-=Part=divider',
            'g=Full group=group',
            'g1=In group',
            'g=end=groupEnd',
            '-=Part=divider',
        ].join('\n'))])
        expect(model.sources[0].items.map((item) => item.type)).toEqual(['divider', 'group', 'divider'])
    })

    test('a source with no text has no items and counts nothing', () => {
        const model = buildPanelModel([{ id: 'character:c', kind: 'character', name: 'Ari', text: undefined }])
        expect(model.sources[0].items).toEqual([])
        expect(model.sources[0].detail).toBe('')
        expect(uniqueCounts(model, none)).toEqual({ n: 0, on: 0 })
    })
})

describe('what "on" means (DD-083)', () => {
    test.each([
        ['check', '1', true], ['check', '0', false], ['check', 'null', false], ['check', '', false],
        // A select that was never set reads 'null' and sits on the first option, so it is off.
        ['select', 'null', false], ['select', '', false], ['select', '0', false], ['select', '2', true],
        ['text', 'null', false], ['text', '', false], ['text', 'hello', true],
        ['textarea', 'null', false], ['textarea', 'x', true],
    ] as const)('%s with %j is %s', (kind, value, expected) => {
        expect(isOn(kind, value)).toBe(expected)
    })

    test('reset writes off, the first option, or empty', () => {
        expect(resetValue('check')).toBe('0')
        expect(resetValue('select')).toBe('0')
        expect(resetValue('text')).toBe('')
        expect(resetValue('textarea')).toBe('')
    })

    test('a select shows its stored index when it is in range, else the first option; an unset text is empty', () => {
        expect(selectedIndex('2', ['a', 'b', 'c'])).toBe(2)
        expect(selectedIndex('null', ['a', 'b', 'c'])).toBe(0)
        expect(selectedIndex('9', ['a', 'b', 'c'])).toBe(0)
        expect(selectedIndex('', ['a', 'b', 'c'])).toBe(0)
        expect(shownText('null')).toBe('')
        expect(shownText('hi')).toBe('hi')
    })
})

describe('counts', () => {
    const model = buildPanelModel([
        input('prompt', 'a=A\nb=B=select=x,y\nk=Shared', 'prompt'),
        input('module:m', 'k=Shared too\nc=C=text'),
    ])
    const values: Record<string, string> = { a: '1', b: '1', k: '1', c: 'hi' }
    const read = (key: string) => values[key] ?? 'null'

    test('a section counts its own rows', () => {
        expect(sourceCounts(model.sources[0], read)).toEqual({ n: 3, on: 3 })
        expect(sourceCounts(model.sources[1], read)).toEqual({ n: 2, on: 2 })
    })

    test('the summary counts a key defined by two sources once', () => {
        expect(uniqueCounts(model, read)).toEqual({ n: 4, on: 4 })
        expect(uniqueCounts(model, none)).toEqual({ n: 4, on: 0 })
    })

    test('panelKeys lists each key once, prompt first, as the stored variable names', () => {
        expect(panelKeys(model)).toEqual(['toggle_a', 'toggle_b', 'toggle_k', 'toggle_c'])
        expect(toggleVarKey('a')).toBe('toggle_a')
    })
})

describe('duplicate keys', () => {
    const model = buildPanelModel([
        input('prompt', 'k=As check\nm=Mixed', 'prompt'),
        { id: 'module:x', kind: 'module', name: 'Module X', text: 'k=As check too\nm=Mixed as select=select=a,b' },
        { id: 'character:c', kind: 'character', name: 'Ari', text: 'solo=Alone\nt=Text=text' },
    ])
    const row = (source: PanelSource, key: string) => valueRowsOf(source).find((candidate) => candidate.key === key)!

    test('the same kind links to the other source; different kinds warn', () => {
        expect(duplicateBadges(model, 'prompt', row(model.sources[0], 'k'))).toEqual([{ sourceName: 'Module X', mismatch: false }])
        expect(duplicateBadges(model, 'prompt', row(model.sources[0], 'm'))).toEqual([{ sourceName: 'Module X', mismatch: true }])
        expect(duplicateBadges(model, 'module:x', row(model.sources[1], 'k'))).toEqual([{ sourceName: 'prompt', mismatch: false }])
    })

    test('a key defined once has no badge', () => {
        expect(duplicateBadges(model, 'character:c', row(model.sources[2], 'solo'))).toEqual([])
    })

    test('a text and a textarea of one key are the same kind', () => {
        const pair = buildPanelModel([input('a', 'q=Q=text'), input('b', 'q=Q=textarea')])
        expect(duplicateBadges(pair, 'a', valueRowsOf(pair.sources[0])[0])).toEqual([{ sourceName: 'b', mismatch: false }])
    })
})

describe('default open sections (DD-084, DD-085)', () => {
    const lines = (prefix: string, n: number) => Array.from({ length: n }, (_, index) => `${prefix}${index}=${prefix} ${index}`).join('\n')

    test('up to 20 toggles in all: every section starts open', () => {
        const model = buildPanelModel([input('s1', lines('a', 10)), input('s2', lines('b', 10))])
        expect(Array.from(defaultOpenSections(model, none))).toEqual(['s1', 's2'])
    })

    test('above 20: the first section, then sections with a toggle on, until about 25 rows show', () => {
        const model = buildPanelModel([
            input('s1', lines('a', 12)),
            input('s2', lines('b', 12)),
            input('s3', lines('c', 12)),
            input('s4', lines('d', 12)),
        ])
        const read = (key: string) => (key === 'b0' || key === 'c0' || key === 'd0' ? '1' : 'null')
        // s1 (first) shows 12; s2 has an on toggle and 12 < 25, so it opens; 24 < 25, so s3 opens; 36 is over the cap, so s4 stays folded.
        expect(Array.from(defaultOpenSections(model, read))).toEqual(['s1', 's2', 's3'])
    })

    test('above 20 with nothing on: only the first section', () => {
        const model = buildPanelModel([input('s1', lines('a', 12)), input('s2', lines('b', 12))])
        expect(Array.from(defaultOpenSections(model, none))).toEqual(['s1'])
    })

    test('rows inside author groups do not count toward the cap', () => {
        const grouped = `g=Group=group\n${lines('in', 30)}\ng=end=groupEnd\n${lines('top', 3)}`
        const model = buildPanelModel([input('s1', grouped), input('s2', lines('b', 2))])
        const read = (key: string) => (key === 'b0' ? '1' : 'null')
        expect(Array.from(defaultOpenSections(model, read))).toEqual(['s1', 's2'])
    })
})

describe('select control (decided from the option text, not the UI language)', () => {
    test('two short options sit on the label line', () => {
        expect(selectControl('Mode', ['On', 'Off'])).toBe('inline')
        expect(selectControl('모드', ['켜기', '끄기'])).toBe('inline')
    })

    test('longer labels or options move under the label; more than three, or very long, open a list', () => {
        expect(selectControl('A label that is far too long to share a line', ['On', 'Off'])).toBe('stacked')
        expect(selectControl('Mode', ['Short', 'Medium', 'Longer'])).toBe('stacked')
        expect(selectControl('Mode', ['a', 'b', 'c', 'd'])).toBe('list')
        expect(selectControl('Mode', ['This option is far too long', 'Two'])).toBe('list')
        expect(selectControl('Mode', ['only one'])).toBe('list')
    })

    test('the same width limit holds in either script: five Korean characters are as wide as eight Latin ones', () => {
        expect(selectControl('Mode', ['abcdefg', 'abcdefg'])).toBe('inline')
        expect(selectControl('Mode', ['abcdefgh', 'abcdefgh'])).toBe('stacked')
        expect(selectControl('모드', ['가나다라', '가나다라'])).toBe('inline')
        expect(selectControl('모드', ['가나다라마', '가나다라마'])).toBe('stacked')
    })
})

describe('session memory', () => {
    test('a remembered section choice wins and can be read back', () => {
        expect(sourceOpenChoice('s')).toBeUndefined()
        rememberSourceOpen('s', false)
        expect(sourceOpenChoice('s')).toBe(false)
        rememberSourceOpen('s', true)
        expect(sourceOpenChoice('s')).toBe(true)
    })

    test('the "saved to" flash is offered once per session', () => {
        expect(takeSavedFlash()).toBe(true)
        expect(takeSavedFlash()).toBe(false)
        resetTogglePanelSession()
        expect(takeSavedFlash()).toBe(true)
    })
})

describe('X1: one key set', () => {
    test('40 toggles spread over prompt, modules and character give the keys the scope engine copies', () => {
        const lines = (prefix: string, n: number) => Array.from({ length: n }, (_, index) => `${prefix}${index}=${prefix} ${index}=${index % 3 === 0 ? 'text' : ''}`)
        const prompt = lines('p', 14).join('\n')
        const moduleA = lines('m', 12).join('\n')
        const moduleB = `${lines('n', 8).join('\n')}\np3=Duplicate of a prompt key`
        const character = [...lines('c', 6), 'group=Group=group', 'g1=In group', 'group=end=groupEnd', 'cap=Caption=caption', 'dv=Divider=divider'].join('\n')
        h.db.customPromptTemplateToggle = prompt
        h.moduleToggles = `\n${moduleA}\n\n${moduleB}\n`
        const model = buildPanelModel([
            input('prompt', prompt, 'prompt'),
            input('module:a', moduleA),
            input('module:b', moduleB),
            input('character:c', character, 'character'),
        ])
        expect(panelKeys(model)).toEqual(currentScopeKeys({ chaId: 'c', customModuleToggle: character }))
        expect(panelKeys(model)).toHaveLength(14 + 12 + 8 + 6 + 1)
    })
})
