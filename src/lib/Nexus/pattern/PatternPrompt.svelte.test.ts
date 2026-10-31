import { get, writable } from 'svelte/store'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('../../../ts/stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('../../../ts/stores.svelte'))

import { alertStore } from '../../../ts/stores.svelte'
import { encodeChoice, encodeText, PATTERN_PROMPT_CANCEL } from '../../../ts/patternPromptAnswer'
import PatternPrompt from './PatternPrompt.svelte'
import PatternPromptHost from './PatternPromptHost.svelte'

const mounted: { target: HTMLElement, app: Record<string, unknown> }[] = []

function render(component: unknown, props: Record<string, unknown>): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(component as never, { target, props }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

function part(target: HTMLElement, name: string): HTMLElement {
    return target.querySelector<HTMLElement>(`[data-part="pattern-prompt-${name}"]`)!
}

function escapeEvent(): KeyboardEvent {
    return new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
}

afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) {
        await unmount(app as never)
        target.remove()
    }
    alertStore.set({ type: 'none', msg: '' })
})

describe('PatternPrompt select', () => {
    test('clicking choice i answers its encoded index once', () => {
        const onanswer = vi.fn()
        const target = render(PatternPrompt, { kind: 'select', heading: 'Pick', choices: ['a', 'b', 'c'], onanswer })
        const buttons = target.querySelectorAll<HTMLButtonElement>('[data-part="pattern-prompt-choice"]')
        expect([...buttons].map((button) => button.textContent)).toEqual(['a', 'b', 'c'])
        buttons[1].click()
        buttons[2].click()
        expect(onanswer).toHaveBeenCalledExactlyOnceWith(encodeChoice(1))
    })

    test('the Cancel button answers the cancel value and a select has no OK button', () => {
        const onanswer = vi.fn()
        const target = render(PatternPrompt, { kind: 'select', heading: 'Pick', choices: ['a'], onanswer })
        expect(part(target, 'ok')).toBeNull()
        part(target, 'cancel').click()
        expect(onanswer).toHaveBeenCalledExactlyOnceWith(PATTERN_PROMPT_CANCEL)
    })

    test('Escape is consumed and cancels once', () => {
        const onanswer = vi.fn()
        render(PatternPrompt, { kind: 'select', heading: 'Pick', choices: ['a'], onanswer })
        const first = escapeEvent()
        window.dispatchEvent(first)
        window.dispatchEvent(escapeEvent())
        expect(first.defaultPrevented).toBe(true)
        expect(onanswer).toHaveBeenCalledExactlyOnceWith(PATTERN_PROMPT_CANCEL)
    })

    test('a tap on the scrim does nothing', () => {
        const onanswer = vi.fn()
        const target = render(PatternPrompt, { kind: 'select', heading: 'Pick', choices: ['a'], onanswer })
        target.querySelector<HTMLElement>('[data-part="pattern-scrim"]')!.click()
        expect(onanswer).not.toHaveBeenCalled()
    })

    test('the dialog is named by its heading', () => {
        const target = render(PatternPrompt, { kind: 'select', heading: 'Pick one', choices: ['a'], onanswer: vi.fn() })
        const dialog = target.querySelector<HTMLElement>('[role="alertdialog"]')!
        expect(target.querySelector(`#${CSS.escape(dialog.getAttribute('aria-labelledby')!)}`)!.textContent).toBe('Pick one')
    })
})

