// @vitest-environment happy-dom

/**
 * `LoadLocalBackup` writes nothing while a send is streaming.
 *
 * Drives the real `LoadLocalBackup` (`src/ts/drive/backuplocal.ts`) with the
 * real `globalApi.svelte.ts` while a real `sendChat` holds its provider request.
 * A restore that reaches its write keeps `dbWriteLock` closed for the life of the
 * module instance, so each `LoadLocalBackup` scenario has a file of its own.
 * Storage, the provider and the modules they import are mocked; nothing here
 * proves native (Tauri) file behaviour.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { Database, Chat, Message } from 'src/ts/storage/database.svelte'
import type { RisuPlugin } from 'src/ts/plugins/plugins.svelte'
import type { Origin } from 'src/ts/process/chatOrigin'
import type { CommandContext } from 'src/ts/process/command'
// Installs the real `globalThis.safeStructuredClone`, the same way
// `src/main.ts` does (`import "./ts/polyfill"`).
import 'src/ts/polyfill'

//#region module mocks

interface ChatOutputArg {
    char: { chaId?: string }
    chat: { id?: string }
    characterIndex: number
    chatIndex: number
    messageIndex: number
}

/** What the trigger engine is handed for a run: the parts a command effect passes on. */
interface TriggerRunArg {
    origin?: Origin
    signal?: AbortSignal
    ownsWindow?: boolean
}

type TriggerHandler = (arg: TriggerRunArg) => unknown

const requestChatDataMock = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())
const runTriggerMock = vi.hoisted(() => vi.fn())
const triggerHandlers = vi.hoisted(() => ({} as Record<string, TriggerHandler | undefined>))
const downloadFileMock = vi.hoisted(() => vi.fn(async () => {}))
const platformBox = vi.hoisted(() => ({ isTauri: false }))
const isLastCharPunctuationMock = vi.hoisted(() => vi.fn())
const chatOutputListeners = vi.hoisted(() => new Set<(arg: ChatOutputArg) => unknown>())
const interceptedSleeps = vi.hoisted(() => new Map<number, { gate: Promise<void>, markReached: () => void }>())
const alertConfirmMock = vi.hoisted(() => vi.fn(async (_msg: string) => true))
const alertSelectMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => '1'))
const alertNormalMock = vi.hoisted(() => vi.fn())
const forageMemStore = vi.hoisted(() => new Map<string, unknown>())
const forageHooks = vi.hoisted(() => ({ onGetItem: undefined as undefined | ((key: string) => Promise<void> | void) }))
const decodeHooks = vi.hoisted(() => ({ onDecode: undefined as undefined | (() => Promise<void> | void) }))
const coldHooks = vi.hoisted(() => ({ onConfirmIncomplete: undefined as undefined | (() => Promise<void> | void) }))

vi.hoisted(() => {
    // navigator.locks is read once, when globalApi.svelte.ts is evaluated: a
    // single-tab stand-in must be in place before any import below.
    type LockMode = 'shared' | 'exclusive'
    interface Queued { mode: LockMode, callback: (lock: { name: string, mode: LockMode }) => Promise<unknown>, resolve: (v: unknown) => void, reject: (e: unknown) => void }
    class FakeSingleTabLockManager {
        private held: { mode: LockMode }[] = []
        private queue: Queued[] = []
        request(_name: string, options: { mode?: LockMode, signal?: AbortSignal }, callback: (lock: { name: string, mode: LockMode }) => Promise<unknown>): Promise<unknown> {
            return new Promise((resolve, reject) => {
                const req: Queued = { mode: options.mode ?? 'exclusive', callback, resolve, reject }
                if (options.signal) {
                    options.signal.addEventListener('abort', () => {
                        const i = this.queue.indexOf(req)
                        if (i >= 0) {
                            this.queue.splice(i, 1)
                            reject(new DOMException('The request was aborted.', 'AbortError'))
                            this.pump()
                        }
                    })
                }
                this.queue.push(req)
                this.pump()
            })
        }
        private grantable(req: Queued): boolean {
            if (this.queue[0] !== req) return false
            if (req.mode === 'exclusive') return this.held.length === 0
            return !this.held.some((h) => h.mode === 'exclusive')
        }
        private pump() {
            while (this.queue.length && this.grantable(this.queue[0])) {
                const req = this.queue.shift() as Queued
                const lock = { mode: req.mode }
                this.held.push(lock)
                Promise.resolve()
                    .then(() => req.callback({ name: 'risu-storage-tab-presence', mode: req.mode }))
                    .then((value) => {
                        const i = this.held.indexOf(lock)
                        if (i >= 0) this.held.splice(i, 1)
                        req.resolve(value)
                        this.pump()
                    })
            }
        }
    }
    Object.defineProperty(window.navigator, 'locks', { value: new FakeSingleTabLockManager(), configurable: true })
})

