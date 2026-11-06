// @vitest-environment jsdom
// The hold keeps the stepped row where the reader saw it: it measures the row's top before and after the step and moves scrollTop by
// the difference. The layout is modelled with one number (the row's top) that the step and the frame change.
import { describe, expect, test, vi } from 'vitest'
import { createStepHold, firstMessageMounted, pagesForPin, windowEnd, windowPin, windowStart } from './stepHold'

describe('the pinned window helpers', () => {
    test('windowStart is the fold target when folded, else the newest row', () => {
        expect(windowStart(-1, 724)).toBe(723)
        expect(windowStart(100, 724)).toBe(100)
        expect(windowStart(0, 724)).toBe(0)
    })
    test('windowPin is -1 while the first message is mounted, else the oldest mounted row', () => {
        expect(windowPin(4, 20, 5)).toBe(-1)
        expect(windowPin(19, 20, 20)).toBe(-1)
        expect(windowPin(20, 20, 21)).toBe(0)
        expect(windowPin(723, 50, 724)).toBe(673)
        expect(windowPin(100, 50, 724)).toBe(50)
        expect(windowPin(4, Infinity, 5)).toBe(-1)
    })
    test('windowEnd and firstMessageMounted follow the pin when there is one, else the page count', () => {
        expect(windowEnd(723, 50, null)).toBe(673)
        expect(windowEnd(703, 50, 673)).toBe(673)
        expect(windowEnd(4, 20, -1)).toBe(0)
        expect(windowEnd(2, 5, null)).toBe(0)
        expect(firstMessageMounted(5, 20, null)).toBe(true)
        expect(firstMessageMounted(21, 20, null)).toBe(false)
        expect(firstMessageMounted(21, 20, -1)).toBe(true)
        expect(firstMessageMounted(5, 20, 0)).toBe(false)
    })
    // Each row is: chat length before, page count, chat length after the step, and the expected pin, page count and mounted state.
    test.each([
        { name: 'short chat, first message mounted', before: 5, pages: 20, after: 8, pin: -1, next: 20, first: true, end: 0 },
        { name: 'short chat that grows past the window', before: 5, pages: 10, after: 30, pin: -1, next: 30, first: true, end: 0 },
        { name: 'window reaches the first message exactly', before: 20, pages: 20, after: 15, pin: -1, next: 20, first: true, end: 0 },
        { name: 'row 0 mounted without the first message', before: 21, pages: 20, after: 25, pin: 0, next: 24, first: false, end: 0 },
        { name: 'a shorter chain never mounts older rows', before: 724, pages: 50, after: 704, pin: 673, next: 30, first: false, end: 673 },
        { name: 'a fold target keeps its distance', before: 724, pages: 50, after: 704, fold: 100, pin: 50, next: 50, first: false, end: 50 },
        { name: 'a fold target that vanished never gives a negative count', before: 724, pages: 50, after: 10, fold: 20, afterFold: 3, pin: 0, next: 3, first: false, end: 0 },
        { name: 'an unbounded window stays unbounded', before: 5, pages: Infinity, after: 6, pin: -1, next: Infinity, first: true, end: 0 },
    ])('$name', ({ before, pages, after, fold, afterFold, pin, next, first, end }) => {
        const foldBefore = fold ?? -1
        const foldAfter = fold === undefined ? -1 : afterFold ?? fold
        const held = windowPin(windowStart(foldBefore, before), pages, before)
        expect(held).toBe(pin)
        const startAfter = windowStart(foldAfter, after)
        const nextPages = pagesForPin(startAfter, after, pages, held)
        expect(nextPages).toBe(next)
        // Releasing the pin leaves the mounted window as it was.
        expect(firstMessageMounted(after, nextPages, null)).toBe(first)
        expect(windowEnd(startAfter, nextPages, null)).toBe(windowEnd(startAfter, pages, held))
        expect(windowEnd(startAfter, nextPages, null)).toBe(end)
    })
})

function rectAt(top: number): DOMRect {
    return { x: 0, y: top, top, left: 0, right: 0, bottom: top, width: 0, height: 0, toJSON: () => ({}) }
}

