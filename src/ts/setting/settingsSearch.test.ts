/**
 * Settings search seams (UI-S2 batch 2, A2): matching tiers, the retry passes, the cross-language fields, the index
 * memo, and the source lists with their view targets.
 *
 * MOCKED: the application modules the setting data files import for their click handlers, as in
 * `settingLabelKeys.test.ts`. The data, the language modules and `changeLanguage` are real.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { LLMModel } from 'src/ts/model/types'

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    sleep: vi.fn(),
    selectFileByDom: vi.fn(),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))
vi.mock(import('src/ts/gui/guisize'), () => ({
    guiSizeText: vi.fn(),
    updateGuisize: vi.fn(),
}) as unknown as typeof import('src/ts/gui/guisize'))
vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    CustomGUISettingMenuStore: { set: vi.fn() },
    DBState: { db: {} },
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertConfirm: vi.fn(),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertClear: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/translator/translator'), () => ({
    exportLLMCacheAsJSON: vi.fn(),
    importLLMCacheFromJSON: vi.fn(),
    clearLLMCache: vi.fn(),
}) as unknown as typeof import('src/ts/translator/translator'))
vi.mock(import('src/ts/exportNotice'), () => ({
    downloadNotice: vi.fn(),
}) as unknown as typeof import('src/ts/exportNotice'))

import { changeLanguage, language } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageGerman } from 'src/lang/de'
import { languageKorean } from 'src/lang/ko'
import {
    buildSearchEntries, getSettingsIndex, GROUP_COLLECT_CAP, GROUP_SHOWN, searchSettings,
    type LanguageTable, type LanguageTables, type SearchEntry, type SearchOutcome, type SearchSource,
} from './settingsSearch'
import { buildSearchSources, legacyListTargets } from './settingsSearchSources'
import { orderedPages } from '../settingsShell/settingsPages'
import { closeSearch, openSearch, resetSearch, settingsSearchState } from '../settingsShell/settingsSearchState.svelte'
import { accessibilitySettingsItems } from './accessibilitySettingsData'
import { displaySettingsItems } from './displaySettingsData.svelte'
import type { SettingContext } from './types'

const FIXTURE_TABLES: LanguageTables = {
    current: {},
    english: {},
    korean: {},
}

function tablesOf(entries: Record<string, unknown>, korean: Record<string, unknown> = {}): LanguageTables {
    return { current: entries, english: entries, korean }
}

function setting(id: string, labelKey: string, extra: Partial<SearchSource> = {}): SearchSource {
    return { id, kind: 'setting', target: { index: 1, rowId: id }, labelKey, ...extra }
}

function page(id: string, labelKey: string, index = 3): SearchSource {
    return { id, kind: 'page', target: { index, rowId: null }, labelKey }
}

function idsOf(outcome: SearchOutcome, kind: 'setting' | 'page'): string[] {
    return (outcome.groups.find((group) => group.kind === kind)?.hits ?? []).map((hit) => hit.entry.id)
}

function search(sources: readonly SearchSource[], tables: LanguageTables, query: string): SearchOutcome {
    return searchSettings(buildSearchEntries(sources, tables), query)
}

afterEach(() => {
    changeLanguage('en')
    resetSearch()
})

describe('ranking and word rules (T-A2)', () => {
    const tables = tablesOf({
        exact: 'Line',
        prefix: 'Line Height',
        wordStart: 'Soft Line Break',
        inside: 'Baseline',
        spacing: 'Spacing',
        margins: 'Margins',
        gapSynonym: 'bigger line gap',
        help: { adjust: 'Adjust the line of text' },
    })
    // Listed worst first, so a sort that keeps the source order cannot pass.
    const sources: SearchSource[] = [
        setting('s.help', 'margins', { helpKey: 'adjust' }),
        setting('s.keyword', 'spacing', { keywords: ['lineage'] }),
        setting('s.synonym', 'margins', { synonymKeys: ['gapSynonym'] }),
        setting('s.inside', 'inside'),
        setting('s.wordStart', 'wordStart'),
        setting('s.prefix', 'prefix'),
        setting('s.exact', 'exact'),
    ]

    test('hits rank exact, prefix, word start, inside, synonym or keyword, then help', () => {
        const outcome = search(sources, tables, 'line')
        expect(idsOf(outcome, 'setting')).toEqual(['s.exact', 's.prefix', 's.wordStart', 's.inside', 's.keyword', 's.synonym', 's.help'])
        expect(outcome.groups[0].hits.map((hit) => hit.tier)).toEqual([0, 1, 2, 3, 4, 4, 5])
    })

    test('a synonym alone finds its entry', () => {
        const outcome = search(sources, tables, 'bigger')
        expect(idsOf(outcome, 'setting')).toEqual(['s.synonym'])
    })

    test('a label hit outranks a help-only hit, and equal tiers keep the source order', () => {
        const twoTables = tablesOf({ a: 'Zoom level', b: 'Zoom level', c: 'Other', help: { zoomHelp: 'Zoom text' } })
        const outcome = search([
            setting('s.helpOnly', 'c', { helpKey: 'zoomHelp' }),
            setting('s.first', 'a'),
            setting('s.second', 'b'),
        ], twoTables, 'zoom')
        expect(idsOf(outcome, 'setting')).toEqual(['s.first', 's.second', 's.helpOnly'])
    })

    test('every word must match some field of the same entry', () => {
        const wordTables = tablesOf({ a: 'Line Height', b: 'Line Width', c: 'Height Map' })
        const outcome = search([setting('s.a', 'a'), setting('s.b', 'b'), setting('s.c', 'c')], wordTables, 'height line')
        expect(idsOf(outcome, 'setting')).toEqual(['s.a'])
    })

    test('a one-letter word matches only at a token start, and a two-letter word never matches inside a token', () => {
        const letterTables = tablesOf({ a: 'Line Height', b: 'Baseline' })
        const sourcesAB = [setting('s.a', 'a'), setting('s.b', 'b')]
        expect(idsOf(search(sourcesAB, letterTables, 'l'), 'setting')).toEqual(['s.a'])
        expect(idsOf(search(sourcesAB, letterTables, 'in'), 'setting')).toEqual([])
        expect(idsOf(search(sourcesAB, letterTables, 'ine'), 'setting')).toEqual(['s.a', 's.b'])
    })

    test('a page whose name equals or starts with the query is pinned above the groups', () => {
        const pinTables = tablesOf({ pageName: 'Display & reading', settingName: 'Display hint', other: 'Reading Display' })
        const outcome = search([
            setting('s.hint', 'settingName'),
            page('page.display', 'pageName'),
            page('page.other', 'other'),
        ], pinTables, 'disp')
        expect(outcome.pinned.map((hit) => hit.entry.id)).toEqual(['page.display'])
        expect(idsOf(outcome, 'page')).toEqual(['page.other'])
        expect(idsOf(outcome, 'setting')).toEqual(['s.hint'])
    })

    test('a group shows 5 and holds the rest, and collection stops at 50 per group', () => {
        const manyKeys: Record<string, string> = {}
        const many: SearchSource[] = []
        for (let at = 0; at < 80; at++) {
            manyKeys[`k${at}`] = `Alpha ${at}`
            many.push(setting(`s.${at}`, `k${at}`))
        }
        const twelve = search(many.slice(0, 12), tablesOf(manyKeys), 'alpha')
        const group = twelve.groups.find((candidate) => candidate.kind === 'setting')
        expect(group?.shown).toHaveLength(GROUP_SHOWN)
        expect(group?.hits).toHaveLength(12)
        const all = search(many, tablesOf(manyKeys), 'alpha')
        expect(all.groups.find((candidate) => candidate.kind === 'setting')?.hits).toHaveLength(GROUP_COLLECT_CAP)
    })

    test('an empty or blank query finds nothing', () => {
        const outcome = search(sources, tables, '   ')
        expect(outcome.groups.every((group) => group.hits.length === 0)).toBe(true)
        expect(outcome.pinned).toEqual([])
        expect(outcome.partial).toBe(false)
    })

    test('a missing or empty language entry is skipped and never indexed as text', () => {
        const gapTables = tablesOf({ present: 'Real label', empty: '' })
        const gapSources: SearchSource[] = [
            setting('s.gone', 'absent'),
            setting('s.empty', 'empty'),
            setting('s.ok', 'present', { synonymKeys: ['absentSynonym'], helpKey: 'absentHelp' }),
        ]
        const entries = buildSearchEntries(gapSources, gapTables)
        expect(entries.map((entry) => entry.id)).toEqual(['s.ok'])
        expect(searchSettings(entries, 'undefined').groups.every((group) => group.hits.length === 0)).toBe(true)
    })

    test('a fallback label stands in when no language holds the key', () => {
        const entries = buildSearchEntries([setting('s.fb', 'absent', { fallbackLabel: 'Jinja Template' })], FIXTURE_TABLES)
        expect(entries.map((entry) => entry.label)).toEqual(['Jinja Template'])
    })

    test('the shown label is the live language and the other languages still match', () => {
        const current: LanguageTable = { name: 'Zeilenhöhe' }
        const entries = buildSearchEntries(
            [setting('s.lh', 'name')],
            { current, english: { name: 'Line Height' }, korean: { name: '줄간격' } },
        )
        expect(entries[0].label).toBe('Zeilenhöhe')
        for (const query of ['zeilen', 'line height', '줄간격']) {
            expect(idsOf(searchSettings(entries, query), 'setting'), query).toEqual(['s.lh'])
        }
    })

    test('synonym text splits on a comma, a fullwidth comma and an ideographic comma', () => {
        const entries = buildSearchEntries(
            [setting('s.z', 'name', { synonymKeys: ['syn'] })],
            tablesOf({ name: 'Chat Text Size', syn: 'bigger text，larger text、small text, text size' }),
        )
        expect(entries[0].synonyms.map((synonym) => synonym.raw)).toEqual(['bigger text', 'larger text', 'small text', 'text size'])
        for (const query of ['larger', 'small text', 'bigger']) {
            expect(idsOf(searchSettings(entries, query), 'setting'), query).toEqual(['s.z'])
        }
    })

    test('spacing is normalised in both directions', () => {
        const spaceTables = tablesOf({ joined: '채팅봇', split: '채팅 봇' })
        const spaceSources = [setting('s.joined', 'joined'), setting('s.split', 'split')]
        expect(idsOf(search(spaceSources, spaceTables, '채팅 봇'), 'setting')).toEqual(['s.joined', 's.split'])
        expect(idsOf(search(spaceSources, spaceTables, '채팅봇'), 'setting')).toEqual(['s.joined', 's.split'])
    })

    test('consonant jamo (초성) match a label by its initials, one jamo at a word start', () => {
        const jamoTables = tablesOf({ a: '줄간격', b: '글자 크기' })
        const jamoSources = [setting('s.a', 'a'), setting('s.b', 'b')]
        expect(idsOf(search(jamoSources, jamoTables, 'ㅈㄱㄱ'), 'setting')).toEqual(['s.a'])
        expect(idsOf(search(jamoSources, jamoTables, 'ㅋ'), 'setting')).toEqual(['s.b'])
        expect(idsOf(search(jamoSources, jamoTables, 'ㄱ'), 'setting')).toEqual(['s.b'])
    })
})

describe('retry passes (T-A3 seam)', () => {
    const tables = tablesOf({ send: 'Send with Enter Key', other: 'Enter name' })
    const sources = [setting('s.send', 'send', { keywords: ['send', 'enter'] }), setting('s.other', 'other')]

    test('a query that matches as typed is not partial', () => {
        const outcome = search(sources, tables, 'enter send')
        expect(idsOf(outcome, 'setting')).toEqual(['s.send'])
        expect(outcome.partial).toBe(false)
    })

    test('a filler word is not required', () => {
        const outcome = search(sources, tables, 'enter to send')
        expect(idsOf(outcome, 'setting')).toEqual(['s.send'])
        expect(outcome.partial).toBe(false)
    })

    test('filler words never have to match, even when the query matches as typed', () => {
        const fillerTables = tablesOf({ send: 'Send with Enter Key', long: 'Enter changes to send a message' })
        const fillerSources = [setting('s.send', 'send'), setting('s.long', 'long')]
        const outcome = search(fillerSources, fillerTables, 'enter to send')
        expect(idsOf(outcome, 'setting')).toEqual(['s.send', 's.long'])
        expect(outcome.partial).toBe(false)
        const longHit = outcome.groups.find((group) => group.kind === 'setting')?.hits.find((hit) => hit.entry.id === 's.long')
        const marked = (longHit?.label ?? []).filter((segment) => segment.marked).map((segment) => segment.text.toLowerCase())
        expect(marked).toEqual(['enter', 'send'])
    })

    test('the joined form of the non-filler words still matches', () => {
        const joinTables = tablesOf({ lh: '줄간격', other: 'Other' })
        const outcome = search([setting('s.lh', 'lh'), setting('s.other', 'other')], joinTables, '줄 간격 설정')
        expect(idsOf(outcome, 'setting')).toEqual(['s.lh'])
        expect(outcome.partial).toBe(false)
    })

    test('the joined form of the query as typed still ranks first', () => {
        const typedTables = tablesOf({ bot: '채팅봇', chatSettings: '채팅 설정' })
        const outcome = search([setting('s.bot', 'bot'), setting('s.chatSettings', 'chatSettings')], typedTables, '채팅 설정')
        expect(idsOf(outcome, 'setting')).toEqual(['s.chatSettings', 's.bot'])
    })

    test('a page named by the non-filler words is pinned', () => {
        const pinTables = tablesOf({ pageName: 'Display', hint: 'Change display hint' })
        const outcome = search([setting('s.hint', 'hint'), page('page.display', 'pageName')], pinTables, 'change display')
        expect(outcome.pinned.map((hit) => hit.entry.id)).toEqual(['page.display'])
        expect(idsOf(outcome, 'setting')).toEqual(['s.hint'])
    })

    test('a page whose name starts with a filler word is pinned by the typed form', () => {
        const outcome = search([page('page.cl', 'cl')], tablesOf({ cl: 'Change Log' }), 'change log')
        expect(outcome.pinned.map((hit) => hit.entry.id)).toEqual(['page.cl'])
    })

    test('query words match regardless of case', () => {
        const caseTables = tablesOf({ a: 'Line Height', b: 'Line Width' })
        const caseSources = [setting('s.a', 'a'), setting('s.b', 'b')]
        expect(idsOf(search(caseSources, caseTables, 'Height Line'), 'setting')).toEqual(['s.a'])
        expect(idsOf(search(caseSources, caseTables, 'LINE height'), 'setting')).toEqual(['s.a'])
    })

    test('the any-word retry marks the outcome partial and ranks more matched words first', () => {
        const outcome = search(sources, tables, 'enter qqqq')
        expect(idsOf(outcome, 'setting').sort()).toEqual(['s.other', 's.send'])
        expect(outcome.partial).toBe(true)
        const ranked = search(sources, tables, 'send enter qqqq')
        expect(idsOf(ranked, 'setting')[0]).toBe('s.send')
    })

    test('nothing matching is empty and not partial', () => {
        const outcome = search(sources, tables, 'qqqq zzzz')
        expect(outcome.groups.every((group) => group.hits.length === 0)).toBe(true)
        expect(outcome.partial).toBe(false)
    })

    test('a one-word query never takes the any-word retry', () => {
        const outcome = search(sources, tables, 'qqqq')
        expect(outcome.partial).toBe(false)
        expect(outcome.groups.every((group) => group.hits.length === 0)).toBe(true)
    })

    test('a query made only of filler words is searched as typed', () => {
        const outcome = search([setting('s.to', 'to'), setting('s.other', 'other')], tablesOf({ to: 'Go to the page', other: 'Other' }), 'to the')
        expect(idsOf(outcome, 'setting')).toEqual(['s.to'])
    })
})

function contextWith(chatTemplate: string): SettingContext {
    const db: Pick<Database, 'instructChatTemplate' | 'aiModel'> = { instructChatTemplate: chatTemplate, aiModel: 'gemini-3-flash-preview' }
    const model: Pick<LLMModel, 'flags' | 'parameters'> = { flags: [], parameters: [] }
    return { db: db as Database, modelInfo: model as LLMModel, subModelInfo: model as LLMModel }
}

/** The real lists, synonym keys and language modules under `ui`. */
function realEntries(ui: 'en' | 'ko'): SearchEntry[] {
    changeLanguage(ui)
    const tables: LanguageTables = { current: language, english: languageEnglish, korean: languageKorean }
    return buildSearchEntries(buildSearchSources(contextWith('chatml')), tables)
}

