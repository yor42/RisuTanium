// @vitest-environment jsdom

/**
 * The classic Settings menu has a Statistics entry between Hotkey and Advanced. It opens the Statistics page (index 17)
 * and is absent under Lite, like Advanced. The entry tests are regression reproducers: they fail on a menu without it.
 *
 * MOCKED: `stores.svelte` (plain writable stores), `alertBack`, `lite` (a settable store), the Settings page components
 * (the Statistics page is a counting stub), the legal links and the plugin icon.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'

const statisticsPage = vi.hoisted(() => vi.fn())

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
vi.mock('./Pages/UsageStatisticsPage.svelte', () => ({ default: statisticsPage }))
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

function entries(target: HTMLElement): string[] {
    return Array.from(target.querySelectorAll('button')).map((button) => button.textContent?.trim() ?? '')
}

beforeEach(() => {
    resetBackHandlersForTests()
    DBState.db = { settingsCloseButtonSize: 24 } as unknown as Database
    isLite.set(false)
    SettingsMenuIndex.set(-1)
    settingsOpen.set(true)
    statisticsPage.mockClear()
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

describe('Statistics entry in the classic Settings menu', () => {
    test('(R) without Lite the entry sits between Hotkey and Advanced', () => {
        const labels = entries(mountSettings())
        const at = labels.indexOf(language.settingsShellPageStatistics)
        expect(at).toBeGreaterThan(-1)
        expect(labels[at - 1]).toBe(language.hotkey)
        expect(labels[at + 1]).toBe(language.advancedSettings)
    })

    test('(R) under Lite the entry is absent, as Advanced is', () => {
        isLite.set(true)
        const labels = entries(mountSettings())
        expect(labels).not.toContain(language.settingsShellPageStatistics)
        expect(labels).not.toContain(language.advancedSettings)
    })

    test('(R) choosing the entry shows the Statistics page and marks the entry current', () => {
        // Wide layout keeps the menu beside the page, so the entry stays on screen.
        setWidth(1000)
        const target = mountSettings()
        expect(statisticsPage).not.toHaveBeenCalled()
        const button = Array.from(target.querySelectorAll('button')).find((candidate) => candidate.textContent?.trim() === language.settingsShellPageStatistics)
        button!.click()
        flushSync()
        expect(get(SettingsMenuIndex)).toBe(17)
        expect(statisticsPage).toHaveBeenCalledTimes(1)
        expect(button!.classList.contains('text-textcolor')).toBe(true)
    })

    test('(R) index 17 under Lite shows no Statistics page', () => {
        isLite.set(true)
        SettingsMenuIndex.set(17)
        mountSettings()
        expect(statisticsPage).not.toHaveBeenCalled()
    })
})
