// @vitest-environment node
/**
 * The Node store's use of the chunked upload and ranged read routes
 * (`/api/upload/*`, `/api/read-range`) against the real `server/node/server.cjs`
 * run as a child process with small limits (chunks of 100 bytes, assets up to
 * 1000), and the two save helpers of `globalApi.svelte.ts` that sit on top of
 * it. A scripted `fetch` in front of the real server loses replies, answers
 * with a proxy's page or edits a key between two pieces where the real server
 * cannot be made to. A pass here says nothing about a browser or a real proxy.
 *
 * Titles say what a test pins. `reproducer` fails on the client before the
 * change (the store sent every value through `/api/write` and `/api/read`);
 * `new behaviour` pins what only the piece routes do; `guard` holds before and
 * after (an old, an upstream or a capability-less server keeps working).
 */
import { createHash } from 'node:crypto'
import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writable } from 'svelte/store'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

// The facade builds its storage tab locks on `localStorage` when it loads; the live-server fixture needs the
// `node` environment, which has none.
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
    /** A module whose every named export is a mock function, for the native bridges the facade imports but never reaches here. */
    permissive: (): Record<string, unknown> => new Proxy({} as Record<string, unknown>, {
        get: (_target, key) => (key === 'then' ? undefined : vi.fn()),
        has: () => true,
    }),
}))

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

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => {
        throw new Error('no live database in tests')
    }),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as Record<string, unknown> },
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
    waitAlert: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/util'), () => ({
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
vi.mock('@tauri-apps/api/event', () => h.permissive())
vi.mock('@tauri-apps/api/webviewWindow', () => h.permissive())
vi.mock('src/ts/vendor/streamSaver', () => ({ default: { useBlobFallback: false, createWriteStream: vi.fn() } }))

