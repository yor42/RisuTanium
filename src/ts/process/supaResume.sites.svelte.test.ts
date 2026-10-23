// @vitest-environment node

/**
 * Plain SupaMemory's resume pointer across the trigger and scripting removal and clear sites, driven
 * through the REAL `runTrigger` (`./triggers.ts`: v1 `cutchat`, v2 `v2CutChat`) and real Lua
 * (`./scriptings.ts`: `cutChat`, `removeChat`, `setFullChat`), plus the reroll cut as a guard.
 * `DBState.db` is a plain object here (`@vitest-environment node` compiles `$state` for the server);
 * nothing asserted depends on reactivity. Network-facing modules, `./command` and `./modules` are fakes,
 * as in `triggerOriginWrites.svelte.test.ts`.
 *
 * Invariants pinned here: `Chat.supaMemoryData` is `<resume chatId>\n<summary>`. A removal that takes
 * the message the pointer names leaves it on a surviving message with the summary unchanged (MC-714:
 * the next one in chat order, hidden included; MC-715: nothing follows, so the last survivor plus a
 * covered-ID field naming it). A removal or `setFullChat` that leaves the chat with no messages clears
 * the data, plain or `hypa:`, and the covered-ID field (MC-721 1, MC-722 2). `setFullChat` with other
 * messages and a reroll cut are not repointed (MC-720 3): the pointer stays and the next send over
 * budget reports the error that names Reset.
 *
 * Test kinds: "guard:" rows pass before and after; every other row is a regression reproducer that
 * fails without the repoint or clear at its site.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { character, Chat, Database, Message } from '../storage/database.svelte'
import type { ChatTokenizer } from '../tokenizer'
import type { OpenAIChat } from './index.svelte'
import type { triggerscript, triggerEffect } from './triggers'

//#region module mocks

vi.mock(import('../parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    // Identity pass-through: none of this suite's fixtures rely on CBS
    // substitution, only on the literal effect fields, so the real (heavy)
    // CBS engine is not needed to exercise the writer.
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('../parser/parser.svelte'))

vi.mock(import('../stores.svelte'), () => {
    const state = $state({ db: {} as any })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        ReloadChatPointer: writable({} as Record<number, number>),
        ReloadGUIPointer: writable(0),
        CurrentTriggerIdStore: writable(null),
        HideIconStore: writable(false),
        moduleBackgroundEmbedding: writable(''),
    } as unknown as typeof import('../stores.svelte')
})

vi.mock(import('../alert'), () => ({
    alertError: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('../alert'))

vi.mock(import('../globalApi.svelte'), () => ({
    fetchNative: vi.fn(),
    readImage: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('../globalApi.svelte'))

vi.mock(import('../tokenizer'), () => ({
    tokenize: vi.fn(async (text: string) => Math.ceil(text.length / 4)),
}) as unknown as typeof import('../tokenizer'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

const processMultiCommandMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock(import('../util'), () => ({
    asBuffer: vi.fn(),
    getPersonaPrompt: vi.fn(() => ''),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    checkPersonaBinded: vi.fn(() => false),
    // Real-shaped: mirrors util.ts's own parseKeyValue exactly (a "key=value"
    // per-line parse), needed for runTrigger's defaultVariables handling.
    parseKeyValue: (template: string) => {
        if (!template) return []
        const kv: [string, string][] = []
        for (const line of template.split('\n')) {
            const [key, value] = line.split('=')
            if (key && value) kv.push([key, value])
        }
        return kv
    },
    // Real (not faked): a genuine setTimeout-based wait. Since a caller of an
    // async function runs synchronously up to its first await regardless of
    // that await's duration, a concurrent mutation performed by test code
    // immediately after starting (not yet awaiting) `runTrigger()` always
    // lands truly "during" a `v2Wait`, even at 0ms.
    sleep: (ms: number) => new Promise((res) => setTimeout(res, ms)),
}) as unknown as typeof import('../util'))

vi.mock(import('./command'), () => ({
    processMultiCommand: processMultiCommandMock,
}) as unknown as typeof import('./command'))

vi.mock(import('./files/inlays'), () => ({
    getInlayAsset: vi.fn(),
    writeInlayImage: vi.fn(async () => 'inlay-id'),
}) as unknown as typeof import('./files/inlays'))

vi.mock(import('./lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
}) as unknown as typeof import('./lorebook.svelte'))

vi.mock(import('./memory/hypamemory'), () => ({
    HypaProcesser: class {
        async addText() {}
        async similaritySearch() { return [] }
    },
}) as unknown as typeof import('./memory/hypamemory'))

vi.mock(import('./request/request'), () => ({
    requestChatData: vi.fn(async () => ({ type: 'fail', result: 'not used' })),
}) as unknown as typeof import('./request/request'))

vi.mock(import('./stableDiff'), () => ({
    generateAIImage: vi.fn(async () => null),
}) as unknown as typeof import('./stableDiff'))

// Real-shaped re-implementations reading/writing through the SAME mocked
// `DBState`/`selectedCharID` above -- mirrors database.svelte.ts's own
// getCurrentCharacter/getCurrentChat/setCurrentCharacter/setCurrentChat
// exactly, which is what lets this suite drive the real selection-based
// accessors faithfully without loading the real (heavy) database.svelte.ts.
vi.mock(import('../storage/database.svelte'), async () => {
    const stores = await import('../stores.svelte')
    const DBState = stores.DBState as unknown as { db: any }
    const selectedCharID = stores.selectedCharID
    const getCurrentCharacter = () => {
        DBState.db.characters ??= []
        return DBState.db.characters[get(selectedCharID)]
    }
    const getCurrentChat = () => {
        const char = getCurrentCharacter()
        return char?.chats?.[char.chatPage]
    }
    return {
        presetTemplate: {},
        getDatabase: vi.fn(() => DBState.db),
        setDatabase: vi.fn((d: unknown) => { DBState.db = d }),
        getCurrentCharacter: vi.fn(getCurrentCharacter),
        getCurrentChat: vi.fn(getCurrentChat),
        setCurrentCharacter: vi.fn((char: unknown) => {
            DBState.db.characters ??= []
            DBState.db.characters[get(selectedCharID)] = char
        }),
        setCurrentChat: vi.fn((chat: unknown) => {
            const char = getCurrentCharacter()
            char.chats[char.chatPage] = chat
        }),
    } as unknown as typeof import('../storage/database.svelte')
})

// A lightweight stand-in, NOT a faithful mirror of modules.ts's own
// getModuleTriggers(): it reproduces the same stamp shape
// (`t.lowLevelAccess = module.lowLevelAccess; return t`), matching what
// `tests/modulesTriggerStamping.svelte.test.ts` checks against the REAL
// getModuleTriggers() (with its own characterCards/interchangeability/
// rpack_js/media import graph). This file has no test of its own for that
// stamping: runTrigger calls getModuleTriggers() on every run here, but none
// of this suite's fixtures ever populate a module trigger, so the stand-in
// always returns []. getModuleLorebooks is unused by this suite's fixtures
// (no module lorebook entries) and returns [] to match.
vi.mock(import('./modules'), async () => {
    const stores = await import('../stores.svelte')
    const DBState = stores.DBState as unknown as { db: any }
    return {
        getModuleLorebooks: vi.fn(() => []),
        getModuleTriggers: vi.fn(() => {
            const modules = DBState.db.modules ?? []
            let triggers: any[] = []
            for (const module of modules) {
                if (!module) continue
                if (module.trigger) {
                    triggers = triggers.concat(module.trigger.map((t: any) => {
                        t.lowLevelAccess = module.lowLevelAccess
                        return t
                    }))
                }
            }
            return triggers
        }),
    } as unknown as typeof import('./modules')
})

//#endregion

let runTrigger: typeof import('./triggers').runTrigger
let DBState: { db: any }
let selectedCharID: ReturnType<typeof writable<number>>
let beginWork: typeof import('./chatOrigin').beginWork
let supaMemory: typeof import('./memory/supaMemory').supaMemory
let beginRegeneration: typeof import('./rerollHistory').beginRegeneration

beforeAll(async () => {
    const jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))

    const triggers = await import('./triggers')
    runTrigger = triggers.runTrigger
    const stores = await import('../stores.svelte')
    DBState = stores.DBState as unknown as { db: any }
    selectedCharID = stores.selectedCharID as never
    const origin = await import('./chatOrigin')
    beginWork = origin.beginWork
    supaMemory = (await import('./memory/supaMemory')).supaMemory
    beginRegeneration = (await import('./rerollHistory')).beginRegeneration
})

//#region fixtures

function v2(type: string, fields: Record<string, unknown> = {}): triggerEffect {
    return { type, indent: 0, ...fields } as unknown as triggerEffect
}

function trig(comment: string, type: string, effect: unknown[]): triggerscript {
    return { comment, type, conditions: [], effect } as unknown as triggerscript
}

// Fixture helpers below build only the fields these tests actually read or
// write, then cast to the real domain type -- matching the established
// pattern in characters.saveMarks.svelte.test.ts and
// sendChatSaveMarks.svelte.test.ts, which do the same for the same reason
// (the real `character`/`Chat`/`Database` types carry many fields no test
// fixture needs to populate).
function makeChat(id: string, overrides: Record<string, unknown> = {}): Chat {
    return {
        id,
        message: [] as unknown[],
        scriptstate: {} as Record<string, unknown>,
        note: '',
        localLore: [] as unknown[],
        ...overrides,
    } as unknown as Chat
}

function makeCharacter(chaId: string, overrides: Record<string, unknown> = {}): character {
    return {
        chaId,
        name: chaId,
        type: 'character',
        chatPage: 0,
        chats: [makeChat(`${chaId}-chat-0`)],
        triggerscript: [] as unknown[],
        globalLore: [] as unknown[],
        desc: `${chaId}-original-desc`,
        replaceGlobalNote: '',
        firstMessage: 'hello',
        backgroundHTML: '',
        lowLevelAccess: false,
        ...overrides,
    } as unknown as character
}

function installDb(characters: character[] = [], extra: Record<string, unknown> = {}) {
    DBState.db = {
        characters,
        modules: [],
        botPresets: [],
        templateDefaultVariables: '',
        personas: [],
        selectedPersona: 0,
        ...extra,
    } as unknown as Database
    selectedCharID.set(0)
}

beforeEach(() => {
    processMultiCommandMock.mockClear()
})

//#endregion


//#region SupaMemory fixtures

const SUMMARY = 'old summary text'
const SUMMARY_LONG = 'S'.repeat(400)

interface MessageSpec {
    chatId?: string
    hidden?: boolean
}

type SupaChat = Chat & { supaMemoryCoveredId?: string }

/** One selected character whose chat holds the given messages (data = chatId) and SupaMemory data. */
function setup(supaMemoryData: string, specs: MessageSpec[] = ['m1', 'm2', 'm3', 'm4'].map((chatId) => ({ chatId }))): { char: character, chat: SupaChat } {
    const char = makeCharacter('char-supa')
    const chat = char.chats[0] as SupaChat
    chat.message = specs.map((spec, i) => ({
        role: 'user',
        data: spec.chatId ?? `unstamped${i}`,
        ...(spec.chatId ? { chatId: spec.chatId } : {}),
        ...(spec.hidden ? { disabled: true } : {}),
    })) as Message[]
    chat.supaMemoryData = supaMemoryData
    installDb([char], {
        removePunctuationHypa: false,
        maxSupaChunkSize: 1200,
        supaModelType: 'subModel',
        supaMemoryPrompt: '',
        supaMemoryKey: '',
        hypaModel: 'MiniLM',
    })
    return { char, chat }
}