interface RigOptions {
    following?: boolean
    newest?: number
    active?: boolean
}

// A host with a recording scrollTop, a movable stepped row, a queue of animation frames and a spy follower.
function rig(options: RigOptions = {}) {
    const host = document.createElement('main')
    document.body.appendChild(host)
    let scrollTop = 0
    const writes: number[] = []
    Object.defineProperty(host, 'scrollTop', { get: () => scrollTop, set: (value: number) => { writes.push(value); scrollTop = value }, configurable: true })
    host.getBoundingClientRect = () => rectAt(0)
    // The row's on-screen top is its content offset minus scrollTop, so a correction moves it.
    const layout = { content: 100, row: document.createElement('article') as HTMLElement | null }
    layout.row!.getBoundingClientRect = () => rectAt(layout.content - scrollTop)
    const state = { pin: null as number | null, windowPin: 8, intents: 0, newest: options.newest ?? 11, following: options.following ?? false, active: options.active ?? true }
    const frames = new Map<number, () => void>()
    const cancelled: number[] = []
    let frameId = 0
    const committed: number[] = []
    const follower = {
        isFollowing: vi.fn(() => state.following),
        release: vi.fn(() => { state.following = false }),
        sync: vi.fn(),
    }
    const hold = createStepHold({
        host: () => host,
        active: () => state.active,
        follower: () => follower,
        newestIndex: () => state.newest,
        pin: () => state.pin,
        setPin: (value) => { state.pin = value },
        windowPin: () => state.windowPin,
        commitPin: (held) => { committed.push(held); state.pin = null },
        row: () => layout.row,
        intentSeq: () => state.intents,
        tick: () => Promise.resolve(),
        requestFrame: (callback) => { frameId += 1; frames.set(frameId, callback); return frameId },
        cancelFrame: (id) => { cancelled.push(id); frames.delete(id) },
    })
    function runFrames(): void {
        for (const [id, callback] of [...frames]) { frames.delete(id); callback() }
    }
    function anchor(): string { return host.style.getPropertyValue('overflow-anchor') }
    return { host, hold, layout, state, writes, frames, cancelled, committed, follower, runFrames, anchor }
}

function deferred() {
    let finish: () => void = () => {}
    let fail: (error: Error) => void = () => {}
    const promise = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject })
    return { promise, finish, fail }
}

describe('a step while the reader is not following the newest message', () => {
    test('the stepped row keeps its on-screen place: scrollTop follows the shift of its top', async () => {
        const r = rig()
        await r.hold.run(9, () => { r.layout.content = 160 })
        expect(r.writes).toEqual([60])
        expect(r.host.scrollTop).toBe(60)
    })
    test('a shift of half a pixel or less is left alone', async () => {
        const r = rig()
        await r.hold.run(9, () => { r.layout.content = 100.4 })
        expect(r.writes).toEqual([])
    })
    test('the frame pass corrects what settled after the first correction', async () => {
        const r = rig()
        await r.hold.run(9, () => { r.layout.content = 160 })
        r.layout.content = 175
        r.runFrames()
        expect(r.writes).toEqual([60, 75])
    })
    test('the frame pass yields to a reader intent that arrived after the hold started', async () => {
        const r = rig()
        await r.hold.run(9, () => { r.layout.content = 160 })
        r.state.intents += 1
        r.layout.content = 175
        r.runFrames()
        expect(r.writes).toEqual([60])
    })
    test('a row that is remounted by the step is measured again after it, never from the replaced element', async () => {
        const r = rig()
        const replaced = document.createElement('article')
        replaced.getBoundingClientRect = () => rectAt(130 - r.host.scrollTop)
        await r.hold.run(9, () => { r.layout.row = replaced })
        expect(r.writes).toEqual([30])
    })
    test('a row that is gone after the step is not corrected', async () => {
        const r = rig()
        await r.hold.run(9, () => { r.layout.row = null })
        expect(r.writes).toEqual([])
        r.runFrames()
        expect(r.writes).toEqual([])
    })
    test('the pin is taken from state before the step and committed once after it', async () => {
        const r = rig()
        const during = deferred()
        const running = r.hold.run(9, () => during.promise)
        expect(r.state.pin).toBe(8)
        during.finish()
        await running
        expect(r.committed).toEqual([8])
        expect(r.state.pin).toBeNull()
    })
    test('a pin that is already set is kept, not taken again', async () => {
        const r = rig()
        r.state.pin = 5
        await r.hold.run(9, () => {})
        expect(r.committed).toEqual([5])
    })
    test('the follower is told to look at the position again after the frame pass', async () => {
        const r = rig()
        await r.hold.run(9, () => {})
        expect(r.follower.sync).not.toHaveBeenCalled()
        r.runFrames()
        expect(r.follower.sync).toHaveBeenCalledTimes(1)
    })
})

