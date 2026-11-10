// @vitest-environment happy-dom

/**
 * `awaitQueuedWholeRead`: the wait in the app-wide whole-read queue, the detached `Image` read made while the slot is
 * held, what ends that read, and what an abort does. The sizes come from the real size cache through a mocked stat.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const transport = vi.hoisted(() => ({ android: true, sizes: {} as Record<string, number> }))
const lookups = vi.hoisted(() => ({ wholeReadBytesOfUrl: vi.fn() }))

vi.mock('../storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../storage/tauriByteTransport')>()),
    isAndroidTransport: () => transport.android,
    statStoredSize: async (key: string) => transport.sizes[key] ?? 0,
}))

vi.mock('../storage/assetUrlGate', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../storage/assetUrlGate')>()
    lookups.wholeReadBytesOfUrl.mockImplementation(actual.wholeReadBytesOfUrl)
    return { ...actual, wholeReadBytesOfUrl: lookups.wholeReadBytesOfUrl }
})

import { androidAssetSizeVerdict, androidWholeReadQueue, rememberWholeReadUrl, resetAssetUrlGateForTest } from '../storage/assetUrlGate'
import { awaitQueuedWholeRead, heldQueuedWholeReadsForTest, resetQueuedWholeReadsForTest } from './queuedWholeRead'

const MIB = 1024 * 1024
const URL_OF = (key: string) => `http://asset.localhost/${key}`

class FakeImage {
    static all: FakeImage[] = []
    crossOrigin = ''
    src = ''
    private listeners = new Map<string, Set<() => void>>()
    constructor() {
        FakeImage.all.push(this)
    }
    addEventListener(type: string, listener: () => void) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set())
        }
        this.listeners.get(type)!.add(listener)
    }
    removeEventListener(type: string, listener: () => void) {
        this.listeners.get(type)?.delete(listener)
    }
    fire(type: 'load' | 'error') {
        for (const listener of [...(this.listeners.get(type) ?? [])]) {
            listener()
        }
    }
}

async function register(key: string, mib: number): Promise<string> {
    transport.sizes[key] = mib * MIB
    await androidAssetSizeVerdict(key)
    rememberWholeReadUrl(URL_OF(key), key)
    return URL_OF(key)
}

async function flush() {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve()
    }
}

/** Outcomes recorded as they resolve, so a test can tell "not yet" from "resolved". */
function track(promise: Promise<string>) {
    const box: { value?: string } = {}
    void promise.then((value) => { box.value = value })
    return box
}

