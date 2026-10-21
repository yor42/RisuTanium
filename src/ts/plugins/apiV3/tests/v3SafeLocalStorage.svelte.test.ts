// @vitest-environment happy-dom

/**
 * The V3 host API's safeLocalStorage bindings (`_clearSafeLocalStorage`,
 * `_keySafeLocalStorage`, `_lengthSafeLocalStorage`) call the real
 * `SafeLocalStorage`, whose `key`, `clear` and `length` use `this`: each
 * binding must keep the instance bound. Drives the REAL `makeRisuaiAPIV3`.
 */
import { flushSync } from 'svelte'
import { describe, test, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, character } from '../../../storage/database.svelte'
import type { toSaveType } from '../../../storage/risuSave'
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
import { DBState } from '../../../stores.svelte'

function makePlugin(): RisuPlugin {
    return {
        name: 'safe-storage-test-plugin',
        script: 'safe-storage-script',
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
}

type SafeStorageApi = {
    _setSafeLocalStorage: (key: string, value: string) => void
    _clearSafeLocalStorage: () => void
    _keySafeLocalStorage: (index: number) => string | null
    _keysSafeLocalStorage: () => string[]
    _lengthSafeLocalStorage: () => number
    _getAliases: () => { safeLocalStorage: Record<string, string> }
}

function safeStorageApi(): SafeStorageApi {
    DBState.db = {} as unknown as Database
    return makeRisuaiAPIV3({} as HTMLIFrameElement, makePlugin()) as unknown as SafeStorageApi
}

beforeEach(() => {
    localStorage.clear()
})

describe('V3 safeLocalStorage bindings keep the storage instance bound', () => {
    test('key(index) returns the stored key', () => {
        const api = safeStorageApi()
        api._setSafeLocalStorage('a', '1')
        api._setSafeLocalStorage('b', '2')
        expect(api._keySafeLocalStorage(0)).toBe('a')
        expect(api._keySafeLocalStorage(1)).toBe('b')
        expect(api._keySafeLocalStorage(2)).toBeNull()
    })

    test('clear() removes only the plugin keys', () => {
        const api = safeStorageApi()
        localStorage.setItem('app-own-key', 'keep')
        api._setSafeLocalStorage('a', '1')
        api._clearSafeLocalStorage()
        expect(api._keysSafeLocalStorage()).toEqual([])
        expect(localStorage.getItem('app-own-key')).toBe('keep')
    })

    test('length counts the plugin keys and is reachable through the alias map', () => {
        const api = safeStorageApi()
        api._setSafeLocalStorage('a', '1')
        api._setSafeLocalStorage('b', '2')
        expect(api._lengthSafeLocalStorage()).toBe(2)
        expect(api._getAliases().safeLocalStorage.length).toBe('_lengthSafeLocalStorage')
    })
})
