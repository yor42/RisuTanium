// @vitest-environment node
/**
 * The streamed `.bin` import of a store2 page (`commitStore2Import` with `stream`): the database entry is read in bounded
 * chunks, uploads interleave with those reads, the main thread yields per character, and an import that plans more than
 * the bulk threshold lands the same tree and the same commit key as the whole path. Runs over the real library,
 * committer and memory backend; the page, the alerts and the file are doubles. A pass says nothing about a device or a
 * real file.
 *
 * Labels: regression (red on the S1-C head, where `stream` is ignored), new behaviour (the streamed path), guard (the
 * outcome of the whole path, which the streamed path must reproduce or leave alone), diagnostic.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const busyBox = vi.hoisted(() => ({ busy: false }))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
        }),
    },
}))

vi.mock(
    import('src/ts/globalApi.svelte'),
    () =>
        ({
            forageStorage: {
                keys: vi.fn(async () => []),
                getItem: vi.fn(async () => null),
                setItem: vi.fn(async () => { }),
                removeItem: vi.fn(async () => { }),
            },
            getSaveMarkCount: () => 0,
            isSaveClean: () => true,
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})

vi.mock(
    import('src/ts/storage/database.svelte'),
    () =>
        ({
            getDatabase: vi.fn(() => ({})),
            presetTemplate: { name: 'test-preset' },
        }) as unknown as typeof import('src/ts/storage/database.svelte'),
)

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: true,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

vi.mock('src/ts/alert', () => ({
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertNormalWait: vi.fn(async () => { }),
    alertWait: vi.fn(),
    alertStore: { set: vi.fn(), subscribe: vi.fn() },
}))

const inert = vi.hoisted(() => (): Record<string, unknown> => new Proxy({}, {
    has: () => true,
    get: (_target, name) => name === 'then' ? undefined : (name === 'alertStore' ? {} : () => undefined),
}))
vi.mock('src/ts/process/coldstorage.svelte', inert)
vi.mock('src/ts/drive/restoreReplace', inert)
vi.mock('src/ts/drive/backupWorkGuard', () => ({ refuseBackupLoadWhileBusy: () => busyBox.busy }))
vi.mock('src/ts/storage/store2/saveActive', () => ({ getActiveStore2Save: () => null }))

import { gunzipSync, gzipSync, zlibSync } from 'fflate'
import * as risuSave from 'src/ts/storage/risuSave'
import { encodeRisuSaveCompressionStream, encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { alertConfirm, alertError, alertStore } from 'src/ts/alert'
import { indexBackupEntries, type BackupIndexEntry, type BinFile, type BinSlice } from 'src/ts/drive/backupContainer'
import { binFileOfSource } from 'src/ts/drive/binFileSource'
import type { ImportSource as FileSource } from 'src/ts/importSource'
import { language } from 'src/lang'
import { createMemoryBackend, Store2BackendFailureError, type Store2Backend } from 'src/ts/storage/store2/backend'
import type { MemoryBackend } from 'src/ts/storage/store2/backend/memory'
import { readBaseContentIndex } from 'src/ts/storage/store2/baseContent'
import { assembleDatabase, bucketOfKey, unitDigest } from 'src/ts/storage/store2/codec'
import { toPlainJson } from 'src/ts/storage/store2/codec/normalize'
import { IMPORT_REPLACES_BASE, Store2BulkAbortError, type CommitRequest } from 'src/ts/storage/store2/commit'
import { firstCommitKey } from 'src/ts/storage/store2/commitKey'
import { clearAbandonedMarker } from 'src/ts/storage/store2/abandonedMarker'
import { gcPass } from 'src/ts/storage/store2/gc/pass'
import {
    decodeFrame, encodeUnit, readUnit, refOfFrame, REQ_MODULE_BUCKETS, UNIT_TYPE, type Manifest,
} from 'src/ts/storage/store2/format'
import { LegacyListBuilder } from 'src/ts/storage/store2/lists/legacyList'
import { BinFileChangedError } from 'src/ts/storage/store2/legacy/binReader'
import { LegacyReadError } from 'src/ts/storage/store2/legacy/resolve'
import {
    commitImportStreamed, prepareImportStream, streamedImportUnits, type StreamCommitRequest, type StreamPrepared,
} from 'src/ts/storage/store2/legacy/importStream'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
import { createKeyMint, type StreamContext } from 'src/ts/storage/store2/commit'
import type { UnitWrite } from 'src/ts/storage/store2/backend/types'
import { seededEnv } from 'src/ts/storage/tests/store2/codecFixtures'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ColdUnitRead } from 'src/ts/storage/store2/legacy/storeReader'
import { CodecError } from 'src/ts/storage/store2/codec/types'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { coldStorageHeader } from 'src/ts/process/coldstorageData'
import type { BusyHandle } from 'src/ts/process/memory/busyActions'
import {
    commitStore2Import, createBinImportReader, readBinDatabaseOmitted, readBinDatabaseTree, scanBinForImport, type Store2ImportEnd,
} from '../storeImport'
import {
    buildTree, committerOf, createClock, expectInvariant, hooked, parsedCommit, plantKey, seedStore, testEnv, treeUnitCount, type Hooks, type TestClock,
} from 'src/ts/storage/tests/store2/commitFixtures'
import { buildLibrary } from '../../../../Agents/Tools/save-gen/c806-library.mjs'

// msgpackr 1.10.1 calls `Buffer.prototype.utf8Write(string, position, 0xffffffff)` for a longer string, and the Node
// running this test rejects a length past the buffer's end. Clamping the length to the room left changes no byte
// written; it only lets the real encoder run here.
interface Utf8Writer {
    utf8Write(this: Uint8Array, text: string, position: number, length: number): number
}
const utf8WriterProto = Buffer.prototype as unknown as Utf8Writer
const nativeUtf8Write = utf8WriterProto.utf8Write
utf8WriterProto.utf8Write = function (text, position, length) {
    return nativeUtf8Write.call(this, text, position, Math.min(length, this.length - position))
}

const NOW = 1_700_000_100_000

beforeEach(() => {
    busyBox.busy = false
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    // A placeholder character's message carries the clock; the arms of a comparison must read the same one.
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    vi.mocked(alertConfirm).mockReset()
    vi.mocked(alertConfirm).mockImplementation(async () => true)
    vi.mocked(alertError).mockReset()
    vi.mocked(alertStore.set).mockReset()
})

afterEach(() => {
    vi.restoreAllMocks()
})

// ---- fixtures ----

const MIB = 1024 * 1024
const ENTRY_NAME = 'database.risudat'
const T = 1_700_000_000_000
const encoder = new TextEncoder()

function concat(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

function u32le(n: number): Uint8Array {
    const out = new Uint8Array(4)
    new DataView(out.buffer).setUint32(0, n, true)
    return out
}

/** One `[nameLength][name][dataLength][data]` entry of the container `LoadLocalBackup` reads. */
function chunk(name: string, data: Uint8Array): Uint8Array {
    const nameBytes = encoder.encode(name)
    return concat(u32le(nameBytes.length), nameBytes, u32le(data.length), data)
}

function coldEntry(id: string, value: unknown): Uint8Array {
    return chunk(`coldstorage_${id}.json`, encoder.encode(JSON.stringify(value)))
}

