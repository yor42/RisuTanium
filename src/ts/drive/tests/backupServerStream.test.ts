// @vitest-environment node
/**
 * Full and partial `.bin` export on a Node-served page whose server streams the export (`exportStream` in
 * `/api/caps`). `SaveLocalBackup`, `SavePartialLocalBackup` and the real export shell (`runExport`) run over the real
 * `server/node/server.cjs` as a child process, through the real `ServerExportWriter`; the files expected come from
 * the page's own sink on the same tree. Replaced: the dialogs, streamsaver (a spy that records its use), and the
 * browser's form post (the same POST made here, its body collected). Scripted fetch answers stand in for failures the
 * real server cannot be made to give. A pass here says nothing about a browser's download, a proxy, or Tauri.
 *
 * Titles say what a test pins: `reproducer` fails on the merge of S2a without the client change (the page ignores
 * `exportStream` and takes the memory writer on a plain-HTTP page), `new` is a contract absent before, `guard` holds
 * before and after.
 */
import { readdir, readFile, unlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writable } from 'svelte/store'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { alertData } from 'src/ts/alert'

vi.hoisted(() => {
    const memory = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => memory.get(key) ?? null,
            setItem: (key: string, value: string) => { memory.set(key, String(value)) },
            removeItem: (key: string) => { memory.delete(key) },
            clear: () => memory.clear(),
            key: (index: number) => Array.from(memory.keys())[index] ?? null,
            get length() { return memory.size },
        },
    })
})

interface PageServer {
    baseUrl: string
    authHeader(): Promise<string>
}

interface Call {
    url: string
    route: string
    nth: number
    init: RequestInit
    forward: () => Promise<Response>
}

const h = vi.hoisted(() => ({
    platform: { isTauri: false, isNodeServer: true },
    keyPair: null as CryptoKeyPair | null,
    permissive: (): Record<string, unknown> => new Proxy({} as Record<string, unknown>, {
        get: (_target, key) => (key === 'then' ? undefined : vi.fn()),
        has: () => true,
    }),
    /** The server the page is served by. */
    server: null as PageServer | null,
    /** Answers a request instead of the server (return nothing to let it through). */
    script: null as ((call: Call) => Promise<Response | undefined>) | null,
    /** How the page sees the server's `exportStream` capability. */
    caps: 'real' as 'real' | 'stripped' | 'noFlag' | 'version2',
    log: [] as { route: string, method: string, key: string | null }[],
    sleeps: [] as number[],
    /** The POST of the download, once the page triggered it. */
    download: null as Promise<void> | null,
    beforeDownload: null as (() => Promise<void>) | null,
    afterFirstChunk: null as (() => void) | null,
    /** The Cancel of the export's wait dialog. */
    cancelNow: null as (() => void) | null,
}))

const sink = vi.hoisted(() => ({ writes: [] as Uint8Array[], closed: false, aborted: false, created: 0, blobFallback: false }))
const alerts = vi.hoisted(() => ({ error: [] as string[], normalWait: [] as string[], notice: [] as string[], confirmAnswers: [] as boolean[], gestureWaitMs: 0 }))

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
            keys: vi.fn(async () => []),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return h.platform.isTauri },
    get isNodeServer() { return h.platform.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

const dbBox = vi.hoisted(() => ({ db: { characters: [], personas: [], characterOrder: [], botPresets: [] } as Record<string, unknown> }))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => dbBox.db),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as unknown as Database },
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
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => alerts.confirmAnswers.shift() ?? true),
    alertError: vi.fn((message: string) => { alerts.error.push(message) }),
    alertWait: vi.fn((message: string, cancel?: () => void): alertData => {
        h.cancelNow = cancel ?? null
        return { type: 'wait', msg: message }
    }),
    alertMd: vi.fn(),
    alertNormal: vi.fn((message: string) => { alerts.notice.push(message) }),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(async (message: string) => {
        alerts.normalWait.push(message)
        if (alerts.gestureWaitMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, alerts.gestureWaitMs))
        }
    }),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/util'), async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/util')>()),
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(async () => { }),
    sleepForever: vi.fn(async () => { }),
    asBuffer: (value: Uint8Array) => value,
    base64url: (source: Uint8Array | ArrayBuffer) => Buffer.from(source as Uint8Array).toString('base64url'),
    getKeypairStore: vi.fn(async () => {
        h.keyPair ??= await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
        return h.keyPair
    }),
    saveKeypairStore: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

