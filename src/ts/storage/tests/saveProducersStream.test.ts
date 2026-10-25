// @vitest-environment node
/**
 * The producers that start from a picked file or a restored backup entry hand a
 * Blob to the store and never read it whole: `saveAssetFromBlob` (the asset
 * pickers), the inlay attach (`postInlayAsset` with a `File`), a restored text
 * inlay (`InlayRestoreCollector` -> `writeAppInlay` with a `textRepr`) and the
 * Tauri store's `writeBlob`. The Node leg runs against the real
 * `server/node/server.cjs` with small limits (chunks of 100 bytes); the Tauri leg
 * runs the real store over the stand-ins of `tauriDesktopFake.ts` and
 * `tauriFsFake.ts`, which fail a call that carries more than one chunk. A pass
 * says nothing about the Rust commands, a web view's memory or a real file
 * chooser.
 *
 * Titles say what a test pins. `reproducer` fails against the code before the
 * change (the producer read the whole file or decoded the whole body); `guard`
 * holds before and after.
 */
import 'fake-indexeddb/auto'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
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

const h = await vi.hoisted(async () => {
    const CAP_BYTES = 4 * 1024 * 1024
    const fs = (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true })
    const fake = await import('src/ts/storage/tests/tauriDesktopFake')
    const desktop = fake.createDesktopInvoke(fs, { cap: CAP_BYTES })
    const bounded = fake.createBoundedFs(fs, { cap: CAP_BYTES })
    const paths = (await import('src/ts/storage/tests/tauriPathFake')).createFakeTauriPaths()
    return {
        fs,
        desktop,
        bounded,
        paths,
        state: { os: 'web' },
        platform: { isTauri: false, isNodeServer: true },
        picked: null as File[] | null,
        hypaLines: [] as string[],
        keyPair: null as CryptoKeyPair | null,
        permissive: (): Record<string, unknown> => new Proxy({} as Record<string, unknown>, {
            get: (_target, key) => (key === 'then' ? undefined : vi.fn()),
            has: () => true,
        }),
    }
})

//#region module mocks

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
    // The picked files of the next `postChatFile`. The bytes variant reads each file whole, as the real picker does.
    selectMultipleFileObjects: vi.fn(async () => h.picked),
    selectMultipleFile: vi.fn(async () => {
        const read: { name: string, data: Uint8Array }[] = []
        for (const file of h.picked ?? []) {
            read.push({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) })
        }
        return read
    }),
    BufferToText: (data: Uint8Array) => new TextDecoder().decode(data),
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

vi.mock('@tauri-apps/plugin-fs', () => h.bounded.module)
vi.mock('@tauri-apps/api/path', () => h.paths.pathModule)
vi.mock('@tauri-apps/api/core', () => ({ ...h.paths.coreModule, invoke: h.desktop.invoke }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => h.state.os }))
vi.mock('@tauri-apps/plugin-shell', () => h.permissive())
vi.mock('@tauri-apps/plugin-http', () => h.permissive())
vi.mock('@tauri-apps/plugin-dialog', () => h.permissive())
vi.mock('@tauri-apps/api/event', () => h.permissive())
vi.mock('@tauri-apps/api/webviewWindow', () => h.permissive())
vi.mock('src/ts/vendor/streamSaver', () => ({ default: { useBlobFallback: false, createWriteStream: vi.fn() } }))

