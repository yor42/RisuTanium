import { describe, expect, test } from 'vitest'
import { formatDraftAge } from './draftAge'

// Report 20 §5.4 / MC-068: the draft-restore marker's age text.
// `formatDraftAge` is a pure function with no Svelte dependency. Every
// expected string below is computed with the SAME `Intl.RelativeTimeFormat`
// call the source itself uses, rather than hardcoded English -- these tests
// pin the elapsed-time BANDING and the LOCALE-CODE MAPPING, not any
// particular translation's wording. The one exception is a literal "contains
// '12'" sanity check, pinning that the marker's age text is human-readable.

function expectedRTF(tag: string, value: number, unit: Intl.RelativeTimeFormatUnit): string {
    return new Intl.RelativeTimeFormat(tag, { numeric: 'auto' }).format(value, unit)
}

describe('formatDraftAge: elapsed-time band boundaries (en)', () => {
    test('59 seconds elapsed is still the under-a-minute (0-second) band', () => {
        expect(formatDraftAge(0, 59_000, 'en')).toBe(expectedRTF('en', 0, 'second'))
    })

    test('60 seconds elapsed crosses into the 1-minute band', () => {
        expect(formatDraftAge(0, 60_000, 'en')).toBe(expectedRTF('en', -1, 'minute'))
    })

    test('59 minutes elapsed is still the minute band', () => {
        expect(formatDraftAge(0, 59 * 60_000, 'en')).toBe(expectedRTF('en', -59, 'minute'))
    })

    test('60 minutes elapsed crosses into the 1-hour band', () => {
        expect(formatDraftAge(0, 60 * 60_000, 'en')).toBe(expectedRTF('en', -1, 'hour'))
    })

    test('23 hours elapsed is still the hour band', () => {
        expect(formatDraftAge(0, 23 * 60 * 60_000, 'en')).toBe(expectedRTF('en', -23, 'hour'))
    })

    test('24 hours elapsed crosses into the 1-day band', () => {
        expect(formatDraftAge(0, 24 * 60 * 60_000, 'en')).toBe(expectedRTF('en', -1, 'day'))
    })
})

describe('formatDraftAge: negative elapsed time is clamped to zero', () => {
    test('a "now" earlier than updatedAt (e.g. a clock skew) is treated as 0 elapsed, not a negative duration', () => {
        expect(formatDraftAge(10_000, 0, 'en')).toBe(expectedRTF('en', 0, 'second'))
    })
})

describe('formatDraftAge: uiLanguage-to-Intl-tag mapping', () => {
    test("'cn' maps to the Simplified Chinese Intl tag 'zh-Hans'", () => {
        expect(formatDraftAge(0, 5 * 60_000, 'cn')).toBe(expectedRTF('zh-Hans', -5, 'minute'))
    })

    test("'zh-Hant' passes straight through to Intl unmapped", () => {
        expect(formatDraftAge(0, 5 * 60_000, 'zh-Hant')).toBe(expectedRTF('zh-Hant', -5, 'minute'))
    })

    test("'ja' passes straight through to Intl unmapped", () => {
        expect(formatDraftAge(0, 5 * 60_000, 'ja')).toBe(expectedRTF('ja', -5, 'minute'))
    })

    test('an unknown/unsupported language code falls back to "en"', () => {
        expect(formatDraftAge(0, 5 * 60_000, 'xx-not-a-real-code')).toBe(expectedRTF('en', -5, 'minute'))
    })

    test('an empty language code falls back to "en"', () => {
        expect(formatDraftAge(0, 5 * 60_000, '')).toBe(expectedRTF('en', -5, 'minute'))
    })
})

describe('formatDraftAge: mid-band values truncate rather than round', () => {
    // 90s is 1.5 minutes: floor -> 1, round -> 2. A boundary case alone
    // (e.g. 60s/120s) cannot distinguish the two, since floor and round only
    // disagree strictly BETWEEN whole-unit boundaries.
    test('90 seconds elapsed floors to 1 minute, not 2', () => {
        expect(formatDraftAge(0, 90_000, 'en')).toBe(expectedRTF('en', -1, 'minute'))
    })

    // 90 minutes is 1.5 hours: floor -> 1, round -> 2.
    test('90 minutes elapsed floors to 1 hour, not 2', () => {
        expect(formatDraftAge(0, 90 * 60_000, 'en')).toBe(expectedRTF('en', -1, 'hour'))
    })

    // 36 hours is 1.5 days: floor -> 1, round -> 2. The day band's own
    // `Math.floor` call is subject to the identical floor-vs-round ambiguity
    // as the minute and hour bands above.
    test('36 hours elapsed floors to 1 day, not 2', () => {
        expect(formatDraftAge(0, 36 * 60 * 60_000, 'en')).toBe(expectedRTF('en', -1, 'day'))
    })
})

describe('formatDraftAge: one literal sanity check, unlike the computed-string assertions above', () => {
    test("'en' at 12 minutes elapsed contains \"12\"", () => {
        expect(formatDraftAge(0, 12 * 60_000, 'en')).toContain('12')
    })
})
