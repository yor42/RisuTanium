// @vitest-environment jsdom

/**
 * "Sheet wins" (MC-2668): the overlay sidebar and a sheet never stay open together. The overlay sets
 * `inert` on every sibling of its panel, and a ChatShell sheet lives inside one of those siblings, so a
 * sheet over an open sidebar would be unreachable by assistive technology.
 *
 * Invariants exercised here:
 * - T1: a sheet that opens outside the panel while the overlay is open closes the overlay, releases its
 *   inert, and ends with focus inside the sheet.
 * - T2: while a sheet is open the overlay does not open, whatever opens it.
 * - T3, guard: a sheet hosted inside the panel leaves the overlay open.
 * - T4, guard: the docked layout is not modal and stays open under a sheet.
 *
 * MOCKED: the stores module (only the stores the component reads), `database.svelte`, the shell switch
 * (a reactive flag), the heavy children and `ShellSidebar`. The sheet is the real `ShellSheet`.
 *
 * Tests whose title starts with `guard:` pass with or without a defect (compatibility).
 */
import { createRawSnippet, flushSync, mount, unmount } from 'svelte'
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
vi.mock('../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: () => {} }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))

import { DynamicGUI, sideBarClosing, sideBarStore } from '../../ts/stores.svelte'
import * as shellSwitchModule from '../../ts/chatShell/shellSwitch.svelte'
import { resetBackHandlersForTests } from '../../ts/backHandlers'
import { panelFollowView } from './panelGestureBinding'
import Sidebar from './Sidebar.svelte'
import ShellSheet from '../ChatShell/ShellSheet.svelte'

const shellFlag = (shellSwitchModule as unknown as { shellFlag: { eligible: boolean } }).shellFlag

const children = createRawSnippet(() => ({ render: () => '<button data-sheet-initial>First action</button>' }))

let mounted: Array<Record<string, unknown>> = []
let page: HTMLElement
let container: HTMLElement
let surface: HTMLElement
let sheetTarget: HTMLElement
const sheet = $state({ open: false })

function setViewport(width: number) {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
}

function layout(width: number) {
    setViewport(width)
    DynamicGUI.set(width <= 1024)
}

function mountSidebar() {
    mounted.push(mount(Sidebar, { target: container }))
    flushSync()
}

function mountSheet(target: HTMLElement) {
    mounted.push(mount(ShellSheet, {
        target,
        props: { get open() { return sheet.open }, kind: 'sheet', label: 'This chat', onclose: () => { sheet.open = false }, children },
    }))
    flushSync()
}

function panel(): HTMLElement {
    return container.querySelector('.setting-area') as HTMLElement
}

function sheetDialog(target: HTMLElement): HTMLElement | null {
    return target.querySelector<HTMLElement>('[role="dialog"]')
}

beforeEach(() => {
    shellFlag.eligible = true
    sheet.open = false
    sideBarClosing.set(false)
    sideBarStore.set(false)
    panelFollowView.set({ phase: 'idle', progress: 0, durationMs: 0, entered: false })
    page = document.createElement('div')
    container = document.createElement('div')
    surface = document.createElement('div')
    surface.setAttribute('data-chat-surface', '')
    sheetTarget = document.createElement('div')
    surface.append(sheetTarget)
    page.append(container, surface)
    document.body.append(page)
})

afterEach(() => {
    sheet.open = false
    flushSync()
    for (const app of mounted.reverse()) {
        unmount(app)
    }
    mounted = []
    flushSync()
    page.remove()
    resetBackHandlersForTests()
    vi.restoreAllMocks()
})

describe('sheet wins over the overlay sidebar', () => {
    test('T1: a sheet opened outside the panel closes the overlay, frees the surface and takes focus', () => {
        layout(784)
        sideBarStore.set(true)
        mountSidebar()
        mountSheet(sheetTarget)
        expect(surface.hasAttribute('inert')).toBe(true)
        sheet.open = true
        flushSync()
        expect(get(sideBarStore)).toBe(false)
        const dialog = sheetDialog(sheetTarget)!
        expect(dialog).not.toBeNull()
        expect(dialog.closest('[inert]')).toBeNull()
        expect(surface.hasAttribute('inert')).toBe(false)
        expect(dialog.contains(document.activeElement)).toBe(true)
    })

    test('T1: the overlay teardown does not return focus to its opener once a sheet took over', async () => {
        layout(784)
        sideBarStore.set(true)
        const opener = document.createElement('button')
        surface.append(opener)
        opener.focus()
        const openerFocus = vi.spyOn(opener, 'focus')
        mountSidebar()
        mountSheet(sheetTarget)
        sheet.open = true
        flushSync()
        await Promise.resolve()
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(get(sideBarStore)).toBe(false)
        expect(openerFocus).not.toHaveBeenCalled()
        expect(sheetDialog(sheetTarget)!.contains(document.activeElement)).toBe(true)
    })

    test('T1: a focus call refused by the still-inert page is placed again once the overlay released it', async () => {
        const realFocus = HTMLElement.prototype.focus
        const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
            if (this.closest('[inert]')) return
            realFocus.call(this, options)
        })
        try {
            layout(784)
            sideBarStore.set(true)
            mountSidebar()
            mountSheet(sheetTarget)
            sheet.open = true
            flushSync()
            await Promise.resolve()
            await new Promise((resolve) => setTimeout(resolve, 0))
            expect(surface.hasAttribute('inert')).toBe(false)
            expect(sheetDialog(sheetTarget)!.contains(document.activeElement)).toBe(true)
        } finally {
            focusSpy.mockRestore()
        }
    })

    test('T2: with a sheet open the overlay refuses to open, and the sheet stays reachable', () => {
        layout(784)
        mountSidebar()
        mountSheet(sheetTarget)
        sheet.open = true
        flushSync()
        sideBarStore.set(true)
        flushSync()
        expect(get(sideBarStore)).toBe(false)
        const dialog = sheetDialog(sheetTarget)!
        expect(dialog.closest('[inert]')).toBeNull()
        expect(surface.hasAttribute('inert')).toBe(false)
        expect(dialog.contains(document.activeElement)).toBe(true)
    })

    test('guard: T3 a sheet hosted inside the panel leaves the overlay open', () => {
        layout(784)
        sideBarStore.set(true)
        mountSidebar()
        sheet.open = true
        mountSheet(panel())
        expect(get(sideBarStore)).toBe(true)
        expect(panel().getAttribute('role')).toBe('dialog')
    })

    test('guard: T4 the docked layout stays open under a sheet', () => {
        layout(1280)
        sideBarStore.set(true)
        mountSidebar()
        mountSheet(sheetTarget)
        sheet.open = true
        flushSync()
        expect(get(sideBarStore)).toBe(true)
        expect(surface.hasAttribute('inert')).toBe(false)
    })
})
