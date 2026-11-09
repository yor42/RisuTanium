// Shared by the Studio history tests: an injected clock that only moves when the test says so,
// and a promise-only drain that never advances it.

import type { HistoryClock } from '../historyModel'

export interface FakeClock extends HistoryClock {
    // Runs every timer due within `ms`, in order, without draining promises between them.
    tick(ms: number): void
    // Same, but drains pending promise continuations after each timer so that work a timer
    // starts is finished before the next timer fires.
    advance(ms: number): Promise<void>
    set(time: number): void
    pendingTimers(): number
}

interface Timer {
    id: number
    at: number
    fn: () => void
}

export function createFakeClock(start = 0): FakeClock {
    let now = start
    let nextId = 1
    const timers = new Map<number, Timer>()

    function nextDue(limit: number): Timer | null {
        let best: Timer | null = null
        for (const timer of timers.values()) {
            if (timer.at <= limit && (best === null || timer.at < best.at || (timer.at === best.at && timer.id < best.id))) {
                best = timer
            }
        }
        return best
    }

    return {
        now: () => now,
        setTimeout(fn, ms) {
            const id = nextId++
            timers.set(id, { id, at: now + Math.max(0, ms), fn })
            return id
        },
        clearTimeout(handle) {
            if (typeof handle === 'number') {
                timers.delete(handle)
            }
        },
        tick(ms) {
            const limit = now + ms
            for (let timer = nextDue(limit); timer; timer = nextDue(limit)) {
                timers.delete(timer.id)
                now = Math.max(now, timer.at)
                timer.fn()
            }
            now = limit
        },
        async advance(ms) {
            const limit = now + ms
            for (let timer = nextDue(limit); timer; timer = nextDue(limit)) {
                timers.delete(timer.id)
                now = Math.max(now, timer.at)
                timer.fn()
                await drainMicrotasks()
            }
            now = limit
            await drainMicrotasks()
        },
        set(time) {
            now = time
        },
        pendingTimers: () => timers.size,
    }
}

// Awaits resolved promises until the queue is idle. It never touches a clock or a timer.
export async function drainMicrotasks(rounds = 100): Promise<void> {
    for (let i = 0; i < rounds; i++) {
        await Promise.resolve()
    }
}
