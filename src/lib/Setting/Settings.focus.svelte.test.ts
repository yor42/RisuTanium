// @vitest-environment jsdom

/**
 * Where focus goes when the legacy Settings screen closes: back to what opened it, as the Settings shell already does.
 * Route under test: composer persona tab -> drop-up -> "Persona settings" -> Back (list) -> Back (closed), switch off.
 * R1 to R4 are regression reproducers (they fail on the screen without a close-time restore); G1 to G6 are compatibility
 * guards that pass with and without it.
 *
 * REAL: Settings (legacy screen), SettingsShell, SettingsSurface, PersonaSheet, ShellSheet, the Back stack, the origin
 * recorder and the chat surface, mounted in the App-shaped SettingsShell test host. Closes go through
 * `window.__risuTaniumBack` or the X button, never `settingsOpen.set(false)`.
 * MOCKED: `stores.svelte` (plain writable stores), `alertBack`, `lite`, the Settings page components, the legal links
 * and the plugin icon.
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
        selIdState: { selId: 0 },
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('../../ts/stores.svelte')
})

vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/lite', () => ({ isLite: writable(false) }))
vi.mock('./Pages/UserSettings.svelte', () => ({ default: () => {} }))
vi.mock('./Pages/BotSettings.svelte', () => ({ default: () => {} }))
vi.mock('./Pages/OtherBotSettings.svelte', () => ({ default: () => {} }))
vi.mock('./Pages/DisplaySettings.svelte', () => ({ default: () => {} }))
vi.mock('./Pages/PluginSettings.svelte', () => ({ default: () => {} }))
vi.mock('./Pages/AdvancedSettings.svelte', () => ({ default: () => {} }))
vi.mock('./Pages/LanguageSettings.svelte', () => ({ default: () => {} }))
vi.mock('./Pages/AccessibilitySettings.svelte', () => ({ default: () => {} }))
vi.mock('./Pages/PersonaSettings.svelte', () => ({ default: () => {} }))
vi.mock('./Pages/PromptSettings.svelte', () => ({ default: () => {} }))
vi.mock('./Pages/Module/ModuleSettings.svelte', () => ({ default: () => {} }))
vi.mock('./Pages/HotkeySettings.svelte', () => ({ default: () => {} }))
vi.mock('./SettingsLegalLinks.svelte', () => ({ default: () => {} }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

import { installBackGuard, resetBackHandlersForTests } from '../../ts/backHandlers'
import { DBState, SettingsMenuIndex, selIdState, settingsOpen } from '../../ts/stores.svelte'
import { setSettingsShellEnabled } from '../../ts/settingsShell/settingsShellSwitch.svelte'
import { installSettingsOrigin, resetSettingsOriginForTests } from '../../ts/settingsShell/settingsOrigin'
import { setShellBackHandler } from '../../ts/settingsShell/settingsNavigation'
import { firstIndexOf } from '../../ts/settingsShell/settingsPages'
import { fixPending, resetSettingsRouteForTests } from './settingsRoute'
import { installChatSurface, resetChatSurfaceForTests } from '../ChatScreens/chatSurface.svelte'
import PersonaSheet from '../ChatShell/PersonaSheet.svelte'
import Host from '../SettingsShell/SettingsShell.testHost.svelte'
import { drainMicrotasks, installFrameQueue, readAtFirstFrame, runFrame, uninstallFrameQueue } from '../../ts/tests/firstFrame.test-helpers'

const mounted: Array<ReturnType<typeof mount>> = []
const originalWidth = window.innerWidth
const view = $state({ open: false, opener: null as HTMLElement | null })

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

/** The composer's persona tab and its drop-up, mounted inside the host's kept-mounted chat surface. */
function mountPersonaTab(): HTMLButtonElement {
    const surface = document.querySelector<HTMLElement>('[data-chat-surface]')!
    const tab = document.createElement('button')
    tab.type = 'button'
    tab.id = 'tab'
    tab.setAttribute('data-part', 'chat-composer-persona')
    tab.setAttribute('data-kind', 'tab')
    tab.textContent = 'as User'
    tab.addEventListener('click', () => { view.opener = tab; view.open = true })
    surface.append(tab)
    mounted.push(mount(PersonaSheet, {
        target: surface,
        props: {
            get open() { return view.open },
            get opener() { return view.opener },
            variant: 'dropup',
            background: [],
            onclose: () => { view.open = false },
        },
    }))
    flushSync()
    return tab
}

