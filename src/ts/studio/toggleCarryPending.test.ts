// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { characterOwnerKey, moduleOwnerKey } from './history/ownerPhase'
import {
    PENDING_PREFIX,
    UNREADABLE_PREFIX,
    clearPending,
    holdSession,
    parsePending,
    readPending,
    resetToggleCarrySessionForTests,
    serializePending,
    writePending,
} from './toggleCarryPending'

const owner = characterOwnerKey('A')
const mainKey = PENDING_PREFIX + owner
const asideKey = UNREADABLE_PREFIX + owner

afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    resetToggleCarrySessionForTests()
})

describe('parsePending (F-S parse cases)', () => {
    it('reads null as absent and the exact shape as ok', () => {
        expect(parsePending(null)).toEqual({ status: 'absent' })
        expect(parsePending(serializePending('a=A\nb=B\n'))).toEqual({ status: 'ok', baseline: 'a=A\nb=B\n' })
        expect(parsePending('{"v":1,"baseline":""}')).toEqual({ status: 'ok', baseline: '' })
    })

    it('reads every other shape as unreadable, including the never-shipped added field', () => {
        const cases = [
            '',
            'not json',
            'null',
            '[]',
            '"text"',
            '{}',
            '{"v":1}',
            '{"baseline":"x"}',
            '{"v":2,"baseline":"x"}',
            '{"v":"1","baseline":"x"}',
            '{"v":1,"baseline":5}',
            '{"v":1,"baseline":null}',
            '{"v":1,"baseline":"x","added":[]}',
            '{"v":1,"baseline":"x","extra":1}',
        ]
        for (const raw of cases) {
            expect(parsePending(raw), raw).toEqual({ status: 'unreadable' })
        }
    })
})

describe('writePending and readPending', () => {
    it('stores one record per owner under its own key and reads it back as stored', () => {
        expect(readPending(owner)).toEqual({ status: 'absent' })
        expect(writePending(owner, 'a=A\n')).toBe('stored')
        expect(localStorage.getItem(mainKey)).toBe('{"v":1,"baseline":"a=A\\n"}')
        expect(readPending(owner)).toEqual({ status: 'ok', baseline: 'a=A\n', kept: 'stored' })
        expect(readPending(characterOwnerKey('B'))).toEqual({ status: 'absent' })
    })

    it('keys a module owner by its raw id, apart from a character with the same id', () => {
        writePending(moduleOwnerKey('m1'), 'm=M\n')
        writePending(characterOwnerKey('m1'), 'c=C\n')
        expect(localStorage.getItem('risuStudio.toggleCarry:module:m1')).toBe(serializePending('m=M\n'))
        expect(readPending(moduleOwnerKey('m1'))).toMatchObject({ baseline: 'm=M\n' })
        expect(readPending(characterOwnerKey('m1'))).toMatchObject({ baseline: 'c=C\n' })
    })

    it('replaces a readable record without an aside copy', () => {
        writePending(owner, 'one')
        expect(writePending(owner, 'two')).toBe('stored')
        expect(readPending(owner)).toMatchObject({ baseline: 'two' })
        expect(localStorage.getItem(asideKey)).toBeNull()
    })
})