/** Text that gzip cannot shrink much: base64 of a seeded byte stream. */
function entropyText(chars: number, seed: number): string {
    let state = seed >>> 0
    const bytes = new Uint8Array(Math.ceil(chars * 3 / 4))
    for (let i = 0; i < bytes.length; i++) {
        state = (state + 0x6D2B79F5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        bytes[i] = ((t ^ (t >>> 14)) >>> 0) & 0xFF
    }
    return Buffer.from(bytes).toString('base64').slice(0, chars)
}

type Obj = Record<string, unknown>
type Library = { characters: Obj[] } & Obj

/** A small synthetic library of `count` characters, each with `entropyChars` of incompressible description. */
function library(count: number, entropyChars = 0): Library {
    const db = buildLibrary({ seed: 7, characters: count, chatsPerCharacter: 2, messagesPerChat: 2, modules: 0, archiveCharacters: false, nonChatScale: 0.02 }) as Library
    if (entropyChars > 0) {
        db.characters.forEach((character, index) => {
            character.desc = entropyText(entropyChars, 1000 + index)
        })
    }
    return db
}

const plainChat = (id: string, text: string): Obj => ({ id, message: [{ time: T, data: text, role: 'char' }], note: '', name: '', localLore: [] })

/** The character `makeColdDataForCharacter` leaves behind; its unit `unit` holds the archived character. */
function stubCharacter(chaId: string, unit: string, extra: Obj = {}): Obj {
    return {
        type: 'character', chaId, name: `Stub ${chaId}`, chatPage: 0, firstMsgIndex: 0, coldstorage: unit, coldStoragedChats: [],
        chats: [{ message: [{ time: T, data: '', role: 'char' }], note: '', name: '', localLore: [] }], ...extra,
    }
}

const stubUnit = (chaId: string): unknown => ({ character: { chaId, name: `Stub ${chaId}`, type: 'character', chatPage: 0, chats: [plainChat(`${chaId}-chat`, 'archived hello')] } })

/** A character whose second chat is a pointer to a unit (`coldStorageHeader` + id), as upstream leaves it. */
const pointerCharacter = (chaId: string, unit: string): Obj => ({
    type: 'character', chaId, name: `Pointer ${chaId}`, chatPage: 0,
    chats: [plainChat(`${chaId}-a`, 'inline'), { message: [{ time: T, data: coldStorageHeader + unit, role: 'char' }], note: '', name: '', localLore: [] }],
})

type MsgpackKind = 'compressed' | 'raw' | 'stream'

async function msgpackEntry(db: unknown, kind: MsgpackKind): Promise<Uint8Array> {
    if (kind === 'stream') {
        return await encodeRisuSaveCompressionStream(db)
    }
    return encodeRisuSaveLegacy(db, kind === 'compressed' ? 'compression' : 'noCompression')
}

const V0 = { config: 0, root: 1, preset: 4, modules: 5, character: 7, plugins: 9, loadouts: 10, pluginStorage: 11 } as const

/** One block as upstream's `encodeRawBlock` frames it; a `Uint8Array` value is the payload as it is. */
function v0Block(type: number, name: string, value: unknown, gzip: boolean): Uint8Array {
    const nameBytes = encoder.encode(name)
    const raw = value instanceof Uint8Array ? value : encoder.encode(JSON.stringify(value))
    const data = gzip && !(value instanceof Uint8Array) ? gzipSync(raw, { mtime: 0 }) : raw
    return concat(Uint8Array.of(type, gzip ? 1 : 0, nameBytes.length), nameBytes, u32le(data.length), data)
}

/** A v0 block-format database: header, a block per character and one per list, then the root block naming every block. */
function v0Database(db: Library, damaged: ReadonlySet<string> = new Set()): Uint8Array {
    const blocks: Array<{ type: number, name: string, value: unknown }> = db.characters.map((character) => ({
        type: V0.character, name: String(character.chaId), value: damaged.has(String(character.chaId)) ? Uint8Array.of(1, 2, 3, 4) : character,
    }))
    blocks.push(
        { type: V0.preset, name: 'preset', value: db.botPresets },
        { type: V0.modules, name: 'modules', value: [] },
        { type: V0.loadouts, name: 'loadouts', value: [] },
        { type: V0.plugins, name: 'plugins', value: [] },
        { type: V0.pluginStorage, name: 'pluginStorage', value: db.pluginCustomStorage ?? {} },
        { type: V0.config, name: 'config', value: {} },
    )
    return concat(
        encoder.encode('RISUSAVE\0'),
        ...blocks.map((block) => v0Block(block.type, block.name, block.value, true)),
        v0Block(V0.root, 'root', { characterOrder: [], personas: [], __directory: blocks.map((block) => block.name) }, false),
    )
}

type Event =
    | { kind: 'slice', start: number, end: number }
    | { kind: 'yield' }
    | { kind: 'backend', name: string }

interface FileOptions {
    /** Reads starting at or after this offset resolve with one byte less than asked. */
    shortFrom?: number
    /** Reads starting at or after this offset reject. */
    rejectFrom?: number
    /** Serve the file through `binFileOfSource`, whose size and modification time never change. */
    viaSource?: boolean
}

interface Opened {
    file: BinFile
    entry: BackupIndexEntry
    index: ReturnType<typeof scanBinForImport>['index']
    /** Replaces the bytes every later read sees; the layout the walk indexed is kept. */
    set(bytes: Uint8Array): void
    options: FileOptions
    dataStart: number
    dataEnd: number
}

/** A `.bin` behind a `BinFile` that records every read and can be changed after it was walked. */
async function open(container: Uint8Array, events: Event[], options: FileOptions = {}): Promise<Opened> {
    let current = container
    const read = (start: number, end: number): Uint8Array => {
        const stop = options.shortFrom !== undefined && start >= options.shortFrom && end - start > 1 ? end - 1 : end
        return current.slice(start, Math.min(stop, current.length))
    }
    let file: BinFile
    if (options.viaSource === true) {
        const source: FileSource = {
            name: 'backup.bin',
            size: container.length,
            read: async (start, end) => {
                events.push({ kind: 'slice', start, end })
                return read(start, end)
            },
            stream: () => { throw new Error('not streamed') },
            stat: async () => ({ size: container.length, modified: 1 }),
            close: async () => { },
        }
        file = binFileOfSource(source)
    } else {
        const sliceOf = (start: number, end: number): BinSlice => ({
            size: end - start,
            slice: (from: number, to?: number) => sliceOf(start + from, to === undefined ? end : start + to),
            arrayBuffer: async () => {
                events.push({ kind: 'slice', start, end })
                if (options.rejectFrom !== undefined && start >= options.rejectFrom) {
                    throw new Error('read refused')
                }
                return read(start, end).slice().buffer
            },
        })
        file = { size: container.length, slice: (start: number, end?: number) => sliceOf(start, end ?? container.length) }
    }
    const walked = await indexBackupEntries(file)
    const scan = scanBinForImport(walked.entries, walked.names)
    if (scan.database === null) {
        throw new Error('The fixture holds no database entry.')
    }
    const dataStart = scan.database.headerOffset + scan.database.headerLength
    events.length = 0
    return {
        file, entry: scan.database, index: scan.index, set: (bytes) => { current = bytes }, options, dataStart, dataEnd: dataStart + scan.database.dataLength,
    }
}

const dataRangeSlices = (events: readonly Event[], opened: Opened) => events.flatMap((event, index) =>
    event.kind === 'slice' && event.start < opened.dataEnd && event.end > opened.dataStart ? [{ index, length: event.end - event.start }] : [])
const putIndexes = (events: readonly Event[]) => events.flatMap((event, index) => event.kind === 'backend' && event.name === 'putUnit' ? [index] : [])

// ---- the base store, the run and what it came to ----

interface BaseStore {
    raw: MemoryBackend
    clock: TestClock
    baseKey: string
}

/**
 * A seeded store the import replaces. `rich` makes the current manifest carry what an import must keep: a keep list, a
 * field of this build's future at the top and in `fixed`, and a requirement token; one older manifest is retained and its
 * entry is one minute old at the import, inside the retention admission interval.
 */
async function baseStore(rich: boolean): Promise<BaseStore> {
    const raw = createMemoryBackend()
    const clock = createClock()
    await seedStore(raw, testEnv(clock, 1))
    if (rich) {
        const committer = committerOf(raw, clock, 31)
        const result = await committer.commit(await committer.readCommit(), {
            newUnits: treeUnitCount(0) + 1,
            carry: IMPORT_REPLACES_BASE,
            build: (context) => {
                const built = buildTree(0, context, 'rich')
                const list = new LegacyListBuilder()
                list.addUnreadable('database/dbbackup-1.bin')
                const keep = list.build()
                const key = context.mint.unit()
                const bytes = encodeUnit(UNIT_TYPE.legacyList, keep)
                built.units.push({ key, bytes })
                const body = built.manifest.body as unknown as Record<string, unknown>
                body.zzFutureTop = { a: 1 }
                ;(body.fixed as Record<string, unknown>).zzFutureFixed = 'kept'
                built.manifest.body.req = [...built.manifest.body.req, REQ_MODULE_BUCKETS]
                built.manifest.body.fixed.legacyKeep = { unit: refOfFrame(key, bytes), v: keep.v, files: keep.files.map((file) => ({ key: file.key, status: file.status })) }
                return built
            },
        })
        expect(result.status).toBe('committed')
        clock.advance(60_000)
    }
    const key = await parsedCommit(raw)
    return { raw, clock, baseKey: key.current?.key as string }
}

interface Context {
    raw: Store2Backend
    opened: Opened
    events: Event[]
}

interface RunOptions {
    /** The streamed arm unless false. */
    stream?: false | { minUnits?: number }
    rich?: boolean
    /** Answers the incomplete-data question; true by default. */
    answer?: boolean
    file?: FileOptions
    /** Runs at the marker compare-and-write: after the first read of the entry (the dry pass) and before the second. */
    onMarker?: (context: Context) => void | Promise<void>
    /** Runs before every backend call, after the marker hook. */
    before?: Hooks['before']
    /** The page's own reader of units the file does not hold, given the file's index. */
    fallback?: (key: string, context: Context) => Promise<ColdUnitRead>
    /** Wraps the backend the committer writes through. */
    wrap?: (backend: Store2Backend) => Store2Backend
    omitted?: ReadonlyMap<string, risuSave.SalvageOmittedBlock>
    /** An existing store the import runs over (a store an earlier `run` left), instead of a fresh seeded one. */
    store?: BaseStore
    /** The committer's key seed; an import over an existing store takes another one than that store's earlier imports, so no minted key repeats. */
    seed?: number
    /** Receives the `carry` of every commit the page makes, in order. */
    carries?: CommitRequest['carry'][]
}

interface Outcome {
    end: Store2ImportEnd
    verdicts: string[]
    confirms: string[]
    errors: unknown[]
    logged: unknown[]
    events: Event[]
    raw: MemoryBackend
    baseKey: string
    clock: TestClock
    /** `decodeRisuSave` and `salvageRisuSave` calls: in all, and when the marker was written. */
    decodes: { total: number, atMarker: number | null }
    labelAtFirstPut: string | null
}

async function run(container: Uint8Array, options: RunOptions = {}): Promise<Outcome> {
    const events: Event[] = []
    const opened = await open(container, events, options.file)
    const base = options.store ?? await baseStore(options.rich === true)
    const { raw } = base
    const context: Context = { raw, opened, events }
    const decodeSpy = vi.spyOn(risuSave, 'decodeRisuSave')
    const salvageSpy = vi.spyOn(risuSave, 'salvageRisuSave')
    decodeSpy.mockClear()
    salvageSpy.mockClear()
    const decodeCalls = (): number => decodeSpy.mock.calls.length + salvageSpy.mock.calls.length
    const outcome: Pick<Outcome, 'verdicts' | 'decodes' | 'labelAtFirstPut'> = { verdicts: [], decodes: { total: 0, atMarker: null }, labelAtFirstPut: null }
    const wrapped = hooked(raw, {
        before: async (name, count) => {
            events.push({ kind: 'backend', name })
            if (name === 'casCommit' && count === 1) {
                outcome.decodes.atMarker = decodeCalls()
                await options.onMarker?.(context)
            }
            if (name === 'putUnit' && count === 1) {
                outcome.labelAtFirstPut = (await parsedCommit(raw)).staging?.label ?? null
            }
            await options.before?.(name, count)
        },
    })
    const backend = options.wrap?.(wrapped.backend) ?? wrapped.backend
    const own = committerOf(backend, base.clock, options.seed ?? 100)
    const carries = options.carries
    const committer = carries === undefined ? own : {
        ...own,
        commit: async (...args: Parameters<typeof own.commit>) => { carries.push(args[1].carry); return own.commit(...args) },
        ...(own.commitStreamed === undefined ? {} : {
            commitStreamed: async (...args: Parameters<NonNullable<typeof own.commitStreamed>>) => { carries.push(args[1].carry); return (own.commitStreamed as NonNullable<typeof own.commitStreamed>)(...args) },
        }),
    }
    const logged: unknown[] = []
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logged.push(args[0]) })
    vi.mocked(alertConfirm).mockClear()
    vi.mocked(alertError).mockClear()
    vi.mocked(alertConfirm).mockImplementation(async () => options.answer ?? true)
    const omitted = options.omitted ?? new Map()
    const reader = createBinImportReader(opened.file, opened.index, async (key) => options.fallback?.(key, context) ?? { status: 'missing' })
    const streaming = options.stream !== false
    const end = await commitStore2Import({
        target: { committer, backend },
        busy: {} as BusyHandle,
        decode: () => readBinDatabaseTree(opened.file, opened.entry, omitted),
        reader,
        ...(streaming ? { stream: { file: opened.file, entry: opened.entry, omitted, minUnits: typeof options.stream === 'object' ? options.stream.minUnits : undefined, onPrepared: (verdict: string) => { outcome.verdicts.push(verdict) } } } : {}),
        yieldToMain: async () => { events.push({ kind: 'yield' }) },
    })
    outcome.decodes.total = decodeCalls()
    return {
        end, events, raw, baseKey: base.baseKey, clock: base.clock, ...outcome,
        confirms: vi.mocked(alertConfirm).mock.calls.map((call) => String(call[0])),
        errors: vi.mocked(alertError).mock.calls.map((call) => call[0]),
        logged,
    }
}

