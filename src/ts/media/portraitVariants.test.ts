// @vitest-environment happy-dom

/**
 * The app-wide portrait store: one reference relation, entries that settle only themselves, and a bound on
 * the counted cost of unreferenced entries. Unit guards of a new module: their evidence is the mutants that
 * must fail them.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { revokePortraitUrl, shrinkPortrait, type ShrinkOutcome } from './portraitDisplay'
import { createPortraitCache, portraitCache, resetPortraitCacheForTest, type PortraitCacheLimits } from './portraitVariants'

vi.mock('./portraitDisplay', () => ({
    shrinkPortrait: vi.fn(),
    revokePortraitUrl: vi.fn(),
}))

const MiB = 1024 * 1024

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

async function turns(count = 12) {
    for (let i = 0; i < count; i++) await Promise.resolve()
}

const shrunk = (url: string, bytes = 12): ShrinkOutcome => ({ kind: 'shrunk', url, width: 10, height: 20, bytes })

interface Call {
    src: string
    maxSide: number
    signal: AbortSignal
    d: ReturnType<typeof deferred<ShrinkOutcome>>
}

function rig(limits?: PortraitCacheLimits) {
    const calls: Call[] = []
    const revoke = vi.fn()
    const shrink = vi.fn((src: string, maxSide: number, signal: AbortSignal) => {
        const d = deferred<ShrinkOutcome>()
        calls.push({ src, maxSide, signal, d })
        return d.promise
    })
    const cache = createPortraitCache({ shrink, revoke }, limits)
    const callFor = (src: string) => calls.filter((call) => call.src === src)
    return { cache, calls, revoke, shrink, callFor }
}

afterEach(() => {
    resetPortraitCacheForTest()
    vi.clearAllMocks()
})

describe('reuse', () => {
    test('U1: a portrait shown before is not shrunk again', async () => {
        const { cache, shrink, callFor } = rig()
        const holder = cache.createHolder()
        const first = holder.request(['a'], 1, [])
        callFor('a')[0].d.resolve(shrunk('blob:a'))
        await first
        const second = holder.request(['b'], 1, [])
        callFor('b')[0].d.resolve(shrunk('blob:b'))
        await second
        const third = await holder.request(['a'], 1, [])
        expect(third).toEqual([{ src: 'blob:a', width: 10, height: 20, key: '1|a' }])
        expect(shrink).toHaveBeenCalledTimes(2)
    })

    test('U4: original and rejected outcomes show the requester\'s own string and are cached', async () => {
        const { cache, shrink, callFor } = rig()
        const holder = cache.createHolder()
        const a = holder.request(['a.png'], 1, [])
        callFor('a.png')[0].d.resolve({ kind: 'original' })
        expect(await a).toEqual([{ src: 'a.png', key: '1|a.png' }])
        const b = holder.request(['b.png'], 1, [])
        callFor('b.png')[0].d.reject(new Error('shrink failed'))
        expect(await b).toEqual([{ src: 'b.png', key: '1|b.png' }])
        const again = cache.createHolder()
        expect(await again.request(['a.png', 'b.png'], 1, [])).toEqual([{ src: 'a.png', key: '1|a.png' }, { src: 'b.png', key: '1|b.png' }])
        expect(shrink).toHaveBeenCalledTimes(2)
    })

    test('an empty string is never fetched and has no entry', async () => {
        const { cache, shrink } = rig()
        expect(await cache.createHolder().request(['', ''], 1, [])).toEqual([{ src: '' }, { src: '' }])
        expect(shrink).not.toHaveBeenCalled()
        expect(cache.snapshotForTest().entries).toEqual([])
    })

    test('U10: a holder disposed and a new holder with the same portrait share the settled URL without a new shrink', async () => {
        const { cache, shrink, callFor, revoke } = rig()
        const first = cache.createHolder()
        const pending = first.request(['x'], 1, [])
        callFor('x')[0].d.resolve(shrunk('blob:x'))
        const images = await pending
        first.retain(images ?? [])
        first.dispose()
        const second = await cache.createHolder().request(['x'], 1, [])
        expect(second).toEqual([{ src: 'blob:x', width: 10, height: 20, key: '1|x' }])
        expect(shrink).toHaveBeenCalledTimes(1)
        expect(revoke).not.toHaveBeenCalled()
    })

    test('a disposed holder returns the originals and never shrinks', async () => {
        const { cache, shrink } = rig()
        const holder = cache.createHolder()
        holder.dispose()
        expect(await holder.request(['a', 'b'], 1, [])).toEqual([{ src: 'a' }, { src: 'b' }])
        expect(shrink).not.toHaveBeenCalled()
    })
})

describe('eviction and the counted bound', () => {
    async function show(holder: ReturnType<ReturnType<typeof rig>['cache']['createHolder']>, h: ReturnType<typeof rig>, name: string, url: string, bytes = 12, keep: Parameters<typeof holder.request>[2] = []) {
        const request = holder.request([name], 1, keep)
        h.callFor(name).at(-1)?.d.resolve(shrunk(url, bytes))
        return await request
    }

    test('U2: the least recently shown unreferenced entry is evicted once, and dispose does not revoke it again', async () => {
        const h = rig({ maxBytes: 50, maxEntries: 64 })
        const holder = h.cache.createHolder()
        await show(holder, h, 'x', 'blob:x')
        await show(holder, h, 'y', 'blob:y')
        expect(h.revoke).not.toHaveBeenCalled()
        await show(holder, h, 'z', 'blob:z')
        expect(h.revoke.mock.calls).toEqual([['blob:x']])
        const snapshot = h.cache.snapshotForTest()
        expect(snapshot.entries.map((entry) => entry.key).sort()).toEqual(['1|y', '1|z'])
        expect(snapshot.total).toBe(36)
        h.cache.dispose()
        expect(h.revoke.mock.calls.map((call) => call[0]).sort()).toEqual(['blob:x', 'blob:y', 'blob:z'])
    })

    test('U12: referenced entries are never evicted; releasing one evicts only that one', async () => {
        const h = rig({ maxBytes: 30, maxEntries: 64 })
        const holder = h.cache.createHolder()
        const request = holder.request(['a', 'b', 'c', 'd'], 1, [])
        for (const name of ['a', 'b', 'c', 'd']) h.callFor(name)[0].d.resolve(shrunk(`blob:${name}`))
        const images = (await request) ?? []
        expect(h.revoke).not.toHaveBeenCalled()
        holder.retain(images.slice(0, 3))
        expect(h.revoke.mock.calls).toEqual([['blob:d']])
        expect(h.cache.snapshotForTest().entries.map((entry) => entry.key).sort()).toEqual(['1|a', '1|b', '1|c'])
    })

    test('U13: a hit makes an entry newer, so the older one is evicted first', async () => {
        const h = rig({ maxBytes: 50, maxEntries: 64 })
        const holder = h.cache.createHolder()
        await show(holder, h, 'x', 'blob:x')
        await show(holder, h, 'y', 'blob:y')
        await holder.request(['x'], 1, [])
        await show(holder, h, 'z', 'blob:z')
        expect(h.revoke.mock.calls).toEqual([['blob:y']])
    })

    test('U15: references are taken at request time, so an entry that settles first is not evicted before its request commits', async () => {
        const h = rig({ maxBytes: 18, maxEntries: 64 })
        const a = h.cache.createHolder()
        const b = h.cache.createHolder()
        const pendingX = a.request(['x'], 1, [])
        await show(b, h, 'y', 'blob:y')
        b.retain([])
        h.callFor('x')[0].d.resolve(shrunk('blob:x'))
        expect(await pendingX).toEqual([{ src: 'blob:x', width: 10, height: 20, key: '1|x' }])
        expect(h.revoke.mock.calls).toEqual([['blob:y']])
    })

    test('U16: the entry count is bounded', async () => {
        const h = rig({ maxEntries: 3 })
        const holder = h.cache.createHolder()
        for (const name of ['a', 'b', 'c', 'd']) {
            const request = holder.request([name], 1, [])
            h.callFor(name)[0].d.resolve({ kind: 'original' })
            await request
        }
        expect(h.cache.snapshotForTest().entries.map((entry) => entry.key).sort()).toEqual(['1|b', '1|c', '1|d'])
        expect(h.revoke).not.toHaveBeenCalled()
    })

    test('U18: the key string counts, so a large data URL entry is evicted under the bound', async () => {
        const h = rig({ maxBytes: 3 * MiB })
        const holder = h.cache.createHolder()
        const dataUrl = 'data:image/png;base64,' + 'A'.repeat(640 * 1024)
        const first = holder.request([dataUrl], 1, [])
        h.callFor(dataUrl)[0].d.resolve(shrunk('blob:d', 1))
        await first
        const second = holder.request(['y.png'], 1, [])
        h.callFor('y.png')[0].d.resolve(shrunk('blob:y', 2 * MiB))
        await second
        const y = h.cache.snapshotForTest().entries.find((entry) => entry.key === '1|y.png')
        expect(y?.cost).toBe(2 * MiB + 2 * '1|y.png'.length)
        expect(h.revoke.mock.calls).toEqual([['blob:d']])
        expect(h.cache.snapshotForTest().entries.map((entry) => entry.key)).toEqual(['1|y.png'])
    })

    test('U19: an original data URL entry costs its key, stays while referenced and leaves at release', async () => {
        const h = rig({ maxBytes: 1 * MiB })
        const holder = h.cache.createHolder()
        const dataUrl = 'data:image/png;base64,' + 'A'.repeat(600 * 1024)
        const request = holder.request([dataUrl], 1, [])
        h.callFor(dataUrl)[0].d.resolve({ kind: 'original' })
        const images = (await request) ?? []
        expect(images[0].src).toBe(dataUrl)
        const snapshot = h.cache.snapshotForTest()
        expect(snapshot.entries).toHaveLength(1)
        expect(snapshot.entries[0].cost).toBe(2 * `1|${dataUrl}`.length)
        expect(snapshot.entries[0].cost).toBeGreaterThan(1 * MiB)
        holder.retain([])
        expect(h.cache.snapshotForTest().entries).toHaveLength(0)
        expect(h.revoke).not.toHaveBeenCalled()
    })
})

describe('references and cancellation', () => {
    test('U3: dispose keeps settled entries, cancels a pending entry nobody else wants and revokes its late URL once', async () => {
        const h = rig({ maxBytes: 30, maxEntries: 64 })
        const holder = h.cache.createHolder()
        const shown = holder.request(['s'], 1, [])
        h.callFor('s')[0].d.resolve(shrunk('blob:s'))
        const images = (await shown) ?? []
        const pending = holder.request(['p'], 1, images)
        holder.dispose()
        expect(h.revoke).not.toHaveBeenCalled()
        expect(h.callFor('p')[0].signal.aborted).toBe(true)
        expect(await pending).toBeNull()
        expect(h.cache.snapshotForTest().entries.map((entry) => entry.key)).toEqual(['1|s'])

        const other = h.cache.createHolder()
        const g = other.request(['g'], 1, [])
        h.callFor('g')[0].d.resolve(shrunk('blob:g'))
        await g
        expect(h.revoke.mock.calls).toEqual([['blob:s']])

        h.callFor('p')[0].d.resolve(shrunk('blob:p'))
        await turns()
        expect(h.revoke.mock.calls).toEqual([['blob:s'], ['blob:p']])
        expect(await holder.request(['n'], 1, [])).toEqual([{ src: 'n' }])
        expect(h.callFor('n')).toHaveLength(0)
    })

    test('U5: dropping the last reference to a pending entry cancels it and the next request shrinks again', async () => {
        const h = rig()
        const holder = h.cache.createHolder()
        const request = holder.request(['x'], 1, [])
        holder.retain([])
        expect(h.callFor('x')[0].signal.aborted).toBe(true)
        expect(h.cache.snapshotForTest().entries).toEqual([])
        expect(await request).toBeNull()
        void holder.request(['x'], 1, [])
        expect(h.callFor('x')).toHaveLength(2)
    })

    test('U6: a newer request cancels only the older request\'s entries it does not share', async () => {
        const h = rig()
        const holder = h.cache.createHolder()
        const older = holder.request(['x', 'a'], 1, [])
        const newer = holder.request(['x', 'b'], 1, [])
        expect(h.callFor('a')[0].signal.aborted).toBe(true)
        expect(h.callFor('x')[0].signal.aborted).toBe(false)
        h.callFor('x')[0].d.resolve(shrunk('blob:x'))
        h.callFor('b')[0].d.resolve(shrunk('blob:b'))
        expect(await older).toBeNull()
        expect(await newer).toEqual([
            { src: 'blob:x', width: 10, height: 20, key: '1|x' },
            { src: 'blob:b', width: 10, height: 20, key: '1|b' },
        ])
    })

    test('U6b: one holder leaving does not cancel what another still references', async () => {
        const h = rig()
        const a = h.cache.createHolder()
        const b = h.cache.createHolder()
        void a.request(['x'], 1, [])
        const forB = b.request(['x'], 1, [])
        a.dispose()
        expect(h.callFor('x')[0].signal.aborted).toBe(false)
        expect(h.shrink).toHaveBeenCalledTimes(1)
        h.callFor('x')[0].d.resolve(shrunk('blob:x'))
        expect(await forB).toEqual([{ src: 'blob:x', width: 10, height: 20, key: '1|x' }])
        expect(h.cache.snapshotForTest().entries[0].refs).toBe(1)
    })

    test('U7: a cancelled outcome for a live entry is not cached', async () => {
        const h = rig()
        const holder = h.cache.createHolder()
        const request = holder.request(['x'], 1, [])
        h.callFor('x')[0].d.resolve({ kind: 'cancelled' })
        expect(await request).toBeNull()
        expect(h.cache.snapshotForTest().entries).toEqual([])
        void holder.request(['x'], 1, [])
        expect(h.callFor('x')).toHaveLength(2)
    })

    test('U8: a URL that arrives for a removed entry is revoked once and not cached', async () => {
        const h = rig()
        const holder = h.cache.createHolder()
        void holder.request(['x'], 1, [])
        holder.retain([])
        h.callFor('x')[0].d.resolve(shrunk('blob:late'))
        await turns()
        expect(h.revoke.mock.calls).toEqual([['blob:late']])
        expect(h.cache.snapshotForTest().entries).toEqual([])
    })

    test('U9: asking again for the pending key keeps its job', async () => {
        const h = rig()
        const holder = h.cache.createHolder()
        const first = holder.request(['x'], 1, [])
        const second = holder.request(['x'], 1, [])
        expect(h.callFor('x')[0].signal.aborted).toBe(false)
        expect(h.shrink).toHaveBeenCalledTimes(1)
        h.callFor('x')[0].d.resolve(shrunk('blob:x'))
        const expected = [{ src: 'blob:x', width: 10, height: 20, key: '1|x' }]
        expect(await first).toEqual(expected)
        expect(await second).toEqual(expected)
    })

    test('U11: one holder\'s repeated release leaves another holder\'s reference intact', async () => {
        const h = rig({ maxBytes: 30, maxEntries: 64 })
        const a = h.cache.createHolder()
        const b = h.cache.createHolder()
        const forA = a.request(['x'], 1, [])
        const forB = b.request(['x'], 1, [])
        h.callFor('x')[0].d.resolve(shrunk('blob:x'))
        await Promise.all([forA, forB])
        a.retain([])
        a.retain([])
        a.dispose()
        a.dispose()
        expect(h.cache.snapshotForTest().entries[0].refs).toBe(1)

        const c = h.cache.createHolder()
        const forC = c.request(['c'], 1, [])
        h.callFor('c')[0].d.resolve(shrunk('blob:c'))
        await forC
        c.retain([])
        expect(h.revoke.mock.calls).toEqual([['blob:c']])

        b.retain([])
        const d = h.cache.createHolder()
        const forD = d.request(['d'], 1, [])
        h.callFor('d')[0].d.resolve(shrunk('blob:d'))
        await forD
        expect(h.revoke.mock.calls).toEqual([['blob:c'], ['blob:x']])
    })
})

describe('outcomes settle only their own entry', () => {
    test.each([
        ['cancelled', { kind: 'cancelled' } as ShrinkOutcome],
        ['shrunk', shrunk('blob:j1', 5)],
        ['original', { kind: 'original' } as ShrinkOutcome],
    ])('U17: an old %s outcome leaves the replacement entry and its request untouched', async (_name, oldOutcome) => {
        const h = rig()
        const a = h.cache.createHolder()
        void a.request(['x'], 1, [])
        a.dispose()
        const b = h.cache.createHolder()
        const forB = b.request(['x'], 1, [])
        const [c1, c2] = h.callFor('x')
        expect(c1.signal.aborted).toBe(true)
        expect(c2.signal.aborted).toBe(false)

        c1.d.resolve(oldOutcome)
        await turns()
        const snapshot = h.cache.snapshotForTest()
        expect(snapshot.entries).toEqual([{ key: '1|x', state: 'pending', refs: 1, cost: 0 }])
        expect(snapshot.total).toBe(0)
        expect(h.revoke.mock.calls).toEqual(oldOutcome.kind === 'shrunk' ? [['blob:j1']] : [])

        c2.d.resolve(shrunk('blob:j2', 7))
        expect(await forB).toEqual([{ src: 'blob:j2', width: 10, height: 20, key: '1|x' }])
        expect(h.cache.snapshotForTest().entries).toEqual([{ key: '1|x', state: 'shrunk', refs: 1, cost: 7 + 2 * '1|x'.length }])
        expect(h.cache.snapshotForTest().total).toBe(7 + 2 * '1|x'.length)
        expect(h.revoke.mock.calls.some((call) => call[0] === 'blob:j2')).toBe(false)
    })
})

describe('the singleton', () => {
    test('U14: the reset hook revokes settled entries, cancels pending ones and starts a new cache', async () => {
        const signals: AbortSignal[] = []
        const outcomes = new Map<string, ReturnType<typeof deferred<ShrinkOutcome>>>()
        vi.mocked(shrinkPortrait).mockImplementation((src: string, _maxSide: number, signal: AbortSignal) => {
            signals.push(signal)
            const d = deferred<ShrinkOutcome>()
            outcomes.set(src, d)
            return d.promise
        })
        const cache = portraitCache()
        const holder = cache.createHolder()
        const settled = holder.request(['x'], 1, [])
        outcomes.get('x')?.resolve(shrunk('blob:x'))
        const images = (await settled) ?? []
        void holder.request(['y'], 1, images)
        resetPortraitCacheForTest()
        expect(vi.mocked(revokePortraitUrl).mock.calls).toEqual([['blob:x']])
        expect(signals[1].aborted).toBe(true)
        expect(portraitCache()).not.toBe(cache)
        void portraitCache().createHolder().request(['x'], 1, [])
        expect(vi.mocked(shrinkPortrait)).toHaveBeenCalledTimes(3)
    })
})