function pressBack(): void {
    window.__risuTaniumBack?.()
    flushSync()
}

function legacyMounted(): boolean {
    return document.querySelector('.setting-bg') !== null && document.querySelector('[data-part="settings-shell"]') === null
}

/** Persona tab -> drop-up -> "Persona settings"; resolves once Settings is open on the Personas page. */
async function openPersonaSettingsFromTab(tab: HTMLButtonElement): Promise<void> {
    tab.focus()
    tab.click()
    await settle()
    document.querySelector<HTMLElement>('[data-part="chat-persona-settings"]')!.click()
    await vi.waitFor(() => { flushSync(); expect(get(settingsOpen)).toBe(true) })
    await settle()
}

function trackFocusCalls(): { calls: HTMLElement[], restore: () => void } {
    const calls: HTMLElement[] = []
    const original = HTMLElement.prototype.focus
    HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions): void {
        calls.push(this)
        original.call(this, options)
    }
    return { calls, restore: () => { HTMLElement.prototype.focus = original } }
}

beforeEach(() => {
    localStorage.clear()
    resetBackHandlersForTests()
    installBackGuard({ showToast: vi.fn() })
    resetSettingsRouteForTests()
    resetSettingsOriginForTests()
    resetChatSurfaceForTests()
    installChatSurface()
    installSettingsOrigin()
    DBState.db = {
        username: 'User',
        personas: [{ id: 'p1', name: 'Ann' }],
        selectedPersona: 0,
        characters: [{ name: 'C', chatPage: 0, chats: [{ bindedPersona: '' }] }],
    } as unknown as Database
    selIdState.selId = 0
    SettingsMenuIndex.set(-1)
    settingsOpen.set(false)
    view.open = false
    view.opener = null
    setSettingsShellEnabled(false)
    setWidth(412)
})

afterEach(() => {
    uninstallFrameQueue()
    for (const component of mounted.splice(0).reverse()) unmount(component)
    document.body.replaceChildren()
    resetBackHandlersForTests()
    resetSettingsRouteForTests()
    resetSettingsOriginForTests()
    resetChatSurfaceForTests()
    setShellBackHandler(null)
    setSettingsShellEnabled(false)
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: originalWidth })
})

