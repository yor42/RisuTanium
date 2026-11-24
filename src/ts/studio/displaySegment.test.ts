// A-T13: the Display form's segment is remembered per character on this device, and a storage that refuses means the
// first segment. The tests use a localStorage stub.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { readDisplaySegment, writeDisplaySegment } from './displaySegment'

function stubStorage(): Map<string, string> {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => { data.set(key, value) },
        removeItem: (key: string) => { data.delete(key) },
    })
    return data
}

beforeEach(() => {
    stubStorage()
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('A-T13: the remembered Display segment', () => {
    test('the first segment is portrait, and each character remembers its own', () => {
        expect(readDisplaySegment('A')).toBe('photo')
        writeDisplaySegment('A', 'screen')
        writeDisplaySegment('B', 'assets')
        expect(readDisplaySegment('A')).toBe('screen')
        expect(readDisplaySegment('B')).toBe('assets')
        expect(readDisplaySegment('C')).toBe('photo')
        writeDisplaySegment('A', 'photo')
        expect(readDisplaySegment('A')).toBe('photo')
        expect(readDisplaySegment('B')).toBe('assets')
    })

    test('a stored value that is no segment reads as portrait', () => {
        localStorage.setItem('risuStudio.displaySegment.A', 'nonsense')
        expect(readDisplaySegment('A')).toBe('photo')
    })

    test('storage that throws on read or write means portrait and never throws', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => { throw new Error('denied') },
            setItem: () => { throw new Error('full') },
            removeItem: () => { throw new Error('denied') },
        })
        expect(readDisplaySegment('A')).toBe('photo')
        expect(() => writeDisplaySegment('A', 'screen')).not.toThrow()
        expect(() => writeDisplaySegment('A', 'photo')).not.toThrow()
    })
})
