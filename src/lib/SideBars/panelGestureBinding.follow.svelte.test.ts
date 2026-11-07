// @vitest-environment happy-dom

/**
 * The follow-mode controller in `panelGestureBinding.ts`, driven through the REAL
 * `Sidebar.svelte` (its backdrop `{@attach}` installs the binding) with synthetic Touch events.
 * Time comes from a stubbed `performance.now`; the settle timers are real.
 *
 * MOCKED: the stores module, `database.svelte`, the new shell switch (a reactive flag) and the
 * heavy children, which render nothing.
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
import { dispatchBack, resetBackHandlersForTests } from '../../ts/backHandlers'
import { panelFollowView } from './panelGestureBinding'
import { FLING_PX_PER_MS, TRIGGER_PX } from './panelGesture'
import Sidebar from './Sidebar.svelte'

const shellFlag = (shellSwitchModule as unknown as { shellFlag: { eligible: boolean } }).shellFlag
const IDLE = { phase: 'idle', progress: 0, durationMs: 0, entered: false } as const
// 85% of the 400 px test viewport.
const PANEL_WIDTH = 340
const WAIT = { timeout: 3000 }

let clock = 0
let mounted: Array<Record<string, unknown>> = []
let host: HTMLElement
let chat: HTMLElement

function setViewport(width: number) {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
}

function mountSidebar(): Record<string, unknown> {
    const app = mount(Sidebar, { target: host })
    mounted.push(app)
    flushSync()
    return app
}

function panel(): HTMLElement {
    return host.querySelector('.setting-area') as HTMLElement
}

class Finger {
    private touch: Touch
    constructor(
        private origin: Element,
        x: number,
        y: number,
        id = 1,
    ) {
        this.touch = new Touch({ identifier: id, target: origin, clientX: x, clientY: y })
    }

    private send(type: string, cancelable: boolean, pressed: boolean, t: number) {
        clock = t
        const ev = new TouchEvent(type, {
            bubbles: true,
            cancelable,
            touches: pressed ? [this.touch] : [],
            targetTouches: pressed ? [this.touch] : [],
            changedTouches: [this.touch],
        })
        this.origin.dispatchEvent(ev)
        return ev
    }

    down(t = 0) {
        return this.send('touchstart', true, true, t)
    }

    moveTo(x: number, y: number, t: number) {
        this.touch = new Touch({ identifier: this.touch.identifier, target: this.origin, clientX: x, clientY: y })
        return this.send('touchmove', true, true, t)
    }

    up(t: number) {
        return this.send('touchend', true, false, t)
    }

    cancel(t: number) {
        return this.send('touchcancel', false, false, t)
    }
}

/** A slow drag from `fromX` to `toX` in four steps, 150 ms apart: never a fling. Returns the last time. */
function slowDrag(f: Finger, fromX: number, toX: number, startT = 0): number {
    let t = startT
    for (let i = 1; i <= 4; i++) {
        t += 150
        f.moveTo(fromX + ((toX - fromX) * i) / 4, 300, t)
    }
    return t
}

function view() {
    return get(panelFollowView)
}

function openPanel() {
    sideBarClosing.set(false)
    sideBarStore.set(true)
    flushSync()
}

beforeEach(() => {
    clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    setViewport(400)
    shellFlag.eligible = true
    DBState.db.menuSideBar = false
    DynamicGUI.set(true)
    sideBarStore.set(false)
    sideBarClosing.set(false)
    panelFollowView.set({ ...IDLE })
    host = document.createElement('div')
    chat = document.createElement('div')
    document.body.append(host, chat)
})

afterEach(() => {
    for (const app of mounted) {
        unmount(app)
    }
    mounted = []
    flushSync()
    vi.restoreAllMocks()
    host.remove()
    chat.remove()
    resetBackHandlersForTests()
    delete window.__risuTaniumGestureInset
    document.documentElement.removeAttribute('dir')
})

