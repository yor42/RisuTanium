// @vitest-environment node

/**
 * Lua `setFullChat` against a chat with alternatives, through the real Lua engine and the real
 * `setFullChatMain` host function.
 *
 * Test kinds: every row is a regression reproducer unless its title starts with "guard:". The rows fail
 * on the code that rebuilds each message as `{role, data}` and never re-attaches records.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import type { Chat, ChatAlt, Message } from '../../storage/database.svelte'

vi.mock('../../parser/parser.svelte', () => ({
    hasher: vi.fn(),
    risuChatParser: vi.fn(),
}))

vi.mock('../../alert', () => ({
    alertConfirm: vi.fn(),
    alertError: vi.fn(),
    alertInput: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
}))

vi.mock('../../globalApi.svelte', () => ({ fetchNative: vi.fn(), readImage: vi.fn() }))
vi.mock('../../tokenizer', () => ({ tokenize: vi.fn() }))
vi.mock('../../util', () => ({
    asBuffer: vi.fn(),
    getPersonaPrompt: vi.fn(),
    getUserIcon: vi.fn(),
    getUserName: vi.fn(),
}))

vi.mock('../../storage/database.svelte', () => ({
    getCurrentCharacter: vi.fn(() => ({})),
    getCurrentChat: vi.fn(() => ({ message: [] })),
    getDatabase: vi.fn(() => ({ characters: [] })),
    setDatabase: vi.fn(),
}))

vi.mock('../../stores.svelte', () => ({
    DBState: { db: {} },
    ReloadChatPointer: { update: vi.fn() },
    ReloadGUIPointer: { update: vi.fn() },
    selectedCharID: { subscribe: (run: (value: number) => void) => (run(0), () => undefined) },
}))

vi.mock('../modules', () => ({
    getModuleLorebooks: vi.fn(() => []),
    getModuleTriggers: vi.fn(() => []),
}))

vi.mock('../files/inlays', () => ({ getInlayAsset: vi.fn(), writeInlayImage: vi.fn() }))
vi.mock('../lorebook.svelte', () => ({ loadLoreBookV3Prompt: vi.fn() }))
vi.mock('../memory/hypamemory', () => ({ HypaProcesser: vi.fn() }))
vi.mock('../request/request', () => ({ requestChatData: vi.fn() }))
vi.mock('../stableDiff', () => ({ generateAIImage: vi.fn() }))

let runScripted: typeof import('../scriptings').runScripted

beforeAll(async () => {
    const jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))
    runScripted = (await import('../scriptings')).runScripted
})

function msg(chatId: string, data: string, time: number, role: 'user' | 'char' = 'char'): Message {
    return { role, data, chatId, time }
}

function chatOf(path: Message[], alt?: ChatAlt[]): Chat {
    return { message: path, note: '', name: 'chat', localLore: [], ...(alt ? { alt } : {}) }
}

async function setFullChat(chat: Chat, luaTable: string): Promise<void> {
    await runScripted(`function onStart(id) setFullChat(id, ${luaTable}) end`, {
        char: {} as never,
        chat,
        setVar: () => false,
        getVar: () => 'null',
        mode: 'start',
    })
}

describe('Lua setFullChat keeps the tree attached', () => {
    test('a message with the same index, role and data keeps its id and time; an edited one gets none', async () => {
        const chat = chatOf([msg('a', 'hello', 10, 'user'), msg('b', 'world', 20)])
        await setFullChat(chat, '{ {role="user", data="hello"}, {role="char", data="changed"} }')
        expect(chat.message[0]).toMatchObject({ chatId: 'a', time: 10 })
        expect(chat.message[1].chatId).toBeUndefined()
        expect(chat.message[1].time).toBeUndefined()
    })

    test('alternatives that follow an unchanged message stay on it', async () => {
        const chat = chatOf(
            [msg('a', 'hello', 10, 'user'), msg('b', 'world', 20)],
            [{ m: msg('x', 'other', 21), p: 'a', a: 1 }],
        )
        await setFullChat(chat, '{ {role="user", data="hello"}, {role="char", data="changed"} }')
        expect(chat.alt?.map((r) => r.p)).toEqual(['a'])
    })

    test('a record whose parent was edited away goes to the nearest earlier survivor', async () => {
        const chat = chatOf(
            [msg('a', 'one', 1, 'user'), msg('b', 'two', 2), msg('c', 'three', 3, 'user')],
            [{ m: msg('x', 'alt of c', 4), p: 'c', a: 1 }],
        )
        await setFullChat(chat, '{ {role="user", data="one"}, {role="char", data="two"}, {role="user", data="three, edited"} }')
        expect(chat.alt?.[0].p).toBe('b')
    })

    test('a list that is empty over a non-empty path is a full clear and clears the alternatives', async () => {
        const chat = chatOf([msg('a', 'one', 1)], [{ m: msg('x', 'other', 2), p: 'a', a: 1 }])
        await setFullChat(chat, '{}')
        expect(chat.message).toEqual([])
        expect('alt' in chat).toBe(false)
    })

    test('guard: a chat with no alternatives is rebuilt as before and gains none', async () => {
        const chat = chatOf([msg('a', 'one', 1, 'user')])
        await setFullChat(chat, '{ {role="user", data="one"}, {role="char", data="two"} }')
        expect(chat.message.map((m) => m.data)).toEqual(['one', 'two'])
        expect('alt' in chat).toBe(false)
    })
})
