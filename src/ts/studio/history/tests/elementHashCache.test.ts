// The cache returns fingerprintElement's value for every input, and
// its bounds and pass rules.
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

import { createElementHashCache } from '../elementHashCache'
import { listFingerprintOf } from '../listFingerprint'

// The reference, read from the real module so the counter above does not see it.
const realModule = await vi.importActual<typeof import('../listFingerprint')>('../listFingerprint')
const reference = realModule.fingerprintElement

function rng(seed: number): () => number {
    let s = seed >>> 0 || 1
    return () => {
        s ^= s << 13
        s >>>= 0
        s ^= s >>> 17
        s ^= s << 5
        s >>>= 0
        return s / 4294967296
    }
}

function rebuilt(text: string): string {
    return text.split('').join('')
}

function corpus(next: () => number): unknown[] {
    const values: unknown[] = [undefined, null, 0, -0, NaN, 1, true, false, {}, [], Symbol('s'), 10n, () => 1, '', 'a', '\uD800', '\uDC00x', 'x\uD800']
    for (const length of [1, 2, 100, 16_383, 16_384, 16_385, 50_000]) {
        const base = 'b'.repeat(length)
        values.push(base, rebuilt(base))
        for (const at of [0, Math.floor(length / 2), length - 1]) {
            const variant = base.slice(0, at) + 'c' + base.slice(at + 1)
            values.push(variant, rebuilt(variant))
        }
    }
    for (let i = 0; i < 40; i++) {
        const length = 16_384 + (i % 3)
        const shared = 'p'.repeat(length - 1)
        values.push(shared + String.fromCharCode(0xac00 + i))
    }
    for (let i = 0; i < 200; i++) {
        const length = Math.floor(next() * 300)
        let text = ''
        for (let j = 0; j < length; j++) text += String.fromCharCode(next() < 0.1 ? 0xd800 + Math.floor(next() * 0x800) : 0x20 + Math.floor(next() * 0xac00))
        values.push(text)
    }
    return values
}

describe('C1 oracle: cached value equals fingerprintElement', () => {
    test('every value, repeated, outside a pass, and in short passes that sweep all the time', () => {
        const next = rng(7)
        const values = corpus(next)
        const plain = createElementHashCache()
        const tiny = createElementHashCache({ maxUnits: 20_000, maxEntries: 5, maxEntryUnits: 16_384 })
        let inTiny = tiny.forList([], 'c')
        let mismatches = 0
        for (let round = 0; round < 3; round++) {
            for (let i = 0; i < values.length; i++) {
                const value = values[Math.floor(next() * values.length)]
                if (i % 7 === 0) inTiny = tiny.forList([], 'c')
                if (!Object.is(plain.hash(value), reference(value))) mismatches += 1
                if (!Object.is(inTiny(value), reference(value))) mismatches += 1
            }
        }
        expect(mismatches).toBe(0)
        expect(tiny.stats().sweeps).toBeGreaterThan(10)
    })

    test('a list fingerprint through the cache equals the plain one, holes included', () => {
        const cache = createElementHashCache()
        // eslint-disable-next-line no-sparse-arrays
        const lists: unknown[][] = [[], ['a', , 'b'], [undefined], [null, 'x', 0], ['same', 'same'], ['b'.repeat(16_384), 'b'.repeat(16_383) + 'c']]
        for (const list of lists) {
            expect(listFingerprintOf(list, cache.forList(list, 'c'))).toBe(realModule.listFingerprintOf(list))
            expect(listFingerprintOf(list, cache.forList(list, 'c'))).toBe(realModule.listFingerprintOf(list))
            expect(listFingerprintOf(list, cache.hash)).toBe(realModule.listFingerprintOf(list))
        }
    })
})

function misses(run: () => void): number {
    const start = counts.elem
    run()
    return counts.elem - start
}

describe('C2 bound: units and entries', () => {
    test('a sweep drops what the last two passes did not meet, and only that', () => {
        const cache = createElementHashCache({ maxUnits: 10, maxEntries: 3, maxEntryUnits: 6 })
        const pass = (list: readonly string[]) => {
            const h = cache.forList(list, 'c')
            for (const text of list) h(text)
        }
        pass(['aaaa', 'bbb'])
        pass(['cc'])
        expect(cache.stats()).toEqual({ entries: 3, units: 9, sweeps: 0 })
        pass(['dd'])
        expect(cache.stats()).toEqual({ entries: 2, units: 4, sweeps: 1 })
        expect(misses(() => pass(['cc', 'dd']))).toBe(0)
        expect(misses(() => pass(['aaaa']))).toBe(1)
    })

    test('a text over the per-entry limit is never stored; outside a pass nothing is evicted', () => {
        const cache = createElementHashCache({ maxUnits: 10, maxEntries: 3, maxEntryUnits: 6 })
        expect(misses(() => {
            cache.hash('fffffff')
            cache.hash('fffffff')
        })).toBe(2)
        const inPass = cache.forList(['fffffff'], 'c')
        expect(misses(() => {
            inPass('fffffff')
            inPass('fffffff')
        })).toBe(2)
        expect(cache.stats()).toEqual({ entries: 0, units: 0, sweeps: 0 })
        for (const text of ['aa', 'bb', 'cc', 'dd']) cache.hash(text)
        expect(cache.stats()).toEqual({ entries: 3, units: 6, sweeps: 0 })
        expect(misses(() => cache.hash('dd'))).toBe(1)
        expect(cache.hash('fffffff')).toBe(reference('fffffff'))
    })

    test('a text of exactly the per-entry limit is stored in a pass', () => {
        const cache = createElementHashCache({ maxUnits: 10, maxEntries: 3, maxEntryUnits: 6 })
        const inPass = cache.forList(['ffffff'], 'c')
        expect(misses(() => {
            inPass('ffffff')
            inPass('ffffff')
        })).toBe(1)
        expect(cache.stats()).toEqual({ entries: 1, units: 6, sweeps: 0 })
    })

    test('non-strings are never stored', () => {
        const cache = createElementHashCache({ maxUnits: 10, maxEntries: 3, maxEntryUnits: 6 })
        const h = cache.forList([], 'c')
        for (const value of [undefined, null, 1, true, {}]) {
            cache.hash(value)
            h(value)
        }
        expect(cache.stats()).toEqual({ entries: 0, units: 0, sweeps: 0 })
    })

    test('the bound holds after every call of a random run', () => {
        const next = rng(11)
        const cache = createElementHashCache({ maxUnits: 500, maxEntries: 7, maxEntryUnits: 200 })
        let h = cache.forList([], 'c')
        let broken = 0
        for (let i = 0; i < 5_000; i++) {
            if (next() < 0.1) h = next() < 0.2 ? cache.hash : cache.forList([], 'c')
            const text = 'z'.repeat(Math.floor(next() * 260)) + (i % 37)
            if (h(text) !== reference(text)) broken += 1
            const stats = cache.stats()
            if (stats.units > 500 || stats.entries > 7) broken += 1
        }
        expect(broken).toBe(0)
    })
})

