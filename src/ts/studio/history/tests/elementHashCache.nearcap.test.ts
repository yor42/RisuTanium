// The pass rule on a card that nearly fills the cache.
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

describe('K10 a card that nearly fills the cache keeps its unchanged messages across outside edits', () => {
    test('each round three messages change outside the history, then a two-pass action reads little more than the new texts', () => {
        // 249 x 12 units in a 3,000-unit cache: one message of room, as a 2.49 M card in the 2.5 M cache.
        const cache = createElementHashCache({ maxUnits: 3_000, maxEntries: 1_000, maxEntryUnits: 1_000 })
        const pass = (list: readonly unknown[]) => listFingerprintOf(list, cache.forList(list, 'c'))
        const n = 249
        const card = Array.from({ length: n }, (_, i) => `g${i}:`.padEnd(12, 'x'))
        pass(card)
        pass(card)
        const perRound: number[] = []
        for (let round = 0; round < 200; round++) {
            for (let k = 0; k < 3; k++) {
                const slot = (round * 31 + k * 97) % n
                card[slot] = `o${round}-${k}-${slot}:`.padEnd(12, 'y')
            }
            const start = counts.elem
            pass(card)
            pass(card)
            perRound.push(counts.elem - start)
        }
        // Three new texts per round, each read at most twice when its first store is refused.
        expect(Math.max(...perRound)).toBeLessThanOrEqual(6)
    })
})
