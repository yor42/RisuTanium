/**
 * PNG card import through `importCharacterProcess` in `src/ts/characterCards.ts`: what is decided before the first asset
 * is saved, what is never held as one string, and what happens when the file changes between the two passes.
 *
 * The real `characterCards.ts`, `pngChunk.ts`, `pngCardImport.ts` and `importSource.ts` run against synthetic cards
 * built here. Everything the import reaches around them (the database, asset storage, alerts, the zip importer) is
 * replaced by recorders. Tests marked "regression reproducer" fail against an importer that saves assets while it is
 * still reading the card; tests marked "guard" pin behaviour that must stay the same.
 */

import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import crc32 from 'crc/crc32'

//#region module mocks

const h = vi.hoisted(() => ({
    saved: [] as Array<{ id: string, length: number, bytesRead: number }>,
    errors: [] as string[],
    characters: [] as Array<Record<string, unknown>>,
    uuid: 0,
    last: 'none',
    confirm: true,
    password: 'pw',
    decryptFails: false,
    assetLimit: 200 * 1024 * 1024,
    /** the bytes the file under test has handed out so far, read when an asset is saved */
    probe: (() => 0) as () => number,
}))

vi.mock('uuid', () => ({
    v4: () => `uuid-${++h.uuid}`,
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/upstreamAgreement'), () => ({
    askUpstreamAgreement: vi.fn(async () => true),
    isUpstreamAccepted: vi.fn(() => true),
    publishUpstreamAccepted: vi.fn(),
}) as unknown as typeof import('src/ts/upstreamAgreement'))

vi.mock(import('src/ts/alert'), () => ({
    alertCardExport: vi.fn(),
    alertConfirm: vi.fn(async () => { h.last = 'ask'; const answer = h.confirm; h.last = 'none'; return answer }),
    alertError: vi.fn((msg: string | Error) => { const text = msg instanceof Error ? msg.message : String(msg); h.errors.push(text); h.last = 'error:' + text }),
    alertInput: vi.fn(async () => { h.last = 'input'; const answer = h.password; h.last = 'none'; return answer }),
    alertMd: vi.fn(),
    alertNormal: vi.fn((msg: string) => { h.last = 'normal:' + msg }),
    alertStore: { set: (v: { type?: string, msg?: string }) => { h.last = v.type === 'none' ? 'none' : `${v.type}:${v.msg}` }, subscribe: vi.fn(), update: vi.fn() },
    alertWait: vi.fn((msg: string) => { h.last = 'wait:' + msg }),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    defaultSdDataFunc: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    importPreset: vi.fn(),
    setCurrentCharacter: vi.fn(),
    getCurrentCharacter: vi.fn(),
    getDatabase: vi.fn(() => ({ statics: { imports: 0 }, characters: h.characters, goCharacterOnImport: false })),
    setDatabaseLite: vi.fn(),
    appVer: 'test',
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    decryptBuffer: vi.fn(async (d: unknown) => {
        if (h.decryptFails) throw new Error('decryption failed')
        return d
    }),
    isKnownUri: vi.fn(() => false),
    selectFileByDom: vi.fn(async () => null),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(async () => {}),
    characterFormatUpdate: vi.fn((c: unknown) => c),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { AppendableBuffer } = await import('src/ts/byteBuffer')
    return {
        AppendableBuffer,
        BlankWriter: class {},
        LocalWriter: class {},
        VirtualWriter: class {},
        checkCharOrder: vi.fn(),
        downloadFile: vi.fn(async () => {}),
        forageStorage: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
        loadAsset: vi.fn(async () => new Uint8Array()),
        openURL: vi.fn(),
        readImage: vi.fn(async (d: unknown) => d),
        saveAsset: vi.fn(async (data: Uint8Array) => {
            const id = createHash('sha1').update(data).digest('hex')
            h.saved.push({ id, length: data.length, bytesRead: h.probe() })
            return id
        }),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'png'),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { characters: h.characters } } },
    SettingsMenuIndex: { set: vi.fn() },
    ShowRealmFrameStore: { set: vi.fn() },
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    selectedCharID: { set: vi.fn() },
    settingsOpen: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

//The digest of an rcc card's encrypted bytes is their length, so a fixture states a valid one without hashing.
vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn(async (d: Uint8Array) => `len${d.length}`),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/processzip'), () => ({
    CharXImporter: class {},
    CharXWriter: class {},
    assetByteLimit: () => h.assetLimit,
}) as unknown as typeof import('src/ts/process/processzip'))

