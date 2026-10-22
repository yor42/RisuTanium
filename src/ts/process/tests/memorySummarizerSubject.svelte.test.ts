// @vitest-environment node

/**
 * The hypaV2 and hypaV3 summarizers parse a chatML summarization prompt
 * (`{{char}}`, `{{user}}` and per-chat tags in it) as the chat their subject
 * stands for -- whatever the selection is, and the holder the subject started
 * from when the chat id has two holders. Called with no subject, the exported
 * `summarize` of hypaV3 keeps reading the selection, which is what the HypaV3
 * modal relies on.
 *
 * Drives the real `hypav2`, `hypav3` and `supaMemory` with the real `../../parser/chatML`,
 * `../../parser/parser.svelte`, `../../util` and `../chatOrigin`. Only the
 * provider request, the embedding processor, the tokenizer and the platform/IO packages are
 * mocked; `requestChatData` is a mock that records the summarization request,
 * so nothing here says anything about a native backend.
 *
 * Tests whose title starts with `guard:` pass with or without the binding:
 * they pin behaviour that must be preserved. The tests at the end check that
 * every internal summarization request carries the subject.
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
    requestChatData: vi.fn(async (body: { formated: Array<{ role: string, content: string }> }) => {
        h.bodies.push(body.formated)
        return { type: 'success', result: 'SUMMARY' }
    }),
}) as unknown as typeof import('../request/request'))

vi.mock(import('../memory/hypamemory'), () => ({
    // Embeds every text to the same one-dimensional vector, which is all the
    // similarity step of hypaV3 needs to run to its end.
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
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: Database }
    selectedCharID = stores.selectedCharID as unknown as Selection
    beginWork = (await import('../chatOrigin')).beginWork
    createSendSubject = (await import('../chatOrigin')).createSendSubject
    createHypaV3Preset = (await import('../memory/hypav3')).createHypaV3Preset
    // The first run imports the whole stores and memory module graph, which takes seconds on a loaded machine; the
    // bound only delays reporting a hang.
}, 60_000)

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

//#region hypaV3

describe('hypaV3\'s exported summarize', () => {
    test('a chatML summarization prompt reads the subject\'s owner, persona and chat when the selection is on another chat', async () => {
        const { summarize } = await import('../memory/hypav3')
        const withSubject: (messages: OpenAIChat[], isResummarize: boolean, subject: RunSubject) => Promise<string> = summarize
        const { A } = memoryWorld()
        selectedCharID.set(1)

        await withSubject(conversation().slice(0, 2), false, subjectFor(A, A.chats[0]))

        expect(marker(summarizerPrompt())).toBe(FROM_A)
    })

    test('a chatML summarization prompt reads the subject\'s owner, persona and chat when the selection is Home', async () => {
        const { summarize } = await import('../memory/hypav3')
        const withSubject: (messages: OpenAIChat[], isResummarize: boolean, subject: RunSubject) => Promise<string> = summarize
        const { A } = memoryWorld()
        selectedCharID.set(-1)

        await withSubject(conversation().slice(0, 2), false, subjectFor(A, A.chats[0]))

        expect(marker(summarizerPrompt())).toBe(FROM_A)
    })

    test('a chatML summarization prompt reads the holder the subject started from when the chat id has two holders', async () => {
        const { summarize } = await import('../memory/hypav3')
        const withSubject: (messages: OpenAIChat[], isResummarize: boolean, subject: RunSubject) => Promise<string> = summarize
        const first = makeChat('chat-dup', 'p-A', 'VAR-A')
        const second = makeChat('chat-dup', 'p-B', 'VAR-B')
        const { A } = memoryWorld()
        A.chats = [first, second]
        A.chatPage = 1
        selectedCharID.set(0)

        await withSubject(conversation().slice(0, 2), false, subjectFor(A, first))

        expect(marker(summarizerPrompt())).toBe(FROM_A)
    })

    test('guard: with no subject a chatML summarization prompt reads the selected chat', async () => {
        const { summarize } = await import('../memory/hypav3')
        memoryWorld()
        selectedCharID.set(1)

        await summarize(conversation().slice(0, 2))

        expect(marker(summarizerPrompt())).toBe(FROM_B)
    })

    test('guard: with the selection on the subject\'s chat a chatML summarization prompt reads that chat', async () => {
        const { summarize } = await import('../memory/hypav3')
        const withSubject: (messages: OpenAIChat[], isResummarize: boolean, subject: RunSubject) => Promise<string> = summarize
        const { A } = memoryWorld()
        selectedCharID.set(0)

        await withSubject(conversation().slice(0, 2), false, subjectFor(A, A.chats[0]))

        expect(marker(summarizerPrompt())).toBe(FROM_A)
    })

    test('guard: with no subject a resummarization request uses the resummarization prompt and reads the selected chat', async () => {
        const { summarize } = await import('../memory/hypav3')
        memoryWorld({ reSummarizationPrompt: `<|im_start|>system\nRESUM[${TAGS}] {{slot}}<|im_end|>` })
        selectedCharID.set(1)

        await summarize(conversation().slice(0, 2), true)

        const prompt = summarizerPrompt()
        expect(marker(prompt), 'the summarization prompt is not the one used').toBeNull()
        expect(/RESUM\[[^\]]*\]/.exec(prompt)?.[0]).toBe('RESUM[Bob/PersonaB/VAR-B]')
    })
})

describe('hypaMemoryV3 summarizes as the chat its subject stands for', () => {
    type WithSubject = (
        chats: OpenAIChat[], currentTokens: number, maxContextTokens: number, room: Chat, char: character, tokenizer: ChatTokenizer, subject: RunSubject,
    ) => Promise<object>

    for (const experimental of [false, true]) {
        const label = experimental ? 'the experimental implementation' : 'the standard implementation'

        test(`${label} reads the subject's owner, persona and chat when the selection is on another chat`, async () => {
            const { hypaMemoryV3 } = await import('../memory/hypav3')
            const run: WithSubject = hypaMemoryV3
            const { A } = memoryWorld({ useExperimentalImpl: experimental, queryChatCount: 3 })
            selectedCharID.set(1)

            await run(conversation(), 500, 200, A.chats[0], A, tokenizer, subjectFor(A, A.chats[0]))

            expect(h.bodies.length, 'a summarization request was made').toBeGreaterThan(0)
            expect(marker(summarizerPrompt())).toBe(FROM_A)
        })

        test(`${label} reads the holder the subject started from when the chat id has two holders`, async () => {
            const { hypaMemoryV3 } = await import('../memory/hypav3')
            const run: WithSubject = hypaMemoryV3
            const first = makeChat('chat-dup', 'p-A', 'VAR-A')
            const second = makeChat('chat-dup', 'p-B', 'VAR-B')
            const { A } = memoryWorld({ useExperimentalImpl: experimental, queryChatCount: 3 })
            A.chats = [first, second]
            A.chatPage = 1
            selectedCharID.set(0)

            await run(conversation(), 500, 200, first, A, tokenizer, subjectFor(A, first))

            expect(h.bodies.length, 'a summarization request was made').toBeGreaterThan(0)
            expect(marker(summarizerPrompt())).toBe(FROM_A)
        })

        test(`guard: ${label} reads that chat when the selection is on the subject's chat`, async () => {
            const { hypaMemoryV3 } = await import('../memory/hypav3')
            const run: WithSubject = hypaMemoryV3
            const { A } = memoryWorld({ useExperimentalImpl: experimental, queryChatCount: 3 })
            selectedCharID.set(0)

            await run(conversation(), 500, 200, A.chats[0], A, tokenizer, subjectFor(A, A.chats[0]))

            expect(h.bodies.length, 'a summarization request was made').toBeGreaterThan(0)
            expect(marker(summarizerPrompt())).toBe(FROM_A)
        })
    }
})

//#endregion

//#region hypaV2

describe('hypaMemoryV2 summarizes as the chat its subject stands for', () => {
    type WithSubject = (
        chats: OpenAIChat[], currentTokens: number, maxContextTokens: number, room: Chat, char: character, tokenizer: ChatTokenizer, subject: RunSubject,
    ) => Promise<object>

    test('a chatML summarization prompt reads the subject\'s owner, persona and chat when the selection is on another chat', async () => {
        const { hypaMemoryV2 } = await import('../memory/hypav2')
        const run: WithSubject = hypaMemoryV2
        const { A } = memoryWorld()
        selectedCharID.set(1)

        await run(conversation(), 500, 200, A.chats[0], A, tokenizer, subjectFor(A, A.chats[0]))

        expect(h.bodies.length, 'a summarization request was made').toBeGreaterThan(0)
        expect(marker(summarizerPrompt())).toBe(FROM_A)
    })

    test('a chatML summarization prompt reads the subject\'s owner, persona and chat when the selection is Home', async () => {
        const { hypaMemoryV2 } = await import('../memory/hypav2')
        const run: WithSubject = hypaMemoryV2
        const { A } = memoryWorld()
        selectedCharID.set(-1)

        await run(conversation(), 500, 200, A.chats[0], A, tokenizer, subjectFor(A, A.chats[0]))

        expect(h.bodies.length, 'a summarization request was made').toBeGreaterThan(0)
        expect(marker(summarizerPrompt())).toBe(FROM_A)
    })

    test('a chatML summarization prompt reads the holder the subject started from when the chat id has two holders', async () => {
        const { hypaMemoryV2 } = await import('../memory/hypav2')
        const run: WithSubject = hypaMemoryV2
        const first = makeChat('chat-dup', 'p-A', 'VAR-A')
        const second = makeChat('chat-dup', 'p-B', 'VAR-B')
        const { A } = memoryWorld()
        A.chats = [first, second]
        A.chatPage = 1
        selectedCharID.set(0)

        await run(conversation(), 500, 200, first, A, tokenizer, subjectFor(A, first))

        expect(h.bodies.length, 'a summarization request was made').toBeGreaterThan(0)
        expect(marker(summarizerPrompt())).toBe(FROM_A)
    })

    test('guard: a chatML summarization prompt reads that chat when the selection is on the subject\'s chat', async () => {
        const { hypaMemoryV2 } = await import('../memory/hypav2')
        const run: WithSubject = hypaMemoryV2
        const { A } = memoryWorld()
        selectedCharID.set(0)

        await run(conversation(), 500, 200, A.chats[0], A, tokenizer, subjectFor(A, A.chats[0]))

        expect(h.bodies.length, 'a summarization request was made').toBeGreaterThan(0)
        expect(marker(summarizerPrompt())).toBe(FROM_A)
    })
})

//#endregion

//#region supaMemory

describe('supaMemory labels the turns of the chat it was given', () => {
    /** The label in front of `content` in a summarizer input (`Label: content`). */
    function labelBefore(input: string, content: string): string | null {
        const found = new RegExp(`(?:^|\\n)([^\\n:]+): ${content}`).exec(input)
        return found ? found[1] : null
    }

    test('a user turn that alone exceeds the chunk size is labelled with the persona bound to the chat it was given, not the one bound to the selection', async () => {
        const { supaMemory } = await import('../memory/supaMemory')
        const { A } = memoryWorld()
        DBState.db.supaMemoryPrompt = ''
        DBState.db.maxSupaChunkSize = 5
        selectedCharID.set(1)

        const result = await supaMemory(conversation().slice(0, 4), 200, 100, A.chats[0], A, tokenizer)

        expect(result.error, 'the memory pass completes').toBeUndefined()
        expect(h.bodies.length, 'a summarization request was made').toBeGreaterThan(0)
        expect(labelBefore(h.bodies[0][0].content, 'msg0')).toBe('PersonaA')
    })
})

