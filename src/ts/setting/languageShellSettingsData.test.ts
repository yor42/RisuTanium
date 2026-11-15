/**
 * The Language page data: the two groups, the select without the translate-it-yourself option, the calm line rule,
 * and that the translator rows are the legacy objects.
 *
 * MOCKED: the application modules the setting data imports for their click handlers (as in
 * `languageSettingsData.translang.test.ts`). The data and the language modules are real.
 */
import { describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
}) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn(async () => {}),
    selectFileByDom: vi.fn(),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/alert'), () => ({
    alertSelect: vi.fn(),
    alertNormal: vi.fn(),
    alertClear: vi.fn(),
    alertConfirm: vi.fn(),
    alertError: vi.fn(),
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/translator/translator'), () => ({
    exportLLMCacheAsJSON: vi.fn(),
    importLLMCacheFromJSON: vi.fn(),
    clearLLMCache: vi.fn(),
}) as unknown as typeof import('src/ts/translator/translator'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: { language: 'ko' } },
}) as unknown as typeof import('src/ts/stores.svelte'))

import { languageEnglish } from 'src/lang/en'
import { languageSettingsItems } from './languageSettingsData.svelte'
import {
    LANGUAGE_NOT_OFFERED_IDS,
    LANGUAGE_SHELL_SECTIONS,
    languagePending,
    languageSectionOfRow,
    languageShellItems,
    languageShellRowIds,
    unplacedLegacyLanguageIds,
} from './languageShellSettingsData'
import { rowIdsOf } from './shellSections'

const english = languageEnglish as unknown as Record<string, unknown>

function legacy(id: string) {
    const found = languageSettingsItems.find((item) => item.id === id)
    if (!found) throw new Error(`no legacy item ${id}`)
    return found
}

describe('Language page sections', () => {
    test('the app group and the translation group come in order and never collapse', () => {
        expect(LANGUAGE_SHELL_SECTIONS.map((section) => section.id)).toEqual(['lang.app', 'lang.translate'])
        for (const section of LANGUAGE_SHELL_SECTIONS) {
            expect(section.collapsed, section.id).toBe(false)
            expect(section.when, section.id).toBeUndefined()
            expect(typeof english[section.labelKey], section.id).toBe('string')
        }
    })

    test('the app group holds the select, the pending line and the download button, and the pending line has no condition', () => {
        const app = LANGUAGE_SHELL_SECTIONS[0]
        expect(app.rows.map((row) => rowIdsOf(row)[0])).toEqual(['lang.uiLanguage', 'lang.pending', 'lang.translang'])
        const pending = app.rows[1]
        expect(pending.kind).toBe('shell')
        if (pending.kind === 'shell') expect(pending.condition).toBeUndefined()
    })

    test('the select offers the eight languages including Japanese and no translate option, with the legacy onChange', () => {
        const item = languageShellItems.find((candidate) => candidate.id === 'lang.uiLanguage')
        const values = item?.options?.selectOptions?.map((option) => option.value)
        expect(values).toEqual(['de', 'en', 'ko', 'cn', 'zh-Hant', 'vi', 'es', 'ja'])
        expect(values).not.toContain('translang')
        expect(item?.onChange).toBe(legacy('lang.uiLanguage').onChange)
        expect(item?.bindKey).toBe('language')
        // The legacy list still offers the option, for the legacy Settings screen.
        expect(legacy('lang.uiLanguage').options?.selectOptions?.some((option) => option.value === 'translang')).toBe(true)
    })

    test('the download is a button row with a click handler and its own labels', () => {
        const item = languageShellItems.find((candidate) => candidate.id === 'lang.translang')
        expect(item?.type).toBe('button')
        expect(typeof item?.options?.onClick).toBe('function')
        for (const key of [item?.labelKey, 'settingsShellLangTranslangHint', 'settingsShellLangPending']) {
            expect(typeof english[key ?? ''], key).toBe('string')
            expect(english[key ?? ''], key).not.toBe('')
        }
    })

    test('the translation group holds every other legacy row as the legacy object, in legacy order', () => {
        const translate = LANGUAGE_SHELL_SECTIONS[1]
        const expected = languageSettingsItems.filter((item) => item.id !== 'lang.uiLanguage' && !LANGUAGE_NOT_OFFERED_IDS.has(item.id))
        expect(translate.rows.length).toBe(expected.length)
        translate.rows.forEach((row, at) => {
            expect(row.kind).toBe('setting')
            if (row.kind === 'setting') expect(row.item).toBe(expected[at])
        })
        expect(translate.rows.map((row) => rowIdsOf(row)[0])).toContain('lang.deeplWebWarn')
        expect(translate.rows.map((row) => rowIdsOf(row)[0])).toContain('lang.googleSourceLang')
    })

    test('the legacy close-Settings banner and the page title are not placed, and every other legacy id is', () => {
        const ids = languageShellRowIds()
        expect(ids).not.toContain('lang.restartWarn')
        expect(ids).not.toContain('lang.header')
        expect(unplacedLegacyLanguageIds()).toEqual([])
        expect(languageSectionOfRow('lang.translatorLang')).toBe('lang.translate')
    })
})

describe('languagePending', () => {
    test('it is false while the language is the one the page started with, and true once it differs', () => {
        expect(languagePending('ko', 'ko')).toBe(false)
        expect(languagePending('ko', 'en')).toBe(true)
        expect(languagePending('ko', 'ko')).toBe(false)
    })
})
