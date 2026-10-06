/**
 * CharX and jpg-charx import through `importCharacterProcess` and `downloadRisuHub` in `src/ts/characterCards.ts`,
 * and the failure labelling of `CharXImporter` in `src/ts/process/processzip.ts`.
 *
 * The real `characterCards.ts`, the real `processzip.ts` (with the real `CharXWriter` building the fixtures) and the
 * real fflate run against synthetic archives built here. Everything the import reaches around them (the database,
 * asset storage, alerts) is replaced by recorders, so each test can compare what was saved, what the user was shown
 * last and which character came out.
 */

import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fflate from 'fflate'

//#region module mocks

const h = vi.hoisted(() => {
    type Alert = { type?: string, msg?: string, submsg?: string }
    return {
        saved: [] as Array<{ id: string, length: number }>,
        /** every saveAsset call that began, including ones that later failed or were slow */
        saveCalls: 0,
        saveDelay: 0,
        saveFail: null as string | null,
        errors: [] as string[],
        alerts: [] as Alert[],
        /** alerts and errors in the order the user would see them */
        log: [] as string[],
        characters: [] as Array<Record<string, unknown>>,
        uuid: 0,
        module: { lorebook: [] as unknown[], trigger: [] as unknown[], regex: [] as unknown[] },
        moduleReads: [] as number[],
        /** makes EntryBuffer.append (the importer's per-entry buffer) fail for chunks this returns true for */
        appendFailWhen: null as ((data: Uint8Array) => boolean) | null,
        /** the tag (first four characters) of every chunk that begins an asset, as appended to an EntryBuffer */
        appendTags: [] as string[],
        /** makes the ZIP parser report an error on its final push */
        finalPushError: false,
        /** makes the ZIP parser report an error through every started entry's data handler after each push */
        lateOndataError: false,
        /** makes the ZIP parser throw from every push after it has processed the data */
        latePushThrow: false,
        /** the most bytes any one importer buffer received since the last reset of the append statistics */
        maxEntryBytes: 0,
        /** whether the page runs on the self-hosted Node server */
        node: false,
    }
})

vi.mock('uuid', () => ({
    v4: () => `uuid-${++h.uuid}`,
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    get isNodeServer() { return h.node },
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
        alertConfirm: vi.fn(async () => true),
        alertError: vi.fn((msg: string | Error) => { h.errors.push(text(msg)); h.log.push('error:' + text(msg)) }),
        alertInput: vi.fn(async () => ''),
        alertMd: vi.fn(),
        alertNormal: vi.fn((msg: string) => { h.log.push('normal:' + msg) }),
        alertStore: {
            set: (v: { type?: string, msg?: string, submsg?: string }) => { h.alerts.push(v); h.log.push(`alert:${v.type}:${v.msg}`) },
            subscribe: vi.fn(),
            update: vi.fn(),
        },
        alertWait: vi.fn((msg: string) => { h.log.push('wait:' + msg) }),
    } as unknown as typeof import('src/ts/alert')
})

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
        decryptBuffer: vi.fn(async (d: unknown) => d),
        isKnownUri: vi.fn(() => false),
        selectFileByDom: vi.fn(async () => null),
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
        checkCharOrder: vi.fn(),
        downloadFile: vi.fn(async () => {}),
        forageStorage: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
        loadAsset: vi.fn(async () => new Uint8Array()),
        openURL: vi.fn(),
        readImage: vi.fn(async (d: unknown) => d),
        saveAsset: vi.fn(async (data: Uint8Array) => {
            h.saveCalls++
            if (h.saveDelay) {
                await new Promise((resolve) => setTimeout(resolve, h.saveDelay))
            }
            if (h.saveFail !== null) {
                throw new Error(h.saveFail)
            }
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

vi.mock(import('src/ts/process/modules'), () => ({
    exportModuleLegacy: vi.fn(),
    readModule: vi.fn(async (data: Uint8Array) => {
        h.moduleReads.push(data.length)
        return h.module
    }),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: vi.fn(async () => new Uint8Array()),
}))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
}))

// The parser is the real fflate Unzip, except that it can be made to report errors the real library cannot produce at
// that moment: an error through an entry's data handler on the final push, and an error through every entry's data
// handler or a throw from push itself after the real push has returned.
vi.mock('fflate', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fflate')>()
    class Unzip extends actual.Unzip {
        #files: import('fflate').UnzipFile[] = []
        #wrapped = false
        push(chunk: Uint8Array, final?: boolean) {
            if (!this.#wrapped && this.onfile) {
                this.#wrapped = true
                const original = this.onfile
                this.onfile = (file) => { this.#files.push(file); original(file) }
            }
            if (final && h.finalPushError) {
                const file = { name: 'assets/injected.bin', originalSize: 0, start() {} } as unknown as import('fflate').UnzipFile
                this.onfile?.(file)
                file.ondata?.(new Error('injected zip error') as import('fflate').FlateError, null as unknown as Uint8Array, false)
            }
            super.push(chunk, final)
            if (h.lateOndataError) {
                for (const file of this.#files) {
                    file.ondata?.(new Error('late zip error') as import('fflate').FlateError, null as unknown as Uint8Array, false)
                }
            }
            if (h.latePushThrow) {
                throw new Error('late push throw')
            }
        }
    }
    return { ...actual, Unzip }
})

//#endregion

import { downloadRisuHub, importCharacterProcess } from 'src/ts/characterCards'
import { CharXImporter, CharXWriter, EntryBuffer, charxLimits, hasZipEndRecord, type CharXParseError } from 'src/ts/process/processzip'
import { checkCharOrder, type VirtualWriter } from 'src/ts/globalApi.svelte'
import { changeChar } from 'src/ts/characters'
import { importSourceOfBytes, type ImportSource } from 'src/ts/importSource'
import { language } from 'src/lang'

// ---------------------------------------------------------------------------------------------
// Synthetic archives (no real images, no user data)
// ---------------------------------------------------------------------------------------------

const U8 = Uint8Array
const enc = new TextEncoder()
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

/** Semi-compressible deterministic bytes that start with a 4-character tag. */
function body(n: number, seed: number, tag: string): Uint8Array {
    const a = new U8(n)
    let x = seed
    for (let i = 0; i < n; i++) {
        x = (x * 1103515245 + 12345) & 0x7fffffff
        a[i] = ((x >> 16) % 40) + 32
    }
    a.set(enc.encode(tag), 0)
    return a
}

const ASSETS = [
    { name: 'assets/a.bin', data: body(30000, 1, 'ASSa') },
    { name: 'assets/b.bin', data: body(30000, 2, 'ASSb') },
    { name: 'assets/c.bin', data: body(30000, 3, 'ASSc') },
]
const assetIds = ASSETS.map((a) => sha1(a.data)).sort()
const startsWithTag = (tag: string) => (d: Uint8Array) => d.length >= 4 && new TextDecoder().decode(d.subarray(0, 4)) === tag

const v3Card = JSON.stringify({
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
        name: 'Synthetic', description: 'd', first_mes: 'hi', character_version: '1',
        extensions: { risuai: {} },
        assets: ASSETS.map((a) => ({ type: 'x-risu-asset', uri: 'embeded://' + a.name, name: a.name, ext: 'bin' })),
    },
})
const MODULE_BYTES = enc.encode('synthetic module bytes')
const JPEG_HEAD = concat([new U8([0xff, 0xd8, 0xff, 0xe0]), new U8(600).fill(0x11), new U8([0xff, 0xd9])])

type Entry = [string, Uint8Array | string]
const cardEntries = (withModule = false): Entry[] => [
    ['card.json', v3Card],
    ...(withModule ? [['module.risum', MODULE_BYTES] as Entry] : []),
    ...ASSETS.map((a) => [a.name, a.data] as Entry),
]

/** An archive written by the real CharXWriter (data descriptors, deflate method with the given level). */
async function writerArchive(entries: Entry[], level: 0 | 6, opts: { prefix?: Uint8Array, comment?: Uint8Array } = {}): Promise<Uint8Array> {
    const chunks: Uint8Array[] = []
    const sink = { write: async (b: Uint8Array) => { chunks.push(new U8(b)) }, close: async () => {} }
    const writer = new CharXWriter(sink as unknown as VirtualWriter)
    if (opts.prefix) writer.apb.append(opts.prefix)
    for (const [key, data] of entries) await writer.write(key, data, level)
    await writer.end()
    const out = concat(chunks)
    if (opts.comment) {
        new DataView(out.buffer, out.byteOffset, out.byteLength).setUint16(out.length - 2, opts.comment.length, true)
        return concat([out, opts.comment])
    }
    return out
}

