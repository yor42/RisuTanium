import { describe, expect, test } from 'vitest'
import type { loreBook } from '../storage/database.svelte'
import { buildOwnerModel } from './ownerModel'
import type { ItemTextSources } from './itemText'
import type { SearchWork } from './searchRunner'
import {
    SNIPPET_CONTEXT,
    chipOfKind,
    createSearchWork,
    markedSegmentsOf,
    matchItem,
    placementOf,
    planSearch,
    prepareQuery,
    searchWordsOf,
    type MatchTarget,
    type SearchChip,
    type SearchLabels,
    type SearchResult,
} from './studioSearch'
import {
    loreBody,
    makeCharacter,
    makeChat,
    makeInput,
    makePreset,
    makeScaleFixture,
    regexBody,
    residentModule,
    stubModule,
    watchBodyKeys,
} from './studioFixtures.test-helpers'

function target(label: string, texts: string[] = [], kindLabel = 'Lorebook'): MatchTarget {
    return { label, kindLabel, texts: () => texts }
}

const joined = (segments: { text: string }[]): string => segments.map((segment) => segment.text).join('')
const markedWords = (segments: { text: string, marked: boolean }[]): string[] => segments.filter((segment) => segment.marked).map((segment) => segment.text)

describe('5a every word must match, in any order', () => {
    test('words match the name, the kind name or the text, in any order', () => {
        const query = prepareQuery('castle king')
        expect(matchItem(query, target('King of the Castle'))).not.toBeNull()
        expect(matchItem(prepareQuery('king castle'), target('King of the Castle'))).not.toBeNull()
        // One word by the name, the other by the text.
        expect(matchItem(query, target('Castle', ['the king lives here']))).not.toBeNull()
        // One word by the kind name.
        expect(matchItem(prepareQuery('lorebook castle'), target('Castle'))).not.toBeNull()
    })

    test('one word that matches nowhere rejects the item', () => {
        expect(matchItem(prepareQuery('king dragon'), target('King of the Castle', ['a king and a castle']))).toBeNull()
        expect(matchItem(prepareQuery('castle dragon'), target('Castle'))).toBeNull()
    })

    test('words are split on runs of whitespace and an empty query matches everything', () => {
        expect(searchWordsOf('  castle \t\n king  ')).toEqual(['castle', 'king'])
        expect(searchWordsOf('   ')).toEqual([])
        expect(matchItem(prepareQuery(''), target('Anything'))).not.toBeNull()
    })

    test('text matching is case-insensitive and treats the word literally', () => {
        expect(matchItem(prepareQuery('KING'), target('x', ['The King']))).not.toBeNull()
        expect(matchItem(prepareQuery('(a+b)'), target('x', ['see (a+b) here']))).not.toBeNull()
        expect(matchItem(prepareQuery('a.b'), target('x', ['axb']))).toBeNull()
        expect(matchItem(prepareQuery('a.b'), target('x', ['a.b']))).not.toBeNull()
    })

    test('every matched word is marked in the name and in a snippet of 40 characters each side', () => {
        const before = 'x'.repeat(100)
        const after = 'y'.repeat(100)
        const match = matchItem(prepareQuery('needle castle'), target('Castle', [`${before}needle${after}`]))
        expect(match).not.toBeNull()
        expect(markedWords(match?.name ?? [])).toEqual(['Castle'])
        const snippet = match?.snippet
        expect(joined(snippet?.segments ?? [])).toBe(`${'x'.repeat(SNIPPET_CONTEXT)}needle${'y'.repeat(SNIPPET_CONTEXT)}`)
        expect(markedWords(snippet?.segments ?? [])).toEqual(['needle'])
        expect(snippet?.before).toBe(true)
        expect(snippet?.after).toBe(true)
    })

    test('two matched words in one snippet are both marked; a short text is not cut', () => {
        const match = matchItem(prepareQuery('alpha gamma'), target('x', ['alpha beta gamma']))
        expect(markedWords(match?.snippet?.segments ?? [])).toEqual(['alpha', 'gamma'])
        expect(match?.snippet?.before).toBe(false)
        expect(match?.snippet?.after).toBe(false)
    })

    test('a snippet never splits a surrogate pair', () => {
        const text = `${'a'.repeat(SNIPPET_CONTEXT - 1)}😀needle`
        const match = matchItem(prepareQuery('needle'), target('x', [text]))
        const shown = joined(match?.snippet?.segments ?? [])
        expect(shown).toContain('needle')
        expect(shown).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u)
    })

    test('a word that matched only by name leaves no snippet', () => {
        expect(matchItem(prepareQuery('castle'), target('Castle', ['unrelated']))?.snippet).toBeNull()
    })

    test('marks do not depend on the order of the words and the longer word wins', () => {
        expect(markedWords(markedSegmentsOf('castle castles', ['castle', 'castles']))).toEqual(['castle', 'castles'])
    })
})

