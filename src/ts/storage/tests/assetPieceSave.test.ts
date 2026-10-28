/**
 * `saveAsset` hashing and `saveAssetFromPieces` of `globalApi.svelte.ts`, with the
 * real module graph from the facade down to the byte store:
 *
 * - Tauri: the real desktop files store over the in-memory file system in
 *   `tauriFsFake.ts` and the command stand-ins in `tauriDesktopFake.ts` (desktop
 *   raw chunks, the base64 fallback, and the Android transport).
 * - Web and Node: a store injected through `injectAppStore`, over a `Map`.
 *
 * `wire` records every byte the commands received, as the commands received it,
 * so a test hashes what reached the transport rather than what the source
 * promised to send. Everything else the facade imports is mocked. A pass here
 * says nothing about the Rust commands, the native bridge or a browser.
 *
 * Titles say what a test pins: `reproducer` fails without the change, `data
 * safety` pins what must never reach the disk, `guard` holds before and after,
 * `new behaviour` pins what only the piece save does.
 */
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { CHUNK_MAX, WRITE_CHUNK_BYTES } from 'src/ts/storage/tauriByteTransport'
import type { ByteStore, ReadResult } from 'src/ts/storage/store/contract'
import type { InlayAsset } from 'src/ts/process/files/inlayStore'

// Many tests here hash megabytes and take one to two seconds alone; a loaded machine must not turn that into a timeout.
vi.setConfig({ testTimeout: 30_000 })

const h = vi.hoisted(() => ({
    platform: { isTauri: false, isNodeServer: false },
    os: 'linux' as 'linux' | 'windows' | 'android',
    keyPair: null as CryptoKeyPair | null,
}))

const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))
const fakePaths = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriPathFake')).createFakeTauriPaths())
const desktop = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriDesktopFake')).createDesktopInvoke(fakeFs))

interface WireChunk {
    command: string
    bytes: Uint8Array
    offset: number
    last: boolean
    finalKey: string | undefined
    key: string
}

const wire = vi.hoisted(() => ({
    chunks: [] as WireChunk[],
    /** Runs after each chunk command has been answered. */
    afterChunk: undefined as ((chunk: WireChunk) => void) | undefined,
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

vi.mock('@tauri-apps/api/core', () => ({
    ...fakePaths.coreModule,
    invoke: async (command: string, args?: unknown, options?: { headers?: Record<string, string> }) => {
        let chunk: WireChunk | undefined
        if (command === 'write_chunk_raw' && args instanceof Uint8Array) {
            const headers = options?.headers ?? {}
            chunk = {
                command,
                bytes: args.slice(),
                offset: Number(headers['x-risu-offset']),
                last: headers['x-risu-last'] === '1',
                finalKey: headers['x-risu-final-key'] === undefined ? undefined : decodeURIComponent(headers['x-risu-final-key']),
                key: decodeURIComponent(headers['x-risu-key']),
            }
        } else if (command === 'write_chunk') {
            const named = args as { data: string, offset: number, last: boolean, finalKey?: string, key: string }
            chunk = { command, bytes: Uint8Array.from(Buffer.from(named.data, 'base64')), offset: named.offset, last: named.last, finalKey: named.finalKey, key: named.key }
        }
        let refused = false
        try {
            return await desktop.invoke(command, args, options)
        } catch (error) {
            // A body the command refuses as not raw is not received.
            refused = String(error).startsWith('not-raw:')
            throw error
        } finally {
            if (chunk !== undefined && !refused) {
                wire.chunks.push(chunk)
                wire.afterChunk?.(chunk)
            }
        }
    },
}))
vi.mock('@tauri-apps/api/path', () => ({ ...fakePaths.pathModule, basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/plugin-fs', () => fakeFs.module)
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => h.os }))
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn(async () => { }) }))
vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: { getWriter: () => ({ write: async () => { }, close: async () => { } }) },
        }),
    },
}))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })),
}))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn(async () => new Response(null, { status: 404 })) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }))

