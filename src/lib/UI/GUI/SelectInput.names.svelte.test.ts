// @vitest-environment jsdom

/**
 * `SelectInput.svelte` names its select through `aria-labelledby` and lists the naming element first
 * in `aria-describedby`, ahead of the extra `describedBy` ids. `labelId` points at an existing visible
 * label, `label` renders a screen-reader-only span before the select, and a call with neither renders
 * no new attribute or element. The options are passed as a snippet of `<option>` markup.
 */
import { createRawSnippet, flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { controlName, fieldNameProblems, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import SelectInput from './SelectInput.svelte'

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

const options = createRawSnippet(() => ({ render: () => '<option value="a">Option A</option>' }))

function render(props: Record<string, unknown>, before = ''): { target: HTMLElement, select: HTMLSelectElement } {
    const target = document.createElement('div')
    target.innerHTML = before
    document.body.appendChild(target)
    const app = mount(SelectInput as never, { target, props: { value: 'a', children: options, ...props } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return { target, select: target.querySelector<HTMLSelectElement>('select')! }
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('SelectInput accessible name', () => {
    test('regression reproducer: labelId names the select from an existing label and lists it first, with no sr-only span', () => {
        const { target, select } = render({ labelId: 'x' }, '<span id="x">Ext</span>')
        expect(select.getAttribute('aria-labelledby')).toBe('x')
        expect(select.getAttribute('aria-describedby')).toBe('x')
        expect(target.querySelector('span.sr-only')).toBeNull()
        expect(fieldNameProblems(target, [{ name: 'Ext' }])).toEqual([])
    })

    test('regression reproducer: describedBy is appended after the label id', () => {
        const { target, select } = render({ labelId: 'x', describedBy: 'h' }, '<span id="x">Ext</span><span id="h">Hint</span>')
        expect(select.getAttribute('aria-describedby')).toBe('x h')
        expect(fieldNameProblems(target, [{ name: 'Ext', help: 'Hint' }])).toEqual([])
    })

    test('regression reproducer: label renders one screen-reader-only span before the select', () => {
        const { target, select } = render({ label: 'Lbl' })
        const spans = target.querySelectorAll<HTMLElement>('span.sr-only')
        expect(spans.length).toBe(1)
        expect(spans[0].nextElementSibling).toBe(select)
        expect(select.getAttribute('aria-labelledby')).toBe(spans[0].id)
        expect(controlName(select)).toBe('Lbl')
        expect(fieldNameProblems(target, [{ name: 'Lbl' }])).toEqual([])
    })

    test('compatibility guard: describedBy alone keeps the description and adds no name; nothing passed adds no attribute', () => {
        const only = render({ describedBy: 'h' }, '<span id="h">Hint</span>')
        expect(only.select.getAttribute('aria-describedby')).toBe('h')
        expect(only.select.hasAttribute('aria-labelledby')).toBe(false)
        const none = render({})
        expect(none.select.hasAttribute('aria-describedby')).toBe(false)
        expect(none.select.hasAttribute('aria-labelledby')).toBe(false)
        expect(none.target.children.length).toBe(1)
        expect(unnamedControls(none.target, { values: true }).length).toBe(1)
    })
})
