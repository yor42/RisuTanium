/**
 * The empty-chat rule at the plugin write sites (MC-721 1, MC-722 2, MC-720 3): a plugin write that
 * leaves a chat with no messages leaves it with no SupaMemory data, plain or `hypa:`, and no covered-ID
 * field; a non-empty replacement that lacks the resume message is not repointed.
 *
 * One row per API entry, each over the REAL `v3.svelte.ts` and `plugins.svelte.ts` (the module-mock set
 * of `v3ColdCharacters.svelte.test.ts`): V2 `setChar`, `setDatabaseLite`, `setDatabase`; V3 `setChar`,
 * `setCharacter`, `setChatToIndex` (and its archived-character variant), `setCharacterToIndex`,
 * `setDatabaseLite`, `setDatabase`. The internal-load guard lives in
 * `storage/tests/databaseSupaEmptyChat.test.ts`.
 *
 * Test kinds: "guard:" rows pass before and after (non-empty replacements, the live-database Proxy
 * residual, which documents that an in-place edit through `getDatabase()` is not cleared); every other
 * row is a regression reproducer that fails when the site it names does not clear.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, character } from '../../../storage/database.svelte'
import type { RisuPlugin } from '../../plugins.svelte'

//#region module mocks

const alertConfirmMock = vi.hoisted(() => vi.fn(async () => true))
const hasherMock = vi.hoisted(() => vi.fn(async (data: Uint8Array) => `hash:${new TextDecoder().decode(data)}`))
const readColdStorageItemMock = vi.hoisted(() => vi.fn())
/** Every text shown to the user, except progress notices. */
const notices = vi.hoisted(() => ({ texts: [] as string[] }))

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

vi.mock(import('../factory'), () => ({
    SandboxHost: class {},
}) as unknown as typeof import('../factory'))

vi.mock(import('../../../storage/database.svelte'), async () => {
    const { DBState: liveDBState } = await import('../../../stores.svelte')
    return {
        getCurrentCharacter: vi.fn(),
        getDatabase: vi.fn(() => liveDBState.db),
        setDatabase: vi.fn((db: Database) => { liveDBState.db = db }),
        setDatabaseLite: vi.fn(),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('../../../storage/database.svelte')
})

vi.mock(import('../../pluginSafety'), () => ({
    checkCodeSafety: vi.fn(async (code: string) => ({ modifiedCode: code })),
}) as unknown as typeof import('../../pluginSafety'))

vi.mock(import('../../pluginSafeClass'), () => ({
    SafeDocument: class {},
    SafeIdbFactory: class {},
    SafeLocalStorage: class {
        getItem = vi.fn()
        setItem = vi.fn()
        removeItem = vi.fn()
        clear = vi.fn()
        key = vi.fn()
        keys = vi.fn()
    },
    SafeLocalPluginStorage: class {},
    tagWhitelist: [],
}) as unknown as typeof import('../../pluginSafeClass'))

vi.mock(import('../transpiler'), () => ({
    pluginCodeTranspiler: vi.fn((code: string) => code),
}) as unknown as typeof import('../transpiler'))

vi.mock(import('../../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        hotReloading: writable(false),
        pluginAlertModalStore: writable(null),
        additionalChatMenu: [],
        additionalFloatingActionButtons: [],
        additionalHamburgerMenu: [],
        additionalSettingsMenu: [],
        bodyIntercepterStore: [],
        chatPanelStore: [],
    } as unknown as typeof import('../../../stores.svelte')
})

