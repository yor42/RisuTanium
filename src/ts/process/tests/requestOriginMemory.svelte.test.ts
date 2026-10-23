// @vitest-environment node

/**
 * Every summarization or prompt-drafting request the memory systems and the stable-diffusion prompt
 * make carries the subject they were given: `hypaMemoryV2`'s summary, `hypaMemoryV3`'s summariser
 * (its exported `summarize` included) and `supaMemory`, and `stableDiff`'s prompt request.
 *
 * Drives the real `hypav2`, `hypav3`, `supaMemory`, `stableDiff`, `chatOrigin` and parser. Only the
 * provider request, the embedding processor, the tokenizer and the platform/IO packages are mocked;
 * `requestChatData` is a mock that records each request, so nothing here says anything about a
 * native backend.
 *
 * Tests whose title starts with `guard:` pass with or without the binding.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Writable } from 'svelte/store'
import type { character, Chat, Database, Message, RisuPersona } from '../../storage/database.svelte'
import type { OpenAIChat } from '../index.svelte'
import type { RunSubject } from '../chatOrigin'
import type { ChatTokenizer } from '../../tokenizer'
import '../../polyfill'

//#region module mocks

const h = vi.hoisted(() => ({
    bodies: [] as Array<Array<{ role: string, content: string }>>,
    requests: [] as Array<{ formated: Array<{ role: string, content: string }>, subject?: unknown }>,
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
        hypaV3ProgressStore: writable({}),
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../../alert'), () => ({
    alertError: vi.fn(),
    alertToast: vi.fn(),
    alertNormal: vi.fn(),
    alertStore: writable({}),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../request/request'), () => ({
    requestChatData: vi.fn(async (body: { formated: Array<{ role: string, content: string }>, subject?: unknown }) => {
        h.bodies.push(body.formated)
        h.requests.push(body)
        return { type: 'success', result: 'SUMMARY' }
    }),
}) as unknown as typeof import('../request/request'))

vi.mock(import('../memory/hypamemory'), () => ({
    // Embeds every text to the same one-dimensional vector, which is all the
    // similarity steps of hypaV2 and hypaV3 need to run to their end.
    HypaProcesser: class {
        vectors: Array<{ content: string, embedding: number[] }> = []
        model = 'test-embedding'
        oaikey = ''
        async addText(texts: string[]) {
            for (const content of texts) {
                this.vectors.push({ content, embedding: [1] })
            }
        }
        async getEmbeds(_query: string) { return [[1]] }
        async similaritySearch() { return [] }
        async similaritySearchScored() { return [] }
    },
    similarity: vi.fn(() => 1),
}) as unknown as typeof import('../memory/hypamemory'))

vi.mock(import('../../globalApi.svelte'), () => ({
    globalFetch: vi.fn(),
    fetchNative: vi.fn(),
    readImage: vi.fn(),
    getFileSrc: vi.fn(),
    forageStorage: {},
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../tokenizer'), () => ({
    tokenize: vi.fn(async (text: string) => text.length),
}) as unknown as typeof import('../../tokenizer'))

vi.mock(import('../transformers'), () => ({
    runSummarizer: vi.fn(),
    runEmbedding: vi.fn(),
}) as unknown as typeof import('../transformers'))

vi.mock(import('../webllm'), () => ({
    chatCompletion: vi.fn(),
    unloadEngine: vi.fn(),
}) as unknown as typeof import('../webllm'))

vi.mock(import('../../characterCards'), () => ({}) as unknown as typeof import('../../characterCards'))

vi.mock(import('../../model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ flags: [] })),
    LLMFlags: {},
}) as unknown as typeof import('../../model/modellist'))

vi.mock(import('../../plugins/plugins.svelte'), () => ({
    pluginV2: {},
}) as unknown as typeof import('../../plugins/plugins.svelte'))

vi.mock(import('../../storage/database.svelte'), async () => {
    const stores = await import('../../stores.svelte')
    const state = stores.DBState as unknown as { db: { characters?: Array<{ chatPage: number, chats?: unknown[] }> } }
    const selected = () => state.db.characters?.[currentSelection()]
    return {
        appVer: '0',
        getDatabase: vi.fn(() => state.db),
        getCurrentCharacter: vi.fn(selected),
        getCurrentChat: vi.fn(() => selected()?.chats?.[selected()!.chatPage]),
    } as unknown as typeof import('../../storage/database.svelte')

    function currentSelection(): number {
        let value = -1
        stores.selectedCharID.subscribe((v) => { value = v })()
        return value
    }
})

// Real: `../memory/hypav2`, `../memory/hypav3`, `../../util`, `../chatOrigin`,
// `../../parser/chatML`, `../../parser/parser.svelte`, `../../cbs`.

//#endregion

//#region fixtures and helpers

type Selection = Writable<number>

let DBState: { db: Database }
let selectedCharID: Selection
let beginWork: typeof import('../chatOrigin').beginWork
let createSendSubject: typeof import('../chatOrigin').createSendSubject
let createHypaV3Preset: typeof import('../memory/hypav3').createHypaV3Preset

beforeEach(async () => {
    h.bodies.length = 0
    h.requests.length = 0
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: Database }
    selectedCharID = stores.selectedCharID as unknown as Selection
    beginWork = (await import('../chatOrigin')).beginWork
    createSendSubject = (await import('../chatOrigin')).createSendSubject
    createHypaV3Preset = (await import('../memory/hypav3')).createHypaV3Preset
})

afterEach(() => {
    selectedCharID.set(-1)
})

/** `{{char}}`, `{{user}}` and a per-chat tag: the text names the character, persona and chat it read. */
const TAGS = '{{char}}/{{user}}/{{getvar::who}}'
const CHATML_PROMPT = `<|im_start|>system\nSUMP[${TAGS}] {{slot}}<|im_end|>`
const FROM_A = 'SUMP[Alice/PersonaA/VAR-A]'
const FROM_B = 'SUMP[Bob/PersonaB/VAR-B]'

