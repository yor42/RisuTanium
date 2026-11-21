import { writable } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat } from '../storage/database.svelte'
import type { RunSubject } from '../process/chatOrigin'

//#region module mocks

vi.mock(import('../stores.svelte'), () => ({
    DBState: { db: { characters: [], globalChatVariables: {}, templateDefaultVariables: '' } },
    selectedCharID: writable(0),
    selIdState: { selId: 0 },
}) as unknown as typeof import('../stores.svelte'))

vi.mock(import('../storage/database.svelte'), () => ({
    getCurrentChat: () => ({}),
    getCurrentCharacter: () => ({}),
}) as unknown as typeof import('../storage/database.svelte'))

vi.mock(import('../util'), () => ({
    parseKeyValue: () => [],
}) as unknown as typeof import('../util'))

//#endregion

import { DBState } from '../stores.svelte'
import { getGlobalChatVar } from './chatVar.svelte'
import { createRunSubject } from '../process/chatOrigin'

type Db = { characters: unknown[]; globalChatVariables: Record<string, string>; templateDefaultVariables: string }
const db = () => DBState.db as unknown as Db

function chatOf(local: Record<string, string> | undefined): Chat {
    return { id: 'chat-1', name: 'c', message: [], note: '', localLore: [], GLGlobalVariables: local }
}

// A subject over a fixed chat, shaped like the engine's own: the five members the engine defines.
function subjectOver(chat: Chat, sharedGlobals?: Readonly<Record<string, string>>): RunSubject {
    const ctx = { owner: { chaId: 'owner-1', name: 'o', chats: [chat], chatPage: 0 }, ownerIndex: -1, chat, chatIndex: 0, member: null, memberIndex: null }
    const subject = {
        origin: { chaId: 'owner-1', chatId: 'chat-1' },
        resolve: () => ctx,
        status: () => 'ok',
        memberStatus: () => null,
        mark: () => {},
        ...(sharedGlobals ? { sharedGlobals } : {}),
    }
    return subject as unknown as RunSubject
}

beforeEach(() => {
    db().characters = []
    db().globalChatVariables = { g: 'live', toggle_a: '1' }
})

describe('E2-U5 a real subject reads the database globals (compatibility guard: passes before and after the seam)', () => {
    test('chat-local value first, then the database value, then null; with and without a subject', () => {
        const chat = chatOf({ local: 'mine' })
        const real = createRunSubject({ chaId: 'owner-1', chatId: 'chat-1' })
        db().characters = [{ chaId: 'owner-1', name: 'o', chatPage: 0, chats: [chat] }]
        for (const subject of [undefined, real, subjectOver(chat)]) {
            expect(getGlobalChatVar('g', subject)).toBe('live')
            expect(getGlobalChatVar('nosuch', subject)).toBe('null')
        }
        expect(getGlobalChatVar('local', subjectOver(chat))).toBe('mine')
    })

    test('a real subject never carries a seam, so an inherited value is the live one', () => {
        const real = createRunSubject({ chaId: 'owner-1', chatId: 'chat-1' })
        expect(real.sharedGlobals).toBeUndefined()
    })
})

describe('E2-U4a the sharedGlobals read seam', () => {
    test('when set, shared values come from it and never from the database', () => {
        const subject = subjectOver(chatOf(Object.create(null)), Object.assign(Object.create(null), { toggle_a: '0', toggle_b: '' }))
        expect(getGlobalChatVar('g', subject)).toBe('null')
        expect(getGlobalChatVar('toggle_a', subject)).toBe('0')
        expect(getGlobalChatVar('toggle_b', subject)).toBe('')
        expect(getGlobalChatVar('toggle_c', subject)).toBe('null')
    })

    test('a seam with no prototype reads inherited names as null', () => {
        const subject = subjectOver(chatOf(Object.create(null)), Object.assign(Object.create(null), {}))
        expect(getGlobalChatVar('constructor', subject)).toBe('null')
    })

    test('an empty seam hides every database value, and a chat-local value still wins', () => {
        const subject = subjectOver(chatOf({ toggle_a: 'mine' }), {})
        expect(getGlobalChatVar('toggle_a', subject)).toBe('mine')
        expect(getGlobalChatVar('g', subject)).toBe('null')
    })

    test('the seam is read, never written: the database globals are unchanged', () => {
        const before = structuredClone(db().globalChatVariables)
        const subject = subjectOver(chatOf(Object.create(null)), { toggle_a: '0' })
        getGlobalChatVar('toggle_a', subject)
        getGlobalChatVar('g', subject)
        expect(db().globalChatVariables).toEqual(before)
    })
})
