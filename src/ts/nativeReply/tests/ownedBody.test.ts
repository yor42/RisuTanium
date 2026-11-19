import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPumpProbe, resolveOwnedFetch, type OwnedFetchResult, type PumpProbe } from '../ownedBody'
import {
    configurePageState, heldReply, holdInflight, noteBound, noteInvoked, resetPageStateForTests, settleNativeReplyInflight,
} from '../pageState'
import { readReplyBody, type ReplyListing } from '../store'
import { RANGE_TRAILER_BYTES, TEXT_RANGE_MAX_BYTES, bytesToBase64 } from '../../storage/tauriByteTransport'

/**
 * T15 (guard, new rule): the owned body source. Fake pump probe, fake store, fake visibility. The record is the body
 * only when the end stamp (or one listing on a visible page) says a `done` body was stored; every other case takes the
 * live result and never waits. Mutants M26 (live body used), M27 (live failure without the record decision), M36 (list
 * while hidden), M44 (decision waits for a later trigger), M45 (settle consumes with no terminal knowledge).
 */

const KEY = '0b9c1a7e-0000-4000-8000-000000000001'
const live = (data: unknown = { from: 'live' }, ok = true): OwnedFetchResult => ({ ok, data, headers: {}, status: ok ? 200 : 400 })
const record = { choices: [{ message: { content: 'from the record' } }] }
const done = (extra: Partial<ReplyListing> = {}): ReplyListing => ({ key: KEY, state: 'terminal', parked: false, outcome: 'done', status: 200, bodyBytes: 10, ...extra })

interface Rig {
    probe: PumpProbe
    list: ReturnType<typeof vi.fn>
    readBody: ReturnType<typeof vi.fn>
    consume: ReturnType<typeof vi.fn>
    abandon: ReturnType<typeof vi.fn>
    visibleCallbacks: Array<() => void>
    visible: { value: boolean }
    controller: AbortController
    run(liveResult: Promise<OwnedFetchResult>): Promise<OwnedFetchResult>
}

function rig(options: { listing?: ReplyListing[], body?: string | Error, invoked?: boolean, visible?: boolean } = {}): Rig {
    resetPageStateForTests()
    holdInflight(KEY)
    noteBound(KEY)
    if (options.invoked !== false) {
        noteInvoked(KEY)
    }
    const consume = vi.fn(async () => ({ result: 'removed' as const, flushed: true }))
    configurePageState({
        store: { consume },
        waiter: {
            committedMarkCount: () => 0, markCount: () => 0, verdict: () => 'absent', afterNextCommit: () => {},
            markCharacter: () => {}, requestSaveNow: () => {},
        },
        onUnreadable: () => {},
    })
    const probe = createPumpProbe()
    const abandon = vi.fn()
    probe.abandon = abandon
    const list = vi.fn(async () => options.listing ?? [])
    const readBody = vi.fn(async () => {
        if (options.body instanceof Error) {
            throw options.body
        }
        return options.body ?? JSON.stringify(record)
    })
    const visibleCallbacks: Array<() => void> = []
    const visible = { value: options.visible ?? true }
    const controller = new AbortController()
    return {
        probe, list, readBody, consume, abandon, visibleCallbacks, visible, controller,
        run: (liveResult) => resolveOwnedFetch(KEY, liveResult, {
            probe,
            signal: controller.signal,
            isVisible: () => visible.value,
            onVisible: (callback) => { visibleCallbacks.push(callback); return () => { visibleCallbacks.length = 0 } },
            store: { list, readBody },
        }),
    }
}

const stampDone = (r: Rig, stored = true) => { r.probe.stamp = { key: KEY, outcome: 'done', stored } }

beforeEach(() => { resetPageStateForTests() })