describe.each(['en', 'ko'] as const)('the DS-015 phrases under a %s UI (T-A3)', (ui) => {
    test("'줄 간격' lands on display.lineHeight as typed", () => {
        const outcome = searchSettings(realEntries(ui), '줄 간격')
        expect(idsOf(outcome, 'setting')[0]).toBe('display.lineHeight')
        expect(outcome.partial).toBe(false)
    })

    test("'bigger text' lands on display.zoomsize through its shipped synonym key", () => {
        const outcome = searchSettings(realEntries(ui), 'bigger text')
        expect(idsOf(outcome, 'setting')[0]).toBe('display.zoomsize')
        expect(outcome.partial).toBe(false)
    })

    // A filler word never has to match, so acc.fixedChatTextarea, whose long label happens to hold "to", does not
    // shut out acc.sendWithEnter. Both tie at word start and source order puts acc.sendWithEnter first.
    test("'enter to send' lands on acc.sendWithEnter because the filler word is not required", () => {
        const outcome = searchSettings(realEntries(ui), 'enter to send')
        expect(idsOf(outcome, 'setting')[0]).toBe('acc.sendWithEnter')
        expect(outcome.partial).toBe(false)
    })

    test("'enter qqqq' still finds acc.sendWithEnter, partially", () => {
        const outcome = searchSettings(realEntries(ui), 'enter qqqq')
        expect(idsOf(outcome, 'setting')).toContain('acc.sendWithEnter')
        expect(outcome.partial).toBe(true)
    })

    test("'qqqq zzzz' finds nothing and is not partial", () => {
        const outcome = searchSettings(realEntries(ui), 'qqqq zzzz')
        expect(outcome.groups.every((group) => group.hits.length === 0)).toBe(true)
        expect(outcome.partial).toBe(false)
    })
})