vi.mock(import('src/ts/update'), () => ({ checkRisuUpdate: vi.fn(async () => { }) }))
vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({ loadPlugins: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/plugins/plugins.svelte'))
vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: async () => {
        throw new Error('assets are not hashed through the parser')
    },
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
vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({ getColdStorageItem: vi.fn() }) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

//#endregion

import { saveAsset, saveAssetFromPieces } from 'src/ts/globalApi.svelte'
import { writeAppInlay, type InlayAsset } from 'src/ts/process/files/inlayStore'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import {
    ServerLacksCapabilityError,
    StoreInvalidKeyError,
    StoreOutcomeUnknownError,
    StoreValueChangedError,
    UploadCapacityError,
    UploadGoneError,
} from 'src/ts/storage/store/errors'
import { NODE_PIECE_BYTES, createNodeHttpStore, NodeHttpError, type FetchLike } from 'src/ts/storage/store/nodeHttpStore'
import { hexOfKey, startNodeServer, type NodeServerFixture } from './nodeServerFixture'

const FAULTS = fileURLToPath(new URL('./nodeWriteFaults.cjs', import.meta.url))
const CHUNK = 100
const ASSET_LIMIT = 1000

let main: NodeServerFixture
let capped: NodeServerFixture

beforeAll(async () => {
    const limits = {
        RISU_NODE_ASSET_LIMIT_BYTES: String(ASSET_LIMIT),
        RISU_UPLOAD_CHUNK_MAX_BYTES: String(CHUNK),
    }
    main = await startNodeServer({ env: limits, nodeArgs: ['--require', FAULTS] })
    capped = await startNodeServer({ env: { ...limits, RISU_UPLOAD_STAGED_CAP_BYTES: '150' } })
}, 120_000)

afterAll(async () => {
    await Promise.all([main?.stop(), capped?.stop()])
}, 60_000)

beforeEach(() => {
    h.platform.isTauri = false
    h.platform.isNodeServer = true
})

afterEach(() => {
    injectAppStore(null)
    vi.restoreAllMocks()
})

//#region helpers

let keyCounter = 0

function assetKey(label: string): string {
    keyCounter++
    return `assets/${label}-${keyCounter}.bin`
}

function patterned(length: number, seed: number): Uint8Array {
    return Uint8Array.from({ length }, (_, index) => (index * 7 + seed) & 255)
}

function sameBytes(left: Uint8Array | null, right: Uint8Array): boolean {
    return left !== null && Buffer.from(left).equals(Buffer.from(right))
}

const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

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

const markerDir = (fx: NodeServerFixture) => dirname(fx.saveDir)

interface Call {
    route: string
    nth: number
    method: string
    headers: Record<string, string>
    /** Sends the request to the real server. */
    forward: () => Promise<Response>
}

/** Returns the answer to give instead of the real server's, or nothing to let the request through. A throw is a connection that failed. */
type Script = (call: Call) => Promise<Response | undefined>

interface Instrumented {
    fetch: FetchLike
    calls: Array<{ route: string, method: string, headers: Record<string, string> }>
    routes(): string[]
    count(route: string): number
}

function instrumented(fx: NodeServerFixture, script?: Script): Instrumented {
    const calls: Instrumented['calls'] = []
    const counts = new Map<string, number>()
    const fetchLike: FetchLike = async (url, init) => {
        const route = new URL(url).pathname
        const nth = (counts.get(route) ?? 0) + 1
        counts.set(route, nth)
        const headers = { ...(init?.headers as Record<string, string>) }
        const method = init?.method ?? 'GET'
        calls.push({ route, method, headers })
        const forward = () => fetch(url, init)
        return (await script?.({ route, nth, method, headers, forward })) ?? await forward()
    }
    return { fetch: fetchLike, calls, routes: () => calls.map((call) => call.route), count: (route) => calls.filter((call) => call.route === route).length }
}

function makeStore(fx: NodeServerFixture, spy: Instrumented): ByteStore {
    return createNodeHttpStore({
        baseUrl: fx.baseUrl,
        authHeader: () => fx.authHeader(),
        fetch: spy.fetch,
        pieceBytes: CHUNK,
        sleep: async () => { },
    })
}

/** A store whose server was probed (so `pieces` is recorded) and whose request log starts empty. */
async function probedStore(fx: NodeServerFixture, script?: Script): Promise<{ store: ByteStore, spy: Instrumented }> {
    const spy = instrumented(fx, script)
    const store = makeStore(fx, spy)
    await store.guarded!.probe()
    spy.calls.length = 0
    return { store, spy }
}

/** A store that never probed: the record stays at its default. */
function unprobedStore(fx: NodeServerFixture, script?: Script): { store: ByteStore, spy: Instrumented } {
    const spy = instrumented(fx, script)
    return { store: makeStore(fx, spy), spy }
}

/** A plain store with no script, to change a key behind another store's back. */
function bystander(fx: NodeServerFixture): ByteStore {
    return makeStore(fx, instrumented(fx))
}

async function abortOutOfBand(fx: NodeServerFixture, uploadId: string): Promise<void> {
    const response = await fetch(`${fx.baseUrl}/api/upload/abort`, { method: 'POST', headers: { 'upload-id': uploadId, 'risu-auth': await fx.authHeader() } })
    expect(response.status).toBe(200)
}

/** The answer of a guarded caps request, as a server with the given `pieces` flag would give it. */
function capsAnswer(pieces: boolean): Response {
    return new Response(JSON.stringify({ checkOnly: true, retire: true, pieces, listPrefix: true }), {
        status: 200,
        headers: { 'risu-storage-guarded': '1', 'content-type': 'application/json' },
    })
}

const lostReply = () => new TypeError('fetch failed: the reply was lost')

/** A byte-for-byte pieces iterator over `bytes` in the given piece length. */
async function* piecesOf(bytes: Uint8Array, length: number): AsyncGenerator<Uint8Array> {
    for (let at = 0; at < bytes.length; at += length) {
        yield bytes.subarray(at, Math.min(bytes.length, at + length))
    }
}

//#endregion

describe('reproducers: the store used /api/write and /api/read for every value', () => {
    test('reproducer: store.write of an asset above one chunk goes through the upload and stores the same bytes', async () => {
        const { store, spy } = await probedStore(main)
        const key = assetKey('write-large')
        const bytes = patterned(450, 1)

        const result = await store.write(key, bytes, 'unconditional')

        expect(spy.routes()).toEqual(['/api/upload/begin', ...Array(5).fill('/api/upload/append'), '/api/upload/commit'])
        expect(sameBytes(await onDisk(main, key), bytes)).toBe(true)
        expect(result.version).toBe(1)
        expect(await stagingFiles(main)).toEqual([])
    })

    test('reproducer: an inlay Blob attached through writeAppInlay is written in slices, without reading the whole Blob, and reads back byte-equal', async () => {
        const { store, spy } = await probedStore(main)
        injectAppStore(store, 'node')
        const bytes = patterned(450, 2)
        const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'video/mp4' })
        const whole = vi.spyOn(blob, 'arrayBuffer')

        const asset: InlayAsset = { data: blob, ext: 'mp4', name: 'clip.mp4', type: 'video' }

        await writeAppInlay(store, 'reproducer-inlay', asset)

        expect(whole).not.toHaveBeenCalled()
        expect(spy.count('/api/upload/commit')).toBe(1)
        const bodies = await store.list('inlays/b-reproducer-inlay.')
        expect(bodies).toHaveLength(1)
        expect(sameBytes((await store.read(bodies[0])).bytes, bytes)).toBe(true)
    })

    test('reproducer: reading a large asset never calls the whole /api/read, and is byte-equal', async () => {
        const { store, spy } = await probedStore(main)
        const key = assetKey('read-large')
        const bytes = patterned(450, 3)
        await writeFile(join(main.saveDir, hexOfKey(key)), bytes)

        const read = await store.read(key)

        expect(spy.routes()).toEqual(Array(5).fill('/api/read-range'))
        expect(sameBytes(read.bytes, bytes)).toBe(true)
    })

    test('reproducer: saveAsset of a key that exists does not rewrite it, so the revision stays', async () => {
        const { store, spy } = await probedStore(main)
        injectAppStore(store, 'node')
        const bytes = patterned(60, 4)

        const first = await saveAsset(bytes)
        const second = await saveAsset(bytes)

        expect(second).toBe(first)
        expect(first).toBe(`assets/${sha256Hex(bytes)}.png`)
        expect(spy.routes().filter((route) => route === '/api/write')).toHaveLength(1)
        expect((await store.read(first)).version).toBe(1)
    })

    test('reproducer: saveAssetFromPieces on the Node store uploads the pieces, keeps an existing key and gives the key saveAsset gives', async () => {
        const { store, spy } = await probedStore(main)
        injectAppStore(store, 'node')
        const bytes = patterned(450, 5)

        const first = await saveAssetFromPieces(piecesOf(bytes, 70), { sizeBound: bytes.length, minPieceBytes: 1 })
        const again = await saveAssetFromPieces(piecesOf(bytes, 70), { sizeBound: bytes.length, minPieceBytes: 1 })

        expect(first).toBe(`assets/${sha256Hex(bytes)}.png`)
        expect(again).toBe(first)
        expect(spy.routes()).not.toContain('/api/write')
        expect(spy.count('/api/upload/commit')).toBe(2)
        expect(spy.calls.filter((call) => call.route === '/api/upload/commit').every((call) => call.headers['upload-if-absent'] === '1')).toBe(true)
        expect(sameBytes(await onDisk(main, first), bytes)).toBe(true)
        expect((await store.read(first)).version).toBe(1)
        expect(await stagingFiles(main)).toEqual([])
    })
})