vi.mock('@tauri-apps/api/core', () => h.permissive())
vi.mock('@tauri-apps/api/path', () => h.permissive())
vi.mock('@tauri-apps/plugin-fs', () => h.permissive())
vi.mock('@tauri-apps/plugin-os', () => h.permissive())
vi.mock('@tauri-apps/plugin-shell', () => h.permissive())
vi.mock('@tauri-apps/plugin-http', () => h.permissive())
vi.mock('@tauri-apps/plugin-dialog', () => h.permissive())
vi.mock('@tauri-apps/plugin-process', () => h.permissive())
vi.mock('@tauri-apps/api/event', () => h.permissive())
vi.mock('@tauri-apps/api/webviewWindow', () => h.permissive())
vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        get useBlobFallback() { return sink.blobFallback },
        createWriteStream: () => {
            sink.created += 1
            return {
                ready: Promise.resolve(),
                writable: {
                    getWriter: () => ({
                        write: async (chunk: Uint8Array) => { sink.writes.push(chunk.slice()) },
                        close: async () => { sink.closed = true },
                        abort: async () => { sink.aborted = true },
                    }),
                },
            }
        },
    },
}))

// The page's own storage object has no server to sign in to here: the probe and the auth header go to the page's server.
vi.mock(import('src/ts/storage/nodeStorage'), async (importOriginal) => {
    const original = await importOriginal<typeof import('src/ts/storage/nodeStorage')>()
    return {
        ...original,
        nodeServerAuthHeader: () => h.server!.authHeader(),
        serverExportAvailable: () => original.serverExportAvailable({
            fetch: (url, init) => globalThis.fetch(url, init),
            authHeader: () => h.server!.authHeader(),
            sleep: async (ms) => { h.sleeps.push(ms) },
        }),
    }
})
// The browser's form post is replaced by the same POST made here, its body collected into the download sink.
vi.mock(import('src/ts/drive/serverExportWriter'), async (importOriginal) => ({
    ...await importOriginal<typeof import('src/ts/drive/serverExportWriter')>(),
    submitDownloadForm: (ticket: string) => {
        h.download = (async () => {
            await h.beforeDownload?.()
            const response = await globalThis.fetch('/api/export/download', {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ ticket }).toString(),
            })
            if (!response.ok || response.body === null) {
                return
            }
            const reader = response.body.getReader()
            let first = true
            for (;;) {
                const { done, value } = await reader.read()
                if (done) {
                    break
                }
                sink.writes.push(value.slice())
                if (first) {
                    first = false
                    h.afterFirstChunk?.()
                }
            }
            sink.closed = true
        })().catch(() => { })
        return () => { }
    },
}))