vi.mock(import('src/ts/process/modules'), () => ({
    exportModuleLegacy: vi.fn(),
    readModule: vi.fn(),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    SeekMode: { Start: 0, Current: 1, End: 2 },
    readFile: vi.fn(async () => new Uint8Array()),
}))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
}))

//#endregion

import { importCharacterProcess } from 'src/ts/characterCards'
import { alertConfirm, alertInput } from 'src/ts/alert'
import { importSourceOfBytes, type ImportSource } from 'src/ts/importSource'
import { language } from 'src/lang'
import { CountingFile } from 'src/ts/process/tests/risumFixtures'

// ---------------------------------------------------------------------------------------------
// Synthetic PNG cards (no real images, no user data)
// ---------------------------------------------------------------------------------------------

const U8 = Uint8Array
const MIB = 1024 * 1024
const SIG = new U8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const utf8 = (s: string) => new TextEncoder().encode(s)
const sha1 = (data: Uint8Array) => createHash('sha1').update(data).digest('hex')

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new U8(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) {
        out.set(p, at)
        at += p.length
    }
    return out
}

function chunk(type: string, body: Uint8Array): Uint8Array {
    const t = utf8(type)
    const len = new U8(4)
    new DataView(len.buffer).setUint32(0, body.length)
    const crc = new U8(4)
    new DataView(crc.buffer).setUint32(0, crc32(Buffer.from(concat([t, body]))))
    return concat([len, t, body, crc])
}

const text = (key: string, value: string | Uint8Array) =>
    chunk('tEXt', concat([utf8(key), new U8([0]), typeof value === 'string' ? utf8(value) : value]))
const iend = () => chunk('IEND', new U8(0))
const ihdr = () => chunk('IHDR', new U8(13).fill(1))
const idat = (n = 40) => chunk('IDAT', new U8(n).fill(7))
const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64')

const assetBytes = (index: number, size: number) => new U8(size).map((_, i) => (i * 31 + index * 17 + 5) & 0xff)
const assetChunk = (index: number, size: number) => text(`chara-ext-asset_:${index}`, Buffer.from(assetBytes(index, size)).toString('base64'))

type RisuExt = Record<string, unknown>

const v2Json = (name: string, ext: RisuExt = {}) => JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: { name, description: 'd', first_mes: 'hi', character_version: '1', extensions: { risuai: ext } },
})

const v3Json = (name: string, uris: string[], ext: RisuExt = {}) => JSON.stringify({
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
        name, description: 'd', first_mes: 'hi', character_version: '1',
        extensions: { risuai: ext },
        assets: uris.map((uri, i) => ({ type: 'x-risu-asset', uri, name: `a${i}`, ext: 'bin' })),
    },
})

const additional = (n: number, ref = (i: number) => `__asset:${i}`) => ({ additionalAssets: Array.from({ length: n }, (_, i) => [`a${i}`, ref(i), 'bin']) })

const SIZES = [300, 1500, 4000]

/** Assets, then the card chunk, as the exporter writes them. */
function exportOrder(card: string, sizes = SIZES, key = 'chara'): { bytes: Uint8Array, image: Uint8Array } {
    const parts = [ihdr(), idat(), ...sizes.map((s, i) => assetChunk(i, s)), text(key, b64(card)), iend()]
    return { bytes: concat([SIG, ...parts]), image: concat([SIG, ihdr(), idat(), iend()]) }
}

function build(chunks: Uint8Array[]): Uint8Array {
    return concat([SIG, ...chunks])
}

const fileOf = (bytes: Uint8Array, name = 'card.png') => new File([new U8(bytes)], name, { type: 'image/png' })

function reset() {
    h.saved = []
    h.errors = []
    h.characters = []
    h.uuid = 0
    h.last = 'none'
    h.confirm = true
    h.password = 'pw'
    h.decryptFails = false
    h.assetLimit = 200 * MIB
    h.probe = () => 0
    vi.mocked(alertConfirm).mockClear()
    vi.mocked(alertInput).mockClear()
}

async function run(data: File | Uint8Array | ImportSource) {
    let returned: number | null | undefined
    let thrown: string | null = null
    try {
        returned = await importCharacterProcess({ name: 'card.png', data })
    } catch (e) {
        thrown = e instanceof Error ? e.message : String(e)
    }
    return { returned, thrown, saved: [...h.saved], errors: [...h.errors], characters: structuredClone(h.characters), last: h.last }
}

