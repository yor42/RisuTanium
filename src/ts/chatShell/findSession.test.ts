import { describe, expect, test, vi } from 'vitest'
import type { Message } from '../storage/database.svelte'
import {
    dayBoundsOf, matchesQuery, normalizeForSearch, passesFilters,
    type SearchFilters, type SearchHit,
} from './inChatSearch'
import type { JumpStatus } from './jumpTarget'
import { createFindSession, sameFingerprint, searchFingerprint, type FindSession } from './findSession'

// ---- harness: a fake clock, fake timers and a manual scan scheduler; nothing waits in real time

interface Deferred {
    promise: Promise<JumpStatus>
    resolve(status: JumpStatus): void
}

function deferred(): Deferred {
    let resolve: (status: JumpStatus) => void = () => {}
    const promise = new Promise<JumpStatus>((r) => { resolve = r })
    return { promise, resolve }
}

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) await Promise.resolve()
}

function msg(data: string, role: 'user' | 'char' = 'char', extra: Partial<Message> = {}): Message {
    return { role, data, ...extra }
}

interface Harness {
    session: FindSession
    messages: Message[]
    first: { text: string }
    onShow: ReturnType<typeof vi.fn<(hit: SearchHit, index: number) => Promise<JumpStatus>>>
    onChange: ReturnType<typeof vi.fn<() => void>>
    runOne(): void
    runAll(): void
    pendingScans(): number
    advance(ms: number): void
    pendingTimers(): number
}

// Chat of `count` messages; `matches` are the indexes whose text carries "alpha". Even matches are the user's, odd the character's.
function build(count: number, matches: number[], options: { firstText?: string, lowPower?: boolean } = {}): Harness {
    const messages: Message[] = []
    for (let i = 0; i < count; i++) {
        messages.push(msg(matches.includes(i) ? `alpha text ${i}` : `filler ${i}`, i % 2 === 0 ? 'user' : 'char'))
    }
    const first = { text: options.firstText ?? 'alpha first' }
    let clock = 0
    const queue: Array<() => void> = []
    const timers = new Map<number, { at: number, run: () => void }>()
    let timerId = 0
    const onShow = vi.fn<(hit: SearchHit, index: number) => Promise<JumpStatus>>(() => Promise.resolve('done'))
    const onChange = vi.fn<() => void>()
    const textAt = (index: number, _thinking: boolean) => normalizeForSearch(index >= 0 ? messages[index].data : first.text, { thinking: false })
    const passes = (index: number, filters: SearchFilters) => {
        const bounds = dayBoundsOf(filters.from, filters.to)
        if (index < 0) return filters.speaker !== 'me' && !filters.hasImage
        return passesFilters(messages[index], filters, bounds)
    }
    const session = createFindSession({
        count: () => messages.length,
        includeFirst: true,
        messageAt: (index) => messages[index],
        firstText: () => first.text,
        textAt,
        passes,
        stillMatches: (hit, query, filters) => matchesQuery(textAt(hit.index, filters.thinking), query) && passes(hit.index, filters),
        lowPower: () => options.lowPower ?? false,
        schedule: (run) => { queue.push(run) },
        now: () => clock,
        setTimer: (run, ms) => {
            timerId++
            timers.set(timerId, { at: clock + ms, run })
            return timerId
        },
        clearTimer: (handle) => { timers.delete(handle) },
        onShow,
        onChange,
    })
    return {
        session, messages, first, onShow, onChange,
        runOne() { queue.shift()?.() },
        runAll() {
            let guard = 0
            while (queue.length > 0 && guard++ < 10000) queue.shift()?.()
        },
        pendingScans: () => queue.length,
        advance(ms) {
            const target = clock + ms
            for (;;) {
                let due: [number, { at: number, run: () => void }] | null = null
                for (const entry of timers) {
                    if (entry[1].at <= target && (due === null || entry[1].at < due[1].at)) due = entry
                }
                if (due === null) break
                timers.delete(due[0])
                clock = Math.max(clock, due[1].at)
                due[1].run()
            }
            clock = target
        },
        pendingTimers: () => timers.size,
    }
}

