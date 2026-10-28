// @vitest-environment node

/**
 * Where `sendChat` places `@@reverse_depth N` lore entries in the prompt it
 * sends (CHORE-472 stage 2, MC-766 to MC-768).
 *
 * - `@@reverse_depth N` has exactly N chat-list entries after it, with and
 *   without a prompt template. An N beyond the list puts the entry at the top.
 *   `@@reverse_depth 0` goes after the last message.
 * - Every entry's slot is computed against the chat list as it was before any
 *   depth insertion, so entries inserted earlier never shift later ones.
 * - In a send that mixes `@@depth` and `@@reverse_depth`, `@@depth N` sits at
 *   index N whatever the processing order.
 * - `reproducer:` tests fail on the code before the placement change.
 *   `guard (passes before and after):` tests pin what must stay as it was.
 *
 * Every case asserts the exact ordered content of the messages the provider
 * receives. Roles are never `system`, because prompt assembly merges
 * consecutive system entries. In the sequences, `S` is the
 * `[Start a new chat]` separator, `H` the first message, `M1`..`Mn` the chat
 * messages (the last one is `Mn`), `HE` a trigger `historyend` prompt, and
 * every other label is a lore entry's content.
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
        statics: { messages: 0 }, aiModel: 'gpt-3.5-turbo', maxContext: 999999, maxResponse: 500,
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

function makeChar(chat: Chat, extra: Record<string, unknown>): character {
    return {
        chaId: 'char-A', name: 'Alice', type: 'character', chatPage: 0, firstMessage: 'Hello!', alternateGreetings: [],
        desc: 'Alice desc', personality: '', scenario: '', bias: [], utilityBot: false,
        inlayViewScreen: false, reloadKeys: 0, supaMemory: false, customscript: [], triggerscript: [],
        emotionImages: [], additionalAssets: [], modules: [], chats: [chat], ...extra,
    } as unknown as character
}

interface Placed {
    pos: 'depth' | 'reverse_depth'
    n: number
    tag: string
}

/** An always-active lore entry whose content is `tag` and whose placement is the decorator `@@<pos> <n>`. */
function loreEntry(placed: Placed): Record<string, unknown> {
    return {
        comment: placed.tag, content: `@@${placed.pos} ${placed.n}\n@@role assistant\n${placed.tag}`,
        mode: 'normal', insertorder: 100, alwaysActive: true, key: '', secondkey: '', selective: false,
    }
}

/** `@@reverse_depth n`, labelled `tag` in the sequence. */
function rev(n: number, tag = 'R'): Placed {
    return { pos: 'reverse_depth', n, tag }
}

/** `@@depth n`, labelled `tag` in the sequence. */
function dep(n: number, tag = 'D'): Placed {
    return { pos: 'depth', n, tag }
}

interface Scenario {
    /** Chat messages M1..Mn; the default is 5. */
    messages?: number
    /** A prompt template holding only a `chat` card (no `lastChat` split). */
    template?: boolean
    /** The format order in effect. */
    order?: string[]
    /** The last message is whitespace only. */
    blankLast?: boolean
    /** A trigger `start` result carrying a `historyend` prompt, labelled `HE`. */
    historyEnd?: boolean
}

/**
 * One real `sendChat`. The entries are listed in processing order, which is
 * the order the lorebook hands them to the depth placement.
 */
