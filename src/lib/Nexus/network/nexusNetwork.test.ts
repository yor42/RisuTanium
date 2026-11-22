import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createNetworkField, type NetworkField, type NetworkFieldOptions } from './nexusNetwork'

//#region fixture

interface Fixture {
    canvas: HTMLCanvasElement
    counts: { clears: number, fillsSinceClear: number, fills: number, strokes: number }
    fillStyles: unknown[]
    strokeStyles: unknown[]
    alphas: unknown[]
}

let frames = new Map<number, (time: number) => void>()
let nextFrameId = 1
let cancelSpy = vi.fn()
let requestSpy = vi.fn()
let roCallbacks: Array<() => void> = []
const fields: NetworkField[] = []

function installSchedulers(): void {
    frames = new Map()
    nextFrameId = 1
    requestSpy = vi.fn((callback: (time: number) => void) => {
        const id = nextFrameId++
        frames.set(id, callback)
        return id
    })
    cancelSpy = vi.fn((id: number) => {
        frames.delete(id)
    })
    vi.stubGlobal('requestAnimationFrame', requestSpy)
    vi.stubGlobal('cancelAnimationFrame', cancelSpy)
}

/** Runs every queued frame callback once; callbacks queued while running wait for the next call. */
function runFrame(time: number): void {
    const due = Array.from(frames.entries())
    frames.clear()
    for (const [, callback] of due) callback(time)
}

function installResizeObserver(delivering: boolean): void {
    roCallbacks = []
    class FakeResizeObserver {
        private callback: () => void
        private pending = true
        constructor(callback: () => void) {
            this.callback = callback
            roCallbacks.push(callback)
        }
        observe(): void {
            if (!delivering) return
            queueMicrotask(() => {
                if (this.pending) this.callback()
            })
        }
        disconnect(): void {
            this.pending = false
        }
        unobserve(): void {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
}

function makeCanvas(): Fixture {
    const canvas = document.createElement('canvas')
    const counts = { clears: 0, fillsSinceClear: 0, fills: 0, strokes: 0 }
    const fillStyles: unknown[] = []
    const strokeStyles: unknown[] = []
    const alphas: unknown[] = []
    let widthValue = 0
    let heightValue = 0
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 800 })
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 600 })
    Object.defineProperty(canvas, 'width', {
        configurable: true,
        get: () => widthValue,
        set: (value: number) => {
            widthValue = value
            counts.clears++
            counts.fillsSinceClear = 0
        },
    })
    Object.defineProperty(canvas, 'height', {
        configurable: true,
        get: () => heightValue,
        set: (value: number) => {
            heightValue = value
            counts.clears++
            counts.fillsSinceClear = 0
        },
    })
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 }) as DOMRect
    const noop = () => {}
    const context = {
        fill: () => {
            counts.fills++
            counts.fillsSinceClear++
        },
        stroke: () => {
            counts.strokes++
        },
        arc: noop,
        beginPath: noop,
        moveTo: noop,
        lineTo: noop,
        clearRect: noop,
        setTransform: noop,
        set fillStyle(value: unknown) {
            fillStyles.push(value)
        },
        set strokeStyle(value: unknown) {
            strokeStyles.push(value)
        },
        set globalAlpha(value: unknown) {
            alphas.push(value)
        },
        lineWidth: 1,
    }
    vi.spyOn(canvas, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    return { canvas, counts, fillStyles, strokeStyles, alphas }
}

function create(options: NetworkFieldOptions, fixture = makeCanvas()): { field: NetworkField } & Fixture {
    const field = createNetworkField(fixture.canvas, options)
    fields.push(field)
    return { field, ...fixture }
}

function press(type: string, init: { pointerType: string, pointerId?: number, clientX?: number, clientY?: number }): void {
    window.dispatchEvent(new PointerEvent(type, { button: 0, pointerId: 1, clientX: 400, clientY: 300, ...init }))
}

//#endregion

beforeEach(() => {
    installSchedulers()
    installResizeObserver(false)
})

