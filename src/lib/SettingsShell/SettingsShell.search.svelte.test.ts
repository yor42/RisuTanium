// @vitest-environment jsdom

/**
 * The Settings search through the real shell: the keys that reach the field, the results and the combobox, the
 * phone field and the polite count. All are guards for new behaviour (G-new): the search does not exist on the
 * base, so each fails only when a scratch mutant breaks the rule it names (T-A1 is the exception and is shown red
 * on the base).
 *
 * MOCKED: `stores.svelte` (a `$state` DBState and plain writable stores), the platform, file, alert and click-handler
 * modules that `setDatabase` and the Display data import, and the legacy pages other than Display. The profile is
 * built through the real `setDatabase` (MC-329).
 */
import { flushSync, mount, tick, unmount } from 'svelte'
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
import { enterKeydown, imeEventSequence } from 'src/ts/ime/tests/imeEventSequence'
import { setShellBackHandler } from '../../ts/settingsShell/settingsNavigation'
import { installSettingsOrigin, resetSettingsOriginForTests } from '../../ts/settingsShell/settingsOrigin'
import { resetSearch, settingsSearchState } from '../../ts/settingsShell/settingsSearchState.svelte'
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
        await tick()
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

function press(el: Element, init: KeyboardEventInit & { keyCode?: number }): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    el.dispatchEvent(event)
    flushSync()
    return event
}

function indexEntry(target: HTMLElement): HTMLElement {
    return target.querySelector<HTMLElement>('[data-part="settings-index-entry"]')!
}

function resultIds(target: HTMLElement): string[] {
    return [...target.querySelectorAll<HTMLElement>('[data-part="settings-search-result"]')].map((el) => el.dataset.result ?? '')
}

describe('T-A1 the keys that reach the search field', () => {
    test('Ctrl+K on a focused index entry opens the search and focuses its field', async () => {
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        indexEntry(target).focus()
        const event = press(indexEntry(target), { key: 'k', ctrlKey: true })
        await settle()
        expect(event.defaultPrevented).toBe(true)
        expect(settingsSearchState.open).toBe(true)
        expect(document.activeElement).toBe(searchField(target))
    })

    test('Cmd+K does the same, and Ctrl+Shift+K does not', async () => {
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        press(indexEntry(target), { key: 'K', ctrlKey: true, shiftKey: true })
        await settle()
        expect(settingsSearchState.open).toBe(false)
        press(indexEntry(target), { key: 'k', metaKey: true })
        await settle()
        expect(document.activeElement).toBe(searchField(target))
    })

    test('a slash outside a text field focuses the field', async () => {
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        const event = press(indexEntry(target), { key: '/' })
        await settle()
        expect(event.defaultPrevented).toBe(true)
        expect(document.activeElement).toBe(searchField(target))
    })
})

describe('T-A9 a shortcut fires only where it belongs', () => {
    test('a slash typed in a text field is left to the field', async () => {
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        const event = press(searchField(target), { key: '/' })
        await settle()
        expect(event.defaultPrevented).toBe(false)
        expect(settingsSearchState.open).toBe(false)
    })

    test('Ctrl+K outside the shell does nothing', async () => {
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        mountHost()
        await settle()
        const outside = document.createElement('button')
        document.body.append(outside)
        const event = press(outside, { key: 'k', ctrlKey: true })
        await settle()
        expect(event.defaultPrevented).toBe(false)
        expect(settingsSearchState.open).toBe(false)
    })
})

describe('T-A10 an IME composition owns its keys', () => {
    test.each([
        ['isComposing', { isComposing: true }],
        ['keyCode 229', { keyCode: 229 }],
    ] as const)('Ctrl+K during a composition (%s) is ignored', async (_name, extra) => {
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        const event = press(indexEntry(target), { key: 'k', ctrlKey: true, ...extra })
        await settle()
        expect(event.defaultPrevented).toBe(false)
        expect(settingsSearchState.open).toBe(false)
    })

    test('Enter that commits a composition does not open a result', async () => {
        SettingsMenuIndex.set(6)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        await typeQuery(target, 'custom css')
        press(searchField(target), { key: 'Enter', isComposing: true })
        await settle()
        expect(settingsSearchState.open).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(6)
    })
})

describe('T-R-Settings the Enter that follows a composition end', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    test.each([2, 200])('an Enter at +%s ms after compositionend opens the result once', async (gap) => {
        SettingsMenuIndex.set(6)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        await typeQuery(target, 'custom css')
        const field = searchField(target)
        const clock = vi.spyOn(performance, 'now')
        clock.mockReturnValue(1000)
        imeEventSequence(field, 'custom css')
        clock.mockReturnValue(1000 + gap)
        const press = enterKeydown(field)
        flushSync()
        await settle()
        expect(press.defaultPrevented).toBe(true)
        expect(settingsSearchState.open).toBe(false)
    })
})

