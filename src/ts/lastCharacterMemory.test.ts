/**
 * The device-local memory of the last character: the stored shape, the tolerant parse, the read that never
 * writes, and which list entries may be restored or recorded. The producer is the real `writeLastChaId`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    LAST_CHARACTER_KEY,
    parseLastCharacter,
    readLastChaId,
    recordDecision,
    resolveRestoreIndex,
    writeLastChaId,
} from './lastCharacterMemory'

beforeEach(() => {
    localStorage.clear()
})

afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
})

describe('parseLastCharacter', () => {
    test('U1: only a JSON object with a non-empty string chaId is a memory; extra fields are ignored', () => {
        for (const raw of [null, undefined, '', 'x', '[]', '{}', '{"chaId":""}', '{"chaId":5}', '{"chaId":null}', '"c1"', '5', 'null']) {
            expect(parseLastCharacter(raw), String(raw)).toBeNull()
        }
        expect(parseLastCharacter('{"chaId":"a","v":2}')).toBe('a')
        expect(parseLastCharacter('{"chaId":"c2"}')).toBe('c2')
    })
})

describe('readLastChaId and writeLastChaId', () => {
    test('U3: the stored string is the documented producer shape, and it reads back', () => {
        writeLastChaId('c2')

        expect(localStorage.getItem(LAST_CHARACTER_KEY)).toBe('{"chaId":"c2"}')
        expect(LAST_CHARACTER_KEY).toBe('risutanium.character.last')
        expect(readLastChaId()).toBe('c2')
    })

    test('writing null forgets the memory', () => {
        writeLastChaId('c2')
        writeLastChaId(null)

        expect(localStorage.getItem(LAST_CHARACTER_KEY)).toBeNull()
        expect(readLastChaId()).toBeNull()
    })

    test('U2: a read of a value it cannot use neither writes nor removes it', () => {
        localStorage.setItem(LAST_CHARACTER_KEY, 'not json')
        const setSpy = vi.spyOn(Storage.prototype, 'setItem')
        const removeSpy = vi.spyOn(Storage.prototype, 'removeItem')

        expect(readLastChaId()).toBeNull()

        expect(setSpy).not.toHaveBeenCalled()
        expect(removeSpy).not.toHaveBeenCalled()
        expect(localStorage.getItem(LAST_CHARACTER_KEY)).toBe('not json')
    })

    test('U2: storage that throws on read or write is nothing remembered, never an error', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full') })
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked') })

        expect(readLastChaId()).toBeNull()
        expect(() => writeLastChaId('c2')).not.toThrow()
        expect(() => writeLastChaId(null)).not.toThrow()
    })
})

describe('resolveRestoreIndex', () => {
    const list = (...entries: unknown[]): unknown[] => entries

    test('U4: a present, live character resolves to its index', () => {
        expect(resolveRestoreIndex(list({ chaId: 'a' }, { chaId: 'b' }), 'b')).toBe(1)
    })

    test('U4: a missing id, a missing list and a non-object holder resolve to nothing', () => {
        expect(resolveRestoreIndex(list({ chaId: 'a' }), 'zz')).toBeNull()
        expect(resolveRestoreIndex(undefined, 'a')).toBeNull()
        expect(resolveRestoreIndex(null, 'a')).toBeNull()
        expect(resolveRestoreIndex(list(null, 'a', 7), 'a')).toBeNull()
    })

    test('U4: a trashed holder is not restorable', () => {
        expect(resolveRestoreIndex(list({ chaId: 'a', trashTime: 123 }), 'a')).toBeNull()
    })

    test('U4: a hidden system character is not restorable', () => {
        expect(resolveRestoreIndex(list({ chaId: '§playground' }, { chaId: '§temp' }), '§playground')).toBeNull()
        expect(resolveRestoreIndex(list({ chaId: '§playground' }, { chaId: '§temp' }), '§temp')).toBeNull()
    })

    test('U4: a numeric chaId never matches the stored string', () => {
        expect(resolveRestoreIndex(list({ chaId: 5 }), '5')).toBeNull()
    })

    test('U4: an archived stub and a group resolve like any character', () => {
        const stub = { chaId: 'cold', coldstorage: 'unit-cold' }
        const group = { chaId: 'team', type: 'group' }

        expect(resolveRestoreIndex(list({ chaId: 'a' }, stub, group), 'cold')).toBe(1)
        expect(resolveRestoreIndex(list({ chaId: 'a' }, stub, group), 'team')).toBe(2)
    })

    test('U4: a duplicate chaId resolves to the first holder, and a trashed first holder is not skipped over', () => {
        expect(resolveRestoreIndex(list({ chaId: 'd' }, { chaId: 'd' }), 'd')).toBe(0)
        expect(resolveRestoreIndex(list({ chaId: 'd', trashTime: 1 }, { chaId: 'd' }), 'd')).toBeNull()
    })
})

describe('recordDecision', () => {
    test('a live character is recorded by its chaId', () => {
        expect(recordDecision({ chaId: 'c1' })).toEqual({ kind: 'record', chaId: 'c1' })
    })

    test('O6: a hidden or trashed selection counts as Home', () => {
        expect(recordDecision({ chaId: '§playground' })).toEqual({ kind: 'home' })
        expect(recordDecision({ chaId: '§temp' })).toEqual({ kind: 'home' })
        expect(recordDecision({ chaId: 'c1', trashTime: 5 })).toEqual({ kind: 'home' })
    })

    test('a missing or malformed entry changes nothing', () => {
        for (const entry of [undefined, null, 'c1', 4, {}, { chaId: 5 }, { chaId: '' }, { trashTime: 5 }]) {
            expect(recordDecision(entry), JSON.stringify(entry)).toEqual({ kind: 'skip' })
        }
    })
})