afterEach(() => {
    for (const field of fields.splice(0)) field.destroy()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('no blank frame at creation or rebuild', () => {
    test('N1a: an animated field draws once at creation, before any frame runs', () => {
        const { counts } = create({ still: false })
        expect(counts.fillsSinceClear).toBeGreaterThan(0)
    })

    test('N1b: the resize notification after creation rebuilds the bitmap and redraws it, without a second loop', async () => {
        installResizeObserver(true)
        const fixture = makeCanvas()
        const clearsAtReturn = (() => {
            create({ still: false }, fixture)
            return fixture.counts.clears
        })()
        await Promise.resolve()
        expect(fixture.counts.clears - clearsAtReturn).toBeGreaterThanOrEqual(2)
        expect(fixture.counts.fillsSinceClear).toBeGreaterThan(0)
        expect(frames.size).toBe(1)
    })

    test('N1b (still half): a still field redraws after the notification and requests no frame', async () => {
        installResizeObserver(true)
        const fixture = makeCanvas()
        create({ still: true }, fixture)
        const clearsAtReturn = fixture.counts.clears
        await Promise.resolve()
        expect(fixture.counts.clears - clearsAtReturn).toBeGreaterThanOrEqual(2)
        expect(fixture.counts.fillsSinceClear).toBeGreaterThan(0)
        expect(requestSpy).not.toHaveBeenCalled()
    })
})

describe('scheme colour', () => {
    test('N2: a colour option colours nodes and links and carries link levels in globalAlpha', () => {
        const { fillStyles, strokeStyles, alphas } = create({ still: true, colour: 'rgb(1, 2, 3)', initialWave: { x: 0.5, y: 0.5 } })
        expect(fillStyles.length).toBeGreaterThan(0)
        expect(fillStyles.every((value) => value === 'rgb(1, 2, 3)')).toBe(true)
        expect(strokeStyles.length).toBeGreaterThan(0)
        expect(strokeStyles.every((value) => value === 'rgb(1, 2, 3)')).toBe(true)
        const linkLevels = Array.from({ length: 8 }, (_, level) => (level + 1) / 8 * 0.5)
        expect(alphas.some((value) => linkLevels.includes(value as number))).toBe(true)
    })
})

describe('listeners and loops', () => {
    test('N3: still and reduced fields request no frame and add no window listener, even after resize notifications', async () => {
        installResizeObserver(true)
        const add = vi.spyOn(window, 'addEventListener')
        for (const options of [{ still: true }, { reducedMotion: true }]) {
            create(options)
        }
        await Promise.resolve()
        for (const callback of roCallbacks) callback()
        expect(requestSpy).not.toHaveBeenCalled()
        expect(add).not.toHaveBeenCalled()
    })

    test('N4: destroy cancels the pending frame, disconnects the observer and removes every listener it added', () => {
        const windowAdd = vi.spyOn(window, 'addEventListener')
        const windowRemove = vi.spyOn(window, 'removeEventListener')
        const documentAdd = vi.spyOn(document, 'addEventListener')
        const documentRemove = vi.spyOn(document, 'removeEventListener')
        const { field } = create({ still: false })
        const queuedId = Array.from(frames.keys())[0]
        field.destroy()
        expect(cancelSpy).toHaveBeenCalledWith(queuedId)
        expect(frames.size).toBe(0)
        const added = [...windowAdd.mock.calls.map((call) => ['window', call[0], call[1]]), ...documentAdd.mock.calls.map((call) => ['document', call[0], call[1]])]
        const removed = [...windowRemove.mock.calls.map((call) => ['window', call[0], call[1]]), ...documentRemove.mock.calls.map((call) => ['document', call[0], call[1]])]
        const types = added.map((entry) => `${entry[0]}:${String(entry[1])}`)
        for (const expected of ['window:pointerdown', 'window:pointerup', 'window:pointercancel', 'window:pointermove', 'window:blur', 'document:visibilitychange', 'document:pointerout']) {
            expect(types).toContain(expected)
        }
        for (const entry of added) {
            expect(removed.some((other) => other[0] === entry[0] && other[1] === entry[1] && other[2] === entry[2])).toBe(true)
        }
    })

    test('N7: a hidden document stops the loop and a visible one starts it again', () => {
        create({ still: false })
        const hidden = vi.spyOn(document, 'hidden', 'get')
        hidden.mockReturnValue(true)
        document.dispatchEvent(new Event('visibilitychange'))
        expect(frames.size).toBe(0)
        hidden.mockReturnValue(false)
        document.dispatchEvent(new Event('visibilitychange'))
        expect(frames.size).toBe(1)
    })
})

describe('no frame loop while the canvas has no area', () => {
    function setSize(canvas: HTMLCanvasElement, width: number, height: number): void {
        Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: width })
        Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: height })
    }

    test('N9a: an animated field created at 0x0 queues no frame; a delivery with a size starts exactly one loop', () => {
        const fixture = makeCanvas()
        setSize(fixture.canvas, 0, 0)
        create({ still: false }, fixture)
        expect(requestSpy).not.toHaveBeenCalled()
        expect(frames.size).toBe(0)

        setSize(fixture.canvas, 800, 600)
        for (const callback of roCallbacks) callback()
        expect(frames.size).toBe(1)
        for (const callback of roCallbacks) callback()
        expect(frames.size).toBe(1)
        expect(requestSpy).toHaveBeenCalledTimes(1)
    })

    test('N9b: a delivery back to 0x0 stops the loop and a later size resumes it', () => {
        const fixture = makeCanvas()
        create({ still: false }, fixture)
        expect(frames.size).toBe(1)
        setSize(fixture.canvas, 0, 0)
        for (const callback of roCallbacks) callback()
        expect(frames.size).toBe(0)
        expect(cancelSpy).toHaveBeenCalled()
        setSize(fixture.canvas, 800, 600)
        for (const callback of roCallbacks) callback()
        expect(frames.size).toBe(1)
    })

    test('N9c: a hidden document stays stopped through a sized delivery and a visibility event, and destroy ends it', () => {
        const fixture = makeCanvas()
        const { field } = create({ still: false }, fixture)
        const hidden = vi.spyOn(document, 'hidden', 'get')
        hidden.mockReturnValue(true)
        document.dispatchEvent(new Event('visibilitychange'))
        expect(frames.size).toBe(0)
        for (const callback of roCallbacks) callback()
        expect(frames.size).toBe(0)
        hidden.mockReturnValue(false)
        setSize(fixture.canvas, 0, 0)
        document.dispatchEvent(new Event('visibilitychange'))
        expect(frames.size).toBe(0)
        setSize(fixture.canvas, 800, 600)
        for (const callback of roCallbacks) callback()
        expect(frames.size).toBe(1)
        field.destroy()
        expect(frames.size).toBe(0)
    })

    test('N9d: a still field at 0x0 still redraws after a delivery and never queues a frame', () => {
        const fixture = makeCanvas()
        setSize(fixture.canvas, 0, 0)
        create({ still: true }, fixture)
        setSize(fixture.canvas, 800, 600)
        for (const callback of roCallbacks) callback()
        expect(fixture.counts.fillsSinceClear).toBeGreaterThan(0)
        expect(requestSpy).not.toHaveBeenCalled()
    })
})

