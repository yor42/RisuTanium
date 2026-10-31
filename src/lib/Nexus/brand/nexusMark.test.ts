import { describe, expect, test } from 'vitest'
import { markInner, progressPercent, progressStyle } from './nexusMark'

describe('progressPercent', () => {
    test('clamps to 0..100 and rounds to a whole percent', () => {
        expect(progressPercent(-1)).toBe(0)
        expect(progressPercent(0)).toBe(0)
        expect(progressPercent(0.426)).toBe(43)
        expect(progressPercent(1)).toBe(100)
        expect(progressPercent(7)).toBe(100)
    })

    test('reads non-finite input as 0', () => {
        expect(progressPercent(NaN)).toBe(0)
        expect(progressPercent(Infinity)).toBe(0)
        expect(progressPercent(-Infinity)).toBe(0)
    })

    test('progressStyle carries the remaining share of the ring', () => {
        expect(progressStyle(0.25)).toBe('--nm-progress-offset: 75')
        expect(progressStyle(9)).toBe('--nm-progress-offset: 0')
    })
})

describe('markInner ids', () => {
    const idsOf = (markup: string): string[] => [...markup.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1])

    test('a hostile uid cannot leave the id attribute or add markup', () => {
        const markup = markInner('a"><script>x</script> b')
        const ids = idsOf(markup)
        expect(ids.length).toBeGreaterThan(0)
        for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]+$/)
        expect(markup).not.toContain('<script')
    })

    test('different uids give disjoint id sets and every reference resolves to its own definitions', () => {
        const first = markInner('one')
        const second = markInner('two')
        const firstIds = idsOf(first)
        const secondIds = idsOf(second)
        expect(new Set(firstIds).size).toBe(firstIds.length)
        expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([])
        for (const ref of first.matchAll(/url\(#([^)]+)\)/g)) expect(firstIds).toContain(ref[1])
    })
})
