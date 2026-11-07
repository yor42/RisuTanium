// @vitest-environment happy-dom

/**
 * A resize that remounts the sidebar while a registered shell (a sheet or the toggles panel) is
 * open. The overlay variant mounts with the sidebar store still true; it must not open modal on top
 * of the shell, take its focus or inert its host. The overlay mounts closed, and stays closed.
 *
 * Invariants exercised here:
 * - TB13 (a): with a registered shell open, mounting the overlay Sidebar over an open sidebar store
 *   leaves focus on the shell's control, adds no dialog, and sets the store to false.
 * - TB13 (b), guard: with no registered shell the overlay is the modal dialog and takes focus.
 *
 * MOCKED: the stores module (only the stores the component reads), `database.svelte`, the shell
 * switch (a reactive flag), the heavy children and `ShellSidebar`, which renders nothing. The shell
 * is registered through the real `registerShell`; `ShellSheet` is not mounted, so its focus rescue
 * cannot hide the defect.
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
import { registerShell } from '../Nexus/pattern/patternFocus'
import { panelFollowView } from './panelGestureBinding'
import Sidebar from './Sidebar.svelte'

const shellFlag = (shellSwitchModule as unknown as { shellFlag: { eligible: boolean } }).shellFlag

let mounted: Array<Record<string, unknown>> = []
let page: HTMLElement
let container: HTMLElement
let sheetHost: HTMLElement
let sheetButton: HTMLButtonElement
let unregister: (() => void) | null = null

function setViewport(width: number) {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
}

function mountSidebar() {
    mounted.push(mount(Sidebar, { target: container }))
    flushSync()
}

function panel(): HTMLElement {
    return container.querySelector('.setting-area') as HTMLElement
}

/** What the resize does: the sidebar store is already true when the overlay variant mounts. */
function resizeTo(width: number) {
    setViewport(width)
    DynamicGUI.set(width <= 1024)
}

beforeEach(() => {
    shellFlag.eligible = true
    DBState.db.menuSideBar = false
    sideBarClosing.set(false)
    panelFollowView.set({ phase: 'idle', progress: 0, durationMs: 0, entered: false })
    page = document.createElement('div')
    container = document.createElement('div')
    sheetHost = document.createElement('div')
    sheetHost.setAttribute('role', 'dialog')
    sheetHost.setAttribute('aria-modal', 'true')
    sheetButton = document.createElement('button')
    sheetHost.append(sheetButton)
    page.append(container, sheetHost)
    document.body.append(page)
})

afterEach(() => {
    for (const app of mounted) {
        unmount(app)
    }
    mounted = []
    flushSync()
    unregister?.()
    unregister = null
    page.remove()
    resetBackHandlersForTests()
    vi.restoreAllMocks()
})

describe('a resize remount while a shell is open', () => {
    test('TB13 (a): the overlay mounts closed over a registered shell, with focus and inert untouched', () => {
        unregister = registerShell({})
        sheetButton.focus()
        sideBarStore.set(true)
        resizeTo(784)
        mountSidebar()
        expect(document.activeElement).toBe(sheetButton)
        expect(panel().getAttribute('role')).toBeNull()
        expect(container.querySelectorAll('[role="dialog"]').length).toBe(0)
        expect(sheetHost.hasAttribute('inert')).toBe(false)
        expect(get(sideBarStore)).toBe(false)
    })

    test('TB13 (a): the wide overlay (960) behaves the same, and widening later leaves the store closed', () => {
        unregister = registerShell({})
        sheetButton.focus()
        sideBarStore.set(true)
        resizeTo(960)
        mountSidebar()
        expect(document.activeElement).toBe(sheetButton)
        expect(panel().getAttribute('role')).toBeNull()
        expect(get(sideBarStore)).toBe(false)
        resizeTo(1280)
        flushSync()
        expect(get(sideBarStore)).toBe(false)
    })

    test('guard: TB13 (b) with no registered shell the overlay is the modal dialog and takes focus', () => {
        sheetButton.focus()
        sideBarStore.set(true)
        resizeTo(784)
        mountSidebar()
        expect(panel().getAttribute('role')).toBe('dialog')
        expect(document.activeElement).toBe(panel())
        expect(get(sideBarStore)).toBe(true)
    })

    test('guard: TB13 the docked layout mounts open over a registered shell, since it is not modal', () => {
        unregister = registerShell({})
        sheetButton.focus()
        sideBarStore.set(true)
        resizeTo(1280)
        mountSidebar()
        expect(document.activeElement).toBe(sheetButton)
        expect(get(sideBarStore)).toBe(true)
    })
})