vi.mock(import('src/ts/model/modellist'), async () => {
    const types = await import('src/ts/model/types')
    return {
        LLMFlags: types.LLMFlags,
        LLMFormat: types.LLMFormat,
        LLMTokenizer: types.LLMTokenizer,
        getModelInfo: vi.fn(),
    } as unknown as typeof import('src/ts/model/modellist')
})
// The chat machinery `multisend.ts` imports for its `.po` branch; the tests below never reach it.
vi.mock(import('src/ts/process/index.svelte'), () => ({ doingChat: vi.fn(), sendChat: vi.fn() }) as unknown as typeof import('src/ts/process/index.svelte'))
vi.mock(import('src/ts/process/generationOwnership.svelte'), () => ({ isComposerWindowOpen: vi.fn() }) as unknown as typeof import('src/ts/process/generationOwnership.svelte'))
vi.mock(import('src/ts/process/chatOrigin'), () => ({ createSendSubject: vi.fn(), registerWork: vi.fn() }) as unknown as typeof import('src/ts/process/chatOrigin'))
vi.mock(import('src/ts/process/memory/hypamemory'), () => ({
    HypaProcesser: class {
        addText(lines: string[]) { h.hypaLines = lines }
        async similaritySearch() { return [] }
    },
}) as unknown as typeof import('src/ts/process/memory/hypamemory'))
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

import { saveAsset, saveAssetFromBlob } from 'src/ts/globalApi.svelte'
import { postInlayAsset } from 'src/ts/process/files/inlays'
import { readAppInlay, readAppInlayRecord, writeAppInlay, type InlayAsset } from 'src/ts/process/files/inlayStore'
import { InlayRestoreCollector } from 'src/ts/drive/inlayBackupImport'
import { encodeInlayHeader, inlayEntryName, inlayIdHash, type InlayEntryHeader } from 'src/ts/drive/inlayBackupCodec'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createIndexedDbStore } from 'src/ts/storage/store/indexedDbStore'
import { createNodeHttpStore, type FetchLike } from 'src/ts/storage/store/nodeHttpStore'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { resetByteTransportForTests } from 'src/ts/storage/tauriByteTransport'
import { startNodeServer, type NodeServerFixture, hexOfKey } from './nodeServerFixture'

const CHUNK = 100
const CAP = 4 * 1024 * 1024

let main: NodeServerFixture

beforeAll(async () => {
    main = await startNodeServer({
        env: { RISU_NODE_ASSET_LIMIT_BYTES: '1000', RISU_UPLOAD_CHUNK_MAX_BYTES: String(CHUNK) },
    })
}, 120_000)

afterAll(async () => {
    await main?.stop()
}, 60_000)

type Leg = 'node' | 'tauri' | 'indexeddb'

beforeEach(() => {
    // The attach path makes an image element only to decode images; audio and video never use it.
    vi.stubGlobal('Image', class { })
    h.picked = null
    h.fs.reset()
    h.desktop.reset()
    h.bounded.reset()
    h.paths.reset()
    resetByteTransportForTests()
})

afterEach(() => {
    injectAppStore(null)
    vi.restoreAllMocks()
})

//#region helpers

function patterned(length: number, seed: number): Uint8Array {
    return Uint8Array.from({ length }, (_, index) => (index * 7 + seed) & 255)
}

function sameBytes(left: Uint8Array | null, right: Uint8Array): boolean {
    return left !== null && Buffer.from(left).equals(Buffer.from(right))
}

const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

interface Spied {
    store: ByteStore
    /** Requests the Node store made, by route. */
    routes(): string[]
}

function nodeStore(): Spied {
    const calls: string[] = []
    const fetchLike: FetchLike = async (url, init) => {
        calls.push(new URL(url).pathname)
        return await fetch(url, init)
    }
    const store = createNodeHttpStore({
        baseUrl: main.baseUrl,
        authHeader: () => main.authHeader(),
        fetch: fetchLike,
        pieceBytes: CHUNK,
        sleep: async () => { },
    })
    return { store, routes: () => calls }
}

async function useNode(): Promise<Spied> {
    h.platform.isTauri = false
    h.platform.isNodeServer = true
    h.state.os = 'web'
    const spied = nodeStore()
    await spied.store.guarded!.probe()
    spied.routes().length = 0
    injectAppStore(spied.store, 'node')
    return spied
}

function useTauri(): ByteStore {
    h.platform.isTauri = true
    h.platform.isNodeServer = false
    h.state.os = 'windows'
    h.fs.setPlatform('windows')
    const store = createTauriFilesStore({ platform: 'windows' })
    injectAppStore(store, 'tauri')
    return store
}

