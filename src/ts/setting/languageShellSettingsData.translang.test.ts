/**
 * The Language page's "get the translation file" button. It runs the same prompts and download as the legacy
 * translate-it-yourself option, but it never changes the stored language, and whether the download resolves or
 * rejects it ends with the runtime language bound to the stored one.
 *
 * Drives the REAL `lang.translang` item with the real `src/lang` and `changeLanguage`. MOCKED: the alert prompts
 * (scripted answers), the download, the platform, the translator and the stores (a plain profile object), so
 * nothing is written. Mutants that make the button reset the language to `en` or skip the final rebinding fail
 * here.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    alertSelect: vi.fn(),
    alertNormal: vi.fn(),
    downloadFile: vi.fn(),
}))

const store = vi.hoisted(() => ({ DBState: { db: { language: 'ko' } } }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn(async () => {}),
    selectFileByDom: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/alert'), () => ({
    alertSelect: mocks.alertSelect,
    alertNormal: mocks.alertNormal,
    alertClear: vi.fn(),
    alertConfirm: vi.fn(),
    alertError: vi.fn(),
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: mocks.downloadFile,
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/translator/translator'), () => ({
    exportLLMCacheAsJSON: vi.fn(),
    importLLMCacheFromJSON: vi.fn(),
    clearLLMCache: vi.fn(),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/stores.svelte'), () => store as unknown as typeof import('src/ts/stores.svelte'))

import { changeLanguage, language } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageGerman } from 'src/lang/de'
import { languageKorean } from 'src/lang/ko'
import { languageVietnamese } from 'src/lang/vi'
import { langState } from './languageSettingsData.svelte'
import { LANGUAGE_SHELL_SECTIONS } from './languageShellSettingsData'

const button = LANGUAGE_SHELL_SECTIONS.flatMap((section) => section.rows)
    .flatMap((row) => (row.kind === 'setting' ? [row.item] : []))
    .find((item) => item.id === 'lang.translang')
const onClick = button?.options?.onClick as () => Promise<void>

/** Scripts the two prompts: "continue an existing translation", then the language `pick`. */
function chooseContinue(pick: string): void {
    mocks.alertSelect.mockImplementation(async (list: string[]) => (list.includes(pick) ? String(list.indexOf(pick)) : '0'))
}

function downloadedJson(): typeof languageEnglish {
    const bytes = mocks.downloadFile.mock.calls[0][1] as Uint8Array
    return JSON.parse(new TextDecoder().decode(bytes)) as typeof languageEnglish
}

beforeEach(() => {
    mocks.alertSelect.mockReset()
    mocks.alertNormal.mockReset()
    mocks.downloadFile.mockReset()
    mocks.downloadFile.mockResolvedValue(true)
    store.DBState.db.language = 'ko'
    langState.changed = false
    changeLanguage('ko')
})

afterEach(() => changeLanguage('en'))

describe('the translation file button (I8)', () => {
    test('it is a button row with a click handler', () => {
        expect(button?.type).toBe('button')
        expect(typeof onClick).toBe('function')
    })

    test('(a) continuing a translation downloads it, keeps the stored language and binds it again', async () => {
        expect(languageGerman.settingsPage.unknown).not.toBe(languageKorean.settingsPage.unknown)
        chooseContinue('de')
        await onClick()
        expect(downloadedJson().settingsPage.unknown).toBe(languageGerman.settingsPage.unknown)
        expect(store.DBState.db.language).toBe('ko')
        expect(language.settingsPage.unknown).toBe(languageKorean.settingsPage.unknown)
        expect(langState.changed).toBe(false)
    })

    test('(b) a new translation downloads the English file and leaves the language alone', async () => {
        mocks.alertSelect.mockResolvedValue('1')
        await onClick()
        expect(downloadedJson().settingsPage.unknown).toBe(languageEnglish.settingsPage.unknown)
        expect(store.DBState.db.language).toBe('ko')
        expect(language.settingsPage.unknown).toBe(languageKorean.settingsPage.unknown)
    })

    test('(c) a cancelled download shows no notice and leaves the language alone', async () => {
        mocks.downloadFile.mockResolvedValue(false)
        chooseContinue('de')
        await onClick()
        expect(mocks.alertNormal).not.toHaveBeenCalled()
        expect(store.DBState.db.language).toBe('ko')
        expect(language.settingsPage.unknown).toBe(languageKorean.settingsPage.unknown)
    })

    test('(d) a rejected download rejects the click and still binds the stored language', async () => {
        mocks.downloadFile.mockRejectedValue(new Error('disk full'))
        chooseContinue('de')
        await expect(onClick()).rejects.toThrow('disk full')
        expect(language.settingsPage.unknown).toBe(languageKorean.settingsPage.unknown)
        expect(language.settingsPage.unknown).not.toBe(languageGerman.settingsPage.unknown)
    })

    test('(e) after the select changed the language, the button binds that stored language', async () => {
        store.DBState.db.language = 'vi'
        chooseContinue('de')
        await onClick()
        expect(store.DBState.db.language).toBe('vi')
        expect(language.settingsPage.unknown).toBe(languageVietnamese.settingsPage.unknown)
    })
})
