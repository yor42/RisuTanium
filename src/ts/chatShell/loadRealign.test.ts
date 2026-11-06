// @vitest-environment jsdom
// The re-align window holds the row at the top of the screen where it was after a load-older restore, while the reader is still.
// The layout is modelled with a height per row: a row's top is the sum of the heights above it minus the scroll position. Native scroll
// anchoring is modelled by hand with anchor(); a reader's scroll with readerScroll(). Neither is recorded as a module write.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { REALIGN_WINDOW_MS, createLoadRealign, viewportTopRow } from './loadRealign'

function rectOf(top: number, height: number): DOMRect {
    return { x: 0, y: top, top, left: 0, right: 0, bottom: top + height, width: 0, height, toJSON: () => ({}) }
}

// Visual order, topmost first. At scrollTop 500 and a viewport of 800: r2 straddles the top edge (-20), r3 is the top row (220), r4
// sits between it and r5, the bottom-most visible row (760).
const DEFAULT_HEIGHTS = [240, 240, 240, 240, 300, 200, 240, 240, 240, 240, 240]
const TOP = 3
const MIDDLE = 4
const ANCHOR = 5
const INPUT_TYPES = ['touchstart', 'pointerdown', 'wheel', 'keydown']

interface RigOptions {
    heights?: number[]
    scrollTop?: number
    firstMessage?: boolean
    viewport?: number
}

interface ObserverRecord {
    callback: () => void
    disconnected: boolean
}

function rig(options: RigOptions = {}) {
    const heights = [...(options.heights ?? DEFAULT_HEIGHTS)]
    const viewport = options.viewport ?? 800
    const host = document.createElement('main')
    document.body.appendChild(host)
    const rowsElement = document.createElement('div')
    host.appendChild(rowsElement)
    let scrollTop = options.scrollTop ?? 500
    const writes: number[] = []
    Object.defineProperty(host, 'scrollTop', {
        get: () => scrollTop,
        set: (value: number) => { writes.push(value); scrollTop = value },
        configurable: true,
    })
    host.getBoundingClientRect = () => rectOf(0, viewport)
    function contentTop(index: number): number {
        let sum = 0
        for (let at = 0; at < index; at++) sum += heights[at]
        return sum
    }
    const rows = heights.map((_, index) => {
        const row = document.createElement('article')
        row.setAttribute('data-part', index === 0 && options.firstMessage ? 'chat-first-message' : 'chat-message-container')
        row.getBoundingClientRect = () => rectOf(contentTop(index) - scrollTop, heights[index])
        return row
    })
    // The transcript is a reversed column: the newest row is first in the DOM and the oldest row last.
    for (let index = rows.length - 1; index >= 0; index--) rowsElement.appendChild(rows[index])
    const decoy = document.createElement('div')
    decoy.setAttribute('data-part', 'chat-other')
    decoy.getBoundingClientRect = () => rectOf(-5, 15)
    rowsElement.appendChild(decoy)

    const state = {
        intent: 3,
        held: false,
        following: false,
        active: true,
        host: host as HTMLElement | undefined,
        rows: rowsElement as HTMLElement | undefined,
    }
    const observers: ObserverRecord[] = []
    const frames = new Map<number, () => void>()
    const requested: number[] = []
    const cancelled: number[] = []
    const timers = new Map<number, () => void>()
    const timerDelays: number[] = []
    const cleared: number[] = []
    let frameId = 0
    let timerId = 0
    const addSpy = vi.spyOn(host, 'addEventListener')
    const removeSpy = vi.spyOn(host, 'removeEventListener')

    const realign = createLoadRealign({
        host: () => state.host,
        rows: () => state.rows,
        active: () => state.active,
        intentSeq: () => state.intent,
        held: () => state.held,
        following: () => state.following,
        setTimer: (callback, ms) => { timerId += 1; timers.set(timerId, callback); timerDelays.push(ms); return timerId },
        clearTimer: (id) => { cleared.push(id); timers.delete(id) },
        observe: (_target, callback) => {
            const record: ObserverRecord = { callback, disconnected: false }
            observers.push(record)
            return () => { record.disconnected = true }
        },
        requestFrame: (callback) => { frameId += 1; frames.set(frameId, callback); requested.push(frameId); return frameId },
        cancelFrame: (id) => { cancelled.push(id); frames.delete(id) },
    })

    function fireResize(): void {
        for (const record of [...observers]) if (!record.disconnected) record.callback()
    }
    function runFrame(): void {
        for (const [id, callback] of [...frames]) { frames.delete(id); callback() }
    }
    function fireTimers(): void {
        for (const [id, callback] of [...timers]) { timers.delete(id); callback() }
    }
    // A row's height changes; no scroll adjustment follows.
    function resize(index: number, delta: number): void {
        heights[index] += delta
    }
    // Native anchoring keeps the anchor row in place by moving the scroll position.
    function anchor(delta: number): void {
        scrollTop += delta
    }
    function readerScroll(delta: number): void {
        scrollTop += delta
    }
    // A row below the top row shrinks, anchoring compensates, and the resize observers fire.
    function settle(index: number, amount: number): void {
        resize(index, -amount)
        anchor(-amount)
        fireResize()
    }
    return {
        host, rowsElement, rows, state, realign, writes, observers, frames, requested, cancelled, timerDelays, cleared, timers,
        addSpy, removeSpy, heights, fireResize, runFrame, fireTimers, resize, anchor, readerScroll, settle,
        scrollTop: () => scrollTop,
    }
}

