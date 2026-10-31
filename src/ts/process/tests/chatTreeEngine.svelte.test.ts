/**
 * The tree engine behind the reply arrows, Branch and reroll: `stepSibling`,
 * `branchAt`, `reroll`/`unReroll`, the candidates a generation stores as
 * siblings, and the Continue repoint. Drives the REAL composer actions, the
 * REAL `sendChat` (request mocked, module mocks copied from
 * `sendChatInterrupted.svelte.test.ts`), the real work registry and the real
 * `chatTree` operations against a real `$state` database.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, Chat, Message } from 'src/ts/storage/database.svelte'
// Installs the real `globalThis.safeStructuredClone`, the same way `src/main.ts` does.
import 'src/ts/polyfill'

//#region module mocks

const requestChatDataMock = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())
const runTriggerMock = vi.hoisted(() => vi.fn())
const processScriptFullMock = vi.hoisted(() => vi.fn())
const supaMemoryMock = vi.hoisted(() => vi.fn())

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

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

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
        changeToPreset: vi.fn(),
        setCurrentChat: vi.fn(),
        getDatabase: vi.fn(() => state.db),
        getCurrentCharacter: vi.fn(getCurrentCharacter),
        getCurrentChat: vi.fn(getCurrentChat),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        CharEmotion: writable({}),
        selectedCharID: writable(-1),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/tokenizer'), () => ({
    ChatTokenizer: class {
        constructor(_extra: number, _mode: string) {}
        async tokenizeChat(_chat: unknown) { return 1 }
    },
    tokenize: vi.fn(async () => 1),
    tokenizeNum: vi.fn(async () => [] as number[]),
}) as unknown as typeof import('src/ts/tokenizer'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: alertErrorMock,
    alertToast: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('src/ts/parser/chatML'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/util'), async () => {
    const stores = await import('src/ts/stores.svelte')
    const state = stores.DBState as unknown as { db: { characters: Array<{ chaId?: string, type?: string }> } }
    return {
        findCharacterbyId: (id: string) => {
            for (const candidate of state.db.characters) {
                if (candidate.type !== 'group' && candidate.chaId === id) {
                    return candidate
                }
            }
            return { name: 'Unknown Character', chaId: globalThis.crypto.randomUUID(), type: 'character', bias: [], desc: '', chats: [], utilityBot: false, inlayViewScreen: false, additionalAssets: [], emotionImages: [], reloadKeys: 0 }
        },
        getAuthorNoteDefaultText: vi.fn(() => ''),
        getPersonaPrompt: vi.fn(() => ''),
        getUserName: vi.fn(() => 'User'),
        isLastCharPunctuation: vi.fn(() => true),
        trimUntilPunctuation: vi.fn((s: string) => s),
        parseToggleSyntax: vi.fn(() => []),
        prebuiltAssetCommand: vi.fn(() => ''),
        sleep: vi.fn(async () => {}),
    } as unknown as typeof import('src/ts/util')
})

vi.mock(import('src/ts/process/request/request'), () => ({
    requestChatData: requestChatDataMock,
}) as unknown as typeof import('src/ts/process/request/request'))

vi.mock(import('src/ts/process/stableDiff'), () => ({
    stableDiff: vi.fn(),
}) as unknown as typeof import('src/ts/process/stableDiff'))

vi.mock(import('src/ts/process/scripts'), () => ({
    processScript: vi.fn(async (_char: unknown, text: string) => text),
    processScriptFull: processScriptFullMock,
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/process/exampleMessages'), () => ({
    exampleMessage: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/exampleMessages'))

vi.mock(import('src/ts/process/tts'), () => ({
    sayTTS: vi.fn(),
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/process/memory/supaMemory'), () => ({
    supaMemory: supaMemoryMock,
}) as unknown as typeof import('src/ts/process/memory/supaMemory'))

vi.mock(import('src/ts/process/group'), () => ({
    groupOrder: vi.fn((order: unknown) => order),
}) as unknown as typeof import('src/ts/process/group'))

vi.mock(import('src/ts/process/triggers'), () => ({
    runTrigger: runTriggerMock,
}) as unknown as typeof import('src/ts/process/triggers'))

vi.mock(import('src/ts/process/memory/hypamemory'), () => ({
    HypaProcesser: class {},
}) as unknown as typeof import('src/ts/process/memory/hypamemory'))

vi.mock(import('src/ts/process/embedding/addinfo'), () => ({
    additionalInformations: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/process/embedding/addinfo'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/models/modelString'), () => ({
    getGenerationModelString: vi.fn(() => undefined),
}) as unknown as typeof import('src/ts/process/models/modelString'))

vi.mock(import('src/ts/process/inlayScreen'), () => ({
    runInlayScreen: vi.fn((_char: unknown, text: string) => ({ text, promise: undefined })),
}) as unknown as typeof import('src/ts/process/inlayScreen'))

vi.mock(import('src/ts/process/transformers'), () => ({
    runImageEmbedding: vi.fn(),
}) as unknown as typeof import('src/ts/process/transformers'))

vi.mock(import('src/ts/process/memory/hanuraiMemory'), () => ({
    hanuraiMemory: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/hanuraiMemory'))

vi.mock(import('src/ts/process/memory/hypav2'), () => ({
    hypaMemoryV2: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/hypav2'))

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    hypaMemoryV3: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/process/scriptings'), () => ({
    runLuaEditTrigger: vi.fn(async (_char: unknown, _type: string, formated: unknown) => formated),
}) as unknown as typeof import('src/ts/process/scriptings'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ flags: [] })),
    LLMFlags: {},
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/process/modules'), () => ({
    getModuleAssets: vi.fn(() => []),
    getModuleToggles: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    readImage: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    pluginV2: { chatOutput: new Set() },
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/process/sendCharacterMessage'), () => ({
    sendCharacterMessage: vi.fn(),
}) as unknown as typeof import('src/ts/process/sendCharacterMessage'))

vi.mock(import('src/ts/process/command'), () => ({
    processMultiCommand: vi.fn(async () => false),
}) as unknown as typeof import('src/ts/process/command'))

vi.mock(import('src/ts/translator/translator'), () => ({
    isExpTranslator: vi.fn(() => false),
    translate: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/translator/translator'))

//#endregion

import { sendChat, doingChat } from 'src/ts/process/index.svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import {
    reroll, unReroll, stepSibling, branchAt, abortChat, resetComposerActionsForTests, type ComposerActionsSource,
} from 'src/ts/process/composerActions.svelte'
import { setComposerWindow } from 'src/ts/process/generationOwnership.svelte'
import { detachTail, siblingsAt, switchTo } from 'src/ts/process/chatTree'
import { treeView } from 'src/ts/process/chatTreeView'
import { keepLiveAlt } from 'src/ts/plugins/chatAltBridge'

//#region fixtures

type CharacterFixture = Database['characters'][number]

function msg(role: 'user' | 'char', data: string, extra: Record<string, unknown> = {}): Message {
    return { role, data, time: 1, ...extra } as unknown as Message
}

/** A message with an id and a time, as a send leaves it. */
function node(role: 'user' | 'char', id: string, time: number, extra: Record<string, unknown> = {}): Message {
    return msg(role, id, { chatId: id, time, saying: role === 'char' ? 'char-0' : undefined, ...extra })
}

