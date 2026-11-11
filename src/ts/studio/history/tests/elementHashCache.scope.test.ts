// @vitest-environment node
// The cache remembers only the card that is open (MC-1453).
import { describe, expect, test, vi } from 'vitest'

const counts = vi.hoisted(() => ({ elem: 0 }))
vi.mock('../listFingerprint', async (importOriginal) => {
    const real = await importOriginal<typeof import('../listFingerprint')>()
    return {
        ...real,
        fingerprintElement: (value: unknown) => {
            counts.elem += 1
            return real.fingerprintElement(value)
        },
    }
})

import { createElementHashCache, type ElementHashCache } from '../elementHashCache'

function misses(run: () => void): number {
    const start = counts.elem
    run()
    return counts.elem - start
}

function pass(cache: ElementHashCache, list: readonly string[], scope: string): void {
    const hash = cache.forList(list, scope)
    for (const text of list) hash(text)
}

const texts = (tag: string, n: number, length: number) => Array.from({ length: n }, (_, i) => `${tag}${i}:`.padEnd(length, 'x'))

describe('Z the cache holds one scope', () => {
    test('Z1 a pass for another scope empties the cache before it hashes anything', () => {
        const cache = createElementHashCache()
        const a = texts('a', 50, 30)
        pass(cache, a, 'A')
        expect(cache.stats()).toMatchObject({ entries: 50, units: 1_500 })
        cache.forList([], 'B')
        expect(cache.stats()).toMatchObject({ entries: 0, units: 0 })
        expect(misses(() => pass(cache, a, 'A'))).toBe(50)
    })

    test('Z2 passes of the same scope keep it', () => {
        const cache = createElementHashCache()
        const a = texts('a', 50, 30)
        pass(cache, a, 'A')
        expect(misses(() => {
            pass(cache, a, 'A')
            pass(cache, [...a, 'new'], 'A')
            pass(cache, a, 'A')
        })).toBe(1)
    })

    test('Z5 the first pass after emptying sweeps nothing and stores the whole list', () => {
        const cache = createElementHashCache({ maxUnits: 30_000, maxEntries: 2_000, maxEntryUnits: 1_000 })
        pass(cache, texts('a', 2_000, 15), 'A')
        expect(cache.stats()).toMatchObject({ entries: 2_000, sweeps: 0 })
        const b = texts('b', 2_000, 15)
        pass(cache, b, 'B')
        expect(cache.stats()).toMatchObject({ entries: 2_000, units: 30_000, sweeps: 0 })
        expect(misses(() => pass(cache, b, 'B'))).toBe(0)
    })
})