function useIndexedDb(): ByteStore {
    h.platform.isTauri = false
    h.platform.isNodeServer = false
    h.state.os = 'web'
    const store = createIndexedDbStore()
    injectAppStore(store, 'indexeddb')
    return store
}

async function onNodeDisk(key: string): Promise<Uint8Array | null> {
    try {
        return new Uint8Array(await readFile(join(main.saveDir, hexOfKey(key))))
    } catch {
        return null
    }
}

/** The sizes of every `Blob.arrayBuffer` call since the spy was made (a call on a slice reports the slice). */
function readSizes(spy: { mock: { contexts: unknown[] } }): number[] {
    return spy.mock.contexts.map((context) => (context as Blob).size)
}

function failingSliceBlob(bytes: Uint8Array, pieceBytes: number, failure: DOMException, reads: { count: number }): File {
    const file = new File([bytes as Uint8Array<ArrayBuffer>], 'big.bin')
    const realSlice = Blob.prototype.slice
    vi.spyOn(file, 'slice').mockImplementation((start, end, type) => {
        const piece = realSlice.call(file, start, end, type)
        if (start === pieceBytes) {
            vi.spyOn(piece, 'arrayBuffer').mockImplementation(async () => {
                reads.count++
                throw failure
            })
        }
        return piece
    })
    return file
}

//#endregion

