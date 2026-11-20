// @vitest-environment jsdom

/**
 * The REAL `Settings.svelte` menu: both close buttons (the list's and the page's) have an
 * accessible name, every Lucide glyph and the Easy Panel gradient mark are hidden from assistive
 * technology, and the close buttons use scheme tokens instead of Tailwind default palette classes.
 * The mock set is that of `Settings.back.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import { language } from 'src/lang'
import { controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'

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
vi.mock('./Pages/UsageStatisticsPage.svelte', () => ({ default: () => {} }))
vi.mock('./SettingsLegalLinks.svelte', () => ({ default: () => {} }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

import { additionalSettingsMenu, DBState, SettingsMenuIndex } from '../../ts/stores.svelte'
import Settings from './Settings.svelte'

const mounted: Array<{ app: ReturnType<typeof mount>, target: HTMLElement }> = []
const originalWidth = window.innerWidth

function setWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

function mountSettings(width: number, index: number): HTMLElement {
    setWidth(width)
    SettingsMenuIndex.set(index)
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push({ app: mount(Settings, { target }), target })
    flushSync()
    return target
}

beforeEach(() => {
    DBState.db = { settingsCloseButtonSize: 24, enableRisuaiProTools: true } as unknown as Database
    additionalSettingsMenu.length = 0
    additionalSettingsMenu.push({ name: 'P', iconType: 'none', callback: () => {} } as unknown as (typeof additionalSettingsMenu)[number])
})

afterEach(() => {
    for (const { app, target } of mounted.splice(0)) {
        unmount(app)
        target.remove()
    }
    setWidth(originalWidth)
})

const GRADIENT_SVG = 'svg:has(linearGradient)'

describe('Settings accessible names', () => {
    test.each([
        ['narrow list with the list close button', 600, -1],
        ['wide layout with the page close button', 1024, 3],
    ])('regression reproducer: the %s is named and its glyphs are hidden', (_name, width, index) => {
        const target = mountSettings(width, index)
        expect(unnamedControls(target)).toEqual([])
        expect(exposedIcons(target, { extra: [GRADIENT_SVG] })).toEqual([])
        const close = target.querySelector('button.absolute.top-2.right-2') as HTMLButtonElement
        expect(controlName(close)).toBe(language.uiCommon.close)
    })

    test('regression reproducer: the Easy Panel gradient mark is hidden on its outer svg', () => {
        const target = mountSettings(1024, 3)
        const gradient = target.querySelector(GRADIENT_SVG)
        expect(gradient?.getAttribute('aria-hidden')).toBe('true')
    })
})

describe('Settings colour', () => {
    test.each([
        ['narrow list', 600, -1],
        ['wide layout', 1024, 3],
    ])('regression reproducer: the %s close hover uses a scheme token', (_name, width, index) => {
        const target = mountSettings(width, index)
        expect(paletteClasses(target)).toEqual([])
    })
})
