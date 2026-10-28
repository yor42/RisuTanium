/**
 * Refusals of a card, module or Realm export that holds a large asset (CHORE-375 stage B).
 *
 * The real `exportCharacterCard`, `exportModule`, `exportModuleLegacy`, `shareRealmCardData`, `CharXWriter` and the
 * PNG chunk writer run. The size of an asset is read through the existing seams, mocked here: the desktop's
 * `statStoredSize` at `tauriByteTransport`, a browser store whose `readValue` returns a Blob that reports a size
 * without holding the bytes, and a Node store whose `readPieces` reports a total. `LocalWriter` records `init`, so
 * "nothing opened" is observable. A mocked file system and a mocked store are not evidence of native behaviour.
 *
 * Labels: (R) regression reproducer, fails on the base where such an export proceeds; (G) guard, passes before and
 * after; (N) new behaviour with nothing on the base to fail against.
 */
import crc32 from 'crc/crc32'
import { beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const h = vi.hoisted(() => ({
    inits: [] as string[],
    writes: 0,
    writeSizes: [] as number[],
    downloads: [] as string[],
    errors: [] as string[],
    stacks: [] as string[],
    notices: [] as string[],
    waits: [] as string[],
    reads: [] as string[],
    saved: 0,
    png: new Uint8Array() as Uint8Array,
}))

const env = vi.hoisted(() => ({
    isTauri: true,
    isNodeServer: false,
    desktop: false,
    store: {} as unknown,
    nodeStore: null as unknown,
    sizes: new Map<string, number>(),
    statFails: false,
    statCalls: 0,
    // keys the mocked sources serve in 4 MiB pieces of a fixed byte pattern, with the number of times each was opened
    served: new Map<string, number>(),
    // a served key whose reads fail after the first piece
    failMid: new Set<string>(),
    // a served key whose open fails from this open number on (the first opens that size nothing)
    failOpenFrom: new Map<string, number>(),
    // the bytes `readImage` returns for a key (the card's own image when absent)
    whole: new Map<string, Uint8Array>(),
}))

// The served keys' bytes: 4 MiB pieces of a fixed pattern, so that two opens of one key read the same bytes.
const served = vi.hoisted(() => {
    const PIECE = 4 * 1024 * 1024
    return {
        PIECE,
        byteAt: (offset: number) => (offset / PIECE) & 255,
        async *pieces(key: string): AsyncGenerator<{ bytes: Uint8Array, offset: number, total: number }, void, undefined> {
            const size = env.sizes.get(key)
            if (!env.served.has(key) || size === undefined) {
                throw new Error('the pre-check never reads pieces')
            }
            const opens = (env.served.get(key) ?? 0) + 1
            env.served.set(key, opens)
            const from = env.failOpenFrom.get(key)
            if (from !== undefined && opens >= from) {
                throw new Error(`ENOENT ${key} (os error 2)`)
            }
            for (let offset = 0; offset < size; offset += PIECE) {
                if (offset > 0 && env.failMid.has(key)) {
                    throw new Error(`the read of ${key} failed at ${offset}`)
                }
                yield { bytes: new Uint8Array(Math.min(PIECE, size - offset)).fill((offset / PIECE) & 255), offset, total: size }
            }
        },
    }
})

vi.mock('uuid', () => ({
    v4: () => 'uuid-1',
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return env.isTauri },
    get isNodeServer() { return env.isNodeServer },
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/upstreamAgreement'), () => ({
    askUpstreamAgreement: vi.fn(async () => true),
    isUpstreamAccepted: vi.fn(() => true),
    publishUpstreamAccepted: vi.fn(),
}) as unknown as typeof import('src/ts/upstreamAgreement'))

