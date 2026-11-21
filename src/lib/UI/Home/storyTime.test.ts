/**
 * The story card's time label (`storyTime.ts`).
 *
 * Invariants exercised here:
 * - Under a minute, any future time and any non-finite or out-of-range time read
 *   "just now"; no value of `lastInteraction` makes the label throw.
 * - Past a minute the label is minutes, hours, then days up to 30, then a date.
 * - `storyDateTime` is undefined for an invalid Date instead of throwing.
 */
import { describe, test, expect } from 'vitest'
import { STORY_DATE_OPTIONS, STORY_RELATIVE_OPTIONS, storyDateTime, storyTime, type StoryTimeFormats } from './storyTime'

const NOW = Date.UTC(2026, 10, 21, 12)
const MIN = 60_000
const DAY = 86_400_000

function formats(locale: string): StoryTimeFormats {
    return {
        relative: new Intl.RelativeTimeFormat(locale, STORY_RELATIVE_OPTIONS),
        date: new Intl.DateTimeFormat(locale, STORY_DATE_OPTIONS),
        justNow: 'just now',
    }
}

describe('storyTime', () => {
    const en = formats('en')

    test('S3a-U9: just now for under a minute, the future, Infinity and out-of-range times', () => {
        expect(storyTime(NOW, NOW, en)).toBe('just now')
        expect(storyTime(NOW - 59_000, NOW, en)).toBe('just now')
        expect(storyTime(NOW + 3_600_000, NOW, en)).toBe('just now')
        expect(storyTime(Infinity, NOW, en)).toBe('just now')
        expect(storyTime(8.7e15, NOW, en)).toBe('just now')
    })

    test('S3a-U9 (E1): a non-finite or out-of-range past value never throws', () => {
        expect(storyTime(-Infinity, NOW, en)).toBe('just now')
        expect(storyTime(NaN, NOW, en)).toBe('just now')
        expect(storyTime(-8.7e15, NOW, en)).toBe('just now')
        expect(storyTime(0, NOW, en)).toBe(en.date.format(0))
    })

    test('S3a-U9: minutes, hours and days with numeric always', () => {
        expect(storyTime(NOW - MIN, NOW, en)).toBe('1 minute ago')
        expect(storyTime(NOW - 59 * MIN, NOW, en)).toBe('59 minutes ago')
        expect(storyTime(NOW - 60 * MIN, NOW, en)).toBe('1 hour ago')
        expect(storyTime(NOW - DAY, NOW, en)).toBe('1 day ago')
        expect(storyTime(NOW - 30 * DAY, NOW, en)).toBe('30 days ago')
    })

    test('S3a-U9: past 30 days a localized date', () => {
        const at = NOW - 31 * DAY
        expect(storyTime(at, NOW, en)).toBe(new Intl.DateTimeFormat('en', STORY_DATE_OPTIONS).format(at))
    })

    test('S3a-U9: ko uses its own relative formatter', () => {
        const ko = formats('ko')
        expect(storyTime(NOW - 3 * DAY, NOW, ko)).toBe(new Intl.RelativeTimeFormat('ko', { numeric: 'always' }).format(-3, 'day'))
    })
})

describe('storyDateTime', () => {
    test('S3a-U10: an ISO string for a valid time', () => {
        expect(storyDateTime(NOW)).toBe('2026-11-21T12:00:00.000Z')
        expect(storyDateTime(8.64e15)).toBe('+275760-09-13T00:00:00.000Z')
    })

    test('S3a-U10: undefined, never a throw, for an invalid Date', () => {
        for (const at of [Infinity, -Infinity, NaN, 8.7e15, 8640000000000001]) {
            expect(() => storyDateTime(at)).not.toThrow()
            expect(storyDateTime(at)).toBeUndefined()
        }
    })
})
