// @vitest-environment jsdom

/**
 * `ColorInput.svelte` names the colour picker library's own `input[type=color]`, which the library
 * renders inside a label with no text, through `aria-labelledby` plus the naming element first in
 * `aria-describedby`. The attributes follow the props when they change. The real
 * `svelte-awesome-color-picker` renders.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { controlName, fieldNameProblems } from 'src/lib/a11yNames.test-helpers'
import ColorInput from './ColorInput.svelte'

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

// The library renders its dialog's sliders and text inputs while it is closed and hides them with CSS,
// which jsdom does not apply. Their names are the library's own (out of scope), so the closed dialog is
// marked hidden as the stylesheet does.
function hideClosedDialog(target: HTMLElement): void {
    for (const dialog of Array.from(target.querySelectorAll('[role="dialog"]'))) {
        dialog.setAttribute('aria-hidden', 'true')
    }
}

function render(props: Record<string, unknown>, before = ''): { target: HTMLElement, input: HTMLInputElement } {
    const target = document.createElement('div')
    target.innerHTML = before
    document.body.appendChild(target)
    const app = mount(ColorInput as never, { target, props }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    hideClosedDialog(target)
    return { target, input: target.querySelector<HTMLInputElement>('input[type="color"]')! }
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('ColorInput accessible name', () => {
    test('regression reproducer: labelId puts both naming attributes on the library colour input', () => {
        const { target, input } = render({ value: '#112233', labelId: 'x', describedBy: 'h' }, '<span id="x">Ext</span><span id="h">Hint</span>')
        expect(input.getAttribute('aria-labelledby')).toBe('x')
        expect(input.getAttribute('aria-describedby')).toBe('x h')
        expect(controlName(input)).toBe('Ext')
        expect(fieldNameProblems(target, [{ name: 'Ext', help: 'Hint' }])).toEqual([])
    })

    test('regression reproducer: label alone renders a screen-reader-only span outside the library label', () => {
        const { target, input } = render({ value: '#112233', label: 'Lbl' })
        const span = target.querySelector<HTMLElement>('span.sr-only')!
        expect(span.textContent).toBe('Lbl')
        expect(input.closest('label')!.contains(span)).toBe(false)
        expect(input.getAttribute('aria-labelledby')).toBe(span.id)
        expect(fieldNameProblems(target, [{ name: 'Lbl' }])).toEqual([])
    })

    test('regression reproducer: changing labelId on a mounted instance updates both attributes', () => {
        const props = $state({ value: '#112233', labelId: 'a' })
        const target = document.createElement('div')
        target.innerHTML = '<span id="a">A</span><span id="b">B</span>'
        document.body.appendChild(target)
        const app = mount(ColorInput as never, { target, props }) as unknown as Record<string, unknown>
        mounted.push({ target, app })
        flushSync()
        const input = target.querySelector<HTMLInputElement>('input[type="color"]')!
        expect(input.getAttribute('aria-labelledby')).toBe('a')
        props.labelId = 'b'
        flushSync()
        expect(input.getAttribute('aria-labelledby')).toBe('b')
        expect(input.getAttribute('aria-describedby')).toBe('b')
    })

    test('compatibility guard: with nothing passed the library input has no naming attribute', () => {
        const { target, input } = render({ value: '#112233' })
        expect(input.hasAttribute('aria-labelledby')).toBe(false)
        expect(input.hasAttribute('aria-describedby')).toBe(false)
        expect(target.querySelector('span.sr-only')).toBeNull()
    })
})
