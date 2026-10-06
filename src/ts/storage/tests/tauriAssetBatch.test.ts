// @vitest-environment happy-dom

/**
 * The page's side of the desktop asset commands: availability, the frames sent,
 * the responses read, and the refusal of a body that does not arrive raw. The
 * native commands are not run here: `invoke` is a stand-in that records what it
 * was given and answers with what a test sets.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
    isTauri: true,
    os: 'windows' as string | 'throw',
    invoke: vi.fn<(command: string, args?: unknown, options?: unknown) => Promise<unknown>>(),
}))

vi.mock('@tauri-apps/api/core', () => ({
    invoke: (command: string, args?: unknown, options?: unknown) => h.invoke(command, args, options),
}))

vi.mock('@tauri-apps/plugin-os', () => ({
    type: () => {
        if (h.os === 'throw') {
            throw new Error('no os plugin')
        }
        return h.os
    },
}))

vi.mock(import('../../platform'), () => ({
    get isTauri() { return h.isTauri },
}) as unknown as typeof import('../../platform'))

import {
    AssetBatchNotRawError,
    encodePutFrames,
    isAssetBatchAvailable,
    isAssetBatchNotRawError,
    listAssetsSized,
    parsePutResults,
    parseReadFrames,
    readAssetBatch,
    resetAssetBatchAvailabilityForTests,
    writeAssetBatch,
} from '../tauriAssetBatch'

const encoder = new TextEncoder()

function u32le(n: number): number[] {
    return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]
}

function frame(status: number, body: Uint8Array): number[] {
    return [status, ...u32le(body.length), ...body]
}

function buffer(bytes: number[]): ArrayBuffer {
    return new Uint8Array(bytes).buffer
}

beforeEach(() => {
    h.isTauri = true
    h.os = 'windows'
    h.invoke.mockReset()
    resetAssetBatchAvailabilityForTests()
})

describe('availability of the batch commands', () => {
    test.each(['windows', 'linux', 'macos'])('is on for %s inside the desktop app', (os) => {
        h.os = os

        expect(isAssetBatchAvailable()).toBe(true)
    })

    test.each(['android', 'ios'])('is off for %s', (os) => {
        h.os = os

        expect(isAssetBatchAvailable()).toBe(false)
    })

    test('is off when the operating system cannot be read', () => {
        h.os = 'throw'

        expect(isAssetBatchAvailable()).toBe(false)
    })

    test('is off outside the desktop app', () => {
        h.isTauri = false

        expect(isAssetBatchAvailable()).toBe(false)
    })

    test('is off for the rest of the page once a command refuses a body that is not raw', async () => {
        h.invoke.mockRejectedValueOnce('not-raw: the body arrived as text')

        await expect(writeAssetBatch([{ key: 'assets/a.png', data: new Uint8Array([1]) }])).rejects.toBeInstanceOf(AssetBatchNotRawError)

        expect(isAssetBatchAvailable()).toBe(false)
    })
})

describe('the frames of a batch write', () => {
    test('are keyLength, key, dataLength, data, little endian, one after another with nothing around them', () => {
        const body = encodePutFrames([
            { key: 'assets/a', data: new Uint8Array([9, 8, 7]) },
            { key: 'assets/é', data: new Uint8Array([]) },
        ])

        expect(Array.from(body)).toEqual([
            ...u32le(8), ...encoder.encode('assets/a'), ...u32le(3), 9, 8, 7,
            ...u32le(9), ...encoder.encode('assets/é'), ...u32le(0),
        ])
    })

    test('go to put_assets_batch as the raw body', async () => {
        h.invoke.mockResolvedValueOnce([{ k: 'ok' }])
        const entries = [{ key: 'assets/a.png', data: new Uint8Array([1, 2]) }]

        const results = await writeAssetBatch(entries)

        expect(results).toEqual([{ k: 'ok' }])
        expect(h.invoke.mock.calls[0][0]).toBe('put_assets_batch')
        expect(Array.from(h.invoke.mock.calls[0][1] as Uint8Array)).toEqual(Array.from(encodePutFrames(entries)))
    })

    test('entries that together exceed the cap are refused before any call, and entries at the cap are sent', async () => {
        const entries = [{ key: 'assets/a', data: new Uint8Array(3) }, { key: 'assets/b', data: new Uint8Array(3) }]

        expect(() => encodePutFrames(entries, 5)).toThrow(RangeError)
        await expect(writeAssetBatch(entries, 5)).rejects.toBeInstanceOf(RangeError)
        expect(h.invoke).not.toHaveBeenCalled()

        h.invoke.mockResolvedValueOnce([{ k: 'ok' }, { k: 'ok' }])
        await expect(writeAssetBatch(entries, 6)).resolves.toHaveLength(2)
        expect(h.invoke).toHaveBeenCalledTimes(1)
    })
})

describe('the answer to a batch write', () => {
    test('is read result by result, including a refused name and a failure', () => {
        expect(parsePutResults([{ k: 'ok' }, { k: 'invalid', reason: 'leading dot' }, { k: 'error', message: 'disk full' }], 3)).toEqual([
            { k: 'ok' },
            { k: 'invalid', reason: 'leading dot' },
            { k: 'error', message: 'disk full' },
        ])
    })

    test.each([
        { title: 'a list of the wrong length', value: [{ k: 'ok' }], expected: 2 },
        { title: 'something other than a list', value: { k: 'ok' }, expected: 1 },
        { title: 'an unknown result kind', value: [{ k: 'maybe' }], expected: 1 },
        { title: 'an invalid result with no reason', value: [{ k: 'invalid' }], expected: 1 },
    ])('refuses $title', ({ value, expected }) => {
        expect(() => parsePutResults(value, expected)).toThrow()
    })

    test('a call error that is not the raw-body refusal reaches the caller unchanged and leaves batching on', async () => {
        h.invoke.mockRejectedValueOnce('malformed: truncated frame')

        await expect(writeAssetBatch([{ key: 'assets/a', data: new Uint8Array([1]) }])).rejects.toBe('malformed: truncated frame')

        expect(isAssetBatchAvailable()).toBe(true)
        expect(isAssetBatchNotRawError('malformed: truncated frame')).toBe(false)
    })
})

describe('the response of a batch read', () => {
    test('is read frame by frame: bytes, a missing key, a refused key and a failure, in key order', () => {
        const response = buffer([
            ...frame(0, new Uint8Array([1, 2, 3])),
            ...frame(1, new Uint8Array([])),
            ...frame(2, encoder.encode('no dots')),
            ...frame(3, encoder.encode('denied')),
        ])

        const results = parseReadFrames(response, 4)

        expect(results[0]).toEqual({ status: 'ok', bytes: new Uint8Array([1, 2, 3]) })
        expect(results.slice(1)).toEqual([
            { status: 'missing' },
            { status: 'invalid', reason: 'no dots' },
            { status: 'error', message: 'denied' },
        ])
    })

    test('reads a file above the single-call size as large and a key left for a later call as deferred, each without bytes', () => {
        const response = buffer([
            ...frame(0, new Uint8Array([1])),
            ...frame(4, new Uint8Array([])),
            ...frame(5, new Uint8Array([])),
            ...frame(5, new Uint8Array([])),
        ])

        expect(parseReadFrames(response, 4)).toEqual([
            { status: 'ok', bytes: new Uint8Array([1]) },
            { status: 'large' },
            { status: 'deferred' },
            { status: 'deferred' },
        ])
    })

    test.each([
        { title: 'a response that ends inside a frame header', bytes: [0, 1, 0], count: 1 },
        { title: 'a large key that carries bytes', bytes: [4, ...u32le(1), 4], count: 1 },
        { title: 'a deferred key that carries bytes', bytes: [5, ...u32le(1), 4], count: 1 },
        { title: 'a frame whose length runs past the end', bytes: [0, ...u32le(5), 1, 2], count: 1 },
        { title: 'bytes after the last frame', bytes: [...frame(0, new Uint8Array([1])), 9], count: 1 },
        { title: 'fewer frames than keys', bytes: frame(0, new Uint8Array([1])), count: 2 },
        { title: 'an unknown status', bytes: [6, ...u32le(0)], count: 1 },
        { title: 'a missing key that carries bytes', bytes: [1, ...u32le(1), 4], count: 1 },
    ])('is refused: $title', ({ bytes, count }) => {
        expect(() => parseReadFrames(buffer(bytes), count)).toThrow()
    })

    test('a response that is not bytes is refused', () => {
        expect(() => parseReadFrames('text', 1)).toThrow()
    })

    test('readAssetBatch sends the keys and reads the answer', async () => {
        h.invoke.mockResolvedValueOnce(buffer(frame(0, new Uint8Array([4]))))

        const results = await readAssetBatch(['assets/a.png'])

        expect(h.invoke).toHaveBeenCalledWith('get_assets_batch', { keys: ['assets/a.png'] }, undefined)
        expect(results).toEqual([{ status: 'ok', bytes: new Uint8Array([4]) }])
    })
})

describe('the sized listing', () => {
    test('returns the keys with their sizes in the order given', async () => {
        h.invoke.mockResolvedValueOnce([['assets/b', 3], ['assets/a', 0]])

        expect(await listAssetsSized()).toEqual([{ key: 'assets/b', size: 3 }, { key: 'assets/a', size: 0 }])
    })

    test.each([
        { title: 'something other than a list', value: 'x' },
        { title: 'an item that is not a pair', value: [['assets/a']] },
        { title: 'a negative size', value: [['assets/a', -1]] },
        { title: 'a fractional size', value: [['assets/a', 1.5]] },
        { title: 'a key that is not text', value: [[7, 1]] },
    ])('is refused: $title', async ({ value }) => {
        h.invoke.mockResolvedValueOnce(value)

        await expect(listAssetsSized()).rejects.toThrow()
    })
})
