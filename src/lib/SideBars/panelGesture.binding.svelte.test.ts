// @vitest-environment happy-dom

/**
 * The overlay's swipe triggers and Android Back hook, driven through the REAL `Sidebar.svelte`
 * (its backdrop `{@attach}` installs the binding) and the REAL `SideBarArrow.svelte`, with
 * synthetic Touch events on happy-dom. Time comes from a stubbed `performance.now`.
 *
 * MOCKED: the stores module (only the stores these two components read), `database.svelte`,
 * and the heavy children (rail, character config, chat list, dev tool, quick settings, plugin
 * icon), which render nothing: the contract under test is the data attributes the real
 * `Sidebar.svelte` puts on its own elements plus the binding, not the children.
 *
 * Tests whose title starts with `guard:` pass with or without a defect (compatibility).
 * Every other test names a behaviour a mutation of the binding or the markup must break.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { alertData } from '../../ts/alert'
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

vi.mock('./SidebarRail.svelte', () => ({ default: () => {} }))
vi.mock('./CharConfig.svelte', () => ({ default: () => {} }))
vi.mock('./DevTool.svelte', () => ({ default: () => {} }))
vi.mock('./SideChatList.svelte', () => ({ default: () => {} }))
vi.mock('../Others/QuickSettingsGUI.svelte', () => ({ default: () => {} }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

import {
    alertStore,
    DBState,
    DynamicGUI,
    MobileGUI,
    sideBarClosing,
    sideBarStore,
} from '../../ts/stores.svelte'
import Sidebar from './Sidebar.svelte'
import SideBarArrow from '../UI/GUI/SideBarArrow.svelte'
import { installPanelGesture } from './panelGestureBinding'
import { EDGE_ZONE_PX, INSET_MAX_CSS, INSET_PROBE_MAX_CSS } from './panelGesture'

let clock = 0
let mounted: Array<Record<string, unknown>> = []
let host: HTMLElement
let chat: HTMLElement

function mountSidebar(): Record<string, unknown> {
    const app = mount(Sidebar, { target: host })
    mounted.push(app)
    flushSync()
    return app
}

function mountArrow(): HTMLElement {
    const slot = document.createElement('div')
    chat.appendChild(slot)
    mounted.push(mount(SideBarArrow, { target: slot }))
    flushSync()
    return slot
}

function panel(): HTMLElement {
    return host.querySelector('.setting-area') as HTMLElement
}

function backdrop(): HTMLElement {
    return host.querySelector('[role="button"][data-panel-surface]') as HTMLElement
}

function railRoot(): HTMLElement {
    return host.querySelector('[data-rail-root]') as HTMLElement
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

    private send(type: string, node: EventTarget, cancelable: boolean, pressed: boolean, t: number) {
        clock = t
        const ev = new TouchEvent(type, {
            bubbles: true,
            cancelable,
            touches: pressed ? [this.touch] : [],
            targetTouches: pressed ? [this.touch] : [],
            changedTouches: [this.touch],
        })
        node.dispatchEvent(ev)
        return ev
    }

    down(t = 0) {
        return this.send('touchstart', this.origin, true, true, t)
    }

    moveTo(x: number, y: number, t: number, opts: { cancelable?: boolean; on?: EventTarget } = {}) {
        this.touch = new Touch({ identifier: this.touch.identifier, target: this.origin, clientX: x, clientY: y })
        return this.send('touchmove', opts.on ?? this.origin, opts.cancelable ?? true, true, t)
    }

    up(t: number, on?: EventTarget) {
        return this.send('touchend', on ?? this.origin, true, false, t)
    }

    cancel(t: number) {
        return this.send('touchcancel', this.origin, false, false, t)
    }
}

/** Records add/removeEventListener on the given objects so "no listener left" is observable. */
function ledger(...objs: EventTarget[]) {
    const live: Array<{ obj: EventTarget; type: string; listener: unknown }> = []
    for (const obj of objs) {
        const add = obj.addEventListener
        const remove = obj.removeEventListener
        vi.spyOn(obj, 'addEventListener').mockImplementation(
            (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
                if (!live.some((e) => e.obj === obj && e.type === type && e.listener === listener)) {
                    live.push({ obj, type, listener })
                }
                add.call(obj, type, listener, options)
            },
        )
        vi.spyOn(obj, 'removeEventListener').mockImplementation(
            (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
                const i = live.findIndex((e) => e.obj === obj && e.type === type && e.listener === listener)
                if (i >= 0) {
                    live.splice(i, 1)
                }
                remove.call(obj, type, listener, options)
            },
        )
    }
    const strokeTypes = ['touchmove', 'touchend', 'touchcancel', 'visibilitychange', 'blur', 'pagehide']
    return {
        strokeListeners: () => live.filter((e) => strokeTypes.includes(e.type)).length,
        touchstartListeners: () => live.filter((e) => e.type === 'touchstart').length,
    }
}

