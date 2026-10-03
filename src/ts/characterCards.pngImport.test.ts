/**
 * PNG character import through `importCharacterProcess` and `downloadRisuHub` in `src/ts/characterCards.ts`.
 *
 * The real `characterCards.ts` and the real `pngChunk.ts` run against synthetic cards built here. Everything the
 * import reaches around them (the database, asset storage, alerts, the zip importer) is replaced by recorders, so each
 * test can compare what was saved, what the user was shown and which character came out.
 */

import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import crc32 from 'crc/crc32'

//#region module mocks

const h = vi.hoisted(() => {
    type Alert = { type?: string, msg?: string, submsg?: string }
    return {
        saved: [] as Array<{ id: string, length: number }>,
        events: [] as string[],
        errors: [] as string[],
        alerts: [] as Alert[],
        characters: [] as Array<Record<string, unknown>>,
        uuid: 0,
    }
})

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
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn((msg: string) => { h.errors.push(String(msg)) }),
    alertInput: vi.fn(async () => ''),
    alertMd: vi.fn(),
    alertNormal: vi.fn((msg: string) => { h.events.push('normal:' + msg) }),
    alertStore: { set: (v: { type?: string, msg?: string, submsg?: string }) => { h.alerts.push(v) }, subscribe: vi.fn(), update: vi.fn() },
    alertWait: vi.fn((msg: string) => { h.events.push('wait:' + msg) }),
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
    decryptBuffer: vi.fn(async (d: unknown) => d),
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
            h.saved.push({ id, length: data.length })
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

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/processzip'), () => ({
    CharXImporter: class {},
    CharXWriter: class {},
}) as unknown as typeof import('src/ts/process/processzip'))

vi.mock(import('src/ts/process/modules'), () => ({
    exportModuleLegacy: vi.fn(),
    readModule: vi.fn(),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: vi.fn(async () => new Uint8Array()),
}))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
}))

//#endregion

import { downloadRisuHub, importCharacterProcess } from 'src/ts/characterCards'
import { language } from 'src/lang'

// ---------------------------------------------------------------------------------------------
// Synthetic PNG cards (no real images, no user data)
// ---------------------------------------------------------------------------------------------

const U8 = Uint8Array
const SIG = new U8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const utf8 = (s: string) => new TextEncoder().encode(s)

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

const text = (key: string | Uint8Array, value: string) =>
    chunk('tEXt', concat([typeof key === 'string' ? utf8(key) : key, new U8([0]), utf8(value)]))
const iend = () => chunk('IEND', new U8(0))
const ihdr = () => chunk('IHDR', new U8(13).fill(1))
const idat = (n = 40) => chunk('IDAT', new U8(n).fill(7))
const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64')

/** Deterministic asset payload: distinct per index, `size` raw bytes, stored in a tEXt chunk as base64. */
function assetBytes(index: number, size: number): Uint8Array {
    return new U8(size).map((_, i) => (i * 31 + index * 17 + 5) & 0xff)
}
const assetValue = (index: number, size: number) => Buffer.from(assetBytes(index, size)).toString('base64')
const assetText = (index: number, size: number, keyPrefix: Uint8Array = new U8(0)) =>
    text(concat([keyPrefix, utf8(`chara-ext-asset_:${index}`)]), assetValue(index, size))

const v2Card = (assets: number) => JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
        name: 'Synthetic', description: 'd', first_mes: 'hi', character_version: '1',
        extensions: { risuai: { additionalAssets: Array.from({ length: assets }, (_, i) => [`a${i}`, `__asset:${i}`, 'bin']) } },
    },
})

const v3Card = (assets: number) => JSON.stringify({
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
        name: 'Synthetic', description: 'd', first_mes: 'hi', character_version: '1',
        extensions: { risuai: {} },
        assets: Array.from({ length: assets }, (_, i) => ({ type: 'x-risu-asset', uri: `__asset:${i}`, name: `a${i}`, ext: 'bin' })),
    },
})

type Built = { bytes: Uint8Array, starts: number[], sizes: number[] }

function build(chunks: Uint8Array[], sizes: number[]): Built {
    const starts: number[] = []
    let at = SIG.length
    for (const c of chunks) {
        starts.push(at)
        at += c.length
    }
    return { bytes: concat([SIG, ...chunks]), starts, sizes }
}

const ASSET_SIZES = [300, 1500, 40_000]

