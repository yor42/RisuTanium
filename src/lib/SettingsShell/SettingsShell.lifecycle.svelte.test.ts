// @vitest-environment jsdom

/**
 * The open-page lifecycle of the Settings shell: opener requests survive (T5), a finished open leaves no page
 * request behind (T19) and the wide layout never sits on index -1 (T20). All guards for new behaviour (G-new).
 * Openers drive the real stores in the order their call sites use: `openSettingsForFix` itself, index then open,
 * and open then index.
 *
 * MOCKED: `stores.svelte` (plain writable stores), `alertBack`, `lite` and the legacy Settings screen and its
 * page components (stubs). The surface, the shell and the host are real.
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
import { setShellBackHandler } from '../../ts/settingsShell/settingsNavigation'
import { openSettingsForFix, resetSettingsRouteForTests } from '../Setting/settingsRoute'
import SettingsShell from './SettingsShell.svelte'
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

function pressBack(): boolean {
    const result = window.__risuTaniumBack?.()
    flushSync()
    return result === true
}

function entry(target: HTMLElement, page: string): HTMLButtonElement {
    const found = target.querySelector<HTMLButtonElement>(`[data-part="settings-index-entry"][data-page="${page}"]`)
    if (!found) throw new Error(`no index entry ${page}`)
    return found
}

function showsIndexList(target: HTMLElement): boolean {
    return target.querySelector('[data-part="settings-index"]') !== null && target.querySelector('[data-part="settings-page"]') === null
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
    setShellBackHandler(null)
    setSettingsShellEnabled(false)
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: originalWidth })
})

describe('T5 same-task opener order', () => {
    test('open then index (the HypaV3 shape) lands on that page, not the stored one', async () => {
        localStorage.setItem('risuSettings.lastPage', 'display')
        const target = mountHost()
        settingsOpen.set(true)
        SettingsMenuIndex.set(2)
        await settle()
        expect(get(SettingsMenuIndex)).toBe(2)
        expect(entry(target, 'features').getAttribute('aria-current')).toBe('page')
    })

    test('index then open after a finished open (the characterCards shape) survives the teardown reset', async () => {
        localStorage.setItem('risuSettings.lastPage', 'display')
        const target = mountHost()
        settingsOpen.set(true)
        await settle()
        settingsOpen.set(false)
        await settle()
        expect(get(SettingsMenuIndex)).toBe(-1)
        SettingsMenuIndex.set(14)
        settingsOpen.set(true)
        await settle()
        expect(get(SettingsMenuIndex)).toBe(14)
        expect(target.querySelector('[data-view="modules"]')?.getAttribute('aria-pressed')).toBe('true')
    })
})

describe('T19 a finished open leaves no page request behind', () => {
    test('the Fix route closes outright, and the next sidebar open starts on the index list', async () => {
        setWidth(412)
        const target = mountHost()
        openSettingsForFix('botSettings')
        await settle()
        expect(get(SettingsMenuIndex)).toBe(1)
        expect(pressBack()).toBe(true)
        expect(get(settingsOpen)).toBe(false)
        await settle()
        expect(get(SettingsMenuIndex)).toBe(-1)
        settingsOpen.set(true)
        await settle()
        expect(showsIndexList(target)).toBe(true)
        expect(document.activeElement).toBe(target.querySelector('[data-part="settings-index-entry"]'))
    })

    test('a wide close followed by narrowing opens on the index list', async () => {
        const target = mountHost()
        settingsOpen.set(true)
        await settle()
        entry(target, 'display').click()
        await settle()
        expect(get(SettingsMenuIndex)).toBe(3)
        settingsOpen.set(false)
        await settle()
        setWidth(412)
        settingsOpen.set(true)
        await settle()
        expect(showsIndexList(target)).toBe(true)
    })

    test('the Ctrl+S toggle from a phone page reopens on the index list', async () => {
        setWidth(412)
        SettingsMenuIndex.set(3)
        settingsOpen.set(true)
        const target = mountHost()
        await settle()
        settingsOpen.set(!get(settingsOpen))
        await settle()
        expect(get(settingsOpen)).toBe(false)
        settingsOpen.set(!get(settingsOpen))
        await settle()
        expect(showsIndexList(target)).toBe(true)
    })

    test('guard: with the switch off the legacy screen keeps the index it left', async () => {
        setSettingsShellEnabled(false)
        mountHost()
        SettingsMenuIndex.set(11)
        settingsOpen.set(true)
        await settle()
        settingsOpen.set(false)
        await settle()
        expect(get(SettingsMenuIndex)).toBe(11)
    })

    test('the switch turned on during a legacy open still resets on close, so the first shell open is clean', async () => {
        setSettingsShellEnabled(false)
        mountHost()
        SettingsMenuIndex.set(11)
        settingsOpen.set(true)
        await settle()
        // The switch is flipped in an earlier task than the close, as a person using the Accessibility page would.
        setSettingsShellEnabled(true)
        await settle()
        settingsOpen.set(false)
        await settle()
        expect(get(SettingsMenuIndex)).toBe(-1)
    })
})

describe('T20 the wide layout never sits on index -1', () => {
    test('rotating a phone from the index into the wide layout shows the stored page, and back keeps it', async () => {
        localStorage.setItem('risuSettings.lastPage', 'display')
        setWidth(412)
        const target = mountHost()
        settingsOpen.set(true)
        await settle()
        expect(showsIndexList(target)).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(-1)

        setWidth(846)
        await settle()
        expect(get(SettingsMenuIndex)).toBe(3)
        expect(entry(target, 'display').getAttribute('aria-current')).toBe('page')
        expect(target.querySelector('[data-part="settings-back"]')?.getAttribute('aria-label')).not.toBe(language.settingsShellMenu)

        setWidth(412)
        await settle()
        expect(get(SettingsMenuIndex)).toBe(3)
        expect(target.querySelector('[data-part="settings-back"]')?.getAttribute('aria-label')).toBe(language.settingsShellMenu)
    })

    test('a shell mounted while Settings is closed leaves the index alone, also on a resize', async () => {
        const target = document.createElement('div')
        document.body.append(target)
        mounted.push(mount(SettingsShell, { target }))
        await settle()
        expect(get(SettingsMenuIndex)).toBe(-1)
        setWidth(1100)
        await settle()
        expect(get(SettingsMenuIndex)).toBe(-1)
    })

    test('a close resets the index and a resize while closed does not apply the default page', async () => {
        const target = mountHost()
        settingsOpen.set(true)
        await settle()
        expect(get(SettingsMenuIndex)).toBe(1)
        settingsOpen.set(false)
        await settle()
        expect(get(SettingsMenuIndex)).toBe(-1)
        setWidth(1100)
        await settle()
        expect(get(SettingsMenuIndex)).toBe(-1)
        expect(target.querySelector('[data-part="settings-shell"]')).toBeNull()
    })
})