describe('the writer', () => {
    test('new behaviour: pieces of any size are buffered into chunks at the acknowledged offsets, and finish(finalKey) commits if-absent', async () => {
        const { store, spy } = await probedStore(main)
        const key = assetKey('buffered')
        const bytes = patterned(250, 6)
        const writer = store.openWriter!(`assets/incoming-${keyCounter}`)

        for (let at = 0; at < bytes.length; at += 30) {
            await writer.write(bytes.subarray(at, Math.min(bytes.length, at + 30)))
        }
        await writer.finish(key)

        const appends = spy.calls.filter((call) => call.route === '/api/upload/append')
        expect(appends.map((call) => call.headers['upload-offset'])).toEqual(['0', '100', '200'])
        expect(spy.calls.find((call) => call.route === '/api/upload/commit')?.headers['upload-if-absent']).toBe('1')
        expect(sameBytes(await onDisk(main, key), bytes)).toBe(true)
        expect(await onDisk(main, `assets/incoming-${keyCounter}`)).toBeNull()
    })

    test('new behaviour: finish() with no final key replaces the value and sends no if-absent', async () => {
        const { store, spy } = await probedStore(main)
        const key = assetKey('replace')
        await store.write(key, patterned(5, 0), 'unconditional')
        const writer = store.openWriter!(key)
        await writer.write(patterned(150, 7))
        await writer.finish()

        expect(spy.calls.find((call) => call.route === '/api/upload/commit')?.headers['upload-if-absent']).toBeUndefined()
        expect(sameBytes(await onDisk(main, key), patterned(150, 7))).toBe(true)
    })

    test('new behaviour: finish(finalKey) over a key that holds a value keeps that value', async () => {
        const { store } = await probedStore(main)
        const key = assetKey('kept')
        await store.write(key, patterned(20, 8), 'unconditional')
        const writer = store.openWriter!('assets/incoming-kept')
        await writer.write(patterned(250, 9))
        await writer.finish(key)

        expect(sameBytes(await onDisk(main, key), patterned(20, 8))).toBe(true)
        expect((await store.read(key)).version).toBe(1)
    })

    test('new behaviour: a commit whose reply is lost is re-sent once and the server answers it with the first outcome', async () => {
        const { store, spy } = await probedStore(main, async (call) => {
            if (call.route === '/api/upload/commit' && call.nth === 1) {
                await call.forward()
                throw lostReply()
            }
            return undefined
        })
        const key = assetKey('lost-commit')
        const bytes = patterned(250, 10)

        const result = await store.write(key, bytes, 'unconditional')

        expect(spy.count('/api/upload/commit')).toBe(2)
        expect(result.version).toBe(1)
        expect(sameBytes(await onDisk(main, key), bytes)).toBe(true)
        expect((await store.read(key)).version).toBe(1)
    })

    test('new behaviour: an append whose reply is lost is re-sent once at the same offset and the value is whole', async () => {
        const { store, spy } = await probedStore(main, async (call) => {
            if (call.route === '/api/upload/append' && call.nth === 2) {
                await call.forward()
                throw lostReply()
            }
            return undefined
        })
        const key = assetKey('lost-append')
        const bytes = patterned(450, 11)

        await store.write(key, bytes, 'unconditional')

        expect(spy.calls.filter((call) => call.route === '/api/upload/append').map((call) => call.headers['upload-offset'])).toEqual(['0', '100', '100', '200', '300', '400'])
        expect(sameBytes(await onDisk(main, key), bytes)).toBe(true)
    })

    test('new behaviour: an append answered by a proxy 5xx is re-sent once', async () => {
        const { store, spy } = await probedStore(main, async (call) => (call.route === '/api/upload/append' && call.nth === 1 ? new Response('<html>bad gateway</html>', { status: 502 }) : undefined))
        const key = assetKey('append-502')
        const bytes = patterned(250, 12)

        await store.write(key, bytes, 'unconditional')

        expect(spy.count('/api/upload/append')).toBe(4)
        expect(sameBytes(await onDisk(main, key), bytes)).toBe(true)
    })

    test('new behaviour: a second append failure aborts the upload and rejects with the transport error', async () => {
        const failure = new TypeError('fetch failed: the connection was reset')
        const { store, spy } = await probedStore(main, async (call) => {
            if (call.route === '/api/upload/append' && call.nth >= 2) {
                throw failure
            }
            return undefined
        })
        const key = assetKey('append-dead')

        await expect(store.write(key, patterned(450, 13), 'unconditional')).rejects.toBe(failure)

        expect(spy.count('/api/upload/append')).toBe(3)
        expect(spy.count('/api/upload/abort')).toBe(1)
        expect(spy.count('/api/upload/commit')).toBe(0)
        expect(await onDisk(main, key)).toBeNull()
        expect(await stagingFiles(main)).toEqual([])
    })

    test('new behaviour: a server that holds too many staged bytes is a typed capacity error, and the upload is abandoned', async () => {
        const { store, spy } = await probedStore(capped)

        await expect(store.write(assetKey('capacity'), patterned(450, 14), 'unconditional')).rejects.toBeInstanceOf(UploadCapacityError)

        expect(spy.count('/api/upload/abort')).toBe(1)
        expect(await stagingFiles(capped)).toEqual([])
    })

    test('new behaviour: a 413 of the upload reaches the caller as the too-large answer of a write', async () => {
        const { store } = await probedStore(main)

        const error = await store.write(assetKey('too-large'), patterned(ASSET_LIMIT + 50, 15), 'unconditional').catch((caught: unknown) => caught)

        expect(error).toBeInstanceOf(NodeHttpError)
        expect((error as NodeHttpError).status).toBe(413)
        expect((error as NodeHttpError).operation).toBe('write')
        expect(await stagingFiles(main)).toEqual([])
    })

    test('new behaviour: a conditional write and a key outside the asset routes keep /api/write', async () => {
        const { store, spy } = await probedStore(main)
        const key = assetKey('conditional')
        const first = await store.write(key, patterned(10, 0), 'unconditional')

        await store.write(key, patterned(450, 16), { ifVersion: first.version! })
        await store.write('k/plain', patterned(450, 17), 'unconditional')

        expect(spy.routes()).toEqual(['/api/write', '/api/write', '/api/write'])
    })
})

