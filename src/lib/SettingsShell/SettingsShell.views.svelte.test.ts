// @vitest-environment jsdom

/**
 * What the Settings page hosts: the view chips and the legacy callbacks, the plugin rows, the Easy panel row, the
 * per-view scroll memory and the shortcuts page on a phone. All guards for new behaviour (G-new).
 *
 * MOCKED: `stores.svelte` (plain writable stores), `alertBack`, `lite`, the legacy Settings pages other than the
 * hotkey page (the stubs record the props they were given), the legal links and the plugin icon. The shell, the
 * page and the real `HotkeySettings` are not mocked.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'

const seen = vi.hoisted(() => ({
    bot: null as { goPromptTemplate: () => void } | null,
    prompt: null as { onGoBack: () => void } | null,
    displayMounts: 0,
}))

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
vi.mock('../Setting/Pages/BotSettings.svelte', () => ({ default: (_anchor: unknown, props: { goPromptTemplate: () => void }) => { seen.bot = props } }))
vi.mock('../Setting/Pages/OtherBotSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/DisplaySettings.svelte', () => ({ default: () => { seen.displayMounts++ } }))
vi.mock('../Setting/Pages/PluginSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/AdvancedSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/LanguageSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/AccessibilitySettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/PersonaSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/PromptSettings.svelte', () => ({ default: (_anchor: unknown, props: { onGoBack: () => void }) => { seen.prompt = props } }))
vi.mock('../Setting/Pages/Module/ModuleSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/SettingsLegalLinks.svelte', () => ({ default: () => {} }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

import { language } from '../../lang'
import { resetBackHandlersForTests } from '../../ts/backHandlers'
import { additionalSettingsMenu, DBState, easyPanelStore, SettingsMenuIndex, selIdState, settingsOpen } from '../../ts/stores.svelte'
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

function chip(target: HTMLElement, view: string): HTMLButtonElement {
    const found = target.querySelector<HTMLButtonElement>(`[data-part="settings-view-chip"][data-view="${view}"]`)
    if (!found) throw new Error(`no chip ${view}`)
    return found
}

function scroller(target: HTMLElement): HTMLElement {
    return target.querySelector<HTMLElement>('[data-part="settings-page-scroll"]')!
}

function menuRows(): Array<{ name: string, icon: string, iconType: 'none', callback: () => void, id: string }> {
    return additionalSettingsMenu as unknown as Array<{ name: string, icon: string, iconType: 'none', callback: () => void, id: string }>
}

beforeEach(() => {
    localStorage.clear()
    seen.bot = null
    seen.prompt = null
    seen.displayMounts = 0
    resetBackHandlersForTests()
    resetSettingsRouteForTests()
    resetSettingsOriginForTests()
    installSettingsOrigin()
    setSettingsShellEnabled(true)
    DBState.db = { characters: [], enableRisuaiProTools: false } as unknown as Database
    selIdState.selId = -1
    easyPanelStore.open = false
    menuRows().length = 0
    SettingsMenuIndex.set(-1)
    settingsOpen.set(false)
    setWidth(1280)
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

describe('T13 views, plugin rows and the Easy panel row', () => {
    test('the models chips switch between Chat bot and Prompt, and the legacy callbacks move the same way', () => {
        SettingsMenuIndex.set(1)
        settingsOpen.set(true)
        const target = mountHost()
        expect(chip(target, 'chatBot').getAttribute('aria-pressed')).toBe('true')
        expect(chip(target, 'prompt').getAttribute('aria-pressed')).toBe('false')
        chip(target, 'prompt').click()
        flushSync()
        expect(get(SettingsMenuIndex)).toBe(13)
        expect(chip(target, 'prompt').getAttribute('aria-pressed')).toBe('true')
        expect(seen.prompt).not.toBeNull()
        seen.prompt!.onGoBack()
        flushSync()
        expect(get(SettingsMenuIndex)).toBe(1)
        seen.bot!.goPromptTemplate()
        flushSync()
        expect(get(SettingsMenuIndex)).toBe(13)
    })

    test('the extensions chips switch between Plugins and Modules; a single-view page has none', () => {
        SettingsMenuIndex.set(4)
        settingsOpen.set(true)
        const target = mountHost()
        chip(target, 'modules').click()
        flushSync()
        expect(get(SettingsMenuIndex)).toBe(14)
        chip(target, 'plugins').click()
        flushSync()
        expect(get(SettingsMenuIndex)).toBe(4)
        SettingsMenuIndex.set(3)
        flushSync()
        expect(target.querySelector('[data-part="settings-view-chip"]')).toBeNull()
    })

    test('a plugin-defined menu entry is a row on the extensions page that runs its callback', () => {
        const callback = vi.fn()
        menuRows().push({ name: 'My plugin page', icon: '', iconType: 'none', callback, id: 'p1' })
        SettingsMenuIndex.set(4)
        settingsOpen.set(true)
        const target = mountHost()
        const row = target.querySelector<HTMLButtonElement>('[data-part="settings-plugin-row"]')
        expect(row?.textContent).toContain('My plugin page')
        row!.click()
        expect(callback).toHaveBeenCalledTimes(1)
        SettingsMenuIndex.set(3)
        flushSync()
        expect(target.querySelector('[data-part="settings-plugin-row"]')).toBeNull()
    })

    test('the Easy panel row appears on Advanced only with Pro tools on, and opens the panel', () => {
        SettingsMenuIndex.set(6)
        settingsOpen.set(true)
        const target = mountHost()
        expect(target.querySelector('[data-part="settings-easy-panel"]')).toBeNull()
        unmount(mounted.pop()!)
        target.remove()
        DBState.db = { characters: [], enableRisuaiProTools: true } as unknown as Database
        const withTools = mountHost()
        const row = withTools.querySelector<HTMLButtonElement>('[data-part="settings-easy-panel"]')
        expect(row?.textContent).toContain(language.easyPanel)
        row!.click()
        expect(easyPanelStore.open).toBe(true)
    })
})

describe('one hosted page across layouts', () => {
    test('rotating between the phone and the wide layout keeps the same hosted page instance', async () => {
        setWidth(412)
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        mountHost()
        await settle()
        expect(seen.displayMounts).toBe(1)
        setWidth(846)
        await settle()
        setWidth(412)
        await settle()
        setWidth(1280)
        await settle()
        expect(seen.displayMounts).toBe(1)
    })
})

describe('T14 per-view scroll', () => {
    test('a view keeps its scroll position while Settings stays open and starts at the top on the next open', async () => {
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        scroller(target).scrollTop = 300
        SettingsMenuIndex.set(6)
        await settle()
        expect(scroller(target).scrollTop).toBe(0)
        SettingsMenuIndex.set(3)
        await settle()
        expect(scroller(target).scrollTop).toBe(300)

        settingsOpen.set(false)
        await settle()
        settingsOpen.set(true)
        SettingsMenuIndex.set(3)
        await settle()
        expect(scroller(target).scrollTop).toBe(0)
    })

    test('a phone returning to the index and drilling in again finds the view where it was left', async () => {
        setWidth(412)
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        scroller(target).scrollTop = 300
        SettingsMenuIndex.set(-1)
        await settle()
        expect(target.querySelector('[data-part="settings-page-scroll"]')).toBeNull()
        SettingsMenuIndex.set(3)
        await settle()
        expect(scroller(target).scrollTop).toBe(300)

        settingsOpen.set(false)
        await settle()
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        await settle()
        expect(scroller(target).scrollTop).toBe(0)
    })
})

describe('T15 shortcuts on a phone', () => {
    test('the shortcuts page shows the screen-too-small line, never an empty column', async () => {
        setWidth(412)
        SettingsMenuIndex.set(15)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        expect(target.querySelector('[data-part="settings-page"]')!.textContent).toContain(language.screenTooSmall)
    })
})
