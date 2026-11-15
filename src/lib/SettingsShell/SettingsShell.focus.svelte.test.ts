// @vitest-environment jsdom

/**
 * Where focus goes when the Settings shell closes (T9): back to the opener while it is still there, to a
 * remounted opener found by its `data-part`, nowhere stale or inert, and after the Fix route to the failed-send
 * card's Try again. All guards for new behaviour (G-new).
 *
 * MOCKED: `stores.svelte` (plain writable stores), `alertBack`, `lite` and the legacy Settings page components.
 * The shell, the host and the real `SendFailureCard` are not mocked.
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
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({}),
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
vi.mock('./PluginsShellPage.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/AdvancedSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/LanguageSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/AccessibilitySettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/PersonaSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/PromptSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/Module/ModuleSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/HotkeySettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/SettingsLegalLinks.svelte', () => ({ default: () => {} }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

import { installBackGuard, resetBackHandlersForTests } from '../../ts/backHandlers'
import { DBState, SettingsMenuIndex, selIdState, settingsOpen } from '../../ts/stores.svelte'
import { setSettingsShellEnabled } from '../../ts/settingsShell/settingsShellSwitch.svelte'
import { installSettingsOrigin, resetSettingsOriginForTests } from '../../ts/settingsShell/settingsOrigin'
import { setShellBackHandler } from '../../ts/settingsShell/settingsNavigation'
import { fixPending, resetSettingsRouteForTests } from '../Setting/settingsRoute'
import Host from './SettingsShell.testHost.svelte'
import { installChatSurface, resetChatSurfaceForTests } from '../ChatScreens/chatSurface.svelte'
import { drainMicrotasks, installFrameQueue, readAtFirstFrame, runFrame, uninstallFrameQueue } from '../../ts/tests/firstFrame.test-helpers'

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

function mountHost(withFailureCard = false): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(Host, { target, props: { withFailureCard } }))
    flushSync()
    return target
}

function byId(id: string): HTMLButtonElement {
    const found = document.getElementById(id)
    if (!(found instanceof HTMLButtonElement)) throw new Error(`no button ${id}`)
    return found
}

function pressBack(): void {
    window.__risuTaniumBack?.()
    flushSync()
}

beforeEach(() => {
    localStorage.clear()
    resetBackHandlersForTests()
    installBackGuard({ showToast: vi.fn() })
    resetSettingsRouteForTests()
    resetSettingsOriginForTests()
    installSettingsOrigin()
    setSettingsShellEnabled(true)
    DBState.db = { characters: [] } as unknown as Database
    selIdState.selId = -1
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
    resetChatSurfaceForTests()
    setShellBackHandler(null)
    setSettingsShellEnabled(false)
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: originalWidth })
})

describe('T9 opener focus', () => {
    test('(rule ii) an opener that stays mounted gets focus back after the close', async () => {
        mountHost()
        const opener = byId('host-header')
        opener.focus()
        settingsOpen.set(true)
        await settle()
        expect(document.activeElement).not.toBe(opener)
        settingsOpen.set(false)
        await settle()
        expect(document.activeElement).toBe(opener)
    })

    test('(rule iii) an opener that was unmounted and mounted again is found by its data-part', async () => {
        mountHost()
        const opener = byId('host-sidebar')
        opener.focus()
        settingsOpen.set(true)
        await settle()
        expect(opener.isConnected).toBe(false)
        settingsOpen.set(false)
        await settle()
        const remounted = document.querySelector<HTMLElement>('[data-part="sidebar-settings"]')
        expect(remounted).not.toBeNull()
        expect(remounted).not.toBe(opener)
        expect(document.activeElement).toBe(remounted)
    })

    test('(rule iv) an opener that is gone and has no data-part leaves focus alone without throwing', async () => {
        mountHost()
        const opener = document.createElement('button')
        document.body.append(opener)
        opener.focus()
        settingsOpen.set(true)
        await settle()
        opener.remove()
        expect(() => { settingsOpen.set(false) }).not.toThrow()
        await settle()
        expect(document.activeElement?.isConnected).toBe(true)
        expect(document.activeElement).not.toBe(opener)
    })

    test('an opener that sits in a still-inert region is not focused', async () => {
        mountHost()
        const region = document.createElement('div')
        region.setAttribute('inert', '')
        const opener = document.createElement('button')
        region.append(opener)
        document.body.append(region)
        opener.focus()
        settingsOpen.set(true)
        await settle()
        settingsOpen.set(false)
        await settle()
        expect(document.activeElement).not.toBe(opener)
    })

    test('(rule i) after the Fix route the failed-send card keeps focus: Try again, never the Fix button', async () => {
        mountHost(true)
        const fix = document.querySelector<HTMLButtonElement>('[data-action="fix"]')!
        const retry = document.querySelector<HTMLButtonElement>('[data-action="retry"]')!
        const landed: Element[] = []
        const record = (event: Event): void => { if (event.target instanceof Element) landed.push(event.target) }
        document.addEventListener('focusin', record)
        try {
            fix.focus()
            fix.click()
            await settle()
            expect(get(settingsOpen)).toBe(true)
            landed.length = 0
            pressBack()
            expect(get(settingsOpen)).toBe(false)
            await settle()
            expect(get(fixPending)).toBe(false)
            expect(document.activeElement).toBe(retry)
            expect(landed).not.toContain(fix)
        } finally {
            document.removeEventListener('focusin', record)
        }
    })
})

describe('T7 phone drill-in focus, before the first frame', () => {
    afterEach(() => {
        uninstallFrameQueue()
    })

    test('a drill-in from the index puts focus on the page heading before the first frame', async () => {
        setWidth(412)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        const display = target.querySelector<HTMLButtonElement>('[data-part="settings-index-entry"][data-page="display"]')!
        expect(document.activeElement).toBe(target.querySelector('[data-part="settings-index-entry"]'))

        installFrameQueue()
        display.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
        flushSync()
        const focusAtFirstFrame = readAtFirstFrame(() => document.activeElement?.getAttribute('data-part'))
        // Only microtasks run: a focus move that waits for an animation frame or a timer has not happened yet.
        await drainMicrotasks()
        runFrame()
        expect(await focusAtFirstFrame).toBe('settings-page-heading')
    })
})

describe('opener focus with the chat surface subscribed before the origin recorder (App order)', () => {
    function installInAppOrder(): void {
        resetSettingsOriginForTests()
        resetChatSurfaceForTests()
        installChatSurface()
        installSettingsOrigin()
    }

    test('an opener inside the chat surface gets focus back although the surface blurred it on open (T2)', async () => {
        installInAppOrder()
        mountHost()
        const opener = byId('host-header')
        opener.focus()
        settingsOpen.set(true)
        await settle()
        settingsOpen.set(false)
        await settle()
        expect(document.activeElement).toBe(opener)
    })

    test('after the Fix route the failed-send card keeps focus and the Fix button is never focused (T6)', async () => {
        installInAppOrder()
        mountHost(true)
        const fix = document.querySelector<HTMLButtonElement>('[data-action="fix"]')!
        const retry = document.querySelector<HTMLButtonElement>('[data-action="retry"]')!
        const landed: Element[] = []
        const record = (event: Event): void => { if (event.target instanceof Element) landed.push(event.target) }
        document.addEventListener('focusin', record)
        try {
            fix.focus()
            fix.click()
            await settle()
            expect(get(settingsOpen)).toBe(true)
            landed.length = 0
            pressBack()
            expect(get(settingsOpen)).toBe(false)
            await settle()
            expect(get(fixPending)).toBe(false)
            expect(document.activeElement).toBe(retry)
            expect(landed).not.toContain(fix)
        } finally {
            document.removeEventListener('focusin', record)
        }
    })
})