const hasherMock = vi.hoisted(() => vi.fn(async (data: Uint8Array) => `hash:${new TextDecoder().decode(data)}`))

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

vi.mock('dompurify', () => ({
    default: { sanitize: (v: string) => v },
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformBox.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        CharEmotion: writable({}),
        selectedCharID: writable(-1),
        ReloadChatPointer: writable({} as Record<number, number>),
        ReloadGUIPointer: writable(0),
        CurrentTriggerIdStore: writable(null),
        additionalChatMenu: [],
        additionalFloatingActionButtons: [],
        additionalHamburgerMenu: [],
        additionalSettingsMenu: [],
        bodyIntercepterStore: [],
        chatPanelStore: [],
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        botMakerMode: writable(false),
        loadedStore: writable(false),
        LoadingStatusState: { text: '' },
        savingStoppedReason: writable(null),
        frozenSaveKeysStore: writable([]),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    const live = stores.DBState as unknown as { db: { characters: Array<{ chatPage: number, chats: unknown[] }> } }
    const currentCharacter = () => live.db.characters[get(stores.selectedCharID)]
    return {
        changeToPreset: vi.fn(),
        presetTemplate: { name: 'test-preset' },
        getDatabase: vi.fn(() => live.db),
        setDatabase: vi.fn((d: unknown) => { live.db = d as never }),
        getCurrentCharacter: vi.fn(() => currentCharacter()),
        getCurrentChat: vi.fn(() => {
            const char = currentCharacter()
            return char?.chats?.[char.chatPage]
        }),
        setCurrentChat: vi.fn(),
        defaultSdDataFunc: vi.fn(() => ({})),
        appVer: 'test',
        appSubVer: 'test',
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/tokenizer'), () => ({
    ChatTokenizer: class {
        constructor(_extra: number, _mode: string) {}
        async tokenizeChat(_chat: unknown) { return 1 }
    },
    tokenize: vi.fn(async () => 1),
    tokenizeNum: vi.fn(async () => [] as number[]),
}) as unknown as typeof import('src/ts/tokenizer'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: alertErrorMock,
    alertToast: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertMd: vi.fn(),
    alertNormal: alertNormalMock,
    alertSelect: alertSelectMock,
    alertConfirm: alertConfirmMock,
    alertWait: vi.fn(),
    alertClear: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('src/ts/parser/chatML'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: hasherMock,
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/util'), async () => {
    const stores = await import('src/ts/stores.svelte')
    const state = stores.DBState as unknown as { db: { characters: Array<{ chaId?: string, type?: string }> } }
    return {
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
        changeFullscreen: vi.fn(),
        checkNullish: (v: unknown) => v === null || v === undefined,
        sleepForever: vi.fn(async () => {}),
        getAuthorNoteDefaultText: vi.fn(() => ''),
        getPersonaPrompt: vi.fn(() => ''),
        getUserName: vi.fn(() => 'User'),
        getUserIcon: vi.fn(() => ''),
        checkPersonaBinded: vi.fn(() => false),
        asBuffer: vi.fn(),
        selectSingleFile: vi.fn(),
        selectMultipleFile: vi.fn(),
        BufferToText: (data: Uint8Array) => new TextDecoder().decode(data),
        isLastCharPunctuation: isLastCharPunctuationMock,
        trimUntilPunctuation: vi.fn((s: string) => s),
        parseToggleSyntax: vi.fn(() => []),
        prebuiltAssetCommand: vi.fn(() => ''),
        // `ms === 10` is the composer's own wait after it appends the message;
        // a test parks it with `interceptedSleeps`. Any other duration is a
        // real timer.
        sleep: vi.fn((ms: number) => {
            const intercepted = interceptedSleeps.get(ms)
            if (intercepted) {
                intercepted.markReached()
                return intercepted.gate
            }
            return new Promise<void>((res) => setTimeout(res, ms))
        }),
    } as unknown as typeof import('src/ts/util')
})

vi.mock(import('src/ts/process/request/request'), () => ({
    requestChatData: requestChatDataMock,
    requestChatDataMain: vi.fn(),
}) as unknown as typeof import('src/ts/process/request/request'))

vi.mock(import('src/ts/process/stableDiff'), () => ({
    stableDiff: vi.fn(),
}) as unknown as typeof import('src/ts/process/stableDiff'))

vi.mock(import('src/ts/process/scripts'), () => ({
    processScript: vi.fn(async (_char: unknown, text: string) => text),
    processScriptFull: vi.fn(async (_char: unknown, text: string) => ({ data: text, emoChanged: false })),
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/process/exampleMessages'), () => ({
    exampleMessage: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/exampleMessages'))

vi.mock(import('src/ts/process/tts'), () => ({
    sayTTS: vi.fn(),
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/process/ttsHooks'), () => ({
    registerTTSPreprocessor: vi.fn(),
    unregisterTTSPreprocessor: vi.fn(),
    registerTTSPostprocessor: vi.fn(),
    unregisterTTSPostprocessor: vi.fn(),
}) as unknown as typeof import('src/ts/process/ttsHooks'))

vi.mock(import('src/ts/process/memory/supaMemory'), () => ({
    supaMemory: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/supaMemory'))

vi.mock(import('src/ts/process/group'), () => ({
    groupOrder: vi.fn((order: unknown) => order),
}) as unknown as typeof import('src/ts/process/group'))

vi.mock(import('src/ts/process/triggers'), () => ({
    runTrigger: runTriggerMock,
}) as unknown as typeof import('src/ts/process/triggers'))

vi.mock(import('src/ts/process/memory/hypamemory'), () => ({
    HypaProcesser: class {},
}) as unknown as typeof import('src/ts/process/memory/hypamemory'))

vi.mock(import('src/ts/process/embedding/addinfo'), () => ({
    additionalInformations: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/process/embedding/addinfo'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
    writeInlayImage: vi.fn(async () => 'inlay-id'),
    postInlayAsset: vi.fn(),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/models/modelString'), () => ({
    getGenerationModelString: vi.fn(() => undefined),
}) as unknown as typeof import('src/ts/process/models/modelString'))

vi.mock(import('src/ts/process/inlayScreen'), () => ({
    runInlayScreen: vi.fn((_char: unknown, text: string) => ({ text, promise: undefined })),
}) as unknown as typeof import('src/ts/process/inlayScreen'))

vi.mock(import('src/ts/process/prereroll'), () => ({
    addRerolls: vi.fn(),
    Prereroll: vi.fn(() => undefined),
    PreUnreroll: vi.fn(() => undefined),
}) as unknown as typeof import('src/ts/process/prereroll'))

vi.mock(import('src/ts/process/transformers'), () => ({
    runImageEmbedding: vi.fn(),
}) as unknown as typeof import('src/ts/process/transformers'))

vi.mock(import('src/ts/process/memory/hanuraiMemory'), () => ({
    hanuraiMemory: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/hanuraiMemory'))

vi.mock(import('src/ts/process/memory/hypav2'), () => ({
    hypaMemoryV2: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/hypav2'))

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    hypaMemoryV3: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/process/scriptings'), () => ({
    runLuaEditTrigger: vi.fn(async (_char: unknown, _type: string, formated: unknown) => formated),
}) as unknown as typeof import('src/ts/process/scriptings'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ id: 'test-model', flags: [] })),
    LLMFlags: {},
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => {}),
    getModuleAssets: vi.fn(() => []),
    getModuleToggles: vi.fn(() => ''),
    getModuleLorebooks: vi.fn(() => []),
    getModuleTriggers: vi.fn(() => []),
    getModuleRegexScripts: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/translator/translator'), () => ({
    isExpTranslator: vi.fn(() => false),
    translate: vi.fn(async () => ''),
    getLLMCache: vi.fn(),
    searchLLMCache: vi.fn(),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    allowedDbKeys: [],
    loadPlugins: vi.fn(async () => {}),
    customProviderStore: { providers: new Map() },
    getV2PluginAPIs: () => ({
        safeLocalStorage: {
            getItem: vi.fn(),
            setItem: vi.fn(),
            removeItem: vi.fn(),
            clear: vi.fn(),
            key: vi.fn(),
            keys: vi.fn(),
        },
    }),
    handlePluginInstallViaPlugin: vi.fn(),
    pluginV2: { providers: new Map(), chatOutput: chatOutputListeners },
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/plugins/apiV3/factory'), () => ({
    SandboxHost: class {},
}) as unknown as typeof import('src/ts/plugins/apiV3/factory'))

vi.mock(import('src/ts/plugins/pluginSafeClass'), () => ({
    SafeLocalPluginStorage: class {},
    tagWhitelist: [],
}) as unknown as typeof import('src/ts/plugins/pluginSafeClass'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    changeColorScheme: vi.fn(),
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/process/mcp/pluginmcp'), () => ({
    registerMCPModule: vi.fn(),
    unregisterMCPModule: vi.fn(),
}) as unknown as typeof import('src/ts/process/mcp/pluginmcp'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    setColdStorageItem: vi.fn(async () => true),
    readColdStorageItem: vi.fn(),
    getColdStorageItem: vi.fn(async () => null),
    collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
    confirmIncompleteColdStorageOperation: vi.fn(async () => {
        await coldHooks.onConfirmIncomplete?.()
        return true
    }),
    getColdStorageBackupKey: vi.fn(() => null),
    isColdStorageBackupData: vi.fn(() => false),
    listColdDataKeys: vi.fn(async () => []),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: vi.fn(async () => undefined),
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
    open: vi.fn(async () => {}),
}))

vi.mock('streamsaver', () => ({
    default: {},
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({
        listen: vi.fn(),
        setTitle: vi.fn(),
    })),
}))

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: vi.fn(async () => {}),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => null),
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => vi.fn()),
}))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        getItem = vi.fn(async (key: string) => {
            await forageHooks.onGetItem?.(key)
            return forageMemStore.get(key) ?? null
        })
        setItem = vi.fn(async (key: string, value: unknown) => { forageMemStore.set(key, value) })
        keys = vi.fn(async () => Array.from(forageMemStore.keys()))
        removeItem = vi.fn(async (key: string) => { forageMemStore.delete(key) })
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))

