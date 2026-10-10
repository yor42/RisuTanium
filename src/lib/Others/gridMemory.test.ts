// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GRID_SORT_KEY, loadGridSort, parseGridSort, saveGridSort } from './gridMemory'

/**
 * The Grid's remembered sort. Labels: (F) is new behaviour that fails before `gridMemory`
 * exists; (G) is a guard.
 */

beforeEach(() => {
    localStorage.clear()
})

describe('gridMemory', () => {
    test('(F) a saved sort is read back, for each mode', () => {
        for (const sort of ['order', 'recent', 'name'] as const) {
            saveGridSort(sort)
            expect(loadGridSort()).toBe(sort)
        }
    })

    test('(F) nothing stored reads as My order', () => {
        expect(loadGridSort()).toBe('order')
    })

    test('(F) an unknown or corrupt stored value reads as My order', () => {
        for (const raw of ['', 'newest', '{"a":1}', 'null', 'RECENT', '"recent"']) {
            localStorage.setItem(GRID_SORT_KEY, raw)
            expect(loadGridSort()).toBe('order')
        }
    })

    test('(F) parseGridSort accepts only the three modes', () => {
        expect(parseGridSort('recent')).toBe('recent')
        expect(parseGridSort('name')).toBe('name')
        expect(parseGridSort('order')).toBe('order')
        expect(parseGridSort(null)).toBe('order')
        expect(parseGridSort(3)).toBe('order')
        expect(parseGridSort('x')).toBe('order')
    })

    test('(G) storage that throws on read or write neither throws nor remembers', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => {
                throw new Error('blocked')
            },
            setItem: () => {
                throw new Error('quota')
            },
        })
        try {
            expect(() => saveGridSort('name')).not.toThrow()
            expect(loadGridSort()).toBe('order')
        } finally {
            vi.unstubAllGlobals()
        }
    })
})
