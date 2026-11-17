// @vitest-environment jsdom

/**
 * `KeyListInput` shows one input per API key plus an empty trailing row, and writes the keys
 * LF-joined. jsdom values are the value an engine settles on (a line break inserted by the user
 * becomes one space); a line break is never put into an element value, which jsdom would strip.
 * Fixture events do not bubble: the component listens on each row element itself.
 *
 * MOCKED: nothing; the real component, language table and splitter run.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import KeyListInput from './KeyListInput.svelte'

interface Harness {
    target: HTMLElement
    box: { value: string }
    writes: string[]
}

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function setup(initial: string, hideText = true, placeholder = 'sk-XXXX'): Harness {
    const box = $state({ value: initial })
    const writes: string[] = []
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(KeyListInput, {
        target,
        props: {
            get value() { return box.value },
            set value(next: string) { writes.push(next); box.value = next },
            hideText,
            placeholder,
        },
    }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return { target, box, writes }
}

function rowsOf(h: Harness): HTMLInputElement[] {
    return Array.from(h.target.querySelectorAll('input'))
}

function texts(h: Harness): string[] {
    return rowsOf(h).map((node) => node.value)
}

/** Assigns the settled value, places the caret and fires a non-bubbling `input`. */
function enter(node: HTMLInputElement, value: string, caret = value.length, init: InputEventInit = {}) {
    if (document.activeElement !== node) {
        node.focus()
    }
    node.value = value
    node.setSelectionRange(caret, caret)
    node.dispatchEvent(new InputEvent('input', { inputType: 'insertText', ...init }))
    flushSync()
}

