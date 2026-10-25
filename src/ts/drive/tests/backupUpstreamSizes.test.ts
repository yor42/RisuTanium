// @vitest-environment happy-dom
/**
 * The size sources of the 100 MiB backup warning (`drive/backupUpstreamSizes.ts`): the threshold is strict, the
 * Node page asks the server once, the desktop page uses the listing it already has, and the browser pre-pass reads one
 * asset at a time and keeps only its size. Sizes are faked: a value reports a length it does not hold, so no test
 * allocates 100 MiB.
 *
 * Reproducers fail on the code before this module existed; "guard" tests state what must not move.
 */
import { describe, expect, test, vi } from 'vitest'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { ExportCancelToken } from 'src/ts/exportCancel'
import {
    UPSTREAM_NODE_ASSET_LIMIT_BYTES,
    findOversizeAssets,
    formatMiB,
    isOversizeForUpstream,
    shownPromptNames,
} from 'src/ts/drive/backupUpstreamSizes'

// The cancel token's module reaches the alert and the application stores only for its wait dialog, which no test here opens.
vi.mock('src/ts/alert', () => ({ alertClear: vi.fn(), alertWait: vi.fn() }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { alertStore: writable({ type: 'none', msg: '' }) }
})

const LIMIT = 104857600

/** A value that reports `length` bytes and holds one. */
function lengthLike(length: number): Uint8Array {
    const value = new Uint8Array(1)
    Object.defineProperty(value, 'length', { value: length })
    return value
}

interface Probe {
    store: ByteStore
    reads: string[]
    maxInFlight: () => number
    heldAfterRead: () => number
}

/** A store whose `read` serves `sizes` and records how many reads overlapped. */
function storeOf(sizes: Record<string, number | 'absent' | 'error'>, listSized?: ByteStore['listSized']): Probe {
    const reads: string[] = []
    let inFlight = 0
    let maxInFlight = 0
    const store = {
        capabilities: { conditionalWrites: false },
        async read(key: string) {
            reads.push(key)
            inFlight++
            maxInFlight = Math.max(maxInFlight, inFlight)
            await new Promise((resolve) => setTimeout(resolve, 1))
            inFlight--
            const size = sizes[key]
            if (size === 'error') {
                throw new Error('unreadable')
            }
            return { bytes: size === undefined || size === 'absent' ? null : lengthLike(size), version: null }
        },
        listSized,
    } as unknown as ByteStore
    return { store, reads, maxInFlight: () => maxInFlight, heldAfterRead: () => inFlight }
}

describe('the threshold', () => {
    test('guard: it is 100 MiB and strictly above it is oversize', () => {
        expect(UPSTREAM_NODE_ASSET_LIMIT_BYTES).toBe(LIMIT)
        expect(isOversizeForUpstream(LIMIT)).toBe(false)
        expect(isOversizeForUpstream(LIMIT + 1)).toBe(true)
        expect(isOversizeForUpstream(0)).toBe(false)
    })

    test('guard: sizes are shown in MiB with one decimal', () => {
        expect(formatMiB(150 * 1024 * 1024)).toBe('150.0 MiB')
        expect(formatMiB(LIMIT + 1)).toBe('100.0 MiB')
    })

    test('guard: a long name list is cut to 20 names of at most 100 characters', () => {
        const names = Array.from({ length: 30 }, (_, i) => `${i}-${'x'.repeat(150)}`)
        const shown = shownPromptNames(names)
        expect(shown).toHaveLength(20)
        expect(shown[0]).toBe(`0-${'x'.repeat(98)}...`)
        expect(shownPromptNames(['short'])).toEqual(['short'])
    })
})

const base = (store: ByteStore) => ({ store, sized: null, keys: null, listedKeys: [] as string[], cancel: new ExportCancelToken() })

describe('findOversizeAssets, desktop and Android', () => {
    test('reproducer: names the listed assets strictly above 100 MiB with their sizes and reads nothing', async () => {
        const probe = storeOf({})
        const found = await findOversizeAssets({
            ...base(probe.store),
            kind: 'tauri',
            sized: [{ key: 'assets/a', size: LIMIT }, { key: 'assets/b', size: LIMIT + 1 }, { key: 'assets/c', size: 5 }],
        })
        expect(found).toEqual([{ key: 'assets/b', size: LIMIT + 1 }])
        expect(probe.reads).toEqual([])
    })

    test('reproducer: a partial backup judges only its keys', async () => {
        const probe = storeOf({})
        const found = await findOversizeAssets({
            ...base(probe.store),
            kind: 'tauri',
            sized: [{ key: 'assets/a', size: LIMIT + 1 }, { key: 'assets/b', size: LIMIT + 2 }],
            keys: ['assets/b'],
        })
        expect(found).toEqual([{ key: 'assets/b', size: LIMIT + 2 }])
    })

    test('guard: no sized listing names nothing and reads nothing', async () => {
        const probe = storeOf({ 'assets/a': LIMIT + 1 })
        expect(await findOversizeAssets({ ...base(probe.store), kind: 'tauri', listedKeys: ['assets/a'] })).toEqual([])
        expect(probe.reads).toEqual([])
    })
})

