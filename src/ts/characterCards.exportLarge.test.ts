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
    downloads: [] as string[],
    errors: [] as string[],
    notices: [] as string[],
    reads: [] as string[],
    saved: 0,
    png: new Uint8Array() as Uint8Array,
}))

const env = vi.hoisted(() => ({
    isNodeServer: false,
    desktop: false,
    store: {} as unknown,
    nodeStore: null as unknown,
    sizes: new Map<string, number>(),
    statFails: false,
    statCalls: 0,
}))

vi.mock('uuid', () => ({
    v4: () => 'uuid-1',
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: true,
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
        alertError: vi.fn((msg: string | Error) => { h.errors.push(text(msg)) }),
        alertInput: vi.fn(async () => ''),
        alertMd: vi.fn(),
        alertModuleSelect: vi.fn(),
        alertNormal: vi.fn(),
        alertNormalWait: vi.fn(async (msg: string) => { h.notices.push(msg) }),
        alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
        alertWait: vi.fn(),
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
        async write() { h.writes++ }
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
        readImage: vi.fn(async (key: string) => { h.reads.push(key); return h.png }),
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
    readRangedPieces: async function* () { throw new Error('the pre-check never reads pieces') },
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
            return size === undefined ? null : new SizedBlob(size)
        }),
    }
    if (kind === 'node') {
        env.nodeStore = {
            read: vi.fn(async () => ({ bytes: null })),
            piecesRecorded: () => true,
            readPieces: vi.fn(async (name: string) => {
                const size = env.sizes.get(name)
                return size === undefined ? null : { total: size, version: null, pieces: (async function* () { yield new Uint8Array(1) })() }
            }),
        }
    }
}

const SOURCES: SourceKind[] = ['tauri', 'web', 'node']

beforeEach(() => {
    globalThis.safeStructuredClone = structuredClone
    h.inits.length = 0
    h.writes = 0
    h.downloads.length = 0
    h.errors.length = 0
    h.notices.length = 0
    h.reads.length = 0
    h.saved = 0
    h.png = syntheticPng()
    env.sizes.clear()
    env.statFails = false
    env.statCalls = 0
    useSource('tauri')
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
    test('(R) a CharX whose assets add up past the 4 GiB headroom is refused before a writer opens', async () => {
        env.sizes.set(BIG, 2 * GIB)
        env.sizes.set(SMALL, 2 * GIB)
        expect(await exportCharacterCard(card([BIG, SMALL]), 'charx', { spec: 'v3' })).toBe(false)
        expectNothingOpened()
        expect(h.notices).toHaveLength(1)
        expect(h.notices[0]).not.toContain('Big Video')
    })

    test('(G) a CharX with one large asset under the headroom proceeds', async () => {
        env.sizes.set(BIG, 300 * MIB)
        expect(await exportCharacterCard(card([BIG]), 'charx', { spec: 'v3' })).toBe(true)
        expect(h.notices).toEqual([])
        expect(h.inits).toHaveLength(1)
    })

    test('(R) a module CharX over the headroom is refused before its save dialog opens and before anything is saved', async () => {
        const keys = [key('m1'), key('m2'), key('m3')]
        for (const name of keys) {
            env.sizes.set(name, Math.floor(1.4 * GIB))
        }
        await exportModule(moduleOf(keys), { alertEnd: false })
        expectNothingOpened()
        expect(h.saved).toBe(0)
        expect(h.notices).toHaveLength(1)
    })

    test('(N) a refused module CharX shows one notice: the card export it runs does not check again', async () => {
        const keys = [key('m1'), key('m2'), key('m3')]
        for (const name of keys) {
            env.sizes.set(name, Math.floor(1.4 * GIB))
        }
        await exportModule(moduleOf(keys), { alertEnd: false })
        expect(h.notices).toHaveLength(1)
    })

    test('(N) a module CharX with a large asset under the headroom proceeds with one dialog', async () => {
        env.sizes.set(BIG, 100 * MIB)
        await exportModule(moduleOf([BIG]), { alertEnd: false })
        expect(h.inits).toEqual(['Synthetic Module.module'])
        expect(h.notices).toEqual([])
        expect(h.errors).toEqual([])
        // the module's own check is passed on, so the card export does not size the asset again
        expect(env.statCalls).toBe(1)
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