vi.mock(import('src/ts/alert'), () => {
    const text = (msg: string | Error) => msg instanceof Error ? msg.message : String(msg)
    return {
        alertCardExport: vi.fn(),
        alertClear: vi.fn(),
        alertConfirm: vi.fn(async () => true),
        alertError: vi.fn((msg: string | Error) => {
            h.errors.push(text(msg))
            h.stacks.push(msg instanceof Error ? msg.stack ?? '' : '')
        }),
        alertInput: vi.fn(async () => ''),
        alertMd: vi.fn(),
        alertModuleSelect: vi.fn(),
        alertNormal: vi.fn(),
        alertNormalWait: vi.fn(async (msg: string) => { h.notices.push(msg) }),
        alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
        alertWait: vi.fn((msg: string) => { h.waits.push(msg) }),
    } as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    defaultSdDataFunc: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    importPreset: vi.fn(),
    setCurrentCharacter: vi.fn(),
    getCurrentCharacter: vi.fn(),
    getCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => ({ statics: { imports: 0 }, characters: [], goCharacterOnImport: false })),
    setDatabaseLite: vi.fn(),
    appVer: 'test',
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/util'), () => {
    class Semaphore {
        async acquire() { }
        release() { }
    }
    return {
        Semaphore,
        asBuffer: (a: unknown) => a,
        checkNullish: (v: unknown) => v === null || v === undefined,
        checkPersonaBinded: vi.fn(),
        decryptBuffer: vi.fn(async (d: unknown) => d),
        // the same four prefixes as the real `isKnownUri`
        isKnownUri: (uri: string) => uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('ccdefault:') || uri.startsWith('embeded://'),
        selectFileByDom: vi.fn(async () => null),
        selectSingleFile: vi.fn(),
        sleep: vi.fn(async () => { }),
    } as unknown as typeof import('src/ts/util')
})

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(async () => { }),
    characterFormatUpdate: vi.fn((c: unknown) => c),
    createBlankChar: vi.fn(() => ({
        name: '',
        firstMessage: '',
        desc: '',
        emotionImages: [],
        bias: [],
        viewScreen: 'none',
        globalLore: [],
        utilityBot: false,
        customscript: [],
        exampleMessage: '',
        creatorNotes: '',
        systemPrompt: '',
        alternateGreetings: [],
        tags: [],
    })),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { AppendableBuffer, VirtualWriter } = await import('src/ts/byteBuffer')
    class LocalWriter {
        async init(name: string) { h.inits.push(name); return true }
        async write(data: Uint8Array) {
            h.writes++
            h.writeSizes.push(data.length)
        }
        async close() { }
        useCancel() { }
    }
    return {
        AppendableBuffer,
        AssetSourceChangedError: class extends Error { },
        BlankWriter: class {
            async init() { }
            async write() { }
            async end() { }
        },
        LocalWriter,
        VirtualWriter,
        checkCharOrder: vi.fn(),
        downloadFile: vi.fn(async (name: string) => { h.downloads.push(name) }),
        forageStorage: {},
        loadAsset: vi.fn(async (key: string) => { h.reads.push(key); return h.png }),
        openURL: vi.fn(),
        pieceStoreOrNull: vi.fn(async () => env.nodeStore),
        readImage: vi.fn(async (key: string) => { h.reads.push(key); return env.whole.get(key) ?? h.png }),
        saveAsset: vi.fn(async () => { h.saved++; return 'saved' }),
        saveAssetFromPieces: vi.fn(async () => { throw new Error('not used') }),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: vi.fn(async () => env.store),
    getAppStoreKind: vi.fn(async () => 'tauri'),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

vi.mock(import('src/ts/storage/tauriByteTransport'), async (importOriginal) => ({
    ...await importOriginal(),
    isDesktopTransport: () => env.desktop,
    transportKind: () => 'web',
    // The pre-check never reads pieces; a CharX export streams the keys a test lists in `env.served`.
    readRangedPieces: async function* (key: string) {
        for await (const piece of served.pieces(key)) {
            yield { ...piece, identity: 'id-1' }
        }
    },
    statStoredSize: async (key: string) => {
        env.statCalls++
        const size = env.sizes.get(key)
        if (env.statFails || size === undefined) {
            throw new Error('size unknown')
        }
        return size
    },
}) as unknown as typeof import('src/ts/storage/tauriByteTransport'))

vi.mock(import('src/ts/media/compressImage/lossyCompression'), () => ({
    doLossyCompression: vi.fn(async (data: Uint8Array) => Buffer.from(data)),
}))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { imageCompression: false } } },
    HideIconStore: { set: vi.fn() },
    ReloadGUIPointer: { set: vi.fn() },
    SettingsMenuIndex: { set: vi.fn() },
    ShowRealmFrameStore: { set: vi.fn() },
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    moduleBackgroundEmbedding: { set: vi.fn() },
    selectedCharID: { set: vi.fn() },
    settingsOpen: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => data),
    decodeRPack: vi.fn(async (data: Uint8Array) => data),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