describe('the results and the combobox', () => {
    test('typing opens the search and lists matching settings with the match marked', async () => {
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        await typeQuery(target, 'custom css')
        expect(settingsSearchState.open).toBe(true)
        expect(resultIds(target)).toContain('display.customCSS')
        expect(target.querySelector('[data-part="settings-page"]')).toBeNull()
        expect(target.querySelector('[data-part="settings-index-entry"][aria-current="page"]')).toBeNull()
        const marked = result(target, 'display.customCSS').querySelector('mark')
        expect(marked).not.toBeNull()
        const input = searchField(target)
        expect(input.getAttribute('aria-expanded')).toBe('true')
        const listbox = target.querySelector('[role="listbox"]')!
        expect(input.getAttribute('aria-controls')).toBe(listbox.id)
    })

    test('arrow keys move the active option and Enter opens it', async () => {
        SettingsMenuIndex.set(6)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        await typeQuery(target, 'custom css')
        const input = searchField(target)
        press(input, { key: 'ArrowDown' })
        const first = target.querySelector<HTMLElement>('[role="option"]')!
        expect(input.getAttribute('aria-activedescendant')).toBe(first.id)
        expect(first.getAttribute('aria-selected')).toBe('true')
        press(input, { key: 'ArrowUp' })
        const options = [...target.querySelectorAll<HTMLElement>('[role="option"]')]
        expect(input.getAttribute('aria-activedescendant')).toBe(options[options.length - 1].id)
        press(input, { key: 'ArrowDown' })
        press(input, { key: 'Enter' })
        await settle()
        expect(settingsSearchState.open).toBe(false)
        expect(get(SettingsMenuIndex)).toBe(3)
    })

    test('a group shows five and a show-all row expands it', async () => {
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        await typeQuery(target, 'size')
        const more = target.querySelector<HTMLElement>('[data-part="settings-search-more"]')!
        expect(more).not.toBeNull()
        const shown = resultIds(target).length
        expect(shown).toBeGreaterThanOrEqual(5)
        const total = Number(/\((\d+)\)/.exec(more.textContent ?? '')![1])
        expect(total).toBeGreaterThan(5)
        more.click()
        await settle()
        expect(target.querySelector('[data-part="settings-search-more"]')).toBeNull()
        expect(resultIds(target).length).toBeGreaterThan(shown)
    })

    test('a query with no hit says so and offers to clear or browse', async () => {
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        await typeQuery(target, 'qqqqzzzz')
        const none = target.querySelector('[data-part="settings-search-none"]')!
        expect(none.textContent).toContain('qqqqzzzz')
        target.querySelector<HTMLButtonElement>('[data-part="settings-search-clear"]')!.click()
        await settle()
        expect(settingsSearchState.query).toBe('')
        expect(settingsSearchState.open).toBe(true)
        await typeQuery(target, 'qqqqzzzz')
        target.querySelector<HTMLButtonElement>('[data-part="settings-search-browse"]')!.click()
        await settle()
        expect(settingsSearchState.open).toBe(false)
        expect(target.querySelector('[data-part="settings-page"]')).not.toBeNull()
    })

    test('a retry that matches only some words says so', async () => {
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        await typeQuery(target, 'enter qqqq')
        expect(target.querySelector('[data-part="settings-search-partial"]')).not.toBeNull()
        expect(resultIds(target)).toContain('acc.sendWithEnter')
    })

    test('choosing an index entry while the search is open closes it', async () => {
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        await typeQuery(target, 'size')
        const entries = [...target.querySelectorAll<HTMLButtonElement>('[data-part="settings-index-entry"]')]
        entries[0].click()
        await settle()
        expect(settingsSearchState.open).toBe(false)
        expect(target.querySelector('[data-part="settings-page"]')).not.toBeNull()
    })
})

describe('the phone field', () => {
    test('the button opens the field in place of the title, and the close button brings the title back', async () => {
        setWidth(400)
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        expect(target.querySelector('[data-part="settings-search-input"]')).toBeNull()
        await openSearchOnPhone(target)
        expect(document.activeElement).toBe(searchField(target))
        expect(target.querySelector('[data-part="settings-title"]')).toBeNull()
        target.querySelector<HTMLButtonElement>('[data-part="settings-search-close"]')!.click()
        await settle()
        expect(settingsSearchState.open).toBe(false)
        expect(target.querySelector('[data-part="settings-title"]')).not.toBeNull()
        expect(document.activeElement).toBe(target.querySelector('[data-part="settings-search-open"]'))
    })

    test('results replace the index', async () => {
        setWidth(400)
        SettingsMenuIndex.set(-1)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        await openSearchOnPhone(target)
        await typeQuery(target, 'size')
        expect(target.querySelector('[data-part="settings-index"]')).toBeNull()
        expect(resultIds(target).length).toBeGreaterThan(0)
    })
})

describe('the polite count (T-A15)', () => {
    test('the count is announced 500 ms after typing settles', async () => {
        vi.useFakeTimers()
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        await typeQuery(target, 'custom css')
        const status = target.querySelector('[data-part="settings-search-status"]')!
        expect(status.textContent).toBe('')
        vi.advanceTimersByTime(499)
        flushSync()
        expect(status.textContent).toBe('')
        vi.advanceTimersByTime(1)
        flushSync()
        expect(status.textContent).toMatch(/^\d+ results?$/)
    })

    test('tearing Settings down before it fires leaves no timer and no later write', async () => {
        vi.useFakeTimers()
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        const before = vi.getTimerCount()
        await typeQuery(target, 'custom css')
        const status = target.querySelector('[data-part="settings-search-status"]')!
        unmount(mounted.pop()!)
        expect(vi.getTimerCount()).toBe(before)
        vi.advanceTimersByTime(1000)
        expect(status.textContent).toBe('')
    })
})
