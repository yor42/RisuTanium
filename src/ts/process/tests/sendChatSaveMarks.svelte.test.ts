/**
 * CHORE-01:
 *
 * Generation continuing after a selection change: the outer `sendChat`
 * (`src/ts/process/index.svelte.ts`) fixes the origin of the send -- the
 * generating character's chaId and its chat's id -- at the start, and its
 * `finally` marks that character for save, AFTER the body (and any nested
 * auto-continue recursion) has fully settled -- so a selection change made
 * WHILE a reply is still streaming (hotkeys, Playground and Home buttons all
 * change selection without checking `doingChat`) doesn't leave the
 * generating character's effect-6 tracking orphaned once the user has moved
 * away from it.
 *
 * This test starts a generation on character 0 (selected), switches
 * `selectedCharID` to character 1 WHILE the reply is still streaming (via a
 * controlled `ReadableStream`'s own `pull()`, so the timing is deterministic,
 * not a real race), lets the stream finish, then proves -- through the REAL
 * `registerDbChangeEffects` and the REAL `RisuSaveEncoder` (encode -> decode
 * round trip) -- that the full reply landed in character 0 and is what gets
 * persisted, not lost to the next save.
 *
 * Drives the REAL, unmocked `sendChat` (`index.svelte.ts`). Every other
 * module it imports is mocked below purely so the module can be loaded and
 * exercised without touching real AI providers, storage backends, etc. The
 * mock set for `index.svelte.ts`'s own dependency graph is copied, extended
 * to let a full (non-early-return) generation complete, from
 * `src/ts/process/tests/sendChatColdGuard.svelte.test.ts` (the existing
 * precedent for driving this exact module for real).
 */
import { flushSync } from 'svelte'
import { describe, test, expect, vi } from 'vitest'
import { writable, get } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import type { toSaveType } from '../../storage/risuSave'
// Installs the real `globalThis.safeStructuredClone`, the same way
// `src/main.ts` does (`import "./ts/polyfill"`): this test's save-mark
// assertions need the real clone, not vitest.setup.ts's JSON-based stand-in.
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
import { registerDbChangeEffects } from '../../storage/dbChangeEffects.svelte'
import { RisuSaveEncoder, decodeRisuSave } from '../../storage/risuSave'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from '../../storage/characterSaveMarks'

//#region fixtures

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        chatPage: 0,
        firstMessage: 'Hello!',
        alternateGreetings: [],
        desc: 'A test character.',
        bias: [],
        replaceGlobalNote: undefined,
        systemPrompt: undefined,
        utilityBot: false,
        inlayViewScreen: false,
        viewScreen: undefined,
        depth_prompt: undefined,
        reloadKeys: 0,
        chats: [{
            id: `${chaId}-chat-0`,
            note: '',
            name: '',
            localLore: [],
            fmIndex: -1,
            message: [{ role: 'user', data: 'Hi', time: 1 }],
        }],
    } as unknown as CharacterFixture
}

function installDb(): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: ['char-0', 'char-1'],
        characters: [
            makeCharacter('char-0', 'Character Zero (generating)'),
            makeCharacter('char-1', 'Character One (switched to mid-stream)'),
        ],
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
    } as unknown as Database
}

function makeTracker(): toSaveType {
    return {
        character: [],
        chat: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false,
    }
}

function snapshotDb(db: Database): Database {
    return $state.snapshot(db) as Database
}

//#endregion

describe('sendChat — generation after a selection change', () => {
    test('a selection change mid-stream does not lose the reply: the full reply lands in the original character and is persisted', async () => {
        installDb()
        selectedCharID.set(0)
        doingChat.set(false)

        const tracker = makeTracker()
        const markChanged = vi.fn()
        const cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        installCharacterSaveMarks({ tracker, schedule: () => {} })

        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })
        // Mirrors saveDb()'s post-init trim.
        tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]

        let pullCount = 0
        const stream = new ReadableStream<{ data: string }>({
            pull(controller) {
                if (pullCount === 0) {
                    controller.enqueue({ data: 'Hello ' })
                    pullCount++
                } else if (pullCount === 1) {
                    // Mid-stream: the user switches away from the generating
                    // character (e.g. a hotkey, Playground, or Home button --
                    // none of which check `doingChat`), BEFORE the reply
                    // finishes streaming.
                    selectedCharID.set(1)
                    flushSync() // effect 6 unshifts char-1 to the tracker's front
                    // A save cycle's debounce fires WHILE the reply is still
                    // streaming (very plausible over a multi-second
                    // generation) -- mirrors saveDb()'s post-init/post-snapshot
                    // trim, which keeps ONLY the current front. Without the
                    // outer sendChat's own mark, this is the exact moment
                    // character 0 (mid-reply, no longer selected) falls out of
                    // the tracker for good.
                    tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]
                    controller.enqueue({ data: 'Hello World!' }) // cumulative
                    pullCount++
                } else {
                    controller.close()
                }
            },
        })
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: stream })

        const result = await sendChat()
        expect(result).toBe(true)

        // The reply landed in character 0 (the one generating), addressed by
        // its origin -- unaffected by the selection change, since
        // sendChatBody writes through the origin, not the current selection.
        expect(DBState.db.characters[0].chats[0].message[1].data).toBe('Hello World!')
        expect(get(selectedCharID)).toBe(1) // selection really did move

        flushSync()

        const toSave = structuredClone(tracker) as toSaveType
        // THE MARK -- without it, character 0 (no longer selected) would
        // never enter tracker.character once selection moved to character 1,
        // and the reply would be silently lost on the next save.
        expect(toSave.character).toContain('char-0')

        await encoder.set(snapshotDb(DBState.db), toSave)
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedChar0 = decoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-0')
        expect(decodedChar0).toBeTruthy()
        expect(decodedChar0!.chats[0].message[1].data).toBe('Hello World!')

        cleanup()
        resetCharacterSaveMarksForTest()
    })
})
