// @vitest-environment happy-dom

/**
 * `Sidebar.svelte` shell-mode layout: the follow overlay is as wide as the finger-driven panel
 * (no rail to subtract), the wide overlay (900 to 1024) is a modal 360 px panel, and the docked
 * layout (above 1024) is a 280 px panel that is not modal. The saved `sideBarSize` is ignored in
 * shell mode. The modal's focus return honours the resolver set by the shell sidebar.
 *
 * MOCKED: the stores module (only the stores the component reads), `database.svelte`, the shell
 * switch (a reactive flag), the heavy children and `ShellSidebar`, which renders nothing.
 *
 * Tests whose title starts with `guard:` pass with or without a defect (compatibility).
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'

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
    const flag = $state({ eligible: true })
    return { shellEligible: () => flag.eligible, shellFlag: flag }
})

vi.mock('./SidebarRail.svelte', () => ({ default: () => {} }))
vi.mock('./CharConfig.svelte', () => ({ default: () => {} }))
vi.mock('./DevTool.svelte', () => ({ default: () => {} }))
vi.mock('./SideChatList.svelte', () => ({ default: () => {} }))
vi.mock('../Others/QuickSettingsGUI.svelte', () => ({ default: () => {} }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))
vi.mock('../ChatShell/sidebar/ShellSidebar.svelte', () => ({ default: () => {} }))

import { DBState, DynamicGUI, sideBarClosing, sideBarStore } from '../../ts/stores.svelte'
import * as shellSwitchModule from '../../ts/chatShell/shellSwitch.svelte'
import { resetBackHandlersForTests } from '../../ts/backHandlers'
import { panelFollowView } from './panelGestureBinding'
import Sidebar from './Sidebar.svelte'

// Loaded on demand by the resolver tests, the only users of the module.
const OVERLAY_FOCUS = '../../ts/chatShell/overlayFocus'

const shellFlag = (shellSwitchModule as unknown as { shellFlag: { eligible: boolean } }).shellFlag

let mounted: Array<Record<string, unknown>> = []
let page: HTMLElement
let container: HTMLElement
let chat: HTMLElement
let opener: HTMLButtonElement

function setViewport(width: number) {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
}

/** The layout flag the app derives from the window width (stores.svelte.ts). */
function layout(width: number) {
    setViewport(width)
    DynamicGUI.set(width <= 1024)
}

function mountSidebar() {
    mounted.push(mount(Sidebar, { target: container }))
    flushSync()
}

function panel(): HTMLElement {
    return container.querySelector('.setting-area') as HTMLElement
}

function openPanel() {
    sideBarClosing.set(false)
    sideBarStore.set(true)
    flushSync()
}

beforeEach(() => {
    layout(400)
    shellFlag.eligible = true
    DBState.db.menuSideBar = false
    sideBarStore.set(false)
    sideBarClosing.set(false)
    panelFollowView.set({ phase: 'idle', progress: 0, durationMs: 0, entered: false })
    page = document.createElement('div')
    container = document.createElement('div')
    chat = document.createElement('div')
    opener = document.createElement('button')
    chat.append(opener)
    page.append(container, chat)
    document.body.append(page)
})

afterEach(() => {
    for (const app of mounted) {
        unmount(app)
    }
    mounted = []
    flushSync()
    page.remove()
    resetBackHandlersForTests()
    vi.restoreAllMocks()
})

describe('the follow overlay (under 900 px)', () => {
    test('TB3: the panel is min(85vw, 360px) wide on its own, with no rail to subtract', () => {
        mountSidebar()
        openPanel()
        // 85% of 400 is 340.
        expect(panel().style.width).toBe('340px')
        expect(panel().style.minWidth).toMatch(/^0(px)?$/)
        layout(800)
        window.dispatchEvent(new Event('resize'))
        flushSync()
        expect(panel().style.width).toBe('360px')
    })
})

describe('the wide overlay (900 to 1024 px)', () => {
    test('TB3w: at 960 the open panel is a modal dialog 360 px wide and the page is inert', () => {
        layout(960)
        mountSidebar()
        opener.focus()
        openPanel()
        expect(panel().getAttribute('role')).toBe('dialog')
        expect(chat.hasAttribute('inert')).toBe(true)
        expect(panel().style.width).toBe('360px')
        expect(panel().style.minWidth).toMatch(/^0(px)?$/)
        expect(panel().style.getPropertyValue('--sidebar-size')).toBe('360px')
        expect(document.activeElement).toBe(panel())
    })

    test('TB3w: Escape closes the wide modal like the follow overlay', () => {
        layout(960)
        mountSidebar()
        openPanel()
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true }))
        flushSync()
        expect(get(sideBarClosing)).toBe(true)
    })

    test('TB3w: ending the modal returns focus to the element the resolver names, else the opener', async () => {
        const { setOverlayReturnFocus } = await import(/* @vite-ignore */ OVERLAY_FOCUS)
        layout(960)
        mountSidebar()
        const transcript = document.createElement('div')
        transcript.tabIndex = -1
        chat.append(transcript)
        opener.focus()
        openPanel()
        setOverlayReturnFocus(() => transcript)
        sideBarStore.set(false)
        flushSync()
        expect(chat.hasAttribute('inert')).toBe(false)
        expect(document.activeElement).toBe(transcript)

        opener.focus()
        openPanel()
        setOverlayReturnFocus(() => null)
        sideBarStore.set(false)
        flushSync()
        expect(document.activeElement).toBe(opener)
    })

    test('TB3w: a resolver that names a detached element falls back to the opener', async () => {
        const { setOverlayReturnFocus } = await import(/* @vite-ignore */ OVERLAY_FOCUS)
        layout(960)
        mountSidebar()
        opener.focus()
        openPanel()
        setOverlayReturnFocus(() => document.createElement('div'))
        sideBarStore.set(false)
        flushSync()
        expect(document.activeElement).toBe(opener)
    })
})

describe('the docked layout (above 1024 px)', () => {
    test('TB3d: at 1280 the panel is 280 px wide inline, not modal, and ignores the saved size', () => {
        layout(1280)
        mountSidebar()
        openPanel()
        expect(panel().style.width).toBe('280px')
        expect(panel().style.minWidth).toBe('280px')
        expect(panel().style.getPropertyValue('--sidebar-size')).toBe('280px')
        expect(panel().hasAttribute('role')).toBe(false)
        expect(chat.hasAttribute('inert')).toBe(false)
        expect(panel().classList.contains('w-96')).toBe(false)
        expect(panel().classList.contains('min-w-96')).toBe(false)
    })

    test('guard: with the shell not eligible the docked panel keeps the saved-size classes and no inline style', () => {
        shellFlag.eligible = false
        layout(1280)
        mountSidebar()
        openPanel()
        expect(panel().classList.contains('w-96')).toBe(true)
        expect(panel().classList.contains('min-w-96')).toBe(true)
        expect(panel().hasAttribute('style')).toBe(false)
    })

    test('guard: with the shell not eligible the wide overlay is not a dialog and has no inline style', () => {
        shellFlag.eligible = false
        layout(960)
        mountSidebar()
        openPanel()
        expect(panel().hasAttribute('role')).toBe(false)
        expect(chat.hasAttribute('inert')).toBe(false)
        expect(panel().hasAttribute('style')).toBe(false)
    })
})
