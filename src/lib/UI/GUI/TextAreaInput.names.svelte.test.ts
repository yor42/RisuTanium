// @vitest-environment jsdom

/**
 * `TextAreaInput.svelte` names its field through `aria-labelledby` and lists the naming element first
 * in `aria-describedby`, in both the plain `<textarea>` branch and the highlight branch's
 * contenteditable `role="textbox"`. The selected autocomplete suggestion uses scheme tokens with a
 * ring as its non-colour cue. Mocks are those of `TextAreaInput.ime.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/stores.svelte', () => ({
    DBState: { db: { hotkeys: [], longPressToPopupEditor: false } },
    disableHighlight: writable(false),
    popUpEditorStore: { open: false, value: '', mode: 'default', language: 'markdown' },
}))
vi.mock('src/ts/gui/guisize', () => ({
    textAreaSize: writable(0),
    textAreaTextSize: writable(1),
}))
vi.mock('src/ts/gui/highlight', () => ({
    highlighter: vi.fn(),
    getNewHighlightId: vi.fn(() => 1),
    removeHighlight: vi.fn(),
    AllCBS: ['random', 'randint'],
}))
vi.mock('src/ts/util', () => ({
    sleep: vi.fn(async () => {}),
}))
vi.mock('src/ts/platform', () => ({
    isMobile: false,
}))
vi.mock('src/ts/hotkey', () => ({
    hotkeyMatches: vi.fn(() => false),
}))

import { controlDescription, controlName, paletteClasses } from 'src/lib/a11yNames.test-helpers'
import TextAreaInput from './TextAreaInput.svelte'

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

function render(props: Record<string, unknown>, before = ''): { target: HTMLElement, field: HTMLElement } {
    const target = document.createElement('div')
    target.innerHTML = before
    document.body.appendChild(target)
    const app = mount(TextAreaInput as never, { target, props: { value: '', ...props } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    const field = target.querySelector<HTMLElement>(props.highlight ? '[role="textbox"]' : 'textarea')!
    return { target, field }
}

afterEach(async () => {
    for (const m of mounted.splice(0)) {
        await unmount(m.app as never)
        m.target.remove()
    }
    Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
    vi.restoreAllMocks()
})

describe.each([
    ['plain textarea', false],
    ['highlight textbox', true],
])('TextAreaInput accessible name, %s', (_branch, highlight) => {
    test('regression reproducer: labelId names the field from an existing label and lists it first', () => {
        const { field } = render({ highlight, labelId: 'x' }, '<span id="x">Ext</span>')
        expect(field.getAttribute('aria-labelledby')).toBe('x')
        expect(field.getAttribute('aria-describedby')).toBe('x')
        expect(controlName(field)).toBe('Ext')
    })

    test('regression reproducer: label renders a screen-reader-only span inside the wrapper before the field', () => {
        const { target, field } = render({ highlight, label: 'Lbl' })
        const span = target.querySelector<HTMLElement>('span.sr-only')!
        expect(span, 'sr-only label span').not.toBeNull()
        expect(span.textContent).toBe('Lbl')
        expect(span.parentElement).toBe(field.parentElement)
        expect(span.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(field.getAttribute('aria-labelledby')).toBe(span.id)
        expect(field.getAttribute('aria-describedby')!.split(' ')[0]).toBe(span.id)
        expect(controlName(field)).toBe('Lbl')
    })

    test('regression reproducer: describedBy is appended after the label id', () => {
        const { field } = render({ highlight, labelId: 'x', describedBy: 'h' }, '<span id="x">Ext</span><span id="h">Hint</span>')
        expect(field.getAttribute('aria-describedby')).toBe('x h')
        expect(controlDescription(field)).toBe('Ext Hint')
    })

    test('compatibility guard: with nothing passed the field has no aria attribute and there is no sr-only span', () => {
        const { target, field } = render({ highlight })
        expect(field.hasAttribute('aria-labelledby')).toBe(false)
        expect(field.hasAttribute('aria-describedby')).toBe(false)
        expect(target.querySelector('span.sr-only')).toBeNull()
    })

    test('regression reproducer: two instances with label get distinct span ids', () => {
        const first = render({ highlight, label: 'One' })
        const second = render({ highlight, label: 'Two' })
        const firstId = first.field.getAttribute('aria-labelledby')
        const secondId = second.field.getAttribute('aria-labelledby')
        expect(firstId).toBeTruthy()
        expect(secondId).toBeTruthy()
        expect(firstId).not.toBe(secondId)
    })

    test('regression reproducer: labelId wins over label and renders no span', () => {
        const { target, field } = render({ highlight, labelId: 'x', label: 'Lbl' }, '<span id="x">Ext</span>')
        expect(target.querySelector('span.sr-only')).toBeNull()
        expect(field.getAttribute('aria-labelledby')).toBe('x')
    })
})

describe('TextAreaInput autocomplete selection', () => {
    test('regression reproducer: the selected suggestion carries the selected fill and ring and no palette class', () => {
        const rect = { top: 10, left: 10, bottom: 20, right: 20, width: 10, height: 10, x: 10, y: 10, toJSON: () => ({}) }
        // jsdom has no Range geometry, so the caret rect is supplied for the list to open.
        Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect as DOMRect })
        const { target, field } = render({ highlight: true })
        field.textContent = '{{ran'
        field.focus()
        const selection = window.getSelection()!
        selection.removeAllRanges()
        const range = document.createRange()
        range.setStart(field.firstChild!, 5)
        range.collapse(true)
        selection.addRange(range)
        field.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        const buttons = [...target.querySelectorAll<HTMLButtonElement>('button')]
        expect(buttons.map((button) => button.textContent)).toEqual(['random', 'randint'])
        for (const cls of ['bg-selected', 'ring-1', 'ring-borderc']) {
            expect(buttons[0].classList.contains(cls), cls).toBe(true)
        }
        expect(buttons[1].classList.contains('ring-1')).toBe(false)
        expect(paletteClasses(target)).toEqual([])
    })
})
