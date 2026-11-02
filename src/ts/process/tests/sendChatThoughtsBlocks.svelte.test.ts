// @vitest-environment node

/**
 * A stored character message that holds several `<Thoughts>` blocks keeps the text between them when
 * `sendChat` assembles the prompt: every block is lifted into the message's `thoughts`, and nothing outside
 * the blocks is removed with them. The stored text is the one the Gemini streaming tool loop produces
 * (`GEMINI_TOOL_LOOP_TEXT`, asserted equal to the real producer's output in geminiToolLoopThoughts.svelte.test.ts).
 *
 * Drives the REAL `sendChat` (`../index.svelte`) with the real `processScriptFull`, `../scriptings` (wasmoon),
 * `../modules`, `../lorebook.svelte`, `../../parser/parser.svelte` and `../chatOrigin`. Only the provider
 * request, the memory systems, the trigger engine and the platform/IO packages are mocked, so nothing here
 * says anything about a native backend. `@vitest-environment node` and the inert `dompurify` are for
 * wasmoon's sake, as in `sendChatPromptEdges.svelte.test.ts`.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Writable } from 'svelte/store'
import { get } from 'svelte/store'
import type { character, Chat, Message, Database } from '../../storage/database.svelte'
import type { SendChatArg } from '../index.svelte'
import '../../polyfill'
import { GEMINI_TOOL_LOOP_TEXT } from './fixtures/geminiToolLoopThoughts'

//#region module mocks

const h = vi.hoisted(() => ({
    request: vi.fn(),
}))

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

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn(async () => null),
}))

vi.mock('@tauri-apps/api/path', () => ({
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })),
}))

vi.mock('src/lib/UI/PopupList.svelte', () => ({
    default: class {},
}))

vi.mock('dompurify', () => ({
    default: { addHook: vi.fn(), sanitize: (html: string) => html },
}))

vi.mock(import('../../platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('../../platform'))

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        CharEmotion: writable({}),
        selectedCharID: writable(-1),
        selIdState: { selId: 0 },
        CurrentTriggerIdStore: writable(null),
        ReloadChatPointer: writable({}),
        ReloadGUIPointer: writable(0),
        HideIconStore: writable(false),
        moduleBackgroundEmbedding: writable(''),
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../../alert'), () => ({
    alertError: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true),
    alertClear: vi.fn(),
    alertModuleSelect: vi.fn(async () => -1),
    alertStore: writable({ type: '', msg: '' }),
    alertWait: vi.fn(),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../globalApi.svelte'), () => ({
    fetchNative: vi.fn(),
    readImage: vi.fn(async () => undefined),
    aiWatermarkingLawApplies: vi.fn(() => false),
    getFileSrc: vi.fn(async () => ''),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
    AppendableBuffer: class {},
    LocalWriter: class {},
    VirtualWriter: class {},
    downloadFile: vi.fn(),
    saveAsset: vi.fn(async () => ''),
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../tokenizer'), () => ({
    ChatTokenizer: class {
        extra: number
        constructor(extra: number, _mode: string) { this.extra = extra }
        async tokenizeChat(chat: { content: string, multimodals?: unknown[] }) {
            return Math.ceil(chat.content.length / 4) + this.extra + (chat.multimodals?.length ?? 0) * 50
        }
    },
    tokenize: vi.fn(async (s: string) => (s?.length ?? 0)),
    tokenizeNum: vi.fn(async () => [] as number[]),
}) as unknown as typeof import('../../tokenizer'))

vi.mock(import('../../characters'), () => ({
    createBlankChar: vi.fn(() => ({ name: '', chaId: '' })),
    getCharImage: vi.fn(),
}) as unknown as typeof import('../../characters'))

vi.mock(import('../command'), () => ({
    processMultiCommand: vi.fn(async () => {}),
}) as unknown as typeof import('../command'))

vi.mock(import('../files/inlays'), () => ({
    getInlayAsset: vi.fn(),
    getInlayAssetBlob: vi.fn(async () => undefined),
    writeInlayImage: vi.fn(async () => 'inlay-id'),
}) as unknown as typeof import('../files/inlays'))

vi.mock(import('../memory/hypamemory'), () => ({
    HypaProcesser: class {
        async addText() {}
        async similaritySearch() { return [] }
    },
}) as unknown as typeof import('../memory/hypamemory'))

vi.mock(import('../request/request'), () => ({
    requestChatData: h.request,
}) as unknown as typeof import('../request/request'))

vi.mock(import('../stableDiff'), () => ({
    stableDiff: vi.fn(),
    generateAIImage: vi.fn(async () => null),
}) as unknown as typeof import('../stableDiff'))

vi.mock(import('../../model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({
        id: 'placeholder', name: 'Placeholder Model', shortName: 'Placeholder',
        internalID: 'placeholder', format: 0, provider: 0, tokenizer: 0, flags: [],
    })),
    LLMFlags: { hasImageInput: 0 },
}) as unknown as typeof import('../../model/modellist'))

vi.mock(import('../../plugins/plugins.svelte'), () => ({
    pluginV2: {
        editdisplay: new Set(),
        editoutput: new Set(),
        editprocess: new Set(),
        editinput: new Set(),
        chatOutput: new Set(),
        providerOptions: new Map(),
    },
}) as unknown as typeof import('../../plugins/plugins.svelte'))

vi.mock(import('../../media'), () => ({
    compressImage: vi.fn(async (v: unknown) => v),
}) as unknown as typeof import('../../media'))

vi.mock(import('../../rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(async () => new Uint8Array()),
    encodeRPack: vi.fn(async () => new Uint8Array()),
}) as unknown as typeof import('../../rpack/rpack_js'))

vi.mock(import('../../interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('../../interchangeability'))

vi.mock(import('../../characterCards'), () => ({
    exportCharacterCard: vi.fn(),
    importCharacterProcess: vi.fn(),
}) as unknown as typeof import('../../characterCards'))

vi.mock(import('../../storage/database.svelte'), async () => {
    const stores = await import('../../stores.svelte')
    const state = stores.DBState as unknown as { db: { characters?: Array<{ chatPage: number, chats?: unknown[] }> } }
    const getCurrentCharacter = () => state.db.characters?.[get(stores.selectedCharID)]
    const getCurrentChat = () => {
        const current = getCurrentCharacter()
        return current?.chats?.[current.chatPage]
    }
    return {
        appVer: '0.0.0',
        presetTemplate: {},
        changeToPreset: vi.fn(),
        setCurrentChat: vi.fn(),
        setDatabase: vi.fn(),
        getDatabase: vi.fn(() => state.db),
        getCurrentCharacter: vi.fn(getCurrentCharacter),
        getCurrentChat: vi.fn(getCurrentChat),
    } as unknown as typeof import('../../storage/database.svelte')
})

vi.mock(import('../exampleMessages'), () => ({
    exampleMessage: vi.fn(() => []),
}) as unknown as typeof import('../exampleMessages'))

vi.mock(import('../tts'), () => ({
    sayTTS: vi.fn(),
}) as unknown as typeof import('../tts'))

vi.mock(import('../memory/supaMemory'), () => ({
    supaMemory: vi.fn(),
}) as unknown as typeof import('../memory/supaMemory'))

vi.mock(import('../memory/hanuraiMemory'), () => ({
    hanuraiMemory: vi.fn(),
}) as unknown as typeof import('../memory/hanuraiMemory'))

vi.mock(import('../memory/hypav2'), () => ({
    hypaMemoryV2: vi.fn(),
}) as unknown as typeof import('../memory/hypav2'))

vi.mock(import('../memory/hypav3'), () => ({
    hypaMemoryV3: vi.fn(),
}) as unknown as typeof import('../memory/hypav3'))

vi.mock(import('../group'), () => ({
    groupOrder: vi.fn((order: unknown) => order),
}) as unknown as typeof import('../group'))

vi.mock(import('../triggers'), () => ({
    runTrigger: vi.fn(async () => undefined),
}) as unknown as typeof import('../triggers'))

vi.mock(import('../embedding/addinfo'), () => ({
    additionalInformations: vi.fn(async () => ''),
}) as unknown as typeof import('../embedding/addinfo'))

vi.mock(import('../models/modelString'), () => ({
    getGenerationModelString: vi.fn(() => undefined),
}) as unknown as typeof import('../models/modelString'))

vi.mock(import('../inlayScreen'), () => ({
    runInlayScreen: vi.fn((_char: unknown, text: string) => ({ text, promise: undefined })),
}) as unknown as typeof import('../inlayScreen'))

vi.mock(import('../prereroll'), () => ({
    addRerolls: vi.fn(),
}) as unknown as typeof import('../prereroll'))

vi.mock(import('../transformers'), () => ({
    runImageEmbedding: vi.fn(),
}) as unknown as typeof import('../transformers'))

// Real: `../../parser/chatML` is not mocked here, so the stored text is split by the code under test only
// where `sendChat` itself splits it.

//#endregion
//#region fixtures and helpers

type Selection = Writable<number>

let sendChat: typeof import('../index.svelte').sendChat
let doingChat: typeof import('../index.svelte').doingChat
let beginWork: typeof import('../chatOrigin').beginWork
let resetScriptCache: typeof import('../scripts').resetScriptCache
let refreshModules: typeof import('../modules').refreshModules
let DBState: { db: Database }
let selectedCharID: Selection
let runTriggerMock: ReturnType<typeof vi.fn>

beforeAll(async () => {
    const jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))

    const index = await import('../index.svelte')
    sendChat = index.sendChat
    doingChat = index.doingChat
    beginWork = (await import('../chatOrigin')).beginWork
    resetScriptCache = (await import('../scripts')).resetScriptCache
    refreshModules = (await import('../modules')).refreshModules
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: Database }
    selectedCharID = stores.selectedCharID as unknown as Selection
    runTriggerMock = (await import('../triggers')).runTrigger as unknown as ReturnType<typeof vi.fn>
})

beforeEach(() => {
    h.request.mockReset()
    h.request.mockResolvedValue({ type: 'success', result: 'unexpected' })
    runTriggerMock.mockReset()
    runTriggerMock.mockImplementation(async () => undefined)
    doingChat.set(false)
    resetScriptCache()
    refreshModules()
})

afterEach(() => {
    selectedCharID.set(-1)
})

const defaultOrder = ['main', 'description', 'personaPrompt', 'chats', 'lastChat', 'jailbreak', 'lorebook', 'globalNote', 'authorNote']

function installDb(characters: character[], extra: Record<string, unknown> = {}): void {
    DBState.db = {
        formatversion: 5, botPresets: [], modules: [], loadouts: [], plugins: [], pluginCustomStorage: {},
        personas: [], selectedPersona: 0, characterOrder: characters.map((c) => c.chaId), characters,
        statics: { messages: 0 }, aiModel: 'custom', maxContext: 999999, maxResponse: 500,
        bias: [], mainPrompt: '', globalNote: '', jailbreakToggle: false, chainOfThought: false,
        personaPrompt: false, promptPreprocess: false, additionalPrompt: '', descriptionPrefix: '',
        promptTemplate: undefined, promptInfoInsideChat: false,
        formatingOrder: defaultOrder,
        autoContinueMinTokens: 0, autoContinueChat: false, igpPrompt: '', notification: false,
        removeIncompleteResponse: false, streamingDisplayOptimizationMode: 'off', ttsAutoSpeech: false,
        presetChain: '', outputImageModal: false, rememberToolUsage: false, supaModelType: 'none',
        hypav2: false, hypaV3: false, hanuraiEnable: false, inlayErrorResponse: false,
        loreBookDepth: 20, loreBookToken: 999999, templateDefaultVariables: '', globalChatVariables: {},
        enabledModules: [], ...extra,
    } as unknown as Database
}

function msg(role: 'user' | 'char', data: string): Message {
    return { role, data, time: 1 } as Message
}

function makeChat(message: Message[]): Chat {
    return {
        id: 'chat-A', note: '', name: '', localLore: [], fmIndex: -1, message,
        scriptstate: {}, GLGlobalVariables: {}, modules: [],
    } as unknown as Chat
}

function makeChar(chat: Chat): character {
    return {
        chaId: 'char-A', name: 'Alice', type: 'character', chatPage: 0, firstMessage: 'Hello!', alternateGreetings: [],
        desc: 'Alice desc', personality: '', scenario: '', bias: [], utilityBot: false,
        inlayViewScreen: false, reloadKeys: 0, supaMemory: false, customscript: [], triggerscript: [],
        emotionImages: [], additionalAssets: [], modules: [], chats: [chat],
    } as unknown as character
}

type Formated = { role: string, content: string, thoughts?: string[] }

/** One real `sendChat` over a chat whose one stored character message is `stored`; returns the prompt sent. */
async function sentPrompt(stored: string, extra: Record<string, unknown> = {}): Promise<Formated[]> {
    const chat = makeChat([msg('user', 'U1'), msg('char', stored), msg('user', 'U2')])
    const owner = makeChar(chat)
    installDb([owner], extra)
    selectedCharID.set(0)

    const handle = beginWork(owner, chat)!
    h.request.mockResolvedValueOnce({ type: 'success', result: 'reply' })
    let result: boolean | Error
    try {
        const arg: Partial<SendChatArg> = { origin: handle.origin, originHint: { owner, chat } }
        result = await sendChat(-1, arg)
    } catch (error) {
        result = error instanceof Error ? error : new Error(String(error))
    } finally {
        handle.end()
    }
    if (result instanceof Error) {
        throw result
    }
    const body = h.request.mock.calls.at(-1)?.[0] as { formated?: Formated[] } | undefined
    return body?.formated ?? []
}

