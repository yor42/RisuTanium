// @vitest-environment jsdom

/**
 * `TextInput.svelte` names its field through `aria-labelledby` and lists the naming element first
 * in `aria-describedby`, because TalkBack speaks only the description in the field's own stop.
 * `labelId` points at an existing visible label, `label` renders a screen-reader-only span before
 * the input, and a call with neither renders no new attribute or element.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { controlName, controlDescription, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import TextInput from './TextInput.svelte'

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

function render(props: Record<string, unknown>, before = ''): { target: HTMLElement, input: HTMLInputElement } {
    const target = document.createElement('div')
    target.innerHTML = before
    document.body.appendChild(target)
    const app = mount(TextInput as never, { target, props: { value: '', ...props } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return { target, input: target.querySelector<HTMLInputElement>('input')! }
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('TextInput accessible name', () => {
    test('regression reproducer: labelId names the field from an existing label and lists it first in the description', () => {
        const { input } = render({ labelId: 'x' }, '<span id="x">Ext</span>')
        expect(input.getAttribute('aria-labelledby')).toBe('x')
        expect(input.getAttribute('aria-describedby')).toBe('x')
        expect(controlName(input)).toBe('Ext')
    })

    test('regression reproducer: label renders a screen-reader-only span before the input and names the field with it', () => {
        const { target, input } = render({ label: 'Lbl' })
        const span = target.querySelector<HTMLElement>('span.sr-only')!
        expect(span, 'sr-only label span').not.toBeNull()
        expect(span.textContent).toBe('Lbl')
        expect(span.nextElementSibling).toBe(input)
        expect(input.nextElementSibling).toBeNull()
        expect(input.getAttribute('aria-labelledby')).toBe(span.id)
        expect(input.getAttribute('aria-describedby')!.split(' ')[0]).toBe(span.id)
        expect(controlName(input)).toBe('Lbl')
    })

    test('regression reproducer: describedBy is appended after the label id', () => {
        const { input } = render({ labelId: 'x', describedBy: 'h' }, '<span id="x">Ext</span><span id="h">Hint</span>')
        expect(input.getAttribute('aria-describedby')).toBe('x h')
        expect(controlDescription(input)).toBe('Ext Hint')
        expect(controlName(input)).toBe('Ext')
    })

    test('compatibility guard: with nothing passed the DOM has no aria attribute and one element child', () => {
        const { target, input } = render({})
        expect(input.hasAttribute('aria-labelledby')).toBe(false)
        expect(input.hasAttribute('aria-describedby')).toBe(false)
        expect(target.children.length).toBe(1)
        expect(unnamedControls(target, { fields: true }).length).toBe(1)
    })

    test('regression reproducer: two instances with label get distinct span ids', () => {
        const first = render({ label: 'One' })
        const second = render({ label: 'Two' })
        const firstId = first.input.getAttribute('aria-labelledby')
        const secondId = second.input.getAttribute('aria-labelledby')
        expect(firstId).toBeTruthy()
        expect(secondId).toBeTruthy()
        expect(firstId).not.toBe(secondId)
    })

    test('regression reproducer: hideText keeps the naming attributes', () => {
        const { input } = render({ label: 'Secret', hideText: true })
        expect(input.type).toBe('password')
        expect(controlName(input)).toBe('Secret')
    })

    test('regression reproducer: labelId wins over label and renders no span', () => {
        const { target, input } = render({ labelId: 'x', label: 'Lbl' }, '<span id="x">Ext</span>')
        expect(target.querySelector('span.sr-only')).toBeNull()
        expect(input.getAttribute('aria-labelledby')).toBe('x')
        expect(controlName(input)).toBe('Ext')
    })

    test('compatibility guard: a blank label renders nothing', () => {
        const { target, input } = render({ label: '  ' })
        expect(target.querySelector('span')).toBeNull()
        expect(input.hasAttribute('aria-labelledby')).toBe(false)
    })
})