vi.mock(import('src/ts/reloadGuard'), () => ({
    markAppInitiatedReload: () => { },
    isAppInitiatedReload: () => false,
}) as unknown as typeof import('src/ts/reloadGuard'))
vi.mock(import('src/ts/model/modellist'), () => ({ getModelInfo: vi.fn() }) as unknown as typeof import('src/ts/model/modellist'))
vi.mock(import('src/ts/update'), () => ({ checkRisuUpdate: vi.fn(async () => { }) }))
vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({ loadPlugins: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/plugins/plugins.svelte'))
vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))
vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('src/ts/characterCards'))
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({ registerDbChangeEffects: vi.fn() }) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))
vi.mock(import('src/ts/gui/animation'), () => ({ updateAnimationSpeed: vi.fn() }) as unknown as typeof import('src/ts/gui/animation'))
vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))
vi.mock(import('src/ts/observer.svelte'), () => ({ startObserveDom: vi.fn() }) as unknown as typeof import('src/ts/observer.svelte'))
vi.mock(import('src/ts/gui/guisize'), () => ({ updateGuisize: vi.fn() }) as unknown as typeof import('src/ts/gui/guisize'))
vi.mock(import('src/ts/characters'), () => ({ updateLorebooks: vi.fn((v: unknown) => v) }) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/hotkey'), () => ({ initMobileGesture: vi.fn() }) as unknown as typeof import('src/ts/hotkey'))
vi.mock(import('src/ts/process/modules'), () => ({ moduleUpdate: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/process/modules'))
vi.mock(import('src/ts/process/coldstorage.svelte'), async () => {
    const { getColdStorageBackupKey } = await import('src/ts/process/coldstorageData')
    return {
        collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
        readColdStorageItem: vi.fn(async () => ({ status: 'missing' })),
        confirmIncompleteColdStorageOperation: vi.fn(async () => true),
        getColdStorageBackupKey,
        getColdStorageItem: vi.fn(async () => null),
        isColdStorageBackupData: vi.fn(() => true),
        setColdStorageItem: vi.fn(async () => true),
    } as unknown as typeof import('src/ts/process/coldstorage.svelte')
})

// A clean page: the restore's save-first step returns at its clean check instead of waiting out its bound.
vi.mock(import('src/ts/globalApi.svelte'), async (importOriginal) => ({
    ...await importOriginal<typeof import('src/ts/globalApi.svelte')>(),
    isSaveClean: () => true,
}))

const shell = vi.hoisted((): Store2ShellBox => ({ commits: [], events: [] }))
vi.mock(import('src/ts/drive/storeImport'), (importOriginal) => store2ShellMock(shell)(importOriginal))

//#endregion

import { resetStore2ShellBox, store2ShellMock, useStore2RestorePage, type Store2ShellBox } from './store2ShellStub'
import { LoadLocalBackup, SaveLocalBackup, SavePartialLocalBackup, type ExportOutcome } from 'src/ts/drive/backuplocal'
import { BackupAssetChangedError, BackupAssetTooLargeError } from 'src/ts/drive/exportShell'
import { dbWriteLock, LocalWriter } from 'src/ts/globalApi.svelte'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createNodeHttpStore } from 'src/ts/storage/store/nodeHttpStore'
import { language } from 'src/lang'
import { alertWait } from 'src/ts/alert'
import { injectRestoreStore } from './restoreSupport'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { hexOfKey, startNodeServer, type NodeServerFixture } from 'src/ts/storage/tests/nodeServerFixture'

//#region fixtures

const MIB = 1024 * 1024
const realFetch = globalThis.fetch

let main: NodeServerFixture
let identity: NodeServerFixture
let limited: NodeServerFixture
let shortTicket: NodeServerFixture
let fresh: NodeServerFixture

const BASE_ENV = { RISU_EXPORT_FREE_RESERVE_BYTES: '0' }

beforeAll(async () => {
    ;[main, identity, limited, shortTicket, fresh] = await Promise.all([
        startNodeServer({ env: BASE_ENV }),
        startNodeServer({ env: { ...BASE_ENV, RISU_EXPORT_PIN: 'off' } }),
        startNodeServer({ env: { ...BASE_ENV, RISU_EXPORT_RATE_LIMIT_MAX: '5', RISU_EXPORT_RATE_LIMIT_WINDOW_MS: '1000' } }),
        startNodeServer({ env: { ...BASE_ENV, RISU_EXPORT_TICKET_TTL_MS: '200' } }),
        startNodeServer({ env: BASE_ENV }),
    ])
}, 180_000)

afterAll(async () => {
    await Promise.all([main, identity, limited, shortTicket, fresh].map((server) => server?.stop()))
}, 60_000)

function patterned(length: number, seed: number): Uint8Array {
    return Uint8Array.from({ length }, (_, index) => (index * 7 + seed) & 255)
}

async function plant(fx: NodeServerFixture, key: string, bytes: Uint8Array): Promise<void> {
    await writeFile(join(fx.saveDir, hexOfKey(key)), bytes)
}

async function onDisk(fx: NodeServerFixture, key: string): Promise<Uint8Array | null> {
    try {
        return new Uint8Array(await readFile(join(fx.saveDir, hexOfKey(key))))
    } catch {
        return null
    }
}

async function jobDirectories(fx: NodeServerFixture): Promise<string[]> {
    try {
        return await readdir(join(fx.saveDir, '__exports'))
    } catch {
        return []
    }
}

function sameBytes(left: Uint8Array | null | undefined, right: Uint8Array): boolean {
    return left !== null && left !== undefined && Buffer.from(left).equals(Buffer.from(right))
}

interface WrittenEntry {
    name: string
    data: Uint8Array
}

function writtenEntries(): WrittenEntry[] {
    const bytes = Buffer.concat(sink.writes)
    const out: WrittenEntry[] = []
    let offset = 0
    while (offset + 4 <= bytes.length) {
        const nameLength = bytes.readUInt32LE(offset)
        offset += 4
        const name = bytes.subarray(offset, offset + nameLength).toString('utf-8')
        offset += nameLength
        const dataLength = bytes.readUInt32LE(offset)
        offset += 4
        out.push({ name, data: new Uint8Array(bytes.subarray(offset, offset + dataLength)) })
        offset += dataLength
    }
    return out
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

/** The page: served by `fx`, its store reading `fx` in pieces. Every request goes through the scripted fetch. */
async function pageOn(fx: NodeServerFixture): Promise<void> {
    injectRestoreStore(await pageStore(fx), 'node')
    h.log.length = 0
}

/** The page's store over `fx`, probed; the page is served by `fx` and every request goes through the scripted fetch. */
async function pageStore(fx: NodeServerFixture) {
    h.server = fx
    h.script = null
    h.caps = 'real'
    installFetch()
    const store = createNodeHttpStore({
        baseUrl: fx.baseUrl,
        authHeader: () => fx.authHeader(),
        pieceBytes: MIB,
        sleep: async () => { },
    })
    await store.guarded!.probe()
    return store
}

function installFetch(): void {
    const counts = new Map<string, number>()
    vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
        const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        const url = raw.startsWith('/') ? `${h.server!.baseUrl}${raw}` : raw
        const route = new URL(url).pathname
        const hex = (init.headers as Record<string, string> | undefined)?.['file-path']
        h.log.push({ route, method: init.method ?? 'GET', key: hex === undefined ? null : Buffer.from(hex, 'hex').toString('utf-8') })
        const nth = (counts.get(route) ?? 0) + 1
        counts.set(route, nth)
        const forward = () => realFetch(url, init)
        const scripted = await h.script?.({ url, route, nth, init, forward })
        if (scripted !== undefined) {
            return scripted
        }
        const response = await forward()
        if (route === '/api/caps' && h.caps !== 'real') {
            const body = await response.json() as Record<string, unknown>
            if (h.caps === 'stripped') {
                delete body.exportStream
                delete body.exportStreamVersion
            } else if (h.caps === 'noFlag') {
                delete body.exportStream
            } else {
                body.exportStreamVersion = 2
            }
            return json(body, response.status, { 'risu-storage-guarded': response.headers.get('risu-storage-guarded') ?? '1' })
        }
        return response
    })
}

const exportRoutes = () => h.log.filter((entry) => entry.route.startsWith('/api/export/'))
const assetRangeReads = () => h.log.filter((entry) => entry.route === '/api/read-range' && entry.key?.startsWith('assets/'))

/** What the page's own sink wrote for the export `run`, with the server's capability hidden from the page. */
async function ownSinkFile(run: () => Promise<{ status: string }>): Promise<{ outcome: { status: string }, bytes: Buffer }> {
    const before = h.caps
    h.caps = 'stripped'
    sink.writes.length = 0
    sink.closed = false
    try {
        const outcome = await run()
        return { outcome, bytes: Buffer.concat(sink.writes) }
    } finally {
        h.caps = before
        sink.writes.length = 0
        sink.closed = false
    }
}

async function serverFile(run: () => Promise<ExportOutcome>): Promise<{ outcome: ExportOutcome, bytes: Buffer }> {
    sink.writes.length = 0
    sink.closed = false
    h.download = null
    const outcome = await run()
    await h.download
    return { outcome, bytes: Buffer.concat(sink.writes) }
}

//#endregion

beforeEach(() => {
    h.platform.isTauri = false
    h.platform.isNodeServer = true
    h.script = null
    h.caps = 'real'
    h.log.length = 0
    h.sleeps.length = 0
    h.download = null
    h.beforeDownload = null
    h.afterFirstChunk = null
    h.cancelNow = null
    sink.writes.length = 0
    sink.closed = false
    sink.aborted = false
    sink.created = 0
    sink.blobFallback = false
    alerts.error.length = 0
    alerts.normalWait.length = 0
    alerts.notice.length = 0
    alerts.confirmAnswers.length = 0
    alerts.gestureWaitMs = 0
    resetStore2ShellBox(shell)
    dbBox.db ={ characters: [], personas: [], characterOrder: [], botPresets: [] }
})

afterEach(async () => {
    injectAppStore(null)
    resetPageStorageModeForTests()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    await Promise.all([main, identity, limited, shortTicket, fresh].map((server) => server.clearKeys()))
})

/** The tree of the equality rows: empty, 3 MiB and 20 MiB assets and a key the server's asset route refuses. */
const TREE: { key: string, bytes: Uint8Array }[] = [
    { key: 'assets/empty.png', bytes: new Uint8Array(0) },
    { key: 'assets/three.png', bytes: patterned(3 * MIB, 3) },
    { key: 'assets/twenty.png', bytes: patterned(20 * MIB, 20) },
    { key: 'assets/odd//name.png', bytes: patterned(700, 9) },
]

async function plantTree(fx: NodeServerFixture): Promise<void> {
    for (const item of TREE) {
        await plant(fx, item.key, item.bytes)
    }
}

function expectTreeEntries(entries: WrittenEntry[]): void {
    for (const item of TREE) {
        const base = item.key.split('/').pop()!
        expect(sameBytes(entries.find((entry) => entry.name === base)?.data, item.bytes)).toBe(true)
    }
}

const partialDb = () => ({
    characters: [
        { chaId: 'c1', name: 'One', image: 'assets/three.png', emotionImages: [], additionalAssets: [], ccAssets: [], inlayView: false },
        { chaId: 'c2', name: 'Two', image: 'assets/twenty.png', emotionImages: [], additionalAssets: [], ccAssets: [], inlayView: false },
    ],
    personas: [], characterOrder: [], botPresets: [],
    userIcon: 'assets/odd//name.png',
    customBackground: 'assets/never-existed.png',
})

describe('plain-HTTP page (no secure context, memory-only streamsaver)', () => {
    test('reproducer: the full export is saved through the server, with no memory notice and no streamsaver stream, and equals the tree', async () => {
        sink.blobFallback = true
        await pageOn(main)
        await plantTree(main)

        const { outcome, bytes } = await serverFile(() => SaveLocalBackup())

        expect(outcome.status).toBe('saved')
        expect(sink.created).toBe(0)
        expect(alerts.normalWait).not.toContain(language.exportHeldInMemory)
        expect(alerts.normalWait).not.toContain(language.exportHelperNotResponding)
        sink.writes.length = 0
        sink.writes.push(new Uint8Array(bytes))
        expectTreeEntries(writtenEntries())
        expect(writtenEntries().map((entry) => entry.name)).toContain('database.risudat')
        expect(sink.closed).toBe(true)
    }, 120_000)

    test('reproducer: the partial export is saved through the server, with no memory notice and no streamsaver stream', async () => {
        sink.blobFallback = true
        await pageOn(main)
        await plantTree(main)
        dbBox.db = partialDb()

        const { outcome, bytes } = await serverFile(() => SavePartialLocalBackup())

        expect(outcome.status).toBe('saved')
        expect(sink.created).toBe(0)
        expect(alerts.normalWait).not.toContain(language.exportHeldInMemory)
        sink.writes.length = 0
        sink.writes.push(new Uint8Array(bytes))
        const entries = writtenEntries()
        expect(sameBytes(entries.find((entry) => entry.name === 'three.png')?.data, TREE[1].bytes)).toBe(true)
        expect(sameBytes(entries.find((entry) => entry.name === 'twenty.png')?.data, TREE[2].bytes)).toBe(true)
        expect(sameBytes(entries.find((entry) => entry.name === 'name.png')?.data, TREE[3].bytes)).toBe(true)
        if (outcome.status === 'saved') {
            expect(outcome.omitted.assets).toEqual(['assets/never-existed.png'])
        }
    }, 120_000)

    test('reproducer: no asset is read through the page, except the key the server\'s asset route refuses', async () => {
        sink.blobFallback = true
        await pageOn(main)
        await plantTree(main)

        const { outcome } = await serverFile(() => SaveLocalBackup())

        expect(outcome.status).toBe('saved')
        expect(sink.closed).toBe(true)
        expect(assetRangeReads()).toEqual([])
        // The refused key keeps the page's own whole read; every other asset body is pinned.
        expect(h.log.filter((entry) => entry.key !== null && entry.key.startsWith('assets/') && entry.route === '/api/read' && entry.method === 'GET').map((entry) => entry.key)).toEqual(['assets/odd//name.png'])
        expect(exportRoutes().filter((entry) => entry.route === '/api/export/begin')).toHaveLength(1)
    }, 120_000)
})

describe('byte equality with the page\'s own sink', () => {
    test('new: the full export through the server equals the page\'s own file on the same tree', async () => {
        await pageOn(main)
        await plantTree(main)
        const own = await ownSinkFile(() => SaveLocalBackup())
        expect(own.outcome.status).toBe('saved')
        expect(exportRoutes()).toEqual([])
        h.log.length = 0

        const served = await serverFile(() => SaveLocalBackup())

        expect(served.outcome.status).toBe('saved')
        expect(exportRoutes().length).toBeGreaterThan(3)
        expect(served.bytes.equals(own.bytes)).toBe(true)
        expect(own.bytes.length).toBeGreaterThan(23 * MIB)
        expect(await jobDirectories(main)).toEqual([])
    }, 180_000)

    test('new: the partial export through the server equals the page\'s own file, a missing asset and a refused key included', async () => {
        await pageOn(main)
        await plantTree(main)
        dbBox.db = partialDb()
        const own = await ownSinkFile(() => SavePartialLocalBackup())
        expect(own.outcome.status).toBe('saved')

        const served = await serverFile(() => SavePartialLocalBackup())

        expect(served.outcome).toEqual(own.outcome)
        expect(served.bytes.equals(own.bytes)).toBe(true)
    }, 180_000)

    test('new: an asset removed between the listing and its pin is missing, and the file equals an export made without it', async () => {
        await pageOn(main)
        await plantTree(main)
        h.script = async (call) => {
            if (call.route === '/api/export/append' && (call.init.headers as Record<string, string>)['pin-key'] === hexOfKey('assets/three.png')) {
                await unlink(join(main.saveDir, hexOfKey('assets/three.png')))
            }
            return undefined
        }
        const served = await serverFile(() => SaveLocalBackup())
        h.script = null
        expect(served.outcome.status).toBe('saved')
        expect((served.outcome as { omitted?: { assets: string[] } }).omitted?.assets).toEqual(['assets/three.png'])

        const own = await ownSinkFile(() => SaveLocalBackup())

        expect(served.bytes.equals(own.bytes)).toBe(true)
        expect(writtenEntriesOf(served.bytes).map((entry) => entry.name)).not.toContain('three.png')
    }, 180_000)

    test('new: a server limiting export requests to 5 per second is waited out, and the file equals the page\'s own', async () => {
        await pageOn(limited)
        await plant(limited, 'assets/a.png', patterned(2 * MIB, 1))
        await plant(limited, 'assets/b.png', patterned(300, 2))
        const own = await ownSinkFile(() => SaveLocalBackup())

        const served = await serverFile(() => SaveLocalBackup())

        expect(served.outcome.status).toBe('saved')
        expect(served.bytes.equals(own.bytes)).toBe(true)
    }, 180_000)

    test('new: a ticket that would expire during the gesture prompt is minted after it, and the download still works', async () => {
        await pageOn(shortTicket)
        await plant(shortTicket, 'assets/a.png', patterned(1000, 1))
        const own = await ownSinkFile(() => SaveLocalBackup())
        vi.stubGlobal('navigator', { userActivation: { isActive: false } })
        alerts.gestureWaitMs = 500

        const served = await serverFile(() => SaveLocalBackup())

        expect(served.outcome.status).toBe('saved')
        expect(alerts.normalWait).toContain(language.backupReadyToSave())
        expect(served.bytes.equals(own.bytes)).toBe(true)
    }, 120_000)
})

function writtenEntriesOf(bytes: Buffer): WrittenEntry[] {
    sink.writes.length = 0
    sink.writes.push(new Uint8Array(bytes))
    return writtenEntries()
}

describe('identity mode (the server cannot hard-link)', () => {
    test('new: an asset changed after it was pinned fails the export as kept, naming the asset, and the job is gone', async () => {
        await pageOn(identity)
        await plant(identity, 'assets/a.png', patterned(5000, 1))
        h.beforeDownload = async () => {
            const path = join(identity.saveDir, hexOfKey('assets/a.png'))
            await writeFile(path, patterned(5001, 2))
            await utimes(path, new Date(), new Date(Date.now() + 5000))
        }

        const { outcome } = await serverFile(() => SaveLocalBackup())

        expect(outcome.status).toBe('failed')
        if (outcome.status === 'failed') {
            expect((outcome as unknown as { cause: unknown }).cause).toBeInstanceOf(BackupAssetChangedError)
            expect((outcome as unknown as { file: string }).file).toBe('kept')
        }
        expect(alerts.error).toContain(language.backupFailedFileKept("'assets/a.png'"))
        await vi.waitFor(async () => expect(await jobDirectories(identity)).toEqual([]))
        expect(sameBytes(await onDisk(identity, 'assets/a.png'), patterned(5001, 2))).toBe(true)
    }, 120_000)
})

describe('cancel', () => {
    test('new: a cancel during staging declines the export with nothing written, never triggers the download, and removes the job', async () => {
        await pageOn(main)
        await plantTree(main)
        h.script = async (call) => {
            if (call.route === '/api/export/append' && call.nth === 3) {
                h.cancelNow?.()
            }
            return undefined
        }

        const { outcome } = await serverFile(() => SaveLocalBackup())

        expect(outcome).toMatchObject({ status: 'declined', cause: 'export-cancelled', file: 'untouched' })
        expect(h.download).toBeNull()
        expect(h.log.some((entry) => entry.route === '/api/export/download')).toBe(false)
        await vi.waitFor(async () => expect(await jobDirectories(main)).toEqual([]))
        await vi.waitFor(() => expect(h.log.some((entry) => entry.route === '/api/export/abort')).toBe(true))
    }, 120_000)

    test('new: a cancel during the download declines the export with the file kept, cuts the stream and removes the job', async () => {
        await pageOn(main)
        await plantTree(main)
        h.afterFirstChunk = () => h.cancelNow?.()

        const { outcome } = await serverFile(() => SaveLocalBackup())

        expect(outcome).toMatchObject({ status: 'declined', cause: 'export-cancelled', file: 'kept' })
        expect(alerts.notice).toContain(language.backupCancelledFileIncomplete)
        await vi.waitFor(async () => expect(await jobDirectories(main)).toEqual([]))
    }, 120_000)
})

describe('prompts', () => {
    test('guard: declining a pre-flight prompt sends no export request (passes before and after)', async () => {
        await pageOn(main)
        await plantTree(main)
        alerts.confirmAnswers.push(true, false)

        const outcome = await SavePartialLocalBackup()

        expect(outcome.status).toBe('declined')
        expect(exportRoutes()).toEqual([])
        expect(await jobDirectories(main)).toEqual([])
    })
})

describe('the page keeps its own writer', () => {
    test.each([
        { name: 'a server without exportStream', caps: 'stripped' as const },
        { name: 'a server whose exportStream flag is absent but whose version is 1', caps: 'noFlag' as const },
        { name: 'a server advertising exportStreamVersion 2', caps: 'version2' as const },
    ])('guard: $name keeps the streamsaver path and bytes (passes before and after)', async ({ caps }) => {
        await pageOn(main)
        await plant(main, 'assets/a.png', patterned(2000, 1))
        h.caps = caps

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(sink.created).toBe(1)
        expect(sink.closed).toBe(true)
        expect(exportRoutes()).toEqual([])
        expect(sameBytes(writtenEntries().find((entry) => entry.name === 'a.png')?.data, patterned(2000, 1))).toBe(true)
    })

    test('guard: a writer opened without the server writer is the browser download writer, as a card or module export opens it', async () => {
        await pageOn(main)
        const writer = new LocalWriter()

        expect(await writer.init('card', ['png'], 'card.png')).toBe(true)

        expect(sink.created).toBe(1)
        expect(exportRoutes()).toEqual([])
    })

    test('new: a caps answer that carries exportStream once and then fails is read once per export, and the server path is kept', async () => {
        await pageOn(main)
        await plant(main, 'assets/a.png', patterned(2000, 1))
        let capsReads = 0
        h.script = async (call) => {
            if (call.route !== '/api/caps') {
                return undefined
            }
            capsReads += 1
            if (capsReads > 1) {
                throw new TypeError('fetch failed')
            }
            return undefined
        }

        const { outcome } = await serverFile(() => SaveLocalBackup())

        expect(outcome.status).toBe('saved')
        expect(capsReads).toBe(1)
        expect(sink.created).toBe(0)
    }, 60_000)

    test('new: a 429 on the caps read is waited out as the server asks, and the server path is taken', async () => {
        await pageOn(main)
        await plant(main, 'assets/a.png', patterned(2000, 1))
        let capsReads = 0
        h.script = async (call) => {
            if (call.route !== '/api/caps') {
                return undefined
            }
            capsReads += 1
            return capsReads === 1 ? json({ error: 'slow' }, 429, { 'retry-after': '2' }) : undefined
        }

        const { outcome } = await serverFile(() => SaveLocalBackup())

        expect(outcome.status).toBe('saved')
        expect(h.sleeps).toContain(2000)
        expect(sink.created).toBe(0)
    }, 60_000)

    test('new: a caps read that keeps failing in transit takes the page\'s own writer, with its memory notice', async () => {
        sink.blobFallback = true
        await pageOn(main)
        await plant(main, 'assets/a.png', patterned(2000, 1))
        h.script = async (call) => {
            if (call.route === '/api/caps') {
                throw new TypeError('fetch failed')
            }
            return undefined
        }

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(h.sleeps.slice(0, 3)).toEqual([1000, 2000, 4000])
        expect(sink.created).toBe(1)
        expect(alerts.normalWait).toContain(language.exportHeldInMemory)
        expect(exportRoutes()).toEqual([])
    }, 60_000)
})

describe('failures reported by the export shell', () => {
    test.each([
        { name: 'begin 400 export-version', route: '/api/export/begin', nth: 1, answer: () => json({ code: 'export-version' }, 400) },
        { name: 'append 413 from a proxy', route: '/api/export/append', nth: 1, answer: () => new Response('<html>too large</html>', { status: 413, headers: { 'content-type': 'text/html' } }) },
        { name: 'append 418', route: '/api/export/append', nth: 2, answer: () => new Response('teapot', { status: 418 }) },
        { name: 'append 507 (staging refused)', route: '/api/export/append', nth: 2, answer: () => json({ code: 'export-space' }, 507) },
    ])('new: $name fails the export with nothing written', async ({ route, nth, answer }) => {
        await pageOn(main)
        await plant(main, 'assets/a.png', patterned(2000, 1))
        h.script = async (call) => (call.route === route && call.nth === nth ? answer() : undefined)

        const outcome = await SaveLocalBackup()

        expect(outcome).toMatchObject({ status: 'failed', file: 'untouched' })
        expect(alerts.error).toEqual([language.backupFailedNothingWritten()])
        expect(h.log.some((entry) => entry.route === '/api/export/download')).toBe(false)
        await vi.waitFor(async () => expect(await jobDirectories(main)).toEqual([]), { timeout: 5000 }).catch(() => undefined)
    })

    test('new: a job gone before the download is triggered is nothing written', async () => {
        await pageOn(main)
        await plant(main, 'assets/a.png', patterned(2000, 1))
        h.script = async (call) => (call.route === '/api/export/finalize' ? json({ code: 'export-gone' }, 404) : undefined)

        const outcome = await SaveLocalBackup()

        expect(outcome).toMatchObject({ status: 'failed', file: 'untouched' })
        expect(alerts.error).toEqual([language.backupFailedNothingWritten()])
    })

    test('new: a job gone after the download is triggered fails the export with the file kept, never as saved', async () => {
        await pageOn(main)
        await plant(main, 'assets/a.png', patterned(2000, 1))
        h.script = async (call) => (call.route === '/api/export/status' ? json({ code: 'export-gone' }, 404) : undefined)

        const outcome = await SaveLocalBackup()

        expect(outcome).toMatchObject({ status: 'failed', file: 'kept' })
        expect(alerts.error).toEqual([language.backupFailedFileKept(null)])
        await h.download
    })

    test('new: status reads that fail for a while during the download are waited out and the export is saved', async () => {
        await pageOn(main)
        await plant(main, 'assets/a.png', patterned(2000, 1))
        h.script = async (call) => {
            if (call.route === '/api/export/status' && call.nth <= 2) {
                throw new TypeError('fetch failed')
            }
            return undefined
        }

        const { outcome } = await serverFile(() => SaveLocalBackup())

        expect(outcome.status).toBe('saved')
        expect(alerts.error).toEqual([])
    }, 60_000)

    test('new: a pin answered above the 4 GiB entry cap fails the export with BackupAssetTooLargeError before any header for that key', async () => {
        await pageOn(main)
        await plant(main, 'assets/huge.png', patterned(2000, 1))
        h.script = async (call) => {
            if (call.route !== '/api/export/append' || (call.init.headers as Record<string, string>)['pin-key'] !== hexOfKey('assets/huge.png')) {
                return undefined
            }
            const real = await call.forward()
            await real.arrayBuffer()
            return json({ ok: true, pin: { size: 4294967296 } })
        }

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('failed')
        if (outcome.status === 'failed') {
            expect((outcome as unknown as { cause: unknown }).cause).toBeInstanceOf(BackupAssetTooLargeError)
            expect((outcome as unknown as { file: string }).file).toBe('untouched')
        }
        expect(sink.created).toBe(0)
        expect(h.log.some((entry) => entry.route === '/api/export/download')).toBe(false)
    })
})

describe('restore of a file made through the server', () => {
    /** Drives LoadLocalBackup() with `bytes` as the chosen file and waits for its end. */
    async function restore(bytes: Uint8Array) {
        const file = new File([bytes as Uint8Array<ArrayBuffer>], 'backup.bin')
        const input = {
            type: '', accept: '', files: [file] as File[], onchange: null as null | (() => Promise<void>),
            click() { }, remove() { }, addEventListener() { },
        }
        vi.stubGlobal('document', { createElement: () => input })
        vi.stubGlobal('history', { replaceState() { } })
        vi.stubGlobal('location', { pathname: '/', hash: '', reload() { } })
        vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
        const ended = LoadLocalBackup()
        await input.onchange?.()
        return await ended
    }

    test('new: the file restores on a fresh server to the tree it was made from', async () => {
        await pageOn(main)
        await plantTree(main)
        const served = await serverFile(() => SaveLocalBackup())
        expect(served.outcome.status).toBe('saved')
        const file = new Uint8Array(served.bytes)
        await pageOn(fresh)
        useStore2RestorePage(await pageStore(fresh), 'node')
        // The page's own `fetch` stub is not wanted while the picked file is read.
        const end = await restore(file)

        expect(end.outcome).toBe('committed')
        expect(shell.commits).toHaveLength(1)
        expect(vi.mocked(alertWait).mock.calls.some((call) => call[0] === language.store2RestoreSaving)).toBe(false)
        // A backup entry carries only the last path segment, so the restored key is `assets/<name>`.
        for (const item of TREE) {
            expect(sameBytes(await onDisk(fresh, `assets/${item.key.split('/').pop()}`), item.bytes)).toBe(true)
        }
    }, 240_000)
})
