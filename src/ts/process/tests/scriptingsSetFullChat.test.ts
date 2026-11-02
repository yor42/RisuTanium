// @vitest-environment node

/**
 * Lua `setFullChat` against a chat with alternatives, through the real Lua engine and the real
 * `setFullChatMain` host function.
 *
 * Test kinds: every row is a regression reproducer unless its title starts with "guard:". The rows about
 * the chatId a getter exposes and the id a payload entry claims fail on the code that exposes no chatId and
 * matches by index, role and data only. The remaining reproducers fail on the code that rebuilds each message
 * as `{role, data}` and never re-attaches records.
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
    test('with no chatId in the payload, a message with the same index, role and data keeps its id and time; an edited one gets none', async () => {
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

    test('an identity round-trip through Lua keeps every field of every message', async () => {
        const character: Message = {
            ...msg('b', 'world', 20),
            generationInfo: { model: 'm', generationId: 'g', inputTokens: 1, outputTokens: 2, maxContext: 3 },
            promptInfo: { promptName: 'p', promptToggles: [{ key: 'k', value: 'v' }], promptText: [{ role: 'user', content: 'c' }] },
            saying: 'npc',
            name: 'Nameless',
            otherUser: true,
            disabled: true,
            isComment: true,
        }
        const chat = chatOf([msg('a', 'hello', 10, 'user'), character])
        const original = structuredClone(chat.message)
        await runScripted('function onStart(id) setFullChat(id, getFullChat(id)) end', {
            char: {} as never,
            chat,
            setVar: () => false,
            getVar: () => 'null',
            mode: 'start',
        })
        expect(chat.message).toEqual(original)
    })

    test('guard: with no chatId in the payload, an edited message at the same index and role carries no metadata', async () => {
        const chat = chatOf([msg('a', 'hello', 10, 'user'), { ...msg('b', 'world', 20), disabled: true, isComment: true, saying: 'npc' }])
        await setFullChat(chat, '{ {role="user", data="hello"}, {role="char", data="changed"} }')
        expect(chat.message[1]).toEqual({ role: 'char', data: 'changed' })
    })

    test('guard: the same data under a different role is a new message', async () => {
        const chat = chatOf([{ ...msg('a', 'x', 10), disabled: true }])
        await setFullChat(chat, '{ {role="user", data="x"} }')
        expect(chat.message[0]).toEqual({ role: 'user', data: 'x' })
    })

    test('guard: a chat with no alternatives is rebuilt as before and gains none', async () => {
        const chat = chatOf([msg('a', 'one', 1, 'user')])
        await setFullChat(chat, '{ {role="user", data="one"}, {role="char", data="two"} }')
        expect(chat.message.map((m) => m.data)).toEqual(['one', 'two'])
        expect('alt' in chat).toBe(false)
    })
})

const luaKeys = 'local function keys(t) local k = {} for n in pairs(t) do k[#k + 1] = n end table.sort(k) return table.concat(k, ",") end '

async function scripted(chat: Chat, body: string): Promise<Record<string, string>> {
    const seen: Record<string, string> = {}
    await runScripted(`${luaKeys}function onStart(id) ${body} end`, {
        char: {} as never,
        chat,
        setVar: (key, value) => { seen[key] = value },
        getVar: () => 'null',
        mode: 'start',
    })
    return seen
}

function full(): Message {
    return {
        ...msg('b', 'world', 20),
        generationInfo: { model: 'm', generationId: 'g', inputTokens: 1, outputTokens: 2, maxContext: 3 },
        promptInfo: { promptName: 'p', promptToggles: [{ key: 'k', value: 'v' }], promptText: [{ role: 'user', content: 'c' }] },
        saying: 'npc',
        disabled: true,
        isComment: true,
        interrupted: true,
    }
}

describe('Lua getters expose chatId', () => {
    test('getFullChat shows the chatId of a message that has one and no key for one that has none', async () => {
        const chat = chatOf([msg('a', 'hello', 10, 'user'), { role: 'char', data: 'world' }])
        const seen = await scripted(chat, 'local c = getFullChat(id) setChatVar(id, "k1", keys(c[1])) setChatVar(id, "id1", tostring(c[1].chatId)) setChatVar(id, "k2", keys(c[2]))')
        expect(seen).toMatchObject({ k1: 'chatId,data,role,time', id1: 'a', k2: 'data,role,time' })
    })

    test('getChat shows the chatId of a message that has one and no key for one that has none', async () => {
        const chat = chatOf([msg('a', 'hello', 10, 'user'), { role: 'char', data: 'world' }])
        const seen = await scripted(chat, 'local c = getChat(id, 0) setChatVar(id, "k1", keys(c)) setChatVar(id, "id1", tostring(c.chatId)) setChatVar(id, "k2", keys(getChat(id, 1)))')
        expect(seen).toMatchObject({ k1: 'chatId,data,role,time', id1: 'a', k2: 'data,role,time' })
    })

    test('getRecentChats shows the chatId of a message that has one and no key for one that has none', async () => {
        const chat = chatOf([msg('a', 'hello', 10, 'user'), { role: 'char', data: 'world' }])
        const seen = await scripted(chat, 'local c = getRecentChats(id, 2) setChatVar(id, "k1", keys(c[1])) setChatVar(id, "id1", tostring(c[1].chatId)) setChatVar(id, "k2", keys(c[2]))')
        expect(seen).toMatchObject({ k1: 'chatId,data,role,time', id1: 'a', k2: 'data,role,time' })
    })
})

describe('Lua setFullChat matches payload entries by chatId', () => {
    test('an id-matched edit keeps every field and its continuations stay', async () => {
        const b = full()
        const chat = chatOf([msg('a', 'hello', 10, 'user'), b], [{ m: msg('x', 'other', 21), p: 'b', a: 1 }])
        const before = structuredClone(b)
        await scripted(chat, 'local c = getFullChat(id) c[2].data = "edited" setFullChat(id, c)')
        expect(chat.message[1]).toEqual({ ...before, data: 'edited' })
        expect(chat.alt?.[0].p).toBe('b')
    })

    test('removing the first message keeps every survivor whole', async () => {
        const b: Message = { ...msg('b', 'world', 20), disabled: true, saying: 'npc' }
        const c: Message = { ...msg('c', 'three', 30, 'user'), isComment: true }
        const chat = chatOf([msg('a', 'hello', 10, 'user'), b, c], [{ m: msg('x', 'other', 21), p: 'a', a: 1 }])
        const before = structuredClone([b, c])
        await scripted(chat, 'local c = getFullChat(id) table.remove(c, 1) setFullChat(id, c)')
        expect(chat.message).toEqual(before)
        expect(chat.alt?.[0].p).toBeNull()
    })

    test('an id-less entry is prepended and an id-matched entry changes role', async () => {
        const chat = chatOf([msg('id-1', 'one', 1, 'user'), { ...msg('id-2', 'two', 2), generationInfo: full().generationInfo }])
        const before = structuredClone(chat.message)
        await scripted(chat, 'local c = getFullChat(id) c[1].data = "edited" c[2].role = "user" c[2].time = 999 table.insert(c, 1, {role = "char", data = "prepended"}) setFullChat(id, c)')
        expect(chat.message).toEqual([
            { role: 'char', data: 'prepended' },
            { ...before[0], data: 'edited' },
            { ...before[1], role: 'user' },
        ])
    })

    test('guard: a duplicated chatId never gets two holders', async () => {
        const chat = chatOf([msg('a', 'hello', 10, 'user'), msg('b', 'world', 20)])
        await scripted(chat, 'local c = getFullChat(id) table.insert(c, {role = c[1].role, data = "copy", chatId = c[1].chatId}) setFullChat(id, c)')
        expect(chat.message[2]).toEqual({ role: 'user', data: 'copy' })
        const ids = chat.message.map((m) => m.chatId).filter(Boolean)
        expect(new Set(ids).size).toBe(ids.length)
    })

    test('an id-less copy before its original does not take the original identity', async () => {
        const a = msg('a', 'hello', 10, 'user')
        const chat = chatOf([a, msg('b', 'world', 20)])
        const before = structuredClone(chat.message)
        await scripted(chat, 'local c = getFullChat(id) table.insert(c, 1, {role = c[1].role, data = c[1].data}) setFullChat(id, c)')
        expect(chat.message[0]).toEqual({ role: 'user', data: 'hello' })
        expect(chat.message[1]).toEqual(before[0])
    })

    test('guard: an unknown id is never adopted, including an id that lives in the alternatives', async () => {
        const chat = chatOf([msg('a', 'hello', 10, 'user')], [{ m: msg('x', 'other', 21), p: null, a: 1 }])
        await setFullChat(chat, '{ {role="char", data="other", chatId="x"} }')
        expect(chat.message[0].chatId).toBeUndefined()
        const ids = [...chat.message.map((m) => m.chatId), ...(chat.alt ?? []).map((r) => r.m.chatId)].filter(Boolean)
        expect(new Set(ids).size).toBe(ids.length)
    })

    test('guard: an unknown id with the same index, role and data is judged like an id-less entry', async () => {
        const a = msg('a', 'hello', 10, 'user')
        const chat = chatOf([a])
        const before = structuredClone(a)
        await setFullChat(chat, '{ {role="user", data="hello", chatId="zzz"} }')
        expect(chat.message[0]).toEqual(before)
    })

    test('a reorder keeps the messages whole and their continuations', async () => {
        const chat = chatOf(
            [msg('a', 'one', 1, 'user'), { ...msg('b', 'two', 2), disabled: true }, { ...msg('c', 'three', 3, 'user'), isComment: true }],
            [{ m: msg('x', 'other', 4), p: 'b', a: 1 }],
        )
        const before = structuredClone(chat.message)
        await scripted(chat, 'local c = getFullChat(id) c[2], c[3] = c[3], c[2] setFullChat(id, c)')
        expect(chat.message).toEqual([before[0], before[2], before[1]])
        expect(chat.alt?.[0].p).toBe('b')
    })
})
