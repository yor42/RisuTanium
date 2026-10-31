// @vitest-environment happy-dom

/**
 * `Suggestion.svelte` after a tree switch: the list of the departed path is not shown, and a suggestion
 * request still in flight when the last message changes does not write its result back.
 *
 * Test kinds: "guard:" rows are compatibility guards that pass before and after (a switch clears the list
 * through the chat's own `suggestMessages`, and a request with no switch still lands); the in-flight row is
 * a regression reproducer that fails when the request ignores the last message.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const pending = vi.hoisted(() => ({
    resolvers: [] as Array<(value: unknown) => void>,
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(0),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/process/suggestionRequest'), () => ({
    requestSuggestionData: vi.fn(() => new Promise((resolve) => { pending.resolvers.push(resolve) })),
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

interface LiveMessage { role: 'user' | 'char', data: string, chatId: string }
interface LiveChat { message: LiveMessage[], suggestMessages?: string[] }
interface LiveCharacter { name: string, chatPage: number, chats: LiveChat[] }

let instance: ReturnType<typeof mount> | null = null
let target: HTMLElement | null = null

function setup(message: LiveMessage[], suggestMessages?: string[]): LiveChat {
    const chat: LiveChat = { message }
    if (suggestMessages) {
        chat.suggestMessages = suggestMessages
    }
    DBState.db = {
        translator: '',
        autoTranslate: false,
        subModel: 'sub',
        autoSuggestPrompt: 'suggest',
        characters: [{ name: 'Char', chatPage: 0, chats: [chat] } satisfies LiveCharacter],
    } as never
    target = document.createElement('div')
    document.body.appendChild(target)
    instance = mount(Suggestion, { target, props: { send: () => {}, messageInput: () => {} } })
    flushSync()
    return (DBState.db.characters as unknown as LiveCharacter[])[0].chats[0]
}

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10))
    flushSync()
}

const shown = () => target?.textContent ?? ''

beforeEach(() => {
    pending.resolvers.length = 0
})

afterEach(async () => {
    if (instance) {
        await unmount(instance).catch(() => {})
    }
    instance = null
    target?.remove()
    target = null
})

const path = (): LiveMessage[] => [
    { role: 'user', data: 'Hi', chatId: 'u1' },
    { role: 'char', data: 'Hello', chatId: 'c2' },
]

describe('suggestions across a tree switch', () => {
    test('guard: the list is empty once the switch clears the chat suggestions', async () => {
        const chat = setup(path(), ['alpha reply', 'beta reply'])
        await settle()
        expect(shown()).toContain('alpha reply')

        delete chat.suggestMessages
        chat.message[1] = { role: 'char', data: 'Other', chatId: 'c1' }
        await settle()

        expect(shown()).not.toContain('alpha reply')
        expect(shown()).not.toContain('beta reply')
    })

    test('guard: a request with no switch lands', async () => {
        const chat = setup(path())
        expect(pending.resolvers.length).toBe(1)

        pending.resolvers[0]({ type: 'success', result: '- first idea\n- second idea' })
        await settle()

        expect(chat.suggestMessages).toEqual(['first idea', 'second idea'])
        expect(shown()).toContain('first idea')
    })

    test('a request still in flight when the last message changes does not write its result back', async () => {
        const chat = setup(path())
        expect(pending.resolvers.length).toBe(1)

        chat.message[1] = { role: 'char', data: 'Other', chatId: 'c1' }
        await settle()
        pending.resolvers[0]({ type: 'success', result: '- stale idea\n- stale two' })
        await settle()

        expect(chat.suggestMessages).toBeUndefined()
        expect(shown()).not.toContain('stale idea')
    })
})
