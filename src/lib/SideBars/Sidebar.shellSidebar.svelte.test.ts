// @vitest-environment happy-dom

/**
 * `Sidebar.svelte` in shell mode: the new chat shell replaces the rail and the old tab bar with
 * `ShellSidebar`; with the shell not eligible the sidebar is today's.
 *
 * Invariants exercised here:
 * - Shell mode (TB1): no rail, no old tab bar, the shell sidebar is mounted in the panel.
 * - Not eligible (TB2, guard): the rail and the old panel stay, the shell sidebar is absent.
 * - Both rail variants (`menuSideBar` on and off) disappear in shell mode.
 *
 * MOCKED: the stores module (only the stores the component reads), `database.svelte`, the shell
 * switch (a reactive flag), the heavy children, and `ShellSidebar`, which renders one marker part.
 *
 * Tests whose title starts with `guard:` pass with or without a defect (compatibility).
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
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
vi.mock('../ChatShell/sidebar/ShellSidebar.svelte', () => ({
    default: (anchor: Comment) => {
        const marker = document.createElement('div')
        marker.setAttribute('data-part', 'chat-sidebar')
        anchor.before(marker)
    },
}))

import { DBState, DynamicGUI, sideBarStore } from '../../ts/stores.svelte'
import * as shellSwitchModule from '../../ts/chatShell/shellSwitch.svelte'
import { resetBackHandlersForTests } from '../../ts/backHandlers'
import { panelFollowView } from './panelGestureBinding'
import Sidebar from './Sidebar.svelte'

const shellFlag = (shellSwitchModule as unknown as { shellFlag: { eligible: boolean } }).shellFlag

let mounted: Array<Record<string, unknown>> = []
let container: HTMLElement

function setViewport(width: number) {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
}

function mountSidebar() {
    mounted.push(mount(Sidebar, { target: container }))
    flushSync()
}

beforeEach(() => {
    setViewport(400)
    shellFlag.eligible = true
    DBState.db.menuSideBar = false
    DynamicGUI.set(true)
    sideBarStore.set(true)
    panelFollowView.set({ phase: 'idle', progress: 0, durationMs: 0, entered: false })
    container = document.createElement('div')
    document.body.append(container)
})

afterEach(() => {
    for (const app of mounted) {
        unmount(app)
    }
    mounted = []
    flushSync()
    container.remove()
    resetBackHandlersForTests()
    vi.restoreAllMocks()
})

describe('shell mode replaces the rail and the old tab bar', () => {
    test('TB1: with the shell eligible there is no rail and the shell sidebar fills the panel', () => {
        mountSidebar()
        expect(container.querySelector('[data-rail-root]')).toBeNull()
        const panel = container.querySelector('.setting-area') as HTMLElement
        expect(panel.querySelector('[data-part="chat-sidebar"]')).not.toBeNull()
    })

    test('TB1: the rail is absent for the menu-bar variant too', () => {
        DBState.db.menuSideBar = true
        mountSidebar()
        expect(container.querySelector('[data-rail-root]')).toBeNull()
        expect(container.querySelector('[data-part="chat-sidebar"]')).not.toBeNull()
    })

    test('guard: TB2 not eligible keeps the rail and the old panel, with no shell sidebar', () => {
        shellFlag.eligible = false
        mountSidebar()
        expect(container.querySelector('[data-rail-root]')).not.toBeNull()
        expect(container.querySelector('[data-part="chat-sidebar"]')).toBeNull()
    })

    test('guard: TB2 not eligible keeps the rail in the docked layout as well', () => {
        shellFlag.eligible = false
        DynamicGUI.set(false)
        setViewport(1280)
        mountSidebar()
        expect(container.querySelector('[data-rail-root]')).not.toBeNull()
        expect(container.querySelector('[data-part="chat-sidebar"]')).toBeNull()
    })
})
