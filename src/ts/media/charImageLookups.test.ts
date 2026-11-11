/**
 * The per-slot holds of `charImageLookups.ts`. `getCharImage` is a controlled fake whose calls and signals are on record;
 * the platform flag and the hide-all-images flag are plain test state.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Stands for the THUMB_ABORTED symbol of a read that was cut off: neither a string nor null.
const ABORTED = Symbol('aborted')

interface Call {
    loc: string
    type: string
    args: unknown[]
    signal: AbortSignal | undefined
    resolve: (value: string | null | typeof ABORTED) => void
    reject: (reason: unknown) => void
}

const { calls, platform, db, getCharImageMock } = vi.hoisted(() => {
    const calls: Call[] = []
    return {
        calls,
        platform: { android: true },
        db: { hideAllImages: false },
        getCharImageMock: vi.fn(),
    }
})

vi.mock('../characters', () => ({
    getCharImage: (...args: unknown[]) => getCharImageMock(...args),
}))

vi.mock('../storage/tauriByteTransport', () => ({
    isAndroidTransport: () => platform.android,
}))

vi.mock('../stores.svelte', () => ({
    DBState: { db },
}))

import { createCharImageLookups, type CharImageLookups } from './charImageLookups'

let lookups: CharImageLookups

beforeEach(() => {
    calls.length = 0
    platform.android = true
    db.hideAllImages = false
    getCharImageMock.mockReset()
    getCharImageMock.mockImplementation((loc: string, type: string, ...rest: unknown[]) => {
        return new Promise((resolve, reject) => {
            const options = rest[0] as { signal?: AbortSignal } | undefined
            calls.push({ loc, type, args: [loc, type, ...rest], signal: options?.signal, resolve, reject })
        })
    })
    lookups = createCharImageLookups()
})

afterEach(() => {
    lookups.dispose()
})

/** Tracks how a promise ends without ever awaiting it, so a pending promise cannot hang the test. */
function track<T>(promise: Promise<T>): { state: 'pending' | 'resolved' | 'rejected'; value?: T; reason?: unknown } {
    const record: { state: 'pending' | 'resolved' | 'rejected'; value?: T; reason?: unknown } = { state: 'pending' }
    promise.then((value) => {
        record.state = 'resolved'
        record.value = value
    }, (reason: unknown) => {
        record.state = 'rejected'
        record.reason = reason
    })
    return record
}

async function flush(): Promise<void> {
    for (let i = 0; i < 20; i++) {
        await Promise.resolve()
    }
}

