/**
 * Importing a `.risum` module reads the file in pieces and validates the whole structure before any asset is saved.
 *
 * The real `modules.ts` and `processzip.ts` run on synthetic `.risum` bytes through `importModule` (a picked `File` that
 * counts every byte it hands out) and through `readModule` (a source that can change under it). Everything they reach
 * around them is replaced by recorders. The RPack layer is the identity, so a record body is its asset.
 *
 * "regression reproducers" fail against the importer that reads the whole file into one buffer; "guards" pin behaviour
 * that must hold before and after, or the contract of the source-based reader.
 */

import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ImportSource } from 'src/ts/importSource'
import {
    CountingFile, assetName, countFileReaderReads, patterned, readWholeThroughFileReader, risumBytes, u32le,
} from 'src/ts/process/tests/risumFixtures'

const h = vi.hoisted(() => ({
    log: [] as string[],
    /** what the single alert slot holds: every alert function replaces it */
    last: 'none' as string,
    modules: [] as unknown[],
    file: null as unknown as File,
    node: false,
    /** every saveAsset call: the asset's length and first byte, and the bytes the picked file had handed out at that moment */
    saves: [] as { length: number, first: number, bytesRead: number }[],
    /** a save of an asset whose first byte is the key fails this many more times */
    failing: new Map<number, number>(),
    /** called by saveAsset before it answers */
    onSave: null as null | ((data: Uint8Array) => Promise<void>),
    sleeps: [] as number[],
    images: new Map<string, Uint8Array>(),
    /** the data the mocked card importer was handed */
    cardData: undefined as unknown,
}))

vi.mock('uuid', () => ({ v4: () => 'uuid' }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    get isNodeServer() { return h.node },
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/alert'), () => {
    const text = (msg: string | Error) => msg instanceof Error ? msg.message : String(msg)
    return {
        alertClear: vi.fn(() => { h.last = 'none' }),
        alertConfirm: vi.fn(async () => false),
        alertError: vi.fn((msg: string | Error) => { h.log.push('error:' + text(msg)); h.last = 'error:' + text(msg) }),
        alertModuleSelect: vi.fn(),
        alertNormal: vi.fn((msg: string) => { h.log.push('normal:' + msg); h.last = 'normal:' + msg }),
        alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
        alertWait: vi.fn((msg: string) => { h.last = 'wait:' + msg }),
    } as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(),
    getCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => ({ modules: h.modules })),
    setCurrentCharacter: vi.fn(),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {
        parts: Uint8Array[] = []
        append(b: Uint8Array) { this.parts.push(b) }
        get buffer() { return Buffer.concat(this.parts) }
    },
    LocalWriter: class {},
    VirtualWriter: class {},
    downloadFile: vi.fn(),
    forageStorage: {},
    readImage: vi.fn(async (path: string) => h.images.get(path)),
    saveAsset: vi.fn(async (data: Uint8Array) => {
        h.saves.push({ length: data.length, first: data[0], bytesRead: (h.file as CountingFile | null)?.bytesRead ?? 0 })
        await h.onSave?.(data)
        const remaining = h.failing.get(data[0]) ?? 0
        if (remaining > 0) {
            h.failing.set(data[0], remaining - 1)
            throw new Error('storage full')
        }
        return `${createHash('sha256').update(data).digest('hex')}.png`
    }),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/util'), () => ({
    checkPersonaBinded: vi.fn(),
    // util's whole-file reader: the bytes of the picked file in one array, for an importer that takes the bytes.
    selectSingleFile: vi.fn(async () => ({ name: h.file.name, data: await readWholeThroughFileReader(h.file) })),
    selectSingleFileObject: vi.fn(async () => h.file),
    sleep: vi.fn(async (ms: number) => { h.sleeps.push(ms) }),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: Uint8Array) => d),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(async (d: Uint8Array) => new Uint8Array(d)),
    encodeRPack: vi.fn(async (d: Uint8Array) => new Uint8Array(d)),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { modules: h.modules } } },
    HideIconStore: { set: vi.fn() },
    moduleBackgroundEmbedding: { set: vi.fn() },
    ReloadGUIPointer: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