/** The tree the committed manifest holds, as plain JSON with every uuid replaced by its position of first appearance. */
async function readBack(outcome: Outcome): Promise<string> {
    const key = await parsedCommit(outcome.raw)
    const read = await readTreeBytes(outcome.raw, key.current?.key as string)
    if (read.status !== 'ok') {
        throw new Error(`The stored tree reads ${read.status}.`)
    }
    const text = JSON.stringify(toPlainJson(assembleDatabase(read.tree.manifest, read.tree.source)))
    const seen = new Map<string, string>()
    return text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (uuid) => {
        if (!seen.has(uuid)) {
            seen.set(uuid, `<uuid${seen.size}>`)
        }
        return seen.get(uuid) as string
    })
}

async function manifestOf(outcome: Outcome): Promise<Manifest> {
    const key = await parsedCommit(outcome.raw)
    const bytes = (await outcome.raw.readUnits([key.current?.key as string])).get(key.current?.key as string) as Uint8Array
    const unit = readUnit(bytes, UNIT_TYPE.manifest)
    if (unit.status !== 'ok') {
        throw new Error('The manifest does not read.')
    }
    return unit.value.body as Manifest
}

/** The whole commit key as JSON; only the epoch and the new current's key, which are random, are replaced. */
async function normalizedKey(outcome: Outcome): Promise<string> {
    const key = await parsedCommit(outcome.raw)
    return JSON.stringify(key).split(key.epoch).join('<epoch>').split(key.current?.key as string).join('<current>')
}

async function committedKey(outcome: Outcome) {
    return await parsedCommit(outcome.raw)
}

const refusalOf = (end: Store2ImportEnd): string => end.kind === 'refused' ? end.cause : end.kind

/** The same fixture through the whole path and the streamed one, each over its own identical store. */
async function arms(container: () => Uint8Array | Promise<Uint8Array>, options: RunOptions = {}): Promise<{ whole: Outcome, streamed: Outcome }> {
    const bytes = await container()
    const whole = await run(bytes, { ...options, stream: false })
    const streamed = await run(bytes, { ...options, stream: options.stream === false ? {} : options.stream ?? {} })
    return { whole, streamed }
}

const dbContainer = async (db: unknown, kind: MsgpackKind = 'compressed', ...cold: Uint8Array[]): Promise<Uint8Array> => concat(chunk(ENTRY_NAME, await msgpackEntry(db, kind)), ...cold)

// ---- T-R1 to T-R3 ----

describe('a page import of a database entry over 9 MiB, with the stream requested', () => {
    let result: Outcome
    let opened: Opened

    beforeAll(async () => {
        const events: Event[] = []
        const data = encodeRisuSaveLegacy(library(80, 200_000), 'compression')
        expect(data.length).toBeGreaterThan(9 * MIB)
        const container = chunk(ENTRY_NAME, data)
        opened = await open(container, events)
        result = await run(container)
    })

    // Regression: the S1-C head reads the entry in one slice of its whole length and ignores the stream.
    test('T-R1: no slice of the entry is longer than 4 MiB', () => {
        expect(result.end.kind).toBe('landed')
        const slices = dataRangeSlices(result.events, opened)
        expect(Math.max(...slices.map((slice) => slice.length))).toBeLessThanOrEqual(4 * MIB)
        expect(slices.length).toBeGreaterThan(1)
    })

    // Regression: the S1-C head reads the entry completely before the first unit is put.
    test('T-R2: uploads interleave with entry reads: a unit is put before the last slice of the entry is read', () => {
        expect(result.end.kind).toBe('landed')
        const slices = dataRangeSlices(result.events, opened)
        const puts = putIndexes(result.events)
        expect(puts.length).toBeGreaterThan(59)
        expect(puts[0]).toBeLessThan(slices[slices.length - 1].index)
    })

    // Regression: the S1-C head never calls the injected yield.
    test('T-R3: the main thread yields at least once per character between the first read of the entry under the marker and the last unit put', () => {
        expect(result.end.kind).toBe('landed')
        const marker = result.events.findIndex((event) => event.kind === 'backend' && event.name === 'casCommit')
        const first = result.events.findIndex((event, index) => index > marker && event.kind === 'slice' && event.start < opened.dataEnd && event.end > opened.dataStart)
        const puts = putIndexes(result.events)
        const last = puts[puts.length - 1]
        const yields = first < 0 ? 0 : result.events.slice(first, last).filter((event) => event.kind === 'yield').length
        expect(yields).toBeGreaterThanOrEqual(80)
    })
})

// ---- T-D1, T-D1c: the streamed import equals the whole one ----

describe('the streamed page import lands what the whole path lands', () => {
    // New behaviour, pinned by mutants: per msgpack header, over a base that carries what an import must keep.
    test.each(['compressed', 'raw', 'stream'] as const)('T-D1 (%s header): the read-back tree and the carried manifest fields equal the whole arm\'s', async (kind) => {
        const { whole, streamed } = await arms(() => dbContainer(library(80), kind), { rich: true })

        expect(whole.end.kind).toBe('landed')
        expect(streamed.end.kind).toBe('landed')
        expect(streamed.verdicts).toEqual(['stream'])
        expect(await readBack(streamed)).toBe(await readBack(whole))
        const carried = async (outcome: Outcome) => {
            const body = await manifestOf(outcome)
            const record = body as unknown as Obj
            return { top: record.zzFutureTop, fixed: (record.fixed as Obj).zzFutureFixed, req: body.req, keep: body.fixed.legacyKeep }
        }
        const expected = await carried(whole)
        expect(expected.top).toEqual({ a: 1 })
        expect(expected.fixed).toBe('kept')
        expect(expected.req).toContain(REQ_MODULE_BUCKETS)
        expect(expected.keep?.files).toEqual([{ key: 'database/dbbackup-1.bin', status: 'unreadable' }])
        expect(await carried(streamed)).toEqual(expected)
        expect(streamed.decodes.atMarker).toBe(0)
        expect(streamed.decodes.total).toBe(0)
    })

    // New behaviour, pinned by mutants: the whole commit key, field by field, over a base with a retained entry inside the admission interval.
    test('T-D1c: the replaced current enters retained, the replacement is stamped import, the marker carries the import label, and the whole commit key equals the whole arm\'s', async () => {
        const { whole, streamed } = await arms(() => dbContainer(library(80)), { rich: true })

        for (const outcome of [whole, streamed]) {
            expect(outcome.end.kind).toBe('landed')
            const key = await committedKey(outcome)
            expect(key.retained.length).toBeGreaterThanOrEqual(2)
            expect(key.retained[0].key).toBe(outcome.baseKey)
            expect((key as unknown as { replaced: { kind: string } }).replaced.kind).toBe('import')
            expect(outcome.labelAtFirstPut).toBe('import')
            expect(key.staging).toBeNull()
        }
        expect(streamed.verdicts).toEqual(['stream'])
        expect(await normalizedKey(streamed)).toBe(await normalizedKey(whole))
    })

    test('T-D1c base: the retained entry of the base is inside the admission interval, so only the force flag keeps the replaced current', async () => {
        const base = await baseStore(true)
        const key = await parsedCommit(base.raw)
        expect(key.retained).toHaveLength(1)
        expect(base.clock.now - key.retained[0].at).toBe(60_000)
    })
})