vi.mock(import('src/ts/storage/risuSave'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        decodeRisuSave: async (...args: Parameters<typeof actual.decodeRisuSave>) => {
            await decodeHooks.onDecode?.()
            return actual.decodeRisuSave(...args)
        },
    }
})

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/observer.svelte'), () => ({
    startObserveDom: vi.fn(),
}) as unknown as typeof import('src/ts/observer.svelte'))

vi.mock(import('src/ts/gui/guisize'), () => ({
    updateGuisize: vi.fn(),
}) as unknown as typeof import('src/ts/gui/guisize'))

vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((v: unknown) => v),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('src/ts/hotkey'))

//#endregion

import { sendChat, doingChat } from 'src/ts/process/index.svelte'
import { send, reroll, unReroll, runAutoMode, abortChat, isAutoModeActive, resetComposerActionsForTests, type ComposerActionsSource } from 'src/ts/process/composerActions.svelte'
import * as composerDrafts from 'src/ts/process/composerDrafts.svelte'
import { processMultiCommand } from 'src/ts/process/command'
import { postChatFile } from 'src/ts/process/files/multisend'
import { runAutopilot } from 'src/ts/process/devToolActions'
import { makeRisuaiAPIV3 } from 'src/ts/plugins/apiV3/v3.svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { resetLocalDraftsForTest } from 'src/ts/localDrafts'
import { requiresFullEncoderReload } from 'src/ts/globalApi.svelte'
import { loadInternalBackup } from 'src/ts/drive/internalBackup'
import { setDatabase } from 'src/ts/storage/database.svelte'
import { RisuSaveEncoder, encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { LoadLocalBackup } from 'src/ts/drive/backuplocal'
import { isWriting } from 'src/ts/process/chatOrigin'
import { busyKinds, isBusy } from 'src/ts/process/memory/busyActions'

//#region fixtures

type CharacterFixture = Database['characters'][number]

function msg(role: 'user' | 'char', data: string, extra: Record<string, unknown> = {}): Message {
    return { role, data, time: 1, ...extra } as unknown as Message
}

function makeChat(id: string, message: Message[], extra: Record<string, unknown> = {}): Chat {
    return { id, note: '', name: '', localLore: [], fmIndex: -1, message, scriptstate: {}, ...extra } as unknown as Chat
}

function makeCharacter(chaId: string, chats: Chat[], extra: Record<string, unknown> = {}): CharacterFixture {
    return {
        chaId,
        name: chaId,
        type: 'character',
        chatPage: 0,
        firstMessage: 'Hello!',
        alternateGreetings: [],
        desc: `${chaId} description`,
        bias: [],
        replaceGlobalNote: undefined,
        systemPrompt: undefined,
        utilityBot: false,
        inlayViewScreen: false,
        viewScreen: undefined,
        depth_prompt: undefined,
        reloadKeys: 0,
        supaMemory: false,
        triggerscript: [],
        customscript: [],
        globalLore: [],
        chats,
        ...extra,
    } as unknown as CharacterFixture
}

function installWorld(overrides: Record<string, unknown> = {}): void {
    const characters = [makeCharacter('char-0', [makeChat('chat-0', [msg('user', 'Hi')])])]
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
        templateDefaultVariables: '',
        personas: [],
        selectedPersona: 0,
        presetRegex: [],
        useSayNothing: false,
        playMessage: false,
        useAutoTranslateInput: false,
        translatorType: '',
        ...overrides,
    } as unknown as Database
    selectedCharID.set(0)
}

