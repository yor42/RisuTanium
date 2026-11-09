// @vitest-environment happy-dom

/**
 * The reply streamed in 'off' mode is carried in place by `Chats.svelte`: its row stays mounted while only its text
 * changes, and the boundary hands the live text to the row. The real `Chats.svelte` and the real boundary are mounted;
 * `Chat.svelte` is replaced by a stub that records the props object each mount received (its getters stay live) and
 * answers `isTranslatedView` from a switch.
 *
 * Invariants pinned here: the tail mounts once over the chunks and sees the latest text; it is replaced once when the
 * stream ends, with fresh mount-time props; every other input of the row hash still remounts it; the carry applies only
 * to the registered last 'char' row of the same message object; the effect re-runs once per chunk; the translated view
 * of the carried instance is handed to the instance that replaces it, and the hold follows the stream registry.
 *
 * Labels: R = regression reproducer (fails on the pre-fix base), G = guard (passes before and after).
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addActiveStream, resetActiveStreamsForTest } from 'src/ts/process/activeStreams'

interface StubProps {
    idx: number
    message: string
    messageGenerationInfo?: unknown
    translationHold?: boolean
    startTranslated?: boolean
}

const rec = vi.hoisted(() => ({
    mounts: [] as StubProps[],
    translated: false,
}))

vi.mock('./Chat.svelte', () => ({
    default: (_anchor: unknown, props: StubProps) => {
        rec.mounts.push(props)
        return {
            updateStreamingDisplay: () => {},
            isTranslatedView: () => rec.translated,
            destroy: () => {},
        }
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

import { DBState, ReloadChatPointer } from 'src/ts/stores.svelte'
import Chats from './Chats.svelte'

type Mode = 'off' | 'balanced' | 'strong'
interface LiveMessage { role: 'user' | 'char', data: string, chatId?: string, generationInfo?: { model: string } }
interface LiveChat { id: string, message: LiveMessage[], isStreaming?: boolean }
interface LiveCharacter { chaId: string, name: string, image: string, chatPage: number, chats: LiveChat[] }

let instance: ReturnType<typeof mount> | null = null
let target: HTMLElement | null = null

function mountChats(message: LiveMessage[], mode: Mode = 'off'): LiveChat {
    const chat: LiveChat = { id: 'chat-0', message }
    const character: LiveCharacter = { chaId: 'a', name: 'A', image: '', chatPage: 0, chats: [chat] }
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
            loadPages: 100,
        },
    })
    flushSync()
    return live.chats[0]
}

/** The producer's pair: the registry entry and the flag are written in one block. */
function startStream(chat: LiveChat, replyChatId?: string) {
    const remove = replyChatId === undefined ? () => {} : addActiveStream({ chaId: 'a', replyChatId })
    chat.isStreaming = true
    flushSync()
    return remove
}

function endStream(chat: LiveChat, remove: () => void) {
    remove()
    chat.isStreaming = false
    flushSync()
}

function writeChunk(chat: LiveChat, index: number, text: string) {
    chat.message[index].data = text
    flushSync()
}

const mountsAt = (idx: number) => rec.mounts.filter((entry) => entry.idx === idx)

const pair = (): LiveMessage[] => [
    { role: 'user', data: 'U', chatId: 'u1' },
    { role: 'char', data: 'C', chatId: 'c1' },
]

const updatingChatsCount = () => vi.mocked(console.log).mock.calls.filter((call) => call[0] === 'Updating Chats').length

beforeEach(() => {
    rec.mounts.length = 0
    rec.translated = false
    ReloadChatPointer.set({})
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
    resetActiveStreamsForTest()
    vi.restoreAllMocks()
    if (instance) {
        await unmount(instance).catch(() => {})
    }
    instance = null
    target?.remove()
    target = null
})

