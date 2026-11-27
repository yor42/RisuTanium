// @vitest-environment jsdom

/**
 * Timed warning/error plain toasts (#700): a plain toast with an explicit positive `durationMs` keeps its
 * `kind` styling and assertive announcement while auto-dismissing when its timer expires, pausing across
 * `pauseWhile`, and using timed-plain admission/eviction rather than consuming `stickyCap`.
 */
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const recordCaughtError = vi.hoisted(() => vi.fn())
vi.mock('../caughtErrors', () => ({ recordCaughtError }))

import {
    createToastHost,
    NO_TOAST,
    resetToastHostForTests,
    type ToastClock,
    type ToastHost,
} from './toastHost.svelte'

interface FakeClock extends ToastClock {
    advance(ms: number): void
}

function fakeClock(): FakeClock {
    let time = 0
    let nextKey = 1
    const timers = new Map<number, { at: number, run: () => void }>()
    return {
        now: () => time,
        after(ms, run) {
            const key = nextKey++
            timers.set(key, { at: time + ms, run })
            return () => { timers.delete(key) }
        },
        advance(ms) {
            const target = time + ms
            for (;;) {
                let next: [number, { at: number, run: () => void }] | null = null
                for (const entry of timers) {
                    if (entry[1].at <= target && (next === null || entry[1].at < next[1].at)) {
                        next = entry
                    }
                }
                if (next === null) break
                timers.delete(next[0])
                time = next[1].at
                next[1].run()
            }
            time = target
        },
    }
}

function setup(): { clock: FakeClock, host: ToastHost } {
    const clock = fakeClock()
    const host = createToastHost({ clock })
    return { clock, host }
}

beforeEach(() => {
    recordCaughtError.mockClear()
})

afterEach(() => {
    resetToastHostForTests()
})

describe('timed plain warning/error toasts', () => {
    test('regression reproducer: a warning toast with durationMs keeps kind warning and auto-dismisses when its timer expires', () => {
        const { clock, host } = setup()
        const id = host.post({ kind: 'warning', text: 'Stopped', durationMs: 5000 })

        expect(id).not.toBe(NO_TOAST)
        expect(host.visible).toHaveLength(1)
        expect(host.visible[0]).toMatchObject({ id, kind: 'warning', text: 'Stopped' })
        expect(host.assertive.text).toBe('Stopped')

        clock.advance(4999)
        expect(host.visible).toHaveLength(1)
        clock.advance(1)
        expect(host.visible).toHaveLength(0)
    })

    test('regression reproducer: a timed warning pauses across pauseWhile and finishes remaining time after resume', () => {
        const { clock, host } = setup()
        let paused = $state(false)
        const stop = $effect.root(() => {
            host.pauseWhile(() => paused)
        })
        try {
            flushSync()
            host.post({ kind: 'warning', text: 'Stopped', durationMs: 5000 })
            clock.advance(2000)
            expect(host.visible).toHaveLength(1)

            paused = true
            flushSync()
            clock.advance(60_000)
            expect(host.visible).toHaveLength(1)

            paused = false
            flushSync()
            clock.advance(2999)
            expect(host.visible).toHaveLength(1)
            clock.advance(1)
            expect(host.visible).toHaveLength(0)
        } finally {
            stop()
        }
    })

    test('regression reproducer: timed warnings do not consume stickyCap and are evicted like timed plain toasts', () => {
        const { host } = setup()
        const w1 = host.post({ kind: 'warning', text: 'w1', durationMs: 5000 })
        const w2 = host.post({ kind: 'warning', text: 'w2', durationMs: 5000 })
        const e1 = host.post({ kind: 'error', text: 'e1' })

        // Both timed warnings are non-sticky, so sticky error e1 is admitted directly (not queued).
        expect(host.visible.map((t) => t.id)).toEqual([w1, w2, e1])
        expect(host.count().queued).toBe(0)

        // A 4th toast evicts the oldest timed plain toast (w1), never queuing behind timed warnings.
        const i1 = host.post({ kind: 'info', text: 'i1' })
        expect(host.visible.map((t) => t.id)).toEqual([w2, e1, i1])
        expect(host.count().queued).toBe(0)
    })

    test('regression reproducer: invalid durationMs (0, negative, NaN, Infinity) is refused with NO_TOAST', () => {
        const { host } = setup()
        for (const bad of [0, -1, -5000, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
            const id = host.post({ kind: 'warning', text: 'bad', durationMs: bad })
            expect(id).toBe(NO_TOAST)
        }
        expect(host.visible).toHaveLength(0)
        expect(recordCaughtError).toHaveBeenCalledTimes(6)
    })

    test('guard: untimed warning and error toasts remain sticky indefinitely and enforce stickyCap', () => {
        const { clock, host } = setup()
        const w1 = host.post({ kind: 'warning', text: 'w1' })
        const e1 = host.post({ kind: 'error', text: 'e1' })
        const e2 = host.post({ kind: 'error', text: 'e2' })

        expect(host.visible.map((t) => t.id)).toEqual([w1, e1])
        expect(host.count().queued).toBe(1)
        expect(e2).not.toBe(NO_TOAST)

        clock.advance(3_600_000)
        expect(host.visible.map((t) => t.id)).toEqual([w1, e1])
        expect(host.count().queued).toBe(1)
    })
})