async function runEffects(char: character, chat: Chat, effect: unknown[]): Promise<void> {
    char.triggerscript.push(trig('go', 'manual', effect))
    const handle = beginWork(char, chat)
    try {
        await runTrigger(char, 'manual', { chat, manualName: 'go', origin: handle!.origin } as never)
    } finally {
        handle!.end()
    }
}

const lua = (body: string) => [{ type: 'triggerlua', code: `function go(id)\n  ${body}\nend` }]
const cutchat = (start: string, end: string) => [{ type: 'cutchat', start, end }]
const v2Cut = (start: string, end: string) => [v2('v2CutChat', { start, startType: 'value', end, endType: 'value' })]

/** Each removal form keeps messages [start, end) of the chat. */
const keepForms: { name: string, keep: (start: number, end: number) => unknown[] }[] = [
    { name: 'trigger cutchat', keep: (s, e) => cutchat(String(s), String(e)) },
    { name: 'trigger v2CutChat', keep: (s, e) => v2Cut(String(s), String(e)) },
    { name: 'Lua cutChat', keep: (s, e) => lua(`cutChat(id, ${s}, ${e})`) },
]

const firstLine = (data: string | undefined) => data?.split('\n')[0]
const lengthTokenizer = { tokenizeChat: async (chat: OpenAIChat) => chat.content.length } as unknown as ChatTokenizer
const sent = (id: string, tokens: number): OpenAIChat => ({ role: 'user', content: id.repeat(tokens), memo: id })

