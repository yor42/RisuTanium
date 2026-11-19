// @vitest-environment happy-dom

/**
 * The page's side of `read_store2_units` on a mocked `invoke`: the loop, the reply forms the bridge delivers, the
 * strict reply parser (against `parseReadFrames`, which reads the same frames for `get_assets_batch`), the platform
 * switch and the measurement counters. The native command is not run here.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    os: 'android' as string,
    visibility: 'visible' as string,
    knob: null as string | null,
    invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
}))

vi.mock('@tauri-apps/api/core', () => ({
    invoke: (command: string, args?: unknown) => h.invoke(command, args),
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
    get isTauri() { return true },
}) as unknown as typeof import('../../platform'))

import { parseReadFrames } from '../tauriAssetBatch'
import { STORE2_BATCH_TRANSPORTS, parseStore2BatchFrames, readStore2UnitBatch, store2BatchTransport, takeStore2BatchStats } from '../tauriStore2Batch'

const OK = 0
const MISSING = 1
const INVALID = 2
const ERROR = 3
const LARGE = 4
const DEFERRED = 5

function frame(status: number, body: readonly number[] = []): Uint8Array {
    const out = new Uint8Array(5 + body.length)
    out[0] = status
    new DataView(out.buffer).setUint32(1, body.length, true)
    out.set(body, 5)
    return out
}

function reply(...frames: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(frames.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of frames) {
        out.set(part, at)
        at += part.length
    }
    return out
}

/** One reply of ok frames holding `[index, index]` for each key. */
function allOk(keys: readonly string[]): Uint8Array {
    return reply(...keys.map((_, i) => frame(OK, [i, i])))
}

const accept = (_key: string): void => undefined
const keysOf = (count: number): string[] => Array.from({ length: count }, (_, i) => `store2/u-${i}`)
const calls = () => h.invoke.mock.calls.filter(([command]) => command === 'read_store2_units')