function opened() {
    return get(sideBarStore) && !get(sideBarClosing)
}

beforeEach(() => {
    clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    DBState.db.menuSideBar = false
    DynamicGUI.set(true)
    MobileGUI.set(false)
    sideBarStore.set(false)
    sideBarClosing.set(false)
    alertStore.set({ type: 'none', msg: '' })
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
    vi.useRealTimers()
    vi.restoreAllMocks()
    host.remove()
    chat.remove()
    delete window.__risuTaniumBack
    delete window.__risuTaniumGestureInset
})

describe('markup contract', () => {
    test('guard: panel and backdrop carry the surface mark, the rail root and the arrow theirs (hamburger rail)', () => {
        mountSidebar()
        const arrowSlot = mountArrow()
        expect(panel().hasAttribute('data-panel-surface')).toBe(true)
        expect(backdrop().hasAttribute('data-panel-surface')).toBe(true)
        expect(host.querySelectorAll('[data-rail-root]').length).toBe(1)
        expect(arrowSlot.querySelector('button')?.hasAttribute('data-panel-handle')).toBe(true)
    })

    test('guard: the menu-bar rail variant carries the rail root too', () => {
        DBState.db.menuSideBar = true
        mountSidebar()
        expect(host.querySelectorAll('[data-rail-root]').length).toBe(1)
    })
})

describe('edge swipe opens', () => {
    test('a rightward stroke from the edge zone opens through the arrow path and suppresses scrolling while claimed', () => {
        mountSidebar()
        const f = new Finger(chat, EDGE_ZONE_PX - 12, 300)
        f.down(0)
        const claim = f.moveTo(EDGE_ZONE_PX - 2, 302, 40)
        expect(claim.defaultPrevented).toBe(true)
        expect(get(sideBarStore)).toBe(false)
        const fire = f.moveTo(EDGE_ZONE_PX + 40, 304, 80)
        expect(fire.defaultPrevented).toBe(true)
        expect(opened()).toBe(true)
        const end = f.up(100)
        expect(end.defaultPrevented).toBe(true)
    })

    test('a stroke starting outside the edge zone and not on the handle does not open', () => {
        mountSidebar()
        const f = new Finger(chat, 200, 300)
        f.down(0)
        f.moveTo(215, 300, 40)
        f.moveTo(260, 300, 80)
        f.up(100)
        expect(get(sideBarStore)).toBe(false)
    })

    test('a vertical-first edge stroke scrolls untouched: never prevented, nothing opens', () => {
        mountSidebar()
        const f = new Finger(chat, 10, 300)
        f.down(0)
        const first = f.moveTo(12, 340, 40)
        const later = f.moveTo(80, 380, 80)
        expect(first.defaultPrevented).toBe(false)
        expect(later.defaultPrevented).toBe(false)
        expect(get(sideBarStore)).toBe(false)
    })

    test('an uncancelable first move abandons without a state change', () => {
        mountSidebar()
        const f = new Finger(chat, 10, 300)
        f.down(0)
        f.moveTo(30, 300, 40, { cancelable: false })
        const later = f.moveTo(90, 300, 80)
        expect(later.defaultPrevented).toBe(false)
        expect(get(sideBarStore)).toBe(false)
    })
})

