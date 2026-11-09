// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GRID_SORT_KEY, LIBRARY_TAB_KEY, loadGridSort, loadLibraryTab, parseGridSort, parseLibraryTab, saveGridSort, saveLibraryTab } from './gridMemory'

/**
 * The Grid's remembered sort and the library's remembered tab. Labels: (F) is new behaviour that
 * fails before `gridMemory` exists; (G) is a guard. Tab numbers: 3 Simple, 0 Grid, 1 List, 2 Trash.
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

describe('gridMemory: the library tab', () => {
    test('(F) a saved tab is read back, for every tab', () => {
        for (const tab of [3, 0, 1, 2]) {
            saveLibraryTab(tab)
            expect(loadLibraryTab()).toBe(tab)
        }
    })

    test('(F) the tab is stored by name, not by number', () => {
        const names = new Map([[3, 'simple'], [0, 'grid'], [1, 'list'], [2, 'trash']])
        for (const [tab, name] of names) {
            saveLibraryTab(tab)
            expect(localStorage.getItem(LIBRARY_TAB_KEY)).toBe(name)
        }
    })

    test('(F) nothing stored reads as Simple', () => {
        expect(loadLibraryTab()).toBe(3)
    })

    test('(F) an unknown, corrupt or numeric-string value reads as Simple', () => {
        for (const raw of ['', 'gallery', '{"a":1}', 'null', 'GRID', '"grid"', '0', '1', '2', '3']) {
            localStorage.setItem(LIBRARY_TAB_KEY, raw)
            expect(loadLibraryTab()).toBe(3)
        }
    })

    test('(F) parseLibraryTab accepts only the four names', () => {
        expect(parseLibraryTab('simple')).toBe(3)
        expect(parseLibraryTab('grid')).toBe(0)
        expect(parseLibraryTab('list')).toBe(1)
        expect(parseLibraryTab('trash')).toBe(2)
        expect(parseLibraryTab(null)).toBe(3)
        expect(parseLibraryTab(0)).toBe(3)
        expect(parseLibraryTab('0')).toBe(3)
        expect(parseLibraryTab('x')).toBe(3)
    })

    test('(F) a tab outside 0 to 3 writes nothing', () => {
        for (const tab of [-1, 4, 1.5, Number.NaN, 99]) {
            saveLibraryTab(tab)
        }
        expect(localStorage.getItem(LIBRARY_TAB_KEY)).toBeNull()
        saveLibraryTab(1)
        saveLibraryTab(7)
        expect(localStorage.getItem(LIBRARY_TAB_KEY)).toBe('list')
    })

    test('(G) the sort key and the tab key do not interfere', () => {
        saveGridSort('name')
        saveLibraryTab(2)
        expect(loadGridSort()).toBe('name')
        expect(loadLibraryTab()).toBe(2)
        localStorage.setItem(GRID_SORT_KEY, 'garbage')
        expect(loadLibraryTab()).toBe(2)
        localStorage.removeItem(LIBRARY_TAB_KEY)
        expect(loadGridSort()).toBe('order')
        expect(LIBRARY_TAB_KEY).not.toBe(GRID_SORT_KEY)
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
            expect(() => saveLibraryTab(1)).not.toThrow()
            expect(loadLibraryTab()).toBe(3)
        } finally {
            vi.unstubAllGlobals()
        }
    })
})