//#endregion

import { language } from 'src/lang'
import { noteSelectedStore } from 'src/ts/storage/assetLimit'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { exportCharacterCard } from 'src/ts/characterCards'
import { getCurrentCharacter, type character } from 'src/ts/storage/database.svelte'
import { exportModule, exportModuleLegacy, type RisuModule } from 'src/ts/process/modules'
import { shareRealmCardData } from 'src/ts/realm'

//#region synthetic data

function pngChunk(type: string, body: Uint8Array): Uint8Array {
    const typeBytes = new TextEncoder().encode(type)
    const out = new Uint8Array(12 + body.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, body.length)
    out.set(typeBytes, 4)
    out.set(body, 8)
    view.setUint32(8 + body.length, crc32(Buffer.concat([typeBytes, body])))
    return out
}

function syntheticPng(): Uint8Array {
    const ihdr = new Uint8Array(13)
    ihdr.set([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])
    return Buffer.concat([
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', ihdr),
        pngChunk('IEND', new Uint8Array()),
    ])
}

const MIB = 1024 * 1024
const GIB = 1024 * MIB
const key = (name: string) => `assets/${name.padEnd(64, '0')}.bin`
const BIG = key('big')
const SMALL = key('small')

function card(assetKeys: string[], extra: Record<string, unknown> = {}): character {
    return {
        name: 'Synthetic Card',
        image: key('portrait'),
        globalLore: [],
        desc: 'a description',
        firstMessage: 'hello',
        creatorNotes: 'notes',
        ccAssets: assetKeys.map((uri, i) => ({ type: 'x-risu-asset', uri, name: i === 0 ? 'Big Video' : `asset ${i}`, ext: 'mp4' })),
        ...extra,
    } as unknown as character
}

function moduleOf(assetKeys: string[]): RisuModule {
    return {
        name: 'Synthetic Module',
        description: 'module notes',
        id: 'module-1',
        assets: assetKeys.map((uri, i) => [i === 0 ? 'Big Video' : `asset ${i}`, uri, 'mp4'] as [string, string, string]),
    }
}

/** A Blob that reports a size and holds no bytes. */
class SizedBlob extends Blob {
    constructor(private readonly reported: number) { super([]) }
    get size() { return this.reported }
}

/** A Blob of a served key: it reports the size and cuts the pieces of the served bytes. */
class ServedBlob extends Blob {
    constructor(private readonly reported: number, private readonly name: string) { super([]) }
    get size() { return this.reported }
    slice(start = 0, end = this.reported) {
        const name = this.name
        return {
            arrayBuffer: async () => {
                const opens = env.served.get(name) ?? 0
                if (start === 0) {
                    env.served.set(name, opens + 1)
                    const from = env.failOpenFrom.get(name)
                    if (from !== undefined && opens + 1 >= from) {
                        throw new Error(`ENOENT ${name} (os error 2)`)
                    }
                }
                if (start > 0 && env.failMid.has(name)) {
                    throw new Error(`the read of ${name} failed at ${start}`)
                }
                return new Uint8Array(end - start).fill(served.byteAt(start)).buffer
            },
        } as unknown as Blob
    }
}

type SourceKind = 'tauri' | 'web' | 'node'