// Messages 0, 2 and 4 carry the query, and the first message does too: hits are 4, 2, 0, -1.
function small(): Harness {
    return build(6, [0, 2, 4])
}

function shownIndexes(h: Harness): number[] {
    return h.onShow.mock.calls.map((call) => call[1])
}

describe('B2a-1 auto-show timing', () => {
    test('the first hit shows after 150 ms without typing, not before', () => {
        const h = small()
        h.session.setQuery('alpha')
        h.runAll()
        h.advance(149)
        expect(h.onShow).not.toHaveBeenCalled()
        h.advance(1)
        expect(h.onShow).toHaveBeenCalledTimes(1)
        expect(shownIndexes(h)).toEqual([4])
    })

    test('typing again restarts the wait', () => {
        const h = small()
        h.session.setQuery('alph')
        h.runAll()
        h.advance(100)
        h.session.setQuery('alpha')
        h.runAll()
        h.advance(100)
        expect(h.onShow).not.toHaveBeenCalled()
        h.advance(50)
        expect(h.onShow).toHaveBeenCalledTimes(1)
    })

    test('Enter shows the first hit at once and the timer then adds nothing', () => {
        const h = small()
        h.session.setQuery('alpha')
        h.runAll()
        h.session.step(1)
        expect(shownIndexes(h)).toEqual([4])
        h.advance(500)
        expect(h.onShow).toHaveBeenCalledTimes(1)
    })

    test('a filter change auto-shows the first hit of the new scan', async () => {
        const h = small()
        h.session.setQuery('alpha')
        h.runAll()
        h.advance(150)
        await settle()
        h.session.setFilters({ speaker: 'me' })
        h.runAll()
        expect(h.session.state.hits.map((hit) => hit.index)).toEqual([4, 2, 0])
        h.advance(149)
        expect(h.onShow).toHaveBeenCalledTimes(1)
        h.advance(1)
        expect(h.onShow).toHaveBeenCalledTimes(2)
    })

    test('clearFilters rescans with the defaults and auto-shows', async () => {
        const h = small()
        h.session.setQuery('alpha')
        h.session.setFilters({ speaker: 'char' })
        h.runAll()
        expect(h.session.state.hits.map((hit) => hit.index)).toEqual([-1])
        h.session.clearFilters()
        h.runAll()
        expect(h.session.state.filters.speaker).toBe('any')
        expect(h.session.state.hits.map((hit) => hit.index)).toEqual([4, 2, 0, -1])
        h.advance(150)
        expect(shownIndexes(h).at(-1)).toBe(4)
    })

    test('restart never auto-shows', async () => {
        const h = small()
        h.session.setQuery('alpha')
        h.runAll()
        h.session.step(1)
        await settle()
        h.session.restart()
        h.runAll()
        h.advance(1000)
        expect(h.onShow).toHaveBeenCalledTimes(1)
    })

    test('the wait counts from the last input, not from the moment the first hit arrives', () => {
        const h = small()
        h.session.setQuery('alpha')
        h.advance(100)
        h.runAll()
        h.advance(49)
        expect(h.onShow).not.toHaveBeenCalled()
        h.advance(1)
        expect(h.onShow).toHaveBeenCalledTimes(1)
    })

    test('restart with an auto-show still waiting drops it', () => {
        const h = small()
        h.session.setQuery('alpha')
        h.runAll()
        h.session.restart()
        h.runAll()
        h.advance(1000)
        expect(h.onShow).not.toHaveBeenCalled()
    })
})

