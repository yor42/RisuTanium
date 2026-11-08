// @vitest-environment jsdom

/**
 * Landing on a search result through the real shell, search, page and Display page. The arrival is one sequence
 * (close the search, set the index, mount, reveal, centre, highlight, focus); these tests hold it to that on the
 * wide and the phone layout, from another view and from the same one, and to doing nothing once it is aborted.
 * All are guards for new behaviour (G-new): the search does not exist on the base, so each fails only when a
 * scratch mutant breaks the rule it names.
 *
 * MOCKED: `stores.svelte` (a `$state` DBState and plain writable stores), the platform, file, alert and click-handler
 * modules that `setDatabase` and the Display data import, and the legacy pages other than Display. The profile is
 * built through the real `setDatabase` (MC-329). `scrollIntoView` is a stub because jsdom has none.
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

describe('T-A12a a result lands on its row (wide, from another view)', () => {
    test('a row inside the collapsed Advanced section is revealed, centred, highlighted and focused, and scroll memory is not applied', async () => {
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        scroller(target).scrollTop = 500
        SettingsMenuIndex.set(6)
        await settle()
        expect(advancedExpanded(target)).toBeNull()

        await typeQuery(target, 'custom css')
        scrollIntoView.mockClear()
        result(target, 'display.customCSS').click()
        await settle()

        expect(get(SettingsMenuIndex)).toBe(3)
        expect(settingsSearchState.open).toBe(false)
        expect(target.querySelector('[data-part="settings-search-results"]')).toBeNull()
        expect(advancedExpanded(target)).toBe('true')
        const row = displayRow(target, 'display.customCSS')!
        expect(scrollIntoView).toHaveBeenCalledTimes(1)
        expect(scrollIntoView.mock.contexts[0]).toBe(row)
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
        expect(row.dataset.arrived).toBe('true')
        expect(row.contains(document.activeElement)).toBe(true)
        expect(scroller(target).scrollTop).toBe(0)
        await settle()
        expect(scroller(target).scrollTop).toBe(0)
    })

    test('the highlight ends after two seconds', async () => {
        vi.useFakeTimers()
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        await typeQuery(target, 'line height')
        result(target, 'display.lineHeight').click()
        await settle()
        expect(displayRow(target, 'display.lineHeight')!.dataset.arrived).toBe('true')
        vi.advanceTimersByTime(2000)
        flushSync()
        expect(displayRow(target, 'display.lineHeight')!.dataset.arrived).toBeUndefined()
    })
})

describe('T-A12b a result lands on its row (phone)', () => {
    test('the focus never visits the page heading on the way to the row control', async () => {
        setWidth(400)
        SettingsMenuIndex.set(-1)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        await openSearchOnPhone(target)
        await typeQuery(target, 'line height')

        const focused: Element[] = []
        const record = (event: FocusEvent): void => { if (event.target instanceof Element) focused.push(event.target) }
        document.addEventListener('focusin', record)
        try {
            result(target, 'display.lineHeight').click()
            await settle()
        } finally {
            document.removeEventListener('focusin', record)
        }

        expect(get(SettingsMenuIndex)).toBe(3)
        const row = displayRow(target, 'display.lineHeight')!
        expect(focused.length).toBeGreaterThan(0)
        expect(focused.some((el) => el.matches('[data-part="settings-page-heading"]'))).toBe(false)
        expect(row.contains(focused[focused.length - 1])).toBe(true)
        expect(row.contains(document.activeElement)).toBe(true)
    })
})

describe('T-A12c page and view targets', () => {
    test('a legacy view target opens the view and focuses its heading', async () => {
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        await typeQuery(target, language.chatFormating)
        result(target, 'chatFormat.template').click()
        await settle()
        expect(get(SettingsMenuIndex)).toBe(1)
        expect(document.activeElement).toBe(pageHeading(target))
        expect(scrollIntoView).not.toHaveBeenCalled()
    })

    test('a row the page no longer has focuses the heading and throws nothing', async () => {
        DBState.db = profile({ customQuotes: true })
        SettingsMenuIndex.set(6)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        await typeQuery(target, language.leadingDoubleQuote)
        const hit = result(target, 'display.leadingDoubleQuote')
        DBState.db.customQuotes = false
        flushSync()
        hit.click()
        await settle()
        expect(get(SettingsMenuIndex)).toBe(3)
        expect(document.activeElement).toBe(pageHeading(target))
        expect(scrollIntoView).not.toHaveBeenCalled()
    })
})

describe('T-A12c2 page and view targets (phone)', () => {
    test('a view target opened from the phone search focuses the heading and never the search button', async () => {
        setWidth(400)
        SettingsMenuIndex.set(-1)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        await openSearchOnPhone(target)
        await typeQuery(target, language.chatFormating)

        const focused: Element[] = []
        const record = (event: FocusEvent): void => { if (event.target instanceof Element) focused.push(event.target) }
        document.addEventListener('focusin', record)
        try {
            result(target, 'chatFormat.template').click()
            await settle()
        } finally {
            document.removeEventListener('focusin', record)
        }

        expect(get(SettingsMenuIndex)).toBe(1)
        expect(pageHeading(target)).not.toBeNull()
        expect(document.activeElement).toBe(pageHeading(target))
        expect(focused.some((el) => el.matches('[data-part="settings-search-open"]'))).toBe(false)
    })
})

describe('T-A12h teardown resets the search', () => {
    test('unmounting within two seconds of a landing leaves no product timer', async () => {
        vi.useFakeTimers()
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const baselineTarget = mountHost()
        await settle()
        unmount(mounted.pop()!)
        baselineTarget.remove()
        await settle()
        const baselineTimers = vi.getTimerCount()
        vi.clearAllTimers()

        const target = mountHost()
        await settle()
        await typeQuery(target, 'line height')
        result(target, 'display.lineHeight').click()
        await settle()
        expect(displayRow(target, 'display.lineHeight')!.dataset.arrived).toBe('true')
        unmount(mounted.pop()!)
        target.remove()
        await settle()

        expect(vi.getTimerCount()).toBeLessThanOrEqual(baselineTimers)
    })

    test('unmounting with the search open and a query typed closes the search and clears the query', async () => {
        SettingsMenuIndex.set(6)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        await typeQuery(target, 'custom css')
        expect(settingsSearchState.open).toBe(true)
        expect(settingsSearchState.query).toBe('custom css')

        unmount(mounted.pop()!)
        target.remove()
        await settle()

        expect(settingsSearchState.open).toBe(false)
        expect(settingsSearchState.query).toBe('')
    })
})

describe('T-A12i reduced motion', () => {
    const originalMatchMedia = window.matchMedia

    afterEach(() => {
        Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: originalMatchMedia })
    })

    test('a reduced-motion preference lands on the row with an instant scroll', async () => {
        const queries: string[] = []
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            writable: true,
            value: (query: string) => {
                queries.push(query)
                return { matches: query === '(prefers-reduced-motion: reduce)', media: query }
            },
        })
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        await typeQuery(target, 'custom css')
        scrollIntoView.mockClear()
        result(target, 'display.customCSS').click()
        await settle()

        expect(queries).toContain('(prefers-reduced-motion: reduce)')
        expect(scrollIntoView).toHaveBeenCalledTimes(1)
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'instant' })
    })
})

describe('T-A12f a result on the view already open', () => {
    test.each([['wide', 1280], ['phone', 400]] as const)('%s: the same index lands like any other open', async (_name, width) => {
        setWidth(width)
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        scroller(target).scrollTop = 500
        if (width < 600) await openSearchOnPhone(target)
        await typeQuery(target, 'custom css')
        scrollIntoView.mockClear()
        result(target, 'display.customCSS').click()
        await settle()

        expect(get(SettingsMenuIndex)).toBe(3)
        expect(settingsSearchState.open).toBe(false)
        expect(advancedExpanded(target)).toBe('true')
        const row = displayRow(target, 'display.customCSS')!
        expect(scrollIntoView).toHaveBeenCalledTimes(1)
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
        expect(row.dataset.arrived).toBe('true')
        expect(row.contains(document.activeElement)).toBe(true)
        expect(scroller(target).scrollTop).toBe(0)
    })
})

describe('T-A12g an aborted arrival is inert', () => {
    test.each([['wide', 1280], ['phone', 400]] as const)('%s: Ctrl+K pressed before the arrival finishes keeps the search and focus in the field', async (_name, width) => {
        setWidth(width)
        SettingsMenuIndex.set(width < 600 ? -1 : 6)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        if (width < 600) await openSearchOnPhone(target)
        await typeQuery(target, 'custom css')
        result(target, 'display.customCSS').click()
        target.querySelector('[data-part="settings-shell"]')!.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }),
        )
        await settle()

        expect(settingsSearchState.open).toBe(true)
        expect(document.activeElement).toBe(searchField(target))
        expect(target.querySelector('[data-arrived]')).toBeNull()
        expect(scrollIntoView).not.toHaveBeenCalled()
    })

    test('tearing Settings down in the middle of an arrival throws nothing and leaves no timer', async () => {
        vi.useFakeTimers()
        SettingsMenuIndex.set(6)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        const afterMount = vi.getTimerCount()
        await typeQuery(target, 'custom css')
        expect(vi.getTimerCount()).toBeGreaterThan(afterMount)
        result(target, 'display.customCSS').click()
        unmount(mounted.pop()!)
        target.remove()
        await settle()
        expect(scrollIntoView).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBeLessThanOrEqual(afterMount)
    })
})