//#endregion

describe.each(keepForms)('$name', ({ keep }) => {
    // regression reproducer (each row of this block unless named guard): fails without the repoint or clear at this site
    test('removing the pointer message with a survivor after it moves the pointer there and keeps the summary', async () => {
        const { char, chat } = setup(`m1\n${SUMMARY}`)
        await runEffects(char, chat, keep(1, 4))
        expect(chat.supaMemoryData).toBe(`m2\n${SUMMARY}`)
        expect(chat.supaMemoryCoveredId).toBeUndefined()
    })

    test('removing the last message (MC-715) writes the last survivor and the covered field', async () => {
        const { char, chat } = setup(`m4\n${SUMMARY}`)
        await runEffects(char, chat, keep(0, 3))
        expect(chat.supaMemoryData).toBe(`m3\n${SUMMARY}`)
        expect(chat.supaMemoryCoveredId).toBe('m3')
    })

    test('a hidden survivor after the removed pointer becomes the pointer', async () => {
        const { char, chat } = setup(`m1\n${SUMMARY}`, [{ chatId: 'm1' }, { chatId: 'm2', hidden: true }, { chatId: 'm3' }])
        await runEffects(char, chat, keep(1, 3))
        expect(chat.supaMemoryData).toBe(`m2\n${SUMMARY}`)
    })

    test('a survivor without a chatId is stamped and becomes the pointer', async () => {
        const { char, chat } = setup(`m1\n${SUMMARY}`, [{ chatId: 'm1' }, {}, { chatId: 'm3' }])
        await runEffects(char, chat, keep(1, 3))
        const stamped = chat.message[0].chatId
        expect(stamped).toEqual(expect.any(String))
        expect(chat.supaMemoryData).toBe(`${stamped}\n${SUMMARY}`)
    })

    test.each(['m2\nold summary text', 'hypa:m2\nold summary text'])('a cut that empties the chat clears %j and the covered field', async (data) => {
        const { char, chat } = setup(data)
        chat.supaMemoryCoveredId = 'm2'
        await runEffects(char, chat, keep(0, 0))
        expect(chat.message.length).toBe(0)
        expect(chat.supaMemoryData).toBe('')
        expect('supaMemoryCoveredId' in chat).toBe(false)
    })

    test('guard: a surviving pointer is untouched', async () => {
        const { char, chat } = setup(`m3\n${SUMMARY}`)
        chat.supaMemoryCoveredId = 'm3'
        await runEffects(char, chat, keep(1, 4))
        expect(chat.supaMemoryData).toBe(`m3\n${SUMMARY}`)
        expect(chat.supaMemoryCoveredId).toBe('m3')
    })

    test('guard: no SupaMemory data stays none', async () => {
        const { char, chat } = setup('')
        await runEffects(char, chat, keep(1, 4))
        expect(chat.supaMemoryData).toBe('')
        expect('supaMemoryCoveredId' in chat).toBe(false)
    })

    test('guard: hypa: data in a non-empty chat is not repointed', async () => {
        const { char, chat } = setup(`hypa:m1\n${SUMMARY}`)
        await runEffects(char, chat, keep(1, 4))
        expect(chat.supaMemoryData).toBe(`hypa:m1\n${SUMMARY}`)
    })
})

