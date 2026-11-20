// @vitest-environment jsdom

/**
 * The masked password prompt of the encrypted `.rtb` restore (CHORE-128 S10, T37), mounted through the real `askPassword`.
 *
 * The Enter and Escape keydowns are built like the Samsung WebView sequence (MC-329): compositionend, then keydown with
 * isComposing false. Only a live composition (isComposing or keyCode 229) holds a key; there is no time window after
 * compositionend. The gap test stubs `performance.now` to place the Enter at +2 ms and +200 ms, so a guard that holds an Enter
 * shortly after compositionend fails it.
 *
 * Labels: compatibility guards of a new component (no pre-fix base). Mutants each names turn a test red: M36 trim, M37 guard
 * removed from Enter, M38 time window after compositionend, M42 Show state remembered across prompts, M45 guard missing on Escape,
 * X15 Enter submitting from any focused element.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync } from 'svelte'
import { get } from 'svelte/store'
import { language } from 'src/lang'
import { enterKeydown, imeEventSequence } from 'src/ts/ime/tests/imeEventSequence'
import { askPassword } from 'src/ts/passwordPrompt'
import { alertStore } from 'src/ts/stores.svelte'

// The prompt never touches the alert queue; the test watches this store to prove it, and the app's own store graph stays out.
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { alertStore: writable({ type: 'none', msg: '' }) }
})

const PENDING = Symbol('pending')

/** The answer if it is already given, otherwise `PENDING`. */
async function answerOf(answer: Promise<string | null>): Promise<string | null | typeof PENDING> {
    return await Promise.race([answer, Promise.resolve(PENDING)])
}

function open(): { answer: Promise<string | null>, field: HTMLInputElement } {
    const answer = askPassword({ message: 'Enter the password' })
    flushSync()
    const field = document.querySelector<HTMLInputElement>('[role="dialog"] input:not([type="checkbox"])')
    if (field === null) {
        throw new Error('the prompt did not render')
    }
    return { answer, field }
}

function type(field: HTMLInputElement, text: string): void {
    field.value = text
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

function press(field: HTMLElement, key: string, init: { isComposing?: boolean, keyCode?: number } = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, code: key, keyCode: init.keyCode ?? 0, isComposing: init.isComposing ?? false, bubbles: true, cancelable: true })
    field.dispatchEvent(event)
    flushSync()
    return event
}

function button(label: string): HTMLButtonElement {
    const found = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((candidate) => candidate.textContent?.trim() === label)
    if (found === undefined) {
        throw new Error(`no button ${label}`)
    }
    return found
}

const showToggle = () => document.querySelector<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')!

afterEach(async () => {
    // A test that leaves a prompt open must not leak it into the next one.
    const left = document.querySelector('[role="dialog"]')
    if (left !== null) {
        button(language.cancel).click()
        flushSync()
    }
    vi.restoreAllMocks()
})

describe('T37 the masked field', () => {
    test('is a password input with autofill, capitalisation, correction and spellcheck off, focused when mounted, in a labelled modal', async () => {
        const { answer, field } = open()
        expect(field.type).toBe('password')
        expect(field.getAttribute('autocomplete')).toBe('off')
        expect(field.getAttribute('autocapitalize')).toBe('off')
        expect(field.getAttribute('autocorrect')).toBe('off')
        expect(field.getAttribute('spellcheck')).toBe('false')
        expect(document.activeElement).toBe(field)
        const dialog = document.querySelector('[role="dialog"]')!
        expect(dialog.getAttribute('aria-modal')).toBe('true')
        expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toBe('Enter the password')
        button(language.cancel).click()
        expect(await answer).toBeNull()
    })

    test('renders while no alert is on screen and never writes the alert store', async () => {
        expect(get(alertStore).type).toBe('none')
        const { answer, field } = open()
        type(field, 'secret')
        expect(get(alertStore).type).toBe('none')
        expect(JSON.stringify(get(alertStore))).not.toContain('secret')
        button(language.cancel).click()
        await answer
    })

    test('OK returns the text exactly as typed, a leading space kept (M36 fails it)', async () => {
        const { answer, field } = open()
        type(field, ' pw with space ')
        button(language.alertComp.ok).click()
        expect(await answer).toBe(' pw with space ')
    })

    test('Cancel and a plain Escape answer null', async () => {
        const first = open()
        type(first.field, 'abc')
        button(language.cancel).click()
        expect(await first.answer).toBeNull()
        const second = open()
        const escape = press(second.field, 'Escape')
        expect(escape.defaultPrevented).toBe(true)
        expect(await second.answer).toBeNull()
    })

    test('a plain Enter submits once and the component is unmounted after the answer', async () => {
        const { answer, field } = open()
        type(field, 'abc')
        const answers = vi.fn()
        void answer.then(answers)
        press(field, 'Enter', { keyCode: 13 })
        press(field, 'Enter', { keyCode: 13 })
        expect(await answer).toBe('abc')
        expect(answers).toHaveBeenCalledTimes(1)
        expect(document.querySelector('[role="dialog"]')).toBeNull()
    })
})

