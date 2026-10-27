/**
 * Byte pins and round trips for the card and module exports of `src/ts/characterCards.ts` (`exportCharacterCard`) and
 * `src/ts/process/modules.ts` (`exportModule`, `exportModuleLegacy`).
 *
 * Every test here is a COMPATIBILITY GUARD: it passes on the base before the asset-list, pre-flight and streaming
 * changes of CHORE-375 and must still pass after each of them. It guards the exported bytes of a small card, so a
 * change of loop order, entry name, entry order, metadata or compression setting shows as a different hash. It is not a
 * reproducer of any defect.
 *
 * What runs for real: `exportCharacterCard` and its asset loops, `exportModule`/`writeModuleCard`,
 * `exportModuleLegacy`, `CharXWriter` on the real fflate, the PNG chunk writer, `compressImage` and `getImageType`, and the
 * importers used for the round trips (`CharXImporter`, `PngChunk.read`, `readModule`).
 * What is replaced: the asset reads (`readImage`, `loadAsset`) and the writer (`LocalWriter` records every chunk it is
 * handed, `downloadFile` records its bytes), the alerts, the database, and the lossy codec. The RPack permutation is
 * replaced by a fixed invertible byte map, so the `.risum` hash pins the container layout and not the real table.
 * "Compression on" is the real `compressImage` with `imageCompression` set and `doLossyCompression` replaced by a fixed
 * byte transform: it pins the code path (which image types go to the codec, and in which order), not real codec bytes.
 * `charxJpeg` replaces `CharXWriter.writeJpeg` (a canvas and image decode) with fixed bytes, so it pins the call
 * position and the zip that follows, not the canvas output. A mocked writer is not evidence of native file behaviour.
 *
 * Determinism: the time zone is pinned before any import (zip header times are local-time fields), `Date` is faked at a
 * fixed instant (zip header times and `modification_date`), and `uuid` is fixed.
 *
 * Card A is the pinned card: it holds an `http(s):` entry, an `embeded://` entry and one repeated key (which the
 * exporter does not de-duplicate). Card B is the round-trip card without the entries an importer drops or refuses.
 * A v2 export reads its assets only from the vits files: the emotion and additional-asset loops there find nothing to
 * read, and the pinned hashes keep it that way.
 */
import { createHash } from 'node:crypto'
import crc32 from 'crc/crc32'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const h = vi.hoisted(() => {
    // Zip header times are local-time fields: a fixed non-UTC zone shows that the pin is in force.
    process.env.TZ = 'Asia/Seoul'
    return {
        chunks: [] as Uint8Array[],
        downloads: [] as Array<{ name: string, data: Uint8Array }>,
        errors: [] as string[],
        assets: new Map<string, Uint8Array>(),
        saved: new Map<string, Uint8Array>(),
        db: { imageCompression: false },
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
    getDatabase: vi.fn(() => ({ statics: { imports: 0 }, characters: [], goCharacterOnImport: false })),
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

import { exportCharacterCard } from 'src/ts/characterCards'
import { exportModule, exportModuleLegacy, readModule, type RisuModule } from 'src/ts/process/modules'
import { CharXImporter, CharXWriter } from 'src/ts/process/processzip'
import { PngChunk } from 'src/ts/pngChunk'
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

/** A PNG whose width is `seed`, optionally carrying one tEXt chunk, so each synthetic image has bytes of its own. */
function syntheticPng(seed: number, text?: [string, string]): Uint8Array {
    const ihdr = new Uint8Array(13)
    new DataView(ihdr.buffer).setUint32(0, seed)
    ihdr.set([0, 0, 0, 1, 8, 2, 0, 0, 0], 4)
    const parts = [
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', ihdr),
    ]
    if (text) {
        parts.push(pngChunk('tEXt', Buffer.from(text[0] + '\0' + text[1], 'latin1')))
    }
    parts.push(pngChunk('IEND', new Uint8Array()))
    return Buffer.concat(parts)
}

const ASSETS: Record<string, Uint8Array> = {
    portrait: syntheticPng(1),
    pngText: syntheticPng(2, ['Comment', 'a text chunk that the CharX metadata carries']),
    emotion: syntheticPng(3),
    // RIFF....WEBP: a type the codec never takes
    webp: Uint8Array.from([0x52, 0x49, 0x46, 0x46, 20, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4, 5, 6, 7, 8]),
    // an Unknown blob (an mp3-like header)
    mp3: Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0x21, 0xff, 0xfb, 0x90, 0x44, 9, 8, 7, 6, 5]),
    gif: Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0, 0xff, 0xff, 0xff, 0, 0, 0, 0x3b]),
    voiceA: Uint8Array.from([0x52, 0x49, 0x46, 0x46, 12, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 11, 12, 13, 14]),
    voiceB: Uint8Array.from([0x52, 0x49, 0x46, 0x46, 12, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 21, 22, 23, 24, 25]),
}