describe('Lua removeChat', () => {
    test('removing the pointer message with a survivor after it moves the pointer there', async () => {
        const { char, chat } = setup(`m1\n${SUMMARY}`)
        await runEffects(char, chat, lua('removeChat(id, 0)'))
        expect(chat.supaMemoryData).toBe(`m2\n${SUMMARY}`)
    })

    test('removing the last message writes the covered pair (MC-715)', async () => {
        const { char, chat } = setup(`m4\n${SUMMARY}`)
        await runEffects(char, chat, lua('removeChat(id, 3)'))
        expect(chat.supaMemoryData).toBe(`m3\n${SUMMARY}`)
        expect(chat.supaMemoryCoveredId).toBe('m3')
    })

    test.each(['m1\nold summary text', 'hypa:m1\nold summary text'])('removing the only message clears %j', async (data) => {
        const { char, chat } = setup(data, [{ chatId: 'm1' }])
        await runEffects(char, chat, lua('removeChat(id, 0)'))
        expect(chat.supaMemoryData).toBe('')
    })

    test('guard: removing another message leaves the pointer', async () => {
        const { char, chat } = setup(`m2\n${SUMMARY}`)
        await runEffects(char, chat, lua('removeChat(id, 3)'))
        expect(chat.supaMemoryData).toBe(`m2\n${SUMMARY}`)
    })

    test('guard: no SupaMemory data stays none', async () => {
        const { char, chat } = setup('')
        await runEffects(char, chat, lua('removeChat(id, 0)'))
        expect(chat.supaMemoryData).toBe('')
    })
})

