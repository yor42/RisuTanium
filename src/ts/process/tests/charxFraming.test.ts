/**
 * CharX writer framing (CHORE-375 stage C1): every entry carries its CRC-32 and sizes in the local header and has no
 * data descriptor, except a zero-length entry, which keeps fflate's descriptor shape (flag bit 3, zeros in the local
 * header, a 16-byte descriptor).
 *
 * Labels, per test:
 * - (R) REGRESSION REPRODUCER: fails on the descriptor framing of the base (the assertion fails, not the setup).
 * - (G) COMPATIBILITY GUARD: passes before and after on the property it names, or ties the new framing to the
 *   descriptor framing (`fflateZipArchive`, the reference of `zipFixtures.ts`).
 * The `charxJpeg v3` cases of an (R) or (G) table cannot run on the base: they replace `charxEncode.jpeg`, which the
 * base does not have, so they fail there at setup. They pin the new framing behind a prefix; the `charx v3` and
 * `module charx` cases of the same table are the base-red reproducers.
 *
 * The exports run for real (`exportCharacterCard`, `exportModule`, `CharXWriter`, `CharXImporter`); the asset reads, the
 * file writer, the alerts, the database and the lossy codec are replaced, as in `characterCards.exportBytes.test.ts`.
 * `charxEncode.jpeg` is replaced in the `charxJpeg` tests only. A mocked writer is not evidence of native file behaviour.
 *
 * The independent parser (`charxFramingParser.ts`) recomputes every CRC and checks every central offset, which fflate's
 * readers never do.
 */
import crc32 from 'crc/crc32'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const h = vi.hoisted(() => {
    // Zip header times are local-time fields: a fixed non-UTC zone makes the replayed bytes reproducible.
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

vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => Uint8Array.from(data, b => (b * 7 + 3) & 0xff)),
    decodeRPack: vi.fn(async (data: Uint8Array) => Uint8Array.from(data, b => ((b - 3 + 256) * 183) & 0xff)),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

//#endregion

import { language } from 'src/lang'
import { alertNormalWait } from 'src/ts/alert'
import { exportCharacterCard } from 'src/ts/characterCards'
import { exportModule, type RisuModule } from 'src/ts/process/modules'
import { CharXImporter, CharXWriter, charxEncode } from 'src/ts/process/processzip'
import type { character } from 'src/ts/storage/database.svelte'
import { CharxFramingError, parseCharx, type ParsedArchive } from './charxFramingParser'
import { fflateZipArchive, type ZipEntry } from './zipFixtures'

//#region synthetic card A (the stage A card)

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

// An Unknown blob that holds the zip signatures a streaming reader ends an entry at: the data descriptor, the local
// header and the central record signatures, in the middle of binary data.
const SIGNATURE_BLOB = Uint8Array.from([
    0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0x21,
    0x50, 0x4b, 0x07, 0x08, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    0x50, 0x4b, 0x03, 0x04, 20, 0, 8, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0x50, 0x4b, 0x01, 0x02, 99, 98, 97,
])

const ASSETS: Record<string, Uint8Array> = {
    portrait: syntheticPng(1),
    pngText: syntheticPng(2, ['Comment', 'a text chunk that the CharX metadata carries']),
    emotion: syntheticPng(3),
    webp: Uint8Array.from([0x52, 0x49, 0x46, 0x46, 20, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4, 5, 6, 7, 8]),
    mp3: Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0x21, 0xff, 0xfb, 0x90, 0x44, 9, 8, 7, 6, 5]),
    gif: Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0, 0xff, 0xff, 0xff, 0, 0, 0, 0x3b]),
    voiceA: Uint8Array.from([0x52, 0x49, 0x46, 0x46, 12, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 11, 12, 13, 14]),
    voiceB: Uint8Array.from([0x52, 0x49, 0x46, 0x46, 12, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 21, 22, 23, 24, 25]),
    signatures: SIGNATURE_BLOB,
    empty: new Uint8Array(0),
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
    signatures: 'key-signatures',
    empty: 'key-empty',
}

function fillStore() {
    h.assets.clear()
    for (const name of Object.keys(ASSETS)) {
        h.assets.set(KEYS[name], ASSETS[name])
    }
}

type CardAsset = { type: string, uri: string, name: string, ext: string }

/** Card A as the stage A pins hold it; `extra` adds assets after the stage A ones. */
function syntheticCharacter(extra: CardAsset[] = []): character {
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
            ...extra,
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
const JPEG_STAND_IN = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0x4a, 0x50, 0xff, 0xd9])

type Format = 'charx v3' | 'charxJpeg v3' | 'module charx'