function makeChat(id: string, message: Message[], extra: Record<string, unknown> = {}): Chat {
    return { id, note: '', name: '', localLore: [], fmIndex: -1, message, ...extra } as unknown as Chat
}

function makeCharacter(chaId: string, chats: Chat[], extra: Record<string, unknown> = {}): CharacterFixture {
    return {
        chaId, name: chaId, type: 'character', chatPage: 0, firstMessage: 'Hello!', alternateGreetings: [],
        desc: `${chaId} description`, bias: [], replaceGlobalNote: undefined, systemPrompt: undefined,
        utilityBot: false, inlayViewScreen: false, viewScreen: undefined, depth_prompt: undefined,
        reloadKeys: 0, supaMemory: false, chats, ...extra,
    } as unknown as CharacterFixture
}

function installDb(characters: CharacterFixture[]): void {
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], loadouts: [], plugins: [],
        pluginCustomStorage: {}, characterOrder: characters.map((c) => c.chaId), characters,
        statics: { messages: 0 }, aiModel: 'gpt-3.5-turbo', maxContext: 999999, maxResponse: 500, bias: [],
        mainPrompt: '', globalNote: '', jailbreakToggle: false, chainOfThought: false, personaPrompt: false,
        promptPreprocess: false, additionalPrompt: '', descriptionPrefix: '',
        formatingOrder: ['main', 'description', 'personaPrompt', 'chats', 'lastChat', 'jailbreak', 'lorebook', 'globalNote', 'authorNote'],
        promptTemplate: undefined, promptInfoInsideChat: false, autoContinueMinTokens: 0, autoContinueChat: false,
        igpPrompt: '', notification: false, removeIncompleteResponse: false, streamingDisplayOptimizationMode: 'off',
        ttsAutoSpeech: false, presetChain: '', outputImageModal: false, rememberToolUsage: false, supaModelType: 'none',
        hypav2: false, hypaV3: false, hanuraiEnable: false, inlayErrorResponse: false, playMessage: false,
    } as unknown as Database
}