describe('5b consonant (초성) matching is for names only', () => {
    test('one jamo matches at the start of a word, not inside one', () => {
        expect(matchItem(prepareQuery('ㅎ'), target('한국어 로어북'))).not.toBeNull()
        expect(matchItem(prepareQuery('ㄹ'), target('한국어 로어북'))).not.toBeNull()
        // ㄱ is the second initial of the first word.
        expect(matchItem(prepareQuery('ㄱ'), target('한국어 로어북', [], 'Kind'))).toBeNull()
    })

    test('two or more jamo match anywhere in the initials, across spaces', () => {
        expect(matchItem(prepareQuery('ㄱㅇ'), target('한국어 로어북', [], 'Kind'))).not.toBeNull()
        expect(matchItem(prepareQuery('ㅇㄹ'), target('한국어 로어북', [], 'Kind'))).not.toBeNull()
        expect(matchItem(prepareQuery('ㅂㅂ'), target('한국어 로어북', [], 'Kind'))).toBeNull()
    })

    test('the kind name takes consonant queries too', () => {
        expect(matchItem(prepareQuery('ㄹㅇㅂ'), target('Castle', [], '로어북'))).not.toBeNull()
    })

    test('a text is never matched by its initials', () => {
        expect(matchItem(prepareQuery('ㅎㄱㅇ'), target('Castle', ['한국어 텍스트'], 'Kind'))).toBeNull()
        expect(matchItem(prepareQuery('ㅎ'), target('Castle', ['한국어 텍스트'], 'Kind'))).toBeNull()
        // The same letters written out are a plain occurrence.
        expect(matchItem(prepareQuery('한국'), target('Castle', ['한국어 텍스트'], 'Kind'))).not.toBeNull()
    })

    test('a consonant word and a plain word combine', () => {
        expect(matchItem(prepareQuery('ㅎㄱㅇ text'), target('한국어', ['some text'], 'Kind'))).not.toBeNull()
        expect(matchItem(prepareQuery('ㅎㄱㅇ text'), target('한국어', ['some other'], 'Kind'))).toBeNull()
    })
})

const labels: SearchLabels = {
    kind: (kind) => kind,
    item: (item) => item.name !== '' ? item.name : `${item.kind} ${item.index + 1}`,
}

function drain(work: SearchWork<SearchResult> | null): SearchResult[] {
    const found: SearchResult[] = []
    if (!work) return found
    for (let unit = 0; unit < work.unitCount; unit++) {
        const total = work.itemCount(unit)
        for (let index = 0; index < total; index++) {
            const hit = work.scan(unit, index)
            if (hit) found.push(hit)
        }
    }
    return found
}

function textSources(overrides: Partial<ItemTextSources['character']> = {}, rest: Partial<ItemTextSources> = {}): ItemTextSources {
    return { character: { chatPage: 0, ...overrides }, modules: [], presets: [], ...rest }
}

function search(
    model: ReturnType<typeof buildOwnerModel>,
    query: string,
    chips: SearchChip[] = [],
    sources: ItemTextSources | null = null,
): SearchResult[] {
    return drain(createSearchWork(planSearch(model), { query: prepareQuery(query), chips: new Set(chips), labels, sources }))
}

const castleLore = [loreBody('Castle', 'the king lives here'), loreBody('Forest', 'tall trees')]
const chatLore = [loreBody('Chat note', 'a chat secret')]
const moduleLore: loreBook[] = [{ key: 'k', secondkey: '', insertorder: 1, comment: 'Module lore', content: 'module body', mode: 'normal', alwaysActive: false, selective: false }]

