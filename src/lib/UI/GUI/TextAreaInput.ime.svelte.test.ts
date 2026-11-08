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

import { compositionEnd, compositionStart, enterKeydown, imeEventSequence } from '../../../ts/ime/tests/imeEventSequence'
import TextAreaInput from './TextAreaInput.svelte'

const mounted: { target: HTMLElement, app: Record<string, unknown> }[] = []

function render(value: string): { editor: HTMLElement, parent: HTMLElement, parentKeydown: ReturnType<typeof vi.fn> } {
    // Svelte delegates keydown at the mount target, so the ancestor listener sits one level up.
    const outer = document.createElement('div')
    const parent = document.createElement('div')
    outer.appendChild(parent)
    document.body.appendChild(outer)
    const parentKeydown = vi.fn()
    outer.addEventListener('keydown', parentKeydown)
    const app = mount(TextAreaInput as never, { target: parent, props: { value, highlight: true } }) as unknown as Record<string, unknown>
    mounted.push({ target: outer, app })
    flushSync()
    const editor = parent.querySelector<HTMLElement>('[contenteditable="true"]')!
    return { editor, parent, parentKeydown }
}

// The caret setup the handlers read: insertTextAtSelection and autoComplete both use the
// window selection inside the editor's first text node.
function placeCaret(editor: HTMLElement, text: string, offset: number): void {
    editor.textContent = text
    editor.focus()
    const selection = window.getSelection()!
    selection.removeAllRanges()
    const range = document.createRange()
    range.setStart(editor.firstChild!, offset)
    range.collapse(true)
    selection.addRange(range)
}

function keydown(editor: HTMLElement, key: string, init: { isComposing?: boolean, keyCode?: number } = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
        key,
        keyCode: init.keyCode ?? 0,
        isComposing: init.isComposing ?? false,
        bubbles: true,
        cancelable: true,
    })
    editor.dispatchEvent(event)
    return event
}

function suggestionButtons(parent: HTMLElement): HTMLButtonElement[] {
    return [...parent.querySelectorAll<HTMLButtonElement>('button')]
}

function selectedSuggestion(parent: HTMLElement): number {
    return suggestionButtons(parent).findIndex((button) => button.classList.contains('text-blue-500'))
}

// Opens the real autocomplete list through the editor's own input handler. A zero rect
// would hide the list, so the range reports a non-zero position.
function openAutocomplete(editor: HTMLElement): void {
    placeCaret(editor, '{{ran', 5)
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) {
        await unmount(app as never)
        target.remove()
    }
    vi.restoreAllMocks()
})

describe('TextAreaInput contenteditable around IME composition', () => {
    test('a composing Enter writes nothing, is not prevented and does not propagate', () => {
        const { editor, parentKeydown } = render('가나')
        placeCaret(editor, '가나', 1)
        compositionStart(editor)
        const flagged = enterKeydown(editor, { isComposing: true })
        const legacy = enterKeydown(editor, { keyCode: 229 })
        expect(editor.textContent).toBe('가나')
        expect(flagged.defaultPrevented).toBe(false)
        expect(legacy.defaultPrevented).toBe(false)
        expect(parentKeydown).not.toHaveBeenCalled()
    })

    test('the Enter right after compositionend inserts a newline and does not propagate', () => {
        const clock = vi.spyOn(performance, 'now').mockReturnValue(5000)
        const { editor, parentKeydown } = render('가나')
        placeCaret(editor, '가나', 1)
        imeEventSequence(editor, '가나')
        clock.mockReturnValue(5002)
        const event = enterKeydown(editor)
        expect(event.defaultPrevented).toBe(true)
        expect(editor.textContent).toBe('가\n나')
        expect(parentKeydown).not.toHaveBeenCalled()
    })

    test('a plain Enter inserts a newline and does not propagate', () => {
        const { editor, parentKeydown } = render('가나')
        placeCaret(editor, '가나', 1)
        const event = enterKeydown(editor)
        expect(event.defaultPrevented).toBe(true)
        expect(editor.textContent).toBe('가\n나')
        expect(parentKeydown).not.toHaveBeenCalled()
    })

    describe('with the autocomplete list open', () => {
        function openList() {
            const rect = { top: 10, left: 10, bottom: 20, right: 20, width: 10, height: 10, x: 10, y: 10, toJSON: () => ({}) }
            vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(rect as DOMRect)
            const view = render('')
            openAutocomplete(view.editor)
            expect(suggestionButtons(view.parent).map((button) => button.textContent)).toEqual(['random', 'randint'])
            expect(selectedSuggestion(view.parent)).toBe(0)
            return view
        }

        test('composing ArrowDown, ArrowUp, Tab, Enter and Escape leave the list, the text and the default alone', () => {
            const { editor, parent } = openList()
            compositionStart(editor)
            const keys = ['ArrowDown', 'ArrowUp', 'Tab', 'Enter', 'Escape'].map((key) => keydown(editor, key, { isComposing: true }))
            flushSync()
            expect(keys.map((event) => event.defaultPrevented)).toEqual([false, false, false, false, false])
            expect(editor.textContent).toBe('{{ran')
            expect(suggestionButtons(parent)).toHaveLength(2)
            expect(selectedSuggestion(parent)).toBe(0)
        })

        test('composing ArrowDown does not move the highlighted suggestion', () => {
            const { editor, parent } = openList()
            compositionStart(editor)
            const event = keydown(editor, 'ArrowDown', { isComposing: true })
            flushSync()
            expect(event.defaultPrevented).toBe(false)
            expect(selectedSuggestion(parent)).toBe(0)
        })

        test('liveness: after compositionend ArrowDown moves the suggestion and Tab inserts it', () => {
            const { editor, parent } = openList()
            compositionStart(editor)
            compositionEnd(editor, '')
            const down = keydown(editor, 'ArrowDown')
            flushSync()
            expect(down.defaultPrevented).toBe(true)
            expect(selectedSuggestion(parent)).toBe(1)
            const tab = keydown(editor, 'Tab')
            flushSync()
            expect(tab.defaultPrevented).toBe(true)
            expect(editor.textContent).toBe('{{randint}}')
        })
    })
})
