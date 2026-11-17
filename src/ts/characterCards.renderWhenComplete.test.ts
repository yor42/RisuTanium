/**
 * The fork-only character key `risutanium_render_when_complete` through the card formats of `src/ts/characterCards.ts`
 * (MC-2170): the key lives in the store and the `.bin`, never in a card. A card export never writes it, and a card import
 * never reads it, wherever the incoming card places it (`data`, `extensions` or `extensions.risuai`).
 *
 * Every test is a compatibility guard: it passes before the field exists and must still pass after. What runs for real:
 * `createBaseV3`, `exportCharacterCard` and its writers, and `importCharacterFile`. What is replaced: the asset reads and
 * saves, the writer, the alerts, the database and the lossy codec. A mocked writer is not evidence of native file behaviour.
 */
import crc32 from 'crc/crc32'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const h = vi.hoisted(() => {
    // Zip header times are local-time fields: a fixed non-UTC zone keeps every run on the same bytes.
    process.env.TZ = 'Asia/Seoul'
    return {
        chunks: [] as Uint8Array[],
        downloads: [] as Array<{ name: string, data: Uint8Array }>,
        errors: [] as string[],
        assets: new Map<string, Uint8Array>(),
        saved: new Map<string, Uint8Array>(),
        db: { imageCompression: false, characters: [] as Array<Record<string, unknown>>, modules: [] as Array<Record<string, unknown>> },
    }
})

vi.mock('uuid', () => ({
    v4: () => 'uuid-1',
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: true,
    isNodeServer: false,
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
        alertNormalWait: vi.fn(async () => { }),
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
    getDatabase: vi.fn(() => ({ statics: { imports: 0 }, characters: h.db.characters, goCharacterOnImport: false })),
    setDatabaseLite: vi.fn(),
    appVer: 'test',
}) as unknown as typeof import('src/ts/storage/database.svelte'))

