/**
 * The V3 plugin `risuFetch` and `nativeFetch` are untrusted callers: they fetch through the untrusted
 * wrappers and never through the V2 API's `globalFetch` and `fetchNative`, and their URL and header
 * checks still run first.
 *
 * Drives the REAL `makeRisuaiAPIV3`. The module-mock set comes from
 * `tests/v3PermissionGaps.svelte.test.ts`. MOCKED: the untrusted wrappers and the V2 API fakes; the
 * policy the wrappers add is asserted in `network/tests/untrustedFetch.test.ts` and
 * `globalApi.untrustedNative.svelte.test.ts`.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import type { RisuPlugin } from '../plugins.svelte'

const h = vi.hoisted(() => ({
    untrustedNative: vi.fn(),
    untrustedGlobal: vi.fn(),
    oldRisuFetch: vi.fn(),
    oldNativeFetch: vi.fn(),
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
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
        risuFetch: h.oldRisuFetch,
        nativeFetch: h.oldNativeFetch,
    }),
    handlePluginInstallViaPlugin: vi.fn(),
    pluginV2: {
        providers: new Map(),
        providerOptions: new Map(),
        chatOutput: new Set(),
    },
}) as unknown as typeof import('../plugins.svelte'))

vi.mock(import('./factory'), () => ({
    SandboxHost: class {},
}) as unknown as typeof import('./factory'))

vi.mock(import('../../storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({}) as unknown),
}) as unknown as typeof import('../../storage/database.svelte'))

vi.mock(import('../pluginSafeClass'), () => ({
    SafeLocalPluginStorage: class {},
    tagWhitelist: [],
}) as unknown as typeof import('../pluginSafeClass'))

vi.mock('dompurify', () => ({
    default: { sanitize: (v: string) => v },
}))

vi.mock(import('../../stores.svelte'), () => ({
    DBState: { db: {} as unknown as Database },
    selectedCharID: writable(0),
    additionalChatMenu: [],
    additionalFloatingActionButtons: [],
    additionalHamburgerMenu: [],
    additionalSettingsMenu: [],
    bodyIntercepterStore: [],
    chatPanelStore: [],
}) as unknown as typeof import('../../stores.svelte'))

vi.mock(import('../../util'), () => ({
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../../util'))

vi.mock(import('../../alert'), () => ({
    alertConfirm: vi.fn(async () => false),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
    forageStorage: {},
    getFetchLogs: vi.fn(() => []),
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../network/untrustedFetch'), () => ({
    untrustedNativeFetch: h.untrustedNative,
    untrustedGlobalFetch: h.untrustedGlobal,
}) as unknown as typeof import('../../network/untrustedFetch'))

vi.mock(import('../../gui/colorscheme'), () => ({
    changeColorScheme: vi.fn(),
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('../../gui/colorscheme'))

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
    hasher: vi.fn(async (data: Uint8Array) => `hash:${new TextDecoder().decode(data)}`),
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

import { makeRisuaiAPIV3 } from './v3.svelte'

function makeApi() {
    const plugin: RisuPlugin = {
        name: 'untrusted-fetch-plugin',
        script: 'script-untrusted-fetch',
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
    return makeRisuaiAPIV3({} as HTMLIFrameElement, plugin)
}

beforeEach(() => {
    h.untrustedNative.mockReset()
    h.untrustedGlobal.mockReset()
    h.oldRisuFetch.mockReset()
    h.oldNativeFetch.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('the V3 fetch APIs of a plugin', () => {
    test('T1 nativeFetch goes through the untrusted wrapper, with the plugin\'s own options passed unchanged', async () => {
        const reply = new Response('ok')
        h.untrustedNative.mockResolvedValue(reply)
        const options = { method: 'GET' as const, headers: { Accept: 'text/plain' } }

        expect(await makeApi().nativeFetch('https://192.168.1.10/x', options)).toBe(reply)

        expect(h.untrustedNative).toHaveBeenCalledWith('https://192.168.1.10/x', options)
        expect(h.oldNativeFetch).not.toHaveBeenCalled()
    })

    test('T1 risuFetch goes through the untrusted wrapper', async () => {
        const outcome = { ok: true, data: {}, headers: {}, status: 200 }
        h.untrustedGlobal.mockResolvedValue(outcome)
        const options = { method: 'POST' as const, body: { a: 1 } }

        expect(await makeApi().risuFetch('https://192.168.1.10/x', options)).toBe(outcome)

        expect(h.untrustedGlobal).toHaveBeenCalledWith('https://192.168.1.10/x', options)
        expect(h.oldRisuFetch).not.toHaveBeenCalled()
    })

    test('guard: the blocked-host check still refuses before any request', () => {
        const api = makeApi()
        expect(() => api.nativeFetch('https://risuai.xyz/x', { method: 'GET' })).toThrow('blocked for security reasons')
        expect(() => api.risuFetch('https://sionyw.com/x', {})).toThrow('blocked for security reasons')
        expect(h.untrustedNative).not.toHaveBeenCalled()
        expect(h.untrustedGlobal).not.toHaveBeenCalled()
    })
})
