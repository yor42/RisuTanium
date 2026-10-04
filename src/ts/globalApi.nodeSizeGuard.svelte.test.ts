/**
 * `saveDb()` on the self-hosted Node server never sends a main file whose
 * encoded length is over the body limit the client knows: it writes nothing,
 * keeps the changes unsaved, writes no numbered backup, parks the save loop
 * with the `too-large` reason and shows one message. The real
 * `globalApi.svelte.ts` and `RisuSaveEncoder` run over the real Node client and
 * Node store against the `FakeNodeServer` stand-in at the `fetch` boundary. The
 * limit is lowered to a few KiB through the limit module so a small database is
 * "over" it. One save loop runs for the whole file (it never returns); the
 * tests that park it come last. A passing test here says nothing about the real
 * server.
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

vi.mock(import('src/ts/storage/nodeBodyLimit'), () => ({
    NODE_BODY_LIMIT_BYTES: 4096,
}))

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
        savingStoppedReason: writable(''),
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

vi.mock('streamsaver', () => ({
    default: {},
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

vi.mock(import('src/ts/storage/mainFileRecord'), () => ({
    noteMainFileBytes: vi.fn(),
    resetMainFileRecordForTests: vi.fn(),
    matchesMainFileRecord: vi.fn(async () => false),
    getMainFileRecordDigest: vi.fn(async () => null),
    digestMainFileBytes: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/storage/mainFileRecord'))

import { afterNextSaveCommit, isSaveClean, saveDb } from 'src/ts/globalApi.svelte'
import { alertError, alertToast } from 'src/ts/alert'
import { noteMainFileBytes } from 'src/ts/storage/mainFileRecord'
import { markCharacterForSave } from 'src/ts/storage/characterSaveMarks'
import { readMainFile } from 'src/ts/storage/store/appStore'
import { savingStoppedReason } from 'src/ts/stores.svelte'

const CHA_ID = 'sized-cha'
const MAIN = 'database/database.bin'
const BACKUP_PREFIX = 'database/dbbackup-'
const LIMIT = 4096

const server = new FakeNodeServer()

function makeDb(prompt: string): Record<string, unknown> {
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        mainPrompt: prompt,
        characters: [{
            chaId: CHA_ID,
            name: 'Sized',
            type: 'character',
            chatPage: 0,
            chats: [{ id: 'sized-chat', message: [], note: '', name: '', localLore: [] }],
        }],
    }
}

/** Text that does not shrink under any compression, so the encoded file is over the lowered limit. */
function incompressible(length: number): string {
    let state = 12345
    let out = ''
    while (out.length < length) {
        state = (state * 1103515245 + 12345) & 0x7fffffff
        out += state.toString(36)
    }
    return out.slice(0, length)
}

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

function writesTo(predicate: (key: string) => boolean) {
    return server.requestsTo('/api/write').filter((request) => predicate(pathOf(request)))
}

function mainWrites() {
    return writesTo((key) => key === MAIN)
}

function backupWrites() {
    return writesTo((key) => key.startsWith(BACKUP_PREFIX))
}

function notedCount(): number {
    return vi.mocked(noteMainFileBytes).mock.calls.length
}

beforeAll(async () => {
    vi.stubGlobal('fetch', server.fetch)
    h.db = makeDb('first')
    server.seed(MAIN, Uint8Array.from([1, 2, 3]))
    await readMainFile()
    // The save loop never returns; it is only awaited far enough to be running.
    void saveDb()
    await settle(100)
})

afterAll(() => {
    h.parked = true
    vi.unstubAllGlobals()
})

describe('saveDb size guard on the Node server', () => {
    test('guard: a save whose encoded file is under the limit is sent, backed up and committed, and nothing is shown', async () => {
        requestSave('small')
        await vi.waitFor(() => { expect(notedCount()).toBe(1) }, { timeout: 8000, interval: 10 })
        await vi.waitFor(() => { expect(backupWrites()).toHaveLength(1) }, { timeout: 8000, interval: 10 })

        expect(mainWrites()).toHaveLength(1)
        expect((server.files.get(MAIN)?.bytes.length ?? 0)).toBeLessThanOrEqual(LIMIT)
        expect(get(savingStoppedReason)).toBe('')
        expect(alertToast).not.toHaveBeenCalled()
        expect(alertError).not.toHaveBeenCalled()
    })

    test('an encoded file over the limit is not sent, no backup is written, the changes stay unsaved, and the loop parks with one message', async () => {
        await settle(100)
        const mainBefore = mainWrites().length
        const backupsBefore = backupWrites().length
        const notedBefore = notedCount()
        const storedBefore = Array.from(server.files.get(MAIN)?.bytes ?? [])
        const committed = vi.fn()
        afterNextSaveCommit(committed)

        requestSave(incompressible(LIMIT * 2))
        await vi.waitFor(() => { expect(get(savingStoppedReason)).toBe('too-large') }, { timeout: 8000, interval: 10 })

        // A retry loop would send again within a few of the (shortened) sleeps.
        await settle(300)
        const requestsAfterPark = server.requests.length
        await settle(300)
        requestSave(incompressible(LIMIT * 3))
        await settle(300)

        expect(server.requests.length).toBe(requestsAfterPark)
        expect(mainWrites()).toHaveLength(mainBefore)
        expect(backupWrites()).toHaveLength(backupsBefore)
        expect(Array.from(server.files.get(MAIN)?.bytes ?? [])).toEqual(storedBefore)
        expect(notedCount()).toBe(notedBefore)
        expect(committed).not.toHaveBeenCalled()
        expect(isSaveClean()).toBe(false)
        expect(alertError).not.toHaveBeenCalled()
        expect(vi.mocked(alertToast).mock.calls).toHaveLength(1)
        const message = String(vi.mocked(alertToast).mock.calls[0][0])
        expect(message).toContain('stopped saving')
        expect(message).toContain(String(LIMIT / (1024 * 1024)))
    }, 20000)
})
