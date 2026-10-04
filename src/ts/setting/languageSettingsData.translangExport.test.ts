/**
 * The "[Translate in your own language]" choice of the UI-language setting: continuing an
 * existing translation offers every shipped translation, Spanish included, and choosing one
 * switches to it before its language JSON is downloaded.
 *
 * Drives the REAL `languageSettingsItems` with the real `src/lang`. MOCKED: the alert
 * prompts (scripted answers), the download, the platform and the translator, so nothing is
 * written. Titles beginning "regression reproducer:" fail against the version whose list
 * lacks Spanish.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    alertSelect: vi.fn(),
    alertNormal: vi.fn(),
    downloadFile: vi.fn(),
}))

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

import { changeLanguage } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageSpanish } from 'src/lang/es'
import { languageSettingsItems } from './languageSettingsData.svelte'

type OnChange = (val: string, ctx: { db: { language: string } }) => Promise<void>

const uiLanguage = languageSettingsItems.find((i) => i.id === 'lang.uiLanguage')
const onChange = (uiLanguage as unknown as { onChange: OnChange }).onChange

/** The language lists offered by the second prompt of each run. */
let offered: string[][] = []

/** Runs the translang flow, choosing "continue" first and then `pick` from the offered list. */
async function chooseTranslation(pick: string): Promise<void> {
    mocks.alertSelect.mockImplementation(async (list: string[]) => {
        if (list.includes(pick)) {
            offered.push(list)
            return String(list.indexOf(pick))
        }
        return '0'
    })
    await onChange('translang', { db: { language: 'ko' } })
}

beforeEach(() => {
    offered = []
    mocks.alertSelect.mockReset()
    mocks.alertNormal.mockReset()
    mocks.downloadFile.mockReset()
})

afterEach(() => changeLanguage('en'))

describe('the UI-language select', () => {
    test('regression reproducer: offers Spanish', () => {
        const options = (uiLanguage as unknown as {
            options: { selectOptions: { value: string; label?: string }[] }
        }).options.selectOptions
        expect(options.find((o) => o.value === 'es')?.label).toBe('Español')
    })

    test('guard: selecting a shipped language switches the app to its translation', async () => {
        expect(languageSpanish.settingsPage.unknown).not.toBe(languageEnglish.settingsPage.unknown)
        await onChange('es', { db: { language: 'es' } })
        const { language } = await import('src/lang')
        expect(language.settingsPage.unknown).toBe(languageSpanish.settingsPage.unknown)
    })
})

describe('continuing an existing translation through the UI-language setting', () => {
    test('regression reproducer: the offered list contains Spanish', async () => {
        await chooseTranslation('de')
        expect(offered[0]).toContain('es')
    })

    test('compatibility guard: the existing entries keep their positions', async () => {
        await chooseTranslation('de')
        expect(offered[0].slice(0, 5)).toEqual(['de', 'ko', 'cn', 'vi', 'zh-Hant'])
    })

    test('regression reproducer: choosing Spanish downloads the Spanish language JSON', async () => {
        expect(languageSpanish.settingsPage.unknown).not.toBe(languageEnglish.settingsPage.unknown)
        await chooseTranslation('es')

        expect(mocks.downloadFile).toHaveBeenCalledTimes(1)
        const [name, bytes] = mocks.downloadFile.mock.calls[0] as [string, Uint8Array]
        expect(name).toBe('lang.json')
        const downloaded = JSON.parse(new TextDecoder().decode(bytes)) as typeof languageEnglish
        expect(downloaded.settingsPage.unknown).toBe(languageSpanish.settingsPage.unknown)
    })

    test('compatibility guard: choosing Korean downloads the Korean language JSON', async () => {
        const { languageKorean } = await import('src/lang/ko')
        await chooseTranslation('ko')

        const bytes = mocks.downloadFile.mock.calls[0][1] as Uint8Array
        const downloaded = JSON.parse(new TextDecoder().decode(bytes)) as typeof languageEnglish
        expect(downloaded.settingsPage.unknown).toBe(languageKorean.settingsPage.unknown)
    })
})