describe('S6 the registered tail in mode off is carried in place', () => {
    test('R T9: over three chunks the tail mounts once and its live text is each chunk', () => {
        const chat = mountChats(pair())
        startStream(chat)
        for (const chunk of ['C a', 'C ab', 'C abc']) {
            writeChunk(chat, 1, chunk)
            expect(mountsAt(1)).toHaveLength(1)
            expect(mountsAt(1)[0].message).toBe(chunk)
        }
        expect(mountsAt(0)).toHaveLength(1)
    })

    test('G T11: the end replaces the tail once, with the final text and the generation info', () => {
        const chat = mountChats(pair())
        const remove = startStream(chat)
        writeChunk(chat, 1, 'C a')
        writeChunk(chat, 1, 'C ab')
        chat.message[1].generationInfo = { model: 'm' }
        endStream(chat, remove)

        expect(mountsAt(1)).toHaveLength(2)
        const newest = mountsAt(1)[1]
        expect(newest.message).toBe('C ab')
        expect(newest.messageGenerationInfo).toEqual({ model: 'm' })
        expect(mountsAt(0)).toHaveLength(1)
    })

    test('G T13: a reload pointer bump on the tail mid-stream remounts it', () => {
        const chat = mountChats(pair())
        startStream(chat)
        writeChunk(chat, 1, 'C a')
        ReloadChatPointer.update((value) => { value[1] = 1; return value })
        flushSync()
        expect(mountsAt(1)).toHaveLength(2)
    })

    test('G T13b: a changed user tail in a streaming chat remounts that row', () => {
        const chat = mountChats([
            { role: 'char', data: 'C', chatId: 'c1' },
            { role: 'user', data: 'U', chatId: 'u1' },
        ])
        startStream(chat)
        writeChunk(chat, 1, 'U edited')
        expect(mountsAt(1)).toHaveLength(2)
    })

    test('G T21: an edit of a char row before the tail remounts that row', () => {
        const chat = mountChats([
            { role: 'char', data: 'FIRST', chatId: 'c0' },
            { role: 'user', data: 'U', chatId: 'u1' },
        ])
        startStream(chat)
        writeChunk(chat, 0, 'FIRST edited')
        expect(mountsAt(0)).toHaveLength(2)
        expect(mountsAt(0)[1].message).toBe('FIRST edited')
    })

    test('G T22: a changed message id with a text change remounts the tail', () => {
        const chat = mountChats(pair())
        startStream(chat)
        writeChunk(chat, 1, 'C a')
        chat.message[1].chatId = 'c1b'
        chat.message[1].data = 'C ab'
        flushSync()
        expect(mountsAt(1)).toHaveLength(2)
        expect(mountsAt(1)[1].message).toBe('C ab')
    })

    test('G T23: a replaced message object with the same id remounts the tail', () => {
        const chat = mountChats(pair())
        startStream(chat)
        writeChunk(chat, 1, 'C a')
        chat.message[1] = { ...chat.message[1], data: 'C ab' }
        flushSync()
        expect(mountsAt(1)).toHaveLength(2)
        expect(mountsAt(1)[1].message).toBe('C ab')
    })

    test('G T24: each chunk runs the list effect once', () => {
        const chat = mountChats(pair())
        startStream(chat)
        const before = updatingChatsCount()
        for (const chunk of ['C a', 'C ab', 'C abc']) {
            writeChunk(chat, 1, chunk)
        }
        expect(updatingChatsCount() - before).toBe(3)
    })

    test.each<Mode>(['balanced', 'strong'])('G: in mode %s a chunk gives the tail no live text', (mode) => {
        const chat = mountChats(pair(), mode)
        startStream(chat)
        const mountsAfterStart = mountsAt(1).length
        writeChunk(chat, 1, 'C a')
        expect(mountsAt(1)).toHaveLength(mountsAfterStart)
        expect(mountsAt(1)[mountsAfterStart - 1].message).toBe('C')
    })
})

describe('S6T the translation hold and the translated view of the carried tail', () => {
    test('G: the hold follows the registry of the streaming reply and lifts at the end', () => {
        const chat = mountChats(pair())
        const remove = startStream(chat, 'c1')
        writeChunk(chat, 1, 'C a')
        expect(mountsAt(1)).toHaveLength(1)
        expect(mountsAt(1)[0].translationHold).toBe(true)
        expect(mountsAt(0)[0].translationHold).toBe(false)

        endStream(chat, remove)
        const newest = mountsAt(1)[mountsAt(1).length - 1]
        expect(newest.translationHold).toBe(false)
    })

    test('G: a streaming flag without a registered reply does not hold', () => {
        const chat = mountChats(pair())
        startStream(chat)
        writeChunk(chat, 1, 'C a')
        expect(mountsAt(1)[0].translationHold).toBe(false)
    })

    test('R: a tail replaced at the end of a stream starts in the translated view the carried one showed', () => {
        const chat = mountChats(pair())
        const remove = startStream(chat, 'c1')
        writeChunk(chat, 1, 'C a')
        rec.translated = true
        writeChunk(chat, 1, 'C ab')
        expect(mountsAt(1)).toHaveLength(1)
        expect(mountsAt(1)[0].startTranslated).toBe(false)

        endStream(chat, remove)
        expect(mountsAt(1)).toHaveLength(2)
        expect(mountsAt(1)[1].startTranslated).toBe(true)
    })

    test('G: an untranslated carried tail is replaced by an untranslated one', () => {
        const chat = mountChats(pair())
        const remove = startStream(chat, 'c1')
        writeChunk(chat, 1, 'C a')
        endStream(chat, remove)
        expect(mountsAt(1)).toHaveLength(2)
        expect(mountsAt(1)[1].startTranslated).toBe(false)
    })

    test('G: a mount mid-stream never starts translated', () => {
        const chat = mountChats(pair())
        startStream(chat, 'c1')
        writeChunk(chat, 1, 'C a')
        rec.translated = true
        ReloadChatPointer.update((value) => { value[1] = 1; return value })
        flushSync()
        expect(mountsAt(1)).toHaveLength(2)
        expect(mountsAt(1)[1].startTranslated).toBe(false)
    })
})
