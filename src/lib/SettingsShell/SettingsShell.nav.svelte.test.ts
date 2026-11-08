// @vitest-environment jsdom

/**
 * The index of the Settings shell: its keyboard model, `aria-current`, the landmarks and where focus goes on
 * open, on a phone drill-in and on Back to the index. All guards for new behaviour (G-new).
 *
 * MOCKED: `stores.svelte` (plain writable stores), `alertBack`, `lite`, the legacy Settings page components and
 * the legal links. The shell, its index and the host are real.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const menu = $state([] as unknown[])
    return {
        DBState: state,
        additionalSettingsMenu: menu,
        easyPanelStore: { open: false },
        MobileGUI: writable(false),
        SettingsMenuIndex: writable(-1),
        settingsOpen: writable(false),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('../../ts/stores.svelte')
})

vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/lite', () => ({ isLite: writable(false) }))
vi.mock('../Setting/Settings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/UserSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/BotSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/OtherBotSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/DisplaySettings.svelte', () => ({ default: () => {} }))
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

import { resetBackHandlersForTests } from '../../ts/backHandlers'
import { DBState, SettingsMenuIndex, selIdState, settingsOpen } from '../../ts/stores.svelte'
import { setSettingsShellEnabled } from '../../ts/settingsShell/settingsShellSwitch.svelte'
import { installSettingsOrigin, resetSettingsOriginForTests } from '../../ts/settingsShell/settingsOrigin'
import { setShellBackHandler } from '../../ts/settingsShell/settingsNavigation'
import { resetSettingsRouteForTests } from '../Setting/settingsRoute'
import Host from './SettingsShell.testHost.svelte'

const mounted: Array<ReturnType<typeof mount>> = []
const originalWidth = window.innerWidth

function setWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
    window.dispatchEvent(new Event('resize'))
    flushSync()
}

/** Lets effects and the `tick` they wait on run. */
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

function entries(target: HTMLElement): HTMLButtonElement[] {
    return [...target.querySelectorAll<HTMLButtonElement>('[data-part="settings-index-entry"]')]
}

function entry(target: HTMLElement, page: string): HTMLButtonElement {
    const found = entries(target).find((candidate) => candidate.dataset.page === page)
    if (!found) throw new Error(`no index entry ${page}`)
    return found
}

function key(element: HTMLElement, name: string): void {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
    flushSync()
}

beforeEach(() => {
    localStorage.clear()
    resetBackHandlersForTests()
    resetSettingsRouteForTests()
    resetSettingsOriginForTests()
    installSettingsOrigin()
    setSettingsShellEnabled(true)
    DBState.db = { characters: [] } as unknown as Database
    selIdState.selId = -1
    SettingsMenuIndex.set(-1)
    settingsOpen.set(false)
})

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
    resetBackHandlersForTests()
    resetSettingsRouteForTests()
    resetSettingsOriginForTests()
    setShellBackHandler(null)
    setSettingsShellEnabled(false)
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: originalWidth })
})

describe('T12 the index', () => {
    test('wide: ten entries, one aria-current, the landmarks, and focus on the selected entry', async () => {
        setWidth(1280)
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        expect(entries(target)).toHaveLength(10)
        const current = entries(target).filter((candidate) => candidate.getAttribute('aria-current') === 'page')
        expect(current.map((candidate) => candidate.dataset.page)).toEqual(['display'])
        expect(document.activeElement).toBe(entry(target, 'display'))
        expect(target.querySelector('header')).not.toBeNull()
        expect(target.querySelector('nav')).not.toBeNull()
        expect(target.querySelector('main')).not.toBeNull()
    })

    test('wide: arrows, Home and End move focus; Enter opens the page', async () => {
        setWidth(1280)
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        key(entry(target, 'display'), 'ArrowDown')
        expect(document.activeElement).toBe(entry(target, 'input'))
        key(entry(target, 'input'), 'ArrowUp')
        expect(document.activeElement).toBe(entry(target, 'display'))
        key(entry(target, 'display'), 'End')
        expect(document.activeElement).toBe(entry(target, 'advanced'))
        key(entry(target, 'advanced'), 'Home')
        expect(document.activeElement).toBe(entry(target, 'models'))
        key(entry(target, 'models'), 'ArrowUp')
        expect(document.activeElement).toBe(entry(target, 'models'))
        key(entry(target, 'models'), 'ArrowDown')
        key(entry(target, 'features'), 'Enter')
        expect(get(SettingsMenuIndex)).toBe(2)
        expect(entry(target, 'features').getAttribute('aria-current')).toBe('page')
        expect(entries(target).filter((candidate) => candidate.getAttribute('aria-current') === 'page')).toHaveLength(1)
    })

    test('phone: the index opens with the first entry focused, a page takes the heading, Back refocuses the entry', async () => {
        setWidth(412)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        expect(target.querySelector('[data-part="settings-page"]')).toBeNull()
        expect(entries(target).filter((candidate) => candidate.hasAttribute('aria-current'))).toHaveLength(0)
        expect(document.activeElement).toBe(entries(target)[0])

        key(entry(target, 'display'), 'Enter')
        await settle()
        expect(get(SettingsMenuIndex)).toBe(3)
        expect(target.querySelector('[data-part="settings-index"]')).toBeNull()
        expect(document.activeElement).toBe(target.querySelector('[data-part="settings-page-heading"]'))
        // Class check only: jsdom paints no CSS, so the visible ring is confirmed in a real browser.
        const heading = target.querySelector('[data-part="settings-page-heading"]')!
        expect(heading.getAttribute('tabindex')).toBe('-1')
        expect(heading.classList.contains('focus-visible:ring-2')).toBe(true)
        expect(heading.classList.contains('focus-visible:ring-textcolor2')).toBe(true)

        target.querySelector<HTMLButtonElement>('[data-part="settings-back"]')!.click()
        await settle()
        expect(get(SettingsMenuIndex)).toBe(-1)
        expect(document.activeElement).toBe(entry(target, 'display'))
    })
})
