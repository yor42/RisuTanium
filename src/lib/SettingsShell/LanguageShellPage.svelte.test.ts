// @vitest-environment jsdom

/**
 * The shell Language page (legacy index 10) with the real page, rows, wrappers, registry and the real language
 * modules. The profile is built through the real `setDatabase` on an empty profile (MC-329).
 *
 * MOCKED: `stores.svelte` (a `$state` DBState and plain writable stores), the alert prompts (scripted answers), the
 * download, and the platform, file and click-handler modules that `setDatabase` and the setting data import.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const mocks = vi.hoisted(() => ({
    alertSelect: vi.fn(),
    alertNormal: vi.fn(),
    downloadFile: vi.fn(),
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    encryptBuffer: vi.fn(async (d: unknown) => d),
    selectSingleFile: vi.fn(async () => null),
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
    changeFullscreen: vi.fn(),
    sleep: vi.fn(async () => {}),
    selectFileByDom: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: mocks.alertNormal,
    alertSelect: mocks.alertSelect,
    alertError: vi.fn(),
    alertConfirm: vi.fn(),
    alertWait: vi.fn(),
    alertClear: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/globalApi.svelte'), async (importOriginal) => ({
    ...(await importOriginal()),
    downloadFile: mocks.downloadFile,
}))

vi.mock(import('src/ts/translator/translator'), () => ({
    exportLLMCacheAsJSON: vi.fn(),
    importLLMCacheFromJSON: vi.fn(),
    clearLLMCache: vi.fn(),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    createHypaV3Preset: vi.fn((name: string, settings: unknown) => ({ name, settings })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/translator/presets'), () => ({
    normalizeTranslatorPresetState: vi.fn(),
}) as unknown as typeof import('src/ts/translator/presets'))

vi.mock(import('src/ts/polyfill'), () => ({
    safeStructuredClone: vi.fn((v: unknown) => JSON.parse(JSON.stringify(v))),
}) as unknown as typeof import('src/ts/polyfill'))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
    BaseDirectory: { AppData: 0 },
}))

vi.mock('src/ts/rpack/rpack_js.js', () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => data),
    decodeRPack: vi.fn(async (data: Uint8Array) => data),
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    const menu = $state([] as unknown[])
    return {
        DBState: state,
        additionalSettingsMenu: menu,
        easyPanelStore: { open: false },
        SettingsMenuIndex: writable(-1),
        CustomGUISettingMenuStore: writable(false),
        CustomCSSStore: writable(''),
        SafeModeStore: writable(false),
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        MobileGUI: writable(false),
        settingsOpen: writable(true),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))

//#endregion

import { changeLanguage, language } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageGerman } from 'src/lang/de'
import { languageKorean } from 'src/lang/ko'
import { setDatabase, type Database } from 'src/ts/storage/database.svelte'
import { DBState } from 'src/ts/stores.svelte'
import LanguageShellPage from './LanguageShellPage.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

type PageExports = { reveal(rowId: string): Promise<HTMLElement | null> }

async function settle(): Promise<void> {
    for (let round = 0; round < 5; round++) {
        flushSync()
        await tick()
        await Promise.resolve()
    }
}

function freshProfile(overrides: Partial<Record<keyof Database, unknown>> = {}): Database {
    const profile = { pluginCustomStorage: {}, ...overrides } as Database
    setDatabase(profile)
    return profile
}

function showPage(): { target: HTMLElement, page: PageExports } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const page = mount(LanguageShellPage, { target }) as unknown as PageExports
    mounted.push(page as unknown as ReturnType<typeof mount>)
    flushSync()
    return { target, page }
}

function maybeRow(target: HTMLElement, id: string): HTMLElement | null {
    return [...target.querySelectorAll<HTMLElement>('[data-setting-row]')].find((el) => el.dataset.settingRow === id) ?? null
}

function statusText(target: HTMLElement): string {
    return [...target.querySelectorAll('[role="status"]')].map((el) => el.textContent?.trim() ?? '').join('')
}

function dbSnapshot(): Record<string, unknown> {
    return JSON.parse(JSON.stringify($state.snapshot(DBState.db))) as Record<string, unknown>
}

async function chooseLanguage(target: HTMLElement, value: string): Promise<void> {
    const select = maybeRow(target, 'lang.uiLanguage')!.querySelector<HTMLSelectElement>('select')!
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
}

beforeEach(() => {
    mocks.alertSelect.mockReset()
    mocks.alertNormal.mockReset()
    mocks.downloadFile.mockReset()
    mocks.downloadFile.mockResolvedValue(true)
    DBState.db = freshProfile({ language: 'ko' })
    changeLanguage('ko')
})

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
    changeLanguage('en')
})

describe('the Language page at index 10', () => {
    test('(a) no pending line on mount', async () => {
        const { target } = showPage()
        await settle()
        expect(maybeRow(target, 'lang.pending')).not.toBeNull()
        expect(statusText(target)).toBe('')
    })

    test('(b) changing the language shows the calm line, and it stays when translator rows appear', async () => {
        const { target } = showPage()
        await settle()
        await chooseLanguage(target, 'de')
        expect(DBState.db.language).toBe('de')
        // The line is drawn as soon as the stored language differs, in whichever language is bound at that moment.
        const tables: Array<Record<string, unknown>> = [languageEnglish, languageKorean, languageGerman]
        const lineIn = tables.map((table) => table.settingsShellLangPending ?? languageEnglish.settingsShellLangPending)
        expect(lineIn).toContain(statusText(target))
        expect(statusText(target)).not.toBe('')
        expect(target.querySelector('[data-part="language-pending"] button')).toBeNull()
        expect(maybeRow(target, 'lang.translatorType')).toBeNull()
        DBState.db.translator = 'ko'
        await settle()
        expect(maybeRow(target, 'lang.translatorType')).not.toBeNull()
        expect(statusText(target)).not.toBe('')
    })

    test('(c) the translation file button keeps the stored language and the Korean binding and shows no line', async () => {
        const { target } = showPage()
        await settle()
        mocks.alertSelect.mockImplementation(async (list: string[]) => (list.includes('de') ? String(list.indexOf('de')) : '0'))
        const before = dbSnapshot()
        maybeRow(target, 'lang.translang')!.querySelector<HTMLButtonElement>('button')!.click()
        await settle()
        expect(mocks.downloadFile).toHaveBeenCalledTimes(1)
        const bytes = mocks.downloadFile.mock.calls[0][1] as Uint8Array
        const downloaded = JSON.parse(new TextDecoder().decode(bytes)) as typeof languageKorean
        expect(downloaded.settingsPage.unknown).toBe(languageGerman.settingsPage.unknown)
        expect(DBState.db.language).toBe('ko')
        expect(dbSnapshot()).toEqual(before)
        expect(language.settingsPage.unknown).toBe(languageKorean.settingsPage.unknown)
        expect(statusText(target)).toBe('')
    })

    test('(d) the select has no translate option and offers Japanese', async () => {
        const { target } = showPage()
        await settle()
        const values = [...maybeRow(target, 'lang.uiLanguage')!.querySelectorAll<HTMLOptionElement>('option')].map((option) => option.value)
        expect(values).not.toContain('translang')
        expect(values).toContain('ja')
        expect(values.length).toBe(8)
    })

    test('(e) mounting writes nothing to the profile', async () => {
        const before = dbSnapshot()
        showPage()
        await settle()
        expect(dbSnapshot()).toEqual(before)
    })

    test('reveal returns a translation row once the translator is on, and null before', async () => {
        const { page } = showPage()
        await settle()
        expect(await page.reveal('lang.translatorLang')).not.toBeNull()
        expect(await page.reveal('lang.translatorType')).toBeNull()
        expect(await page.reveal('lang.nope')).toBeNull()
    })
})
