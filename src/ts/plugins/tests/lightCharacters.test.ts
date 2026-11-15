import { describe, expect, it } from 'vitest'
import { swapLightEntries, type LightWriteCounts } from '../lightCharacters'

const holder = (chaId: string): Record<string, unknown> => ({ chaId, name: `holder ${chaId}` })
const light = (chaId: string): Record<string, unknown> => ({ lightEntry: true, chaId, name: 'ignored' })
const freshCounts = (): LightWriteCounts => ({ lightKept: 0, lightLeftOut: 0 })

describe('swapLightEntries held slots', () => {
    it('reports the output index of every swapped entry, after a left-out entry shifts them', () => {
        const live = [holder('a'), holder('b'), holder('c')]
        const counts = freshCounts()
        const heldSlots = new Set<number>()
        const out = swapLightEntries(live, [light('missing'), light('a'), light('b'), light('c')], counts, heldSlots)
        expect(out).toEqual(live)
        expect(out[0]).toBe(live[0])
        expect([...heldSlots].sort()).toEqual([0, 1, 2])
        expect(counts).toEqual({ lightKept: 3, lightLeftOut: 1 })
    })

    it('does not report a pass-through element, and reports the slot of a light entry among full ones', () => {
        const live = [holder('a'), holder('b')]
        const full = holder('new')
        const heldSlots = new Set<number>()
        const out = swapLightEntries(live, [full, light('b'), light('a')], freshCounts(), heldSlots)
        expect(out).toEqual([full, live[1], live[0]])
        expect([...heldSlots].sort()).toEqual([1, 2])
    })

    it('maps duplicated ids to their holders in order and reports each output slot', () => {
        const live = [holder('x'), holder('y'), holder('x')]
        const heldSlots = new Set<number>()
        const out = swapLightEntries(live, [light('x'), light('x'), light('y')], freshCounts(), heldSlots)
        expect(out[0]).toBe(live[0])
        expect(out[1]).toBe(live[2])
        expect(out[2]).toBe(live[1])
        expect([...heldSlots].sort()).toEqual([0, 1, 2])
    })

    it('with no light entry returns the list as it is and reports no slot', () => {
        const live = [holder('a')]
        const incoming = [holder('a')]
        const heldSlots = new Set<number>()
        const counts = freshCounts()
        expect(swapLightEntries(live, incoming, counts, heldSlots)).toBe(incoming)
        expect(heldSlots.size).toBe(0)
        expect(counts).toEqual({ lightKept: 0, lightLeftOut: 0 })
    })

    it('leaves the counts and the list the same whether or not slots are asked for', () => {
        const live = [holder('a'), holder('b')]
        const incoming = [light('b'), light('gone'), light('a')]
        const plainCounts = freshCounts()
        const askedCounts = freshCounts()
        const plain = swapLightEntries(live, incoming, plainCounts)
        const asked = swapLightEntries(live, incoming, askedCounts, new Set<number>())
        expect(asked).toEqual(plain)
        expect(askedCounts).toEqual(plainCounts)
        expect(plainCounts).toEqual({ lightKept: 2, lightLeftOut: 1 })
    })
})
