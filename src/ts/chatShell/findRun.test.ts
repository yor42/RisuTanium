// The run owns the jump in flight, the pre-search origin and the moved flag, so a close can wait for a show instead of cancelling it.
import { describe, expect, test, vi, type Mock } from 'vitest'
import { createFindRun, type FindRun } from './findRun'
import type { JumpOrigin, JumpResult, JumpStatus } from './jumpTarget'

function at(index: number): JumpOrigin { return { index, offset: 10, atBottom: false } }
function result(status: JumpStatus, to = 0): JumpResult { return { status, from: null, to } }

interface Manual {
    promise: Promise<JumpResult>
    resolve: (value: JumpResult) => void
}
function manual(): Manual {
    let resolve: (value: JumpResult) => void = () => {}
    const promise = new Promise<JumpResult>((done) => { resolve = done })
    return { promise, resolve }
}

interface Harness {
    run: FindRun
    jumpTo: Mock<(index: number) => Promise<JumpResult>>
    readOrigin: Mock<() => JumpOrigin | null>
    state: { position: JumpOrigin | null, key: string }
    pending: Manual[]
}

// Each jumpTo call takes the next manual promise, so a test decides when and how a show settles.
function harness(position: JumpOrigin | null = at(100)): Harness {
    const state = { position, key: 'chat-a' }
    const pending: Manual[] = []
    const jumpTo = vi.fn<(index: number) => Promise<JumpResult>>(() => {
        const next = manual()
        pending.push(next)
        return next.promise
    })
    const readOrigin = vi.fn<() => JumpOrigin | null>(() => state.position)
    const run = createFindRun({ readOrigin, jumpTo, chatKey: () => state.key })
    return { run, jumpTo, readOrigin, state, pending }
}

async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('createFindRun', () => {
    test('FR-1: close resolves only after the in-flight show; done far from the origin owes the chip with the pre-search origin', async () => {
        const h = harness(at(300))
        const shown = h.run.show(40)
        let closed = false
        const closing = h.run.close().then((value) => { closed = true; return value })
        await flush()
        expect(closed).toBe(false)
        h.state.position = at(40)
        h.pending[0].resolve(result('done', 40))
        await shown
        expect(await closing).toEqual({ origin: at(300), key: 'chat-a' })
    })
    test('FR-1: a move of 50 messages or fewer owes no chip; cancelled and blocked owe none', async () => {
        const near = harness(at(100))
        const nearShown = near.run.show(60)
        const nearClosing = near.run.close()
        near.state.position = at(60)
        near.pending[0].resolve(result('done', 60))
        await nearShown
        expect(await nearClosing).toBeNull()
        for (const status of ['cancelled', 'blocked'] as const) {
            const h = harness(at(300))
            const shown = h.run.show(40)
            const closing = h.run.close()
            h.state.position = at(40)
            h.pending[0].resolve(result(status, 40))
            await shown
            expect(await closing).toBeNull()
        }
    })
    test('FR-1: a close with nothing in flight and no show owes no chip and never calls jumpTo', async () => {
        const h = harness()
        expect(await h.run.close()).toBeNull()
        expect(h.jumpTo).not.toHaveBeenCalled()
    })
    test('FR-2: a show after close returns null and never calls jumpTo', async () => {
        const h = harness()
        await h.run.close()
        expect(await h.run.show(5)).toBeNull()
        expect(h.jumpTo).not.toHaveBeenCalled()
        expect(h.run.live).toBe(false)
    })
    test('FR-3: the origin is the place before the first request, not the place a superseded show left behind', async () => {
        const h = harness(at(300))
        const first = h.run.show(200)
        // The first show slid the window and was then overtaken: it answers cancelled while the reader reads from a displaced place.
        h.state.position = at(210)
        const second = h.run.show(40)
        h.pending[0].resolve(result('cancelled', 200))
        await first
        h.state.position = at(40)
        h.pending[1].resolve(result('done', 40))
        await second
        expect(await h.run.close()).toEqual({ origin: at(300), key: 'chat-a' })
    })
    test('FR-3: an origin that could not be read at the first request is read at the next show', async () => {
        const h = harness(null)
        const first = h.run.show(10)
        h.pending[0].resolve(result('blocked', 10))
        await first
        h.state.position = at(300)
        const second = h.run.show(40)
        h.state.position = at(40)
        h.pending[1].resolve(result('done', 40))
        await second
        expect(await h.run.close()).toEqual({ origin: at(300), key: 'chat-a' })
    })
    test('FR-4: a show that resolves done after close returns null to its caller, and the close still reports the chip', async () => {
        const h = harness(at(300))
        const shown = h.run.show(40)
        const closing = h.run.close()
        h.state.position = at(40)
        h.pending[0].resolve(result('done', 40))
        expect(await shown).toBeNull()
        expect(await closing).toEqual({ origin: at(300), key: 'chat-a' })
    })
    test('FR-4: a show that settled before close returns its result while live', async () => {
        const h = harness(at(300))
        const shown = h.run.show(40)
        h.pending[0].resolve(result('done', 40))
        expect(await shown).toEqual(result('done', 40))
    })
    test('FR-5: a chat that changed while the show settled owes no chip', async () => {
        const h = harness(at(300))
        const shown = h.run.show(40)
        const closing = h.run.close()
        h.state.key = 'chat-b'
        h.state.position = at(40)
        h.pending[0].resolve(result('done', 40))
        await shown
        expect(await closing).toBeNull()
    })
    test('FR-5: no readable place after the settle owes no chip', async () => {
        const h = harness(at(300))
        const shown = h.run.show(40)
        const closing = h.run.close()
        h.state.position = null
        h.pending[0].resolve(result('done', 40))
        await shown
        expect(await closing).toBeNull()
    })
    test('FR-6: a second close returns null and reads and jumps nothing more', async () => {
        const h = harness(at(300))
        const shown = h.run.show(40)
        h.state.position = at(40)
        h.pending[0].resolve(result('done', 40))
        await shown
        expect(await h.run.close()).not.toBeNull()
        const reads = h.readOrigin.mock.calls.length
        expect(await h.run.close()).toBeNull()
        expect(h.readOrigin.mock.calls.length).toBe(reads)
        expect(h.jumpTo).toHaveBeenCalledOnce()
    })
    test('close does not wait on a show that already settled, and the chip rule reads the position at the close', async () => {
        const h = harness(at(300))
        const shown = h.run.show(40)
        h.pending[0].resolve(result('done', 40))
        await shown
        // The reader scrolled back near the origin before closing: no long move remains.
        h.state.position = at(290)
        expect(await h.run.close()).toBeNull()
    })
})
