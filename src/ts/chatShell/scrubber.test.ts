import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bubbleParts, createScrubGesture, createScrubVisibility, fractionAtPointer, indexAtFraction, scrubberFits, tenthCrossed, thumbFraction, wheelPixels } from './scrubber'

const timers = { setTimer: (callback: () => void, ms: number) => setTimeout(callback, ms) as unknown as number, clearTimer: (handle: number) => clearTimeout(handle) }

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('U1 indexAtFraction', () => {
    it('rounds to the nearest index and clamps', () => {
        expect(indexAtFraction(0, 5800)).toBe(0)
        expect(indexAtFraction(1, 5800)).toBe(5799)
        expect(indexAtFraction(0.5, 5800)).toBe(2900)
        expect(indexAtFraction(0.0001, 5800)).toBe(1)
        expect(indexAtFraction(0.00008, 5800)).toBe(0)
        expect(indexAtFraction(-0.4, 5800)).toBe(0)
        expect(indexAtFraction(1.7, 5800)).toBe(5799)
        expect(indexAtFraction(0.8, 1)).toBe(0)
    })
})

describe('U1b degenerate tracks stay finite', () => {
    it('gives 0 when the track has no travel and for non-finite input', () => {
        const base = { y: 300, grab: 10, trackTop: 100 }
        expect(fractionAtPointer({ ...base, trackHeight: 50, thumbHeight: 56 })).toBe(0)
        expect(fractionAtPointer({ ...base, trackHeight: 56, thumbHeight: 56 })).toBe(0)
        expect(fractionAtPointer({ ...base, y: 50, trackHeight: 50, thumbHeight: 56 })).toBe(0)
        expect(fractionAtPointer({ ...base, trackHeight: Number.NaN, thumbHeight: 56 })).toBe(0)
        expect(fractionAtPointer({ ...base, y: Number.POSITIVE_INFINITY, trackHeight: 400, thumbHeight: 56 })).toBe(0)
        expect(fractionAtPointer({ ...base, trackHeight: 456, thumbHeight: 56 })).toBeCloseTo(0.475, 5)
        expect(fractionAtPointer({ ...base, y: 9999, trackHeight: 456, thumbHeight: 56 })).toBe(1)
        expect(fractionAtPointer({ ...base, y: -50, trackHeight: 456, thumbHeight: 56 })).toBe(0)
    })
    it('never maps a non-finite fraction or count to a non-integer index', () => {
        expect(indexAtFraction(Number.NaN, 5800)).toBe(0)
        expect(indexAtFraction(Number.POSITIVE_INFINITY, 5800)).toBe(0)
        expect(indexAtFraction(0.5, Number.NaN)).toBe(0)
        expect(indexAtFraction(0.5, 0)).toBe(0)
    })
    it('fits only when the travel is at least one thumb height', () => {
        expect(scrubberFits(111, 56)).toBe(false)
        expect(scrubberFits(112, 56)).toBe(true)
        expect(scrubberFits(Number.NaN, 56)).toBe(false)
        expect(scrubberFits(400, 0)).toBe(false)
    })
})

describe('U2 thumbFraction', () => {
    it('is 1 at the bottom, 0 for the first message and for short chats', () => {
        expect(thumbFraction({ topIndex: 100, count: 5800, atBottom: true })).toBe(1)
        expect(thumbFraction({ topIndex: -1, count: 5800, atBottom: false })).toBe(0)
        expect(thumbFraction({ topIndex: 3, count: 1, atBottom: false })).toBe(0)
        expect(thumbFraction({ topIndex: 2900, count: 5801, atBottom: false })).toBeCloseTo(0.5, 5)
        expect(thumbFraction({ topIndex: 9000, count: 5800, atBottom: false })).toBe(1)
    })
})

describe('U3 gesture', () => {
    function make() {
        const onHoldStart = vi.fn()
        return { gesture: createScrubGesture({ ...timers, onHoldStart }), onHoldStart }
    }
    it('a small quick press is a tap at the press point', () => {
        const { gesture, onHoldStart } = make()
        gesture.down(10, 20)
        expect(gesture.move(13, 24)).toBeNull()
        vi.advanceTimersByTime(259)
        expect(gesture.up()).toEqual({ kind: 'tap', x: 10, y: 20 })
        vi.advanceTimersByTime(1000)
        expect(onHoldStart).not.toHaveBeenCalled()
    })
    it('6 px of movement starts the drag and later moves report the pointer', () => {
        const { gesture } = make()
        gesture.down(0, 0)
        expect(gesture.move(0, 5)).toBeNull()
        expect(gesture.move(0, 6)).toEqual({ kind: 'dragStart' })
        expect(gesture.move(0, 40)).toEqual({ kind: 'drag', y: 40 })
        expect(gesture.up()).toEqual({ kind: 'release' })
    })
    it('a 260 ms hold starts the drag without movement, not at 259 ms', () => {
        const { gesture, onHoldStart } = make()
        gesture.down(0, 0)
        vi.advanceTimersByTime(259)
        expect(onHoldStart).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(onHoldStart).toHaveBeenCalledTimes(1)
        expect(gesture.phase).toBe('dragging')
        expect(gesture.up()).toEqual({ kind: 'release' })
    })
    it('an abort after the drag started never releases', () => {
        const { gesture } = make()
        gesture.down(0, 0)
        gesture.move(0, 30)
        expect(gesture.abort()).toEqual({ kind: 'aborted' })
        expect(gesture.up()).toBeNull()
        expect(gesture.abort()).toBeNull()
    })
    it('an abort stops a pending hold', () => {
        const { gesture, onHoldStart } = make()
        gesture.down(0, 0)
        gesture.abort()
        vi.advanceTimersByTime(1000)
        expect(onHoldStart).not.toHaveBeenCalled()
    })
})

