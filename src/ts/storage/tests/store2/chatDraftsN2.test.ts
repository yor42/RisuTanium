// @vitest-environment node
import { describe, expect, test } from 'vitest'
import type { Database } from '../../database.svelte'
import type { EncodedTree } from '../../store2/codec'
import { asDatabase, buildSmall, encodeWith, unitOf, type Obj } from './codecFixtures'

/**
 * N2 (#272): the draft unit at the 200-draft cap, 3 KB of text each, encoded through the real codec. The plan's bound
 * (R-3) is about 0.6 MB per flush with the base stored as a digest: the unit must stay within the draft text it carries
 * plus a fixed allowance for keys, digests and framing. Encode time is recorded, not asserted (hardware dependent; the
 * plan's 15 ms memo rule is judged from the recorded numbers).
 */

const DRAFTS = 200
const TEXT_BYTES = 3000
const PER_CHAT = 4
const NOW = 1_700_000_000_000

/** Deterministic text that does not compress away: a linear congruential stream over a 64-letter alphabet with spaces. */
function text(seed: number): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,'
    let state = (seed * 2654435761) >>> 0
    let out = ''
    for (let i = 0; i < TEXT_BYTES; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        out += alphabet[state >>> 26]
    }
    return out
}

function cappedDrafts(): Obj[] {
    const entries: Obj[] = []
    for (let n = 0; n < DRAFTS; n++) {
        const chat = Math.floor(n / PER_CHAT)
        if (n % PER_CHAT === 0) entries.push({ cha: `c${chat % 10}`, chat: `k${chat}`, drafts: [] })
        ;(entries[entries.length - 1].drafts as Obj[]).push({ m: `id:m${n}`, text: text(n + 1), bh: n.toString(16).padStart(32, '0'), at: NOW + n })
    }
    return entries
}

function profile(chatDrafts?: Obj[]): Database {
    return asDatabase({ ...buildSmall(2) as unknown as Obj, ...(chatDrafts === undefined ? {} : { chatDrafts }) })
}

function medianMs(run: () => EncodedTree): number {
    const times: number[] = []
    for (let i = 0; i < 7; i++) {
        const start = performance.now()
        run()
        times.push(performance.now() - start)
    }
    times.sort((a, b) => a - b)
    return times[3]
}

describe('N2: the draft unit at the cap', () => {
    test('200 drafts of 3 KB encode into one unit within the plan bound; size and encode time are recorded', () => {
        const drafts = cappedDrafts()
        const withDrafts = profile(drafts)
        const unit = unitOf(encodeWith(withDrafts), 'chatDrafts')
        const textBytes = DRAFTS * TEXT_BYTES

        expect(unit.type).toBe(30)
        // A first encode writes every unit; only a written unit carries its bytes.
        if (unit.reused !== false) throw new Error('the first encode must write the draft unit')
        expect(unit.bytes.length).toBeGreaterThan(textBytes / 2)
        expect(unit.bytes.length).toBeLessThanOrEqual(textBytes + 100_000)

        const without = medianMs(() => encodeWith(profile()))
        const withCap = medianMs(() => encodeWith(withDrafts))
        console.log(`N2 chatDrafts unit: ${unit.bytes.length} bytes for ${DRAFTS} drafts x ${TEXT_BYTES} chars; encode median ${withCap.toFixed(1)} ms with, ${without.toFixed(1)} ms without (difference ${(withCap - without).toFixed(1)} ms, this host)`)
    })
})