describe('the commit outcome', () => {
    test('new behaviour: a 410 in replace mode is an unknown outcome, not re-sent and not settled by the key holding some value', async () => {
        const { store, spy } = await probedStore(main, async (call) => {
            if (call.route === '/api/upload/commit') {
                await abortOutOfBand(main, call.headers['upload-id'])
            }
            return undefined
        })
        const key = assetKey('gone-replace')
        const old = patterned(20, 17)
        await bystander(main).write(key, old, 'unconditional')

        await expect(store.write(key, patterned(250, 18), 'unconditional')).rejects.toBeInstanceOf(StoreOutcomeUnknownError)

        expect(spy.count('/api/upload/commit')).toBe(1)
        expect(sameBytes(await onDisk(main, key), old)).toBe(true)
    })

    test('new behaviour: a 410 in if-absent mode with the key present is a success', async () => {
        const key = assetKey('gone-present')
        const { store } = await probedStore(main, async (call) => {
            if (call.route === '/api/upload/commit') {
                await abortOutOfBand(main, call.headers['upload-id'])
            }
            return undefined
        })
        await bystander(main).write(key, patterned(20, 19), 'unconditional')
        const writer = store.openWriter!('assets/incoming-gone')
        await writer.write(patterned(250, 20))

        await expect(writer.finish(key)).resolves.toBeUndefined()

        expect(sameBytes(await onDisk(main, key), patterned(20, 19))).toBe(true)
    })

    test('new behaviour: a 410 in if-absent mode with the key absent is an UploadGoneError', async () => {
        const { store } = await probedStore(main, async (call) => {
            if (call.route === '/api/upload/commit') {
                await abortOutOfBand(main, call.headers['upload-id'])
            }
            return undefined
        })
        const key = assetKey('gone-absent')
        const writer = store.openWriter!('assets/incoming-gone2')
        await writer.write(patterned(250, 21))

        await expect(writer.finish(key)).rejects.toBeInstanceOf(UploadGoneError)

        expect(await onDisk(main, key)).toBeNull()
    })

    test('new behaviour: a 5xx carrying the server\'s own failure is a definite failure: not re-sent, not an unknown outcome, the old value intact', async () => {
        const { store, spy } = await probedStore(main)
        const key = assetKey('marker')
        const original = patterned(30, 22)
        await store.write(key, original, 'unconditional')
        await writeFile(join(markerDir(main), 'inject-rename-fail'), 'EIO')
        let error: unknown
        try {
            error = await store.write(key, patterned(250, 23), 'unconditional').catch((caught: unknown) => caught)
        } finally {
            await rm(join(markerDir(main), 'inject-rename-fail'), { force: true })
        }

        expect(error).toBeInstanceOf(NodeHttpError)
        expect(error).not.toBeInstanceOf(StoreOutcomeUnknownError)
        expect((error as NodeHttpError).status).toBe(500)
        expect(spy.count('/api/upload/commit')).toBe(1)
        expect(sameBytes(await onDisk(main, key), original)).toBe(true)
        expect(await stagingFiles(main)).toEqual([])
    })

    test('new behaviour: a proxy 5xx on a commit is re-sent once, and still failing is an unknown outcome in replace mode', async () => {
        const { store, spy } = await probedStore(main, async (call) => (call.route === '/api/upload/commit' ? new Response('<html>gateway timeout</html>', { status: 504 }) : undefined))

        await expect(store.write(assetKey('proxy-5xx'), patterned(250, 24), 'unconditional')).rejects.toBeInstanceOf(StoreOutcomeUnknownError)

        expect(spy.count('/api/upload/commit')).toBe(2)
    })

    test('new behaviour: a proxy 5xx on a commit that then succeeds on the re-send is a success', async () => {
        const { store, spy } = await probedStore(main, async (call) => (call.route === '/api/upload/commit' && call.nth === 1 ? new Response('<html>bad gateway</html>', { status: 502 }) : undefined))
        const key = assetKey('proxy-502')
        const bytes = patterned(250, 25)

        await store.write(key, bytes, 'unconditional')

        expect(spy.count('/api/upload/commit')).toBe(2)
        expect(sameBytes(await onDisk(main, key), bytes)).toBe(true)
    })

    test('new behaviour: an unresolved if-absent commit is settled by has: present is a success, absent is an unknown outcome', async () => {
        const key = assetKey('unresolved')
        const { store } = await probedStore(main, async (call) => (call.route === '/api/upload/commit' ? new Response('<html>gateway timeout</html>', { status: 504 }) : undefined))
        const writer = store.openWriter!('assets/incoming-unresolved')
        await writer.write(patterned(250, 26))
        await expect(writer.finish(key)).rejects.toBeInstanceOf(StoreOutcomeUnknownError)

        await bystander(main).write(key, patterned(10, 27), 'unconditional')
        const second = store.openWriter!('assets/incoming-unresolved2')
        await second.write(patterned(250, 28))

        await expect(second.finish(key)).resolves.toBeUndefined()
    })
})