describe('B2a-2 stepping and wrapping (MC-1764, G9)', () => {
    test('next walks to older hits, wraps from the last once the scan is complete, prev from 0 goes to the last', async () => {
        const h = small()
        h.session.setQuery('alpha')
        h.runAll()
        const order: number[] = []
        for (let i = 0; i < 5; i++) {
            h.session.step(1)
            await settle()
            order.push(shownIndexes(h).at(-1) ?? 99)
        }
        expect(order).toEqual([4, 2, 0, -1, 4])
        h.session.step(-1)
        await settle()
        expect(shownIndexes(h).at(-1)).toBe(-1)
        h.session.step(-1)
        await settle()
        expect(shownIndexes(h).at(-1)).toBe(0)
    })

    test('with no current hit and no anchor, next goes to the first hit and prev to the last', () => {
        const a = small()
        a.session.setQuery('alpha')
        a.runAll()
        a.session.step(1)
        expect(shownIndexes(a)).toEqual([4])
        const b = small()
        b.session.setQuery('alpha')
        b.runAll()
        b.session.step(-1)
        expect(shownIndexes(b)).toEqual([-1])
    })

    test('zero hits: step is a no-op in both directions and onShow is never called', () => {
        const h = small()
        h.session.setQuery('zzz')
        h.runAll()
        h.session.step(1)
        h.session.step(-1)
        h.advance(1000)
        expect(h.session.state.hits).toEqual([])
        expect(h.session.state.complete).toBe(true)
        expect(h.onShow).not.toHaveBeenCalled()
    })

    test('before any query is set the session holds no hits and step does nothing', () => {
        const h = small()
        h.session.step(1)
        expect(h.onShow).not.toHaveBeenCalled()
        expect(h.session.state.query).toBe('')
    })

    test('incomplete scan: next at the last hit stays put and does not wrap; once complete it advances', async () => {
        const h = build(700, [699, 650, 100])
        h.session.setQuery('alpha')
        h.runOne()
        expect(h.session.state.complete).toBe(false)
        expect(h.session.state.hits.map((hit) => hit.index)).toEqual([699, 650])
        h.session.step(1)
        await settle()
        h.session.step(1)
        await settle()
        expect(shownIndexes(h)).toEqual([699, 650])
        h.session.step(1)
        await settle()
        expect(shownIndexes(h)).toEqual([699, 650])
        h.runAll()
        expect(h.session.state.complete).toBe(true)
        h.session.step(1)
        await settle()
        expect(shownIndexes(h)).toEqual([699, 650, 100])
    })

    test('a new query discards the old hits and the position', async () => {
        const h = small()
        h.session.setQuery('alpha')
        h.runAll()
        h.session.step(1)
        await settle()
        h.session.setQuery('filler')
        expect(h.session.state.hits).toEqual([])
        expect(h.session.state.current).toBeNull()
        expect(h.session.state.anchorIndex).toBeNull()
        h.runAll()
        expect(h.session.state.hits.map((hit) => hit.index)).toEqual([5, 3, 1])
    })

    test('the query is normalised and a whitespace-only query is no search', () => {
        const h = small()
        h.session.setQuery('  ALPHA  ')
        expect(h.session.state.query).toBe('alpha')
        h.runAll()
        expect(h.session.state.hits.length).toBe(4)
        h.session.setQuery('   ')
        h.runAll()
        expect(h.session.state.query).toBe('')
        expect(h.session.state.hits).toEqual([])
        expect(h.session.state.complete).toBe(true)
    })

    test('the scan size follows the low-power flag', () => {
        const h = build(700, [699, 400], { lowPower: true })
        h.session.setQuery('alpha')
        h.runOne()
        // 250 messages per slice under low power: index 450 and above scanned, so only 699 is a hit so far.
        expect(h.session.state.hits.map((hit) => hit.index)).toEqual([699])
        expect(h.session.state.complete).toBe(false)
    })
})