beforeEach(() => {
    transport.android = true
    transport.sizes = {}
    FakeImage.all = []
    lookups.wholeReadBytesOfUrl.mockClear()
    vi.stubGlobal('Image', FakeImage)
    resetAssetUrlGateForTest()
    resetQueuedWholeReadsForTest()
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('what needs no queue', () => {
    test('an already aborted signal resolves aborted with no Image', async () => {
        const url = await register('a', 20)
        const hold = new AbortController()
        hold.abort()
        expect(await awaitQueuedWholeRead(url, hold.signal)).toBe('aborted')
        expect(FakeImage.all).toHaveLength(0)
    })

    test('an unknown URL and a file under 8 MiB are direct, with no Image', async () => {
        const small = await register('small', 4)
        const hold = new AbortController()
        expect(await awaitQueuedWholeRead(small, hold.signal)).toBe('direct')
        expect(await awaitQueuedWholeRead(URL_OF('unknown'), hold.signal)).toBe('direct')
        expect(FakeImage.all).toHaveLength(0)
    })

    test('the 8 MiB boundary is exact: 8 MiB is queued, 8 MiB minus one byte is direct', async () => {
        for (const [key, bytes] of [['edge', 8 * MIB], ['below', 8 * MIB - 1]] as const) {
            transport.sizes[key] = bytes
            await androidAssetSizeVerdict(key)
            rememberWholeReadUrl(URL_OF(key), key)
        }
        const hold = new AbortController()
        expect(await awaitQueuedWholeRead(URL_OF('below'), hold.signal)).toBe('direct')
        expect(FakeImage.all).toHaveLength(0)

        const edge = track(awaitQueuedWholeRead(URL_OF('edge'), hold.signal))
        await flush()
        expect(FakeImage.all.map((image) => image.src)).toEqual([URL_OF('edge')])
        FakeImage.all[0].fire('load')
        await flush()
        expect(edge.value).toBe('queued')
        hold.abort()
    })

    test('off Android the registry is never consulted, so a large data: URL is never hashed', async () => {
        transport.android = false
        const hold = new AbortController()
        const huge = `data:image/png;base64,${'A'.repeat(4 * MIB)}`
        expect(await awaitQueuedWholeRead(huge, hold.signal)).toBe('direct')
        expect(lookups.wholeReadBytesOfUrl).not.toHaveBeenCalled()
        expect(FakeImage.all).toHaveLength(0)
    })
})

describe('the queued read', () => {
    test('a granted read loads the URL once, keeps the Image, sets no crossOrigin and resolves queued on load', async () => {
        const url = await register('a', 20)
        const hold = new AbortController()
        const result = track(awaitQueuedWholeRead(url, hold.signal))
        await flush()
        expect(FakeImage.all.map((image) => image.src)).toEqual([url])
        expect(FakeImage.all[0].crossOrigin).toBe('')
        expect(result.value).toBeUndefined()

        FakeImage.all[0].fire('load')
        await flush()
        expect(result.value).toBe('queued')
        expect(heldQueuedWholeReadsForTest()).toBe(1)

        hold.abort()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('an error settles the read like a load and gives the slot back', async () => {
        const first = await register('a', 40)
        const second = await register('b', 40)
        const hold = new AbortController()
        const a = track(awaitQueuedWholeRead(first, hold.signal))
        const b = track(awaitQueuedWholeRead(second, hold.signal))
        await flush()
        expect(FakeImage.all).toHaveLength(1)

        FakeImage.all[0].fire('error')
        await flush()
        expect(a.value).toBe('queued')
        expect(FakeImage.all).toHaveLength(2)
        expect(b.value).toBeUndefined()
    })

    test('a read that never ends gives its slot back after 30 s', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const first = await register('a', 40)
        const second = await register('b', 40)
        const hold = new AbortController()
        const a = track(awaitQueuedWholeRead(first, hold.signal))
        track(awaitQueuedWholeRead(second, hold.signal))
        await flush()
        expect(FakeImage.all).toHaveLength(1)

        vi.advanceTimersByTime(29_999)
        await flush()
        expect(FakeImage.all).toHaveLength(1)
        vi.advanceTimersByTime(1)
        await flush()
        expect(a.value).toBe('queued')
        expect(FakeImage.all).toHaveLength(2)
    })

    test('an abort while waiting resolves aborted at once; the grant that arrives later is given back with no Image', async () => {
        const first = await register('a', 40)
        const second = await register('b', 40)
        const holdA = new AbortController()
        const holdB = new AbortController()
        track(awaitQueuedWholeRead(first, holdA.signal))
        const b = track(awaitQueuedWholeRead(second, holdB.signal))
        await flush()
        expect(FakeImage.all).toHaveLength(1)

        holdB.abort()
        await flush()
        expect(b.value).toBe('aborted')

        FakeImage.all[0].fire('load')
        await flush()
        expect(FakeImage.all).toHaveLength(1)
        // The queue is empty again: a 60 MiB read is granted at once.
        const third = await register('c', 60)
        track(awaitQueuedWholeRead(third, new AbortController().signal))
        await flush()
        expect(FakeImage.all).toHaveLength(2)
    })

    test('an abort mid-read resolves aborted at once and the slot is held until the read settles', async () => {
        const first = await register('a', 40)
        const second = await register('b', 40)
        const holdA = new AbortController()
        const a = track(awaitQueuedWholeRead(first, holdA.signal))
        track(awaitQueuedWholeRead(second, new AbortController().signal))
        await flush()
        expect(FakeImage.all).toHaveLength(1)

        holdA.abort()
        await flush()
        expect(a.value).toBe('aborted')
        expect(FakeImage.all).toHaveLength(1)
        expect(heldQueuedWholeReadsForTest()).toBe(1)

        FakeImage.all[0].fire('load')
        await flush()
        expect(FakeImage.all).toHaveLength(2)
        expect(heldQueuedWholeReadsForTest()).toBe(1)
    })

    test('the Image stays referenced after settle and is dropped when the hold aborts', async () => {
        const url = await register('a', 20)
        const hold = new AbortController()
        track(awaitQueuedWholeRead(url, hold.signal))
        await flush()
        FakeImage.all[0].fire('load')
        await flush()
        expect(heldQueuedWholeReadsForTest()).toBe(1)
        hold.abort()
        expect(heldQueuedWholeReadsForTest()).toBe(0)
    })

    test('the reads share the one app-wide queue', async () => {
        const url = await register('a', 60)
        const grant = await androidWholeReadQueue().acquire(60 * MIB)
        const result = track(awaitQueuedWholeRead(url, new AbortController().signal))
        await flush()
        expect(FakeImage.all).toHaveLength(0)

        grant.release()
        await flush()
        expect(FakeImage.all).toHaveLength(1)
        expect(result.value).toBeUndefined()
    })
})
