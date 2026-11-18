// Report 20 §5.4 / MC-068: the draft-restore marker's age text. Pure and
// Svelte-free, like `draftContents.ts` -- the marker itself lives in
// `Chat.svelte`, which supplies `Date.now()` and the app's own UI language
// code (the same string `changeLanguage` in `src/lang/index.ts` takes).
//
// No new locale strings: `Intl.RelativeTimeFormat` already ships a
// translation for every unit this needs, in every locale it supports, so
// MC-068's "the age needs no new locale strings" is met by delegating to it
// rather than adding a seventh set of hand-written phrases.

import { resolveIntlTag } from './intlTag'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * Formats how long ago `updatedAt` was, relative to `now`, in `uiLanguage`.
 * Elapsed time is clamped to a minimum of 0 (a `now` earlier than
 * `updatedAt`, e.g. a clock skew, is never reported as a negative duration).
 */
export function formatDraftAge(updatedAt: number, now: number, uiLanguage: string): string {
    const rtf = new Intl.RelativeTimeFormat(resolveIntlTag(uiLanguage), { numeric: 'auto' })
    const elapsedMs = Math.max(0, now - updatedAt)

    if (elapsedMs < MINUTE_MS) {
        return rtf.format(0, 'second')
    }
    if (elapsedMs < HOUR_MS) {
        return rtf.format(-Math.floor(elapsedMs / MINUTE_MS), 'minute')
    }
    if (elapsedMs < DAY_MS) {
        return rtf.format(-Math.floor(elapsedMs / HOUR_MS), 'hour')
    }
    return rtf.format(-Math.floor(elapsedMs / DAY_MS), 'day')
}
