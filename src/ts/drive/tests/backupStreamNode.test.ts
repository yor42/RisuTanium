// @vitest-environment node
/**
 * Full and partial export, and restore, of local backups on a Node-served page whose store
 * writes in pieces. `SaveLocalBackup`, `SavePartialLocalBackup` and `LoadLocalBackup` run for
 * real over the Node store (`createNodeHttpStore`) against the real `server/node/server.cjs`
 * as a child process; a scripted `fetch` in front of the server loses replies, answers an
 * absent key or refuses an upload where the real server cannot be made to. Only the download
 * sink (streamsaver) and the dialogs are replaced. A pass here says nothing about a browser, a
 * real proxy or the Tauri store.
 *
 * Titles say what a test pins: `reproducer` fails on the commit before the change (assets went
 * through the whole `/api/read` and `/api/write`, and a failed first read was recorded as a
 * missing asset), `guard` holds before and after.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { writable } from 'svelte/store'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

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

const h = vi.hoisted(() => ({
    platform: { isTauri: false, isNodeServer: true },
    keyPair: null as CryptoKeyPair | null,
    permissive: (): Record<string, unknown> => new Proxy({} as Record<string, unknown>, {
        get: (_target, key) => (key === 'then' ? undefined : vi.fn()),
        has: () => true,
    }),
}))

/** What the download sink received, and whether the stream was closed (a finished file) or aborted. */
const sink = vi.hoisted(() => ({ writes: [] as Uint8Array[], closed: false, aborted: false }))
const alerts = vi.hoisted(() => ({ error: [] as string[], normalWait: [] as string[] }))

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
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn((message: string) => { alerts.error.push(message) }),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(async (message: string) => { alerts.normalWait.push(message) }),
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
        useBlobFallback: false,
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: {
                getWriter: () => ({
                    write: async (chunk: Uint8Array) => { sink.writes.push(chunk.slice()) },
                    close: async () => { sink.closed = true },
                    abort: async () => { sink.aborted = true },
                }),
            },
        }),
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
        listColdDataKeys: vi.fn(async () => []),
        setColdStorageItem: vi.fn(async () => true),
    } as unknown as typeof import('src/ts/process/coldstorage.svelte')
})

//#endregion

import { LoadLocalBackup, SaveLocalBackup, SavePartialLocalBackup } from 'src/ts/drive/backuplocal'
import { ExportReadError } from 'src/ts/drive/inlayBackupExport'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { writeAppInlay, type InlayAsset } from 'src/ts/process/files/inlayStore'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { createNodeHttpStore, type FetchLike } from 'src/ts/storage/store/nodeHttpStore'
import { language } from 'src/lang'
import { injectRestoreStore } from './restoreSupport'
import { hexOfKey, startNodeServer, type NodeServerFixture } from 'src/ts/storage/tests/nodeServerFixture'

//#region fixtures

const MIB = 1024 * 1024
const SMALL_CHUNK = 100

let small: NodeServerFixture
let normal: NodeServerFixture

beforeAll(async () => {
    small = await startNodeServer({ env: { RISU_NODE_ASSET_LIMIT_BYTES: '5000', RISU_UPLOAD_CHUNK_MAX_BYTES: String(SMALL_CHUNK) } })
    normal = await startNodeServer({})
}, 120_000)

afterAll(async () => {
    await Promise.all([small?.stop(), normal?.stop()])
}, 60_000)

interface Request {
    route: string
    key: string | null
    method: string
}

interface World {
    store: ByteStore
    requests: Request[]
    /** The requests that named `key` (a hex `file-path`), as routes. */
    routesFor(key: string): string[]
}

type Script = (call: { route: string, key: string | null, nth: number, forward: () => Promise<Response> }) => Promise<Response | undefined>