describe('B2a-3 dispose', () => {
    test('a late result after dispose changes nothing, calls no onChange and arms no timer; later calls are no-ops', async () => {
        const h = small()
        const pending = deferred()
        h.onShow.mockImplementationOnce(() => pending.promise)
        h.session.setQuery('alpha')
        h.runAll()
        h.session.step(1)
        const before = h.session.state
        expect(before.unshown).toBe(true)
        h.session.dispose()
        const changes = h.onChange.mock.calls.length
        pending.resolve('done')
        await settle()
        expect(h.session.state.unshown).toBe(true)
        expect(h.onChange.mock.calls.length).toBe(changes)
        expect(h.pendingTimers()).toBe(0)
        h.session.step(1)
        void h.session.show(1)
        h.session.setQuery('beta')
        h.session.setFilters({ speaker: 'me' })
        h.session.clearFilters()
        h.session.restart()
        h.session.setComposing(false)
        expect(h.pendingScans()).toBe(0)
        expect(h.pendingTimers()).toBe(0)
        expect(h.onShow).toHaveBeenCalledTimes(1)
        expect(h.onChange.mock.calls.length).toBe(changes)
    })

    test('dispose cancels the scan and the auto-show timer', () => {
        const h = small()
        h.session.setQuery('alpha')
        h.runAll()
        expect(h.pendingTimers()).toBe(1)
        h.session.dispose()
        expect(h.pendingTimers()).toBe(0)
        h.advance(1000)
        expect(h.onShow).not.toHaveBeenCalled()
        const g = build(700, [699, 100])
        g.session.setQuery('alpha')
        g.runOne()
        g.session.dispose()
        g.runAll()
        expect(g.session.state.hits.map((hit) => hit.index)).toEqual([699])
    })
})

describe('B2a-4 show-time identity and still-match checks (G2)', () => {
    test('a replaced object at the hit index restarts the scan and never calls onShow', () => {
        const h = small()
        h.session.setQuery('alpha')
        h.runAll()
        h.messages[2] = msg('alpha replaced', 'user')
        void h.session.show(1)
        expect(h.onShow).not.toHaveBeenCalled()
        expect(h.pendingScans()).toBeGreaterThan(0)
        h.runAll()
        expect(h.session.state.hits[1].message).toBe(h.messages[2])
    })

    test('the same object that no longer matches restarts and drops the hit', () => {
        const h = small()
        h.session.setQuery('alpha')
        h.runAll()
        h.messages[4].data = 'filler now'
        void h.session.show(0)
        expect(h.onShow).not.toHaveBeenCalled()
        expect(h.pendingScans()).toBeGreaterThan(0)
        h.runAll()
        expect(h.session.state.hits.map((hit) => hit.index)).toEqual([2, 0, -1])
    })

    test('an unchanged hit shows without a restart', () => {
        const h = small()
        h.session.setQuery('alpha')
        h.runAll()
        void h.session.show(1)
        expect(shownIndexes(h)).toEqual([2])
        expect(h.pendingScans()).toBe(0)
    })

    test('first message: a text changed after the scan was created restarts; the same text shows', () => {
        const h = small()
        h.session.setQuery('alpha')
        h.runAll()
        h.first.text = 'alpha first edited'
        void h.session.show(3)
        expect(h.onShow).not.toHaveBeenCalled()
        expect(h.pendingScans()).toBeGreaterThan(0)
        h.runAll()
        void h.session.show(3)
        expect(shownIndexes(h)).toEqual([-1])
    })

    test('first message: an unchanged text shows at once', () => {
        const h = small()
        h.session.setQuery('alpha')
        h.runAll()
        void h.session.show(3)
        expect(shownIndexes(h)).toEqual([-1])
        expect(h.pendingScans()).toBe(0)
    })

    test('a dropped step leaves the session without a current hit, so the next step uses the scan result', async () => {
        const h = small()
        h.session.setQuery('alpha')
        h.runAll()
        h.messages[4].data = 'filler now'
        h.session.step(1)
        expect(h.onShow).not.toHaveBeenCalled()
        h.runAll()
        h.session.step(1)
        await settle()
        expect(shownIndexes(h)).toEqual([2])
    })

    test('show with an out-of-range position does nothing', () => {
        const h = small()
        h.session.setQuery('alpha')
        h.runAll()
        void h.session.show(9)
        void h.session.show(-1)
        expect(h.onShow).not.toHaveBeenCalled()
    })
})

