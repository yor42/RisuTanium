/**
 * The pure rules that decide what a failed archived read is called and what the
 * user is told (`./coldstorageData`):
 *
 * - `classifyColdDecodeFailure` calls a decode failure "damaged" only when the
 *   error says the stored bytes themselves are bad: an fflate data-format code
 *   (0 truncated, 1, 2, 3 bad stream, 6 bad header) or a SyntaxError from
 *   `JSON.parse`. Every other failure while decoding (out of memory, a Worker
 *   that cannot start, a RangeError, an fflate API-misuse code) is not a
 *   statement about the data and stays a plain read error.
 * - `coldChatNoticeText`, `legacyRetryStateFor` and `legacyRetryView` choose the
 *   chat text for every result value. The text for a no-storage or damaged read
 *   never invites a retry and never claims the data is lost or tells the user
 *   to delete the chat; a plain read error keeps the retry invitation.
 *
 * The cases for a missing unit, a plain read error and the Retry notice are
 * guards: a missing unit keeps its data-missing text and no Retry button, a
 * plain read error keeps the temporary-problem text and the Retry button.
 */
import { describe, test, expect } from 'vitest'
import { compressSync, decompressSync } from 'fflate'
import { language } from 'src/lang'
import {
    classifyColdDecodeFailure,
    coldChatNoticeText,
    legacyRetryStateFor,
    legacyRetryView,
    type LegacyRetryState,
} from './coldstorageData'
import type { PreLoadChatResult, RetryLegacyColdChatLoadResult } from './coldstorage.svelte'

const KEY = 'chat-unit-key'

function decodeError(bytes: Uint8Array): unknown {
    try {
        decompressSync(bytes)
    } catch (error) {
        return error
    }
    throw new Error('the bytes decoded; the fixture is not a decode failure')
}

describe('classifyColdDecodeFailure', () => {
    test.each([0, 1, 2, 3, 6])('an error with the fflate data-format code %i is damaged', (code) => {
        expect(classifyColdDecodeFailure(Object.assign(new Error('bad data'), { code }))).toBe('damaged')
    })

    test('code 0, a truncated stream, is damaged and is not mistaken for "no code"', () => {
        expect(classifyColdDecodeFailure({ code: 0 })).toBe('damaged')
    })

    test('the error fflate throws for a truncated stream is damaged', () => {
        const whole = compressSync(new TextEncoder().encode(JSON.stringify({ message: ['x'.repeat(2000)] })))
        const error = decodeError(whole.slice(0, Math.floor(whole.length / 2)))
        expect(typeof (error as { code?: unknown }).code).toBe('number')
        expect(classifyColdDecodeFailure(error)).toBe('damaged')
    })

    test('the error fflate throws for bytes that are not a compressed stream is damaged', () => {
        const error = decodeError(new Uint8Array([1, 2, 3, 4]))
        expect(typeof (error as { code?: unknown }).code).toBe('number')
        expect(classifyColdDecodeFailure(error)).toBe('damaged')
    })

    test('the SyntaxError JSON.parse throws is damaged', () => {
        let thrown: unknown
        try {
            JSON.parse('{not valid json')
        } catch (error) {
            thrown = error
        }
        expect(classifyColdDecodeFailure(thrown)).toBe('damaged')
    })

    test('an error recognised by name only (another realm\'s SyntaxError) is damaged', () => {
        expect(classifyColdDecodeFailure({ name: 'SyntaxError', message: 'Unexpected token' })).toBe('damaged')
    })

    test.each([4, 5, 7, 8, 9, 10, 11, 12, 13, 14])('an error with the fflate code %i, which decompress never raises for bad input, is not damaged', (code) => {
        expect(classifyColdDecodeFailure(Object.assign(new Error('misuse'), { code }))).toBeNull()
    })

    test.each([
        ['a RangeError (a buffer or string too large)', new RangeError('Array buffer allocation failed')],
        ['a plain Error', new Error('something else')],
        ['an error shaped like a Worker that could not run (no code)', Object.assign(new Error('Worker failed'), { name: 'SecurityError' })],
        ['an error with a string code', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })],
        ['an error with a code that is not a number', Object.assign(new Error('x'), { code: '0' })],
        ['null', null],
        ['undefined', undefined],
        ['a string', 'unexpected EOF'],
        ['a number', 0],
    ])('%s is not damaged', (_label, error) => {
        expect(classifyColdDecodeFailure(error)).toBeNull()
    })
})

