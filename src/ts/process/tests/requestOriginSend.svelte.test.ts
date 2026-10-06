/**
 * The send's own requests carry the send's subject: the main reply, the image-prompt request and
 * the emotion request (through `requestChatData`), and the stable-diffusion call (through
 * `stableDiff`'s third argument).
 *
 * Drives the real `sendChat` (`index.svelte.ts`). `requestChatData` and `stableDiff` are mocks that
 * record what they were called with, so nothing here says anything about a native backend. The mock
 * set of the module's dependency graph follows `sendChatSaveMarks.svelte.test.ts`.
 *
 * Tests whose title starts with `guard:` pass with or without the binding.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
// Installs the real `globalThis.safeStructuredClone`, the same way
// `src/main.ts` does (`import "./ts/polyfill"`): the send's snapshots need
// the real clone, not vitest.setup.ts's JSON-based stand-in.
import '../../polyfill'

//#region module mocks

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

vi.mock(import('../../platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('../../platform'))

vi.mock(import('../../storage/database.svelte'), () => ({
    changeToPreset: vi.fn(),
    setCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => { throw new Error('no live database in tests') }),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('../../storage/database.svelte'))

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        CharEmotion: writable({}),
        selectedCharID: writable(-1),
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../../tokenizer'), () => ({
    ChatTokenizer: class {
        constructor(_extra: number, _mode: string) {}
        async tokenizeChat(_chat: unknown) { return 1 }
    },
    tokenize: vi.fn(async () => 1),
    tokenizeNum: vi.fn(async () => [] as number[]),
}) as unknown as typeof import('../../tokenizer'))

vi.mock(import('../../alert'), () => ({
    alertError: vi.fn(),
    alertToast: vi.fn(),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('../../parser/chatML'))

vi.mock(import('../lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
}) as unknown as typeof import('../lorebook.svelte'))

vi.mock(import('../../util'), () => ({
    findCharacterbyId: vi.fn(() => undefined),
    getAuthorNoteDefaultText: vi.fn(() => ''),
    getPersonaPrompt: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    isLastCharPunctuation: vi.fn(() => true),
    trimUntilPunctuation: vi.fn((s: string) => s),
    parseToggleSyntax: vi.fn(() => []),
    prebuiltAssetCommand: vi.fn(() => ''),
}) as unknown as typeof import('../../util'))

const requestChatDataMock = vi.hoisted(() => vi.fn())
const stableDiffMock = vi.hoisted(() => vi.fn())

vi.mock(import('../request/request'), () => ({
    requestChatData: requestChatDataMock,
}) as unknown as typeof import('../request/request'))

vi.mock(import('../stableDiff'), () => ({
    stableDiff: stableDiffMock,
}) as unknown as typeof import('../stableDiff'))

vi.mock(import('../scripts'), () => ({
    processScript: vi.fn(async (_char: unknown, text: string) => text),
    processScriptFull: vi.fn(async (_char: unknown, text: string) => ({ data: text, emoChanged: false })),
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('../scripts'))

vi.mock(import('../exampleMessages'), () => ({
    exampleMessage: vi.fn(() => []),
}) as unknown as typeof import('../exampleMessages'))

vi.mock(import('../tts'), () => ({
    sayTTS: vi.fn(),
}) as unknown as typeof import('../tts'))

vi.mock(import('../memory/supaMemory'), () => ({
    supaMemory: vi.fn(),
}) as unknown as typeof import('../memory/supaMemory'))

vi.mock(import('../group'), () => ({
    groupOrder: vi.fn(),
}) as unknown as typeof import('../group'))

vi.mock(import('../triggers'), () => ({
    runTrigger: vi.fn(async () => undefined),
}) as unknown as typeof import('../triggers'))

vi.mock(import('../memory/hypamemory'), () => ({
    HypaProcesser: class {},
}) as unknown as typeof import('../memory/hypamemory'))

vi.mock(import('../embedding/addinfo'), () => ({
    additionalInformations: vi.fn(async () => ''),
}) as unknown as typeof import('../embedding/addinfo'))

vi.mock(import('../files/inlays'), () => ({
    getInlayAsset: vi.fn(),
}) as unknown as typeof import('../files/inlays'))

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

vi.mock(import('../memory/hanuraiMemory'), () => ({
    hanuraiMemory: vi.fn(),
}) as unknown as typeof import('../memory/hanuraiMemory'))

vi.mock(import('../memory/hypav2'), () => ({
    hypaMemoryV2: vi.fn(),
}) as unknown as typeof import('../memory/hypav2'))

vi.mock(import('../scriptings'), () => ({
    runLuaEditTrigger: vi.fn(async (_char: unknown, _type: string, formated: unknown) => formated),
}) as unknown as typeof import('../scriptings'))

vi.mock(import('../../model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ flags: [] })),
    LLMFlags: {},
}) as unknown as typeof import('../../model/modellist'))

vi.mock(import('../memory/hypav3'), () => ({
    hypaMemoryV3: vi.fn(),
}) as unknown as typeof import('../memory/hypav3'))

vi.mock(import('../modules'), () => ({
    getModuleAssets: vi.fn(() => []),
    getModuleToggles: vi.fn(() => ''),
}) as unknown as typeof import('../modules'))

vi.mock(import('../../globalApi.svelte'), () => ({
    readImage: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../plugins/plugins.svelte'), () => ({
    pluginV2: { chatOutput: new Set() },
}) as unknown as typeof import('../../plugins/plugins.svelte'))

//#endregion

import { sendChat, doingChat } from '../index.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'

//#region fixtures

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string, extra: Record<string, unknown> = {}): CharacterFixture {
    return {
        chaId, name, type: 'character', chatPage: 0, firstMessage: 'Hello!', alternateGreetings: [], desc: 'A test character.',
        bias: [], replaceGlobalNote: undefined, systemPrompt: undefined, utilityBot: false, inlayViewScreen: false, viewScreen: undefined,
        depth_prompt: undefined, reloadKeys: 0, emotionImages: [['happy', 'happy.png']],
        newGenData: { instructions: 'draw', prompt: '{{slot}}', negative: '' },
        chats: [{ id: `${chaId}-chat-0`, note: '', name: '', localLore: [], fmIndex: -1, message: [{ role: 'user', data: 'Hi', time: 1 }] }],
        ...extra,
    } as unknown as CharacterFixture
}

function installDb(viewScreen: 'emotion' | 'imggen', igpPrompt: string): void {
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], loadouts: [], plugins: [], pluginCustomStorage: {},
        characterOrder: ['char-0'], characters: [makeCharacter('char-0', 'Character Zero', { viewScreen })],
        statics: { messages: 0 }, aiModel: 'gpt-3.5-turbo', maxContext: 999999, maxResponse: 500, bias: [], mainPrompt: '', globalNote: '',
        jailbreakToggle: false, chainOfThought: false, personaPrompt: false, promptPreprocess: false, additionalPrompt: '', descriptionPrefix: '',
        formatingOrder: ['main', 'description', 'personaPrompt', 'chats', 'lastChat', 'jailbreak', 'lorebook', 'globalNote', 'authorNote'],
        promptTemplate: undefined, promptInfoInsideChat: false, autoContinueMinTokens: 0, autoContinueChat: false, igpPrompt,
        notification: false, removeIncompleteResponse: false, streamingDisplayOptimizationMode: 'off', ttsAutoSpeech: false, presetChain: '',
        outputImageModal: false, rememberToolUsage: false, emotionProcesser: 'llm', sdProvider: 'webui',
    } as unknown as Database
}

interface RecordedRequest {
    subject?: { origin: { chaId: string, chatId: string } }
    mode: string
}

function recordedRequests(): RecordedRequest[] {
    return requestChatDataMock.mock.calls.map((call: unknown[]) => ({
        subject: (call[0] as { subject?: RecordedRequest['subject'] }).subject,
        mode: String(call[1]),
    }))
}

beforeEach(() => {
    requestChatDataMock.mockReset()
    stableDiffMock.mockReset()
    doingChat.set(false)
})

//#endregion

describe('the send\'s own requests carry the send\'s subject', () => {
    test('the main reply, the image-prompt request and the emotion request each carry the subject of the chat the send started in', async () => {
        installDb('emotion', 'draw a scene')
        selectedCharID.set(0)
        requestChatDataMock
            .mockResolvedValueOnce({ type: 'success', result: 'A reply.' })
            .mockResolvedValueOnce({ type: 'success', result: 'IGP' })
            .mockResolvedValueOnce({ type: 'success', result: 'happy' })

        const result = await sendChat()

        expect(result).toBe(true)
        const requests = recordedRequests()
        expect(requests.map((r) => r.mode), 'the send made its three requests').toEqual(['model', 'emotion', 'emotion'])
        expect.soft(requests[0].subject?.origin, 'the main request').toEqual({ chaId: 'char-0', chatId: 'char-0-chat-0' })
        expect.soft(requests[1].subject?.origin, 'the image-prompt request').toEqual({ chaId: 'char-0', chatId: 'char-0-chat-0' })
        expect.soft(requests[2].subject?.origin, 'the emotion request').toEqual({ chaId: 'char-0', chatId: 'char-0-chat-0' })
        expect.soft(requests[1].subject, 'one subject for the whole send').toBe(requests[0].subject)
        expect.soft(requests[2].subject, 'one subject for the whole send').toBe(requests[0].subject)
    })

    test('the main reply carries the send\'s subject when the selection has moved to Home while the reply streams', async () => {
        installDb('emotion', '')
        selectedCharID.set(0)
        requestChatDataMock.mockImplementationOnce(async () => {
            selectedCharID.set(-1)
            return { type: 'success', result: 'A reply.' }
        })
        requestChatDataMock.mockResolvedValue({ type: 'success', result: 'happy' })

        await sendChat()

        expect(recordedRequests()[0].subject?.origin).toEqual({ chaId: 'char-0', chatId: 'char-0-chat-0' })
    })

    test('the stable-diffusion call receives the send\'s subject', async () => {
        installDb('imggen', '')
        selectedCharID.set(0)
        requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: 'A reply.' })

        await sendChat()

        expect(stableDiffMock).toHaveBeenCalledTimes(1)
        const third = stableDiffMock.mock.calls[0][2] as { origin?: { chaId: string, chatId: string } } | undefined
        expect(third?.origin).toEqual({ chaId: 'char-0', chatId: 'char-0-chat-0' })
    })

    test('guard: a send with the emotion screen makes its main request first, then the emotion request', async () => {
        installDb('emotion', '')
        selectedCharID.set(0)
        requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: 'A reply.' }).mockResolvedValueOnce({ type: 'success', result: 'happy' })

        await sendChat()

        expect(recordedRequests().map((r) => r.mode)).toEqual(['model', 'emotion'])
    })
})