describe('writeBlob', () => {
    test('new behaviour: a Blob above one chunk is read and uploaded one slice at a time, never whole', async () => {
        const BODY = 'inlays/b-sliced.0123456789abcdef'
        const { store, spy } = await probedStore(main)
        const bytes = patterned(450, 29)
        const blob = new Blob([bytes as Uint8Array<ArrayBuffer>])
        const whole = vi.spyOn(blob, 'arrayBuffer')

        const result = await store.writeBlob!(BODY, blob, 'unconditional')

        expect(whole).not.toHaveBeenCalled()
        expect(spy.count('/api/upload/append')).toBe(5)
        expect(result.version).toBe(1)
        expect(sameBytes(await onDisk(main, BODY), bytes)).toBe(true)
        expect(store.readBlob).toBeUndefined()
    })

    test('new behaviour: a Blob of one chunk or less is one single-body write', async () => {
        const BODY = 'inlays/b-small.0123456789abcdef'
        const { store, spy } = await probedStore(main)

        await store.writeBlob!(BODY, new Blob([patterned(CHUNK, 30) as Uint8Array<ArrayBuffer>]), 'unconditional')

        expect(spy.routes()).toEqual(['/api/write'])
    })

    test('data safety: a slice that cannot be read reaches the caller unchanged, is read once, aborts the upload and is never sent again', async () => {
        const BODY = 'inlays/b-unreadable.0123456789abcdef'
        const { store, spy } = await probedStore(main)
        const blob = new Blob([patterned(450, 31) as Uint8Array<ArrayBuffer>])
        const failure = new DOMException('The requested file could not be read.', 'NotReadableError')
        let failedReads = 0
        const realSlice = Blob.prototype.slice
        vi.spyOn(blob, 'slice').mockImplementation((start, end, type) => {
            const piece = realSlice.call(blob, start, end, type)
            if (start === CHUNK) {
                vi.spyOn(piece, 'arrayBuffer').mockImplementation(async () => {
                    failedReads++
                    throw failure
                })
            }
            return piece
        })

        await expect(store.writeBlob!(BODY, blob, 'unconditional')).rejects.toBe(failure)

        expect(failedReads).toBe(1)
        expect(spy.count('/api/upload/append')).toBe(1)
        expect(spy.count('/api/upload/abort')).toBe(1)
        expect(spy.count('/api/upload/commit')).toBe(0)
        expect(await onDisk(main, BODY)).toBeNull()
        expect(await stagingFiles(main)).toEqual([])
    })
})

