import { describe, expect, test } from 'vitest'
import { LEGACY_MOUNT_CAP, legacyMountCap, legacyTrimPages, type LegacyTrimInputs } from './legacyWindow'

/**
 * The decision of the legacy list's trim: a window above the cap shrinks to the cap only when nothing else owns it.
 * Labels: G = guard of the new rule (the module does not exist before this change).
 */

const base: LegacyTrimInputs = {
    loadPages: 120,
    cap: 100,
    atBottom: true,
    grew: false,
    editorsOpen: false,
    folded: false,
    scrollingToMessage: false,
}

describe('legacyTrimPages', () => {
    test('G U0 shrinks a window above the cap to the cap', () => {
        expect(legacyTrimPages(base)).toBe(100)
    })

    test('G U1 leaves an unbounded window (a screenshot restore) alone', () => {
        expect(legacyTrimPages({ ...base, loadPages: Infinity })).toBeNull()
    })

    test('G U2 leaves the window alone while a jump to a message runs', () => {
        expect(legacyTrimPages({ ...base, scrollingToMessage: true })).toBeNull()
    })

    test('G U3 leaves a window at or below the cap alone', () => {
        expect(legacyTrimPages({ ...base, loadPages: 100 })).toBeNull()
        expect(legacyTrimPages({ ...base, loadPages: 30 })).toBeNull()
    })

    test('G U4 leaves the window alone when away from the bottom, in a growing event, with an editor open or folded', () => {
        expect(legacyTrimPages({ ...base, atBottom: false })).toBeNull()
        expect(legacyTrimPages({ ...base, grew: true })).toBeNull()
        expect(legacyTrimPages({ ...base, editorsOpen: true })).toBeNull()
        expect(legacyTrimPages({ ...base, folded: true })).toBeNull()
    })
})

describe('legacyMountCap', () => {
    test('G U5 is the default cap, or the initial setting when that is larger', () => {
        expect(legacyMountCap(30)).toBe(LEGACY_MOUNT_CAP)
        expect(legacyMountCap(100)).toBe(100)
        expect(legacyMountCap(250)).toBe(250)
    })
})