const KEYS: Record<keyof typeof ASSETS, string> = {
    portrait: 'key-portrait',
    pngText: 'key-png-text',
    emotion: 'key-emotion',
    webp: 'key-webp',
    mp3: 'key-mp3',
    gif: 'key-gif',
    voiceA: 'key-voice-a',
    voiceB: 'key-voice-b',
}

function fillStore() {
    h.assets.clear()
    for (const name of Object.keys(ASSETS)) {
        h.assets.set(KEYS[name], ASSETS[name])
    }
}

type CardAsset = { type: string, uri: string, name: string, ext: string }

function syntheticCharacter(withUriEntries: boolean): character {
    const ccAssets: CardAsset[] = [
        { type: 'x-risu-asset', uri: KEYS.webp, name: 'webp one', ext: 'webp' },
        { type: 'x-risu-asset', uri: KEYS.mp3, name: 'song', ext: 'mp3' },
        { type: 'background', uri: KEYS.pngText, name: 'backdrop', ext: 'png' },
        // the repeated key: read and written again, under a de-duplicated entry path when the name repeats as well
        { type: 'x-risu-asset', uri: KEYS.webp, name: withUriEntries ? 'webp one' : 'webp two', ext: 'webp' },
    ]
    if (withUriEntries) {
        ccAssets.push(
            { type: 'x-risu-asset', uri: 'https://example.invalid/remote.png', name: 'remote', ext: 'png' },
            { type: 'icon', uri: 'embeded://assets/icon/image/already.png', name: 'already', ext: 'png' },
        )
    }
    return {
        name: 'Synthetic Card',
        image: KEYS.portrait,
        globalLore: [],
        desc: 'a description',
        firstMessage: 'hello',
        creatorNotes: 'notes',
        ccAssets,
        additionalAssets: [['extra', KEYS.gif, 'gif']],
        emotionImages: [['happy', KEYS.emotion]],
        ttsMode: 'vits',
        vits: { files: { 'a.wav': KEYS.voiceA, 'b.wav': KEYS.voiceB } },
    } as unknown as character
}

function syntheticModule(withUriEntries: boolean): RisuModule {
    const assets: [string, string, string][] = [
        ['webp one', KEYS.webp, 'webp'],
        ['song', KEYS.mp3, 'mp3'],
        ['backdrop', KEYS.pngText, 'png'],
        ['happy-gif', KEYS.gif, 'gif'],
        [withUriEntries ? 'webp one' : 'webp two', KEYS.webp, 'webp'],
    ]
    if (withUriEntries) {
        assets.push(
            ['remote', 'https://example.invalid/remote.png', 'png'],
            ['already', 'embeded://assets/icon/image/already.png', 'png'],
        )
    }
    return { name: 'Synthetic Module', description: 'module notes', id: 'module-1', assets, icon: KEYS.portrait }
}

//#endregion

//#region running an export

const FIXED_INSTANT = '2026-03-04T05:06:07.000Z'

function concat(parts: Uint8Array[]): Uint8Array {
    return Buffer.concat(parts)
}

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex')
}

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
    return concat(h.chunks)
}