describe('cross-language matching (T-A4)', () => {
    test('a Korean query finds a setting under the English UI and an English query under the Korean UI', () => {
        expect(idsOf(searchSettings(realEntries('en'), '줄간격'), 'setting')[0]).toBe('display.lineHeight')
        expect(idsOf(searchSettings(realEntries('ko'), 'line height'), 'setting')[0]).toBe('display.lineHeight')
    })

    test('consonant queries match the Korean label under either UI', () => {
        for (const ui of ['en', 'ko'] as const) {
            expect(idsOf(searchSettings(realEntries(ui), 'ㅈㄱㄱ'), 'setting'), ui).toContain('display.lineHeight')
        }
    })

    test('the shown label follows the UI language', () => {
        const english = realEntries('en').find((entry) => entry.id === 'display.lineHeight')
        const korean = realEntries('ko').find((entry) => entry.id === 'display.lineHeight')
        expect(english?.label).toBe(languageEnglish.lineHeight)
        expect(korean?.label).toBe(languageKorean.lineHeight)
    })
})

describe('source lists and view targets (T-A5)', () => {
    const everything = buildSearchSources(contextWith('chatml'))

    test('every legacy list opens its explicit view, and the lists of a native page name rows', () => {
        const indexOfList: Record<string, number> = {
            accessibility: 11, advanced: 6, language: 10, basicParameters: 1, seed: 1,
            samplingParameters: 1, penaltyParameters: 1, modelSpecificParameters: 1, chatFormat: 1, display: 3,
        }
        const lists = legacyListTargets()
        expect(lists.map((list) => list.name).sort()).toEqual(Object.keys(indexOfList).sort())
        for (const list of lists) {
            expect(list.index, list.name).toBe(indexOfList[list.name])
            expect(list.rows, list.name).toBe(['display', 'accessibility', 'language', 'advanced'].includes(list.name))
        }
    })

    test('R1: accessibility items name their row on the Input page and display items name their row', () => {
        const byId = new Map(everything.map((source) => [source.id, source]))
        expect(byId.get('acc.sendWithEnter')?.target).toEqual({ index: 11, rowId: 'acc.sendWithEnter' })
        expect(byId.get('lang.translatorLang')?.target).toEqual({ index: 10, rowId: 'lang.translatorLang' })
        expect(byId.get('adv.genTime')?.target).toEqual({ index: 6, rowId: 'adv.genTime' })
        expect(byId.get('acc.requestInfoInsideChat')?.target).toEqual({ index: 6, rowId: 'acc.requestInfoInsideChat' })
        expect(byId.get('display.customCSS')?.target).toEqual({ index: 3, rowId: 'display.customCSS' })
        expect(byId.get('page.display')?.target).toEqual({ index: 3, rowId: null })
    })

    test('every source id is unique and every legacy item with a label is placed once', () => {
        const ids = everything.map((source) => source.id)
        expect(new Set(ids).size).toBe(ids.length)
        const labelled = [...accessibilitySettingsItems, ...displaySettingsItems]
            .filter((item) => item.type !== 'header' && (item.labelKey !== undefined || item.fallbackLabel))
            .filter((item) => item.condition === undefined)
            .map((item) => item.id)
            .filter((id) => id !== 'acc.moveInsteadOfCopyOnCMPConvert' && id !== 'display.showMemoryLimit')
        for (const id of labelled) expect(ids, id).toContain(id)
    })

    test('a Display row the page renames is found by the page name, and the font name row is searchable', () => {
        changeLanguage('en')
        const tables: LanguageTables = { current: language, english: languageEnglish, korean: languageKorean }
        const customFont = contextWith('chatml')
        customFont.db.font = 'custom'
        const entries = buildSearchEntries(buildSearchSources(customFont), tables)
        const quote = entries.find((entry) => entry.id === 'display.unformatQuotes')
        expect(quote?.label).toBe(languageEnglish.settingsShellQuoteStyle)
        const font = entries.find((entry) => entry.id === 'display.customFont')
        expect(font?.label).toBe(languageEnglish.settingsShellFontName)
        expect(font?.target).toEqual({ index: 3, rowId: 'display.customFont' })
    })

    test('an Input row the page renames is found by the page name and opens that row', () => {
        changeLanguage('en')
        const tables: LanguageTables = { current: language, english: languageEnglish, korean: languageKorean }
        const entries = buildSearchEntries(buildSearchSources(contextWith('chatml')), tables)
        const instant = entries.find((entry) => entry.id === 'acc.instantRemove')
        expect(instant?.label).toBe(languageEnglish.settingsShellInputInstantRemove)
        expect(instant?.label).toBe('Ask what to delete')
        expect(instant?.target).toEqual({ index: 11, rowId: 'acc.instantRemove' })
    })

    test('T8: the streaming row is not searchable, and the old media finder follows the unrecommended gate', () => {
        const gated = contextWith('chatml')
        gated.db.useExperimental = true
        gated.db.showUnrecommended = false
        const idsOn = buildSearchSources(gated).map((source) => source.id)
        expect(idsOn).not.toContain('adv.streamingDisplayOpt')
        expect(idsOn).toContain('adv.exp.cachePoint')
        expect(idsOn).not.toContain('adv.legacyMedia')
        gated.db.showUnrecommended = true
        expect(buildSearchSources(gated).map((source) => source.id)).toContain('adv.legacyMedia')
    })

    test('an Advanced row the page renames is found by the page name', () => {
        changeLanguage('en')
        const tables: LanguageTables = { current: language, english: languageEnglish, korean: languageKorean }
        const entries = buildSearchEntries(buildSearchSources(contextWith('chatml')), tables)
        expect(entries.find((entry) => entry.id === 'adv.genTime')?.label).toBe(languageEnglish.settingsShellAdvGenTime)
        expect(entries.find((entry) => entry.id === 'acc.requestInfoInsideChat')?.label).toBe(languageEnglish.settingsShellAdvRequestInfo)
    })

    test('dead fields are not searchable and headers are not settings', () => {
        const ids = everything.map((source) => source.id)
        expect(ids).not.toContain('display.showMemoryLimit')
        expect(ids).not.toContain('display.memoryLimitThickness')
        expect(ids).not.toContain('acc.moveInsteadOfCopyOnCMPConvert')
        expect(ids).not.toContain('acc.header')
    })

    test('a setting whose condition is false is left out until the condition holds', () => {
        expect(everything.map((source) => source.id)).not.toContain('chatFormat.jinjaTemplate')
        const jinja = buildSearchSources(contextWith('jinja'))
        expect(jinja.map((source) => source.id)).toContain('chatFormat.jinjaTemplate')
    })

    test('every page and view has an entry that opens it, and its old menu name finds it', () => {
        const entries = new Map(everything.filter((source) => source.kind === 'page').map((source) => [source.target.index, source]))
        for (const entry of orderedPages()) {
            for (const view of entry.views) {
                expect(entries.get(view.legacyIndex), view.id).toBeDefined()
            }
        }
        changeLanguage('en')
        const found = search(everything, { current: language, english: languageEnglish, korean: languageKorean }, 'Other Bots')
        expect(found.pinned.concat(found.groups.flatMap((group) => [...group.hits])).map((hit) => hit.entry.id)).toContain('page.features')
    })
})

