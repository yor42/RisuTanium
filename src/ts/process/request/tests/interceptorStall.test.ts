/**
 * A plugin body interceptor that never settles cannot hold a request after a Stop: `globalFetch` answers the
 * aborted result and `fetchNative` rejects `aborted`, in both cases before anything is sent. Without a Stop the
 * interceptor is awaited and its returned body replaces the request body.
 *
 * Drives the real `globalFetch` and `fetchNative` of `globalApi.svelte.ts` and the real interceptor loop. Mocked: the
 * platform packages, the `fetch` of the page (a fake proxy that records what it is sent) and the stores.
 *
 * Tests whose title starts with `guard:` pass with or without the change and pin behaviour that must be preserved.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../../storage/database.svelte'
import '../../../polyfill'
//#region module mocks

const h = vi.hoisted(() => ({
    interceptors: [] as Array<{ id: string, callback: (body: unknown, type: string) => Promise<unknown> }>,
    seen: [] as string[],
    sent: [] as Array<{ url: string, body: string }>,
    replies: [] as Array<{ status: number, body: unknown }>,
}))

vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) } }))
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: vi.fn((p: string) => p), invoke: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({ appDataDir: vi.fn(async () => '/appdata'), join: vi.fn(async (...p: string[]) => p.join('/')), basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn(async () => {}) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(async () => null), open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }))
vi.mock('src/ts/vendor/streamSaver', () => ({ default: { useBlobFallback: false, createWriteStream: () => ({ ready: Promise.resolve(), writable: { getWriter: () => ({ write: async () => {}, close: async () => {} }) } }) } }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))
vi.mock('dompurify', () => ({ default: { addHook: vi.fn(), sanitize: (html: string) => html } }))
vi.mock('../../../platform', () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }))
vi.mock('../../../storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn(), installCharacterSaveMarks: vi.fn(), appendIfAbsent: vi.fn() }))

vi.mock('../../../stores.svelte', () => ({
    DBState: { db: {} },
    CharEmotion: writable({}), selectedCharID: writable(-1), selIdState: { selId: 0 },
    CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
    HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''),
    botMakerMode: writable(false), LoadingStatusState: { text: '' }, savingStoppedReason: writable(null),
    frozenSaveKeysStore: writable([]), peerWaitingStatus: writable(null), MobileGUI: writable(false), loadedStore: writable(false),
    bodyIntercepterStore: h.interceptors,
}))

vi.mock('../../../alert', () => ({
    alertError: vi.fn(), alertToast: vi.fn(), alertInput: vi.fn(async () => ''), alertNormal: vi.fn(), alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true), alertClear: vi.fn(), alertModuleSelect: vi.fn(async () => -1), alertStore: writable({ type: '', msg: '' }), alertWait: vi.fn(),
    alertMd: vi.fn(), waitAlert: vi.fn(async () => {}), alertNormalWait: vi.fn(), alertAddCharacter: vi.fn(),
}))

vi.mock('../../../storage/nodeStorage', () => ({ getNodeServerProxyAuth: vi.fn(async () => null) }))
vi.mock('../../../update', () => ({ checkRisuUpdate: vi.fn(async () => {}) }))
vi.mock('../../../plugins/plugins.svelte', () => ({
    loadPlugins: vi.fn(async () => {}),
    pluginV2: {
        editdisplay: new Set(), editoutput: new Set(), editprocess: new Set(), editinput: new Set(), chatOutput: new Set(),
        replacerbeforeRequest: new Set(), replacerafterRequest: new Set(), providers: new Map(),
    },
    pluginProcess: vi.fn(),
}))
vi.mock('../../../characterCards', () => ({ characterURLImport: vi.fn(), hubURL: 'https://example.invalid' }))
vi.mock('../../../storage/dbChangeEffects.svelte', () => ({ registerDbChangeEffects: vi.fn() }))
vi.mock('../../../storage/autoStorage', () => ({ AutoStorage: class { async getItem() { return null } async setItem() {} async keys() { return [] as string[] } async removeItem() {} } }))
vi.mock('../../../gui/animation', () => ({ updateAnimationSpeed: vi.fn() }))
vi.mock('../../../gui/colorscheme', () => ({ updateColorScheme: vi.fn(), updateTextThemeAndCSS: vi.fn() }))
vi.mock('../../../observer.svelte', () => ({ startObserveDom: vi.fn() }))
vi.mock('../../../gui/guisize', () => ({ updateGuisize: vi.fn() }))
vi.mock('../../../hotkey', () => ({ initMobileGesture: vi.fn() }))
vi.mock('../../modules', () => ({ moduleUpdate: vi.fn(async () => {}) }))
vi.mock('../../coldstorage.svelte', () => ({ getColdStorageItem: vi.fn() }))

vi.mock('../../../tokenizer', () => ({
    ChatTokenizer: class { constructor(_a: number, _b: string) {} async tokenizeChat() { return 1 } },
    tokenize: vi.fn(async (s: string) => (s?.length ?? 0)), tokenizeNum: vi.fn(async () => [] as number[]),
}))

vi.mock('../../../characters', () => ({ createBlankChar: vi.fn(() => ({ name: '', chaId: '' })), getCharImage: vi.fn(), updateLorebooks: vi.fn((v: unknown) => v) }))
vi.mock('../../command', () => ({ processMultiCommand: vi.fn(async () => {}) }))
vi.mock('../../files/inlays', () => ({
    getInlayAsset: vi.fn(), getInlayAssetBlob: vi.fn(async () => undefined), writeInlayImage: vi.fn(async () => 'x'), supportsInlayImage: vi.fn(() => false),
    saveInlayedSignature: vi.fn(), setInlayAsset: vi.fn(),
}))
vi.mock('../../../media', () => ({ compressImage: vi.fn(async (v: unknown) => v) }))
vi.mock('../../tts', () => ({ sayTTS: vi.fn() }))
vi.mock('../../mcp/mcp', () => ({ getTools: vi.fn(async () => []), callTool: vi.fn(async () => [{ type: 'text', text: 'listing' }]), decodeToolCall: vi.fn(), encodeToolCall: vi.fn() }))
vi.mock('../../utility/workspace/workspaceModel.svelte', () => ({ hasWorkspace: vi.fn(() => true) }))
vi.mock('../../utility/workspace/instructionSources', () => ({ buildWorkspaceInstructions: vi.fn(async () => ({ text: '' })) }))

vi.mock('../../../util', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../util')>()),
    sleep: async () => {},
}))

vi.mock('../../../storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../storage/tauriByteTransport')>()),
    isDesktopTransport: () => true,
}))

vi.mock('../../../storage/database.svelte', async () => {
    const stores = await import('../../../stores.svelte')
    const state = stores.DBState as unknown as { db: object }
    return {
        appVer: '0.0.0', appSubVer: '', presetTemplate: {}, defaultSdDataFunc: vi.fn(() => ({})), changeToPreset: vi.fn(), setCurrentChat: vi.fn(), setDatabase: vi.fn(),
        getDatabase: vi.fn(() => state.db), getCurrentCharacter: vi.fn(() => undefined), getCurrentChat: vi.fn(() => undefined),
    }
})

let DBState: { db: Database }
let globalApi: typeof import('../../../globalApi.svelte')
const realFetch = globalThis.fetch
let fetchSpy: ReturnType<typeof vi.fn>

beforeAll(async () => {
    DBState = (await import('../../../stores.svelte')).DBState as unknown as { db: Database }
    globalApi = await import('../../../globalApi.svelte')
}, 60000)

beforeEach(() => {
    h.seen.length = 0
    h.sent.length = 0
    h.replies.length = 0
    h.interceptors.length = 0
    DBState.db = { characters: [], enabledModules: [], modules: [], fallbackModels: {}, requestRetrys: 0 } as unknown as Database
    fetchSpy = vi.fn(async (_proxy: string, init: { body?: unknown }) => {
        h.sent.push({ url: '', body: typeof init.body === 'string' ? init.body : init.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : '' })
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    globalThis.fetch = fetchSpy as unknown as typeof fetch
})

afterEach(() => {
    globalThis.fetch = realFetch
})

const hang = () => new Promise<never>(() => {})

async function flush() {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('a body interceptor that never settles', () => {
    test('I-1: globalFetch answers the aborted result after the abort and sends nothing', async () => {
        h.interceptors.push({ id: 'hang', callback: hang })
        const controller = new AbortController()
        let settled = false
        const call = globalApi.globalFetch('https://example.invalid/v1', { method: 'POST', body: '{}', interceptor: 'openai_basic', abortSignal: controller.signal })
            .then((value) => { settled = true; return value })
        await flush()
        expect(settled).toBe(false)
        controller.abort()
        await flush()

        expect(settled).toBe(true)
        expect(await call).toEqual({ ok: false, data: 'aborted', headers: {}, status: 400 })
        expect(fetchSpy).not.toHaveBeenCalled()
    })

    test('I-2: fetchNative rejects aborted after the abort and sends nothing', async () => {
        h.interceptors.push({ id: 'hang', callback: hang })
        const controller = new AbortController()
        let outcome: 'pending' | 'rejected' | 'resolved' = 'pending'
        let reason: unknown
        const call = globalApi.fetchNative('https://example.invalid/v1', { method: 'POST', body: '{}', interceptor: 'openai_basic', signal: controller.signal })
            .then(() => { outcome = 'resolved' }, (error) => { outcome = 'rejected'; reason = error })
        await flush()
        expect(outcome).toBe('pending')
        controller.abort()
        await flush()

        expect(outcome).toBe('rejected')
        expect((reason as Error).message).toBe('aborted')
        expect(fetchSpy).not.toHaveBeenCalled()
    })

    test('I-3: guard, without a Stop the interceptor is awaited and its body replaces the request body', async () => {
        h.interceptors.push({ id: 'slow', callback: async () => { await new Promise((resolve) => setTimeout(resolve, 5)); return JSON.stringify({ replaced: true }) } })
        const controller = new AbortController()

        await globalApi.globalFetch('https://example.invalid/v1', { method: 'POST', body: '{}', interceptor: 'openai_basic', abortSignal: controller.signal })

        expect(h.sent[0].body).toContain('replaced')
    })

    test('I-3b: guard, a falsy return keeps the request body', async () => {
        h.interceptors.push({ id: 'noop', callback: async () => undefined })

        await globalApi.globalFetch('https://example.invalid/v1', { method: 'POST', body: '{"keep":1}', interceptor: 'openai_basic' })

        expect(h.sent[0].body).toContain('keep')
    })
})