beforeEach(() => {
    reset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

function expectNothingSaved(out: Awaited<ReturnType<typeof run>>, message: string | null | (() => string)) {
    expect(out.thrown).toBeNull()
    expect(out.saved).toEqual([])
    expect(out.characters).toEqual([])
    expect(out.errors).toEqual(message === null ? [] : [typeof message === 'function' ? message() : message])
}

// ---------------------------------------------------------------------------------------------
// A card that will be refused is refused before any asset is saved
// ---------------------------------------------------------------------------------------------

describe('PNG import refuses before it saves (regression reproducer)', () => {
    test('an asset over the limit saves nothing, not even the assets before it', async () => {
        h.assetLimit = 2 * MIB
        const bytes = exportOrder(v2Json('Big', additional(2)), [300, 3 * MIB]).bytes
        expectNothingSaved(await run(fileOf(bytes)), language.cardFileEntryTooLarge('chara-ext-asset_:1', 2))
    })

    test('an image over the limit saves nothing', async () => {
        h.assetLimit = 2 * MIB
        const bytes = build([ihdr(), chunk('IDAT', new U8(3 * MIB).fill(7)), assetChunk(0, 300), text('chara', b64(v2Json('Img', additional(1)))), iend()])
        expectNothingSaved(await run(fileOf(bytes)), () => language.cardImageTooLarge(2))
    })

    test('a card chunk that is not JSON saves nothing', async () => {
        const bytes = build([ihdr(), idat(), assetChunk(0, 300), assetChunk(1, 300), text('chara', b64('{ not json')), iend()])
        expectNothingSaved(await run(fileOf(bytes)), language.errors.noData)
    })

    test('a card chunk of no text at all saves nothing', async () => {
        const bytes = build([ihdr(), idat(), assetChunk(0, 300), text('chara', ''), iend()])
        expectNothingSaved(await run(fileOf(bytes)), language.errors.noData)
    })

    test.each([
        ['a v2 additional asset', () => v2Json('M', additional(2, (i) => `__asset:${i + 5}`)), '5'],
        ['a v2 emotion', () => v2Json('M', { emotions: [['happy', '__asset:9']] }), '9'],
        ['a v2 vits entry', () => v2Json('M', { vits: { 'model.onnx': '__asset:8' } }), '8'],
        ['a v3 asset', () => v3Json('M', ['__asset:0', '__asset:6']), '6'],
        ['a v3 embedded asset', () => v3Json('M', ['embeded://7']), '7'],
    ] as Array<[string, () => string, string]>)('a reference of %s that no asset chunk satisfies saves nothing', async (_name, card, key) => {
        const bytes = exportOrder(card(), [300, 400]).bytes
        expectNothingSaved(await run(fileOf(bytes)), language.errors.importAssetNotFound.replace('{key}', key))
    })

    test('a password card whose prompt is declined saves nothing', async () => {
        h.password = ''
        const out = await run(fileOf(rccBytes({ usePassword: true, content: v2Json('R', additional(2)), assets: 2 })))
        expectNothingSaved(out, null)
        expect(out.last).toBe('none')
    })

    test.each([
        ['a wrong password', () => { h.decryptFails = true }, language.errors.wrongPassword],
        ['a wrong digest', () => {}, language.errors.noData],
    ] as Array<[string, () => void, string]>)('a password card with %s saves nothing', async (name, setup, message) => {
        setup()
        const bytes = rccBytes({ usePassword: true, content: v2Json('R', additional(2)), assets: 2, badDigest: name === 'a wrong digest' })
        expectNothingSaved(await run(fileOf(bytes)), message)
    })

    test('an rcc card with a reference no asset chunk satisfies saves nothing', async () => {
        const bytes = rccBytes({ usePassword: false, content: v2Json('R', additional(3)), assets: 2 })
        expectNothingSaved(await run(fileOf(bytes)), language.errors.importAssetNotFound.replace('{key}', '2'))
    })

    test('a card whose low-level-access prompt is declined saves nothing and is asked once', async () => {
        h.confirm = false
        const bytes = exportOrder(v2Json('Low', { ...additional(3), lowLevelAccess: true })).bytes
        const out = await run(fileOf(bytes))
        expectNothingSaved(out, null)
        expect(out.last).toBe('none')
        expect(alertConfirm).toHaveBeenCalledTimes(1)
    })

    test('an rcc card whose low-level-access prompt is declined saves nothing and is asked once', async () => {
        h.confirm = false
        const bytes = rccBytes({ usePassword: false, content: v2Json('R', { ...additional(2), lowLevelAccess: true }), assets: 2 })
        expectNothingSaved(await run(fileOf(bytes)), null)
        expect(alertConfirm).toHaveBeenCalledTimes(1)
    })
})

// ---------------------------------------------------------------------------------------------
// Compatibility guards: what a card that is accepted gives
// ---------------------------------------------------------------------------------------------

describe('PNG import of accepted cards (compatibility guard)', () => {
    test.each([
        ['v2', () => v2Json('Two', additional(3)), 'chara'],
        ['v3', () => v3Json('Three', ['__asset:0', 'embeded://1', '__asset:2']), 'ccv3'],
    ] as Array<[string, () => string, string]>)('a %s card keeps its content, its assets under their own ids and its image', async (_name, card, key) => {
        const { bytes, image } = exportOrder(card(), SIZES, key)
        const out = await run(fileOf(bytes))
        expect(out.thrown).toBeNull()
        expect(out.errors).toEqual([])
        expect(out.characters).toHaveLength(1)
        const ids = SIZES.map((s, i) => sha1(assetBytes(i, s)))
        expect(out.saved.map((s) => s.id)).toEqual([...ids, sha1(image)])
        expect((out.characters[0].additionalAssets as string[][]).map((a) => a[1])).toEqual(ids)
        expect(out.characters[0].image).toBe(sha1(image))
    })

    test('a card without assets and the same card as a Uint8Array give the same character and saves', async () => {
        const { bytes } = exportOrder(v2Json('Same'), [])
        const fromFile = await run(fileOf(bytes))
        reset()
        const fromBytes = await run(new U8(bytes))
        expect(fromBytes.characters).toEqual(fromFile.characters)
        expect(fromBytes.saved.map((s) => s.id)).toEqual(fromFile.saved.map((s) => s.id))
    })

    test('an rcc card keeps its assets and its image, with and without a password', async () => {
        for (const usePassword of [true, false]) {
            reset()
            const bytes = rccBytes({ usePassword, content: v2Json('R', additional(2)), assets: 2 })
            const out = await run(fileOf(bytes))
            expect(out.errors, `password ${usePassword}`).toEqual([])
            expect(out.characters, `password ${usePassword}`).toHaveLength(1)
            expect(out.saved.map((s) => s.id).slice(0, 2)).toEqual([0, 1].map((i) => sha1(assetBytes(i, 500))))
            expect(out.saved).toHaveLength(3)
        }
    })

    test('an old Tavern card without a spec imports with its image', async () => {
        const tavern = JSON.stringify({ name: 'Old', description: 'd', first_mes: 'hi' })
        const bytes = build([ihdr(), idat(), text('chara', b64(tavern)), iend()])
        const out = await run(fileOf(bytes))
        expect(out.errors).toEqual([])
        expect(out.characters).toHaveLength(1)
        expect(out.characters[0].name).toBe('Old')
        expect(out.saved.map((s) => s.id)).toEqual([sha1(concat([SIG, ihdr(), idat(), iend()]))])
    })

    test('an old Tavern card imports without asking the low-level-access prompt', async () => {
        const tavern = JSON.stringify({ name: 'Old', description: 'd', first_mes: 'hi', extensions: { risuai: { lowLevelAccess: true } } })
        const out = await run(fileOf(build([ihdr(), idat(), text('chara', b64(tavern)), iend()])))
        expect(out.characters).toHaveLength(1)
        expect(alertConfirm).not.toHaveBeenCalled()
    })

    test('a card that asks for low-level access is asked once, and imports when it is accepted', async () => {
        const out = await run(fileOf(exportOrder(v2Json('Low', { ...additional(3), lowLevelAccess: true })).bytes))
        expect(out.errors).toEqual([])
        expect(out.characters).toHaveLength(1)
        expect(alertConfirm).toHaveBeenCalledTimes(1)
    })

    test('a legacy card with every emotion inline in a card chunk above 5 MiB imports with them', async () => {
        const emotion = Buffer.from(assetBytes(3, 4 * MIB)).toString('base64')
        const card = v2Json('Legacy', { emotions: [['happy', emotion], ['sad', emotion]] })
        expect(card.length).toBeGreaterThan(5 * MIB)
        const out = await run(fileOf(build([ihdr(), idat(), text('chara', b64(card)), iend()])))
        expect(out.errors).toEqual([])
        expect(out.characters).toHaveLength(1)
        expect(out.saved.filter((s) => s.length === 4 * MIB)).toHaveLength(2)
    })

    test('ccv3 is chosen over chara, and an empty ccv3 falls back to chara', async () => {
        const both = build([ihdr(), text('chara', b64(v2Json('FromChara'))), text('ccv3', b64(v3Json('FromV3', []))), iend()])
        expect((await run(fileOf(both))).characters[0].name).toBe('FromV3')
        reset()
        const emptyV3 = build([ihdr(), text('ccv3', ''), text('chara', b64(v2Json('FromChara'))), iend()])
        expect((await run(fileOf(emptyV3))).characters[0].name).toBe('FromChara')
    })

    test('a v3 card carrying v2-style references, and a chara chunk that loses to ccv3, are not checked', async () => {
        const v3WithV2Refs = v3Json('V3', [], additional(2, () => '__asset:99'))
        const out = await run(fileOf(build([ihdr(), text('chara', b64(v2Json('Loser', additional(1, () => '__asset:77')))), text('ccv3', b64(v3WithV2Refs)), iend()])))
        expect(out.errors).toEqual([])
        expect(out.characters.map((c) => c.name)).toEqual(['V3'])
    })

    test('two chara chunks: a later one replaces a short earlier one, a first one of 5 Mi characters is kept', async () => {
        const second = await run(fileOf(build([ihdr(), text('chara', b64(v2Json('First'))), text('chara', b64(v2Json('Second'))), iend()])))
        expect(second.characters[0].name).toBe('Second')
        reset()
        const padded = v2Json('FirstBig', { padding: 'x'.repeat(4 * MIB) })
        expect(b64(padded).length).toBeGreaterThan(5 * MIB)
        const first = await run(fileOf(build([ihdr(), text('chara', b64(padded)), text('chara', b64(v2Json('Ignored'))), iend()])))
        expect(first.characters[0].name).toBe('FirstBig')
    })

    test('asset chunks no card refers to are still saved', async () => {
        const out = await run(fileOf(exportOrder(v2Json('Extra'), [200, 300]).bytes))
        expect(out.saved).toHaveLength(3)
    })
})

describe('PNG import of an old Tavern card that carries asset chunks (regression reproducer)', () => {
    test('only the image is saved, not the asset chunks no card refers to, and the character is imported as before', async () => {
        const tavern = JSON.stringify({ name: 'Old', description: 'd', first_mes: 'hi' })
        const out = await run(fileOf(build([ihdr(), idat(), assetChunk(0, 300), text('chara', b64(tavern)), iend()])))
        expect(out.errors).toEqual([])
        expect(out.characters).toHaveLength(1)
        expect(out.characters[0].name).toBe('Old')
        expect(out.saved.map((s) => s.id)).toEqual([sha1(concat([SIG, ihdr(), idat(), iend()]))])
    })
})

// ---------------------------------------------------------------------------------------------
// Memory: the file is read by offset, and no asset is ever one string
// ---------------------------------------------------------------------------------------------

/** A file that exists only as a list of parts: bytes, or a byte repeated. It counts every byte it hands out. */
class SparseFile extends File {
    handedOut = 0
    #total: number
    constructor(private readonly parts: Array<Uint8Array | { fill: number, length: number }>, name = 'big.png') {
        super([], name, { type: 'image/png' })
        this.#total = parts.reduce((n, p) => n + (p instanceof Uint8Array ? p.length : p.length), 0)
    }

    override get size() { return this.#total }

    readRange(start: number, end: number): Uint8Array {
        const out = new U8(Math.max(0, Math.min(end, this.#total) - start))
        let at = 0
        let partStart = 0
        for (const part of this.parts) {
            const length = part instanceof Uint8Array ? part.length : part.length
            const from = Math.max(start, partStart)
            const to = Math.min(end, partStart + length)
            if (to > from) {
                if (part instanceof Uint8Array) out.set(part.subarray(from - partStart, to - partStart), at)
                else out.fill(part.fill, at, at + (to - from))
                at += to - from
            }
            partStart += length
        }
        this.handedOut += out.length
        return out
    }

    override slice(start = 0, end = this.#total): Blob {
        const range = this.readRange(start, end)
        return { size: range.length, arrayBuffer: async () => range.buffer } as unknown as Blob
    }

    override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
        let at = 0
        const block = new U8(MIB).fill(0x41)
        const sample = this
        return new ReadableStream<Uint8Array<ArrayBuffer>>({
            pull(controller) {
                if (at >= sample.#total) {
                    controller.close()
                    return
                }
                const to = Math.min(at + MIB, sample.#total)
                //A block of one repeated byte is shared, not allocated per piece.
                const piece = sample.isFill(at, to) ? block.subarray(0, to - at) : new U8(sample.readRange(at, to))
                at = to
                controller.enqueue(piece)
            },
        })
    }

    isFill(start: number, end: number): boolean {
        let partStart = 0
        for (const part of this.parts) {
            const length = part instanceof Uint8Array ? part.length : part.length
            if (start < partStart + length && end > partStart) {
                if (part instanceof Uint8Array || part.fill !== 0x41 || start < partStart || end > partStart + length) return false
            }
            partStart += length
        }
        return true
    }
}

/** The length and type of a tEXt chunk header, the key and NUL, then `valueLength` bytes of 'A', a stand-in CRC. */
function bigTextChunk(key: string, valueLength: number): Array<Uint8Array | { fill: number, length: number }> {
    const header = new U8(8)
    new DataView(header.buffer).setUint32(0, key.length + 1 + valueLength)
    header.set(utf8('tEXt'), 4)
    return [header, utf8(key), new U8([0]), { fill: 0x41, length: valueLength }, new U8(4)]
}

describe('PNG import memory', () => {
    test('an asset whose base64 text is above the longest string is refused without reading it (regression reproducer)', async () => {
        const card = text('chara', b64(v2Json('Huge', additional(2))))
        const file = new SparseFile([SIG, ihdr(), assetChunk(0, 300), ...bigTextChunk('chara-ext-asset_:1', 540_000_000), card, iend()])
        h.probe = () => file.handedOut
        const out = await run(file)
        expectNothingSaved(out, language.cardFileEntryTooLarge('chara-ext-asset_:1', 200))
        expect(file.handedOut).toBeLessThan(MIB)
    })

    test('a card chunk above the longest string is refused without reading it (regression reproducer)', async () => {
        const file = new SparseFile([SIG, ihdr(), assetChunk(0, 300), ...bigTextChunk('ccv3', 540_000_000), iend()])
        h.probe = () => file.handedOut
        const out = await run(file)
        expectNothingSaved(out, language.errors.noData)
        expect(file.handedOut).toBeLessThan(MIB)
    })

    test('before the first asset is saved the importer has read at most a window for each pass and one asset (regression reproducer)', async () => {
        const WINDOW = 256 * 1024
        const sizes = Array.from({ length: 6 }, () => 300 * 1024)
        const { bytes } = exportOrder(v2Json('Mem', additional(6)), sizes)
        const file = new CountingFile([new U8(bytes)], 'card.png', { type: 'image/png' })
        h.probe = () => file.bytesRead
        const out = await run(file)
        expect(out.errors).toEqual([])
        expect(out.saved).toHaveLength(7)
        const firstAssetText = Math.ceil(300 * 1024 / 3) * 4
        expect(out.saved[0].bytesRead).toBeLessThanOrEqual(2 * WINDOW + firstAssetText + 16 * 1024)
    })

    test('the importer never asks the file for its whole content in one read', async () => {
        const sizes = Array.from({ length: 6 }, () => 300 * 1024)
        const { bytes } = exportOrder(v2Json('Mem', additional(6)), sizes)
        const file = new CountingFile([new U8(bytes)], 'card.png', { type: 'image/png' })
        await run(file)
        const largest = Math.max(...file.reads.map((r) => Number(r.split(':')[1])))
        expect(largest).toBeLessThan(bytes.length / 4)
    })
})

// ---------------------------------------------------------------------------------------------
// A file that changes between the two passes
// ---------------------------------------------------------------------------------------------

/** An import source over `bytes` that misbehaves once the first pass is over: `after` runs on the second `stat`. */
function changingSource(bytes: Uint8Array, mutate: { size?: number, modified?: number, corrupt?: (start: number, out: Uint8Array) => Uint8Array, failReads?: boolean }): ImportSource {
    const inner = importSourceOfBytes('card.png', bytes)
    let stats = 0
    return {
        name: inner.name,
        size: inner.size,
        stat: async () => {
            stats++
            const now = await inner.stat()
            return stats <= 1 ? now : { size: mutate.size ?? now.size, modified: mutate.modified ?? now.modified }
        },
        read: async (start, end) => {
            if (stats > 1 && mutate.failReads) throw new Error('the disk went away')
            const out = await inner.read(start, end)
            return stats > 1 && mutate.corrupt ? mutate.corrupt(start, new U8(out)) : out
        },
        stream: () => inner.stream(),
        close: () => inner.close(),
    }
}

describe('PNG import of a file that changes between the passes', () => {
    const { bytes } = exportOrder(v2Json('Moving', additional(3)))

    test('a size that is not the first one is refused with the changed-file message and nothing is saved', async () => {
        const out = await run(changingSource(bytes, { size: bytes.length + 10 }))
        expectNothingSaved(out, () => language.cardFileChanged)
    })

    test('a modification time that is not the first one is refused with the changed-file message and nothing is saved', async () => {
        const out = await run(changingSource(bytes, { modified: 12345 }))
        expectNothingSaved(out, () => language.cardFileChanged)
    })

    test('a chunk that is not where the first pass saw it is refused and no further asset is saved', async () => {
        const secondAssetAt = Buffer.from(bytes).indexOf('chara-ext-asset_:1') - 8
        const out = await run(changingSource(bytes, {
            corrupt: (start, read) => {
                if (start <= secondAssetAt && secondAssetAt < start + read.length) read[secondAssetAt - start + 3] ^= 0x01 //the chunk's length
                return read
            },
        }))
        expect(out.thrown).toBeNull()
        expect(out.errors).toEqual([language.cardFileChanged])
        expect(out.saved.map((s) => s.id)).toEqual([sha1(assetBytes(0, SIZES[0]))])
        expect(out.characters).toEqual([])
    })

    test('a read error in the second pass is refused with the changed-file message and saves nothing', async () => {
        const out = await run(changingSource(bytes, { failReads: true }))
        expectNothingSaved(out, () => language.cardFileChanged)
    })

    test('a read that answers short for the second asset, with the size and time unchanged, is refused and no further asset is saved', async () => {
        const secondAssetAt = Buffer.from(bytes).indexOf('chara-ext-asset_:1') - 8
        const out = await run(changingSource(bytes, {
            corrupt: (start, read) => {
                if (start <= secondAssetAt && secondAssetAt < start + read.length) return read.subarray(0, secondAssetAt - start + 40) //the header and key are intact, the value is cut
                return read
            },
        }))
        expect(out.thrown).toBeNull()
        expect(out.errors).toEqual([language.cardFileChanged])
        expect(out.saved.map((s) => s.id)).toEqual([sha1(assetBytes(0, SIZES[0]))])
        expect(out.characters).toEqual([])
    })

    test('a source whose first stat disagrees with its size is refused with the changed-file message and nothing is saved', async () => {
        const inner = importSourceOfBytes('card.png', bytes)
        const source: ImportSource = {
            name: inner.name,
            size: inner.size,
            stat: async () => ({ size: inner.size + 10, modified: (await inner.stat()).modified }),
            read: (start, end) => inner.read(start, end),
            stream: () => inner.stream(),
            close: () => inner.close(),
        }
        expectNothingSaved(await run(source), () => language.cardFileChanged)
    })
})

// ---------------------------------------------------------------------------------------------
// rcc fixtures
// ---------------------------------------------------------------------------------------------

/** A card image whose `chara` chunk is an rcc value; the encrypted part is the card text itself (decryption is the identity). */
function rccBytes(opts: { usePassword: boolean, content: string, assets?: number, badDigest?: boolean }): Uint8Array {
    const encrypted = Buffer.from(opts.content)
    const value = [
        'rcc', 'rccv1', encrypted.toString('base64'), opts.badDigest ? 'len0' : `len${encrypted.length}`,
        Buffer.from(JSON.stringify({ usePassword: opts.usePassword })).toString('base64'),
    ].join('||')
    const assets = Array.from({ length: opts.assets ?? 0 }, (_, i) => assetChunk(i, 500))
    return build([ihdr(), idat(), ...assets, text('chara', value), iend()])
}
