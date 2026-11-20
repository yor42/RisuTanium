/**
 * The V3 plugin `getFetchLogs` hands a plugin with the `fetchLogs` permission the redacted log text only:
 * every entry passes through the request-log redactor on the way out, and the URL is reduced to origin
 * and path, so even a raw entry (one written before redaction existed) leaks no key.
 *
 * Drives the REAL `makeRisuaiAPIV3`. The module-mock set comes from `v3.untrustedFetch.test.ts`
 * (copied, not shared). MOCKED: `globalApi.svelte`, whose `getFetchLogs` returns the raw entry and whose
 * `fetchLogRedactor` is a stub that replaces the synthetic key; the redaction rules themselves are
 * asserted in `requestLogRedact.test.ts` and `globalApi.requestLogRedact.svelte.test.ts`.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import type { RisuPlugin } from '../plugins.svelte'

const K1 = 'sk-test-SYNTHETIC0000abcd'

const h = vi.hoisted(() => ({
    logs: [] as Array<{ url: string, body: string, header: string, response: string, success: boolean, date: string, status?: number }>,
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
        risuFetch: vi.fn(),
        nativeFetch: vi.fn(),
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
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
    forageStorage: {},
    getFetchLogs: vi.fn(() => h.logs),
    fetchLogRedactor: vi.fn(() => (_field: string, text: string) => text.split(K1).join('[redacted]')),
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../network/untrustedFetch'), () => ({
    untrustedNativeFetch: vi.fn(),
    untrustedGlobalFetch: vi.fn(),
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
        name: 'fetch-logs-plugin',
        script: 'script-fetch-logs',
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
    return makeRisuaiAPIV3({} as HTMLIFrameElement, plugin)
}

beforeEach(() => {
    h.logs.length = 0
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('the V3 getFetchLogs of a plugin', () => {
    test('R9 a raw log entry reaches the plugin redacted, with the URL reduced to origin and path', async () => {
        h.logs.push({
            url: `https://api.example.invalid/v1/chat?key=${K1}`,
            body: `{"api_key":"${K1}"}`,
            header: `{"x-api-key":"${K1}"}`,
            response: `{"access_token":"${K1}","ok":true}`,
            success: true,
            date: 'now',
            status: 200,
        })

        const result = await makeApi().getFetchLogs()

        expect(result).toHaveLength(1)
        expect(JSON.stringify(result)).not.toContain(K1)
        expect(result![0].url).toBe('https://api.example.invalid/v1/chat')
        expect(result![0].body).toBe('{"api_key":"[redacted]"}')
        expect(result![0].response).toBe('{"access_token":"[redacted]","ok":true}')
        expect(result![0].status).toBe(200)
    })

    test('guard: with no entries it returns an empty list without needing a redactor', async () => {
        expect(await makeApi().getFetchLogs()).toEqual([])
    })
})