describe('T37 Enter on a button', () => {
    test('Enter on the Cancel button is left to the button, so it cancels and never submits the typed text', async () => {
        const { answer, field } = open()
        type(field, 'typed')
        const cancel = button(language.cancel)
        const enter = press(cancel, 'Enter', { keyCode: 13 })
        // The prompt must not take the key: the browser then activates the focused button, which answers null.
        expect(enter.defaultPrevented).toBe(false)
        expect(await answerOf(answer)).toBe(PENDING)
        cancel.click()
        expect(await answer).toBeNull()
    })
})

describe('T37 Show password', () => {
    test('switches the field to text and back, and a later prompt starts hidden again (M42 fails it)', async () => {
        const first = open()
        expect(showToggle().checked).toBe(false)
        showToggle().click()
        flushSync()
        expect(first.field.type).toBe('text')
        showToggle().click()
        flushSync()
        expect(first.field.type).toBe('password')
        showToggle().click()
        flushSync()
        expect(first.field.type).toBe('text')
        button(language.cancel).click()
        await first.answer
        const second = open()
        expect(second.field.type).toBe('password')
        expect(showToggle().checked).toBe(false)
        button(language.cancel).click()
        await second.answer
    })
})

describe('T37 the IME rule (MC-329)', () => {
    test('a composing Escape answers nothing and is not prevented; a plain Escape answers null (M45 fails it)', async () => {
        const { answer, field } = open()
        const composing = press(field, 'Escape', { isComposing: true, keyCode: 229 })
        expect(composing.defaultPrevented).toBe(false)
        expect(await answerOf(answer)).toBe(PENDING)
        expect(document.querySelector('[role="dialog"]')).not.toBeNull()
        press(field, 'Escape')
        expect(await answer).toBeNull()
    })

    test.each([false, true])('a composing Enter answers nothing and is not prevented (text mode %s; M37 fails it)', async (text) => {
        const { answer, field } = open()
        if (text) {
            showToggle().click()
            flushSync()
        }
        imeEventSequence(field, '한글')
        flushSync()
        const composing = enterKeydown(field, { isComposing: true, keyCode: 229 })
        flushSync()
        expect(composing.defaultPrevented).toBe(false)
        expect(await answerOf(answer)).toBe(PENDING)
        button(language.cancel).click()
        await answer
    })

    test.each([
        [2, false], [200, false], [2, true], [200, true],
    ])('the Enter %s ms after compositionend submits the composed text once (text mode %s; M38 fails it)', async (gap, text) => {
        const { answer, field } = open()
        if (text) {
            showToggle().click()
            flushSync()
        }
        const clock = vi.spyOn(performance, 'now')
        clock.mockReturnValue(1000)
        imeEventSequence(field, '한글')
        flushSync()
        clock.mockReturnValue(1000 + gap)
        const answers = vi.fn()
        void answer.then(answers)
        enterKeydown(field)
        flushSync()
        expect(await answerOf(answer)).toBe('한글')
        expect(answers).toHaveBeenCalledTimes(1)
    })
})