function theChat(): Chat {
    return DBState.db.characters[0].chats[0]
}

/** The text of every message in the chat, in order. */
function contents(): string[] {
    return theChat().message.map((m) => m.data)
}

function draftKey() {
    return { chaId: 'char-0', chatId: 'chat-0' }
}

function seedDraft(text: string): void {
    composerDrafts.write(draftKey(), (record) => { record.messageInput = text })
}

function draftText(): string {
    return composerDrafts.peek(draftKey()).messageInput
}

function makeSource(): ComposerActionsSource {
    return { closeMenu: () => {} }
}

let pluginCounter = 0

/** A v3 plugin API with its own script, so no permission decision is shared between tests. */
function makePluginApi() {
    pluginCounter++
    const plugin: RisuPlugin = {
        name: `ownership-plugin-${pluginCounter}`,
        script: `ownership-script-${pluginCounter}`,
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
    return makeRisuaiAPIV3({} as HTMLIFrameElement, plugin)
}

async function settle(): Promise<void> {
    await new Promise<void>((res) => setTimeout(res, 0))
}

async function until(condition: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
        if (condition()) {
            return
        }
        await settle()
    }
    throw new Error(`timed out waiting for: ${what}`)
}

interface ControlledStream {
    stream: ReadableStream<{ data: string }>
    push(text: string): void
    close(): void
}