afterEach(() => {
    document.body.innerHTML = ''
})

describe('holding the top row after the layout settles', () => {
    test('a settle between the top row and the anchor row moves the scroll position back, once per settle', () => {
        const live = rig()
        live.realign.start()
        live.settle(MIDDLE, 272)
        expect(live.writes).toEqual([500])
        live.settle(ANCHOR, 123)
        expect(live.writes).toEqual([500, 500])
        expect(live.scrollTop()).toBe(500)
        expect(live.realign.isActive()).toBe(true)
    })

    test.each([
        { shift: 0.4, written: false },
        { shift: 0.6, written: true },
    ])('a shift of $shift px writes: $written', ({ shift, written }) => {
        const live = rig()
        live.realign.start()
        live.settle(MIDDLE, shift)
        expect(live.writes.length).toBe(written ? 1 : 0)
        if (written) expect(live.writes[0]).toBeCloseTo(500, 6)
    })

    test('a settle that anchoring already compensated above the top row writes nothing', () => {
        const live = rig({ heights: [1000, 933, 240, 300, 300, 240, 240, 240], scrollTop: 1713 })
        live.realign.start()
        live.resize(1, -693)
        live.anchor(-693)
        live.fireResize()
        expect(live.writes).toEqual([])
        expect(live.realign.isActive()).toBe(true)
    })

    test('after a corrective write, a second observation with no change writes nothing', () => {
        const live = rig()
        live.realign.start()
        live.settle(MIDDLE, 272)
        expect(live.writes).toEqual([500])
        live.fireResize()
        live.runFrame()
        expect(live.writes).toEqual([500])
    })

    test('a frame with no change writes nothing and the window stays active for the next settle', () => {
        const live = rig()
        live.realign.start()
        live.settle(MIDDLE, 272)
        live.runFrame()
        expect(live.writes).toEqual([500])
        expect(live.realign.isActive()).toBe(true)
        live.runFrame()
        expect(live.writes).toEqual([500])
        live.settle(ANCHOR, 123)
        expect(live.writes).toEqual([500, 500])
    })

    test('a reading that needed no write still refreshes what the next reading is compared with', () => {
        const live = rig({ heights: [240, 240, 240, 240, 300, 400, 240, 240, 240, 240, 240] })
        live.realign.start()
        live.resize(ANCHOR, -380)
        live.fireResize()
        expect(live.writes).toEqual([])
        expect(live.realign.isActive()).toBe(true)
        live.settle(ANCHOR, 15)
        expect(live.writes.length).toBe(1)
        expect(live.writes[0]).toBeCloseTo(500, 6)
    })

    test('a net-zero settle that fires no observer is corrected by the next frame, which asks for another frame', () => {
        const live = rig()
        live.realign.start()
        live.resize(2, 100)
        live.resize(MIDDLE, -100)
        const before = live.requested.length
        live.runFrame()
        expect(live.writes).toEqual([600])
        expect(live.requested.length).toBe(before + 1)
        live.runFrame()
        expect(live.requested.length).toBe(before + 2)
        expect(live.writes).toEqual([600])
    })
})

