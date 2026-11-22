// @vitest-environment jsdom

/**
 * The classic Settings menu has a Connections row after Chat bot (index 18, absent under Lite) and renders the
 * Connections page for 18 and 19. The legacy Back tests mount the real `Settings.svelte` at phone width: Back on
 * a connection detail returns to the list with the index kept, and with the delete dialog open it cancels only
 * the dialog (A11, T21). The row tests are reproducers that fail on a menu without the row.
 *
 * MOCKED: `stores.svelte` (plain writable stores, `$state` DBState), `alertBack`, `lite` (a settable store), the
 * other Settings page components, the legal links, the plugin icon, the toast host and the confirm arm delay.
 * The Connections page and the back handlers are real.
 */
import 'src/ts/polyfill'
import { flushSync, mount, tick, unmount } from 'svelte'
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
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('../../ts/stores.svelte')
})

vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/lite', () => ({ isLite: writable(false) }))
vi.mock('../../ts/toast/toastHost.svelte', () => ({ postToast: vi.fn(), postUndoToast: vi.fn() }))
vi.mock('../Nexus/pattern/patternWarning', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../Nexus/pattern/patternWarning')>()),
    armDelayMs: () => 0,
}))
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
vi.mock('./Pages/UsageStatisticsPage.svelte', () => ({ default: () => {} }))
vi.mock('./SettingsLegalLinks.svelte', () => ({ default: () => {} }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

import { DBState, SettingsMenuIndex, settingsOpen } from '../../ts/stores.svelte'
import { isLite } from '../../ts/lite'
import { language } from '../../lang'
import { dispatchBack, resetBackHandlersForTests } from '../../ts/backHandlers'
import { setSettingsSubLevel } from '../../ts/settingsShell/settingsNavigation'
import Settings from './Settings.svelte'

const mounted: Array<ReturnType<typeof mount>> = []
const originalWidth = window.innerWidth

function setWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
}

async function settle(): Promise<void> {
    for (let round = 0; round < 4; round++) {
        flushSync()
        await tick()
        await Promise.resolve()
    }
}

function mountSettings(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(Settings, { target }))
    flushSync()
    return target
}

function labels(target: HTMLElement): string[] {
    return Array.from(target.querySelectorAll('button')).map((button) => button.textContent?.trim() ?? '')
}

function detailOpen(): boolean {
    return document.querySelector('[data-part="settings-connection-detail"]') !== null
}

function dialogOpen(): boolean {
    return document.querySelector('[data-part="pattern-warn-root"]') !== null
}

beforeEach(() => {
    resetBackHandlersForTests()
    DBState.db = {
        settingsCloseButtonSize: 24,
        connections: [{ id: 'conn-1', name: 'Home proxy', provider: 'reverse_proxy', key: 'sk-SYNTH-proxy-5678', url: 'https://p.invalid' }],
        proxyConnectionId: '',
        botPresets: [],
        customModels: [],
    } as unknown as Database
    isLite.set(false)
    SettingsMenuIndex.set(-1)
    settingsOpen.set(true)
    setWidth(500)
})

afterEach(async () => {
    for (const component of mounted.splice(0)) {
        await unmount(component)
    }
    document.body.replaceChildren()
    setSettingsSubLevel(null)
    resetBackHandlersForTests()
    isLite.set(false)
    setWidth(originalWidth)
})

describe('Connections row in the classic Settings menu', () => {
    test('(R) the row follows Chat bot', () => {
        const all = labels(mountSettings())
        const at = all.indexOf(language.settingsShellPageConnections)
        expect(at).toBeGreaterThan(-1)
        expect(all[at - 1]).toBe(language.chatBot)
    })

    test('(R) under Lite the row is absent and index 18 shows no page', () => {
        isLite.set(true)
        SettingsMenuIndex.set(18)
        const target = mountSettings()
        expect(labels(target)).not.toContain(language.settingsShellPageConnections)
        expect(document.querySelector('[data-part="settings-connection-add-open"]')).toBeNull()
    })

    test('(R) choosing the row sets 18 and renders the page', async () => {
        setWidth(1000)
        const target = mountSettings()
        expect(document.querySelector('[data-part="settings-connection-add-open"]')).toBeNull()
        Array.from(target.querySelectorAll('button')).find((button) => button.textContent?.trim() === language.settingsShellPageConnections)!.click()
        await settle()
        expect(get(SettingsMenuIndex)).toBe(18)
        expect(document.querySelector('[data-part="settings-connection-add-open"]')).not.toBeNull()
    })

    test.each([18, 19])('(R) index %i renders the page', async (index) => {
        setWidth(1000)
        SettingsMenuIndex.set(index)
        mountSettings()
        await settle()
        expect(document.querySelector('[data-part="settings-connection-add-open"]')).not.toBeNull()
    })
})

describe('A11 legacy Back on the Connections page (real Settings.svelte, phone width)', () => {
    test('Back on the detail returns to the list and the index stays 18', async () => {
        setWidth(390)
        SettingsMenuIndex.set(18)
        mountSettings()
        await settle()
        document.querySelector<HTMLElement>('[data-connection-open="conn-1"]')!.click()
        await settle()
        expect(detailOpen()).toBe(true)
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(detailOpen()).toBe(false)
        expect(document.querySelector('[data-connection-open="conn-1"]')).not.toBeNull()
        expect(get(SettingsMenuIndex)).toBe(18)
        expect(get(settingsOpen)).toBe(true)
    })

    test('with the delete dialog open, Back cancels only the dialog', async () => {
        setWidth(390)
        SettingsMenuIndex.set(18)
        mountSettings()
        await settle()
        document.querySelector<HTMLElement>('[data-connection-open="conn-1"]')!.click()
        await settle()
        document.querySelector<HTMLElement>('[data-part="settings-connection-delete"]')!.click()
        await settle()
        expect(dialogOpen()).toBe(true)
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(dialogOpen()).toBe(false)
        expect(detailOpen()).toBe(true)
        expect(DBState.db.connections?.length).toBe(1)
        expect(get(SettingsMenuIndex)).toBe(18)
    })
})