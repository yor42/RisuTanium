/**
 * The cancellable select and input prompts: the answer codec, the two ask functions over the real prompt
 * controller, and the Back and page-covering classification of the two alert types. The old `select` and
 * `input` prompts keep holding Back.
 */
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { alertData } from './alert'

vi.mock(import('./stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('./stores.svelte'))

vi.mock(import('./storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
}) as unknown as typeof import('./storage/database.svelte'))

vi.mock(import('./platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('./platform'))

import { alertInput, alertSelect } from './alert'
import { ALERT_BACK_ACTIONS } from './alertBack'
import { ALERT_COVERS_PAGE, escapeActionFor } from './alertEscape'
import { ANSWER_GUARD_MS, isPromptType, pageCovered, resetAlertPromptsForTests } from './alertPrompts'
import { dispatchBack, resetBackHandlersForTests } from './backHandlers'
import { askChoice, askText } from './patternPrompt'
import { decodeChoice, decodeText, encodeChoice, encodeText, PATTERN_PROMPT_CANCEL } from './patternPromptAnswer'
import { alertStore } from './stores.svelte'

function shown(): alertData {
    return get(alertStore)
}

async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0)
}

async function answerAfterGuard(message: string): Promise<void> {
    await vi.advanceTimersByTimeAsync(ANSWER_GUARD_MS)
    alertStore.set({ type: 'none', msg: message })
    await settle()
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    resetBackHandlersForTests()
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' })
})

afterEach(() => {
    resetBackHandlersForTests()
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' })
    vi.useRealTimers()
})

describe('the answer codec', () => {
    test('a chosen index and entered text round-trip, including index zero and empty text', () => {
        expect(decodeChoice(encodeChoice(0), 3)).toBe(0)
        expect(decodeChoice(encodeChoice(2), 3)).toBe(2)
        expect(decodeText(encodeText('hello'))).toBe('hello')
        expect(decodeText(encodeText(''))).toBe('')
    })

    test('the cancel constant decodes to null for both kinds', () => {
        expect(decodeChoice(PATTERN_PROMPT_CANCEL, 3)).toBeNull()
        expect(decodeText(PATTERN_PROMPT_CANCEL)).toBeNull()
    })

    test('an out-of-range, fractional or negative index decodes to null', () => {
        expect(decodeChoice(encodeChoice(3), 3)).toBeNull()
        expect(decodeChoice(encodeChoice(-1), 3)).toBeNull()
        expect(decodeChoice(encodeChoice(1.5), 3)).toBeNull()
        expect(decodeChoice(encodeChoice(0), 0)).toBeNull()
    })

    test('an answer of the wrong kind decodes to null', () => {
        expect(decodeChoice(encodeText('1'), 3)).toBeNull()
        expect(decodeText(encodeChoice(1))).toBeNull()
    })

    test('malformed messages decode to null', () => {
        for (const msg of ['', 'cancel', 'no', '{', 'null', '[]', '{}', '{"value":null}', '{"value":{}}', '{"value":true}', '{"value":0,"cancel":true}']) {
            expect(decodeChoice(msg, 3), msg).toBeNull()
            expect(decodeText(msg), msg).toBeNull()
        }
    })
})

describe('askChoice and askText over the prompt controller', () => {
    test('a choice answer resolves the index', async () => {
        const result = askChoice('Pick', ['a', 'b', 'c'])
        expect(shown().type).toBe('patternSelect')
        expect(shown().msg).toBe('Pick')
        expect(shown().choices).toEqual(['a', 'b', 'c'])
        await answerAfterGuard(encodeChoice(2))
        await expect(result).resolves.toBe(2)
        expect(shown().type).toBe('none')
    })

    test('an index outside the choices resolves null', async () => {
        const result = askChoice('Pick', ['a', 'b'])
        await answerAfterGuard(encodeChoice(2))
        await expect(result).resolves.toBeNull()
    })

    test('a stray empty none message resolves null, never a choice', async () => {
        const result = askChoice('Pick', ['a', 'b'])
        await answerAfterGuard('')
        await expect(result).resolves.toBeNull()
    })

    test('a cancel resolves null for a choice and for text', async () => {
        const choice = askChoice('Pick', ['a'])
        await answerAfterGuard(PATTERN_PROMPT_CANCEL)
        await expect(choice).resolves.toBeNull()
        const text = askText('Name')
        await answerAfterGuard(PATTERN_PROMPT_CANCEL)
        await expect(text).resolves.toBeNull()
    })

    test('text resolves as entered, including the empty string, and the prompt carries its default and datalist', async () => {
        const result = askText('Name', { defaultValue: 'x', datalist: [['a', 'A']] })
        expect(shown().type).toBe('patternInput')
        expect(shown().defaultValue).toBe('x')
        expect(shown().datalist).toEqual([['a', 'A']])
        await answerAfterGuard(encodeText(''))
        await expect(result).resolves.toBe('')
    })

    test('an answer inside the answer guard is discarded and the prompt stays up', async () => {
        const result = askChoice('Pick', ['a'])
        const data = shown()
        alertStore.set({ type: 'none', msg: encodeChoice(0) })
        await settle()
        expect(shown()).toBe(data)
        await answerAfterGuard(encodeChoice(0))
        await expect(result).resolves.toBe(0)
    })
})

describe('Back and page covering', () => {
    test('Back cancels a shown patternSelect and a shown patternInput, even inside the answer guard', async () => {
        const choice = askChoice('Pick', ['a', 'b'])
        expect(dispatchBack()).toBe(true)
        await settle()
        await expect(choice).resolves.toBeNull()
        expect(shown().type).toBe('none')

        const text = askText('Name', { defaultValue: 'keep' })
        expect(dispatchBack()).toBe(true)
        await settle()
        await expect(text).resolves.toBeNull()
    })

    test('Back never answers with a choice or text', () => {
        for (const type of ['patternSelect', 'patternInput'] as const) {
            const action = ALERT_BACK_ACTIONS[type]
            expect(action).toEqual({ kind: 'answer', message: PATTERN_PROMPT_CANCEL })
        }
    })

    test('the old select and input prompts still hold Back and stay up', async () => {
        const select = alertSelect(['a', 'b'])
        const data = shown()
        await vi.advanceTimersByTimeAsync(ANSWER_GUARD_MS)
        dispatchBack()
        await settle()
        expect(shown()).toBe(data)
        alertStore.set({ type: 'none', msg: '0' })
        await select

        const input = alertInput('Name')
        const inputData = shown()
        await vi.advanceTimersByTimeAsync(ANSWER_GUARD_MS)
        dispatchBack()
        await settle()
        expect(shown()).toBe(inputData)
        alertStore.set({ type: 'none', msg: 'x' })
        await input
        expect(ALERT_BACK_ACTIONS.select).toEqual({ kind: 'hold' })
        expect(ALERT_BACK_ACTIONS.input).toEqual({ kind: 'hold' })
    })

    test('both new types are prompts that Escape ignores and that cover the page', () => {
        for (const type of ['patternSelect', 'patternInput'] as const) {
            expect(escapeActionFor(type)).toBe('ignore')
            expect(isPromptType(type)).toBe(true)
            expect(ALERT_COVERS_PAGE[type]).toBe(true)
        }
        void askChoice('Pick', ['a'])
        expect(pageCovered()).toBe(true)
    })
})