/** Selects where sizes are read from; the sizes themselves are `env.sizes`. */
function useSource(kind: SourceKind) {
    env.desktop = kind === 'tauri'
    env.isNodeServer = kind === 'node'
    env.nodeStore = null
    env.store = {
        read: vi.fn(async () => ({ bytes: null })),
        readValue: vi.fn(async (name: string) => {
            const size = env.sizes.get(name)
            if (size === undefined) {
                return null
            }
            return env.served.has(name) ? new ServedBlob(size, name) : new SizedBlob(size)
        }),
    }
    if (kind === 'node') {
        env.nodeStore = {
            read: vi.fn(async () => ({ bytes: null })),
            piecesRecorded: () => true,
            readPieces: vi.fn(async (name: string) => {
                const size = env.sizes.get(name)
                if (size === undefined) {
                    return null
                }
                if (env.served.has(name)) {
                    return { total: size, version: null, pieces: (async function* () { for await (const piece of served.pieces(name)) { yield piece.bytes } })() }
                }
                return { total: size, version: null, pieces: (async function* () { yield new Uint8Array(1) })() }
            }),
        }
    }
}

const SOURCES: SourceKind[] = ['tauri', 'web', 'node']

beforeEach(() => {
    globalThis.safeStructuredClone = structuredClone
    h.inits.length = 0
    h.writes = 0
    h.writeSizes.length = 0
    h.downloads.length = 0
    h.errors.length = 0
    h.stacks.length = 0
    h.notices.length = 0
    h.waits.length = 0
    h.reads.length = 0
    h.saved = 0
    h.png = syntheticPng()
    env.isTauri = true
    env.sizes.clear()
    env.statFails = false
    env.statCalls = 0
    env.served.clear()
    env.failMid.clear()
    env.failOpenFrom.clear()
    env.whole.clear()
    useSource('tauri')
    // the importer's per-asset limit is the page's store limit capped at 1 GiB: the app's files store takes 1 GiB
    noteSelectedStore('tauri', env.store as ByteStore)
    vi.stubGlobal('fetch', vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(4) })))
})

function expectNothingOpened() {
    expect(h.inits).toEqual([])
    expect(h.writes).toBe(0)
    expect(h.downloads).toEqual([])
    expect(h.errors).toEqual([])
}

//#endregion

describe('PNG, JSON and .risum with a large asset', () => {
    for (const source of SOURCES) {
        test(`(R) a v3 PNG export with a 65 MiB asset is refused before a writer opens (${source})`, async () => {
            useSource(source)
            env.sizes.set(BIG, 65 * MIB)
            expect(await exportCharacterCard(card([BIG]), 'png', { spec: 'v3' })).toBe(false)
            expectNothingOpened()
            expect(h.notices).toHaveLength(1)
            expect(h.notices[0]).toContain('Big Video')
        })
    }

    test('(R) a v2 PNG export with a large vits file is refused before a writer opens', async () => {
        env.sizes.set(BIG, 65 * MIB)
        const char = card([], { ttsMode: 'vits', vits: { files: { 'big.wav': BIG } } })
        expect(await exportCharacterCard(char, 'png', { spec: 'v2' })).toBe(false)
        expectNothingOpened()
        expect(h.notices[0]).toContain('big.wav')
    })

    test('(R) a v3 JSON export with a 65 MiB asset is refused before the file is downloaded', async () => {
        env.sizes.set(BIG, 65 * MIB)
        expect(await exportCharacterCard(card([BIG]), 'json', { spec: 'v3' })).toBe(false)
        expectNothingOpened()
        expect(h.notices[0]).toContain('Big Video')
    })

    test('(R) a .risum export with a 65 MiB asset is refused before it is built or downloaded', async () => {
        env.sizes.set(BIG, 65 * MIB)
        expect(await exportModuleLegacy(moduleOf([BIG]), { alertEnd: false })).toBeNull()
        expectNothingOpened()
        expect(h.reads).toEqual([])
        expect(h.notices[0]).toContain('Big Video')
    })

    test('(R) the notice names every large asset once, by display name', async () => {
        env.sizes.set(BIG, 65 * MIB)
        env.sizes.set(SMALL, 70 * MIB)
        const char = card([BIG, SMALL, BIG])
        expect(await exportCharacterCard(char, 'png', { spec: 'v3' })).toBe(false)
        expect(h.notices).toHaveLength(1)
        expect(h.notices[0]).toContain('Big Video')
        expect(h.notices[0]).toContain('asset 1')
        expect(h.notices[0].split('Big Video').length).toBe(2)
    })

    test('(G) an asset of exactly 64 MiB is not large', async () => {
        env.sizes.set(BIG, 64 * MIB)
        expect(await exportCharacterCard(card([BIG]), 'png', { spec: 'v3' })).toBe(true)
        expect(h.notices).toEqual([])
        expect(h.errors).toEqual([])
    })

    test('(R) one byte above 64 MiB is large', async () => {
        env.sizes.set(BIG, 64 * MIB + 1)
        expect(await exportCharacterCard(card([BIG]), 'png', { spec: 'v3' })).toBe(false)
        expectNothingOpened()
    })

    test('(G) an asset whose size cannot be read is not large and takes the whole-read path', async () => {
        env.statFails = true
        expect(await exportCharacterCard(card([BIG]), 'png', { spec: 'v3' })).toBe(true)
        expect(h.notices).toEqual([])
        expect(h.reads).toContain(BIG)
    })

    test('(G) a card with only small assets exports as before', async () => {
        env.sizes.set(BIG, 1 * MIB)
        expect(await exportCharacterCard(card([BIG]), 'json', { spec: 'v3' })).toBe(true)
        expect(h.downloads).toHaveLength(1)
        expect(h.notices).toEqual([])
    })
})

