// @vitest-environment node

/**
 * `parseRisuChat({ processRegex: true })` binds its script pass to the chat and
 * message that were active when parsing started, so an awaited `pluginV2.editprocess`
 * handler cannot redirect `@@inject`, `@@repeat_back`, module regex, or CBS
 * variable reads to another chat or a shifted message.
 *
 * Drives the REAL `makeRisuaiAPIV3` (`../v3.svelte`), REAL `processScriptFull`
 * (`../../process/scripts`), REAL `risuChatParser` (`../../parser/parser.svelte`),
 * REAL `chatOrigin` (`../../process/chatOrigin`), and REAL `modules`
 * (`../../process/modules`).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { get, writable } from 'svelte/store'
import type { Writable } from 'svelte/store'
import type { Chat, Database, Message, character, customscript, loreBook } from 'src/ts/storage/database.svelte'
import type { RisuModule } from 'src/ts/process/modules'
import type { RisuPlugin } from 'src/ts/plugins/plugins.svelte'
import 'src/ts/polyfill'

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: (options?: { name?: string }) => ({
            getItem: vi.fn(async (key: string) => {
                if (options?.name === 'plugin_permissions') {
                    if (key.endsWith('_db_lastGrantTime')) return Date.now()
                    if (key.endsWith('_db')) return true
                }
                return null
            }),
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
    default: { addHook: vi.fn(), sanitize: (html: string) => html },
}))

vi.mock(import('katex'), () => ({}))
vi.mock(import('src/ts/lite'), () => ({}))

vi.mock(import('../factory'), () => ({
    SandboxHost: class {},
}) as unknown as typeof import('../factory'))

vi.mock(import('../../pluginSafeClass'), () => ({
    SafeDocument: class {},
    SafeIdbFactory: class {},
    SafeLocalStorage: class {},
    SafeLocalPluginStorage: class {},
    tagWhitelist: [],
}) as unknown as typeof import('../../pluginSafeClass'))

vi.mock(import('../../plugins.svelte'), () => ({
    allowedDbKeys: [],
    customProviderStore: writable([]),
    getV2PluginAPIs: vi.fn(() => ({
        safeLocalStorage: {
            getItem: vi.fn(),
            setItem: vi.fn(),
            removeItem: vi.fn(),
            clear: vi.fn(),
            key: vi.fn(),
            keys: vi.fn(),
            length: 0,
        },
    })),
    handlePluginInstallViaPlugin: vi.fn(),
    pluginV2: {
        editdisplay: new Set(),
        editoutput: new Set(),
        editprocess: new Set(),
        editinput: new Set(),
        chatOutput: new Set(),
    },
}) as unknown as typeof import('../../plugins.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { characters: [], modules: [], enabledModules: [] } as unknown as Database })
    return {
        DBState: state,
        CharEmotion: writable({}),
        selectedCharID: writable(-1),
        selIdState: { selId: 0 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        loadedStore: writable(false),
        hotReloading: writable(false),
        additionalChatMenu: [],
        additionalFloatingActionButtons: [],
        additionalHamburgerMenu: [],
        additionalSettingsMenu: [],
        bodyIntercepterStore: [],
        chatPanelStore: [],
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    const state = stores.DBState as unknown as { db: Database }
    const getCurrentCharacter = () => state.db.characters?.[get(stores.selectedCharID)]
    const getCurrentChat = () => {
        const current = getCurrentCharacter()
        return current?.chats?.[current.chatPage]
    }
    return {
        appVer: '0.0.0',
        presetTemplate: {},
        setDatabase: vi.fn(),
        getDatabase: vi.fn(() => state.db),
        getCurrentCharacter: vi.fn(getCurrentCharacter),
        getCurrentChat: vi.fn(getCurrentChat),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/util'), async (importOriginal) => ({
    ...await importOriginal(),
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertPluginConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertErrorWait: vi.fn(async () => {}),
    alertNormal: vi.fn(),
    alertNormalWait: vi.fn(async () => {}),
    alertMd: vi.fn(),
    alertToast: vi.fn(),
    alertWait: vi.fn(() => ({ type: 'wait' as const, msg: '' })),
    alertClear: vi.fn(),
    waitAlert: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((book: loreBook[]) => book),
}))

vi.mock(import('src/ts/characterCards'), () => ({
    exportCharacterCard: vi.fn(),
    importCharacterProcess: vi.fn(),
}))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
    getFetchLogs: vi.fn(),
    readImage: vi.fn(),
    saveAsset: vi.fn(),
    toGetter: vi.fn((obj: unknown) => obj),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    changeColorScheme: vi.fn(),
    effectiveColorScheme: vi.fn(() => 'dark'),
    paintedCustomQuote: vi.fn(),
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/platform'), () => ({
    isNodeServer: false,
    isTauri: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: vi.fn(async () => ({
        read: async () => ({ bytes: null, version: null }),
        has: async () => false,
    })),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

vi.mock(import('src/ts/process/mcp/pluginmcp'), () => ({
    registerMCPModule: vi.fn(),
    unregisterMCPModule: vi.fn(),
    registeredCustomPluginMCPs: new Map(),
}))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    setColdStorageItem: vi.fn(),
    readColdStorageItem: vi.fn(),
}))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
    getInlayAssetCapped: vi.fn(),
    createInlayFromData: vi.fn(),
    writeInlayImage: vi.fn(),
}))

vi.mock(import('src/ts/translator/translator'), () => ({
    getLLMCache: vi.fn(),
    searchLLMCache: vi.fn(),
}))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    sendChat: vi.fn(async () => {}),
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ id: 'test-model' }) as unknown),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/process/request/request'), () => ({
    requestChatData: vi.fn(),
    requestChatDataMain: vi.fn(),
}) as unknown as typeof import('src/ts/process/request/request'))

vi.mock(import('src/ts/process/ttsHooks'), () => ({
    registerTTSPreprocessor: vi.fn(),
    unregisterTTSPreprocessor: vi.fn(),
    registerTTSPostprocessor: vi.fn(),
    unregisterTTSPostprocessor: vi.fn(),
}))

vi.mock(import('src/ts/process/moduleEnsure'), () => ({
    ensureCurrentModules: vi.fn(async () => true),
}))

//#endregion

import { makeRisuaiAPIV3 } from '../v3.svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { pluginV2 } from 'src/ts/plugins/plugins.svelte'
import { resetScriptCache } from 'src/ts/process/scripts'
import { refreshModules } from 'src/ts/process/modules'

function makePlugin(): RisuPlugin {
    return {
        name: 'parse-risu-chat-test-plugin',
        script: '',
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
}

function makeMessage(role: 'user' | 'char', data: string): Message {
    return { role, data, time: 1 } as Message
}

function makeChat(id: string, message: Message[], extra: Partial<Chat> = {}): Chat {
    return {
        id,
        note: '',
        name: id,
        localLore: [],
        fmIndex: -1,
        message,
        scriptstate: {},
        modules: [],
        ...extra,
    } as Chat
}

function makeCharacter(
    chaId: string,
    customscript: customscript[],
    chats: Chat[],
    extra: Partial<character> = {},
): character {
    return {
        type: 'character',
        name: chaId,
        chaId,
        chats,
        chatPage: 0,
        customscript,
        triggerscript: [],
        globalLore: [],
        modules: [],
        firstMessage: '',
        desc: '',
        notes: '',
        ...extra,
    } as unknown as character
}

function makeEditProcessScript(overrides: Partial<customscript>): customscript {
    return {
        comment: 'test',
        in: 'INJ',
        out: '@@inject',
        type: 'editprocess',
        ableFlag: false,
        flag: '',
        ...overrides,
    }
}

function makeModule(id: string, regex: customscript[]): RisuModule {
    return {
        id,
        name: id,
        description: '',
        regex,
        trigger: [],
        assets: [],
        lorebook: [],
        rank: 0,
    } as unknown as RisuModule
}

function setupDb(characters: character[], modules: RisuModule[] = []): void {
    DBState.db = {
        characters,
        modules,
        enabledModules: [],
        presetRegex: [],
        dynamicAssets: false,
        userName: 'User',
        personas: [{ name: 'User', personaPrompt: '', id: 'p0' }],
        selectedPersona: 0,
    } as unknown as Database
    refreshModules()
}

function holdOneEditHandler(): {
    entered: Promise<void>
    release: (nextText?: string) => void
} {
    let resolveEntered!: () => void
    const entered = new Promise<void>((resolve) => {
        resolveEntered = resolve
    })
    let resolveGate!: (nextText?: string) => void
    const gate = new Promise<string | undefined>((resolve) => {
        resolveGate = resolve
    })
    const handler = async (text: string) => {
        resolveEntered()
        const replacement = await gate
        return replacement ?? text
    }
    ;(pluginV2.editprocess as Set<(data: string) => Promise<string | null | undefined>>).add(handler)
    return {
        entered,
        release: (nextText?: string) => resolveGate(nextText),
    }
}

const api = () => makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

describe('parseRisuChat with processRegex origin and message binding', () => {
    beforeEach(() => {
        ;(pluginV2.editprocess as Set<unknown>).clear()
        resetScriptCache()
        ;(selectedCharID as Writable<number>).set(-1)
    })

    afterEach(() => {
        ;(pluginV2.editprocess as Set<unknown>).clear()
        resetScriptCache()
    })

    test('reproducer: switching to another character during an awaited editprocess handler does not overwrite that character with @@inject', async () => {
        const charA = makeCharacter(
            'char-a',
            [makeEditProcessScript({ in: 'INJ', out: '@@inject' })],
            [makeChat('chat-a1', [makeMessage('user', 'a0'), makeMessage('char', 'a1-before')])],
        )
        const charB = makeCharacter(
            'char-b',
            [],
            [makeChat('chat-b1', [makeMessage('user', 'b0'), makeMessage('char', 'b1-before')])],
        )
        setupDb([charA, charB])
        ;(selectedCharID as Writable<number>).set(0)

        const hold = holdOneEditHandler()
        const pending = api().parseRisuChat('INJ payload-a', { processRegex: true, messageIndex: 1 })
        await hold.entered

        ;(selectedCharID as Writable<number>).set(1)
        hold.release()
        const result = await pending

        expect(charB.chats[0].message[1].data).toBe('b1-before')
        expect(charA.chats[0].message[1].data).toBe('INJ payload-a')
        expect(result).toBe(' payload-a')
    })

    test('reproducer: switching chatPage on the same character during an awaited editprocess handler does not overwrite the newly active chat with <inject>', async () => {
        const chat1 = makeChat('chat-1', [makeMessage('user', 'c1-0'), makeMessage('char', 'c1-1-before')])
        const chat2 = makeChat('chat-2', [makeMessage('user', 'c2-0'), makeMessage('char', 'c2-1-before')])
        const charA = makeCharacter(
            'char-a',
            [makeEditProcessScript({ in: 'INJ', out: '', ableFlag: true, flag: '<inject>g' })],
            [chat1, chat2],
        )
        setupDb([charA])
        ;(selectedCharID as Writable<number>).set(0)

        const hold = holdOneEditHandler()
        const pending = api().parseRisuChat('INJ flag-payload', { processRegex: true, messageIndex: 1 })
        await hold.entered

        charA.chatPage = 1
        hold.release()
        const result = await pending

        expect(chat2.message[1].data).toBe('c2-1-before')
        expect(chat1.message[1].data).toBe('INJ flag-payload')
        expect(result).toBe(' flag-payload')
    })

    test('reproducer: switching chat during an awaited editprocess handler keeps CBS variable reads and module regex bound to the original chat', async () => {
        const modA = makeModule('mod-a', [makeEditProcessScript({ in: 'MODTOK', out: 'MOD_A_HIT' })])
        const modB = makeModule('mod-b', [makeEditProcessScript({ in: 'MODTOK', out: 'MOD_B_HIT' })])
        const charA = makeCharacter(
            'char-a',
            [],
            [makeChat('chat-a1', [makeMessage('user', 'a0')], { scriptstate: { $tag: 'fromA' }, modules: ['mod-a'] })],
        )
        const charB = makeCharacter(
            'char-b',
            [],
            [makeChat('chat-b1', [makeMessage('user', 'b0')], { scriptstate: { $tag: 'fromB' }, modules: ['mod-b'] })],
        )
        setupDb([charA, charB], [modA, modB])
        ;(selectedCharID as Writable<number>).set(0)

        const hold = holdOneEditHandler()
        const pending = api().parseRisuChat('initial', { processRegex: true, messageIndex: 0 })
        await hold.entered

        ;(selectedCharID as Writable<number>).set(1)
        hold.release('{{getvar::tag}} MODTOK')
        const result = await pending

        expect(result).toBe('fromA MOD_A_HIT')
    })

    test('reproducer: prepending a message to the original chat during await writes @@inject to the original message object, not the index', async () => {
        const targetMsg = makeMessage('char', 'target-before')
        const otherMsg = makeMessage('user', 'other-before')
        const charA = makeCharacter(
            'char-a',
            [makeEditProcessScript({ in: 'INJ', out: '@@inject' })],
            [makeChat('chat-a1', [otherMsg, targetMsg])],
        )
        setupDb([charA])
        ;(selectedCharID as Writable<number>).set(0)

        const hold = holdOneEditHandler()
        const pending = api().parseRisuChat('INJ shifted', { processRegex: true, messageIndex: 1 })
        await hold.entered

        const inserted = makeMessage('user', 'inserted-at-0')
        charA.chats[0].message.unshift(inserted)
        hold.release()
        const result = await pending

        expect(otherMsg.data).toBe('other-before')
        expect(targetMsg.data).toBe('INJ shifted')
        expect(result).toBe(' shifted')
    })

    test('reproducer: deleting the target message from the original chat during await leaves remaining messages untouched', async () => {
        const survivor = makeMessage('char', 'survivor-before')
        const targetMsg = makeMessage('char', 'target-before')
        const charA = makeCharacter(
            'char-a',
            [makeEditProcessScript({ in: 'INJ', out: '@@inject' })],
            [makeChat('chat-a1', [makeMessage('user', 'u0'), targetMsg, survivor])],
        )
        setupDb([charA])
        ;(selectedCharID as Writable<number>).set(0)

        const hold = holdOneEditHandler()
        const pending = api().parseRisuChat('INJ deleted', { processRegex: true, messageIndex: 1 })
        await hold.entered

        charA.chats[0].message.splice(1, 1)
        hold.release()
        const result = await pending

        expect(survivor.data).toBe('survivor-before')
        expect(result).toBe('INJ deleted')
    })

    test('reproducer: switching chat during an awaited editprocess handler keeps @@repeat_back reading from the original chat', async () => {
        const charA = makeCharacter(
            'char-a',
            [makeEditProcessScript({ in: 'FROM_[AB]', out: '@@repeat_back end' })],
            [makeChat('chat-a1', [makeMessage('user', 'FROM_A'), makeMessage('user', 'current-a')])],
        )
        const charB = makeCharacter(
            'char-b',
            [],
            [makeChat('chat-b1', [makeMessage('user', 'FROM_B'), makeMessage('user', 'current-b')])],
        )
        setupDb([charA, charB])
        ;(selectedCharID as Writable<number>).set(0)

        const hold = holdOneEditHandler()
        const pending = api().parseRisuChat('reply:', { processRegex: true, messageIndex: 1 })
        await hold.entered

        ;(selectedCharID as Writable<number>).set(1)
        hold.release()
        const result = await pending

        expect(result).toBe('reply:FROM_A')
    })

    test('guard: same-chat @@inject without switching updates the target message and strips the matched token', async () => {
        const charA = makeCharacter(
            'char-a',
            [makeEditProcessScript({ in: 'INJ', out: '@@inject' })],
            [makeChat('chat-a1', [makeMessage('user', 'u0'), makeMessage('char', 'before')])],
        )
        setupDb([charA])
        ;(selectedCharID as Writable<number>).set(0)

        const result = await api().parseRisuChat('INJ same-chat', { processRegex: true, messageIndex: 1 })

        expect(charA.chats[0].message[1].data).toBe('INJ same-chat')
        expect(result).toBe(' same-chat')
    })

    test('guard: processRegex without messageIndex runs editprocess regex without mutating messages', async () => {
        const charA = makeCharacter(
            'char-a',
            [
                makeEditProcessScript({ in: 'INJ', out: '@@inject' }),
                makeEditProcessScript({ in: 'PING', out: 'PONG' }),
            ],
            [makeChat('chat-a1', [makeMessage('user', 'keep-u0')])],
        )
        setupDb([charA])
        ;(selectedCharID as Writable<number>).set(0)

        const result = await api().parseRisuChat('HELLO PING', { processRegex: true })

        expect(charA.chats[0].message[0].data).toBe('keep-u0')
        expect(result).toBe('HELLO PONG')
    })

    test('guard: omitting processRegex does not run editprocess handlers or regex scripts', async () => {
        const handler = vi.fn(async (d: string) => d)
        ;(pluginV2.editprocess as Set<(data: string) => Promise<string | null | undefined>>).add(handler)
        const charA = makeCharacter(
            'char-a',
            [makeEditProcessScript({ in: 'PING', out: 'PONG' })],
            [makeChat('chat-a1', [makeMessage('user', 'u0')])],
        )
        setupDb([charA])
        ;(selectedCharID as Writable<number>).set(0)

        const result = await api().parseRisuChat('PING')

        expect(handler).not.toHaveBeenCalled()
        expect(result).toBe('PING')
    })
})
