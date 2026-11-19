// @vitest-environment node

/**
 * The page side of the native avatar preview: the reply parser and the
 * single-slot lane with its one 30 s timer. The transport is a stand-in
 * `invoke`; the frozen-page rule is the only part of `tauriByteTransport`
 * replaced (its byte decoder stays real). MOCKED: `@tauri-apps/api/core` is
 * never reached because every row installs its own invoke.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { frozen } = vi.hoisted(() => ({ frozen: { value: false } }))

vi.mock('../storage/tauriByteTransport', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>()
    return { ...actual, shouldBypassFrozenPagePaths: () => frozen.value }
})

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => { throw new Error('the real invoke must not be reached') }) }))

import { MAX_PREVIEW_SIDE, NATIVE_HARD_CAP_MS, __avatarPreviewNativeTestHooks, parsePreviewReply, requestNativePreview } from './avatarPreviewNative'

function reply(status: number, width: number, height: number, rgbaBytes: number): Uint8Array {
    const out = new Uint8Array(9 + rgbaBytes)
    const view = new DataView(out.buffer)
    out[0] = status
    view.setUint32(1, width, true)
    view.setUint32(5, height, true)
    for (let i = 0; i < rgbaBytes; i++) {
        out[9 + i] = i & 255
    }
    return out
}

function pixelsReply(width: number, height: number): Uint8Array {
    return reply(0, width, height, width * height * 4)
}

describe('parsePreviewReply', () => {
    test('spec: status 0 with the exact RGBA length gives the pixels, copied out of the reply', () => {
        const bytes = pixelsReply(3, 2)

        const outcome = parsePreviewReply(bytes)

        expect(outcome).toMatchObject({ kind: 'pixels', width: 3, height: 2 })
        if (outcome?.kind !== 'pixels') {
            throw new Error('not pixels')
        }
        expect(outcome.rgba.length).toBe(24)
        expect(Array.from(outcome.rgba.slice(0, 4))).toEqual([0, 1, 2, 3])
        bytes[9] = 99
        expect(outcome.rgba[0]).toBe(0)
    })

    test('spec: a reply that is a view into a larger buffer is read through its own offset', () => {
        const inner = pixelsReply(1, 1)
        const outer = new Uint8Array(inner.length + 5)
        outer.set(inner, 3)

        expect(parsePreviewReply(outer.subarray(3, 3 + inner.length))).toMatchObject({ kind: 'pixels', width: 1, height: 1 })
    })

    test.each([1, 2, 3, 4, 5])('spec: status %i with no pixels and zero sides is a refusal', (status) => {
        expect(parsePreviewReply(reply(status, 0, 0, 0))).toEqual({ kind: 'refused', status })
    })

    test('spec: every length off by one, an empty side, a side above the cap, an unknown status and a refusal with sides give null', () => {
        const ok = pixelsReply(2, 2)
        expect(parsePreviewReply(ok.subarray(0, ok.length - 1))).toBeNull()
        expect(parsePreviewReply(concatBytes(ok, [0]))).toBeNull()
        expect(parsePreviewReply(reply(0, 0, 2, 0))).toBeNull()
        expect(parsePreviewReply(reply(0, 2, 0, 0))).toBeNull()
        expect(parsePreviewReply(reply(0, MAX_PREVIEW_SIDE + 1, 1, (MAX_PREVIEW_SIDE + 1) * 4))).toBeNull()
        expect(parsePreviewReply(reply(0, 1, MAX_PREVIEW_SIDE + 1, (MAX_PREVIEW_SIDE + 1) * 4))).toBeNull()
        expect(parsePreviewReply(reply(6, 0, 0, 0))).toBeNull()
        expect(parsePreviewReply(reply(255, 0, 0, 0))).toBeNull()
        expect(parsePreviewReply(reply(2, 1, 0, 0))).toBeNull()
        expect(parsePreviewReply(reply(2, 0, 1, 0))).toBeNull()
        expect(parsePreviewReply(reply(2, 0, 0, 1))).toBeNull()
        expect(parsePreviewReply(new Uint8Array(8))).toBeNull()
        expect(parsePreviewReply(new Uint8Array(0))).toBeNull()
    })

    test('spec: the side cap itself is accepted', () => {
        expect(parsePreviewReply(pixelsReply(MAX_PREVIEW_SIDE, 1))).toMatchObject({ kind: 'pixels', width: MAX_PREVIEW_SIDE, height: 1 })
    })

    function concatBytes(bytes: Uint8Array, extra: number[]): Uint8Array {
        const out = new Uint8Array(bytes.length + extra.length)
        out.set(bytes, 0)
        out.set(extra, bytes.length)
        return out
    }
})

type Settle = { resolve: (value: unknown) => void, reject: (error: Error) => void }

interface Call {
    command: string
    args: Record<string, unknown>
    settle: Settle
}

const calls: Call[] = []

function installInvoke(): void {
    __avatarPreviewNativeTestHooks.setInvoke((command, args) => new Promise((resolve, reject) => {
        calls.push({ command, args, settle: { resolve, reject } })
    }))
}

function previewCalls(): Call[] {
    return calls.filter((call) => call.command === 'avatar_preview')
}

function cancelCalls(): Call[] {
    return calls.filter((call) => call.command === 'avatar_preview_cancel')
}

const wanted = () => true

async function turns(n = 20): Promise<void> {
    for (let i = 0; i < n; i++) {
        await Promise.resolve()
    }
}

beforeEach(() => {
    vi.useFakeTimers()
    calls.length = 0
    frozen.value = false
    __avatarPreviewNativeTestHooks.reset()
    installInvoke()
})

afterEach(() => {
    __avatarPreviewNativeTestHooks.reset()
    vi.useRealTimers()
})

describe('the lane', () => {
    test('spec: a call invokes avatar_preview with the key, the short side and a ticket, and nothing else', async () => {
        const result = requestNativePreview('assets/a.png', { shortSide: 168, stillWanted: wanted })
        await turns()

        expect(previewCalls()).toHaveLength(1)
        const args = previewCalls()[0].args
        expect(Object.keys(args).sort()).toEqual(['key', 'shortSide', 'ticket'])
        expect(args.key).toBe('assets/a.png')
        expect(args.shortSide).toBe(168)
        expect(Number.isSafeInteger(args.ticket)).toBe(true)
        expect(args.ticket as number).toBeLessThan(2 ** 52)

        previewCalls()[0].settle.resolve(pixelsReply(2, 1))
        expect(await result).toMatchObject({ kind: 'pixels', width: 2, height: 1 })
    })

    test('spec: two calls invoke one after another, never overlapping, each with its own ticket', async () => {
        const first = requestNativePreview('assets/a.png', { shortSide: 168, stillWanted: wanted })
        const second = requestNativePreview('assets/b.png', { shortSide: 168, stillWanted: wanted })
        await turns()

        expect(previewCalls().map((call) => call.args.key)).toEqual(['assets/a.png'])
        expect(__avatarPreviewNativeTestHooks.laneState()).toEqual({ busy: true, queued: 1 })

        previewCalls()[0].settle.resolve(reply(2, 0, 0, 0))
        expect(await first).toEqual({ kind: 'refused', status: 2 })
        await turns()

        expect(previewCalls().map((call) => call.args.key)).toEqual(['assets/a.png', 'assets/b.png'])
        expect(previewCalls()[1].args.ticket).not.toBe(previewCalls()[0].args.ticket)
        previewCalls()[1].settle.resolve(reply(1, 0, 0, 0))
        expect(await second).toEqual({ kind: 'refused', status: 1 })
        expect(__avatarPreviewNativeTestHooks.laneState()).toEqual({ busy: false, queued: 0 })
    })

    test('spec: an array reply of bytes goes through the bridge decoder', async () => {
        const result = requestNativePreview('assets/a.png', { shortSide: 168, stillWanted: wanted })
        await turns()

        previewCalls()[0].settle.resolve(Array.from(reply(3, 0, 0, 0)))

        expect(await result).toEqual({ kind: 'refused', status: 3 })
    })

    test.each([
        ['an error', (call: Call) => call.settle.reject(new Error('busy'))],
        ['a reply that is not bytes', (call: Call) => call.settle.resolve('not bytes')],
        ['a malformed reply', (call: Call) => call.settle.resolve(reply(0, 2, 2, 3))],
    ])('spec: %s is transient', async (_label, answer) => {
        const result = requestNativePreview('assets/a.png', { shortSide: 168, stillWanted: wanted })
        await turns()

        answer(previewCalls()[0])

        expect(await result).toEqual({ kind: 'transient' })
        expect(__avatarPreviewNativeTestHooks.laneState().busy).toBe(false)
    })

    test('spec: an invoke that throws synchronously is transient and frees the lane', async () => {
        __avatarPreviewNativeTestHooks.setInvoke(() => {
            throw new Error('no bridge')
        })

        expect(await requestNativePreview('assets/a.png', { shortSide: 168, stillWanted: wanted })).toEqual({ kind: 'transient' })
        expect(__avatarPreviewNativeTestHooks.laneState().busy).toBe(false)
    })

    test('spec: a job whose caller has left by the time it reaches the front is transient and never invokes', async () => {
        let present = true
        const first = requestNativePreview('assets/a.png', { shortSide: 168, stillWanted: wanted })
        const second = requestNativePreview('assets/b.png', { shortSide: 168, stillWanted: () => present })
        const third = requestNativePreview('assets/c.png', { shortSide: 168, stillWanted: wanted })
        await turns()
        present = false

        previewCalls()[0].settle.resolve(reply(2, 0, 0, 0))
        await first
        await turns()

        expect(await second).toEqual({ kind: 'transient' })
        expect(previewCalls().map((call) => call.args.key)).toEqual(['assets/a.png', 'assets/c.png'])
        previewCalls()[1].settle.resolve(reply(4, 0, 0, 0))
        expect(await third).toEqual({ kind: 'refused', status: 4 })
    })

    test('spec: a stillWanted that throws counts as gone', async () => {
        const result = requestNativePreview('assets/a.png', { shortSide: 168, stillWanted: () => { throw new Error('broken getter') } })

        expect(await result).toEqual({ kind: 'transient' })
        expect(calls).toHaveLength(0)
    })

    test('spec: while the page is frozen (hidden on Android) no job starts and the answer is transient', async () => {
        frozen.value = true

        expect(await requestNativePreview('assets/a.png', { shortSide: 168, stillWanted: wanted })).toEqual({ kind: 'transient' })

        expect(calls).toHaveLength(0)
        expect(__avatarPreviewNativeTestHooks.laneState().busy).toBe(false)
    })
})

describe('the one 30 s timer', () => {
    test('spec: a reply that settles at 25 s is the outcome, including a refusal the caller persists', async () => {
        const result = requestNativePreview('assets/a.png', { shortSide: 168, stillWanted: wanted })
        await turns()

        await vi.advanceTimersByTimeAsync(25_000)
        previewCalls()[0].settle.resolve(reply(5, 0, 0, 0))

        expect(await result).toEqual({ kind: 'refused', status: 5 })
        expect(cancelCalls()).toHaveLength(0)
        await vi.advanceTimersByTimeAsync(10_000)
        expect(cancelCalls()).toHaveLength(0)
    })

    test('spec: nothing settling by the cap sends cancel with the same ticket, frees the lane and gives transient; a later reply is ignored', async () => {
        const first = requestNativePreview('assets/a.png', { shortSide: 168, stillWanted: wanted })
        const second = requestNativePreview('assets/b.png', { shortSide: 168, stillWanted: wanted })
        await turns()

        await vi.advanceTimersByTimeAsync(NATIVE_HARD_CAP_MS - 1)
        expect(cancelCalls()).toHaveLength(0)
        expect(previewCalls()).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1)
        await turns()

        expect(await first).toEqual({ kind: 'transient' })
        expect(cancelCalls()).toHaveLength(1)
        expect(cancelCalls()[0].args).toEqual({ ticket: previewCalls()[0].args.ticket })
        // The next queued job invokes at once.
        expect(previewCalls().map((call) => call.args.key)).toEqual(['assets/a.png', 'assets/b.png'])

        await vi.advanceTimersByTimeAsync(1_000)
        previewCalls()[0].settle.resolve(pixelsReply(1, 1))
        await turns()
        expect(__avatarPreviewNativeTestHooks.laneState()).toEqual({ busy: true, queued: 0 })

        previewCalls()[1].settle.resolve(reply(2, 0, 0, 0))
        expect(await second).toEqual({ kind: 'refused', status: 2 })
        expect(__avatarPreviewNativeTestHooks.laneState().busy).toBe(false)
    })

    test('spec: the next job invokes immediately after a settle at 5 s, and the old timer cannot cancel it', async () => {
        const first = requestNativePreview('assets/a.png', { shortSide: 168, stillWanted: wanted })
        const second = requestNativePreview('assets/b.png', { shortSide: 168, stillWanted: wanted })
        await turns()
        await vi.advanceTimersByTimeAsync(5_000)

        previewCalls()[0].settle.resolve(reply(2, 0, 0, 0))
        await first
        await turns()
        expect(previewCalls()).toHaveLength(2)

        await vi.advanceTimersByTimeAsync(NATIVE_HARD_CAP_MS - 5_000 + 1)
        expect(cancelCalls()).toHaveLength(0)
        await vi.advanceTimersByTimeAsync(5_000)
        expect(cancelCalls()).toHaveLength(1)
        expect(cancelCalls()[0].args.ticket).toBe(previewCalls()[1].args.ticket)
        expect(await second).toEqual({ kind: 'transient' })
    })

    test('guard: a cancel whose invoke rejects does not surface', async () => {
        __avatarPreviewNativeTestHooks.setInvoke((command, args) => {
            if (command === 'avatar_preview_cancel') {
                return Promise.reject(new Error('gone'))
            }
            return new Promise(() => {})
        })
        const result = requestNativePreview('assets/a.png', { shortSide: 168, stillWanted: wanted })
        await turns()

        await vi.advanceTimersByTimeAsync(NATIVE_HARD_CAP_MS)

        expect(await result).toEqual({ kind: 'transient' })
    })
})