describe('findOversizeAssets, Node page', () => {
    test('reproducer: asks the server for the keys above 100 MiB under assets/ once and reads nothing', async () => {
        const listSized = vi.fn(async () => [{ key: 'assets/big', size: LIMIT + 5 }])
        const probe = storeOf({}, listSized)
        const found = await findOversizeAssets({ ...base(probe.store), kind: 'node', listedKeys: ['assets/big'] })
        expect(found).toEqual([{ key: 'assets/big', size: LIMIT + 5 }])
        expect(listSized).toHaveBeenCalledExactlyOnceWith('assets/', LIMIT)
        expect(probe.reads).toEqual([])
    })

    test('guard: a server that cannot answer (null) or a store without the method names nothing: such a server cannot hold more than 100 MiB', async () => {
        const unanswered = storeOf({}, async () => null)
        expect(await findOversizeAssets({ ...base(unanswered.store), kind: 'node' })).toEqual([])
        const lacking = storeOf({})
        expect(await findOversizeAssets({ ...base(lacking.store), kind: 'node' })).toEqual([])
        expect(lacking.reads).toEqual([])
    })

    test('reproducer: a partial backup judges only its keys', async () => {
        const probe = storeOf({}, async () => [{ key: 'assets/a', size: LIMIT + 1 }, { key: 'assets/b', size: LIMIT + 2 }])
        const found = await findOversizeAssets({ ...base(probe.store), kind: 'node', keys: ['assets/a'] })
        expect(found).toEqual([{ key: 'assets/a', size: LIMIT + 1 }])
    })

    test('guard: a failing listing is the caller\'s error, not an empty answer', async () => {
        const probe = storeOf({}, async () => { throw new Error('network') })
        await expect(findOversizeAssets({ ...base(probe.store), kind: 'node' })).rejects.toThrow('network')
    })
})

describe('findOversizeAssets, browser pre-pass', () => {
    const listedKeys = ['assets/small', 'assets/exact', 'assets/over', 'assets/gone', 'assets/broken', 'database/main']

    function browserStore() {
        return storeOf({ 'assets/small': 10, 'assets/exact': LIMIT, 'assets/over': LIMIT + 1, 'assets/gone': 'absent', 'assets/broken': 'error', 'database/main': LIMIT * 3 })
    }

    for (const kind of ['indexeddb', 'opfs-transitional'] as const) {
        test(`reproducer (${kind}): reads each asset once, one at a time, and names only the ones strictly above 100 MiB`, async () => {
            const probe = browserStore()
            const seen: Array<[number, number]> = []
            const found = await findOversizeAssets({
                ...base(probe.store),
                kind,
                listedKeys,
                onProgress: (done, total) => seen.push([done, total]),
            })
            expect(found).toEqual([{ key: 'assets/over', size: LIMIT + 1 }])
            expect(probe.reads).toEqual(['assets/small', 'assets/exact', 'assets/over', 'assets/gone', 'assets/broken'])
            expect(probe.maxInFlight()).toBe(1)
            expect(probe.heldAfterRead()).toBe(0)
            expect(seen).toEqual([[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]])
        })
    }

    test('reproducer: a partial backup reads only its own keys', async () => {
        const probe = browserStore()
        const found = await findOversizeAssets({ ...base(probe.store), kind: 'indexeddb', keys: ['assets/over', 'assets/small', 'outside/file'], listedKeys })
        expect(found).toEqual([{ key: 'assets/over', size: LIMIT + 1 }])
        expect(probe.reads).toEqual(['assets/over', 'assets/small'])
    })

    test('reproducer: a cancel raised as the second asset is announced lets that read finish and stops before the third', async () => {
        const probe = browserStore()
        const cancel = new ExportCancelToken()
        const run = findOversizeAssets({ ...base(probe.store), kind: 'indexeddb', listedKeys, cancel, onProgress: (done) => { if (done === 2) { cancel.cancel() } } })
        await expect(run).rejects.toBeDefined()
        expect(probe.reads).toEqual(['assets/small', 'assets/exact'])
    })
})