type Format = 'charx v3' | 'charxJpeg v3' | 'png v2' | 'png v3' | 'json v2' | 'json v3' | 'risum' | 'module charx'

const exporters: Record<Format, (withUriEntries: boolean) => Promise<unknown>> = {
    'charx v3': (u) => exportCharacterCard(syntheticCharacter(u), 'charx', { spec: 'v3' }),
    'charxJpeg v3': (u) => exportCharacterCard(syntheticCharacter(u), 'charxJpeg', { spec: 'v3' }),
    'png v2': (u) => exportCharacterCard(syntheticCharacter(u), 'png', { spec: 'v2' }),
    'png v3': (u) => exportCharacterCard(syntheticCharacter(u), 'png', { spec: 'v3' }),
    'json v2': (u) => exportCharacterCard(syntheticCharacter(u), 'json', { spec: 'v2' }),
    'json v3': (u) => exportCharacterCard(syntheticCharacter(u), 'json', { spec: 'v3' }),
    'risum': (u) => exportModuleLegacy(syntheticModule(u), { alertEnd: false }),
    'module charx': (u) => exportModule(syntheticModule(u), { alertEnd: false }),
}

// The jpeg prefix that stands in for the canvas output of `CharXWriter.writeJpeg`.
const JPEG_STAND_IN = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x4a, 0x50, 0xff, 0xd9])

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(FIXED_INSTANT))
    h.saved.clear()
    h.db.imageCompression = false
    fillStore()
    vi.spyOn(CharXWriter.prototype, 'writeJpeg').mockImplementation(async function (this: CharXWriter) {
        this.apb.append(JPEG_STAND_IN)
    })
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

//#endregion

describe('fixed environment', () => {
    test('(G) the time zone and clock are pinned', () => {
        expect(new Date(FIXED_INSTANT).getTimezoneOffset()).toBe(-540)
        expect(Date.now()).toBe(Date.parse(FIXED_INSTANT))
    })
})

//#region pinned hashes

// SHA-256 of the bytes written for card A, per format and compression setting, taken on the base before CHORE-375.
const PINNED: Record<string, string> = {
    'charx v3 plain': '470145053f3c090b4ffb52f96f10c961782c7fe104c3ebc51d2affbdfb94acf7',
    'charx v3 lossy': '74d8c70f1bc5c2db701f65875f637c91203dcd15f1f9e38a934e082ff1cd8a62',
    'charxJpeg v3 plain': 'e17b3cd2c8bb26df2476ca9587dfc81c421ac26fd011cc9e5a25bacefd75a720',
    'charxJpeg v3 lossy': '200718f3c4b5fb4f436aaaaccf5dbe4cb6a451888ab2dc67fb1475c325e9c60a',
    'png v2 plain': 'bf1f5809a4aca7185c051cb4d21ed1a599391ff0bc7e80baa71e36fada60ae40',
    'png v2 lossy': 'bf1f5809a4aca7185c051cb4d21ed1a599391ff0bc7e80baa71e36fada60ae40',
    'png v3 plain': '05dcd5b3d1f7f69ae7fd9bedf4f7968fb063dba020e8c90763678366b4d1678e',
    'png v3 lossy': '4a6459347369106007745bbc3e3d78f6863102998d50e328727278923bca5406',
    'json v2 plain': 'caaa4ab732c903c5e1a72ff10fc835734e283ec641312206ceadc1a4b7d3dded',
    'json v2 lossy': 'caaa4ab732c903c5e1a72ff10fc835734e283ec641312206ceadc1a4b7d3dded',
    'json v3 plain': '5bc98a462d6658e0174602c57b8887b449107bf3ee86667924f3f211fd48e245',
    'json v3 lossy': 'be4f6af46cbb559ae3d4652ed697e5e8f5fa7df8143a749fdc5f79f68159d80d',
    'risum plain': '6d4db874da25ca330bfc040b35ea4b218ac083f176f2a55b50035babc7449427',
    'risum lossy': '6bbb60cace0a475761df14b2c1f4633d56b62dded2f6632187505d394f4784d8',
    'module charx plain': 'c9378ae767038ae9eb839985618141043223060f05dcad1881fc8ec2af26e9f8',
    'module charx lossy': '4a5eae90fec7eebf8f72623af54a0be79e9c03dc52939462484dd11559772871',
}

