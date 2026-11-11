// @vitest-environment jsdom

/**
 * The row of the shell Display page: the changed-from-default dot (DS-010) and the arrival highlight. Both read
 * the stored profile or the search state and write nothing. All are guards for new behaviour (G-new): the dot and the
 * highlight do not exist on the base, so each fails only when a scratch mutant breaks the rule it names.
 *
 * MOCKED: `stores.svelte` (a `$state` DBState and plain writable stores), the platform, file, alert and click-handler
 * modules that `setDatabase` and the Display data import, and the legacy pages other than Display. The profile is
 * built through the real `setDatabase` (MC-329).
 */
import { flushSync, mount, unmount } from 'svelte'
import { tickFake } from '../../ts/tests/svelteTick.test-helpers'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

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
    alertNormal: vi.fn(),
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

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
        settingsOpen: writable(false),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/lite', () => ({ isLite: writable(false) }))
vi.mock('../Setting/Settings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/UserSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/BotSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/OtherBotSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/PluginSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/AdvancedSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/LanguageSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/AccessibilitySettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/PersonaSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/PromptSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/Module/ModuleSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/HotkeySettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/SettingsLegalLinks.svelte', () => ({ default: () => {} }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

//#endregion

import { language } from 'src/lang'
import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { setDatabase, type Database } from 'src/ts/storage/database.svelte'
import { DBState, SettingsMenuIndex, settingsOpen } from 'src/ts/stores.svelte'
import { setShellBackHandler } from '../../ts/settingsShell/settingsNavigation'
import { installSettingsOrigin, resetSettingsOriginForTests } from '../../ts/settingsShell/settingsOrigin'
import { HIGHLIGHT_MS, resetSearch, setHighlight } from '../../ts/settingsShell/settingsSearchState.svelte'
import { setSettingsShellEnabled } from '../../ts/settingsShell/settingsShellSwitch.svelte'
import { resetSettingsRouteForTests } from '../Setting/settingsRoute'
import Host from './SettingsShell.testHost.svelte'

const mounted: Array<ReturnType<typeof mount>> = []
const originalWidth = window.innerWidth
const scrollIntoView = vi.fn()

function setWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
    window.dispatchEvent(new Event('resize'))
    flushSync()
}

async function settle(): Promise<void> {
    for (let round = 0; round < 3; round++) {
        flushSync()
        await tickFake()
        await Promise.resolve()
    }
}

function mountHost(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(Host, { target }))
    flushSync()
    return target
}

function profile(overrides: Partial<Record<keyof Database, unknown>> = {}): Database {
    const next = { pluginCustomStorage: {}, ...overrides } as Database
    setDatabase(next)
    return next
}

function scroller(target: HTMLElement): HTMLElement {
    return target.querySelector<HTMLElement>('[data-part="settings-page-scroll"]')!
}

function searchField(target: HTMLElement): HTMLInputElement {
    const found = target.querySelector<HTMLInputElement>('[data-part="settings-search-input"]')
    if (!found) throw new Error('no search field')
    return found
}

async function typeQuery(target: HTMLElement, text: string): Promise<void> {
    const input = searchField(target)
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
}

async function openSearchOnPhone(target: HTMLElement): Promise<void> {
    target.querySelector<HTMLButtonElement>('[data-part="settings-search-open"]')!.click()
    await settle()
}

function result(target: HTMLElement, id: string): HTMLElement {
    const found = [...target.querySelectorAll<HTMLElement>('[data-part="settings-search-result"]')].find((el) => el.dataset.result === id)
    if (!found) throw new Error(`no result ${id}`)
    return found
}

function displayRow(target: HTMLElement, id: string): HTMLElement | null {
    return [...target.querySelectorAll<HTMLElement>('[data-setting-row]')].find((el) => el.dataset.settingRow === id) ?? null
}

function advancedExpanded(target: HTMLElement): string | null {
    return target.querySelector('[data-section="display.advanced"] button[aria-expanded]')?.getAttribute('aria-expanded') ?? null
}

function pageHeading(target: HTMLElement): Element | null {
    return target.querySelector('[data-part="settings-page-heading"]')
}

beforeEach(() => {
    localStorage.clear()
    resetBackHandlersForTests()
    resetSettingsRouteForTests()
    resetSettingsOriginForTests()
    installSettingsOrigin()
    setSettingsShellEnabled(true)
    DBState.db = profile()
    SettingsMenuIndex.set(-1)
    settingsOpen.set(false)
    scrollIntoView.mockReset()
    Element.prototype.scrollIntoView = scrollIntoView
    setWidth(1280)
})

afterEach(() => {
    vi.useRealTimers()
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
    resetSearch()
    resetBackHandlersForTests()
    resetSettingsRouteForTests()
    resetSettingsOriginForTests()
    setShellBackHandler(null)
    setSettingsShellEnabled(false)
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: originalWidth })
})

function dot(target: HTMLElement, id: string): Element | null {
    return displayRow(target, id)?.querySelector('[data-part="setting-row-dot"]') ?? null
}

describe('T-A11 the changed-from-default dot', () => {
    test('a row shows the dot exactly when its stored value differs from the default', async () => {
        DBState.db = profile({ lineHeight: 1.25 })
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        expect(displayRow(target, 'display.lineHeight')).not.toBeNull()
        expect(dot(target, 'display.lineHeight')).toBeNull()
        DBState.db.lineHeight = 1.5
        await settle()
        expect(dot(target, 'display.lineHeight')).not.toBeNull()
        expect(dot(target, 'display.lineHeight')!.getAttribute('aria-label')).toBe(language.settingsShellChangedFromDefault)
        DBState.db.lineHeight = 1.25
        await settle()
        expect(dot(target, 'display.lineHeight')).toBeNull()
    })

    test('an override reads the stored field, not the value it shows', async () => {
        DBState.db = profile({ unformatQuotes: false })
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        expect(dot(target, 'display.unformatQuotes')).toBeNull()
        DBState.db.unformatQuotes = true
        await settle()
        expect(dot(target, 'display.unformatQuotes')).not.toBeNull()
    })

    test('a row a shell component renders carries the dot of the one field it edits', async () => {
        DBState.db = profile({ assetWidth: -1 })
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        expect(dot(target, 'display.assetWidth')).toBeNull()
        DBState.db.assetWidth = 12.5
        await settle()
        expect(dot(target, 'display.assetWidth')).not.toBeNull()
    })

    test('a field with no known default never shows the dot', async () => {
        DBState.db = profile({ hideRealm: false })
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        DBState.db.hideRealm = true
        await settle()
        expect(displayRow(target, 'display.hideRealm')).not.toBeNull()
        expect(dot(target, 'display.hideRealm')).toBeNull()
    })
})

describe('the arrival highlight', () => {
    test('only the highlighted row carries the marker, and it clears with the highlight', async () => {
        vi.useFakeTimers()
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        expect(target.querySelector('[data-arrived]')).toBeNull()
        setHighlight('display.lineHeight')
        flushSync()
        const marked = [...target.querySelectorAll<HTMLElement>('[data-arrived]')].map((el) => el.dataset.settingRow)
        expect(marked).toEqual(['display.lineHeight'])
        vi.advanceTimersByTime(HIGHLIGHT_MS)
        flushSync()
        expect(target.querySelector('[data-arrived]')).toBeNull()
    })
})