function controlledStream(): ControlledStream {
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

interface HeldRequest {
    signal: AbortSignal | undefined
    source: ControlledStream
}

const held: HeldRequest[] = []

/** Every provider request from now on returns a stream the test feeds and closes by hand. */
function holdEveryRequest(): void {
    requestChatDataMock.mockImplementation(async (_arg: unknown, _mode: string, signal?: AbortSignal) => {
        const source = controlledStream()
        held.push({ signal, source })
        return { type: 'streaming', result: source.stream }
    })
}

function closeEveryHeldStream(): void {
    for (const request of held) {
        request.source.close()
    }
}

function mockReply(text: string): void {
    requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: text })
}

/** Waits until `count` requests are held, and feeds the last one a first chunk. */
async function requestHeld(count: number): Promise<HeldRequest> {
    await until(() => held.length >= count, `${count} held request(s)`)
    const request = held[count - 1]
    request.source.push(`chunk ${count}`)
    await settle()
    return request
}

/**
 * Closes every held stream, again and again, until `promise` settles; calls
 * `stop` part-way so a loop that would never end on its own is ended.
 */
async function drain(promise: Promise<unknown>, stop: () => void = () => {}): Promise<void> {
    let done = false
    void promise.then(() => { done = true }, () => { done = true })
    for (let i = 0; i < 80 && !done; i++) {
        closeEveryHeldStream()
        await settle()
        if (i === 25) {
            stop()
        }
    }
    if (!done) {
        throw new Error('the call did not settle although every stream was closed')
    }
}