async function makeWorld(fx: NodeServerFixture, options: { pieceBytes: number, script?: Script, probe?: boolean }): Promise<World> {
    const requests: Request[] = []
    const counts = new Map<string, number>()
    const fetchLike: FetchLike = async (url, init) => {
        const route = new URL(url).pathname
        const headers = (init?.headers ?? {}) as Record<string, string>
        const hex = headers['file-path']
        const key = hex === undefined ? null : Buffer.from(hex, 'hex').toString('utf-8')
        requests.push({ route, key, method: init?.method ?? 'GET' })
        const id = `${route}|${key ?? ''}`
        const nth = (counts.get(id) ?? 0) + 1
        counts.set(id, nth)
        const forward = () => fetch(url, init)
        return (await options.script?.({ route, key, nth, forward })) ?? await forward()
    }
    const store = createNodeHttpStore({
        baseUrl: fx.baseUrl,
        authHeader: () => fx.authHeader(),
        fetch: fetchLike,
        pieceBytes: options.pieceBytes,
        sleep: async () => { },
    })
    if (options.probe !== false) {
        await store.guarded!.probe()
    }
    requests.length = 0
    injectRestoreStore(store, 'node')
    return { store, requests, routesFor: (key) => requests.filter((request) => request.key === key).map((request) => request.route) }
}

function patterned(length: number, seed: number): Uint8Array {
    return Uint8Array.from({ length }, (_, index) => (index * 7 + seed) & 255)
}

async function plant(fx: NodeServerFixture, key: string, bytes: Uint8Array): Promise<void> {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(fx.saveDir, hexOfKey(key)), bytes)
}

async function onDisk(fx: NodeServerFixture, key: string): Promise<Uint8Array | null> {
    try {
        return new Uint8Array(await readFile(join(fx.saveDir, hexOfKey(key))))
    } catch {
        return null
    }
}

async function stagingFiles(fx: NodeServerFixture): Promise<string[]> {
    return (await readdir(fx.saveDir)).filter((name) => name.startsWith('__upload-'))
}

function sameBytes(left: Uint8Array | null | undefined, right: Uint8Array): boolean {
    return left !== null && left !== undefined && Buffer.from(left).equals(Buffer.from(right))
}

interface WrittenEntry {
    name: string
    data: Uint8Array
}

/** The `[nameLength][name][dataLength][data]` entries the download sink received. */
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

function u32le(n: number): Uint8Array {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
}

function chunkOf(name: string, data: Uint8Array): Uint8Array {
    const nameBytes = new TextEncoder().encode(name)
    return Buffer.concat([u32le(nameBytes.length), nameBytes, u32le(data.length), data])
}

const lostReply = () => new TypeError('fetch failed: the connection was lost')

//#endregion

beforeEach(() => {
    h.platform.isTauri = false
    h.platform.isNodeServer = true
    sink.writes.length = 0
    sink.closed = false
    sink.aborted = false
    alerts.error.length = 0
    alerts.normalWait.length = 0
    dbBox.db = { characters: [], personas: [], characterOrder: [], botPresets: [] }
})

afterEach(async () => {
    injectAppStore(null)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    await small.clearKeys()
    await normal.clearKeys()
})