const exporters: Record<Format, () => Promise<unknown>> = {
    'charx v3': () => exportCharacterCard(syntheticCharacter(), 'charx', { spec: 'v3' }),
    'charxJpeg v3': () => exportCharacterCard(syntheticCharacter(), 'charxJpeg', { spec: 'v3' }),
    'module charx': () => exportModule(syntheticModule(), { alertEnd: false }),
}

/** The `write(key, data, level)` calls of one export, in order, as the entries an archive is built from. */
type Recorded = { data: Uint8Array, level: ZipEntry[2] }

/**
 * Runs one export; returns the bytes it wrote and the entry calls the writer received. The entry names are read from the
 * exported archive's own central directory, because the writer sanitizes and de-duplicates them.
 */
async function exportAndRecord(run: () => Promise<unknown>, jpeg: boolean = false): Promise<{ bytes: Uint8Array, entries: ZipEntry[], prefix?: Uint8Array }> {
    h.chunks.length = 0
    h.downloads.length = 0
    h.errors.length = 0
    const writes: Recorded[] = []
    const write = CharXWriter.prototype.write
    vi.spyOn(CharXWriter.prototype, 'write').mockImplementation(async function (this: CharXWriter, key, data, level) {
        writes.push({ data: typeof data === 'string' ? new TextEncoder().encode(data) : data.slice(), level })
        return write.call(this, key, data, level)
    })
    if (jpeg) {
        vi.spyOn(charxEncode, 'jpeg').mockImplementation(async () => JPEG_STAND_IN)
    }
    await run()
    expect(h.errors).toEqual([])
    const bytes = h.downloads.length > 0 ? h.downloads[0].data : Buffer.concat(h.chunks)
    expect(bytes.length).toBeGreaterThan(0)
    const parsed = parseCharx(bytes)
    expect(parsed.entries).toHaveLength(writes.length)
    const entries = writes.map((w, i): ZipEntry => [parsed.entries[i].name, w.data, w.level])
    return { bytes, entries, prefix: jpeg ? JPEG_STAND_IN : undefined }
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(FIXED_INSTANT))
    h.saved.clear()
    h.chunks.length = 0
    h.downloads.length = 0
    h.errors.length = 0
    h.db.imageCompression = false
    fillStore()
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

function bytesEqual(a: Uint8Array | undefined, b: Uint8Array): boolean {
    return a !== undefined && Buffer.from(a).equals(Buffer.from(b))
}

/** The importer after a parse, and the origin of the failure that stopped it (`undefined` when it imported). */
type ImportOutcome = { importer: CharXImporter, failure?: string }

async function importCharx(bytes: Uint8Array): Promise<ImportOutcome> {
    const importer = new CharXImporter()
    try {
        await importer.parse(bytes)
        await importer.done()
        return { importer }
    } catch (error) {
        return { importer, failure: (error as { origin?: string }).origin ?? String(error) }
    }
}

describe('(R) a binary asset that holds zip signatures', () => {
    test('exports and imports with equal bytes', async () => {
        const { bytes } = await exportAndRecord(() => exportCharacterCard(
            syntheticCharacter([{ type: 'x-risu-asset', uri: KEYS.signatures, name: 'signature blob', ext: 'bin' }]),
            'charx',
            { spec: 'v3' },
        ))
        // the planted signatures are in the archive as raw bytes (level 0 stores them), which is what makes the case meaningful
        expect(Buffer.from(bytes).includes(Buffer.from([0x50, 0x4b, 0x07, 0x08]))).toBe(true)
        expect(Buffer.from(bytes).includes(Buffer.from([0x50, 0x4b, 0x03, 0x04, 20, 0, 8, 0, 8]))).toBe(true)
        const outcome = await importCharx(bytes)
        // on the descriptor framing the streaming reader ends the entry at the first signature and refuses the archive as 'zip'
        expect(outcome.failure ?? 'imported').toBe('imported')
        expect([...h.saved.values()].some(saved => bytesEqual(saved, SIGNATURE_BLOB))).toBe(true)
    })
})

