// @vitest-environment jsdom

/**
 * `PromptDataItem.svelte` value controls: every select and number input of an opened item is named by
 * its visible label span through `aria-labelledby`, with one naming span per control in every item type.
 * The two role selects and the two range inputs that exist in different item types use different ids.
 * Mounts the REAL component with the real shared inputs; the highlighter, size and hotkey modules are
 * mocks of `PromptDataItem.names.svelte.test.ts`.
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
            promptSettings: { customChainOfThought: false, sendChatAsSystem: true },
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
import { fieldNameProblems, unnamedControls, type FieldExpectation } from 'src/lib/a11yNames.test-helpers'
import PromptDataItem from './PromptDataItem.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountItem(promptItem: PromptItem): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PromptDataItem, {
        target,
        props: { promptItem, isOpened: true, currentIndex: 0, displayIndex: 0 },
    }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const KNOWN_UNNAMED: string[] = []

function check(target: HTMLElement, expected: FieldExpectation[]): void {
    expect(fieldNameProblems(target, expected)).toEqual([])
    expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    // Every control is named by its visible label span; a lost labelId would fall back to a duplicate sr-only name.
    expect(target.querySelectorAll('span.sr-only')).toHaveLength(0)
}

const TYPE = { name: language.type }

describe('PromptDataItem value controls are named', () => {
    test('plain item: type, special type and role selects', () => {
        check(mountItem({ type: 'plain', text: 'a', role: 'system', type2: 'normal' } as PromptItem), [
            TYPE,
            { name: language.specialType },
            { name: language.role },
        ])
    })

    test('chatML item: only the type select', () => {
        check(mountItem({ type: 'chatML', text: 'a' } as PromptItem), [TYPE])
    })

    test('cache item: type select, depth number and role select', () => {
        check(mountItem({ type: 'cache', depth: 1, role: 'all', name: '' } as PromptItem), [
            TYPE,
            { name: language.depth },
            { name: language.role },
        ])
    })

    test('chat item with an open range end: type, range start and the disabled range end', () => {
        check(mountItem({ type: 'chat', rangeStart: 0, rangeEnd: 'end', chatAsOriginalOnSystem: false } as PromptItem), [
            TYPE,
            { name: language.rangeStart },
            { name: language.rangeEnd },
        ])
    })

    test('chat item with a numeric range end: the editable range end is named like the disabled one', () => {
        check(mountItem({ type: 'chat', rangeStart: 0, rangeEnd: 3, chatAsOriginalOnSystem: false } as PromptItem), [
            TYPE,
            { name: language.rangeStart },
            { name: language.rangeEnd },
        ])
    })

    test('chat item in the whole-chat form: only the type select', () => {
        check(mountItem({ type: 'chat', rangeStart: -1000, rangeEnd: 'end' } as PromptItem), [TYPE])
    })

    test('persona item: type select and the block role select', () => {
        check(mountItem({ type: 'persona', innerFormat: null, role2: 'system' } as unknown as PromptItem), [
            TYPE,
            { name: language.role },
        ])
    })

    test('author note with a custom inner format: type select and the block role select', () => {
        check(mountItem({ type: 'authornote', defaultText: '', innerFormat: '{{slot}}', role2: 'user' } as unknown as PromptItem), [
            TYPE,
            { name: language.role },
        ])
    })
})
