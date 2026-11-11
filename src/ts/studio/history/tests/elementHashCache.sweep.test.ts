// @vitest-environment node
// Workload bounds of the cache, counted, never timed. Each shape holds
// more than 1,024 entries, so a rule that bounds work per store but not per pass shows here.
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

function pass(cache: ElementHashCache, list: readonly string[]): void {
    const hash = cache.forList(list, 'c')
    for (const text of list) hash(text)
}

const texts = (tag: string, n: number, length: number) => Array.from({ length: n }, (_, i) => `${tag}${i}:`.padEnd(length, 'x'))

type Method = (...args: never[]) => unknown

// Container operations done while `run` runs: array elements pushed or spliced, Map sets and deletes,
// and Map iteration steps. Map gets are not counted: a pass makes one per element whatever the rule.
function countWork(run: () => void): number {
    let work = 0
    const arrayProto = Array.prototype as unknown as Record<string, Method>
    const mapProto = Map.prototype as unknown as Record<string | symbol, Method>
    const saved = new Map<string | symbol, Method>()
    const replace = (target: Record<string | symbol, Method>, key: string | symbol, make: (original: Method) => Method) => {
        const original = target[key]
        saved.set(target === mapProto ? key : `array:${String(key)}`, original)
        target[key] = make(original)
    }
    const counted = (iterator: Iterator<unknown>): IterableIterator<unknown> => ({
        next() {
            work += 1
            return iterator.next()
        },
        [Symbol.iterator]() {
            return this
        },
    })
    replace(arrayProto, 'push', (original) => function (this: unknown[], ...items: unknown[]) {
        work += items.length
        return (original as unknown as (...a: unknown[]) => number).apply(this, items)
    } as unknown as Method)
    replace(arrayProto, 'splice', (original) => function (this: unknown[], ...args: unknown[]) {
        const removed = (original as unknown as (...a: unknown[]) => unknown[]).apply(this, args)
        work += removed.length + Math.max(0, args.length - 2)
        return removed
    } as unknown as Method)
    for (const key of ['set', 'delete'] as const) {
        replace(mapProto, key, (original) => function (this: Map<unknown, unknown>, ...args: unknown[]) {
            work += 1
            return (original as unknown as (...a: unknown[]) => unknown).apply(this, args)
        } as unknown as Method)
    }
    for (const key of [Symbol.iterator, 'entries', 'keys', 'values'] as const) {
        replace(mapProto, key, (original) => function (this: Map<unknown, unknown>) {
            return counted((original as unknown as () => Iterator<unknown>).call(this))
        } as unknown as Method)
    }
    try {
        run()
    } finally {
        for (const [key, original] of saved) {
            if (typeof key === 'string' && key.startsWith('array:')) arrayProto[key.slice(6)] = original
            else mapProto[key] = original
        }
    }
    return work
}

describe('SW1 one sweep per pass', () => {
    test('a pass of new texts into a cache full of the previous pass\'s entries sweeps once and does work in proportion to the list and the entries held', () => {
        const cache = createElementHashCache({ maxUnits: 1_000_000_000, maxEntries: 4_000, maxEntryUnits: 1_000 })
        const before = texts('p', 4_000, 20)
        pass(cache, before)
        pass(cache, before)
        const list = texts('q', 3_000, 20)
        const sweeps = cache.stats().sweeps
        let missed = 0
        const work = countWork(() => {
            missed = misses(() => pass(cache, list))
        })
        expect(work).toBeLessThanOrEqual(2 * (list.length + 4_000))
        expect(cache.stats().sweeps - sweeps).toBe(1)
        expect(missed).toBe(3_000)
    })
})

describe('SW2 convergence', () => {
    test('a replaced list of one card stops missing by its third pass, and passes after the first read at most one list', () => {
        // Each list fits the 400,000 units alone; together they do not.
        const cache = createElementHashCache({ maxUnits: 400_000, maxEntries: 32_768, maxEntryUnits: 100_000 })
        const first = texts('a', 6_000, 40)
        const second = texts('b', 6_000, 40)
        for (let k = 0; k < 3; k++) pass(cache, first)
        const perPass: number[] = []
        for (let k = 0; k < 12; k++) {
            perPass.push(misses(() => pass(cache, second)))
            if (perPass[k] === 0) break
        }
        expect(perPass.length).toBeLessThanOrEqual(3)
        expect(perPass.at(-1)).toBe(0)
        expect(perPass.slice(1).reduce((sum, n) => sum + n, 0)).toBeLessThanOrEqual(second.length)
    })
})