vi.mock(import('../../../util'), () => ({
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../../../util'))

vi.mock(import('../../../alert'), () => {
    const show = (msg: string | Error) => { notices.texts.push(msg instanceof Error ? msg.message : String(msg)) }
    return {
        alertConfirm: alertConfirmMock,
        alertPluginConfirm: alertConfirmMock,
        alertError: vi.fn(show),
        alertErrorWait: vi.fn(async (msg: string) => { show(msg) }),
        alertNormal: vi.fn(show),
        alertNormalWait: vi.fn(async (msg: string) => { show(msg) }),
        alertMd: vi.fn(show),
        alertToast: vi.fn(show),
        alertWait: vi.fn(() => ({})),
        alertClear: vi.fn(),
        waitAlert: vi.fn(async () => {}),
    } as unknown as typeof import('../../../alert')
})

vi.mock(import('../../../globalApi.svelte'), () => ({
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
}) as unknown as typeof import('../../../globalApi.svelte'))

vi.mock(import('../../../gui/colorscheme'), () => ({
    changeColorScheme: vi.fn(),
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('../../../gui/colorscheme'))

vi.mock(import('../../../platform'), () => ({
    isNodeServer: false,
    isTauri: false,
}) as unknown as typeof import('../../../platform'))

vi.mock(import('../../../process/mcp/pluginmcp'), () => ({
    registerMCPModule: vi.fn(),
    unregisterMCPModule: vi.fn(),
}) as unknown as typeof import('../../../process/mcp/pluginmcp'))

vi.mock(import('../../../process/coldstorage.svelte'), () => ({
    setColdStorageItem: vi.fn(),
    readColdStorageItem: readColdStorageItemMock,
}) as unknown as typeof import('../../../process/coldstorage.svelte'))

vi.mock(import('../../../process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
}) as unknown as typeof import('../../../process/files/inlays'))

vi.mock(import('../../../translator/translator'), () => ({
    getLLMCache: vi.fn(),
    searchLLMCache: vi.fn(),
}) as unknown as typeof import('../../../translator/translator'))

vi.mock(import('../../../parser/parser.svelte'), () => ({
    hasher: hasherMock,
    risuChatParser: vi.fn(),
}) as unknown as typeof import('../../../parser/parser.svelte'))

vi.mock(import('../../../model/types'), () => ({
    LLMFlags: {},
    LLMFormat: {},
    LLMProvider: {},
    LLMTokenizer: {},
}) as unknown as typeof import('../../../model/types'))

vi.mock(import('../../../process/index.svelte'), () => ({
    sendChat: vi.fn(async () => {}),
    doingChat: writable(false),
}) as unknown as typeof import('../../../process/index.svelte'))

vi.mock(import('../../../process/scripts'), () => ({
    processScriptFull: vi.fn(),
}) as unknown as typeof import('../../../process/scripts'))

vi.mock(import('../../../model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ id: 'test-model' }) as unknown),
}) as unknown as typeof import('../../../model/modellist'))

vi.mock(import('../../../process/request/request'), () => ({
    requestChatDataMain: vi.fn(),
}) as unknown as typeof import('../../../process/request/request'))

vi.mock(import('../../../process/modules'), () => ({
    getModuleLorebooks: vi.fn(),
}) as unknown as typeof import('../../../process/modules'))

vi.mock(import('../../../process/ttsHooks'), () => ({
    registerTTSPreprocessor: vi.fn(),
    unregisterTTSPreprocessor: vi.fn(),
    registerTTSPostprocessor: vi.fn(),
    unregisterTTSPostprocessor: vi.fn(),
}) as unknown as typeof import('../../../process/ttsHooks'))

//#endregion

import { makeRisuaiAPIV3 } from '../v3.svelte'
import { getV2PluginAPIs } from '../../plugins.svelte'
import { DBState, selectedCharID } from '../../../stores.svelte'
import { buildColdStub } from '../../../process/coldCharacter'


//#region fixtures

type CharacterFixture = Database['characters'][number]
type ColdCharacter = character & { coldstorage?: string }

const PLUGIN_NAME = 'cold-test-plugin'

function makePlugin(): RisuPlugin {
    return {
        name: PLUGIN_NAME,
        script: 'cold-characters-script',
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
}

function makeChat(id: string, text: string) {
    return { id, message: [{ role: 'user', data: text, time: 1 }], note: '', name: id, localLore: [] }
}

/** A full character with the fields the tests read. */
function fullCharacter(chaId: string, extra: Record<string, unknown> = {}): character {
    return {
        type: 'character',
        name: `${chaId} name`,
        chaId,
        chatPage: 0,
        firstMsgIndex: 0,
        creatorNotes: '',
        lastInteraction: 5000,
        desc: `${chaId} description`,
        globalLore: [{ comment: `${chaId} lore`, content: `${chaId} lore content`, key: 'k', alwaysActive: false, secondkey: '', selective: false, insertorder: 100, mode: 'normal' }],
        chats: [makeChat(`${chaId}-chat-0`, 'first'), makeChat(`${chaId}-chat-1`, 'second'), makeChat(`${chaId}-chat-2`, 'third')],
        ...extra,
    } as unknown as character
}

/**
 * The stub as it sits in the list after load: the fields the boot-time format
 * check fills on every character are default-filled.
 */
function stubOf(full: character, key: string): CharacterFixture {
    const stub = buildColdStub(full, key, []) as unknown as Record<string, unknown>
    Object.assign(stub, { customscript: [], firstMessage: '', globalLore: [], desc: '', viewScreen: 'none', emotionImages: [] })
    return stub as unknown as CharacterFixture
}

interface UnitEntry { kind: 'ok', character: unknown }
const units = new Map<string, UnitEntry | { kind: 'error' }>()

function putUnit(key: string, stored: unknown): void {
    units.set(key, { kind: 'ok', character: stored })
}

function installUnitReader(): void {
    readColdStorageItemMock.mockImplementation(async (key: string) => {
        const entry = units.get(key)
        if (!entry) {
            return { status: 'missing' }
        }
        if (entry.kind === 'error') {
            return { status: 'error', error: new Error('unit unreadable') }
        }
        return { status: 'ok', value: { character: structuredClone(entry.character) } }
    })
}

function installDb(characters: CharacterFixture[]): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [{ name: PLUGIN_NAME, script: '' }],
        pluginCustomStorage: {},
        characterOrder: characters.map((c) => c.chaId),
        characters,
    } as unknown as Database
}

const SUMMARY = 'old summary text'

type SupaChat = { id: string, message: unknown[], supaMemoryData?: string, supaMemoryCoveredId?: string }
type Entry = Record<string, unknown>

const sent = (...ids: string[]) => ids.map((chatId) => ({ role: 'user', data: chatId, chatId }))

/** A detached character whose single chat carries the given messages and SupaMemory data. */
function detached(chaId: string, ids: string[], data: string, covered?: string): Entry {
    return {
        type: 'character',
        name: `${chaId} name`,
        chaId,
        chatPage: 0,
        chats: [{
            id: `${chaId}-chat-0`,
            message: sent(...ids),
            note: '',
            name: 'c',
            localLore: [],
            supaMemoryData: data,
            ...(covered ? { supaMemoryCoveredId: covered } : {}),
        }],
    }
}

const detachedChat = (ids: string[], data: string, covered?: string) => (detached('x', ids, data, covered).chats as Entry[])[0]

function installTwo(): void {
    installDb([
        detached('a', ['m1', 'm2'], `m1\n${SUMMARY}`, 'm1') as unknown as CharacterFixture,
        detached('b', ['n1', 'n2'], `n1\n${SUMMARY}`, 'n1') as unknown as CharacterFixture,
    ])
}

const chatAt = (charIndex: number) => (DBState.db.characters[charIndex].chats as unknown as SupaChat[])[0]

const api2 = () => getV2PluginAPIs()
const api3 = () => makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin())

const KINDS = ['m1\n' + SUMMARY, 'hypa:m1\n' + SUMMARY]

function expectCleared(chat: SupaChat): void {
    expect(chat.message.length).toBe(0)
    expect(chat.supaMemoryData).toBe('')
    expect('supaMemoryCoveredId' in chat).toBe(false)
}

//#endregion

beforeEach(() => {
    units.clear()
    readColdStorageItemMock.mockReset()
    installUnitReader()
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    selectedCharID.set(0)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe.each(KINDS)('a plugin write that empties a chat with %j', (data) => {
    test('V2 setChar (site b)', () => {
        installTwo()
        api2().setChar(detached('a', [], data, 'm1'))
        expectCleared(chatAt(0))
    })

    test('V2 setDatabaseLite (site a)', async () => {
        installTwo()
        await api2().setDatabaseLite({ characters: [detached('a', [], data, 'm1'), detached('b', ['n1'], 'n1\nkept', undefined)] })
        expectCleared(chatAt(0))
        expect(chatAt(1).supaMemoryData).toBe('n1\nkept')
    })

    test('V2 setDatabase (site a)', async () => {
        installTwo()
        await api2().setDatabase({ characters: [detached('a', [], data, 'm1'), detached('b', ['n1'], 'n1\nkept', undefined)] })
        expectCleared(chatAt(0))
        expect(chatAt(1).supaMemoryData).toBe('n1\nkept')
    })

    test('V3 setChar (site b)', () => {
        installTwo()
        api3().setChar(detached('a', [], data, 'm1'))
        expectCleared(chatAt(0))
    })

    test('V3 setCharacter (site b)', () => {
        installTwo()
        api3().setCharacter(detached('a', [], data, 'm1'))
        expectCleared(chatAt(0))
    })

    test('V3 setChatToIndex (site c)', async () => {
        installTwo()
        await api3().setChatToIndex(1, 0, detachedChat([], data, 'm1'))
        expectCleared(chatAt(1))
        expect(chatAt(0).supaMemoryData).toBe(`m1\n${SUMMARY}`)
    })

    test('V3 setChatToIndex on an archived character (site c)', async () => {
        const full = detached('hero', ['h1', 'h2'], 'h1\nx') as unknown as character
        putUnit('unit-hero', full)
        installDb([detached('warm', ['w1'], 'w1\nx') as unknown as CharacterFixture, stubOf(full, 'unit-hero')])
        await api3().setChatToIndex(1, 0, detachedChat([], data, 'm1'))
        expectCleared(chatAt(1))
    })

    test('V3 setCharacterToIndex (site d)', () => {
        installTwo()
        api3().setCharacterToIndex(1, detached('b', [], data, 'n1'))
        expectCleared(chatAt(1))
        expect(chatAt(0).supaMemoryData).toBe(`m1\n${SUMMARY}`)
    })

    test('V3 setDatabaseLite (site a)', async () => {
        installTwo()
        await api3().setDatabaseLite({ characters: [detached('a', [], data, 'm1'), detached('b', ['n1'], 'n1\nkept', undefined)] })
        expectCleared(chatAt(0))
    })

    test('V3 setDatabase (site a)', async () => {
        installTwo()
        await api3().setDatabase({ characters: [detached('a', [], data, 'm1'), detached('b', ['n1'], 'n1\nkept', undefined)] })
        expectCleared(chatAt(0))
    })
})

describe('a non-empty plugin replacement that lacks the pointer is left untouched (MC-720 3)', () => {
    const lacking = (): Entry => detached('a', ['z1'], `m1\n${SUMMARY}`, 'm1')
    const expectUntouched = () => {
        expect(chatAt(0).message.length).toBe(1)
        expect(chatAt(0).supaMemoryData).toBe(`m1\n${SUMMARY}`)
        expect(chatAt(0).supaMemoryCoveredId).toBe('m1')
    }

    test('guard: V2 setChar', () => {
        installTwo()
        api2().setChar(lacking())
        expectUntouched()
    })

    test('guard: V2 setDatabaseLite and setDatabase', async () => {
        installTwo()
        await api2().setDatabaseLite({ characters: [lacking()] })
        expectUntouched()
        installTwo()
        await api2().setDatabase({ characters: [lacking()] })
        expectUntouched()
    })

    test('guard: V3 setChar, setCharacter, setDatabaseLite and setDatabase', async () => {
        installTwo()
        api3().setChar(lacking())
        expectUntouched()
        installTwo()
        api3().setCharacter(lacking())
        expectUntouched()
        installTwo()
        await api3().setDatabaseLite({ characters: [lacking()] })
        expectUntouched()
        installTwo()
        await api3().setDatabase({ characters: [lacking()] })
        expectUntouched()
    })

    test('guard: V3 setChatToIndex and setCharacterToIndex', async () => {
        installTwo()
        await api3().setChatToIndex(0, 0, (lacking().chats as Entry[])[0])
        expectUntouched()
        installTwo()
        api3().setCharacterToIndex(0, lacking())
        expectUntouched()
    })
})

describe('residual: an in-place edit through the V2 live database', () => {
    // guard: passes before and after; documents that emptying a chat through the live `getDatabase()`
    // object, without a setter call, keeps its data until Reset.
    test('guard: emptying chat.message through getDatabase() leaves the data', () => {
        installTwo()
        const live = api2().getDatabase() as unknown as { characters: { chats: SupaChat[] }[] }
        live.characters[0].chats[0].message = []
        expect(chatAt(0).message.length).toBe(0)
        expect(chatAt(0).supaMemoryData).toBe(`m1\n${SUMMARY}`)
    })
})
