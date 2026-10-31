// @vitest-environment node

/**
 * Where `sendChat` places trigger `start` and `historyend` text when a prompt
 * template is in use (CHORE-376, MC-767).
 *
 * - `start` text goes immediately before the output of the first `chat` card
 *   and `historyend` text immediately after the output of the last `chat`
 *   card, each exactly once, whether or not the card's range selects anything.
 * - A template without a `chat` card sends neither text. The non-template send
 *   keeps `start` directly before the last message and `historyend` after it.
 * - `reproducer:` tests fail on the code before the placement change.
 *   `guard (passes before and after):` tests pin what must stay as it was.
 *
 * Every case asserts the exact ordered content of the messages the provider
 * receives. In the sequences, `S` is the `[Start a new chat]` separator, `H`
 * the first message, `M1`..`Mn` the chat messages, `TS` the trigger `start`
 * text, `HE` the trigger `historyend` text, and every other label is a plain
 * template card's text. The model is one whose prompt assembly does not merge
 * consecutive system entries, so each system entry stays a separate message.
 *
 * Drives the REAL `sendChat` (`../index.svelte`) with the real
 * `processScriptFull` (`../scripts`), `../scriptings` (wasmoon), `../modules`,
 * `../lorebook.svelte`, `../../parser/parser.svelte` and `../chatOrigin`. Only
 * the provider request, the memory systems, the trigger engine and the
 * platform/IO packages are mocked, and the tokenizer is a deterministic
 * counting stand-in, so nothing here says anything about real encoding cost or
 * a native backend. `@vitest-environment node` and the inert `dompurify` are
 * for wasmoon's sake, as in `sendChatContextTrim.svelte.test.ts`.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { Writable } from 'svelte/store'
import type { character, Chat, Message, Database } from '../../storage/database.svelte'
import type { SendChatArg } from '../index.svelte'
// Installs the real `globalThis.safeStructuredClone`, the same way
// `src/main.ts` does (`import "./ts/polyfill"`): the setup file's stand-in
// throws on `undefined`, which the script pass clones.
import '../../polyfill'

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

// Inert passthrough: real DOMPurify needs `document`, real wasmoon needs it
// absent, and sanitization is not what this suite tests.
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

// Deterministic counting stand-in: a chat costs a quarter of its content
// length, rounded up, plus the per-chat extra the send passes in.
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

// The real plugin module reads `document` at load time.
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

// Real-shaped selection accessors over the same mocked `DBState` and
// `selectedCharID` the send reads.
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

// Collaborators of `sendChat` that touch the network, memory systems, media or
// the trigger engine.
vi.mock(import('../../parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('../../parser/chatML'))

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

// Real: `../../util`, `../scripts`, `../scriptings` (wasmoon), `../modules`,
// `../lorebook.svelte`, `../../parser/parser.svelte`, `../../cbs`,
// `../../parser/chatVar.svelte`, `../chatOrigin`, `../index.svelte`.

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
    // `getModules` remembers its last result by module ids alone.
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

function makeChar(chat: Chat, extra: Record<string, unknown> = {}): character {
    return {
        chaId: 'char-A', name: 'Alice', type: 'character', chatPage: 0, firstMessage: 'Hello!', alternateGreetings: [],
        desc: 'Alice desc', personality: '', scenario: '', bias: [], utilityBot: false,
        inlayViewScreen: false, reloadKeys: 0, supaMemory: false, customscript: [], triggerscript: [],
        emotionImages: [], additionalAssets: [], modules: [], chats: [chat], ...extra,
    } as unknown as character
}

/** A `chat` template card over the range `[rangeStart, rangeEnd)`. */
function chatCard(rangeStart: number, rangeEnd: number | 'end'): Record<string, unknown> {
    return { type: 'chat', rangeStart, rangeEnd }
}

/** A plain template card sending `text` as a user message. */
function plainCard(text: string): Record<string, unknown> {
    return { type: 'plain', type2: 'main', text, role: 'user' }
}

interface Scenario {
    /** The prompt template; omitted for a non-template send. */
    template?: Record<string, unknown>[]
    /** Trigger `start` result texts; omitted for no trigger text. */
    trigger?: { start?: string, historyend?: string }
}

