import fc from 'fast-check'
import { writable } from 'svelte/store'
import { describe, expect, test, vi } from 'vitest'

/**
 * The preview model against the chat panel's own model and the real engine parser. Every case is a new-behaviour guard
 * (class G): the module is new, so its red proof is the named mutant, not a run on the unchanged base. Fixtures are
 * toggle texts as the producers write them, with LF and CRLF endings.
 */

const h = vi.hoisted(() => ({
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
    getModuleToggles: () => '',
}) as unknown as typeof import('src/ts/process/modules'))

import { buildPanelModel, type PanelItem, type SourceInput } from 'src/ts/chatShell/togglePanel'
import { joinedPreviewInputs, panelIdOf, previewSourcesOf, withCurrentText } from './togglePreviewModel'
import { parseDefinition } from './toggleDef'
import { corpus, crlf, textArb } from './toggleDefFixtures.test-helpers'

const input = (id: string, text: string | undefined, kind: SourceInput['kind'] = 'module'): SourceInput => ({ id, kind, name: `name ${id}`, text })

/** The panel model of the inputs without the preview's extra fields. */
function stripped(inputs: readonly SourceInput[]) {
    return previewSourcesOf(inputs).map(({ id, kind, name, detail, items }) => ({ id, kind, name, detail, items }))
}

function itemsOf(source: { readonly items: readonly PanelItem[] }): PanelItem[] {
    return source.items.flatMap((item): PanelItem[] => item.type === 'group' ? [item, ...item.children] : [item])
}

// Lines: 0 divider, 1 repeated divider (skipped), 2 select, 3 blank, 4 dropped, 5 group, 6 row, 7 caption,
// 8 group end, 9 group with no row (removed), 10 its end, 11 text row.
const MIXED = [
    'intro=Intro=divider', 'intro=Intro=divider', 'tone=Tone=select=a,b', '', 'junk', 'g1=Group A=group', 'k1=K One',
    'cap=Note=caption', 'g1e=x=groupEnd', 'e=Empty=group', 'e2=x=groupEnd', 'last=Last=text',
].join('\n')

// Lines: 0 divider, 1 group with no row (removed), 2 its end, 3 same-label divider (then adjacent to its twin), 4 row.
const DIVIDER_AROUND_EMPTY_GROUP = ['d=D=divider', 'g=G=group', 'g2=x=groupEnd', 'd=D=divider', 'r=R'].join('\n')

describe('PV-1 the preview model is the chat panel model', () => {
    test('equals buildPanelModel on every corpus text, LF and CRLF', () => {
        const entries = [...corpus, { name: 'mixed', text: MIXED }, { name: 'divider around an empty group', text: DIVIDER_AROUND_EMPTY_GROUP }]
        for (const entry of entries) {
            for (const text of [entry.text, crlf(entry.text)]) {
                const inputs = [input('a', text), input('b', undefined, 'character')]
                expect(stripped(inputs), entry.name).toStrictEqual(buildPanelModel(inputs).sources)
            }
        }
    })

    test('equals buildPanelModel on generated texts, one to three sources', () => {
        fc.assert(fc.property(fc.array(textArb, { minLength: 1, maxLength: 3 }), (texts) => {
            const inputs = texts.map((text, index) => input(`s${index}`, text))
            expect(stripped(inputs)).toStrictEqual(buildPanelModel(inputs).sources)
        }), { numRuns: 400, seed: 20261118 })
    })

    test('a repeated same-label divider consumes no uid, so the row after it keeps the panel uid', () => {
        const [source] = previewSourcesOf([input('m', 'd=D=divider\nd=D=divider\nr=R')])
        expect(source.items.map((item) => item.uid)).toStrictEqual(['m#0', 'm#1'])
        expect(source.lineOf.get('m#1')).toBe(2)
    })

    test('a group with no value row is removed and a same-label divider it separated is shown once', () => {
        const [source] = previewSourcesOf([input('m', DIVIDER_AROUND_EMPTY_GROUP)])
        expect(source.items.map((item) => item.type)).toStrictEqual(['divider', 'row'])
        expect(source.items.map((item) => item.uid)).toStrictEqual(['m#0', 'm#3'])
    })
})

describe('PV-2 every item names the line that produced it', () => {
    test('literal: indexes skip blank, dropped, repeated-divider and removed-group lines', () => {
        const [source] = previewSourcesOf([input('m', MIXED)])
        expect([...source.lineOf.entries()]).toStrictEqual([['m#0', 0], ['m#1', 2], ['m#2', 5], ['m#3', 6], ['m#4', 7], ['m#6', 11]])
    })

    test('literal: the divider and the row around a removed group', () => {
        const [source] = previewSourcesOf([input('m', DIVIDER_AROUND_EMPTY_GROUP)])
        expect([...source.lineOf.entries()]).toStrictEqual([['m#0', 0], ['m#3', 4]])
    })

    test('every shown uid maps to a line of its own kind, and only shown uids are mapped', () => {
        fc.assert(fc.property(textArb, (text) => {
            const [source] = previewSourcesOf([input('m', text)])
            const def = parseDefinition(text)
            const shown = itemsOf(source)
            expect([...source.lineOf.keys()].sort()).toStrictEqual(shown.map((item) => item.uid).sort())
            for (const item of shown) {
                const line = def.lines[source.lineOf.get(item.uid) as number]
                if (item.type === 'row') {
                    expect(line.form.kind).toBe('value')
                    expect(line.parts[0]).toBe(item.key)
                    expect(line.parts[1]).toBe(item.label)
                } else {
                    expect(line.form.kind).toBe(item.type)
                    expect(line.parts[1] ?? line.parts[0] ?? '').toBe(item.label)
                }
            }
        }), { numRuns: 400, seed: 20261118 })
    })
})