describe('end-of-chat removal then the next send (MC-715, T4 end to end)', () => {
    test('trigger cutchat of the pointer message: the send reports no error and sends only the summary', async () => {
        const { char, chat } = setup(`m3\n${SUMMARY_LONG}`, [{ chatId: 'm1' }, { chatId: 'm2' }, { chatId: 'm3' }])
        await runEffects(char, chat, cutchat('0', '2'))
        expect(chat.supaMemoryCoveredId).toBe('m2')
        const result = await supaMemory([sent('m1', 60), sent('m2', 10)], 70, 60, chat, char, lengthTokenizer)
        expect(result.error).toBeUndefined()
        expect(result.chats.map((entry) => entry.memo)).toEqual(['supaMemory'])
        expect(firstLine(chat.supaMemoryData)).toBe('m2')
        expect(chat.supaMemoryCoveredId).toBe('m2')
    })
})

describe('setFullChat', () => {
    test.each(['m2\nold summary text', 'hypa:m2\nold summary text'])('an empty list clears %j and the covered field', async (data) => {
        const { char, chat } = setup(data)
        chat.supaMemoryCoveredId = 'm2'
        await runEffects(char, chat, lua('setFullChat(id, {})'))
        expect(chat.message.length).toBe(0)
        expect(chat.supaMemoryData).toBe('')
        expect('supaMemoryCoveredId' in chat).toBe(false)
    })

    // guard: passes before and after (MC-720 3, not repointed)
    test('guard: a list with other messages leaves the data and the next send over budget names Reset', async () => {
        const { char, chat } = setup(`m2\n${SUMMARY_LONG}`)
        await runEffects(char, chat, lua('setFullChat(id, {{role="user", data="a"}, {role="char", data="b"}})'))
        expect(chat.message.map((m) => m.data)).toEqual(['a', 'b'])
        expect(chat.supaMemoryData).toBe(`m2\n${SUMMARY_LONG}`)
        const result = await supaMemory([sent('z1', 60), sent('z2', 10)], 70, 60, chat, char, lengthTokenizer)
        expect(result.error).toContain('Reset SupaMemory data')
    })
})

describe('reroll', () => {
    // guard: passes before and after (reversible cut, MC-720 3)
    test('guard: the reroll cut keeps the pointer even when it cuts the pointer message', async () => {
        const { char, chat } = setup(`m2\n${SUMMARY}`, [{ chatId: 'm1' }, { chatId: 'm2' }])
        chat.message[1].role = 'char'
        const handle = beginWork(char, chat)
        try {
            expect(beginRegeneration(handle!.origin)).not.toBeNull()
        } finally {
            handle!.end()
        }
        expect(chat.message.map((m) => m.chatId)).toEqual(['m1'])
        expect(chat.supaMemoryData).toBe(`m2\n${SUMMARY}`)
    })
})
