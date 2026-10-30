// @vitest-environment node
/**
 * CharX import in pieces (`CharXImporter` in `src/ts/process/processzip.ts`). An asset entry
 * that passes `charxLimits.streamAfterBytes` while it streams in is no longer collected whole:
 * it goes through `saveAssetFromPieces` fed by a queue, on every store that writes in pieces
 * (the desktop files store over the in-memory file system of `tauriFsFake.ts`, and the Node
 * store over the real `server/node/server.cjs` with small limits). The fixtures are written by
 * `fflateZipArchive` (`zipFixtures.ts`), whose streaming `Zip` states no entry size in the local
 * header (data descriptors), so the importer cannot decide from a header. A pass here says nothing about the
 * Rust commands or a real proxy.
 *
 * Titles say what a test pins: `reproducer` fails on the commit before the change (every
 * entry was taken whole by `EntryBuffer.take()`), `data safety` pins what must never be stored,
 * `guard` holds before and after.
 */
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { writable } from 'svelte/store'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

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
    os: 'linux' as 'linux' | 'windows' | 'android',
    keyPair: null as CryptoKeyPair | null,
}))

const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))
const fakePaths = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriPathFake')).createFakeTauriPaths())
const desktop = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriDesktopFake')).createDesktopInvoke(fakeFs))

interface WireChunk {
    key: string
    finalKey: string | undefined
    last: boolean
    length: number
}

const wire = vi.hoisted(() => ({ chunks: [] as WireChunk[] }))

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

