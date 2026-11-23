// @vitest-environment jsdom

/**
 * The REAL `Suggestion.svelte`: the translate toggle, the reroll button and the copy-to-input button
 * are named and their glyphs hidden, the translate toggle exposes `aria-pressed`, and its on state is
 * a filled chip with a ring instead of a hue. The suggestion button itself is named by its text.
 *
 * MOCKED: the module set of `Suggestion.surfaceReturn.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(0),
        MobileGUI: writable(false),
        ReloadChatPointer: writable({}),
        ReloadGUIPointer: writable(0),
        settingsOpen: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/process/suggestionRequest'), () => ({
    requestSuggestionData: vi.fn(() => new Promise(() => {})),
}) as unknown as typeof import('src/ts/process/suggestionRequest'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/process/composerActions.svelte'), () => ({
    isComposerLocked: vi.fn(() => false),
    isComposerLockedIn: vi.fn(() => false),
}) as unknown as typeof import('src/ts/process/composerActions.svelte'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/translator/translator'), () => ({
    translate: vi.fn(async (text: string) => text),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => false),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    getUserName: vi.fn(() => 'User'),
    replacePlaceholders: vi.fn((text: string) => text),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    ParseMarkdown: vi.fn(async (text: string) => text),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

import { DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import Suggestion from './Suggestion.svelte'
import { resetChatSurfaceForTests } from './chatSurface.svelte'

let instance: ReturnType<typeof mount> | null = null
let target: HTMLElement | null = null

async function showSuggestion(): Promise<HTMLElement> {
    DBState.db = {
        translator: 'google',
        autoTranslate: false,
        subModel: 'sub',
        autoSuggestPrompt: 'suggest',
        characters: [{
            name: 'Char',
            chatPage: 0,
            chats: [{ message: [{ role: 'user', data: 'Hi', chatId: 'u1' }], suggestMessages: ['idea'] }],
        }],
    } as never
    target = document.createElement('div')
    document.body.appendChild(target)
    instance = mount(Suggestion, { target, props: { send: () => {}, messageInput: () => {} } })
    flushSync()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    flushSync()
    return target
}

afterEach(async () => {
    if (instance) await unmount(instance)
    target?.remove()
    instance = null
    target = null
    resetChatSurfaceForTests()
})

describe('Suggestion accessible names', () => {
    test('regression reproducer: every button is named and every glyph hidden', async () => {
        const root = await showSuggestion()
        expect(unnamedControls(root)).toEqual([])
        expect(exposedIcons(root)).toEqual([])
        const buttons = Array.from(root.querySelectorAll('button'))
        expect(buttons.map(controlName)).toEqual([language.translate, language.reroll, 'idea', language.suggestionToInput])
    })

    test('regression reproducer: the translate toggle exposes its state and shows the on state without a palette hue', async () => {
        const root = await showSuggestion()
        const toggle = root.querySelector<HTMLButtonElement>('button.font-bold')!
        expect(toggle.getAttribute('aria-pressed')).toBe('false')
        expect(toggle.classList.contains('bg-textcolor2')).toBe(true)
        toggle.click()
        flushSync()
        expect(toggle.getAttribute('aria-pressed')).toBe('true')
        for (const token of ['bg-selected', 'ring-1', 'ring-borderc', 'hover:ring-2']) {
            expect(toggle.classList.contains(token)).toBe(true)
        }
        expect(paletteClasses(root)).toEqual([])
    })
})