/** One character with one chat holding `messages`, selected; returns the live chat. */
function install(messages: Message[], chatExtra: Record<string, unknown> = {}): Chat {
    installDb([makeCharacter('char-0', [makeChat('chat-0', messages, chatExtra)])])
    selectedCharID.set(0)
    return DBState.db.characters[0].chats[0]
}

/** [u0, c0] plus the extra messages given: the usual shape of a chat with a reply to reroll. */
function simpleChat(chatExtra: Record<string, unknown> = {}): Chat {
    return install([node('user', 'u0', 1), node('char', 'c0', 2)], chatExtra)
}

function pathIds(chat: Chat): Array<string | undefined> {
    return chat.message.map((m) => m.chatId)
}

function altData(chat: Chat): string[] {
    return (chat.alt ?? []).map((record) => record.m.data)
}

function copyOf<T>(value: T): T {
    return JSON.parse(JSON.stringify(value))
}

function mockReply(text: string): void {
    requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: text })
}

function mockMultiline(...texts: string[]): void {
    requestChatDataMock.mockResolvedValueOnce({ type: 'multiline', result: texts.map((text) => ['char', text]) })
}

async function settle(): Promise<void> {
    await new Promise<void>((res) => setTimeout(res, 0))
}

async function until(condition: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
        if (condition()) {
            return
        }
        await settle()
    }
    throw new Error(`timed out waiting for: ${what}`)
}

interface HeldStream {
    push(text: string): void
    close(): void
}

/** A streaming request the test feeds by hand; resolves once the request was made. */
function holdNextRequest(): HeldStream {
    let controller: ReadableStreamDefaultController<{ data: string }> | undefined
    const stream = new ReadableStream<{ data: string }>({ start(c) { controller = c } })
    requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: stream })
    return {
        push(text) { try { controller?.enqueue({ data: text }) } catch { /* cancelled */ } },
        close() { try { controller?.close() } catch { /* cancelled */ } },
    }
}

const closeMenu = vi.fn()
const source: ComposerActionsSource = { closeMenu }

beforeEach(() => {
    requestChatDataMock.mockReset()
    requestChatDataMock.mockResolvedValue({ type: 'success', result: 'unexpected request.' })
    alertErrorMock.mockReset()
    runTriggerMock.mockReset()
    runTriggerMock.mockResolvedValue(undefined)
    processScriptFullMock.mockReset()
    processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => ({ data: text, emoChanged: false }))
    supaMemoryMock.mockReset()
    closeMenu.mockReset()
    resetComposerActionsForTests()
    doingChat.set(false)
})

afterEach(() => {
    setComposerWindow(false)
    selectedCharID.set(-1)
})

//#endregion