describe('saveAssetFromBlob', () => {
    test('reproducer: a picked File saved on the Node store is never read whole: it goes up in slices and gets saveAsset\'s key', async () => {
        const spied = await useNode()
        const bytes = patterned(450, 1)
        const file = new File([bytes as Uint8Array<ArrayBuffer>], 'pic.mp4')
        const whole = vi.spyOn(file, 'arrayBuffer')
        const slices = vi.spyOn(file, 'slice')
        const reads = vi.spyOn(Blob.prototype, 'arrayBuffer')

        const key = await saveAssetFromBlob(file, 'mp4', { minPieceBytes: 1, pieceBytes: 70 })

        expect(key).toBe(`assets/${sha256Hex(bytes)}.mp4`)
        expect(whole).not.toHaveBeenCalled()
        expect(slices.mock.calls.length).toBe(Math.ceil(450 / 70))
        expect(Math.max(...readSizes(reads))).toBeLessThanOrEqual(70)
        expect(spied.routes()).not.toContain('/api/write')
        expect(spied.routes().filter((route) => route === '/api/upload/commit')).toHaveLength(1)
        expect(sameBytes(await onNodeDisk(key), bytes)).toBe(true)
    })

    test('reproducer: a picked File saved on the Tauri store is never read whole: slices of at most one chunk reach the chunk commands', async () => {
        useTauri()
        const bytes = patterned(CAP * 2 + 5, 2)
        const file = new File([bytes as Uint8Array<ArrayBuffer>], 'pic.mp4')
        const whole = vi.spyOn(file, 'arrayBuffer')
        const reads = vi.spyOn(Blob.prototype, 'arrayBuffer')

        const key = await saveAssetFromBlob(file, 'mp4', { minPieceBytes: 1 })

        expect(key).toBe(`assets/${sha256Hex(bytes)}.mp4`)
        expect(whole).not.toHaveBeenCalled()
        expect(Math.max(...readSizes(reads))).toBeLessThanOrEqual(CAP)
        expect(Math.max(...h.desktop.payloads)).toBeLessThanOrEqual(CAP)
        expect(sameBytes(h.fs.files.get(key) ?? null, bytes)).toBe(true)
    })

    test.each([
        ['no name', ''],
        ['a known extension', 'clip.mp4'],
        ['an upper-case extension', 'CLIP.MP4'],
        ['no dot', 'noextension'],
        ['an extension that is not plain', 'x.we!rd'],
        ['a bare extension', 'webp'],
    ])('guard: the key for %s equals saveAsset\'s key for the same bytes and name, on the piece path and the whole path', async (_label, name) => {
        await useNode()
        const bytes = patterned(450, 3)
        const expected = await saveAsset(bytes, '', name)

        const pieced = await saveAssetFromBlob(new Blob([bytes as Uint8Array<ArrayBuffer>]), name, { minPieceBytes: 1, pieceBytes: 70 })
        const whole = await saveAssetFromBlob(new Blob([bytes as Uint8Array<ArrayBuffer>]), name, { minPieceBytes: 10_000 })

        expect(pieced).toBe(expected)
        expect(whole).toBe(expected)
    })

    test('guard: a store without openWriter (the browser store) reads the Blob and saves it with saveAsset, under the same key', async () => {
        const store = useIndexedDb()
        expect(store.openWriter).toBeUndefined()
        const bytes = patterned(300, 4)

        const key = await saveAssetFromBlob(new File([bytes as Uint8Array<ArrayBuffer>], 'a.png'), 'png', { minPieceBytes: 1 })

        expect(key).toBe(await saveAsset(bytes, '', 'png'))
        expect(sameBytes((await store.read(key)).bytes, bytes)).toBe(true)
    })

    test('data safety: a slice that cannot be read reaches the caller as the same error on the Node store, once, and leaves nothing', async () => {
        const spied = await useNode()
        const bytes = patterned(450, 5)
        const failure = new DOMException('The requested file could not be read.', 'NotReadableError')
        const reads = { count: 0 }
        // The third slice fails, after the first chunk of the upload has been sent.
        const file = failingSliceBlob(bytes, 140, failure, reads)

        await expect(saveAssetFromBlob(file, '', { minPieceBytes: 1, pieceBytes: 70 })).rejects.toBe(failure)

        expect(reads.count).toBe(1)
        expect(await onNodeDisk(`assets/${sha256Hex(bytes)}.png`)).toBeNull()
        expect(spied.routes().filter((route) => route === '/api/upload/commit')).toHaveLength(0)
        expect(spied.routes().filter((route) => route === '/api/upload/abort')).toHaveLength(1)
    })

    test('data safety: a slice that cannot be read reaches the caller as the same error on the Tauri store, once, and leaves no file', async () => {
        useTauri()
        const bytes = patterned(CAP * 2 + 5, 6)
        const failure = new DOMException('The requested file could not be read.', 'NotReadableError')
        const reads = { count: 0 }
        const file = failingSliceBlob(bytes, CAP, failure, reads)

        await expect(saveAssetFromBlob(file, '', { minPieceBytes: 1 })).rejects.toBe(failure)

        expect(reads.count).toBe(1)
        expect(Array.from(h.fs.files.keys()).filter((key) => key.startsWith('assets/'))).toEqual([])
    })
})