describe('PatternPrompt input', () => {
    test('the field starts at the default value and Enter answers the encoded text once', () => {
        const onanswer = vi.fn()
        const target = render(PatternPrompt, { kind: 'input', heading: 'Name', defaultValue: 'abc', onanswer })
        const field = part(target, 'field') as HTMLInputElement
        expect(field.value).toBe('abc')
        expect(document.activeElement).toBe(field)
        field.value = 'xyz'
        field.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
        expect(onanswer).toHaveBeenCalledExactlyOnceWith(encodeText('xyz'))
    })

    test('OK answers the entered text, including the empty string', () => {
        const onanswer = vi.fn()
        const target = render(PatternPrompt, { kind: 'input', heading: 'Name', onanswer })
        part(target, 'ok').click()
        expect(onanswer).toHaveBeenCalledExactlyOnceWith(encodeText(''))
    })

    test('Cancel and Escape answer the cancel value, never the text', () => {
        const cancelled = vi.fn()
        const target = render(PatternPrompt, { kind: 'input', heading: 'Name', defaultValue: 'keep', onanswer: cancelled })
        part(target, 'cancel').click()
        expect(cancelled).toHaveBeenCalledExactlyOnceWith(PATTERN_PROMPT_CANCEL)

        const escaped = vi.fn()
        render(PatternPrompt, { kind: 'input', heading: 'Other', defaultValue: 'keep', onanswer: escaped })
        window.dispatchEvent(escapeEvent())
        expect(escaped).toHaveBeenCalledExactlyOnceWith(PATTERN_PROMPT_CANCEL)
    })

    test('a datalist renders its options and links the field', () => {
        const target = render(PatternPrompt, { kind: 'input', heading: 'Name', datalist: [['v1', 'One'], ['v2', 'Two']], onanswer: vi.fn() })
        const field = part(target, 'field') as HTMLInputElement
        const list = target.querySelector('datalist')!
        expect(field.getAttribute('list')).toBe(list.id)
        expect([...list.querySelectorAll('option')].map((option) => option.value)).toEqual(['v1', 'v2'])
    })
})

describe('PatternPromptHost', () => {
    test('renders nothing for other alert types', () => {
        const target = render(PatternPromptHost, {})
        alertStore.set({ type: 'select', msg: 'a||b' })
        flushSync()
        expect(target.querySelector('[data-part="pattern-dialog"]')).toBeNull()
    })

    test('renders a patternSelect and writes the encoded answer to the store', () => {
        const target = render(PatternPromptHost, {})
        alertStore.set({ type: 'patternSelect', msg: 'Pick', choices: ['a', 'b'] })
        flushSync()
        target.querySelectorAll<HTMLButtonElement>('[data-part="pattern-prompt-choice"]')[1].click()
        expect(get(alertStore)).toEqual({ type: 'none', msg: encodeChoice(1) })
        flushSync()
        expect(target.querySelector('[data-part="pattern-dialog"]')).toBeNull()
    })

    test('renders a patternInput with its default and writes the cancel value', () => {
        const target = render(PatternPromptHost, {})
        alertStore.set({ type: 'patternInput', msg: 'Name', defaultValue: 'zed', datalist: [] })
        flushSync()
        expect((part(target, 'field') as HTMLInputElement).value).toBe('zed')
        part(target, 'cancel').click()
        expect(get(alertStore)).toEqual({ type: 'none', msg: PATTERN_PROMPT_CANCEL })
    })

    test('the same prompt written back again accepts the next press', () => {
        const target = render(PatternPromptHost, {})
        const data = { type: 'patternSelect' as const, msg: 'Pick', choices: ['a'] }
        alertStore.set(data)
        flushSync()
        // The prompt controller writes the prompt back inside the same store notification when an answer
        // arrives inside its guard, so the host sees the answer and the prompt with no flush between.
        let writtenBack = false
        const stop = alertStore.subscribe((value) => {
            if (value.type === 'none' && !writtenBack) {
                writtenBack = true
                alertStore.set(data)
            }
        })
        target.querySelector<HTMLButtonElement>('[data-part="pattern-prompt-choice"]')!.click()
        expect(writtenBack).toBe(true)
        expect(get(alertStore)).toBe(data)
        flushSync()
        target.querySelector<HTMLButtonElement>('[data-part="pattern-prompt-choice"]')!.click()
        stop()
        expect(get(alertStore)).toEqual({ type: 'none', msg: encodeChoice(0) })
    })
})
