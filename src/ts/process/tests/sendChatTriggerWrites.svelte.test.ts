// @vitest-environment node

/**
 * W1a `sendChat` suite: drives the REAL `sendChat`/`sendChatBody`
 * (`src/ts/process/index.svelte.ts`) with the REAL trigger engine
 * (`../triggers`) and the REAL Lua-engine module (`../scriptings` --
 * unmocked, though no fixture here defines a `triggerlua` effect, so no Lua
 * VM is ever constructed and wasmoon's WASM loader is never reached).
 *
 * Built on `sendChatSaveMarks.svelte.test.ts`'s mock set (itself built on
 * `sendChatColdGuard.svelte.test.ts`'s precedent for driving this exact
 * module for real), extended with what `../triggers`/`../scriptings`
 * additionally need for real: `../command`, `../../parser/chatVar.svelte`,
 * `../../globalApi.svelte`'s `fetchNative`, `../../util`'s `asBuffer` and
 * `getUserIcon`, and a real-shaped (not throwing) `getDatabase` on
 * `../../storage/database.svelte`. `../triggers` and `../scriptings`
 * themselves are the two modules NOT mocked here -- every other mock below is
 * either a network-facing stub (matching the sibling suites) or a
 * real-shaped re-implementation reading/writing the same mocked
 * `DBState`/`selectedCharID`, disclosed inline.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { Database, character as CharacterType, Chat as ChatType } from '../../storage/database.svelte'
import type { triggerscript, triggerEffect } from '../triggers'
// Installs the real `globalThis.safeStructuredClone`, the same way
// `src/main.ts` does (`import "./ts/polyfill"`): `sendChatBody`'s own
// `safeStructuredClone(DBState.db.promptTemplate)` needs the real clone --
// `vitest.setup.ts`'s JSON-based stand-in throws on an `undefined` field
// (this suite's fixture leaves `promptTemplate` undefined). The real clone
// also matters for a live `$state` Proxy in general (the browser build's
// own `DBState.db`), though this suite's own `DBState.db` is a plain object:
// this file compiles under `@vitest-environment node`, where Svelte
// generates `$state()` for the server, not as a reactive Proxy.
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

// Real-shaped: mirrors database.svelte.ts's own
// getCurrentCharacter/getCurrentChat/setCurrentCharacter/setCurrentChat,
// reading and writing through the SAME mocked DBState/selectedCharID below --
// `../triggers` calls all four (plus `getDatabase`, which the
// `sendChatSaveMarks` sibling deliberately makes throw, since it never
// reaches `../triggers` for real; here it must return the live db instead).
vi.mock(import('../../storage/database.svelte'), async () => {
    const stores = await import('../../stores.svelte')
    const DBState = stores.DBState as unknown as { db: any }
    const selectedCharID = stores.selectedCharID
    const getCurrentCharacter = () => {
        DBState.db.characters ??= []
        return DBState.db.characters[get(selectedCharID)]
    }
    const getCurrentChat = () => {
        const char = getCurrentCharacter()
        return char?.chats?.[char.chatPage]
    }
    return {
        presetTemplate: { name: 'test-preset' },
        changeToPreset: vi.fn(),
        getDatabase: vi.fn(() => DBState.db),
        setDatabase: vi.fn((d: unknown) => { DBState.db = d }),
        getCurrentCharacter: vi.fn(getCurrentCharacter),
        getCurrentChat: vi.fn(getCurrentChat),
        setCurrentCharacter: vi.fn((char: unknown) => {
            DBState.db.characters ??= []
            DBState.db.characters[get(selectedCharID)] = char
        }),
        setCurrentChat: vi.fn((chat: unknown) => {
            const char = getCurrentCharacter()
            char.chats[char.chatPage] = chat
        }),
    } as unknown as typeof import('../../storage/database.svelte')
})

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        CharEmotion: writable({}),
        selectedCharID: writable(-1),
        ReloadChatPointer: writable({} as Record<number, number>),
        ReloadGUIPointer: writable(0),
        CurrentTriggerIdStore: writable(null),
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

const alertInputMock = vi.hoisted(() => vi.fn(async () => ''))

vi.mock(import('../../alert'), () => ({
    alertError: vi.fn(),
    alertToast: vi.fn(),
    alertInput: alertInputMock,
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('../../parser/chatML'))

// Identity pass-through -- `../triggers` calls this directly for condition/
// value parsing; none of this suite's fixtures rely on CBS substitution.
vi.mock(import('../../parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('../../parser/parser.svelte'))

// Harmless no-ops -- W1b's territory (CBS `{{setvar}}`/Lua `setChatVar`),
// not exercised by any fixture here (no `triggerlua` effect, no CBS parse).
vi.mock(import('../../parser/chatVar.svelte'), () => ({
    getChatVar: vi.fn(() => ''),
    getGlobalChatVar: vi.fn(() => ''),
    setChatVar: vi.fn(),
}) as unknown as typeof import('../../parser/chatVar.svelte'))

vi.mock(import('../lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
}) as unknown as typeof import('../lorebook.svelte'))

vi.mock(import('../../util'), () => ({
    asBuffer: vi.fn(),
    findCharacterbyId: vi.fn(() => undefined),
    getAuthorNoteDefaultText: vi.fn(() => ''),
    getPersonaPrompt: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    getUserIcon: vi.fn(() => ''),
    isLastCharPunctuation: vi.fn(() => true),
    trimUntilPunctuation: vi.fn((s: string) => s),
    parseToggleSyntax: vi.fn(() => []),
    prebuiltAssetCommand: vi.fn(() => ''),
    // Real (not faked): `../triggers` needs its actual "key=value" per-line
    // parse for `defaultVariables`/`templateDefaultVariables`.
    parseKeyValue: (template: string) => {
        if (!template) return []
        const kv: [string, string][] = []
        for (const line of template.split('\n')) {
            const [key, value] = line.split('=')
            if (key && value) kv.push([key, value])
        }
        return kv
    },
    // Real: a genuine setTimeout-based wait, needed by `../triggers`'s
    // `v2Wait` effect (the cutchat guard below uses no wait, but this keeps
    // the mock real-shaped for any future addition).
    sleep: (ms: number) => new Promise((res) => setTimeout(res, ms)),
}) as unknown as typeof import('../../util'))

const requestChatDataMock = vi.hoisted(() => vi.fn())

vi.mock(import('../request/request'), () => ({
    requestChatData: requestChatDataMock,
}) as unknown as typeof import('../request/request'))

vi.mock(import('../stableDiff'), () => ({
    stableDiff: vi.fn(),
    generateAIImage: vi.fn(async () => null),
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

vi.mock(import('../memory/hypamemory'), () => ({
    HypaProcesser: class {},
}) as unknown as typeof import('../memory/hypamemory'))

vi.mock(import('../embedding/addinfo'), () => ({
    additionalInformations: vi.fn(async () => ''),
}) as unknown as typeof import('../embedding/addinfo'))

vi.mock(import('../files/inlays'), () => ({
    getInlayAsset: vi.fn(),
    writeInlayImage: vi.fn(async () => 'inlay-id'),
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

vi.mock(import('../../model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ flags: [] })),
    LLMFlags: {},
}) as unknown as typeof import('../../model/modellist'))

vi.mock(import('../memory/hypav3'), () => ({
    hypaMemoryV3: vi.fn(),
}) as unknown as typeof import('../memory/hypav3'))

// Real-shaped: `../triggers` calls `getModuleTriggers()` on every run and
// `../scriptings`' `runLuaEditTrigger` (real, called by `index.svelte.ts`
// for `editRequest`) calls it too -- no fixture here defines a module
// trigger, so [] is both real-shaped and correct for every test.
vi.mock(import('../modules'), () => ({
    getModuleAssets: vi.fn(() => []),
    getModuleToggles: vi.fn(() => ''),
    getModuleTriggers: vi.fn(() => []),
    getModuleLorebooks: vi.fn(() => []),
}) as unknown as typeof import('../modules'))

vi.mock(import('../../globalApi.svelte'), () => ({
    readImage: vi.fn(),
    fetchNative: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../plugins/plugins.svelte'), () => ({
    pluginV2: { chatOutput: new Set() },
}) as unknown as typeof import('../../plugins/plugins.svelte'))

// `../command` -- needed only by `../triggers`'s `v2Command`/`command`
// effects (`processMultiCommand`); no fixture here uses either.
vi.mock(import('../command'), () => ({
    processMultiCommand: vi.fn(async () => {}),
}) as unknown as typeof import('../command'))

//#endregion

import { sendChat, doingChat } from '../index.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'

//#region fixtures

type CharacterFixture = Database['characters'][number]

function v2(type: string, fields: Record<string, unknown> = {}): triggerEffect {
    return { type, indent: 0, ...fields } as unknown as triggerEffect
}

function trig(comment: string, type: string, effect: unknown[]): triggerscript {
    return { comment, type, conditions: [], effect } as unknown as triggerscript
}

function makeChat(id: string, overrides: Record<string, unknown> = {}): ChatType {
    return {
        id,
        note: '',
        name: '',
        localLore: [],
        fmIndex: -1,
        scriptstate: {},
        message: [{ role: 'user', data: 'Hi', time: 1 }],
        ...overrides,
    } as unknown as ChatType
}

function makeCharacter(chaId: string, chats: ChatType[], chatPage: number, overrides: Record<string, unknown> = {}): CharacterType {
    return {
        chaId,
        name: chaId,
        type: 'character',
        chatPage,
        firstMessage: 'Hello!',
        alternateGreetings: [],
        desc: 'A test character.',
        bias: [],
        defaultVariables: '',
        triggerscript: [] as unknown[],
        customscript: [] as unknown[],
        replaceGlobalNote: undefined,
        systemPrompt: undefined,
        utilityBot: false,
        inlayViewScreen: false,
        viewScreen: undefined,
        depth_prompt: undefined,
        reloadKeys: 0,
        chats,
        ...overrides,
    } as unknown as CharacterType
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
        templateDefaultVariables: '',
        characterOrder: characters.map((c) => (c as unknown as { chaId: string }).chaId),
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
    } as unknown as Database
}

/** A gate `alertInput` blocks on, plus a signal for "the call has happened". */
function makeAlertGate() {
    let reachedResolve: () => void = () => {}
    const reached = new Promise<void>((res) => { reachedResolve = res })
    let release: () => void = () => {}
    const gate = new Promise<string>((res) => { release = () => res('gate-answer') })
    alertInputMock.mockImplementationOnce(async () => {
        reachedResolve()
        return gate
    })
    return { reached, release }
}

