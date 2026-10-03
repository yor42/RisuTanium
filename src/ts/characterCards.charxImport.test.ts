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
        /** makes an AppendableBuffer.append fail for chunks this returns true for */
        appendFailWhen: null as ((data: Uint8Array) => boolean) | null,
        /** the tag (first four characters) of every chunk that begins an asset, as appended to an AppendableBuffer */
        appendTags: [] as string[],
        /** makes the ZIP parser report an error on its final push */
        finalPushError: false,
        /** makes the ZIP parser report an error through every started entry's data handler after each push */
        lateOndataError: false,
        /** makes the ZIP parser throw from every push after it has processed the data */
        latePushThrow: false,
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
    const { AppendableBuffer: Base } = await import('src/ts/byteBuffer')
    class AppendableBuffer extends Base {
        append(data: Uint8Array) {
            if (data.length >= 4 && data[0] === 0x41 && data[1] === 0x53 && data[2] === 0x53) {
                h.appendTags.push(String.fromCharCode(...data.subarray(0, 4)))
            }
            if (h.appendFailWhen?.(data)) {
                throw new RangeError('Array buffer allocation failed (simulated)')
            }
            super.append(data)
        }
    }
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
import { CharXImporter, CharXWriter, hasZipEndRecord, type CharXParseError } from 'src/ts/process/processzip'
import type { VirtualWriter } from 'src/ts/globalApi.svelte'
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

type Input = 'file' | 'chunked-file' | 'uint8array' | 'buffer' | 'stream'
type Outcome = {
    returned: number | null | undefined
    characters: Array<Record<string, unknown>>
    savedIds: string[]
    saveCalls: number
    errors: string[]
    log: string[]
    thrown: string | null
}

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
}

function dataFor(bytes: Uint8Array, name: string, input: Input): File | Uint8Array | ReadableStream<Uint8Array> {
    switch (input) {
        case 'file': return fileOf(bytes, name)
        case 'chunked-file': return chunkedFile(bytes, name)
        case 'uint8array': return new U8(bytes)
        case 'buffer': return Buffer.from(bytes)
        case 'stream': return chunkedStream(bytes, 997)
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

beforeEach(() => {
    reset()
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

    test('a failing asset save on a complete archive still surfaces through done(), not as an incomplete file', async () => {
        const bytes = await writerArchive(cardEntries(), 6)
        h.saveFail = 'storage full'
        const out = await runImport(bytes, 'card.charx', 'file')
        expect(out.thrown).toBe('Failed to save 3 assets')
        expect(out.errors).not.toContain(language.cardFileIncomplete)
        expect(out.characters).toEqual([])
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
        await downloadRisuHub('some-id')
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
        await downloadRisuHub('some-id')
        const fromRealm = describeOutcome(undefined, null)
        expect(fromRealm.errors).toEqual([])
        expect(fromRealm.characters).toEqual(fromFile.characters)
        expect(fromRealm.savedIds).toEqual(fromFile.savedIds)
    })

    test('a download cut inside an asset is refused with nothing saved', async () => {
        const z = await writerArchive(cardEntries(), 6)
        const e = entryOf(geometry(z), 'assets/b.bin')
        vi.stubGlobal('fetch', vi.fn(async () => realmResponse(z.subarray(0, e.dataStart + 100)).res))
        await downloadRisuHub('some-id')
        expect(h.saveCalls).toBe(0)
        expect(h.characters).toEqual([])
        expect(h.errors).toEqual([language.cardFileIncomplete])
    })

    test('a download whose body fails still ends in an error and imports nothing (compatibility guard)', async () => {
        const z = await writerArchive(cardEntries(), 6)
        const { res } = realmResponse(z, 'application/zip', true)
        vi.stubGlobal('fetch', vi.fn(async () => res))
        await downloadRisuHub('some-id')
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