describe('(G) exported bytes of card A are pinned', () => {
    const formats = Object.keys(exporters) as Format[]
    for (const format of formats) {
        for (const compression of ['plain', 'lossy'] as const) {
            const label = `${format} ${compression}`
            test(label, async () => {
                h.db.imageCompression = compression === 'lossy'
                const bytes = await written(() => exporters[format](true))
                expect(sha256(bytes)).toBe(PINNED[label])
            })
        }
    }

    test('the same export twice gives the same bytes', async () => {
        const first = await written(() => exporters['charx v3'](true))
        const second = await written(() => exporters['charx v3'](true))
        expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true)
    })

    test('compression changes the bytes of an image the codec takes and leaves WebP and Unknown alone', async () => {
        const plain = await written(() => exporters['charx v3'](true))
        h.db.imageCompression = true
        const lossy = await written(() => exporters['charx v3'](true))
        expect(Buffer.from(plain).equals(Buffer.from(lossy))).toBe(false)
        // WebP and the mp3-like blob are stored as they were in both runs (level 0 entries hold raw bytes)
        for (const bytes of [ASSETS.webp, ASSETS.mp3]) {
            expect(Buffer.from(plain).includes(Buffer.from(bytes))).toBe(true)
            expect(Buffer.from(lossy).includes(Buffer.from(bytes))).toBe(true)
        }
        expect(Buffer.from(plain).includes(Buffer.from(ASSETS.emotion))).toBe(true)
        expect(Buffer.from(lossy).includes(Buffer.from(ASSETS.emotion))).toBe(false)
    })
})

//#endregion

//#region round trips

function bytesEqual(a: Uint8Array | undefined, b: Uint8Array): boolean {
    return a !== undefined && Buffer.from(a).equals(Buffer.from(b))
}

const EXPECTED_BY_NAME: Record<string, Uint8Array> = {
    'webp one': ASSETS.webp,
    'webp two': ASSETS.webp,
    'song': ASSETS.mp3,
    'backdrop': ASSETS.pngText,
    'extra': ASSETS.gif,
    'happy-gif': ASSETS.gif,
    'happy': ASSETS.emotion,
    'main': ASSETS.portrait,
}

type CardJson = { data: { assets: CardAsset[], extensions: { risuai: { vits: Record<string, string> } } } }

async function importCharx(bytes: Uint8Array): Promise<{ card: CardJson, importer: CharXImporter }> {
    const importer = new CharXImporter()
    await importer.parse(bytes)
    await importer.done()
    expect(importer.cardData).toBeDefined()
    return { card: JSON.parse(importer.cardData as string) as CardJson, importer }
}

function expectCharxAssetsBack(card: CardJson, importer: CharXImporter, names: string[]) {
    const seen: string[] = []
    for (const asset of card.data.assets) {
        expect(asset.uri.startsWith('embeded://')).toBe(true)
        const saved = h.saved.get(importer.assets[asset.uri.slice('embeded://'.length)])
        expect(bytesEqual(saved, EXPECTED_BY_NAME[asset.name]), asset.name).toBe(true)
        seen.push(asset.name)
    }
    expect(seen.sort()).toEqual(names.sort())
}

