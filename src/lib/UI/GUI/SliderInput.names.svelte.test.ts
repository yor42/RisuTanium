// @vitest-environment jsdom

/**
 * `SliderInput.svelte` names its `role="slider"` element, not the wrapper, through `aria-labelledby`
 * with the naming element first in `aria-describedby`. A `disableable` slider also names its toggle
 * checkbox with the same field label through `CheckInput`'s `label` prop. The real `CheckInput` renders.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { controlName, fieldNameProblems, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import SliderInput from './SliderInput.svelte'

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

function render(props: Record<string, unknown>, before = '<span id="x">Ext</span>'): { target: HTMLElement, slider: HTMLElement } {
    const target = document.createElement('div')
    target.innerHTML = before
    document.body.appendChild(target)
    const app = mount(SliderInput as never, { target, props: { min: 0, max: 10, value: 5, ...props } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return { target, slider: target.querySelector<HTMLElement>('[role="slider"]')! }
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('SliderInput accessible name', () => {
    test('regression reproducer: labelId names the slider element and the wrapper carries no aria attribute', () => {
        const { target, slider } = render({ labelId: 'x' })
        expect(slider.getAttribute('aria-labelledby')).toBe('x')
        expect(slider.getAttribute('aria-describedby')).toBe('x')
        expect(slider.parentElement!.hasAttribute('aria-labelledby')).toBe(false)
        expect(slider.parentElement!.hasAttribute('aria-describedby')).toBe(false)
        expect(fieldNameProblems(target, [{ name: 'Ext' }])).toEqual([])
    })

    test('regression reproducer: a disableable slider names its checkbox with the field label', () => {
        const { target } = render({ labelId: 'x', label: 'Ext', disableable: true })
        expect(fieldNameProblems(target, [{ name: 'Ext', toggle: true }])).toEqual([])
        const box = target.querySelector<HTMLInputElement>('input[type="checkbox"]')!
        expect(controlName(box)).toBe('Ext')
        expect(unnamedControls(target, { fields: true, values: true })).toEqual([])
    })

    test('regression reproducer: label alone renders one screen-reader-only name span for the slider and the checkbox text', () => {
        const { target, slider } = render({ label: 'Lbl', disableable: true }, '')
        const spans = target.querySelectorAll<HTMLElement>('span.sr-only')
        expect(spans.length).toBe(1)
        expect(slider.getAttribute('aria-labelledby')).toBe(spans[0].id)
        expect(fieldNameProblems(target, [{ name: 'Lbl', toggle: true }])).toEqual([])
    })

    test('compatibility guard: the slider semantics are unchanged by naming', () => {
        const { slider } = render({ labelId: 'x', step: 1, fixed: 1 })
        expect(slider.getAttribute('aria-valuemin')).toBe('0')
        expect(slider.getAttribute('aria-valuemax')).toBe('10')
        expect(slider.getAttribute('aria-valuenow')).toBe('5')
        expect(slider.getAttribute('aria-valuetext')).toBe('5.0')
    })

    test('compatibility guard: with nothing passed no aria name attribute and no extra element is rendered', () => {
        const { target, slider } = render({}, '')
        expect(slider.hasAttribute('aria-labelledby')).toBe(false)
        expect(slider.hasAttribute('aria-describedby')).toBe(false)
        expect(target.querySelector('span.sr-only')).toBeNull()
    })
})
