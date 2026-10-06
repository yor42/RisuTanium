// @vitest-environment happy-dom

/**
 * `importCharacter` (the file picker) and `importCharacterProcess` in `src/ts/characterCards.ts`: every picked file is
 * attempted whatever an earlier file's outcome, and the last message of the action says what did not import and why.
 *
 * The real `characterCards.ts` and `processzip.ts` run on synthetic archives, cards and images. All alert functions
 * write one slot, like the real store, so a test reads what the user would be left looking at. The confirm prompt shows
 * an 'ask' value and leaves the slot at 'none' once answered, as the real prompt does.
 */

import { createHash } from 'node:crypto'
import crc32 from 'crc/crc32'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fflate from 'fflate'
import { patterned, risumBytes } from 'src/ts/process/tests/risumFixtures'

//#region module mocks

const h = vi.hoisted(() => ({
    /** what the single alert slot holds: every alert function replaces it */
    last: 'none' as string,
    errors: [] as string[],
    characters: [] as Array<Record<string, unknown>>,
    /** the files the picker hands over */
    picked: null as File[] | null,
    confirm: true,
    /** every asset save fails with this message while it is set */
    saveFails: null as string | null,
    ordered: 0,
    uuid: 0,
    /** the files a desktop open-with hands over, by path */
    files: new Map<string, Uint8Array>(),
    /** the buffer size of every plugin `read` */
    readSizes: [] as number[],
    openHandles: 0,
    /** the bytes every plugin `read` has handed out */
    bytesRead: 0,
    /** every asset save: a hash of the asset and the bytes the open files had handed out at that moment */
    saves: [] as { hash: string, bytesRead: number }[],
    os: 'windows',
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
        alertClear: vi.fn(() => { h.last = 'none' }),
        alertConfirm: vi.fn(async () => { h.last = 'ask'; const answer = h.confirm; h.last = 'none'; return answer }),
        alertError: vi.fn((msg: string | Error) => { h.errors.push(text(msg)); h.last = 'error:' + text(msg) }),
        alertInput: vi.fn(async () => ''),
        alertMd: vi.fn(),
        alertModuleSelect: vi.fn(),
        alertNormal: vi.fn((msg: string) => { h.last = 'normal:' + msg }),
        alertStore: {
            set: (v: { type?: string, msg?: string }) => { h.last = v.type === 'none' ? 'none' : `${v.type}:${v.msg}` },
            subscribe: vi.fn(),
            update: vi.fn(),
        },
        alertWait: vi.fn((msg: string) => { h.last = 'wait:' + msg }),
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
        isKnownUri: vi.fn(() => false),
        selectFileByDom: vi.fn(async () => h.picked),
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
    return {
        AppendableBuffer,
        BlankWriter: class {},
        LocalWriter: class {},
        VirtualWriter: class {},
        checkCharOrder: vi.fn(() => { h.ordered++ }),
        downloadFile: vi.fn(async () => {}),
        forageStorage: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
        loadAsset: vi.fn(async () => new Uint8Array()),
        openURL: vi.fn(),
        readImage: vi.fn(async (d: unknown) => d),
        saveAsset: vi.fn(async (data: Uint8Array) => {
            h.saves.push({ hash: createHash('sha256').update(data).digest('hex'), bytesRead: h.bytesRead })
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

/** The largest file payload one plugin call may carry; a call above it rejects, the way the per-call bound would fail it. */
const CALL_CAP = 4 * 1024 * 1024

vi.mock('@tauri-apps/plugin-fs', () => ({
    SeekMode: { Start: 0, Current: 1, End: 2 },
    readFile: vi.fn(async (path: string) => {
        const data = h.files.get(path) ?? new Uint8Array()
        if (data.length > CALL_CAP) {
            throw new Error(`readFile carries ${data.length} bytes, above the per-call bound`)
        }
        return data
    }),
    open: vi.fn(async (path: string) => {
        const data = h.files.get(path)
        if (data === undefined) {
            throw `failed to open ${path} (os error 2)`
        }
        let position = 0
        h.openHandles++
        return {
            read: async (buffer: Uint8Array) => {
                h.readSizes.push(buffer.byteLength)
                if (buffer.byteLength > CALL_CAP) {
                    throw new Error(`read asks for ${buffer.byteLength} bytes, above the per-call bound`)
                }
                if (position >= data.length) {
                    return null
                }
                const count = Math.min(buffer.byteLength, data.length - position)
                buffer.set(data.subarray(position, position + count), 0)
                position += count
                h.bytesRead += count
                return count
            },
            seek: async (offset: number) => {
                position = offset
                return position
            },
            stat: async () => ({ size: data.length, mtime: null }),
            close: async () => { h.openHandles-- },
        }
    }),
}))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => h.os }))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
}))