describe('K6 a warm card keeps its messages', () => {
    // A card of 30 x 40 units in a 2,000-unit cache; other cards fill the rest. Each round edits one
    // message, then runs an action (two passes), as the service does.
    for (const slot of [0, 15, 29]) {
        test(`a warm card that fits is never read whole again after other cards' stores (edited slot ${slot})`, () => {
            const cache = createElementHashCache({ maxUnits: 2_000, maxEntries: 64, maxEntryUnits: 1_000 })
            const pass = (list: readonly unknown[]) => listFingerprintOf(list, cache.forList(list, 'c'))
            const card = Array.from({ length: 30 }, (_, i) => `c${i}:`.padEnd(40, 'x'))
            pass(card)
            pass(card)
            for (let k = 0; k < 2; k++) {
                const other = Array.from({ length: 10 }, (_, i) => `o${k}-${i}:`.padEnd(38, 'z'))
                pass(other)
                pass(other)
            }
            expect(misses(() => pass(card))).toBe(0)
            const perRound: number[] = []
            for (let round = 0; round < 40; round++) {
                card[slot] = `e${round}:`.padEnd(40, 'w')
                perRound.push(misses(() => {
                    pass(card)
                    pass(card)
                }))
            }
            expect(Math.max(...perRound)).toBeLessThanOrEqual(2)
        })
    }
})

describe('K8 a pass never evicts what it stored itself', () => {
    test('warming a card right after two other cards were used keeps the new card for its first action', () => {
        const cache = createElementHashCache({ maxUnits: 2_000, maxEntries: 200, maxEntryUnits: 1_000 })
        const pass = (list: readonly unknown[]) => listFingerprintOf(list, cache.forList(list, 'c'))
        const cards = ['x', 'y', 'z'].map((tag) => Array.from({ length: 22 }, (_, i) => `${tag}${i}:`.padEnd(40, tag)))
        const actionMisses: number[] = []
        for (let visit = 0; visit < 9; visit++) {
            const card = cards[visit % 3]
            pass(card)
            actionMisses.push(misses(() => {
                pass(card)
                pass(card)
            }))
        }
        expect(Math.max(...actionMisses)).toBeLessThanOrEqual(1)
    })
})

describe('X1 a list larger than the cache is hashed lookup-only', () => {
    test('over the unit limit and over the entry limit nothing is stored; a stored text is still a hit', () => {
        const cache = createElementHashCache({ maxUnits: 100, maxEntries: 5, maxEntryUnits: 100 })
        const fits = ['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(30)]
        listFingerprintOf(fits, cache.forList(fits, 'c'))
        expect(cache.stats()).toMatchObject({ entries: 3, units: 90 })
        const overUnits = ['d'.repeat(60), 'e'.repeat(50)]
        const overCount = ['1', '2', '3', '4', '5', '6']
        for (const list of [overUnits, overCount]) {
            for (let i = 0; i < 2; i++) {
                const n = misses(() => expect(listFingerprintOf(list, cache.forList(list, 'c'))).toBe(realModule.listFingerprintOf(list)))
                expect(n).toBe(list.length)
                expect(cache.stats()).toMatchObject({ entries: 3, units: 90 })
            }
        }
        const mixed = [fits[0], 'f'.repeat(80)]
        expect(misses(() => listFingerprintOf(mixed, cache.forList(mixed, 'c')))).toBe(1)
        expect(cache.stats()).toMatchObject({ entries: 3, units: 90 })
    })

    test('X1b a stored text read by a lookup-only pass is kept by the sweep of the next pass', () => {
        const cache = createElementHashCache({ maxUnits: 100, maxEntries: 10, maxEntryUnits: 100 })
        const card = ['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(30)]
        listFingerprintOf(card, cache.forList(card, 'c'))
        listFingerprintOf([], cache.forList([], 'c'))
        const over = [...card, 'd'.repeat(60)]
        listFingerprintOf(over, cache.forList(over, 'c'))
        const other = ['e'.repeat(20)]
        listFingerprintOf(other, cache.forList(other, 'c'))
        expect(cache.stats()).toMatchObject({ entries: 3, units: 90, sweeps: 1 })
        expect(misses(() => listFingerprintOf(card, cache.forList(card, 'c')))).toBe(0)
    })
})
