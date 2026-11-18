// @vitest-environment happy-dom

/**
 * `admitCardImageRead`: what the card's image read may start on Android. The sizes come from the real size
 * cache through a mocked stat, the queue is the real app-wide whole-read queue, and the registry lookup is
 * spied so a test can tell "no lookup" from "an unknown size".
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const transport = vi.hoisted(() => ({ android: true, sizes: {} as Record<string, number> }))
const lookups = vi.hoisted(() => ({ wholeReadBytesOfUrl: vi.fn() }))

vi.mock('./storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./storage/tauriByteTransport')>()),
    isAndroidTransport: () => transport.android,
    statStoredSize: async (key: string) => transport.sizes[key] ?? 0,
}))

vi.mock('./storage/assetUrlGate', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./storage/assetUrlGate')>()
    lookups.wholeReadBytesOfUrl.mockImplementation(actual.wholeReadBytesOfUrl)
    return { ...actual, wholeReadBytesOfUrl: lookups.wholeReadBytesOfUrl }
})

import { androidAssetSizeVerdict, androidWholeReadQueue, rememberWholeReadUrl, resetAssetUrlGateForTest } from './storage/assetUrlGate'
import { admitCardImageRead, type ImageReadPermit } from './chatCardReadGate'

const MIB = 1024 * 1024
const URL_OF = (key: string) => `http://asset.localhost/${key}`

async function register(key: string, bytes: number): Promise<string> {
    transport.sizes[key] = bytes
    await androidAssetSizeVerdict(key)
    rememberWholeReadUrl(URL_OF(key), key)
    return URL_OF(key)
}

async function flush(): Promise<void> {
    for (let i = 0; i < 20; i++) {
        await Promise.resolve()
    }
}

/** Whether `promise` has settled after the microtasks of the queue ran. */
async function settledAfterFlush(promise: Promise<unknown>): Promise<boolean> {
    let settled = false
    void promise.then(() => { settled = true }, () => { settled = true })
    await flush()
    return settled
}

beforeEach(() => {
    transport.android = true
    transport.sizes = {}
    resetAssetUrlGateForTest()
    lookups.wholeReadBytesOfUrl.mockClear()
})

afterEach(() => {
    resetAssetUrlGateForTest()
})

describe('admitCardImageRead', () => {
    test('off Android every source gets an empty permit and nothing is looked up', async () => {
        transport.android = false
        const permit = await admitCardImageRead(URL_OF('a'), new AbortController().signal)

        expect(permit).not.toBeNull()
        expect(lookups.wholeReadBytesOfUrl).not.toHaveBeenCalled()
        permit?.release()
    })

    test.each(['data:image/png;base64,AAAA', 'blob:http://localhost:3000/u'])('on Android a %s source gets an empty permit with no lookup', async (src) => {
        const permit = await admitCardImageRead(src, new AbortController().signal)

        expect(permit).not.toBeNull()
        expect(lookups.wholeReadBytesOfUrl).not.toHaveBeenCalled()
    })

    test('on Android a source of unknown size is refused', async () => {
        expect(await admitCardImageRead(URL_OF('never-registered'), new AbortController().signal)).toBeNull()
    })

    test('on Android 15 MiB is admitted and one byte more is refused', async () => {
        const at = await register('at', 15 * 1024 * 1024)
        const over = await register('over', 15 * 1024 * 1024 + 1)

        const permit = await admitCardImageRead(at, new AbortController().signal)
        expect(permit).not.toBeNull()
        permit?.release()
        expect(await admitCardImageRead(over, new AbortController().signal)).toBeNull()
    })

    test('a read under 8 MiB takes no grant, even while the queue is full', async () => {
        const small = await register('small', 1 * MIB)
        const held = await androidWholeReadQueue().acquire(64 * MIB)

        const admitted = admitCardImageRead(small, new AbortController().signal)

        expect(await settledAfterFlush(admitted)).toBe(true)
        expect(await admitted).not.toBeNull()
        held.release()
    })

    test('a read of 8 MiB or more waits behind a full queue, is granted on a release, and its permit gives the grant back once', async () => {
        const big = await register('big', 10 * MIB)
        const held = await androidWholeReadQueue().acquire(60 * MIB)

        const admitted = admitCardImageRead(big, new AbortController().signal)
        expect(await settledAfterFlush(admitted)).toBe(false)

        held.release()
        const permit = (await admitted) as ImageReadPermit
        expect(permit).not.toBeNull()
        const probe = androidWholeReadQueue().acquire(64 * MIB)
        expect(await settledAfterFlush(probe)).toBe(false)

        permit.release()
        permit.release()
        const grant = await probe
        const second = androidWholeReadQueue().acquire(64 * MIB)
        expect(await settledAfterFlush(second)).toBe(false)
        grant.release()
        ;(await second).release()
    })

    test('an abort while waiting resolves null at once, and the grant that arrives later is given back', async () => {
        const big = await register('big', 10 * MIB)
        const held = await androidWholeReadQueue().acquire(60 * MIB)
        const controller = new AbortController()

        const admitted = admitCardImageRead(big, controller.signal)
        expect(await settledAfterFlush(admitted)).toBe(false)
        controller.abort()
        expect(await admitted).toBeNull()

        held.release()
        await flush()
        const probe = androidWholeReadQueue().acquire(64 * MIB)
        expect(await settledAfterFlush(probe)).toBe(true)
        ;(await probe).release()
    })

    test('an aborted signal gives null with no lookup', async () => {
        const url = await register('a', 1 * MIB)
        lookups.wholeReadBytesOfUrl.mockClear()
        const controller = new AbortController()
        controller.abort()

        expect(await admitCardImageRead(url, controller.signal)).toBeNull()
        expect(lookups.wholeReadBytesOfUrl).not.toHaveBeenCalled()
    })
})