//#endregion

import { importCharacter, importCharacterProcess, importOpenedFiles } from 'src/ts/characterCards'
import { charxLimits } from 'src/ts/process/processzip'
import { language } from 'src/lang'

// ---------------------------------------------------------------------------------------------
// Synthetic files (no real images, no user data)
// ---------------------------------------------------------------------------------------------

const U8 = Uint8Array
const enc = new TextEncoder()

const v3Json = (name: string, over: { lowLevelAccess?: boolean, assets?: number } = {}) => JSON.stringify({
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
        name, description: 'd', first_mes: 'hi', character_version: '1',
        extensions: { risuai: over.lowLevelAccess ? { lowLevelAccess: true } : {} },
        assets: Array.from({ length: over.assets ?? 0 }, (_, i) => ({ type: 'x-risu-asset', uri: `embeded://assets/a${i}.bin`, name: `a${i}`, ext: 'bin' })),
    },
})

function charx(name: string, over: { lowLevelAccess?: boolean, assets?: number } = {}, fileName = `${name}.charx`): File {
    const files: fflate.Zippable = { 'card.json': [enc.encode(v3Json(name, over)), { level: 0 }] }
    for (let i = 0; i < (over.assets ?? 0); i++) {
        files[`assets/a${i}.bin`] = [new U8(64).fill(i + 1), { level: 0 }]
    }
    return new File([new U8(fflate.zipSync(files))], fileName, { type: 'application/zip' })
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

function pngBytes(name: string): Uint8Array {
    const card = JSON.stringify({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: { name, description: 'd', personality: '', scenario: '', first_mes: 'hi', mes_example: '', creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [], creator: '', character_version: '1', extensions: { risuai: {} } },
    })
    const parts = [
        new U8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', new U8(13).fill(1)),
        pngChunk('tEXt', new U8([...enc.encode('chara'), 0, ...enc.encode(Buffer.from(card).toString('base64'))])),
        pngChunk('IDAT', new U8(20).fill(2)),
        pngChunk('IEND', new U8(0)),
    ]
    const out = new U8(parts.reduce((n, p) => n + p.length, 0))
    let at = 0
    for (const p of parts) { out.set(p, at); at += p.length }
    return out
}

const png = (name: string) => new File([new U8(pngBytes(name))], `${name}.png`, { type: 'image/png' })
/** A card image cut inside its card chunk. */
const cutPng = (name: string) => new File([new U8(pngBytes(name).subarray(0, 33 + 20))], `${name}.png`, { type: 'image/png' })
const textFile = (name: string) => new File([new U8([1, 2, 3])], name, { type: 'text/plain' })

const names = () => h.characters.map((c) => (c as { name?: string }).name)

beforeEach(() => {
    h.last = 'none'
    h.errors = []
    h.characters = []
    h.picked = null
    h.confirm = true
    h.saveFails = null
    h.ordered = 0
    h.uuid = 0
    h.files.clear()
    h.readSizes = []
    h.openHandles = 0
    h.bytesRead = 0
    h.saves = []
    h.os = 'windows'
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

async function pick(files: File[]) {
    h.picked = files
    await importCharacter()
}

// ---------------------------------------------------------------------------------------------
// The picker: every file is attempted, and what did not import is named once at the end
// ---------------------------------------------------------------------------------------------

describe('importCharacter with several files', () => {
    test('a cut image, a good archive and a text file: the archive imports and the last message names the others with their reasons', async () => {
        await pick([cutPng('Cut'), charx('Good'), textFile('notes.txt')])
        expect(names()).toEqual(['Good'])
        expect(h.last).toBe('error:' + language.importFilesNotImported(2, 3, 'Cut.png: ' + language.cardFileIncomplete + '\nnotes.txt: ' + language.importNotCardFile))
    })

    test('an archive whose assets fail to save does not stop the next card, and is named with the save failure', async () => {
        //Every save fails; only the first archive has assets to save.
        h.saveFails = 'storage full'
        await pick([charx('Failing', { assets: 12 }), charx('Next')])
        expect(names()).toEqual(['Next'])
        expect(h.last).toBe('error:' + language.importFilesNotImported(1, 2, 'Failing.charx: Failed to save 12 assets'))
    })

    test('two good files import two characters, order them after each, and show no error (guard)', async () => {
        await pick([charx('One'), png('Two')])
        expect(names()).toEqual(['One', 'Two'])
        expect(h.errors).toEqual([])
        expect(h.ordered).toBe(2)
        expect(h.last).toBe('normal:' + language.importedCharacter)
    })

    test('one refused file shows its own message as the last message (guard)', async () => {
        await pick([cutPng('Cut')])
        expect(h.last).toBe('error:' + language.cardFileIncomplete)
    })

    test('one failed file shows its own error, not a summary (guard)', async () => {
        h.saveFails = 'storage full'
        await pick([charx('Failing', { assets: 12 })])
        expect(h.last).toBe('error:Failed to save 12 assets')
    })

    test('a declined file is not listed, and the files after it import (guard)', async () => {
        //Only the first archive asks for low-level access.
        h.confirm = false
        await pick([charx('Declined', { lowLevelAccess: true }), charx('Next')])
        expect(names()).toEqual(['Next'])
        expect(h.errors).toEqual([])
        expect(h.last).toBe('normal:' + language.importedCharacter)
    })

    test('a single unrecognised file is refused with its own reason', async () => {
        await pick([textFile('notes.txt')])
        expect(h.last).toBe('error:' + language.importNotCardFile)
    })

    test('an off-spec json card is imported and does not appear in the summary (guard)', async () => {
        const offSpec = new File([enc.encode(JSON.stringify({ name: 'Old', description: 'd', first_mes: 'hi' }))], 'old.json', { type: 'application/json' })
        await pick([offSpec, charx('Good')])
        expect(names()).toEqual(['Old', 'Good'])
        expect(h.errors).toEqual([])
    })
})

// ---------------------------------------------------------------------------------------------
// One file through importCharacterProcess
// ---------------------------------------------------------------------------------------------

describe('importCharacterProcess outcomes', () => {
    test('a spec json card whose low-level-access prompt is declined imports nothing, even with top-level off-spec fields', async () => {
        const body = JSON.parse(v3Json('Declined', { lowLevelAccess: true }))
        Object.assign(body, { name: 'Top', description: 'd', first_mes: 'hi' })
        h.confirm = false
        const returned = await importCharacterProcess({ name: 'card.json', data: enc.encode(JSON.stringify(body)) })
        expect(returned).toBeUndefined()
        expect(h.characters).toEqual([])
        expect(h.errors).toEqual([])
        expect(h.last).toBe('none')
    })

    test('a declined archive returns no character index', async () => {
        h.confirm = false
        const file = charx('Declined', { lowLevelAccess: true })
        const returned = await importCharacterProcess({ name: file.name, data: file })
        expect(returned).toBeUndefined()
        expect(h.characters).toEqual([])
        expect(h.last).toBe('none')
    })

    test('a stream given as a json body is refused with noData', async () => {
        const returned = await importCharacterProcess({ name: 'card.json', data: new ReadableStream<Uint8Array>() })
        expect(returned).toBeUndefined()
        expect(h.last).toBe('error:' + language.errors.noData)
    })

    test('a json file that is not a card is refused with noData', async () => {
        await importCharacterProcess({ name: 'other.json', data: enc.encode('{"a":1}') })
        expect(h.last).toBe('error:' + language.errors.noData)
    })

    test('a file of another type is refused as not a card file', async () => {
        await importCharacterProcess({ name: 'notes.txt', data: new U8([1]) })
        expect(h.last).toBe('error:' + language.importNotCardFile)
    })

    test('an archive whose asset saves fail shows the save failure as the last message and returns no character, with or without returnCharacter', async () => {
        h.saveFails = 'storage full'
        const file = charx('Failing', { assets: 12 })
        expect(await importCharacterProcess({ name: file.name, data: file })).toBeUndefined()
        expect(h.last).toBe('error:Failed to save 12 assets')
        h.last = 'none'
        expect(await importCharacterProcess({ name: file.name, data: file, returnCharacter: true })).toBeUndefined()
        expect(h.last).toBe('error:Failed to save 12 assets')
        expect(h.characters).toEqual([])
    })

    test('an archive imports and returns the new index, or the character itself with returnCharacter (guard)', async () => {
        const file = charx('Good')
        expect(await importCharacterProcess({ name: file.name, data: file })).toBe(0)
        const returned = await importCharacterProcess({ name: file.name, data: file, returnCharacter: true })
        expect(typeof returned).toBe('object')
        expect((returned as { name?: string }).name).toBe('Good')
        expect(names()).toEqual(['Good'])
    })
})

// ---------------------------------------------------------------------------------------------
// Files the operating system hands to the desktop app: read in pieces, never in one call
// ---------------------------------------------------------------------------------------------

describe('importOpenedFiles', () => {
    /** An archive whose one asset is `assetBytes` long, stored without compression. */
    function bigCharx(name: string, assetBytes: number): Uint8Array {
        const files: fflate.Zippable = {
            'card.json': [enc.encode(v3Json(name, { assets: 1 })), { level: 0 }],
            'assets/a0.bin': [new U8(assetBytes).fill(7), { level: 0 }],
        }
        return new U8(fflate.zipSync(files))
    }

    test('per-call bound: an archive above one piece imports, is read with buffers of at most 4 MiB, and its handle is closed', async () => {
        const bytes = bigCharx('Huge', CALL_CAP + 1000)
        h.files.set('C:\\cards\\Huge.charx', bytes)

        await importOpenedFiles(['C:\\cards\\Huge.charx'])

        expect(names()).toEqual(['Huge'])
        expect(h.errors).toEqual([])
        expect(h.readSizes.length).toBeGreaterThan(1)
        expect(Math.max(...h.readSizes)).toBeLessThanOrEqual(CALL_CAP)
        expect(h.openHandles).toBe(0)
    })

    test('a small archive imports through the same open and read path (guard)', async () => {
        h.files.set('/home/u/Small.charx', new U8(await charx('Small').arrayBuffer()))

        await importOpenedFiles(['/home/u/Small.charx'])

        expect(names()).toEqual(['Small'])
        expect(h.openHandles).toBe(0)
    })

    test('a path that cannot be opened is reported for that file, the others import, and no handle stays open', async () => {
        h.files.set('/home/u/Good.charx', new U8(await charx('Good').arrayBuffer()))

        await importOpenedFiles(['/home/u/Gone.charx', '/home/u/Good.charx'])

        expect(names()).toEqual(['Good'])
        expect(h.last.startsWith('error:')).toBe(true)
        expect(h.openHandles).toBe(0)
    })
})

// ---------------------------------------------------------------------------------------------
// A module the operating system hands to the desktop app: read in pieces through one shared handle
// ---------------------------------------------------------------------------------------------

describe('importOpenedFiles with a .risum module', () => {
    const KIB = 1024
    /** The read-ahead window of the importer's first pass. */
    const WINDOW = 256 * KIB
    const hashOf = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')
    const backlog = charxLimits.backlogBytes

    afterEach(() => {
        charxLimits.backlogBytes = backlog
    })

    test('per-call bound: a module above one piece imports, no read asks for more than 4 MiB, the file is never read whole before its first asset is saved, every record comes back from its own place, and the handle is closed', async () => {
        const records = Array.from({ length: 6 }, (_, i) => patterned(900 * KIB, i + 1))
        const bytes = risumBytes({ records })
        expect(bytes.length).toBeGreaterThan(CALL_CAP)
        h.files.set('C:\\mods\\Big.risum', bytes)
        //One record in flight at a time, so the reader cannot run ahead of the saves.
        charxLimits.backlogBytes = 1

        await importOpenedFiles(['C:\\mods\\Big.risum'])

        expect(h.errors).toEqual([])
        expect(h.saves.map((save) => save.hash)).toEqual(records.map(hashOf))
        expect(h.saves[0].bytesRead).toBeLessThanOrEqual(WINDOW + 900 * KIB + 16 * KIB)
        expect(Math.max(...h.readSizes)).toBeLessThanOrEqual(CALL_CAP)
        expect(h.openHandles).toBe(0)
    })

    test('a module whose record count does not match its asset list is refused before any asset is saved, and its handle is closed', async () => {
        h.files.set('/mods/Mismatch.risum', risumBytes({ records: [patterned(500, 1), patterned(500, 2)], listed: 3 }))

        await importOpenedFiles(['/mods/Mismatch.risum'])

        expect(h.saves).toEqual([])
        expect(h.last).toBe('error:' + language.errors.noData)
        expect(h.openHandles).toBe(0)
    })

    test('a module cut short is refused before any asset is saved, and its handle is closed', async () => {
        const full = risumBytes({ records: [patterned(500, 1), patterned(500, 2)] })
        h.files.set('/mods/Cut.risum', full.slice(0, full.length - 300))

        await importOpenedFiles(['/mods/Cut.risum'])

        expect(h.saves).toEqual([])
        expect(h.last).toBe('error:' + language.moduleFileIncomplete)
        expect(h.openHandles).toBe(0)
    })

    test('a module whose assets cannot be saved fails with the save count, and its handle is closed', async () => {
        h.files.set('/mods/Failing.risum', risumBytes({ records: [patterned(500, 1), patterned(500, 2)] }))
        h.saveFails = 'storage full'

        await importOpenedFiles(['/mods/Failing.risum'])

        expect(h.last).toBe('error:Failed to save 2 assets')
        expect(h.openHandles).toBe(0)
    })
})

// ---------------------------------------------------------------------------------------------
// A card image the operating system hands to the desktop app: read in pieces through one shared handle
// ---------------------------------------------------------------------------------------------

describe('importOpenedFiles with a PNG card', () => {
    const KIB = 1024
    /** The read-ahead window of one pass over the card. */
    const WINDOW = 256 * KIB
    const hashOf = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')

    function cardWithAssets(name: string, assets: Uint8Array[]): Uint8Array {
        const card = JSON.stringify({
            spec: 'chara_card_v2',
            spec_version: '2.0',
            data: {
                name, description: 'd', first_mes: 'hi', character_version: '1',
                extensions: { risuai: { additionalAssets: assets.map((_, i) => [`a${i}`, `__asset:${i}`, 'bin']) } },
            },
        })
        const text = (key: string, value: string) => pngChunk('tEXt', new U8([...enc.encode(key), 0, ...enc.encode(value)]))
        const parts = [
            new U8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            pngChunk('IHDR', new U8(13).fill(1)),
            pngChunk('IDAT', new U8(20).fill(2)),
            ...assets.map((asset, i) => text(`chara-ext-asset_:${i}`, Buffer.from(asset).toString('base64'))),
            text('chara', Buffer.from(card).toString('base64')),
            pngChunk('IEND', new U8(0)),
        ]
        const out = new U8(parts.reduce((n, p) => n + p.length, 0))
        let at = 0
        for (const p of parts) { out.set(p, at); at += p.length }
        return out
    }

    test('per-call bound: a card above one piece imports, no read asks for more than 4 MiB, the file is not read whole before its first asset is saved, every asset comes back from its own place, and the handle is closed', async () => {
        const assets = Array.from({ length: 6 }, (_, i) => patterned(900 * KIB, i + 1))
        const bytes = cardWithAssets('BigCard', assets)
        expect(bytes.length).toBeGreaterThan(CALL_CAP)
        h.files.set('C:\\cards\\BigCard.png', bytes)

        await importOpenedFiles(['C:\\cards\\BigCard.png'])

        expect(h.errors).toEqual([])
        expect(names()).toEqual(['BigCard'])
        expect(h.saves.slice(0, 6).map((save) => save.hash)).toEqual(assets.map(hashOf))
        expect(h.saves[0].bytesRead).toBeLessThanOrEqual(2 * WINDOW + Math.ceil(900 * KIB / 3) * 4 + 16 * KIB)
        expect(Math.max(...h.readSizes)).toBeLessThanOrEqual(CALL_CAP)
        expect(h.openHandles).toBe(0)
    })

    test('a card cut inside an asset is refused before any asset is saved, and its handle is closed', async () => {
        const bytes = cardWithAssets('Cut', [patterned(500, 1), patterned(500, 2)])
        h.files.set('/cards/Cut.png', bytes.slice(0, 120))

        await importOpenedFiles(['/cards/Cut.png'])

        expect(h.saves).toEqual([])
        expect(h.last).toBe('error:' + language.cardFileIncomplete)
        expect(h.openHandles).toBe(0)
    })
})