describe('legacy Settings close returns focus to its opener', () => {
    test('R1: persona tab -> Persona settings -> Back -> Back leaves focus on the persona tab (switch off, phone width)', async () => {
        mountHost()
        const tab = mountPersonaTab()
        await openPersonaSettingsFromTab(tab)
        expect(legacyMounted()).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(firstIndexOf('personas'))

        pressBack()
        expect(get(SettingsMenuIndex)).toBe(-1)
        expect(get(settingsOpen)).toBe(true)
        pressBack()
        expect(get(settingsOpen)).toBe(false)
        await settle()
        expect(document.activeElement).toBe(tab)
    })

    test('R2: an opener that was unmounted and mounted again is found by its data-part after the close', async () => {
        setWidth(1280)
        mountHost()
        const opener = document.getElementById('host-sidebar')!
        opener.focus()
        settingsOpen.set(true)
        await settle()
        expect(legacyMounted()).toBe(true)
        expect(opener.isConnected).toBe(false)

        pressBack()
        expect(get(settingsOpen)).toBe(false)
        await settle()
        const remounted = document.querySelector<HTMLElement>('[data-part="sidebar-settings"]')
        expect(remounted).not.toBeNull()
        expect(remounted).not.toBe(opener)
        expect(document.activeElement).toBe(remounted)
    })

    test('R3: the X button close returns focus to the opener', async () => {
        mountHost()
        const opener = document.getElementById('host-header')!
        opener.focus()
        settingsOpen.set(true)
        await settle()
        expect(legacyMounted()).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(-1)
        expect(document.activeElement).not.toBe(opener)

        document.querySelector<HTMLElement>('.setting-bg button.absolute')!.click()
        flushSync()
        expect(get(settingsOpen)).toBe(false)
        await settle()
        expect(document.activeElement).toBe(opener)
    })

    test('R4: focus is back on the opener before the first frame after the Back that closes', async () => {
        setWidth(1280)
        mountHost()
        const opener = document.getElementById('host-header')!
        opener.focus()
        settingsOpen.set(true)
        await settle()
        expect(document.activeElement).not.toBe(opener)

        installFrameQueue()
        pressBack()
        const focusAtFirstFrame = readAtFirstFrame(() => document.activeElement)
        // Only microtasks run: a focus return that waits for an animation frame or a timer has not happened yet.
        await drainMicrotasks()
        runFrame()
        expect(await focusAtFirstFrame).toBe(opener)
    })

    test('G1: with the Settings shell on, the same route restores focus exactly once', async () => {
        setSettingsShellEnabled(true)
        mountHost()
        const tab = mountPersonaTab()
        await openPersonaSettingsFromTab(tab)
        expect(document.querySelector('[data-part="settings-shell"]')).not.toBeNull()
        expect(document.querySelector('.setting-bg')).toBeNull()

        const spy = trackFocusCalls()
        try {
            pressBack()
            pressBack()
            expect(get(settingsOpen)).toBe(false)
            spy.calls.length = 0
            await settle()
            expect(document.activeElement).toBe(tab)
            expect(spy.calls.filter((element) => element === tab)).toHaveLength(1)
        } finally {
            spy.restore()
        }
    })

    test('G2: the drop-up Back alone keeps Settings closed and focus on the tab', async () => {
        mountHost()
        const tab = mountPersonaTab()
        tab.focus()
        tab.click()
        await settle()
        expect(document.querySelector('[data-part="chat-persona-settings"]')).not.toBeNull()

        pressBack()
        await settle()
        expect(view.open).toBe(false)
        expect(get(settingsOpen)).toBe(false)
        expect(document.activeElement).toBe(tab)
    })

    test('G3: after the Fix route the failed-send card keeps focus: Try again, never the Fix button', async () => {
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
            expect(legacyMounted()).toBe(true)
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

    test('G4: an open with nothing focused records no opener and the close moves no focus', async () => {
        mountHost()
        ;(document.activeElement as HTMLElement | null)?.blur()
        expect(document.activeElement).toBe(document.body)
        settingsOpen.set(true)
        await settle()
        expect(legacyMounted()).toBe(true)

        const spy = trackFocusCalls()
        try {
            pressBack()
            expect(get(settingsOpen)).toBe(false)
            await settle()
            expect(spy.calls).toHaveLength(0)
            expect(document.activeElement).toBe(document.body)
        } finally {
            spy.restore()
        }
    })

    test('G5a: the persona tab removed while Settings is open leaves focus alone without throwing', async () => {
        mountHost()
        const tab = mountPersonaTab()
        await openPersonaSettingsFromTab(tab)
        tab.remove()

        pressBack()
        expect(() => { pressBack() }).not.toThrow()
        expect(get(settingsOpen)).toBe(false)
        await settle()
        expect(document.activeElement).not.toBe(tab)
        expect(document.activeElement?.isConnected).toBe(true)
    })

    test('G5b: an opener without a data-part that is removed while Settings is open leaves focus alone', async () => {
        mountHost()
        const opener = document.createElement('button')
        document.body.append(opener)
        opener.focus()
        settingsOpen.set(true)
        await settle()
        opener.remove()

        expect(() => { pressBack() }).not.toThrow()
        expect(get(settingsOpen)).toBe(false)
        await settle()
        expect(document.activeElement).not.toBe(opener)
        expect(document.activeElement?.isConnected).toBe(true)
    })

    test('G6: Settings reopened before the close has flushed gets no restore', async () => {
        setWidth(1280)
        mountHost()
        const opener = document.getElementById('host-header')!
        opener.focus()
        settingsOpen.set(true)
        await settle()
        const spy = trackFocusCalls()
        try {
            const other = document.createElement('button')
            document.body.append(other)
            pressBack()
            expect(get(settingsOpen)).toBe(false)
            other.focus()
            settingsOpen.set(true)
            spy.calls.length = 0
            await settle()
            expect(get(settingsOpen)).toBe(true)
            expect(spy.calls).toHaveLength(0)
        } finally {
            spy.restore()
        }
    })
})