// The persona at `selectedPersona` is a third one, so neither chat is bound to it.
const PERSONAS = [
    { id: 'p-S', name: 'SelectedPersona', personaPrompt: 'PS-PROMPT', icon: '' },
    { id: 'p-A', name: 'PersonaA', personaPrompt: 'PA-PROMPT', icon: '' },
    { id: 'p-B', name: 'PersonaB', personaPrompt: 'PB-PROMPT', icon: '' },
] as RisuPersona[]

function msg(role: 'user' | 'char', data: string): Message {
    return { role, data, time: 1 } as Message
}

function makeChat(id: string, persona: string, who: string): Chat {
    return {
        id, note: '', name: '', localLore: [], fmIndex: -1, message: [msg('user', 'hi')],
        scriptstate: { $who: who }, GLGlobalVariables: {}, modules: [], bindedPersona: persona,
    } as unknown as Chat
}

function makeChar(chaId: string, name: string, chats: Chat[]): character {
    return {
        chaId, name, type: 'character', chatPage: 0, firstMessage: '', alternateGreetings: [], desc: '', personality: '',
        scenario: '', bias: [], customscript: [], triggerscript: [], globalLore: [], emotionImages: [], additionalAssets: [],
        modules: [], exampleMessage: '', chats,
    } as unknown as character
}

/** Alice (chat A, persona A, `VAR-A`) and Bob (chat B, persona B, `VAR-B`), with the summarization prompt in both memory settings. */
function memoryWorld(hypaV3Settings: Record<string, unknown> = {}): { A: character, B: character } {
    const A = makeChar('char-A', 'Alice', [makeChat('chat-A', 'p-A', 'VAR-A')])
    const B = makeChar('char-B', 'Bob', [makeChat('chat-B', 'p-B', 'VAR-B')])
    DBState.db = {
        characters: [A, B], personas: PERSONAS, selectedPersona: 0, username: 'GlobalUser', modules: [], enabledModules: [],
        loadouts: [], globalChatVariables: {}, subModel: 'x', maxResponse: 0,
        supaModelType: 'subModel', supaMemoryPrompt: CHATML_PROMPT, hypaAllocatedTokens: 0, hypaChunkSize: 100,
        hypaV3PresetId: 0,
        hypaV3Presets: [createHypaV3Preset('p', { summarizationPrompt: CHATML_PROMPT, ...hypaV3Settings })],
    } as unknown as Database
    return { A, B }
}

function subjectFor(owner: character, chat: Chat): RunSubject {
    const handle = beginWork(owner, chat)!
    return createSendSubject(handle.origin, { owner, chat })
}

const tokenizer = { tokenizeChat: async () => 50 } as unknown as ChatTokenizer

function conversation(): OpenAIChat[] {
    return Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `msg${i}`, memo: `m${i}` }))
}

/** The prompt of the first summarization request, or `''` when none was made. */
function summarizerPrompt(): string {
    return (h.bodies[0] ?? []).map((m) => m.content).join('\n')
}

function marker(text: string): string | null {
    const found = /SUMP\[[^\]]*\]/.exec(text)
    return found ? found[0] : null
}

//#endregion


//#region the requests carry the subject

/** The subject each recorded request carried, in order. */
function carriedSubjects(): unknown[] {
    return h.requests.map((request) => request.subject)
}