function richModel() {
    return buildOwnerModel(makeInput({
        character: makeCharacter({
            globalLore: castleLore,
            customscript: [regexBody('Quote fix', '"', '“')],
            chats: [makeChat({ id: 'c1', name: 'Chat', localLore: chatLore })],
            modules: ['on'],
            customModuleToggle: 'combat=Combat',
            backgroundHTML: '<div></div>',
        }),
        modules: [
            residentModule('on', { lorebook: moduleLore }),
            residentModule('off', { lorebook: moduleLore }),
        ],
        presets: [makePreset('Main', { regex: [{ comment: 'Main regex' }] }), makePreset('Spare', { regex: [{ comment: 'Spare regex' }] })],
        activePreset: 0,
    }))
}

function richSources(): ItemTextSources {
    return textSources({
        globalLore: castleLore,
        customscript: [regexBody('Quote fix', '"', '“')],
        chats: [{ localLore: chatLore }],
        customModuleToggle: 'combat=Combat',
        backgroundHTML: '<div></div>',
    }, {
        modules: [residentModule('on', { lorebook: moduleLore }), residentModule('off', { lorebook: moduleLore })],
        presets: [{ regex: [{ in: 'a', out: 'b' }], toggles: '' }, { regex: [{ in: 'c', out: 'd' }], toggles: '' }],
    })
}

describe('5c chips and the empty query', () => {
    test('an empty query with no chip searches nothing', () => {
        expect(createSearchWork(planSearch(richModel()), { query: prepareQuery(''), chips: new Set(), labels, sources: null })).toBeNull()
        expect(createSearchWork(planSearch(richModel()), { query: prepareQuery('   '), chips: new Set(), labels, sources: null })).toBeNull()
    })

    test('an empty query with a chip lists every item of the chip across owners', () => {
        const lore = search(richModel(), '', ['lore'])
        expect(lore.map((hit) => hit.label).sort()).toEqual(['Castle', 'Chat note', 'Forest', 'Module lore', 'Module lore'])
        expect(new Set(lore.map((hit) => hit.chip))).toEqual(new Set(['lore']))
        expect(search(richModel(), '', ['regex']).every((hit) => hit.kind === 'regex')).toBe(true)
        expect(search(richModel(), '', ['regex'])).toHaveLength(3)
    })

    test('chips add up, and Info lists the kinds without a chip of their own', () => {
        const model = richModel()
        const both = search(model, '', ['regex', 'toggles'])
        expect(new Set(both.map((hit) => hit.chip))).toEqual(new Set(['regex', 'toggles']))
        const info = search(model, '', ['info'])
        expect(info.length).toBeGreaterThan(0)
        expect(info.every((hit) => chipOfKind(hit.kind) === 'info')).toBe(true)
        expect(new Set(info.map((hit) => hit.kind))).toEqual(new Set(['basic', 'html', 'advanced']))
    })

    test('a chip limits a query to its kinds', () => {
        const model = richModel()
        expect(search(model, 'king', [], richSources()).map((hit) => hit.label)).toEqual(['Castle'])
        expect(search(model, 'king', ['regex'], richSources())).toEqual([])
        expect(search(model, 'king', ['lore'], richSources()).map((hit) => hit.label)).toEqual(['Castle'])
    })

    test('hits in an unused module or an other preset are tagged Off', () => {
        const model = richModel()
        const lore = search(model, '', ['lore'])
        expect(lore.filter((hit) => hit.ownerType === 'module').map((hit) => [hit.ownerName, hit.off])).toEqual([['Module on', false], ['Module off', true]])
        const regex = search(model, '', ['regex'])
        expect(regex.filter((hit) => hit.ownerType === 'preset').map((hit) => [hit.label, hit.off])).toEqual([['Main regex', false], ['Spare regex', true]])
        expect(lore.filter((hit) => hit.ownerType === 'character').every((hit) => !hit.off)).toBe(true)
    })

    test('a hit carries the item id and the owner that the tree and the detail select', () => {
        const model = richModel()
        const [hit] = search(model, 'castle')
        expect(hit.id).toBe('cha-1/lore:0')
        expect(hit.ownerKey).toBe('character:cha-1')
        expect(model.ownerByKey(hit.ownerKey)?.kinds().find((node) => node.kind === hit.kind)?.items()[hit.index].id).toBe(hit.id)
    })

    test('plugins are not searched', () => {
        const model = buildOwnerModel(makeInput({ plugins: [{ name: 'findable plugin' }] }))
        expect(search(model, 'findable')).toEqual([])
        expect(search(model, '', ['info']).some((hit) => hit.ownerType === 'plugin')).toBe(false)
    })

    test('a hit placement opens the groups and the page of its owner', () => {
        const rows = Array.from({ length: 150 }, (_, index) => residentModule(`row-${index}`))
        const model = buildOwnerModel(makeInput({ modules: rows, enabledModules: ['row-0'] }))
        const active = model.ownerByKey('module:row-0')
        const late = model.ownerByKey('module:row-120')
        expect(active && placementOf(model, active, 100)).toEqual({ groups: ['modules'], page: { group: 'modules', index: 0 } })
        expect(late && placementOf(model, late, 100)).toEqual({ groups: ['otherModules'], page: { group: 'otherModules', index: 1 } })
        const preset = buildOwnerModel(makeInput({ presets: [makePreset('A'), makePreset('B')], activePreset: 0 }))
        const other = preset.otherPresets[0]
        expect(placementOf(preset, other, 100)).toEqual({ groups: ['presets', 'otherPresets'], page: { group: 'otherPresets', index: 0 } })
        expect(placementOf(preset, preset.character, 100)).toEqual({ groups: [], page: null })
    })
})

