// @vitest-environment jsdom

/**
 * Back on the Settings shell: Android Back through the real `dispatchBack`, and the header Back's label and
 * action. All are guards for new behaviour (G-new): the shell does not exist on the base, so each fails only
 * when a scratch mutant breaks the rule it names.
 *
 * MOCKED: `stores.svelte` (plain writable stores), `alertBack`, `lite` and the legacy Settings page
 * components. The shell, the host, the Back stack and the origin recorder are real.
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

import { language } from '../../lang'
import { installBackGuard, resetBackHandlersForTests } from '../../ts/backHandlers'
import { DBState, SettingsMenuIndex, selIdState, settingsOpen } from '../../ts/stores.svelte'
import { setSettingsShellEnabled } from '../../ts/settingsShell/settingsShellSwitch.svelte'
import { installSettingsOrigin, resetSettingsOriginForTests } from '../../ts/settingsShell/settingsOrigin'
import { setShellBackHandler, settingsShellEscape } from '../../ts/settingsShell/settingsNavigation'
import { openSearch, resetSearch, settingsSearchState } from '../../ts/settingsShell/settingsSearchState.svelte'
import { openSettingsForFix, resetSettingsRouteForTests } from '../Setting/settingsRoute'
import SettingsShell from './SettingsShell.svelte'
import Host from './SettingsShell.testHost.svelte'

const showToast = vi.fn()
const mounted: Array<ReturnType<typeof mount>> = []
const originalWidth = window.innerWidth

function setWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
    window.dispatchEvent(new Event('resize'))
    flushSync()
}

function mountHost(): { target: HTMLElement, destroy: () => void } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(Host, { target })
    mounted.push(component)
    flushSync()
    return {
        target,
        destroy: () => {
            unmount(component)
            mounted.splice(mounted.indexOf(component), 1)
            target.remove()
        },
    }
}

function pressBack(): boolean {
    const result = window.__risuTaniumBack?.()
    flushSync()
    return result === true
}

function backButton(target: HTMLElement): HTMLButtonElement {
    const found = target.querySelector<HTMLButtonElement>('[data-part="settings-back"]')
    if (!found) throw new Error('no header Back')
    return found
}

beforeEach(() => {
    localStorage.clear()
    showToast.mockReset()
    resetBackHandlersForTests()
    installBackGuard({ showToast })
    resetSettingsRouteForTests()
    resetSettingsOriginForTests()
    installSettingsOrigin()
    setSettingsShellEnabled(true)
    DBState.db = { characters: [] } as unknown as Database
    selIdState.selId = -1
    SettingsMenuIndex.set(-1)
    settingsOpen.set(false)
    setWidth(412)
})

afterEach(() => {
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

describe('T7 Android Back through dispatchBack', () => {
    test('a phone page goes up to the index, then closes, then the root warns', () => {
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        mountHost()
        expect(pressBack()).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(-1)
        expect(get(settingsOpen)).toBe(true)
        expect(pressBack()).toBe(true)
        expect(get(settingsOpen)).toBe(false)
        expect(showToast).not.toHaveBeenCalled()
        expect(pressBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test('the focused field is blurred before the store changes', () => {
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        mountHost()
        const field = document.createElement('input')
        document.body.append(field)
        field.focus()
        const seenAtBlur: string[] = []
        field.addEventListener('blur', () => seenAtBlur.push(`${get(settingsOpen)}|${get(SettingsMenuIndex)}`))
        pressBack()
        expect(seenAtBlur).toEqual(['true|3'])
        expect(get(SettingsMenuIndex)).toBe(-1)
    })

    test('the handler leaves the stack with the shell, and a closed shell is not a registered Escape target', () => {
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const host = mountHost()
        expect(settingsShellEscape()).toBe(true)
        host.destroy()
        expect(settingsShellEscape()).toBe(false)
        // A shell kept mounted past the close registers nothing either.
        settingsOpen.set(true)
        const target = document.createElement('div')
        document.body.append(target)
        const shell = mount(SettingsShell, { target })
        flushSync()
        expect(settingsShellEscape()).toBe(true)
        settingsOpen.set(false)
        flushSync()
        expect(settingsShellEscape()).toBe(false)
        expect(pressBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
        unmount(shell)
    })
})

describe('T-A7 Back with the search open', () => {
    test('Android Back closes only the search, then follows page, index and close', () => {
        SettingsMenuIndex.set(1)
        settingsOpen.set(true)
        mountHost()
        openSearch()
        flushSync()
        expect(pressBack()).toBe(true)
        expect(settingsSearchState.open).toBe(false)
        expect(get(settingsOpen)).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(1)
        expect(pressBack()).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(-1)
        expect(get(settingsOpen)).toBe(true)
        expect(pressBack()).toBe(true)
        expect(get(settingsOpen)).toBe(false)
        expect(showToast).not.toHaveBeenCalled()
    })

    test('Escape and the header Back close the search first and keep Settings open', () => {
        SettingsMenuIndex.set(1)
        settingsOpen.set(true)
        const { target } = mountHost()
        openSearch()
        flushSync()
        expect(settingsShellEscape()).toBe(true)
        flushSync()
        expect(settingsSearchState.open).toBe(false)
        expect(get(settingsOpen)).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(1)
        openSearch()
        flushSync()
        backButton(target).click()
        flushSync()
        expect(settingsSearchState.open).toBe(false)
        expect(get(settingsOpen)).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(1)
    })
})

describe('T8 header Back', () => {
    test('from a chat the wide label names the chat and Back closes', () => {
        DBState.db = { characters: [{ name: 'Seraphina' }] } as unknown as Database
        selIdState.selId = 0
        setWidth(1280)
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const { target } = mountHost()
        const button = backButton(target)
        expect(button.getAttribute('aria-label')).toBe(language.settingsShellBackToChat('Seraphina'))
        expect(button.textContent).toContain('Seraphina')
        button.click()
        flushSync()
        expect(get(settingsOpen)).toBe(false)
    })

    test('a phone page names the settings menu and goes up to the index; the index names the chat', () => {
        DBState.db = { characters: [{ name: 'Seraphina' }] } as unknown as Database
        selIdState.selId = 0
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const { target } = mountHost()
        expect(backButton(target).getAttribute('aria-label')).toBe(language.settingsShellMenu)
        backButton(target).click()
        flushSync()
        expect(get(SettingsMenuIndex)).toBe(-1)
        expect(get(settingsOpen)).toBe(true)
        expect(backButton(target).getAttribute('aria-label')).toBe(language.settingsShellBackToChat('Seraphina'))
        backButton(target).click()
        flushSync()
        expect(get(settingsOpen)).toBe(false)
    })

    test('a phone page opened by the Fix route names the chat, not the settings menu, because Back closes outright', () => {
        DBState.db = { characters: [{ name: 'Seraphina' }] } as unknown as Database
        selIdState.selId = 0
        const { target } = mountHost()
        openSettingsForFix('botSettings')
        flushSync()
        expect(get(SettingsMenuIndex)).not.toBe(-1)
        expect(backButton(target).getAttribute('aria-label')).toBe(language.settingsShellBackToChat('Seraphina'))
        backButton(target).click()
        flushSync()
        expect(get(settingsOpen)).toBe(false)
    })

    test('no chat on screen reads a plain Back', async () => {
        setWidth(1280)
        settingsOpen.set(true)
        const { target } = mountHost()
        await tick()
        expect(backButton(target).getAttribute('aria-label')).toBe(language.settingsShellBack)
    })
})