function stopAutoMode(source: ComposerActionsSource): () => void {
    return () => {
        if (isAutoModeActive()) {
            void runAutoMode(source)
        }
    }
}

function settledOutcome<T>(promise: Promise<T>): Promise<T | Error> {
    return promise.then(
        (value) => value,
        (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
    )
}

interface Observation<T> {
    state: 'pending' | 'resolved' | 'rejected'
    value?: T
    error?: Error
}

/** What `promise` has done after a few macrotasks, without waiting for it. */
async function observe<T>(promise: Promise<T>, ticks = 4): Promise<Observation<T>> {
    const seen: Observation<T> = { state: 'pending' }
    promise.then(
        (value) => { seen.state = 'resolved'; seen.value = value },
        (error: unknown) => { seen.state = 'rejected'; seen.error = error instanceof Error ? error : new Error(String(error)) },
    )
    for (let i = 0; i < ticks; i++) {
        await settle()
    }
    return { ...seen }
}

function makeLatch() {
    let release: () => void = () => {}
    const gate = new Promise<void>((res) => { release = res })
    let markReached: () => void = () => {}
    const reached = new Promise<void>((res) => { markReached = res })
    return { gate, release, reached, markReached }
}

/** Holds the composer's input trigger open: the composer's window stays open until `release`. */
function gateInputTrigger() {
    const { gate, release, reached, markReached } = makeLatch()
    triggerHandlers.input = async () => {
        markReached()
        await gate
    }
    return { release, reached }
}

/**
 * The context a command effect of a run gives its command line: the run's own
 * chat, its cancel signal and whether it owns the composer's window.
 */
function commandContextOf(arg: TriggerRunArg): CommandContext {
    if (!arg.origin) {
        throw new Error('the trigger run carries no origin')
    }
    return { origin: arg.origin, signal: arg.signal, ownsWindow: arg.ownsWindow }
}

/** The context of a line typed in the composer of `char-0`'s chat: it owns the window the take opened. */
function composerCommandContext(): CommandContext {
    return { origin: draftKey(), ownsWindow: true }
}

/**
 * Post File as the chat screen calls it: with the key of the chat it was
 * clicked in and the objects that chat was read through.
 */
function postFile(query: Parameters<typeof postChatFile>[0]): ReturnType<typeof postChatFile> {
    return postChatFile(query, draftKey(), { owner: DBState.db.characters[0], chat: theChat() })
}

/** A `.po` file with one entry per text, each ended by a blank line. */
function poFile(...texts: string[]): { name: string, data: Uint8Array } {
    const body = texts.map((text) => `msgid "${text}"\nmsgstr ""\n\n`).join('')
    return { name: 'job.po', data: new TextEncoder().encode(body) }
}

beforeEach(() => {
    requestChatDataMock.mockReset()
    requestChatDataMock.mockResolvedValue({ type: 'success', result: 'unexpected request.' })
    alertErrorMock.mockReset()
    downloadFileMock.mockClear()
    platformBox.isTauri = false
    for (const key of Object.keys(triggerHandlers)) {
        delete triggerHandlers[key]
    }
    runTriggerMock.mockReset()
    runTriggerMock.mockImplementation(async (_char: unknown, mode: string, arg: TriggerRunArg) => triggerHandlers[mode]?.(arg))
    isLastCharPunctuationMock.mockReset()
    isLastCharPunctuationMock.mockReturnValue(true)
    chatOutputListeners.clear()
    interceptedSleeps.clear()
    held.length = 0
    resetLocalDraftsForTest()
    doingChat.set(false)
})

afterEach(() => {
    closeEveryHeldStream()
    resetComposerActionsForTests()
    selectedCharID.set(-1)
})

//#endregion

//#region backup fixtures

import { isComposerBusy } from 'src/ts/process/composerActions.svelte'
import { language } from 'src/lang'
import { flushSync, mount, unmount } from 'svelte'
import UserSettings from 'src/lib/Setting/Pages/UserSettings.svelte'

async function settleMany(n = 6): Promise<void> {
    for (let i = 0; i < n; i++) {
        flushSync()
        await settle()
    }
}

type CharacterFixtureBk = Database['characters'][number]

function backupCharacter(chaId: string, name: string): CharacterFixtureBk {
    return {
        chaId,
        name,
        type: 'character',
        chatPage: 0,
        chats: [{ id: `${chaId}-chat-0`, message: [], note: '', name: '', localLore: [] }],
    } as unknown as CharacterFixtureBk
}

function backupDb(characters: CharacterFixtureBk[], extra: Record<string, unknown> = {}): Database {
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters,
        ...extra,
    } as unknown as Database
}

