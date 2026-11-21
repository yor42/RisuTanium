import { describe, expect, test, vi } from 'vitest'
import { ChatUnitIndex } from '../chatIndex'
import { HEADER, MIN_LEFT, packUnits, type PackLine } from '../pack'

const len = (s: string): number => Math.ceil(s.length / 4)

function lineOf(pos: number, text: string, off = 0): PackLine {
    return { unit: { key: `k${pos}`, ordinal: 0, off, text }, pos, label: String(pos), name: 'Bot', text, rank: pos + 1 }
}

function spies() {
    const countText = vi.fn(async (t: string) => len(t))
    const countBlock = vi.fn(async (b: string) => len(b) + 3)
    return { countText, countBlock }
}

describe('packUnits', () => {
    test('new rule: whole lines only, T within budget, chronological block, lowest rank drops first', async () => {
        const lines = [lineOf(5, 'x'.repeat(40)), lineOf(1, 'y'.repeat(40)), lineOf(3, 'z'.repeat(40))]
        const out = await packUnits({ lines, budget: 70, maxCounts: Infinity, ...spies() })
        expect(out.T).toBeLessThanOrEqual(70)
        expect(out.picks.length).toBeGreaterThan(0)
        const body = out.block.split('\n')
        expect(body[0]).toBe(HEADER)
        const poses = body.slice(1).map((l) => Number(/^\[#(\d+)\]/.exec(l)![1]))
        expect(poses).toEqual([...poses].sort((a, b) => a - b))
        for (const p of out.picks) expect(out.block).toContain(p.text)
        // The kept picks are a prefix of the ranked order, so the lowest-ranked one went first.
        expect(out.picks).toEqual(lines.slice(0, out.picks.length))
    })

    test('new rule: a block that counts over budget drops the last pick and recounts', async () => {
        const lines = [lineOf(0, 'a'.repeat(20)), lineOf(1, 'b'.repeat(20))]
        const countText = vi.fn(async (t: string) => len(t))
        // Lines fit one by one, but the assembled block counts 10 over, so one pick must go.
        const countBlock = vi.fn(async (b: string) => (b.includes('b'.repeat(20)) ? 999 : 20))
        const out = await packUnits({ lines, budget: 60, maxCounts: Infinity, countText, countBlock })
        expect(out.picks).toEqual([lines[0]])
        expect(out.T).toBe(20)
        expect(countBlock).toHaveBeenCalledTimes(2)
    })

    test('new rule: the walk stops once fewer than MIN_LEFT tokens remain', async () => {
        const visited: number[] = []
        const lines = (i: number): PackLine | undefined => {
            visited.push(i)
            return i < 10 ? lineOf(i, 'w'.repeat(30)) : undefined
        }
        const run = len(HEADER) + 1
        const lineCost = len('[#0] Bot: ' + 'w'.repeat(30)) + 1
        const budget = run + lineCost + (MIN_LEFT - 1)
        const out = await packUnits({ lines, budget, maxCounts: Infinity, ...spies() })
        expect(out.picks).toHaveLength(1)
        expect(visited).toEqual([0])
    })

    test('new rule: empty lines give no block and T 0, and the line function sees only visited indexes', async () => {
        const seen: number[] = []
        const out = await packUnits({ lines: (i) => (seen.push(i), undefined), budget: 100, maxCounts: Infinity, ...spies() })
        expect(out).toMatchObject({ picks: [], block: '', T: 0, capped: false })
        expect(seen).toEqual([0])
    })

    test('new rule: with a cache a line counted once is served from the cache, with the same slots', async () => {
        const lines = [lineOf(0, 'q'.repeat(40)), lineOf(1, 'r'.repeat(40))]
        const cache = new Map<string, number>()
        const s1 = spies()
        const cold = await packUnits({ lines, budget: 500, maxCounts: Infinity, cache, ...s1 })
        const s2 = spies()
        const warm = await packUnits({ lines, budget: 500, maxCounts: Infinity, cache, ...s2 })
        expect(s2.countText).not.toHaveBeenCalled()
        expect(warm.slots).toBe(cold.slots)
        expect(warm.counted).toBe(1)
        expect(cold.counted).toBe(cold.slots)
        expect(warm.picks).toEqual(cold.picks)
    })

    test('new rule: a varying-counter cap of 12 never makes more than 12 counter calls', async () => {
        const lines = Array.from({ length: 40 }, (_, i) => lineOf(i, 'p'.repeat(2000)))
        const s = spies()
        const out = await packUnits({ lines, budget: 100, maxCounts: 12, ...s })
        expect(s.countText.mock.calls.length + s.countBlock.mock.calls.length).toBeLessThanOrEqual(12)
        // Header plus ten lines, one slot kept back for the block.
        expect(s.countText).toHaveBeenCalledTimes(11)
        expect(out).toMatchObject({ picks: [], capped: true, T: 0 })
    })

    test('new rule: a drop loop that needs a slot beyond the cap returns no picks and capped', async () => {
        const lines = [lineOf(0, 'a'.repeat(8)), lineOf(1, 'b'.repeat(8))]
        const countBlock = vi.fn(async () => 9999)
        const out = await packUnits({ lines, budget: 100, maxCounts: 4, countText: async (t) => len(t), countBlock })
        expect(countBlock).toHaveBeenCalledTimes(1)
        expect(out).toMatchObject({ picks: [], block: '', T: 0, capped: true })
    })

    test('new rule: the cache does not change which lines are visited or picked', async () => {
        // The first 62 lines cannot fit; the 63rd would. A cap of 64 never reaches it, cached or not.
        const lines = Array.from({ length: 70 }, (_, i) => lineOf(i, (i < 62 ? 'L' : 's').repeat(i < 62 ? 4000 : 4)))
        const cache = new Map<string, number>()
        const cold = spies()
        const a = await packUnits({ lines, budget: 200, maxCounts: 64, cache, ...cold })
        const warm = spies()
        const b = await packUnits({ lines, budget: 200, maxCounts: 64, cache, ...warm })
        expect(a.picks).toEqual([])
        expect(b.picks).toEqual(a.picks)
        expect(a.capped).toBe(true)
        expect(b.capped).toBe(true)
        expect(b.slots).toBe(a.slots)
        expect(warm.countText).not.toHaveBeenCalled()
        expect(warm.countBlock).not.toHaveBeenCalled()
    })

    test('guard: a ranked index feeds the pack, so recall order survives packing', async () => {
        const idx = new ChatUnitIndex('c')
        idx.reconcile(
            ['alpha one', 'beta two', 'alpha three'].map((t, i) => ({ chatId: `c${i}`, index: i, role: 'user' as const, name: 'U', rawHash: String(i), preWrap: t })),
        )
        const { order } = idx.rank('alpha', 1)
        const lines = order.map((u, i) => lineOf(Number(u.key[1]), u.text, u.off))
        const out = await packUnits({ lines, budget: 500, maxCounts: Infinity, ...spies() })
        expect(out.picks.map((p) => p.text)).toEqual(['alpha three', 'alpha one', 'beta two'])
        expect(out.block.split('\n').slice(1).map((l) => l.replace(/^\[#\d+\] Bot: /, ''))).toEqual(['alpha one', 'beta two', 'alpha three'])
    })
})