describe('a step while the reader is following the newest message', () => {
    test('a step on the newest row holds nothing: no pin, no scroll write, and the follower is not released', async () => {
        const r = rig({ following: true })
        r.layout.content = 100
        await r.hold.run(11, () => { r.layout.content = 200 })
        r.runFrames()
        expect(r.writes).toEqual([])
        expect(r.state.pin).toBeNull()
        expect(r.committed).toEqual([])
        expect(r.follower.release).not.toHaveBeenCalled()
    })
    test('a step on an older row releases the follower and then holds that row', async () => {
        const r = rig({ following: true })
        await r.hold.run(9, () => { r.layout.content = 150 })
        expect(r.follower.release).toHaveBeenCalledTimes(1)
        expect(r.writes).toEqual([50])
    })
    test('the first message counts as an older row', async () => {
        const r = rig({ following: true })
        await r.hold.run(-1, () => { r.layout.content = 120 })
        expect(r.follower.release).toHaveBeenCalledTimes(1)
        expect(r.writes).toEqual([20])
    })
    test('the pin of an earlier hold is committed even when this hold follows', async () => {
        const r = rig()
        const first = deferred()
        const earlier = r.hold.run(9, () => first.promise)
        expect(r.state.pin).toBe(8)
        r.state.following = true
        await r.hold.run(11, () => {})
        expect(r.committed).toEqual([8])
        expect(r.state.pin).toBeNull()
        expect(r.anchor()).toBe('none')
        r.runFrames()
        expect(r.anchor()).toBe('')
        expect(r.writes).toEqual([])
        first.finish()
        await earlier
        expect(r.committed).toEqual([8])
    })
})

describe('a hidden surface or a missing host', () => {
    test('the step runs and nothing is held, pinned or suppressed', async () => {
        const r = rig({ active: false })
        const step = vi.fn()
        await r.hold.run(9, step)
        expect(step).toHaveBeenCalledTimes(1)
        expect(r.state.pin).toBeNull()
        expect(r.anchor()).toBe('')
        expect(r.frames.size).toBe(0)
        expect(r.hold.isInFlight()).toBe(false)
    })
})

describe('the transcript anchoring is suppressed from the start of a hold until its frame pass', () => {
    test('none while the step is pending, after the tick, and until the frame pass; empty after it', async () => {
        const r = rig()
        const pending = deferred()
        const running = r.hold.run(9, () => pending.promise)
        expect(r.anchor()).toBe('none')
        expect(r.hold.isInFlight()).toBe(true)
        pending.finish()
        await running
        expect(r.anchor()).toBe('none')
        expect(r.hold.isInFlight()).toBe(true)
        r.runFrames()
        expect(r.anchor()).toBe('')
        expect(r.host.getAttribute('style') ?? '').toBe('')
        expect(r.hold.isInFlight()).toBe(false)
    })
    test('a rejected step removes the suppression, commits the pin and clears the hold, and the error reaches the caller', async () => {
        const r = rig()
        const pending = deferred()
        const running = r.hold.run(9, () => pending.promise)
        const outcome = running.then(() => 'resolved', (error: Error) => error.message)
        pending.fail(new Error('step failed'))
        expect(await outcome).toBe('step failed')
        expect(r.anchor()).toBe('')
        expect(r.hold.isInFlight()).toBe(false)
        expect(r.committed).toEqual([8])
        expect(r.state.pin).toBeNull()
        expect(r.frames.size).toBe(0)
    })
    test('a step that throws at once is cleaned up the same way', async () => {
        const r = rig()
        await expect(r.hold.run(9, () => { throw new Error('sync failure') })).rejects.toThrow('sync failure')
        expect(r.anchor()).toBe('')
        expect(r.hold.isInFlight()).toBe(false)
        expect(r.committed).toEqual([8])
    })
    test('a successful hold does not clean up in the way a failed one does: the frame pass is still pending', async () => {
        const r = rig()
        await r.hold.run(9, () => {})
        expect(r.frames.size).toBe(1)
        expect(r.cancelled).toEqual([])
    })
})

