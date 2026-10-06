// @vitest-environment happy-dom

/**
 * The progress texts, wait texts and import errors of `characterCards.ts` and `processzip.ts` are read from the active
 * UI language at the moment they are shown, and the English texts stay what they are.
 *
 * The real `characterCards.ts`, `processzip.ts` and `pngChunk.ts` run on synthetic archives, images and characters.
 * Everything they reach around them (the database, asset storage, alerts, the network) is replaced by recorders, so no
 * test writes anything or contacts a service. A mocked save is not evidence of how native storage behaves.
 *
 * Titles beginning "regression reproducer:" fail against the version that shows fixed English texts under every
 * language; titles beginning "guard:" pin behaviour that is the same before and after the change.
 */

import crc32 from 'crc/crc32'
import * as fflate from 'fflate'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const h = vi.hoisted(() => ({
    /** every wait and progress message, in the order the user would see it */
    shown: [] as string[],
    errors: [] as string[],
    characters: [] as Array<Record<string, unknown>>,
    saveFails: null as string | null,
    /** the arguments of every picker initialisation of the local writer */
    pickerInits: [] as Array<[string, string[]]>,
    uuid: 0,
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
        alertStore: {
            set: (v: { type?: string, msg?: string }) => { if (v.type === 'wait' || v.type === 'progress') h.shown.push(v.msg ?? '') },
            subscribe: vi.fn(),
            update: vi.fn(),
        },
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
    getDatabase: vi.fn(() => ({ statics: { imports: 0 }, characters: h.characters, modules: [], goCharacterOnImport: false })),
    setDatabaseLite: vi.fn(),
    appVer: 'test',
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/util'), () => {
    class Semaphore {
        private available: number
        private readonly max: number
        private waiting: Array<() => void> = []
        constructor(max: number) { this.available = max; this.max = max }
        async acquire(): Promise<void> {
            if (this.available > 0) { this.available -= 1; return }
            await new Promise<void>((resolve) => this.waiting.push(resolve))
        }
        release(): void {
            const next = this.waiting.shift()
            if (next) { next(); return }
            if (this.available < this.max) this.available += 1
        }
    }
    return {
        asBuffer: (a: unknown) => a,
        Semaphore,
        checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
        checkPersonaBinded: vi.fn(),
        decryptBuffer: vi.fn(async (d: unknown) => d),
        isKnownUri: vi.fn((uri: string) => uri === 'ccdefault:'),
        selectFileByDom: vi.fn(async () => null),
        selectSingleFile: vi.fn(async () => null),
        sleep: vi.fn(async () => {}),
    } as unknown as typeof import('src/ts/util')
})

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(async () => {}),
    characterFormatUpdate: vi.fn((c: unknown) => c),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { AppendableBuffer } = await import('src/ts/byteBuffer')
    const enc = new TextEncoder()
    return {
        AppendableBuffer,
        BlankWriter: class {},
        //The picker initialisation is recorded; nothing is written anywhere.
        LocalWriter: class {
            async init(name: string, ext: string[]) { h.pickerInits.push([name, ext]); return true }
            async write() {}
            async close() {}
        },
        VirtualWriter: class {},
        checkCharOrder: vi.fn(),
        downloadFile: vi.fn(async () => {}),
        forageStorage: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
        loadAsset: vi.fn(async () => new Uint8Array([9, 9])),
        openURL: vi.fn(),
        readImage: vi.fn(async (d: unknown) => typeof d === 'string' ? enc.encode(d) : d),
        saveAsset: vi.fn(async (data: Uint8Array) => {
            if (h.saveFails !== null) throw new Error(h.saveFails)
            return `asset-${data[0]}-${data.length}`
        }),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'png'),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { characters: h.characters, modules: [] } } },
    HideIconStore: { set: vi.fn() },
    moduleBackgroundEmbedding: { set: vi.fn() },
    ReloadGUIPointer: { set: vi.fn() },
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

vi.mock(import('src/ts/process/modules'), () => ({
    exportModuleLegacy: vi.fn(async () => new Uint8Array([1, 2, 3])),
    readModule: vi.fn(async () => ({ lorebook: [], trigger: [], regex: [] })),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(async (d: Uint8Array) => d),
    encodeRPack: vi.fn(async (d: Uint8Array) => d),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: vi.fn(async () => new Uint8Array()),
}))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
}))