vi.mock('@tauri-apps/api/core', () => ({
    ...fakePaths.coreModule,
    invoke: async (command: string, args?: unknown, options?: { headers?: Record<string, string> }) => {
        const result = await desktop.invoke(command, args, options)
        if (command === 'write_chunk_raw' && args instanceof Uint8Array) {
            const headers = options?.headers ?? {}
            wire.chunks.push({
                key: decodeURIComponent(headers['x-risu-key']),
                finalKey: headers['x-risu-final-key'] === undefined ? undefined : decodeURIComponent(headers['x-risu-final-key']),
                last: headers['x-risu-last'] === '1',
                length: args.length,
            })
        }
        return result
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

import { saveAsset } from 'src/ts/globalApi.svelte'
import { CharXImporter, EntryBuffer, charxLimits } from 'src/ts/process/processzip'
import { fflateZipArchive, type ZipEntry } from './zipFixtures'
import type { Semaphore } from 'src/ts/util'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createNodeHttpStore, type FetchLike } from 'src/ts/storage/store/nodeHttpStore'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { hexOfKey, startNodeServer, type NodeServerFixture } from 'src/ts/storage/tests/nodeServerFixture'

const CHUNK = 65_536
const ASSET_LIMIT = 1_000_000
/**
 * An entry whose inflated data arrives in several chunks: the writer stores at level 0, and the inflater hands out
 * one stored block of at most 65535 bytes at a time.
 */
const BIG = 200_000

let server: NodeServerFixture

beforeAll(async () => {
    server = await startNodeServer({ env: { RISU_NODE_ASSET_LIMIT_BYTES: String(ASSET_LIMIT), RISU_UPLOAD_CHUNK_MAX_BYTES: String(CHUNK) } })
}, 120_000)

afterAll(async () => {
    await server?.stop()
}, 60_000)

const originalLimits = { ...charxLimits }

beforeEach(() => {
    h.platform.isTauri = false
    h.platform.isNodeServer = true
    h.os = 'linux'
    fakeFs.reset()
    fakePaths.reset()
    desktop.reset()
    wire.chunks.length = 0
    // Small fixtures: an entry of a few hundred bytes counts as one that passes a chunk.
    charxLimits.streamAfterBytes = 200
})

afterEach(async () => {
    Object.assign(charxLimits, originalLimits)
    injectAppStore(null)
    vi.restoreAllMocks()
    await server.clearKeys()
})

//#region helpers

const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function patterned(length: number, seed: number): Uint8Array {
    return Uint8Array.from({ length }, (_, index) => (index * 7 + seed) & 255)
}

/** A CharX in the descriptor framing (`fflateZipArchive`): a streaming `Zip` that states no entry size before the data. */
async function buildCharx(entries: Array<[string, Uint8Array | string]>): Promise<Uint8Array> {
    return fflateZipArchive(entries.map(([name, data]): ZipEntry => [name, typeof data === 'string' ? new TextEncoder().encode(data) : data, 0]))
}

/** The archive as a stream of slices, so the importer sees an entry's data arrive in several chunks. */
function streamOf(archive: Uint8Array, slice = 64): ReadableStream<Uint8Array> {
    let at = 0
    return new ReadableStream<Uint8Array>({
        pull(controller) {
            if (at >= archive.length) {
                controller.close()
                return
            }
            controller.enqueue(archive.slice(at, at + slice))
            at += slice
        },
    })
}

async function nodeStore(script?: (url: string) => Promise<Response | undefined>): Promise<{ store: ByteStore, routes: string[], writes: string[] }> {
    const routes: string[] = []
    const writes: string[] = []
    const fetchLike: FetchLike = async (url, init) => {
        routes.push(new URL(url).pathname)
        const headers = init?.headers as Record<string, string> | undefined
        if (new URL(url).pathname === '/api/write' && headers?.['file-path'] !== undefined) {
            writes.push(Buffer.from(headers['file-path'], 'hex').toString('utf-8'))
        }
        return (await script?.(url)) ?? await fetch(url, init)
    }
    const store = createNodeHttpStore({
        baseUrl: server.baseUrl,
        authHeader: () => server.authHeader(),
        fetch: fetchLike,
        pieceBytes: CHUNK,
        sleep: async () => { },
    })
    await store.guarded!.probe()
    routes.length = 0
    injectAppStore(store, 'node')
    return { store, routes, writes }
}

function useTauri(): ByteStore {
    h.platform.isTauri = true
    h.platform.isNodeServer = false
    fakeFs.setPlatform('posix')
    fakePaths.setPlatform('posix')
    fakeFs.setAppDataRoot(fakePaths.appDataDirectory('posix'))
    fakeFs.directories.add('assets')
    const store = createTauriFilesStore({ platform: 'posix' })
    injectAppStore(store, 'tauri')
    return store
}

async function onDisk(key: string): Promise<Uint8Array | null> {
    try {
        return new Uint8Array(await readFile(join(server.saveDir, hexOfKey(key))))
    } catch {
        return null
    }
}

async function storedAssetKeys(): Promise<string[]> {
    const hexPrefix = hexOfKey('assets/')
    return (await readdir(server.saveDir)).filter((name) => name.startsWith(hexPrefix)).map((name) => Buffer.from(name, 'hex').toString('utf-8'))
}

async function stagingFiles(): Promise<string[]> {
    return (await readdir(server.saveDir)).filter((name) => name.startsWith('__upload-'))
}

/**
 * The abort request that removes a staging file is sent, and settles, after the failing parse() has already rejected;
 * the staging file may not even exist yet. The cleanup is therefore awaited by its own effects, never by a clock:
 * first the abort request, then the staging file's removal.
 */
async function untilUploadAborted(routes: string[]): Promise<void> {
    const deadline = Date.now() + 10_000
    while (!routes.includes('/api/upload/abort') && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25))
    }
    while ((await stagingFiles()).length > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25))
    }
}

/** The most bytes any `EntryBuffer.take()` returned: an entry collected whole shows as its full length. */
function largestTaken(take: { mock: { results: Array<{ value?: Uint8Array }> } }): number {
    return Math.max(0, ...take.mock.results.map((result) => result.value?.length ?? 0))
}

const CARD = JSON.stringify({ spec: 'chara_card_v3', data: { name: 'x' } })

//#endregion

describe('fixture', () => {
    test('guard: a descriptor-framed archive states no entry size in the local header', async () => {
        const archive = await buildCharx([['assets/a.png', patterned(BIG,1)]])
        const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
        expect(view.getUint32(0, true)).toBe(0x04034b50)
        const flags = view.getUint16(6, true)
        const compressedSize = view.getUint32(18, true)
        expect(flags & 8).toBe(8)
        expect(compressedSize).toBe(0)
    })
})