describe('5d private content and unloaded modules are never searched', () => {
    test('a private character and its chat are not searched', () => {
        const model = buildOwnerModel(makeInput({
            character: makeCharacter({
                license: 'private',
                name: 'Hidden',
                globalLore: [loreBody('Secret', 'private body')],
                chats: [makeChat({ id: 'c1', name: 'Chat', localLore: [loreBody('Secret chat', 'private chat body')] })],
            }),
            modules: [residentModule('open', { lorebook: moduleLore })],
            enabledModules: ['open'],
        }))
        const sources = textSources({ license: 'private', globalLore: [loreBody('Secret', 'private body')], chats: [{ localLore: [loreBody('Secret chat', 'private chat body')] }] })
        expect(search(model, 'secret', [], sources)).toEqual([])
        expect(search(model, 'private', [], sources)).toEqual([])
        expect(search(model, '', ['lore'], sources).map((hit) => hit.ownerType)).toEqual(['module'])
        const types = planSearch(model).units.map((unit) => unit.owner.type)
        expect(types).not.toContain('character')
        expect(types).not.toContain('chat')
    })

    test('an owner is not searched by its text when the sources do not hold it', () => {
        // A character that is no longer the bound one yields no text; names are still searched.
        const model = richModel()
        expect(search(model, 'king', [], null)).toEqual([])
        expect(search(model, 'castle', [], null).map((hit) => hit.label)).toEqual(['Castle'])
    })

    test('an unloaded module is counted, never searched and never read beyond its stub fields', () => {
        const reads: string[] = []
        const model = buildOwnerModel(makeInput({
            modules: [
                residentModule('res', { lorebook: moduleLore }),
                watchBodyKeys(stubModule('stub-a', { name: 'Findable stub' }), reads),
                watchBodyKeys(stubModule('stub-b'), reads),
            ],
            enabledModules: ['res', 'stub-a', 'stub-b'],
        }))
        const plan = planSearch(model)
        expect(plan.unloaded).toBe(2)
        expect(plan.units.every((unit) => unit.owner.id === 'res' || unit.owner.type !== 'module')).toBe(true)
        expect(search(model, 'findable')).toEqual([])
        expect(search(model, '', ['lore', 'regex', 'toggles', 'scripts', 'info'], textSources()).every((hit) => hit.ownerType !== 'module' || hit.ownerKey === 'module:res')).toBe(true)
        expect(reads).toEqual([])
    })

    test('the scale fixture counts its unloaded modules and a full scan reads no stub body', () => {
        const fixture = makeScaleFixture()
        const model = buildOwnerModel(fixture.input)
        expect(planSearch(model).unloaded).toBe(fixture.stubCount)
        search(model, 'body', ['lore'], textSources({ globalLore: [] }, { modules: fixture.input.modules }))
        expect(fixture.reads).toEqual([])
    })
})

describe('5e2 a list that shrank is a miss', () => {
    test('an index past the list or a unit that is not there reads as no hit', () => {
        const work = createSearchWork(planSearch(richModel()), { query: prepareQuery(''), chips: new Set<SearchChip>(['lore']), labels, sources: null })
        expect(work).not.toBeNull()
        expect(work?.scan(0, 9999)).toBeNull()
        expect(work?.scan(9999, 0)).toBeNull()
        expect(work?.scan(0, -1)).toBeNull()
    })
})