// @vitest-environment jsdom

/**
 * `NumberInput.svelte` names its field through `aria-labelledby` and lists the naming element first
 * in `aria-describedby`, because TalkBack speaks only the description in the field's own stop.
 * `labelId` points at an existing visible label, `label` renders a screen-reader-only span before
 * the input, and a call with neither renders no new attribute or element.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { controlName, fieldNameProblems, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import NumberInput from './NumberInput.svelte'

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

function render(props: Record<string, unknown>, before = ''): { target: HTMLElement, input: HTMLInputElement } {
    const target = document.createElement('div')
    target.innerHTML = before
    document.body.appendChild(target)
    const app = mount(NumberInput as never, { target, props: { value: 1, ...props } }) as unknown as Record<string, unknown>
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

describe('NumberInput accessible name', () => {
    test('regression reproducer: labelId names the field from an existing label and lists it first, with no sr-only span', () => {
        const { target, input } = render({ labelId: 'x' }, '<span id="x">Ext</span>')
        expect(input.getAttribute('aria-labelledby')).toBe('x')
        expect(input.getAttribute('aria-describedby')!.split(' ')[0]).toBe('x')
        expect(target.querySelector('span.sr-only')).toBeNull()
        expect(fieldNameProblems(target, [{ name: 'Ext' }])).toEqual([])
    })

    test('regression reproducer: label renders one screen-reader-only span before the input and describedBy follows the name', () => {
        const { target, input } = render({ label: 'Lbl', describedBy: 'h' }, '<span id="h">Hint</span>')
        const spans = target.querySelectorAll<HTMLElement>('span.sr-only')
        expect(spans.length).toBe(1)
        expect(spans[0].textContent).toBe('Lbl')
        expect(spans[0].nextElementSibling).toBe(input)
        expect(input.nextElementSibling).toBeNull()
        expect(input.getAttribute('aria-labelledby')).toBe(spans[0].id)
        expect(input.getAttribute('aria-describedby')).toBe(`${spans[0].id} h`)
        expect(controlName(input)).toBe('Lbl')
        expect(fieldNameProblems(target, [{ name: 'Lbl', help: 'Hint' }])).toEqual([])
    })

    test('compatibility guard: with nothing passed the DOM has no aria attribute and one element child', () => {
        const { target, input } = render({})
        expect(input.hasAttribute('aria-labelledby')).toBe(false)
        expect(input.hasAttribute('aria-describedby')).toBe(false)
        expect(target.children.length).toBe(1)
        expect(unnamedControls(target, { values: true }).length).toBe(1)
    })

    test('regression reproducer: two instances with label get distinct span ids', () => {
        const first = render({ label: 'One' })
        const second = render({ label: 'Two' })
        expect(first.input.getAttribute('aria-labelledby')).toBeTruthy()
        expect(first.input.getAttribute('aria-labelledby')).not.toBe(second.input.getAttribute('aria-labelledby'))
    })

    test('regression reproducer: labelId wins over label and a blank label renders nothing', () => {
        const both = render({ labelId: 'x', label: 'Lbl' }, '<span id="x">Ext</span>')
        expect(both.target.querySelector('span.sr-only')).toBeNull()
        expect(controlName(both.input)).toBe('Ext')
        const blank = render({ label: '  ' })
        expect(blank.target.querySelector('span')).toBeNull()
        expect(blank.input.hasAttribute('aria-labelledby')).toBe(false)
    })
})
