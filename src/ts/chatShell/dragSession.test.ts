// @vitest-environment happy-dom

/**
 * `startDragSession`: one pointer's drag over a scroller.
 *
 * Invariants:
 * - Only the recorded `pointerup` commits; cancel, lost capture, blur, a hidden page, Escape and `abort()` abort. `onend` runs
 *   exactly once, and nothing reacts after it.
 * - Events of another pointer are ignored.
 * - Escape is default-prevented in the capture phase and never stopped.
 * - An autoscroll frame adds the edge delta to `scrollTop` and reports the pointer again; it stops with the drag.
 *
 * MOCKED: the animation frame queue (run by hand). The DOM is happy-dom's.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// dragSession reads the edge geometry from chatOrder, which imports the live-write modules; none of them runs here.
vi.mock(import('src/ts/stores.svelte'), () => ({ DBState: { db: { characters: [] } }, selIdState: { selId: -1 } }) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({ changeChatTo: vi.fn() }) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/alert'), () => ({ alertError: vi.fn() }) as unknown as typeof import('src/ts/alert'))

import { startDragSession, type DragEnd } from './dragSession'

let scroller: HTMLDivElement
let frames: Map<number, FrameRequestCallback>
let nextFrame: number
const ends: DragEnd[] = []
const points: number[] = []
const captures = { set: [] as number[], released: [] as number[], held: new Set<number>() }

function pointer(type: string, init: { pointerId?: number, clientY?: number } = {}): PointerEvent {
    return new PointerEvent(type, { pointerId: init.pointerId ?? 1, clientY: init.clientY ?? 0, bubbles: true, cancelable: true })
}

function start(pointerId = 1, clientY = 100) {
    return startDragSession(scroller, pointer('pointerdown', { pointerId, clientY }), {
        onpoint: (y) => { points.push(y) },
        onend: (kind) => { ends.push(kind) },
    })
}

function runFrames(): void {
    const queued = [...frames.values()]
    frames.clear()
    for (const callback of queued) {
        callback(0)
    }
}

beforeEach(() => {
    scroller = document.createElement('div')
    document.body.append(scroller)
    scroller.getBoundingClientRect = () => ({ top: 0, bottom: 640, left: 0, right: 280, width: 280, height: 640, x: 0, y: 0, toJSON: () => ({}) })
    scroller.setPointerCapture = (id: number) => { captures.set.push(id); captures.held.add(id) }
    scroller.releasePointerCapture = (id: number) => { captures.released.push(id); captures.held.delete(id) }
    scroller.hasPointerCapture = (id: number) => captures.held.has(id)
    frames = new Map()
    nextFrame = 1
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(nextFrame, callback); return nextFrame++ })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
    ends.length = 0
    points.length = 0
    captures.set.length = 0
    captures.released.length = 0
    captures.held.clear()
})

afterEach(() => {
    scroller.remove()
    vi.unstubAllGlobals()
})

describe('ending', () => {
    test('the recorded pointerup commits once and releases the capture', () => {
        const session = start()
        expect(captures.set).toEqual([1])
        scroller.dispatchEvent(pointer('pointerup'))
        expect(ends).toEqual(['commit'])
        expect(session.live).toBe(false)
        expect(captures.released).toEqual([1])
    })

    test.each([
        ['pointercancel', () => scroller.dispatchEvent(pointer('pointercancel'))],
        ['lostpointercapture', () => scroller.dispatchEvent(pointer('lostpointercapture'))],
        ['window blur', () => window.dispatchEvent(new Event('blur'))],
        ['a hidden page', () => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
            document.dispatchEvent(new Event('visibilitychange'))
        }],
        ['Escape', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))],
    ])('%s aborts once', (_name, trigger) => {
        try {
            const session = start()
            trigger()
            expect(ends).toEqual(['abort'])
            expect(session.live).toBe(false)
        } finally {
            Reflect.deleteProperty(document, 'visibilityState')
        }
    })

    test('abort() is idempotent and a later pointerup commits nothing', () => {
        const session = start()
        session.abort()
        session.abort()
        scroller.dispatchEvent(pointer('pointerup'))
        expect(ends).toEqual(['abort'])
    })

    test('a visible visibilitychange is ignored', () => {
        const session = start()
        document.dispatchEvent(new Event('visibilitychange'))
        expect(session.live).toBe(true)
        expect(ends).toEqual([])
        session.abort()
    })

    test('events of another pointer are ignored', () => {
        const session = start(1)
        scroller.dispatchEvent(pointer('pointermove', { pointerId: 2, clientY: 300 }))
        scroller.dispatchEvent(pointer('pointerup', { pointerId: 2 }))
        scroller.dispatchEvent(pointer('pointercancel', { pointerId: 2 }))
        expect(points).toEqual([])
        expect(session.live).toBe(true)
        session.abort()
    })

    test('nothing reacts once ended: pointer, Escape, blur and hidden', () => {
        start()
        scroller.dispatchEvent(pointer('pointerup'))
        const key = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        window.dispatchEvent(key)
        window.dispatchEvent(new Event('blur'))
        scroller.dispatchEvent(pointer('pointermove', { clientY: 5 }))
        scroller.dispatchEvent(pointer('pointercancel'))
        expect(ends).toEqual(['commit'])
        expect(points).toEqual([])
        expect(key.defaultPrevented).toBe(false)
    })

    test('every listener is removed before the capture is released', () => {
        start()
        // At the moment of the release the session must already be deaf: a pointer move, an Escape and the lost capture that the
        // release itself raises reach nothing.
        const during = { escapePrevented: true, pointsSeen: -1 }
        scroller.releasePointerCapture = (id: number) => {
            captures.held.delete(id)
            scroller.dispatchEvent(pointer('pointermove', { pointerId: id, clientY: 5 }))
            const key = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
            window.dispatchEvent(key)
            during.escapePrevented = key.defaultPrevented
            scroller.dispatchEvent(pointer('lostpointercapture', { pointerId: id }))
            during.pointsSeen = points.length
        }
        scroller.dispatchEvent(pointer('pointerup'))
        expect(during).toEqual({ escapePrevented: false, pointsSeen: 0 })
        expect(ends).toEqual(['commit'])
    })
})

describe('Escape', () => {
    test('is default-prevented in the capture phase and still reaches a document listener', () => {
        start()
        const seen = vi.fn()
        document.addEventListener('keydown', seen)
        const key = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        document.body.dispatchEvent(key)
        document.removeEventListener('keydown', seen)
        expect(key.defaultPrevented).toBe(true)
        expect(seen).toHaveBeenCalledTimes(1)
        expect(ends).toEqual(['abort'])
    })

    test('ends the drag even when an earlier handler already prevented it', () => {
        start()
        const preventer = (event: Event) => event.preventDefault()
        window.addEventListener('keydown', preventer, { capture: true })
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        window.removeEventListener('keydown', preventer, { capture: true })
        expect(ends).toEqual(['abort'])
    })

    test('other keys pass untouched', () => {
        const session = start()
        const key = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
        window.dispatchEvent(key)
        expect(key.defaultPrevented).toBe(false)
        expect(session.live).toBe(true)
        session.abort()
    })
})

describe('autoscroll', () => {
    test('a move reports the pointer; one frame per edge move scrolls by the delta and reports again', () => {
        const session = start()
        scroller.dispatchEvent(pointer('pointermove', { clientY: 630 }))
        expect(points).toEqual([630])
        expect(frames.size).toBe(1)
        runFrames()
        expect(scroller.scrollTop).toBeGreaterThan(0)
        expect(points).toEqual([630, 630])
        expect(frames.size).toBe(1)
        session.abort()
        expect(frames.size).toBe(0)
    })

    test('no frame is queued in the middle of the scroller, and the loop stops when the pointer leaves the edge', () => {
        const session = start()
        scroller.dispatchEvent(pointer('pointermove', { clientY: 300 }))
        expect(frames.size).toBe(0)
        scroller.dispatchEvent(pointer('pointermove', { clientY: 630 }))
        scroller.dispatchEvent(pointer('pointermove', { clientY: 300 }))
        runFrames()
        expect(scroller.scrollTop).toBe(0)
        expect(frames.size).toBe(0)
        session.abort()
    })

    test('a frame queued before the end does nothing after it', () => {
        start()
        scroller.dispatchEvent(pointer('pointermove', { clientY: 630 }))
        const queued = [...frames.values()]
        scroller.dispatchEvent(pointer('pointerup'))
        expect(frames.size).toBe(0)
        queued.forEach((callback) => callback(0))
        expect(scroller.scrollTop).toBe(0)
        expect(points).toEqual([630])
    })
})