/** Assets first, then the card chunk, as the exporter writes them. */
function exportOrderCard(opts: { ccv3?: boolean, trailing?: Uint8Array, noIend?: boolean } = {}): Built {
    const n = ASSET_SIZES.length
    const chunks = [
        ihdr(), idat(),
        ...ASSET_SIZES.map((s, i) => assetText(i, s)),
        opts.ccv3 ? text('ccv3', b64(v3Card(n))) : text('chara', b64(v2Card(n))),
    ]
    if (!opts.noIend) chunks.push(iend())
    if (opts.trailing) chunks.push(opts.trailing)
    return build(chunks, ASSET_SIZES)
}

/** The card chunk first, then the assets and the image data. */
function charaFirstCard(opts: { noIend?: boolean } = {}): Built {
    const n = ASSET_SIZES.length
    const chunks = [ihdr(), text('chara', b64(v2Card(n))), ...ASSET_SIZES.map((s, i) => assetText(i, s)), idat(), idat(60)]
    if (!opts.noIend) chunks.push(iend())
    return build(chunks, ASSET_SIZES)
}

const bomKeyCard = (): Built => {
    const BOM = new U8([0xef, 0xbb, 0xbf])
    const n = 2
    return build([
        ihdr(), text(concat([BOM, utf8('chara')]), b64(v2Card(n))),
        assetText(0, 200, BOM), assetText(1, 300, BOM), idat(), iend(),
    ], [200, 300])
}

const noAssetCard = (): Built => build([ihdr(), idat(), text('chara', b64(v2Card(0))), iend()], [])

const fileOf = (bytes: Uint8Array, name = 'card.png') => new File([new U8(bytes)], name, { type: 'image/png' })
const streamOf = (bytes: Uint8Array, size = 997) => new ReadableStream<Uint8Array>({
    start(controller) {
        for (let i = 0; i < bytes.length; i += size) controller.enqueue(new U8(bytes.subarray(i, i + size)))
        controller.close()
    },
})

// ---------------------------------------------------------------------------------------------
// Running an import and describing what it did
// ---------------------------------------------------------------------------------------------

type Input = 'file' | 'uint8array' | 'stream'
type Outcome = {
    returned: number | null | undefined
    characters: Array<Record<string, unknown>>
    saved: Array<{ id: string, length: number }>
    errors: string[]
    /** every progress and wait message, in order */
    progress: string[]
    thrown: string | null
}

function reset() {
    h.saved = []
    h.events = []
    h.errors = []
    h.alerts = []
    h.characters = []
    h.uuid = 0
}

function describeOutcome(returned: number | null | undefined, thrown: string | null): Outcome {
    return {
        returned,
        characters: structuredClone(h.characters),
        saved: [...h.saved],
        errors: [...h.errors],
        progress: [
            ...h.events,
            ...h.alerts.map((a) => `${a.type}:${a.msg}:${a.submsg ?? ''}`),
        ],
        thrown,
    }
}

async function runImport(bytes: Uint8Array, input: Input): Promise<Outcome> {
    reset()
    const data = input === 'file' ? fileOf(bytes) : input === 'stream' ? streamOf(bytes) : new U8(bytes)
    let returned: number | null | undefined
    let thrown: string | null = null
    try {
        returned = await importCharacterProcess({ name: 'card.png', data })
    } catch (e) {
        thrown = e instanceof Error ? e.message : String(e)
    }
    return describeOutcome(returned, thrown)
}

beforeEach(() => {
    reset()
})

const originalFetch = globalThis.fetch

