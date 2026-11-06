/**
 * Toggle search and the on-only filter (UI-S1b stage F3, TOGGLES_SPEC §6): what a query matches, the one-jamo rule,
 * the breadcrumb path and the option-only line, the unique-key counts. Guards by construction: the module is new.
 */
import { writable } from 'svelte/store'
import { describe, expect, test, vi } from 'vitest'

// The model parses toggle text through util, which reaches the stores; plain stand-ins keep the parser real and the stores out.
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
    DBState: { db: {} },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
}) as unknown as typeof import('src/ts/stores.svelte'))

import { buildPanelModel, type PanelSource, type PanelValueRow } from './togglePanel'
import { choseongOf, filterPanel, textMatches } from './toggleSearch'

const rowsOf = (result: ReturnType<typeof filterPanel>): string[] =>
    result.sources.flatMap((entry) => entry.items.flatMap((item) => (item.type === 'row' ? [item.key] : item.type === 'group' ? item.children.flatMap((child) => (child.type === 'row' ? [child.key] : [])) : [])))

function sourcesOf(...texts: [string, string, string?][]): PanelSource[] {
    return buildPanelModel(texts.map(([id, text, name], index) => ({ id, kind: index === 0 ? 'prompt' : 'module', name: name ?? id, text }))).sources
}

const always = () => true

describe('choseongOf', () => {
    test('a Hangul syllable becomes its initial consonant; everything else passes through, lower-cased', () => {
        expect(choseongOf('서술 Style')).toBe('ㅅㅅ style')
        expect(choseongOf('값 ㄱ1')).toBe('ㄱ ㄱ1')
    })
})

describe('textMatches', () => {
    test('a Latin query is case-insensitive and may sit anywhere', () => {
        expect(textMatches('Narration Style', 'style')).toBe(true)
        expect(textMatches('Narration Style', 'RATION')).toBe(true)
        expect(textMatches('Narration Style', 'zzz')).toBe(false)
    })

    test('one jamo matches only the start of a word', () => {
        expect(textMatches('서술 스타일', 'ㅅ')).toBe(true)
        expect(textMatches('아이템 목록', 'ㅁ')).toBe(true)
        // ㅌ is the third consonant of both: never the start of a word.
        expect(textMatches('서술 스타일', 'ㅌ')).toBe(false)
        expect(textMatches('아이템 목록', 'ㅌ')).toBe(false)
        expect(textMatches('서술 스타일', 'ㅇ')).toBe(false)
    })

    test('two or more jamo match anywhere in the consonants of the text', () => {
        expect(textMatches('서술 스타일', 'ㅅㅌ')).toBe(true)
        expect(textMatches('서술 스타일', 'ㅌㅇ')).toBe(true)
        expect(textMatches('서술 스타일', 'ㅅㅅㅅ')).toBe(true)
        expect(textMatches('서술 스타일', 'ㅁㅁ')).toBe(false)
    })

    test('a syllable query is a plain substring', () => {
        expect(textMatches('서술 스타일', '술 스')).toBe(true)
        expect(textMatches('서술 스타일', '목록')).toBe(false)
    })
})

describe('filterPanel', () => {
    const sources = sourcesOf(
        ['prompt', 'tone=서술 스타일=select=대담하게,차분하게\nscene=Scene card', 'Prompt'],
        ['module:m', 'plain=Plain toggle\nextras=Extras=group\ninner=Inner switch\nother=Other=text\nend=end=groupEnd', 'Narrator pack'],
    )

    test('label, key, option label, section name and group name all match; a row that matched only by an option says which', () => {
        const byLabel = filterPanel(sources, { query: 'scene', onlyOn: false, passesOn: always })
        expect(rowsOf(byLabel)).toEqual(['scene'])
        expect(byLabel.sources[0].matches.get(byLabel.sources[0].items[0].uid)).toEqual({ path: ['Prompt'], option: null })

        expect(rowsOf(filterPanel(sources, { query: 'TONE', onlyOn: false, passesOn: always }))).toEqual(['tone'])

        const byOption = filterPanel(sources, { query: '대담', onlyOn: false, passesOn: always })
        expect(rowsOf(byOption)).toEqual(['tone'])
        expect(byOption.sources[0].matches.get(byOption.sources[0].items[0].uid)).toEqual({ path: ['Prompt'], option: '대담하게' })

        expect(rowsOf(filterPanel(sources, { query: 'narrator', onlyOn: false, passesOn: always }))).toEqual(['plain', 'inner', 'other'])
        expect(rowsOf(filterPanel(sources, { query: 'extras', onlyOn: false, passesOn: always }))).toEqual(['inner', 'other'])
    })

    test('a hit inside an author group keeps only the matching rows of the group and the path names the group', () => {
        const result = filterPanel(sources, { query: 'inner', onlyOn: false, passesOn: always })
        expect(result.sources).toHaveLength(1)
        const group = result.sources[0].items[0]
        expect(group.type).toBe('group')
        if (group.type !== 'group') return
        expect(group.children.map((child) => (child as PanelValueRow).key)).toEqual(['inner'])
        expect(result.sources[0].matches.get(group.children[0].uid)).toEqual({ path: ['Narrator pack', 'Extras'], option: null })
    })

    test('sections with no hit are left out', () => {
        const result = filterPanel(sources, { query: 'scene', onlyOn: false, passesOn: always })
        expect(result.sources.map((entry) => entry.source.id)).toEqual(['prompt'])
    })

    test('the on-only filter keeps rows that pass and drops sections that end up empty; with a query both apply', () => {
        const on = (row: PanelValueRow) => row.key === 'tone' || row.key === 'inner'
        expect(rowsOf(filterPanel(sources, { query: '', onlyOn: true, passesOn: on }))).toEqual(['tone', 'inner'])
        expect(rowsOf(filterPanel(sources, { query: 'inner', onlyOn: true, passesOn: on }))).toEqual(['inner'])
        expect(rowsOf(filterPanel(sources, { query: 'scene', onlyOn: true, passesOn: on }))).toEqual([])
        expect(filterPanel(sources, { query: 'scene', onlyOn: true, passesOn: on }).sources).toEqual([])
    })

    test('shown and total count distinct keys: a key defined by two sources counts once', () => {
        const dup = sourcesOf(['prompt', 'k=Shared\nonly=Only here'], ['module:m', 'k=Shared too'])
        const result = filterPanel(dup, { query: 'shared', onlyOn: false, passesOn: always })
        expect(result.shown).toBe(1)
        expect(result.total).toBe(2)
        expect(filterPanel(dup, { query: 'nothing', onlyOn: false, passesOn: always })).toMatchObject({ shown: 0, total: 2, sources: [] })
    })

    test('an empty query with the filter off lists every row', () => {
        expect(rowsOf(filterPanel(sources, { query: '  ', onlyOn: false, passesOn: always }))).toEqual(['tone', 'scene', 'plain', 'inner', 'other'])
    })
})