async function sentSequence(entries: Placed[], scenario: Scenario = {}): Promise<string[]> {
    const count = scenario.messages ?? 5
    const messages = Array.from({ length: count }, (_, i) => msg(i % 2 === 0 ? 'user' : 'char', `M${i + 1}`))
    if (scenario.blankLast) {
        messages[count - 1] = msg(count % 2 === 1 ? 'user' : 'char', ' ')
    }
    // The lorebook processes the last listed entry first.
    const globalLore = [...entries].reverse().map(loreEntry)
    const chat = makeChat(messages)
    const owner = makeChar(chat, { globalLore })
    const extra: Record<string, unknown> = {}
    if (scenario.template) {
        extra.promptTemplate = [{ type: 'chat', rangeStart: 0, rangeEnd: 'end' }]
        extra.promptSettings = {}
    }
    if (scenario.order) {
        extra.formatingOrder = scenario.order
    }
    installDb([owner], extra)
    selectedCharID.set(0)
    if (scenario.historyEnd) {
        runTriggerMock.mockImplementation(async (_char: unknown, mode: string) => mode === 'start'
            ? { tokens: 0, stopSending: false, additonalSysPrompt: { historyend: 'HE' } }
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

/** `seq('S H M1 R')` is `['S', 'H', 'M1', 'R']`. */
function seq(labels: string): string[] {
    return labels.split(' ')
}

//#endregion

describe('@@reverse_depth placement, no prompt template', () => {
    test('reproducer: rev 1 and rev 2 each have exactly N entries after them (Q6)', async () => {
        expect(await sentSequence([rev(1)])).toEqual(seq('S H M1 M2 M3 M4 R M5'))
        expect(await sentSequence([rev(2)])).toEqual(seq('S H M1 M2 M3 R M4 M5'))
    })

    test('reproducer: rev 0 goes after the last message (Q10)', async () => {
        expect(await sentSequence([rev(0)])).toEqual(seq('S H M1 M2 M3 M4 M5 R'))
    })

    test('reproducer: rev 0 with a trigger historyend gives last, rev 0, historyend (Q10)', async () => {
        expect(await sentSequence([rev(0)], { historyEnd: true })).toEqual(seq('S H M1 M2 M3 M4 M5 R HE'))
    })

    test('reproducer: N = L-1 sits one entry from the top, N = L and N = L+1 at the top (Q8)', async () => {
        expect(await sentSequence([rev(6)])).toEqual(seq('S R H M1 M2 M3 M4 M5'))
        expect(await sentSequence([rev(7)])).toEqual(seq('R S H M1 M2 M3 M4 M5'))
        expect(await sentSequence([rev(8)])).toEqual(seq('R S H M1 M2 M3 M4 M5'))
        expect(await sentSequence([rev(9)])).toEqual(seq('R S H M1 M2 M3 M4 M5'))
    })

    test('reproducer: rev 1, rev 2, rev 1 in one send each keep their N (Q9)', async () => {
        expect(await sentSequence([rev(1, 'A'), rev(2, 'B'), rev(1, 'C')]))
            .toEqual(seq('S H M1 M2 M3 B M4 A C M5'))
    })

    test('reproducer: two rev 2 entries share one slot in processing order, M4 and M5 after them (Q9)', async () => {
        expect(await sentSequence([rev(2, 'A'), rev(2, 'B')])).toEqual(seq('S H M1 M2 M3 A B M4 M5'))
    })

    test('reproducer: lastChat before chats, rev 0 directly follows the last message inside the lastChat block (Q10)', async () => {
        const order = ['main', 'description', 'personaPrompt', 'lastChat', 'chats', 'jailbreak', 'lorebook', 'globalNote', 'authorNote']
        expect(await sentSequence([rev(0)], { order })).toEqual(seq('M5 R S H M1 M2 M3 M4'))
    })

    test('guard (passes before and after): a blank last message is dropped, so rev 1 has exactly 1 sent entry after it', async () => {
        expect(await sentSequence([rev(1)], { blankLast: true })).toEqual(seq('S H M1 M2 M3 R M4'))
    })

    test('guard (passes before and after): without lastChat in the order, rev 0, 1 and 2 keep their place', async () => {
        const order = defaultOrder.filter((block) => block !== 'lastChat')
        expect(await sentSequence([rev(0)], { order })).toEqual(seq('S H M1 M2 M3 M4 R'))
        expect(await sentSequence([rev(1)], { order })).toEqual(seq('S H M1 M2 M3 R M4'))
        expect(await sentSequence([rev(2)], { order })).toEqual(seq('S H M1 M2 R M3 M4'))
    })

    test('guard (passes before and after): a negative rev stays before the last message', async () => {
        expect(await sentSequence([rev(-2)])).toEqual(seq('S H M1 M2 M3 M4 R M5'))
    })
})

describe('@@reverse_depth placement, with a prompt template', () => {
    const template = { template: true }

    test('reproducer: N = L+1, and N far beyond L, sit at the top (Q8)', async () => {
        expect(await sentSequence([rev(8)], template)).toEqual(seq('R S H M1 M2 M3 M4 M5'))
        expect(await sentSequence([rev(9)], template)).toEqual(seq('R S H M1 M2 M3 M4 M5'))
        expect(await sentSequence([rev(12)], template)).toEqual(seq('R S H M1 M2 M3 M4 M5'))
    })

    test('reproducer: rev 1, rev 2, rev 1 in one send each keep their N (Q9)', async () => {
        expect(await sentSequence([rev(1, 'A'), rev(2, 'B'), rev(1, 'C')], template))
            .toEqual(seq('S H M1 M2 M3 B M4 A C M5'))
    })

    test('guard (passes before and after): rev 1, 2 and 5 below the list length are unchanged', async () => {
        expect(await sentSequence([rev(1)], template)).toEqual(seq('S H M1 M2 M3 M4 R M5'))
        expect(await sentSequence([rev(2)], template)).toEqual(seq('S H M1 M2 M3 R M4 M5'))
        expect(await sentSequence([rev(5)], template)).toEqual(seq('S H R M1 M2 M3 M4 M5'))
    })

    test('guard (passes before and after): rev 0 is the end', async () => {
        expect(await sentSequence([rev(0)], template)).toEqual(seq('S H M1 M2 M3 M4 M5 R'))
    })

    test('guard (passes before and after): N = L is the top and N = L-1 is index 1', async () => {
        expect(await sentSequence([rev(7)], template)).toEqual(seq('R S H M1 M2 M3 M4 M5'))
        expect(await sentSequence([rev(6)], template)).toEqual(seq('S R H M1 M2 M3 M4 M5'))
    })

    test('guard (passes before and after): a negative rev stays at the end', async () => {
        expect(await sentSequence([rev(-2)], template)).toEqual(seq('S H M1 M2 M3 M4 M5 R'))
    })

    test('guard (passes before and after): two rev 2 entries keep their relative order', async () => {
        expect(await sentSequence([rev(2, 'A'), rev(2, 'B')], template)).toEqual(seq('S H M1 M2 M3 A B M4 M5'))
    })
})

describe('@@depth is unchanged when no @@reverse_depth entry is present', () => {
    test('guard (passes before and after): depth 2 alone, with and without a template', async () => {
        expect(await sentSequence([dep(2)])).toEqual(seq('S H D M1 M2 M3 M4 M5'))
        expect(await sentSequence([dep(2)], { template: true })).toEqual(seq('S H D M1 M2 M3 M4 M5'))
    })

    test('guard (passes before and after): two depth entries splice one after the other, with and without a template', async () => {
        expect(await sentSequence([dep(1, 'D'), dep(3, 'E')])).toEqual(seq('S D H E M1 M2 M3 M4 M5'))
        expect(await sentSequence([dep(1, 'D'), dep(3, 'E')], { template: true })).toEqual(seq('S D H E M1 M2 M3 M4 M5'))
    })

    test('guard (passes before and after): depth 0 stays after everything', async () => {
        expect(await sentSequence([dep(0)])).toEqual(seq('S H M1 M2 M3 M4 M5 D'))
    })
})

describe('a send that mixes @@depth and @@reverse_depth', () => {
    test('guard (passes before and after): template, depth 2 and rev 2 with the rev entry processed first', async () => {
        expect(await sentSequence([rev(2), dep(2)], { template: true })).toEqual(seq('S H D M1 M2 M3 R M4 M5'))
    })

    test('guard (passes before and after): template, depth 1 and rev 2 with the depth entry first, 5 messages', async () => {
        expect(await sentSequence([dep(1), rev(2)], { template: true })).toEqual(seq('S D H M1 M2 M3 R M4 M5'))
    })

    test('reproducer: no template, depth 3 and rev 4 keep the depth entry at index 3', async () => {
        expect(await sentSequence([dep(3), rev(4)])).toEqual(seq('S H M1 D R M2 M3 M4 M5'))
    })

    test('reproducer: no template, depth 3 and rev 6 keep the depth entry at index 3', async () => {
        expect(await sentSequence([dep(3), rev(6)])).toEqual(seq('S R H D M1 M2 M3 M4 M5'))
    })

    test('reproducer: no template, depth 2 and rev 6 keep the depth entry at index 2', async () => {
        expect(await sentSequence([dep(2), rev(6)])).toEqual(seq('S R D H M1 M2 M3 M4 M5'))
    })

    test('reproducer: template, depth 2 and rev 6 keep the depth entry at index 2', async () => {
        expect(await sentSequence([dep(2), rev(6)], { template: true })).toEqual(seq('S R D H M1 M2 M3 M4 M5'))
    })

    test('reproducer: template, depth 3 and rev 6 keep the depth entry at index 3', async () => {
        expect(await sentSequence([dep(3), rev(6)], { template: true })).toEqual(seq('S R H D M1 M2 M3 M4 M5'))
    })

    test('reproducer: one message, no template, depth 1 and rev 2 with exactly 2 entries after the rev entry', async () => {
        expect(await sentSequence([dep(1), rev(2)], { messages: 1 })).toEqual(seq('S D R H M1'))
    })

    test('reproducer: 5 messages, no template, depth 1 and rev 2 with exactly 2 entries after the rev entry', async () => {
        expect(await sentSequence([dep(1), rev(2)])).toEqual(seq('S D H M1 M2 M3 R M4 M5'))
    })

    test('reproducer: the processing order of a depth and a rev entry does not change the result', async () => {
        const noTemplate = seq('S R H D M1 M2 M3 M4 M5')
        expect(await sentSequence([dep(3), rev(6)])).toEqual(noTemplate)
        expect(await sentSequence([rev(6), dep(3)])).toEqual(noTemplate)
        const withTemplate = seq('S R D H M1 M2 M3 M4 M5')
        expect(await sentSequence([dep(2), rev(6)], { template: true })).toEqual(withTemplate)
        expect(await sentSequence([rev(6), dep(2)], { template: true })).toEqual(withTemplate)
    })
})