describe('a second step while the first is still settling', () => {
    test('the second hold cancels the first one\'s frame pass and exactly one frame pass runs, against the second step\'s own start', async () => {
        const r = rig()
        await r.hold.run(9, () => { r.layout.content = 160 })
        expect(r.writes).toEqual([60])
        expect(r.frames.size).toBe(1)
        const firstFrame = [...r.frames.keys()][0]
        // The reader scrolls a little before the second tap, so hold 2 must measure its own start, not hold 1's.
        r.host.scrollTop = 80
        await r.hold.run(9, () => { r.layout.content = 190 })
        expect(r.cancelled).toEqual([firstFrame])
        expect(r.writes).toEqual([60, 80, 110])
        expect(r.anchor()).toBe('none')
        expect(r.frames.size).toBe(1)
        r.runFrames()
        expect(r.anchor()).toBe('')
        expect(r.follower.sync).toHaveBeenCalledTimes(1)
    })
    test('while the first step is pending the superseded hold writes and commits nothing and the second commits once', async () => {
        const r = rig()
        const first = deferred()
        const second = deferred()
        const earlier = r.hold.run(9, () => first.promise)
        const later = r.hold.run(9, () => second.promise)
        expect(r.state.pin).toBe(8)
        first.finish()
        await earlier
        expect(r.committed).toEqual([])
        expect(r.writes).toEqual([])
        expect(r.anchor()).toBe('none')
        expect(r.hold.isInFlight()).toBe(true)
        r.layout.content = 140
        second.finish()
        await later
        expect(r.committed).toEqual([8])
        expect(r.writes).toEqual([40])
        expect(r.frames.size).toBe(1)
    })
    test('a superseded step that rejects touches no state', async () => {
        const r = rig()
        const first = deferred()
        const second = deferred()
        const earlier = r.hold.run(9, () => first.promise)
        const outcome = earlier.then(() => 'resolved', (error: Error) => error.message)
        const later = r.hold.run(9, () => second.promise)
        first.fail(new Error('old step failed'))
        expect(await outcome).toBe('old step failed')
        expect(r.anchor()).toBe('none')
        expect(r.hold.isInFlight()).toBe(true)
        expect(r.state.pin).toBe(8)
        second.finish()
        await later
        expect(r.committed).toEqual([8])
    })
})

describe('cancel', () => {
    test('drops the suppression, the pending frame, the pin and the in-flight state at once, and a later resolution writes nothing', async () => {
        const r = rig()
        const pending = deferred()
        const running = r.hold.run(9, () => pending.promise)
        r.hold.cancel()
        expect(r.anchor()).toBe('')
        expect(r.hold.isInFlight()).toBe(false)
        expect(r.state.pin).toBeNull()
        r.layout.content = 300
        pending.finish()
        await running
        expect(r.writes).toEqual([])
        expect(r.committed).toEqual([])
        expect(r.frames.size).toBe(0)
        expect(r.anchor()).toBe('')
    })
    test('cancels the frame pass of a hold that already finished', async () => {
        const r = rig()
        await r.hold.run(9, () => {})
        const [pendingId] = [...r.frames.keys()]
        r.hold.cancel()
        expect(r.cancelled).toEqual([pendingId])
        expect(r.anchor()).toBe('')
        expect(r.hold.isInFlight()).toBe(false)
        r.runFrames()
        expect(r.follower.sync).not.toHaveBeenCalled()
    })
    test('with nothing pending it cancels no frame', () => {
        const r = rig()
        r.hold.cancel()
        expect(r.cancelled).toEqual([])
    })
})