describe('CharX headroom', () => {
    // Each asset is under the import cap, so the total is what refuses (the cap is checked first).
    const FIVE = Array.from({ length: 5 }, (_, i) => key(`h${i}`))
    const setFive = () => {
        for (const name of FIVE) {
            env.sizes.set(name, Math.floor(0.9 * GIB))
        }
    }

    test('(R) a CharX whose assets add up past the 4 GiB headroom is refused before a writer opens', async () => {
        setFive()
        expect(await exportCharacterCard(card(FIVE), 'charx', { spec: 'v3' })).toBe(false)
        expectNothingOpened()
        expect(h.notices).toHaveLength(1)
        expect(h.notices[0]).not.toContain('Big Video')
        expect(h.notices[0]).toContain('GiB')
    })

    test('(G) a CharX with one large asset under the headroom proceeds and streams the asset', async () => {
        env.sizes.set(BIG, 65 * MIB)
        env.served.set(BIG, 0)
        expect(await exportCharacterCard(card([BIG]), 'charx', { spec: 'v3' })).toBe(true)
        expect(h.notices).toEqual([])
        expect(h.errors).toEqual([])
        expect(h.inits).toHaveLength(1)
        // never read whole: two passes over the pieces
        expect(h.reads).not.toContain(BIG)
        expect(env.served.get(BIG)).toBe(2)
    })

    test('(R) a module CharX over the headroom is refused before its save dialog opens and before anything is saved', async () => {
        setFive()
        await exportModule(moduleOf(FIVE), { alertEnd: false })
        expectNothingOpened()
        expect(h.saved).toBe(0)
        expect(h.notices).toHaveLength(1)
    })

    test('(N) a refused module CharX shows one notice: the card export it runs does not check again', async () => {
        setFive()
        await exportModule(moduleOf(FIVE), { alertEnd: false })
        expect(h.notices).toHaveLength(1)
    })

    test('(N) a module CharX with a large asset under the headroom proceeds with one dialog and streams it', async () => {
        env.sizes.set(BIG, 65 * MIB)
        env.served.set(BIG, 0)
        await exportModule(moduleOf([BIG]), { alertEnd: false })
        expect(h.inits).toEqual(['Synthetic Module.module'])
        expect(h.notices).toEqual([])
        expect(h.errors).toEqual([])
        // the module's own check is passed on, so the card export does not size the asset again
        expect(env.statCalls).toBe(1)
        expect(h.reads).not.toContain(BIG)
        expect(env.served.get(BIG)).toBe(2)
    })
})