function mockNonStreamingReply(text = 'a reply') {
    requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: text })
}

function mockStreamingReply(chunks: string[]) {
    let i = 0
    const stream = new ReadableStream<{ data: string }>({
        pull(controller) {
            if (i < chunks.length) {
                controller.enqueue({ data: chunks[i] })
                i++
            } else {
                controller.close()
            }
        },
    })
    requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: stream })
}

beforeEach(() => {
    requestChatDataMock.mockReset()
    alertInputMock.mockReset()
    alertInputMock.mockImplementation(async () => '')
    doingChat.set(false)
})

//#endregion

describe('sendChat: an output trigger and a Branch-style unshift during its wait', () => {
    test.each([
        ['streaming', 0] as const,
        ['streaming', 1] as const,
        ['non-streaming', 0] as const,
        ['non-streaming', 1] as const,
    ])('site=%s, origin chatPage=%i', async (site, chatPageIndex) => {
        const before = chatPageIndex === 0 ? [] : [makeChat('chat-before')]
        const origin = makeChat('chat-origin', { scriptstate: {} })
        const after = [makeChat('chat-after')]
        const chats = [...before, origin, ...after]
        const char = makeCharacter('char-branch', chats, chatPageIndex)
        char.triggerscript.push(trig('t', 'output', [
            v2('v2GetAlertInput', { display: 'w', displayType: 'value', outputVar: 'gv' }),
            v2('v2SetVar', { operator: '=', var: 'marker', valueType: 'value', value: 'written' }),
        ]))
        installDb([char])
        selectedCharID.set(0)

        if (site === 'streaming') {
            mockStreamingReply(['Hello '])
        } else {
            mockNonStreamingReply('Hello')
        }
        const { reached, release } = makeAlertGate()

        const p = sendChat()
        await reached

        // A Branch-style unshift of a $state.snapshot copy with a fresh id,
        // onto the SAME character, while the output trigger is paused on
        // its alert.
        const originLive = DBState.db.characters[0].chats.find((c: ChatType) => c.id === 'chat-origin')
        const branchCopy = { ...($state.snapshot(originLive) as object), id: 'chat-branch-copy' } as unknown as ChatType
        DBState.db.characters[0].chats.unshift(branchCopy)

        release()
        await p

        const idsAfter = (DBState.db.characters[0].chats as ChatType[]).map((c) => c.id)
        expect(new Set(idsAfter).size).toBe(idsAfter.length)
        expect(idsAfter).toContain('chat-branch-copy')
        if (chatPageIndex !== 0) {
            expect(idsAfter).toContain('chat-before')
        }
        expect(idsAfter).toContain('chat-after')
        expect((originLive as unknown as { scriptstate: Record<string, string> }).scriptstate?.['$marker']).toBe('written')
    })
})