describe('memory summarizers hand their subject to the request', () => {
    type WithSubject = (
        chats: OpenAIChat[], currentTokens: number, maxContextTokens: number, room: Chat, char: character, tokenizer: ChatTokenizer, subject: RunSubject,
    ) => Promise<{ error?: string }>

    test('hypaMemoryV2\'s summary request carries the subject it was given', async () => {
        const { hypaMemoryV2 } = await import('../memory/hypav2')
        const run: WithSubject = hypaMemoryV2
        const { A } = memoryWorld()
        selectedCharID.set(1)
        const subject = subjectFor(A, A.chats[0])

        await run(conversation(), 500, 200, A.chats[0], A, tokenizer, subject)

        expect(h.requests.length, 'a summarization request was made').toBeGreaterThan(0)
        expect(carriedSubjects().map((carried) => carried === subject ? 'the subject' : String(carried)), 'the subject each request carried').toEqual(h.requests.map(() => 'the subject'))
    })

    test('hypaMemoryV3\'s standard summariser requests carry the subject it was given', async () => {
        const { hypaMemoryV3 } = await import('../memory/hypav3')
        const run: WithSubject = hypaMemoryV3
        const { A } = memoryWorld({ useExperimentalImpl: false, enableSimilarityCorrection: true, queryChatCount: 3 })
        selectedCharID.set(1)
        const subject = subjectFor(A, A.chats[0])

        await run(conversation(), 500, 200, A.chats[0], A, tokenizer, subject)

        expect(h.requests.length, 'summarization requests were made').toBeGreaterThan(0)
        expect(carriedSubjects().map((carried) => carried === subject ? 'the subject' : String(carried)), 'the subject each request carried').toEqual(h.requests.map(() => 'the subject'))
    })

    test('hypaMemoryV3\'s experimental summariser requests carry the subject it was given', async () => {
        const { hypaMemoryV3 } = await import('../memory/hypav3')
        const run: WithSubject = hypaMemoryV3
        const { A } = memoryWorld({ useExperimentalImpl: true, queryChatCount: 3 })
        selectedCharID.set(1)
        const subject = subjectFor(A, A.chats[0])

        await run(conversation(), 500, 200, A.chats[0], A, tokenizer, subject)

        expect(h.requests.length, 'summarization requests were made').toBeGreaterThan(0)
        expect(carriedSubjects().map((carried) => carried === subject ? 'the subject' : String(carried)), 'the subject each request carried').toEqual(h.requests.map(() => 'the subject'))
    })

    test('hypaV3\'s exported summarize request carries the subject it was given', async () => {
        const { summarize } = await import('../memory/hypav3')
        const { A } = memoryWorld()
        selectedCharID.set(1)
        const subject = subjectFor(A, A.chats[0])

        await summarize(conversation().slice(0, 2), false, subject)

        expect(h.requests.length).toBe(1)
        expect(h.requests[0].subject).toBe(subject)
    })

    test('guard: hypaV3\'s exported summarize with no subject makes a request that carries none', async () => {
        const { summarize } = await import('../memory/hypav3')
        memoryWorld()
        selectedCharID.set(1)

        await summarize(conversation().slice(0, 2))

        expect(h.requests.length).toBe(1)
        expect(h.requests[0].subject).toBeUndefined()
    })

    test('supaMemory\'s summary request carries the subject it was given', async () => {
        const { supaMemory } = await import('../memory/supaMemory')
        const { A } = memoryWorld()
        DBState.db.supaMemoryPrompt = ''
        DBState.db.maxSupaChunkSize = 5
        selectedCharID.set(1)
        const subject = subjectFor(A, A.chats[0])

        const result = await supaMemory(conversation().slice(0, 4), 200, 100, A.chats[0], A, tokenizer, {}, subject)

        expect(result.error, 'the memory pass completes').toBeUndefined()
        expect(h.requests.length, 'a summarization request was made').toBeGreaterThan(0)
        expect(carriedSubjects().map((carried) => carried === subject ? 'the subject' : String(carried)), 'the subject each request carried').toEqual(h.requests.map(() => 'the subject'))
    })
})

describe('stableDiff hands its subject to the prompt request', () => {
    test('the prompt request carries the subject passed as the third argument', async () => {
        const { stableDiff } = await import('../stableDiff')
        const { A } = memoryWorld()
        Object.assign(DBState.db, { sdProvider: 'webui' })
        Object.assign(A, { newGenData: { instructions: 'draw it', prompt: '{{slot}}', negative: '' } })
        selectedCharID.set(1)
        const subject = subjectFor(A, A.chats[0])
        const withSubject: (char: character, prompt: string, subject: RunSubject) => Promise<unknown> = stableDiff as never

        await withSubject(A, 'user: hi', subject).catch(() => {})

        expect(h.requests.length, 'the prompt request was made').toBe(1)
        expect(h.requests[0].subject).toBe(subject)
    })

    test('guard: the prompt request is made in the submodel mode with the instructions and the chat', async () => {
        const { stableDiff } = await import('../stableDiff')
        const { A } = memoryWorld()
        Object.assign(DBState.db, { sdProvider: 'webui' })
        Object.assign(A, { newGenData: { instructions: 'draw it', prompt: '{{slot}}', negative: '' } })

        await stableDiff(A, 'user: hi').catch(() => {})

        expect(h.requests.length).toBe(1)
        expect(h.requests[0].formated.map((m) => m.content)).toEqual(['draw it', 'Chat:\nuser: hi'])
    })
})

//#endregion
