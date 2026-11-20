// @vitest-environment happy-dom

/**
 * A Custom text theme quote can be null ("follow the scheme"). The V3 `getTextTheme` must still
 * return strings, painted through the same helper as the live text theme, so the documented
 * get -> set round trip keeps working. Drives the REAL `makeRisuaiAPIV3` and the REAL colour
 * scheme module; only storage and unrelated host modules are mocked.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../../storage/database.svelte'
import type { RisuPlugin } from '../../plugins.svelte'

//#region module mocks

const alertConfirmMock = vi.hoisted(() => vi.fn(async () => true))

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

vi.mock(import('../transpiler'), () => ({
    pluginCodeTranspiler: vi.fn((code: string) => code),
}) as unknown as typeof import('../transpiler'))

vi.mock(import('../../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        hotReloading: writable(false),
        CustomCSSStore: writable(''),
        SafeModeStore: writable(false),
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
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../../../util'))

vi.mock(import('../../../alert'), () => ({
    alertConfirm: alertConfirmMock,
    alertPluginConfirm: alertConfirmMock,
    alertError: vi.fn(),
    alertErrorWait: vi.fn(async () => {}),
    alertNormal: vi.fn(),
    alertNormalWait: vi.fn(async () => {}),
    alertMd: vi.fn(),
    alertToast: vi.fn(),
    alertWait: vi.fn(() => ({})),
    alertClear: vi.fn(),
    waitAlert: vi.fn(async () => {}),
}) as unknown as typeof import('../../../alert'))

vi.mock(import('../../../globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
    downloadFile: vi.fn(),
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

vi.mock(import('../../../gui/systemBars'), () => ({
    syncSystemBars: vi.fn(),
}) as unknown as typeof import('../../../gui/systemBars'))

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
    readColdStorageItem: vi.fn(),
}) as unknown as typeof import('../../../process/coldstorage.svelte'))

vi.mock(import('../../../process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
}) as unknown as typeof import('../../../process/files/inlays'))

vi.mock(import('../../../translator/translator'), () => ({
    getLLMCache: vi.fn(),
    searchLLMCache: vi.fn(),
}) as unknown as typeof import('../../../translator/translator'))

vi.mock(import('../../../parser/parser.svelte'), () => ({
    hasher: vi.fn(),
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
import { isLite } from '../../../lite'

type TextThemeApi = {
    getTextTheme: () => { name: string, customTheme: Record<string, string | null> }
    setCustomTextTheme: (theme: Record<string, string>) => void
}

function themeApi(): TextThemeApi {
    const plugin: RisuPlugin = {
        name: 'text-theme-test-plugin',
        script: 'text-theme-script',
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
    return makeRisuaiAPIV3({} as HTMLIFrameElement, plugin) as unknown as TextThemeApi
}

function seed(schemeName: string, quote1: string | null, quote2: string | null) {
    DBState.db = {
        textTheme: 'custom',
        font: 'default',
        colorSchemeName: schemeName,
        customTextTheme: {
            FontColorStandard: '#111111',
            FontColorItalic: '#222222',
            FontColorBold: '#333333',
            FontColorItalicBold: '#444444',
            FontColorQuote1: quote1,
            FontColorQuote2: quote2,
        },
    } as unknown as Database
}

beforeEach(() => {
    isLite.set(false)
    document.documentElement.removeAttribute('style')
})

describe('getTextTheme with null quotes', () => {
    test('VT-1: a null quote on a light scheme is reported as the painted light quote and round-trips', () => {
        seed('light', null, null)
        const api = themeApi()

        const { customTheme } = api.getTextTheme()

        expect(customTheme.FontColorQuote1).toBe('#0b5f7a')
        expect(customTheme.FontColorQuote2).toBe('#8a4200')
        expect(() => api.setCustomTextTheme(customTheme as Record<string, string>)).not.toThrow()
    })

    test('VT-1: a null quote on a dark scheme is reported as the dark quote', () => {
        seed('default', null, null)

        const { customTheme } = themeApi().getTextTheme()

        expect(customTheme.FontColorQuote1).toBe('#8BE9FD')
        expect(customTheme.FontColorQuote2).toBe('#FFB86C')
    })

    test('VT-2: after the round trip the quotes are stored as the painted strings', () => {
        seed('light', null, null)
        const api = themeApi()

        api.setCustomTextTheme(api.getTextTheme().customTheme as Record<string, string>)

        expect(DBState.db.customTextTheme.FontColorQuote1).toBe('#0b5f7a')
        expect(DBState.db.customTextTheme.FontColorQuote2).toBe('#8a4200')
    })

    test('a stored quote is reported verbatim', () => {
        seed('light', '#123456', null)

        const { customTheme } = themeApi().getTextTheme()

        expect(customTheme.FontColorQuote1).toBe('#123456')
        expect(customTheme.FontColorQuote2).toBe('#8a4200')
    })
})