describe('export of a large asset on a Node store with pieces', () => {
    test('reproducer: the asset is streamed from the store in ranges and never assembled by store.read, and the entry is byte-equal', async () => {
        const world = await makeWorld(small, { pieceBytes: SMALL_CHUNK })
        const bytes = patterned(450, 1)
        await plant(small, 'assets/big.png', bytes)
        const assembled = vi.spyOn(world.store, 'read')
        const streamed = vi.spyOn(world.store, 'readPieces')

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(assembled.mock.calls.map((call) => call[0])).not.toContain('assets/big.png')
        expect(streamed.mock.calls.map((call) => call[0])).toContain('assets/big.png')
        expect(world.routesFor('assets/big.png').filter((route) => route === '/api/read')).toEqual([])
        expect(world.routesFor('assets/big.png').filter((route) => route === '/api/read-range')).toHaveLength(5)
        expect(sameBytes(writtenEntries().find((entry) => entry.name === 'big.png')?.data, bytes)).toBe(true)
        expect(sink.closed).toBe(true)
    })

    test('reproducer: a first range that fails twice with a network error fails the export and no file is completed', async () => {
        await makeWorld(small, {
            pieceBytes: SMALL_CHUNK,
            script: async (call) => {
                if (call.route === '/api/read-range' && call.key === 'assets/big.png') {
                    throw lostReply()
                }
                return undefined
            },
        })
        await plant(small, 'assets/big.png', patterned(450, 2))

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('failed')
        if (outcome.status === 'failed') {
            expect(outcome.cause).toBeInstanceOf(ExportReadError)
        }
        expect(sink.closed).toBe(false)
        expect(alerts.error).toHaveLength(1)
    })

    test('new behaviour: a first range that fails once is re-sent and the export completes with the asset', async () => {
        const world = await makeWorld(small, {
            pieceBytes: SMALL_CHUNK,
            script: async (call) => {
                if (call.route === '/api/read-range' && call.key === 'assets/big.png' && call.nth === 1) {
                    throw lostReply()
                }
                return undefined
            },
        })
        const bytes = patterned(450, 3)
        await plant(small, 'assets/big.png', bytes)

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(world.routesFor('assets/big.png').filter((route) => route === '/api/read-range').length).toBeGreaterThanOrEqual(6)
        expect(sameBytes(writtenEntries().find((entry) => entry.name === 'big.png')?.data, bytes)).toBe(true)
    })

    test('data safety: an asset that changes after its header is written ends the export as failed, never as a shorter entry', async () => {
        await makeWorld(small, {
            pieceBytes: SMALL_CHUNK,
            script: async (call) => {
                if (call.route !== '/api/read-range' || call.key !== 'assets/big.png' || call.nth !== 3) {
                    return undefined
                }
                const real = await call.forward()
                const headers = new Headers(real.headers)
                headers.set('x-risu-revision', '999')
                return new Response(new Uint8Array(await real.arrayBuffer()), { status: real.status, headers })
            },
        })
        await plant(small, 'assets/big.png', patterned(450, 18))

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('failed')
        if (outcome.status === 'failed') {
            expect(outcome.cause).toMatchObject({ name: 'BackupAssetChangedError' })
        }
        expect(sink.closed).toBe(false)
    })

    test('guard: an asset the server reports absent (x-risu-exists: 0) is missing and the export completes without it', async () => {
        await makeWorld(small, {
            pieceBytes: SMALL_CHUNK,
            script: async (call) => (call.route === '/api/read-range' && call.key === 'assets/gone.png'
                ? new Response(new Uint8Array(0), { status: 200, headers: { 'x-risu-revision': '1', 'x-risu-size': '0', 'x-risu-exists': '0' } })
                : undefined),
        })
        await plant(small, 'assets/gone.png', patterned(450, 4))
        await plant(small, 'assets/kept.png', patterned(450, 5))

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        if (outcome.status === 'saved') {
            expect(outcome.omitted.assets).toEqual(['assets/gone.png'])
        }
        expect(writtenEntries().map((entry) => entry.name)).toContain('kept.png')
        expect(writtenEntries().map((entry) => entry.name)).not.toContain('gone.png')
    })

    test('new behaviour: a page whose store never probed asks once and still reads in ranges', async () => {
        const world = await makeWorld(small, { pieceBytes: SMALL_CHUNK, probe: false })
        await plant(small, 'assets/big.png', patterned(450, 6))

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(world.routesFor('assets/big.png')).not.toContain('/api/read')
        expect(world.requests.filter((request) => request.route === '/api/caps')).toHaveLength(1)
    })

    test('guard: a server without pieces keeps the whole read and the entry is byte-equal', async () => {
        const world = await makeWorld(small, {
            pieceBytes: SMALL_CHUNK,
            script: async (call) => (call.route === '/api/caps'
                ? new Response(JSON.stringify({ checkOnly: true, retire: true, pieces: false }), { status: 200, headers: { 'risu-storage-guarded': '1', 'content-type': 'application/json' } })
                : undefined),
        })
        await world.store.guarded!.probe()
        const bytes = patterned(450, 7)
        await plant(small, 'assets/big.png', bytes)

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(world.routesFor('assets/big.png')).toContain('/api/read')
        expect(world.routesFor('assets/big.png')).not.toContain('/api/read-range')
        expect(sameBytes(writtenEntries().find((entry) => entry.name === 'big.png')?.data, bytes)).toBe(true)
    })

    test('reproducer: the partial export reads a referenced asset in ranges and never assembles it by store.read', async () => {
        const bytes = patterned(450, 8)
        dbBox.db = {
            characters: [{ chaId: 'c1', name: 'Char', image: 'assets/big.png', emotionImages: [], additionalAssets: [], ccAssets: [], inlayView: false }],
            personas: [], characterOrder: [], botPresets: [],
        }
        const world = await makeWorld(small, { pieceBytes: SMALL_CHUNK })
        await plant(small, 'assets/big.png', bytes)

        const outcome = await SavePartialLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(world.routesFor('assets/big.png')).not.toContain('/api/read')
        expect(sameBytes(writtenEntries().find((entry) => entry.name === 'big.png')?.data, bytes)).toBe(true)
    })

    test('reproducer: the partial export fails when the first range of a referenced asset is lost twice, and the stream is aborted, not closed', async () => {
        dbBox.db = {
            characters: [{ chaId: 'c1', name: 'Char', image: 'assets/big.png', emotionImages: [], additionalAssets: [], ccAssets: [], inlayView: false }],
            personas: [], characterOrder: [], botPresets: [],
        }
        await makeWorld(small, {
            pieceBytes: SMALL_CHUNK,
            script: async (call) => {
                if (call.route === '/api/read-range' && call.key === 'assets/big.png') {
                    throw lostReply()
                }
                return undefined
            },
        })
        await plant(small, 'assets/big.png', patterned(450, 19))

        const outcome = await SavePartialLocalBackup()

        expect(outcome.status).toBe('failed')
        if (outcome.status === 'failed') {
            expect(outcome.cause).toBeInstanceOf(ExportReadError)
        }
        expect(sink.closed).toBe(false)
        expect(sink.aborted).toBe(true)
    })

    test('guard: a referenced asset whose key the store refuses for its shape is missing and the partial export goes on', async () => {
        // The Node store refuses a key that is not well-formed UTF-16 before any request.
        const refusedKey = 'assets/lone-\ud800-surrogate.png'
        dbBox.db = {
            characters: [{ chaId: 'c1', name: 'Char', image: refusedKey, emotionImages: [], additionalAssets: [], ccAssets: [], inlayView: false }],
            personas: [], characterOrder: [], botPresets: [],
        }
        const world = await makeWorld(small, { pieceBytes: SMALL_CHUNK })

        const outcome = await SavePartialLocalBackup()

        expect(outcome.status).toBe('saved')
        if (outcome.status === 'saved') {
            expect(outcome.omitted.assets).toEqual([refusedKey])
        }
        expect(world.requests.filter((request) => request.route.startsWith('/api/read'))).toEqual([])
        expect(sink.closed).toBe(true)
    })
})