describe('open drag from the edge', () => {
    test('the stroke claims, opens the stores and the progress follows the finger', () => {
        mountSidebar()
        const f = new Finger(chat, 10, 300)
        f.down(0)
        const claim = f.moveTo(60, 302, 20)
        expect(claim.defaultPrevented).toBe(true)
        expect(get(sideBarStore)).toBe(true)
        expect(view().phase).toBe('dragging')
        expect(view().progress).toBeCloseTo(50 / PANEL_WIDTH, 5)
        f.moveTo(130, 302, 300)
        expect(view().progress).toBeCloseTo(120 / PANEL_WIDTH, 5)
        f.moveTo(100, 302, 600)
        expect(view().progress).toBeCloseTo(90 / PANEL_WIDTH, 5)
    })

    test('a slow release above 40 percent settles open over the chat duration, transform only', async () => {
        mountSidebar()
        const f = new Finger(chat, 10, 300)
        f.down(0)
        const t = slowDrag(f, 10, 10 + 0.5 * PANEL_WIDTH)
        f.up(t + 300)
        expect(view()).toMatchObject({ phase: 'settling', progress: 1, durationMs: 200 })
        await vi.waitFor(() => expect(view()).toMatchObject({ phase: 'idle', progress: 1, entered: true }), WAIT)
        expect(get(sideBarStore)).toBe(true)
        expect(get(sideBarClosing)).toBe(false)
    })

    test('a slow release below 40 percent settles closed and ends with the panel closed', async () => {
        mountSidebar()
        const f = new Finger(chat, 10, 300)
        f.down(0)
        const t = slowDrag(f, 10, 10 + 0.2 * PANEL_WIDTH)
        f.up(t + 300)
        expect(view()).toMatchObject({ phase: 'settling', progress: 0 })
        await vi.waitFor(() => expect(get(sideBarStore)).toBe(false), WAIT)
        expect(get(sideBarClosing)).toBe(false)
        expect(view()).toMatchObject({ phase: 'idle', entered: false })
    })

    test('the old 40 px travel does not open it in this mode', async () => {
        mountSidebar()
        const f = new Finger(chat, 10, 300)
        f.down(0)
        const t = slowDrag(f, 10, 10 + TRIGGER_PX + 10)
        f.up(t + 300)
        expect(view().progress).toBe(0)
        await vi.waitFor(() => expect(get(sideBarStore)).toBe(false), WAIT)
    })

    test('a fast flick opens although it travelled little', () => {
        mountSidebar()
        const f = new Finger(chat, 10, 300)
        f.down(0)
        f.moveTo(40, 300, 10)
        f.moveTo(70, 300, 20)
        f.moveTo(100, 300, 30)
        expect(view().progress).toBeLessThan(0.4)
        expect((100 - 10) / 30).toBeGreaterThan(FLING_PX_PER_MS)
        f.up(35)
        expect(view()).toMatchObject({ phase: 'settling', progress: 1 })
    })

    test('reduced motion still follows the finger, and the settle is a 120 ms move', () => {
        vi.spyOn(window, 'matchMedia').mockImplementation(
            (query: string) => ({ matches: query.includes('reduce'), media: query }) as unknown as MediaQueryList,
        )
        mountSidebar()
        const f = new Finger(chat, 10, 300)
        f.down(0)
        f.moveTo(60, 300, 20)
        expect(view().phase).toBe('dragging')
        f.moveTo(120, 300, 40)
        expect(view().progress).toBeCloseTo(110 / PANEL_WIDTH, 5)
        f.up(45)
        expect(view().durationMs).toBe(120)
    })

    test('the host inset owns the outermost pixels: a stroke inside it is not ours, past it opens', () => {
        window.__risuTaniumGestureInset = { left: () => 20 }
        mountSidebar()
        const inside = new Finger(chat, 10, 300)
        inside.down(0)
        const ignored = inside.moveTo(70, 300, 20)
        inside.up(30)
        expect(ignored.defaultPrevented).toBe(false)
        expect(get(sideBarStore)).toBe(false)

        const past = new Finger(chat, 30, 300)
        past.down(100)
        past.moveTo(90, 300, 120)
        expect(get(sideBarStore)).toBe(true)
        expect(view().phase).toBe('dragging')
    })

    test('RTL opens from the right edge by dragging left, and the left edge does not open', () => {
        document.documentElement.setAttribute('dir', 'rtl')
        mountSidebar()
        const left = new Finger(chat, 10, 300)
        left.down(0)
        left.moveTo(70, 300, 20)
        left.up(30)
        expect(get(sideBarStore)).toBe(false)

        const right = new Finger(chat, 390, 300)
        right.down(100)
        right.moveTo(340, 300, 120)
        expect(get(sideBarStore)).toBe(true)
        expect(view().progress).toBeCloseTo(50 / PANEL_WIDTH, 5)
    })

    test('a vertical edge stroke is a scroll: nothing is prevented or opened', () => {
        mountSidebar()
        const f = new Finger(chat, 10, 300)
        f.down(0)
        const first = f.moveTo(12, 340, 20)
        const later = f.moveTo(90, 380, 40)
        expect(first.defaultPrevented).toBe(false)
        expect(later.defaultPrevented).toBe(false)
        expect(get(sideBarStore)).toBe(false)
        expect(view().phase).toBe('idle')
    })

    test('a touch cancel mid-drag settles back to closed', async () => {
        mountSidebar()
        const f = new Finger(chat, 10, 300)
        f.down(0)
        f.moveTo(80, 300, 20)
        f.cancel(40)
        expect(view()).toMatchObject({ phase: 'settling', progress: 0 })
        await vi.waitFor(() => expect(get(sideBarStore)).toBe(false), WAIT)
    })

    test('a stroke that rests mid-drag is not dropped by the idle watchdog', async () => {
        mountSidebar()
        const f = new Finger(chat, 10, 300)
        f.down(0)
        f.moveTo(80, 300, 20)
        await new Promise((resolve) => setTimeout(resolve, 1200))
        expect(view().phase).toBe('dragging')
        f.up(1300)
        expect(view().phase).toBe('settling')
    })

    test('tearing the binding down mid-drag leaves nothing driven and no live stroke', () => {
        const app = mountSidebar()
        const f = new Finger(chat, 10, 300)
        f.down(0)
        f.moveTo(80, 300, 20)
        unmount(app)
        mounted = []
        flushSync()
        expect(view().phase).toBe('idle')
        const before = view()
        f.moveTo(120, 300, 40)
        expect(view()).toEqual(before)
    })
})

