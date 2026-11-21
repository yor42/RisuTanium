/**
 * The clearing of the device records the retired boot archive pass left in
 * `localStorage` (`src/ts/storage/bootArchiveMemo.ts`). Nothing writes those
 * keys any more, so each test seeds them with raw `localStorage` writes of the
 * values the old pass stored. These tests are guards: clearing must keep
 * removing exactly those keys on a device that still holds them.
 *
 * `localStorage` is the happy-dom one, or a stand-in that throws; nothing here
 * says anything about a browser's storage quota or about private browsing
 * modes.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { clearArchiveMemo, clearStubEnrichStrikes } from 'src/ts/storage/bootArchiveMemo'

const SKIPPED_KEY = 'archivePassSkipped'
const TOO_LARGE_KEY = 'archivePassTooLarge'
const STRIKES_KEY = 'archivePassStrikes'
const TOLD_KEY = 'archivePassPausedTold'
const STUB_ENRICH_KEY = 'stubEnrichStrikes'

beforeEach(() => {
    localStorage.clear()
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

/** A storage whose every access throws, as a blocked or full `localStorage` does. */
function throwingStorage(): Storage {
    const fail = (): never => { throw new Error('storage blocked') }
    return {
        get length(): number { return fail() },
        key: fail,
        getItem: fail,
        setItem: fail,
        removeItem: fail,
        clear: fail,
    } as unknown as Storage
}

describe('clearing the notice memo and strike count of the retired boot archive pass', () => {
    test('forgets the skipped list, the too-large flag, the strike count and the told record, and leaves other storage keys alone', () => {
        localStorage.setItem('unrelated-key', 'kept')
        localStorage.setItem(SKIPPED_KEY, JSON.stringify(['a', 'b']))
        localStorage.setItem(TOO_LARGE_KEY, '1')
        localStorage.setItem(STRIKES_KEY, '2')
        localStorage.setItem(TOLD_KEY, '1')

        clearArchiveMemo()

        expect(localStorage.getItem(SKIPPED_KEY)).toBeNull()
        expect(localStorage.getItem(TOO_LARGE_KEY)).toBeNull()
        expect(localStorage.getItem(STRIKES_KEY)).toBeNull()
        expect(localStorage.getItem(TOLD_KEY)).toBeNull()
        expect(localStorage.getItem('unrelated-key')).toBe('kept')
    })

    test('forgets a stored strike value that is not a count', () => {
        localStorage.setItem(STRIKES_KEY, 'garbage')

        clearArchiveMemo()

        expect(localStorage.getItem(STRIKES_KEY)).toBeNull()
    })

    test('does not throw when localStorage throws', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        vi.stubGlobal('localStorage', throwingStorage())

        expect(() => clearArchiveMemo()).not.toThrow()
    })
})

describe('clearing the stub-enrichment count of the retired boot archive pass', () => {
    test('removes the key, never writes zero, and leaves other keys alone', () => {
        localStorage.setItem(STUB_ENRICH_KEY, '1')
        localStorage.setItem(STRIKES_KEY, '1')
        localStorage.setItem('unrelated-key', 'kept')

        clearStubEnrichStrikes()

        expect(localStorage.getItem(STUB_ENRICH_KEY)).toBeNull()
        expect(localStorage.getItem(STRIKES_KEY)).toBe('1')
        expect(localStorage.getItem('unrelated-key')).toBe('kept')
    })

    test('where no count is stored writes nothing', () => {
        clearStubEnrichStrikes()

        expect(localStorage.length).toBe(0)
    })

    test('ignores a storage that throws', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        vi.stubGlobal('localStorage', throwingStorage())

        expect(() => clearStubEnrichStrikes()).not.toThrow()
    })

    test('guard: clearing the archive memo leaves the count alone, because an archive-off boot clears the archive memo on every boot', () => {
        localStorage.setItem(STUB_ENRICH_KEY, '2')
        localStorage.setItem(STRIKES_KEY, '2')
        localStorage.setItem(TOLD_KEY, '1')
        localStorage.setItem(TOO_LARGE_KEY, '1')

        clearArchiveMemo()

        expect(localStorage.getItem(STRIKES_KEY)).toBeNull()
        expect(localStorage.getItem(TOLD_KEY)).toBeNull()
        expect(localStorage.getItem(TOO_LARGE_KEY)).toBeNull()
        expect(localStorage.getItem(STUB_ENRICH_KEY)).toBe('2')
    })
})