vi.mock(import('src/ts/update'), () => ({ checkRisuUpdate: vi.fn(async () => { }) }))
vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({ loadPlugins: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

// An asset is hashed by assetHash.ts; a call into the parser's hasher is a failure.
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

const MIB = 1024 * 1024
/** Just above the piece-save threshold, so the default threshold is the one under test. */
const LARGE = 17 * MIB + 12345

function sha256Hex(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex')
}

/** A deterministic byte stream: the same seed gives the same bytes. */
function randomBytes(length: number, seed: number): Uint8Array {
    const out = new Uint8Array(length)
    let state = seed >>> 0 || 1
    for (let i = 0; i < length; i++) {
        state ^= state << 13
        state >>>= 0
        state ^= state >>> 17
        state ^= state << 5
        state >>>= 0
        out[i] = state & 0xff
    }
    return out
}

/** The pieces of `bytes` in the given sizes, repeated; every piece is a view that is never touched afterwards. */
async function* piecesOf(bytes: Uint8Array, sizes: number[]): AsyncGenerator<Uint8Array, void, undefined> {
    let at = 0
    for (let i = 0; at < bytes.length; i++) {
        const size = sizes[i % sizes.length]
        yield bytes.subarray(at, Math.min(at + size, bytes.length))
        at += size
    }
}

const PIECE_SIZES = [3 * MIB + 17, 5 * MIB, 1, 123457, 6 * MIB + 3, 777]

type Api = typeof import('src/ts/globalApi.svelte')
type AppStoreModule = typeof import('src/ts/storage/store/appStore')
type BusyModule = typeof import('src/ts/process/memory/busyActions')

interface World {
    api: Api
    appStore: AppStoreModule
    busy: BusyModule
}

/** A fresh module graph: a fresh page load for every memory the facade and the store keep. */
async function loadWorld(): Promise<World> {
    vi.resetModules()
    const api = await import('src/ts/globalApi.svelte')
    const appStore = await import('src/ts/storage/store/appStore')
    const busy = await import('src/ts/process/memory/busyActions')
    return { api, appStore, busy }
}

interface MapStoreHandle {
    store: ByteStore
    files: Map<string, Uint8Array>
    write: ReturnType<typeof vi.fn>
}

/** A web-shaped store over a `Map`; it offers no `openWriter`. */
async function mapStore(): Promise<MapStoreHandle> {
    const { StoreInvalidKeyError } = await import('src/ts/storage/store/errors')
    const files = new Map<string, Uint8Array>()
    const write = vi.fn(async (key: string, bytes: Uint8Array) => {
        files.set(key, bytes)
        return { version: null }
    })
    const store: ByteStore = {
        capabilities: { conditionalWrites: false },
        read: async (key: string): Promise<ReadResult> => {
            if (key === '') {
                throw new StoreInvalidKeyError(key, 'a key is a non-empty string')
            }
            return { bytes: files.get(key) ?? null, version: null }
        },
        write,
        has: async (key: string) => files.has(key),
        delete: async (key) => { files.delete(key) },
        deleteMany: async (entries) => { for (const entry of entries) { files.delete(entry.key) } },
        list: async (prefix) => Array.from(files.keys()).filter((key) => key.startsWith(prefix)),
    }
    return { store, files, write }
}

function useTauri(os: 'linux' | 'windows' | 'android'): void {
    h.platform.isTauri = true
    h.platform.isNodeServer = false
    h.os = os
    const platform = os === 'windows' ? 'windows' : 'posix'
    fakeFs.setPlatform(platform)
    fakePaths.setPlatform(platform)
    fakeFs.setAppDataRoot(fakePaths.appDataDirectory(platform))
    fakeFs.directories.add('assets')
}

/** The keys under `assets/` the in-memory file system holds, temp files included. */
function assetFiles(): string[] {
    return Array.from(fakeFs.files.keys()).filter((key) => key.startsWith('assets/'))
}

function concat(chunks: WireChunk[]): Uint8Array {
    return Buffer.concat(chunks.map((chunk) => chunk.bytes))
}

beforeEach(() => {
    h.platform.isTauri = false
    h.platform.isNodeServer = false
    h.os = 'linux'
    h.keyPair = null
    fakeFs.reset()
    fakePaths.reset()
    desktop.reset()
    wire.chunks.length = 0
    wire.afterChunk = undefined
    localStorage.clear()
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

const TRANSPORTS = [
    { name: 'desktop raw chunks', os: 'linux' as const, refuseRaw: false, chunkBytes: CHUNK_MAX, command: 'write_chunk_raw' },
    { name: 'desktop base64 fallback', os: 'linux' as const, refuseRaw: true, chunkBytes: CHUNK_MAX, command: 'write_chunk' },
    { name: 'Android base64 chunks of one MiB', os: 'android' as const, refuseRaw: false, chunkBytes: WRITE_CHUNK_BYTES, command: 'write_chunk' },
]

describe('saveAsset without crypto.subtle', () => {
    test('reproducer: a plain-HTTP page gets the content-hash key, the same key crypto.subtle gives', async () => {
        const bytes = randomBytes(4096, 21)
        const { api, appStore } = await loadWorld()
        const first = await mapStore()
        appStore.injectAppStore(first.store)
        const withSubtle = await api.saveAsset(bytes)
        vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto), randomUUID: crypto.randomUUID.bind(crypto) })
        const second = await mapStore()
        appStore.injectAppStore(second.store)

        const withoutSubtle = await api.saveAsset(bytes)

        expect(withSubtle).toBe(`assets/${sha256Hex(bytes)}.png`)
        expect(withoutSubtle).toBe(withSubtle)
        expect(Array.from(second.files.get(withoutSubtle) ?? [])).toEqual(Array.from(bytes))
    })
})

describe('saveAssetFromPieces on Tauri', () => {
    test.each(TRANSPORTS)('data safety: on $name the bytes the transport received hash to the key, in pieces of at most one chunk, and the key is never visible half written', async (transport) => {
        useTauri(transport.os)
        if (transport.refuseRaw) {
            desktop.refuseRawBodies()
        }
        const bytes = randomBytes(LARGE, 5)
        const { api } = await loadWorld()
        const visible: string[][] = []
        wire.afterChunk = () => { visible.push(assetFiles()) }

        const key = await api.saveAssetFromPieces(piecesOf(bytes, PIECE_SIZES), { fileName: 'cover.webp', sizeBound: bytes.length })

        const expected = `assets/${sha256Hex(bytes)}.webp`
        expect(key).toBe(expected)
        expect(wire.chunks.every((chunk) => chunk.command === transport.command)).toBe(true)
        expect(sha256Hex(concat(wire.chunks))).toBe(sha256Hex(bytes))
        expect(Math.max(...wire.chunks.map((chunk) => chunk.bytes.length))).toBeLessThanOrEqual(transport.chunkBytes)
        expect(wire.chunks.map((chunk) => chunk.offset)).toEqual(wire.chunks.map((_, i) => wire.chunks.slice(0, i).reduce((sum, chunk) => sum + chunk.bytes.length, 0)))
        expect(wire.chunks.filter((chunk) => chunk.last)).toHaveLength(1)
        expect(wire.chunks.at(-1)?.finalKey).toBe(expected)
        expect(wire.chunks.slice(0, -1).every((chunk) => chunk.finalKey === undefined)).toBe(true)
        // Until the last chunk only the temp exists, and it is gone after it; the key is the one file left.
        expect(visible.slice(0, -1).every((files) => files.every((name) => name.includes('risu-write-')))).toBe(true)
        expect(assetFiles()).toEqual([expected])
        expect(Buffer.compare(Buffer.from(fakeFs.files.get(expected) ?? []), Buffer.from(bytes))).toBe(0)
    }, 60_000)

    test.each(TRANSPORTS)('guard: on $name the stored file and the key equal what saveAsset stores for the same bytes', async (transport) => {
        useTauri(transport.os)
        if (transport.refuseRaw) {
            desktop.refuseRawBodies()
        }
        const bytes = randomBytes(LARGE, 6)
        const { api } = await loadWorld()
        const fromPieces = await api.saveAssetFromPieces(piecesOf(bytes, PIECE_SIZES), { sizeBound: bytes.length })
        const storedFromPieces = fakeFs.files.get(fromPieces)?.slice()
        fakeFs.files.delete(fromPieces)

        const whole = await api.saveAsset(bytes)

        expect(fromPieces).toBe(whole)
        expect(Buffer.compare(Buffer.from(storedFromPieces ?? []), Buffer.from(fakeFs.files.get(whole) ?? []))).toBe(0)
    }, 60_000)

    test('new behaviour: an asset with no pieces is saved as the empty file under the digest of nothing', async () => {
        useTauri('linux')
        const { api } = await loadWorld()

        const key = await api.saveAssetFromPieces(piecesOf(new Uint8Array(0), [1]), { sizeBound: 64 * MIB })

        expect(key).toBe('assets/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.png')
        expect(assetFiles()).toEqual([key])
        expect(fakeFs.files.get(key)?.length).toBe(0)
    })

    test('new behaviour: the key is recorded as written this page load and the choke point is held while the final chunk is decided', async () => {
        useTauri('linux')
        const bytes = randomBytes(LARGE, 7)
        const { api, busy } = await loadWorld()
        const key = `assets/${sha256Hex(bytes)}.png`
        let seen: { written: string[], inFlight: number } | undefined
        wire.afterChunk = (chunk) => {
            if (chunk.last) {
                seen = { written: api.listAssetsWrittenThisPage(), inFlight: busy.chokePointInFlight('asset') }
            }
        }
        expect(busy.chokePointInFlight('asset')).toBe(0)

        await api.saveAssetFromPieces(piecesOf(bytes, PIECE_SIZES), { sizeBound: bytes.length })

        expect(seen?.written).toContain(key)
        expect(seen?.inFlight).toBe(1)
        expect(busy.chokePointInFlight('asset')).toBe(0)
    }, 60_000)

    test.each(TRANSPORTS)('data safety: on $name an existing file under the key is kept, the temp is discarded, and the key is recorded before the call that decides', async (transport) => {
        useTauri(transport.os)
        if (transport.refuseRaw) {
            desktop.refuseRawBodies()
        }
        const bytes = randomBytes(LARGE, 8)
        const key = `assets/${sha256Hex(bytes)}.png`
        const existing = Uint8Array.from([1, 2, 3])
        fakeFs.plant(key, existing)
        const { api, busy } = await loadWorld()
        let seen: { written: string[], inFlight: number, fileThen: number[] } | undefined
        wire.afterChunk = (chunk) => {
            if (chunk.last) {
                seen = { written: api.listAssetsWrittenThisPage(), inFlight: busy.chokePointInFlight('asset'), fileThen: Array.from(fakeFs.files.get(key) ?? []) }
            }
        }

        await expect(api.saveAssetFromPieces(piecesOf(bytes, PIECE_SIZES), { sizeBound: bytes.length })).resolves.toBe(key)

        expect(seen?.written).toContain(key)
        expect(seen?.inFlight).toBe(1)
        expect(seen?.fileThen).toEqual([1, 2, 3])
        expect(Array.from(fakeFs.files.get(key) ?? [])).toEqual([1, 2, 3])
        expect(assetFiles()).toEqual([key])
    }, 60_000)

    test('data safety: a source that fails mid-asset ends in AssetSourceChangedError, removes the temp and stores nothing', async () => {
        useTauri('linux')
        const bytes = randomBytes(LARGE, 9)
        const { api } = await loadWorld()
        let released = false
        async function* failing(): AsyncGenerator<Uint8Array, void, undefined> {
            try {
                yield bytes.subarray(0, 6 * MIB)
                yield bytes.subarray(6 * MIB, 9 * MIB)
                throw new Error('read failed')
            } finally {
                released = true
            }
        }

        const result = api.saveAssetFromPieces(failing(), { sizeBound: bytes.length })

        await expect(result).rejects.toBeInstanceOf(api.AssetSourceChangedError)
        await expect(result).rejects.toThrow(/read failed/)
        expect(assetFiles()).toEqual([])
        expect(desktop.count('abort_chunked')).toBeGreaterThan(0)
        expect(released).toBe(true)
    })

    test('data safety: a source that fails before its first piece stores nothing and starts no write', async () => {
        useTauri('linux')
        const { api } = await loadWorld()
        async function* failing(): AsyncGenerator<Uint8Array, void, undefined> {
            throw new Error('open failed')
        }

        await expect(api.saveAssetFromPieces(failing(), { sizeBound: 64 * MIB })).rejects.toBeInstanceOf(api.AssetSourceChangedError)

        expect(assetFiles()).toEqual([])
        expect(wire.chunks).toEqual([])
    })

    test('data safety: a source error is passed on as the typed error it already is', async () => {
        useTauri('linux')
        const { api } = await loadWorld()
        const original = new api.AssetSourceChangedError('the record header changed')
        async function* failing(): AsyncGenerator<Uint8Array, void, undefined> {
            yield new Uint8Array(5 * MIB)
            throw original
        }

        await expect(api.saveAssetFromPieces(failing(), { sizeBound: 64 * MIB })).rejects.toBe(original)
        expect(assetFiles()).toEqual([])
    })

    test('data safety: a failed check before the file takes its name ends the save as a changed source and leaves nothing under any key', async () => {
        useTauri('linux')
        const bytes = randomBytes(LARGE, 10)
        const { api } = await loadWorld()
        const key = `assets/${sha256Hex(bytes)}.png`

        await expect(api.saveAssetFromPieces(piecesOf(bytes, PIECE_SIZES), {
            sizeBound: bytes.length,
            beforeFinish: async () => { throw new Error('the file changed on disk') },
        })).rejects.toBeInstanceOf(api.AssetSourceChangedError)

        expect(assetFiles()).toEqual([])
        expect(wire.chunks.some((chunk) => chunk.last)).toBe(false)
        expect(fakeFs.files.has(key)).toBe(false)
    }, 60_000)

    test('data safety: a short read that the source reports as a failure is not stored as a shorter asset', async () => {
        useTauri('linux')
        const bytes = randomBytes(LARGE, 11)
        const { api } = await loadWorld()
        async function* short(): AsyncGenerator<Uint8Array, void, undefined> {
            yield bytes.subarray(0, 8 * MIB)
            throw new Error('the record ended 9437184 bytes early')
        }

        await expect(api.saveAssetFromPieces(short(), { sizeBound: bytes.length })).rejects.toBeInstanceOf(api.AssetSourceChangedError)

        expect(assetFiles()).toEqual([])
    })

    test('data safety: a store failure mid-asset rejects with the store error itself, removes the temp and stores nothing', async () => {
        useTauri('linux')
        const bytes = randomBytes(LARGE, 12)
        const { api } = await loadWorld()
        desktop.chunk.failWrites(({ offset }) => (offset >= 2 * CHUNK_MAX ? 'No space left on device (os error 28)' : undefined))

        const result = api.saveAssetFromPieces(piecesOf(bytes, PIECE_SIZES), { sizeBound: bytes.length })

        await expect(result).rejects.not.toBeInstanceOf(api.AssetSourceChangedError)
        await expect(result).rejects.toThrow(/No space left/)
        expect(assetFiles()).toEqual([])
    }, 60_000)

    test('reproducer: a store whose openWriter throws rejects with that error, releases the asset choke point and the source, and aborts no writer', async () => {
        useTauri('linux')
        const { api, appStore, busy } = await loadWorld()
        const { StoreInvalidKeyError } = await import('src/ts/storage/store/errors')
        const handle = await mapStore()
        const refusal = new StoreInvalidKeyError('assets/incoming', 'refused by the store')
        const openWriter = vi.fn((): never => { throw refusal })
        appStore.injectAppStore({ ...handle.store, openWriter })
        let released = false
        async function* source(): AsyncGenerator<Uint8Array, void, undefined> {
            try {
                yield new Uint8Array(5 * MIB)
            } finally {
                released = true
            }
        }
        const pieces = source()
        // The generator only runs its finally once started, so start it as the save would.
        const iterator = pieces[Symbol.asyncIterator]()
        await iterator.next()

        await expect(api.saveAssetFromPieces(pieces, { sizeBound: 64 * MIB })).rejects.toBe(refusal)

        expect(openWriter).toHaveBeenCalledTimes(1)
        expect(busy.chokePointInFlight('asset')).toBe(0)
        expect(released).toBe(true)
        expect(assetFiles()).toEqual([])
        expect(desktop.count('abort_chunked')).toBe(0)
    })

    test('guard: an asset below the threshold on Tauri is saved whole by saveAsset, with no chunk command', async () => {
        useTauri('linux')
        const bytes = randomBytes(3 * MIB, 13)
        const { api } = await loadWorld()

        const key = await api.saveAssetFromPieces(piecesOf(bytes, [MIB, 777]), { sizeBound: bytes.length })

        expect(key).toBe(`assets/${sha256Hex(bytes)}.png`)
        expect(wire.chunks).toEqual([])
        expect(Buffer.compare(Buffer.from(fakeFs.files.get(key) ?? []), Buffer.from(bytes))).toBe(0)
    })
})

describe('saveAssetFromPieces off Tauri', () => {
    test.each([['web', false], ['Node server', true]])('guard: on the %s a large asset is collected and saved whole under the key saveAsset gives, with no writer', async (_name, node) => {
        h.platform.isNodeServer = node
        const bytes = randomBytes(LARGE, 14)
        const { api, appStore } = await loadWorld()
        const handle = await mapStore()
        appStore.injectAppStore(handle.store)

        const key = await api.saveAssetFromPieces(piecesOf(bytes, PIECE_SIZES), { fileName: 'x.mp4', sizeBound: bytes.length })

        expect(key).toBe(`assets/${sha256Hex(bytes)}.mp4`)
        expect(handle.write).toHaveBeenCalledTimes(1)
        expect(Buffer.compare(Buffer.from(handle.files.get(key) ?? []), Buffer.from(bytes))).toBe(0)
        expect(wire.chunks).toEqual([])
    }, 60_000)

    test('guard: on the web the keys saveAsset gives are the SHA-256 of the bytes, whatever the size', async () => {
        const { api, appStore } = await loadWorld()
        appStore.injectAppStore((await mapStore()).store)

        for (const length of [0, 1, 4096]) {
            const bytes = randomBytes(length, length + 3)
            expect(await api.saveAsset(bytes)).toBe(`assets/${sha256Hex(bytes)}.png`)
        }
    })

    /** A web-shaped store whose piece writer (the browser's Blob accumulator) fails its `finish` with `failure`. */
    async function failingWriterStore(failure: unknown): Promise<MapStoreHandle> {
        const handle = await mapStore()
        const openWriter = vi.fn(() => ({
            write: async () => { },
            finish: async () => { throw failure },
            abort: async () => { },
        }))
        return { ...handle, store: { ...handle.store, openWriter } }
    }

    test('reproducer: a browser that cannot keep a Blob refuses a streamed asset above the whole-value bound with the message that names the file and the limit', async () => {
        const { api, appStore } = await loadWorld()
        const { StoreBlobUnsupportedError } = await import('src/ts/storage/store/errors')
        const unsupported = new StoreBlobUnsupportedError('assets/x', new DOMException('no blobs', 'DataCloneError'))
        const handle = await failingWriterStore(unsupported)
        appStore.injectAppStore(handle.store)

        const refusal = api.saveAssetFromPieces(piecesOf(randomBytes(LARGE, 61), PIECE_SIZES), { fileName: 'big.mp4', sizeBound: LARGE })

        await expect(refusal).rejects.toThrow(/^"big\.mp4" is larger than the \d+ MB this browser can store/)
        await expect(refusal).rejects.toMatchObject({ cause: unsupported })
        expect(handle.files.size).toBe(0)
    })

    test('reproducer: the same refusal without a file name (CharX, .risum) says "unnamed file"', async () => {
        const { api, appStore } = await loadWorld()
        const { StoreBlobUnsupportedError } = await import('src/ts/storage/store/errors')
        const handle = await failingWriterStore(new StoreBlobUnsupportedError('assets/x', new DOMException('no blobs', 'DataCloneError')))
        appStore.injectAppStore(handle.store)

        await expect(api.saveAssetFromPieces(piecesOf(randomBytes(LARGE, 62), PIECE_SIZES), { sizeBound: LARGE }))
            .rejects.toThrow(/^"unnamed file" is larger than the \d+ MB this browser can store/)
    })

    test('reproducer: a quota failure of the piece writer reaches the caller as the storage-full message with the browser error as its cause', async () => {
        const { api, appStore } = await loadWorld()
        const quota = new DOMException('', 'QuotaExceededError')
        const handle = await failingWriterStore(quota)
        appStore.injectAppStore(handle.store)

        const failure = api.saveAssetFromPieces(piecesOf(randomBytes(LARGE, 63), PIECE_SIZES), { fileName: 'a.mp4', sizeBound: LARGE })

        await expect(failure).rejects.toThrow(/could not be saved because your browser storage is full\./)
        await expect(failure).rejects.toBeInstanceOf(api.AssetStorageFullError)
        await expect(failure).rejects.toThrow(/^"a\.mp4" could not be saved because your browser storage is full\./)
        await expect(failure).rejects.toMatchObject({ cause: quota })
    })

    test('guard: any other failure of the piece writer reaches the caller as it is', async () => {
        const { api, appStore } = await loadWorld()
        const failure = new Error('disk failure')
        const handle = await failingWriterStore(failure)
        appStore.injectAppStore(handle.store)

        await expect(api.saveAssetFromPieces(piecesOf(randomBytes(LARGE, 63), PIECE_SIZES), { fileName: 'a.mp4', sizeBound: LARGE })).rejects.toBe(failure)
    })

    test('guard: a source error that carries a quota error stays an AssetSourceChangedError, which the importers match on', async () => {
        const { api, appStore } = await loadWorld()
        const quota = new DOMException('', 'QuotaExceededError')
        const handle = await failingWriterStore(new Error('not reached'))
        appStore.injectAppStore(handle.store)
        async function* failing(): AsyncGenerator<Uint8Array, void, undefined> {
            yield new Uint8Array(10)
            throw quota
        }

        const failure = api.saveAssetFromPieces(failing(), { fileName: 'a.mp4', sizeBound: LARGE })

        await expect(failure).rejects.toBeInstanceOf(api.AssetSourceChangedError)
        await expect(failure).rejects.not.toHaveProperty('name', 'AssetStorageFullError')
    })

    test('data safety: a source that fails while the pieces are collected stores nothing and throws the typed error', async () => {
        const { api, appStore } = await loadWorld()
        const handle = await mapStore()
        appStore.injectAppStore(handle.store)
        async function* failing(): AsyncGenerator<Uint8Array, void, undefined> {
            yield new Uint8Array(10)
            throw new Error('read failed')
        }

        await expect(api.saveAssetFromPieces(failing(), { sizeBound: 20 * MIB })).rejects.toBeInstanceOf(api.AssetSourceChangedError)

        expect(handle.files.size).toBe(0)
    })
})

interface BlobStoreHandle extends MapStoreHandle {
    /** The Blobs `writeBlob` kept, by key. */
    blobs: Map<string, Blob>
    writeBlob: ReturnType<typeof vi.fn>
    /** The keys `delete` was called with, in order. */
    deleted: string[]
}

/** What a test changes about the Blob store: the browser's copy of a File, a gate on a write, what `readBlob` shows, a failing delete. */
interface BlobStoreOptions {
    /** The Blob the store keeps for a `writeBlob` of `blob`; the default keeps `blob` itself. */
    copyOf?: (key: string, blob: Blob) => Blob
    /** Runs before a `writeBlob` stores anything; a throw is the write's failure. */
    beforeWrite?: (key: string, blob: Blob) => Promise<void> | void
    /** What `readBlob` answers for `key`, given the Blob held there. */
    readOverride?: (key: string, held: Blob | null) => Blob | null
    /** Thrown by `delete` after it was recorded. */
    deleteFailure?: unknown
}

const TEMP_KEY = /^assets\/incoming-[0-9a-f-]{36}$/

/** A web-shaped store that keeps Blobs (the browser's IndexedDB): `writeBlob` and `readBlob`, no `openWriter`. */
async function blobMapStore(writeBlobFailure?: unknown, options: BlobStoreOptions = {}): Promise<BlobStoreHandle> {
    const handle = await mapStore()
    const blobs = new Map<string, Blob>()
    const deleted: string[] = []
    const writeBlob = vi.fn(async (key: string, blob: Blob) => {
        if (writeBlobFailure !== undefined) {
            throw writeBlobFailure
        }
        await options.beforeWrite?.(key, blob)
        blobs.set(key, options.copyOf?.(key, blob) ?? blob)
        return { version: null }
    })
    const store: ByteStore = {
        ...handle.store,
        has: async (key: string) => handle.files.has(key) || blobs.has(key),
        readBlob: async (key: string) => {
            const held = blobs.get(key) ?? null
            return options.readOverride === undefined ? held : options.readOverride(key, held)
        },
        writeBlob,
        delete: async (key: string) => {
            deleted.push(key)
            if (options.deleteFailure !== undefined) {
                throw options.deleteFailure
            }
            handle.files.delete(key)
            blobs.delete(key)
        },
    }
    return { ...handle, store, blobs, writeBlob, deleted }
}

/** The bytes of a Blob. */
async function bytesOfBlob(blob: Blob | undefined): Promise<Uint8Array> {
    return new Uint8Array(await (blob ?? new Blob([])).arrayBuffer())
}

/** The copy a lazily copying browser stores for `source`: same length, one byte different, and `n` tells copies apart. */
function changedCopy(source: Blob, bytes: Uint8Array, n: number = 1): (key: string, blob: Blob) => Blob {
    return (_key, blob) => {
        if (blob !== source) {
            return blob
        }
        const changed = bytes.slice()
        changed[0] ^= n
        return new Blob([changed as Uint8Array<ArrayBuffer>])
    }
}

/** The sizes of every `Blob.arrayBuffer` call since the spy was made (a call on a slice reports the slice). */
function arrayBufferSizes(spy: { mock: { contexts: unknown[] } }): number[] {
    return spy.mock.contexts.map((context) => (context as Blob).size)
}

describe('saveAssetFromBlob on a store that keeps Blobs', () => {
    test('new behaviour: a picked file is stored under a temporary name, its stored copy is hashed in slices and stored again under the key saveAsset gives, never read whole', async () => {
        const bytes = randomBytes(450, 31)
        const { api, appStore } = await loadWorld()
        const handle = await blobMapStore()
        appStore.injectAppStore(handle.store)
        const file = new File([bytes as Uint8Array<ArrayBuffer>], 'clip.mp4')
        const reads = vi.spyOn(Blob.prototype, 'arrayBuffer')

        const key = await api.saveAssetFromBlob(file, 'clip.mp4', { minPieceBytes: 1, pieceBytes: 70 })

        expect(key).toBe(`assets/${sha256Hex(bytes)}.mp4`)
        expect(handle.writeBlob).toHaveBeenCalledTimes(2)
        expect(handle.writeBlob.mock.calls[0][0]).toMatch(TEMP_KEY)
        expect(handle.writeBlob.mock.calls[0][1]).toBe(file)
        expect(handle.writeBlob.mock.calls[1][0]).toBe(key)
        expect((handle.writeBlob.mock.calls[1][1] as Blob).size).toBe(450)
        expect(handle.deleted).toEqual([handle.writeBlob.mock.calls[0][0]])
        expect(Array.from(handle.blobs.keys())).toEqual([key])
        expect(handle.write).not.toHaveBeenCalled()
        expect(Math.max(...arrayBufferSizes(reads))).toBeLessThanOrEqual(70)
    })

    test('new behaviour: a key the store already holds is not written again; only the temporary copy is made and removed', async () => {
        const bytes = randomBytes(300, 32)
        const { api, appStore } = await loadWorld()
        const handle = await blobMapStore()
        appStore.injectAppStore(handle.store)

        await api.saveAssetFromBlob(new Blob([bytes as Uint8Array<ArrayBuffer>]), 'a.png', { minPieceBytes: 1 })
        await api.saveAssetFromBlob(new Blob([bytes as Uint8Array<ArrayBuffer>]), 'a.png', { minPieceBytes: 1 })

        expect(handle.writeBlob).toHaveBeenCalledTimes(3)
        expect(handle.writeBlob.mock.calls.filter(([key]) => !TEMP_KEY.test(key as string))).toHaveLength(1)
        expect(handle.deleted).toHaveLength(2)
        expect(handle.deleted.every((key) => TEMP_KEY.test(key))).toBe(true)
        expect(handle.blobs.size).toBe(1)
    })

    test('guard: a Blob below the threshold is saved whole by saveAsset', async () => {
        const bytes = randomBytes(300, 33)
        const { api, appStore } = await loadWorld()
        const handle = await blobMapStore()
        appStore.injectAppStore(handle.store)

        const key = await api.saveAssetFromBlob(new Blob([bytes as Uint8Array<ArrayBuffer>]), 'a.png', { minPieceBytes: 10_000 })

        expect(handle.writeBlob).not.toHaveBeenCalled()
        expect(Array.from(handle.files.get(key) ?? [])).toEqual(Array.from(bytes))
    })

    test('reproducer: a browser that cannot keep a Blob gets the bytes whole under the key of the bytes it stores, even if the file changed since the hash pass', async () => {
        const first = randomBytes(450, 34)
        const second = randomBytes(450, 35)
        const { api, appStore } = await loadWorld()
        const { StoreBlobUnsupportedError } = await import('src/ts/storage/store/errors')
        const handle = await blobMapStore(new StoreBlobUnsupportedError('assets/x', new DOMException('no blobs', 'DataCloneError')))
        appStore.injectAppStore(handle.store)
        // The slices read the first content; the whole read after the refused Blob write finds the file changed.
        const file = new File([first as Uint8Array<ArrayBuffer>], 'clip.mp4')
        vi.spyOn(file, 'arrayBuffer').mockImplementation(async () => (second as Uint8Array<ArrayBuffer>).buffer)

        const key = await api.saveAssetFromBlob(file, 'clip.mp4', { minPieceBytes: 1, pieceBytes: 70 })

        expect(key).toBe(`assets/${sha256Hex(second)}.mp4`)
        expect(Array.from(handle.files.get(key) ?? [])).toEqual(Array.from(second))
        expect(handle.files.has(`assets/${sha256Hex(first)}.mp4`)).toBe(false)
    })

    test('reproducer: a browser that cannot keep a Blob refuses a file above the whole-value bound, naming it, and stores nothing', async () => {
        const bytes = randomBytes(450, 36)
        vi.resetModules()
        vi.doMock('src/ts/storage/nodeBodyLimit', async (importOriginal) => ({ ...(await importOriginal<typeof import('src/ts/storage/nodeBodyLimit')>()), WEB_ASSET_LIMIT_BYTES: 400 }))
        try {
            const { StoreBlobUnsupportedError } = await import('src/ts/storage/store/errors')
            const api = await import('src/ts/globalApi.svelte')
            const appStore = await import('src/ts/storage/store/appStore')
            const handle = await blobMapStore(new StoreBlobUnsupportedError('assets/x', new DOMException('no blobs', 'DataCloneError')))
            appStore.injectAppStore(handle.store)

            await expect(api.saveAssetFromBlob(new Blob([bytes as Uint8Array<ArrayBuffer>]), 'big.mp4', { minPieceBytes: 1 })).rejects.toThrow(/"big\.mp4" is larger than the \d+ MB this browser can store/)

            expect(handle.files.size).toBe(0)
            expect(handle.blobs.size).toBe(0)
        } finally {
            vi.doUnmock('src/ts/storage/nodeBodyLimit')
        }
    })

    test('reproducer: the refusal of a file saved without a name says "unnamed file", not an empty pair of quotes', async () => {
        const bytes = randomBytes(450, 38)
        vi.resetModules()
        vi.doMock('src/ts/storage/nodeBodyLimit', async (importOriginal) => ({ ...(await importOriginal<typeof import('src/ts/storage/nodeBodyLimit')>()), WEB_ASSET_LIMIT_BYTES: 400 }))
        try {
            const { StoreBlobUnsupportedError } = await import('src/ts/storage/store/errors')
            const api = await import('src/ts/globalApi.svelte')
            const appStore = await import('src/ts/storage/store/appStore')
            const handle = await blobMapStore(new StoreBlobUnsupportedError('assets/x', new DOMException('no blobs', 'DataCloneError')))
            appStore.injectAppStore(handle.store)

            await expect(api.saveAssetFromBlob(new Blob([bytes as Uint8Array<ArrayBuffer>]), undefined, { minPieceBytes: 1 })).rejects.toThrow(/^"unnamed file" is larger than the \d+ MB this browser can store/)

            expect(handle.files.size).toBe(0)
        } finally {
            vi.doUnmock('src/ts/storage/nodeBodyLimit')
        }
    })

    test('reproducer: a quota failure of the Blob write reaches the caller as the storage-full message with the browser error as its cause, and falls back to nothing', async () => {
        const bytes = randomBytes(450, 37)
        const quota = new DOMException('', 'QuotaExceededError')
        const { api, appStore } = await loadWorld()
        const handle = await blobMapStore(quota)
        appStore.injectAppStore(handle.store)

        const failure = api.saveAssetFromBlob(new Blob([bytes as Uint8Array<ArrayBuffer>]), 'a.png', { minPieceBytes: 1 })

        await expect(failure).rejects.toThrow(/could not be saved because your browser storage is full\./)
        await expect(failure).rejects.toBeInstanceOf(api.AssetStorageFullError)
        await expect(failure).rejects.toThrow(/^"a\.png" could not be saved because your browser storage is full\./)
        await expect(failure).rejects.toMatchObject({ cause: quota })
        expect(handle.write).not.toHaveBeenCalled()
        expect(handle.files.size).toBe(0)
    })

    test('guard: a failure that is neither the missing Blob capability nor a quota error reaches the caller as it is and falls back to nothing', async () => {
        const bytes = randomBytes(450, 37)
        const failure = new Error('disk failure')
        const { api, appStore } = await loadWorld()
        const handle = await blobMapStore(failure)
        appStore.injectAppStore(handle.store)

        await expect(api.saveAssetFromBlob(new Blob([bytes as Uint8Array<ArrayBuffer>]), 'a.png', { minPieceBytes: 1 })).rejects.toBe(failure)

        expect(handle.write).not.toHaveBeenCalled()
        expect(handle.files.size).toBe(0)
    })

    test('guard: a store that offers openWriter without readBlob (Tauri, Node) still takes the piece writer', async () => {
        const bytes = randomBytes(450, 38)
        const { api, appStore } = await loadWorld()
        const handle = await mapStore()
        const parts: Uint8Array[] = []
        const writeBlob = vi.fn(async () => ({ version: null }))
        const openWriter = vi.fn(() => ({
            write: async (data: Uint8Array) => { parts.push(data.slice()) },
            finish: async (finalKey?: string) => { handle.files.set(finalKey ?? '', Buffer.concat(parts)) },
            abort: async () => { },
        }))
        appStore.injectAppStore({ ...handle.store, openWriter, writeBlob })

        const key = await api.saveAssetFromBlob(new Blob([bytes as Uint8Array<ArrayBuffer>]), 'clip.mp4', { minPieceBytes: 1, pieceBytes: 70 })

        expect(openWriter).toHaveBeenCalledTimes(1)
        expect(writeBlob).not.toHaveBeenCalled()
        expect(key).toBe(`assets/${sha256Hex(bytes)}.mp4`)
        expect(Array.from(handle.files.get(key) ?? [])).toEqual(Array.from(bytes))
    })
})

describe('an inlay body Blob on a store that cannot keep a Blob', () => {
    test('reproducer: a body within the whole-value bound is stored as bytes; one above it is refused with the store error', async () => {
        vi.resetModules()
        vi.doMock('src/ts/storage/nodeBodyLimit', async (importOriginal) => ({ ...(await importOriginal<typeof import('src/ts/storage/nodeBodyLimit')>()), WEB_ASSET_LIMIT_BYTES: 400 }))
        try {
            const { StoreBlobUnsupportedError } = await import('src/ts/storage/store/errors')
            const unsupported = new StoreBlobUnsupportedError('inlays/b-x', new DOMException('no blobs', 'DataCloneError'))
            const inlays = await import('src/ts/process/files/inlayStore')
            const handle = await blobMapStore(unsupported)
            const small = randomBytes(300, 41)

            const smallInlay: InlayAsset = { data: new Blob([small as Uint8Array<ArrayBuffer>], { type: 'video/mp4' }), ext: 'mp4', name: 'clip.mp4', type: 'video' }
            const bigInlay: InlayAsset = { data: new Blob([randomBytes(450, 42) as Uint8Array<ArrayBuffer>], { type: 'video/mp4' }), ext: 'mp4', name: 'big.mp4', type: 'video' }

            await inlays.writeAppInlay(handle.store, 'clip', smallInlay)

            const record = await inlays.readAppInlayRecord(handle.store, 'clip')
            expect(record?.len).toBe(300)
            expect(Array.from(handle.files.get(record!.body) ?? [])).toEqual(Array.from(small))
            const refusal = inlays.writeAppInlay(handle.store, 'big', bigInlay)
            await expect(refusal).rejects.toThrow(/^"big\.mp4" is larger than the \d+ MB this browser can store/)
            await expect(refusal).rejects.toMatchObject({ cause: unsupported })
            expect(await inlays.readAppInlayRecord(handle.store, 'big')).toBeNull()
        } finally {
            vi.doUnmock('src/ts/storage/nodeBodyLimit')
        }
    })
})

describe('saveAssetFromBlob names the bytes the store holds', () => {
    const SLICED = { minPieceBytes: 1, pieceBytes: 70 }
    const quotaError = () => new DOMException('', 'QuotaExceededError')

    /** The `assets/` keys of the store, Blobs and bytes together. */
    function assetKeysOf(handle: BlobStoreHandle): string[] {
        return [...Array.from(handle.blobs.keys()), ...Array.from(handle.files.keys())].filter((key) => key.startsWith('assets/'))
    }

    test('reproducer: when the browser stores a different copy of the picked file, the returned key is the hash of the stored bytes and no temporary key remains', async () => {
        const bytes = randomBytes(450, 51)
        const { api, appStore } = await loadWorld()
        const file = new File([bytes as Uint8Array<ArrayBuffer>], 'clip.mp4')
        const handle = await blobMapStore(undefined, { copyOf: changedCopy(file, bytes) })
        appStore.injectAppStore(handle.store)

        const key = await api.saveAssetFromBlob(file, 'clip.mp4', SLICED)

        const stored = await bytesOfBlob(handle.blobs.get(key))
        expect(stored.length).toBe(450)
        expect(Array.from(stored)).not.toEqual(Array.from(bytes))
        expect(key).toBe(`assets/${sha256Hex(stored)}.mp4`)
        expect(assetKeysOf(handle)).toEqual([key])
    })

    test('guard: a faithful store gives the hash of the file as the key and leaves no temporary key (passes before and after)', async () => {
        const bytes = randomBytes(450, 52)
        const { api, appStore } = await loadWorld()
        const handle = await blobMapStore()
        appStore.injectAppStore(handle.store)

        const key = await api.saveAssetFromBlob(new File([bytes as Uint8Array<ArrayBuffer>], 'clip.mp4'), 'clip.mp4', SLICED)

        expect(key).toBe(`assets/${sha256Hex(bytes)}.mp4`)
        expect(Array.from(await bytesOfBlob(handle.blobs.get(key)))).toEqual(Array.from(bytes))
        expect(assetKeysOf(handle)).toEqual([key])
    })

    test('new behaviour: a final key the store already holds is left untouched and only the temporary key is deleted', async () => {
        const bytes = randomBytes(450, 53)
        const { api, appStore } = await loadWorld()
        const handle = await blobMapStore()
        appStore.injectAppStore(handle.store)
        const key = `assets/${sha256Hex(bytes)}.mp4`
        const existing = new Blob([bytes as Uint8Array<ArrayBuffer>])
        handle.blobs.set(key, existing)

        const returned = await api.saveAssetFromBlob(new File([bytes as Uint8Array<ArrayBuffer>], 'clip.mp4'), 'clip.mp4', SLICED)

        expect(returned).toBe(key)
        expect(handle.blobs.get(key)).toBe(existing)
        expect(handle.deleted).toHaveLength(1)
        expect(handle.deleted.every((deletedKey) => TEMP_KEY.test(deletedKey))).toBe(true)
        expect(assetKeysOf(handle)).toEqual([key])
    })

    test('new behaviour: a temporary copy that has vanished ends the save in a readable sentence, with no key returned and nothing under a content key', async () => {
        const bytes = randomBytes(450, 54)
        const { api, appStore } = await loadWorld()
        const handle = await blobMapStore(undefined, { readOverride: (key, held) => TEMP_KEY.test(key) ? null : held })
        appStore.injectAppStore(handle.store)

        const failure = api.saveAssetFromBlob(new File([bytes as Uint8Array<ArrayBuffer>], 'clip.mp4'), 'clip.mp4', SLICED)

        await expect(failure).rejects.toThrow(/^"clip\.mp4" was not saved: its temporary copy was removed by another tab of this app\. Try again\.$/)
        expect(handle.writeBlob).toHaveBeenCalledTimes(1)
        expect(handle.deleted).toHaveLength(1)
        expect(assetKeysOf(handle)).toEqual([])
    })

    test('reproducer: a quota failure on the temporary write is the storage-full message, with the browser error as its cause and nothing stored', async () => {
        const bytes = randomBytes(450, 55)
        const quota = quotaError()
        const { api, appStore } = await loadWorld()
        const handle = await blobMapStore(quota)
        appStore.injectAppStore(handle.store)

        const failure = api.saveAssetFromBlob(new File([bytes as Uint8Array<ArrayBuffer>], 'clip.mp4'), 'clip.mp4', SLICED)

        await expect(failure).rejects.toThrow(/could not be saved because your browser storage is full\./)
        await expect(failure).rejects.toBeInstanceOf(api.AssetStorageFullError)
        await expect(failure).rejects.toMatchObject({ cause: quota })
        expect(assetKeysOf(handle)).toEqual([])
    })

    test('reproducer: a quota failure on the final write deletes the temporary key and leaves earlier keys alone', async () => {
        const bytes = randomBytes(450, 56)
        const quota = quotaError()
        const { api, appStore } = await loadWorld()
        const handle = await blobMapStore(undefined, {
            beforeWrite: (key) => {
                if (!TEMP_KEY.test(key)) {
                    throw quota
                }
            },
        })
        appStore.injectAppStore(handle.store)
        const earlier = new Blob([randomBytes(10, 57) as Uint8Array<ArrayBuffer>])
        handle.blobs.set('assets/earlier.png', earlier)

        const failure = api.saveAssetFromBlob(new File([bytes as Uint8Array<ArrayBuffer>], 'clip.mp4'), 'clip.mp4', SLICED)

        await expect(failure).rejects.toThrow(/could not be saved because your browser storage is full\./)
        await expect(failure).rejects.toBeInstanceOf(api.AssetStorageFullError)
        await expect(failure).rejects.toMatchObject({ cause: quota })
        expect(assetKeysOf(handle)).toEqual(['assets/earlier.png'])
        expect(handle.blobs.get('assets/earlier.png')).toBe(earlier)
    })

    test('new behaviour: a stored copy whose size differs from the picked file ends the save as AssetSourceChangedError and nothing is kept', async () => {
        const bytes = randomBytes(450, 58)
        const { api, appStore } = await loadWorld()
        const file = new File([bytes as Uint8Array<ArrayBuffer>], 'clip.mp4')
        const handle = await blobMapStore(undefined, { copyOf: (_key, blob) => blob === file ? new Blob([bytes.slice(0, 400) as Uint8Array<ArrayBuffer>]) : blob })
        appStore.injectAppStore(handle.store)

        await expect(api.saveAssetFromBlob(file, 'clip.mp4', SLICED)).rejects.toBeInstanceOf(api.AssetSourceChangedError)

        expect(handle.writeBlob).toHaveBeenCalledTimes(1)
        expect(assetKeysOf(handle)).toEqual([])
    })

    test('new behaviour: a final value that is read back with another size is deleted by the save that wrote it, and the save fails', async () => {
        const bytes = randomBytes(450, 59)
        const { api, appStore } = await loadWorld()
        const handle = await blobMapStore(undefined, { readOverride: (key, held) => !TEMP_KEY.test(key) && held !== null ? held.slice(0, held.size - 1) : held })
        appStore.injectAppStore(handle.store)

        await expect(api.saveAssetFromBlob(new File([bytes as Uint8Array<ArrayBuffer>], 'clip.mp4'), 'clip.mp4', SLICED)).rejects.toBeInstanceOf(api.AssetSourceChangedError)

        expect(assetKeysOf(handle)).toEqual([])
        expect(handle.deleted.some((key) => !TEMP_KEY.test(key))).toBe(true)
    })

    test('guard: a size that is wrong once and right on the second look keeps the final value', async () => {
        const bytes = randomBytes(450, 60)
        const { api, appStore } = await loadWorld()
        let finalReads = 0
        const handle = await blobMapStore(undefined, {
            readOverride: (key, held) => {
                if (TEMP_KEY.test(key) || held === null) {
                    return held
                }
                finalReads += 1
                return finalReads === 1 ? held.slice(0, held.size - 1) : held
            },
        })
        appStore.injectAppStore(handle.store)

        const key = await api.saveAssetFromBlob(new File([bytes as Uint8Array<ArrayBuffer>], 'clip.mp4'), 'clip.mp4', SLICED)

        expect(key).toBe(`assets/${sha256Hex(bytes)}.mp4`)
        expect(assetKeysOf(handle)).toEqual([key])
    })

    test('new behaviour: a failing delete of the temporary key is logged and the save still returns the correct final key', async () => {
        const bytes = randomBytes(450, 61)
        const failure = new Error('delete failed')
        const { api, appStore } = await loadWorld()
        const handle = await blobMapStore(undefined, { deleteFailure: failure })
        appStore.injectAppStore(handle.store)
        const logged = vi.spyOn(console, 'error').mockImplementation(() => { })

        const key = await api.saveAssetFromBlob(new File([bytes as Uint8Array<ArrayBuffer>], 'clip.mp4'), 'clip.mp4', SLICED)

        expect(key).toBe(`assets/${sha256Hex(bytes)}.mp4`)
        expect(Array.from(await bytesOfBlob(handle.blobs.get(key)))).toEqual(Array.from(bytes))
        expect(logged).toHaveBeenCalledWith(failure)
    })

    test('guard: two saves of the same changing file at once each return a key that holds bytes hashing to it, and only temporary keys are deleted', async () => {
        const bytes = randomBytes(450, 62)
        const { api, appStore } = await loadWorld()
        const file = new File([bytes as Uint8Array<ArrayBuffer>], 'clip.mp4')
        let copies = 0
        let finalWrites = 0
        let release: () => void = () => { }
        const bothTemporaryCopiesDone = new Promise<void>((resolve) => { release = resolve })
        const handle = await blobMapStore(undefined, {
            copyOf: (_key, blob) => {
                if (blob !== file) {
                    return blob
                }
                copies += 1
                return changedCopy(file, bytes, copies)(_key, blob)
            },
            beforeWrite: async (key) => {
                if (!TEMP_KEY.test(key)) {
                    finalWrites += 1
                    if (finalWrites === 2) {
                        release()
                    }
                    await bothTemporaryCopiesDone
                }
            },
        })
        appStore.injectAppStore(handle.store)

        const [first, second] = await Promise.all([
            api.saveAssetFromBlob(file, 'clip.mp4', SLICED),
            api.saveAssetFromBlob(file, 'clip.mp4', SLICED),
        ])

        expect(first).not.toBe(second)
        for (const key of [first, second]) {
            expect(key).toBe(`assets/${sha256Hex(await bytesOfBlob(handle.blobs.get(key)))}.mp4`)
        }
        expect(assetKeysOf(handle).sort()).toEqual([first, second].sort())
        expect(handle.deleted.every((key) => TEMP_KEY.test(key))).toBe(true)
    })

    test('guard: the whole save, temporary copy and read-back included, reads at most one slice at a time', async () => {
        const bytes = randomBytes(450, 63)
        const { api, appStore } = await loadWorld()
        const file = new File([bytes as Uint8Array<ArrayBuffer>], 'clip.mp4')
        const handle = await blobMapStore(undefined, { copyOf: changedCopy(file, bytes) })
        appStore.injectAppStore(handle.store)
        const reads = vi.spyOn(Blob.prototype, 'arrayBuffer')

        await api.saveAssetFromBlob(file, 'clip.mp4', SLICED)

        expect(reads).toHaveBeenCalled()
        expect(Math.max(...arrayBufferSizes(reads))).toBeLessThanOrEqual(70)
    })

    test('new behaviour: a final write that fails as StoreBlobUnsupportedError rejects, deletes the temporary key and does not fall back to a whole read', async () => {
        const bytes = randomBytes(450, 64)
        const { api, appStore } = await loadWorld()
        const { StoreBlobUnsupportedError } = await import('src/ts/storage/store/errors')
        const unsupported = new StoreBlobUnsupportedError('assets/x', new DOMException('unknown', 'UnknownError'))
        const handle = await blobMapStore(undefined, {
            beforeWrite: (key) => {
                if (!TEMP_KEY.test(key)) {
                    throw unsupported
                }
            },
        })
        appStore.injectAppStore(handle.store)
        const reads = vi.spyOn(Blob.prototype, 'arrayBuffer')

        await expect(api.saveAssetFromBlob(new File([bytes as Uint8Array<ArrayBuffer>], 'clip.mp4'), 'clip.mp4', SLICED)).rejects.toBe(unsupported)

        expect(assetKeysOf(handle)).toEqual([])
        expect(handle.write).not.toHaveBeenCalled()
        expect(Math.max(...arrayBufferSizes(reads))).toBeLessThanOrEqual(70)
    })

    test('guard: a Blob below the threshold creates no temporary key', async () => {
        const bytes = randomBytes(300, 65)
        const { api, appStore } = await loadWorld()
        const handle = await blobMapStore()
        appStore.injectAppStore(handle.store)

        await api.saveAssetFromBlob(new Blob([bytes as Uint8Array<ArrayBuffer>]), 'a.png', { minPieceBytes: 10_000 })

        expect(handle.writeBlob).not.toHaveBeenCalled()
        expect(handle.blobs.size).toBe(0)
        expect(handle.deleted).toEqual([])
    })

    test('reproducer: a browser that keeps no Blob saves the bytes whole and a quota failure there is one storage-full error whose cause is the browser error itself', async () => {
        const bytes = randomBytes(450, 66)
        const quota = quotaError()
        const { api, appStore } = await loadWorld()
        const { StoreBlobUnsupportedError } = await import('src/ts/storage/store/errors')
        const handle = await blobMapStore(new StoreBlobUnsupportedError('assets/x', new DOMException('no blobs', 'DataCloneError')))
        appStore.injectAppStore(handle.store)
        handle.write.mockRejectedValueOnce(quota)

        const failure = api.saveAssetFromBlob(new File([bytes as Uint8Array<ArrayBuffer>], 'clip.mp4'), 'clip.mp4', SLICED)

        await expect(failure).rejects.toThrow(/could not be saved because your browser storage is full\./)
        await expect(failure).rejects.toBeInstanceOf(api.AssetStorageFullError)
        await expect(failure).rejects.toThrow(/^"clip\.mp4" could not be saved/)
        await expect(failure).rejects.toMatchObject({ cause: quota })
    })

    test('reproducer: saveAsset turns an empty quota error into the storage-full message and names the file only when it has an extension', async () => {
        const bytes = randomBytes(40, 67)
        const quota = quotaError()
        const { api, appStore } = await loadWorld()
        const handle = await mapStore()
        appStore.injectAppStore(handle.store)
        handle.write.mockRejectedValue(quota)

        const named = api.saveAsset(bytes, '', 'a.png')
        const extensionOnly = api.saveAsset(bytes, '', 'png')
        const unnamed = api.saveAsset(bytes)

        // All three rejections get a handler before the first await, so none is unhandled while another is awaited.
        const settled = await Promise.allSettled([named, extensionOnly, unnamed])

        expect(settled.map((entry) => entry.status)).toEqual(['rejected', 'rejected', 'rejected'])
        const [namedReason, extensionOnlyReason, unnamedReason] = settled.map((entry) => (entry as PromiseRejectedResult).reason)
        expect(namedReason).toBeInstanceOf(Error)
        expect(namedReason.message).toMatch(/^"a\.png" could not be saved because your browser storage is full\./)
        expect(namedReason).toMatchObject({ cause: quota })
        expect(extensionOnlyReason.message).toMatch(/^"unnamed file" could not be saved/)
        expect(unnamedReason.message).toMatch(/^"unnamed file" could not be saved/)
    })

    test('guard: saveAsset passes a failure that is not a quota error through as it is', async () => {
        const failure = new Error('disk failure')
        const { api, appStore } = await loadWorld()
        const handle = await mapStore()
        appStore.injectAppStore(handle.store)
        handle.write.mockRejectedValue(failure)

        await expect(api.saveAsset(randomBytes(40, 68), '', 'a.png')).rejects.toBe(failure)
    })

    test('reproducer: a small picked File with an extension-only file name shows the name of the File', async () => {
        const quota = quotaError()
        const { api, appStore } = await loadWorld()
        const handle = await blobMapStore()
        appStore.injectAppStore(handle.store)
        handle.write.mockRejectedValue(quota)

        await expect(api.saveAssetFromBlob(new File([randomBytes(40, 69) as Uint8Array<ArrayBuffer>], 'pic.png'), 'png', { minPieceBytes: 10_000 }))
            .rejects.toThrow(/^"pic\.png" could not be saved/)
    })
})

describe('saveAssetFromBlob judges the final key by the value it holds', () => {
    const SLICED = { minPieceBytes: 1, pieceBytes: 70 }

    interface SingleValueHandle {
        store: ByteStore
        /** One value per key, as IndexedDB keeps it: bytes from `write`, a Blob from `writeBlob`. */
        values: Map<string, Uint8Array | Blob>
        deleted: string[]
    }

    /** A store with `readBlob` and `readValue` over one value per key; `afterFinalWrite` runs right after the Blob save wrote the content key. */
    function singleValueStore(afterFinalWrite: (key: string, values: Map<string, Uint8Array | Blob>) => Promise<void> | void): SingleValueHandle {
        const values = new Map<string, Uint8Array | Blob>()
        const deleted: string[] = []
        const store: ByteStore = {
            capabilities: { conditionalWrites: false },
            read: async (key: string): Promise<ReadResult> => {
                const held = values.get(key)
                return { bytes: held === undefined ? null : held instanceof Blob ? new Uint8Array(await held.arrayBuffer()) : held, version: null }
            },
            write: async (key: string, data: Uint8Array) => { values.set(key, data.slice()); return { version: null } },
            writeBlob: async (key: string, blob: Blob) => {
                values.set(key, blob.slice(0, blob.size))
                if (!TEMP_KEY.test(key)) {
                    await afterFinalWrite(key, values)
                }
                return { version: null }
            },
            readBlob: async (key: string) => {
                const held = values.get(key)
                return held instanceof Blob ? held : null
            },
            readValue: async (key: string) => values.get(key) ?? null,
            has: async (key: string) => values.has(key),
            delete: async (key: string) => { deleted.push(key); values.delete(key) },
            deleteMany: async (entries) => { for (const entry of entries) { values.delete(entry.key) } },
            list: async (prefix: string) => Array.from(values.keys()).filter((key) => key.startsWith(prefix)),
        }
        return { store, values, deleted }
    }

    test('reproducer: a saveAsset of the same bytes that lands after the final write keeps its key and its bytes', async () => {
        const bytes = randomBytes(450, 91)
        const { api, appStore } = await loadWorld()
        let otherKey = ''
        // A same-content save replaces the Blob with bytes; it lands before the first read of the content key.
        const handle = singleValueStore(() => { })
        let landed = false
        const land = async (key: string) => {
            if (!landed && !TEMP_KEY.test(key)) {
                landed = true
                otherKey = await api.saveAsset(bytes, '', 'clip.mp4')
            }
        }
        const inner = handle.store
        appStore.injectAppStore({
            ...inner,
            readBlob: async (key: string) => { await land(key); return inner.readBlob!(key) },
            readValue: async (key: string) => { await land(key); return inner.readValue!(key) },
        })

        const outcome = await api.saveAssetFromBlob(new File([bytes as Uint8Array<ArrayBuffer>], 'clip.mp4'), 'clip.mp4', SLICED).then((key) => ({ key }), (error: unknown) => ({ error }))

        expect(otherKey).toBe(`assets/${sha256Hex(bytes)}.mp4`)
        expect(handle.values.has(otherKey)).toBe(true)
        const held = handle.values.get(otherKey)
        expect(Array.from(held instanceof Blob ? await bytesOfBlob(held) : held ?? [])).toEqual(Array.from(bytes))
        expect(outcome).toEqual({ key: otherKey })
        expect(handle.deleted.every((key) => TEMP_KEY.test(key))).toBe(true)
    })

    test('reproducer: a final key that is absent after the write ends the save as AssetSourceChangedError and deletes nothing but the temporary key', async () => {
        const bytes = randomBytes(450, 92)
        const { api, appStore } = await loadWorld()
        const handle = singleValueStore((key, values) => { values.delete(key) })
        appStore.injectAppStore(handle.store)

        await expect(api.saveAssetFromBlob(new File([bytes as Uint8Array<ArrayBuffer>], 'clip.mp4'), 'clip.mp4', SLICED)).rejects.toBeInstanceOf(api.AssetSourceChangedError)

        expect(handle.deleted).toHaveLength(1)
        expect(handle.deleted.every((key) => TEMP_KEY.test(key))).toBe(true)
    })

    test('guard: a Blob of the wrong size under the final key is deleted and the save fails', async () => {
        const bytes = randomBytes(450, 93)
        const { api, appStore } = await loadWorld()
        const handle = singleValueStore((key, values) => { values.set(key, new Blob([bytes.slice(0, 449) as Uint8Array<ArrayBuffer>])) })
        appStore.injectAppStore(handle.store)

        await expect(api.saveAssetFromBlob(new File([bytes as Uint8Array<ArrayBuffer>], 'clip.mp4'), 'clip.mp4', SLICED)).rejects.toBeInstanceOf(api.AssetSourceChangedError)

        expect(handle.deleted.some((key) => !TEMP_KEY.test(key))).toBe(true)
        expect(Array.from(handle.values.keys())).toEqual([])
    })

    test('reproducer: bytes of the wrong size under the final key belong to another writer, so the save fails and keeps them', async () => {
        const bytes = randomBytes(450, 94)
        const { api, appStore } = await loadWorld()
        const handle = singleValueStore((key, values) => { values.set(key, bytes.slice(0, 449)) })
        appStore.injectAppStore(handle.store)

        await expect(api.saveAssetFromBlob(new File([bytes as Uint8Array<ArrayBuffer>], 'clip.mp4'), 'clip.mp4', SLICED)).rejects.toBeInstanceOf(api.AssetSourceChangedError)

        expect(handle.deleted.every((key) => TEMP_KEY.test(key))).toBe(true)
        expect(Array.from(handle.values.keys())).toEqual([`assets/${sha256Hex(bytes)}.mp4`])
    })
})

describe('saveAssetFromBlob refuses a file above the store asset limit before reading it', () => {
    const GIB = 1024 * MIB

    /** A File that reports `size` bytes without holding them; any read of it fails the test. */
    function fileReporting(name: string, size: number): { file: File, slice: ReturnType<typeof vi.fn>, arrayBuffer: ReturnType<typeof vi.fn> } {
        const file = new File([Uint8Array.of(1)], name)
        const slice = vi.fn(() => { throw new Error('a file above the limit must not be sliced') })
        const arrayBuffer = vi.fn(async () => { throw new Error('a file above the limit must not be read') })
        Object.defineProperty(file, 'size', { value: size })
        Object.defineProperty(file, 'slice', { value: slice })
        Object.defineProperty(file, 'arrayBuffer', { value: arrayBuffer })
        return { file, slice, arrayBuffer }
    }

    async function refusalOf(promise: Promise<string>): Promise<{ names: readonly string[], limitBytes: number, message: string }> {
        const { AssetTooLargeError } = await import('src/ts/storage/pickedAssetLimit')
        const error = await promise.then(() => null, (reason: unknown) => reason)
        expect(error).toBeInstanceOf(AssetTooLargeError)
        const refusal = error as InstanceType<typeof AssetTooLargeError>
        return { names: refusal.fileNames, limitBytes: refusal.limitBytes, message: refusal.message }
    }

    test.each([
        ['tauri', 'tauri' as const, GIB],
        ['indexeddb', 'indexeddb' as const, GIB],
        ['opfs-transitional', 'opfs-transitional' as const, 200 * MIB],
    ])('regression reproducer: on %s a file one byte above the limit is refused with its name and never sliced or read', async (_label, kind, limit) => {
        const { api, appStore } = await loadWorld()
        const handle = await mapStore()
        appStore.injectAppStore(handle.store, kind)
        const big = fileReporting('clip.mp4', limit + 1)

        const refusal = await refusalOf(api.saveAssetFromBlob(big.file, 'mp4'))

        expect(refusal.names).toEqual(['clip.mp4'])
        expect(refusal.limitBytes).toBe(limit)
        expect(big.slice).not.toHaveBeenCalled()
        expect(big.arrayBuffer).not.toHaveBeenCalled()
        expect(handle.files.size).toBe(0)
        expect(handle.write).not.toHaveBeenCalled()
    })

    test('regression reproducer: on the browser IndexedDB store that keeps Blobs a file above the limit is refused before the Blob is handed to the store, sliced or read', async () => {
        const { api, appStore } = await loadWorld()
        const handle = await blobMapStore()
        appStore.injectAppStore(handle.store, 'indexeddb')
        const big = fileReporting('clip.mp4', GIB + 1)

        const refusal = await refusalOf(api.saveAssetFromBlob(big.file, 'mp4'))

        expect(refusal.names).toEqual(['clip.mp4'])
        expect(refusal.limitBytes).toBe(GIB)
        expect(handle.writeBlob).not.toHaveBeenCalled()
        expect(big.slice).not.toHaveBeenCalled()
        expect(big.arrayBuffer).not.toHaveBeenCalled()
        expect(handle.blobs.size).toBe(0)
    })

    test('the refusal message is the translated notice with the limit in MB', async () => {
        const { api, appStore } = await loadWorld()
        appStore.injectAppStore((await mapStore()).store, 'tauri')

        const refusal = await refusalOf(api.saveAssetFromBlob(fileReporting('a.mp4', GIB + 1).file))

        expect(refusal.message).toBe('"a.mp4" is larger than the 1024 MB limit, so it was not added.')
    })

    test('boundary: a file of exactly the limit is not refused, one byte more is', async () => {
        const { api, appStore } = await loadWorld()
        const handle = await mapStore()
        // Past the guard the save reaches the store's writer, which stops the test there.
        appStore.injectAppStore({ ...handle.store, openWriter: () => { throw new Error('reached the writer') } }, 'opfs-transitional')

        await expect(api.saveAssetFromBlob(fileReporting('exact.mp4', 200 * MIB).file)).rejects.toThrow('reached the writer')
        await refusalOf(api.saveAssetFromBlob(fileReporting('over.mp4', 200 * MIB + 1).file))
    })

    test('guard (passes without the limit too; mutant M13 is its failing evidence): a Node page whose pieces are not yet recorded probes first, so a 150 MiB file is accepted', async () => {
        const { api, appStore } = await loadWorld()
        const handle = await mapStore()
        let recorded = false
        const probe = vi.fn(async () => { recorded = true })
        appStore.injectAppStore({
            ...handle.store,
            openWriter: () => { throw new Error('reached the writer') },
            piecesRecorded: () => recorded,
            guarded: { probe } as never,
        }, 'node')

        await expect(api.saveAssetFromBlob(fileReporting('mid.mp4', 150 * MIB).file)).rejects.toThrow('reached the writer')

        expect(probe).toHaveBeenCalledTimes(1)
        expect(await api.pickedAssetLimitBytes()).toBe(GIB)
    })

    test('a Node page whose probe fails keeps the 100 MiB body limit and refuses a 150 MiB file', async () => {
        const { api, appStore } = await loadWorld()
        const handle = await mapStore()
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        appStore.injectAppStore({
            ...handle.store,
            openWriter: () => { throw new Error('reached the writer') },
            piecesRecorded: () => false,
            guarded: { probe: async () => { throw new Error('no server') } } as never,
        }, 'node')

        const refusal = await refusalOf(api.saveAssetFromBlob(fileReporting('mid.mp4', 150 * MIB).file))

        expect(refusal.limitBytes).toBe(100 * MIB)
    })

    test('guard: a file within the limit is saved as before', async () => {
        const bytes = randomBytes(300, 7)
        const { api, appStore } = await loadWorld()
        const handle = await mapStore()
        appStore.injectAppStore(handle.store, 'opfs-transitional')

        const key = await api.saveAssetFromBlob(new Blob([bytes as Uint8Array<ArrayBuffer>]), 'a.png')

        expect(key).toBe(`assets/${sha256Hex(bytes)}.png`)
    })
})