//#endregion

import { downloadRisuHub, exportCharacterCard, importCharacterProcess } from 'src/ts/characterCards'
import { CharXWriter, processZip } from 'src/ts/process/processzip'
import type { character } from 'src/ts/storage/database.svelte'
import type { VirtualWriter } from 'src/ts/globalApi.svelte'
import { changeLanguage } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'
import { fillLang } from 'src/lang/fill'

// ---------------------------------------------------------------------------------------------
// Locale values
// ---------------------------------------------------------------------------------------------

type AlertKey = keyof typeof languageEnglish.alerts
type ErrorKey = keyof typeof languageEnglish.errors

/** The Korean value of an alert text; it must exist and differ from the English text for a test to mean anything. */
function koAlert(key: AlertKey): string {
    const value = languageKorean.alerts?.[key] as string | undefined
    expect(value, `ko alerts.${key} is translated`).toBeTypeOf('string')
    expect(value, `ko alerts.${key} differs from English`).not.toBe(languageEnglish.alerts[key])
    return value as string
}

function koError(key: ErrorKey): string {
    const value = languageKorean.errors?.[key] as string | undefined
    expect(value, `ko errors.${key} is translated`).toBeTypeOf('string')
    expect(value, `ko errors.${key} differs from English`).not.toBe(languageEnglish.errors[key])
    return value as string
}

/** Messages in the order first shown, with consecutive repeats of one message collapsed. */
const sequence = (messages: string[]) => messages.filter((m, i) => i === 0 || m !== messages[i - 1])
/** Messages in the order first shown, each once. */
const distinct = (messages: string[]) => [...new Set(messages)]

// ---------------------------------------------------------------------------------------------
// Synthetic inputs (no real images, no user data)
// ---------------------------------------------------------------------------------------------

const U8 = Uint8Array
const enc = new TextEncoder()
const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64')

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new U8(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) { out.set(p, at); at += p.length }
    return out
}

function pngChunk(type: string, body: Uint8Array): Uint8Array {
    const t = enc.encode(type)
    const out = new U8(12 + body.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, body.length)
    out.set(t, 4)
    out.set(body, 8)
    view.setUint32(8 + body.length, crc32(Buffer.from(out.subarray(4, 8 + body.length))))
    return out
}

const SIGNATURE = new U8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const textChunk = (key: string, value: string) => pngChunk('tEXt', concat([enc.encode(key), new U8([0]), enc.encode(value)]))
const plainPng = () => concat([SIGNATURE, pngChunk('IHDR', new U8(13).fill(1)), pngChunk('IDAT', new U8(20).fill(2)), pngChunk('IEND', new U8(0))])

/** A v2 card image whose emotion, additional asset and vits entries all point at embedded asset chunks. */
function v2AssetPng(): Uint8Array {
    const card = JSON.stringify({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name: 'Synthetic', description: 'd', first_mes: 'hi', character_version: '1',
            extensions: { risuai: {
                emotions: [['happy', '__asset:0']],
                additionalAssets: [['a', '__asset:1', 'bin']],
                vits: { model: '__asset:2' },
            } },
        },
    })
    return concat([
        SIGNATURE, pngChunk('IHDR', new U8(13).fill(1)),
        textChunk('chara', b64(card)),
        ...[0, 1, 2].map((i) => textChunk(`chara-ext-asset_:${i}`, Buffer.from(new U8(30).fill(i + 1)).toString('base64'))),
        pngChunk('IDAT', new U8(20).fill(2)), pngChunk('IEND', new U8(0)),
    ])
}

const ASSET_PATHS = ['assets/a.bin', 'assets/b.bin', 'assets/c.bin']

const v3CardJson = (uris: string[]) => JSON.stringify({
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
        name: 'Synthetic', description: 'd', first_mes: 'hi', character_version: '1',
        extensions: { risuai: {} },
        assets: uris.map((uri, i) => ({ type: 'x-risu-asset', uri, name: `a${i}`, ext: 'bin' })),
    },
})