// ---- ST1 to ST5: a streamed re-import reuses what the profile already stores ----

/** The unit types an import writes again whatever the base holds: the manifest, and the units that carry an entity id. */
const ALWAYS_NEW: ReadonlySet<number> = new Set([UNIT_TYPE.manifest, UNIT_TYPE.shard, UNIT_TYPE.order])

const currentKeyOf = async (outcome: Outcome): Promise<string> => (await parsedCommit(outcome.raw)).current?.key as string

/** The store `outcome` left, as the base of one more import (a minute later, which is inside the retention admission interval). */
async function storeAfter(outcome: Outcome): Promise<BaseStore> {
    outcome.clock.advance(60_000)
    return { raw: outcome.raw, clock: outcome.clock, baseKey: await currentKeyOf(outcome) }
}

/** The same file imported once more over the store `first` left. The committer takes another key seed than the first import's. */
async function importAgain(first: Outcome, container: Uint8Array, options: RunOptions = {}): Promise<Outcome> {
    return run(container, { ...options, store: await storeAfter(first), seed: 101 })
}

/** The keys `after` holds and `before` did not whose type is not an always-new one and whose content a unit the current tree of `raw` names already holds. */
async function duplicatesAfter(raw: MemoryBackend, before: ReadonlyMap<string, Uint8Array>, after: ReadonlyMap<string, Uint8Array>): Promise<string[]> {
    const known = (await readBaseContentIndex(raw, await raw.readCommit())).units
    return [...after.entries()]
        .filter(([key]) => !before.has(key))
        .filter(([, bytes]) => {
            const frame = decodeFrame(bytes)
            return frame.status === 'ok' && !ALWAYS_NEW.has(frame.type) && known.has(unitDigest(bytes))
        })
        .map(([key]) => key)
}

describe('a streamed re-import of the same file reuses the units the profile already stores', () => {
    // Regression reproducer: without a content index every unit of the second import is put again under a new key.
    test('ST1: the second import of one .bin puts no unit whose content the current tree already names, and carries the first import\'s manifest', async () => {
        const bytes = await dbContainer(library(80))
        const first = await run(bytes)
        expect(first.end.kind).toBe('landed')
        expect(first.verdicts).toEqual(['stream'])
        const fromKey = await currentKeyOf(first)
        const before = first.raw.snapshot()
        const carries: CommitRequest['carry'][] = []

        const second = await importAgain(first, bytes, { carries })

        expect(second.end.kind).toBe('landed')
        expect(second.verdicts).toEqual(['stream'])
        expect(second.decodes.total).toBe(0)
        expect(await duplicatesAfter(first.raw, before, second.raw.snapshot())).toEqual([])
        expect(carries).toHaveLength(1)
        expect(carries[0]).not.toBe(IMPORT_REPLACES_BASE)
        expect(carries[0]).toMatchObject({ from: fromKey })
        // The carry counts exactly the units of the first import's tree that the new tree names under their old keys.
        const named = [...(await readBaseContentIndex(second.raw, await second.raw.readCommit())).units.values()].flat().filter((unit) => before.has(unit.key))
        expect(named.length).toBeGreaterThan(0)
        expect((carries[0] as { units: number }).units).toBe(named.length)
        expect(await readBack(second)).toBe(await readBack(first))
        await expectInvariant(second.raw)
    })

    // Regression reproducer for the put count (red before content reuse: every unit is put again); its routing
    // assertions pass before and kill the post-reuse routing mutant after. A file whose pre-reuse total is over the
    // threshold streams even when reuse leaves it under it.
    test('ST2: the re-import is still streamed when reuse takes its written units under the threshold; nothing is decoded whole', async () => {
        const bytes = await dbContainer(library(80))
        const first = await run(bytes)
        const firstPuts = putIndexes(first.events).length
        expect(firstPuts).toBeGreaterThan(59)

        const second = await importAgain(first, bytes)

        expect(second.end.kind).toBe('landed')
        expect(second.verdicts).toEqual(['stream'])
        expect(second.decodes.total).toBe(0)
        const puts = putIndexes(second.events).length
        expect(puts).toBeLessThan(60)
        expect(puts).toBeLessThan(firstPuts)
    })

    // New rule: P2 uses P1b's index object. A peer that replaces the profile between the passes and keeps the manifest the
    // index was read from retained does not change what P2 reuses, so the passes still agree.
    test('ST3: a peer commit that keeps the indexed manifest retained lands the import with the first pass\'s decisions', async () => {
        const bytes = await dbContainer(library(80))
        const first = await run(bytes)
        const fromKey = await currentKeyOf(first)
        const carries: CommitRequest['carry'][] = []
        let reads = 0
        let retainedAtPlant: string[] = []

        const second = await importAgain(first, bytes, {
            carries,
            before: async (name) => {
                // The first read of the commit key is the index's; the second is the one the commit is made over.
                if (name === 'readCommit' && ++reads === 2) {
                    const key = await parsedCommit(first.raw)
                    await plantKey(first.raw, {
                        ...key, seq: key.seq + 1, epoch: 'p'.repeat(key.epoch.length), current: { key: first.baseKey, at: first.clock.now },
                        retained: [{ key: fromKey, at: first.clock.now }], pins: [],
                    })
                    retainedAtPlant = (await parsedCommit(first.raw)).retained.map((entry) => entry.key)
                }
            },
        })

        expect(retainedAtPlant).toEqual([fromKey])
        expect(second.end.kind).toBe('landed')
        expect(second.verdicts).toEqual(['stream'])
        expect(carries).toHaveLength(1)
        expect(carries[0]).toMatchObject({ from: fromKey })
        expect((carries[0] as { units: number }).units).toBeGreaterThan(0)
        await expectInvariant(second.raw)
    })

    /**
     * Replaces the commit key at the final write of the k-th attempt, with this import's own marker still standing, by a
     * key that names `targets[k]` as its current and nothing else: the peer that does not name the manifest the index was read from.
     */
    function dropsBaseUnderMarker(raw: MemoryBackend, clock: TestClock, targets: string[]): { before: NonNullable<RunOptions['before']>, markers: () => number } {
        let markers = 0
        let plantedFor = 0
        return {
            markers: () => markers,
            before: async (name) => {
                if (name !== 'casCommit') {
                    return
                }
                const key = await parsedCommit(raw)
                if (key.staging === null) {
                    markers++
                } else if (plantedFor !== markers && markers <= targets.length) {
                    plantedFor = markers
                    await plantKey(raw, {
                        ...key, seq: key.seq + 1, epoch: String.fromCharCode(96 + markers).repeat(key.epoch.length),
                        current: { key: targets[markers - 1], at: clock.now }, retained: [], pins: [],
                    })
                }
            },
        }
    }

    // New rule, behavioural kill of the streamed carry: with a sentinel the re-judge lands over the peer's current.
    test('ST5: a peer that drops the indexed manifest under the marker twice ends the import library-refused with the marker cleared, and no named manifest names a missing unit', async () => {
        const bytes = await dbContainer(library(80))
        const first = await run(bytes)
        const fromKey = await currentKeyOf(first)
        // The first plant leaves the seed manifest current; the second attempt's base is then that manifest, so it is dropped for the first import's.
        const peer = dropsBaseUnderMarker(first.raw, first.clock, [first.baseKey, fromKey])

        const second = await importAgain(first, bytes, { before: peer.before })

        expect(peer.markers()).toBe(2)
        expect(second.verdicts).toEqual(['stream', 'stream'])
        expect(second.end).toEqual({ kind: 'refused', cause: 'library-refused' })
        expect(second.errors).toEqual([language.store2ImportRefused])
        const key = await parsedCommit(second.raw)
        expect(key.staging).toBeNull()
        expect(key.current?.key).toBe(fromKey)
        const swept = await gcPass({ backend: second.raw, kind: 'tauri', idleReason: () => null })
        expect(swept.status).toBe('done')
        await expectInvariant(second.raw)
    })

    test('ST5 (once): a peer that drops the indexed manifest under the marker once is answered by one quiet rebuild, which lands', async () => {
        const bytes = await dbContainer(library(80))
        const first = await run(bytes)
        const peer = dropsBaseUnderMarker(first.raw, first.clock, [first.baseKey])

        const second = await importAgain(first, bytes, { before: peer.before })

        expect(peer.markers()).toBe(2)
        expect(second.errors).toEqual([])
        expect(second.end.kind).toBe('landed')
        expect(second.verdicts).toEqual(['stream', 'stream'])
        const key = await parsedCommit(second.raw)
        expect(key.staging).toBeNull()
        await gcPass({ backend: second.raw, kind: 'tauri', idleReason: () => null })
        await expectInvariant(second.raw)
    })
})

// ---- T-D2, T-D3, T-D8: what the prepare reports ----

const COLD_A = '00000000-0000-4000-8000-0000000000a1'
const COLD_B = '00000000-0000-4000-8000-0000000000a2'
const COLD_C = '00000000-0000-4000-8000-0000000000a3'
const PLUGIN_UNIT = '00000000-0000-4000-8000-0000000000a4'

/** The library of `count` characters with `extra` after them, as the database of a msgpack entry. */
const withExtra = (count: number, extra: Obj[], patch: Obj = {}): Library => {
    const db = library(count)
    db.characters.push(...extra)
    return Object.assign(db, patch)
}

