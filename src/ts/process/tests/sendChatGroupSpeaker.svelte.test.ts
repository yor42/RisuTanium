/**
 * The keep-alive card names the member that speaks a group turn for the length of that turn, whether or not
 * the reply streams (MC-1502).
 *
 * Drives the REAL, unmocked `sendChat` (`../index.svelte`) and the real `notificationSubjectOf` against a real
 * `$state` database, with the module mocks of `sendChatGroupOrigin.svelte.test.ts` (copied, not shared: each
 * suite mocks its own graph). `requestChatData` reads the card's subject while a request is in flight, so a
 * subject is observed during the turn and not after it.
 *
 * Labels: a reproducer fails on the stage-1 base for the stated reason; a guard passes before and after.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, Chat, Message } from '../../storage/database.svelte'
// Installs the real `globalThis.safeStructuredClone`, the same way `src/main.ts` does (`import "./ts/polyfill"`).
import '../../polyfill'

//#region module mocks

const requestChatDataMock = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())
const runTriggerMock = vi.hoisted(() => vi.fn())
const sayTTSMock = vi.hoisted(() => vi.fn())
const runInlayScreenMock = vi.hoisted(() => vi.fn())
const processScriptFullMock = vi.hoisted(() => vi.fn())
const isLastCharPunctuationMock = vi.hoisted(() => vi.fn())

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
    alertError: alertErrorMock,
    alertToast: vi.fn(),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('../../parser/chatML'))

vi.mock(import('../lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
}) as unknown as typeof import('../lorebook.svelte'))

vi.mock(import('../../util'), async () => {
    const stores = await import('../../stores.svelte')
    const state = stores.DBState as unknown as { db: { characters: Array<{ chaId?: string, type?: string }> } }
    return {
        // Faithful to production: the live non-group character holding the id, or a blank one with a fresh id.
        findCharacterbyId: (id: string) => {
            for (const candidate of state.db.characters) {
                if (candidate.type !== 'group' && candidate.chaId === id) {
                    return candidate
                }
            }
            return {
                name: 'Unknown Character',
                chaId: globalThis.crypto.randomUUID(),
                type: 'character',
                bias: [],
                desc: '',
                chats: [],
                utilityBot: false,
                inlayViewScreen: false,
                additionalAssets: [],
                emotionImages: [],
                reloadKeys: 0,
            }
        },
        getAuthorNoteDefaultText: vi.fn(() => ''),
        getPersonaPrompt: vi.fn(() => ''),
        getUserName: vi.fn(() => 'User'),
        isLastCharPunctuation: isLastCharPunctuationMock,
        trimUntilPunctuation: vi.fn((s: string) => s),
        parseToggleSyntax: vi.fn(() => []),
        prebuiltAssetCommand: vi.fn(() => ''),
    } as unknown as typeof import('../../util')
})

vi.mock(import('../request/request'), () => ({
    requestChatData: requestChatDataMock,
}) as unknown as typeof import('../request/request'))

vi.mock(import('../stableDiff'), () => ({
    stableDiff: vi.fn(),
}) as unknown as typeof import('../stableDiff'))

vi.mock(import('../scripts'), () => ({
    processScript: vi.fn(async (_char: unknown, text: string) => text),
    processScriptFull: processScriptFullMock,
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('../scripts'))

vi.mock(import('../exampleMessages'), () => ({
    exampleMessage: vi.fn(() => []),
}) as unknown as typeof import('../exampleMessages'))

vi.mock(import('../tts'), () => ({
    sayTTS: sayTTSMock,
}) as unknown as typeof import('../tts'))

vi.mock(import('../memory/supaMemory'), () => ({
    supaMemory: vi.fn(),
}) as unknown as typeof import('../memory/supaMemory'))

vi.mock(import('../group'), () => ({
    groupOrder: vi.fn((order: unknown) => order),
}) as unknown as typeof import('../group'))

vi.mock(import('../triggers'), () => ({
    runTrigger: runTriggerMock,
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
    runInlayScreen: runInlayScreenMock,
}) as unknown as typeof import('../inlayScreen'))

vi.mock(import('../prereroll'), async (importOriginal) => ({
    renameContinuedMessage: (await importOriginal()).renameContinuedMessage,
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

vi.mock(import('../../storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
    installCharacterSaveMarks: vi.fn(),
    resetCharacterSaveMarksForTest: vi.fn(),
}) as unknown as typeof import('../../storage/characterSaveMarks'))

vi.mock('../coldMemberRestore', () => ({
    restoreColdCharacterByChaId: vi.fn(async () => false),
}))

// The thumbnail module is replaced: no avatar is generated, and every image is a local asset.
vi.mock('../../media/avatarThumb', () => ({
    isThumbEligible: (loc: string) => loc.startsWith('assets/'),
    peekAvatarThumb: () => undefined,
    getAvatarThumbSrc: vi.fn(async () => null),
}))

//#endregion

import { sendChat, doingChat } from '../index.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'
import { activeStreams, resetActiveStreamsForTest, replySpeakerOf } from '../activeStreams'
import { notificationSubjectOf } from '../../android/notificationAvatar'

//#region fixtures

type CharacterFixture = Database['characters'][number]

const GROUP_ID = 'group-1'
const CHAT_ID = 'group-chat'
const TARGET = { chaId: GROUP_ID, chatId: CHAT_ID }

function msg(role: 'user' | 'char', data: string, extra: Record<string, unknown> = {}): Message {
    return { role, data, time: 1, ...extra } as unknown as Message
}

function makeChat(id: string, message: Message[]): Chat {
    return { id, note: '', name: '', localLore: [], fmIndex: -1, message } as unknown as Chat
}

function makeCharacter(chaId: string, extra: Record<string, unknown> = {}): CharacterFixture {
    return {
        chaId,
        name: `Name of ${chaId}`,
        type: 'character',
        chatPage: 0,
        firstMessage: 'Hello!',
        alternateGreetings: [],
        desc: `${chaId} description`,
        image: `assets/${chaId}.png`,
        bias: [],
        utilityBot: false,
        inlayViewScreen: false,
        reloadKeys: 0,
        supaMemory: false,
        chats: [makeChat(`${chaId}-chat`, [msg('user', `${chaId} own`, { chatId: `${chaId}-own-id` })])],
        ...extra,
    } as unknown as CharacterFixture
}

function makeGroup(memberIds: string[]): CharacterFixture {
    return {
        chaId: GROUP_ID,
        name: 'The Group',
        type: 'group',
        chatPage: 0,
        image: 'assets/group.png',
        characters: [...memberIds],
        characterActive: memberIds.map(() => true),
        characterTalks: memberIds.map(() => 1),
        orderByOrder: true,
        reloadKeys: 0,
        supaMemory: false,
        chats: [makeChat(CHAT_ID, [msg('user', 'Hi')])],
    } as unknown as CharacterFixture
}

function installDb(characters: CharacterFixture[]): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: characters.map((c) => c.chaId),
        characters,
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
        supaModelType: 'none',
        hypav2: false,
        hypaV3: false,
        hanuraiEnable: false,
        inlayErrorResponse: false,
    } as unknown as Database
}

/** The group, selected, in slot 0 and two members in slots 1 and 2. */
function installGroupWorld(): void {
    installDb([makeGroup(['m1', 'm2']), makeCharacter('m1'), makeCharacter('m2')])
    selectedCharID.set(0)
}