describe('writeAppInlay over the Node store', () => {
    test('data safety: a Blob whose second slice cannot be read rejects with that same NotReadableError (the changed outcome of writeGroup), aborts the upload and leaves no inlay key', async () => {
        const { store, spy } = await probedStore(main)
        injectAppStore(store, 'node')
        const blob = new Blob([patterned(450, 57) as Uint8Array<ArrayBuffer>], { type: 'video/mp4' })
        const failure = new DOMException('The requested file could not be read.', 'NotReadableError')
        const realSlice = Blob.prototype.slice
        vi.spyOn(blob, 'slice').mockImplementation((start, end, type) => {
            const piece = realSlice.call(blob, start, end, type)
            if (start === CHUNK) {
                vi.spyOn(piece, 'arrayBuffer').mockImplementation(async () => { throw failure })
            }
            return piece
        })
        const asset: InlayAsset = { data: blob, ext: 'mp4', name: 'unreadable.mp4', type: 'video' }

        const caught = await writeAppInlay(store, 'unreadable-inlay', asset).catch((error: unknown) => error)

        expect(caught).toBe(failure)
        expect(caught instanceof DOMException && caught.name === 'NotReadableError').toBe(true)
        expect(await store.list('inlays/')).not.toEqual(expect.arrayContaining([expect.stringContaining('unreadable-inlay')]))
        expect(spy.count('/api/upload/abort')).toBe(1)
        expect(spy.count('/api/upload/commit')).toBe(0)
        expect(await stagingFiles(main)).toEqual([])
    })
})

describe('the key rule', () => {
    test('data safety: an unusable key is refused before any request, by openWriter, by finish(finalKey), by writeBlob and by write', async () => {
        const { store, spy } = await probedStore(main)

        expect(() => store.openWriter!('a\uD800b')).toThrow(StoreInvalidKeyError)
        await expect(store.writeBlob!('a\uD800b', new Blob(['x']), 'unconditional')).rejects.toBeInstanceOf(StoreInvalidKeyError)
        await expect(store.write('a\uD800b', patterned(450, 32), 'unconditional')).rejects.toBeInstanceOf(StoreInvalidKeyError)
        expect(spy.calls).toEqual([])

        const writer = store.openWriter!('assets/incoming-rule')
        await writer.write(patterned(250, 33))
        await expect(writer.finish('assets/a\uD800b')).rejects.toBeInstanceOf(StoreInvalidKeyError)
        expect(spy.count('/api/upload/abort')).toBe(1)
        expect(await stagingFiles(main)).toEqual([])
    })

    test('data safety: a key that only the creatable rule refuses (too long for an asset key) is refused before any request, by openWriter and by finish(finalKey)', async () => {
        const { store, spy } = await probedStore(main)
        const tooLong = `assets/${'x'.repeat(200)}`

        expect(() => store.openWriter!(tooLong)).toThrow(StoreInvalidKeyError)
        expect(spy.calls).toEqual([])

        const writer = store.openWriter!('assets/incoming-too-long')
        await writer.write(patterned(250, 55))
        await expect(writer.finish(tooLong)).rejects.toBeInstanceOf(StoreInvalidKeyError)

        expect(spy.count('/api/upload/commit')).toBe(0)
        expect(spy.count('/api/upload/abort')).toBe(1)
        expect(await stagingFiles(main)).toEqual([])
    })
})