describe('CharX import cap', () => {
    test('(R) a CharX with an asset above the import cap is refused before a writer opens, naming it', async () => {
        env.sizes.set(BIG, GIB + 1)
        expect(await exportCharacterCard(card([BIG]), 'charx', { spec: 'v3' })).toBe(false)
        expectNothingOpened()
        expect(h.reads).not.toContain(BIG)
        expect(h.notices).toHaveLength(1)
        expect(h.notices[0]).toContain('Big Video')
    })

    test('(R) a module CharX with an asset above the import cap is refused before its save dialog and before anything is saved', async () => {
        env.sizes.set(BIG, GIB + 1)
        await exportModule(moduleOf([BIG]), { alertEnd: false })
        expectNothingOpened()
        expect(h.saved).toBe(0)
        expect(h.notices).toHaveLength(1)
        expect(h.notices[0]).toContain('Big Video')
    })

    test('(R) the page store limit is the cap when it is lower than 1 GiB', async () => {
        noteSelectedStore('opfs-transitional', env.store as ByteStore)
        env.sizes.set(BIG, 201 * MIB)
        expect(await exportCharacterCard(card([BIG]), 'charx', { spec: 'v3' })).toBe(false)
        expectNothingOpened()
        expect(h.notices[0]).toContain('Big Video')
    })

    test('(G) a PNG export keeps its own large-asset refusal, not the cap\'s', async () => {
        env.sizes.set(BIG, GIB + 1)
        expect(await exportCharacterCard(card([BIG]), 'png', { spec: 'v3' })).toBe(false)
        expect(h.notices[0]).toContain('Export as CharX')
    })
})