describe('index memo (T-A13)', () => {
    function factory(chatTemplate: () => string): { make: () => SearchSource[], calls: () => number } {
        let count = 0
        return {
            make: () => {
                count += 1
                return buildSearchSources(contextWith(chatTemplate()))
            },
            calls: () => count,
        }
    }

    test('the same open and language serve one build', () => {
        openSearch()
        const source = factory(() => 'chatml')
        const first = getSettingsIndex(settingsSearchState.openToken, source.make)
        const second = getSettingsIndex(settingsSearchState.openToken, source.make)
        expect(second).toBe(first)
        expect(source.calls()).toBe(1)
    })

    test('a language switch rebuilds the index and its labels', () => {
        openSearch()
        const source = factory(() => 'chatml')
        const token = settingsSearchState.openToken
        const before = getSettingsIndex(token, source.make)
        expect(before.find((entry) => entry.id === 'display.lineHeight')?.label).toBe(languageEnglish.lineHeight)
        changeLanguage('de')
        const after = getSettingsIndex(token, source.make)
        expect(source.calls()).toBe(2)
        const hit = searchSettings(after, languageGerman.lineHeight).groups[0].hits[0]
        expect(hit.entry.id).toBe('display.lineHeight')
        expect(hit.entry.label).toBe(languageGerman.lineHeight)
    })

    test('closing drops the index and a reopen sees a changed condition', () => {
        let template = 'chatml'
        const source = factory(() => template)
        openSearch()
        const first = getSettingsIndex(settingsSearchState.openToken, source.make)
        expect(first.map((entry) => entry.id)).not.toContain('chatFormat.jinjaTemplate')
        closeSearch()
        template = 'jinja'
        openSearch()
        const second = getSettingsIndex(settingsSearchState.openToken, source.make)
        expect(source.calls()).toBe(2)
        expect(second.map((entry) => entry.id)).toContain('chatFormat.jinjaTemplate')
    })

    test('a new open takes a new index even when the search was not closed in between', () => {
        const source = factory(() => 'chatml')
        openSearch()
        getSettingsIndex(settingsSearchState.openToken, source.make)
        openSearch()
        getSettingsIndex(settingsSearchState.openToken, source.make)
        expect(source.calls()).toBe(2)
    })

    test('closing alone drops the index even when the token is reused', () => {
        const source = factory(() => 'chatml')
        openSearch()
        const token = settingsSearchState.openToken
        getSettingsIndex(token, source.make)
        closeSearch()
        getSettingsIndex(token, source.make)
        expect(source.calls()).toBe(2)
    })

    beforeEach(() => {
        resetSearch()
    })
})