describe('U4 tenthCrossed', () => {
    it('is true only when a 10 % mark lies between the two positions', () => {
        expect(tenthCrossed(0.09, 0.11)).toBe(true)
        expect(tenthCrossed(0.11, 0.19)).toBe(false)
        expect(tenthCrossed(0.95, 1)).toBe(true)
        expect(tenthCrossed(0.3, 0.3)).toBe(false)
        expect(tenthCrossed(0.55, 0.25)).toBe(true)
    })
})

describe('U5 visibility', () => {
    function make() {
        const onChange = vi.fn()
        return { visibility: createScrubVisibility({ ...timers, onChange }), onChange }
    }
    it('shows on reader intent and hides at 1500 ms, not 1499', () => {
        const { visibility, onChange } = make()
        expect(visibility.visible).toBe(false)
        visibility.readerScrolled()
        expect(visibility.visible).toBe(true)
        expect(onChange).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(1499)
        expect(visibility.visible).toBe(true)
        vi.advanceTimersByTime(1)
        expect(visibility.visible).toBe(false)
        expect(onChange).toHaveBeenCalledTimes(2)
    })
    it('a second event restarts the linger', () => {
        const { visibility } = make()
        visibility.readerScrolled()
        vi.advanceTimersByTime(1000)
        visibility.readerScrolled()
        vi.advanceTimersByTime(1499)
        expect(visibility.visible).toBe(true)
        vi.advanceTimersByTime(1)
        expect(visibility.visible).toBe(false)
    })
    it('a drag keeps it shown, and after the drag the linger runs 1500 ms, not 1499', () => {
        const { visibility } = make()
        visibility.readerScrolled()
        visibility.dragging(true)
        vi.advanceTimersByTime(5000)
        expect(visibility.visible).toBe(true)
        visibility.dragging(false)
        vi.advanceTimersByTime(1499)
        expect(visibility.visible).toBe(true)
        vi.advanceTimersByTime(1)
        expect(visibility.visible).toBe(false)
    })
    it('a blocker wins over hover, a drag and the linger', () => {
        const { visibility } = make()
        visibility.readerScrolled()
        visibility.hover(true)
        visibility.dragging(true)
        visibility.blocked(true)
        expect(visibility.visible).toBe(false)
        expect(visibility.trackInteractive).toBe(false)
        visibility.blocked(false)
        expect(visibility.visible).toBe(true)
    })
    it('the track is interactive only while hovered, and hover alone shows the scrubber', () => {
        const { visibility } = make()
        visibility.readerScrolled()
        expect(visibility.trackInteractive).toBe(false)
        visibility.hover(true)
        expect(visibility.trackInteractive).toBe(true)
        vi.advanceTimersByTime(5000)
        expect(visibility.visible).toBe(true)
        visibility.hover(false)
        expect(visibility.visible).toBe(false)
    })
    it('destroy cancels the linger timer', () => {
        const { visibility, onChange } = make()
        visibility.readerScrolled()
        visibility.destroy()
        vi.advanceTimersByTime(5000)
        expect(onChange).toHaveBeenCalledTimes(1)
    })
})

describe('U6 bubbleParts', () => {
    const format = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
    it('numbers from one with grouping and adds a date only for a numeric time', () => {
        const parts = bubbleParts(1233, 5800, Date.UTC(2026, 10, 15, 12), format)
        expect(parts).toEqual({ position: (1234).toLocaleString(), total: (5800).toLocaleString(), date: 'Nov 15, 2026' })
        expect(bubbleParts(0, 5800, undefined, format).date).toBeNull()
        expect(bubbleParts(0, 5800, Number.NaN, format).date).toBeNull()
        expect(bubbleParts(0, 5800, undefined, format).position).toBe('1')
    })
    it('formats through the injected formatter', () => {
        const spy = { format: vi.fn(() => 'D') } as unknown as Intl.DateTimeFormat
        expect(bubbleParts(4, 10, 123, spy).date).toBe('D')
        expect(spy.format).toHaveBeenCalledWith(123)
    })
})

describe('wheelPixels', () => {
    it('applies the line and page units of the reader-intent reducer', () => {
        expect(wheelPixels(-30, 0, 600)).toBe(-30)
        expect(wheelPixels(3, 1, 600)).toBe(48)
        expect(wheelPixels(-1, 2, 600)).toBe(-600)
    })
})
