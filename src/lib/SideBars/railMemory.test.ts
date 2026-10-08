import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    loadOpenFolders,
    loadScroll,
    MAX_REMEMBERED_FOLDERS,
    OPEN_FOLDERS_KEY,
    RAIL_SCROLL_KEY,
    saveOpenFolders,
    saveScroll,
} from './railMemory'

/** What the rail remembers on this device: open folders and one scroll position. */

const valid = (...ids: string[]): Set<string> => new Set(ids)

beforeEach(() => {
    localStorage.clear()
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('open folders', () => {
    test('(U) a saved set loads back', () => {
        saveOpenFolders(['a', 'b'], valid('a', 'b', 'c'))
        expect(loadOpenFolders(valid('a', 'b', 'c'))).toEqual(['a', 'b'])
    })

    test('(U) nothing saved, corrupt JSON and values of the wrong type load as empty', () => {
        expect(loadOpenFolders(valid('a'))).toEqual([])
        for (const raw of ['{not json', '{"a":1}', '"a"', '42', 'null', '']) {
            localStorage.setItem(OPEN_FOLDERS_KEY, raw)
            expect(loadOpenFolders(valid('a'))).toEqual([])
        }
    })

    test('(U) non-string entries and duplicates are dropped', () => {
        localStorage.setItem(OPEN_FOLDERS_KEY, JSON.stringify(['a', 1, null, 'a', { x: 1 }, 'b']))
        expect(loadOpenFolders(valid('a', 'b'))).toEqual(['a', 'b'])
    })

    test('(U) ids that are not valid are pruned at load and at save', () => {
        localStorage.setItem(OPEN_FOLDERS_KEY, JSON.stringify(['a', 'gone', 'b']))
        expect(loadOpenFolders(valid('a', 'b'))).toEqual(['a', 'b'])

        saveOpenFolders(['a', 'gone', 'b', 'a'], valid('a', 'b'))
        expect(JSON.parse(localStorage.getItem(OPEN_FOLDERS_KEY)!)).toEqual(['a', 'b'])
    })

    test('(U) the remembered set is capped', () => {
        const ids = Array.from({ length: MAX_REMEMBERED_FOLDERS + 50 }, (_, i) => `f${i}`)
        expect(loadOpenFolders(new Set(ids))).toEqual([])
        localStorage.setItem(OPEN_FOLDERS_KEY, JSON.stringify(ids))
        expect(loadOpenFolders(new Set(ids))).toHaveLength(MAX_REMEMBERED_FOLDERS)
        saveOpenFolders(ids, new Set(ids))
        expect(JSON.parse(localStorage.getItem(OPEN_FOLDERS_KEY)!)).toHaveLength(MAX_REMEMBERED_FOLDERS)
    })
})

describe('scroll position', () => {
    test('(U) a saved position loads back', () => {
        saveScroll({ key: 'k', offset: 12, px: 340 })
        expect(loadScroll()).toEqual({ key: 'k', offset: 12, px: 340 })
    })

    test('(U) nothing saved, corrupt JSON and wrong shapes load as null', () => {
        expect(loadScroll()).toBeNull()
        const bad = [
            '{not json',
            'null',
            '[]',
            '{"key":1,"offset":0,"px":0}',
            '{"key":"k","offset":"0","px":0}',
            '{"key":"k","offset":-1,"px":0}',
            '{"key":"k","offset":0,"px":-5}',
            '{"key":"k","offset":0}',
            '{"key":"k","offset":null,"px":0}',
        ]
        for (const raw of bad) {
            localStorage.setItem(RAIL_SCROLL_KEY, raw)
            expect(loadScroll()).toBeNull()
        }
    })
})

describe('storage that fails', () => {
    test('(G) a storage that throws on read and on write never throws out of the module', () => {
        const blocked = (): never => {
            throw new Error('blocked')
        }
        vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked, clear: blocked })
        expect(() => saveOpenFolders(['a'], valid('a'))).not.toThrow()
        expect(() => saveScroll({ key: 'k', offset: 0, px: 0 })).not.toThrow()
        expect(loadOpenFolders(valid('a'))).toEqual([])
        expect(loadScroll()).toBeNull()
    })
})
