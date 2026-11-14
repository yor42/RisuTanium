import { describe, expect, test } from 'vitest'
import { BOTTOM_PX, TRAVEL_MS, appendedReplies, badgeText, createTravel, distanceFromEnd, isAtBottom, isFar, latestButtonVisible, travelPlan } from './jumpTarget'

describe('the at-bottom rule', () => {
    test('A1-1: the end is within 100 px of the bottom, a slid window is never at it', () => {
        expect(BOTTOM_PX).toBe(100)
        expect(isAtBottom(100, false)).toBe(true)
        expect(isAtBottom(100.5, false)).toBe(false)
        expect(isAtBottom(0, true)).toBe(false)
        expect(isAtBottom(150, false)).toBe(false)
    })
    test('A1-1: the distance is read from the scroll metrics', () => {
        expect(distanceFromEnd({ scrollHeight: 1000, clientHeight: 300, scrollTop: 550 })).toBe(150)
    })
    test('A1-2: far means more than one screen from the end, or a window that does not mount the newest message', () => {
        expect(isFar(600, 600, false)).toBe(false)
        expect(isFar(601, 600, false)).toBe(true)
        expect(isFar(0, 600, true)).toBe(true)
    })
    test('A1-2: the button shows only away from the bottom, for distance, an unread reply or a count', () => {
        const base = { atBottom: false, far: false, unread: false, count: 0 }
        expect(latestButtonVisible(base)).toBe(false)
        expect(latestButtonVisible({ ...base, far: true })).toBe(true)
        expect(latestButtonVisible({ ...base, unread: true })).toBe(true)
        expect(latestButtonVisible({ ...base, count: 2 })).toBe(true)
        expect(latestButtonVisible({ atBottom: true, far: true, unread: true, count: 5 })).toBe(false)
    })
})

describe('the count', () => {
    test('A1-3: the badge is capped at 99+', () => {
        expect(badgeText(1)).toBe('1')
        expect(badgeText(99)).toBe('99')
        expect(badgeText(100)).toBe('99+')
        expect(badgeText(150)).toBe('99+')
    })
    test('A1-4: only character replies appended past the previous length are counted', () => {
        const messages = [{ role: 'user' }, { role: 'char' }, { role: 'user' }, { role: 'char' }, { role: 'char' }]
        expect(appendedReplies(messages, 2)).toBe(2)
        expect(appendedReplies(messages, 5)).toBe(0)
        expect(appendedReplies(messages, 0)).toBe(3)
    })
})

describe('travelPlan', () => {
    test('A1-5: a travel of more than two screens is cut to two screens first, and lasts 260 ms', () => {
        expect(TRAVEL_MS).toBe(260)
        expect(travelPlan({ distance: 6000, viewport: 600, reduced: false })).toEqual({ cutTo: 1200, duration: 260 })
        expect(travelPlan({ distance: 1200, viewport: 600, reduced: false })).toEqual({ cutTo: null, duration: 260 })
        expect(travelPlan({ distance: 300, viewport: 600, reduced: false })).toEqual({ cutTo: null, duration: 260 })
    })
    test('A1-5: reduced motion is one instant cut', () => {
        expect(travelPlan({ distance: 6000, viewport: 600, reduced: true })).toEqual({ cutTo: null, duration: 0 })
    })
})

describe('createTravel', () => {
    function rig(initialTop: number, initialEnd: number) {
        const state = { top: initialTop, end: initialEnd, clock: 0, stopped: false }
        const writes: number[] = []
        const frames = new Map<number, () => void>()
        let id = 0
        const travel = createTravel({
            requestFrame: (callback: () => void) => { id += 1; frames.set(id, callback); return id },
            cancelFrame: (frame: number) => { frames.delete(frame) },
            now: () => state.clock,
            read: () => ({ top: state.top, end: state.end }),
            write: (value: number) => { writes.push(value); state.top = value },
            stop: () => state.stopped,
        })
        const advance = (ms: number) => {
            state.clock += ms
            for (const [frame, callback] of [...frames]) { frames.delete(frame); callback() }
        }
        return { state, writes, travel, advance, pending: () => frames.size }
    }
    test('A1-6: writes rise monotonically and the last write is the live end', () => {
        const { state, writes, travel, advance } = rig(0, 1000)
        const results: boolean[] = []
        travel.run(260, (completed: boolean) => results.push(completed))
        advance(0)
        advance(100)
        state.end = 1400
        advance(100)
        advance(100)
        expect(results).toEqual([true])
        for (let i = 1; i < writes.length; i++) expect(writes[i]).toBeGreaterThanOrEqual(writes[i - 1])
        expect(writes[writes.length - 1]).toBe(1400)
    })
    test('A1-6: stop() is checked before every write and ends the travel without one', () => {
        const { state, writes, travel, advance, pending } = rig(0, 1000)
        const results: boolean[] = []
        travel.run(260, (completed: boolean) => results.push(completed))
        advance(50)
        const written = writes.length
        state.stopped = true
        advance(50)
        expect(writes.length).toBe(written)
        expect(results).toEqual([false])
        expect(pending()).toBe(0)
    })
    test('A1-6: cancel drops the pending frame and never calls back', () => {
        const { writes, travel, advance, pending } = rig(0, 1000)
        const results: boolean[] = []
        travel.run(260, (completed: boolean) => results.push(completed))
        travel.cancel()
        advance(300)
        expect(pending()).toBe(0)
        expect(writes).toEqual([])
        expect(results).toEqual([])
    })
})