describe('wave phase', () => {
    test('N5: time() is the start phase plus the elapsed frame time, capped per frame', () => {
        const { field } = create({ still: false, startTime: 7 })
        expect(field.time()).toBe(7)
        runFrame(1000)
        runFrame(1100)
        expect(field.time()).toBeCloseTo(7.1, 5)
        const still = create({ still: true, startTime: 7 })
        expect(still.field.time()).toBe(7)
    })
})

describe('DD-212 press rules', () => {
    function strokesAfterFrame(fixture: Fixture, time = 1000): number {
        fixture.counts.strokes = 0
        runFrame(time)
        return fixture.counts.strokes
    }

    let clock = 0
    beforeEach(() => {
        clock = 1000
        vi.spyOn(performance, 'now').mockImplementation(() => clock)
    })

    test('N6 (1): a mouse press waves at once unless canWave refuses it', () => {
        const refused = create({ still: false, canWave: () => false })
        press('pointerdown', { pointerType: 'mouse' })
        expect(strokesAfterFrame(refused)).toBe(0)
        refused.field.destroy()
        const allowed = create({ still: false, canWave: () => true })
        press('pointerdown', { pointerType: 'mouse' })
        expect(strokesAfterFrame(allowed)).toBeGreaterThan(0)
    })

    test('N6 (2): a touch press alone raises no wave', () => {
        const fixture = create({ still: false })
        press('pointerdown', { pointerType: 'touch' })
        expect(strokesAfterFrame(fixture)).toBe(0)
    })

    test('N6 (3): a touch tap waves on its own release', () => {
        const fixture = create({ still: false })
        press('pointerdown', { pointerType: 'touch' })
        clock += 100
        press('pointerup', { pointerType: 'touch', clientX: 404 })
        expect(strokesAfterFrame(fixture)).toBeGreaterThan(0)
    })

    test('N6 (4): a release more than 10 px away raises no wave', () => {
        const fixture = create({ still: false })
        press('pointerdown', { pointerType: 'touch' })
        clock += 100
        press('pointerup', { pointerType: 'touch', clientX: 430 })
        expect(strokesAfterFrame(fixture)).toBe(0)
    })

    test('N6 (5): a release after 500 ms raises no wave', () => {
        const fixture = create({ still: false })
        press('pointerdown', { pointerType: 'touch' })
        clock += 800
        press('pointerup', { pointerType: 'touch', clientX: 404 })
        expect(strokesAfterFrame(fixture)).toBe(0)
    })

    test('N6 (6): a touch press that canWave refuses raises no wave on release', () => {
        const fixture = create({ still: false, canWave: () => false })
        press('pointerdown', { pointerType: 'touch' })
        clock += 100
        press('pointerup', { pointerType: 'touch', clientX: 404 })
        expect(strokesAfterFrame(fixture)).toBe(0)
    })

    test('N6 (7): a pen press behaves as touch', () => {
        const fixture = create({ still: false })
        press('pointerdown', { pointerType: 'pen' })
        expect(strokesAfterFrame(fixture)).toBe(0)
        press('pointerdown', { pointerType: 'pen' })
        clock += 100
        press('pointerup', { pointerType: 'pen', clientX: 404 })
        expect(strokesAfterFrame(fixture, 1100)).toBeGreaterThan(0)
    })

    test('N6 (8): a cancelled press raises no wave on a later release', () => {
        const fixture = create({ still: false })
        press('pointerdown', { pointerType: 'touch' })
        press('pointercancel', { pointerType: 'touch' })
        clock += 100
        press('pointerup', { pointerType: 'touch', clientX: 404 })
        expect(strokesAfterFrame(fixture)).toBe(0)
    })

    test('N6 (9): a release of another pointer raises no wave', () => {
        const fixture = create({ still: false })
        press('pointerdown', { pointerType: 'touch', pointerId: 1 })
        clock += 100
        press('pointerup', { pointerType: 'touch', pointerId: 2, clientX: 404 })
        expect(strokesAfterFrame(fixture)).toBe(0)
    })
})

describe('resolution change', () => {
    test('N8: a pixel-ratio change rebuilds and redraws inside the frame', () => {
        const fixture = create({ still: false })
        vi.stubGlobal('devicePixelRatio', 1)
        runFrame(1000)
        vi.stubGlobal('devicePixelRatio', 2)
        const clearsBefore = fixture.counts.clears
        runFrame(1100)
        expect(fixture.counts.clears).toBeGreaterThan(clearsBefore)
        expect(fixture.counts.fillsSinceClear).toBeGreaterThan(0)
    })
})