describe('host gesture inset', () => {
    let inset: unknown
    let left: ReturnType<typeof vi.fn>

    function install(impl: () => unknown) {
        left = vi.fn(impl)
        window.__risuTaniumGestureInset = { left: left as unknown as () => unknown }
    }

    /** One rightward stroke from `x`; reports whether it opened, then returns to the closed state. */
    function strokeOpens(x: number): boolean {
        const f = new Finger(chat, x, 300)
        f.down(0)
        f.moveTo(x + 15, 300, 40)
        f.moveTo(x + 60, 300, 80)
        f.up(100)
        const result = opened()
        sideBarStore.set(false)
        sideBarClosing.set(false)
        return result
    }

    beforeEach(() => {
        inset = 24
        install(() => inset)
    })

    test('the zone starts past the reported strip: a stroke inside it does not open, one just past it does', () => {
        mountSidebar()
        expect(strokeOpens(10)).toBe(false)
        expect(strokeOpens(23)).toBe(false)
        expect(strokeOpens(24)).toBe(true)
        expect(strokeOpens(24 + EDGE_ZONE_PX)).toBe(true)
        expect(strokeOpens(24 + EDGE_ZONE_PX + 1)).toBe(false)
    })

    test('the inset is read at every touch, not once at install', () => {
        mountSidebar()
        expect(strokeOpens(10)).toBe(false)
        inset = 0
        expect(strokeOpens(10)).toBe(true)
        inset = 24
        expect(strokeOpens(10)).toBe(false)
    })

    test('a host that appears after a first touch is honoured from the next touch', () => {
        delete window.__risuTaniumGestureInset
        mountSidebar()
        expect(strokeOpens(10)).toBe(true)
        install(() => 24)
        expect(strokeOpens(10)).toBe(false)
    })

    test('the bridge is read only left of the probe window', () => {
        mountSidebar()
        strokeOpens(INSET_PROBE_MAX_CSS)
        strokeOpens(200)
        expect(left).not.toHaveBeenCalled()
        strokeOpens(INSET_PROBE_MAX_CSS - 1)
        expect(left).toHaveBeenCalled()
    })

    test('the bridge is called as a method: its receiver is the host object', () => {
        mountSidebar()
        const bridge = window.__risuTaniumGestureInset
        strokeOpens(10)
        expect(left.mock.contexts.length).toBeGreaterThan(0)
        for (const context of left.mock.contexts) expect(context).toBe(bridge)
    })

    test('the handle opens from anywhere without reading the bridge', () => {
        mountSidebar()
        const handle = mountArrow().querySelector('button') as HTMLElement
        const f = new Finger(handle, 200, 300)
        f.down(0)
        f.moveTo(215, 300, 40)
        f.moveTo(260, 300, 80)
        expect(opened()).toBe(true)
        expect(left).not.toHaveBeenCalled()
    })

    test.each([
        ['Infinity', () => Infinity],
        ['NaN', () => NaN],
        ['a string', () => '24'],
        ['null', () => null],
        ['a negative number', () => -5],
        ['a throw', () => {
            throw new Error('bridge gone')
        }],
    ])('an unusable answer (%s) behaves as no strip', (_name, impl) => {
        install(impl)
        mountSidebar()
        expect(strokeOpens(10)).toBe(true)
    })

    test('a bridge whose left is not a function behaves as no strip', () => {
        window.__risuTaniumGestureInset = { left: 24 } as unknown as Window['__risuTaniumGestureInset']
        mountSidebar()
        expect(strokeOpens(10)).toBe(true)
    })

    test('an inset above the cap is clamped so the zone stays inside the probe window', () => {
        inset = 500
        mountSidebar()
        expect(INSET_MAX_CSS).toBe(96)
        expect(strokeOpens(95)).toBe(false)
        expect(strokeOpens(96)).toBe(true)
        expect(strokeOpens(INSET_PROBE_MAX_CSS - 1)).toBe(true)
        expect(strokeOpens(INSET_PROBE_MAX_CSS)).toBe(false)
    })
})