describe('MC-350 keep-unreadable (F-S)', () => {
    it('copies an unreadable record byte-exact to the aside key once, then writes the main key', () => {
        const raw = '{"v":1,"baseline":"x","added":["k"]}'
        localStorage.setItem(mainKey, raw)
        expect(readPending(owner)).toEqual({ status: 'unreadable' })
        expect(writePending(owner, 'fresh')).toBe('stored')
        expect(localStorage.getItem(asideKey)).toBe(raw)
        expect(readPending(owner)).toEqual({ status: 'ok', baseline: 'fresh', kept: 'stored' })
    })

    it('keeps a newer-version record from another build under the aside key and never loses it', () => {
        const raw = '{"v":2,"baseline":"x","lineage":[1,2]}'
        localStorage.setItem(mainKey, raw)
        writePending(owner, 'fresh')
        expect(localStorage.getItem(asideKey)).toBe(raw)
        writePending(owner, 'fresher')
        expect(localStorage.getItem(asideKey)).toBe(raw)
    })

    it('writes nothing when the aside key is taken, and holds the question in the session', () => {
        const raw = '{"v":2,"baseline":"x"}'
        localStorage.setItem(mainKey, raw)
        localStorage.setItem(asideKey, 'an earlier copy')
        expect(writePending(owner, 'fresh')).toBe('memoryOnly')
        expect(localStorage.getItem(mainKey)).toBe(raw)
        expect(localStorage.getItem(asideKey)).toBe('an earlier copy')
        expect(readPending(owner)).toEqual({ status: 'ok', baseline: 'fresh', kept: 'session' })
    })

    it('writes nothing when the aside copy itself fails', () => {
        const raw = 'not json'
        localStorage.setItem(mainKey, raw)
        const real = Storage.prototype.setItem
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
            if (key === asideKey) {
                throw new Error('quota')
            }
            real.call(this, key, value)
        })
        expect(writePending(owner, 'fresh')).toBe('memoryOnly')
        expect(localStorage.getItem(mainKey)).toBe(raw)
        expect(readPending(owner)).toMatchObject({ kept: 'session' })
    })

    it('clearPending removes a readable record and keeps unreadable bytes and the aside copy', () => {
        writePending(owner, 'x')
        expect(clearPending(owner)).toBe(true)
        expect(localStorage.getItem(mainKey)).toBeNull()

        localStorage.setItem(mainKey, '{"v":2,"baseline":"x"}')
        localStorage.setItem(asideKey, 'copy')
        expect(clearPending(owner)).toBe(true)
        expect(localStorage.getItem(mainKey)).toBe('{"v":2,"baseline":"x"}')
        expect(localStorage.getItem(asideKey)).toBe('copy')
    })
})

describe('the session map', () => {
    it('gives a storage failure a session entry, which wins over storage on read', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota')
        })
        expect(writePending(owner, 'held')).toBe('memoryOnly')
        vi.restoreAllMocks()
        localStorage.setItem(mainKey, serializePending('stored elsewhere'))
        expect(readPending(owner)).toEqual({ status: 'ok', baseline: 'held', kept: 'session' })
    })

    it('updates an existing session entry without storing', () => {
        holdSession(owner, 'one')
        expect(writePending(owner, 'two')).toBe('memoryOnly')
        expect(localStorage.getItem(mainKey)).toBeNull()
        expect(readPending(owner)).toMatchObject({ baseline: 'two', kept: 'session' })
    })

    it('holdSession never touches the stored record', () => {
        writePending(owner, 'stored')
        holdSession(owner, 'held')
        expect(localStorage.getItem(mainKey)).toBe(serializePending('stored'))
        expect(readPending(owner)).toMatchObject({ baseline: 'held', kept: 'session' })
    })

    it('clearPending drops the session entry and the readable stored record', () => {
        writePending(owner, 'stored')
        holdSession(owner, 'held')
        expect(clearPending(owner)).toBe(true)
        expect(readPending(owner)).toEqual({ status: 'absent' })
        expect(localStorage.getItem(mainKey)).toBeNull()
    })

    it('clearPending drops the session entry even when storage throws, and says so', () => {
        writePending(owner, 'stored')
        holdSession(owner, 'held')
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new Error('denied')
        })
        expect(clearPending(owner)).toBe(false)
        vi.restoreAllMocks()
        expect(readPending(owner)).toMatchObject({ kept: 'stored' })
    })

    it('resetToggleCarrySessionForTests empties the session map', () => {
        holdSession(owner, 'held')
        resetToggleCarrySessionForTests()
        expect(readPending(owner)).toEqual({ status: 'absent' })
    })

    it('reads unavailable device storage as absent', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('denied')
        })
        expect(readPending(owner)).toEqual({ status: 'absent' })
        expect(writePending(owner, 'x')).toBe('memoryOnly')
    })
})
