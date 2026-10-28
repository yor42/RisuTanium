/**
 * `.byaf` (Backyard archive) character import through `importCharacterFile` in `src/ts/characterCards.ts`.
 *
 * The real `characterCards.ts`, the real `processzip.ts` and the real fflate run against synthetic archives built here.
 * Everything the import reaches around them (the database, asset storage, alerts) is replaced by recorders, so each
 * test compares what was saved, which character came out and why a refusal was refused.
 *
 * Labels: a "reproducer" fails on the base commit, where a `.byaf` name reaches the png refusal (`importNotCardFile`)
 * and `CharXImporter` ignores a router argument. A "mutant control" fails on the base too and passes with and without
 * the mutant it names; it only pins the rest of the fixture. A "guard" passes before and after.
 */

import { createHash } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fflate from 'fflate'

//#region module mocks

const h = vi.hoisted(() => {
    return {
        saved: [] as Array<{ id: string, length: number }>,
        /** every whole-entry saveAsset call that began, including ones that later failed */
        saveCalls: 0,
        saveFail: null as string | null,
        /** whether the page store writes in pieces */
        pieces: false,
        pieceSaves: [] as Array<{ id: string, length: number }>,
        errors: [] as string[],
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
    alertError: vi.fn((msg: string | Error) => { h.errors.push(msg instanceof Error ? msg.message : String(msg)) }),
    alertInput: vi.fn(async () => ''),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    alertWait: vi.fn(),
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
        pieceStoreOrNull: vi.fn(async () => h.pieces ? {} : null),
        saveAssetFromPieces: vi.fn(async (queue: AsyncIterable<Uint8Array>) => {
            const parts: Buffer[] = []
            for await (const piece of queue) {
                parts.push(Buffer.from(piece))
            }
            const all = Buffer.concat(parts)
            const id = createHash('sha1').update(all).digest('hex')
            h.pieceSaves.push({ id, length: all.length })
            return id
        }),
        saveAsset: vi.fn(async (data: Uint8Array) => {
            h.saveCalls++
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
    readModule: vi.fn(async () => ({ lorebook: [], trigger: [], regex: [] })),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: vi.fn(async () => new Uint8Array()),
}))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
}))

//#endregion

