// @vitest-environment jsdom

/**
 * Plugin lifecycle in `v3.svelte.ts`:
 *
 *  - `loadV3Plugins` unloads every running instance, including when several run
 *    at once (R1);
 *  - a replacer added by a plugin is removed again when the plugin unloads (R2),
 *    and a throwing unload callback never stops termination (G-c);
 *  - a mutation observer hands the plugin its records as remote references, and
 *    a record exposes the removed nodes (R6, through the real `SandboxHost`).
 *
 * Labels: R = regression reproducer (fails on the pre-fix code), G =
 * compatibility guard (passes before and after). The module-mock set comes from
 * `v3.chatPanel.svelte.test.ts`; each scenario uses its own plugin name and
 * script, because the session permission cache is keyed by the script hash.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import type { RisuPlugin } from '../plugins.svelte'

//#region module mocks

const alertConfirmMock = vi.hoisted(() => vi.fn(async (_message: string) => true))
const hasherMock = vi.hoisted(() => vi.fn(async (data: Uint8Array) => `hash:${new TextDecoder().decode(data)}`))
const replacers = vi.hoisted(() => ({
    beforeRequest: new Set<unknown>(),
    throwOnRemove: false,
}))

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
        addRisuReplacer: (name: string, func: unknown) => {
            if (name === 'beforeRequest') replacers.beforeRequest.add(func)
        },
        removeRisuReplacer: (name: string, func: unknown) => {
            if (replacers.throwOnRemove) throw new Error('unload callback failure')
            if (name === 'beforeRequest') replacers.beforeRequest.delete(func)
        },
    }),
    handlePluginInstallViaPlugin: vi.fn(),
    pluginV2: {
        providers: new Map(),
        providerOptions: new Map(),
        chatOutput: new Set(),
    },
}) as unknown as typeof import('../plugins.svelte'))

const hostTerminateMock = vi.hoisted(() => vi.fn())
vi.mock(import('./factory'), () => ({
    SandboxHost: class {
        constructor(_api: unknown) {}
        run() {}
        terminate() {
            hostTerminateMock()
        }
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
    const state = $state({ db: {} as unknown as Database })
    const chatPanelStore = $state([] as unknown[])
    return {
        DBState: state,
        selectedCharID: writable(0),
        additionalChatMenu: [],
        additionalFloatingActionButtons: [],
        additionalHamburgerMenu: [],
        additionalSettingsMenu: [],
        bodyIntercepterStore: [],
        chatPanelStore,
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../../util'), () => ({
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../../util'))

vi.mock(import('../../alert'), () => ({
    alertConfirm: alertConfirmMock,
    alertError: vi.fn(),
    alertNormal: vi.fn(),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
    forageStorage: {},
    getFetchLogs: vi.fn(() => []),
}) as unknown as typeof import('../../globalApi.svelte'))

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
    hasher: hasherMock,
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

import { executePluginV3, getV3PluginInstance, loadV3Plugins, makeRisuaiAPIV3 } from './v3.svelte'

//#region fixtures

let scenario = 0

function makePlugin(): RisuPlugin {
    scenario += 1
    return {
        name: `lifecycle-plugin-${scenario}`,
        script: `script-lifecycle-${scenario}`,
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
}

const makeApi = (plugin: RisuPlugin) => makeRisuaiAPIV3({} as HTMLIFrameElement, plugin)

// jsdom has no iframe `sandbox` token list; the real `SandboxHost.run` only
// adds tokens to it.
if (!('sandbox' in HTMLIFrameElement.prototype)) {
    Object.defineProperty(HTMLIFrameElement.prototype, 'sandbox', {
        configurable: true,
        get() { return { add() {} } },
    })
}

beforeEach(() => {
    memStore.clear()
    hostTerminateMock.mockReset()
    replacers.beforeRequest.clear()
    replacers.throwOnRemove = false
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    vi.stubGlobal('ImageBitmap', class {})
})

afterEach(async () => {
    replacers.throwOnRemove = false
    await loadV3Plugins([])
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

//#endregion

describe('loadV3Plugins unload', () => {
    test('R1: every running instance is unloaded, not every other one', async () => {
        const a = makePlugin()
        const b = makePlugin()
        await executePluginV3(a)
        await executePluginV3(b)
        expect(getV3PluginInstance(a.name)).toBeDefined()
        expect(getV3PluginInstance(b.name)).toBeDefined()

        await loadV3Plugins([])

        expect(hostTerminateMock).toHaveBeenCalledTimes(2)
        expect(getV3PluginInstance(a.name)).toBeUndefined()
        expect(getV3PluginInstance(b.name)).toBeUndefined()
    })

    test('R1 companion: three instances are all unloaded and the new list starts afresh', async () => {
        const plugins = [makePlugin(), makePlugin(), makePlugin()]
        for (const plugin of plugins) await executePluginV3(plugin)

        const keep = makePlugin()
        await loadV3Plugins([keep])

        expect(hostTerminateMock).toHaveBeenCalledTimes(3)
        for (const plugin of plugins) expect(getV3PluginInstance(plugin.name)).toBeUndefined()
        expect(getV3PluginInstance(keep.name)).toBeDefined()
    })
})

describe('replacer unload', () => {
    test('R2: a replacer added by a plugin is removed when the plugin unloads', async () => {
        const plugin = makePlugin()
        await executePluginV3(plugin)
        const api = makeApi(plugin)
        const replacer = async (content: string) => content

        await api.addRisuReplacer('beforeRequest', replacer)
        expect(replacers.beforeRequest.has(replacer)).toBe(true)

        await loadV3Plugins([])

        expect(replacers.beforeRequest.size).toBe(0)
    })

    test('R2 guard: a replacer the plugin removed itself leaves unload without error', async () => {
        const plugin = makePlugin()
        await executePluginV3(plugin)
        const api = makeApi(plugin)
        const replacer = (async (content: string) => content) as unknown as Parameters<typeof api.removeRisuReplacer>[1]

        await api.addRisuReplacer('beforeRequest', replacer)
        api.removeRisuReplacer('beforeRequest', replacer)
        expect(replacers.beforeRequest.size).toBe(0)

        await expect(loadV3Plugins([])).resolves.toBeUndefined()
        expect(hostTerminateMock).toHaveBeenCalledTimes(1)
    })

    test('G-c: a throwing unload callback does not stop termination', async () => {
        const plugin = makePlugin()
        await executePluginV3(plugin)
        const api = makeApi(plugin)
        vi.spyOn(console, 'error').mockImplementation(() => {})

        await api.addRisuReplacer('beforeRequest', async (content: string) => content)
        replacers.throwOnRemove = true
        await loadV3Plugins([])

        expect(hostTerminateMock).toHaveBeenCalledTimes(1)
        expect(getV3PluginInstance(plugin.name)).toBeUndefined()
    })
})

//#region real SandboxHost for the mutation observer

type Msg = Record<string, unknown>

async function makeRealHostRig(plugin: RisuPlugin) {
    const { SandboxHost } = await vi.importActual<typeof import('./factory')>('./factory')
    const host = new SandboxHost(makeApi(plugin))
    const container = document.createElement('div')
    document.body.appendChild(container)
    host.run(container, '')
    const win = (container.querySelector('iframe') as HTMLIFrameElement).contentWindow as Window
    const posted: Msg[] = []
    vi.spyOn(win, 'postMessage').mockImplementation(((message: Msg) => {
        posted.push(message)
    }) as unknown as typeof win.postMessage)
    let counter = 0
    const settle = async () => {
        for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const request = async (data: Msg) => {
        const reqId = `r${++counter}`
        const event = new MessageEvent('message', { data: { ...data, reqId } })
        Object.defineProperty(event, 'source', { value: win })
        window.dispatchEvent(event)
        await settle()
        const response = posted.find((m) => m.type === 'RESPONSE' && m.reqId === reqId)
        if (!response) throw new Error('no RESPONSE for ' + reqId)
        if (response.error) throw new Error(String(response.error))
        return response.result as { id: string } & Record<string, unknown>
    }
    return { host, posted, request, settle }
}

describe('mutation observer records', () => {
    test('R6: the callback receives remote references and a record exposes the removed element nodes', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {})
        const rig = await makeRealHostRig(makePlugin())
        let observerId = ''
        try {
            const root = await rig.request({ type: 'CALL_ROOT', method: 'getRootDocument', args: [] })
            const observer = await rig.request({
                type: 'CALL_ROOT',
                method: 'createMutationObserver',
                args: [{ __type: 'CALLBACK_REF', id: 'cb_mutation' }],
            })
            observerId = observer.id
            await rig.request({
                type: 'CALL_INSTANCE',
                id: observer.id,
                method: 'observe',
                args: [{ __type: 'REMOTE_REF', id: root.id }, { childList: true, subtree: true }],
            })

            const element = document.createElement('div')
            const text = document.createTextNode('text')
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
            document.body.append(element, text, svg)
            await rig.settle()
            element.remove()
            text.remove()
            svg.remove()
            await rig.settle()

            const invokes = rig.posted.filter((m) => m.type === 'INVOKE_CALLBACK') as { args: unknown[] }[]
            expect(invokes).toHaveLength(2)
            const removalArg = invokes[1].args[0] as { __type?: string, id: string }
            expect(removalArg.__type).toBe('REMOTE_REF')

            const record = await rig.request({ type: 'CALL_INSTANCE', id: removalArg.id, method: 'at', args: [0] })
            const removed = await rig.request({ type: 'CALL_INSTANCE', id: record.id, method: 'getRemovedNodes', args: [] })
            const added = await rig.request({ type: 'CALL_INSTANCE', id: record.id, method: 'getAddedNodes', args: [] })
            // Only the HTMLElement counts: the text node and the SVG element are excluded.
            expect(await rig.request({ type: 'CALL_INSTANCE', id: removed.id, method: 'length', args: [] })).toBe(1)
            expect(await rig.request({ type: 'CALL_INSTANCE', id: added.id, method: 'length', args: [] })).toBe(0)
        } finally {
            // A live observer would report the teardown's DOM removals after the
            // test's globals are gone.
            if (observerId) await rig.request({ type: 'CALL_INSTANCE', id: observerId, method: 'disconnect', args: [] })
            rig.host.terminate()
        }
    })
})

//#endregion
