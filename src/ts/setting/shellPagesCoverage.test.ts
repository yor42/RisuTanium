/**
 * Id coverage of the native shell pages: every legacy id of a converted list is placed on its page, dead, or not
 * offered; no id sits on two pages; a search result for a placed row opens the page that shows it; and the legacy
 * lists, which the sidebar picker still reads, keep their own objects.
 *
 * MOCKED: the application modules the setting data files import for their click handlers, as in
 * `settingLabelKeys.test.ts`. The data and the language modules are real.
 */
import { describe, expect, test, vi } from 'vitest'
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

import { accessibilitySettingsItems } from './accessibilitySettingsData'
import { advancedSettingsItems } from './advancedSettingsData'
import { displayShellRowIds } from './displayShellSettingsData'
import { advancedShellRowIds, unplacedLegacyAdvancedIds } from './advancedShellSettingsData'
import { inputShellRowIds, unplacedLegacyInputIds } from './inputShellSettingsData'
import { languageShellRowIds, unplacedLegacyLanguageIds } from './languageShellSettingsData'
import { buildSearchSources } from './settingsSearchSources'
import { getFullSettingsData } from './utils'
import type { SettingContext } from './types'

function context(): SettingContext {
    const db: Pick<Database, 'instructChatTemplate' | 'aiModel'> = { instructChatTemplate: 'chatml', aiModel: 'gemini-3-flash-preview' }
    const model: Pick<LLMModel, 'flags' | 'parameters'> = { flags: [], parameters: [] }
    return { db: db as Database, modelInfo: model as LLMModel, subModelInfo: model as LLMModel }
}

describe('native shell page coverage (I3)', () => {
    test('every legacy Accessibility id is placed on the Input page, dead, or not offered', () => {
        expect(unplacedLegacyInputIds()).toEqual([])
    })

    test('every legacy Language id is placed on the Language page or not offered', () => {
        expect(unplacedLegacyLanguageIds()).toEqual([])
    })

    test('every legacy Advanced id is placed on the Advanced page or not offered', () => {
        expect(unplacedLegacyAdvancedIds()).toEqual([])
    })

    test('no row id sits on two native pages, and none twice on one page', () => {
        const pages = [displayShellRowIds(), inputShellRowIds(), languageShellRowIds(), advancedShellRowIds()]
        const all = pages.flat()
        expect(new Set(all).size).toBe(all.length)
    })

    test('a search result for an Input row opens the Input page at that row', () => {
        const sources = new Map(buildSearchSources(context()).map((source) => [source.id, source]))
        const placed = inputShellRowIds().filter((id) => sources.has(id))
        // Conditional rows (the picker) are absent for this context; the rest must be there.
        expect(placed.length).toBeGreaterThan(20)
        for (const id of placed) {
            expect(sources.get(id)?.target, id).toEqual({ index: 11, rowId: id })
        }
    })

    test('a search result for a Language row opens the Language page at that row', () => {
        const sources = new Map(buildSearchSources(context()).map((source) => [source.id, source]))
        const placed = languageShellRowIds().filter((id) => sources.has(id))
        expect(placed).toContain('lang.uiLanguage')
        expect(placed).toContain('lang.translatorLang')
        for (const id of placed) {
            expect(sources.get(id)?.target, id).toEqual({ index: 10, rowId: id })
        }
    })

    test('a search result for an Advanced row opens the Advanced page at that row', () => {
        const sources = new Map(buildSearchSources(context()).map((source) => [source.id, source]))
        const placed = advancedShellRowIds().filter((id) => sources.has(id))
        expect(placed).toContain('adv.genTime')
        expect(placed).toContain('adv.coldstorage')
        for (const id of placed) {
            expect(sources.get(id)?.target, id).toEqual({ index: 6, rowId: id })
        }
    })

    test('T4: acc.requestInfoInsideChat is an Accessibility id that opens the Advanced page', () => {
        const sources = new Map(buildSearchSources(context()).map((source) => [source.id, source]))
        expect(sources.get('acc.requestInfoInsideChat')?.target).toEqual({ index: 6, rowId: 'acc.requestInfoInsideChat' })
        expect(inputShellRowIds()).not.toContain('acc.requestInfoInsideChat')
    })
})

describe('the legacy lists stay the sidebar picker source (T10, compatibility guard)', () => {
    test('getFullSettingsData holds the legacy objects, not the page overrides', () => {
        const full = getFullSettingsData()
        const instant = accessibilitySettingsItems.find((item) => item.id === 'acc.instantRemove')
        expect(instant?.labelKey).toBe('instantRemove')
        expect(full.find((item) => item.id === 'acc.instantRemove')).toBe(instant)
        const genTime = advancedSettingsItems.find((item) => item.id === 'adv.genTime')
        expect(genTime?.labelKey).toBe('genTimes')
        expect(full.find((item) => item.id === 'adv.genTime')).toBe(genTime)
    })
})