/** The facts two arms must agree on. */
async function pictureOf(outcome: Outcome): Promise<unknown> {
    return {
        end: outcome.end.kind === 'landed' ? { kind: 'landed', incomplete: outcome.end.incomplete, repair: outcome.end.repair } : outcome.end,
        confirms: outcome.confirms,
        errors: outcome.errors,
        tree: outcome.end.kind === 'landed' ? await readBack(outcome) : null,
    }
}

describe('a streamed page import reports what the whole path reports', () => {
    // Guard: the omitted blocks of a v0 file are confirmed up front (P1a) and the streamed prepare must see the same ones.
    test('T-D2: a v0 file with a block the decode leaves out, a stub with no unit and 70 fillers gives the whole arm\'s incomplete list, question and tree', async () => {
        const db = library(70)
        db.characters.push(stubCharacter('stub-d2', COLD_A), { ...db.characters[0], chaId: 'broken-d2', name: 'Broken' })
        const bytes = chunk(ENTRY_NAME, v0Database(db, new Set(['broken-d2'])))
        const probe = await open(bytes, [])
        const omitted = await readBinDatabaseOmitted(probe.file, probe.entry, { yieldToMain: async () => { } })
        expect([...omitted.keys()]).toEqual(['broken-d2'])

        const { whole, streamed } = await arms(() => bytes, { omitted })

        expect(whole.end.kind).toBe('landed')
        expect(streamed.verdicts).toEqual(['stream'])
        expect(whole.confirms).toHaveLength(1)
        expect(await pictureOf(streamed)).toEqual(await pictureOf(whole))
        expect((streamed.end as Extract<Store2ImportEnd, { kind: 'landed' }>).incomplete.map((item) => item.kind)).toEqual(['character'])
    })

    // New behaviour: a block that reads in P1a and fails in P1b is not in the confirmed omitted map, so the prepare refuses before asking.
    test('T-D2 (changed): a v0 block corrupted between the first omitted scan and the dry pass is read-failed with the file-changed text, unasked and uncommitted', async () => {
        const db = library(70)
        const victim = String(db.characters[40].chaId)
        const bytes = chunk(ENTRY_NAME, v0Database(db))
        const probe = await open(bytes, [])
        const omitted = await readBinDatabaseOmitted(probe.file, probe.entry, { yieldToMain: async () => { } })
        expect(omitted.size).toBe(0)

        // The first byte of the victim block's gzip payload: the layout the walk indexed stays valid, the block no longer inflates.
        const changed = bytes.slice()
        const at = Buffer.from(changed).toString('latin1').indexOf(victim)
        expect(changed[at - 1]).toBe(victim.length)
        expect(changed[at - 3]).toBe(V0.character)
        const payload = at + victim.length + 4
        expect(changed[payload]).toBe(0x1f)
        changed[payload] ^= 0xff

        const outcome = await run(changed, { omitted })

        expect(outcome.end).toEqual({ kind: 'refused', cause: 'read-failed' })
        expect(outcome.errors).toEqual([fileChanged])
        expect(outcome.confirms).toEqual([])
        const key = await parsedCommit(outcome.raw)
        expect(key.staging).toBeNull()
        expect(key.current?.key).toBe(outcome.baseKey)
        expect(outcome.events.filter((event) => event.kind === 'backend' && event.name === 'putUnit')).toHaveLength(0)
    })

    // Guard, passes before and after: an id the repairs would change hands the file back to the whole path before the question.
    const idProblems: Array<[string, (db: Library) => void]> = [
        ['a shared usable chaId', (db) => { db.characters.push({ ...db.characters[0], name: 'Same id' }, stubCharacter(String(db.characters[0].chaId), COLD_A)) }],
        ['a missing chaId', (db) => { db.characters.push({ ...stubCharacter('x', COLD_A), chaId: undefined }) }],
        ['an unusable chaId', (db) => { db.characters.push({ ...db.characters[0], chaId: 'root', name: 'Reserved id' }, stubCharacter('stub-u', COLD_A)) }],
        ['a chaId equal to an earlier chat id', (db) => { db.characters.push(stubCharacter(String((db.characters[0].chats as Obj[])[0].id), COLD_A)) }],
        ['an entry that is not an object', (db) => { db.characters.push([] as never, stubCharacter('after-array', COLD_A)) }],
    ]

    test.each(idProblems)('T-D3: %s takes the whole path (over 59 units): it commits, asks once and is never read-failed', async (_label, mutate) => {
        const db = library(70)
        mutate(db)
        const bytes = await dbContainer(db)

        const { whole, streamed } = await arms(() => bytes)

        expect(whole.end.kind).toBe('landed')
        expect(streamed.end.kind).toBe('landed')
        expect(streamed.verdicts).toEqual(['whole'])
        expect(streamed.confirms).toHaveLength(1)
        expect(streamed.confirms).toEqual(whole.confirms)
        expect(await readBack(streamed)).toBe(await readBack(whole))
    })

    test('T-D8 (i): missing stub, chat and plugin units over 59 units: the same incomplete list, order, text and tree', async () => {
        const db = withExtra(70, [stubCharacter('stub-i', COLD_A), pointerCharacter('pointer-i', COLD_B)], { pluginCustomStorage: { _coldplugin: { prefs: PLUGIN_UNIT } } })
        const { whole, streamed } = await arms(() => dbContainer(db))

        expect(streamed.verdicts).toEqual(['stream'])
        expect(whole.confirms).toHaveLength(1)
        expect((whole.end as Extract<Store2ImportEnd, { kind: 'landed' }>).incomplete.map((item) => item.kind)).toEqual(['character', 'chat', 'plugin'])
        expect(await pictureOf(streamed)).toEqual(await pictureOf(whole))
    })

    test('T-D8 (ii): an unsavable file that is also incomplete asks first; no declines, yes is unsavable with the same detail', async () => {
        const db = withExtra(70, [stubCharacter('stub-ii', COLD_A)], { plugins: 'not a list' })
        const bytes = await dbContainer(db)
        for (const answer of [false, true]) {
            const { whole, streamed } = await arms(() => bytes, { answer })
            expect(streamed.verdicts).toEqual(['stop'])
            expect(whole.confirms).toHaveLength(1)
            expect(refusalOf(whole.end)).toBe(answer ? 'unsavable' : 'declined')
            expect(await pictureOf(streamed)).toEqual(await pictureOf(whole))
        }
    })

    test('T-D8 (iii): a codec error at character 3 and a read failure at character 10 is read-failed in both arms', async () => {
        const db = library(70)
        ;(db.characters[3] as Obj).chats = [5]
        db.characters[10] = stubCharacter(String(db.characters[10].chaId), COLD_A)
        const { whole, streamed } = await arms(() => dbContainer(db), { fallback: async () => ({ status: 'error', error: new Error('disk') }) })

        expect(refusalOf(whole.end)).toBe('read-failed')
        expect(streamed.verdicts).toEqual(['stop'])
        expect(await pictureOf(streamed)).toEqual(await pictureOf(whole))
    })

    test('T-D8 (iv): a character codec error and a front codec error report the front detail', async () => {
        const db = library(70)
        ;(db.characters[5] as Obj).chats = [5]
        db.plugins = 'not a list'
        const { whole, streamed } = await arms(() => dbContainer(db))

        expect(refusalOf(whole.end)).toBe('unsavable')
        expect(streamed.verdicts).toEqual(['stop'])
        expect(await pictureOf(streamed)).toEqual(await pictureOf(whole))
        expect(streamed.errors).toEqual(whole.errors)
        expect(String(streamed.errors[0])).toContain('plugins')
    })

    test('T-D8 (v): 59 units or fewer with a missing cold unit take the whole path: asked once, committed', async () => {
        const db = withExtra(1, [stubCharacter('stub-v', COLD_A)])
        const { whole, streamed } = await arms(() => dbContainer(db))

        expect(streamed.verdicts).toEqual(['whole'])
        expect(whole.confirms).toHaveLength(1)
        expect(streamed.confirms).toEqual(whole.confirms)
        expect(streamed.end.kind).toBe('landed')
        expect(streamed.events.filter((event) => event.kind === 'backend' && event.name === 'commitOrdinary')).toHaveLength(1)
        expect(await pictureOf(streamed)).toEqual(await pictureOf(whole))
    })

    test('T-D8 (vi): a read failure at character 3 and a duplicate chaId at character 10 take the whole path\'s outcome', async () => {
        const db = library(70)
        db.characters[3] = stubCharacter(String(db.characters[3].chaId), COLD_A)
        db.characters[10] = { ...db.characters[10], chaId: db.characters[9].chaId }
        const { whole, streamed } = await arms(() => dbContainer(db), { fallback: async () => ({ status: 'error', error: new Error('disk') }) })

        expect(refusalOf(whole.end)).toBe('read-failed')
        expect(streamed.verdicts).toEqual(['whole'])
        expect(await pictureOf(streamed)).toEqual(await pictureOf(whole))
    })

    test('T-D8 (vii): a character read failure and a plugin-index read failure report the character\'s', async () => {
        const db = withExtra(70, [stubCharacter('stub-vii', COLD_A)], { pluginCustomStorage: { _coldplugin: { prefs: PLUGIN_UNIT } } })
        const asked: string[] = []
        const { whole, streamed } = await arms(() => dbContainer(db), {
            fallback: async (key) => { asked.push(key); return { status: 'error', error: new Error('disk') } },
        })

        expect(refusalOf(whole.end)).toBe('read-failed')
        expect(streamed.verdicts).toEqual(['stop'])
        const failed = (outcome: Outcome) => outcome.logged.filter((entry): entry is LegacyReadError => entry instanceof LegacyReadError).map((entry) => entry.key)
        expect(failed(whole)).toEqual([COLD_A])
        expect(failed(streamed)).toEqual([COLD_A])
        expect(asked.indexOf(PLUGIN_UNIT)).toBeLessThan(0)
    })
})

