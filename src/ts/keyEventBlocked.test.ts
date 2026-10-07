/**
 * Whether a key event began while the keys were blocked is decided once per event
 * and read the same way by every listener of that event, whatever the listeners
 * before it did to the alert.
 *
 * Exercises the per-event snapshot module on its own, with plain KeyboardEvents
 * and no component or alert store, so the semantics are pinned independently of
 * the listeners that use it. Each test loads a fresh copy of the module, because
 * the live reader it keeps is module state.
 *
 * Invariants pinned here:
 *  - an event that was recorded keeps the value it was recorded with, however the
 *    live state changes afterwards;
 *  - "recorded as not blocked" is different from "never recorded": only an event
 *    that was never recorded asks the live reader;
 *  - with no live reader registered, an event that was never recorded is not
 *    blocked;
 *  - one event's record never reaches another event.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

type Snapshot = typeof import('./keyEventBlocked')

function keydown(key = 'Delete'): KeyboardEvent {
    return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
}

let snapshot: Snapshot

beforeEach(async () => {
    vi.resetModules()
    snapshot = await import('./keyEventBlocked')
})

describe('keyEventBlocked', () => {
    test('an event recorded as blocked reads as blocked after the live state turns false', () => {
        let live = true
        snapshot.setLiveKeysBlockedReader(() => live)
        const ev = keydown()
        snapshot.recordKeyEventBlocked(ev, true)
        live = false

        expect(snapshot.keyEventBlocked(ev)).toBe(true)
    })

    test('an event recorded as not blocked reads as not blocked after the live state turns true', () => {
        let live = false
        snapshot.setLiveKeysBlockedReader(() => live)
        const ev = keydown()
        snapshot.recordKeyEventBlocked(ev, false)
        live = true

        expect(snapshot.keyEventBlocked(ev)).toBe(false)
    })

    test.each([true, false])('an event that was never recorded reads the live reader (%s)', (live) => {
        snapshot.setLiveKeysBlockedReader(() => live)

        expect(snapshot.keyEventBlocked(keydown())).toBe(live)
    })

    test('with no live reader registered, an event that was never recorded is not blocked', () => {
        expect(snapshot.keyEventBlocked(keydown())).toBe(false)
    })

    test('recording one event does not change another event', () => {
        const recorded = keydown()
        const other = keydown()
        snapshot.recordKeyEventBlocked(recorded, true)

        expect(snapshot.keyEventBlocked(other)).toBe(false)
    })
})

describe('keysBlockedNow', () => {
    test.each([true, false])('reads the live reader without an event (%s)', (live) => {
        snapshot.setLiveKeysBlockedReader(() => live)

        expect(snapshot.keysBlockedNow()).toBe(live)
    })

    test('with no live reader registered, keys are not blocked', () => {
        expect(snapshot.keysBlockedNow()).toBe(false)
    })
})