describe('export of an inlay body on a Node store with pieces', () => {
    async function attachInlay(world: World): Promise<string> {
        const bytes = patterned(450, 9)
        const asset: InlayAsset = { data: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'video/mp4' }), ext: 'mp4', name: 'clip.mp4', type: 'video' }
        await writeAppInlay(world.store, 'inlay-one', asset)
        const bodies = await world.store.list('inlays/b-inlay-one.')
        expect(bodies).toHaveLength(1)
        return bodies[0]
    }

    test('reproducer: the body is streamed in ranges and never assembled by store.read, and the export completes', async () => {
        const world = await makeWorld(small, { pieceBytes: SMALL_CHUNK })
        const body = await attachInlay(world)
        world.requests.length = 0
        const assembled = vi.spyOn(world.store, 'read')

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('saved')
        expect(assembled.mock.calls.map((call) => call[0])).not.toContain(body)
        // The existence check is a HEAD of the same route; only a GET reads the whole body.
        expect(world.requests.filter((request) => request.key === body && request.route === '/api/read' && request.method === 'GET')).toEqual([])
        expect(world.routesFor(body)).toContain('/api/read-range')
    })

    test('reproducer: a body whose first range fails twice with a network error fails the export', async () => {
        let failing = false
        const world = await makeWorld(small, {
            pieceBytes: SMALL_CHUNK,
            script: async (call) => {
                if (failing && call.route === '/api/read-range' && call.key?.startsWith('inlays/b-')) {
                    throw lostReply()
                }
                return undefined
            },
        })
        await attachInlay(world)
        failing = true

        const outcome = await SaveLocalBackup()

        expect(outcome.status).toBe('failed')
        if (outcome.status === 'failed') {
            expect(outcome.cause).toBeInstanceOf(ExportReadError)
        }
        expect(sink.closed).toBe(false)
    })
})