describe('resolveOwnedFetch', () => {
    test('a: the record is the body when the stamp says done and stored, even if the live body differs', async () => {
        const r = rig()
        stampDone(r)
        r.probe.head = { status: 200, headers: { 'content-type': 'application/json' } }
        const result = await r.run(Promise.resolve(live({ from: 'live' })))
        expect(result).toMatchObject({ ok: true, data: record, status: 200, headers: { 'content-type': 'application/json' } })
        expect(heldReply(KEY)).toMatchObject({ bodySource: 'record', terminal: { outcome: 'done', stored: true } })
    })

    test('b: a dropped chunk that fails the live read still gives one success from the record', async () => {
        const r = rig()
        stampDone(r)
        const result = await r.run(Promise.resolve(live('SyntaxError: bad json', false)))
        expect(result.ok).toBe(true)
        expect(result.data).toEqual(record)
        // The head was lost: the status is read from the body.
        expect(result.status).toBe(200)
        expect(r.list).not.toHaveBeenCalled()
    })

    test('c: a stamp with stored false takes the live result and the page saw the end', async () => {
        const r = rig()
        stampDone(r, false)
        const result = await r.run(Promise.resolve(live()))
        expect(result.data).toEqual({ from: 'live' })
        expect(heldReply(KEY)?.bodySource).toBeUndefined()
        expect(heldReply(KEY)?.terminal).toMatchObject({ outcome: 'done', stored: false })
        expect(r.readBody).not.toHaveBeenCalled()
        await settleNativeReplyInflight(KEY)
        expect(r.consume).toHaveBeenCalledTimes(1)
    })

    test('d: a body that cannot be read takes the live result and settle drops the key without a consume', async () => {
        const r = rig({ body: new Error('io') })
        stampDone(r)
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const result = await r.run(Promise.resolve(live()))
        expect(result.data).toEqual({ from: 'live' })
        await settleNativeReplyInflight(KEY)
        expect(r.consume).not.toHaveBeenCalled()
        expect(heldReply(KEY)).toBeUndefined()
    })

    test('e: no events and a visible return that lists a stored body takes the record and abandons the live branch', async () => {
        const r = rig({ listing: [done()] })
        let finishLive: (value: OwnedFetchResult) => void = () => {}
        const pending = r.run(new Promise<OwnedFetchResult>((resolve) => { finishLive = resolve }))
        expect(r.visibleCallbacks).toHaveLength(1)
        r.visibleCallbacks[0]()
        const result = await pending
        expect(result.data).toEqual(record)
        expect(r.abandon).toHaveBeenCalledTimes(1)
        expect(heldReply(KEY)?.bodySource).toBe('record')
        // The live branch that settles later changes nothing.
        finishLive(live())
        await Promise.resolve()
        expect(heldReply(KEY)?.bodySource).toBe('record')
    })

    test('e2: a visible return that lists a running record does nothing', async () => {
        const r = rig({ listing: [{ key: KEY, state: 'live', parked: false }] })
        let finishLive: (value: OwnedFetchResult) => void = () => {}
        const pending = r.run(new Promise<OwnedFetchResult>((resolve) => { finishLive = resolve }))
        r.visibleCallbacks[0]()
        await vi.waitFor(() => expect(r.list).toHaveBeenCalledTimes(1))
        expect(r.abandon).not.toHaveBeenCalled()
        finishLive(live())
        expect((await pending).data).toEqual({ from: 'live' })
    })

    test('f: a live branch that settles on a hidden page with no stamp calls no list and takes the live result', async () => {
        const r = rig({ visible: false, listing: [done()] })
        const result = await r.run(Promise.resolve(live()))
        expect(result.data).toEqual({ from: 'live' })
        expect(r.list).not.toHaveBeenCalled()
        await settleNativeReplyInflight(KEY)
        expect(r.consume).not.toHaveBeenCalled()
    })

    test('h: a request Rust did not own takes the live result and settle drops the key without a consume', async () => {
        const r = rig({ listing: [done()] })
        r.probe.owned = false
        const { noteUnowned } = await import('../pageState')
        noteUnowned(KEY)
        const result = await r.run(Promise.resolve(live()))
        expect(result.data).toEqual({ from: 'live' })
        expect(r.list).not.toHaveBeenCalled()
        await settleNativeReplyInflight(KEY)
        expect(r.consume).not.toHaveBeenCalled()
        expect(heldReply(KEY)).toBeUndefined()
    })

    test('i: a Stop with the record still live resolves without a list call, and settle consumes it', async () => {
        const r = rig({ listing: [{ key: KEY, state: 'live', parked: false }] })
        r.controller.abort()
        const result = await r.run(Promise.resolve(live('aborted', false)))
        expect(result.ok).toBe(false)
        expect(r.list).not.toHaveBeenCalled()
        expect(heldReply(KEY)?.pageEnded).toBe(true)
        r.consume.mockRejectedValueOnce(new Error('live: reply is still being received'))
        await settleNativeReplyInflight(KEY)
        expect(heldReply(KEY)?.state).toBe('release')
        // The reconcile after the stopped event consumes it with no note.
        r.consume.mockResolvedValueOnce({ result: 'removed', flushed: true })
        const { consumeReply } = await import('../pageState')
        expect(await consumeReply(KEY)).toBe('removed')
        expect(heldReply(KEY)).toBeUndefined()
    })

    test('j: a Stop before the invoke lists nothing and settle drops the key without an invoke', async () => {
        const r = rig({ invoked: false })
        r.controller.abort()
        await r.run(Promise.resolve(live('aborted', false)))
        expect(r.list).not.toHaveBeenCalled()
        await settleNativeReplyInflight(KEY)
        expect(r.consume).not.toHaveBeenCalled()
        expect(heldReply(KEY)).toBeUndefined()
    })

    test('k: a failed command with no stamp and no listing takes the live result, and settle drops the key without a consume', async () => {
        const r = rig({ listing: [] })
        const result = await r.run(Promise.resolve(live('failed command', false)))
        expect(result.ok).toBe(false)
        expect(r.list).toHaveBeenCalledTimes(1)
        await settleNativeReplyInflight(KEY)
        expect(r.consume).not.toHaveBeenCalled()
        expect(heldReply(KEY)).toBeUndefined()
    })

    test('a stored body that is not JSON is one failure of the record: settle consumes it', async () => {
        const r = rig({ body: '<html>502</html>' })
        stampDone(r)
        r.probe.head = { status: 502, headers: {} }
        const result = await r.run(Promise.resolve(live('also not json', false)))
        expect(result.ok).toBe(false)
        expect(result.status).toBe(502)
        expect(typeof result.data).toBe('string')
        expect(heldReply(KEY)?.bodySource).toBe('record')
        await settleNativeReplyInflight(KEY)
        expect(r.consume).toHaveBeenCalledTimes(1)
    })

    test('the listing status is used when the head was lost', async () => {
        const r = rig({ listing: [done({ status: 429 })], body: JSON.stringify({ error: { message: 'limit' } }) })
        const result = await r.run(Promise.resolve(live('x', false)))
        expect(result.status).toBe(429)
        expect(result.ok).toBe(false)
    })

    test('an announced failure is final for the live result, and only then', async () => {
        const r = rig()
        r.probe.stamp = { key: KEY, outcome: 'failed', stored: false, announced: true }
        expect((await r.run(Promise.resolve(live('x', false)))).nativeFinal).toBe(true)
        const quiet = rig()
        quiet.probe.stamp = { key: KEY, outcome: 'failed', stored: false }
        expect((await quiet.run(Promise.resolve(live('x', false)))).nativeFinal).toBeUndefined()
    })
})