describe('the reader is never written against', () => {
    test('a scroll with no layout change ends the window without a write, and a later settle writes nothing', () => {
        const live = rig()
        live.realign.start()
        live.readerScroll(-300)
        live.fireResize()
        live.runFrame()
        expect(live.writes).toEqual([])
        expect(live.realign.isActive()).toBe(false)
        live.settle(MIDDLE, 272)
        expect(live.writes).toEqual([])
    })

    test('a scroll in the same interval as a settle ends the window without a write', () => {
        const live = rig()
        live.realign.start()
        live.resize(MIDDLE, -272)
        live.anchor(-272)
        live.readerScroll(-300)
        live.fireResize()
        expect(live.writes).toEqual([])
        expect(live.realign.isActive()).toBe(false)
    })

    test('the anchor row may drift under 1 px but not 1.5 px', () => {
        const drift = rig()
        drift.realign.start()
        drift.resize(MIDDLE, -50.9)
        drift.anchor(-50)
        drift.fireResize()
        expect(drift.writes.length).toBe(1)
        expect(drift.writes[0]).toBeCloseTo(500, 6)

        const moved = rig()
        moved.realign.start()
        moved.readerScroll(1.5)
        moved.fireResize()
        expect(moved.writes).toEqual([])
        expect(moved.realign.isActive()).toBe(false)
    })

    test('no row common to both readings ends the window without a write', () => {
        const live = rig()
        live.realign.start()
        live.readerScroll(1200)
        live.fireResize()
        expect(live.writes).toEqual([])
        expect(live.realign.isActive()).toBe(false)
    })

    test('a scroll that moves every row while the position moved ends the window, however much layout also shifted', () => {
        const live = rig()
        live.realign.start()
        live.readerScroll(-40)
        live.resize(0, -200)
        live.fireResize()
        expect(live.writes).toEqual([])
        expect(live.realign.isActive()).toBe(false)
        live.resize(1, -50)
        live.runFrame()
        live.fireResize()
        expect(live.writes).toEqual([])
    })

    test.each([
        { moved: 0.6, written: false },
        { moved: 0.05, written: true },
    ])('a position that moved $moved px alongside a shift of every row writes: $written', ({ moved, written }) => {
        const live = rig()
        live.realign.start()
        live.readerScroll(moved)
        live.resize(0, -100)
        live.fireResize()
        if (written) {
            expect(live.writes.length).toBe(1)
            expect(live.writes[0]).toBeCloseTo(400, 6)
        } else {
            expect(live.writes).toEqual([])
            expect(live.realign.isActive()).toBe(false)
        }
    })
})

describe('layout that moves rows while the scroll position stays put', () => {
    // The device shape: rows 90-99 at indices 1-10 in a 690 px viewport; row 91 (index 2) is the top row at 227.8 and row 90 straddles.
    function deviceRig() {
        return rig({ heights: [3647.99, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 2000], scrollTop: 3660.19, viewport: 690 })
    }
    function anchoredFrame(live: ReturnType<typeof rig>): void {
        live.resize(0, -693.23)
        live.anchor(-693.33)
        live.fireResize()
    }
    function slipResizes(live: ReturnType<typeof rig>): void {
        live.resize(0, -394.9)
        live.resize(1, -122.8)
        live.resize(2, -149.2)
        live.resize(3, -122.8)
        live.resize(4, -149.2)
        live.resize(5, -122.8)
        live.resize(6, -149.2)
        live.resize(7, -122.8)
        live.resize(8, -149.2)
    }

    test('a settle that no anchoring compensated leaves the position unchanged, so the top row is corrected', () => {
        const live = rig({ heights: [1000, 933, 240, 300, 300, 240, 240, 240], scrollTop: 1713 })
        live.realign.start()
        live.resize(1, -693)
        live.fireResize()
        expect(live.writes).toEqual([1020])
        expect(live.realign.isActive()).toBe(true)
    })

    test('the device slip after an anchored frame is corrected once, with no overlap in the visible rows', () => {
        const live = deviceRig()
        live.realign.start()
        anchoredFrame(live)
        expect(live.writes).toEqual([])
        live.runFrame()
        expect(live.writes).toEqual([])
        slipResizes(live)
        live.fireResize()
        expect(live.writes.length).toBe(1)
        expect(live.writes[0]).toBeCloseTo(2449.26, 1)
        expect(live.rows[2].getBoundingClientRect().top).toBeCloseTo(227.8, 1)
        expect(live.realign.isActive()).toBe(true)
        live.resize(9, -149.2)
        live.resize(10, -122.8)
        live.fireResize()
        live.runFrame()
        expect(live.writes.length).toBe(1)
        live.fireTimers()
        expect(live.realign.isActive()).toBe(false)
    })

    test('the anchored mixed frame, where one row kept its place and the top row moved, is corrected', () => {
        const live = deviceRig()
        live.realign.start()
        anchoredFrame(live)
        live.runFrame()
        slipResizes(live)
        live.anchor(-666.7)
        live.fireResize()
        expect(live.writes.length).toBe(1)
        expect(live.writes[0]).toBeCloseTo(2449.26, 1)
        expect(live.realign.isActive()).toBe(true)
    })

    test('a correction is followed by the next one, because the position is re-read after the write', () => {
        const live = rig()
        live.realign.start()
        live.resize(0, -100)
        live.fireResize()
        expect(live.writes).toEqual([400])
        live.resize(0, -50)
        live.fireResize()
        expect(live.writes).toEqual([400, 350])
    })
})

