/**
 * `getDbBackups()` on the self-hosted Node server: which numbered backups it
 * lists and which it removes. The real `globalApi.svelte.ts` runs over the real
 * `NodeStorage` or Node store, whichever it uses, against the `FakeNodeServer`
 * stand-in at the `fetch` boundary, so the same assertions run whichever client
 * class the backups go through. A passing test here says nothing about the real
 * server's file handling.
 *
 * Tests titled `guard:` assert behaviour that must not change; the others assert
 * behaviour only the contract-based backups have.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { FakeNodeServer } from 'src/ts/storage/tests/manualCleanupHarness'

const h = vi.hoisted(() => ({
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
    sleep: vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 1))),
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

import { forageStorage, getDbBackups } from 'src/ts/globalApi.svelte'

const BACKUP_PREFIX = 'database/dbbackup-'

// One server for the file: the page's storage object keeps the revisions it has
// seen, so the server's revision counters must survive from test to test.
const server = new FakeNodeServer()

function bytes(...values: number[]): Uint8Array {
    return Uint8Array.from(values)
}

/**
 * Seeds `base + first` through `base + last`. Each test uses a range of its own:
 * the page's storage object remembers the revision of every key it has touched.
 */
function seedBackups(base: number, first: number, last: number): void {
    for (let n = first; n <= last; n++) {
        server.seed(`${BACKUP_PREFIX}${base + n}.bin`, bytes(n))
    }
}

/** The numbers `getDbBackups` lists for a seeded range, newest first. */
function newest(base: number, last: number, count: number): number[] {
    return Array.from({ length: count }, (_, index) => base + last - index)
}

function backupKeys(): string[] {
    return server.keysWithPrefix(BACKUP_PREFIX).sort()
}

function removeRequests() {
    return server.requestsTo('/api/remove')
}

beforeEach(() => {
    server.files.clear()
    server.requests.length = 0
    server.strayNames.length = 0
    server.beforeRequest = undefined
    server.afterRequest = undefined
    vi.stubGlobal('fetch', server.fetch)
})

describe('getDbBackups on the Node server', () => {
    test('guard: with more than 20 backups it removes the oldest and lists the newest 20, newest first', async () => {
        seedBackups(1000, 1, 23)

        const listed = await getDbBackups()

        expect(listed).toEqual(newest(1000, 23, 20))
        expect(backupKeys()).toEqual(newest(1000, 23, 20).map((n) => `${BACKUP_PREFIX}${n}.bin`).sort())
    })

    test('guard: the main file and unrelated keys are never listed or removed', async () => {
        seedBackups(2000, 1, 21)
        server.seed('database/database.bin', bytes(9))
        server.seed('assets/a.png', bytes(8))

        await getDbBackups()

        expect(server.files.has('database/database.bin')).toBe(true)
        expect(server.files.has('assets/a.png')).toBe(true)
    })

    test('a name whose number does not parse is neither counted nor removed', async () => {
        seedBackups(3000, 2, 21)
        server.seed(`${BACKUP_PREFIX}x.bin`, bytes(7))
        server.seed(`${BACKUP_PREFIX}1e3.bin`, bytes(7))

        const listed = await getDbBackups()

        expect(listed).toEqual(newest(3000, 21, 20))
        expect(removeRequests()).toEqual([])
        expect(server.files.has(`${BACKUP_PREFIX}x.bin`)).toBe(true)
        expect(server.files.has(`${BACKUP_PREFIX}1e3.bin`)).toBe(true)
        expect(backupKeys()).toHaveLength(22)
    })

    test('the prune deletes the listed key itself, never a name rebuilt from its number', async () => {
        const padded = `${BACKUP_PREFIX}00007.bin`
        server.seed(padded, bytes(7))
        seedBackups(6000, 1000, 1019)

        const listed = await getDbBackups()

        expect(listed).toEqual(newest(6000, 1019, 20))
        expect(server.files.has(padded)).toBe(false)
        expect(removeRequests()).toHaveLength(1)
        expect(Buffer.from(removeRequests()[0].headers['file-path'], 'hex').toString('utf-8')).toBe(padded)
    })

    test('a stray name that is not a key is never listed as a backup', async () => {
        seedBackups(4000, 1, 20)
        server.strayNames.push(`${Buffer.from(`${BACKUP_PREFIX}99.bin`).toString('hex')}.tmp-0123456789abcdef`, '__revisions.json')

        const listed = await getDbBackups()

        expect(listed).toHaveLength(20)
        expect(removeRequests()).toEqual([])
    })

    test('two tabs pruning the same oldest backup: the tab that loses the race still completes its prune', async () => {
        const oldest = `${BACKUP_PREFIX}5001.bin`
        seedBackups(5000, 2, 21)
        // This tab wrote the oldest backup itself earlier in the page's life.
        await forageStorage.setItem(oldest, bytes(1))
        let peerRemoved = false
        server.afterRequest = (path) => {
            if (path === '/api/list' && !peerRemoved) {
                peerRemoved = true
                server.peerRemove(oldest)
            }
        }

        const listed = await getDbBackups()

        expect(peerRemoved).toBe(true)
        expect(listed).toEqual(newest(5000, 21, 20))
        expect(server.files.has(oldest)).toBe(false)
    })
})
