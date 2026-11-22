/**
 * The live push site of an owned send (`sendChat` in `src/ts/process/index.svelte.ts`): an eligible send marks its
 * character for save and only then tells the page state which mark count the reply must be covered by. The count is read
 * after the mark, so the commit that covers it is one that saw the reply; read before it, the first commit that merely
 * covers the older count would consume the record while the reply is still unsaved. An ineligible send never reaches
 * the page state.
 *
 * Drives the REAL, unmocked `sendChat`; the mock set is the one of `sendChatSaveMarks.svelte.test.ts`, extended with the
 * Android transport flag, a counting `markCharacterForSave` and a spy on `noteReplyPushed`.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
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

vi.mock(import('../request/request'), () => ({
    requestChatData: requestChatDataMock,
}) as unknown as typeof import('../request/request'))

vi.mock(import('../stableDiff'), () => ({
    stableDiff: vi.fn(),
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

// The save-mark count is what the page state is told; it moves only through the counting mark below.
const world = vi.hoisted(() => ({
    markCount: 0,
    android: false,
    /** Every mark and every note of the live push, in call order. */
    log: [] as Array<{ kind: 'mark', chaId: unknown, countAfter: number } | { kind: 'note', key: string, chaId: unknown, target: number }>,
}))

vi.mock(import('../../globalApi.svelte'), () => ({
    readImage: vi.fn(),
    getSaveMarkCount: vi.fn(() => world.markCount),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../storage/characterSaveMarks'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        markCharacterForSave: vi.fn((chaId: unknown) => {
            world.markCount += 1
            world.log.push({ kind: 'mark', chaId, countAfter: world.markCount })
        }),
    }
})

vi.mock(import('../../storage/tauriByteTransport'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        isAndroidTransport: () => world.android,
    }
})

vi.mock(import('../../nativeReply/pageState'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        noteReplyPushed: vi.fn((key: string, chaId: unknown, target: number) => {
            world.log.push({ kind: 'note', key, chaId, target })
        }),
    }
})

vi.mock(import('../../plugins/plugins.svelte'), () => ({
    pluginV2: { chatOutput: new Set() },
}) as unknown as typeof import('../../plugins/plugins.svelte'))

//#endregion

import { sendChat } from '../index.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'
import { noteReplyPushed, noteBound, noteInvoked, resetPageStateForTests } from '../../nativeReply/pageState'
import { clearRunningSends } from './activeUnits.test-helpers'

function installDb(useStreaming: boolean): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: ['char-0'],
        characters: [{
            chaId: 'char-0',
            name: 'Character Zero',
            type: 'character',
            chatPage: 0,
            firstMessage: 'Hello!',
            alternateGreetings: [],
            desc: 'A test character.',
            bias: [],
            utilityBot: false,
            inlayViewScreen: false,
            reloadKeys: 0,
            chats: [{
                id: 'char-0-chat-0',
                note: '',
                name: '',
                localLore: [],
                fmIndex: -1,
                message: [{ role: 'user', data: 'Hi', time: 1 }],
            }],
        }],
        statics: { messages: 0 },
        aiModel: 'gpt-3.5-turbo',
        maxContext: 999999,
        maxResponse: 500,
        bias: [],
        mainPrompt: '',
        globalNote: '',
        jailbreakToggle: false,
        chainOfThought: false,
        personaPrompt: false,
        promptPreprocess: false,
        additionalPrompt: '',
        descriptionPrefix: '',
        formatingOrder: ['main', 'description', 'personaPrompt', 'chats', 'lastChat', 'jailbreak', 'lorebook', 'globalNote', 'authorNote'],
        promptTemplate: undefined,
        promptInfoInsideChat: false,
        autoContinueMinTokens: 0,
        autoContinueChat: false,
        igpPrompt: '',
        notification: false,
        removeIncompleteResponse: false,
        streamingDisplayOptimizationMode: 'off',
        ttsAutoSpeech: false,
        presetChain: '',
        outputImageModal: false,
        rememberToolUsage: false,
        useStreaming,
    } as unknown as Database
}

async function sendOnce(options: { android: boolean, useStreaming: boolean, owned?: boolean }): Promise<void> {
    world.android = options.android
    installDb(options.useStreaming)
    selectedCharID.set(0)
    clearRunningSends()
    // A request that owns the record binds the grant and invokes the native fetch with it; the page state learns both
    // through its real notes. A request that never does leaves the entry as the grant made it.
    requestChatDataMock.mockImplementationOnce(async (args: { chatId: string }) => {
        if (options.owned === true) {
            noteBound(args.chatId)
            noteInvoked(args.chatId)
        }
        return { type: 'success', result: 'Reply' }
    })
    expect(await sendChat()).toBe(true)
    expect(DBState.db.characters[0].chats[0].message[1].data).toBe('Reply')
}

beforeEach(() => {
    world.markCount = 0
    world.android = false
    world.log.length = 0
    vi.mocked(noteReplyPushed).mockClear()
    resetPageStateForTests()
})

describe('sendChat: the live push of an owned send', () => {
    test('an eligible send marks its character, then notes the push with the mark count read after that mark', async () => {
        await sendOnce({ android: true, useStreaming: false, owned: true })

        const notes = world.log.filter((entry) => entry.kind === 'note')
        expect(notes).toHaveLength(1)
        const noteAt = world.log.findIndex((entry) => entry.kind === 'note')
        const before = world.log[noteAt - 1]
        // The mark comes first, on the origin character, and the target is the count that mark produced.
        expect(before.kind).toBe('mark')
        if (before.kind !== 'mark' || notes[0].kind !== 'note') {
            throw new Error('unreachable')
        }
        expect(before.chaId).toBe('char-0')
        expect(notes[0].chaId).toBe('char-0')
        expect(notes[0].target).toBe(before.countAfter)
        // A count read before the mark would be one lower than the count the mark produced.
        const countBeforeMark = before.countAfter - 1
        expect(notes[0].target).toBeGreaterThan(countBeforeMark)
        expect(typeof notes[0].key).toBe('string')
        expect(notes[0].key).not.toBe('')
    })

    test('a send granted a key whose request never owned a record neither marks nor notes the push', async () => {
        await sendOnce({ android: true, useStreaming: false, owned: true })
        const marksOfOwnedSend = world.log.filter((entry) => entry.kind === 'mark').length
        world.markCount = 0
        world.log.length = 0
        vi.mocked(noteReplyPushed).mockClear()
        resetPageStateForTests()

        await sendOnce({ android: true, useStreaming: false })

        // The push's own mark is the one the owned send has and this send lacks.
        expect(world.log.filter((entry) => entry.kind === 'mark')).toHaveLength(marksOfOwnedSend - 1)
        expect(noteReplyPushed).not.toHaveBeenCalled()
    })

    test('a send that is not on the Android transport never notes a push', async () => {
        await sendOnce({ android: false, useStreaming: false })
        expect(noteReplyPushed).not.toHaveBeenCalled()
    })

    test('a streaming send on Android never notes the non-stream push', async () => {
        await sendOnce({ android: true, useStreaming: true })
        expect(noteReplyPushed).not.toHaveBeenCalled()
    })
})
