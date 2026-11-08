// @vitest-environment jsdom

/**
 * Lite keeps the classic Settings screen with its hidden parts. (G6a) the Chat bot, Accessibility
 * and Advanced settings entries are absent under Lite and present otherwise; (G6b) under Lite the
 * wide layout opens on the menu, because the page the classic auto-select would pick is hidden
 * there; (G6c) without Lite the auto-select still picks the Chat bot page; (G6d) Lite can close
 * Settings with the X button at narrow and wide width. (G6b) is the regression reproducer: it fails
 * on a Settings screen whose auto-select ignores Lite. The others are guards.
 *
 * MOCKED: `stores.svelte` (plain writable stores), `alertBack`, the Settings page components (the
 * Chat bot page is a counting stub), the legal links, the plugin icon and `lite` (a settable store).
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'

const botSettings = vi.hoisted(() => vi.fn())

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        additionalSettingsMenu: [],
        easyPanelStore: { open: false },
        // The kept layout store: Settings no longer reads it, so a stale value must change nothing here.
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
vi.mock('./Pages/BotSettings.svelte', () => ({ default: botSettings }))
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

import { DBState, SettingsMenuIndex, settingsOpen } from '../../ts/stores.svelte'
import { isLite } from '../../ts/lite'
import { language } from '../../lang'
import { resetBackHandlersForTests } from '../../ts/backHandlers'
import Settings from './Settings.svelte'

const mounted: Array<ReturnType<typeof mount>> = []
const originalWidth = window.innerWidth

function setWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

function mountSettings(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(Settings, { target }))
    flushSync()
    return target
}

function hasMenuEntry(target: HTMLElement, label: string): boolean {
    return Array.from(target.querySelectorAll('button')).some((button) => button.textContent?.trim() === label)
}

function closeButton(target: HTMLElement): Element | null {
    return target.querySelector('button.absolute.top-2.right-2')
}

beforeEach(() => {
    resetBackHandlersForTests()
    DBState.db = { settingsCloseButtonSize: 24 } as unknown as Database
    isLite.set(false)
    SettingsMenuIndex.set(-1)
    settingsOpen.set(true)
    botSettings.mockClear()
    setWidth(500)
})

afterEach(() => {
    for (const component of mounted.splice(0)) {
        unmount(component)
    }
    document.body.replaceChildren()
    resetBackHandlersForTests()
    isLite.set(false)
    setWidth(originalWidth)
})

describe('Lite Settings menu', () => {
    test('(G6a) under Lite the Chat bot, Accessibility and Advanced settings entries are absent and Language and Backup stay', () => {
        isLite.set(true)
        const target = mountSettings()
        expect(hasMenuEntry(target, language.chatBot)).toBe(false)
        expect(hasMenuEntry(target, language.accessibility)).toBe(false)
        expect(hasMenuEntry(target, language.advancedSettings)).toBe(false)
        expect(hasMenuEntry(target, language.language)).toBe(true)
        expect(hasMenuEntry(target, language.backupAndFiles)).toBe(true)
    })

    test('(G6a) without Lite every one of those entries is present', () => {
        const target = mountSettings()
        expect(hasMenuEntry(target, language.chatBot)).toBe(true)
        expect(hasMenuEntry(target, language.accessibility)).toBe(true)
        expect(hasMenuEntry(target, language.advancedSettings)).toBe(true)
        expect(hasMenuEntry(target, language.language)).toBe(true)
        expect(hasMenuEntry(target, language.backupAndFiles)).toBe(true)
    })
})

describe('Settings auto-select at wide width', () => {
    test('(G6b) under Lite at width 1000 Settings opens on the menu and never mounts the Chat bot page', () => {
        isLite.set(true)
        setWidth(1000)
        mountSettings()
        expect(get(SettingsMenuIndex)).toBe(-1)
        expect(botSettings).not.toHaveBeenCalled()
    })

    test('(G6c) without Lite at width 1000 the classic auto-select picks the Chat bot page', () => {
        setWidth(1000)
        mountSettings()
        expect(get(SettingsMenuIndex)).toBe(1)
        expect(botSettings).toHaveBeenCalledTimes(1)
    })
})

describe('Lite close button', () => {
    test.each([
        ['narrow list view', 400],
        ['wide layout', 1000],
    ])('(G6d) under Lite the X button exists in the %s and closes Settings', (_name, width) => {
        isLite.set(true)
        setWidth(width)
        const target = mountSettings()
        const button = closeButton(target)
        expect(button).not.toBeNull()
        ;(button as HTMLButtonElement).click()
        flushSync()
        expect(get(settingsOpen)).toBe(false)
    })
})
