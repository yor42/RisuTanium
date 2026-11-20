// @vitest-environment jsdom

/**
 * The masked password prompt of the encrypted `.rtb` restore (CHORE-128 S10, T37; S1 moved it onto `PatternDialog`), mounted
 * through the real `askPassword`.
 *
 * The prompt is located by `[aria-modal="true"]` and the locating helper asserts there is exactly one, so a setup failure is
 * never mistaken for a behaviour failure. The Enter and Escape keydowns are built like the Samsung WebView sequence (MC-329):
 * compositionend, then keydown with isComposing false. Only a live composition (isComposing or keyCode 229) holds a key; there
 * is no time window after compositionend. The gap test stubs `performance.now` to place the Enter at +2 ms and +200 ms, so a
 * guard that holds an Enter shortly after compositionend fails it.
 *
 * Every negative assertion sits beside a control that shows the forbidden effect is reachable in the same state. The prompt
 * deliberately returns no focus on close (explicit null trigger), so no test asserts that focus returns to an opener.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync } from 'svelte'
import { get } from 'svelte/store'
import { language } from 'src/lang'
import * as backHandlersModule from 'src/ts/backHandlers'
import { dispatchBack, registerBackHandler, resetBackHandlersForTests } from 'src/ts/backHandlers'
import { enterKeydown, imeEventSequence } from 'src/ts/ime/tests/imeEventSequence'
import { askPassword } from 'src/ts/passwordPrompt'
import { alertStore } from 'src/ts/stores.svelte'

// The prompt never touches the alert queue; the test watches this store to prove it, and the app's own store graph stays out.
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { alertStore: writable({ type: 'none', msg: '' }) }
})

const PENDING = Symbol('pending')
const extras: HTMLElement[] = []

/** The answer if it is already given, otherwise `PENDING`. */
async function answerOf(answer: Promise<string | null>): Promise<string | null | typeof PENDING> {
    return await Promise.race([answer, Promise.resolve(PENDING)])
}

function dialog(): HTMLElement {
    const found = document.querySelectorAll<HTMLElement>('[aria-modal="true"]')
    if (found.length !== 1) {
        throw new Error(`expected one prompt, found ${found.length}`)
    }
    return found[0]
}

function open(): { answer: Promise<string | null>, field: HTMLInputElement } {
    const answer = askPassword({ message: 'Enter the password' })
    flushSync()
    const field = dialog().querySelector<HTMLInputElement>('input:not([type="checkbox"])')
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
    const found = Array.from(dialog().querySelectorAll<HTMLButtonElement>('button')).find((candidate) => candidate.textContent?.trim() === label)
    if (found === undefined) {
        throw new Error(`no button ${label}`)
    }
    return found
}

const showToggle = () => dialog().querySelector<HTMLInputElement>('input[type="checkbox"]')!

/** A body-level element outside the prompt. */
function sibling(tag: string, attributes: Record<string, string> = {}): HTMLElement {
    const created = document.createElement(tag)
    for (const [name, value] of Object.entries(attributes)) created.setAttribute(name, value)
    document.body.appendChild(created)
    extras.push(created)
    return created
}

afterEach(async () => {
    // A test that leaves a prompt open must not leak it into the next one.
    if (document.querySelector('[aria-modal="true"]') !== null) {
        button(language.cancel).click()
        flushSync()
    }
    for (const created of extras.splice(0)) created.remove()
    resetBackHandlersForTests()
    vi.restoreAllMocks()
})

