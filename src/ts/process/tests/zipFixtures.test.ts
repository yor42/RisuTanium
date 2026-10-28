/**
 * Guards for `fflateZipArchive` in `zipFixtures.ts`, the reference descriptor framing.
 *
 * All tests are COMPATIBILITY GUARDS of the helper itself. They use no `CharXWriter` internal except the
 * `write(key, data, level)` call shape and the `charxEncode.jpeg` hook, so they pass before and after the writer's framing changes.
 * - Every local header the helper writes sets flag bit 3 (a data descriptor).
 * - A prefix goes in front of the archive, and the entries read back.
 * - Replaying the entry names (read from the exported archive's central directory), the data and the levels of the
 *   stage A CharX exports through the helper gives the stage A SHA-256 values. The export's own hash is not asserted
 *   here: it changes with the writer's framing and is pinned in `characterCards.exportBytes.test.ts`.
 *
 * The module mocks below are the harness of `characterCards.exportBytes.test.ts`, which runs the real exports with
 * the asset reads, the writer, the alerts, the database and the lossy codec replaced.
 */
import { createHash } from 'node:crypto'
import * as fflate from 'fflate'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { fflateZipArchive, type ZipEntry, type ZipLevel } from './zipFixtures'

//#region module mocks

const h = vi.hoisted(() => {
    // Zip header times are local-time fields: a fixed non-UTC zone makes the replayed hashes reproducible.
    process.env.TZ = 'Asia/Seoul'
    return {
        chunks: [] as Uint8Array[],
        downloads: [] as Array<{ name: string, data: Uint8Array }>,
        errors: [] as string[],
        assets: new Map<string, Uint8Array>(),
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
        saveAsset: vi.fn(async () => 'saved'),
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

vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => Uint8Array.from(data, b => (b * 7 + 3) & 0xff)),
    decodeRPack: vi.fn(async (data: Uint8Array) => Uint8Array.from(data, b => ((b - 3 + 256) * 183) & 0xff)),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

//#endregion

import crc32 from 'crc/crc32'
import { exportCharacterCard } from 'src/ts/characterCards'
import { exportModule } from 'src/ts/process/modules'
import { CharXWriter, charxEncode } from 'src/ts/process/processzip'
import type { character } from 'src/ts/storage/database.svelte'
import type { RisuModule } from 'src/ts/process/modules'

//#region synthetic card A (the card the stage A pins were taken from)

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
    webp: Uint8Array.from([0x52, 0x49, 0x46, 0x46, 20, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4, 5, 6, 7, 8]),
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

function syntheticCharacter(): character {
    return {
        name: 'Synthetic Card',
        image: KEYS.portrait,
        globalLore: [],
        desc: 'a description',
        firstMessage: 'hello',
        creatorNotes: 'notes',
        ccAssets: [
            { type: 'x-risu-asset', uri: KEYS.webp, name: 'webp one', ext: 'webp' },
            { type: 'x-risu-asset', uri: KEYS.mp3, name: 'song', ext: 'mp3' },
            { type: 'background', uri: KEYS.pngText, name: 'backdrop', ext: 'png' },
            { type: 'x-risu-asset', uri: KEYS.webp, name: 'webp one', ext: 'webp' },
            { type: 'x-risu-asset', uri: 'https://example.invalid/remote.png', name: 'remote', ext: 'png' },
            { type: 'icon', uri: 'embeded://assets/icon/image/already.png', name: 'already', ext: 'png' },
        ],
        additionalAssets: [['extra', KEYS.gif, 'gif']],
        emotionImages: [['happy', KEYS.emotion]],
        ttsMode: 'vits',
        vits: { files: { 'a.wav': KEYS.voiceA, 'b.wav': KEYS.voiceB } },
    } as unknown as character
}

function syntheticModule(): RisuModule {
    return {
        name: 'Synthetic Module',
        description: 'module notes',
        id: 'module-1',
        assets: [
            ['webp one', KEYS.webp, 'webp'],
            ['song', KEYS.mp3, 'mp3'],
            ['backdrop', KEYS.pngText, 'png'],
            ['happy-gif', KEYS.gif, 'gif'],
            ['webp one', KEYS.webp, 'webp'],
            ['remote', 'https://example.invalid/remote.png', 'png'],
            ['already', 'embeded://assets/icon/image/already.png', 'png'],
        ],
        icon: KEYS.portrait,
    }
}

//#endregion

const FIXED_INSTANT = '2026-03-04T05:06:07.000Z'

// The jpeg prefix that stands in for the canvas output of the `charxEncode.jpeg` hook.
const JPEG_STAND_IN = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x4a, 0x50, 0xff, 0xd9])