describe('inlay attach', () => {
    test('reproducer: attaching a picked video through postChatFile never reads the file whole (the picker hands the File over unread)', async () => {
        const { postChatFile } = await import('src/ts/process/files/multisend')
        const spied = await useNode()
        const bytes = patterned(450, 14)
        const file = new File([bytes as Uint8Array<ArrayBuffer>], 'clip.mp4')
        const whole = vi.spyOn(file, 'arrayBuffer')
        h.picked = [file]

        const results = await postChatFile('')

        expect(whole).not.toHaveBeenCalled()
        expect(results).toHaveLength(1)
        expect(results[0]).toMatchObject({ type: 'asset' })
        const record = await readAppInlayRecord(spied.store, (results[0] as { data: string }).data)
        expect(sameBytes((await spied.store.read(record!.body)).bytes, bytes)).toBe(true)
    })

    test('guard: a picked text file is read to text by postChatFile itself', async () => {
        const { postChatFile } = await import('src/ts/process/files/multisend')
        await useNode()
        h.picked = [new File(['hello txt'], 'note.txt')]

        const results = await postChatFile('')

        expect(results).toHaveLength(1)
        expect(results[0]).toMatchObject({ type: 'text', name: 'note.txt' })
        expect(h.hypaLines.join('\n')).toContain('hello txt')
    })

    test.each<[string, number]>([['node', 450], ['tauri', CAP * 2 + 7]])('%s store: a File above one chunk handed to postInlayAsset is not copied whole', async (leg, length) => {
        const spied = leg === 'node' ? await useNode() : undefined
        const store = leg === 'node' ? spied!.store : useTauri()
        const bytes = patterned(length, 7)
        const file = new File([bytes as Uint8Array<ArrayBuffer>], 'clip.mp4')
        const whole = vi.spyOn(file, 'arrayBuffer')
        const reads = vi.spyOn(Blob.prototype, 'arrayBuffer')

        const id = await postInlayAsset({ name: 'clip.mp4', data: file })

        expect(typeof id).toBe('string')
        expect(whole).not.toHaveBeenCalled()
        expect(Math.max(...readSizes(reads))).toBeLessThan(length)
        const record = await readAppInlayRecord(store, id as string)
        expect(record?.repr).toBe('blob')
        expect(record?.len).toBe(length)
        expect(sameBytes((await store.read(record!.body)).bytes, bytes)).toBe(true)
    })

    test('guard: a Uint8Array attachment is stored as before', async () => {
        useIndexedDb()
        const store = useIndexedDb()
        const bytes = patterned(300, 8)

        const id = await postInlayAsset({ name: 'clip.mp3', data: bytes })

        const record = await readAppInlayRecord(store, id as string)
        expect(record?.mime).toBe('audio/mp3')
        expect(sameBytes((await store.read(record!.body)).bytes, bytes)).toBe(true)
    })
})