/** An archive written by another tool: sizes in the local headers, one stored (method 0) entry. */
function otherToolArchive(entries: Entry[]): Uint8Array {
    const files: fflate.Zippable = {}
    entries.forEach(([key, data], i) => {
        files[key] = [typeof data === 'string' ? enc.encode(data) : data, { level: i === entries.length - 1 ? 0 : 6 }]
    })
    return fflate.zipSync(files)
}

type Geometry = { entries: Array<{ name: string, header: number, dataStart: number, dataEnd: number, next: number, method: number }>, cdStart: number, eocd: number }

/** Reads the central directory of an archive (offsets are relative to the archive start, `base` bytes in). */
function geometry(z: Uint8Array, base = 0): Geometry {
    const dv = new DataView(z.buffer, z.byteOffset, z.byteLength)
    let eocd = -1
    for (let i = z.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
    const count = dv.getUint16(eocd + 10, true)
    const cdStart = base + dv.getUint32(eocd + 16, true)
    const entries: Geometry['entries'] = []
    let at = cdStart
    for (let i = 0; i < count; i++) {
        const method = dv.getUint16(at + 10, true)
        const csize = dv.getUint32(at + 20, true)
        const nameLen = dv.getUint16(at + 28, true)
        const extraLen = dv.getUint16(at + 30, true)
        const commentLen = dv.getUint16(at + 32, true)
        const header = base + dv.getUint32(at + 42, true)
        const name = new TextDecoder().decode(z.subarray(at + 46, at + 46 + nameLen))
        const dataStart = header + 30 + dv.getUint16(header + 26, true) + dv.getUint16(header + 28, true)
        entries.push({ name, header, dataStart, dataEnd: dataStart + csize, next: 0, method })
        at += 46 + nameLen + extraLen + commentLen
    }
    entries.forEach((e, i) => { e.next = i + 1 < entries.length ? entries[i + 1].header : cdStart })
    return { entries, cdStart, eocd }
}

const entryOf = (g: Geometry, name: string) => g.entries.find((e) => e.name === name)!
/** The local header of `name` says compression method 99. */
function method99(z: Uint8Array, name: string, base = 0): Uint8Array {
    const c = z.slice()
    const e = entryOf(geometry(z, base), name)
    c[e.header + 8] = 99
    c[e.header + 9] = 0
    return c
}
/** The deflate body of `name` starts with the reserved block type 11. */
function badBlockType(z: Uint8Array, name: string, base = 0): Uint8Array {
    const c = z.slice()
    c[entryOf(geometry(z, base), name).dataStart] |= 0x06
    return c
}

const fileOf = (bytes: Uint8Array, name: string) => new File([new U8(bytes)], name, { type: 'application/zip' })

function chunkedStream(bytes: Uint8Array, size = 4096, after?: (c: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>) => void): ReadableStream<Uint8Array<ArrayBuffer>> {
    let at = 0
    return new ReadableStream<Uint8Array<ArrayBuffer>>({
        pull(controller) {
            if (at >= bytes.length) {
                if (after) after(controller)
                else controller.close()
                return
            }
            controller.enqueue(new U8(bytes.subarray(at, at + size)))
            at += size
        },
    })
}

/** A File whose stream() hands out the bytes in small chunks, so the parser sees several pushes. */
function chunkedFile(bytes: Uint8Array, name: string, after?: (c: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>) => void, size = 4096): File {
    const f = fileOf(bytes, name)
    f.stream = () => chunkedStream(bytes, size, after)
    return f
}

const tick = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------------------------
// Running an import and describing what it did
// ---------------------------------------------------------------------------------------------

type Input = 'file' | 'chunked-file' | 'uint8array' | 'buffer' | 'stream' | 'source'
type Outcome = {
    returned: number | null | undefined
    characters: Array<Record<string, unknown>>
    savedIds: string[]
    saveCalls: number
    errors: string[]
    log: string[]
    thrown: string | null
}

const defaultLimits = { ...charxLimits }

function reset() {
    h.saved = []
    h.saveCalls = 0
    h.saveDelay = 0
    h.saveFail = null
    h.errors = []
    h.alerts = []
    h.log = []
    h.characters = []
    h.uuid = 0
    h.module = { lorebook: [], trigger: [], regex: [] }
    h.moduleReads = []
    h.appendFailWhen = null
    h.appendTags = []
    h.finalPushError = false
    h.lateOndataError = false
    h.latePushThrow = false
    h.maxEntryBytes = 0
    h.node = false
    vi.mocked(changeChar).mockClear()
    vi.mocked(checkCharOrder).mockClear()
    Object.assign(charxLimits, defaultLimits)
}

function dataFor(bytes: Uint8Array, name: string, input: Input): File | Uint8Array | ImportSource | ReadableStream<Uint8Array> {
    switch (input) {
        case 'file': return fileOf(bytes, name)
        case 'chunked-file': return chunkedFile(bytes, name)
        case 'uint8array': return new U8(bytes)
        case 'buffer': return Buffer.from(bytes)
        case 'stream': return chunkedStream(bytes, 997)
        case 'source': return importSourceOfBytes(name, bytes)
    }
}

async function runImport(bytes: Uint8Array, name: string, input: Input, settle = 0): Promise<Outcome> {
    const data = dataFor(bytes, name, input)
    let returned: number | null | undefined
    let thrown: string | null = null
    try {
        returned = await importCharacterProcess({ name, data })
    } catch (e) {
        thrown = e instanceof Error ? e.message : String(e)
    }
    if (settle) await tick(settle)
    return describeOutcome(returned, thrown)
}

function describeOutcome(returned: number | null | undefined, thrown: string | null): Outcome {
    return {
        returned,
        characters: structuredClone(h.characters),
        savedIds: h.saved.map((s) => s.id).sort(),
        saveCalls: h.saveCalls,
        errors: [...h.errors],
        log: [...h.log],
        thrown,
    }
}

// The importer's per-entry buffer is observed (and made to fail) through its append method.
const realAppend = EntryBuffer.prototype.append
let appendTotals = new WeakMap<object, number>()
/** Forgets what the buffers built so far received, so a test can measure the import alone. */
function resetAppendStats() {
    appendTotals = new WeakMap()
    h.maxEntryBytes = 0
    h.appendTags = []
}

beforeEach(() => {
    reset()
    vi.spyOn(EntryBuffer.prototype, 'append').mockImplementation(function (this: EntryBuffer, data: Uint8Array) {
        if (data.length >= 4 && data[0] === 0x41 && data[1] === 0x53 && data[2] === 0x53) {
            h.appendTags.push(String.fromCharCode(...data.subarray(0, 4)))
        }
        if (h.appendFailWhen?.(data)) {
            throw new RangeError('Array buffer allocation failed (simulated)')
        }
        const total = (appendTotals.get(this) ?? 0) + data.length
        appendTotals.set(this, total)
        h.maxEntryBytes = Math.max(h.maxEntryBytes, total)
        return realAppend.call(this, data)
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

const originalFetch = globalThis.fetch

afterEach(() => {
    vi.stubGlobal('fetch', originalFetch)
    vi.restoreAllMocks()
})

const lastLog = (o: Outcome) => o.log[o.log.length - 1]

function expectRefused(out: Outcome, label: string, message = language.cardFileIncomplete) {
    expect(out.thrown, `${label}: no throw`).toBeNull()
    expect(out.errors, `${label}: message`).toEqual([message])
    expect(out.characters, `${label}: no character`).toEqual([])
}

function expectRefusedBeforeSaving(out: Outcome, label: string, message = language.cardFileIncomplete) {
    expectRefused(out, label, message)
    expect(out.saveCalls, `${label}: nothing saved`).toBe(0)
}

// ---------------------------------------------------------------------------------------------
// Compatibility guards: a complete archive imports the same through every input
// ---------------------------------------------------------------------------------------------

const completeArchives: Array<[string, string, () => Promise<Uint8Array>, boolean]> = [
    ['CharXWriter archive, stored (level 0)', 'card.charx', () => writerArchive(cardEntries(), 0), false],
    ['CharXWriter archive, deflated (level 6)', 'card.charx', () => writerArchive(cardEntries(), 6), false],
    ['CharXWriter archive with an archive comment', 'card.charx', () => writerArchive(cardEntries(), 6, { comment: enc.encode('synthetic archive comment') }), false],
    ['CharXWriter archive with module.risum', 'card.charx', () => writerArchive(cardEntries(true), 6), true],
    ['other-tool archive with a stored entry', 'card.charx', async () => otherToolArchive(cardEntries()), false],
    ['jpg-charx (.jpg)', 'card.jpg', () => writerArchive(cardEntries(), 6, { prefix: JPEG_HEAD }), false],
    ['jpg-charx (.jpeg), module.risum', 'card.jpeg', () => writerArchive(cardEntries(true), 0, { prefix: JPEG_HEAD }), true],
]

describe('import of complete charx and jpg-charx archives (compatibility guard)', () => {
    test.each(completeArchives)('File, chunked File, Uint8Array, Buffer and ReadableStream inputs import the same character and assets: %s', async (_label, name, make, withModule) => {
        const bytes = await make()
        h.module = { lorebook: [{ key: 'k', comment: 'lore' }], trigger: [], regex: [] }
        const reference = await runImport(bytes, name, 'uint8array')
        expect(reference.thrown).toBeNull()
        expect(reference.errors).toEqual([])
        expect(reference.characters).toHaveLength(1)
        expect(reference.savedIds).toEqual(assetIds)
        expect(reference.characters[0].globalLore).toEqual(withModule ? [{ key: 'k', comment: 'lore' }] : [])
        expect(h.moduleReads).toEqual(withModule ? [MODULE_BYTES.length] : [])
        expect(reference.log.filter((l) => l.includes('Saving Assets'))).toEqual([
            'alert:wait:Loading... (Saving Assets 1/3)',
            'alert:wait:Loading... (Saving Assets 2/3)',
            'alert:wait:Loading... (Saving Assets 3/3)',
        ])
        for (const input of ['file', 'chunked-file', 'buffer', 'stream'] as const) {
            reset()
            h.module = { lorebook: [{ key: 'k', comment: 'lore' }], trigger: [], regex: [] }
            const out = await runImport(bytes, name, input)
            expect(out.thrown, input).toBeNull()
            expect(out.errors, input).toEqual([])
            expect(out.characters, input).toEqual(reference.characters)
            expect(out.savedIds, input).toEqual(reference.savedIds)
            expect(out.log.filter((l) => l.includes('Saving Assets')).pop(), input).toBe('alert:wait:Loading... (Saving Assets 3/3)')
        }
    })

    test.each([['card.jpg'], ['card.jpeg']])('a plain JPEG named %s gives noData and saves nothing', async (name) => {
        for (const input of ['file', 'uint8array', 'stream'] as const) {
            reset()
            const out = await runImport(JPEG_HEAD, name, input)
            expect(out.errors, input).toEqual([language.errors.noData])
            expect(out.saveCalls, input).toBe(0)
            expect(out.characters, input).toEqual([])
        }
    })
})

describe('import of a complete charx archive whose asset saves fail (regression reproducer)', () => {
    test('a failing asset save on a complete archive shows the save failure as the last message, not an incomplete file, and returns no character', async () => {
        const bytes = await writerArchive(cardEntries(), 6)
        h.saveFail = 'storage full'
        const out = await runImport(bytes, 'card.charx', 'file')
        expect(out.thrown).toBeNull()
        expect(out.returned).toBeUndefined()
        expect(out.errors).toEqual(['Failed to save 3 assets'])
        expect(lastLog(out)).toBe('error:Failed to save 3 assets')
        expect(out.characters).toEqual([])
    })

    test('with returnCharacter a failing asset save shows the save failure as the last message and returns no character', async () => {
        const bytes = await writerArchive(cardEntries(), 6)
        h.saveFail = 'storage full'
        const returned = await importCharacterProcess({ name: 'card.charx', data: fileOf(bytes, 'card.charx'), returnCharacter: true })
        expect(returned).toBeUndefined()
        expect(h.log[h.log.length - 1]).toBe('error:Failed to save 3 assets')
        expect(h.characters).toEqual([])
    })
})

// ---------------------------------------------------------------------------------------------
// Cut archives are refused before anything is saved
// ---------------------------------------------------------------------------------------------

type CutKind = [string, (g: Geometry, z: Uint8Array) => number]
const cuts: CutKind[] = [
    ['inside the data of a middle entry', (g) => { const e = entryOf(g, 'assets/b.bin'); return e.dataStart + Math.floor((e.dataEnd - e.dataStart) / 2) }],
    ['inside the data of the last entry', (g) => { const e = entryOf(g, 'assets/c.bin'); return e.dataStart + Math.floor((e.dataEnd - e.dataStart) / 2) }],
    ['inside the data descriptor of the last entry', (g) => entryOf(g, 'assets/c.bin').dataEnd + 8],
    ['exactly where an entry would start', (g) => entryOf(g, 'assets/c.bin').header],
    ['inside a local header', (g) => entryOf(g, 'assets/c.bin').header + 20],
    ['inside the central directory', (g) => g.cdStart + 20],
    ['just before the end record', (g) => g.eocd],
    ['inside the end record', (g) => g.eocd + 10],
    ['one byte short of the end record', (g, z) => z.length - 1],
]

describe('import of cut charx archives (regression reproducer)', () => {
    const makers: Array<[string, () => Promise<Uint8Array>]> = [
        ['CharXWriter level 0', () => writerArchive(cardEntries(), 0)],
        ['CharXWriter level 6', () => writerArchive(cardEntries(), 6)],
        ['other tool', async () => otherToolArchive(cardEntries())],
    ]
    for (const [label, make] of makers) {
        test.each(cuts)(`${label}: a file cut %s is refused with nothing saved`, async (_cut, at) => {
            const z = await make()
            const cut = z.subarray(0, at(geometry(z), z))
            for (const input of ['file', 'chunked-file', 'uint8array', 'stream'] as const) {
                reset()
                expectRefusedBeforeSaving(await runImport(cut, 'card.charx', input), `${label} ${input}`)
            }
        })
    }

    test('the final message is the refusal when a slow asset save would otherwise still be running', async () => {
        const z = await writerArchive(cardEntries(), 6)
        const e = entryOf(geometry(z), 'assets/c.bin')
        h.saveDelay = 40
        const out = await runImport(z.subarray(0, e.dataStart + 100), 'card.charx', 'chunked-file', 120)
        expectRefusedBeforeSaving(out, 'slow save')
        expect(lastLog(out)).toBe('error:' + language.cardFileIncomplete)
    })

    test('a jpg-charx cut inside an entry is refused as an incomplete file only for a .charx name, and as noData for a .jpg name', async () => {
        const z = await writerArchive(cardEntries(), 6, { prefix: JPEG_HEAD })
        const g = geometry(z, JPEG_HEAD.length)
        const e = entryOf(g, 'assets/b.bin')
        const cut = z.subarray(0, e.dataStart + 100)
        expectRefusedBeforeSaving(await runImport(cut, 'card.charx', 'file'), '.charx name')
        reset()
        expectRefusedBeforeSaving(await runImport(cut, 'card.jpg', 'uint8array'), '.jpg name', language.errors.noData)
        reset()
        expectRefusedBeforeSaving(await runImport(cut, 'card.jpeg', 'file'), '.jpeg name', language.errors.noData)
    })

    test('an input with no end record at all is refused as an incomplete file for a .charx name', async () => {
        expectRefusedBeforeSaving(await runImport(new U8(10).fill(7), 'tiny.charx', 'uint8array'), 'tiny')
    })
})

// ---------------------------------------------------------------------------------------------
// Failures that leave the end record intact
// ---------------------------------------------------------------------------------------------

describe('import of damaged charx archives with an intact end record (regression reproducer)', () => {
    const damages: Array<[string, (z: Uint8Array) => Uint8Array]> = [
        ['an unknown compression method on a middle entry', (z) => method99(z, 'assets/b.bin')],
        ['an unknown compression method on the first asset', (z) => method99(z, 'assets/a.bin')],
        ['a reserved deflate block type on a middle entry', (z) => badBlockType(z, 'assets/b.bin')],
        ['a reserved deflate block type on the first asset', (z) => badBlockType(z, 'assets/a.bin')],
    ]

    test.each(damages)('a CharXWriter archive with %s is refused as an incomplete file', async (_label, damage) => {
        const z = damage(await writerArchive(cardEntries(), 6))
        for (const input of ['file', 'chunked-file', 'uint8array', 'stream'] as const) {
            reset()
            const out = await runImport(z, 'card.charx', input)
            expectRefused(out, input)
        }
    })

    test('the final message is the refusal even when an earlier asset save is still in flight', async () => {
        const z = method99(await writerArchive(cardEntries(), 6), 'assets/b.bin')
        h.saveDelay = 40
        const out = await runImport(z, 'card.charx', 'chunked-file', 150)
        expectRefused(out, 'method 99')
        expect(lastLog(out)).toBe('error:' + language.cardFileIncomplete)
        expect(out.log.filter((l) => l.includes('Saving Assets'))).toEqual([])
    })

    test('the final message is the refusal for a reserved block type with an earlier save still in flight', async () => {
        const z = badBlockType(await writerArchive(cardEntries(), 6), 'assets/b.bin')
        h.saveDelay = 40
        const out = await runImport(z, 'card.charx', 'chunked-file', 150)
        expectRefused(out, 'block type')
        expect(lastLog(out)).toBe('error:' + language.cardFileIncomplete)
    })

    test('an other-tool archive with a stored entry and a damaged deflate entry is refused', async () => {
        const z = badBlockType(otherToolArchive(cardEntries()), 'assets/b.bin')
        expectRefused(await runImport(z, 'card.charx', 'file'), 'other tool')
    })
})

// ---------------------------------------------------------------------------------------------
// Origins: input, importer and zip failures are told apart without looking at the error
// ---------------------------------------------------------------------------------------------

describe('failures of the input and of the importer show their own message', () => {
    test('a File whose stream fails mid-read shows the stream error, not an incomplete file', async () => {
        const z = await writerArchive(cardEntries(), 6)
        const f = fileOf(z, 'card.charx')
        f.stream = () => chunkedStream(z.subarray(0, 9000), 4096, (c) => c.error(new DOMException('stream failed', 'NotReadableError')))
        let thrown: string | null = null
        try { await importCharacterProcess({ name: 'card.charx', data: f }) } catch (e) { thrown = String(e) }
        expect(thrown).toBeNull()
        expect(h.errors).toHaveLength(1)
        expect(h.errors[0]).toContain('stream failed')
        expect(h.errors).not.toContain(language.cardFileIncomplete)
        expect(h.characters).toEqual([])
    })

    test('a File whose tail cannot be read shows that error, not an incomplete file', async () => {
        const z = await writerArchive(cardEntries(), 6)
        const f = fileOf(z, 'card.charx')
        f.slice = () => { throw new DOMException('tail unreadable', 'NotReadableError') }
        await importCharacterProcess({ name: 'card.charx', data: f })
        expect(h.errors).toHaveLength(1)
        expect(h.errors[0]).toContain('tail unreadable')
        expect(h.saveCalls).toBe(0)
    })

    test('a ReadableStream input that fails while it is buffered shows that error', async () => {
        const stream = new ReadableStream<Uint8Array>({ start(c) { c.error(new TypeError('network error')) } })
        await importCharacterProcess({ name: 'card.charx', data: stream })
        expect(h.errors).toHaveLength(1)
        expect(h.errors[0]).toContain('network error')
    })

    test.each([
        ['stored (level 0) archive', () => writerArchive(cardEntries(), 0)],
        ['deflated (level 6) archive', () => writerArchive(cardEntries(), 6)],
        ['other-tool archive with a stored entry', async () => otherToolArchive(cardEntries())],
    ] as Array<[string, () => Promise<Uint8Array>]>)('an allocation failure in the importer on a valid %s shows the failure, not an incomplete file', async (_label, make) => {
        const z = await make()
        for (const input of ['file', 'chunked-file', 'uint8array'] as const) {
            reset()
            h.appendFailWhen = startsWithTag('ASSc')
            const out = await runImport(z, 'card.charx', input)
            expectRefused(out, input, 'Array buffer allocation failed (simulated)')
        }
    })

    test('the final message is the importer failure when an earlier asset save is still in flight', async () => {
        const z = await writerArchive(cardEntries(), 6)
        h.appendFailWhen = startsWithTag('ASSb')
        h.saveDelay = 40
        const out = await runImport(z, 'card.charx', 'chunked-file', 150)
        expect(out.errors).toEqual(['Array buffer allocation failed (simulated)'])
        expect(lastLog(out)).toBe('error:Array buffer allocation failed (simulated)')
    })
})

// ---------------------------------------------------------------------------------------------
// Realm download
// ---------------------------------------------------------------------------------------------

describe('downloadRisuHub charx download', () => {
    /**
     * `arrayBuffer` counts only calls made outside `blob()`, because a Response may implement `blob()` through it.
     * With `failBody`, every way of reading the body rejects.
     */
    function realmResponse(bytes: Uint8Array, contentType = 'application/zip', failBody = false) {
        const res = new Response(new U8(bytes), { status: 200, headers: { 'content-type': contentType } })
        const failing = async (): Promise<never> => { throw new TypeError('network error') }
        const realArrayBuffer = failBody ? failing : res.arrayBuffer.bind(res)
        const realBlob = failBody ? failing : res.blob.bind(res)
        let insideBlob = false
        const direct = { arrayBufferCalls: 0 }
        Object.defineProperty(res, 'arrayBuffer', {
            configurable: true,
            value: () => {
                if (!insideBlob) direct.arrayBufferCalls++
                return realArrayBuffer()
            },
        })
        Object.defineProperty(res, 'blob', {
            configurable: true,
            value: async () => {
                insideBlob = true
                try { return await realBlob() } finally { insideBlob = false }
            },
        })
        return { res, direct }
    }

    test.each(['application/zip', 'application/charx'])('reads a %s download as a Blob, not as one array, and imports the card', async (type) => {
        const z = await writerArchive(cardEntries(), 6)
        const { res, direct } = realmResponse(z, type)
        vi.stubGlobal('fetch', vi.fn(async () => res))
        await downloadRisuHub('some-id', { creator: 'some-creator' })
        expect(direct.arrayBufferCalls).toBe(0)
        expect(h.errors).toEqual([])
        expect(h.characters).toHaveLength(1)
        expect(h.saved.map((s) => s.id).sort()).toEqual(assetIds)
    })

    test('imports the same character and assets as the same archive dropped as a File (compatibility guard)', async () => {
        const z = await writerArchive(cardEntries(true), 6)
        const fromFile = await runImport(z, 'card.charx', 'file')
        reset()
        vi.stubGlobal('fetch', vi.fn(async () => realmResponse(z).res))
        await downloadRisuHub('some-id', { creator: 'some-creator' })
        const fromRealm = describeOutcome(undefined, null)
        expect(fromRealm.errors).toEqual([])
        expect(fromRealm.characters).toEqual(fromFile.characters)
        expect(fromRealm.savedIds).toEqual(fromFile.savedIds)
    })

    test('a download cut inside an asset is refused with nothing saved', async () => {
        const z = await writerArchive(cardEntries(), 6)
        const e = entryOf(geometry(z), 'assets/b.bin')
        vi.stubGlobal('fetch', vi.fn(async () => realmResponse(z.subarray(0, e.dataStart + 100)).res))
        await downloadRisuHub('some-id', { creator: 'some-creator' })
        expect(h.saveCalls).toBe(0)
        expect(h.characters).toEqual([])
        expect(h.errors).toEqual([language.cardFileIncomplete])
    })

    test.each([
        ['a cut archive', async () => { const z = await writerArchive(cardEntries(), 6); return z.subarray(0, entryOf(geometry(z), 'assets/b.bin').dataStart + 100) }],
        ['an archive whose asset saves fail (guard)', async () => { h.saveFail = 'storage full'; return await writerArchive(cardEntries(), 6) }],
    ] as Array<[string, () => Promise<Uint8Array>]>)('a download of %s with a character already in the library does not order or open any character', async (_label, make) => {
        const bytes = await make()
        h.characters = [{ name: 'Existing' }]
        vi.stubGlobal('fetch', vi.fn(async () => realmResponse(bytes).res))
        await downloadRisuHub('some-id', { forceRedirect: true, creator: 'some-creator' })
        expect(h.characters).toEqual([{ name: 'Existing' }])
        expect(changeChar).not.toHaveBeenCalled()
        expect(checkCharOrder).not.toHaveBeenCalled()
        expect(h.log[h.log.length - 1].startsWith('error:')).toBe(true)
    })

    test('a download that imports orders the characters and opens the new one (compatibility guard)', async () => {
        const z = await writerArchive(cardEntries(), 6)
        vi.stubGlobal('fetch', vi.fn(async () => realmResponse(z).res))
        await downloadRisuHub('some-id', { forceRedirect: true, creator: 'some-creator' })
        expect(h.characters).toHaveLength(1)
        expect(checkCharOrder).toHaveBeenCalledTimes(1)
        expect(changeChar).toHaveBeenCalledWith(0)
    })

    test('a download whose body fails still ends in an error and imports nothing (compatibility guard)', async () => {
        const z = await writerArchive(cardEntries(), 6)
        const { res } = realmResponse(z, 'application/zip', true)
        vi.stubGlobal('fetch', vi.fn(async () => res))
        await downloadRisuHub('some-id', { creator: 'some-creator' })
        expect(h.errors).toEqual(['Error while importing'])
        expect(h.saveCalls).toBe(0)
        expect(h.characters).toEqual([])
    })
})

// ---------------------------------------------------------------------------------------------
// CharXImporter and hasZipEndRecord on their own
// ---------------------------------------------------------------------------------------------

async function parseOf(data: Uint8Array | File | ReadableStream<Uint8Array>) {
    const importer = new CharXImporter()
    importer.alertInfo = true
    h.appendTags = []
    let error: unknown
    try { await importer.parse(data) } catch (e) { error = e }
    return { importer, error }
}

const originOf = (error: unknown) => (error as { origin?: string } | undefined)?.origin ?? `no origin: ${String(error)}`

describe('CharXImporter.parse rejections', () => {
    test('a stream read failure rejects with origin input', async () => {
        const z = await writerArchive(cardEntries(), 6)
        const { error } = await parseOf(chunkedStream(z.subarray(0, 9000), 4096, (c) => c.error(new DOMException('stream failed', 'NotReadableError'))))
        expect(originOf(error)).toBe('input')
    })

    test.each([['level 0', 0], ['level 6', 6]] as const)('an archive cut inside an entry (%s) rejects with origin zip', async (_label, level) => {
        const z = await writerArchive(cardEntries(), level)
        const e = entryOf(geometry(z), 'assets/c.bin')
        const { error } = await parseOf(z.subarray(0, e.dataStart + Math.floor((e.dataEnd - e.dataStart) / 2)))
        expect(originOf(error)).toBe('zip')
    })

    test('a reserved block type reported through the entry data handler rejects with origin zip', async () => {
        const z = badBlockType(await writerArchive(cardEntries(), 6), 'assets/b.bin')
        expect(originOf((await parseOf(z)).error)).toBe('zip')
    })

    test('an unknown compression method thrown by the parser itself rejects with origin zip', async () => {
        const z = method99(await writerArchive(cardEntries(), 6), 'assets/b.bin')
        expect(originOf((await parseOf(z)).error)).toBe('zip')
    })

    test.each([
        ['CharXWriter level 6', () => writerArchive(cardEntries(), 6)],
        ['CharXWriter level 0', () => writerArchive(cardEntries(), 0)],
        ['other-tool archive with a stored entry', async () => otherToolArchive(cardEntries())],
    ] as Array<[string, () => Promise<Uint8Array>]>)('an exception raised by the importer\'s own buffer rejects with origin importer and the original error (%s)', async (_label, make) => {
        h.appendFailWhen = startsWithTag('ASSc')
        const { error } = await parseOf(await make())
        expect(originOf(error)).toBe('importer')
        expect((error as CharXParseError).message).toBe('Array buffer allocation failed (simulated)')
        expect((error as CharXParseError).cause).toBeInstanceOf(RangeError)
    })

    test('after an importer failure, a later entry is not started, so the importer origin stands', async () => {
        // asset a cannot be buffered; asset b (unknown compression method) is never started
        const z = method99(await writerArchive(cardEntries(), 6), 'assets/b.bin')
        h.appendFailWhen = startsWithTag('ASSa')
        expect(originOf((await parseOf(z)).error)).toBe('importer')
    })

    test('after a zip error, a later entry is not started, so the zip origin stands', async () => {
        const z = badBlockType(await writerArchive(cardEntries(), 6), 'assets/a.bin')
        h.appendFailWhen = startsWithTag('ASSc')
        expect(originOf((await parseOf(z)).error)).toBe('zip')
    })

    test('an importer failure stays the reported origin when the parser throws after it in the same push', async () => {
        const z = await writerArchive(cardEntries(), 6)
        h.appendFailWhen = startsWithTag('ASSa')
        h.latePushThrow = true
        const { error } = await parseOf(z)
        expect(originOf(error)).toBe('importer')
        expect((error as CharXParseError).message).toBe('Array buffer allocation failed (simulated)')
    })

    test('an importer failure stays the reported origin when an entry reports a data error after it', async () => {
        const z = await writerArchive(cardEntries(), 6)
        h.appendFailWhen = startsWithTag('ASSa')
        h.lateOndataError = true
        const { error } = await parseOf(z)
        expect(originOf(error)).toBe('importer')
    })

    test('saves queued before a later entry fails in the same push are not started, even those waiting for a free slot', async () => {
        // twelve small assets are queued (ten slots), then the thirteenth has an unknown compression method
        const small: Entry[] = [['card.json', v3Card]]
        for (let i = 0; i < 13; i++) small.push([`assets/s${i}.bin`, body(2000, 50 + i, 'SMLL')])
        const z = method99(await writerArchive(small, 6), 'assets/s12.bin')
        h.saveDelay = 20
        const { error } = await parseOf(z)
        await tick(80)
        expect(originOf(error)).toBe('zip')
        expect(h.saveCalls).toBe(0)
    })

    test('after the first failure no later entry in the same push is saved', async () => {
        // a single 1 MB push holds the failing asset a and the intact assets b and c after it
        const z = badBlockType(await writerArchive(cardEntries(), 6), 'assets/a.bin')
        expect(z.length).toBeLessThan(1024 * 1024)
        const { error, importer } = await parseOf(z)
        await tick(30)
        expect(originOf(error)).toBe('zip')
        expect(h.saveCalls).toBe(0)
        expect(Object.keys(importer.assets)).toEqual([])
        // no later entry is started or buffered
        expect(h.appendTags).toEqual([])
        expect(Object.keys(importer.assetBuffers)).toEqual([])
    })

    test('after an importer failure no later entry in the same push is saved', async () => {
        const z = await writerArchive(cardEntries(), 6)
        h.appendFailWhen = startsWithTag('ASSa')
        const { error, importer } = await parseOf(z)
        await tick(30)
        expect(originOf(error)).toBe('importer')
        expect(h.saveCalls).toBe(0)
        // asset a is the only entry whose data was handed to the importer
        expect(h.appendTags).toEqual(['ASSa'])
        expect(Object.keys(importer.assetBuffers)).toEqual([])
    })

    test('a save already queued for a started asset shows no progress once a later entry fails', async () => {
        const z = method99(await writerArchive(cardEntries(), 6), 'assets/b.bin')
        h.saveDelay = 40
        const { error } = await parseOf(chunkedStream(z, 4096))
        await tick(120)
        expect(originOf(error)).toBe('zip')
        expect(h.log.filter((l) => l.includes('Saving Assets'))).toEqual([])
    })

    test('a failing save together with an error on the final push leaves no rejection without a listener', async () => {
        const unhandled: unknown[] = []
        const listener = (reason: unknown) => { unhandled.push(reason) }
        process.on('unhandledRejection', listener)
        try {
            const z = await writerArchive(cardEntries(), 6)
            h.saveFail = 'storage full'
            h.finalPushError = true
            // the archive arrives first, the save fails, and only then the final push reports its error
            const stream = new ReadableStream<Uint8Array>({
                async start(controller) {
                    controller.enqueue(new U8(z))
                    await tick(40)
                    controller.close()
                },
            })
            const { error } = await parseOf(stream)
            await tick(60)
            expect(originOf(error)).toBe('zip')
            expect(h.saveCalls).toBeGreaterThan(0)
            expect(unhandled).toEqual([])
        } finally {
            process.off('unhandledRejection', listener)
        }
    })
})

describe('hasZipEndRecord', () => {
    const tailOf = async (z: Uint8Array) => ({ file: await hasZipEndRecord(fileOf(z, 'x.charx')), bytes: await hasZipEndRecord(z) })

    test('finds the end record of an archive, of an archive with a comment and of a jpg-charx', async () => {
        const plain = await writerArchive(cardEntries(), 6)
        expect(await tailOf(plain)).toEqual({ file: true, bytes: true })
        expect(await tailOf(await writerArchive(cardEntries(), 6, { comment: enc.encode('comment') }))).toEqual({ file: true, bytes: true })
        expect(await tailOf(await writerArchive(cardEntries(), 6, { prefix: JPEG_HEAD }))).toEqual({ file: true, bytes: true })
    })

    test('finds the end record of an archive with the longest archive comment', async () => {
        const comment = new U8(0xffff).fill(0x41)
        expect(await tailOf(await writerArchive(cardEntries(), 6, { comment }))).toEqual({ file: true, bytes: true })
    })

    test('an end record signature earlier in the window counts when a later signature inside the comment does not fit', async () => {
        // the comment holds a later signature whose own comment length (0x4242) runs past the end of the data
        const comment = concat([enc.encode('xx'), new U8([0x50, 0x4b, 0x05, 0x06]), new U8(40).fill(0x42)])
        expect(await tailOf(await writerArchive(cardEntries(), 6, { comment }))).toEqual({ file: true, bytes: true })
    })

    test('a signature whose record or comment runs past the end of the data does not count', async () => {
        const z = await writerArchive(cardEntries(), 6)
        expect(await tailOf(z.subarray(0, z.length - 1))).toEqual({ file: false, bytes: false })
        const claimsComment = z.slice()
        new DataView(claimsComment.buffer).setUint16(claimsComment.length - 2, 5, true)
        expect(await tailOf(claimsComment)).toEqual({ file: false, bytes: false })
    })

    test('data without a signature in its last 65557 bytes has no end record', async () => {
        const z = await writerArchive(cardEntries(), 6)
        const farTail = concat([z, new U8(0x10000).fill(0x20)])
        expect(await tailOf(farTail)).toEqual({ file: false, bytes: false })
        expect(await tailOf(new U8(0))).toEqual({ file: false, bytes: false })
        expect(await tailOf(JPEG_HEAD)).toEqual({ file: false, bytes: false })
    })

    test('does not check the central directory offset, which a jpg-charx keeps relative to the archive', async () => {
        const z = await writerArchive(cardEntries(), 6, { prefix: JPEG_HEAD })
        const dv = new DataView(z.buffer, z.byteOffset, z.byteLength)
        // the offset points before the archive start as read from the whole file; the record must still count
        dv.setUint32(z.length - 22 + 16, 1, true)
        expect((await tailOf(z)).file).toBe(true)
    })

    test('rejects with origin input when the tail of a File cannot be read', async () => {
        const f = fileOf(await writerArchive(cardEntries(), 6), 'x.charx')
        f.slice = () => { throw new DOMException('tail unreadable', 'NotReadableError') }
        const error = await hasZipEndRecord(f).catch((e: unknown) => e)
        expect(originOf(error)).toBe('input')
    })
})

// ---------------------------------------------------------------------------------------------
// Size limits: card.json and module.risum 50 MiB, every other entry 200 MiB, refused before anything is saved
// ---------------------------------------------------------------------------------------------

const MIB = 1024 * 1024
const sizeMessage = (name: string, limitMiB: number) => language.cardFileEntryTooLarge(name, limitMiB)

/** Zero-filled (so it compresses to almost nothing) bytes that start with a 4-character tag. */
function zeros(n: number, tag = 'ZERO'): Uint8Array {
    const a = new U8(n)
    a.set(enc.encode(tag), 0)
    return a
}

/** `cardEntries()` with one asset's data replaced. */
function replaceAsset(entries: Entry[], name: string, data: Uint8Array): Entry[] {
    return entries.map(([key, value]) => key === name ? [key, data] as Entry : [key, value] as Entry)
}

/** card.json padded with spaces (still valid JSON) up to `size` bytes. */
function paddedCard(size: number): Uint8Array {
    const card = enc.encode(v3Card)
    const out = new U8(size).fill(0x20)
    out.set(card, 0)
    return out
}

type CdRecord = { name: string, at: number }

/** The central directory records of an archive, located from the end record (never from the offset field). */
function cdRecords(z: Uint8Array): CdRecord[] {
    const dv = new DataView(z.buffer, z.byteOffset, z.byteLength)
    let eocd = -1
    for (let i = z.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
    const out: CdRecord[] = []
    let at = eocd - dv.getUint32(eocd + 12, true)
    while (at < eocd) {
        const nameLen = dv.getUint16(at + 28, true)
        out.push({ name: new TextDecoder().decode(z.subarray(at + 46, at + 46 + nameLen)), at })
        at += 46 + nameLen + dv.getUint16(at + 30, true) + dv.getUint16(at + 32, true)
    }
    return out
}

/** A copy whose central directory declares `size` for the entry `name`. */
function declareSize(z: Uint8Array, name: string, size: number): Uint8Array {
    const c = z.slice()
    new DataView(c.buffer).setUint32(cdRecords(c).find((r) => r.name === name)!.at + 24, size, true)
    return c
}

const eocdOf = (z: Uint8Array) => geometry(z).eocd

describe('charx size limits: refusal before anything is saved', () => {
    test('a data-descriptor asset over 200 MiB is refused with a message naming it and nothing saved (regression reproducer)', async () => {
        const z = await writerArchive(replaceAsset(cardEntries(), 'assets/b.bin', zeros(201 * MIB)), 6)
        const out = await runImport(z, 'card.charx', 'file')
        expectRefusedBeforeSaving(out, '201 MiB descriptor entry', sizeMessage('assets/b.bin', 200))
        expect(out.returned).toBeUndefined()
    }, 240000)

    test('a known-size asset over 200 MiB is refused with a message naming it and nothing saved (regression reproducer)', async () => {
        const z = otherToolArchive(replaceAsset(cardEntries(), 'assets/b.bin', zeros(201 * MIB)))
        const out = await runImport(z, 'card.charx', 'file')
        expectRefusedBeforeSaving(out, '201 MiB known-size entry', sizeMessage('assets/b.bin', 200))
    }, 240000)

    test('a card.json over 50 MiB written after the assets is refused before the assets are saved (regression reproducer)', async () => {
        const z = await writerArchive([...cardEntries().filter(([k]) => k !== 'card.json'), ['card.json', paddedCard(51 * MIB)]], 6)
        expectRefusedBeforeSaving(await runImport(z, 'card.charx', 'file'), 'card.json 51 MiB', sizeMessage('card.json', 50))
    }, 240000)

    test('a module.risum over 50 MiB is refused instead of importing the card without its module (regression reproducer)', async () => {
        const entries: Entry[] = [...cardEntries().filter(([k]) => k !== 'card.json'), ['module.risum', zeros(51 * MIB)], ['card.json', v3Card]]
        expectRefusedBeforeSaving(await runImport(await writerArchive(entries, 6), 'card.charx', 'file'), 'module.risum 51 MiB', sizeMessage('module.risum', 50))
        expect(h.moduleReads).toEqual([])
    }, 240000)

    test('an asset between 50 and 200 MiB imports (regression reproducer)', async () => {
        const big = zeros(51 * MIB, 'BIG1')
        const z = await writerArchive(replaceAsset(cardEntries(), 'assets/b.bin', big), 6)
        const out = await runImport(z, 'card.charx', 'file')
        expect(out.thrown).toBeNull()
        expect(out.errors).toEqual([])
        expect(out.characters).toHaveLength(1)
        expect(out.savedIds).toContain(sha1(big))
        expect(out.savedIds).toHaveLength(3)
    }, 240000)

    test('a known-size module.risum of exactly 50 MiB is read (regression reproducer for the boundary)', async () => {
        const z = otherToolArchive([['card.json', v3Card], ['module.risum', zeros(50 * MIB)], ...ASSETS.map((a) => [a.name, a.data] as Entry)])
        const out = await runImport(z, 'card.charx', 'file')
        expect(out.errors).toEqual([])
        expect(out.characters).toHaveLength(1)
        expect(h.moduleReads).toEqual([50 * MIB])
    }, 240000)

    test('a data-descriptor module.risum of exactly 50 MiB is read (compatibility guard)', async () => {
        const z = await writerArchive([['card.json', v3Card], ['module.risum', zeros(50 * MIB)], ...ASSETS.map((a) => [a.name, a.data] as Entry)], 6)
        const out = await runImport(z, 'card.charx', 'file')
        expect(out.errors).toEqual([])
        expect(h.moduleReads).toEqual([50 * MIB])
    }, 240000)

    test.each([
        ['known-size', (entries: Entry[]) => Promise.resolve(otherToolArchive(entries))],
        ['data-descriptor', (entries: Entry[]) => writerArchive(entries, 6)],
    ] as Array<[string, (entries: Entry[]) => Promise<Uint8Array>]>)('an asset of exactly the limit imports and one byte more is refused (%s) (regression reproducer)', async (_label, build) => {
        charxLimits.assetBytes = 2 * MIB
        const exact = zeros(2 * MIB, 'EXAC')
        const exactOut = await runImport(await build(replaceAsset(cardEntries(), 'assets/b.bin', exact)), 'card.charx', 'file')
        expect(exactOut.errors).toEqual([])
        expect(exactOut.savedIds).toContain(sha1(exact))
        reset()
        charxLimits.assetBytes = 2 * MIB
        const over = await runImport(await build(replaceAsset(cardEntries(), 'assets/b.bin', zeros(2 * MIB + 1, 'OVER'))), 'card.charx', 'file')
        expectRefusedBeforeSaving(over, 'one byte over', sizeMessage('assets/b.bin', 2))
    })

    test('a central directory that declares an over-limit size for a small entry refuses the card before saving (new behaviour)', async () => {
        const z = declareSize(await writerArchive(cardEntries(), 6), 'assets/a.bin', 201 * MIB)
        expectRefusedBeforeSaving(await runImport(z, 'card.charx', 'file'), 'declared 201 MiB', sizeMessage('assets/a.bin', 200))
    })

    test('the size refusal comes from the Uint8Array and stream inputs as well, never as an incomplete file', async () => {
        charxLimits.assetBytes = 2 * MIB
        const z = await writerArchive(replaceAsset(cardEntries(), 'assets/b.bin', zeros(3 * MIB)), 6)
        for (const input of ['uint8array', 'buffer', 'stream', 'chunked-file', 'source'] as const) {
            reset()
            charxLimits.assetBytes = 2 * MIB
            const out = await runImport(z, 'card.charx', input)
            expect(out.thrown, input).toBeNull()
            expect(out.errors, input).toEqual([sizeMessage('assets/b.bin', 2)])
            expect(out.characters, input).toEqual([])
        }
    })
})

describe('charx size limits on the Node server', () => {
    test('an asset the directory declares over the 100 MiB write limit is refused with a message naming the limit before anything is saved', async () => {
        h.node = true
        const z = declareSize(await writerArchive(cardEntries(), 6), 'assets/a.bin', 101 * MIB)
        expectRefusedBeforeSaving(await runImport(z, 'card.charx', 'file'), 'declared 101 MiB on Node', sizeMessage('assets/a.bin', 100))
    })

    test('the same archive is not refused for its size off the Node server, where 200 MiB is the limit (guard)', async () => {
        const z = declareSize(await writerArchive(cardEntries(), 6), 'assets/a.bin', 101 * MIB)
        const out = await runImport(z, 'card.charx', 'file')
        expect(out.errors).toEqual([])
        expect(out.characters).toHaveLength(1)
    })

    test('the card.json and module.risum limit stays 50 MiB on the Node server (guard)', async () => {
        h.node = true
        const z = await writerArchive([...cardEntries().filter(([k]) => k !== 'card.json'), ['card.json', paddedCard(51 * MIB)]], 6)
        expectRefusedBeforeSaving(await runImport(z, 'card.charx', 'file'), 'card.json 51 MiB on Node', sizeMessage('card.json', 50))
    }, 240000)
})

describe('a charx read through an import source', () => {
    test('imports the same character and assets as the File it was read from', async () => {
        const z = await writerArchive(cardEntries(), 6)
        const fromFile = await runImport(z, 'card.charx', 'file')
        reset()
        const fromSource = await runImport(z, 'card.charx', 'source')

        expect(fromSource.errors).toEqual([])
        expect(fromSource.thrown).toBeNull()
        expect(fromSource.savedIds).toEqual(fromFile.savedIds)
        expect(fromSource.characters).toEqual(fromFile.characters)
    })

    test('a cut archive is refused as incomplete and nothing is saved', async () => {
        const z = await writerArchive(cardEntries(), 6)
        const out = await runImport(z.subarray(0, z.length - 40), 'card.charx', 'source')
        expect(out.saveCalls).toBe(0)
        expect(out.errors).toEqual([language.cardFileIncomplete])
    })
})

describe('charx size limits: the streaming check when the central directory does not say', () => {
    test('a central directory that understates an entry still refuses at the limit with the size message (regression reproducer)', async () => {
        charxLimits.assetBytes = 2 * MIB
        const z = declareSize(await writerArchive(replaceAsset(cardEntries(), 'assets/b.bin', zeros(3 * MIB)), 6), 'assets/b.bin', 1000)
        resetAppendStats()
        const out = await runImport(z, 'card.charx', 'file')
        expect(out.thrown).toBeNull()
        expect(out.errors).toEqual([sizeMessage('assets/b.bin', 2)])
        expect(out.characters).toEqual([])
        expect(h.maxEntryBytes).toBeLessThanOrEqual(2 * MIB)
    })

    test('an unreadable central directory still refuses a data-descriptor asset over the limit (regression reproducer)', async () => {
        charxLimits.assetBytes = 2 * MIB
        const z = await writerArchive(replaceAsset(cardEntries(), 'assets/b.bin', zeros(3 * MIB)), 6)
        z[cdRecords(z)[0].at] = 0
        const out = await runImport(z, 'card.charx', 'file')
        expect(out.errors).toEqual([sizeMessage('assets/b.bin', 2)])
        expect(out.characters).toEqual([])
    })

    test('an unreadable central directory still refuses a known-size asset over the limit without starting it (regression reproducer)', async () => {
        charxLimits.assetBytes = 2 * MIB
        const z = otherToolArchive(replaceAsset(cardEntries(), 'assets/b.bin', zeros(3 * MIB)))
        z[cdRecords(z)[0].at] = 0
        resetAppendStats()
        const out = await runImport(z, 'card.charx', 'file')
        expect(out.errors).toEqual([sizeMessage('assets/b.bin', 2)])
        // the oversize entry is refused when it is announced, so nothing near its size is ever buffered
        expect(h.maxEntryBytes).toBeLessThan(MIB)
    })

    test('a JSON file that is not the card is counted against the limit and refused with an unreadable central directory (regression reproducer)', async () => {
        charxLimits.assetBytes = 2 * MIB
        const entries: Entry[] = [...cardEntries(), ['x_meta/info.json', zeros(3 * MIB)]]
        const z = await writerArchive(entries, 6)
        z[cdRecords(z)[0].at] = 0
        const out = await runImport(z, 'card.charx', 'file')
        expect(out.errors).toEqual([sizeMessage('x_meta/info.json', 2)])
    })

    test('a JSON file that is not the card is discarded without being retained (new behaviour)', async () => {
        const importer = new CharXImporter()
        const z = await writerArchive([...cardEntries(), ['x_meta/info.json', zeros(3 * MIB)]], 6)
        let retained = -1
        const push = importer.unzip.push.bind(importer.unzip)
        importer.unzip.push = (chunk: Uint8Array, final?: boolean) => {
            push(chunk, final)
            const buffer = importer.assetBuffers['x_meta/info.json']
            if (buffer) retained = Math.max(retained, buffer.retainedBytes)
        }
        await importer.parse(chunkedStream(z, 512))
        await importer.done()
        expect(retained).toBe(0)
        expect(Object.keys(importer.assets).sort()).toHaveLength(3)
    })

    test('a damaged JSON file that is not the card is refused as an incomplete file (compatibility guard)', async () => {
        const z = badBlockType(await writerArchive([...cardEntries(), ['x_meta/info.json', body(5000, 9, 'JSON')]], 6), 'x_meta/info.json')
        expectRefused(await runImport(z, 'card.charx', 'file'), 'damaged json')
    })
})

describe('charx size limits: backlog of decoded assets', () => {
    test.each([16, 64])('assets waiting to be saved stay bounded whatever the asset count: %i assets of 4 MiB (regression reproducer)', async (count) => {
        const blob = zeros(4 * MIB, 'BLOB')
        const entries: Entry[] = [['card.json', v3Card]]
        for (let i = 0; i < count; i++) entries.push([`assets/blob${i}.bin`, blob])
        const z = await writerArchive(entries, 6)
        const importer = new CharXImporter()
        const counters = importer as unknown as { totalEnqueued: number, totalCompleted: number }
        h.saveDelay = 20
        let maxUnsaved = 0
        const push = importer.unzip.push.bind(importer.unzip)
        importer.unzip.push = (chunk: Uint8Array, final?: boolean) => {
            maxUnsaved = Math.max(maxUnsaved, counters.totalEnqueued - counters.totalCompleted)
            push(chunk, final)
        }
        await importer.parse(chunkedStream(z, 512))
        await importer.done()
        expect(h.saved).toHaveLength(count)
        // 32 MiB of backlog is eight assets of 4 MiB, plus the entry that completes while reading resumes
        expect(maxUnsaved).toBeLessThanOrEqual(10)
    }, 240000)

    test('a save that fails while the reader waits for the backlog ends the import with that failure, not a hang', async () => {
        const blob = zeros(4 * MIB, 'BLOB')
        const entries: Entry[] = [['card.json', v3Card]]
        for (let i = 0; i < 12; i++) entries.push([`assets/blob${i}.bin`, blob])
        const z = await writerArchive(entries, 6)
        h.saveDelay = 5
        h.saveFail = 'storage full'
        const importer = new CharXImporter()
        await importer.parse(chunkedStream(z, 512))
        await expect(importer.done()).rejects.toBeDefined()
    }, 240000)
})

describe('charx size limits: archives the central directory pre-check must not break', () => {
    const expectImports = async (z: Uint8Array, name = 'card.charx') => {
        const out = await runImport(z, name, 'file')
        expect(out.thrown).toBeNull()
        expect(out.errors).toEqual([])
        expect(out.characters).toHaveLength(1)
        expect(out.savedIds).toEqual(assetIds)
        return out
    }

    test('a central directory that overstates a data-descriptor size within the limit imports the same bytes as the original (compatibility guard)', async () => {
        const z = await writerArchive(cardEntries(), 6)
        await expectImports(declareSize(z, 'assets/b.bin', 150 * MIB))
    })

    test('a central directory that understates a data-descriptor size within the limit imports the same bytes (compatibility guard)', async () => {
        const z = await writerArchive(cardEntries(), 6)
        await expectImports(declareSize(z, 'assets/b.bin', 10))
    })

    test('a central directory whose names are in another order than the entries imports the same bytes (compatibility guard)', async () => {
        const z = (await writerArchive(cardEntries(), 6)).slice()
        const [first, second] = cdRecords(z).filter((r) => r.name.startsWith('assets/'))
        const nameA = z.slice(first.at + 46, first.at + 46 + first.name.length)
        z.set(z.slice(second.at + 46, second.at + 46 + second.name.length), first.at + 46)
        z.set(nameA, second.at + 46)
        await expectImports(z)
    })

    test('a central directory whose entry count does not match falls back to streaming (compatibility guard)', async () => {
        const z = (await writerArchive(cardEntries(), 6)).slice()
        const dv = new DataView(z.buffer)
        const eocd = eocdOf(z)
        dv.setUint16(eocd + 8, 9, true)
        dv.setUint16(eocd + 10, 9, true)
        await expectImports(declareSize(z, 'assets/a.bin', 300 * MIB))
    })

    test('a central directory whose records do not end at the end record falls back to streaming (compatibility guard)', async () => {
        // seven bytes sit between the last record and the end record, and the end record counts them in the directory length;
        // every record parses, so only the exact-end check can reject the directory
        const declared = declareSize(await writerArchive(cardEntries(), 6), 'assets/a.bin', 300 * MIB)
        const eocd = eocdOf(declared)
        const z = concat([declared.subarray(0, eocd), new U8(7), declared.subarray(eocd)])
        const dv = new DataView(z.buffer)
        dv.setUint32(eocd + 7 + 12, dv.getUint32(eocd + 7 + 12, true) + 7, true)
        await expectImports(z)
    })

    test('an unparseable central directory falls back to streaming (compatibility guard)', async () => {
        const z = declareSize(await writerArchive(cardEntries(), 6), 'assets/a.bin', 300 * MIB)
        z[cdRecords(z)[2].at] = 0
        await expectImports(z)
    })

    test('an archive with zip64 end records is not pre-checked and imports (compatibility guard)', async () => {
        const z = declareSize(await writerArchive(cardEntries(), 6), 'assets/a.bin', 300 * MIB)
        const eocd = eocdOf(z)
        const record = new U8(56)
        new DataView(record.buffer).setUint32(0, 0x06064b50, true)
        const locator = new U8(20)
        new DataView(locator.buffer).setUint32(0, 0x07064b50, true)
        await expectImports(concat([z.subarray(0, eocd), record, locator, z.subarray(eocd)]))
    })

    test('a jpg-charx whose end record offset field is wrong imports (compatibility guard)', async () => {
        const z = await writerArchive(cardEntries(), 6, { prefix: JPEG_HEAD })
        new DataView(z.buffer, z.byteOffset, z.byteLength).setUint32(z.length - 22 + 16, 1, true)
        await expectImports(z, 'card.jpg')
    })

    test('a jpg-charx with an archive comment and a wrong end record offset field still has its central directory checked (new behaviour)', async () => {
        const archive = await writerArchive(cardEntries(), 6, { prefix: JPEG_HEAD, comment: enc.encode('synthetic archive comment') })
        const z = declareSize(archive, 'assets/a.bin', 201 * MIB)
        // the end record starts 22 bytes plus the comment length before the end
        new DataView(z.buffer, z.byteOffset, z.byteLength).setUint32(z.length - 22 - 'synthetic archive comment'.length + 16, 1, true)
        expectRefusedBeforeSaving(await runImport(z, 'card.jpg', 'file'), 'jpg prefix and comment', sizeMessage('assets/a.bin', 200))
    })

    test('a zero-length assets/ entry is saved as an empty asset (compatibility guard)', async () => {
        const files: fflate.Zippable = { 'card.json': [enc.encode(v3Card), { level: 6 }], 'assets/': [new U8(0), { level: 0 }] }
        for (const a of ASSETS) files[a.name] = [a.data, { level: 6 }]
        const out = await runImport(fflate.zipSync(files), 'card.charx', 'file')
        expect(out.errors).toEqual([])
        expect(out.savedIds).toEqual([...assetIds, sha1(new U8(0))].sort())
    })

    test('a File whose central directory cannot be read is refused with that read error (new behaviour)', async () => {
        const z = await writerArchive(cardEntries(), 6)
        const f = fileOf(z, 'card.charx')
        const slice = f.slice.bind(f)
        // the tail read passes only a start; the central directory read passes an end as well
        f.slice = ((start?: number, end?: number, type?: string) => {
            if (end !== undefined) throw new DOMException('directory unreadable', 'NotReadableError')
            return slice(start, end, type)
        }) as File['slice']
        await importCharacterProcess({ name: 'card.charx', data: f })
        expect(h.errors).toEqual(['directory unreadable'])
        expect(h.saveCalls).toBe(0)
    })
})
