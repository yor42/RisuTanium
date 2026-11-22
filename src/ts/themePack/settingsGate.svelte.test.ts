// @vitest-environment jsdom
/**
 * The settings surface gate (#438 S3a-3). REAL: the surface gate, `screenMasked`, the own-colours state, SettingsSurface,
 * SettingsShell and the host that mirrors App's branch around Settings. MOCKED: `stores.svelte` (plain writable stores), the
 * legacy Settings screen and the page components (stubs), `alertBack` and `lite`. The registered probes are plain `style`
 * elements, as in surfaceGate.svelte.test.ts.
 *
 * C1 and the mask rows are regression reproducers (no settings gate area exists at the base); C2 is a compatibility guard
 * (the legacy screen never declared); C2b is a regression reproducer (the shell never declared).
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../storage/database.svelte'

vi.mock(import('../stores.svelte'), () => {
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
    } as unknown as typeof import('../stores.svelte')
})

vi.mock('../alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../lite', () => ({ isLite: writable(false) }))
vi.mock('../../lib/Setting/Settings.svelte', () => ({ default: () => {} }))
vi.mock('../../lib/Setting/Pages/UserSettings.svelte', () => ({ default: () => {} }))
vi.mock('../../lib/Setting/Pages/BotSettings.svelte', () => ({ default: () => {} }))
vi.mock('../../lib/Setting/Pages/OtherBotSettings.svelte', () => ({ default: () => {} }))
vi.mock('../../lib/Setting/Pages/DisplaySettings.svelte', () => ({ default: () => {} }))
vi.mock('../../lib/Setting/Pages/PluginSettings.svelte', () => ({ default: () => {} }))
vi.mock('../../lib/SettingsShell/PluginsShellPage.svelte', () => ({ default: () => {} }))
vi.mock('../../lib/Setting/Pages/AdvancedSettings.svelte', () => ({ default: () => {} }))
vi.mock('../../lib/Setting/Pages/LanguageSettings.svelte', () => ({ default: () => {} }))
vi.mock('../../lib/Setting/Pages/AccessibilitySettings.svelte', () => ({ default: () => {} }))
vi.mock('../../lib/SettingsShell/PersonasShellPage.svelte', () => ({ default: () => {} }))
vi.mock('../../lib/Setting/Pages/PromptSettings.svelte', () => ({ default: () => {} }))
vi.mock('../../lib/Setting/Pages/Module/ModuleSettings.svelte', () => ({ default: () => {} }))
vi.mock('../../lib/Setting/Pages/HotkeySettings.svelte', () => ({ default: () => {} }))
vi.mock('../../lib/Setting/SettingsLegalLinks.svelte', () => ({ default: () => {} }))
vi.mock('../../lib/Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

import { packBaseTone } from '../gui/surfaceTone'
import { get } from 'svelte/store'
import { installBackGuard, resetBackHandlersForTests } from '../backHandlers'
import { DBState, SettingsMenuIndex, selIdState, settingsOpen } from '../stores.svelte'
import { setSettingsShellEnabled } from '../settingsShell/settingsShellSwitch.svelte'
import { installSettingsOrigin, resetSettingsOriginForTests } from '../settingsShell/settingsOrigin'
import { setShellBackHandler } from '../settingsShell/settingsNavigation'
import { resetSettingsRouteForTests } from '../../lib/Setting/settingsRoute'
import Host from '../../lib/SettingsShell/SettingsShell.testHost.svelte'
import { ownColours, resetOwnColoursForTests } from './ownColours.svelte'
import {
    declareSurface,
    installThemePackGate,
    registerThemePackElement,
    resetThemePackGateForTests,
    screenMasked,
    shownScreen,
    syncThemePackMedia,
} from './surfaceGate.svelte'

const screen = $state({ settingsOpen: false, studioOpen: false })
const BASE = 'data-theme-pack-base'

function sheet(area: string, base: 'dark' | 'light' | null): HTMLStyleElement {
    const element = document.createElement('style')
    element.setAttribute('data-theme-pack', area)
    element.setAttribute('media', 'not all')
    document.head.appendChild(element)
    registerThemePackElement(element, area, base)
    return element
}

function installAppGate(): void {
    installThemePackGate((area) => screenMasked(area, screen))
}

const mounted: Array<ReturnType<typeof mount>> = []

function mountHost(): void {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(Host, { target }))
    flushSync()
}

beforeEach(() => {
    localStorage.clear()
    resetBackHandlersForTests()
    installBackGuard({ showToast: vi.fn() })
    resetSettingsRouteForTests()
    resetSettingsOriginForTests()
    installSettingsOrigin()
    DBState.db = { characters: [] } as unknown as Database
    selIdState.selId = -1
    SettingsMenuIndex.set(-1)
    settingsOpen.set(false)
})

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
    document.head.innerHTML = ''
    resetThemePackGateForTests()
    resetOwnColoursForTests()
    resetBackHandlersForTests()
    resetSettingsRouteForTests()
    resetSettingsOriginForTests()
    setShellBackHandler(null)
    setSettingsShellEnabled(false)
    screen.settingsOpen = false
    screen.studioOpen = false
})

describe('C1: the settings sheet is on only while declared and open, and it sets no base', () => {
    test('masked while Settings is closed, on once it opens, off again on close', () => {
        installAppGate()
        const settings = sheet('settings', null)
        declareSurface('settings')
        flushSync()
        expect(settings.getAttribute('media')).toBe('not all')
        screen.settingsOpen = true
        flushSync()
        expect(settings.getAttribute('media')).toBe('all')
        expect(document.documentElement.hasAttribute(BASE)).toBe(false)
        expect(get(packBaseTone)).toBeNull()
        screen.settingsOpen = false
        flushSync()
        expect(settings.getAttribute('media')).toBe('not all')
    })

    test('settings wins over studio and chat, and on close chat returns in the same flush', () => {
        installAppGate()
        const chat = sheet('chat', 'dark')
        const studio = sheet('studio', null)
        const settings = sheet('settings', null)
        declareSurface('chat')
        declareSurface('studio')
        declareSurface('settings')
        screen.studioOpen = true
        screen.settingsOpen = true
        flushSync()
        expect(shownScreen()).toBe('settings')
        expect([chat, studio, settings].map((el) => el.getAttribute('media'))).toEqual(['not all', 'not all', 'all'])
        screen.settingsOpen = false
        screen.studioOpen = false
        flushSync()
        expect([chat, studio, settings].map((el) => el.getAttribute('media'))).toEqual(['all', 'not all', 'not all'])
    })

    test('a registered settings element with a base would set the base attribute: the area is registered with none', () => {
        installAppGate()
        const settings = sheet('settings', null)
        declareSurface('settings')
        screen.settingsOpen = true
        flushSync()
        syncThemePackMedia()
        expect(settings.getAttribute('media')).toBe('all')
        expect(document.documentElement.hasAttribute(BASE)).toBe(false)
    })
})

describe('the settings mask (#560 own colours)', () => {
    test('screenMasked: settings is masked while closed and while ownColours.on, whatever studio does', () => {
        const open = (settingsOpen: boolean, studioOpen: boolean) => ({ settingsOpen, studioOpen })
        expect(screenMasked('settings', open(false, false))).toBe(true)
        expect(screenMasked('settings', open(false, true))).toBe(true)
        expect(screenMasked('settings', open(true, false))).toBe(false)
        expect(screenMasked('settings', open(true, true))).toBe(false)
        ownColours.on = true
        expect(screenMasked('settings', open(true, false))).toBe(true)
        expect(screenMasked('settings', open(true, true))).toBe(true)
    })

    test('a settings sheet is off while the own colours are on and returns when they go off, with Settings open throughout', () => {
        installAppGate()
        const settings = sheet('settings', null)
        declareSurface('settings')
        screen.settingsOpen = true
        flushSync()
        expect(settings.getAttribute('media')).toBe('all')
        ownColours.on = true
        flushSync()
        expect(settings.getAttribute('media')).toBe('not all')
        expect(shownScreen()).toBeNull()
        ownColours.on = false
        flushSync()
        expect(settings.getAttribute('media')).toBe('all')
    })
})

describe('C2 and C2b: only the mounted shell declares the settings surface', () => {
    test('C2: the legacy Settings screen (shell switch off) never declares', () => {
        setSettingsShellEnabled(false)
        installAppGate()
        screen.settingsOpen = true
        settingsOpen.set(true)
        mountHost()
        expect(shownScreen()).toBeNull()
    })

    test('C2b: a mounted shell declares, and unmounting it releases', () => {
        setSettingsShellEnabled(true)
        installAppGate()
        const settings = sheet('settings', null)
        screen.settingsOpen = true
        settingsOpen.set(true)
        mountHost()
        expect(shownScreen()).toBe('settings')
        expect(settings.getAttribute('media')).toBe('all')
        for (const component of mounted.splice(0)) unmount(component)
        flushSync()
        expect(shownScreen()).toBeNull()
        expect(settings.getAttribute('media')).toBe('not all')
    })
})
