// @vitest-environment happy-dom

/**
 * `loadLoreBookV3Prompt`'s `used` list: which entries reached the prompt, named
 * by their source (character, chat or module), owner id and index within that
 * source's list. Regression reproducers: an engine without the list fails all
 * of them. The parser is an identity and the tokenizer counts characters.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat, character, Message } from '../../storage/database.svelte'
import '../../polyfill'

const h = vi.hoisted(() => ({
    db: {
        characters: [] as unknown[],
        username: 'User',
        loreBookDepth: 5,
        loreBookToken: 100000,
        templateDefaultVariables: '',
    },
    moduleLore: [] as unknown[],
    moduleOwners: [] as string[],
}))

vi.mock('../../stores.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    return {
        DBState: { db: h.db },
        selectedCharID: store(0),
    }
})
vi.mock('../../storage/database.svelte', () => ({
    getDatabase: () => h.db,
    getCurrentChat: () => undefined,
    getCurrentCharacter: () => undefined,
}))
vi.mock('../../alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn() }))
vi.mock('../../../lang', () => ({ language: {} }))
vi.mock('../../globalApi.svelte', () => ({ downloadFile: vi.fn() }))
vi.mock('../../util', () => ({
    findCharacterbyId: vi.fn(() => undefined),
    pickHashRand: (_cid: number, word: string) => word.length,
    selectSingleFile: vi.fn(),
    parseKeyValue: () => [],
}))
vi.mock('../../parser/parser.svelte', () => ({ risuChatParser: vi.fn((text: string) => text) }))
vi.mock('../../tokenizer', () => ({ tokenize: async (text: string) => text.length }))
vi.mock('../modules', () => ({
    getModuleLorebooks: vi.fn((_subject: unknown, owners?: string[]) => {
        owners?.push(...h.moduleOwners)
        return h.moduleLore
    }),
}))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('../memory/busyActions', () => ({ beginBusy: vi.fn() }))

import { loadLoreBookV3Prompt } from '../lorebook.svelte'
import { createRunSubject, originOf } from '../chatOrigin'
import { selectedCharID } from '../../stores.svelte'

type Entry = Record<string, unknown>

function entry(key: string, content: string, over: Entry = {}): Entry {
    return {
        key,
        comment: key,
        content,
        mode: 'normal',
        insertorder: 100,
        alwaysActive: false,
        secondkey: '',
        selective: false,
        ...over,
    }
}

function scene(characterLore: Entry[], chatLore: Entry[], tokenBudget = 100000) {
    const chat = {
        id: 'chat-1',
        name: 'Chat',
        localLore: chatLore,
        message: [{ role: 'user', data: 'the dragon by the castle', time: 0 }] as Message[],
    } as unknown as Chat
    const char = {
        name: 'Char',
        chaId: 'cha-1',
        chatPage: 0,
        globalLore: characterLore,
        loreSettings: { scanDepth: 5, tokenBudget, fullWordMatching: false, recursiveScanning: false },
        chats: [chat],
    } as unknown as character
    h.db.characters = [char]
    selectedCharID.set(0)
    const origin = originOf(char, chat)
    if (!origin) throw new Error('fixture has no origin')
    return createRunSubject(origin)
}

const byPlace = (a: { source: string, index: number }, b: { source: string, index: number }) =>
    a.source === b.source ? a.index - b.index : a.source.localeCompare(b.source)

beforeEach(() => {
    h.moduleLore = []
    h.moduleOwners = []
})

describe('used entries', () => {
    test('regression reproducer: names each sent entry by source, owner and index within its own list', async () => {
        h.moduleLore = [entry('nothing', 'module miss'), entry('dragon', 'module hit', { comment: 'Module dragon' })]
        h.moduleOwners = ['mod-a', 'mod-b']
        const subject = scene(
            [entry('unmatched', 'char miss'), entry('castle', 'char hit', { comment: '' })],
            [entry('dragon', 'chat hit', { comment: 'Chat dragon' })],
        )
        const result = await loadLoreBookV3Prompt(subject)
        expect([...result.used].sort(byPlace)).toEqual([
            { source: 'character', ownerId: 'cha-1', index: 1, name: 'castle' },
            { source: 'chat', ownerId: 'chat-1', index: 0, name: 'Chat dragon' },
            { source: 'module', ownerId: 'mod-b', index: 1, name: 'Module dragon' },
        ])
        expect(result.actives).toHaveLength(3)
    })

    test('regression reproducer: an entry cut by the token budget is not listed', async () => {
        const subject = scene(
            [entry('dragon', 'short', { insertorder: 200 }), entry('castle', 'a body far longer than the budget allows', { insertorder: 10 })],
            [],
            10,
        )
        const result = await loadLoreBookV3Prompt(subject)
        expect(result.used.map((used) => used.index)).toEqual([0])
    })

    test('regression reproducer: an injector merged into a sent target is listed with the target', async () => {
        const subject = scene(
            [
                entry('castle', '@@inject_lore target\ninjected', { comment: 'injector' }),
                entry('dragon', 'target body', { comment: 'target' }),
            ],
            [],
        )
        const result = await loadLoreBookV3Prompt(subject)
        expect(result.actives.map((active) => active.source)).toEqual(['target'])
        expect(result.used.map((used) => used.name).sort()).toEqual(['injector', 'target'])
    })

    test('regression reproducer: a module entry whose owner the module lookup did not report keeps an empty owner id', async () => {
        h.moduleLore = [entry('dragon', 'module hit', { comment: 'Module dragon' })]
        const subject = scene([], [])
        const result = await loadLoreBookV3Prompt(subject)
        expect(result.used).toEqual([{ source: 'module', ownerId: '', index: 0, name: 'Module dragon' }])
    })
})
