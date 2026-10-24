/**
 * The pure rules of the "reload first" offer. Labels: reproducer (the rule is new behaviour and fails against a
 * skeleton that returns the safe-wrong value), guard (passes with or without the change).
 */
import { describe, expect, test } from 'vitest'
import {
    DECLINED_KEY, RESUME_NOTE_KEY, RESUME_NOTE_MAX_AGE_MS, hasUsedSinceLaunch, makeResumeNote, parseResumeNote, readDeclined,
    shouldAskReloadFirst, takeResumeNote, workBlocksReload, writeDeclined, writeResumeNote,
    type AskInputs, type WorkProbes,
} from '../reloadFirstPolicy'

function memoryStorage(initial: Record<string, string> = {}): Storage {
    const map = new Map(Object.entries(initial))
    return {
        get length() { return map.size },
        clear: () => map.clear(),
        getItem: (key) => map.get(key) ?? null,
        key: (index) => [...map.keys()][index] ?? null,
        removeItem: (key) => { map.delete(key) },
        setItem: (key, value) => { map.set(key, String(value)) },
    }
}

const asking: AskInputs = {
    android: true,
    storeMode: 'store2',
    used: true,
    characters: 101,
    modules: 0,
    declined: false,
    workInFlight: false,
}

describe('shouldAskReloadFirst', () => {
    test('reproducer: a used Android store2 page asks above 100 characters or above 30 modules', () => {
        expect(shouldAskReloadFirst(asking)).toBe(true)
        expect(shouldAskReloadFirst({ ...asking, characters: 0, modules: 31 })).toBe(true)
    })

    test('guard: the boundary values and an unused page do not ask', () => {
        expect(shouldAskReloadFirst({ ...asking, characters: 100, modules: 30 })).toBe(false)
        expect(shouldAskReloadFirst({ ...asking, characters: 0, modules: 0 })).toBe(false)
        expect(shouldAskReloadFirst({ ...asking, used: false })).toBe(false)
    })

    test('guard: desktop, web, another storage mode, a remembered No and work in flight never ask', () => {
        expect(shouldAskReloadFirst({ ...asking, android: false })).toBe(false)
        expect(shouldAskReloadFirst({ ...asking, storeMode: 'legacy' })).toBe(false)
        expect(shouldAskReloadFirst({ ...asking, declined: true })).toBe(false)
        expect(shouldAskReloadFirst({ ...asking, workInFlight: true })).toBe(false)
    })
})

describe('workBlocksReload', () => {
    const idle: WorkProbes = { drafts: false, inFlight: false, busy: false, chokePoint: false, parked: false }

    test('reproducer: each probe alone blocks the reload', () => {
        for (const key of Object.keys(idle) as (keyof WorkProbes)[]) {
            expect(workBlocksReload({ ...idle, [key]: true })).toBe(true)
        }
    })

    test('guard: nothing in flight does not block', () => {
        expect(workBlocksReload(idle)).toBe(false)
    })
})

describe('hasUsedSinceLaunch', () => {
    const quiet = { characterOpened: false, chatSeen: false, marksNow: 5, marksAtReady: 5 }

    test('reproducer: each signal alone counts as use', () => {
        expect(hasUsedSinceLaunch({ ...quiet, characterOpened: true })).toBe(true)
        expect(hasUsedSinceLaunch({ ...quiet, chatSeen: true })).toBe(true)
        expect(hasUsedSinceLaunch({ ...quiet, marksNow: 6 })).toBe(true)
    })

    test('guard: none of them, or marks equal to the baseline, is not use', () => {
        expect(hasUsedSinceLaunch(quiet)).toBe(false)
    })
})