describe('B2a-5 composition (G12)', () => {
    test('composing input never arms the timer; compositionend arms 150 ms', () => {
        const h = small()
        h.session.setQuery('alpha', { composing: true })
        h.runAll()
        expect(h.pendingTimers()).toBe(0)
        h.advance(1000)
        expect(h.onShow).not.toHaveBeenCalled()
        h.session.setComposing(false)
        h.advance(149)
        expect(h.onShow).not.toHaveBeenCalled()
        h.advance(1)
        expect(h.onShow).toHaveBeenCalledTimes(1)
    })

    test('a timer armed before composition does not fire during it and compositionend re-arms it', () => {
        const h = small()
        h.session.setQuery('alpha')
        h.runAll()
        h.advance(100)
        h.session.setComposing(true)
        h.advance(100)
        h.advance(1000)
        expect(h.onShow).not.toHaveBeenCalled()
        h.session.setComposing(false)
        h.advance(149)
        expect(h.onShow).not.toHaveBeenCalled()
        h.advance(1)
        expect(h.onShow).toHaveBeenCalledTimes(1)
    })

    test('compositionend before any hit exists shows the first hit once the scan reports it', () => {
        const h = small()
        h.session.setQuery('alpha', { composing: true })
        h.session.setComposing(false)
        h.advance(500)
        h.runAll()
        h.advance(150)
        expect(shownIndexes(h)).toEqual([4])
    })

    test('the scan keeps running while composing', () => {
        const h = small()
        h.session.setQuery('alpha', { composing: true })
        h.runAll()
        expect(h.session.state.hits.length).toBe(4)
    })
})