describe('PV-3 unreadable counts dropped lines only', () => {
    test('blank and whitespace-only lines are not counted; the three dropped shapes are', () => {
        const [source] = previewSourcesOf([input('m', 'a=A\n\n  \n\t\nbad\n=x\nk=\ng=G=group')])
        expect(source.unreadable).toBe(3)
    })

    test('a text with nothing wrong counts none, and a missing text is an empty source', () => {
        const sources = previewSourcesOf([input('m', 'a=A\nb=B=text\n'), input('n', undefined)])
        expect(sources.map((source) => source.unreadable)).toStrictEqual([0, 0])
        expect(sources[1].items).toStrictEqual([])
    })
})

describe('PV-4 panel ids and the current text', () => {
    test('panelIdOf names the source as toggleSourcesOf does', () => {
        expect(panelIdOf({ kind: 'character', chaId: 'cha-1' })).toBe('character:cha-1')
        expect(panelIdOf({ kind: 'module', moduleId: 'mod-7' })).toBe('module:mod-7')
        expect(panelIdOf({ kind: 'module', moduleId: 'Name With Spaces' })).toBe('module:Name With Spaces')
    })

    test('withCurrentText replaces only the matching input and keeps the rest as they were', () => {
        const inputs = [input('prompt', 'p=P', 'prompt'), input('module:m1', 'm=M'), input('character:c1', 'c=C', 'character')]
        const replaced = withCurrentText(inputs, { panelId: 'module:m1', text: 'x=X' })
        expect(replaced.map((entry) => entry.text)).toStrictEqual(['p=P', 'x=X', 'c=C'])
        expect(replaced[1]).toStrictEqual({ ...inputs[1], text: 'x=X' })
        expect(replaced[0]).toBe(inputs[0])
        expect(replaced[2]).toBe(inputs[2])
        expect(inputs[1].text).toBe('m=M')
    })

    test('no match, or no current text, leaves the texts as they were', () => {
        const inputs = [input('module:m1', 'm=M')]
        expect(withCurrentText(inputs, { panelId: 'module:other', text: 'x=X' })).toStrictEqual(inputs)
        expect(withCurrentText(inputs, null)).toStrictEqual(inputs)
        expect(withCurrentText(inputs, null)).not.toBe(inputs)
    })
})

describe('PV-5 a private bound character never reaches the joined preview', () => {
    const sources = (): SourceInput[] => [
        input('prompt', 'p=P', 'prompt'),
        input('module:m1', 'm=M'),
        input('character:c1', 'secret=Secret', 'character'),
    ]
    const ids = (list: readonly SourceInput[]) => list.map((entry) => entry.id)

    test.each([
        ['character', 'character:c1'],
        ['module', 'module:m1'],
        ['preset', 'prompt'],
        ['no current owner', null],
    ])('removes the character source when the current owner is %s', (_name, panelId) => {
        const current = panelId === null ? null : { panelId, text: 'edited=Edited' }
        const joined = joinedPreviewInputs(sources(), { chaId: 'c1', license: 'private' }, current)
        expect(ids(joined)).toStrictEqual(['prompt', 'module:m1'])
        expect(joined.every((entry) => entry.id !== 'character:c1' && !entry.text?.includes('secret'))).toBe(true)
    })

    test('the current text of the other owners still applies', () => {
        const joined = joinedPreviewInputs(sources(), { chaId: 'c1', license: 'private' }, { panelId: 'module:m1', text: 'edited=Edited' })
        expect(joined.map((entry) => entry.text)).toStrictEqual(['p=P', 'edited=Edited'])
    })

    test('a public or unlicensed character is kept, with its current text applied', () => {
        for (const license of [undefined, '', 'public']) {
            const joined = joinedPreviewInputs(sources(), { chaId: 'c1', license }, { panelId: 'character:c1', text: 'edited=Edited' })
            expect(ids(joined)).toStrictEqual(['prompt', 'module:m1', 'character:c1'])
            expect(joined[2].text).toBe('edited=Edited')
        }
    })

    test('only the bound character is removed: another character source stays', () => {
        const list = [...sources(), input('character:c2', 'other=Other', 'character')]
        expect(ids(joinedPreviewInputs(list, { chaId: 'c1', license: 'private' }, null))).toStrictEqual(['prompt', 'module:m1', 'character:c2'])
    })
})
