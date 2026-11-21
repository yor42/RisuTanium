// @vitest-environment jsdom

/**
 * Device-local seasonal logo preferences. Each test names the defect it guards: a regression reproducer fails on the
 * stated mutant of seasonalPrefs.svelte.ts, a compatibility guard says so.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    SEASONAL_LAST_PLAYED_KEY,
    SEASONAL_LOGO_KEY,
    localYmd,
    markPlayed,
    playedToday,
    reloadSeasonalPrefs,
    seasonalLogoEnabled,
    setSeasonalLogoEnabled,
} from './seasonalPrefs.svelte'

beforeEach(() => {
    localStorage.clear()
    reloadSeasonalPrefs()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('seasonal logo toggle', () => {
    // Guards: an absent key read as off (the maintainer decision is on by default, MC-3080).
    test('an absent key means the logo is on', () => {
        expect(localStorage.getItem(SEASONAL_LOGO_KEY)).toBeNull()
        expect(seasonalLogoEnabled()).toBe(true)
    })

    // Guards: the toggle not persisting, or "on" leaving a stale off value that a reload reads back as off.
    test('off is stored and survives a reload; on removes the key again', () => {
        setSeasonalLogoEnabled(false)
        expect(seasonalLogoEnabled()).toBe(false)
        expect(localStorage.getItem(SEASONAL_LOGO_KEY)).toBe('0')
        reloadSeasonalPrefs()
        expect(seasonalLogoEnabled()).toBe(false)
        setSeasonalLogoEnabled(true)
        expect(localStorage.getItem(SEASONAL_LOGO_KEY)).toBeNull()
        reloadSeasonalPrefs()
        expect(seasonalLogoEnabled()).toBe(true)
    })

    // Guards: an unrelated stored value (older or foreign) turning the logo off.
    test('only the stored off marker turns the logo off', () => {
        localStorage.setItem(SEASONAL_LOGO_KEY, 'false')
        reloadSeasonalPrefs()
        expect(seasonalLogoEnabled()).toBe(true)
    })

    // Guards: private mode or disabled storage throwing out of the reader (the top bar would fail to render).
    test('unreadable storage reads as on', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
        expect(() => reloadSeasonalPrefs()).not.toThrow()
        expect(seasonalLogoEnabled()).toBe(true)
    })

    // Guards: a quota or private-mode error on write throwing from the settings switch, or the switch not applying.
    test('unwritable storage still applies the choice for the session', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
        expect(() => setSeasonalLogoEnabled(false)).not.toThrow()
        expect(seasonalLogoEnabled()).toBe(false)
    })
})

describe('once-a-day record', () => {
    // Guards: a first view counted as already played.
    test('nothing is played before the first mark', () => {
        expect(playedToday('2026-12-25')).toBe(false)
    })

    // Guards: the mark not matching the same day, or matching any later day (a boolean instead of a date).
    test('a mark covers that day only', () => {
        markPlayed('2026-12-25')
        expect(localStorage.getItem(SEASONAL_LAST_PLAYED_KEY)).toBe('2026-12-25')
        expect(playedToday('2026-12-25')).toBe(true)
        expect(playedToday('2026-12-26')).toBe(false)
    })

    // Guards: storage errors throwing out of the host, or an unreadable record blocking the animation forever.
    test('unreadable or unwritable storage counts as not played and never throws', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
        expect(playedToday('2026-12-25')).toBe(false)
        expect(() => markPlayed('2026-12-25')).not.toThrow()
    })
})

describe('localYmd', () => {
    // Guards: UTC formatting (a late-evening view stamped as tomorrow) and an unpadded month or day.
    test('formats the device-local calendar day with padding', () => {
        expect(localYmd(new Date(2027, 0, 5, 23, 59, 59))).toBe('2027-01-05')
        expect(localYmd(new Date(2026, 11, 25, 0, 0, 1))).toBe('2026-12-25')
    })
})
