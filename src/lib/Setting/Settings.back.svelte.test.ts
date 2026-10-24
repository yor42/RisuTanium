// @vitest-environment jsdom

/**
 * Android Back on the Settings overlay does what its X does, and the overlay answers Back only
 * while `settingsOpen` is true (the embedded page of the mobile shell must not). (R) = regression
 * reproducer: fails on a base without the Back handler (the store does not change and the quit
 * warning shows); (G) = guard that may pass before and after. The reproducers import only modules
 * that exist on the pre-fix base.
 *
 * MOCKED: `stores.svelte` (plain writable stores), `alertBack`, the Settings page components, the
 * legal links, the plugin icon and `lite`. The quit warning is a spy.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        additionalSettingsMenu: [],
        easyPanelStore: { open: false },
        MobileGUI: writable(false),
        SettingsMenuIndex: writable(-1),
        settingsOpen: writable(true),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('../../ts/stores.svelte')
})

vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/lite', () => ({ isLite: writable(false) }))
vi.mock('./Pages/DisplaySettings.svelte', () => ({ default: () => {} }))
vi.mock('./Pages/UserSettings.svelte', () => ({ default: () => {} }))
vi.mock('./Pages/BotSettings.svelte', () => ({ default: () => {} }))
vi.mock('./Pages/OtherBotSettings.svelte', () => ({ default: () => {} }))
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

import { DBState, MobileGUI, SettingsMenuIndex, settingsOpen } from '../../ts/stores.svelte'
import { installBackGuard, registerBackHandler, resetBackHandlersForTests } from '../../ts/backHandlers'
import Settings from './Settings.svelte'

const showToast = vi.fn()
const mounted: Array<ReturnType<typeof mount>> = []
const cleanups: Array<() => void> = []
const originalWidth = window.innerWidth

function setWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

function mountSettings(): { target: HTMLElement; destroy: () => void } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(Settings, { target })
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

function tuple(): string {
    return `${get(settingsOpen)}|${get(SettingsMenuIndex)}`
}

function pressBack(): boolean {
    const result = window.__risuTaniumBack?.()
    flushSync()
    return result === true
}

function closeButton(target: HTMLElement): HTMLButtonElement {
    const found = target.querySelector('button.absolute.top-2.right-2')
    if (!(found instanceof HTMLButtonElement)) {
        throw new Error('no X button')
    }
    return found
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    showToast.mockReset()
    resetBackHandlersForTests()
    installBackGuard({ showToast })
    DBState.db = { settingsCloseButtonSize: 24 } as unknown as Database
    MobileGUI.set(false)
    SettingsMenuIndex.set(-1)
    settingsOpen.set(true)
    setWidth(500)
})

afterEach(() => {
    for (const component of mounted.splice(0)) {
        unmount(component)
    }
    for (const cleanup of cleanups.splice(0)) {
        cleanup()
    }
    document.body.replaceChildren()
    resetBackHandlersForTests()
    setWidth(originalWidth)
    vi.useRealTimers()
})

describe('Settings overlay Back', () => {
    test('(R) a narrow detail page goes back to the list, then Back closes Settings, then the root warns', () => {
        SettingsMenuIndex.set(3)
        mountSettings()
        expect(pressBack()).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(-1)
        expect(get(settingsOpen)).toBe(true)
        expect(showToast).not.toHaveBeenCalled()
        expect(pressBack()).toBe(true)
        expect(get(settingsOpen)).toBe(false)
        expect(showToast).not.toHaveBeenCalled()
        expect(pressBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test('(R) the Beta Mobile GUI overlay has no X and closes on Back as Escape does', () => {
        MobileGUI.set(true)
        SettingsMenuIndex.set(3)
        const { target } = mountSettings()
        expect(target.querySelector('button.absolute.top-2.right-2')).toBeNull()
        expect(pressBack()).toBe(true)
        expect(get(settingsOpen)).toBe(false)
        expect(showToast).not.toHaveBeenCalled()
    })

    test.each([
        ['narrow list view', 500, false, -1],
        ['narrow detail view', 500, false, 3],
        ['wide layout', 800, false, 3],
    ])('(G) Back from the %s leaves the stores as its X does', (_name, width, mobileGui, index) => {
        setWidth(width)
        MobileGUI.set(mobileGui)
        SettingsMenuIndex.set(index)
        const first = mountSettings()
        closeButton(first.target).click()
        flushSync()
        const afterX = tuple()
        first.destroy()
        settingsOpen.set(true)
        SettingsMenuIndex.set(index)
        mountSettings()
        pressBack()
        expect(tuple()).toBe(afterX)
        expect(afterX).not.toBe(`true|${index}`)
    })

    test('(G) the overlay stops answering when Settings closes or unmounts', () => {
        SettingsMenuIndex.set(3)
        const { destroy } = mountSettings()
        settingsOpen.set(false)
        flushSync()
        expect(pressBack()).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(3)
        expect(showToast).toHaveBeenCalledTimes(1)
        settingsOpen.set(true)
        flushSync()
        vi.advanceTimersByTime(3000)
        destroy()
        expect(pressBack()).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(3)
        expect(showToast).toHaveBeenCalledTimes(2)
    })

    test('(G) the embedded page (settingsOpen false) registers nothing', () => {
        MobileGUI.set(true)
        settingsOpen.set(false)
        SettingsMenuIndex.set(3)
        mountSettings()
        expect(pressBack()).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(3)
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test('(R) Settings registers when it opens, so it answers before a surface registered while it was closed', () => {
        MobileGUI.set(true)
        settingsOpen.set(false)
        mountSettings()
        const other = { open: true }
        cleanups.push(registerBackHandler(() => {
            if (!other.open) {
                return false
            }
            other.open = false
            return true
        }))
        settingsOpen.set(true)
        flushSync()
        expect(pressBack()).toBe(true)
        expect(get(settingsOpen)).toBe(false)
        expect(other.open).toBe(true)
        expect(showToast).not.toHaveBeenCalled()
    })

    test('(G) a surface opened over Settings answers first, then Settings', () => {
        SettingsMenuIndex.set(-1)
        mountSettings()
        const popup = { open: true }
        cleanups.push(registerBackHandler(() => {
            if (!popup.open) {
                return false
            }
            popup.open = false
            return true
        }))
        expect(pressBack()).toBe(true)
        expect(popup.open).toBe(false)
        expect(get(settingsOpen)).toBe(true)
        expect(pressBack()).toBe(true)
        expect(get(settingsOpen)).toBe(false)
    })
})
