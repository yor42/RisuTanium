// @vitest-environment jsdom

/**
 * `setChatPanel` (in `src/ts/plugins/apiV3/v3.svelte.ts`) keeps a `<style>`
 * element in a plugin chat panel only when the plugin holds the 'mainDom'
 * permission:
 *
 *  - the panel is stored at once, sanitized and without any `<style>`;
 *  - only a panel whose sanitized markup contains a `<style>` asks for
 *    'mainDom', in a detached step, and a grant puts the style back;
 *  - removing the panel, unloading the plugin or setting the same id again
 *    makes a late grant a no-op.
 *
 * The sanitizer is the real DOMPurify under jsdom; with an identity sanitizer
 * the containment assertions fail (the `onerror` and `<style` checks). The
 * module-mock set comes from `v3PermissionGaps.svelte.test.ts`. Each scenario
 * uses its own plugin name and script, because the session permission cache is
 * keyed by the script hash.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import type { RisuPlugin } from '../plugins.svelte'

//#region module mocks

const alertConfirmMock = vi.hoisted(() => vi.fn(async (_message: string) => true))
const hasherMock = vi.hoisted(() => vi.fn(async (data: Uint8Array) => `hash:${new TextDecoder().decode(data)}`))

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

import { executePluginV3, loadV3Plugins, makeRisuaiAPIV3 } from './v3.svelte'
import { chatPanelStore } from '../../stores.svelte'

//#region fixtures

type PanelRow = { id: string, pluginName: string, html: string, className?: string }

const panels = () => chatPanelStore as unknown as PanelRow[]

// The style sits after an element, so no parser behaviour for a leading
// <style> decides the result.
const STYLED = '<div>a</div><style>body{display:none}</style><img src=x onerror=alert(1)>'

let scenario = 0

function makePlugin(): RisuPlugin {
    scenario += 1
    return {
        name: `panel-plugin-${scenario}`,
        script: `script-panel-${scenario}`,
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
}

function makeApi(plugin: RisuPlugin) {
    return makeRisuaiAPIV3({} as HTMLIFrameElement, plugin)
}

/** A permission prompt the test answers by hand. */
function deferPrompt() {
    let answer: (granted: boolean) => void = () => {}
    alertConfirmMock.mockImplementation(() => new Promise<boolean>((resolve) => {
        answer = resolve
    }))
    return {
        answer: (granted: boolean) => answer(granted),
        asked: () => vi.waitFor(() => expect(alertConfirmMock).toHaveBeenCalled()),
    }
}

/** Lets every detached continuation that can settle do so. */
const settleDetached = async () => {
    for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
}

beforeEach(() => {
    memStore.clear()
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => false)
    panels().length = 0
})

afterEach(async () => {
    await loadV3Plugins([])
    panels().length = 0
})

//#endregion

describe('a panel without mainDom keeps no style (C1, C3)', () => {
    test('C1: the stored panel has no <style> and no event handler when mainDom is denied', async () => {
        const api = makeApi(makePlugin())

        const { id } = api.setChatPanel(STYLED)
        await settleDetached()

        expect(panels()).toHaveLength(1)
        expect(panels()[0].id).toBe(id)
        expect(panels()[0].html).not.toContain('<style')
        expect(panels()[0].html).not.toContain('onerror')
        expect(panels()[0].html).toContain('<div>a</div>')
    })

    test('C1: the panel is stored synchronously, before any prompt is answered', async () => {
        const prompt = deferPrompt()
        const api = makeApi(makePlugin())

        api.setChatPanel(STYLED)

        expect(panels()).toHaveLength(1)
        expect(panels()[0].html).not.toContain('<style')
        await prompt.asked()
        expect(panels()[0].html).not.toContain('<style')
        prompt.answer(false)
        await settleDetached()
        expect(panels()[0].html).not.toContain('<style')
    })

    test('C3: markup without a <style> never asks for mainDom', async () => {
        const api = makeApi(makePlugin())

        api.setChatPanel('<p>plain</p>')
        await settleDetached()

        expect(alertConfirmMock).not.toHaveBeenCalled()
        expect(panels()[0].html).toBe('<p>plain</p>')
    })
})

describe('a panel with mainDom keeps its style (C2)', () => {
    test('C2: compatibility guard, the <style> is back once the grant resolves', async () => {
        const prompt = deferPrompt()
        const api = makeApi(makePlugin())

        api.setChatPanel(STYLED)
        await prompt.asked()
        prompt.answer(true)

        await vi.waitFor(() => expect(panels()[0].html).toContain('<style'))
        expect(panels()[0].html).toContain('<div>a</div>')
        expect(panels()[0].html).not.toContain('onerror')
    })
})

describe('a late grant never revives or overwrites a panel (C5, C6, C7)', () => {
    test('C5: removing the panel while the prompt is pending leaves the store empty', async () => {
        const prompt = deferPrompt()
        const api = makeApi(makePlugin())

        api.setChatPanel(STYLED)
        api.setChatPanel(null)
        await prompt.asked()
        prompt.answer(true)
        await settleDetached()

        expect(panels()).toHaveLength(0)
    })

    test('C6: unloading the plugin while the prompt is pending leaves the store empty', async () => {
        const prompt = deferPrompt()
        const plugin = makePlugin()
        await executePluginV3(plugin)
        // executePluginV3 builds its own API for the sandbox host, so the
        // panel is set through an API of the same plugin.
        const api = makeApi(plugin)

        api.setChatPanel(STYLED)
        await prompt.asked()
        await loadV3Plugins([])
        expect(panels()).toHaveLength(0)
        prompt.answer(true)
        await settleDetached()

        expect(panels()).toHaveLength(0)
    })

    test('C7: a later set wins over an earlier grant', async () => {
        const prompt = deferPrompt()
        const api = makeApi(makePlugin())

        api.setChatPanel(STYLED)
        await prompt.asked()
        api.setChatPanel('<b>2</b>')
        prompt.answer(true)
        await settleDetached()

        expect(panels()).toHaveLength(1)
        expect(panels()[0].html).toBe('<b>2</b>')
    })
})