describe('on Android', () => {
    test('T7 a slot memoizes per key: the same key returns the same promise from one call, and the call carries a signal', () => {
        const first = lookups.get('s', 'assets/a.webp', 'thumb')
        const second = lookups.get('s', 'assets/a.webp', 'thumb')
        expect(second).toBe(first)
        expect(calls).toHaveLength(1)
        expect(calls[0].loc).toBe('assets/a.webp')
        expect(calls[0].type).toBe('thumb')
        expect(calls[0].signal).toBeInstanceOf(AbortSignal)
        expect(calls[0].signal!.aborted).toBe(false)
    })

    test('T7 the type and the location are part of the key; two slots do not share a promise', () => {
        lookups.get('s', 'assets/a.webp', 'thumb')
        lookups.get('s', 'assets/a.webp', 'plain')
        lookups.get('other', 'assets/a.webp', 'plain')
        expect(calls.map((call) => `${call.loc}|${call.type}`)).toEqual(['assets/a.webp|thumb', 'assets/a.webp|plain', 'assets/a.webp|plain'])
        expect(calls[0].signal!.aborted).toBe(true)
        expect(calls[1].signal!.aborted).toBe(false)
        expect(calls[2].signal!.aborted).toBe(false)
    })

    test('T7 hide-all-images is part of the key', () => {
        lookups.get('s', 'assets/a.webp', 'plain')
        db.hideAllImages = true
        lookups.get('s', 'assets/a.webp', 'plain')
        expect(calls).toHaveLength(2)
        expect(calls[0].signal!.aborted).toBe(true)
    })

    test('T7 replacing the key aborts the old hold, and the old promise follows the new outcome', async () => {
        const old = track(lookups.get('s', 'assets/a.webp', 'plain'))
        const next = track(lookups.get('s', 'assets/b.webp', 'plain'))
        expect(calls[0].signal!.aborted).toBe(true)
        expect(calls[1].signal!.aborted).toBe(false)

        calls[0].resolve(ABORTED)
        await flush()
        expect(old.state).toBe('pending')

        calls[1].resolve('url-b')
        await flush()
        expect(next).toMatchObject({ state: 'resolved', value: 'url-b' })
        expect(old).toMatchObject({ state: 'resolved', value: 'url-b' })
    })

    test('T7 an old promise that has settled keeps its value when the slot is replaced', async () => {
        const old = track(lookups.get('s', 'assets/a.webp', 'plain'))
        calls[0].resolve('url-a')
        await flush()
        const next = track(lookups.get('s', 'assets/b.webp', 'plain'))
        calls[1].resolve('url-b')
        await flush()
        expect(old).toMatchObject({ state: 'resolved', value: 'url-a' })
        expect(next).toMatchObject({ state: 'resolved', value: 'url-b' })
    })

    test('T7 an old promise adopts a rejection of the new entry', async () => {
        const old = track(lookups.get('s', 'assets/a.webp', 'plain'))
        const next = track(lookups.get('s', 'assets/b.webp', 'plain'))
        calls[1].reject(new Error('boom'))
        await flush()
        expect(next.state).toBe('rejected')
        expect(old.state).toBe('rejected')
    })

    test('T7 the helper never resolves ABORTED, and an aborted result leaves the promise pending', async () => {
        const entry = track(lookups.get('s', 'assets/a.webp', 'plain'))
        calls[0].resolve(ABORTED)
        await flush()
        expect(entry.state).toBe('pending')
    })

    test('T7 a rejection drops the entry so the next get asks again; a null or empty result stays memoized', async () => {
        const failed = track(lookups.get('s', 'assets/a.webp', 'plain'))
        calls[0].reject(new Error('boom'))
        await flush()
        expect(failed.state).toBe('rejected')
        lookups.get('s', 'assets/a.webp', 'plain')
        expect(calls).toHaveLength(2)

        calls[1].resolve(null)
        await flush()
        lookups.get('s', 'assets/a.webp', 'plain')
        expect(calls).toHaveLength(2)

        lookups.get('t', 'assets/c.webp', 'thumbcss')
        calls[2].resolve('')
        await flush()
        lookups.get('t', 'assets/c.webp', 'thumbcss')
        expect(calls).toHaveLength(3)
    })

    test('T7 getIf with use true is get', () => {
        const viaGet = lookups.get('s', 'assets/a.webp', 'plain')
        expect(lookups.getIf('s', true, 'assets/a.webp', 'plain', '')).toBe(viaGet)
        expect(calls).toHaveLength(1)
    })

    test('T7 getIf false makes no call, returns the empty value itself, aborts the old hold and lets followers adopt the empty value', async () => {
        const old = track(lookups.get('s', 'assets/a.webp', 'plain'))
        expect(lookups.getIf('s', false, '', 'plain', '/none.webp')).toBe('/none.webp')
        expect(calls).toHaveLength(1)
        expect(calls[0].signal!.aborted).toBe(true)
        await flush()
        expect(old).toMatchObject({ state: 'resolved', value: '/none.webp' })
    })

    test('T7 getIf false with a null empty value releases followers with null', async () => {
        const old = track(lookups.get('s', 'assets/a.webp', 'plain'))
        expect(lookups.getIf('s', false, '', 'plain', null)).toBeNull()
        await flush()
        expect(old).toMatchObject({ state: 'resolved', value: null })
    })

    test('T7 a getIf false repeated on a released slot changes nothing, and a later get starts a fresh read', async () => {
        lookups.getIf('s', false, '', 'plain', '')
        lookups.getIf('s', false, '', 'plain', '')
        expect(calls).toHaveLength(0)
        const next = track(lookups.get('s', 'assets/a.webp', 'plain'))
        expect(calls).toHaveLength(1)
        calls[0].resolve('url-a')
        await flush()
        expect(next).toMatchObject({ state: 'resolved', value: 'url-a' })
    })

    test('T7 dispose aborts every hold, leaves pending promises pending and starts nothing afterwards', async () => {
        const a = track(lookups.get('a', 'assets/a.webp', 'plain'))
        const b = track(lookups.get('b', 'assets/b.webp', 'plain'))
        lookups.dispose()
        expect(calls.map((call) => call.signal!.aborted)).toEqual([true, true])
        calls[0].resolve(ABORTED)
        calls[1].resolve(ABORTED)
        await flush()
        expect(a.state).toBe('pending')
        expect(b.state).toBe('pending')

        const late = track(lookups.get('a', 'assets/c.webp', 'plain'))
        expect(lookups.getIf('a', false, '', 'plain', 'empty')).toBe('empty')
        const lateIf = lookups.getIf('a', true, 'assets/d.webp', 'plain', '')
        await flush()
        expect(calls).toHaveLength(2)
        expect(late.state).toBe('pending')
        expect(track(lateIf as Promise<string | null>).state).toBe('pending')
    })

    test('T7 two owners with different keys on one slot abort each other, so the loser follows the winner (the hazard U1 forbids)', async () => {
        const first = track(lookups.get('shared', 'assets/a.webp', 'plain'))
        const second = track(lookups.get('shared', 'assets/b.webp', 'plain'))
        calls[1].resolve('url-b')
        await flush()
        expect(first).toMatchObject({ state: 'resolved', value: 'url-b' })
        expect(second).toMatchObject({ state: 'resolved', value: 'url-b' })
    })
})