describe('T37 the masked field', () => {
    test('is a password input with autofill, capitalisation, correction and spellcheck off, focused when mounted, in a labelled modal alert dialog', async () => {
        const { answer, field } = open()
        expect(field.type).toBe('password')
        expect(field.getAttribute('autocomplete')).toBe('off')
        expect(field.getAttribute('autocapitalize')).toBe('off')
        expect(field.getAttribute('autocorrect')).toBe('off')
        expect(field.getAttribute('spellcheck')).toBe('false')
        // First focus comes only from the initial-focus mark; without it the shell would hold focus.
        expect(document.activeElement).toBe(field)
        const prompt = dialog()
        expect(prompt.getAttribute('role')).toBe('alertdialog')
        expect(prompt.getAttribute('aria-modal')).toBe('true')
        expect(document.getElementById(prompt.getAttribute('aria-labelledby')!)!.textContent).toBe('Enter the password')
        button(language.cancel).click()
        expect(await answer).toBeNull()
    })

    test('renders while no alert is on screen and never writes the alert store', async () => {
        expect(get(alertStore).type).toBe('none')
        const { answer, field } = open()
        type(field, 'secret')
        // There is text to leak.
        expect(field.value).toBe('secret')
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
        // The dialog is present before the first Enter, so its absence afterwards is the unmount.
        expect(dialog()).not.toBeNull()
        const answers = vi.fn()
        void answer.then(answers)
        press(field, 'Enter', { keyCode: 13 })
        press(field, 'Enter', { keyCode: 13 })
        expect(await answer).toBe('abc')
        expect(answers).toHaveBeenCalledTimes(1)
        expect(document.querySelector('[aria-modal="true"]')).toBeNull()
    })
})