// The stage A SHA-256 of each CharX export of card A, taken on the base before CHORE-375. They are the reference for the
// descriptor framing. They are separate from the export pins of `characterCards.exportBytes.test.ts` and are never retaken.
const STAGE_A_REFERENCE: Record<string, string> = {
    'charx v3 plain': '470145053f3c090b4ffb52f96f10c961782c7fe104c3ebc51d2affbdfb94acf7',
    'charx v3 lossy': '74d8c70f1bc5c2db701f65875f637c91203dcd15f1f9e38a934e082ff1cd8a62',
    'charxJpeg v3 plain': 'e17b3cd2c8bb26df2476ca9587dfc81c421ac26fd011cc9e5a25bacefd75a720',
    'charxJpeg v3 lossy': '200718f3c4b5fb4f436aaaaccf5dbe4cb6a451888ab2dc67fb1475c325e9c60a',
    'module charx plain': 'c9378ae767038ae9eb839985618141043223060f05dcad1881fc8ec2af26e9f8',
    'module charx lossy': '4a5eae90fec7eebf8f72623af54a0be79e9c03dc52939462484dd11559772871',
}

const exporters: Record<string, () => Promise<unknown>> = {
    'charx v3': () => exportCharacterCard(syntheticCharacter(), 'charx', { spec: 'v3' }),
    'charxJpeg v3': () => exportCharacterCard(syntheticCharacter(), 'charxJpeg', { spec: 'v3' }),
    'module charx': () => exportModule(syntheticModule(), { alertEnd: false }),
}

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex')
}

/**
 * The entry names in an archive's central directory. The directory is found as `eocd - cdSize`, not through the offset
 * field, so a prefix in front of the archive and the way a writer accounts for it do not matter.
 */
function centralNames(archive: Uint8Array): string[] {
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
    let eocd = archive.length - 22
    while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--
    expect(eocd).toBeGreaterThanOrEqual(0)
    const count = view.getUint16(eocd + 10, true)
    let at = eocd - view.getUint32(eocd + 12, true)
    const out: string[] = []
    for (let i = 0; i < count; i++) {
        expect(view.getUint32(at, true)).toBe(0x02014b50)
        const nameLength = view.getUint16(at + 28, true)
        out.push(new TextDecoder().decode(archive.subarray(at + 46, at + 46 + nameLength)))
        at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
    }
    return out
}

type Recorded = { data: Uint8Array, level: ZipLevel | undefined }