import { importCharacterFile } from 'src/ts/characterCards'
import { charxLimits } from 'src/ts/process/processzip'
import { fflateZipArchive, type ZipEntry } from 'src/ts/process/tests/zipFixtures'
import { importSourceOfBytes, type ImportSource, type ImportSourceStat } from 'src/ts/importSource'
import type { ImportOutcome } from 'src/ts/importBatch'
import { language } from 'src/lang'
import { noteSelectedStore } from 'src/ts/storage/assetLimit'
import { createMemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'

// ---------------------------------------------------------------------------------------------
// Synthetic archives (no real images, no user data)
// ---------------------------------------------------------------------------------------------

const MIB = 1024 * 1024
const enc = new TextEncoder()
const sha1 = (data: Uint8Array) => createHash('sha1').update(data).digest('hex')

/** Deterministic bytes that start with a PNG signature. */
function png(n: number, seed: number): Uint8Array {
    const a = new Uint8Array(n)
    let x = seed
    for (let i = 0; i < n; i++) {
        x = (x * 1103515245 + 12345) & 0x7fffffff
        a[i] = (x >> 16) & 0xff
    }
    a.set([0x89, 0x50, 0x4e, 0x47], 0)
    return a
}

type Entry = [string, Uint8Array | string]
const OMIT = Symbol('omit')
const EMPTY = new Uint8Array(0)
const asBytes = (doc: unknown): Uint8Array => doc instanceof Uint8Array ? doc : enc.encode(typeof doc === 'string' ? doc : JSON.stringify(doc))

const AVATAR = png(2000, 1)
const SECOND = png(1500, 2)
const THIRD = png(1200, 3)
const FOURTH = png(1100, 4)
const CHAR_DIR = 'characters/c1/'
const KEY = (file: string) => CHAR_DIR + 'images/' + file

const defaultManifest = () => ({
    schemaVersion: 1,
    createdAt: '2025-06-12T19:03:56.873Z',
    author: { name: 'Ann Author', backyardURL: 'https://example.invalid/ann' },
    characters: [CHAR_DIR + 'character.json'],
    scenarios: ['scenarios/s1.json'],
})
const defaultCharacter = () => ({
    schemaVersion: 1,
    id: 'c1',
    name: 'Annie',
    displayName: 'Ann',
    isNSFW: true,
    persona: 'Persona of {character} for {user}',
    createdAt: '2025-06-12T19:03:56.873Z',
    updatedAt: '2025-06-13T19:03:56.873Z',
    loreItems: [{ key: 'cat, dog', value: 'Pets of {user}' }],
    images: [{ path: 'images/avatar.png', label: 'avatar' }],
})
const defaultScenario = () => ({
    schemaVersion: 1,
    title: 'Dropped title',
    narrative: 'Narrative of {user}',
    formattingInstructions: 'Format for {character}',
    exampleMessages: [{ characterID: 'c1', text: '#{user}: hi\n#{character}: hello' }],
    firstMessages: [{ characterID: 'c1', text: 'Hello {user}' }],
    temperature: 0.7,
})

type Parts = {
    manifest: unknown
    character: unknown
    scenario: unknown
    /** more scenario files by base name; the manifest must list them to use them */
    moreScenarios: Array<[string, unknown]>
    images: Entry[]
    /** unlisted entries between the images and the JSON */
    extra: Entry[]
}
const defaultParts = (): Parts => ({
    manifest: defaultManifest(),
    character: defaultCharacter(),
    scenario: defaultScenario(),
    moreScenarios: [],
    images: [[KEY('avatar.png'), AVATAR]],
    extra: [['backgrounds/bg.bin', png(5000, 7)], ['stray.txt', 'stray']],
})

/** The entries of a Backyard archive in the order the samples have: the manifest, then directories and images, then the JSON. */
function entries(over: Partial<Parts> = {}): Entry[] {
    const p = { ...defaultParts(), ...over }
    const out: Entry[] = []
    if (p.manifest !== OMIT) out.push(['manifest.json', asBytes(p.manifest)])
    out.push(['characters/', EMPTY], [CHAR_DIR, EMPTY], [CHAR_DIR + 'images/', EMPTY])
    out.push(...p.images, ...p.extra)
    if (p.character !== OMIT) out.push([CHAR_DIR + 'character.json', asBytes(p.character)])
    out.push(['scenarios/', EMPTY])
    if (p.scenario !== OMIT) out.push(['scenarios/s1.json', asBytes(p.scenario)])
    for (const [name, doc] of p.moreScenarios) out.push([`scenarios/${name}.json`, asBytes(doc)])
    return out
}

type Mode = 'stored' | 'deflate' | 'descriptor'
function zip(list: Entry[], mode: Mode = 'stored'): Uint8Array {
    if (mode === 'descriptor') {
        return fflateZipArchive(list.map(([key, data]): ZipEntry => [key, asBytes(data), 0]))
    }
    const files: fflate.Zippable = {}
    for (const [key, data] of list) {
        files[key] = [asBytes(data), { level: mode === 'deflate' ? 6 : 0 }]
    }
    return fflate.zipSync(files)
}

type Geometry = { entries: Array<{ name: string, header: number, dataStart: number, dataEnd: number }>, eocd: number }
function geometry(z: Uint8Array): Geometry {
    const dv = new DataView(z.buffer, z.byteOffset, z.byteLength)
    let eocd = -1
    for (let i = z.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
    const count = dv.getUint16(eocd + 10, true)
    let at = dv.getUint32(eocd + 16, true)
    const out: Geometry['entries'] = []
    for (let i = 0; i < count; i++) {
        const csize = dv.getUint32(at + 20, true)
        const nameLen = dv.getUint16(at + 28, true)
        const extraLen = dv.getUint16(at + 30, true)
        const commentLen = dv.getUint16(at + 32, true)
        const header = dv.getUint32(at + 42, true)
        const name = new TextDecoder().decode(z.subarray(at + 46, at + 46 + nameLen))
        const dataStart = header + 30 + dv.getUint16(header + 26, true) + dv.getUint16(header + 28, true)
        out.push({ name, header, dataStart, dataEnd: dataStart + csize })
        at += 46 + nameLen + extraLen + commentLen
    }
    return { entries: out, eocd }
}
const entryOf = (z: Uint8Array, name: string) => geometry(z).entries.find((e) => e.name === name)!

/** The end record states a directory one byte too large, so the directory is not trusted and every entry is still streamed. */
function untrusted(z: Uint8Array): Uint8Array {
    const c = z.slice()
    const { eocd } = geometry(c)
    const dv = new DataView(c.buffer, c.byteOffset, c.byteLength)
    dv.setUint32(eocd + 12, dv.getUint32(eocd + 12, true) + 1, true)
    return c
}

/** The local header of `name` declares `size` as its uncompressed size. */
function declareSize(z: Uint8Array, name: string, size: number): Uint8Array {
    const c = z.slice()
    new DataView(c.buffer, c.byteOffset, c.byteLength).setUint32(entryOf(z, name).header + 22, size, true)
    return c
}

/** Every occurrence of the name bytes `from` (local header and central record) becomes `to`, which has the same length. */
function renameKey(z: Uint8Array, from: string, to: string): Uint8Array {
    const c = z.slice()
    const a = enc.encode(from)
    const b = enc.encode(to)
    for (let i = 0; i + a.length <= c.length; i++) {
        if (a.every((byte, j) => c[i + j] === byte)) c.set(b, i)
    }
    return c
}

/** The UTF-8 name flag is cleared for `name`, so a reader takes its bytes as Latin-1. */
function clearUtf8Flag(z: Uint8Array, name: string): Uint8Array {
    const c = z.slice()
    const a = enc.encode(name)
    for (let i = 46; i + a.length <= c.length; i++) {
        if (!a.every((byte, j) => c[i + j] === byte)) continue
        if (c[i - 30] === 0x50 && c[i - 29] === 0x4b && c[i - 28] === 3 && c[i - 27] === 4) c[i - 30 + 7] &= ~0x08
        if (c[i - 46] === 0x50 && c[i - 45] === 0x4b && c[i - 44] === 1 && c[i - 43] === 2) c[i - 46 + 9] &= ~0x08
    }
    return c
}

// ---------------------------------------------------------------------------------------------
// Running an import
// ---------------------------------------------------------------------------------------------

type Input = 'uint8array' | 'file' | 'stream' | 'source'
const defaultLimits = { ...charxLimits }

function fileOf(bytes: Uint8Array, name: string) {
    return new File([new Uint8Array(bytes)], name, { type: 'application/zip' })
}

function dataFor(bytes: Uint8Array, name: string, input: Input): File | Uint8Array | ImportSource | ReadableStream<Uint8Array> {
    switch (input) {
        case 'file': return fileOf(bytes, name)
        case 'uint8array': return new Uint8Array(bytes)
        case 'source': return importSourceOfBytes(name, bytes)
        case 'stream': return fileOf(bytes, name).stream()
    }
}

async function runImport(bytes: Uint8Array, name = 'card.byaf', input: Input = 'uint8array'): Promise<ImportOutcome> {
    return await importCharacterFile({ name, data: dataFor(bytes, name, input) })
}

const refusedWith = (reason: string): ImportOutcome => ({ kind: 'refused', reason })
const tooLarge = (key: string, limitBytes: number) => language.cardFileEntryTooLarge(key, Math.round(limitBytes / MIB))

/** The character the default archive imports to. */
function expectDefaultCharacter(character: Record<string, unknown>) {
    expect(character).toMatchObject({
        name: 'Ann',
        nickname: 'Annie',
        desc: 'Persona of {{char}} for {{user}}',
        scenario: 'Narrative of {{user}}',
        systemPrompt: 'Format for {{char}}',
        firstMessage: 'Hello {{user}}',
        exampleMessage: '<START>\n{{user}}: hi\n{{char}}: hello',
        tags: ['nsfw'],
        creator: 'Ann Author',
        creatorNotes: 'https://example.invalid/ann',
        creation_date: 1749755036,
        modification_date: 1749841436,
        image: sha1(AVATAR),
    })
    expect(character.globalLore).toMatchObject([{ key: 'cat, dog', comment: 'cat, dog', content: 'Pets of {{user}}', alwaysActive: false }])
}

beforeAll(() => {
    // The production safeStructuredClone returns undefined for undefined; the setup stub is a JSON round trip.
    globalThis.safeStructuredClone = structuredClone
})

beforeEach(() => {
    h.saved = []
    h.saveCalls = 0
    h.saveFail = null
    h.pieces = false
    h.pieceSaves = []
    h.errors = []
    h.characters = []
    h.uuid = 0
    globalThis.safeStructuredClone = structuredClone
    noteSelectedStore('opfs-transitional', createMemoryByteStore())
    Object.assign(charxLimits, defaultLimits)
})

// ---------------------------------------------------------------------------------------------
// R1 to R3: a good archive
// ---------------------------------------------------------------------------------------------

describe('byaf import of a good archive', () => {
    test('R1 reproducer: one character, one scenario and one avatar import with every mapped field; only the avatar is saved', async () => {
        const out = await runImport(zip(entries()))
        expect(out.kind).toBe('imported')
        expect(h.characters.length).toBe(1)
        expectDefaultCharacter(h.characters[0])
        expect(h.saved.map((s) => s.id)).toEqual([sha1(AVATAR)])
        expect(h.saveCalls).toBe(1)
    })

    const variants: Array<[string, Mode, Input]> = [
        ['stored File', 'stored', 'file'],
        ['stored ImportSource', 'stored', 'source'],
        ['stored ReadableStream', 'stored', 'stream'],
        ['deflate level 6 bytes', 'deflate', 'uint8array'],
        ['descriptor framing bytes', 'descriptor', 'uint8array'],
        ['descriptor framing File', 'descriptor', 'file'],
    ]
    test.each(variants)('R2 reproducer: the same character from %s', async (_label, mode, input) => {
        const out = await runImport(zip(entries(), mode), 'card.byaf', input)
        expect(out.kind).toBe('imported')
        expect(h.characters.length).toBe(1)
        expectDefaultCharacter(h.characters[0])
        expect(h.saved.map((s) => s.id)).toEqual([sha1(AVATAR)])
    })

    test('R3 reproducer: the first image is the avatar; the others are icon assets named by their label, empty for main or empty labels', async () => {
        const character = {
            ...defaultCharacter(),
            images: [
                { path: 'images/avatar.png', label: 'avatar' },
                { path: 'images/second.png', label: 'Smile' },
                { path: 'images/third.png', label: 'main' },
                { path: 'images/fourth.png', label: '' },
            ],
        }
        const images: Entry[] = [[KEY('avatar.png'), AVATAR], [KEY('second.png'), SECOND], [KEY('third.png'), THIRD], [KEY('fourth.png'), FOURTH]]
        const out = await runImport(zip(entries({ character, images })))
        expect(out.kind).toBe('imported')
        expect(h.characters[0].image).toBe(sha1(AVATAR))
        expect(h.characters[0].ccAssets).toEqual([
            { type: 'icon', uri: sha1(SECOND), name: 'Smile', ext: 'png' },
            { type: 'icon', uri: sha1(THIRD), name: '', ext: 'png' },
            { type: 'icon', uri: sha1(FOURTH), name: '', ext: 'png' },
        ])
        expect(h.saved.map((s) => s.id).sort()).toEqual([AVATAR, SECOND, THIRD, FOURTH].map(sha1).sort())
    })
})

// ---------------------------------------------------------------------------------------------
// R4, R4b: refusals save nothing
// ---------------------------------------------------------------------------------------------

describe('byaf refusals save nothing even though the images precede the JSON', () => {
    const over = (patch: Partial<Parts>) => zip(entries(patch))
    const withScenario = (n: number) => ({ ...defaultManifest(), scenarios: ['scenarios/s1.json', 'scenarios/s2.json'].slice(0, n) })
    const rows: Array<[string, () => Uint8Array, () => string]> = [
        ['no zip end record', () => { const z = zip(entries()); return z.subarray(0, z.length - 30) }, () => language.cardFileIncomplete],
        ['manifest missing', () => over({ manifest: OMIT }), () => language.errors.noData],
        ['manifest not JSON', () => over({ manifest: 'not json {' }), () => language.errors.noData],
        ['manifest an array', () => over({ manifest: [1, 2] }), () => language.errors.noData],
        ['manifest schemaVersion 2', () => over({ manifest: { ...defaultManifest(), schemaVersion: 2 } }), () => language.byafUnsupportedVersion],
        ['character schemaVersion 2', () => over({ character: { ...defaultCharacter(), schemaVersion: 2 } }), () => language.byafUnsupportedVersion],
        ['first scenario schemaVersion 2', () => over({ scenario: { ...defaultScenario(), schemaVersion: 2 } }), () => language.byafUnsupportedVersion],
        ['later scenario schemaVersion 2', () => over({ manifest: withScenario(2), moreScenarios: [['s2', { ...defaultScenario(), schemaVersion: 2 }]] }), () => language.byafUnsupportedVersion],
        ['two characters', () => over({ manifest: { ...defaultManifest(), characters: [CHAR_DIR + 'character.json', 'characters/c2/character.json'] } }), () => language.byafSeveralCharacters],
        ['both names blank', () => over({ character: { ...defaultCharacter(), name: ' ', displayName: '' } }), () => language.errors.noData],
        ['first scenario missing', () => over({ scenario: OMIT }), () => language.errors.noData],
        ['first scenario not JSON', () => over({ scenario: 'garbage' }), () => language.errors.noData],
    ]
    test.each(rows)('R4 reproducer: %s', async (_label, build, reason) => {
        const out = await runImport(build())
        expect(out).toEqual(refusedWith(reason()))
        expect(h.characters.length).toBe(0)
        expect(h.saveCalls).toBe(0)
    })

    test('R4 reproducer: a JSON entry over the lowered metadata limit refuses, listed or not (an unlisted scenarios/x.json too)', async () => {
        charxLimits.metadataBytes = 4096
        const out = await runImport(zip(entries({ moreScenarios: [['x', 'x'.repeat(8192)]] })))
        expect(out).toEqual(refusedWith(tooLarge('scenarios/x.json', 4096)))
        expect(h.characters.length).toBe(0)
        expect(h.saveCalls).toBe(0)
    })

    test('R4 reproducer: a corrupt deflate stream in the JSON refuses as incomplete and saves nothing', async () => {
        const z = zip(entries(), 'deflate')
        const c = z.slice()
        c[entryOf(z, 'scenarios/s1.json').dataStart] |= 0x06
        const out = await runImport(c)
        expect(out).toEqual(refusedWith(language.cardFileIncomplete))
        expect(h.characters.length).toBe(0)
        expect(h.saveCalls).toBe(0)
    })

    // Several defects at once: every version check is decided before the count and the names.
    const twoCharacters = { ...defaultManifest(), characters: [CHAR_DIR + 'character.json', 'characters/c2/character.json'] }
    const multi: Array<[string, () => Uint8Array, () => string]> = [
        ['both names blank plus a wrong-version scenario', () => over({ character: { ...defaultCharacter(), name: '', displayName: '' }, scenario: { ...defaultScenario(), schemaVersion: 2 } }), () => language.byafUnsupportedVersion],
        ['two characters plus a wrong-version scenario', () => over({ manifest: twoCharacters, scenario: { ...defaultScenario(), schemaVersion: 2 } }), () => language.byafUnsupportedVersion],
        ['two characters plus an absent first character file', () => over({ manifest: twoCharacters, character: OMIT }), () => language.errors.noData],
        ['first scenario absent plus a wrong-version later scenario', () => over({ manifest: withScenario(2), scenario: OMIT, moreScenarios: [['s2', { ...defaultScenario(), schemaVersion: 2 }]] }), () => language.byafUnsupportedVersion],
        ['two valid characters', () => over({ manifest: twoCharacters }), () => language.byafSeveralCharacters],
    ]
    test.each(multi)('R4b reproducer: %s', async (_label, build, reason) => {
        const out = await runImport(build())
        expect(out).toEqual(refusedWith(reason()))
        expect(h.characters.length).toBe(0)
        expect(h.saveCalls).toBe(0)
    })

    test('R4b mutant control for M8 (fails on the base, passes with and without M8): a later scenario that is missing or garbled is skipped and the import goes through', async () => {
        const manifest = { ...defaultManifest(), scenarios: ['scenarios/s1.json', 'scenarios/missing.json', 'scenarios/s3.json'] }
        const out = await runImport(zip(entries({ manifest, moreScenarios: [['s3', 'garbled {']] })))
        expect(out.kind).toBe('imported')
        expect(h.characters.length).toBe(1)
        expectDefaultCharacter(h.characters[0])
    })
})

// ---------------------------------------------------------------------------------------------
// R5, R9: totality, skip rules and placeholders
// ---------------------------------------------------------------------------------------------

describe('byaf skip rules and text conversion', () => {
    test('R5 reproducer: unsafe, unsupported and missing image paths are skipped; the next usable image is the avatar', async () => {
        const character = {
            ...defaultCharacter(),
            images: [
                { path: '../x.png', label: 'up' },
                { path: '/x.png', label: 'abs' },
                { path: 'a\\b.png', label: 'backslash' },
                { path: 'images/x.bmp', label: 'bmp' },
                { path: 'images/missing.png', label: 'missing' },
                { path: 'images/second.png', label: 'Second' },
            ],
        }
        const images: Entry[] = [['characters/x.png', png(900, 9)], [KEY('x.bmp'), png(900, 10)], [KEY('second.png'), SECOND]]
        const out = await runImport(zip(entries({ character, images })))
        expect(out.kind).toBe('imported')
        expect(h.characters[0].image).toBe(sha1(SECOND))
        expect(h.characters[0].ccAssets).toEqual([])
        expect(h.saved.map((s) => s.id)).toEqual([sha1(SECOND)])
    })

    test('R5 reproducer: a listed image whose entry name is not flagged UTF-8 is skipped as missing', async () => {
        const name = 'café.png'
        const character = {
            ...defaultCharacter(),
            images: [{ path: 'images/' + name, label: 'cafe' }, { path: 'images/avatar.png', label: 'avatar' }],
        }
        const images: Entry[] = [[KEY(name), SECOND], [KEY('avatar.png'), AVATAR]]
        const out = await runImport(clearUtf8Flag(zip(entries({ character, images })), KEY(name)))
        expect(out.kind).toBe('imported')
        expect(h.characters[0].image).toBe(sha1(AVATAR))
        expect(h.saved.map((s) => s.id)).toEqual([sha1(AVATAR)])
    })

    test('R5 reproducer: non-string fields become empty strings and a name is enough', async () => {
        const character = {
            ...defaultCharacter(),
            persona: 12,
            loreItems: [{ key: 5, value: 'v' }, 'junk', null],
            images: [{ path: 'images/avatar.png', label: 'avatar' }, { path: 'images/second.png', label: 9 }],
        }
        const images: Entry[] = [[KEY('avatar.png'), AVATAR], [KEY('second.png'), SECOND]]
        const scenario = { schemaVersion: 1, narrative: 3, firstMessages: [{ text: 4 }] }
        const out = await runImport(zip(entries({ character, scenario, images })))
        expect(out.kind).toBe('imported')
        expect(h.characters[0]).toMatchObject({ name: 'Ann', desc: '', scenario: '', firstMessage: '', exampleMessage: '' })
        expect(h.characters[0].globalLore).toMatchObject([{ key: '', content: 'v' }])
        expect(h.characters[0].ccAssets).toMatchObject([{ name: '' }])
    })

    test('R9 reproducer: names are kept as given, untrimmed; lore comment stays the raw key', async () => {
        const character = { ...defaultCharacter(), displayName: ' Ann ', name: '{user}', loreItems: [{ key: ' {user}, x ', value: 'v' }] }
        const out = await runImport(zip(entries({ character })))
        expect(out.kind).toBe('imported')
        expect(h.characters[0]).toMatchObject({ name: ' Ann ', nickname: '{user}' })
        expect(h.characters[0].globalLore).toMatchObject([{ key: '{{user}}, x', comment: ' {user}, x ' }])
    })
})

// ---------------------------------------------------------------------------------------------
// R6, R7, R8: save failure, names, pieces
// ---------------------------------------------------------------------------------------------

describe('byaf names, failures and the piece path', () => {
    test('R6 reproducer: an asset save failure in the second pass fails the import and adds no character', async () => {
        h.saveFail = 'disk full'
        const out = await runImport(zip(entries()))
        expect(out.kind).toBe('failed')
        expect(h.characters.length).toBe(0)
    })

    test('R7 reproducer: an upper-case .BYAF name imports', async () => {
        const out = await runImport(zip(entries()), 'X.BYAF')
        expect(out.kind).toBe('imported')
        expect(h.characters.length).toBe(1)
    })

    test('R7 reproducer: a .byaf name without its end record refuses as incomplete', async () => {
        const z = zip(entries())
        const out = await runImport(z.subarray(0, z.length - 30), 'x.byaf')
        expect(out).toEqual(refusedWith(language.cardFileIncomplete))
    })

    test('R7 guard (passes before and after): x.byaf.json stays a JSON card', async () => {
        const json = JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Json Name', description: 'd', first_mes: 'hi', character_version: '', extensions: {} } })
        const out = await runImport(enc.encode(json), 'x.byaf.json')
        expect(out.kind).toBe('imported')
        expect(h.characters[0]).toMatchObject({ name: 'Json Name' })
    })

    test('R7 guard (passes before and after): x.byaf.yaml is never read as an archive', async () => {
        const out = await runImport(zip(entries()), 'x.byaf.yaml')
        expect(out.kind).not.toBe('imported')
        expect(h.saveCalls).toBe(0)
        expect(h.characters.length).toBe(0)
    })

    test('R8 reproducer: a listed image past the streaming threshold is saved in pieces, not as a whole entry', async () => {
        h.pieces = true
        charxLimits.streamAfterBytes = 1 * MIB
        const big = png(5 * MIB, 11)
        const out = await runImport(zip(entries({ images: [[KEY('avatar.png'), big]] })))
        expect(out.kind).toBe('imported')
        expect(h.characters[0].image).toBe(sha1(big))
        expect(h.pieceSaves).toEqual([{ id: sha1(big), length: big.length }])
        expect(h.saveCalls).toBe(0)
    })
})

// ---------------------------------------------------------------------------------------------
// R10 to R15: sizes
// ---------------------------------------------------------------------------------------------

describe('byaf size rules', () => {
    const LIMIT = 2 * MIB
    const FILLER: Entry = ['backgrounds/filler.bin', png(Math.round(1.5 * MIB), 5)]
    const BIG = png(3 * MIB, 6)
    const twoImages = () => ({
        character: { ...defaultCharacter(), images: [{ path: 'images/a.png', label: 'a' }, { path: 'images/b.png', label: 'b' }] },
    })
    const A = png(1000, 12)
    const B_KEY = KEY('b.png')

    test('R10 reproducer: an unlisted entry above the asset limit does not refuse and is never saved', async () => {
        charxLimits.assetBytes = LIMIT
        const extra: Entry[] = [['backgrounds/bg.bin', png(3 * MIB, 7)], ['stray.bin', png(3 * MIB, 8)]]
        const out = await runImport(zip(entries({ extra })))
        expect(out.kind).toBe('imported')
        expect(h.saved.map((s) => s.id)).toEqual([sha1(AVATAR)])
        expect(h.saveCalls).toBe(1)
    })

    // Layout: a small listed image, an unlisted filler, the oversize listed image, then the JSON. The filler puts the
    // oversize header in a later read than the end of the first image, so a refusal that came only from the second
    // pass would already have started saving the first image.
    const oversizeLayout = (b: Uint8Array = BIG): Parameters<typeof entries>[0] => ({
        ...twoImages(),
        images: [[KEY('a.png'), A]],
        extra: [FILLER, [B_KEY, b]],
    })

    // A descriptor-framed entry declares size 0 in its local header. With a valid central directory the importer reads it with the central sizes written in, so pass 1 also records the central size; with an untrusted directory the decoded length is the only size pass 1 has for it.
    const descriptorLayout = () => zip(entries({ ...twoImages(), images: [[KEY('a.png'), A], [B_KEY, BIG]], extra: [] }), 'descriptor')

    test.each(['untrusted directory', 'untrusted descriptor framing'] as const)('R11 reproducer: an oversize listed image is refused before anything is saved (%s)', async (variant) => {
        charxLimits.assetBytes = LIMIT
        const bytes = variant === 'untrusted directory' ? untrusted(zip(entries(oversizeLayout()))) : untrusted(descriptorLayout())
        const out = await runImport(bytes)
        expect(out).toEqual(refusedWith(tooLarge(B_KEY, LIMIT)))
        expect(h.characters.length).toBe(0)
        expect(h.saveCalls).toBe(0)
    })

    test('R11 mutant control (fails on the base, passes with and without the glue check): the descriptor-framed archive with a trusted directory is refused with nothing saved', async () => {
        charxLimits.assetBytes = LIMIT
        const out = await runImport(descriptorLayout())
        expect(out).toEqual(refusedWith(tooLarge(B_KEY, LIMIT)))
        expect(h.characters.length).toBe(0)
        expect(h.saveCalls).toBe(0)
    })

    test('R12 reproducer: the same oversize listed image with a trusted directory is refused with nothing saved', async () => {
        charxLimits.assetBytes = LIMIT
        const out = await runImport(zip(entries(oversizeLayout())))
        expect(out).toEqual(refusedWith(tooLarge(B_KEY, LIMIT)))
        expect(h.characters.length).toBe(0)
        expect(h.saveCalls).toBe(0)
    })

    test.each(['untrusted directory', 'trusted directory'] as const)('R14 reproducer: a local header declaring more than the limit refuses before anything is saved (%s)', async (variant) => {
        charxLimits.assetBytes = LIMIT
        const small = png(1000, 13)
        const z = declareSize(zip(entries(oversizeLayout(small))), B_KEY, 3 * MIB)
        const out = await runImport(variant === 'untrusted directory' ? untrusted(z) : z)
        expect(out).toEqual(refusedWith(tooLarge(B_KEY, LIMIT)))
        expect(h.characters.length).toBe(0)
        expect(h.saveCalls).toBe(0)
    })

    // The oversize copy comes first; the second copy of the name is small.
    const duplicateLayout = () => {
        const parts = oversizeLayout()
        parts.extra = [FILLER, [B_KEY, BIG], [KEY('B.png'), png(1000, 14)]]
        return renameKey(zip(entries(parts)), KEY('B.png'), B_KEY)
    }
    test('R15 reproducer: a name that appears twice with the oversize copy first refuses before anything is saved (untrusted directory)', async () => {
        charxLimits.assetBytes = LIMIT
        const out = await runImport(untrusted(duplicateLayout()))
        expect(out).toEqual(refusedWith(tooLarge(B_KEY, LIMIT)))
        expect(h.characters.length).toBe(0)
        expect(h.saveCalls).toBe(0)
    })

    test('R15 mutant control for M7 (fails on the base, passes with and without M7): the same archive with a trusted directory is refused before any chunk is read', async () => {
        charxLimits.assetBytes = LIMIT
        const out = await runImport(duplicateLayout())
        expect(out).toEqual(refusedWith(tooLarge(B_KEY, LIMIT)))
        expect(h.characters.length).toBe(0)
        expect(h.saveCalls).toBe(0)
    })
})

// ---------------------------------------------------------------------------------------------
// R13: the source changing while the import runs
// ---------------------------------------------------------------------------------------------

describe('byaf import of a source that changes', () => {
    /** An ImportSource whose n-th stat() call answers `answers[n]` (a throw when it is an Error); later calls repeat the first answer. */
    function changingSource(bytes: Uint8Array, answers: Array<ImportSourceStat | Error>): ImportSource & { stats: number } {
        const inner = importSourceOfBytes('card.byaf', bytes)
        const source = {
            ...inner,
            stats: 0,
            async stat(): Promise<ImportSourceStat> {
                const answer = answers[Math.min(source.stats, answers.length - 1)]
                source.stats++
                if (answer instanceof Error) throw answer
                return answer
            },
        }
        return source
    }
    const bytes = zip(entries())
    const same: ImportSourceStat = { size: bytes.length, modified: 1000 }
    const run = (answers: Array<ImportSourceStat | Error>) => importCharacterFile({ name: 'card.byaf', data: changingSource(bytes, answers) })

    test.each([
        ['the first stat disagrees with the opened size', [{ size: bytes.length + 1, modified: 1000 }]],
        ['the second stat reports another size', [same, { size: bytes.length + 5, modified: 1000 }, same]],
        ['the second stat reports another modification time', [same, { size: bytes.length, modified: 2000 }, same]],
        ['the second stat throws', [same, new Error('gone'), same]],
    ] as Array<[string, Array<ImportSourceStat | Error>]>)('R13 reproducer: %s', async (_label, answers) => {
        const out = await run(answers)
        expect(out).toEqual(refusedWith(language.cardFileChanged))
        expect(h.saveCalls).toBe(0)
        expect(h.characters.length).toBe(0)
    })

    test('R13 reproducer: a change found after the saves builds no character', async () => {
        const out = await run([same, same, { size: bytes.length, modified: 3000 }])
        expect(out).toEqual(refusedWith(language.cardFileChanged))
        expect(h.characters.length).toBe(0)
    })

    test('R13 mutant control (fails on the base): an unchanged source imports', async () => {
        const out = await run([same])
        expect(out.kind).toBe('imported')
        expect(h.characters.length).toBe(1)
    })
})