vi.mock(import('src/ts/characterCards'), () => ({
    exportCharacterCard: vi.fn(),
    importCharacterProcess: vi.fn(async (arg: { data: unknown }) => {
        h.cardData = arg.data
        return undefined
    }),
}) as unknown as typeof import('src/ts/characterCards'))

import { exportModuleLegacy, importModule, readModule, type RisuModule } from 'src/ts/process/modules'
import { charxLimits } from 'src/ts/process/processzip'
import { ModuleRefusal } from 'src/ts/process/moduleRefusal'
import { language } from 'src/lang'

const KIB = 1024
const MIB = 1024 * KIB
/** The read-ahead window of the importer's first pass. */
const WINDOW = 256 * KIB

const limitDefaults = { ...charxLimits }
let restoreFileReader: () => void

const sha = (data: Uint8Array) => `${createHash('sha256').update(data).digest('hex')}.png`

function pick(bytes: Uint8Array<ArrayBuffer>, name = 'm.risum'): CountingFile {
    const file = new CountingFile([bytes], name)
    h.file = file
    return file
}

/** An import source over `bytes` whose methods the test can replace. */
function sourceOf(bytes: Uint8Array, over: Partial<ImportSource> = {}): ImportSource {
    return {
        name: 'm.risum',
        size: bytes.length,
        read: async (start, end) => bytes.slice(start, Math.min(end, bytes.length)),
        stream: () => { throw new Error('the module reader never streams') },
        stat: async () => ({ size: bytes.length, modified: 1 }),
        close: async () => undefined,
        ...over,
    }
}

beforeEach(() => {
    h.log = []
    h.last = 'none'
    h.modules = []
    h.node = false
    h.saves = []
    h.failing = new Map()
    h.onSave = null
    h.sleeps = []
    h.images = new Map()
    h.cardData = undefined
    Object.assign(charxLimits, limitDefaults)
    restoreFileReader = countFileReaderReads()
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    restoreFileReader()
    Object.assign(charxLimits, limitDefaults)
    vi.restoreAllMocks()
})

describe('regression reproducers', () => {
    test('a picked module is read in pieces: before its first asset is saved the file has handed out at most one window and one record, and never all of itself', async () => {
        const records = Array.from({ length: 6 }, (_, i) => patterned(300 * KIB, i + 1))
        const file = pick(risumBytes({ records }))
        //One record in flight at a time, so the reader cannot run ahead of the saves.
        charxLimits.backlogBytes = 1

        await importModule()

        expect(h.log).toEqual([])
        expect(h.saves).toHaveLength(6)
        expect(h.saves[0].bytesRead).toBeLessThanOrEqual(WINDOW + 300 * KIB + 4096)
        expect(file.reads.every((read) => Number(read.split(':')[1]) < file.size)).toBe(true)
    })

    test.each([
        ['more assets listed than records', { listed: 3 }],
        ['more records than assets listed', { listed: 1 }],
    ])('%s: the module is refused and no asset is saved', async (_label, over) => {
        pick(risumBytes({ records: [patterned(500, 1), patterned(500, 2)], ...over }))

        await importModule()

        expect(h.saves).toEqual([])
        expect(h.modules).toEqual([])
        expect(h.log).toEqual(['error:' + language.errors.noData])
    })

    test('a record over the asset limit is refused naming the asset and the limit, and nothing is saved', async () => {
        charxLimits.assetBytes = 2 * MIB
        pick(risumBytes({ records: [patterned(1000, 1), patterned(3 * MIB, 2)] }))

        await importModule()

        expect(h.saves).toEqual([])
        expect(h.modules).toEqual([])
        expect(h.log).toHaveLength(1)
        expect(h.log[0]).toMatch(new RegExp(`"${assetName(1)}".*larger than the 2 MB limit`))
    })

    test('on the Node server a record over the 100 MB write limit is refused naming the limit before anything is saved', async () => {
        h.node = true
        //The second record declares 100 MiB + 1 and holds almost nothing; the limit is judged from the header alone.
        pick(risumBytes({ records: [patterned(1000, 1), patterned(10, 2)], declaredLengths: { 1: 100 * MIB + 1 } }))

        await importModule()

        expect(h.saves).toEqual([])
        expect(h.modules).toEqual([])
        expect(h.log).toHaveLength(1)
        expect(h.log[0]).toMatch(new RegExp(`"${assetName(1)}".*larger than the 100 MB limit`))
    })

    test('a .charx picked in Settings > Modules reaches the card importer as the picked File, not as one buffer', async () => {
        const file = pick(new Uint8Array(64), 'card.charx')

        await importModule()

        expect(h.cardData).toBe(file)
    })
})