describe('close drag', () => {
    test('a slow drag toward closed that ends below 60 percent open closes', async () => {
        mountSidebar()
        openPanel()
        const f = new Finger(panel(), 300, 300)
        f.down(0)
        const t = slowDrag(f, 300, 300 - 0.5 * PANEL_WIDTH)
        expect(view().progress).toBeCloseTo(0.5, 5)
        f.up(t + 300)
        expect(view()).toMatchObject({ phase: 'settling', progress: 0 })
        await vi.waitFor(() => expect(get(sideBarStore)).toBe(false), WAIT)
        expect(get(sideBarClosing)).toBe(false)
    })

    test('a short drag that stays above 60 percent springs back open', async () => {
        mountSidebar()
        openPanel()
        const f = new Finger(panel(), 300, 300)
        f.down(0)
        const t = slowDrag(f, 300, 300 - 0.2 * PANEL_WIDTH)
        f.up(t + 300)
        expect(view()).toMatchObject({ phase: 'settling', progress: 1 })
        await vi.waitFor(() => expect(view().phase).toBe('idle'), WAIT)
        expect(get(sideBarStore)).toBe(true)
    })

    test('a fast flick toward closed closes even from a short drag', () => {
        mountSidebar()
        openPanel()
        const f = new Finger(panel(), 300, 300)
        f.down(0)
        f.moveTo(280, 300, 10)
        f.moveTo(255, 300, 20)
        f.moveTo(230, 300, 30)
        expect(view().progress).toBeGreaterThan(0.6)
        f.up(35)
        expect(view()).toMatchObject({ phase: 'settling', progress: 0 })
    })
})

describe('Back', () => {
    test('Back closes the open panel exactly once and is consumed', () => {
        mountSidebar()
        openPanel()
        let closingRises = 0
        const stop = sideBarClosing.subscribe((closing) => {
            if (closing) {
                closingRises++
            }
        })
        expect(dispatchBack()).toBe(true)
        expect(dispatchBack()).toBe(true)
        stop()
        expect(closingRises).toBe(1)
        expect(get(sideBarClosing)).toBe(true)
    })

    test('Back unregisters when the binding is destroyed', () => {
        const app = mountSidebar()
        openPanel()
        unmount(app)
        mounted = []
        flushSync()
        expect(dispatchBack()).toBe(false)
        expect(get(sideBarClosing)).toBe(false)
    })

    test('Back during a drag closes from where the panel is', async () => {
        mountSidebar()
        const f = new Finger(chat, 10, 300)
        f.down(0)
        f.moveTo(120, 300, 20)
        expect(view().phase).toBe('dragging')
        expect(dispatchBack()).toBe(true)
        expect(view()).toMatchObject({ phase: 'settling', progress: 0 })
        await vi.waitFor(() => expect(get(sideBarStore)).toBe(false), WAIT)
    })
})

describe('with the new shell off the old thresholds apply', () => {
    test('the 40 px trigger opens at once and nothing follows the finger', () => {
        shellFlag.eligible = false
        mountSidebar()
        const f = new Finger(chat, 10, 300)
        f.down(0)
        f.moveTo(20, 300, 20)
        expect(get(sideBarStore)).toBe(false)
        f.moveTo(10 + TRIGGER_PX, 300, 40)
        expect(get(sideBarStore)).toBe(true)
        expect(get(sideBarClosing)).toBe(false)
        expect(view()).toEqual(IDLE)
        f.up(60)
    })

    test('the 0.4 px/ms fling still opens before the trigger distance', () => {
        shellFlag.eligible = false
        mountSidebar()
        const f = new Finger(chat, 10, 300)
        f.down(0)
        f.moveTo(18, 300, 10)
        f.moveTo(26, 300, 20)
        f.moveTo(34, 300, 30)
        expect(get(sideBarStore)).toBe(true)
        f.up(50)
    })

    test('the wide layout keeps the old behaviour even when the shell is on', () => {
        setViewport(1000)
        mountSidebar()
        const f = new Finger(chat, 10, 300)
        f.down(0)
        f.moveTo(20, 300, 20)
        f.moveTo(10 + TRIGGER_PX, 300, 40)
        expect(get(sideBarStore)).toBe(true)
        expect(view()).toEqual(IDLE)
        f.up(60)
    })
})