/** One real `sendChat` over 5 messages M1..M5; returns the sent contents in order. */
async function sentSequence(scenario: Scenario): Promise<string[]> {
    const messages = Array.from({ length: 5 }, (_, i) => msg(i % 2 === 0 ? 'user' : 'char', `M${i + 1}`))
    const chat = makeChat(messages)
    const owner = makeChar(chat)
    const extra: Record<string, unknown> = {}
    if (scenario.template) {
        extra.promptTemplate = scenario.template
        extra.promptSettings = {}
    }
    installDb([owner], extra)
    selectedCharID.set(0)
    const trigger = scenario.trigger
    if (trigger) {
        runTriggerMock.mockImplementation(async (_char: unknown, mode: string) => mode === 'start'
            ? { tokens: 0, stopSending: false, additonalSysPrompt: { start: trigger.start, historyend: trigger.historyend } }
            : undefined)
    }

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
    const body = h.request.mock.calls.at(-1)?.[0] as { formated?: Array<{ content: string }> } | undefined
    return (body?.formated ?? [])
        .map((entry) => entry.content.trim())
        .filter((content) => content !== 'Alice desc')
        .map((content) => content.startsWith('[Start') ? 'S' : content === 'Hello!' ? 'H' : content)
}

/** `seq('S H M1 TS')` is `['S', 'H', 'M1', 'TS']`. */
function seq(labels: string): string[] {
    return labels.split(' ')
}

const bothTexts = { start: 'TS', historyend: 'HE' }

//#endregion

describe('trigger start and historyend text in a prompt-template send', () => {
    test('reproducer: one chat card gets TS before its output and HE after it, once each', async () => {
        const template = [plainCard('TOP'), chatCard(0, 'end'), plainCard('BOTTOM')]
        expect(await sentSequence({ template, trigger: bothTexts }))
            .toEqual(seq('TOP TS S H M1 M2 M3 M4 M5 HE BOTTOM'))
    })

    test('reproducer: split chat cards get TS only before the first and HE only after the last', async () => {
        const template = [chatCard(0, -2), plainCard('MID'), chatCard(-2, 'end')]
        expect(await sentSequence({ template, trigger: bothTexts }))
            .toEqual(seq('TS S H M1 M2 M3 MID M4 M5 HE'))
    })

    test('reproducer: an empty first chat range still puts TS before the cards that follow it', async () => {
        const template = [chatCard(2, 2), plainCard('MID'), chatCard(0, 'end')]
        expect(await sentSequence({ template, trigger: bothTexts }))
            .toEqual(seq('TS MID S H M1 M2 M3 M4 M5 HE'))
    })

    test('reproducer: an empty last chat range puts HE where its chats would be', async () => {
        const template = [chatCard(0, 'end'), plainCard('MID'), chatCard(3, 3)]
        expect(await sentSequence({ template, trigger: bothTexts }))
            .toEqual(seq('TS S H M1 M2 M3 M4 M5 MID HE'))
    })

    test('reproducer: start text alone and historyend text alone each go to their own chat card', async () => {
        const template = [plainCard('TOP'), chatCard(0, 'end'), plainCard('BOTTOM')]
        expect(await sentSequence({ template, trigger: { start: 'TS' } }))
            .toEqual(seq('TOP TS S H M1 M2 M3 M4 M5 BOTTOM'))
        expect(await sentSequence({ template, trigger: { historyend: 'HE' } }))
            .toEqual(seq('TOP S H M1 M2 M3 M4 M5 HE BOTTOM'))
    })

    test('guard (passes before and after): a template send without trigger text is unchanged', async () => {
        const template = [plainCard('TOP'), chatCard(0, 'end'), plainCard('BOTTOM')]
        expect(await sentSequence({ template }))
            .toEqual(seq('TOP S H M1 M2 M3 M4 M5 BOTTOM'))
    })

    test('guard (passes before and after): a template with no chat card sends neither text', async () => {
        const template = [plainCard('TOP'), plainCard('BOTTOM')]
        expect(await sentSequence({ template, trigger: bothTexts })).toEqual(seq('TOP BOTTOM'))
    })

    test('guard (passes before and after): without a template TS sits directly before the last message and HE after it', async () => {
        expect(await sentSequence({ trigger: bothTexts })).toEqual(seq('S H M1 M2 M3 M4 TS M5 HE'))
    })
})