describe('(G) card B comes back through its importer with its asset bytes', () => {
    const charxNames = ['webp one', 'song', 'backdrop', 'webp two', 'extra', 'happy', 'main']

    test('character CharX', async () => {
        const bytes = await written(() => exporters['charx v3'](false))
        const { card, importer } = await importCharx(bytes)
        expectCharxAssetsBack(card, importer, charxNames)
    })

    test('character CharX with a jpeg prefix is written and its assets read back', async () => {
        const bytes = await written(() => exporters['charxJpeg v3'](false))
        expect(Buffer.from(bytes.subarray(0, JPEG_STAND_IN.length)).equals(Buffer.from(JPEG_STAND_IN))).toBe(true)
        // the prefix shifts every offset in the archive, so the importer reads the zip that follows it
        const { card, importer } = await importCharx(bytes.subarray(JPEG_STAND_IN.length))
        expectCharxAssetsBack(card, importer, charxNames)
    })

    test('module CharX', async () => {
        const bytes = await written(() => exporters['module charx'](false))
        const { card, importer } = await importCharx(bytes)
        expectCharxAssetsBack(card, importer, ['webp one', 'song', 'backdrop', 'happy-gif', 'webp two', 'main'])
        // the module itself rides along as module.risum
        expect(importer.moduleData).toBeDefined()
    })

    test('PNG v2 carries the vits files as chunks', async () => {
        const bytes = await written(() => exporters['png v2'](false))
        const chunks = PngChunk.read(bytes, ['chara', 'chara-ext-asset_:1', 'chara-ext-asset_:2'])
        const card = JSON.parse(Buffer.from(chunks['chara'], 'base64').toString('utf-8')) as CardJson
        const vits = card.data.extensions.risuai.vits
        expect(Object.keys(vits).sort()).toEqual(['a.wav', 'b.wav'])
        expect(bytesEqual(Buffer.from(chunks[vits['a.wav'].replace('__asset:', 'chara-ext-asset_:')], 'base64'), ASSETS.voiceA)).toBe(true)
        expect(bytesEqual(Buffer.from(chunks[vits['b.wav'].replace('__asset:', 'chara-ext-asset_:')], 'base64'), ASSETS.voiceB)).toBe(true)
    })

    test('PNG v3 carries every asset as a chunk and keeps the default portrait entry', async () => {
        const bytes = await written(() => exporters['png v3'](false))
        const keys = ['ccv3'].concat([1, 2, 3, 4, 5, 6].map(n => 'chara-ext-asset_:' + n))
        const chunks = PngChunk.read(bytes, keys)
        const card = JSON.parse(Buffer.from(chunks['ccv3'], 'base64').toString('utf-8')) as CardJson
        const names: string[] = []
        for (const asset of card.data.assets) {
            if (asset.uri === 'ccdefault:') {
                expect(asset.name).toBe('main')
                continue
            }
            const chunk = chunks[asset.uri.replace('__asset:', 'chara-ext-asset_:')]
            expect(bytesEqual(Buffer.from(chunk, 'base64'), EXPECTED_BY_NAME[asset.name]), asset.name).toBe(true)
            names.push(asset.name)
        }
        expect(names.sort()).toEqual(['backdrop', 'extra', 'happy', 'song', 'webp one', 'webp two'])
    })

    test('JSON v3 carries every asset as a data URI', async () => {
        const bytes = await written(() => exporters['json v3'](false))
        const card = JSON.parse(Buffer.from(bytes).toString('utf-8')) as CardJson
        const names: string[] = []
        for (const asset of card.data.assets) {
            // unlike PNG, a JSON card inlines the portrait under the default entry
            const prefix = 'data:application/octet-stream;base64,'
            expect(asset.uri.startsWith(prefix)).toBe(true)
            expect(bytesEqual(Buffer.from(asset.uri.slice(prefix.length), 'base64'), EXPECTED_BY_NAME[asset.name]), asset.name).toBe(true)
            names.push(asset.name)
        }
        expect(names.sort()).toEqual(['backdrop', 'extra', 'happy', 'main', 'song', 'webp one', 'webp two'])
    })

    test('.risum', async () => {
        const bytes = await written(() => exporters['risum'](false))
        const module = await readModule(bytes)
        const names = (module.assets ?? []).map(a => a[0])
        expect(names).toEqual(['webp one', 'song', 'backdrop', 'happy-gif', 'webp two'])
        for (const [name, id] of module.assets ?? []) {
            expect(bytesEqual(h.saved.get(id), EXPECTED_BY_NAME[name]), name).toBe(true)
        }
    })
})

//#endregion