afterEach(() => {
    vi.stubGlobal('fetch', originalFetch)
    vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------------------------
// Compatibility guards: a card whose chunks are all complete imports the same through every input
// ---------------------------------------------------------------------------------------------

const completeCards: Array<[string, () => Built]> = [
    ['export order, chara', () => exportOrderCard()],
    ['export order, ccv3', () => exportOrderCard({ ccv3: true })],
    ['chara first', () => charaFirstCard()],
    ['keys with a BOM', () => bomKeyCard()],
    ['no assets', () => noAssetCard()],
]

describe('PNG import of complete cards (compatibility guard)', () => {
    test.each(completeCards)('File, Uint8Array and ReadableStream inputs give the same character, assets, image and progress: %s', async (_name, make) => {
        const card = make()
        const fromBytes = await runImport(card.bytes, 'uint8array')
        expect(fromBytes.thrown).toBeNull()
        expect(fromBytes.errors).toEqual([])
        expect(fromBytes.characters).toHaveLength(1)
        // every embedded asset and the trimmed image were saved
        expect(fromBytes.saved).toHaveLength(card.sizes.length + 1)
        for (let i = 0; i < card.sizes.length; i++) {
            const expected = createHash('sha1').update(assetBytes(i, card.sizes[i])).digest('hex')
            expect(fromBytes.saved.map((s) => s.id), `asset ${i}`).toContain(expected)
        }
        expect(await runImport(card.bytes, 'file'), 'File').toEqual(fromBytes)
        expect(await runImport(card.bytes, 'stream'), 'ReadableStream').toEqual(fromBytes)
    })

    test('shows the exact asset percentage sequence, then the assets of the card', async () => {
        const card = exportOrderCard()
        const out = await runImport(card.bytes, 'file')
        const loading = out.progress.filter((p) => p.startsWith('progress:Loading... (Loading Assets):'))
        // The first three belong to the PNG read (index / total), the rest to the character build.
        expect(loading.slice(0, 3)).toEqual([
            'progress:Loading... (Loading Assets):0.00',
            'progress:Loading... (Loading Assets):33.33',
            'progress:Loading... (Loading Assets):66.67',
        ])
    })

    test.each([
        ['IEND missing', () => exportOrderCard({ noIend: true })],
        ['trailing bytes after IEND', () => exportOrderCard({ trailing: utf8('\0\0\0\u0005tEXtchara\0zzzzz') })],
        ['IEND missing, chara first', () => charaFirstCard({ noIend: true })],
    ] as Array<[string, () => Built]>)('imports with all assets: %s', async (_name, make) => {
        const card = make()
        for (const input of ['file', 'uint8array'] as const) {
            const out = await runImport(card.bytes, input)
            expect(out.thrown, input).toBeNull()
            expect(out.errors, input).toEqual([])
            expect(out.characters, input).toHaveLength(1)
            expect(out.saved.length, input).toBe(card.sizes.length + 1)
        }
    })

    test.each([1, 4, 7, 8, 10])('imports a card cut %i bytes into its IEND chunk, with all assets', async (into) => {
        const card = exportOrderCard()
        const cut = card.bytes.subarray(0, card.starts[card.starts.length - 1] + into)
        for (const input of ['file', 'uint8array'] as const) {
            const out = await runImport(cut, input)
            expect(out.thrown, input).toBeNull()
            expect(out.errors, input).toEqual([])
            expect(out.characters, input).toHaveLength(1)
            expect(out.saved.length, input).toBe(card.sizes.length + 1)
        }
    })

    test('a complete PNG with no card data gives noData and saves nothing', async () => {
        const bytes = build([ihdr(), idat(), iend()], []).bytes
        for (const input of ['file', 'uint8array'] as const) {
            const out = await runImport(bytes, input)
            expect(out.errors, input).toEqual([language.errors.noData])
            expect(out.saved, input).toEqual([])
            expect(out.characters, input).toEqual([])
        }
    })
})

// ---------------------------------------------------------------------------------------------
// Cut cards are refused before anything is saved
// ---------------------------------------------------------------------------------------------

function expectRefused(out: Outcome, label: string) {
    expect(out.thrown, `${label}: no throw`).toBeNull()
    expect(out.saved, `${label}: nothing saved`).toEqual([])
    expect(out.characters, `${label}: no character`).toEqual([])
    expect(out.errors, `${label}: message`).toEqual([language.cardFileIncomplete])
}

describe('PNG import of cut cards (regression reproducer)', () => {
    test('a Uint8Array card cut inside its last asset body is refused with nothing saved', async () => {
        const card = charaFirstCard()
        // chara-first: chara, asset 0, asset 1, asset 2, then image data; cut inside asset 2's body
        const assetStart = card.starts[1 + ASSET_SIZES.length]
        const cut = card.bytes.subarray(0, assetStart + 8 + 100)
        expectRefused(await runImport(cut, 'uint8array'), 'Uint8Array')
    })

    test('a File export-order card cut inside an asset body is refused before the earlier assets are saved', async () => {
        const card = exportOrderCard()
        const cut = card.bytes.subarray(0, card.starts[3] + 8 + 100)
        expectRefused(await runImport(cut, 'file'), 'File')
        expectRefused(await runImport(cut, 'uint8array'), 'Uint8Array')
    })

    test('an export-order card cut exactly where the card chunk would start is refused with nothing saved', async () => {
        const card = exportOrderCard({ ccv3: true })
        const cut = card.bytes.subarray(0, card.starts[2 + ASSET_SIZES.length])
        expectRefused(await runImport(cut, 'file'), 'File')
        expectRefused(await runImport(cut, 'uint8array'), 'Uint8Array')
    })

    test.each([1, 2, 3, 4, 5, 6, 7])('an export-order card cut %i bytes into the header of its card chunk is refused with nothing saved', async (into) => {
        const card = exportOrderCard({ ccv3: true })
        const cut = card.bytes.subarray(0, card.starts[2 + ASSET_SIZES.length] + into)
        expectRefused(await runImport(cut, 'file'), 'File')
        expectRefused(await runImport(cut, 'uint8array'), 'Uint8Array')
    })

    test('a chara-first card cut inside the CRC of its last image chunk is refused with nothing saved', async () => {
        const card = charaFirstCard()
        const lastIdat = card.starts[card.starts.length - 2]
        const cut = card.bytes.subarray(0, lastIdat + 8 + 60 + 2)
        expectRefused(await runImport(cut, 'file'), 'File')
        expectRefused(await runImport(cut, 'uint8array'), 'Uint8Array')
    })

    test('a ReadableStream card cut inside an asset body is refused with nothing saved', async () => {
        const card = exportOrderCard()
        const cut = card.bytes.subarray(0, card.starts[3] + 8 + 100)
        expectRefused(await runImport(cut, 'stream'), 'ReadableStream')
    })

    test('a PNG that is not a card but has asset chunks gives noData and saves nothing', async () => {
        const bytes = build([ihdr(), assetText(0, 100), assetText(1, 100), iend()], []).bytes
        for (const input of ['file', 'uint8array'] as const) {
            const out = await runImport(bytes, input)
            expect(out.errors, input).toEqual([language.errors.noData])
            expect(out.saved, input).toEqual([])
        }
    })

    test('a cut file with no card data at all reports an incomplete file, not noData', async () => {
        const bytes = build([ihdr(), idat()], []).bytes
        const out = await runImport(bytes.subarray(0, bytes.length - 3), 'file')
        expectRefused(out, 'File')
    })
})

// ---------------------------------------------------------------------------------------------
// Realm download
// ---------------------------------------------------------------------------------------------

describe('downloadRisuHub PNG download', () => {
    function realmResponse(bytes: Uint8Array, overrides: { blob?: () => Promise<Blob>, body?: ReadableStream<Uint8Array> } = {}) {
        const res = new Response(new U8(bytes), { status: 200, headers: { 'content-type': 'image/png' } })
        const body = overrides.body ?? res.body
        const bodyGetter = vi.fn(() => body)
        if (overrides.blob) {
            Object.defineProperty(res, 'blob', { value: overrides.blob })
        }
        Object.defineProperty(res, 'body', { get: bodyGetter })
        return { res, bodyGetter }
    }

    test('reads the download as a Blob and imports the card without teeing or streaming the body', async () => {
        const card = exportOrderCard()
        const { res, bodyGetter } = realmResponse(card.bytes)
        const tee = vi.spyOn(ReadableStream.prototype, 'tee')
        vi.stubGlobal('fetch', vi.fn(async () => res))

        await downloadRisuHub('some-id')

        expect(bodyGetter).not.toHaveBeenCalled()
        expect(tee).not.toHaveBeenCalled()
        expect(h.errors).toEqual([])
        expect(h.characters).toHaveLength(1)
        expect(h.saved).toHaveLength(card.sizes.length + 1)
    })

    test('imports the same character and assets as the same card dropped as a File (compatibility guard)', async () => {
        const card = exportOrderCard()
        const fromFile = await runImport(card.bytes, 'file')
        reset()
        vi.stubGlobal('fetch', vi.fn(async () => realmResponse(card.bytes).res))
        await downloadRisuHub('some-id')
        const fromRealm = describeOutcome(undefined, null)
        expect(fromRealm.errors).toEqual([])
        expect(fromRealm.characters).toEqual(fromFile.characters)
        expect(fromRealm.saved).toEqual(fromFile.saved)
    })

    test('a download cut inside an asset body is refused with nothing saved', async () => {
        const card = exportOrderCard()
        const cut = card.bytes.subarray(0, card.starts[3] + 8 + 100)
        vi.stubGlobal('fetch', vi.fn(async () => realmResponse(cut).res))
        await downloadRisuHub('some-id')
        expect(h.saved).toEqual([])
        expect(h.characters).toEqual([])
        expect(h.errors).toEqual([language.cardFileIncomplete])
    })

    test('a download whose body fails still ends in an error and imports nothing (compatibility guard)', async () => {
        const card = exportOrderCard()
        const { res } = realmResponse(card.bytes, {
            blob: async () => { throw new TypeError('network error') },
            body: new ReadableStream<Uint8Array>({ start(controller) { controller.error(new TypeError('network error')) } }),
        })
        vi.stubGlobal('fetch', vi.fn(async () => res))
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.spyOn(console, 'log').mockImplementation(() => {})
        await downloadRisuHub('some-id')
        expect(h.errors).toEqual(['Error while importing'])
        expect(h.saved).toEqual([])
        expect(h.characters).toEqual([])
    })
})
