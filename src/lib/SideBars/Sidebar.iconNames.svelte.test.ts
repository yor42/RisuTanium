// @vitest-environment jsdom

/**
 * The rail, hamburger menu, developer-tool toggle and backdrop of the REAL `Sidebar.svelte`:
 * every icon-only control has an accessible name, every Lucide glyph is hidden from assistive
 * technology, the hamburger and the developer-tool toggle expose their state, the backdrop answers
 * Space as well as Enter, and the hamburger hover uses a scheme token. The mock set is that of
 * `Sidebar.follow.svelte.test.ts`; the hamburger glyph keeps `text-white` on purpose.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import { language } from '../../lang'
import { controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: { menuSideBar: false, hamburgerButtonBottom: false, characters: [] } as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        CharEmotion: writable(new Map()),
        OpenRealmStore: writable(false),
        alertStore: writable({ type: 'none', msg: '' }),
        settingsOpen: writable(false),
        botMakerMode: writable(false),
        DynamicGUI: writable(false),
        MobileGUI: writable(false),
        sideBarClosing: writable(false),
        sideBarStore: writable(false),
        PlaygroundStore: writable(0),
        QuickSettings: { open: false },
        additionalHamburgerMenu: [],
    } as unknown as typeof import('../../ts/stores.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ sideBarSize: 0 })),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock('../../ts/chatShell/shellSwitch.svelte', () => {
    const flag = $state({ eligible: false })
    return { shellEligible: () => flag.eligible, shellFlag: flag }
})

vi.mock('./SidebarRail.svelte', () => ({ default: () => {} }))
vi.mock('./CharConfig.svelte', () => ({ default: () => {} }))
vi.mock('./DevTool.svelte', () => ({ default: () => {} }))
vi.mock('./SideChatList.svelte', () => ({ default: () => {} }))
vi.mock('../Others/QuickSettingsGUI.svelte', () => ({ default: () => {} }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))
vi.mock('../ChatShell/sidebar/ShellSidebar.svelte', () => ({ default: () => {} }))

import { additionalHamburgerMenu, DBState, DynamicGUI, selectedCharID, sideBarClosing } from '../../ts/stores.svelte'
import Sidebar from './Sidebar.svelte'

let mounted: Array<{ app: Record<string, unknown>, target: HTMLElement }> = []

function mountSidebar(dbExtra: Record<string, unknown>): HTMLElement {
    DBState.db = {
        menuSideBar: false,
        hamburgerButtonBottom: false,
        enableDevTools: true,
        characters: [{ chaId: 'c1' }],
        ...dbExtra,
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(Sidebar, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ app, target })
    flushSync()
    return target
}

const hamburger = (target: HTMLElement) => target.querySelector('button.min-w-14') as HTMLButtonElement
const backdrop = (target: HTMLElement) => target.querySelector('[role="button"][data-panel-surface]') as HTMLElement
const wrench = (target: HTMLElement) => target.querySelector('button.border-l-selected') as HTMLButtonElement

beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true, writable: true })
    selectedCharID.set(0)
    DynamicGUI.set(true)
    sideBarClosing.set(false)
    additionalHamburgerMenu.length = 0
    additionalHamburgerMenu.push({ name: 'P', iconType: 'none', callback: () => {} } as unknown as (typeof additionalHamburgerMenu)[number])
})

afterEach(() => {
    for (const { app, target } of mounted) {
        unmount(app)
        target.remove()
    }
    mounted = []
})

describe('Sidebar accessible names', () => {
    test.each([
        ['top', false],
        ['bottom', true],
    ])('regression reproducer: the %s hamburger, its menu entries, the wrench and the backdrop are named and every glyph is hidden', (_name, bottom) => {
        const target = mountSidebar({ hamburgerButtonBottom: bottom })
        hamburger(target).click()
        flushSync()
        expect(unnamedControls(target)).toEqual([])
        expect(exposedIcons(target)).toEqual([])
        expect(controlName(hamburger(target))).toBe(language.menu)
        expect(Array.from(target.querySelectorAll('button.ico')).map(controlName)).toEqual([
            language.settings, language.home, language.playground.playground, 'P', language.character,
        ])
        expect(controlName(wrench(target))).toBe(language.chatShellDevTool)
        expect(controlName(backdrop(target))).toBe(language.closeSidebar)
    })

    test('regression reproducer: the rail of the side-menu layout hides the glyphs of its text-named buttons', () => {
        const target = mountSidebar({ menuSideBar: true })
        expect(unnamedControls(target)).toEqual([])
        expect(exposedIcons(target)).toEqual([])
    })
})

describe('Sidebar state', () => {
    test('regression reproducer: the hamburger exposes whether the menu is open', () => {
        const target = mountSidebar({})
        expect(hamburger(target).getAttribute('aria-expanded')).toBe('false')
        hamburger(target).click()
        flushSync()
        expect(hamburger(target).getAttribute('aria-expanded')).toBe('true')
    })

    test('regression reproducer: the developer-tool toggle exposes its state', () => {
        const target = mountSidebar({})
        expect(wrench(target).getAttribute('aria-pressed')).toBe('false')
        wrench(target).click()
        flushSync()
        expect(wrench(target).getAttribute('aria-pressed')).toBe('true')
    })

    test('regression reproducer: Space on the backdrop starts closing the panel, as Enter does', () => {
        const target = mountSidebar({})
        backdrop(target).dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
        flushSync()
        expect(get(sideBarClosing)).toBe(true)
        sideBarClosing.set(false)
        backdrop(target).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
        flushSync()
        expect(get(sideBarClosing)).toBe(true)
    })
})

describe('Sidebar colour', () => {
    test.each([
        ['top', false],
        ['bottom', true],
    ])('regression reproducer: the %s hamburger hover uses a scheme token and only the documented text-white remains', (_name, bottom) => {
        const target = mountSidebar({ hamburgerButtonBottom: bottom })
        hamburger(target).click()
        flushSync()
        expect(hamburger(target).classList.contains('hover:bg-borderc')).toBe(true)
        expect(paletteClasses(target, { allow: [/^text-white$/] })).toEqual([])
    })
})