describe('independent parser on the exports', () => {
    const cases: Array<[Format, boolean]> = [['charx v3', false], ['charxJpeg v3', true], ['module charx', false]]

    for (const [format, jpeg] of cases) {
        test(`(R) ${format}: only an empty entry carries a data descriptor`, async () => {
            const { bytes } = await exportAndRecord(exporters[format], jpeg)
            const archive = parseCharx(bytes)
            const withDescriptor = archive.entries.filter(entry => (entry.local.flagLow & 8) !== 0 || entry.descriptor !== undefined)
            expect(withDescriptor.filter(entry => entry.central.size !== 0).map(entry => entry.name)).toEqual([])
        })

        test(`(G) ${format}: every CRC, size and central offset checks, and every entry decodes to what was written`, async () => {
            const { bytes, entries, prefix } = await exportAndRecord(exporters[format], jpeg)
            const archive = parseCharx(bytes)
            expect(archive.prefixLength).toBe(prefix ? prefix.length : 0)
            if (prefix) {
                expect(bytesEqual(bytes.subarray(0, prefix.length), prefix)).toBe(true)
            }
            expect(archive.entries.map(entry => entry.name)).toEqual(entries.map(entry => entry[0]))
            archive.entries.forEach((entry, i) => {
                expect(bytesEqual(entry.data, entries[i][1]), entry.name).toBe(true)
            })
        })
    }

    describe('(G) the parser refuses a wrong archive', () => {
        async function plainArchive(prefix?: Uint8Array): Promise<Uint8Array> {
            const chunks: Uint8Array[] = []
            const writer = new CharXWriter({ write: async (data: Uint8Array) => { chunks.push(data.slice()) }, close: async () => { } } as unknown as ConstructorParameters<typeof CharXWriter>[0])
            if (prefix) {
                vi.spyOn(charxEncode, 'jpeg').mockImplementation(async () => prefix)
                await writer.writeJpeg(new Uint8Array(1))
            }
            await writer.write('a.bin', Uint8Array.from({ length: 200 }, (_, i) => i & 255))
            await writer.write('b.json', new TextEncoder().encode('{"k":"value value value"}'), 6)
            await writer.end()
            return Buffer.concat(chunks)
        }

        function centralOffset(bytes: Uint8Array, index: number): number {
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            let eocd = bytes.length - 22
            while (view.getUint32(eocd, true) !== 0x06054b50) eocd--
            let at = eocd - view.getUint32(eocd + 12, true)
            for (let i = 0; i < index; i++) {
                at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
            }
            return at
        }

        test('the unmodified archive parses', async () => {
            expect(parseCharx(await plainArchive()).entries.map(entry => entry.name)).toEqual(['a.bin', 'b.json'])
        })

        test('a CRC that is not the data\'s is refused (the CRC of the compressed bytes would be)', async () => {
            const bytes = await plainArchive()
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            const central = centralOffset(bytes, 1)
            const wrong = crc32(Buffer.from(parseCharx(bytes).entries[1].body))
            view.setUint32(central + 16, wrong, true)
            expect(() => parseCharx(bytes)).toThrow(CharxFramingError)
        })

        test('a central offset taken from the file position, prefix included, is refused', async () => {
            const prefix = new Uint8Array(37).fill(0xff)
            const bytes = await plainArchive(prefix)
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            expect(parseCharx(bytes).prefixLength).toBe(prefix.length)
            let eocd = bytes.length - 22
            while (view.getUint32(eocd, true) !== 0x06054b50) eocd--
            for (let i = 0; i < 2; i++) {
                const at = centralOffset(bytes, i)
                view.setUint32(at + 42, view.getUint32(at + 42, true) + prefix.length, true)
            }
            view.setUint32(eocd + 16, view.getUint32(eocd + 16, true) + prefix.length, true)
            expect(() => parseCharx(bytes)).toThrow(CharxFramingError)
        })
    })
})

//#region structural guard against the descriptor framing

type EntryDiffView = ParsedArchive['entries'][number]

/**
 * The new archive and the descriptor-framing archive of the same calls may differ only in flag bit 3, the local CRC and
 * sizes, the missing descriptors (a zero-length entry keeps its own) and the offsets those shift. Everything else is equal.
 */