describe('handle swipe', () => {
    test('a rightward stroke on the handle opens; the triggered stroke keeps swallowing moves and its touchend', () => {
        mountSidebar()
        const handle = mountArrow().querySelector('button') as HTMLElement
        const f = new Finger(handle, 200, 300)
        f.down(0)
        f.moveTo(215, 300, 40)
        const fire = f.moveTo(260, 300, 80)
        expect(fire.defaultPrevented).toBe(true)
        expect(opened()).toBe(true)
        const after = f.moveTo(280, 300, 100)
        expect(after.defaultPrevented).toBe(true)
        const end = f.up(120)
        expect(end.defaultPrevented).toBe(true)
    })

    test('a tap on the handle is left alone: touchend not prevented, no open', () => {
        mountSidebar()
        const handle = mountArrow().querySelector('button') as HTMLElement
        const f = new Finger(handle, 200, 300)
        f.down(0)
        f.moveTo(202, 301, 30)
        const end = f.up(60)
        expect(end.defaultPrevented).toBe(false)
        expect(get(sideBarStore)).toBe(false)
    })
})

describe('close swipe', () => {
    beforeEach(() => {
        sideBarStore.set(true)
    })

    test('a leftward stroke on the panel starts the close animation path', () => {
        mountSidebar()
        const f = new Finger(panel(), 300, 300)
        f.down(0)
        f.moveTo(285, 300, 40)
        f.moveTo(240, 300, 80)
        expect(get(sideBarClosing)).toBe(true)
        expect(get(sideBarStore)).toBe(true)
    })

    test('a leftward stroke on the backdrop closes too', () => {
        mountSidebar()
        const f = new Finger(backdrop(), 300, 300)
        f.down(0)
        f.moveTo(285, 300, 40)
        f.moveTo(240, 300, 80)
        expect(get(sideBarClosing)).toBe(true)
    })

    test('a stroke that starts on the rail never closes, even where the rail sits inside a surface', () => {
        mountSidebar()
        host.setAttribute('data-panel-surface', '')
        const f = new Finger(railRoot(), 40, 300)
        f.down(0)
        const claim = f.moveTo(25, 300, 40)
        f.moveTo(0, 300, 80)
        expect(claim.defaultPrevented).toBe(false)
        expect(get(sideBarClosing)).toBe(false)
    })

    test('a rightward stroke on the panel does nothing', () => {
        mountSidebar()
        const f = new Finger(panel(), 100, 300)
        f.down(0)
        f.moveTo(120, 300, 40)
        f.moveTo(200, 300, 80)
        expect(get(sideBarClosing)).toBe(false)
    })
})

describe('yields', () => {
    function edgeSwipeOn(el: Element): boolean {
        mountSidebar()
        const f = new Finger(el, 10, 300)
        f.down(0)
        f.moveTo(25, 300, 40)
        f.moveTo(80, 300, 80)
        f.up(100)
        return get(sideBarStore)
    }

    test('baseline: a plain chat element does open', () => {
        const plain = document.createElement('div')
        chat.appendChild(plain)
        expect(edgeSwipeOn(plain)).toBe(true)
    })

    test('a textarea keeps its horizontal movement', () => {
        const el = document.createElement('textarea')
        chat.appendChild(el)
        expect(edgeSwipeOn(el)).toBe(false)
    })

    test('a contenteditable keeps its horizontal movement', () => {
        const wrap = document.createElement('div')
        wrap.setAttribute('contenteditable', 'true')
        const inner = document.createElement('span')
        wrap.appendChild(inner)
        chat.appendChild(wrap)
        expect(edgeSwipeOn(inner)).toBe(false)
    })

    test('a horizontally scrollable block keeps its horizontal movement', () => {
        const pre = document.createElement('pre')
        pre.style.overflowX = 'auto'
        Object.defineProperty(pre, 'scrollWidth', { value: 600, configurable: true })
        Object.defineProperty(pre, 'clientWidth', { value: 200, configurable: true })
        const code = document.createElement('code')
        pre.appendChild(code)
        chat.appendChild(pre)
        expect(edgeSwipeOn(code)).toBe(false)
    })

    test('guard: an overflow-x auto block that does not overflow does not yield', () => {
        const pre = document.createElement('pre')
        pre.style.overflowX = 'auto'
        Object.defineProperty(pre, 'scrollWidth', { value: 200, configurable: true })
        Object.defineProperty(pre, 'clientWidth', { value: 200, configurable: true })
        chat.appendChild(pre)
        expect(edgeSwipeOn(pre)).toBe(true)
    })

    test('a row being dragged by the sortable list keeps its horizontal movement', () => {
        const row = document.createElement('div')
        row.className = 'sortable-chosen'
        const inner = document.createElement('span')
        row.appendChild(inner)
        chat.appendChild(row)
        expect(edgeSwipeOn(inner)).toBe(false)
    })

    test('a full-screen modal layer above the page does not open the overlay behind it', () => {
        const modal = document.createElement('div')
        modal.style.position = 'fixed'
        const inner = document.createElement('div')
        modal.appendChild(inner)
        chat.appendChild(modal)
        expect(edgeSwipeOn(inner)).toBe(false)
    })

    test('an opted-out region keeps its horizontal movement', () => {
        const off = document.createElement('div')
        off.setAttribute('data-panel-gesture', 'off')
        chat.appendChild(off)
        expect(edgeSwipeOn(off)).toBe(false)
    })
})

