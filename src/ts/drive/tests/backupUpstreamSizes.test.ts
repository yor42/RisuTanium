// @vitest-environment happy-dom
/**
 * The size sources of the 100 MiB backup warning (`drive/backupUpstreamSizes.ts`): the threshold is strict, the
 * Node page asks the server once and the desktop page uses the listing it already has. Sizes are faked: a value reports a length it does not hold, so no test
 * allocates 100 MiB.
 *
 * Reproducers fail on the code before this module existed; "guard" tests state what must not move.
 */
import { describe, expect, test, vi } from 'vitest'
import type { ByteStore } from 'src/ts/storage/store/contract'
import {
    UPSTREAM_NODE_ASSET_LIMIT_BYTES,
    findOversizeAssets,
    formatMiB,
    isOversizeForUpstream,
    shownPromptNames,
} from 'src/ts/drive/backupUpstreamSizes'

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

const base = (store: ByteStore) => ({ store, sized: null, keys: null })

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
        expect(await findOversizeAssets({ ...base(probe.store), kind: 'tauri' })).toEqual([])
        expect(probe.reads).toEqual([])
    })
})

describe('findOversizeAssets, Node page', () => {
    test('reproducer: asks the server for the keys above 100 MiB under assets/ once and reads nothing', async () => {
        const listSized = vi.fn(async () => [{ key: 'assets/big', size: LIMIT + 5 }])
        const probe = storeOf({}, listSized)
        const found = await findOversizeAssets({ ...base(probe.store), kind: 'node' })
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
