// @vitest-environment jsdom

/**
 * `getColorScheme` (in `src/ts/plugins/apiV3/v3.svelte.ts`) reports the scheme that is painted:
 *
 *  - a built-in `name` reports the current built-in table even when the saved copy is old;
 *  - a custom scheme reports the saved copy;
 *  - lite mode reports the lite scheme while `name` stays the saved name;
 *  - the result is a copy: changing it changes neither the saved copy nor the built-in table.
 *
 * The colour module is real. The module-mock set otherwise comes from `v3.chatPanel.svelte.test.ts`.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
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
import { colorSchemePresets } from '../../gui/colorscheme'
import { isLite } from '../../lite'

const OLD_COPY = {
    bgcolor: '#282a36', darkbg: '#21222c', borderc: '#6272a4', selected: '#44475a', draculared: '#ff5555',
    textcolor: '#f8f8f2', textcolor2: '#64748b', darkBorderc: '#4b5563', darkbutton: '#374151', type: 'dark',
} as const

const CUSTOM = {
    bgcolor: '#101010', darkbg: '#202020', borderc: '#303030', selected: '#404040', draculared: '#505050',
    textcolor: '#606060', textcolor2: '#123456', darkBorderc: '#707070', darkbutton: '#808080', type: 'dark',
} as const

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

function setDb(name: string, scheme: Record<string, string>) {
    DBState.db = { colorSchemeName: name, colorScheme: structuredClone(scheme) } as unknown as Database
}

beforeEach(() => {
    memStore.clear()
    isLite.set(false)
})

afterEach(() => {
    isLite.set(false)
})

describe('getColorScheme reports the painted scheme', () => {
    test('RR: a built-in name with an old saved copy reports the current table', () => {
        setDb('default', OLD_COPY)

        const result = makeApi().getColorScheme()

        expect(result.name).toBe('default')
        expect(result.scheme.textcolor2).toBe('#94a3b8')
        expect(DBState.db.colorScheme.textcolor2).toBe('#64748b')
    })

    test('CG (passes before and after): a custom scheme reports the saved copy', () => {
        setDb('custom', CUSTOM)

        const result = makeApi().getColorScheme()

        expect(result.name).toBe('custom')
        expect(result.scheme).toEqual(CUSTOM)
    })

    test('RR: lite mode reports the lite scheme while the name stays the saved name', () => {
        setDb('custom', CUSTOM)
        isLite.set(true)

        const result = makeApi().getColorScheme()

        expect(result.name).toBe('custom')
        expect(result.scheme).toEqual(colorSchemePresets.lite)
    })

    test('the result is a copy: editing it changes neither the saved copy nor the table', () => {
        setDb('light', OLD_COPY)

        const result = makeApi().getColorScheme()
        result.scheme.textcolor2 = '#000000'

        expect(colorSchemePresets.light.textcolor2).toBe('#525f73')
        expect(DBState.db.colorScheme.textcolor2).toBe('#64748b')
        expect(makeApi().getColorScheme().scheme.textcolor2).toBe('#525f73')
    })
})
