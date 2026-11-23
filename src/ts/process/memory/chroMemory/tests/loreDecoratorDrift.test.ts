import { describe, expect, test } from 'vitest'
import { LORE_SCAN_DECORATORS } from '../../../loreScanDecorators'
import { EXCLUDED_DECORATORS, EXCLUDED_DECORATOR_PREFIX, INERT_DECORATORS, NEUTRAL_DECORATORS, isExcludedDecorator } from '../loreRecall'

describe('lore scan decorator drift guard (T7)', () => {
    test('the scan handles the 33 decorators the lists classify', () => {
        expect(LORE_SCAN_DECORATORS).toHaveLength(33)
        expect(new Set(LORE_SCAN_DECORATORS).size).toBe(33)
    })

    test('new rule: every scan decorator is in exactly one of excluded, neutral or inert', () => {
        for (const name of LORE_SCAN_DECORATORS) {
            const hits = [isExcludedDecorator(name), NEUTRAL_DECORATORS.has(name), INERT_DECORATORS.has(name)].filter(Boolean).length
            expect(hits, name).toBe(1)
        }
    })

    test('new rule: every listed excluded or neutral name is a scan decorator, so a retired name cannot linger', () => {
        const scan = new Set<string>(LORE_SCAN_DECORATORS)
        for (const name of [...EXCLUDED_DECORATORS, ...NEUTRAL_DECORATORS, ...INERT_DECORATORS]) expect(scan.has(name), name).toBe(true)
    })

    test('new rule: the spec lists hold 19 excluded names plus the inject prefix and 6 neutral names', () => {
        expect(EXCLUDED_DECORATORS.size).toBe(19)
        expect(NEUTRAL_DECORATORS.size).toBe(6)
        expect(INERT_DECORATORS.size).toBe(4)
        const injectNames = LORE_SCAN_DECORATORS.filter((n) => n.startsWith(EXCLUDED_DECORATOR_PREFIX))
        expect(injectNames).toEqual(['inject_lore', 'inject_at', 'inject_replace', 'inject_prepend'])
        expect(isExcludedDecorator('inject_future_kind')).toBe(true)
    })
})
