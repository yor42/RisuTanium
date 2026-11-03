// @vitest-environment happy-dom

/**
 * `Suggestion.svelte` under a kept-mounted chat surface: the translate toggle is seeded from
 * `autoTranslate` when the component is created, so a setting changed while Settings covers the
 * chat is taken up on the return, and a toggle the user set by hand survives a visit that left
 * the setting alone.
 *
 * Labels: R = regression reproducer (the base keeps the mount-time value), G = guard (passes before and after).
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
import Suggestion from './Suggestion.svelte'
import { chatSurface, resetChatSurfaceForTests } from './chatSurface.svelte'

let instance: ReturnType<typeof mount> | null = null
let target: HTMLElement | null = null

function showSuggestion(autoTranslate: boolean): void {
    DBState.db = {
        translator: 'google',
        autoTranslate,
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
}

function translateToggleIsOn(): boolean {
    const toggle = target?.querySelector('button.font-bold')
    if (!toggle) {
        throw new Error('the translate toggle was not rendered')
    }
    return toggle.classList.contains('text-green-500')
}

function visit(changeSetting: () => void): void {
    chatSurface.hidden = true
    flushSync()
    changeSetting()
    flushSync()
    chatSurface.hidden = false
    flushSync()
}

afterEach(async () => {
    if (instance) {
        await unmount(instance).catch(() => {})
    }
    instance = null
    target?.remove()
    target = null
    resetChatSurfaceForTests()
})

describe('the translate toggle across a Settings visit', () => {
    test('R T27 follows an autoTranslate setting turned on while hidden', () => {
        showSuggestion(false)
        expect(translateToggleIsOn()).toBe(false)

        visit(() => { DBState.db.autoTranslate = true })

        expect(translateToggleIsOn()).toBe(true)
    })

    test('R T27 follows an autoTranslate setting turned off while hidden', () => {
        showSuggestion(true)
        expect(translateToggleIsOn()).toBe(true)

        visit(() => { DBState.db.autoTranslate = false })

        expect(translateToggleIsOn()).toBe(false)
    })

    test('G a toggle set by hand stays when the setting did not change', () => {
        showSuggestion(false)
        const toggle = target?.querySelector('button.font-bold') as HTMLButtonElement
        toggle.click()
        flushSync()
        expect(translateToggleIsOn()).toBe(true)

        visit(() => {})

        expect(translateToggleIsOn()).toBe(true)
    })
})