/** A charx archive whose card names its assets by the `embeded://` scheme. */
function charxArchive(): File {
    const files: fflate.Zippable = { 'card.json': [enc.encode(v3CardJson(ASSET_PATHS.map((p) => 'embeded://' + p))), { level: 0 }] }
    ASSET_PATHS.forEach((p, i) => { files[p] = [new U8(64).fill(i + 1), { level: 0 }] })
    return new File([new U8(fflate.zipSync(files))], 'card.charx', { type: 'application/zip' })
}

const jsonCard = (card: unknown) => enc.encode(JSON.stringify(card))

const v2Json = (risuai: Record<string, unknown>) => ({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: { name: 'Synthetic', description: 'd', first_mes: 'hi', character_version: '1', extensions: { risuai } },
})

const v3Json = (uri: string) => JSON.parse(v3CardJson([uri]))

/** A character with one asset of each kind the exporter writes. */
function exportedCharacter(): character {
    return {
        name: 'Synthetic',
        image: 'main-image',
        desc: 'd',
        firstMessage: 'hi',
        globalLore: [],
        emotionImages: [['happy', 'emotion-key']],
        additionalAssets: [['extra', 'asset-key', 'png']],
        ttsMode: 'vits',
        vits: { name: 'v', id: 'v', files: { model: 'vits-key' } },
    } as unknown as character
}

/** Records what the exporter writes, as a stand-in for the file the user chose. */
function sink() {
    const chunks: Uint8Array[] = []
    return {
        chunks,
        writer: {
            write: async (b: Uint8Array) => { chunks.push(new U8(b)) },
            close: async () => {},
        } as unknown as VirtualWriter,
    }
}

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