describe('coldChatNoticeText', () => {
    test('a missing chat unit keeps its text', () => {
        expect(coldChatNoticeText('missing', KEY)).toBe(language.errors.coldStorageChatDataMissing(KEY))
    })

    test('a plain read error keeps the temporary-problem text, which invites a retry', () => {
        const text = coldChatNoticeText('error', KEY)
        expect(text).toBe(language.errors.coldStorageChatLoadFailed(KEY))
        expect(text).toMatch(/temporary/i)
    })

    test.each(['none', 'ok'] as const)('the %s result shows no notice', (result) => {
        expect(coldChatNoticeText(result, KEY)).toBeNull()
    })

    test('a no-storage read shows its own text, naming the key, not the temporary-problem text', () => {
        const text = coldChatNoticeText('unavailable', KEY)
        expect(text).toBe(language.errors.coldStorageChatUnavailable(KEY))
        expect(text).toContain(KEY)
        expect(text).not.toBe(language.errors.coldStorageChatLoadFailed(KEY))
        expect(text).not.toBe(language.errors.coldStorageChatDataMissing(KEY))
    })

    test('a damaged read shows its own text, naming the key, not the temporary-problem text', () => {
        const text = coldChatNoticeText('damaged', KEY)
        expect(text).toBe(language.errors.coldStorageChatDamaged(KEY))
        expect(text).toContain(KEY)
        expect(text).not.toBe(language.errors.coldStorageChatLoadFailed(KEY))
        expect(text).not.toBe(language.errors.coldStorageChatDataMissing(KEY))
    })

    test.each(['unavailable', 'damaged'] as const)('the %s text neither invites a retry nor claims loss nor advises deleting the chat', (result) => {
        const text = coldChatNoticeText(result, KEY) as string
        expect(text).not.toMatch(/try again|temporary|switching chats|restarting|delete this chat|permanently|\blost\b/i)
        expect(text).toMatch(/nothing was changed/i)
    })

    test('every result value has a defined answer: text for the four failures, null for the two successes', () => {
        const results: PreLoadChatResult[] = ['none', 'ok', 'missing', 'error', 'unavailable', 'damaged']
        const answers = results.map((result) => coldChatNoticeText(result, KEY))
        expect(answers.filter((answer) => answer !== null)).toHaveLength(4)
        expect(new Set(answers.filter((answer) => answer !== null)).size).toBe(4)
    })
})

describe('legacyRetryStateFor', () => {
    test.each([
        ['missing', 'missing'],
        ['error', 'retryFailed'],
        ['busy', 'retryFailed'],
    ] as const)('the %s result is recorded as %s', (result, state) => {
        expect(legacyRetryStateFor(result)).toBe(state)
    })

    test.each(['ok', 'none'] as const)('the %s result clears the recorded state', (result) => {
        expect(legacyRetryStateFor(result)).toBeNull()
    })

    test('a no-storage read is recorded as unavailable, not as a retryable failure', () => {
        expect(legacyRetryStateFor('unavailable')).toBe('unavailable')
    })

    test('a damaged read is recorded as damaged, not as a retryable failure', () => {
        expect(legacyRetryStateFor('damaged')).toBe('damaged')
    })

    test('every result value maps to a distinct recorded state or to none, and none is lost', () => {
        const results: RetryLegacyColdChatLoadResult[] = ['none', 'busy', 'ok', 'missing', 'error', 'unavailable', 'damaged']
        const states = results.map((result) => legacyRetryStateFor(result))
        expect(states).toEqual([null, 'retryFailed', null, 'missing', 'retryFailed', 'unavailable', 'damaged'])
    })
})

describe('legacyRetryView', () => {
    test.each([undefined, 'pending'] as const)('with the state %s the notice offers the Retry button and no failure line', (state) => {
        expect(legacyRetryView(state)).toEqual({
            text: language.errors.coldStorageLegacyChatRetryNotice,
            detail: null,
            showRetry: true,
        })
    })

    test('after a failed retry the notice offers the Retry button with the try-later line', () => {
        expect(legacyRetryView('retryFailed')).toEqual({
            text: language.errors.coldStorageLegacyChatRetryNotice,
            detail: language.errors.coldStorageLegacyChatRetryFailed,
            showRetry: true,
        })
    })

    test('a missing unit shows its text and hides the Retry button', () => {
        expect(legacyRetryView('missing')).toEqual({
            text: language.errors.coldStorageLegacyChatDataMissing,
            detail: null,
            showRetry: false,
        })
    })

    test('a no-storage read shows its own text, with no failure line and no Retry button', () => {
        expect(legacyRetryView('unavailable')).toEqual({
            text: language.errors.coldStorageLegacyChatUnavailable,
            detail: null,
            showRetry: false,
        })
    })

    test('a damaged read shows its own text, with no failure line and no Retry button', () => {
        expect(legacyRetryView('damaged')).toEqual({
            text: language.errors.coldStorageLegacyChatDamaged,
            detail: null,
            showRetry: false,
        })
    })

    test.each(['unavailable', 'damaged'] as const)('the %s notice never says to try again or later', (state) => {
        const view = legacyRetryView(state)
        expect(view.text).not.toMatch(/try|again|later|retry/i)
        expect(view.showRetry).toBe(false)
        expect(view.detail).toBeNull()
    })

    test('the Retry button is hidden for exactly the three states that cannot succeed by pressing it', () => {
        const states: Array<LegacyRetryState | undefined> = [undefined, 'pending', 'missing', 'retryFailed', 'unavailable', 'damaged']
        expect(states.map((state) => legacyRetryView(state).showRetry)).toEqual([true, true, false, true, false, false])
    })

    test('reproducer: on a store2 page no state offers Retry, and every state says the earlier messages could not be read', () => {
        const states: Array<LegacyRetryState | undefined> = [undefined, 'pending', 'missing', 'retryFailed', 'unavailable', 'damaged']
        for (const state of states) {
            expect(legacyRetryView(state, true), String(state)).toEqual({
                text: language.errors.coldStorageLegacyChatDamaged,
                detail: null,
                showRetry: false,
            })
        }
    })

    test('guard: a page that is not store2 keeps the matrix (the explicit false equals the default)', () => {
        const states: Array<LegacyRetryState | undefined> = [undefined, 'pending', 'missing', 'retryFailed', 'unavailable', 'damaged']
        for (const state of states) {
            expect(legacyRetryView(state, false)).toEqual(legacyRetryView(state))
        }
        expect(legacyRetryView(undefined, false).showRetry).toBe(true)
    })
})