//#endregion

//#region the internal hops carry the subject

/** Every summarization request made in the test, as the marker its prompt carries. */
function allMarkers(): Array<string | null> {
    return h.bodies.map((body) => marker(body.map((m) => m.content).join('\n')))
}

describe('the internal hops carry the subject', () => {
    type WithSubject = (
        chats: OpenAIChat[], currentTokens: number, maxContextTokens: number, room: Chat, char: character, tokenizer: ChatTokenizer, subject: RunSubject,
    ) => Promise<{ error?: string }>

    test('hypaV3\'s standard implementation passes the subject at each of its three summarization requests', async () => {
        const { hypaMemoryV3 } = await import('../memory/hypav3')
        const run: WithSubject = hypaMemoryV3
        // The head of the chat is summarized in two batches (`msg0`..`msg5`, then
        // `msg6`); the similarity step then summarizes the last three chats
        // (`msg7`..`msg9`) to build its query.
        const { A } = memoryWorld({ useExperimentalImpl: false, enableSimilarityCorrection: true, queryChatCount: 3 })
        selectedCharID.set(1)

        const result = await run(conversation(), 500, 200, A.chats[0], A, tokenizer, subjectFor(A, A.chats[0]))

        expect(result.error, 'the memory pass completes').toBeUndefined()
        const requests = h.bodies.map((body) => body.map((m) => m.content).join('\n'))
        expect(requests.filter((text) => text.includes('msg0')).length, 'the first batch was summarized').toBe(1)
        expect(requests.filter((text) => text.includes('msg6')).length, 'the second batch was summarized').toBe(1)
        expect(requests.filter((text) => text.includes('msg9')).length, 'the similarity query was summarized').toBe(1)
        expect(new Set(allMarkers())).toEqual(new Set([FROM_A]))
    })

    test('hypaV3\'s experimental implementation passes the subject at its summarization requests', async () => {
        const { hypaMemoryV3 } = await import('../memory/hypav3')
        const run: WithSubject = hypaMemoryV3
        const { A } = memoryWorld({ useExperimentalImpl: true, queryChatCount: 3 })
        selectedCharID.set(1)

        // The summarization batches are requested before the embedding step, which
        // this fixture does not model; the result is not what the test looks at.
        await run(conversation(), 500, 200, A.chats[0], A, tokenizer, subjectFor(A, A.chats[0]))

        expect(h.bodies.length, 'summarization requests were made').toBeGreaterThan(0)
        expect(new Set(allMarkers())).toEqual(new Set([FROM_A]))
    })

    test('hypaV2\'s summary passes the subject it was given to parseChatML', async () => {
        const { hypaMemoryV2 } = await import('../memory/hypav2')
        const { A } = memoryWorld()
        selectedCharID.set(1)

        await hypaMemoryV2(conversation(), 500, 200, A.chats[0], A, tokenizer, subjectFor(A, A.chats[0]))

        expect(h.bodies.length, 'a summarization request was made').toBeGreaterThan(0)
        expect(new Set(allMarkers())).toEqual(new Set([FROM_A]))
    })
})

//#endregion
