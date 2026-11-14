import { describe, expect, test, vi } from 'vitest'
import type { JumpOrigin } from './jumpTarget'
import { CHIP_MS, READER_MOVE_PX, createReturnChip } from './returnChip'

const ORIGIN: JumpOrigin = { index: 12, offset: 40, atBottom: false }
const OTHER: JumpOrigin = { index: 80, offset: 0, atBottom: true }

// Timers are driven by the test: a timer fires only when `advance` passes its due time.
function rig() {
    let now = 0
    let nextId = 0
    const timers = new Map<number, { due: number, callback: () => void }>()
    const changes = vi.fn<() => void>()
    const chip = createReturnChip({
        setTimer: (callback, ms) => { nextId += 1; timers.set(nextId, { due: now + ms, callback }); return nextId },
        clearTimer: (id) => { timers.delete(id) },
        onChange: changes,
    })
    function advance(ms: number): void {
        now += ms
        for (const [id, timer] of [...timers]) {
            if (timer.due > now) continue
            timers.delete(id)
            timer.callback()
        }
    }
    return { chip, advance, timers, changes }
}

describe('the return chip', () => {
    test('A2-6: the chip shows the origin of its chat and leaves after 15 seconds', () => {
        const { chip, advance } = rig()
        expect(CHIP_MS).toBe(15000)
        chip.show(ORIGIN, 'room')
        expect(chip.state).toEqual({ origin: ORIGIN, chatKey: 'room' })
        advance(CHIP_MS - 1)
        expect(chip.state.origin).toBe(ORIGIN)
        advance(1)
        expect(chip.state).toEqual({ origin: null, chatKey: null })
    })
    test('A2-6: hover or focus keeps the chip, and the last release starts the 15 seconds again', () => {
        const { chip, advance } = rig()
        chip.show(ORIGIN, 'room')
        advance(10000)
        chip.hold('hover', true)
        chip.hold('focus', true)
        advance(60000)
        expect(chip.state.origin).toBe(ORIGIN)
        chip.hold('hover', false)
        advance(60000)
        expect(chip.state.origin).toBe(ORIGIN)
        chip.hold('focus', false)
        advance(CHIP_MS - 1)
        expect(chip.state.origin).toBe(ORIGIN)
        advance(1)
        expect(chip.state.origin).toBeNull()
    })
    test('A2-6: the reader scrolling 80 px in total hides the chip, a jump never feeds it', () => {
        const { chip } = rig()
        expect(READER_MOVE_PX).toBe(80)
        chip.show(ORIGIN, 'room')
        chip.readerMoved(40)
        chip.readerMoved(-39)
        expect(chip.state.origin).toBe(ORIGIN)
        chip.readerMoved(1)
        expect(chip.state.origin).toBeNull()
    })
    test('A2-6: a reader move before the chip shows does not count towards it', () => {
        const { chip } = rig()
        chip.readerMoved(500)
        chip.show(ORIGIN, 'room')
        chip.readerMoved(79)
        expect(chip.state.origin).toBe(ORIGIN)
    })
    test('A2-6: take returns the origin once and hides the chip', () => {
        const { chip, timers } = rig()
        chip.show(ORIGIN, 'room')
        expect(chip.take()).toBe(ORIGIN)
        expect(chip.take()).toBeNull()
        expect(chip.state.origin).toBeNull()
        expect(timers.size).toBe(0)
    })
    test('A2-6: a second show replaces the origin, resets the move count and restarts the timer', () => {
        const { chip, advance } = rig()
        chip.show(ORIGIN, 'room')
        chip.readerMoved(70)
        advance(14000)
        chip.show(OTHER, 'room')
        expect(chip.state.origin).toBe(OTHER)
        chip.readerMoved(70)
        advance(14000)
        expect(chip.state.origin).toBe(OTHER)
        advance(1000)
        expect(chip.state.origin).toBeNull()
    })
    test('A2-6: hide clears the chip and its timer, and tells the view once per change', () => {
        const { chip, timers, changes } = rig()
        chip.show(ORIGIN, 'room')
        expect(changes).toHaveBeenCalledTimes(1)
        chip.hide()
        chip.hide()
        expect(chip.state.chatKey).toBeNull()
        expect(timers.size).toBe(0)
        expect(changes).toHaveBeenCalledTimes(2)
    })
    test('A2-6: a hold on a hidden chip does nothing and never starts a timer', () => {
        const { chip, timers } = rig()
        chip.hold('hover', true)
        chip.hold('hover', false)
        expect(timers.size).toBe(0)
    })
})