describe('readReplyBody', () => {
    function pieceReply(bytes: Uint8Array, total: number): string {
        const out = new Uint8Array(bytes.length + RANGE_TRAILER_BYTES)
        out.set(bytes, 0)
        new DataView(out.buffer, bytes.length, RANGE_TRAILER_BYTES).setBigUint64(0, BigInt(total), true)
        return bytesToBase64(out)
    }

    test('g: a three-byte character that straddles the piece boundary decodes once', async () => {
        const text = 'a'.repeat(TEXT_RANGE_MAX_BYTES - 1) + '€' + 'tail'
        const bytes = new TextEncoder().encode(text)
        const reads: number[] = []
        const body = await readReplyBody(async (offset, len) => {
            reads.push(offset)
            return pieceReply(bytes.subarray(offset, offset + len), bytes.length)
        }, KEY)
        expect(body).toBe(text)
        expect(reads).toEqual([0, TEXT_RANGE_MAX_BYTES])
    })

    test('an empty body is the empty text, and a reply that changes identity fails', async () => {
        expect(await readReplyBody(async () => pieceReply(new Uint8Array(0), 0), KEY)).toBe('')
        let call = 0
        await expect(readReplyBody(async (offset) => {
            call += 1
            return pieceReply(new Uint8Array(4), call === 1 ? 8 : 9)
        }, KEY)).rejects.toThrow(/changed/)
    })
})