/** Stores an internal backup of one character `char-A` where `loadInternalBackup` lists backups. */
async function seedInternalBackup(): Promise<void> {
    const encoder = new RisuSaveEncoder()
    await encoder.init(backupDb([backupCharacter('char-A', 'A from backup')]), { compression: false })
    forageMemStore.set('dbbackup-1700000000', new Uint8Array(encoder.encode()!))
}

function u32le(n: number): Uint8Array {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
}

/** One `[nameLength][name][dataLength][data]` chunk, matching LoadLocalBackup's reader. */
function buildChunk(name: string, data: Uint8Array): Uint8Array {
    const nameBuf = new TextEncoder().encode(name)
    const out = new Uint8Array(4 + nameBuf.length + 4 + data.length)
    let offset = 0
    out.set(u32le(nameBuf.length), offset); offset += 4
    out.set(nameBuf, offset); offset += nameBuf.length
    out.set(u32le(data.length), offset); offset += 4
    out.set(data, offset)
    return out
}

function localBackupBytes(marker: string): { fixture: Uint8Array, dbBytes: Uint8Array } {
    const dbBytes = encodeRisuSaveLegacy({ characters: [], mainPrompt: marker } as unknown as Database, 'noCompression')
    return { fixture: buildChunk('database.risudat', dbBytes), dbBytes }
}