describe('gates', () => {
    const cases: { name: string; trip: (live: ReturnType<typeof rig>) => void }[] = [
        { name: 'reader intent', trip: (live) => { live.state.intent += 1 } },
        { name: 'a step hold in flight', trip: (live) => { live.state.held = true } },
        { name: 'following the newest message', trip: (live) => { live.state.following = true } },
        { name: 'the top row leaving the document', trip: (live) => { live.rows[TOP].remove() } },
        { name: 'a hidden surface', trip: (live) => { live.state.active = false } },
        { name: 'another host element', trip: (live) => { live.state.host = document.createElement('main') } },
        { name: 'another rows element', trip: (live) => { live.state.rows = document.createElement('div') } },
    ]
    test.each(cases)('$name ends the window with no write', ({ trip }) => {
        const live = rig()
        live.realign.start()
        trip(live)
        live.settle(MIDDLE, 272)
        expect(live.writes).toEqual([])
        expect(live.realign.isActive()).toBe(false)
    })

    test('a hold that has finished does not revive an ended window', () => {
        const live = rig()
        live.realign.start()
        live.state.held = true
        live.settle(MIDDLE, 100)
        live.state.held = false
        live.settle(ANCHOR, 100)
        expect(live.writes).toEqual([])
    })

    test.each(INPUT_TYPES)('a %s on the host ends the window', (type) => {
        const live = rig()
        live.realign.start()
        live.host.dispatchEvent(new Event(type))
        expect(live.realign.isActive()).toBe(false)
        live.settle(MIDDLE, 272)
        expect(live.writes).toEqual([])
    })
})

describe('starting', () => {
    const refused: { name: string; setup: (live: ReturnType<typeof rig>) => void }[] = [
        { name: 'no host', setup: (live) => { live.state.host = undefined } },
        { name: 'no rows element', setup: (live) => { live.state.rows = undefined } },
        { name: 'a hold in flight', setup: (live) => { live.state.held = true } },
        { name: 'following', setup: (live) => { live.state.following = true } },
        { name: 'a hidden surface', setup: (live) => { live.state.active = false } },
    ]
    test.each(refused)('$name starts nothing', ({ setup }) => {
        const live = rig()
        setup(live)
        live.realign.start()
        expect(live.observers.length).toBe(0)
        expect(live.requested.length).toBe(0)
        expect(live.timerDelays.length).toBe(0)
        expect(live.addSpy).not.toHaveBeenCalled()
        expect(live.realign.isActive()).toBe(false)
    })

    test('no row starts nothing', () => {
        const live = rig({ heights: [], scrollTop: 0 })
        live.realign.start()
        expect(live.observers.length).toBe(0)
        expect(live.requested.length).toBe(0)
        expect(live.timerDelays.length).toBe(0)
        expect(live.addSpy).not.toHaveBeenCalled()
        expect(live.realign.isActive()).toBe(false)
    })

    test('a second start ends the first window and holds the row that is on top at that call', () => {
        const live = rig()
        live.realign.start()
        live.readerScroll(-240)
        live.realign.start()
        expect(live.observers[0].disconnected).toBe(true)
        expect(live.cancelled).toEqual([live.requested[0]])
        expect(live.cleared.length).toBe(1)
        expect(live.observers[1].disconnected).toBe(false)
        live.settle(3, 100)
        expect(live.writes).toEqual([260])
    })
})