// ---- T-D4, T-D5, T-D7, T-D11, T-A6 ----

/** What a page abort under the marker must leave: the previous current, no marker, and no final compare-and-write. */
async function expectAborted(outcome: Outcome, refusal: string, text: string | null): Promise<void> {
    expect(outcome.verdicts).toEqual(['stream'])
    expect(outcome.end).toEqual({ kind: 'refused', cause: refusal })
    if (text !== null) {
        expect(outcome.errors).toEqual([text])
    }
    const key = await parsedCommit(outcome.raw)
    expect(key.staging).toBeNull()
    expect(key.current?.key).toBe(outcome.baseKey)
    // The marker and its clear are the only two compare-and-writes.
    expect(outcome.events.filter((event) => event.kind === 'backend' && event.name === 'casCommit')).toHaveLength(2)
}

/** The abort's original error: the `Store2BulkAbortError` the commit logged, unwrapped. */
function abortOriginal(outcome: Outcome): unknown {
    const abort = outcome.logged.find((entry): entry is Store2BulkAbortError => entry instanceof Store2BulkAbortError)
    return abort?.original
}

function causes(error: unknown): unknown[] {
    const chain: unknown[] = []
    for (let current = error; current instanceof Error && chain.length < 8; current = current.cause) {
        chain.push(current)
    }
    return chain
}

const fileChanged = language.backupFileChangedWhileReading

/** Replaces the first occurrence of `from` by `to` (same length) in `bytes`. */
function patched(bytes: Uint8Array, from: string, to: string): Uint8Array {
    expect(to.length).toBe(from.length)
    const text = Buffer.from(bytes).toString('latin1')
    const at = text.indexOf(from)
    expect(at).toBeGreaterThanOrEqual(0)
    const out = bytes.slice()
    out.set(encoder.encode(to), at)
    return out
}