describe('an entry past one chunk is saved in pieces on the Node store', () => {
    test('reproducer: the big entry is never taken whole, is stored under the saveAsset key and reads back byte-equal', async () => {
        const { routes, writes } = await nodeStore()
        const bytes = patterned(BIG,2)
        const archive = await buildCharx([['card.json', CARD], ['assets/big.png', bytes]])
        const take = vi.spyOn(EntryBuffer.prototype, 'take')

        const importer = new CharXImporter()
        await importer.parse(streamOf(archive))
        await importer.done()

        const key = `assets/${sha256Hex(bytes)}.png`
        expect(importer.assets['assets/big.png']).toBe(key)
        expect(Buffer.from(await onDisk(key) ?? []).equals(Buffer.from(bytes))).toBe(true)
        expect(largestTaken(take)).toBeLessThan(bytes.length)
        expect(writes).not.toContain(key)
        expect(routes).toContain('/api/upload/commit')
        expect(await stagingFiles()).toEqual([])
    })

    test('guard: a small entry stays on the whole path', async () => {
        const { store } = await nodeStore()
        const write = vi.spyOn(store, 'write')
        const bytes = patterned(120, 3)
        const archive = await buildCharx([['card.json', CARD], ['assets/small.png', bytes]])
        const take = vi.spyOn(EntryBuffer.prototype, 'take')

        const importer = new CharXImporter()
        await importer.parse(streamOf(archive))
        await importer.done()

        expect(take).toHaveBeenCalledTimes(2)
        expect(write).toHaveBeenCalledTimes(1)
        expect(importer.assets['assets/small.png']).toBe(`assets/${sha256Hex(bytes)}.png`)
    })

    test('guard: a streamed entry of another extension is keyed like saveAsset does it, by content and not by the entry name', async () => {
        await nodeStore()
        const bytes = patterned(BIG, 20)
        const expectedKey = await saveAsset(bytes)
        await server.clearKeys()
        const archive = await buildCharx([['card.json', CARD], ['assets/big.webp', bytes]])
        const take = vi.spyOn(EntryBuffer.prototype, 'take')

        const importer = new CharXImporter()
        await importer.parse(streamOf(archive))
        await importer.done()

        expect(largestTaken(take)).toBeLessThan(bytes.length)
        expect(expectedKey).toBe(`assets/${sha256Hex(bytes)}.png`)
        expect(importer.assets['assets/big.webp']).toBe(expectedKey)
        expect(Buffer.from(await onDisk(expectedKey) ?? []).equals(Buffer.from(bytes))).toBe(true)
        expect(await storedAssetKeys()).toEqual([expectedKey])
    })

    test('guard: a server without pieces keeps the whole path', async () => {
        const { store } = await nodeStore(async (url) => (new URL(url).pathname === '/api/caps'
            ? new Response(JSON.stringify({ checkOnly: true, retire: true, pieces: false }), { status: 200, headers: { 'risu-storage-guarded': '1', 'content-type': 'application/json' } })
            : undefined))
        await store.guarded!.probe()
        const bytes = patterned(BIG,4)
        const archive = await buildCharx([['card.json', CARD], ['assets/big.png', bytes]])
        const take = vi.spyOn(EntryBuffer.prototype, 'take')

        const importer = new CharXImporter()
        await importer.parse(streamOf(archive))
        await importer.done()

        expect(take).toHaveBeenCalledTimes(2)
    })

    test('data safety: an archive cut short inside the entry stores no asset under any key', async () => {
        await nodeStore()
        const bytes = patterned(BIG,5)
        const archive = await buildCharx([['card.json', CARD], ['assets/big.png', bytes]])
        const cut = archive.slice(0, Math.floor(archive.length * 0.7))

        const importer = new CharXImporter()
        const outcome = await importer.parse(streamOf(cut)).then(() => importer.done()).then(() => null, (error: unknown) => error)

        expect(outcome).not.toBeNull()
        expect(await storedAssetKeys()).toEqual([])
        expect(await stagingFiles()).toEqual([])
    })

    test('data safety: an entry that passes its size limit while it streams stores no asset', async () => {
        const { routes } = await nodeStore()
        charxLimits.assetBytes = 300
        const archive = await buildCharx([['card.json', CARD], ['assets/big.png', patterned(BIG,6)]])

        const importer = new CharXImporter()
        const outcome = await importer.parse(streamOf(archive)).then(() => null, (error: unknown) => error)

        expect(outcome).toMatchObject({ name: 'CharXParseError', origin: 'size' })
        await untilUploadAborted(routes)
        expect(await storedAssetKeys()).toEqual([])
        expect(await stagingFiles()).toEqual([])
    })

    test('new behaviour: the entry is counted when it switches, so done() waits for its save', async () => {
        await nodeStore()
        const bytes = patterned(BIG,7)
        const archive = await buildCharx([['card.json', CARD], ['assets/big.png', bytes]])
        const importer = new CharXImporter()
        let open: () => void = () => { }
        const gate = new Promise<void>((resolve) => { open = resolve })
        ;(importer as unknown as { semaphore: Pick<Semaphore, 'acquire' | 'release'> }).semaphore = {
            acquire: async () => { await gate },
            release: () => { },
        }

        await importer.parse(streamOf(archive))
        let settled = false
        const done = importer.done().then(() => { settled = true })
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(settled).toBe(false)
        open()
        await done

        expect(Buffer.from(await onDisk(`assets/${sha256Hex(bytes)}.png`) ?? []).equals(Buffer.from(bytes))).toBe(true)
    })

    test('new behaviour: reading pauses at the backlog limit and resumes as the writer drains the queue', async () => {
        await nodeStore()
        charxLimits.backlogBytes = 1000
        const bytes = patterned(BIG, 8)
        const archive = await buildCharx([['card.json', CARD], ['assets/big.png', bytes]])

        const importer = new CharXImporter()
        await importer.parse(streamOf(archive, 512))
        await importer.done()

        expect(Buffer.from(await onDisk(`assets/${sha256Hex(bytes)}.png`) ?? []).equals(Buffer.from(bytes))).toBe(true)
    }, 20_000)

    test('data safety: abandon() aborts a streaming save and nothing is stored under the key', async () => {
        let release: () => void = () => { }
        const stalled = new Promise<void>((resolve) => { release = resolve })
        let appends = 0
        const { routes } = await nodeStore(async (url) => {
            if (new URL(url).pathname === '/api/upload/append') {
                appends++
                if (appends === 2) {
                    await stalled
                }
            }
            return undefined
        })
        const bytes = patterned(BIG,9)
        const archive = await buildCharx([['card.json', CARD], ['assets/big.png', bytes]])

        const importer = new CharXImporter()
        await importer.parse(streamOf(archive))
        importer.abandon()
        release()
        await untilUploadAborted(routes)

        expect(await storedAssetKeys()).toEqual([])
        expect(await stagingFiles()).toEqual([])
    })
})

