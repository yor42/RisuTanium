/**
 * Stepping to another candidate of the last reply (reroll forward, un-reroll
 * back) removes the reply's `interrupted` flag: the person has looked at the
 * candidate. Drives the REAL composer actions, work registry and origin
 * writer against a real `$state` database; the generation entry point, the
 * candidate store and the other collaborators are mocked.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, Chat, Message } from 'src/ts/storage/database.svelte'

//#region module mocks

const prerollMock = vi.hoisted(() => vi.fn())
const preUnrerollMock = vi.hoisted(() => vi.fn())

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
    Prereroll: prerollMock,
    PreUnreroll: preUnrerollMock,
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

function installFlaggedReply(): Message {
    const message = { role: 'char', data: 'Partial', time: 1, chatId: 'reply-1', interrupted: true, generationInfo: { generationId: 'gen-1' } } as unknown as Message
    const chat = { id: 'chat-0', note: '', name: '', localLore: [], fmIndex: -1, message: [{ role: 'user', data: 'Hi', time: 1 }, message] } as unknown as Chat
    DBState.db = {
        characters: [{ chaId: 'char-0', name: 'char-0', type: 'character', chatPage: 0, chats: [chat] }],
    } as unknown as Database
    selectedCharID.set(0)
    return DBState.db.characters[0].chats[0].message[1]
}

const source: ComposerActionsSource = { closeMenu: () => {} }

beforeEach(() => {
    prerollMock.mockReset()
    preUnrerollMock.mockReset()
    resetComposerActionsForTests()
})

describe('stepping to another candidate of a flagged reply', () => {
    test('un-reroll back to an earlier candidate removes the flag', async () => {
        const reply = installFlaggedReply()
        preUnrerollMock.mockReturnValue('Earlier candidate')

        await unReroll(source)

        expect(reply.data).toBe('Earlier candidate')
        expect('interrupted' in reply).toBe(false)
    })

    test('reroll forward to a later candidate removes the flag', async () => {
        const reply = installFlaggedReply()
        prerollMock.mockReturnValue('Later candidate')

        await reroll(source)

        expect(reply.data).toBe('Later candidate')
        expect('interrupted' in reply).toBe(false)
    })

    test('guard: with no candidate to step to, the reply and its flag stay', async () => {
        const reply = installFlaggedReply()
        preUnrerollMock.mockReturnValue(undefined)

        await unReroll(source)

        expect(reply.data).toBe('Partial')
        expect(reply.interrupted).toBe(true)
    })
})