describe('off Android', () => {
    beforeEach(() => {
        platform.android = false
    })

    test('T7 get passes every call straight to the two-argument getCharImage: no memo, no signal', () => {
        lookups.get('s', 'assets/a.webp', 'thumb')
        lookups.get('s', 'assets/a.webp', 'thumb')
        lookups.get('s', 'assets/b.webp', 'plain')
        expect(calls.map((call) => call.args)).toEqual([
            ['assets/a.webp', 'thumb'],
            ['assets/a.webp', 'thumb'],
            ['assets/b.webp', 'plain'],
        ])
    })

    test('T7 getIf false makes no call and returns the empty value; getIf true is the two-argument call', () => {
        expect(lookups.getIf('s', false, 'assets/a.webp', 'thumb', '/none.webp')).toBe('/none.webp')
        expect(lookups.getIf('s', false, 'assets/a.webp', 'plain', null)).toBeNull()
        expect(calls).toHaveLength(0)
        lookups.getIf('s', true, 'assets/a.webp', 'thumb', '/none.webp')
        expect(calls.map((call) => call.args)).toEqual([['assets/a.webp', 'thumb']])
    })

    test('T7 a result that is not a promise is wrapped, and the helper keeps no hold off Android', async () => {
        getCharImageMock.mockImplementation(() => 'plain-value')
        const wrapped = lookups.get('s', 'assets/a.webp', 'plain')
        expect(wrapped).toBeInstanceOf(Promise)
        await expect(wrapped).resolves.toBe('plain-value')
        lookups.dispose()
        getCharImageMock.mockImplementation(() => 'after-dispose')
        await expect(lookups.get('s', 'assets/a.webp', 'plain')).resolves.toBe('after-dispose')
    })
})