describe('ranged reads', () => {
    test('new behaviour: a revision change between pieces restarts the assembly, and the value comes from one revision', async () => {
        const key = assetKey('restart')
        const rewriter = bystander(main)
        await rewriter.write(key, patterned(450, 34), 'unconditional')
        const { store, spy } = await probedStore(main, async (call) => {
            if (call.route === '/api/read-range' && call.nth === 2) {
                await rewriter.write(key, patterned(450, 35), 'unconditional')
            }
            return undefined
        })

        const read = await store.read(key)

        expect(sameBytes(read.bytes, patterned(450, 35))).toBe(true)
        expect(read.version).toBe(2)
        expect(spy.count('/api/read-range')).toBe(7)
    })

    test('new behaviour: a value that keeps changing is given up after two restarts', async () => {
        const key = assetKey('restart-cap')
        const rewriter = bystander(main)
        await rewriter.write(key, patterned(450, 36), 'unconditional')
        const { store, spy } = await probedStore(main, async (call) => {
            if (call.route === '/api/read-range' && call.nth % 2 === 0) {
                await rewriter.write(key, patterned(450, 100 + call.nth), 'unconditional')
            }
            return undefined
        })

        await expect(store.read(key)).rejects.toBeInstanceOf(StoreValueChangedError)

        expect(spy.count('/api/read-range')).toBe(6)
    })

    test('new behaviour: a value whose size changes between pieces restarts the assembly', async () => {
        const key = assetKey('restart-size')
        const rewriter = bystander(main)
        await rewriter.write(key, patterned(450, 37), 'unconditional')
        const { store } = await probedStore(main, async (call) => {
            if (call.route === '/api/read-range' && call.nth === 3) {
                await rewriter.write(key, patterned(300, 38), 'unconditional')
            }
            return undefined
        })

        const read = await store.read(key)

        expect(sameBytes(read.bytes, patterned(300, 38))).toBe(true)
    })

    test('new behaviour: the streaming source hands out pieces in order with the total known from the first, and a value of one chunk or less is one piece', async () => {
        const key = assetKey('stream')
        const bytes = patterned(450, 39)
        await writeFile(join(main.saveDir, hexOfKey(key)), bytes)
        const { store, spy } = await probedStore(main)

        const source = await store.readPieces!(key)

        expect(source?.total).toBe(450)
        expect(spy.count('/api/read-range')).toBe(1)
        const pieces: Uint8Array[] = []
        for await (const piece of source!.pieces) {
            pieces.push(piece)
        }
        expect(pieces.map((piece) => piece.length)).toEqual([100, 100, 100, 100, 50])
        expect(sameBytes(Buffer.concat(pieces), bytes)).toBe(true)
    })

    test('data safety: the streaming source never restarts: a change after the first piece rejects and asks for nothing more', async () => {
        const key = assetKey('stream-changed')
        const rewriter = bystander(main)
        await rewriter.write(key, patterned(450, 40), 'unconditional')
        const { store, spy } = await probedStore(main, async (call) => {
            if (call.route === '/api/read-range' && call.nth === 2) {
                await rewriter.write(key, patterned(450, 41), 'unconditional')
            }
            return undefined
        })
        const source = await store.readPieces!(key)
        const seen: number[] = []

        const iteration = (async () => {
            for await (const piece of source!.pieces) {
                seen.push(piece.length)
            }
        })()

        await expect(iteration).rejects.toBeInstanceOf(StoreValueChangedError)
        expect(seen).toEqual([100])
        expect(spy.count('/api/read-range')).toBe(2)
    })

    test('data safety: absence is only what the server says; a failed first range is a transport error, never null', async () => {
        const failure = new TypeError('fetch failed: the connection was reset')
        const { store } = await probedStore(main, async (call) => {
            if (call.route === '/api/read-range' && call.nth === 1) {
                throw failure
            }
            if (call.route === '/api/read-range' && call.nth === 2) {
                return new Response('<html>bad gateway</html>', { status: 502 })
            }
            return undefined
        })
        const key = assetKey('stream-transport')
        await writeFile(join(main.saveDir, hexOfKey(key)), patterned(250, 42))

        await expect(store.readPieces!(key)).rejects.toBe(failure)
        const bad = await store.readPieces!(key).catch((caught: unknown) => caught)
        expect(bad).toBeInstanceOf(NodeHttpError)
        expect(await store.readPieces!(assetKey('never-written'))).toBeNull()
        expect((await store.read(assetKey('never-written-either'))).bytes).toBeNull()
    })

    test('new behaviour: a server that probed pieces but answers only the ranged read with 404 is read whole through /api/read, by read and by readPieces', async () => {
        const key = assetKey('range-404')
        const bytes = patterned(450, 56)
        await writeFile(join(main.saveDir, hexOfKey(key)), bytes)
        const { store, spy } = await probedStore(main, async (call) => (call.route === '/api/read-range' ? new Response('Not found', { status: 404 }) : undefined))

        const read = await store.read(key)

        expect(sameBytes(read.bytes, bytes)).toBe(true)
        expect(spy.routes()).toEqual(['/api/read-range', '/api/read'])

        // A second store still holds the probed record, so readPieces meets the 404 itself.
        const fresh = await probedStore(main, async (call) => (call.route === '/api/read-range' ? new Response('Not found', { status: 404 }) : undefined))
        const source = await fresh.store.readPieces!(key)
        expect(fresh.spy.routes()).toEqual(['/api/read-range', '/api/read'])
        const pieces: Uint8Array[] = []
        for await (const piece of source!.pieces) {
            pieces.push(piece)
        }

        expect(source?.total).toBe(450)
        expect(sameBytes(Buffer.concat(pieces), bytes)).toBe(true)
    })

    test('data safety: a transport error in the middle of the stream is that error, not a change', async () => {
        const failure = new TypeError('fetch failed: the connection was reset')
        const key = assetKey('stream-middle')
        await writeFile(join(main.saveDir, hexOfKey(key)), patterned(450, 43))
        const { store } = await probedStore(main, async (call) => {
            if (call.route === '/api/read-range' && call.nth === 3) {
                throw failure
            }
            return undefined
        })
        const source = await store.readPieces!(key)

        const iteration = (async () => {
            for await (const piece of source!.pieces) {
                expect(piece.length).toBeGreaterThan(0)
            }
        })()

        await expect(iteration).rejects.toBe(failure)
    })
})