// The real `util` reads the Tauri window at import time when `isTauri` is on.
vi.mock(import('src/ts/util'), () => {
    class Semaphore {
        private available: number
        private waiting: Array<() => void> = []
        constructor(max: number) { this.available = max }
        async acquire() {
            if (this.available > 0) {
                this.available -= 1
                return
            }
            await new Promise<void>(resolve => this.waiting.push(resolve))
        }
        release() {
            const next = this.waiting.shift()
            if (next) {
                next()
                return
            }
            this.available += 1
        }
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
    const { AppendableBuffer } = await import('src/ts/byteBuffer')
    class LocalWriter {
        async init() { return true }
        async write(data: Uint8Array) { h.chunks.push(data.slice()) }
        async close() { }
        useCancel() { }
        abort() { }
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
        VirtualWriter: class { },
        checkCharOrder: vi.fn(),
        downloadFile: vi.fn(async (name: string, data: Uint8Array) => { h.downloads.push({ name, data: data.slice() }) }),
        forageStorage: {},
        loadAsset: vi.fn(async (key: string) => h.assets.get(key)),
        openURL: vi.fn(),
        pieceStoreOrNull: vi.fn(async () => null),
        readImage: vi.fn(async (key: string) => h.assets.get(key)),
        saveAsset: vi.fn(async (data: Uint8Array) => {
            const id = 'saved-' + h.saved.size
            h.saved.set(id, data.slice())
            return id
        }),
        saveAssetFromPieces: vi.fn(async () => { throw new Error('pieces are not used by a small card') }),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

// The codec stand-in is a fixed byte transform of the same length.
vi.mock(import('src/ts/media/compressImage/lossyCompression'), () => ({
    doLossyCompression: vi.fn(async (data: Uint8Array) => Buffer.from(data.map(b => b ^ 0x5a))),
}))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return h.db } },
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

// A fixed invertible byte map in place of the RPack table (3 is added after multiplying by 7; 183 is 7 inverted mod 256).
vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => Uint8Array.from(data, b => (b * 7 + 3) & 0xff)),
    decodeRPack: vi.fn(async (data: Uint8Array) => Uint8Array.from(data, b => ((b - 3 + 256) * 183) & 0xff)),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

//#endregion

import { createBaseV3, exportCharacterCard, importCharacterFile } from 'src/ts/characterCards'
import type { character } from 'src/ts/storage/database.svelte'


//#region synthetic assets

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

/** A PNG whose width is `seed`, so each synthetic image has bytes of its own. */
function syntheticPng(seed: number): Uint8Array {
    const ihdr = new Uint8Array(13)
    new DataView(ihdr.buffer).setUint32(0, seed)
    ihdr.set([0, 0, 0, 1, 8, 2, 0, 0, 0], 4)
    return Buffer.concat([
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', ihdr),
        pngChunk('IEND', new Uint8Array()),
    ])
}

const PORTRAIT_KEY = 'key-portrait'
const EMOTION_KEY = 'key-emotion'
const EXTRA_KEY = 'key-extra'

function fillStore() {
    h.assets.clear()
    h.assets.set(PORTRAIT_KEY, syntheticPng(1))
    h.assets.set(EMOTION_KEY, syntheticPng(2))
    h.assets.set(EXTRA_KEY, syntheticPng(3))
}

/** A character holding a few assets, so the cards carry asset chunks and entries as a real card does. */
function characterWith(extra: Record<string, unknown>): character {
    return {
        name: 'Retained Holder',
        image: PORTRAIT_KEY,
        globalLore: [],
        desc: 'a description',
        firstMessage: 'hello',
        creatorNotes: 'notes',
        ccAssets: [],
        additionalAssets: [['extra', EXTRA_KEY, 'png']],
        emotionImages: [['happy', EMOTION_KEY]],
        ...extra,
    } as unknown as character
}

//#endregion

//#region running an export and an import

const FIXED_INSTANT = '2026-03-04T05:06:07.000Z'

/** Runs one export and returns what was written: the writer's chunks in order, or the one downloaded file. */
async function written(run: () => Promise<unknown>): Promise<Uint8Array> {
    h.chunks.length = 0
    h.downloads.length = 0
    h.errors.length = 0
    await run()
    expect(h.errors).toEqual([])
    if (h.downloads.length > 0) {
        expect(h.chunks).toEqual([])
        expect(h.downloads).toHaveLength(1)
        return h.downloads[0].data
    }
    expect(h.chunks.length).toBeGreaterThan(0)
    return Buffer.concat(h.chunks)
}

type Route = { label: string, name: string, bytes: (char: character) => Promise<Uint8Array> }

const ROUTES: Route[] = [
    { label: 'PNG v3', name: 'card.png', bytes: (char) => written(() => exportCharacterCard(char, 'png', { spec: 'v3' })) },
    { label: 'CharX v3', name: 'card.charx', bytes: (char) => written(() => exportCharacterCard(char, 'charx', { spec: 'v3' })) },
    { label: 'JSON v3', name: 'card.json', bytes: (char) => written(() => exportCharacterCard(char, 'json', { spec: 'v3' })) },
]

/** The character the real importer builds from the bytes; it is added to the database list like any import. */
async function importedFrom(name: string, bytes: Uint8Array): Promise<character> {
    h.db.characters.length = 0
    h.errors.length = 0
    const outcome = await importCharacterFile({ name, data: bytes, returnCharacter: true })
    expect(h.errors).toEqual([])
    expect(outcome.kind).toBe('imported')
    if (outcome.kind !== 'imported') {
        throw new Error(`The import ended as ${outcome.kind}.`)
    }
    const char = outcome.character ?? h.db.characters[outcome.index as number]
    expect(char).toBeDefined()
    return char as unknown as character
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(FIXED_INSTANT))
    h.saved.clear()
    h.db.characters.length = 0
    fillStore()
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

//#endregion

beforeEach(() => {
    h.db.modules.length = 0
})

const KEY = 'risutanium_render_when_complete'

describe('the card the export builds carries no render-when-complete key', () => {
    test('createBaseV3 holds no key of that name anywhere, and the live character still holds it', () => {
        const live = characterWith({ [KEY]: true })

        const card = createBaseV3(live)

        expect(JSON.stringify(card)).not.toContain(KEY)
        expect((live as unknown as Record<string, unknown>)[KEY]).toBe(true)
    })

    for (const route of ROUTES) {
        test(`${route.label}: the exported bytes never name the key, and the imported character holds none`, async () => {
            const bytes = await route.bytes(characterWith({ [KEY]: true }))

            expect(Buffer.from(bytes).includes(Buffer.from(KEY))).toBe(false)
            const imported = await importedFrom(route.name, bytes)
            expect(Object.hasOwn(imported, KEY)).toBe(false)
        })
    }
})

describe('a v3 card that carries the key supplies nothing', () => {
    const placements: Array<[string, (card: Record<string, unknown>) => void]> = [
        ['data', (card) => { (card.data as Record<string, unknown>)[KEY] = true }],
        ['extensions', (card) => { ((card.data as Record<string, unknown>).extensions as Record<string, unknown>)[KEY] = true }],
        ['extensions.risuai', (card) => { (((card.data as Record<string, unknown>).extensions as Record<string, unknown>).risuai as Record<string, unknown>)[KEY] = true }],
    ]

    test.each(placements)('the key placed in %s is not set on the imported character', async (_label, place) => {
        const card: Record<string, unknown> = { spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Keyed', description: 'd', first_mes: 'hi', character_version: '1', extensions: { risuai: {} } } }
        place(card)

        const imported = await importedFrom('card.json', new TextEncoder().encode(JSON.stringify(card)))

        expect(Object.hasOwn(imported, KEY)).toBe(false)
        expect(imported.name).toBe('Keyed')
    })
})