afterEach(async () => {
    vi.restoreAllMocks()
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('KeyListInput', () => {
    test('KL1 renders N+1 masked rows with no autofill, spellcheck, correction or capitalization', () => {
        const h = setup('sk-test-A\nsk-test-B')
        const rows = rowsOf(h)
        expect(rows).toHaveLength(3)
        for (const row of rows) {
            expect(row.type).toBe('password')
            expect(row.getAttribute('autocomplete')).toBe('new-password')
            expect(row.getAttribute('spellcheck')).toBe('false')
            expect(row.getAttribute('autocorrect')).toBe('off')
            expect(row.getAttribute('autocapitalize')).toBe('off')
        }
        expect(texts(h)).toEqual(['sk-test-A', 'sk-test-B', ''])
    })

    test('KL2 a ${NAME} reference row is shown as text', () => {
        const h = setup('sk-test-A\n${RISU_TEST_KEY}')
        const rows = rowsOf(h)
        expect(rows[0].type).toBe('password')
        expect(rows[1].type).toBe('text')
        expect(rows[1].getAttribute('autocomplete')).toBe('off')
    })

    test('KL3 mounting never writes', () => {
        for (const initial of ['sk-test-A', undefined as unknown as string, 'A\n B', '']) {
            const h = setup(initial)
            expect(h.writes).toEqual([])
        }
    })

    test('KL4 one key is written exactly as typed', () => {
        const h = setup('')
        enter(rowsOf(h)[0], ' sk-test-A ')
        expect(h.box.value).toBe(' sk-test-A ')
        expect(texts(h)).toEqual([' sk-test-A ', ''])
        enter(rowsOf(h)[0], ' ')
        expect(h.box.value).toBe(' ')
    })

    test('KL5 a split keeps the focused element, caret and index, and never calls focus()', () => {
        const h = setup('')
        const node = rowsOf(h)[0]
        node.focus()
        const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')
        enter(node, 'sk-A sk-Btest-Z', 9)
        const rows = rowsOf(h)
        expect(rows.map((row) => row.value)).toEqual(['sk-A', 'sk-Btest-Z', ''])
        expect(rows[1]).toBe(node)
        expect(document.activeElement).toBe(node)
        expect(node.selectionStart).toBe(4)
        expect(focusSpy).not.toHaveBeenCalled()
        expect(h.box.value).toBe('sk-A\nsk-Btest-Z')
    })

    test('KL5b a character typed right after a split keeps its own caret', async () => {
        const h = setup('')
        const node = rowsOf(h)[0]
        enter(node, 'a b')
        enter(node, 'bc', 2)
        await tick()
        expect(texts(h)).toEqual(['a', 'bc', ''])
        expect(node.selectionStart).toBe(2)
    })

    test('KL6 a composing input never splits; compositionend does; a later input changes nothing', () => {
        const h = setup('', false)
        const node = rowsOf(h)[0]
        node.focus()
        node.dispatchEvent(new CompositionEvent('compositionstart'))
        node.value = 'sk-test-A sk-test-B'
        node.setSelectionRange(19, 19)
        node.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', isComposing: true }))
        flushSync()
        expect(texts(h)).toEqual(['sk-test-A sk-test-B', ''])
        node.dispatchEvent(new CompositionEvent('compositionend', { data: 'sk-test-A\nsk-test-B' }))
        flushSync()
        expect(texts(h)).toEqual(['sk-test-A', 'sk-test-B', ''])
        expect(h.box.value).toBe('sk-test-A\nsk-test-B')
        const second = rowsOf(h)[1]
        second.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }))
        flushSync()
        expect(texts(h)).toEqual(['sk-test-A', 'sk-test-B', ''])
        expect(h.box.value).toBe('sk-test-A\nsk-test-B')
    })

    test('KL7 a changed value followed only by change splits', () => {
        const h = setup('')
        const node = rowsOf(h)[0]
        node.value = 'sk-test-A sk-test-B'
        node.dispatchEvent(new Event('change'))
        flushSync()
        expect(texts(h)).toEqual(['sk-test-A', 'sk-test-B', ''])
        expect(h.box.value).toBe('sk-test-A\nsk-test-B')
    })

    test('KL8 a saved spaced value survives focus and blur and splits on its first edit', () => {
        const h = setup('pass word')
        const node = rowsOf(h)[0]
        node.focus()
        node.dispatchEvent(new FocusEvent('focusout'))
        flushSync()
        expect(texts(h)).toEqual(['pass word', ''])
        expect(h.box.value).toBe('pass word')
        expect(h.writes).toEqual([])
        enter(node, 'pass wordx')
        expect(texts(h)).toEqual(['pass', 'wordx', ''])
        expect(h.box.value).toBe('pass\nwordx')
    })

    test('KL9 typing into the trailing row appends another; labels, placeholders and hint are linked', () => {
        const h = setup('sk-test-A', true, 'sk-XXXX')
        let rows = rowsOf(h)
        expect(rows).toHaveLength(2)
        expect(rows[0].placeholder).toBe('sk-XXXX')
        expect(rows[0].getAttribute('aria-label')).toBe('Key 1')
        expect(rows[1].placeholder).toBe(language.settingsPage.addAnotherKey)
        expect(rows[1].getAttribute('aria-label')).toBe(language.settingsPage.addAnotherKey)
        enter(rows[1], 'sk-test-B')
        rows = rowsOf(h)
        expect(rows).toHaveLength(3)
        expect(rows[1].getAttribute('aria-label')).toBe('Key 2')
        expect(h.box.value).toBe('sk-test-A\nsk-test-B')
        const hint = document.getElementById(rows[0].getAttribute('aria-describedby') ?? 'none')
        expect(hint?.textContent).toBe(language.settingsPage.keySeparatorHint)
        for (const row of rows) {
            expect(row.getAttribute('aria-describedby')).toBe(hint?.id)
        }
    })

    test('KL9b an empty field keeps the site placeholder and the label Key 1 on its only row', () => {
        const h = setup('', true, 'sk-XXXX')
        const rows = rowsOf(h)
        expect(rows).toHaveLength(1)
        expect(rows[0].placeholder).toBe('sk-XXXX')
        expect(rows[0].getAttribute('aria-label')).toBe('Key 1')
    })

    test('KL10 Enter moves to the next row, unless composing; the trailing row ignores it', () => {
        const h = setup('sk-test-A')
        const [first, trailing] = rowsOf(h)
        first.focus()
        const composing = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, cancelable: true })
        first.dispatchEvent(composing)
        const ime = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, cancelable: true })
        first.dispatchEvent(ime)
        expect(document.activeElement).toBe(first)
        expect(composing.defaultPrevented).toBe(false)
        expect(ime.defaultPrevented).toBe(false)
        const enterKey = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
        first.dispatchEvent(enterKey)
        expect(document.activeElement).toBe(trailing)
        expect(enterKey.defaultPrevented).toBe(true)
        expect(h.box.value).toBe('sk-test-A')
        trailing.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
        expect(document.activeElement).toBe(trailing)
    })

    test('KL11 a cleared middle row drops on focusout and no empty line is written', () => {
        const h = setup('sk-test-A\nsk-test-B\nsk-test-C')
        const middle = rowsOf(h)[1]
        enter(middle, '')
        expect(h.box.value).toBe('sk-test-A\nsk-test-C')
        middle.dispatchEvent(new FocusEvent('focusout'))
        flushSync()
        expect(texts(h)).toEqual(['sk-test-A', 'sk-test-C', ''])
        expect(h.box.value).toBe('sk-test-A\nsk-test-C')
        enter(rowsOf(h)[1], ' ')
        expect(h.box.value).toBe('sk-test-A')
    })

    test('KL11b blurring the empty trailing row keeps it', () => {
        const h = setup('sk-test-A')
        const trailing = rowsOf(h)[1]
        trailing.dispatchEvent(new FocusEvent('focusout'))
        flushSync()
        expect(texts(h)).toEqual(['sk-test-A', ''])
        expect(h.box.value).toBe('sk-test-A')
    })

    test('KL12 with hiding off every row is text/off, and an own write does not rebuild rows', () => {
        const h = setup('sk-test-A', false)
        for (const row of rowsOf(h)) {
            expect(row.type).toBe('text')
            expect(row.getAttribute('autocomplete')).toBe('off')
            expect(row.getAttribute('spellcheck')).toBe('false')
            expect(row.getAttribute('autocorrect')).toBe('off')
            expect(row.getAttribute('autocapitalize')).toBe('off')
        }
        const first = rowsOf(h)[0]
        enter(first, 'sk-test-Ax')
        expect(rowsOf(h)[0]).toBe(first)
        h.box.value = 'sk-test-Q\nsk-test-R'
        flushSync()
        expect(texts(h)).toEqual(['sk-test-Q', 'sk-test-R', ''])
        expect(h.writes).toEqual(['sk-test-Ax'])
    })

    test('KL12b an external change back to the last own write is shown and edits build on it', () => {
        const h = setup('sk-test-P1')
        enter(rowsOf(h)[0], 'sk-test-P1x')
        h.box.value = 'sk-test-P2'
        flushSync()
        expect(texts(h)).toEqual(['sk-test-P2', ''])
        h.box.value = 'sk-test-P1x'
        flushSync()
        expect(texts(h)).toEqual(['sk-test-P1x', ''])
        enter(rowsOf(h)[0], 'sk-test-P1xy')
        expect(h.box.value).toBe('sk-test-P1xy')
    })

    test('KL12c an external change back to the mounted value is shown', () => {
        const h = setup('sk-test-P1')
        h.box.value = 'sk-test-P2'
        flushSync()
        h.box.value = 'sk-test-P1'
        flushSync()
        expect(texts(h)).toEqual(['sk-test-P1', ''])
    })

    test('KL13 a non-bubbling input event is handled', () => {
        const h = setup('')
        const node = rowsOf(h)[0]
        node.value = 'sk-test-A'
        node.dispatchEvent(new InputEvent('input', { bubbles: false, inputType: 'insertText' }))
        flushSync()
        expect(h.box.value).toBe('sk-test-A')
    })
})