describe('reroll persists the replaced reply as a sibling', () => {
    test('TB1: a completed reroll keeps the old reply in alt, following the user message', async () => {
        const chat = simpleChat()
        mockReply('New reply')

        await reroll(source)

        expect(chat.message.map((m) => m.data)).toEqual(['u0', 'New reply'])
        expect(chat.alt).toHaveLength(1)
        expect(chat.alt![0].m.data).toBe('c0')
        expect(chat.alt![0].p).toBe('u0')
    })

    test('TB2: a failed reroll keeps the old reply; the path ends at the user message', async () => {
        const chat = simpleChat()
        requestChatDataMock.mockResolvedValueOnce({ type: 'fail', result: 'boom' })

        await reroll(source)

        expect(pathIds(chat)).toEqual(['u0'])
        expect(altData(chat)).toEqual(['c0'])
        expect(treeView(chat).continuation).toBe(1)
    })

    test('TB2: an aborted reroll keeps the old reply', async () => {
        const chat = simpleChat()
        const held = holdNextRequest()
        const running = reroll(source)
        await until(() => requestChatDataMock.mock.calls.length > 0, 'the request')
        held.push('Par')
        await settle()

        abortChat()
        held.close()
        await running

        expect(altData(chat)).toEqual(['c0'])
    })

    test('TB3: the old reply survives rerolls in six other chats, and un-reroll brings it back', async () => {
        const chats = Array.from({ length: 7 }, (_, n) => makeChat(`chat-${n}`, [node('user', `u${n}`, 1), node('char', `c${n}`, 2)]))
        installDb([makeCharacter('char-0', chats)])
        selectedCharID.set(0)
        const live = DBState.db.characters[0]
        for (let n = 0; n < 7; n++) {
            live.chatPage = n
            mockReply(`New reply ${n}`)
            await reroll(source)
        }
        live.chatPage = 0
        expect(live.chats[0].message.map((m) => m.data)).toEqual(['u0', 'New reply 0'])

        await unReroll(source)

        expect(live.chats[0].message.map((m) => m.data)).toEqual(['u0', 'c0'])
    })

    test('TB4/TB27: ← to the earlier sibling, → back with no request, → at the last sibling generates', async () => {
        const chat = simpleChat()
        mockReply('New reply')
        await reroll(source)
        expect(requestChatDataMock).toHaveBeenCalledTimes(1)

        await unReroll(source)
        expect(chat.message.map((m) => m.data)).toEqual(['u0', 'c0'])
        await reroll(source)
        expect(chat.message.map((m) => m.data)).toEqual(['u0', 'New reply'])
        expect(requestChatDataMock).toHaveBeenCalledTimes(1)

        mockReply('Third reply')
        await reroll(source)
        expect(requestChatDataMock).toHaveBeenCalledTimes(2)
        expect(chat.message.map((m) => m.data)).toEqual(['u0', 'Third reply'])
        expect(altData(chat).sort()).toEqual(['New reply', 'c0'].sort())
    })
})