describe('sendChat: the start trigger\'s cutchat is reflected in the prompt (guard)', () => {
    test('requestChatData receives the cut-down history, not the pre-cut one', async () => {
        const origin = makeChat('chat-cut', {
            message: [
                { role: 'user', data: 'msg-keep', time: 1 },
                { role: 'user', data: 'msg-dropped', time: 2 },
            ],
        })
        const char = makeCharacter('char-cutstart', [origin], 0)
        char.triggerscript.push(trig('t', 'start', [
            v2('v2CutChat', { start: '0', startType: 'value', end: '1', endType: 'value' }),
        ]))
        installDb([char])
        selectedCharID.set(0)
        mockNonStreamingReply('reply')

        await sendChat()

        expect(requestChatDataMock).toHaveBeenCalledTimes(1)
        const formated = requestChatDataMock.mock.calls[0][0].formated as { content: string }[]
        const contents = formated.map((c) => c.content).join('\n')
        expect(contents).toContain('msg-keep')
        expect(contents).not.toContain('msg-dropped')
    })
})

describe('sendChat: the start trigger and a gone origin', () => {
    test('the send stops, doingChat clears, and nothing is generated', async () => {
        const origin = makeChat('chat-gone-start')
        const char = makeCharacter('char-gonestart', [origin], 0)
        char.triggerscript.push(trig('t', 'start', [
            v2('v2GetAlertInput', { display: 'w', displayType: 'value', outputVar: 'gv' }),
            v2('v2SetVar', { operator: '=', var: 'marker', valueType: 'value', value: 'written' }),
        ]))
        installDb([char])
        selectedCharID.set(0)
        mockNonStreamingReply('reply')
        const { reached, release } = makeAlertGate()

        const p = sendChat()
        await reached

        char.chats.splice(0, 1) // the origin chat is gone, during the trigger's wait

        release()
        let result: boolean | undefined
        let threw = false
        try {
            result = await p
        } catch {
            threw = true
        }

        expect(threw).toBe(false)
        expect(requestChatDataMock).not.toHaveBeenCalled()
        expect(get(doingChat)).toBe(false)
        expect(result).toBe(false)
    })
})

describe('sendChat: the start trigger and an ambiguous origin', () => {
    test('the trigger\'s write does not land, but the send carries on and generates', async () => {
        const origin = makeChat('chat-ambig-start', { scriptstate: {} })
        const char = makeCharacter('char-ambigstart', [origin], 0)
        char.triggerscript.push(trig('t', 'start', [
            v2('v2GetAlertInput', { display: 'w', displayType: 'value', outputVar: 'gv' }),
            v2('v2SetVar', { operator: '=', var: 'marker', valueType: 'value', value: 'written' }),
        ]))
        installDb([char])
        selectedCharID.set(0)
        mockNonStreamingReply('reply')
        const { reached, release } = makeAlertGate()

        const p = sendChat()
        await reached

        char.chats.push(makeChat('chat-ambig-start')) // a duplicate id appears, during the wait

        release()
        const result = await p

        expect(result).toBe(true)
        expect(requestChatDataMock).toHaveBeenCalledTimes(1)
        expect((origin as unknown as { scriptstate: Record<string, string> }).scriptstate?.['$marker']).toBeUndefined()
    })
})