/** One plain character in slot 0, selected. */
function installSingleWorld(): void {
    installDb([makeCharacter('solo', { chats: [makeChat(CHAT_ID, [msg('user', 'Hi')])] })])
    selectedCharID.set(0)
}

function subjectKey(chaId: string = GROUP_ID): string | undefined {
    return notificationSubjectOf({ chaId, chatId: CHAT_ID })?.identity.key
}

/** What the card's subject names at the moment each request is made, in request order. */
function recordSubjectAtEachRequest(subjectChaId: string = GROUP_ID): Array<string | undefined> {
    const seen: Array<string | undefined> = []
    requestChatDataMock.mockImplementation(async () => {
        seen.push(subjectKey(subjectChaId))
        return { type: 'success', result: `reply ${seen.length}` }
    })
    return seen
}

function controlledStream(): { stream: ReadableStream<{ data: string }>, push(text: string): void, close(): void } {
    let controller: ReadableStreamDefaultController<{ data: string }> | undefined
    const stream = new ReadableStream<{ data: string }>({
        start(c) { controller = c },
    })
    return {
        stream,
        push(text) {
            try { controller?.enqueue({ data: text }) } catch { /* the reader cancelled it */ }
        },
        close() {
            try { controller?.close() } catch { /* the reader cancelled it */ }
        },
    }
}