describe('B2a-6 results of a jump (G1) and stale results (E3)', () => {
    test.each<JumpStatus>(['cancelled', 'deferred'])('%s keeps the hit current and the next step re-shows it', async (status) => {
        const h = small()
        h.onShow.mockImplementationOnce(() => Promise.resolve(status))
        h.session.setQuery('alpha')
        h.runAll()
        h.session.step(1)
        await settle()
        expect(h.session.state.unshown).toBe(true)
        expect(h.session.state.current).toBe(0)
        h.session.step(1)
        await settle()
        expect(shownIndexes(h)).toEqual([4, 4])
        expect(h.session.state.unshown).toBe(false)
        h.session.step(1)
        await settle()
        expect(shownIndexes(h)).toEqual([4, 4, 2])
    })

    test.each<JumpStatus>(['blocked', 'outOfRange'])('%s ends the pending show and the next step advances', async (status) => {
        const h = small()
        h.onShow.mockImplementationOnce(() => Promise.resolve(status))
        h.session.setQuery('alpha')
        h.runAll()
        h.session.step(1)
        await settle()
        expect(h.session.state.unshown).toBe(false)
        h.session.step(1)
        await settle()
        expect(shownIndexes(h)).toEqual([4, 2])
    })

    test('done clears unshown and the next step advances', async () => {
        const h = small()
        h.session.setQuery('alpha')
        h.runAll()
        h.session.step(1)
        await settle()
        expect(h.session.state.unshown).toBe(false)
        h.session.step(1)
        await settle()
        expect(shownIndexes(h)).toEqual([4, 2])
    })

    test('a rejected onShow counts as cancelled', async () => {
        const h = small()
        h.onShow.mockImplementationOnce(() => Promise.reject(new Error('no list')))
        h.session.setQuery('alpha')
        h.runAll()
        h.session.step(1)
        await settle()
        expect(h.session.state.unshown).toBe(true)
        h.session.step(1)
        await settle()
        expect(shownIndexes(h)).toEqual([4, 4])
    })

    test('show A pending, show B done, then A cancelled: unshown stays false and current is B', async () => {
        const h = small()
        const a = deferred()
        const b = deferred()
        h.onShow.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise)
        h.session.setQuery('alpha')
        h.runAll()
        void h.session.show(0)
        void h.session.show(1)
        b.resolve('done')
        await settle()
        expect(h.session.state.unshown).toBe(false)
        a.resolve('cancelled')
        await settle()
        expect(h.session.state.unshown).toBe(false)
        expect(h.session.state.current).toBe(1)
    })

    test('a result arriving after setQuery, a filter change or clearFilters is ignored', async () => {
        const h = small()
        const pending = deferred()
        h.onShow.mockImplementationOnce(() => pending.promise)
        h.session.setQuery('alpha')
        h.runAll()
        void h.session.show(0)
        h.session.setQuery('alpha')
        h.runAll()
        const changes = h.onChange.mock.calls.length
        const before = h.session.state
        pending.resolve('cancelled')
        await settle()
        expect(h.onChange.mock.calls.length).toBe(changes)
        expect(h.session.state).toEqual(before)
    })

    test('a result from before a filter change cannot mark a restarted hit unshown', async () => {
        const h = small()
        const pending = deferred()
        h.onShow.mockImplementationOnce(() => pending.promise)
        h.session.setQuery('alpha')
        h.runAll()
        void h.session.show(0)
        h.session.setFilters({ speaker: 'any' })
        h.runAll()
        void h.session.show(0)
        await settle()
        expect(h.session.state.unshown).toBe(false)
        pending.resolve('cancelled')
        await settle()
        expect(h.session.state.unshown).toBe(false)
    })

    test('a stale done cannot clear unshown of a newer show still in flight', async () => {
        const h = small()
        const a = deferred()
        const b = deferred()
        h.onShow.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise)
        h.session.setQuery('alpha')
        h.runAll()
        void h.session.show(0)
        void h.session.show(1)
        a.resolve('done')
        await settle()
        expect(h.session.state.unshown).toBe(true)
        b.resolve('done')
        await settle()
        expect(h.session.state.unshown).toBe(false)
    })

    test('a done from before a new query cannot clear unshown of a show of the new query', async () => {
        const h = small()
        const a = deferred()
        const b = deferred()
        h.onShow.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise)
        h.session.setQuery('alpha')
        h.runAll()
        void h.session.show(0)
        h.session.setQuery('alpha')
        h.runAll()
        void h.session.show(0)
        a.resolve('done')
        await settle()
        expect(h.session.state.unshown).toBe(true)
    })

    test('onShow throwing is treated as cancelled', async () => {
        const h = small()
        h.onShow.mockImplementationOnce(() => { throw new Error('no list') })
        h.session.setQuery('alpha')
        h.runAll()
        expect(() => h.session.step(1)).not.toThrow()
        await settle()
        expect(h.session.state.unshown).toBe(true)
        expect(h.session.state.current).toBe(0)
    })

    test('restart does not discard the result of the show in flight', async () => {
        const h = small()
        const pending = deferred()
        h.onShow.mockImplementationOnce(() => pending.promise)
        h.session.setQuery('alpha')
        h.runAll()
        h.session.step(1)
        h.session.restart()
        h.runAll()
        pending.resolve('done')
        await settle()
        expect(h.session.state.unshown).toBe(false)
        expect(h.session.state.current).toBe(0)
    })
})

describe('B2a-7 a single hit (G14)', () => {
    test('next and prev show the same hit again', async () => {
        const h = small()
        h.session.setQuery('filler 1')
        h.runAll()
        expect(h.session.state.hits.map((hit) => hit.index)).toEqual([1])
        h.session.step(1)
        await settle()
        h.session.step(1)
        await settle()
        h.session.step(-1)
        await settle()
        expect(shownIndexes(h)).toEqual([1, 1, 1])
    })
})

