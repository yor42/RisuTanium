// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest'
import { readCap, writeCap } from './fieldHeightStore'

function memoryStorage(initial: Record<string, string> = {}): Storage {
    const data = new Map(Object.entries(initial))
    return {
        get length() { return data.size },
        clear: () => data.clear(),
        getItem: (key) => data.get(key) ?? null,
        key: (index) => [...data.keys()][index] ?? null,
        removeItem: (key) => { data.delete(key) },
        setItem: (key, value) => { data.set(key, value) },
    }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('fieldHeightStore', () => {
    test('B2-U6 each kind has its own key', () => {
        const storage = memoryStorage()
        vi.stubGlobal('localStorage', storage)
        writeCap('desc', 300)
        writeCap('greeting', 200)
        expect(storage.getItem('risuStudio.ltCap.desc')).toBe('300')
        expect(readCap('desc')).toBe(300)
        expect(readCap('greeting')).toBe(200)
        expect(readCap('note')).toBeNull()
    })

    test('B2-U6 a non-finite value or one outside 72..4000 reads null, and writes refuse them', () => {
        const bad = ['NaN', 'abc', '-5', '71', '4001', 'Infinity', '', '  ']
        for (const raw of bad) {
            vi.stubGlobal('localStorage', memoryStorage({ 'risuStudio.ltCap.desc': raw }))
            expect(readCap('desc'), raw).toBeNull()
        }
        for (const raw of ['72', '4000']) {
            vi.stubGlobal('localStorage', memoryStorage({ 'risuStudio.ltCap.desc': raw }))
            expect(readCap('desc'), raw).toBe(Number(raw))
        }
        const storage = memoryStorage()
        vi.stubGlobal('localStorage', storage)
        writeCap('desc', Number.NaN)
        writeCap('desc', 10)
        writeCap('desc', 9999)
        expect(storage.length).toBe(0)
    })

    test('B2-x26 a fractional cap is stored rounded', () => {
        const storage = memoryStorage()
        vi.stubGlobal('localStorage', storage)
        writeCap('desc', 100.6)
        expect(storage.getItem('risuStudio.ltCap.desc')).toBe('101')
    })

    test('B2-U6 a storage that throws, or none at all, is swallowed', () => {
        const throwing = {
            getItem: () => { throw new Error('denied') },
            setItem: () => { throw new Error('full') },
        }
        vi.stubGlobal('localStorage', throwing)
        expect(readCap('desc')).toBeNull()
        expect(() => writeCap('desc', 300)).not.toThrow()
        vi.unstubAllGlobals()
        expect(readCap('desc')).toBeNull()
        expect(() => writeCap('desc', 300)).not.toThrow()
    })
})
