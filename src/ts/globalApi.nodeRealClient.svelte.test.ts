/**
 * `saveDb()` on the self-hosted Node server through the real Node client and
 * the real Node store: the commit's writes go over the wire with the revision
 * this page holds, and another device's change to the root answers a stale
 * write with a 409, which parks the loop with the conflict message. The real
 * `globalApi.svelte.ts`, `RisuSaveEncoder`, block-store owner, `NodeStorage` and
 * Node HTTP store run against the `FakeNodeServer` stand-in at the `fetch`
 * boundary. One save loop runs for the whole file (it never returns); the test
 * that parks it is the last one. A passing test here says nothing about the
 * real server.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { get, writable } from 'svelte/store'
import { FakeNodeServer } from 'src/ts/storage/tests/manualCleanupHarness'

const h = vi.hoisted(() => ({
    parked: false,
    db: undefined as undefined | Record<string, unknown>,
    keyPair: null as CryptoKeyPair | null,
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

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: true,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => h.db),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        botMakerMode: writable(false),
        loadedStore: writable(false),
        LoadingStatusState: { text: '' },
        ReloadGUIPointer: writable(0),
        bodyIntercepterStore: writable(null),
        savingStoppedReason: writable(null),
        frozenSaveKeysStore: writable([]),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn((ms: number) => h.parked
        ? new Promise<void>(() => {})
        : new Promise<void>((resolve) => setTimeout(resolve, Math.min(ms, 5)))),
    sleepForever: vi.fn(() => new Promise<void>(() => {})),
    base64url: (source: Uint8Array | ArrayBuffer) => Buffer.from(source as Uint8Array).toString('base64url'),
    getKeypairStore: vi.fn(async () => {
        h.keyPair ??= await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
        return h.keyPair
    }),
    saveKeypairStore: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: vi.fn(async () => undefined),
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
    open: vi.fn(async () => {}),
}))

vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: {
                getWriter: () => ({
                    write: async () => { },
                    close: async () => { },
                }),
            },
        }),
    },
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({
        listen: vi.fn(),
        setTitle: vi.fn(),
    })),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0 },
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readFile: vi.fn(async () => { throw new Error('no file system on the Node server') }),
    writeFile: vi.fn(async () => {}),
    readDir: vi.fn(async () => []),
    remove: vi.fn(async () => {}),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => null),
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => vi.fn()),
}))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

// The storage object over the real Node client, as `AutoStorage` builds it on a Node server.
vi.mock(import('src/ts/storage/autoStorage'), async () => {
    const { NodeStorage } = await import('src/ts/storage/nodeStorage')
    class FakeAutoStorage {
        realStorage = new NodeStorage()
        async Init() {}
        async getItem(key: string) { return await this.realStorage.getItem(key) }
        async setItem(key: string, value: Uint8Array) { await this.realStorage.setItem(key, value) }
        async keys() { return await this.realStorage.keys() }
        async removeItem(key: string) { return await this.realStorage.removeItem(key) }
    }
    return { AutoStorage: FakeAutoStorage } as unknown as typeof import('src/ts/storage/autoStorage')
})

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/observer.svelte'), () => ({
    startObserveDom: vi.fn(),
}) as unknown as typeof import('src/ts/observer.svelte'))

vi.mock(import('src/ts/gui/guisize'), () => ({
    updateGuisize: vi.fn(),
}) as unknown as typeof import('src/ts/gui/guisize'))

vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((v: unknown) => v),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('src/ts/hotkey'))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    getColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

import { saveDb } from 'src/ts/globalApi.svelte'
import { alertToast } from 'src/ts/alert'
import { markCharacterForSave } from 'src/ts/storage/characterSaveMarks'
import { getPageBlockOwner } from 'src/ts/storage/pageBlockOwner'
import { setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { treeToBlockSet } from 'src/ts/storage/treeToBlockSet'
import { savingStoppedReason } from 'src/ts/stores.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import type { Database } from 'src/ts/storage/database.svelte'
import type { BlockStoreOwner } from 'src/ts/storage/blockStore'

const CHA_ID = 'saved-cha'
const server = new FakeNodeServer()
let owner: BlockStoreOwner

function settle(ms = 80): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function requestSave(prompt: string): void {
    h.db!.mainPrompt = prompt
    markCharacterForSave(CHA_ID)
}

function pathOf(request: { headers: Record<string, string> }): string {
    return Buffer.from(request.headers['file-path'] ?? '', 'hex').toString('utf-8')
}

function rootWrites() {
    return server.requestsTo('/api/write').filter((request) => /^blocks\/[^/]+\/root$/.test(pathOf(request)))
}

const rootKey = () => `blocks/${owner.committedState()!.generation}/root`

beforeAll(async () => {
    vi.stubGlobal('fetch', server.fetch)
    // A page without Web Locks has no `navigator.locks` at all; the test environment answers null.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    h.db = makeDb('first', [CHA_ID])
    owner = (await getPageBlockOwner())!
    const seeded = await owner.replaceWholeState(await treeToBlockSet(structuredClone(h.db) as unknown as Database), { requireAbsentHead: true })
    expect(seeded.kind).toBe('won')
    setPageStorageMode({ kind: 'block' })
    void saveDb()
    await settle(100)
})

afterAll(() => {
    h.parked = true
    vi.unstubAllGlobals()
})

describe('saveDb on the Node server through the real client', () => {
    test('a commit presents the revision of the root this page holds and lands over the wire', async () => {
        const expected = String(server.revisionOf(rootKey()))
        server.requests.length = 0

        requestSave('second')
        await vi.waitFor(() => { expect(rootWrites()).toHaveLength(1) }, { timeout: 8000, interval: 10 })
        await settle()

        expect(rootWrites()[0].headers['if-match-revision']).toBe(expected)
        expect(get(savingStoppedReason)).toBeNull()
        expect(alertToast).not.toHaveBeenCalled()
    })

    test('a save after another device changed the root is answered with a 409, saving stops with the node-conflict message, and the other device\'s root is untouched', async () => {
        const peerRoot = Uint8Array.from([9, 9, 9, 9])
        server.peerWrite(rootKey(), peerRoot)
        server.requests.length = 0

        requestSave('third')
        await vi.waitFor(() => { expect(get(savingStoppedReason)).toBe('node-conflict') }, { timeout: 8000, interval: 10 })
        await settle(150)

        expect(rootWrites()).toHaveLength(1)
        expect(Array.from(server.files.get(rootKey())?.bytes ?? [])).toEqual(Array.from(peerRoot))
        expect(vi.mocked(alertToast).mock.calls.map((call) => String(call[0]))).toEqual([
            expect.stringContaining('conflicts with a newer version'),
        ])
    })
})