describe('a restored text inlay', () => {
    /** Part 0 of a backup entry: the header length, the header and the body, as the exporter writes it. */
    async function restore(store: ByteStore, id: string, repr: InlayEntryHeader['repr'], body: Uint8Array): Promise<void> {
        const header: InlayEntryHeader = { v: 1, id, repr, mime: '', fields: { name: `${id}.txt`, ext: 'txt', type: 'signature' }, len: body.length, parts: 1 }
        const headerBytes = encodeInlayHeader(header)!
        const prefix = new Uint8Array(4)
        new DataView(prefix.buffer).setUint32(0, headerBytes.length, true)
        const hash = await inlayIdHash(id)
        const collector = new InlayRestoreCollector(Number.MAX_SAFE_INTEGER)
        const entry = new Blob([prefix, headerBytes as Uint8Array<ArrayBuffer>, body as Uint8Array<ArrayBuffer>])
        expect(await collector.add(inlayEntryName(hash, 0), hash, 0, entry)).toBe('ok')
        const result = await collector.finish(store)
        expect(result).toEqual({ written: 1, skipped: [], changed: false })
    }

    function utf16Bytes(text: string): Uint8Array {
        const bytes = new Uint8Array(text.length * 2)
        const view = new DataView(bytes.buffer)
        for (let i = 0; i < text.length; i++) {
            view.setUint16(i * 2, text.charCodeAt(i), true)
        }
        return bytes
    }

    const LENGTHS: Record<Leg, number> = { node: 450, tauri: CAP + 4096, indexeddb: 450 }

    describe.each<Leg>(['node', 'tauri', 'indexeddb'])('on the %s store', (leg) => {
        async function open(): Promise<ByteStore> {
            if (leg === 'node') {
                return (await useNode()).store
            }
            return leg === 'tauri' ? useTauri() : useIndexedDb()
        }

        test('reproducer: a UTF-8 text inlay is stored from the Blob, never decoded whole, and reads back as the same string with its repr', async () => {
            const store = await open()
            const text = Array.from({ length: LENGTHS[leg] }, (_, i) => String.fromCharCode(97 + (i % 26))).join('')
            const reads = vi.spyOn(Blob.prototype, 'arrayBuffer')

            await restore(store, `text-${leg}`, 'string', new TextEncoder().encode(text))
            const sizes = readSizes(reads)
            reads.mockClear()

            expect(Math.max(...sizes)).toBeLessThan(text.length)
            expect((await readAppInlayRecord(store, `text-${leg}`))?.repr).toBe('string')
            const back = await readAppInlay(`text-${leg}`)
            expect(typeof back?.data).toBe('string')
            expect(back?.data).toBe(text)
        })

        test('reproducer: a UTF-16 text inlay (not well-formed) is stored from the Blob and reads back as the same string with its repr', async () => {
            const store = await open()
            const count = Math.ceil(LENGTHS[leg] / 2)
            const text = '\ud800' + Array.from({ length: count }, (_, i) => String.fromCharCode(97 + (i % 26))).join('')
            const reads = vi.spyOn(Blob.prototype, 'arrayBuffer')

            await restore(store, `text16-${leg}`, 'string16', utf16Bytes(text))
            const sizes = readSizes(reads)
            reads.mockClear()

            expect(Math.max(...sizes)).toBeLessThan(text.length * 2)
            expect((await readAppInlayRecord(store, `text16-${leg}`))?.repr).toBe('string16')
            const back = await readAppInlay(`text16-${leg}`)
            expect(typeof back?.data).toBe('string')
            expect(back?.data).toBe(text)
        })
    })

    test('guard: a store without writeBlob stores the same string inlay from bytes', async () => {
        const base = useIndexedDb()
        const bytesOnly: ByteStore = { ...base, writeBlob: undefined, readBlob: undefined }
        injectAppStore(bytesOnly, 'indexeddb')

        await restore(bytesOnly, 'text-bytes', 'string', new TextEncoder().encode('hello'))

        expect((await readAppInlayRecord(bytesOnly, 'text-bytes'))?.repr).toBe('string')
        expect((await readAppInlay('text-bytes'))?.data).toBe('hello')
    })

    test('data safety: a backup slice that cannot be read or has vanished is the changed outcome of the restore, on the Node and the Tauri store', async () => {
        for (const [leg, errorName] of [['node', 'NotReadableError'], ['tauri', 'NotReadableError'], ['node', 'NotFoundError'], ['tauri', 'NotFoundError']] as const) {
            const store = leg === 'node' ? (await useNode()).store : useTauri()
            const body = patterned(leg === 'node' ? 450 : CAP + 4096, 9)
            const failure = new DOMException('The requested file could not be read.', errorName)
            const id = `changed-${leg}-${errorName}`
            const header: InlayEntryHeader = { v: 1, id, repr: 'string', mime: '', fields: { name: id, ext: 'txt', type: 'signature' }, len: body.length, parts: 1 }
            const headerBytes = encodeInlayHeader(header)!
            const prefix = new Uint8Array(4)
            new DataView(prefix.buffer).setUint32(0, headerBytes.length, true)
            const hash = await inlayIdHash(id)
            const collector = new InlayRestoreCollector(Number.MAX_SAFE_INTEGER)
            const entry = new Blob([prefix, headerBytes as Uint8Array<ArrayBuffer>, body as Uint8Array<ArrayBuffer>])
            await collector.add(inlayEntryName(hash, 0), hash, 0, entry)
            const realSlice = Blob.prototype.slice
            const unreadable = vi.spyOn(Blob.prototype, 'slice').mockImplementation(function (this: Blob, start, end, type) {
                const piece = realSlice.call(this, start, end, type)
                if (start !== undefined && start > 0 && piece.size > 0 && this.size === body.length) {
                    vi.spyOn(piece, 'arrayBuffer').mockImplementation(async () => { throw failure })
                }
                return piece
            })

            const result = await collector.finish(store)
            unreadable.mockRestore()

            expect(result.changed).toBe(true)
            expect(result.written).toBe(0)
            expect(await readAppInlayRecord(store, id)).toBeNull()
        }
    })
})