describe('restore of a large asset entry on a Node store with pieces', () => {
    /** Drives LoadLocalBackup() with `bytes` as the chosen file and waits for its end. */
    async function restore(bytes: Uint8Array, file: File = new File([bytes as Uint8Array<ArrayBuffer>], 'backup.bin')) {
        const input = {
            type: '', accept: '', files: [file] as File[], onchange: null as null | (() => Promise<void>),
            click() { }, remove() { }, addEventListener() { },
        }
        vi.stubGlobal('document', { createElement: () => input })
        vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
        const ended = LoadLocalBackup()
        await input.onchange?.()
        return await ended
    }

    /** The database entry of a backup the export wrote from the current (empty) test database. */
    async function databaseEntry(): Promise<Uint8Array> {
        const world = await makeWorld(normal, { pieceBytes: 8 * MIB })
        expect((await SaveLocalBackup()).status).toBe('saved')
        const entry = writtenEntries().find((candidate) => candidate.name === 'database.risudat')
        expect(entry).toBeDefined()
        sink.writes.length = 0
        await world.store.guarded!.probe()
        return entry!.data
    }

    test('reproducer: an entry above one chunk goes through the upload, not one /api/write, and reads back byte-equal', async () => {
        const database = await databaseEntry()
        const world = await makeWorld(normal, { pieceBytes: 8 * MIB })
        const bytes = patterned(5 * MIB + 17, 11)

        const end = await restore(Buffer.concat([chunkOf('big.png', bytes), chunkOf('database.risudat', database)]))

        expect(end.outcome).toBe('committed')
        const routes = world.routesFor('assets/big.png')
        expect(routes).toContain('/api/upload/commit')
        expect(routes).not.toContain('/api/write')
        expect(sameBytes(await onDisk(normal, 'assets/big.png'), bytes)).toBe(true)
        expect(await stagingFiles(normal)).toEqual([])
    }, 60_000)

    test('guard: an entry up to one chunk is written whole, as before', async () => {
        const database = await databaseEntry()
        const world = await makeWorld(normal, { pieceBytes: 8 * MIB })
        const bytes = patterned(3 * MIB, 12)

        const end = await restore(Buffer.concat([chunkOf('mid.png', bytes), chunkOf('database.risudat', database)]))

        expect(end.outcome).toBe('committed')
        expect(world.routesFor('assets/mid.png')).not.toContain('/api/upload/begin')
        expect(sameBytes(await onDisk(normal, 'assets/mid.png'), bytes)).toBe(true)
    }, 60_000)

    test('guard: a server without pieces keeps the whole write', async () => {
        const database = await databaseEntry()
        const world = await makeWorld(normal, {
            pieceBytes: 8 * MIB,
            script: async (call) => (call.route === '/api/caps'
                ? new Response(JSON.stringify({ checkOnly: true, retire: true, pieces: false }), { status: 200, headers: { 'risu-storage-guarded': '1', 'content-type': 'application/json' } })
                : undefined),
        })
        await world.store.guarded!.probe()
        const bytes = patterned(5 * MIB, 13)

        const end = await restore(Buffer.concat([chunkOf('big.png', bytes), chunkOf('database.risudat', database)]))

        expect(end.outcome).toBe('committed')
        expect(world.routesFor('assets/big.png')).toEqual(['/api/write'])
        expect(sameBytes(await onDisk(normal, 'assets/big.png'), bytes)).toBe(true)
    }, 60_000)

    test('data safety: a database entry above one chunk is decoded whole and never streamed into assets', async () => {
        // Incompressible text, so the encoded database passes one chunk.
        let state = 12345
        const noise = Array.from({ length: 12 }, () => Uint8Array.from({ length: 512 * 1024 }, () => {
            state = (Math.imul(state, 1103515245) + 12345) >>> 0
            return state >>> 24
        }))
        dbBox.db = { characters: [], personas: [], characterOrder: [], botPresets: [], largeNotes: noise }
        const exporting = await makeWorld(normal, { pieceBytes: 8 * MIB })
        expect((await SaveLocalBackup()).status).toBe('saved')
        const database = writtenEntries().find((candidate) => candidate.name === 'database.risudat')!.data
        expect(database.length).toBeGreaterThan(4 * MIB)
        sink.writes.length = 0
        exporting.requests.length = 0
        const world = await makeWorld(normal, { pieceBytes: 8 * MIB })

        const end = await restore(chunkOf('database.risudat', database))

        expect(end.outcome).toBe('committed')
        expect(world.requests.filter((request) => request.route === '/api/upload/begin')).toEqual([])
        expect(await onDisk(normal, 'assets/database.risudat')).toBeNull()
    }, 120_000)

    test('data safety: a cold-storage unit above one chunk is never streamed', async () => {
        const database = await databaseEntry()
        const world = await makeWorld(normal, { pieceBytes: 8 * MIB })
        const coldName = 'coldstorage_' + '0'.repeat(8) + '-0000-4000-8000-' + '0'.repeat(12) + '.json'
        const cold = new TextEncoder().encode(' '.repeat(5 * MIB))

        await restore(Buffer.concat([chunkOf(coldName, cold), chunkOf('database.risudat', database)]))

        expect(world.requests.filter((request) => request.route === '/api/upload/begin')).toEqual([])
    }, 60_000)

    test('guard: a stale entry name the store refuses is skipped and named, and the restore goes on', async () => {
        const database = await databaseEntry()
        await makeWorld(normal, { pieceBytes: 8 * MIB })
        const bytes = patterned(5 * MIB, 14)

        const end = await restore(Buffer.concat([chunkOf('.hidden.png', bytes), chunkOf('database.risudat', database)]))

        expect(end.outcome).toBe('committed')
        expect(alerts.normalWait.some((message) => message.includes('.hidden.png'))).toBe(true)
        expect(await onDisk(normal, 'assets/.hidden.png')).toBeNull()
    }, 60_000)

    test('new behaviour: a server that refuses the upload as too large stops the restore with the too-large message', async () => {
        const database = await databaseEntry()
        // The small server holds assets up to 5000 bytes, so it refuses this upload with a 413.
        const world = await makeWorld(small, { pieceBytes: 8 * MIB })
        const bytes = patterned(5 * MIB, 15)

        const end = await restore(Buffer.concat([chunkOf('big.png', bytes), chunkOf('database.risudat', database)]))

        expect(end.outcome).not.toBe('committed')
        expect(alerts.error).toContain(language.restoreAssetRefusedTooLarge('big.png'))
        expect(world.routesFor('assets/big.png')).not.toContain('/api/write')
        expect(await stagingFiles(small)).toEqual([])
    }, 60_000)

    test.each([
        { name: 'the upload is gone', answer: () => new Response(JSON.stringify({ code: 'upload-gone' }), { status: 410, headers: { 'content-type': 'application/json' } }) },
        { name: 'the server holds too many staged bytes', answer: () => new Response(JSON.stringify({ code: 'upload-capacity' }), { status: 503, headers: { 'content-type': 'application/json' } }) },
    ])('new behaviour: when $name the restore stops with the upload message', async ({ answer }) => {
        const database = await databaseEntry()
        await makeWorld(normal, {
            pieceBytes: 8 * MIB,
            script: async (call) => (call.route === '/api/upload/append' ? answer() : undefined),
        })
        const bytes = patterned(5 * MIB, 16)

        const end = await restore(Buffer.concat([chunkOf('big.png', bytes), chunkOf('database.risudat', database)]))

        expect(end.outcome).not.toBe('committed')
        expect(alerts.error).toContain(language.restoreAssetUploadStopped('big.png'))
    }, 60_000)

    test('new behaviour: a slice of the backup file that cannot be read stops the restore as a changed file', async () => {
        const database = await databaseEntry()
        await makeWorld(normal, { pieceBytes: 8 * MIB })
        const bytes = patterned(5 * MIB, 17)
        const backup = Buffer.concat([chunkOf('big.png', bytes), chunkOf('database.risudat', database)])
        const entryStart = 4 + 'big.png'.length + 4
        class FailingFile extends File {
            override slice(start?: number, end?: number, type?: string): Blob {
                const part = super.slice(start, end, type)
                if (start !== undefined && end !== undefined && start >= entryStart + 4 * MIB && end - start === part.size && part.size > 0 && start < entryStart + bytes.length) {
                    return Object.assign(part, { arrayBuffer: async () => { throw new Error('the backup file changed') } })
                }
                return part
            }
        }

        const end = await restore(backup, new FailingFile([backup as Uint8Array<ArrayBuffer>], 'backup.bin'))

        expect(end.outcome).not.toBe('committed')
        expect(alerts.error).toContain(language.backupFileChangedWhileReading)
        expect(await stagingFiles(normal)).toEqual([])
        expect(await onDisk(normal, 'assets/big.png')).toBeNull()
    }, 60_000)
})