async function settle(): Promise<void> {
    for (let i = 0; i < 20; i++) {
        await Promise.resolve()
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function waitFor(what: string, check: () => boolean): Promise<void> {
    for (let i = 0; i < 200; i++) {
        if (check()) {
            return
        }
        await settle()
    }
    throw new Error(`timed out waiting for: ${what}`)
}

beforeEach(() => {
    requestChatDataMock.mockReset()
    requestChatDataMock.mockResolvedValue({ type: 'success', result: 'unexpected request.' })
    alertErrorMock.mockReset()
    runTriggerMock.mockReset()
    runTriggerMock.mockResolvedValue(undefined)
    sayTTSMock.mockReset()
    runInlayScreenMock.mockReset()
    runInlayScreenMock.mockImplementation((_char: unknown, text: string) => ({ text, promise: undefined }))
    processScriptFullMock.mockReset()
    processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => ({ data: text, emoChanged: false }))
    isLastCharPunctuationMock.mockReset()
    isLastCharPunctuationMock.mockReturnValue(true)
    doingChat.set(false)
    resetActiveStreamsForTest()
})

afterEach(() => {
    selectedCharID.set(-1)
})

//#endregion

describe('the speaker of a group turn, streaming off (MC-1502)', () => {
    // Regression reproducer: on the stage-1 base only a live stream names a member, so each request sees the group.
    test('T2.1 each member turn names that member during its request, and the lookup reverts to the group after the send', async () => {
        installGroupWorld()
        const seen = recordSubjectAtEachRequest()

        const result = await sendChat()

        expect(result).toBe(true)
        expect(seen).toEqual(['m1', 'm2'])
        // After the send the lookup is the group's again. The closing card follows what the consumer tracked last, not this lookup.
        expect(subjectKey()).toBe(GROUP_ID)
        expect(replySpeakerOf(GROUP_ID, CHAT_ID)).toBeUndefined()
    })

    // Regression reproducer: a send to member i registers that member the same way.
    test('T2.1 a send to one member of the group names that member during its request', async () => {
        installGroupWorld()
        const seen = recordSubjectAtEachRequest()

        const result = await sendChat(1)

        expect(result).toBe(true)
        expect(seen).toEqual(['m2'])
        expect(subjectKey()).toBe(GROUP_ID)
    })

    // Guard: a plain character is its own subject throughout.
    test('T2.4 a single-character send keeps naming the character', async () => {
        installSingleWorld()
        const seen: Array<string | undefined> = []
        requestChatDataMock.mockImplementation(async () => {
            seen.push(notificationSubjectOf({ chaId: 'solo', chatId: CHAT_ID })?.identity.key)
            return { type: 'success', result: 'reply' }
        })

        const result = await sendChat()

        expect(result).toBe(true)
        expect(seen).toEqual(['solo'])
        expect(notificationSubjectOf({ chaId: 'solo', chatId: CHAT_ID })?.identity.key).toBe('solo')
        expect(replySpeakerOf('solo', CHAT_ID)).toBeUndefined()
    })

    // Guard: a turn that fails still releases its speaker, and the next send starts clean.
    test('T2.5 a member request that rejects leaves no speaker behind, and the next send starts clean', async () => {
        installGroupWorld()
        requestChatDataMock.mockImplementationOnce(async () => {
            throw new Error('request failed')
        })

        const failed = await sendChat(0).catch((error: unknown) => error)

        expect(failed).toBeInstanceOf(Error)
        expect(subjectKey()).toBe(GROUP_ID)
        expect(replySpeakerOf(GROUP_ID, CHAT_ID)).toBeUndefined()

        const seen = recordSubjectAtEachRequest()
        const result = await sendChat(1)

        expect(result).toBe(true)
        expect(seen).toEqual(['m2'])
    })

    // Guard: a member turn of the whole-group walk that throws still releases its speaker.
    test('a thrown member turn of the group walk leaves no speaker behind', async () => {
        installGroupWorld()
        requestChatDataMock.mockImplementationOnce(async () => {
            throw new Error('request failed')
        })

        const failed = await sendChat().catch((error: unknown) => error)

        expect(failed).toBeInstanceOf(Error)
        expect(replySpeakerOf(GROUP_ID, CHAT_ID)).toBeUndefined()
        expect(subjectKey()).toBe(GROUP_ID)
    })

    // Guard: a refused send registers nothing, so it cannot leave a speaker behind.
    test('a send refused before it starts registers no speaker', async () => {
        installGroupWorld()
        selectedCharID.set(-1)

        const result = await sendChat(0)

        expect(result).toBe(false)
        expect(replySpeakerOf(GROUP_ID, CHAT_ID)).toBeUndefined()
        expect(requestChatDataMock).not.toHaveBeenCalled()
    })

    // Chosen: a prompt preview also registers its member, because it takes the same in-flight work and shows the
    // same card; it cannot overlap a real send, and it releases the speaker when it settles.
    test('a prompt preview of a member turn registers its speaker for the preview only', async () => {
        installGroupWorld()
        const seen = recordSubjectAtEachRequest()

        await sendChat(0, { previewPrompt: true })

        expect(seen).toEqual(['m1'])
        expect(replySpeakerOf(GROUP_ID, CHAT_ID)).toBeUndefined()
        expect(subjectKey()).toBe(GROUP_ID)
    })
})

describe('the speaker of a group turn, streaming on (MC-1502)', () => {
    // Regression reproducer: the member is named from the turn's start, before the first chunk.
    test('T2.2 the member is named while the request is pending, before any stream exists', async () => {
        installGroupWorld()
        let finish: ((value: { type: string, result: string }) => void) | undefined
        let during: string | undefined
        let streamsDuring = -1
        requestChatDataMock.mockImplementationOnce(() => new Promise((resolve) => {
            during = subjectKey()
            streamsDuring = activeStreams().length
            finish = resolve
        }))

        const outcome = sendChat(0)
        await waitFor('the first request', () => finish !== undefined)

        expect(streamsDuring).toBe(0)
        expect(during).toBe('m1')
        expect(subjectKey()).toBe('m1')

        finish?.({ type: 'success', result: 'reply' })
        await outcome

        expect(subjectKey()).toBe(GROUP_ID)
    })

    // Guard: mid-stream the member is named, as before.
    test('T2.3 the member is named mid-stream', async () => {
        installGroupWorld()
        const source = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })

        const outcome = sendChat(1)
        await waitFor('the stream', () => activeStreams().length === 1)
        source.push('partial')
        await settle()

        expect(activeStreams()[0].memberChaId).toBe('m2')
        expect(subjectKey()).toBe('m2')

        source.close()
        await outcome

        expect(subjectKey()).toBe(GROUP_ID)
    })
})
