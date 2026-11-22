// @vitest-environment jsdom

/**
 * The Settings shell has a Statistics page entry directly before Advanced. Choosing it opens legacy index 17 with the
 * Statistics page under the page heading. Both are regression reproducers: they fail on a shell without the entry.
 *
 * MOCKED: `stores.svelte` (plain writable stores), `alertBack`, `lite`, the legacy Settings page components and the legal
 * links (as in the shell navigation tests). The Statistics page is a counting stub; the shell, its index and the host are real.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'

const statisticsPage = vi.hoisted(() => vi.fn())

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
vi.mock('./PersonasShellPage.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/PromptSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/Module/ModuleSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/HotkeySettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/UsageStatisticsPage.svelte', () => ({ default: statisticsPage }))
vi.mock('../Setting/SettingsLegalLinks.svelte', () => ({ default: () => {} }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

import { language } from '../../lang'
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
    return [...target.querySelectorAll<HTMLButtonElement>('[data-part="settings-index-entry"], [data-part="settings-index-display"]')]
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
    statisticsPage.mockClear()
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

describe('Statistics page in the shell', () => {
    test('(R) the index lists Statistics directly before Advanced, with its own label', async () => {
        setWidth(1280)
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        const pages = entries(target).map((candidate) => candidate.dataset.page)
        expect(pages.indexOf('statistics')).toBe(pages.indexOf('advanced') - 1)
        const found = entries(target).find((candidate) => candidate.dataset.page === 'statistics')!
        expect(found.textContent?.trim()).toBe(language.settingsShellPageStatistics)
    })

    test('(R) choosing the entry opens index 17 with the Statistics page and its heading', async () => {
        setWidth(1280)
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        expect(statisticsPage).not.toHaveBeenCalled()
        const found = entries(target).find((candidate) => candidate.dataset.page === 'statistics')!
        found.click()
        await settle()
        expect(get(SettingsMenuIndex)).toBe(17)
        expect(statisticsPage).toHaveBeenCalledTimes(1)
        expect(found.getAttribute('aria-current')).toBe('page')
        expect(target.querySelector('[data-part="settings-page-heading"]')?.textContent?.trim()).toBe(language.settingsShellPageStatistics)
    })
})