describe('B2a-7b a single hit before the scan completes', () => {
    test('next and prev re-show it instead of staying put', async () => {
        const h = build(700, [699])
        h.session.setQuery('alpha')
        h.runOne()
        expect(h.session.state.complete).toBe(false)
        expect(h.session.state.hits.length).toBe(1)
        h.session.step(1)
        await settle()
        h.session.step(1)
        await settle()
        h.session.step(-1)
        await settle()
        expect(shownIndexes(h)).toEqual([699, 699, 699])
    })
})

describe('B2a-8 restart keeps the position by reference', () => {
    test('a lost current that was never done is no longer unshown', async () => {
        const h = small()
        h.onShow.mockImplementationOnce(() => Promise.resolve('cancelled'))
        h.session.setQuery('alpha')
        h.runAll()
        h.session.step(1)
        await settle()
        expect(h.session.state.unshown).toBe(true)
        h.messages[4].data = 'filler gone'
        h.session.restart()
        h.runAll()
        expect(h.session.state.current).toBeNull()
        expect(h.session.state.unshown).toBe(false)
    })

    test('a hit shown while a restart is still scanning wins over the restart target', async () => {
        const h = build(700, [699, 650, 100])
        h.session.setQuery('alpha')
        h.runAll()
        void h.session.show(2)
        await settle()
        expect(h.session.state.hits[2].index).toBe(100)
        h.session.restart()
        h.runOne()
        expect(h.session.state.complete).toBe(false)
        void h.session.show(0)
        await settle()
        h.runAll()
        expect(h.session.state.current).toBe(0)
        expect(h.session.state.anchorIndex).toBe(699)
    })

    test('current follows the message when earlier messages shift its index; restart never calls onShow', async () => {
        const h = small()
        h.session.setQuery('alpha')
        h.runAll()
        h.session.step(1)
        await settle()
        h.session.step(1)
        await settle()
        expect(h.session.state.current).toBe(1)
        h.messages.unshift(msg('filler head'))
        h.session.restart()
        h.runAll()
        const state = h.session.state
        expect(state.hits.map((hit) => hit.index)).toEqual([5, 3, 1, -1])
        expect(state.current).toBe(1)
        expect(state.anchorIndex).toBe(3)
        expect(h.onShow).toHaveBeenCalledTimes(2)
        h.session.step(1)
        await settle()
        expect(shownIndexes(h).at(-1)).toBe(1)
    })

    test('the first message is re-pointed by its place, not by a message reference', async () => {
        const h = small()
        h.session.setQuery('alpha')
        h.runAll()
        h.session.step(-1)
        await settle()
        expect(h.session.state.current).toBe(3)
        h.messages.unshift(msg('filler head'))
        h.session.restart()
        h.runAll()
        expect(h.session.state.current).toBe(3)
        expect(h.session.state.anchorIndex).toBe(-1)
    })

    test('a lost current: next goes below the anchor and prev above it', async () => {
        const h = small()
        h.session.setQuery('alpha')
        h.runAll()
        h.session.step(1)
        await settle()
        h.session.step(1)
        await settle()
        h.messages[2].data = 'filler gone'
        h.session.restart()
        h.runAll()
        expect(h.session.state.current).toBeNull()
        expect(h.session.state.anchorIndex).toBe(2)
        h.session.step(1)
        await settle()
        expect(shownIndexes(h).at(-1)).toBe(0)
        h.session.restart()
        h.runAll()
        h.messages[0].data = 'filler gone too'
        h.session.restart()
        h.runAll()
        expect(h.session.state.current).toBeNull()
        h.session.step(-1)
        await settle()
        expect(shownIndexes(h).at(-1)).toBe(4)
    })

    test('a lost current with nothing below the anchor: next wraps to the first hit when the scan is complete', async () => {
        const h = small()
        h.session.setQuery('alpha')
        h.runAll()
        h.session.step(-1)
        await settle()
        expect(shownIndexes(h)).toEqual([-1])
        h.first.text = 'filler first'
        h.session.restart()
        h.runAll()
        expect(h.session.state.current).toBeNull()
        expect(h.session.state.anchorIndex).toBe(-1)
        h.session.step(1)
        await settle()
        expect(shownIndexes(h).at(-1)).toBe(4)
    })

    test('a lost current with nothing below the anchor and an incomplete scan: next is a no-op until the scan completes', async () => {
        const h = build(700, [699, 650, 100])
        h.session.setQuery('alpha')
        h.runOne()
        h.session.step(1)
        await settle()
        h.session.step(1)
        await settle()
        expect(shownIndexes(h)).toEqual([699, 650])
        h.messages[650].data = 'filler gone'
        h.session.restart()
        // The cancelled scan's queued slice runs first and does nothing; the second slice is the restart's first.
        h.runOne()
        h.runOne()
        expect(h.session.state.hits.map((hit) => hit.index)).toEqual([699])
        expect(h.session.state.current).toBeNull()
        expect(h.session.state.complete).toBe(false)
        h.session.step(1)
        await settle()
        expect(shownIndexes(h)).toEqual([699, 650])
        h.runAll()
        h.session.step(1)
        await settle()
        expect(shownIndexes(h).at(-1)).toBe(100)
    })
})