let capturedInput: HTMLInputElement | null = null

/** Drives the real `LoadLocalBackup()` with `bytes` as the chosen file, and awaits its change handler. */
async function loadBackupBytes(bytes: Uint8Array): Promise<void> {
    const realCreateElement = document.createElement.bind(document)
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = realCreateElement(tag)
        if (tag === 'input') {
            capturedInput = el as HTMLInputElement
        }
        return el
    })
    try {
        LoadLocalBackup()
        const input = capturedInput
        if (!input) {
            throw new Error('LoadLocalBackup did not create a file input')
        }
        const file = new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')
        Object.defineProperty(input, 'files', { value: [file], configurable: true })
        await (input.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
    } finally {
        createElementSpy.mockRestore()
    }
}

beforeEach(() => {
    forageMemStore.clear()
    forageHooks.onGetItem = undefined
    decodeHooks.onDecode = undefined
    coldHooks.onConfirmIncomplete = undefined
    requiresFullEncoderReload.state = false
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    alertSelectMock.mockReset()
    alertSelectMock.mockImplementation(async () => '1')
    alertNormalMock.mockReset()
    vi.mocked(setDatabase).mockClear()
})

/** A send held open on its first provider request. */
async function startHeldSendBk(): Promise<{ running: Promise<boolean> }> {
    holdEveryRequest()
    const running = sendChat()
    await requestHeld(1)
    return { running }
}

//#endregion

describe('LoadLocalBackup is registered as busy once its file is chosen', () => {
    test('LoadLocalBackup is registered while it runs and the entry ends when it stops early', async () => {
        installWorld()
        let during: string[] = []
        alertErrorMock.mockImplementation(() => { during = busyKinds() })

        await loadBackupBytes(new Uint8Array([0, 0, 0, 0])).catch(() => {})

        expect(alertErrorMock).toHaveBeenCalled()
        expect(during).toEqual(['backupLoad'])
        expect(isBusy()).toBe(false)
    })

    test('LoadLocalBackup leaves no entry when the picker delivers no file', async () => {
        installWorld()
        const realCreateElement = document.createElement.bind(document)
        const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
            const el = realCreateElement(tag)
            if (tag === 'input') {
                capturedInput = el as HTMLInputElement
            }
            return el
        })
        try {
            LoadLocalBackup()
            const input = capturedInput as HTMLInputElement | null
            Object.defineProperty(input, 'files', { value: [], configurable: true })
            await (input!.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
        } finally {
            spy.mockRestore()
        }

        expect(isBusy()).toBe(false)
    })
})

describe('LoadLocalBackup waits for work', () => {
    test('a send streaming: LoadLocalBackup is refused before the restored profile is written and DBState.db is the same object', async () => {
        installWorld()
        const { running } = await startHeldSendBk()
        const dbBefore = DBState.db
        const { fixture } = localBackupBytes('restored-marker-b4')

        await loadBackupBytes(fixture).catch(() => {})
        const dbAfter = DBState.db
        const written = Array.from(forageMemStore.keys()).some((key) => key === 'database/database.bin' || key.startsWith('blocks/'))
        const installed = vi.mocked(setDatabase).mock.calls.length
        const reloadFlag = requiresFullEncoderReload.state
        await drain(running)

        expect.soft(written, 'the main file or a block of the restored profile was written').toBe(false)
        expect.soft(installed, 'setDatabase calls').toBe(0)
        expect.soft(dbAfter === dbBefore, 'DBState.db is the same object').toBe(true)
        expect.soft(reloadFlag, 'requiresFullEncoderReload').toBe(false)
    })
})