describe('the resume note', () => {
    const now = 1_000_000

    test('reproducer: a fresh note of either export names its operation', () => {
        expect(parseResumeNote(makeResumeNote('export-full', now), now)).toBe('export-full')
        expect(parseResumeNote(makeResumeNote('export-partial', now), now + 5)).toBe('export-partial')
    })

    test('guard: an old, future, malformed, unknown or other-version note names nothing', () => {
        expect(parseResumeNote(makeResumeNote('export-full', now), now + RESUME_NOTE_MAX_AGE_MS + 1)).toBeNull()
        expect(parseResumeNote(makeResumeNote('export-full', now), now - 1)).toBeNull()
        expect(parseResumeNote(JSON.stringify({ v: 1, op: 'export-partia', at: now }), now)).toBeNull()
        expect(parseResumeNote(JSON.stringify({ v: 1, op: 'import', at: now }), now)).toBeNull()
        expect(parseResumeNote(JSON.stringify({ v: 2, op: 'export-full', at: now }), now)).toBeNull()
        expect(parseResumeNote(JSON.stringify({ v: 1, op: 'export-full', at: '1' }), now)).toBeNull()
        expect(parseResumeNote(JSON.stringify({ v: 1, op: 'export-full', at: 1.5 }), now)).toBeNull()
        expect(parseResumeNote('not json', now)).toBeNull()
        expect(parseResumeNote(null, now)).toBeNull()
    })

    test('reproducer: taking a note removes it, also when it is stale or corrupt', () => {
        const fresh = memoryStorage({ [RESUME_NOTE_KEY]: makeResumeNote('export-full', now) })
        expect(takeResumeNote(fresh, now)).toBe('export-full')
        expect(fresh.getItem(RESUME_NOTE_KEY)).toBeNull()
        expect(takeResumeNote(fresh, now)).toBeNull()

        const stale = memoryStorage({ [RESUME_NOTE_KEY]: makeResumeNote('export-full', now) })
        expect(takeResumeNote(stale, now + RESUME_NOTE_MAX_AGE_MS + 1)).toBeNull()
        expect(stale.getItem(RESUME_NOTE_KEY)).toBeNull()

        const corrupt = memoryStorage({ [RESUME_NOTE_KEY]: '{' })
        expect(takeResumeNote(corrupt, now)).toBeNull()
        expect(corrupt.getItem(RESUME_NOTE_KEY)).toBeNull()
    })

    test('guard: a storage that throws or is missing gives no operation', () => {
        const throwing = { getItem: () => { throw new Error('denied') }, removeItem: () => { throw new Error('denied') } }
        expect(takeResumeNote(throwing, now)).toBeNull()
        expect(takeResumeNote(null, now)).toBeNull()
    })

    test('reproducer: writing reads the note back, and a storage that does not keep it fails', () => {
        const storage = memoryStorage()
        expect(writeResumeNote(storage, 'export-partial', now)).toBe(true)
        expect(takeResumeNote(storage, now)).toBe('export-partial')

        const forgetful: Storage = { ...memoryStorage(), setItem: () => { }, getItem: () => null }
        expect(writeResumeNote(forgetful, 'export-full', now)).toBe(false)
        const throwing: Storage = { ...memoryStorage(), setItem: () => { throw new Error('quota') } }
        expect(writeResumeNote(throwing, 'export-full', now)).toBe(false)
        expect(writeResumeNote(null, 'export-full', now)).toBe(false)
    })
})

describe('the remembered No', () => {
    test('reproducer: it round-trips, is separate from the resume note and survives taking it', () => {
        const storage = memoryStorage()
        expect(readDeclined(storage)).toBe(false)
        expect(writeDeclined(storage)).toBe(true)
        expect(readDeclined(storage)).toBe(true)
        expect(storage.getItem(DECLINED_KEY)).toBe('1')

        writeResumeNote(storage, 'export-full', 1)
        takeResumeNote(storage, 1)
        expect(readDeclined(storage)).toBe(true)
        expect(readDeclined(memoryStorage({ [RESUME_NOTE_KEY]: 'x' }))).toBe(false)
    })

    test('guard: a throwing or missing storage reads as not declined', () => {
        expect(readDeclined({ getItem: () => { throw new Error('denied') } })).toBe(false)
        expect(writeDeclined({ setItem: () => { throw new Error('denied') } })).toBe(false)
        expect(readDeclined(null)).toBe(false)
        expect(writeDeclined(null)).toBe(false)
    })
})