/** Runs one export and returns the bytes it wrote with the archive's write calls: the entries and the jpeg prefix. */
async function exportAndRecord(run: () => Promise<unknown>): Promise<{ bytes: Uint8Array, entries: ZipEntry[], prefix?: Uint8Array }> {
    h.chunks.length = 0
    h.downloads.length = 0
    h.errors.length = 0
    const writes: Recorded[] = []
    let prefix: Uint8Array | undefined
    // Data and level come from the `write(key, data, level)` call shape, which is the writer's public surface.
    const write = CharXWriter.prototype.write
    vi.spyOn(CharXWriter.prototype, 'write').mockImplementation(async function (this: CharXWriter, key, data, level) {
        writes.push({ data: typeof data === 'string' ? new TextEncoder().encode(data) : data.slice(), level })
        return write.call(this, key, data, level)
    })
    vi.spyOn(charxEncode, 'jpeg').mockImplementation(async () => {
        prefix = JPEG_STAND_IN
        return JPEG_STAND_IN
    })
    await run()
    expect(h.errors).toEqual([])
    const bytes = h.downloads.length > 0 ? h.downloads[0].data : Buffer.concat(h.chunks)
    expect(bytes.length).toBeGreaterThan(0)
    // the entry name as the writer sanitized and de-duplicated it, read from the exported archive itself
    const names = centralNames(bytes)
    expect(names).toHaveLength(writes.length)
    const entries = writes.map((w, i): ZipEntry => [names[i], w.data, w.level])
    return { bytes, entries, prefix }
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(FIXED_INSTANT))
    h.db.imageCompression = false
    fillStore()
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('fflateZipArchive (compatibility guards of the descriptor-framing helper)', () => {
    /** Local file header positions, found by walking the central directory. */
    function localHeaders(archive: Uint8Array): number[] {
        const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
        let eocd = archive.length - 22
        while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--
        expect(eocd).toBeGreaterThanOrEqual(0)
        const count = view.getUint16(eocd + 10, true)
        let at = view.getUint32(eocd + 16, true)
        const offsets: number[] = []
        for (let i = 0; i < count; i++) {
            expect(view.getUint32(at, true)).toBe(0x02014b50)
            offsets.push(view.getUint32(at + 42, true))
            at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
        }
        return offsets
    }

    test('guard: every local header sets flag bit 3 and states no CRC or sizes', () => {
        const archive = fflateZipArchive([
            ['a.bin', Uint8Array.from({ length: 300 }, (_, i) => i & 255)],
            ['b.json', new TextEncoder().encode('{"k":"value value value value"}'), 6],
            ['c.bin', new Uint8Array(0), 6],
        ])
        // callers patch the bytes through `new DataView(archive.buffer)`, so the array must start at its buffer's start
        expect(archive.byteOffset).toBe(0)
        expect(archive.buffer.byteLength).toBe(archive.byteLength)
        const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
        const offsets = localHeaders(archive)
        expect(offsets).toHaveLength(3)
        for (const at of offsets) {
            expect(view.getUint32(at, true)).toBe(0x04034b50)
            expect(view.getUint16(at + 6, true) & 8).toBe(8)
            expect(view.getUint32(at + 14, true)).toBe(0)
            expect(view.getUint32(at + 18, true)).toBe(0)
            expect(view.getUint32(at + 22, true)).toBe(0)
        }
    })

    test('guard: a prefix goes in front of the archive and the entries read back', () => {
        const prefix = Uint8Array.from([1, 2, 3, 4, 5])
        const body = Uint8Array.from({ length: 100 }, (_, i) => i)
        const archive = fflateZipArchive([['x.bin', body, 6]], { prefix })
        expect(Array.from(archive.subarray(0, 5))).toEqual([1, 2, 3, 4, 5])
        const files = fflate.unzipSync(archive.subarray(5))
        expect(Array.from(files['x.bin'])).toEqual(Array.from(body))
    })

    describe.each(Object.keys(STAGE_A_REFERENCE).map((label) => [label] as const))('%s', (label) => {
        test('guard: replaying the export entries through the helper gives the stage A SHA-256', async () => {
            const [format, compression] = [label.replace(/ (plain|lossy)$/, ''), label.endsWith('lossy') ? 'lossy' : 'plain']
            h.db.imageCompression = compression === 'lossy'
            const { entries, prefix } = await exportAndRecord(exporters[format])
            expect(sha256(fflateZipArchive(entries, { prefix }))).toBe(STAGE_A_REFERENCE[label])
        })
    })
})