/** The one assistant message of the prompt that is not the character's first message: the stored character message. */
function assistantOf(prompt: Formated[]): Formated {
    const found = prompt.filter((entry) => entry.role === 'assistant' && entry.content.trim() !== 'Hello!')
    expect(found, 'the stored character message is the one assistant message').toHaveLength(1)
    return found[0]
}

//#endregion

describe('a stored message with several <Thoughts> blocks', () => {
    test('reproducer: the text and the tool call between two blocks stay in the sent content, and both blocks become thoughts', async () => {
        const prompt = await sentPrompt(GEMINI_TOOL_LOOP_TEXT)
        const assistant = assistantOf(prompt)

        expect(assistant.content).toContain('MIDDLE')
        expect(assistant.content).toContain('END')
        expect(assistant.content).toContain('<tool_call>')
        expect(assistant.content).not.toContain('<Thoughts>')
        expect(assistant.thoughts).toHaveLength(2)
        expect(assistant.thoughts![0]).toContain('THOUGHT-ONE')
        expect(assistant.thoughts![1]).toContain('THOUGHT-TWO')
    })

    test('guard (passes before and after): a single block is lifted out and the text after it stays', async () => {
        const prompt = await sentPrompt('<Thoughts>\n\nONLY\n\n</Thoughts>\n\nANSWER')
        const assistant = assistantOf(prompt)

        expect(assistant.content.trim()).toBe('ANSWER')
        expect(assistant.thoughts).toHaveLength(1)
        expect(assistant.thoughts![0]).toContain('ONLY')
    })

    test('guard (passes before and after): a block outside maxThoughtTagDepth is dropped from the content and not kept as a thought', async () => {
        const prompt = await sentPrompt('<Thoughts>\n\nONLY\n\n</Thoughts>\n\nANSWER', { promptSettings: { maxThoughtTagDepth: 100 } })
        const assistant = assistantOf(prompt)

        expect(assistant.content.trim()).toBe('ANSWER')
        expect(assistant.thoughts).toHaveLength(0)
    })

    test('reproducer: with maxThoughtTagDepth set, the text between two blocks stays and neither block is kept', async () => {
        const prompt = await sentPrompt(GEMINI_TOOL_LOOP_TEXT, { promptSettings: { maxThoughtTagDepth: 100 } })
        const assistant = assistantOf(prompt)

        expect(assistant.content).toContain('MIDDLE')
        expect(assistant.content).not.toContain('<Thoughts>')
        expect(assistant.thoughts).toHaveLength(0)
    })
})