describe('a page abort under the marker', () => {
    // New behaviour: P2 reads a v0 file that is not the one P1b read, so nothing lands and the person is told the file changed.
    test('T-D4 (a): a v0 block swapped between the dry pass and the build is read-failed, marker cleared, no decode after the marker', async () => {
        const a = chunk(ENTRY_NAME, v0Database(library(70)))
        // A swapped block of the same entry length keeps the layout the walk indexed valid; the compressed lengths are searched for.
        let b: Uint8Array | null = null
        for (let n = 0; n < 400 && b === null; n++) {
            const changed = library(70)
            changed.characters[40] = { ...changed.characters[40], lastInteraction: T + 40_000 + 1 + n }
            const candidate = chunk(ENTRY_NAME, v0Database(changed))
            b = candidate.length === a.length ? candidate : null
        }
        expect(b).not.toBeNull()
        const outcome = await run(a, { onMarker: ({ opened }) => opened.set(b as Uint8Array) })

        await expectAborted(outcome, 'read-failed', fileChanged)
        expect(outcome.verdicts).toEqual(['stream'])
        expect(outcome.decodes.total).toBe(outcome.decodes.atMarker)
    })

    test('T-D4 (b): an msgpack entry truncated between the passes is read-failed; a character whose msgpack is broken names the cause', async () => {
        const bytes = await dbContainer(library(70), 'raw')
        const truncated = await run(bytes, { onMarker: ({ opened }) => opened.set(bytes.slice(0, bytes.length - 100)) })
        await expectAborted(truncated, 'read-failed', fileChanged)
        expect(abortOriginal(truncated)).toBeInstanceOf(BinFileChangedError)
        expect(truncated.decodes.total).toBe(truncated.decodes.atMarker)

        // A byte of the entry's first map key made an unknown type: the entry no longer streams.
        const broken = bytes.slice()
        const at = Buffer.from(broken).toString('latin1').indexOf('characters')
        broken[at - 1] = 0xc1
        const outcome = await run(bytes, { onMarker: ({ opened }) => opened.set(broken) })
        await expectAborted(outcome, 'read-failed', fileChanged)
        const original = abortOriginal(outcome)
        expect(original).toBeInstanceOf(BinFileChangedError)
        expect((original as BinFileChangedError).reason).toBe('content')
        expect(String(((original as BinFileChangedError).cause as Error).message)).toMatch(/no longer streams/)
    })

    // New behaviour: the check that catches it is the bytes' CRC, not a codec error.
    test.each([false, true])('T-D4 (c, c\'): one byte flipped inside a character string, same length, is read-failed with no codec error in the cause (through a source whose size and time never change: %s)', async (viaSource) => {
        const bytes = await dbContainer(library(70), 'raw')
        const flipped = patched(bytes, 'Synthetic 33', 'Synthetic 44')
        const outcome = await run(bytes, { file: { viaSource }, onMarker: ({ opened }) => opened.set(flipped) })

        await expectAborted(outcome, 'read-failed', fileChanged)
        const original = abortOriginal(outcome)
        expect(original).toBeInstanceOf(BinFileChangedError)
        expect((original as BinFileChangedError).reason).toBe('content')
        expect(causes(original).some((error) => error instanceof CodecError)).toBe(false)
    })

    const coldContainer = async (): Promise<{ bytes: Uint8Array, db: Library }> => {
        const db = withExtra(70, [stubCharacter('stub-cold', COLD_A)])
        return { db, bytes: await dbContainer(db, 'compressed', coldEntry(COLD_A, stubUnit('stub-cold'))) }
    }

    test('T-D4 (d): a cold entry changed while the build resolves it is read-failed with the file-changed text', async () => {
        const { db, bytes } = await coldContainer()
        const changed = await dbContainer(db, 'compressed', coldEntry(COLD_A, { ...(stubUnit('stub-cold') as Obj), padding: 'longer than the walk saw' }))
        const outcome = await run(bytes, { onMarker: ({ opened }) => opened.set(changed) })

        await expectAborted(outcome, 'read-failed', fileChanged)
        const original = abortOriginal(outcome)
        expect(original).toBeInstanceOf(LegacyReadError)
        expect((original as LegacyReadError).cause).toBeInstanceOf(BinFileChangedError)
    })

    test('T-D4 (e): the page\'s own reader failing in the build is read-failed with the read-failed text', async () => {
        const db = withExtra(70, [stubCharacter('stub-fb', COLD_B)])
        const bytes = await dbContainer(db)
        const state = { marked: false }
        const outcome = await run(bytes, {
            onMarker: () => { state.marked = true },
            fallback: async () => state.marked ? { status: 'error', error: new Error('disk') } : { status: 'ok', value: stubUnit('stub-fb') },
        })

        await expectAborted(outcome, 'read-failed', language.store2ImportReadFailed)
        expect(abortOriginal(outcome)).toBeInstanceOf(LegacyReadError)
    })

    test('T-D4 (f): a v0 block swapped when the backend also refuses to clear the marker is unconfirmed', async () => {
        const bytes = await dbContainer(library(70), 'raw')
        const flipped = patched(bytes, 'Synthetic 33', 'Synthetic 44')
        const outcome = await run(bytes, {
            onMarker: ({ opened }) => opened.set(flipped),
            before: (name, count) => { if (name === 'casCommit' && count === 2) { throw new Store2BackendFailureError('the clear is refused') } },
        })

        expect(outcome.verdicts).toEqual(['stream'])
        expect(outcome.end).toEqual({ kind: 'unconfirmed' })
        expect((await parsedCommit(outcome.raw)).staging).not.toBeNull()
    })

    test('T-D4 (g): a cold entry that turned unreadable between the passes changes the incomplete items: read-failed', async () => {
        const { bytes } = await coldContainer()
        // The unit's JSON opens with a brace; a closing one makes it text the reader skips, as the restore loop does.
        const garbled = patched(bytes, '{"character":', '}"character":')
        const outcome = await run(bytes, { onMarker: ({ opened }) => opened.set(garbled) })

        expect(outcome.verdicts).toEqual(['stream'])
        await expectAborted(outcome, 'read-failed', fileChanged)
        expect(causes(abortOriginal(outcome)).some((error) => error instanceof CodecError)).toBe(false)
    })

    test('T-D4 (h): a file whose second read plans more units stops at the first pass\'s count: content error, and no more puts than that count minus one', async () => {
        const padded = (chatsOfFirst: number, pad: number): Library => {
            const db = library(70)
            const first = db.characters[0]
            const chats = first.chats as Obj[]
            for (let i = 0; i < chatsOfFirst; i++) {
                chats.push(plainChat(`00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, `extra ${i}`))
            }
            db.characters[69].note = 'p'.repeat(pad)
            return db
        }
        const a = await dbContainer(padded(0, 62_000), 'raw')
        const reference = await run(a)
        expect(reference.end.kind).toBe('landed')
        const count = putIndexes(reference.events).length
        // 60 more chats are more units than the dry pass left for the front, the modules and the finish, so the committer's own cap would be reached too.
        const longer = await dbContainer(padded(60, 62_000), 'raw')
        const b = await dbContainer(padded(60, 62_000 - (longer.length - a.length)), 'raw')
        expect(longer.length).toBeGreaterThan(a.length)
        expect(b.length).toBe(a.length)
        const outcome = await run(a, { onMarker: ({ opened }) => opened.set(b) })

        await expectAborted(outcome, 'read-failed', fileChanged)
        const original = abortOriginal(outcome)
        expect((original as BinFileChangedError).reason).toBe('content')
        expect(putIndexes(outcome.events).length).toBe(count - 1)
    })

    // New behaviour: a device failure of the k-th upload is an abandoned import, not a changed file.
    test.each(['a backend error', 'a flush that is not confirmed'])('T-D4 (i): %s at a character put is abandoned and says so, with the marker cleared', async (mode) => {
        const bytes = await dbContainer(library(70))
        let puts = 0
        const outcome = await run(bytes, {
            before: mode === 'a backend error'
                ? (name) => { if (name === 'putUnit' && ++puts === 7) { throw new Store2BackendFailureError('the device failed') } }
                : undefined,
            wrap: mode === 'a backend error'
                ? undefined
                : (backend) => ({
                    ...backend,
                    putUnit: async (key, data) => {
                        const written = await backend.putUnit(key, data)
                        return ++puts === 7 ? { ...written, flushed: false } : written
                    },
                }),
        })

        expect(outcome.verdicts).toEqual(['stream'])
        expect(outcome.end).toEqual({ kind: 'refused', cause: 'abandoned' })
        expect(outcome.errors).toEqual([language.store2ImportAbandoned])
        const key = await parsedCommit(outcome.raw)
        expect(key.staging).toBeNull()
        expect(key.current?.key).toBe(outcome.baseKey)
        expect(outcome.logged.some((entry) => entry instanceof BinFileChangedError || entry instanceof Store2BulkAbortError)).toBe(false)
        expect(putIndexes(outcome.events).length).toBe(7)
    })

    test('T-D5: work that starts before the flip refuses a streamed import as busy: nothing is put and the marker is cleared', async () => {
        busyBox.busy = true
        const bytes = await dbContainer(library(70))
        for (const stream of [false, {}] as const) {
            const outcome = await run(bytes, { stream })
            expect(outcome.verdicts).toEqual(stream === false ? [] : ['stream'])
            expect(outcome.end).toEqual({ kind: 'refused', cause: 'busy' })
            expect(putIndexes(outcome.events)).toEqual([])
            const key = await parsedCommit(outcome.raw)
            expect(key.staging).toBeNull()
            expect(key.current?.key).toBe(outcome.baseKey)
        }
    })

    // Diagnostic: a tab closed under the marker leaves the marker, which the page that follows clears.
    test('T-D7: a build stopped after some puts leaves a marker that clearAbandonedMarker clears; the previous tree loads', async () => {
        const bytes = await dbContainer(library(70))
        let puts = 0
        let dead = false
        const outcome = await run(bytes, {
            before: (name) => {
                if (name === 'putUnit' && ++puts === 9) {
                    dead = true
                }
                if (dead) {
                    throw new Error('the page is gone')
                }
            },
        })

        expect(outcome.verdicts).toEqual(['stream'])
        expect(outcome.end).toEqual({ kind: 'unconfirmed' })
        dead = false
        const key = await parsedCommit(outcome.raw)
        expect(key.staging).not.toBeNull()
        const fresh = committerOf(outcome.raw, outcome.clock, 555)
        const cleared = await clearAbandonedMarker(fresh, await fresh.readCommit(), async () => 'gone')
        expect(cleared.result?.status).toBe('cleared')
        const after = await parsedCommit(outcome.raw)
        expect(after.staging).toBeNull()
        expect(after.current?.key).toBe(outcome.baseKey)
        const tree = await readTreeBytes(outcome.raw, outcome.baseKey)
        expect(tree.status).toBe('ok')
    })

    // New behaviour: with no injected yield, the import yields through the event loop's own yield, once per character at least.
    test('T-D11: a streamed import with the default yield calls scheduler.yield at least once per character and never setTimeout', async () => {
        const bytes = await dbContainer(library(80))
        const spy = vi.fn(async () => { })
        vi.stubGlobal('scheduler', { yield: spy })
        const timers = vi.spyOn(globalThis, 'setTimeout')
        try {
            const events: Event[] = []
            const opened = await open(bytes, events)
            const base = await baseStore(false)
            const committer = committerOf(base.raw, base.clock, 100)
            const omitted = new Map()
            const end = await commitStore2Import({
                target: { committer, backend: base.raw },
                busy: {} as BusyHandle,
                decode: () => readBinDatabaseTree(opened.file, opened.entry, omitted),
                reader: createBinImportReader(opened.file, opened.index, async () => ({ status: 'missing' })),
                stream: { file: opened.file, entry: opened.entry, omitted },
            })

            expect(end.kind).toBe('landed')
            expect(spy.mock.calls.length).toBeGreaterThanOrEqual(80)
            expect(timers).not.toHaveBeenCalled()
        } finally {
            vi.unstubAllGlobals()
        }
    })

    test('T-A6 (P1b): a short chunk and a rejected read are refused with the file-changed text and nothing is decoded whole', async () => {
        const bytes = await dbContainer(library(70))
        for (const file of [{ shortFrom: 0 }, { rejectFrom: 0 }] as const) {
            const events: Event[] = []
            const opened = await open(bytes, events)
            // Reads of the entry's data, after the walk indexed it, are short or refused.
            const { shortFrom, rejectFrom } = file as { shortFrom?: number, rejectFrom?: number }
            opened.options.shortFrom = shortFrom === undefined ? undefined : opened.dataStart
            opened.options.rejectFrom = rejectFrom === undefined ? undefined : opened.dataStart
            const base = await baseStore(false)
            const decodeSpy = vi.spyOn(risuSave, 'decodeRisuSave')
            const salvageSpy = vi.spyOn(risuSave, 'salvageRisuSave')
            const committer = committerOf(base.raw, base.clock, 100)
            const omitted = new Map()
            const end = await commitStore2Import({
                target: { committer, backend: base.raw },
                busy: {} as BusyHandle,
                decode: () => readBinDatabaseTree(opened.file, opened.entry, omitted),
                reader: createBinImportReader(opened.file, opened.index, async () => ({ status: 'missing' })),
                stream: { file: opened.file, entry: opened.entry, omitted },
            })

            expect(end).toEqual({ kind: 'refused', cause: 'read-failed' })
            expect(vi.mocked(alertError).mock.calls.at(-1)?.[0]).toBe(fileChanged)
            expect(decodeSpy).not.toHaveBeenCalled()
            expect(salvageSpy).not.toHaveBeenCalled()
            expect((await parsedCommit(base.raw)).current?.key).toBe(base.baseKey)
        }
    })

    // New behaviour: the omitted map no longer needs the whole entry in memory.
    test('P1a: readBinDatabaseOmitted reads a big entry in slices of at most 4 MiB and decodes nothing whole; a zlib-wrapped entry is read whole as before', async () => {
        const data = encodeRisuSaveLegacy(library(40, 200_000), 'compression')
        expect(data.length).toBeGreaterThan(5 * MIB)
        const events: Event[] = []
        const opened = await open(chunk(ENTRY_NAME, data), events)
        const decodeSpy = vi.spyOn(risuSave, 'decodeRisuSave')
        const salvageSpy = vi.spyOn(risuSave, 'salvageRisuSave')
        decodeSpy.mockClear()
        salvageSpy.mockClear()

        const omitted = await readBinDatabaseOmitted(opened.file, opened.entry, { yieldToMain: async () => { } })

        expect(omitted.size).toBe(0)
        const slices = dataRangeSlices(events, opened)
        expect(Math.max(...slices.map((slice) => slice.length))).toBeLessThanOrEqual(4 * MIB)
        expect(slices.length).toBeGreaterThan(1)
        expect(decodeSpy).not.toHaveBeenCalled()
        expect(salvageSpy).not.toHaveBeenCalled()

        // The decoder declines a 'compressed' entry that is not gzip; the whole decode (`decompressSync`) accepts it.
        const header = data.slice(0, 11)
        const zlibEntry = concat(header, zlibSync(gunzipSync(data.slice(11))))
        const wholeEvents: Event[] = []
        const wholeOpened = await open(chunk(ENTRY_NAME, zlibEntry), wholeEvents)
        decodeSpy.mockClear()
        expect((await readBinDatabaseOmitted(wholeOpened.file, wholeOpened.entry, { yieldToMain: async () => { } })).size).toBe(0)
        expect(decodeSpy).toHaveBeenCalledTimes(1)
    })

    test('T-A6 (P1a): readBinDatabaseOmitted refuses a short chunk as length and a rejected read as unreadable', async () => {
        const bytes = await dbContainer(library(5))
        for (const [options, reason] of [[{ shortFrom: 0 }, 'length'], [{ rejectFrom: 0 }, 'unreadable']] as const) {
            const opened = await open(bytes, [])
            opened.options.shortFrom = 'shortFrom' in options ? opened.dataStart : undefined
            opened.options.rejectFrom = 'rejectFrom' in options ? opened.dataStart : undefined
            const failure = await readBinDatabaseOmitted(opened.file, opened.entry, { yieldToMain: async () => { } }).catch((error: unknown) => error)

            expect(failure).toBeInstanceOf(BinFileChangedError)
            expect((failure as BinFileChangedError).reason).toBe(reason)
        }
    })
})

// ---- the plugin unit ids of a streamed import ----

const PLUGIN_INDEX_GOLDEN = path.join(process.cwd(), 'src/ts/drive/tests/binGoldens/upstream-plugin-index.bin')
const mintedId = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
/** The fixed unit ids of the golden (`binGoldens.harness.ts`): the index, the large and kept values, the shadowed, trashed and old ones. */
const GOLDEN_FIXED_IDS: ReadonlySet<string> = new Set([0xb1, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6].map(mintedId))
const GOLDEN_LARGE_ID = mintedId(0xb2)
const GOLDEN_KEPT_ID = mintedId(0xb4)
/** The golden's small index entries; each one draws one plugin unit id. */
const GOLDEN_MINTED = 7
/** The bucket of the `_coldplugin` key, which every import stores. */
const COLD_PLUGIN_BUCKET = bucketOfKey('_coldplugin')
const emptyBucketDigest = (): string => unitDigest(encodeUnit(UNIT_TYPE.pluginStorageBucket, { v: 1, entries: [] }))

/** The first `count` v4-shaped ids that are not the golden's fixed ones and that `accept` (given the buckets already taken). */
function idsWhere(count: number, accept: (bucket: number, taken: ReadonlySet<number>) => boolean): string[] {
    const ids: string[] = []
    const taken = new Set<number>()
    for (let n = 1; ids.length < count && n < 0x1000; n++) {
        const id = mintedId(n)
        const bucket = bucketOfKey(id)
        if (GOLDEN_FIXED_IDS.has(id) || !accept(bucket, taken)) {
            continue
        }
        ids.push(id)
        taken.add(bucket)
    }
    expect(ids).toHaveLength(count)
    return ids
}

/** Every id in the `_coldplugin` bucket: the entries of the golden then fill that bucket and the kept value's one. */
const SAME_BUCKET_IDS = idsWhere(12, (bucket) => bucket === COLD_PLUGIN_BUCKET)
/** Ids in pairwise distinct buckets, none of them a bucket the golden's other keys use. */
const SPREAD_IDS = idsWhere(GOLDEN_MINTED, (bucket, taken) => ![COLD_PLUGIN_BUCKET, bucketOfKey(GOLDEN_LARGE_ID), bucketOfKey(GOLDEN_KEPT_ID)].includes(bucket) && !taken.has(bucket))

interface IdBox {
    ids: string[]
    calls: number
}

type ImportStreamHooks = Parameters<typeof prepareImportStream>[1]

/** A store holding at least 16 buckets of equal (empty) content, as any library without plugin storage leaves behind. */
async function storeWithEmptyBuckets(): Promise<BaseStore> {
    const first = await run(await dbContainer(library(5)), { stream: false })
    expect(first.end.kind).toBe('landed')
    const base = await storeAfter(first)
    const known = await readBaseContentIndex(base.raw, await base.raw.readCommit())
    expect(known.units.get(emptyBucketDigest())?.length ?? 0).toBeGreaterThanOrEqual(16)
    return base
}

/** The request `commitStore2Import` builds for the golden over `base`, with the plugin unit ids drawn from `box`. */
async function pluginIndexRequest(base: BaseStore, box: IdBox): Promise<{ request: StreamCommitRequest, hooks: ImportStreamHooks }> {
    const opened = await open(new Uint8Array(fs.readFileSync(PLUGIN_INDEX_GOLDEN)), [])
    const committer = committerOf(base.raw, base.clock, 101)
    const request: StreamCommitRequest = {
        stream: { file: opened.file, entry: opened.entry, omitted: new Map(), minUnits: 0 },
        reader: createBinImportReader(opened.file, opened.index, async () => ({ status: 'missing' })),
        lists: createListDerivation(),
        yieldToMain: async () => { },
        baseContent: async () => readBaseContentIndex(base.raw, await committer.readCommit()),
        resolve: {
            newUnitId: () => {
                box.calls += 1
                const id = box.ids.shift()
                if (id === undefined) {
                    throw new Error('The test ran out of plugin unit ids.')
                }
                return id
            },
        },
        committer,
        backend: base.raw,
    }
    return { request, hooks: { confirmIncomplete: async () => true } }
}

/** The streamed prepare's answer, failing the test when the file took another route. */
function streamedOf(verdict: Awaited<ReturnType<typeof prepareImportStream>>): StreamPrepared {
    if (verdict === 'whole' || 'status' in verdict) {
        throw new Error(`The golden did not take the stream route (${verdict === 'whole' ? verdict : verdict.status}).`)
    }
    return verdict
}

describe('a streamed import mints each plugin unit id once, whatever the id source answers later', () => {
    // Regression reproducer: P2 drew new ids, so its buckets held another number of equal-content empty ones than P1b's
    // and the unit count check refused the commit as a changed file.
    test('R1: a base holding 16 equal-content empty buckets: ids drawn between the passes change nothing, and the commit names the first pass\'s ids', async () => {
        const base = await storeWithEmptyBuckets()
        const box: IdBox = { ids: [...SAME_BUCKET_IDS], calls: 0 }
        const { request, hooks } = await pluginIndexRequest(base, box)

        const prepared = streamedOf(await prepareImportStream(request, hooks))
        expect(box.calls).toBe(GOLDEN_MINTED)
        box.ids = [...SPREAD_IDS]
        const outcome = await commitImportStreamed(request, prepared, hooks)

        expect(outcome.status).toBe('committed')
        expect(box.calls).toBe(GOLDEN_MINTED)
        expect(box.ids).toEqual(SPREAD_IDS)
        const key = (await parsedCommit(base.raw)).current?.key as string
        const read = await readTreeBytes(base.raw, key)
        if (read.status !== 'ok') {
            throw new Error(`The stored tree reads ${read.status}.`)
        }
        const storage = (assembleDatabase(read.tree.manifest, read.tree.source).pluginCustomStorage ?? {}) as unknown as Obj
        const slots = storage._coldplugin as Record<string, string>
        const minted = Object.entries(slots).filter(([, id]) => !GOLDEN_FIXED_IDS.has(id))
        expect(minted).toHaveLength(GOLDEN_MINTED)
        expect(new Set(minted.map(([, id]) => id))).toEqual(new Set(SAME_BUCKET_IDS.slice(0, GOLDEN_MINTED)))
        for (const id of Object.values(slots)) {
            expect(Object.hasOwn(storage, id)).toBe(true)
        }
        expect(storage[slots.bigKey]).toEqual({ big: ['a', 'b', 'c'] })
        expect(storage[slots.objKey]).toEqual({ theme: 'dark', nested: { list: [1, 2, null], flag: false } })
        expect(slots.bigKey).toBe(GOLDEN_LARGE_ID)
        await expectInvariant(base.raw)
    })

    // New-behaviour guard: one prepared stream builds again from its first id.
    test('R3: two builds of one prepared stream name the same plugin unit ids', async () => {
        const base = await storeWithEmptyBuckets()
        const box: IdBox = { ids: [...SAME_BUCKET_IDS], calls: 0 }
        const { request, hooks } = await pluginIndexRequest(base, box)
        const prepared = streamedOf(await prepareImportStream(request, hooks))
        box.ids = [...SPREAD_IDS]
        // One build description finalized twice: the replay cursor must not outlive a call.
        const importUnits = streamedImportUnits(prepared, request, hooks)

        const bucketBodies = async (): Promise<string> => {
            const units: UnitWrite[] = []
            const context: StreamContext = {
                mint: createKeyMint(seededEnv(5), null).mint,
                seq: 1,
                now: NOW,
                put: async (unit) => { units.push(unit) },
            }
            const built = await importUnits.finalize(context)
            const bodies: string[] = []
            // A reused unit is a base unit by content and carries no bytes; the minted ids live in written buckets.
            for (const unit of [...units, ...built.units]) {
                if (!('bytes' in unit)) {
                    continue
                }
                const read = readUnit(unit.bytes, UNIT_TYPE.pluginStorageBucket)
                if (read.status === 'ok') {
                    bodies.push(JSON.stringify(read.value.body))
                }
            }
            return bodies.sort().join('\n')
        }
        const first = await bucketBodies()
        const second = await bucketBodies()

        expect(first).toContain(SAME_BUCKET_IDS[0])
        expect(second).toBe(first)
        expect(box.calls).toBe(GOLDEN_MINTED)
        expect(box.ids).toEqual(SPREAD_IDS)
    })

    // New-behaviour guards: a build that needs another number of plugin unit ids than the first pass minted is a changed file.
    test.each([
        ['R4a', 'a build that asks for one id more than recorded', (minted: readonly string[]) => minted.slice(1), 'more plugin unit ids'],
        ['R4b', 'a build that uses one id fewer than recorded', (minted: readonly string[]) => [...minted, mintedId(0x2000)], 'fewer plugin unit ids'],
    ])('%s: %s aborts with the content error, the marker cleared and the tree unchanged', async (_id, _name, reshape, text) => {
        const base = await storeWithEmptyBuckets()
        const box: IdBox = { ids: [...SAME_BUCKET_IDS], calls: 0 }
        const { request, hooks } = await pluginIndexRequest(base, box)
        const prepared = streamedOf(await prepareImportStream(request, hooks))
        const before = (await parsedCommit(base.raw)).current?.key

        const failure = await commitImportStreamed(request, { ...prepared, minted: reshape(prepared.minted) }, hooks).catch((error: unknown) => error)

        expect(failure).toBeInstanceOf(Store2BulkAbortError)
        expect((failure as Store2BulkAbortError).original).toMatchObject({ reason: 'content', cause: { message: expect.stringContaining(text) } })
        expect((failure as Store2BulkAbortError).original).toBeInstanceOf(BinFileChangedError)
        const key = await parsedCommit(base.raw)
        expect(key.staging).toBeNull()
        expect(key.current?.key).toBe(before)
        expect(box.calls).toBe(GOLDEN_MINTED)
    })
})