describe('B2a-9 the search fingerprint', () => {
    const base = { messages: [msg('one'), msg('two')], streaming: false, firstText: 'first' }

    test('lastLength is null while streaming and the last text length otherwise', () => {
        expect(searchFingerprint({ ...base, streaming: true }).lastLength).toBeNull()
        expect(searchFingerprint(base).lastLength).toBe(3)
    })

    test('streamed chunks leave the fingerprint equal', () => {
        const messages = [msg('one'), msg('two')]
        const a = searchFingerprint({ messages, streaming: true, firstText: 'first' })
        messages[1].data = 'two and more'
        const b = searchFingerprint({ messages, streaming: true, firstText: 'first' })
        expect(sameFingerprint(a, b)).toBe(true)
    })

    test('the end of the stream changes it', () => {
        const messages = [msg('one'), msg('two')]
        const a = searchFingerprint({ messages, streaming: true, firstText: 'first' })
        messages[1].data = 'two and more'
        const b = searchFingerprint({ messages, streaming: false, firstText: 'first' })
        expect(sameFingerprint(a, b)).toBe(false)
    })

    test('array identity, length, last length and first text each change the comparison', () => {
        const a = searchFingerprint(base)
        expect(sameFingerprint(a, searchFingerprint({ ...base, messages: [...base.messages] }))).toBe(false)
        const longer = base.messages.slice()
        const b = searchFingerprint({ ...base, messages: longer })
        longer.push(msg('abc'))
        expect(sameFingerprint(b, searchFingerprint({ ...base, messages: longer }))).toBe(false)
        const edited = [msg('one'), msg('two')]
        const c = searchFingerprint({ ...base, messages: edited })
        edited[1].data = 'two!'
        expect(sameFingerprint(c, searchFingerprint({ ...base, messages: edited }))).toBe(false)
        expect(sameFingerprint(a, searchFingerprint({ ...base, firstText: 'first two' }))).toBe(false)
        expect(sameFingerprint(a, searchFingerprint(base))).toBe(true)
    })

    test('an empty chat has a stable fingerprint', () => {
        const messages: Message[] = []
        expect(sameFingerprint(searchFingerprint({ messages, streaming: false, firstText: '' }), searchFingerprint({ messages, streaming: false, firstText: '' }))).toBe(true)
    })
})