describe('the capability record', () => {
    test('guard: a store that never probed treats the server as lacking pieces: every value goes through /api/write and /api/read', async () => {
        const { store, spy } = unprobedStore(main)
        const key = assetKey('no-caps')
        const bytes = patterned(450, 44)

        await store.write(key, bytes, 'unconditional')
        const read = await store.read(key)

        expect(spy.routes()).toEqual(['/api/write', '/api/read'])
        expect(sameBytes(read.bytes, bytes)).toBe(true)
    })

    test('new behaviour: a probe records the flag from its answer, and a later probe that says false turns pieces off', async () => {
        let pieces = true
        const spy = instrumented(main, async (call) => (call.route === '/api/caps' ? capsAnswer(pieces) : undefined))
        const store = makeStore(main, spy)
        expect(await store.guarded!.probe()).toEqual({ checkOnly: true, retire: true, pieces: true })
        spy.calls.length = 0

        await store.write(assetKey('flag-on'), patterned(250, 45), 'unconditional')
        pieces = false
        await store.guarded!.probe()
        spy.calls.length = 0
        await store.write(assetKey('flag-off'), patterned(250, 46), 'unconditional')

        expect(spy.routes()).toEqual(['/api/write'])
    })

    test('data safety: a probe that fails in transit leaves the record as it was', async () => {
        let offline = false
        const { store, spy } = await probedStore(main, async (call) => {
            if (call.route === '/api/caps' && offline) {
                throw new TypeError('fetch failed: offline')
            }
            return undefined
        })
        offline = true

        await expect(store.guarded!.probe()).rejects.toBeInstanceOf(StoreOutcomeUnknownError)
        spy.calls.length = 0
        await store.write(assetKey('transient'), patterned(250, 47), 'unconditional')

        expect(spy.count('/api/upload/commit')).toBe(1)
    })

    test('new behaviour: a refused probe clears the record', async () => {
        let refusing = false
        const { store, spy } = await probedStore(main, async (call) => (call.route === '/api/caps' && refusing ? new Response('Not found', { status: 404 }) : undefined))
        refusing = true

        await expect(store.guarded!.probe()).rejects.toBeInstanceOf(ServerLacksCapabilityError)
        spy.calls.length = 0
        await store.write(assetKey('refused'), patterned(250, 48), 'unconditional')

        expect(spy.routes()).toEqual(['/api/write'])
    })

    test('guard: the pinned default piece size does not exceed the server chunk limit', async () => {
        const limits = createRequire(import.meta.url)('../../../../server/node/bodyLimit.cjs') as { NODE_UPLOAD_CHUNK_MAX_BYTES: number }
        expect(limits.NODE_UPLOAD_CHUNK_MAX_BYTES).toBeGreaterThan(0)
        expect(NODE_PIECE_BYTES).toBeLessThanOrEqual(limits.NODE_UPLOAD_CHUNK_MAX_BYTES)
    })
})

describe('new behaviour (compatibility): a server without the upload routes keeps working and never surfaces a 404', () => {
    const SITUATIONS: Array<{ name: string, make: () => Promise<{ store: ByteStore, spy: Instrumented }> }> = [
        { name: 'no capabilities probed', make: async () => unprobedStore(main) },
        {
            name: 'caps say pieces:false',
            make: async () => {
                const spy = instrumented(main, async (call) => (call.route === '/api/caps' ? capsAnswer(false) : undefined))
                const store = makeStore(main, spy)
                await store.guarded!.probe()
                spy.calls.length = 0
                return { store, spy }
            },
        },
        {
            name: 'caps say pieces:true but the upload routes answer 404',
            make: async () => probedStore(main, async (call) => (call.route.startsWith('/api/upload/') || call.route === '/api/read-range' ? new Response('Not found', { status: 404 }) : undefined)),
        },
    ]

    describe.each(SITUATIONS)('$name', (situation) => {
        test('store.write, writeBlob, openWriter and saveAssetFromPieces store the same bytes through /api/write, and a read returns them', async () => {
            const { store, spy } = await situation.make()
            injectAppStore(store, 'node')
            const written = patterned(450, 49)
            const blobbed = patterned(450, 50)
            const piecewise = patterned(450, 51)
            const hashed = patterned(450, 52)
            const writeKey = assetKey('fallback-write')
            const blobKey = 'inlays/b-fallback.0123456789abcdef'
            const finalKey = assetKey('fallback-final')

            await store.write(writeKey, written, 'unconditional')
            await store.writeBlob!(blobKey, new Blob([blobbed as Uint8Array<ArrayBuffer>]), 'unconditional')
            const writer = store.openWriter!('assets/incoming-fallback')
            await writer.write(piecewise.subarray(0, 200))
            await writer.write(piecewise.subarray(200))
            await writer.finish(finalKey)
            const savedKey = await saveAssetFromPieces(piecesOf(hashed, 70), { sizeBound: hashed.length, minPieceBytes: 1 })

            expect(spy.routes().filter((route) => route === '/api/upload/append' || route === '/api/upload/commit' || route === '/api/read-range')).toEqual([])
            expect(sameBytes(await onDisk(main, writeKey), written)).toBe(true)
            expect(sameBytes(await onDisk(main, blobKey), blobbed)).toBe(true)
            expect(sameBytes(await onDisk(main, finalKey), piecewise)).toBe(true)
            expect(sameBytes(await onDisk(main, savedKey), hashed)).toBe(true)
            expect(sameBytes((await store.read(writeKey)).bytes, written)).toBe(true)
            expect((await store.readPieces!(writeKey))?.total).toBe(450)
            expect(await stagingFiles(main)).toEqual([])
        })
    })

    test('new behaviour: after an upload route answered 404 the record is cleared, so the next write does not begin another upload', async () => {
        const { store, spy } = await probedStore(main, async (call) => (call.route === '/api/upload/begin' ? new Response('Not found', { status: 404 }) : undefined))

        await store.write(assetKey('cleared-1'), patterned(250, 53), 'unconditional')
        await store.write(assetKey('cleared-2'), patterned(250, 54), 'unconditional')

        expect(spy.count('/api/upload/begin')).toBe(1)
        expect(spy.count('/api/write')).toBe(2)
    })
})