describe('rows other than the last', () => {
    /** [m0..m7] where position 5 holds two siblings, the last of them on the path. */
    function twoSiblingsAtFive(): Chat {
        const chat = install(Array.from({ length: 8 }, (_, i) => node(i % 2 === 0 ? 'user' : 'char', `m${i}`, i + 1)))
        detachTail(chat, 5)
        chat.message.push(node('char', 'x5', 0.5), node('user', 'x6', 0.6), node('char', 'x7', 0.7))
        switchTo(chat, 5, 'm5')
        return chat
    }

    test('TB5: → on a non-last row at the last sibling changes nothing and sends no request', async () => {
        const chat = twoSiblingsAtFive()
        expect(pathIds(chat)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'])
        const before = copyOf(chat)

        await stepSibling(source, 5, 'm5', 'forward')

        expect(copyOf(chat)).toEqual(before)
        expect(requestChatDataMock).not.toHaveBeenCalled()
    })

    test('TB6: ← then → on a middle row restores the path and the records', async () => {
        const chat = twoSiblingsAtFive()
        const before = copyOf(chat)

        await stepSibling(source, 5, 'm5', 'back')
        expect(pathIds(chat).slice(5)).toEqual(['x5', 'x6', 'x7'])
        await stepSibling(source, 5, 'x5', 'forward')

        expect(pathIds(chat)).toEqual(before.message.map((m) => m.chatId))
        expect(copyOf(chat.alt!.map((r) => ({ id: r.m.chatId, p: r.p })).sort((a, b) => String(a.id).localeCompare(String(b.id)))))
            .toEqual(before.alt!.map((r) => ({ id: r.m.chatId, p: r.p })).sort((a, b) => String(a.id).localeCompare(String(b.id))))
    })

    test('TB9: the entries have mutated when the call returns, before anything is awaited', () => {
        const chat = twoSiblingsAtFive()
        const stepped = stepSibling(source, 5, 'm5', 'back')
        expect(pathIds(chat)[5]).toBe('x5')
        const branched = branchAt(source, 1, 'm1')
        expect(pathIds(chat)).toEqual(['m0', 'm1'])
        return Promise.all([stepped, branched])
    })

    test('TB21: a row whose expected id no longer sits at its index is refused with no change', async () => {
        const chat = twoSiblingsAtFive()
        const before = copyOf(chat)

        await stepSibling(source, 5, 'x5', 'back')
        await branchAt(source, 2, 'not-m2')

        expect(copyOf(chat)).toEqual(before)
    })

    test('TB21b: a row mounted without an id only gives the ids; nothing else changes and the next press acts', async () => {
        const chat = install([msg('user', 'q'), msg('char', 'a'), msg('user', 'q2'), msg('char', 'a2')])
        const before = copyOf(chat)

        await branchAt(source, 1, undefined)

        expect(chat.message.map((m) => m.data)).toEqual(before.message.map((m) => m.data))
        expect(chat.alt).toBeUndefined()
        expect(chat.message.every((m) => typeof m.chatId === 'string' && m.chatId.length > 0)).toBe(true)

        await branchAt(source, 1, chat.message[1].chatId)
        expect(chat.message.map((m) => m.data)).toEqual(['q', 'a'])
        expect(altData(chat)).toEqual(['q2', 'a2'])
    })

    test('TB22: an unreadable alt refuses every entry with the notice and no request', async () => {
        for (const bad of ['broken', { not: 'a list' }]) {
            const chat = simpleChat()
            ;(chat as unknown as { alt: unknown }).alt = bad
            const before = copyOf(chat)
            alertErrorMock.mockClear()

            await stepSibling(source, 1, 'c0', 'back')
            await branchAt(source, 0, 'u0')
            await reroll(source)
            await unReroll(source)

            expect(copyOf(chat)).toEqual(before)
            expect(alertErrorMock).toHaveBeenCalledTimes(4)
            expect(alertErrorMock).toHaveBeenCalledWith(language.errors.chatAltUnreadable)
            expect(requestChatDataMock).not.toHaveBeenCalled()
        }
    })
})

describe('branchAt', () => {
    test('Branch keeps one chat, ends the path at the message and keeps the old tail as children', async () => {
        const chat = install([node('user', 'u0', 1), node('char', 'c0', 2), node('user', 'u1', 3), node('char', 'c1', 4)])

        await branchAt(source, 1, 'c0')

        expect(DBState.db.characters[0].chats).toHaveLength(1)
        expect(pathIds(chat)).toEqual(['u0', 'c0'])
        expect(treeView(chat).continuation).toBe(1)
        expect(siblingsAt(chat, 2).map((m) => m.chatId)).toEqual(['u1'])
    })

    test('Branch is refused on the last message', async () => {
        const chat = simpleChat()
        const before = copyOf(chat)

        await branchAt(source, 1, 'c0')

        expect(copyOf(chat)).toEqual(before)
    })

    test('end control: arrives at the most recently left continuation and restores all six live fields', async () => {
        const chat = install([
            node('user', 'm0', 1), node('char', 'm1', 2), node('user', 'm2', 3), node('char', 'm3', 4),
        ], { lastMemory: 'm0', scriptstate: { mark: 'first' }, supaMemoryData: 'm2\nFIRST-SUMMARY-TEXT', supaMemoryCoveredId: 'm0' })
        await branchAt(source, 1, 'm1')
        chat.message.push(node('user', 'n2', 10))
        chat.scriptstate = { mark: 'second' }
        chat.lastMemory = 'm1'

        await stepSibling(source, 2, 'n2', 'back')
        expect(pathIds(chat)).toEqual(['m0', 'm1', 'm2', 'm3'])
        chat.scriptstate = { mark: 'third' }
        await branchAt(source, 1, 'm1')
        expect(treeView(chat).continuation).toBe(2)

        await stepSibling(source, 2, 'm1', 'back')

        expect(pathIds(chat)).toEqual(['m0', 'm1', 'm2', 'm3'])
        expect(chat.scriptstate).toEqual({ mark: 'third' })
        expect(chat.supaMemoryData).toBe('m2\nFIRST-SUMMARY-TEXT')
        expect(chat.supaMemoryCoveredId).toBe('m0')
    })
})

describe('the gate', () => {
    test('TB7: while a generation holds doingChat, every entry changes nothing', async () => {
        const chat = simpleChat()
        mockReply('New reply')
        await reroll(source)
        const held = holdNextRequest()
        const running = sendChat(-1)
        await until(() => requestChatDataMock.mock.calls.length > 1, 'the request')
        const before = copyOf(chat)
        const characters = DBState.db.characters.length
        const calls = requestChatDataMock.mock.calls.length

        await branchAt(source, 0, 'u0')
        await stepSibling(source, 1, chat.message[1].chatId, 'back')
        await stepSibling(source, 1, chat.message[1].chatId, 'forward')
        await reroll(source)
        await unReroll(source)

        expect(copyOf(chat.alt)).toEqual(before.alt)
        expect(chat.message).toHaveLength(before.message.length)
        expect(DBState.db.characters).toHaveLength(characters)
        expect(requestChatDataMock.mock.calls.length).toBe(calls)
        held.push('x')
        held.close()
        await running
    })

    test('TB8: while another composer action holds the window, every entry changes nothing', async () => {
        const chat = simpleChat()
        mockReply('New reply')
        await reroll(source)
        const before = copyOf(chat)
        setComposerWindow(true)

        await branchAt(source, 0, 'u0')
        await stepSibling(source, 1, chat.message[1].chatId, 'back')
        await reroll(source)
        await unReroll(source)

        expect(copyOf(chat)).toEqual(before)
        expect(requestChatDataMock).toHaveBeenCalledTimes(1)
    })

    test('TB15: a reroll whose selection moved to another chat writes its records to its own chat only', async () => {
        const first = makeChat('chat-0', [node('user', 'u0', 1), node('char', 'c0', 2)])
        const second = makeChat('chat-1', [node('user', 'v0', 1), node('char', 'd0', 2)])
        installDb([makeCharacter('char-0', [first, second])])
        selectedCharID.set(0)
        const live = DBState.db.characters[0]
        const otherBefore = copyOf(live.chats[1])
        let release: () => void = () => {}
        const gate = new Promise<void>((res) => { release = res })
        requestChatDataMock.mockImplementationOnce(async () => {
            await gate
            return { type: 'multiline', result: [['char', 'Moved on'], ['char', 'Candidate']] }
        })

        const running = reroll(source)
        await until(() => requestChatDataMock.mock.calls.length > 0, 'the request')
        live.chatPage = 1
        release()
        await running

        expect(copyOf(live.chats[1])).toEqual(otherBefore)
        expect(altData(live.chats[0]).sort()).toEqual(['Candidate', 'c0'])
    })

    test('TB13: the piece from rerollBase departs as one chain headed at its first message', async () => {
        const chat = install([
            node('user', 'u0', 1),
            node('char', 'A', 2, { saying: 'speaker-a' }),
            node('char', 'B', 3, { saying: 'speaker-b' }),
        ])
        mockReply('A again')

        await reroll(source)

        expect(chat.message.map((m) => m.data)).toEqual(['u0', 'A again'])
        const byId = new Map(chat.alt!.map((record) => [record.m.chatId, record]))
        expect(byId.get('A')?.p).toBe('u0')
        expect(byId.get('B')?.p).toBe('A')
        expect(byId.get('A')?.a).toBe(byId.get('B')?.a)
    })
})

describe('candidates of one generation', () => {
    test('TB14: a multiline answer stores its other lines as sibling records that restore the start state', async () => {
        const chat = simpleChat({ scriptstate: { start: 1 }, lastMemory: 'u0' })
        mockMultiline('first', 'second', 'third')

        await reroll(source)
        chat.scriptstate = { start: 1, written: 2 }

        const candidates = chat.alt!.filter((record) => record.m.data === 'second' || record.m.data === 'third')
        expect(candidates).toHaveLength(2)
        const shown = chat.message[1]
        expect(shown.data).toBe('first')
        const stamps = new Set(candidates.map((record) => record.a))
        expect(stamps.size).toBe(1)
        expect(candidates.map((r) => r.m.data)).toEqual(['second', 'third'])
        expect(candidates.every((r) => r.p === 'u0')).toBe(true)
        expect(candidates[0].m.time).toBeGreaterThan(shown.time ?? 0)
        expect(candidates[1].m.time).toBeGreaterThan(candidates[0].m.time ?? 0)
        for (const record of candidates) {
            expect(Object.keys(record.mem ?? {}).sort()).toEqual(['hypaV2Data', 'hypaV3Data', 'lastMemory', 'scriptstate', 'supaMemoryCoveredId', 'supaMemoryData'])
            expect(record.mem?.scriptstate).toEqual({ start: 1 })
            expect(record.mem?.lastMemory).toBe(chat.lastMemory)
            expect(record.mem?.supaMemoryData).toBeNull()
        }

        const calls = requestChatDataMock.mock.calls.length
        await reroll(source)
        expect(chat.message[1].data).toBe('second')
        expect(chat.scriptstate).toEqual({ start: 1 })
        await reroll(source)
        expect(chat.message[1].data).toBe('third')
        expect(requestChatDataMock.mock.calls.length).toBe(calls)

        mockReply('Fourth')
        await reroll(source)
        expect(requestChatDataMock.mock.calls.length).toBe(calls + 1)
    })
})

describe('Continue repoints what named the continued message', () => {
    test('TB23: after a non-streaming Continue the children and the parked pair follow the new id', async () => {
        const chat = install([
            node('user', 'u0', 1), node('char', 'c0', 2), node('user', 'u1', 3), node('char', 'c1', 4),
        ], { supaMemoryData: 'c0\nLONG-SUMMARY-TEXT', supaMemoryCoveredId: null })
        await branchAt(source, 1, 'c0')
        expect(siblingsAt(chat, 2).map((m) => m.chatId)).toEqual(['u1'])
        mockReply(' and more')

        await sendChat(-1, { continue: true })

        const newId = chat.message[1].chatId
        expect(newId).not.toBe('c0')
        expect(chat.message[1].data).toContain('and more')
        expect(siblingsAt(chat, 2).map((m) => m.chatId)).toEqual(['u1'])
        expect(chat.alt!.find((record) => record.m.chatId === 'u1')?.p).toBe(newId)
        expect(chat.alt![0].mem?.supaMemoryData).toBe(`${newId}\nLONG-SUMMARY-TEXT`)

        await stepSibling(source, 2, newId, 'back')
        expect(pathIds(chat)).toEqual(['u0', newId, 'u1', 'c1'])
    })
})

describe('ids for messages a send left without one', () => {
    test('TB28: reroll and Branch on a chat of id-less messages store records that resolve', async () => {
        const chat = install([msg('user', 'q'), msg('char', 'a', { saying: 'char-0' }), msg('user', 'q2'), msg('char', 'a2', { saying: 'char-0' })])

        mockReply('fresh')
        await reroll(source)

        expect(chat.message.map((m) => m.data)).toEqual(['q', 'a', 'q2', 'fresh'])
        expect(chat.alt).toHaveLength(1)
        expect(typeof chat.alt![0].m.chatId).toBe('string')
        expect(typeof chat.alt![0].p).toBe('string')
        expect(chat.message.every((m) => typeof m.chatId === 'string')).toBe(true)

        await branchAt(source, 1, chat.message[1].chatId)
        expect(chat.alt!.every((record) => typeof record.m.chatId === 'string' && (record.p === null || typeof record.p === 'string'))).toBe(true)
        expect(treeView(chat).continuation).toBe(1)
        await stepSibling(source, 2, chat.message[1].chatId, 'back')
        expect(chat.message.map((m) => m.data)).toEqual(['q', 'a', 'q2', 'fresh'])
    })

    test('TB28: detachTail and switchTo give the messages they cut or depart an id before the records form', () => {
        const cut = install([msg('user', 'q'), msg('char', 'a'), msg('user', 'q2')])
        detachTail(cut, 2)
        expect(cut.message.every((m) => typeof m.chatId === 'string')).toBe(true)
        expect(cut.alt![0].p).toBe(cut.message[1].chatId)

        const swapped = install([node('user', 'u0', 1), node('char', 'c0', 2)])
        detachTail(swapped, 1)
        swapped.message.push(msg('char', 'typed after the cut'))
        expect(switchTo(swapped, 1, 'c0')).toBe(true)
        const departed = swapped.alt!.find((record) => record.m.data === 'typed after the cut')
        expect(typeof departed?.m.chatId).toBe('string')
        expect(departed?.p).toBe('u0')
    })

    test('TB29: Branch on a chat without an id gives it one, so a whole-character write keeps the alternatives', async () => {
        const chat = install([node('user', 'u0', 1), node('char', 'c0', 2), node('user', 'u1', 3)])
        delete (chat as unknown as { id?: string }).id

        await branchAt(source, 1, 'c0')

        expect(typeof chat.id).toBe('string')
        expect(chat.alt).toHaveLength(1)
        const incoming = copyOf(DBState.db.characters)
        delete (incoming[0].chats[0] as unknown as { alt?: unknown }).alt
        keepLiveAlt(DBState.db.characters, incoming)
        expect(incoming[0].chats[0].alt).toHaveLength(1)
    })
})