describe('a large CharX asset is streamed', () => {
    const CHUNK = 4 * MIB

    function serveBig(size = 65 * MIB): void {
        env.sizes.set(BIG, size)
        env.served.set(BIG, 0)
    }

    test('(R) no write is above the 4 MiB hand-on size with a full-size asset at the seam', async () => {
        serveBig()
        // what `readImage` would return if the export read the asset whole
        env.whole.set(BIG, new Uint8Array(65 * MIB))
        expect(await exportCharacterCard(card([BIG]), 'charx', { spec: 'v3' })).toBe(true)
        expect(Math.max(...h.writeSizes)).toBeLessThanOrEqual(CHUNK)
        // 65 MiB in 4 MiB writes: 17 of them, the last of 1 MiB
        expect(h.writeSizes.filter(size => size === CHUNK)).toHaveLength(16)
        expect(h.writeSizes.filter(size => size === MIB)).toHaveLength(1)
    })

    test('(R) a large key is never passed to readImage, in a card, a charxJpeg card or a module CharX', async () => {
        serveBig()
        expect(await exportCharacterCard(card([BIG]), 'charx', { spec: 'v3' })).toBe(true)
        expect(await exportCharacterCard(card([BIG]), 'charxJpeg', { spec: 'v3' })).toBe(true)
        await exportModule(moduleOf([BIG]), { alertEnd: false })
        expect(h.errors).toEqual([])
        expect(h.reads).not.toContain(BIG)
        // each export read the asset twice
        expect(env.served.get(BIG)).toBe(6)
    })

    test('(G) a small asset of the same card is still read whole', async () => {
        serveBig()
        env.sizes.set(SMALL, 1 * MIB)
        expect(await exportCharacterCard(card([BIG, SMALL]), 'charx', { spec: 'v3' })).toBe(true)
        expect(h.reads).toContain(SMALL)
        expect(h.reads).not.toContain(BIG)
    })

    describe('progress', () => {
        test('(R) on the web the wait text shows the checking pass and then the writing pass', async () => {
            env.isTauri = false
            useSource('web')
            serveBig()
            expect(await exportCharacterCard(card([BIG]), 'charx', { spec: 'v3' })).toBe(true)
            const phases = h.waits.filter(text => text.startsWith('Checking') || text.startsWith('Writing Big'))
            const firstWriting = phases.findIndex(text => text.startsWith('Writing'))
            expect(firstWriting).toBeGreaterThan(0)
            expect(phases.slice(0, firstWriting).every(text => text.startsWith('Checking'))).toBe(true)
            expect(phases.slice(firstWriting).every(text => text.startsWith('Writing'))).toBe(true)
            expect(phases[0]).toBe(language.exportCheckingAsset('Big Video', 4, 65))
            expect(phases[firstWriting - 1]).toBe(language.exportCheckingAsset('Big Video', 65, 65))
            expect(phases[firstWriting]).toBe(language.exportStreamingAsset('Big Video', 4, 65))
            expect(phases[phases.length - 1]).toBe(language.exportStreamingAsset('Big Video', 65, 65))
        })

        test('(G) on Tauri the wait gate is not used until the Cancel stage; the per-asset percentage stays', async () => {
            serveBig()
            expect(await exportCharacterCard(card([BIG]), 'charx', { spec: 'v3' })).toBe(true)
            expect(h.waits).toEqual([])
        })
    })

    describe('a read that fails names the asset and never the key', () => {
        function expectNamed(): void {
            expect(h.errors).toHaveLength(1)
            expect(h.errors[0]).toContain('Big Video')
            expect(h.errors[0]).not.toContain(BIG)
            expect(h.stacks[0]).not.toContain(BIG)
        }

        beforeEach(() => {
            vi.spyOn(console, 'error').mockImplementation(() => { })
        })

        for (const source of SOURCES) {
            test(`(N) ${source}: a read that fails after the first piece`, async () => {
                useSource(source)
                serveBig()
                env.failMid.add(BIG)
                expect(await exportCharacterCard(card([BIG]), 'charx', { spec: 'v3' })).toBe(false)
                expectNamed()
            })
        }

        test('(N) tauri: the asset is gone when the second pass opens it', async () => {
            useSource('tauri')
            serveBig()
            env.failOpenFrom.set(BIG, 2)
            expect(await exportCharacterCard(card([BIG]), 'charx', { spec: 'v3' })).toBe(false)
            expectNamed()
        })

        test('(N) node: the first range fails again after being re-sent', async () => {
            useSource('node')
            serveBig()
            // the size probe is the first open; both attempts of the first pass fail
            env.failOpenFrom.set(BIG, 2)
            expect(await exportCharacterCard(card([BIG]), 'charx', { spec: 'v3' })).toBe(false)
            expectNamed()
        })

        test('(N) a module CharX names the asset the same way', async () => {
            useSource('tauri')
            serveBig()
            env.failMid.add(BIG)
            await exportModule(moduleOf([BIG]), { alertEnd: false })
            expectNamed()
        })
    })
})

describe('Realm share', () => {
    function realmCharacter(assetKeys: string[]): void {
        vi.mocked(getCurrentCharacter).mockReturnValue(card(assetKeys))
    }

    test('(R) a Realm share with a 65 MiB asset is refused before the card is built', async () => {
        env.sizes.set(BIG, 65 * MIB)
        realmCharacter([BIG])
        expect(await shareRealmCardData()).toBeNull()
        expect(h.reads).toEqual([])
        expect(h.errors).toEqual([])
        expect(h.notices).toHaveLength(1)
        expect(h.notices[0]).toContain('Big Video')
        expect(h.notices[0]).not.toMatch(/charx/i)
    })

    test('(N) a Realm share of small assets returns the card and sizes each asset once', async () => {
        env.sizes.set(BIG, 1 * MIB)
        realmCharacter([BIG])
        const shared = await shareRealmCardData()
        expect(shared).not.toBeNull()
        expect(h.notices).toEqual([])
        // the share's own check is passed on, so the card export does not size the asset again
        expect(env.statCalls).toBe(1)
    })
})