describe('the Tauri store writeBlob', () => {
    const BODY = 'inlays/b-clip.0123456789abcdef'

    test('reproducer: a Blob above one chunk reaches the chunk commands one slice at a time, replaces an earlier value and leaves no temp file', async () => {
        const store = useTauri()
        await store.write(BODY, patterned(10, 10), 'unconditional')
        const bytes = patterned(CAP * 2 + 5, 11)
        const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'video/mp4' })
        const whole = vi.spyOn(blob, 'arrayBuffer')
        const reads = vi.spyOn(Blob.prototype, 'arrayBuffer')

        await store.writeBlob!(BODY, blob, 'unconditional')

        expect(whole).not.toHaveBeenCalled()
        expect(readSizes(reads)).toEqual([CAP, CAP, 5])
        expect(Math.max(...h.desktop.payloads)).toBeLessThanOrEqual(CAP)
        expect(sameBytes(h.fs.files.get(BODY) ?? null, bytes)).toBe(true)
        expect(Array.from(h.fs.files.keys()).filter((key) => key.includes('.tmp'))).toEqual([])
        expect(store.readBlob).toBeUndefined()
    })

    test('data safety: a slice that cannot be read rejects with that error, is read once, is not sent again and keeps the earlier value', async () => {
        const store = useTauri()
        const earlier = patterned(10, 12)
        await store.write(BODY, earlier, 'unconditional')
        const failure = new DOMException('The requested file could not be read.', 'NotReadableError')
        const reads = { count: 0 }
        const blob = failingSliceBlob(patterned(CAP * 2 + 5, 13), CAP, failure, reads)
        h.desktop.payloads.length = 0

        await expect(store.writeBlob!(BODY, blob, 'unconditional')).rejects.toBe(failure)

        expect(reads.count).toBe(1)
        expect(sameBytes(h.fs.files.get(BODY) ?? null, earlier)).toBe(true)
        expect(Array.from(h.fs.files.keys()).filter((key) => key.includes('.tmp'))).toEqual([])
    })

    test('data safety: a slice that fails after earlier chunks were handed to the writer aborts the chunked write and commits nothing', async () => {
        const store = useTauri()
        const earlier = patterned(10, 15)
        await store.write(BODY, earlier, 'unconditional')
        const failure = new DOMException('The requested file could not be read.', 'NotReadableError')
        const reads = { count: 0 }
        const blob = failingSliceBlob(patterned(CAP * 2 + 5, 16), CAP * 2, failure, reads)
        const abortsBefore = h.desktop.count('abort_chunked')
        const chunksBefore = h.desktop.count('write_chunk_raw') + h.desktop.count('write_chunk')

        await expect(store.writeBlob!(BODY, blob, 'unconditional')).rejects.toBe(failure)

        expect(h.desktop.count('write_chunk_raw') + h.desktop.count('write_chunk')).toBeGreaterThan(chunksBefore)
        expect(h.desktop.count('abort_chunked')).toBe(abortsBefore + 1)
        expect(reads.count).toBe(1)
        expect(sameBytes(h.fs.files.get(BODY) ?? null, earlier)).toBe(true)
        expect(Array.from(h.fs.files.keys()).filter((key) => key.includes('.tmp'))).toEqual([])
    })

    test('IndexedDB writeBlob still keeps the Blob (guard), and a Blob body with a textRepr reads back as a string (reproducer)', async () => {
        const store = useIndexedDb()
        const blob = new Blob(['abc'], { type: 'video/mp4' })

        await store.writeBlob!(BODY, blob, 'unconditional')

        expect(await store.readBlob!(BODY)).not.toBeNull()
        const asset: InlayAsset = { name: 'n', ext: 'txt', type: 'signature', data: new Blob(['héllo']) }
        await writeAppInlay(store, 'idb-text', asset, { textRepr: 'string' })
        expect((await readAppInlay('idb-text'))?.data).toBe('héllo')
    })
})
