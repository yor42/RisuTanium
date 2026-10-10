// @vitest-environment happy-dom

/**
 * `Chats.svelte` passes a message's `interrupted` flag to `Chat` as a mount
 * prop only while no stream is writing that reply, and the flag is part of the
 * message's mount hash, so removing it without touching the text re-mounts the
 * message. The real `Chats.svelte` is mounted; `Chat.svelte` is replaced by a
 * stub that records the props it was mounted with.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mounts = vi.hoisted(() => [] as Array<{ interrupted: boolean, message: string, idx: number }>)
const unmounts = vi.hoisted(() => ({ count: 0 }))

vi.mock('./Chat.svelte', () => ({
    default: (_anchor: unknown, props: { interrupted: boolean, message: string, idx: number }) => {
        mounts.push({ interrupted: props.interrupted, message: props.message, idx: props.idx })
        return { destroy: () => { unmounts.count += 1 } }
    },
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(0),
        ReloadChatPointer: writable({} as Record<number, number>),
        createSimpleCharacter: vi.fn(() => ({})),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    chatFoldedStateMessageIndex: { index: -1 },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/characters'))

import { DBState } from 'src/ts/stores.svelte'
import { addActiveStream, resetActiveStreamsForTest } from 'src/ts/process/activeStreams'
import Chats from './Chats.svelte'

type Mode = 'off' | 'balanced' | 'strong'

interface LiveMessage { role: 'user' | 'char', data: string, chatId?: string, interrupted?: true }
interface LiveChat { id: string, message: LiveMessage[], isStreaming?: boolean, activeStreamingDisplayOptimizationMode?: Mode }
interface LiveCharacter { chaId: string, name: string, image: string, chatPage: number, chats: LiveChat[] }

let instance: ReturnType<typeof mount> | null = null
let target: HTMLElement | null = null

function mountChats(mode: Mode, messages: LiveMessage[]): { chat: LiveChat } {
    const character: LiveCharacter = { chaId: 'a', name: 'A', image: '', chatPage: 0, chats: [{ id: 'chat-0', message: messages }] }
    DBState.db = { streamingDisplayOptimizationMode: mode, characters: [character] } as never
    const live = (DBState.db.characters as unknown as LiveCharacter[])[0]
    target = document.createElement('div')
    document.body.appendChild(target)
    instance = mount(Chats, {
        target,
        props: {
            messages: live.chats[0].message as never,
            currentCharacter: live as never,
            onReroll: () => {},
            unReroll: () => {},
            currentUsername: 'User',
            userIcon: '',
            loadPages: 10,
        },
    })
    flushSync()
    return { chat: live.chats[0] }
}

/** The mounts of the message at `idx`, oldest first. */
function mountsAt(idx: number) {
    return mounts.filter((entry) => entry.idx === idx)
}

beforeEach(() => {
    mounts.length = 0
    unmounts.count = 0
    resetActiveStreamsForTest()
})

afterEach(async () => {
    if (instance) {
        await unmount(instance).catch(() => {})
    }
    instance = null
    target?.remove()
    target = null
})

describe('the interrupted note is a mount prop of Chat', () => {
    test.each(['off', 'balanced', 'strong'] as const)('a flagged reply nothing is streaming (after a load) is mounted with it (%s mode)', (mode) => {
        mountChats(mode, [
            { role: 'user', data: 'Hi' },
            { role: 'char', data: 'Partial', chatId: 'reply-1', interrupted: true },
        ])

        expect(mountsAt(1).map((entry) => entry.interrupted)).toEqual([true])
        expect(mountsAt(0).map((entry) => entry.interrupted)).toEqual([false])
    })

    test.each(['off', 'balanced', 'strong'] as const)('guard: a reply without the flag is mounted without it (%s mode)', (mode) => {
        mountChats(mode, [
            { role: 'user', data: 'Hi' },
            { role: 'char', data: 'Whole', chatId: 'reply-1' },
        ])

        expect(mountsAt(1).map((entry) => entry.interrupted)).toEqual([false])
    })

    test.each(['off', 'balanced', 'strong'] as const)('the reply being streamed is mounted without it before its first chunk (%s mode)', (mode) => {
        const { chat } = mountChats(mode, [{ role: 'user', data: 'Hi' }])
        mounts.length = 0

        // What the stream does in one synchronous step.
        chat.message.push({ role: 'char', data: '', chatId: 'reply-1', interrupted: true })
        addActiveStream({ chaId: 'a', replyChatId: 'reply-1' })
        chat.isStreaming = true
        chat.activeStreamingDisplayOptimizationMode = mode
        flushSync()

        expect(mountsAt(1).map((entry) => entry.interrupted)).toEqual([false])
    })

    test('off mode: removing the flag without touching the text re-mounts the message without the note', () => {
        const { chat } = mountChats('off', [
            { role: 'user', data: 'Hi' },
            { role: 'char', data: 'Partial', chatId: 'reply-1', interrupted: true },
        ])
        const mountedBefore = mountsAt(1).length

        delete chat.message[1].interrupted
        flushSync()

        const after = mountsAt(1)
        expect(after.length).toBe(mountedBefore + 1)
        expect(after.at(-1)).toMatchObject({ interrupted: false, message: 'Partial' })
    })

    test.each(['off', 'balanced', 'strong'] as const)('a continue of a flagged reply hides the note while it streams and after it ends (%s mode)', (mode) => {
        const { chat } = mountChats(mode, [
            { role: 'user', data: 'Hi' },
            { role: 'char', data: 'Partial', chatId: 'reply-1', interrupted: true },
        ])
        expect(mountsAt(1).at(-1)?.interrupted).toBe(true)

        const removeStream = addActiveStream({ chaId: 'a', replyChatId: 'reply-1' })
        chat.isStreaming = true
        chat.activeStreamingDisplayOptimizationMode = mode
        flushSync()
        expect(mountsAt(1).at(-1)?.interrupted).toBe(false)

        chat.message[1].data = 'Partial and more'
        flushSync()
        expect(mountsAt(1).at(-1)?.interrupted).toBe(false)

        removeStream()
        delete chat.message[1].interrupted
        chat.isStreaming = false
        chat.activeStreamingDisplayOptimizationMode = undefined
        flushSync()
        expect(mountsAt(1).at(-1)).toMatchObject({ interrupted: false, message: 'Partial and more' })
    })
})
