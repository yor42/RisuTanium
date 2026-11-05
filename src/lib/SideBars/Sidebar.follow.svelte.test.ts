// @vitest-environment happy-dom

/**
 * The follow-the-finger overlay as the REAL `Sidebar.svelte` renders it: modal semantics, the
 * transform and opacity that follow the controller's progress, and the close paths. The
 * controller itself is covered by `panelGestureBinding.follow.svelte.test.ts` and the progress
 * model by `panelGesture.follow.test.ts`.
 *
 * MOCKED: the stores module (only the stores the component reads), `database.svelte`, the new
 * shell switch (a reactive flag), and the heavy children, which render nothing.
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

import { DBState, DynamicGUI, sideBarClosing, sideBarStore } from '../../ts/stores.svelte'
import * as shellSwitchModule from '../../ts/chatShell/shellSwitch.svelte'
import { language } from '../../lang'
import { resetBackHandlersForTests } from '../../ts/backHandlers'
import { panelFollowView } from './panelGestureBinding'
import Sidebar from './Sidebar.svelte'

const shellFlag = (shellSwitchModule as unknown as { shellFlag: { eligible: boolean } }).shellFlag

let mounted: Array<Record<string, unknown>> = []
let page: HTMLElement
let container: HTMLElement
let chat: HTMLElement
let opener: HTMLButtonElement

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

function backdrop(): HTMLElement {
    return container.querySelector('[role="button"][data-panel-surface]') as HTMLElement
}

function railRoot(): HTMLElement {
    return container.querySelector('[data-rail-root]') as HTMLElement
}

function openPanel() {
    sideBarClosing.set(false)
    sideBarStore.set(true)
    flushSync()
}

beforeEach(() => {
    setViewport(400)
    shellFlag.eligible = true
    DBState.db.menuSideBar = false
    DynamicGUI.set(true)
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

describe('modal semantics while overlaid', () => {
    test('the open panel is a labelled modal dialog, the rest of the page is inert, focus moves in', () => {
        mountSidebar()
        opener.focus()
        openPanel()
        expect(panel().getAttribute('role')).toBe('dialog')
        expect(panel().hasAttribute('aria-modal')).toBe(false)
        expect(container.querySelector('[data-rail-root]')?.hasAttribute('inert')).toBe(false)
        expect(panel().getAttribute('aria-label')).toBe(language.menu)
        expect(chat.hasAttribute('inert')).toBe(true)
        expect(container.hasAttribute('inert')).toBe(false)
        expect(document.activeElement).toBe(panel())
    })

    test('closing returns focus to the opener and lifts the inert mark', () => {
        mountSidebar()
        opener.focus()
        openPanel()
        sideBarStore.set(false)
        flushSync()
        expect(chat.hasAttribute('inert')).toBe(false)
        expect(document.activeElement).toBe(opener)
        expect(panel().hasAttribute('role')).toBe(false)
    })

    test('a page region that was already inert stays inert after the modal ends', () => {
        const other = document.createElement('div')
        other.setAttribute('inert', '')
        page.append(other)
        mountSidebar()
        openPanel()
        sideBarStore.set(false)
        flushSync()
        expect(other.hasAttribute('inert')).toBe(true)
    })

    test('guard: with the new shell off the panel is not a dialog and nothing is inert', () => {
        shellFlag.eligible = false
        mountSidebar()
        openPanel()
        expect(panel().hasAttribute('role')).toBe(false)
        expect(panel().hasAttribute('aria-modal')).toBe(false)
        expect(chat.hasAttribute('inert')).toBe(false)
        expect(panel().hasAttribute('style')).toBe(false)
        expect(panel().classList.contains('risu-sidebar')).toBe(true)
    })

    test('the wide layout is docked: no dialog and nothing inert', () => {
        setViewport(1000)
        mountSidebar()
        openPanel()
        expect(panel().hasAttribute('role')).toBe(false)
        expect(chat.hasAttribute('inert')).toBe(false)
    })
})

describe('close paths', () => {
    test('tapping the backdrop closes, through the transform exit and not the width keyframes', () => {
        mountSidebar()
        openPanel()
        backdrop().click()
        flushSync()
        expect(get(sideBarClosing)).toBe(true)
        expect(panel().classList.contains('follow-out')).toBe(true)
        expect(panel().classList.contains('risu-sidebar-close')).toBe(false)
        expect(railRoot().classList.contains('risu-sub-sidebar-close')).toBe(false)
    })

    test('the end of the exit animation finishes the close', () => {
        mountSidebar()
        openPanel()
        backdrop().click()
        flushSync()
        panel().dispatchEvent(new Event('animationend', { bubbles: true }))
        flushSync()
        expect(get(sideBarStore)).toBe(false)
        expect(get(sideBarClosing)).toBe(false)
    })

    test('Escape closes the modal panel once', () => {
        mountSidebar()
        openPanel()
        const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
        window.dispatchEvent(event)
        flushSync()
        expect(get(sideBarClosing)).toBe(true)
        expect(event.defaultPrevented).toBe(true)
    })

    test('the mouse back button closes the modal panel', () => {
        mountSidebar()
        openPanel()
        window.dispatchEvent(new MouseEvent('mouseup', { button: 3, cancelable: true, bubbles: true }))
        flushSync()
        expect(get(sideBarClosing)).toBe(true)
    })

    test('guard: Escape does nothing while the panel is closed or the new shell is off', () => {
        mountSidebar()
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        flushSync()
        expect(get(sideBarClosing)).toBe(false)
        shellFlag.eligible = false
        openPanel()
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        flushSync()
        expect(get(sideBarClosing)).toBe(false)
    })

    test('Escape during a drag does not fight the finger', () => {
        mountSidebar()
        openPanel()
        panelFollowView.set({ phase: 'dragging', progress: 0.5, durationMs: 0, entered: false })
        flushSync()
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        flushSync()
        expect(get(sideBarClosing)).toBe(false)
    })
})

describe('the panel follows progress', () => {
    function drive(progress: number, phase: 'dragging' | 'settling' = 'dragging', durationMs = 0) {
        panelFollowView.set({ phase, progress, durationMs, entered: false })
        flushSync()
    }

    test('the panel and the rail translate together; the backdrop opacity runs from 0 to 0.5', () => {
        mountSidebar()
        openPanel()
        drive(0)
        expect(panel().style.transform).toBe('translateX(-340px)')
        expect(railRoot().style.transform).toBe('translateX(-340px)')
        expect(backdrop().style.opacity).toBe('0')
        drive(0.5)
        expect(panel().style.transform).toBe('translateX(-170px)')
        expect(backdrop().style.opacity).toBe('0.25')
        drive(1)
        expect(panel().style.transform).toBe('translateX(0px)')
        expect(backdrop().style.opacity).toBe('0.5')
    })

    test('dragging has no transition, and the keyframe entrance and exit are off', () => {
        mountSidebar()
        openPanel()
        drive(0.3)
        expect(panel().style.transition).toContain('none')
        expect(panel().style.animation).toContain('none')
        expect(panel().classList.contains('follow-in')).toBe(false)
        expect(panel().classList.contains('follow-out')).toBe(false)
    })

    test('no blur anywhere on the panel, the rail or the backdrop', () => {
        mountSidebar()
        openPanel()
        for (const progress of [0, 0.4, 1]) {
            drive(progress)
            for (const element of [panel(), railRoot(), backdrop()]) {
                const style = element.getAttribute('style') ?? ''
                expect(style).not.toMatch(/blur|backdrop-filter/)
            }
        }
    })

    test('a settle moves transform and opacity only, over the duration the controller chose (120 ms under reduced motion)', () => {
        mountSidebar()
        openPanel()
        drive(1, 'settling', 120)
        expect(panel().style.transition).toContain('transform 120ms')
        expect(panel().style.transition).not.toMatch(/width|all/)
        expect(backdrop().style.transition).toContain('opacity 120ms')
        expect(backdrop().style.opacity).toBe('0.5')
    })

    test('the panel is min(85vw, 360px) wide including the rail', () => {
        mountSidebar()
        openPanel()
        // 85% of 400 is 340; the 80 px rail leaves 260 for the panel.
        expect(panel().style.width).toBe('260px')
        expect(panel().style.minWidth).toMatch(/^0(px)?$/)
        setViewport(800)
        window.dispatchEvent(new Event('resize'))
        flushSync()
        expect(panel().style.width).toBe('280px')
    })

    test('after a drag left the panel open the button entrance does not replay', () => {
        mountSidebar()
        openPanel()
        expect(panel().classList.contains('follow-in')).toBe(true)
        panelFollowView.set({ phase: 'idle', progress: 1, durationMs: 0, entered: true })
        flushSync()
        expect(panel().classList.contains('follow-in')).toBe(false)
        expect(panel().hasAttribute('style')).toBe(true)
        expect(panel().style.transform).toBe('')
    })
})
