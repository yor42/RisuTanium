/**
 * The time on a story card. Pure: the formatters and the clock are arguments,
 * so the caller decides the language and the tick.
 */

export interface StoryTimeFormats {
    relative: Intl.RelativeTimeFormat
    date: Intl.DateTimeFormat
    justNow: string
}

export const STORY_RELATIVE_OPTIONS: Intl.RelativeTimeFormatOptions = { numeric: 'always' }
export const STORY_DATE_OPTIONS: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const RELATIVE_DAYS_LIMIT = 31 * DAY

/**
 * Just now under a minute and for any future, non-finite or out-of-range time;
 * then minutes, hours and days (1 to 30); then a localized date. No value of
 * `at` reaches a formatter that would throw: the `!(age >= MINUTE)` form sends
 * future and NaN ages to just now, and a time the Date constructor cannot
 * represent is read as just now before the date branch can format it.
 */
export function storyTime(at: number, now: number, formats: StoryTimeFormats): string {
    const age = now - at
    if (!(age >= MINUTE) || Number.isNaN(new Date(at).getTime())) {
        return formats.justNow
    }
    if (age < HOUR) {
        return formats.relative.format(-Math.floor(age / MINUTE), 'minute')
    }
    if (age < DAY) {
        return formats.relative.format(-Math.floor(age / HOUR), 'hour')
    }
    if (age < RELATIVE_DAYS_LIMIT) {
        return formats.relative.format(-Math.floor(age / DAY), 'day')
    }
    return formats.date.format(at)
}

/** The machine-readable time for a `time` element, or undefined when the engine cannot represent `at` as a Date. */
export function storyDateTime(at: number): string | undefined {
    const date = new Date(at)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}
