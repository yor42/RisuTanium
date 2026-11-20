// @vitest-environment jsdom

/**
 * `setColorScheme` (in `src/ts/plugins/apiV3/v3.svelte.ts`) repaints the text theme at once: the
 * standard text theme's font colours depend on the scheme type, so they must follow the new scheme.
 *
 * The colour module is real. The module-mock set comes from `v3.getColorScheme.test.ts`.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import type { RisuPlugin } from '../plugins.svelte'

//#region module mocks

const memStore = new Map<string, unknown>()

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => memStore.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => {
                memStore.set(key, value)
            }),
            removeItem: vi.fn(async (key: string) => {
                memStore.delete(key)
            }),
        }),
    },
}))

vi.mock(import('../plugins.svelte'), () => ({
    allowedDbKeys: [],
    customProviderStore: writable([] as string[]),
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
    pluginV2: {
        providers: new Map(),
        providerOptions: new Map(),
        chatOutput: new Set(),
    },
}) as unknown as typeof import('../plugins.svelte'))

vi.mock(import('./factory'), () => ({
    SandboxHost: class {
        constructor(_api: unknown) {}
        run() {}
        terminate() {}
    },
}) as unknown as typeof import('./factory'))

vi.mock(import('../../storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({}) as unknown),
}) as unknown as typeof import('../../storage/database.svelte'))

vi.mock(import('../pluginSafeClass'), () => ({
    SafeLocalPluginStorage: class {},
    tagWhitelist: [],
}) as unknown as typeof import('../pluginSafeClass'))

vi.mock(import('../../stores.svelte'), () => {
    const state = { db: {} as unknown as Database }
    return {
        DBState: state,
        selectedCharID: writable(0),
        additionalChatMenu: [],
        additionalFloatingActionButtons: [],
        additionalHamburgerMenu: [],
        additionalSettingsMenu: [],
        bodyIntercepterStore: [],
        chatPanelStore: [] as unknown[],
        CustomCSSStore: writable(''),
        SafeModeStore: writable(false),
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../../util'), () => ({
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../../util'))

vi.mock(import('../../alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
    forageStorage: {},
    getFetchLogs: vi.fn(() => []),
    downloadFile: vi.fn(),
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../gui/systemBars'), () => ({
    syncSystemBars: vi.fn(),
}) as unknown as typeof import('../../gui/systemBars'))

vi.mock(import('../../platform'), () => ({
    isNodeServer: false,
    isTauri: false,
}) as unknown as typeof import('../../platform'))

vi.mock(import('../../process/mcp/pluginmcp'), () => ({
    registerMCPModule: vi.fn(),
    unregisterMCPModule: vi.fn(),
}) as unknown as typeof import('../../process/mcp/pluginmcp'))

vi.mock(import('../../process/coldstorage.svelte'), () => ({
    setColdStorageItem: vi.fn(),
    readColdStorageItem: vi.fn(),
}) as unknown as typeof import('../../process/coldstorage.svelte'))

vi.mock(import('../../process/files/inlays'), () => ({
    getInlayAsset: vi.fn(async () => 'asset-data'),
}) as unknown as typeof import('../../process/files/inlays'))

vi.mock(import('../../translator/translator'), () => ({
    getLLMCache: vi.fn(),
    searchLLMCache: vi.fn(),
}) as unknown as typeof import('../../translator/translator'))

vi.mock(import('../../parser/parser.svelte'), () => ({
    hasher: vi.fn(async () => 'hash'),
    risuChatParser: vi.fn(),
}) as unknown as typeof import('../../parser/parser.svelte'))

vi.mock(import('../../model/types'), () => ({
    LLMFlags: {},
    LLMFormat: {},
    LLMProvider: {},
    LLMTokenizer: {},
}) as unknown as typeof import('../../model/types'))

vi.mock(import('../../process/index.svelte'), () => ({
    sendChat: vi.fn(async () => {}),
    doingChat: writable(false),
}) as unknown as typeof import('../../process/index.svelte'))

vi.mock(import('../../process/scripts'), () => ({
    processScriptFull: vi.fn(),
}) as unknown as typeof import('../../process/scripts'))

vi.mock(import('../../model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ id: 'test-model' }) as unknown),
}) as unknown as typeof import('../../model/modellist'))

vi.mock(import('../../process/request/request'), () => ({
    requestChatDataMain: vi.fn(),
}) as unknown as typeof import('../../process/request/request'))

vi.mock(import('../../process/modules'), () => ({
    getModuleLorebooks: vi.fn(),
}) as unknown as typeof import('../../process/modules'))

vi.mock(import('../../process/ttsHooks'), () => ({
    registerTTSPreprocessor: vi.fn(),
    unregisterTTSPreprocessor: vi.fn(),
    registerTTSPostprocessor: vi.fn(),
    unregisterTTSPostprocessor: vi.fn(),
}) as unknown as typeof import('../../process/ttsHooks'))

//#endregion

import { makeRisuaiAPIV3 } from './v3.svelte'
import { DBState } from '../../stores.svelte'
import { updateColorScheme, updateTextThemeAndCSS, type ColorScheme } from '../../gui/colorscheme'

const LIGHT: ColorScheme = {
    bgcolor: '#ffffff', darkbg: '#f1f5f9', borderc: '#cbd5e1', selected: '#e2e8f0', draculared: '#dc2626',
    textcolor: '#0f172a', textcolor2: '#475569', darkBorderc: '#94a3b8', darkbutton: '#e2e8f0', type: 'light',
}

function makeApi() {
    const plugin: RisuPlugin = {
        name: 'color-plugin',
        script: 'script-color',
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
    return makeRisuaiAPIV3({} as HTMLIFrameElement, plugin)
}

function fontColorStandard(): string {
    return document.documentElement.style.getPropertyValue('--FontColorStandard')
}

beforeEach(() => {
    memStore.clear()
    DBState.db = { colorSchemeName: 'default', textTheme: 'standard', font: 'default' } as unknown as Database
    document.documentElement.removeAttribute('style')
    updateColorScheme()
    updateTextThemeAndCSS()
})

describe('setColorScheme refreshes the text theme', () => {
    test('RR: setting a light scheme over a dark one paints the light standard font colour', () => {
        expect(fontColorStandard()).toBe('#fafafa')

        makeApi().setColorScheme(LIGHT)

        expect(DBState.db.colorSchemeName).toBe('custom')
        expect(fontColorStandard()).toBe('#0f172a')
    })

    test('CG (passes before and after): setting a dark scheme keeps the dark standard font colour', () => {
        makeApi().setColorScheme({ ...LIGHT, type: 'dark' })

        expect(fontColorStandard()).toBe('#fafafa')
    })
})
