import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { BOTTOM_PX, LONG_JUMP_MESSAGES, TRAVEL_MS, alignDelta, appendedReplies, badgeText, bookmarkEntries, createTravel, distanceFromEnd, hasUntimed, indexForDay, isAtBottom, isFar, isLongJump, latestButtonVisible, localDayStart, parseInset, parseMessageNumber, travelPlan } from './jumpTarget'

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

describe('the long jump rule', () => {
    test('A2-1: a jump of more than 50 messages is long, in either direction', () => {
        expect(LONG_JUMP_MESSAGES).toBe(50)
        expect(isLongJump(100, 150)).toBe(false)
        expect(isLongJump(100, 151)).toBe(true)
        expect(isLongJump(151, 100)).toBe(true)
        expect(isLongJump(150, 100)).toBe(false)
    })
})

describe('alignDelta', () => {
    test('A2-2: with no inset the target top goes to one third of the visible height', () => {
        expect(alignDelta({ targetTop: 500, hostTop: 0, clientHeight: 600, topInset: 0 })).toBe(300)
        expect(alignDelta({ targetTop: 100, hostTop: 50, clientHeight: 600, topInset: 0 })).toBe(100 - 250)
    })
    test('A2-2: an inset moves the line down and shrinks the visible area it divides', () => {
        // The line is at 60 + (600 - 60) / 3 = 240.
        expect(alignDelta({ targetTop: 500, hostTop: 0, clientHeight: 600, topInset: 60 })).toBe(260)
    })
    test('A2-2: the scroll-padding-top text reads as an inset only when it is a positive length', () => {
        expect(parseInset('60px')).toBe(60)
        expect(parseInset('')).toBe(0)
        expect(parseInset('auto')).toBe(0)
        expect(parseInset('-5px')).toBe(0)
    })
})

describe('jumping to a day', () => {
    const zone = process.env.TZ
    beforeEach(() => { process.env.TZ = 'Asia/Seoul' })
    afterEach(() => {
        if (zone === undefined) delete process.env.TZ
        else process.env.TZ = zone
    })
    // 2026-03-10 00:30 in Seoul is 2026-03-09 15:30 UTC.
    const late = Date.UTC(2026, 2, 9, 15, 30)
    const messages: { time?: number }[] = [{ time: Date.UTC(2026, 2, 8, 12) }, {}, { time: late }, { time: Date.UTC(2026, 2, 12, 3) }]

    test('A2-3: the day starts at local midnight, not UTC midnight', () => {
        expect(localDayStart('2026-03-10')).toBe(Date.UTC(2026, 2, 9, 15))
    })
    test('A2-3: a message at 00:30 local time belongs to that local day', () => {
        const start = localDayStart('2026-03-10')
        expect(start).not.toBeNull()
        expect(indexForDay(messages, start as number)).toEqual({ found: true, index: 2 })
    })
    test('A2-3: a message without a time is skipped, whatever its place', () => {
        const start = localDayStart('2026-03-08') as number
        expect(indexForDay([{}, { time: start + 5 }], start)).toEqual({ found: true, index: 1 })
    })
    test('A2-3: a day after the last timed message is not found', () => {
        expect(indexForDay(messages, localDayStart('2026-03-13') as number)).toEqual({ found: false })
        expect(indexForDay([{}, {}], 0)).toEqual({ found: false })
    })
    test('A2-3: text that is not a real day is refused', () => {
        expect(localDayStart('')).toBeNull()
        expect(localDayStart('2026-3-1')).toBeNull()
        expect(localDayStart('2026-02-30')).toBeNull()
        expect(localDayStart('2026-13-01')).toBeNull()
        expect(localDayStart('tomorrow')).toBeNull()
    })
    test('A2-3: untimed messages are reported so the sheet can say they are skipped', () => {
        expect(hasUntimed(messages)).toBe(true)
        expect(hasUntimed([{ time: 1 }, { time: 2 }])).toBe(false)
        expect(hasUntimed([])).toBe(false)
    })
})

describe('parseMessageNumber', () => {
    test('A2-4: a whole number from 1 to the count is accepted and gives the message index', () => {
        expect(parseMessageNumber('1', 800)).toBe(0)
        expect(parseMessageNumber('800', 800)).toBe(799)
        expect(parseMessageNumber(' 3 ', 800)).toBe(2)
    })
    test('A2-4: grouping commas and spaces are dropped before the digit test', () => {
        expect(parseMessageNumber('1,000', 1200)).toBe(999)
        expect(parseMessageNumber('1 000', 1200)).toBe(999)
    })
    test.each(['0', '801', '1.5', '1e2', '-1', '', '   ', 'abc', '３'])('A2-4: %j is refused', (text) => {
        expect(parseMessageNumber(text, 800)).toBeNull()
    })
})

describe('bookmarkEntries', () => {
    function chatOf(count: number, bookmarks: string[], names: { [chatId: string]: string } = {}) {
        return { message: Array.from({ length: count }, (_, i) => ({ chatId: `id${i}`, data: `message ${i}` })), bookmarks, bookmarkNames: names }
    }
    test('A2-5: a bookmark whose message is gone is dropped and the rest come in message order', () => {
        const entries = bookmarkEntries(chatOf(10, ['id7', 'gone', 'id2', 'id7']), 60)
        expect(entries.total).toBe(2)
        expect(entries.shown.map((entry) => entry.index)).toEqual([2, 7])
        expect(entries.shown.map((entry) => entry.chatId)).toEqual(['id2', 'id7'])
    })
    test('A2-5: only the first sixty are shown while the total counts every resolved bookmark', () => {
        const ids = Array.from({ length: 61 }, (_, i) => `id${i}`)
        const entries = bookmarkEntries(chatOf(70, ids), 60)
        expect(entries.total).toBe(61)
        expect(entries.shown).toHaveLength(60)
        expect(entries.shown[59].index).toBe(59)
    })
    test('A2-5: the label is the bookmark name, else a snippet of at most 70 characters', () => {
        const long = 'word '.repeat(30)
        const chat = { message: [{ chatId: 'a', data: 'short text' }, { chatId: 'b', data: long }, { chatId: 'c', data: 'unused' }], bookmarks: ['a', 'b', 'c'], bookmarkNames: { c: 'Named' } }
        const labels = bookmarkEntries(chat, 60).shown.map((entry) => entry.label)
        expect(labels[0]).toBe('short text')
        expect(labels[1].length).toBeLessThanOrEqual(70)
        expect(long.trim().startsWith(labels[1])).toBe(true)
        expect(labels[2]).toBe('Named')
    })
    test('A2-5: a chat with no bookmarks has none', () => {
        expect(bookmarkEntries({ message: [{ chatId: 'a', data: 'x' }] }, 60)).toEqual({ total: 0, shown: [] })
    })
})