describe('T37 Enter on a button', () => {
    test('Enter on the Cancel button is left to the button, so it cancels and never submits the typed text', async () => {
        const { answer, field } = open()
        type(field, 'typed')
        // There is text a submit would carry.
        expect(field.value).toBe('typed')
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
    test('a composing Escape answers nothing and is consumed; a plain Escape answers null', async () => {
        const { answer, field } = open()
        const composing = press(field, 'Escape', { isComposing: true, keyCode: 229 })
        expect(composing.defaultPrevented).toBe(true)
        expect(await answerOf(answer)).toBe(PENDING)
        expect(document.querySelector('[aria-modal="true"]')).not.toBeNull()
        press(field, 'Escape')
        expect(await answer).toBeNull()
    })

    test.each([false, true])('a composing Enter answers nothing and is not prevented, and a plain Enter then submits (text mode %s; M37 fails it)', async (text) => {
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
        // Enter submits in this very state, so the composing Enter above was held by the guard alone.
        enterKeydown(field)
        flushSync()
        expect(await answer).toBe('한글')
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

describe('S1 the prompt as a dialog shell', () => {
    test('T-S1-1 Tab wraps from OK to the field and Shift+Tab from the field to OK', async () => {
        const { answer, field } = open()
        const ok = button(language.alertComp.ok)
        ok.focus()
        expect(press(ok, 'Tab').defaultPrevented).toBe(true)
        expect(document.activeElement).toBe(field)
        expect(press(field, 'Tab', {}).defaultPrevented).toBe(false)
        const shift = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
        field.dispatchEvent(shift)
        flushSync()
        expect(shift.defaultPrevented).toBe(true)
        expect(document.activeElement).toBe(ok)
        button(language.cancel).click()
        await answer
    })

    test('T-S1-2 focus forced outside the prompt comes back inside it', async () => {
        const outside = sibling('button')
        const { answer } = open()
        outside.focus()
        flushSync()
        expect(dialog().contains(document.activeElement)).toBe(true)
        expect(document.activeElement).not.toBe(outside)
        button(language.cancel).click()
        await answer
    })

    test('T-S1-3 the page behind is inert while the prompt is open and released after the answer; an already inert sibling stays inert', async () => {
        const s1 = sibling('div')
        const s2 = sibling('div', { inert: '' })
        const { answer, field } = open()
        // Control: the release below is observed on an element that was shown inert.
        expect(s1.hasAttribute('inert')).toBe(true)
        expect(s2.hasAttribute('inert')).toBe(true)
        type(field, 'x')
        button(language.alertComp.ok).click()
        await answer
        expect(s1.hasAttribute('inert')).toBe(false)
        expect(s2.hasAttribute('inert')).toBe(true)
    })

    test.each(['cancel', 'ok', 'escape', 'back'])('T-S1-4 a control focused before the prompt is not refocused after %s', async (route) => {
        const before = sibling('button')
        before.focus()
        expect(document.activeElement).toBe(before)
        const { answer, field } = open()
        if (route === 'cancel') button(language.cancel).click()
        else if (route === 'ok') button(language.alertComp.ok).click()
        else if (route === 'escape') press(field, 'Escape')
        else expect(dispatchBack()).toBe(true)
        await answer
        expect(document.activeElement).toBe(document.body)
        // Control: `before` is connected, focusable and not inert, so a teardown refocus would have landed on it.
        before.focus()
        expect(document.activeElement).toBe(before)
    })

    test('T-S1-5 Back answers null and is not passed to an older handler', async () => {
        const older = vi.fn(() => true)
        registerBackHandler(older)
        const { answer } = open()
        expect(dispatchBack()).toBe(true)
        expect(await answer).toBeNull()
        expect(document.querySelector('[aria-modal="true"]')).toBeNull()
        expect(older).not.toHaveBeenCalled()
        // Control: once the prompt's handler has gone, the older one is reachable through dispatch.
        expect(dispatchBack()).toBe(true)
        expect(older).toHaveBeenCalledTimes(1)
    })

    test('T-S1-6 after the answer Back is not trapped', async () => {
        const { answer } = open()
        // Control: while the prompt is open, Back is taken and the prompt answers.
        expect(dispatchBack()).toBe(true)
        expect(await answer).toBeNull()
        expect(dispatchBack()).toBe(false)
    })

    test('T-S1-7 Escape on Cancel or on OK answers null and never reaches the document', async () => {
        const seen = vi.fn()
        document.addEventListener('keydown', seen)
        try {
            for (const label of [language.cancel, language.alertComp.ok]) {
                const { answer } = open()
                const target = button(label)
                target.focus()
                // Control: a key the dialog ignores does reach the document from this very button.
                seen.mockClear()
                press(target, 'x')
                expect(seen).toHaveBeenCalledTimes(1)
                seen.mockClear()
                const escape = press(target, 'Escape')
                expect(escape.defaultPrevented).toBe(true)
                expect(await answer).toBeNull()
                expect(seen).not.toHaveBeenCalled()
            }
        } finally {
            document.removeEventListener('keydown', seen)
        }
    })

    test.each(['cancel', 'ok', 'escape', 'back'])('T-S1-11 by the time the caller continues after %s the dialog is gone, inert is released and nothing is focused', async (route) => {
        const s1 = sibling('button')
        const { answer, field } = open()
        // Controls: the dialog is present, the sibling is inert and focus is inside the dialog.
        expect(dialog()).not.toBeNull()
        expect(s1.hasAttribute('inert')).toBe(true)
        expect(dialog().contains(document.activeElement)).toBe(true)
        expect(document.activeElement).toBe(field)
        const probe = vi.fn(() => ({
            dialogs: document.querySelectorAll('[aria-modal="true"]').length,
            inert: s1.hasAttribute('inert'),
            active: document.activeElement,
        }))
        const probed = answer.then(probe)
        if (route === 'cancel') button(language.cancel).click()
        else if (route === 'ok') button(language.alertComp.ok).click()
        else if (route === 'escape') press(field, 'Escape')
        else expect(dispatchBack()).toBe(true)
        await probed
        expect(probe).toHaveBeenCalledTimes(1)
        expect(probe.mock.results[0].value).toEqual({ dialogs: 0, inert: false, active: document.body })
    })

    test.each(['ok', 'back', 'cancel', 'escape'])('T-S1-12 the Back handler is unregistered by the time the caller continues after %s', async (route) => {
        const releases: ReturnType<typeof vi.fn>[] = []
        const register = backHandlersModule.registerBackHandler
        const spy = vi.spyOn(backHandlersModule, 'registerBackHandler').mockImplementation((handler) => {
            const release = vi.fn(register(handler))
            releases.push(release)
            return release
        })
        try {
            const before = releases.length
            const { answer, field } = open()
            expect(releases.length).toBe(before + 1)
            const release = releases[before]
            expect(release).not.toHaveBeenCalled()
            const atResolve = vi.fn()
            const resolved = answer.then(() => atResolve(release.mock.calls.length))
            if (route === 'cancel') button(language.cancel).click()
            else if (route === 'ok') button(language.alertComp.ok).click()
            else if (route === 'escape') press(field, 'Escape')
            else expect(dispatchBack()).toBe(true)
            await resolved
            expect(atResolve).toHaveBeenCalledWith(1)
            expect(release).toHaveBeenCalledTimes(1)
        } finally {
            spy.mockRestore()
        }
    })
})