describe('ending', () => {
    test('expiry after the window length leaves no observer, frame, timer or listener', () => {
        const live = rig()
        live.realign.start()
        expect(live.timerDelays).toEqual([REALIGN_WINDOW_MS])
        expect(REALIGN_WINDOW_MS).toBe(300)
        const pending = live.requested[0]
        live.fireTimers()
        expect(live.observers[0].disconnected).toBe(true)
        expect(live.cancelled).toEqual([pending])
        expect(live.frames.size).toBe(0)
        expect([...live.removeSpy.mock.calls.map((call) => call[0])].sort()).toEqual([...INPUT_TYPES].sort())
        expect(live.realign.isActive()).toBe(false)
        live.runFrame()
        expect(live.requested.length).toBe(1)
        live.settle(MIDDLE, 272)
        expect(live.writes).toEqual([])
    })

    test('cancel disconnects, cancels the frame, clears the timer and removes the listeners, and is idempotent', () => {
        const live = rig()
        live.realign.start()
        const pending = live.requested[0]
        live.realign.cancel()
        live.realign.cancel()
        expect(live.observers[0].disconnected).toBe(true)
        expect(live.cancelled).toEqual([pending])
        expect(live.cleared.length).toBe(1)
        expect(live.timers.size).toBe(0)
        expect([...live.removeSpy.mock.calls.map((call) => call[0])].sort()).toEqual([...INPUT_TYPES].sort())
        live.settle(MIDDLE, 272)
        expect(live.writes).toEqual([])
    })
})

describe('viewportTopRow', () => {
    test('picks the first row whose top is inside the viewport, not the row straddling the top edge', () => {
        const live = rig({ scrollTop: 252 })
        expect(viewportTopRow(live.host, live.rowsElement)).toBe(live.rows[2])
    })

    test('falls back to the straddling row when one row covers the viewport', () => {
        const live = rig({ heights: [240, 3000], scrollTop: 252 })
        expect(viewportTopRow(live.host, live.rowsElement)).toBe(live.rows[1])
    })

    test('skips rows with no height and rows fully above', () => {
        const live = rig({ heights: [240, 240, 0, 240, 240], scrollTop: 252 })
        expect(viewportTopRow(live.host, live.rowsElement)).toBe(live.rows[3])
    })

    test('counts the first message as a row and ignores other children', () => {
        const live = rig({ heights: [100, 300, 300], scrollTop: 0, firstMessage: true })
        expect(viewportTopRow(live.host, live.rowsElement)).toBe(live.rows[0])
    })

    test.each([
        { scrollTop: 240.4, picks: 1 },
        { scrollTop: 240.6, picks: 2 },
    ])('a row top at scrollTop $scrollTop: row $picks is on top', ({ scrollTop, picks }) => {
        const live = rig({ scrollTop })
        expect(viewportTopRow(live.host, live.rowsElement)).toBe(live.rows[picks])
    })

    test('returns null when no row is visible', () => {
        const live = rig({ heights: [], scrollTop: 0 })
        expect(viewportTopRow(live.host, live.rowsElement)).toBeNull()
    })
})

describe('inline styles', () => {
    const exits: { name: string; leave: (live: ReturnType<typeof rig>) => void }[] = [
        { name: 'expiry', leave: (live) => live.fireTimers() },
        { name: 'cancel', leave: (live) => live.realign.cancel() },
        { name: 'a wheel on the host', leave: (live) => { live.host.dispatchEvent(new Event('wheel')) } },
        { name: 'a replacing start', leave: (live) => live.realign.start() },
    ]
    test.each(exits)('the host and rows style attributes are untouched across start, a write and $name', ({ leave }) => {
        const live = rig()
        live.host.setAttribute('style', 'overflow-anchor:none')
        live.rowsElement.setAttribute('style', 'padding-bottom:50px')
        const hostStyle = live.host.getAttribute('style')
        const rowsStyle = live.rowsElement.getAttribute('style')
        live.realign.start()
        expect(live.host.getAttribute('style')).toBe(hostStyle)
        expect(live.rowsElement.getAttribute('style')).toBe(rowsStyle)
        live.settle(MIDDLE, 272)
        expect(live.writes).toEqual([500])
        expect(live.host.getAttribute('style')).toBe(hostStyle)
        expect(live.rowsElement.getAttribute('style')).toBe(rowsStyle)
        leave(live)
        expect(live.host.getAttribute('style')).toBe(hostStyle)
        expect(live.rowsElement.getAttribute('style')).toBe(rowsStyle)
    })
})