describe('an entry past one chunk is saved in pieces on the desktop store', () => {
    test('reproducer: the big entry is never taken whole and its chunks end with the saveAsset key', async () => {
        const store = useTauri()
        const write = vi.spyOn(store, 'write')
        const bytes = patterned(BIG,10)
        const archive = await buildCharx([['card.json', CARD], ['assets/big.png', bytes]])
        const take = vi.spyOn(EntryBuffer.prototype, 'take')

        const importer = new CharXImporter()
        await importer.parse(streamOf(archive))
        await importer.done()

        const key = `assets/${sha256Hex(bytes)}.png`
        expect(importer.assets['assets/big.png']).toBe(key)
        expect(largestTaken(take)).toBeLessThan(bytes.length)
        expect(write).not.toHaveBeenCalled()
        expect(wire.chunks.at(-1)).toMatchObject({ finalKey: key, last: true })
        expect(Buffer.from(fakeFs.files.get(key) ?? []).equals(Buffer.from(bytes))).toBe(true)
    })

    test('data safety: an archive cut short inside the entry leaves no asset file', async () => {
        useTauri()
        const archive = await buildCharx([['card.json', CARD], ['assets/big.png', patterned(BIG,11)]])
        const cut = archive.slice(0, Math.floor(archive.length * 0.7))

        const importer = new CharXImporter()
        const outcome = await importer.parse(streamOf(cut)).then(() => importer.done()).then(() => null, (error: unknown) => error)

        expect(outcome).not.toBeNull()
        expect(Array.from(fakeFs.files.keys()).filter((key) => key.startsWith('assets/'))).toEqual([])
    })

    test('guard: a small entry stays on the whole path', async () => {
        const store = useTauri()
        const write = vi.spyOn(store, 'write')
        const archive = await buildCharx([['card.json', CARD], ['assets/small.png', patterned(120, 12)]])

        const importer = new CharXImporter()
        await importer.parse(streamOf(archive))
        await importer.done()

        expect(write).toHaveBeenCalledTimes(1)
    })
})