beforeEach(() => {
    h.os = 'android'
    h.visibility = 'visible'
    h.knob = null
    h.invoke.mockReset()
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-store2-batch' ? h.knob : null })
    vi.stubGlobal('document', { get visibilityState() { return h.visibility } })
    takeStore2BatchStats()
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('T4.13 the reply forms and the loop', () => {
    const forms: [string, (bytes: Uint8Array) => unknown][] = [
        ['an ArrayBuffer', (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)],
        ['a view at a non-zero offset', (bytes) => {
            const wide = new Uint8Array(bytes.length + 9)
            wide.set(bytes, 7)
            return wide.subarray(7, 7 + bytes.length)
        }],
        ['a number array', (bytes) => Array.from(bytes)],
    ]

    for (const os of ['android', 'windows'] as const) {
        test.each(forms)(`${os}: %s`, async (_name, form) => {
            h.os = os
            const keys = keysOf(3)
            h.invoke.mockImplementation(async () => form(allOk(keys)))

            const read = await readStore2UnitBatch(keys, accept)

            expect(read === null ? null : keys.map((key) => [...(read.get(key) ?? [])])).toEqual([[0, 0], [1, 1], [2, 2]])
        })
    }

    test('a reply that answers every key deferred ends the loop and leaves every key out', async () => {
        const keys = keysOf(4)
        h.invoke.mockImplementation(async (_command, args) => reply(...(args as { keys: string[] }).keys.map(() => frame(DEFERRED))))

        const read = await readStore2UnitBatch(keys, accept)

        expect(read).toEqual(new Map())
        expect(calls()).toHaveLength(1)
    })

    test('a deferred tail is asked for again, in order, and the loop ends when every key is answered', async () => {
        const keys = keysOf(5)
        h.invoke.mockImplementationOnce(async () => reply(frame(OK, [1]), frame(OK, [2]), frame(DEFERRED), frame(DEFERRED), frame(DEFERRED)))
        h.invoke.mockImplementationOnce(async () => reply(frame(OK, [3]), frame(MISSING), frame(OK, [5])))

        const read = await readStore2UnitBatch(keys, accept)

        expect(calls().map(([, args]) => (args as { keys: string[] }).keys)).toEqual([keys, keys.slice(2)])
        expect(read === null ? null : [...read.keys()]).toEqual([keys[0], keys[1], keys[2], keys[4]])
    })

    test('a call whose every frame is non-ok and non-deferred makes progress, and its keys are left out', async () => {
        const keys = keysOf(3)
        h.invoke.mockImplementation(async () => reply(frame(MISSING), frame(INVALID, [65]), frame(ERROR, [66])))

        const read = await readStore2UnitBatch(keys, accept)

        expect(read).toEqual(new Map())
        expect(calls()).toHaveLength(1)
    })

    test('a key the store refuses is never sent', async () => {
        const keys = keysOf(3)
        h.invoke.mockImplementation(async (_command, args) => allOk((args as { keys: string[] }).keys))

        const read = await readStore2UnitBatch(keys, (key) => {
            if (key === keys[1]) {
                throw new Error('refused')
            }
        })

        expect(calls().flatMap(([, args]) => (args as { keys: string[] }).keys)).toEqual([keys[0], keys[2]])
        expect(read === null ? null : [...read.keys()]).toEqual([keys[0], keys[2]])
    })

    test('a rejected call leaves every key out and does not reject', async () => {
        h.invoke.mockRejectedValue('transport lost')

        await expect(readStore2UnitBatch(keysOf(3), accept)).resolves.toEqual(new Map())
    })
})

describe('the strict reply parser reads the frames as parseReadFrames does', () => {
    const good = reply(frame(OK, [1, 2]), frame(MISSING), frame(INVALID, [65]), frame(ERROR, [66]), frame(LARGE), frame(DEFERRED))
    const cases: [string, unknown, number][] = [
        ['all six statuses', good, 6],
        ['an empty reply for no key', new Uint8Array(0), 0],
        ['a truncated header', good.subarray(0, good.length - 2), 6],
        ['a truncated body', frame(OK, [1, 2, 3]).subarray(0, 7), 1],
        ['a trailing byte', reply(frame(OK, [1]), Uint8Array.of(0)), 1],
        ['an unknown status', frame(6), 1],
        ['a body on missing', frame(MISSING, [1]), 1],
        ['a body on large', frame(LARGE, [1]), 1],
        ['a body on deferred', frame(DEFERRED, [1]), 1],
        ['too few frames', frame(OK, [1]), 2],
        ['a string', 'garbage', 1],
        ['an object', {}, 1],
    ]

    test.each(cases)('%s', (_name, response, count) => {
        let expected: ReturnType<typeof parseReadFrames> | 'throws'
        try {
            expected = parseReadFrames(response, count)
        } catch {
            expected = 'throws'
        }
        let actual: ReturnType<typeof parseStore2BatchFrames> | 'throws'
        try {
            actual = parseStore2BatchFrames(response, count)
        } catch {
            actual = 'throws'
        }

        if (expected === 'throws' || actual === 'throws') {
            expect(actual).toBe(expected)
            return
        }
        expect(actual.map((entry) => entry.status === 'ok' ? 'ok' : entry.status === 'deferred' ? 'deferred' : 'other'))
            .toEqual(expected.map((entry) => entry.status === 'ok' ? 'ok' : entry.status === 'deferred' ? 'deferred' : 'other'))
        actual.forEach((entry, i) => {
            const read = expected[i]
            if (entry.status === 'ok' && read.status === 'ok') {
                expect([...entry.bytes]).toEqual([...read.bytes])
            }
        })
    })
})

describe('T4.21 the platform switch', () => {
    test('android and desktop batch, a page without the plugin does not', () => {
        expect([...STORE2_BATCH_TRANSPORTS]).toEqual(['android', 'desktop'])
        expect(store2BatchTransport('android')).toBe(true)
        expect(store2BatchTransport('desktop')).toBe(true)
        expect(store2BatchTransport('other')).toBe(false)
    })

    test('a page without the plugin makes no call and answers null', async () => {
        h.os = 'throw'

        expect(await readStore2UnitBatch(keysOf(3), accept)).toBeNull()
        expect(calls()).toHaveLength(0)
    })
})

describe('T4.17 the measurement counters', () => {
    test('calls, fallback keys, off reads and milliseconds are counted exactly, and a take clears them', async () => {
        const keys = keysOf(3)
        h.invoke.mockImplementationOnce(async () => reply(frame(OK, [1]), frame(LARGE), frame(MISSING)))
        await readStore2UnitBatch(keys, accept)
        h.invoke.mockRejectedValueOnce('transport lost')
        await readStore2UnitBatch(keysOf(2), accept)
        h.knob = 'off'
        await readStore2UnitBatch(keys, accept)

        const taken = takeStore2BatchStats()

        expect(taken).toMatchObject({ calls: 2, fallbackKeys: 4, offCalls: 1 })
        expect(taken?.ms).toBeGreaterThanOrEqual(0)
        expect(takeStore2BatchStats()).toEqual({ calls: 0, fallbackKeys: 0, ms: 0, offCalls: 0 })
    })

    test('a build without measurement counts nothing, ignores the knob and answers null from the take', async () => {
        vi.resetModules()
        vi.doMock('../../process/memory/measureFlag', () => ({ MEASURE: false }))
        try {
            const batch = await import('../tauriStore2Batch')
            h.knob = 'off'
            h.invoke.mockImplementation(async () => allOk(keysOf(2)))

            const read = await batch.readStore2UnitBatch(keysOf(2), accept)

            expect(read?.size).toBe(2)
            expect(batch.takeStore2BatchStats()).toBeNull()
        } finally {
            vi.doUnmock('../../process/memory/measureFlag')
            vi.resetModules()
        }
    })
})