describe('SW3 no starvation', () => {
    test('three lists of one card in turn, any two of which fit: after a finished warm pass no action misses', () => {
        // Three lists of 3,000 x 37 units in 250,000: the census shape scaled down by ten.
        const cache = createElementHashCache({ maxUnits: 250_000, maxEntries: 32_768, maxEntryUnits: 100_000 })
        const cards = ['x', 'y', 'z'].map((tag) => texts(tag, 3_000, 37))
        const actions: number[] = []
        for (let visit = 0; visit < 12; visit++) {
            const card = cards[visit % 3]
            pass(cache, card)
            actions.push(misses(() => {
                pass(cache, card)
                pass(cache, card)
            }))
        }
        expect(actions).toEqual(new Array<number>(12).fill(0))
    })
})

describe('SW4 a bulk change outside the history inside one card', () => {
    test('the changed messages are read in at most two passes', () => {
        const cache = createElementHashCache({ maxUnits: 300_000, maxEntries: 32_768, maxEntryUnits: 100_000 })
        const card = texts('e', 6_000, 40)
        for (let k = 0; k < 3; k++) pass(cache, card)
        for (let i = 0; i < card.length; i += 2) card[i] = `n${i}:`.padEnd(40, 'y')
        const perPass = [0, 0, 0].map(() => misses(() => pass(cache, card)))
        expect(perPass[2]).toBe(0)
        expect(perPass[0] + perPass[1]).toBeLessThanOrEqual(2 * 3_000)
    })
})

describe('SW5 the no-more-sweeps rule ends with its pass', () => {
    test('texts refused in one pass are stored in the next pass when they fit', () => {
        const cache = createElementHashCache({ maxUnits: 1_000_000, maxEntries: 1_500, maxEntryUnits: 1_000 })
        const first = texts('a', 1_500, 10)
        const second = texts('b', 1_500, 10)
        pass(cache, first)
        expect(misses(() => pass(cache, second))).toBe(1_500)
        expect(cache.stats()).toMatchObject({ entries: 1_500, sweeps: 1 })
        expect(misses(() => pass(cache, second))).toBe(1_500)
        expect(cache.stats()).toMatchObject({ entries: 1_500, sweeps: 2 })
        expect(misses(() => pass(cache, second))).toBe(0)
    })
})

describe('SW6 a sweep never drops a text of the current or the previous pass', () => {
    test('a card one message short of the cap, three messages changed outside per round: each pass misses only new texts', () => {
        // 1,249 x 12 units in 15,000: one message of room.
        const cache = createElementHashCache({ maxUnits: 15_000, maxEntries: 32_768, maxEntryUnits: 1_000 })
        const n = 1_249
        const card = texts('g', n, 12)
        pass(cache, card)
        pass(cache, card)
        for (let round = 0; round < 60; round++) {
            const changed = new Set<number>()
            for (let k = 0; k < 3; k++) {
                const slot = (round * 31 + k * 97) % n
                changed.add(slot)
                card[slot] = `o${round}-${k}-${slot}:`.padEnd(12, 'y')
            }
            expect(misses(() => pass(cache, card))).toBe(changed.size)
            expect(misses(() => pass(cache, card))).toBeLessThanOrEqual(changed.size)
        }
    })

    test('a hit marks its pass: texts read in the previous pass survive a sweep of the current one', () => {
        const cache = createElementHashCache({ maxUnits: 1_000_000, maxEntries: 1_500, maxEntryUnits: 1_000 })
        const card = texts('h', 1_499, 10)
        pass(cache, card)
        pass(cache, card)
        const next = ['new0:'.padEnd(10, 'n'), 'new1:'.padEnd(10, 'n'), ...card]
        expect(misses(() => pass(cache, next))).toBe(2)
    })
})