describe('interruption', () => {
    function claimedEdgeStroke() {
        mountSidebar()
        const target = document.createElement('div')
        chat.appendChild(target)
        const seen = ledger(window, document, target)
        const f = new Finger(target, 10, 300)
        f.down(0)
        const claim = f.moveTo(25, 300, 40)
        expect(claim.defaultPrevented).toBe(true)
        expect(seen.strokeListeners()).toBeGreaterThan(0)
        return { f, seen, target }
    }

    test('touchcancel ends the stroke with no change and no listener left', () => {
        const { f, seen } = claimedEdgeStroke()
        f.cancel(60)
        expect(seen.strokeListeners()).toBe(0)
        const later = f.moveTo(90, 300, 80)
        expect(later.defaultPrevented).toBe(false)
        expect(get(sideBarStore)).toBe(false)
    })

    test('the page going hidden ends the stroke with no change and no listener left', () => {
        const { f, seen } = claimedEdgeStroke()
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
        try {
            document.dispatchEvent(new Event('visibilitychange'))
        } finally {
            delete (document as unknown as Record<string, unknown>).visibilityState
        }
        expect(seen.strokeListeners()).toBe(0)
        const later = f.moveTo(90, 300, 80)
        expect(later.defaultPrevented).toBe(false)
        expect(get(sideBarStore)).toBe(false)
    })

    test('a stroke with no touch event for the idle limit is dropped with no listener left', () => {
        vi.useFakeTimers()
        const { seen } = claimedEdgeStroke()
        vi.advanceTimersByTime(1100)
        expect(seen.strokeListeners()).toBe(0)
        expect(get(sideBarStore)).toBe(false)
    })

    test('a store change made by someone else mid-stroke cancels it', () => {
        const { f } = claimedEdgeStroke()
        sideBarClosing.set(true)
        flushSync()
        sideBarClosing.set(false)
        const later = f.moveTo(90, 300, 80)
        expect(later.defaultPrevented).toBe(false)
        expect(get(sideBarStore)).toBe(false)
    })

    test('a second finger cancels the stroke', () => {
        const { f, seen } = claimedEdgeStroke()
        new Finger(chat, 200, 200, 2).down(50)
        expect(seen.strokeListeners()).toBe(0)
        const later = f.moveTo(90, 300, 80)
        expect(later.defaultPrevented).toBe(false)
    })
})

describe('removed target', () => {
    test('a target removed mid-stroke ends cleanly when its own events keep arriving', () => {
        mountSidebar()
        const target = document.createElement('div')
        chat.appendChild(target)
        const seen = ledger(window, document, target)
        const f = new Finger(target, 10, 300)
        f.down(0)
        f.moveTo(25, 300, 40)
        target.remove()
        f.moveTo(60, 300, 60, { on: target })
        expect(seen.strokeListeners()).toBe(0)
        f.up(80, target)
        expect(get(sideBarStore)).toBe(false)
    })

    test('a move delivered to both the target and the window counts once: one real move cannot fling', () => {
        mountSidebar()
        const target = document.createElement('div')
        chat.appendChild(target)
        const f = new Finger(target, 10, 300)
        f.down(0)
        f.moveTo(25, 300, 5)
        expect(get(sideBarStore)).toBe(false)
    })
})

