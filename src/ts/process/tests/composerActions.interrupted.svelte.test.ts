/**
 * Stepping to another sibling of the last reply (reroll forward, un-reroll
 * back) moves the reply on screen as a whole, so the `interrupted` flag stays
 * with the message that carries it, on the path or parked in `alt`. Drives the
 * REAL composer actions, work registry and origin writer against a real
 * `$state` database; the generation entry point and the other collaborators
 * are mocked.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, Chat, Message } from 'src/ts/storage/database.svelte'

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
    } as unknown as typeof import('src/ts/stores.svelte')
})

// The composer's module reference list reads the database through these three; the real file would load the whole
// app graph, which this suite does not need.
vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    const { get } = await import('svelte/store')
    const state = stores.DBState as unknown as { db: { characters?: Array<{ chatPage: number, chats?: unknown[] }> } }
    const getCurrentCharacter = () => state.db.characters?.[get(stores.selectedCharID)]
    const getCurrentChat = () => {
        const char = getCurrentCharacter()
        return char?.chats?.[char.chatPage]
    }
    return {
        getDatabase: vi.fn(() => state.db),
        getCurrentCharacter: vi.fn(getCurrentCharacter),
        getCurrentChat: vi.fn(getCurrentChat),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
    sendChat: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/process/sendCharacterMessage'), () => ({
    sendCharacterMessage: vi.fn(),
}) as unknown as typeof import('src/ts/process/sendCharacterMessage'))

vi.mock(import('src/ts/process/prereroll'), () => ({
    addRerolls: vi.fn(),
}) as unknown as typeof import('src/ts/process/prereroll'))

vi.mock(import('src/ts/process/command'), () => ({
    processMultiCommand: vi.fn(async () => false),
}) as unknown as typeof import('src/ts/process/command'))

vi.mock(import('src/ts/translator/translator'), () => ({
    isExpTranslator: vi.fn(() => false),
    translate: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/coldstorageData'), () => ({
    isColdChat: vi.fn(() => false),
}) as unknown as typeof import('src/ts/process/coldstorageData'))

//#endregion

import { reroll, unReroll, resetComposerActionsForTests, type ComposerActionsSource } from 'src/ts/process/composerActions.svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'

/** A chat whose last reply (time 5) is flagged, with `siblings` as records that follow the user message. */
function installFlaggedReply(siblings: Message[] = []): Chat {
    const message = { role: 'char', data: 'Partial', time: 5, chatId: 'reply-1', interrupted: true, generationInfo: { generationId: 'gen-1' } } as unknown as Message
    const chat = {
        id: 'chat-0', note: '', name: '', localLore: [], fmIndex: -1,
        message: [{ role: 'user', data: 'Hi', time: 1, chatId: 'user-0' }, message],
        alt: siblings.map((m) => ({ m, p: 'user-0', a: 1 })),
    } as unknown as Chat
    DBState.db = {
        characters: [{ chaId: 'char-0', name: 'char-0', type: 'character', chatPage: 0, chats: [chat] }],
    } as unknown as Database
    selectedCharID.set(0)
    return DBState.db.characters[0].chats[0]
}

function sibling(data: string, time: number, extra: Record<string, unknown> = {}): Message {
    return { role: 'char', data, time, chatId: `sib-${data}`, ...extra } as unknown as Message
}

const source: ComposerActionsSource = { closeMenu: () => {} }

beforeEach(() => {
    resetComposerActionsForTests()
})

describe('stepping to another sibling of a flagged reply', () => {
    test('un-reroll back to an earlier sibling shows it and parks the flagged reply with its flag', async () => {
        const chat = installFlaggedReply([sibling('Earlier candidate', 2)])

        await unReroll(source)

        expect(chat.message[1].data).toBe('Earlier candidate')
        expect('interrupted' in chat.message[1]).toBe(false)
        const parked = chat.alt!.find((record) => record.m.chatId === 'reply-1')
        expect(parked?.m.interrupted).toBe(true)
    })

    test('reroll forward to a later sibling shows it and parks the flagged reply with its flag', async () => {
        const chat = installFlaggedReply([sibling('Later candidate', 9)])

        await reroll(source)

        expect(chat.message[1].data).toBe('Later candidate')
        const parked = chat.alt!.find((record) => record.m.chatId === 'reply-1')
        expect(parked?.m.interrupted).toBe(true)
    })

    test('a sibling that was itself interrupted keeps its flag when it is shown', async () => {
        const chat = installFlaggedReply([sibling('Stopped earlier', 2, { interrupted: true })])

        await unReroll(source)

        expect(chat.message[1].data).toBe('Stopped earlier')
        expect(chat.message[1].interrupted).toBe(true)
    })

    test('guard: with no sibling to step to, the reply and its flag stay', async () => {
        const chat = installFlaggedReply()

        await unReroll(source)

        expect(chat.message[1].data).toBe('Partial')
        expect(chat.message[1].interrupted).toBe(true)
    })
})