beforeEach(() => {
    h.shown = []
    h.errors = []
    h.characters = []
    h.saveFails = null
    h.pickerInits = []
    h.uuid = 0
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

const originalFetch = globalThis.fetch

afterEach(() => {
    changeLanguage('en')
    vi.stubGlobal('fetch', originalFetch)
    vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------------------------
// Import progress
// ---------------------------------------------------------------------------------------------

describe('card import progress texts', () => {
    test('guard: English PNG import shows the reading, loading assets, loading emotions and loading VITS texts', async () => {
        await importCharacterProcess({ name: 'card.png', data: v2AssetPng() })
        expect(h.errors).toEqual([])
        expect(distinct(h.shown)).toEqual([
            'Loading... (Reading)',
            'Loading... (Loading Assets)',
            'Loading... (Loading Emotions)',
            'Loading... (Loading VITS)',
        ])
    })

    test('regression reproducer: Korean PNG import shows the Korean reading, loading assets, loading emotions and loading VITS texts', async () => {
        const expected = [koAlert('readingCard'), koAlert('loadingAssets'), koAlert('loadingEmotions'), koAlert('loadingVits')]
        changeLanguage('ko')
        await importCharacterProcess({ name: 'card.png', data: v2AssetPng() })
        expect(h.errors).toEqual([])
        expect(distinct(h.shown)).toEqual(expected)
    })

    test('regression reproducer: Korean PNG import without card data still shows the Korean reading text', async () => {
        const expected = koAlert('readingCard')
        changeLanguage('ko')
        await importCharacterProcess({ name: 'card.png', data: plainPng() })
        expect(h.shown[0]).toBe(expected)
    })

    test('regression reproducer: English charx import builds a v3 character under the text "Loading... (Loading Assets)"', async () => {
        await importCharacterProcess({ name: 'card.charx', data: charxArchive() })
        expect(h.errors).toEqual([])
        expect(sequence(h.shown)).toEqual([
            'Loading... (Reading)',
            'Loading... (Saving Assets 1/3)',
            'Loading... (Saving Assets 2/3)',
            'Loading... (Saving Assets 3/3)',
            'Loading... (Loading Assets)',
        ])
    })

    test('regression reproducer: Korean charx import shows the Korean reading, saving assets (with the counts) and loading assets texts', async () => {
        const reading = koAlert('readingCard')
        const saving = koAlert('savingAssets')
        const loading = koAlert('loadingAssets')
        expect(saving).toContain('{done}')
        expect(saving).toContain('{total}')
        changeLanguage('ko')
        await importCharacterProcess({ name: 'card.charx', data: charxArchive() })
        expect(h.errors).toEqual([])
        expect(sequence(h.shown)).toEqual([
            reading,
            fillLang(saving, { done: 1, total: 3 }),
            fillLang(saving, { done: 2, total: 3 }),
            fillLang(saving, { done: 3, total: 3 }),
            loading,
        ])
    })

    test('regression reproducer: Korean charx import whose asset saves fail reports the Korean saved-assets failure with the count', async () => {
        const expected = fillLang(koError('moduleAssetsSaveFailed'), { count: 3 })
        changeLanguage('ko')
        h.saveFails = 'storage full'
        await importCharacterProcess({ name: 'card.charx', data: charxArchive() })
        expect(h.errors).toEqual([expected])
    })

    test('guard: English charx import whose asset saves fail reports "Failed to save 3 assets"', async () => {
        h.saveFails = 'storage full'
        await importCharacterProcess({ name: 'card.charx', data: charxArchive() })
        expect(h.errors).toEqual(['Failed to save 3 assets'])
    })
})

// ---------------------------------------------------------------------------------------------
// Missing assets
// ---------------------------------------------------------------------------------------------

const missingAssetCards: Array<[string, string, () => Uint8Array]> = [
    ['an emotion', 'e', () => jsonCard(v2Json({ emotions: [['happy', '__asset:e']] }))],
    ['an additional asset', 'x', () => jsonCard(v2Json({ additionalAssets: [['a', '__asset:x', 'bin']] }))],
    ['a vits file', 'v', () => jsonCard(v2Json({ vits: { model: '__asset:v' } }))],
    ['a v3 asset by the __asset: scheme', 'k1', () => jsonCard(v3Json('__asset:k1'))],
    ['a v3 asset by the embeded:// scheme', 'assets/missing.bin', () => jsonCard(v3Json('embeded://assets/missing.bin'))],
]

describe('card import of a missing asset', () => {
    test.each(missingAssetCards)('guard: English import of %s that is not in the file reports the English text with the key', async (_label, key, make) => {
        await importCharacterProcess({ name: 'card.json', data: make() })
        expect(h.errors).toEqual([`Error while importing, asset ${key} not found`])
        expect(h.characters).toEqual([])
    })

    test.each(missingAssetCards)('regression reproducer: Korean import of %s that is not in the file reports the Korean text with the key filled in', async (_label, key, make) => {
        const template = koError('importAssetNotFound')
        expect(template).toContain('{key}')
        changeLanguage('ko')
        await importCharacterProcess({ name: 'card.json', data: make() })
        expect(h.errors).toEqual([fillLang(template, { key })])
        expect(h.errors[0]).not.toContain('{key}')
        expect(h.characters).toEqual([])
    })
})

// ---------------------------------------------------------------------------------------------
// ZIP without an image
// ---------------------------------------------------------------------------------------------

describe('processZip without an image', () => {
    const textOnlyZip = () => fflate.zipSync({ 'notes.txt': enc.encode('synthetic') })

    test('guard: English processZip rejects with "No image found in ZIP file"', async () => {
        await expect(processZip(textOnlyZip())).rejects.toThrow('No image found in ZIP file')
    })

    test('regression reproducer: Korean processZip rejects with the Korean no-image text', async () => {
        const expected = koError('noImageInZip')
        changeLanguage('ko')
        await expect(processZip(textOnlyZip())).rejects.toThrow(expected)
    })
})

// ---------------------------------------------------------------------------------------------
// Export progress
// ---------------------------------------------------------------------------------------------

describe('card export progress texts', () => {
    const v2Png = (language: string) => async () => {
        changeLanguage(language)
        const out = sink()
        await exportCharacterCard(exportedCharacter(), 'png', { writer: out.writer, spec: 'v2' })
        return out
    }
    const v3Png = (language: string) => async () => {
        changeLanguage(language)
        const out = sink()
        const char = exportedCharacter()
        char.image = 'main-image'
        await exportCharacterCard(char, 'png', { writer: out.writer, spec: 'v3' })
        return out
    }

    test('guard: English v2 PNG export shows the adding VITS and writing texts in step order', async () => {
        await v2Png('en')()
        expect(h.errors).toEqual([])
        expect(distinct(h.shown)).toEqual([
            'Loading... (Adding VITS)',
            'Loading... (Writing)',
        ])
    })

    test('regression reproducer: Korean v2 PNG export shows the Korean adding VITS and writing texts in step order', async () => {
        const expected = [koAlert('addingVits'), koAlert('writingPng')]
        await v2Png('ko')()
        expect(h.errors).toEqual([])
        expect(distinct(h.shown)).toEqual(expected)
    })

    test('guard: English v3 PNG export shows the adding assets and writing texts', async () => {
        await v3Png('en')()
        expect(h.errors).toEqual([])
        expect(distinct(h.shown)).toEqual(['Loading... (Adding Assets)', 'Loading... (Writing)'])
    })

    test('regression reproducer: Korean v3 PNG export shows the Korean adding assets and writing texts', async () => {
        const expected = [koAlert('addingCardAssets'), koAlert('writingPng')]
        await v3Png('ko')()
        expect(h.errors).toEqual([])
        expect(distinct(h.shown)).toEqual(expected)
    })
})

// ---------------------------------------------------------------------------------------------
// Export picker and the embeded:// scheme
// ---------------------------------------------------------------------------------------------

describe('charx export', () => {
    test('regression reproducer: the Jpeg charx export opens the file picker labelled "CharX Embedded Jpeg" with the jpeg extension', async () => {
        await exportCharacterCard(exportedCharacter(), 'charxJpeg', { spec: 'v3' })
        expect(h.pickerInits).toEqual([['CharX Embedded Jpeg', ['jpeg']]])
    })

    test('guard: the charx export opens the file picker labelled "CharX File" with the charx extension', async () => {
        await exportCharacterCard(exportedCharacter(), 'charx', { spec: 'v3' })
        expect(h.pickerInits).toEqual([['CharX File', ['charx']]])
    })

    test('guard: an exported charx names its assets by the embeded:// scheme and imports back with those assets', async () => {
        const out = sink()
        await exportCharacterCard(exportedCharacter(), 'charx', { writer: out.writer, spec: 'v3' })
        expect(h.errors).toEqual([])
        const archive = concat(out.chunks)
        const files = fflate.unzipSync(archive)
        const card = JSON.parse(new TextDecoder().decode(files['card.json'])) as { data: { assets: Array<{ uri: string, type: string }> } }
        const uris = card.data.assets.map((a) => a.uri)
        expect(card.data.assets.filter((a) => a.type === 'x-risu-asset').map((a) => a.uri)).toEqual(['embeded://assets/other/image/extra.png'])
        expect(uris.some((u) => u.startsWith('embedded://'))).toBe(false)

        h.shown = []
        const index = await importCharacterProcess({ name: 'card.charx', data: new File([new U8(archive)], 'card.charx', { type: 'application/zip' }) })
        expect(h.errors).toEqual([])
        expect(index).toBe(0)
        const imported = h.characters[0] as { additionalAssets?: Array<[string, string, string]> }
        expect(imported.additionalAssets?.map((a) => a[0])).toEqual(['extra'])
        expect(imported.additionalAssets?.[0][1]).toMatch(/^asset-/)
    })

    test('guard: a card that names an asset by the embeded:// scheme imports it from the archive', async () => {
        const index = await importCharacterProcess({ name: 'card.charx', data: charxArchive() })
        expect(h.errors).toEqual([])
        expect(index).toBe(0)
        const imported = h.characters[0] as { additionalAssets?: Array<[string, string, string]> }
        expect(imported.additionalAssets).toHaveLength(3)
    })
})

// ---------------------------------------------------------------------------------------------
// Realm download
// ---------------------------------------------------------------------------------------------

describe('Realm download wait text', () => {
    const failingDownload = () => vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })))

    test('guard: English Realm download shows "Downloading..." before the request', async () => {
        failingDownload()
        await downloadRisuHub('some-id', { creator: 'some-creator' })
        expect(h.shown).toEqual(['Downloading...'])
        expect(h.errors).toEqual(['unavailable'])
    })

    test('regression reproducer: Korean Realm download shows the Korean downloading text before the request', async () => {
        const expected = koAlert('downloading')
        changeLanguage('ko')
        failingDownload()
        await downloadRisuHub('some-id', { creator: 'some-creator' })
        expect(h.shown).toEqual([expected])
    })

    test('guard: a forced-redirect Realm download shows no wait text', async () => {
        failingDownload()
        await downloadRisuHub('some-id', { forceRedirect: true, creator: 'some-creator' })
        expect(h.shown).toEqual([])
    })
})
