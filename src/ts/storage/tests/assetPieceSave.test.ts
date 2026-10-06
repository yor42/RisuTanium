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