describe('guards', () => {
    test('a module is imported whole: the same module and asset keys as a whole-buffer reader gives for the same bytes', async () => {
        const records = [patterned(1, 1), patterned(300, 2), new Uint8Array(0), patterned(300, 2), patterned(70_000, 5)]
        const bytes = risumBytes({ records, module: { lorebook: [{ key: 'k', content: 'c' }], cjs: 'x' } })

        // The reader that took the whole buffer.
        const buf = Buffer.from(bytes)
        const mainLength = buf.readUInt32LE(2)
        const expectedModule = JSON.parse(buf.subarray(6, 6 + mainLength).toString()).module as RisuModule
        const expectedKeys = records.map(sha)
        expectedModule.assets!.forEach((asset, i) => { asset[1] = expectedKeys[i] })
        expectedModule.id = 'uuid'

        const fromBuffer = await readModule(Buffer.from(bytes))
        pick(bytes)
        await importModule()

        expect(fromBuffer).toEqual(expectedModule)
        expect(h.modules).toEqual([expectedModule])
    })

    test('exporting a module and importing the file gives the module and the same asset bytes back', async () => {
        h.images.set('p0', patterned(5000, 1))
        h.images.set('p1', patterned(70_000, 2))
        const original = {
            name: 'Round trip', description: 'd', id: 'm1',
            lorebook: [{ key: 'k', comment: 'c', content: 'text', mode: 'normal', insertorder: 1, alwaysActive: false, secondkey: '', selective: false }],
            assets: [['n0', 'p0', 'png'], ['n1', 'p1', 'png']],
        } as unknown as RisuModule

        const exported = await exportModuleLegacy(original, { saveData: false, alertEnd: false })
        pick(new Uint8Array(exported))
        await importModule()

        expect(h.modules).toHaveLength(1)
        expect(h.modules[0]).toMatchObject({ name: 'Round trip', description: 'd', lorebook: original.lorebook })
        expect((h.modules[0] as RisuModule).assets).toEqual([['n0', sha(h.images.get('p0')!), 'png'], ['n1', sha(h.images.get('p1')!), 'png']])
    })

    test('a module with no assets imports, and bytes after its terminator are ignored', async () => {
        pick(risumBytes({}))
        await importModule()
        expect(h.modules).toHaveLength(1)

        pick(risumBytes({ records: [patterned(40, 1)], trailing: new Uint8Array([9, 9, 9, 1, 255, 255, 255, 255]) }))
        await importModule()
        expect(h.modules).toHaveLength(2)
        expect(h.saves).toHaveLength(1)
        expect(h.log).toEqual([])
    })

    test('a module cut short at any point saves nothing, adds nothing and shows one error', async () => {
        const full = risumBytes({ records: [patterned(500, 1), patterned(500, 2)] })
        const mainEnd = 6 + new DataView(full.buffer).getUint32(2, true)
        const cuts = [1, 3, 7, mainEnd - 1, mainEnd, mainEnd + 3, mainEnd + 5 + 100, mainEnd + 5 + 500, full.length - 1]
        for (const cut of cuts) {
            h.log = []
            h.modules = []
            pick(full.slice(0, cut))

            await importModule()

            expect(h.saves, `cut at ${cut}`).toEqual([])
            expect(h.modules, `cut at ${cut}`).toEqual([])
            expect(h.log, `cut at ${cut}`).toHaveLength(1)
            expect(h.log[0].startsWith('error:'), `cut at ${cut}`).toBe(true)
        }
    })

    test('a record that runs past the end of the file refuses the module as incomplete', async () => {
        pick(risumBytes({ records: [patterned(1000, 1), patterned(10, 2)], declaredLengths: { 1: 100 * MIB + 1 } }))

        await importModule()

        expect(h.saves).toEqual([])
        expect(h.log).toEqual(['error:' + language.moduleFileIncomplete])
    })

    test('a failed save is retried five seconds later, and the failed record is read from the file again each time', async () => {
        const records = [patterned(500, 1), patterned(600, 2), patterned(700, 3)]
        h.failing.set(records[1][0], 2)
        const file = pick(risumBytes({ records }))

        await importModule()

        expect(h.log).toEqual([])
        expect(h.sleeps).toEqual([5000, 5000])
        expect(h.saves).toHaveLength(5)
        expect(h.modules).toHaveLength(1)
        expect((h.modules[0] as RisuModule).assets!.map((asset) => asset[1])).toEqual(records.map(sha))
        const recordReads = (length: number) => file.reads.filter((read) => read === `slice.arrayBuffer:${length + 5}`).length
        expect(recordReads(500)).toBe(1)
        expect(recordReads(600)).toBe(3)
        expect(recordReads(700)).toBe(1)
    })

    test('records that never save fail the import after three retries with the count of what failed', async () => {
        const records = [patterned(500, 1), patterned(600, 2), patterned(700, 3)]
        h.failing.set(records[0][0], 100)
        h.failing.set(records[2][0], 100)
        pick(risumBytes({ records }))

        await importModule()

        expect(h.sleeps).toEqual([5000, 5000, 5000])
        expect(h.modules).toEqual([])
        expect(h.log).toEqual(['error:Failed to save 2 assets'])
    })

    describe('a source that changes between the two passes', () => {
        const records = [patterned(400, 1), patterned(400, 2), patterned(400, 3)]
        const bytes = risumBytes({ records })
        /** Calls that read one whole record: its 5-byte header and 400-byte body. */
        const isRecordRead = (start: number, end: number) => end - start === 405

        const secondRecordRead = (change: (read: Uint8Array) => Uint8Array | never) => {
            let seen = 0
            return sourceOf(bytes, {
                read: async (start, end) => {
                    const read = bytes.slice(start, Math.min(end, bytes.length))
                    return isRecordRead(start, end) && ++seen === 2 ? change(read) : read
                },
            })
        }

        test.each([
            ['its size', sourceOf(bytes, { stat: (() => { let n = 0; return async () => ({ size: bytes.length + (n++ === 0 ? 0 : 1), modified: 1 }) })() })],
            ['its modification time', sourceOf(bytes, { stat: (() => { let n = 0; return async () => ({ size: bytes.length, modified: n++ === 0 ? 1 : 2 }) })() })],
            ['the mark byte of a record', secondRecordRead((read) => { read[0] = 2; return read })],
            ['the length of a record', secondRecordRead((read) => { read.set(u32le(399), 1); return read })],
            ['a record that is shorter than the first pass saw', secondRecordRead((read) => read.subarray(0, 100))],
            ['a record that cannot be read', secondRecordRead(() => { throw new Error('device removed') })],
        ])('%s: the import fails saying the file changed, without retrying, and the second record is never saved', async (_label, source) => {
            const promise = readModule(source)

            await expect(promise).rejects.toBeInstanceOf(ModuleRefusal)
            await expect(promise).rejects.toThrow(language.moduleFileChanged)
            expect(h.sleeps).toEqual([])
            expect(h.saves.map((save) => save.first)).not.toContain(records[1][0])
        })
    })

    test('a record larger than the backlog cap is imported when nothing else is in flight, and the records after it wait for it', async () => {
        charxLimits.backlogBytes = 32 * KIB
        const records = [patterned(180 * KIB, 1), patterned(10 * KIB, 2), patterned(10 * KIB, 3)]
        let active = 0
        const activeAtStart = new Map<number, number>()
        h.onSave = async (data) => {
            active++
            activeAtStart.set(data[0], active)
            await new Promise((resolve) => setTimeout(resolve, 5))
            active--
        }

        const module = await readModule(Buffer.from(risumBytes({ records })))

        expect(module.assets!.map((asset) => asset[1])).toEqual(records.map(sha))
        expect(activeAtStart.get(records[0][0])).toBe(1)
        expect(Math.max(...activeAtStart.values())).toBe(2)
    })
})
