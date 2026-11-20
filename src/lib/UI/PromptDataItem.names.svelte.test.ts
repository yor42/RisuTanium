// @vitest-environment jsdom

/**
 * `PromptDataItem.svelte`: the three header buttons are named and their glyphs hidden, and every text
 * field of an opened item is named by its visible label with the label listed first in
 * `aria-describedby`. Mounts the REAL component with the real shared inputs; the highlighter, size
 * and hotkey modules are mocks of `TextAreaInput.ime.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { PromptItem } from 'src/ts/process/prompt'

vi.mock('src/ts/stores.svelte', () => ({
    DBState: {
        db: {
            hotkeys: [],
            longPressToPopupEditor: false,
            promptTemplate: [],
            promptSettings: { customChainOfThought: false, sendChatAsSystem: false },
        },
    },
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

import { language } from 'src/lang'
import { controlDescription, controlName, exposedIcons, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import PromptDataItem from './PromptDataItem.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountItem(promptItem: PromptItem, isOpened = true): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PromptDataItem, {
        target,
        props: { promptItem, isOpened, currentIndex: 0, displayIndex: 0 },
    }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

function field(target: HTMLElement, label: string): HTMLElement {
    const found = Array.from(target.querySelectorAll<HTMLElement>('input[type="text"], textarea, [role="textbox"]'))
        .find((el) => controlName(el) === label)
    if (!found) expect.fail('no field named ' + label)
    return found
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('PromptDataItem accessible names', () => {
    test('regression reproducer: the remove, move down and move up buttons are named and their glyphs hidden', () => {
        const target = mountItem({ type: 'plain', text: 'a', role: 'system', type2: 'normal' } as PromptItem, false)
        const buttons = Array.from(target.querySelectorAll('div.flex.flex-1.justify-end > button'))
        expect(buttons.map(controlName)).toEqual([language.remove, language.chatShellMoveDown, language.chatShellMoveUp])
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the plain item fields (name and prompt) are named by their labels', () => {
        const target = mountItem({ type: 'plain', text: 'a', role: 'system', type2: 'normal' } as PromptItem)
        expect(unnamedControls(target, { fields: true })).toEqual([])
        const name = field(target, language.name)
        const prompt = field(target, language.prompt)
        expect(controlDescription(name).startsWith(language.name)).toBe(true)
        expect(controlDescription(prompt).startsWith(language.prompt)).toBe(true)
        expect(prompt.getAttribute('role')).toBe('textbox')
    })

    test('regression reproducer: the chatML prompt field is named', () => {
        const target = mountItem({ type: 'chatML', text: 'a' } as PromptItem)
        expect(unnamedControls(target, { fields: true })).toEqual([])
        field(target, language.prompt)
    })

    test('regression reproducer: the author note default and custom inner format fields are named', () => {
        const target = mountItem({ type: 'authornote', defaultText: '', innerFormat: '{{slot}}', role2: 'system' } as PromptItem)
        expect(unnamedControls(target, { fields: true })).toEqual([])
        field(target, language.defaultPrompt)
        field(target, language.innerFormat)
    })

    test('guard: the chat item checkboxes keep their visible names (passes before and after)', () => {
        const target = mountItem({ type: 'chat', rangeStart: 0, rangeEnd: 'end' } as PromptItem)
        const names = Array.from(target.querySelectorAll('input[type="checkbox"]')).map(controlName)
        expect(names).toEqual([language.untilChatEnd, language.advanced])
    })
})