describe('no stroke at all', () => {
    test('while the overlay is closing', () => {
        mountSidebar()
        sideBarStore.set(true)
        sideBarClosing.set(true)
        flushSync()
        const seen = ledger(window, document, panel())
        const f = new Finger(panel(), 300, 300)
        f.down(0)
        expect(seen.strokeListeners()).toBe(0)
    })

    test('while an alert is open', () => {
        mountSidebar()
        alertStore.set({ type: 'normal', msg: 'hello' } as alertData)
        const target = document.createElement('div')
        chat.appendChild(target)
        const seen = ledger(window, document, target)
        const f = new Finger(target, 10, 300)
        f.down(0)
        expect(seen.strokeListeners()).toBe(0)
        f.moveTo(25, 300, 40)
        f.moveTo(80, 300, 80)
        expect(get(sideBarStore)).toBe(false)
    })
})

describe('Android Back hook', () => {
    test('open overlay: consumed, and the close path starts', () => {
        mountSidebar()
        sideBarStore.set(true)
        expect(window.__risuTaniumBack?.()).toBe(true)
        expect(get(sideBarClosing)).toBe(true)
    })

    test('closing overlay: consumed without a second change', () => {
        mountSidebar()
        sideBarStore.set(true)
        sideBarClosing.set(true)
        expect(window.__risuTaniumBack?.()).toBe(true)
        expect(get(sideBarStore)).toBe(true)
    })

    test('closed overlay: not consumed', () => {
        mountSidebar()
        expect(window.__risuTaniumBack?.()).toBe(false)
    })

    test('open overlay with an alert: not consumed, overlay untouched', () => {
        mountSidebar()
        sideBarStore.set(true)
        alertStore.set({ type: 'normal', msg: 'hello' } as alertData)
        expect(window.__risuTaniumBack?.()).toBe(false)
        expect(get(sideBarClosing)).toBe(false)
    })

    test('a close whose animationend never comes is finished by the watchdog', () => {
        vi.useFakeTimers()
        mountSidebar()
        sideBarStore.set(true)
        window.__risuTaniumBack?.()
        expect(get(sideBarClosing)).toBe(true)
        vi.advanceTimersByTime(1000)
        expect(get(sideBarClosing)).toBe(false)
        expect(get(sideBarStore)).toBe(false)
        expect(window.__risuTaniumBack?.()).toBe(false)
    })

    test('Back during a stuck close finishes it once instead of trapping every later Back', () => {
        mountSidebar()
        sideBarStore.set(true)
        clock = 0
        window.__risuTaniumBack?.()
        expect(get(sideBarClosing)).toBe(true)
        clock = 5000
        expect(window.__risuTaniumBack?.()).toBe(true)
        expect(get(sideBarClosing)).toBe(false)
        expect(get(sideBarStore)).toBe(false)
        expect(window.__risuTaniumBack?.()).toBe(false)
    })

    test('an older instance cleaning up keeps the newer instance hook', () => {
        const first = installPanelGesture()
        const second = installPanelGesture()
        const newer = window.__risuTaniumBack
        expect(typeof newer).toBe('function')
        first()
        expect(window.__risuTaniumBack).toBe(newer)
        second()
        expect(window.__risuTaniumBack).toBeUndefined()
    })
})

describe('lifetime', () => {
    test('wide layout installs nothing; the phone overlay installs on appearing and removes on leaving', () => {
        const seen = ledger(document)
        DynamicGUI.set(false)
        mountSidebar()
        expect(seen.touchstartListeners()).toBe(0)
        expect(window.__risuTaniumBack).toBeUndefined()
        DynamicGUI.set(true)
        flushSync()
        expect(seen.touchstartListeners()).toBe(1)
        expect(typeof window.__risuTaniumBack).toBe('function')
        DynamicGUI.set(false)
        flushSync()
        expect(seen.touchstartListeners()).toBe(0)
        expect(window.__risuTaniumBack).toBeUndefined()
    })

    test('a screen that replaces the sidebar leaves no listener and no Back hook', () => {
        const seen = ledger(document)
        const app = mountSidebar()
        expect(seen.touchstartListeners()).toBe(1)
        sideBarStore.set(true)
        unmount(app)
        mounted = mounted.filter((m) => m !== app)
        flushSync()
        expect(seen.touchstartListeners()).toBe(0)
        expect(window.__risuTaniumBack).toBeUndefined()
        expect(get(sideBarClosing)).toBe(false)
    })
})