function expectSameModuloFraming(actualBytes: Uint8Array, referenceBytes: Uint8Array) {
    const actual = parseCharx(actualBytes)
    const reference = parseCharx(referenceBytes)
    expect(actual.prefixLength).toBe(reference.prefixLength)
    const { directoryOffset: actualOffset, ...actualEnd } = actual.end
    const { directoryOffset: referenceOffset, ...referenceEnd } = reference.end
    expect(actualEnd).toEqual(referenceEnd)
    expect(actualOffset).toBeLessThan(referenceOffset)
    expect(actual.entries.map(entry => entry.name)).toEqual(reference.entries.map(entry => entry.name))
    let nonEmpty = 0
    reference.entries.forEach((ref: EntryDiffView, i) => {
        const act = actual.entries[i]
        const label = ref.name
        const empty = ref.central.size === 0
        expect(ref.local.flagLow & 8, `${label}: the reference sets bit 3`).toBe(8)
        // local header
        expect(act.local.versionNeeded, label).toBe(ref.local.versionNeeded)
        expect(act.local.flagHigh, `${label}: flag high byte (0x800 for a non-ASCII name)`).toBe(ref.local.flagHigh)
        expect(act.local.flagLow & ~8, `${label}: flag low byte without bit 3`).toBe(ref.local.flagLow & ~8)
        expect(act.local.method, label).toBe(ref.local.method)
        expect(act.local.stamp, label).toBe(ref.local.stamp)
        expect(act.local.extraLength, label).toBe(ref.local.extraLength)
        // the body and the decoded data
        expect(bytesEqual(act.body, ref.body), `${label}: body`).toBe(true)
        expect(bytesEqual(act.data, ref.data), `${label}: data`).toBe(true)
        // central record: everything but the offset and bit 3
        for (const field of Object.keys(ref.central) as Array<keyof typeof ref.central>) {
            if (field === 'offset' || field === 'flagLow') {
                continue
            }
            expect(act.central[field], `${label}: central ${field}`).toBe(ref.central[field])
        }
        expect(act.central.flagLow & ~8, `${label}: central flag low byte without bit 3`).toBe(ref.central.flagLow & ~8)
        if (empty) {
            // an empty entry keeps fflate's shape: bit 3 in both records, zeros in the local header, a descriptor
            expect(act.local.flagLow & 8, `${label}: empty entry local bit 3`).toBe(8)
            expect(act.central.flagLow & 8, `${label}: empty entry central bit 3`).toBe(8)
            expect(act.local.crc).toBe(0)
            expect(act.local.compressedSize).toBe(0)
            expect(act.local.size).toBe(0)
            expect(act.descriptor, label).toEqual(ref.descriptor)
        } else {
            nonEmpty++
            expect(act.local.flagLow & 8, `${label}: local bit 3 clear`).toBe(0)
            expect(act.central.flagLow & 8, `${label}: central bit 3 clear`).toBe(0)
            expect(act.descriptor, label).toBeUndefined()
            expect(act.local.crc, label).toBe(ref.central.crc)
            expect(act.local.compressedSize, label).toBe(ref.central.compressedSize)
            expect(act.local.size, label).toBe(ref.central.size)
        }
    })
    // the offsets shift by exactly the descriptors that are gone
    expect(referenceBytes.length - actualBytes.length).toBe(16 * nonEmpty)
}

async function writerArchive(entries: ZipEntry[], prefix?: Uint8Array): Promise<Uint8Array> {
    const chunks: Uint8Array[] = []
    const writer = new CharXWriter({ write: async (data: Uint8Array) => { chunks.push(data.slice()) }, close: async () => { } } as unknown as ConstructorParameters<typeof CharXWriter>[0])
    if (prefix) {
        vi.spyOn(charxEncode, 'jpeg').mockImplementation(async () => prefix)
        await writer.writeJpeg(new Uint8Array(1))
    }
    for (const [name, data, level] of entries) {
        await writer.write(name, data, level)
    }
    await writer.end()
    return Buffer.concat(chunks)
}

describe('(G) the new framing against the descriptor framing (fflateZipArchive)', () => {
    const text = (s: string) => new TextEncoder().encode(s)
    const binary = Uint8Array.from({ length: 700 }, (_, i) => (i * 31 + 7) & 255)

    // non-ASCII names (flag 0x800), levels 0 and 6, and empty entries at both levels
    const entries: ZipEntry[] = [
        ['card.json', text('{"spec":"chara_card_v3","name":"card"}'), 6],
        ['assets/other/unknown/한글 이름.bin', binary, 0],
        ['x_meta/한글 이름.json', text('{"type":"Unknown"}'), 6],
        ['assets/icon/image/emoji🙂.png', binary.subarray(10, 300), 0],
        ['empty-level-0.bin', new Uint8Array(0), 0],
        ['empty-level-6.bin', new Uint8Array(0), 6],
        ['plain.txt', text('ascii only ascii only ascii only ascii only'), 6],
        ['module.risum', binary, 0],
    ]

    test('mixed levels, non-ASCII names and empty entries', async () => {
        expectSameModuloFraming(await writerArchive(entries), fflateZipArchive(entries))
    })

    test('the same with a prefix in front of the archive', async () => {
        const prefix = Uint8Array.from([0xff, 0xd8, 1, 2, 3, 4, 5, 0xff, 0xd9])
        expectSameModuloFraming(await writerArchive(entries, prefix), fflateZipArchive(entries, { prefix }))
    })

    test('an empty entry is the descriptor shape at both levels (body of 5 bytes at level 0 and 2 at level 6)', async () => {
        const archive = parseCharx(await writerArchive(entries))
        const byName = new Map(archive.entries.map(entry => [entry.name, entry]))
        expect(byName.get('empty-level-0.bin')?.central.compressedSize).toBe(5)
        expect(byName.get('empty-level-6.bin')?.central.compressedSize).toBe(2)
        expect(byName.get('empty-level-0.bin')?.descriptor).toEqual({ crc: 0, compressedSize: 5, size: 0 })
        expect(byName.get('empty-level-6.bin')?.descriptor).toEqual({ crc: 0, compressedSize: 2, size: 0 })
    })

    const labels: Array<[string, Format, boolean, boolean]> = [
        ['charx v3 plain', 'charx v3', false, false],
        ['charx v3 lossy', 'charx v3', false, true],
        ['charxJpeg v3 plain', 'charxJpeg v3', true, false],
        ['charxJpeg v3 lossy', 'charxJpeg v3', true, true],
        ['module charx plain', 'module charx', false, false],
        ['module charx lossy', 'module charx', false, true],
    ]
    for (const [label, format, jpeg, lossy] of labels) {
        test(`${label}: the export of card A equals the replay through the helper`, async () => {
            h.db.imageCompression = lossy
            const { bytes, entries: calls, prefix } = await exportAndRecord(exporters[format], jpeg)
            expectSameModuloFraming(bytes, fflateZipArchive(calls, { prefix }))
        })
    }
})

//#endregion

describe('(new behaviour) a CharX that could pass 65,535 entries is refused before anything opens', () => {
    // 32,767 assets are 2 * 32,767 + 2 = 65,536 entries. The keys are outside assets/, so the pre-check does not size them.
    const MANY = 32767
    const manyCardAssets = (): CardAsset[] => Array.from({ length: MANY }, (_, i) => ({ type: 'x-risu-asset', uri: `many-${i}`, name: `n${i}`, ext: 'bin' }))

    test('a character CharX shows the count notice and writes nothing', async () => {
        vi.mocked(alertNormalWait).mockClear()
        const exported = await exportCharacterCard(syntheticCharacter(manyCardAssets()), 'charx', { spec: 'v3' })
        expect(exported).toBe(false)
        expect(vi.mocked(alertNormalWait).mock.calls.map(call => call[0])).toEqual([language.exportCharxTooManyEntries(2 * (MANY + 7) + 2, 65535)])
        expect(h.chunks).toEqual([])
        expect(h.downloads).toEqual([])
        expect(h.errors).toEqual([])
    })

    test('a module CharX shows the count notice and writes nothing', async () => {
        vi.mocked(alertNormalWait).mockClear()
        const module = syntheticModule()
        module.assets = Array.from({ length: MANY }, (_, i) => [`n${i}`, `many-${i}`, 'bin'] as [string, string, string])
        await exportModule(module, { alertEnd: false })
        const notices = vi.mocked(alertNormalWait).mock.calls.map(call => call[0])
        expect(notices).toHaveLength(1)
        expect(notices[0]).toBe(language.exportCharxTooManyEntries(2 * (MANY + 1) + 2, 65535))
        expect(h.chunks).toEqual([])
        expect(h.downloads).toEqual([])
        expect(h.errors).toEqual([])
    })
})

describe('(G) a zero-length asset', () => {
    test('imports through CharXImporter with no bytes', async () => {
        const { bytes } = await exportAndRecord(() => exportCharacterCard(
            syntheticCharacter([{ type: 'x-risu-asset', uri: KEYS.empty, name: 'nothing', ext: 'bin' }]),
            'charx',
            { spec: 'v3' },
        ))
        const archive = parseCharx(bytes)
        const emptyEntries = archive.entries.filter(entry => entry.name.startsWith('assets/') && entry.central.size === 0)
        expect(emptyEntries).toHaveLength(1)
        expect(emptyEntries[0].descriptor).toBeDefined()
        const outcome = await importCharx(bytes)
        expect(outcome.failure ?? 'imported').toBe('imported')
        const card = JSON.parse(outcome.importer.cardData as string) as { data: { assets: CardAsset[] } }
        const asset = card.data.assets.find(a => a.name === 'nothing')
        expect(asset).toBeDefined()
        const id = outcome.importer.assets[(asset as CardAsset).uri.slice('embeded://'.length)]
        expect(id).toBeDefined()
        expect(h.saved.get(id)?.length).toBe(0)
    })
})
