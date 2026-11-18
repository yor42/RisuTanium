// @vitest-environment node
/**
 * The streamed `.bin` import at boot (`commitBootImport` with `stream`): the first-life and exit installs over a second
 * read of the file, what they keep of the old upstream files, and the end of an install that stopped under the marker.
 * Runs over the real boot target, library and memory backend, and over the real alert store (`alertConfirm` is answered by
 * the test, `alertError` and `waitAlert` are the app's own). A pass says nothing about a device or a real file.
 *
 * Labels: new behaviour (the streamed path), guard (the whole path's outcome, which the streamed path must reproduce).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const flag = vi.hoisted(() => ({ measure: true }))

vi.mock('src/ts/process/memory/measureFlag', () => ({
    get MEASURE() {
        return flag.measure
    },
}))

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

// The alert store of the world tests: the real `alert.ts` writes it, the test reads and clears it.
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: {} },
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        botMakerMode: writable(false),
        loadedStore: writable(false),
        LoadingStatusState: { text: '' },
        ReloadGUIPointer: writable(0),
        bodyIntercepterStore: writable(null),
        savingStoppedReason: writable(''),
        frozenSaveKeysStore: writable([]),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('src/ts/alert', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/alert')>()),
    alertConfirm: vi.fn(async () => true),
}))

const inert = vi.hoisted(() => (): Record<string, unknown> => new Proxy({}, {
    has: () => true,
    get: (_target, name) => name === 'then' ? undefined : (name === 'alertStore' ? {} : () => undefined),
}))
vi.mock('src/ts/process/coldstorage.svelte', inert)
vi.mock('src/ts/drive/restoreReplace', inert)
vi.mock('src/ts/drive/backupWorkGuard', () => ({ refuseBackupLoadWhileBusy: () => false }))
vi.mock('src/ts/storage/store2/saveActive', () => ({ getActiveStore2Save: () => null }))
// The page's unit naming reads the platform at load; this stands in for the browser and Node naming.
vi.mock('src/ts/process/coldUnitLocation', () => ({
    coldUnitKeyOfStoreKey: (key: string) => {
        const name = key.slice('coldstorage/'.length)
        return key.startsWith('coldstorage/') && !name.includes('/') ? name : null
    },
}))

import { get } from 'svelte/store'
import { gzipSync } from 'fflate'
import * as risuSave from 'src/ts/storage/risuSave'
import { encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { alertConfirm } from 'src/ts/alert'
import { alertStore } from 'src/ts/stores.svelte'
import { indexBackupEntries, type BackupIndexEntry, type BinFile, type BinSlice } from 'src/ts/drive/backupContainer'
import { language } from 'src/lang'
import { createMemoryBackend, Store2BackendFailureError, type MemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { assembleDatabase } from 'src/ts/storage/store2/codec'
import { toPlainJson } from 'src/ts/storage/store2/codec/normalize'
import { classifyBoot } from 'src/ts/storage/store2/boot'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { readFenceVerdict } from 'src/ts/storage/store2/fence'
import { firstLifeGrant } from 'src/ts/storage/store2/firstLife'
import { keyOfRef, readUnit, UNIT_TYPE, type DeletionSnapshot, type Manifest } from 'src/ts/storage/store2/format'
import { createListDerivation } from 'src/ts/storage/store2/lists'
import { createBootImportTarget, type BootImportEnd, type BootImportEntry, type BootImportTarget } from 'src/ts/storage/store2/legacy/bootImport'
import type { IncompleteItem } from 'src/ts/storage/store2/legacy/resolve'
import type { ColdUnitRead } from 'src/ts/storage/store2/legacy/storeReader'
import { freshOwnerId } from 'src/ts/storage/store2/owner'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { coldStorageHeader } from 'src/ts/process/coldstorageData'
import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { commitBootImport, createBinImportReader, readBinDatabaseTree, scanBinForImport } from '../storeImport'
import type { ImportPhaseRingHandle } from '../importPhaseRing'
import { hooked, parsedCommit, type Hooks } from 'src/ts/storage/tests/store2/commitFixtures'
import { createClock as storeClock, testEnv as storeEnv } from 'src/ts/storage/tests/store2SaveKit'
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
type RingGlobal = { __risuImportPhases?: ImportPhaseRingHandle }
const phases = (): string[] => (globalThis as RingGlobal).__risuImportPhases?.snapshot().map((record) => record.phase) ?? []

beforeEach(() => {
    flag.measure = true
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-import' ? 'on' : null })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'info').mockImplementation(() => { })
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    vi.mocked(alertConfirm).mockReset()
    vi.mocked(alertConfirm).mockImplementation(async () => true)
    alertStore.set({ type: 'none', msg: '' })
})

afterEach(() => {
    const ring = (globalThis as RingGlobal).__risuImportPhases
    if (typeof ring?.reset === 'function') {
        ring.reset()
    }
    delete (globalThis as RingGlobal).__risuImportPhases
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

// ---- fixtures ----

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

function chunk(name: string, data: Uint8Array): Uint8Array {
    const nameBytes = encoder.encode(name)
    return concat(u32le(nameBytes.length), nameBytes, u32le(data.length), data)
}

const coldEntry = (id: string, value: unknown): Uint8Array => chunk(`coldstorage_${id}.json`, encoder.encode(JSON.stringify(value)))

type Obj = Record<string, unknown>
type Library = { characters: Obj[] } & Obj

function library(count: number): Library {
    return buildLibrary({ seed: 7, characters: count, chatsPerCharacter: 2, messagesPerChat: 2, modules: 0, archiveCharacters: false, nonChatScale: 0.02 }) as Library
}

const COLD_A = '00000000-0000-4000-8000-0000000000a1'
const COLD_B = '00000000-0000-4000-8000-0000000000a2'

const plainChat = (id: string, text: string): Obj => ({ id, message: [{ time: T, data: text, role: 'char' }], note: '', name: '', localLore: [] })

function stubCharacter(chaId: string, unit: string): Obj {
    return {
        type: 'character', chaId, name: `Stub ${chaId}`, chatPage: 0, firstMsgIndex: 0, coldstorage: unit, coldStoragedChats: [],
        chats: [{ message: [{ time: T, data: '', role: 'char' }], note: '', name: '', localLore: [] }],
    }
}

const stubUnit = (chaId: string): unknown => ({ character: { chaId, name: `Stub ${chaId}`, type: 'character', chatPage: 0, chats: [plainChat(`${chaId}-chat`, 'archived hello')] } })

const pointerCharacter = (chaId: string, unit: string): Obj => ({
    type: 'character', chaId, name: `Pointer ${chaId}`, chatPage: 0,
    chats: [plainChat(`${chaId}-a`, 'inline'), { message: [{ time: T, data: coldStorageHeader + unit, role: 'char' }], note: '', name: '', localLore: [] }],
})

const dbContainer = (db: unknown, ...cold: Uint8Array[]): Uint8Array => concat(chunk(ENTRY_NAME, encodeRisuSaveLegacy(db, 'compression')), ...cold)

const V0 = { config: 0, root: 1, preset: 4, modules: 5, character: 7, plugins: 9, loadouts: 10, pluginStorage: 11 } as const

function v0Block(type: number, name: string, value: unknown, gzip: boolean): Uint8Array {
    const nameBytes = encoder.encode(name)
    const raw = encoder.encode(JSON.stringify(value))
    const data = gzip ? gzipSync(raw, { mtime: 0 }) : raw
    return concat(Uint8Array.of(type, gzip ? 1 : 0, nameBytes.length), nameBytes, u32le(data.length), data)
}

function v0Database(db: Library): Uint8Array {
    const blocks: Array<{ type: number, name: string, value: unknown }> = db.characters.map((character) => ({ type: V0.character, name: String(character.chaId), value: character }))
    blocks.push(
        { type: V0.preset, name: 'preset', value: db.botPresets },
        { type: V0.modules, name: 'modules', value: [] },
        { type: V0.loadouts, name: 'loadouts', value: [] },
        { type: V0.plugins, name: 'plugins', value: [] },
        { type: V0.pluginStorage, name: 'pluginStorage', value: {} },
        { type: V0.config, name: 'config', value: {} },
    )
    return concat(
        encoder.encode('RISUSAVE\0'),
        ...blocks.map((block) => v0Block(block.type, block.name, block.value, true)),
        v0Block(V0.root, 'root', { characterOrder: [], personas: [], __directory: blocks.map((block) => block.name) }, false),
    )
}

interface FileOptions {
    shortFrom?: number
}

interface Opened {
    file: BinFile
    entry: BackupIndexEntry
    index: ReturnType<typeof scanBinForImport>['index']
    set(bytes: Uint8Array): void
    options: FileOptions
    dataStart: number
}

async function open(container: Uint8Array): Promise<Opened> {
    let current = container
    const options: FileOptions = {}
    const sliceOf = (start: number, end: number): BinSlice => ({
        size: end - start,
        slice: (from: number, to?: number) => sliceOf(start + from, to === undefined ? end : start + to),
        arrayBuffer: async () => {
            const stop = options.shortFrom !== undefined && start >= options.shortFrom && end - start > 1 ? end - 1 : end
            return current.slice(start, Math.min(stop, current.length)).slice().buffer
        },
    })
    const file: BinFile = { size: container.length, slice: (start: number, end?: number) => sliceOf(start, end ?? container.length) }
    const walked = await indexBackupEntries(file)
    const scan = scanBinForImport(walked.entries, walked.names)
    if (scan.database === null) {
        throw new Error('The fixture holds no database entry.')
    }
    return { file, entry: scan.database, index: scan.index, set: (bytes) => { current = bytes }, options, dataStart: scan.database.headerOffset + scan.database.headerLength }
}

// ---- the boot rig ----

const MAIN = 'database/database.bin'
const backupKey = (time: number) => `database/dbbackup-${time}.bin`

interface Rig {
    memory: MemoryBackend
    store: MemoryByteStore
    backend: Store2Backend
    target: BootImportTarget
    entry: BootImportEntry
    /** Switches on the failure the test injects into the lists the codec reads, once the marker stands. */
    armLists: { value: boolean }
}

interface RigOptions {
    mainFile?: boolean
    backups?: number[]
    fork?: boolean
    entry?: 'first-life' | 'exit'
    before?: Hooks['before']
    /** Makes the codec's own list derivation throw a `TypeError` for a character, once armed. */
    breakLists?: boolean
}

async function rig(options: RigOptions = {}): Promise<Rig> {
    const memory = createMemoryBackend()
    const store = createMemoryByteStore()
    if (options.mainFile === true) {
        store.files.set(MAIN, new Uint8Array([1, 2, 3]))
    }
    for (const time of options.backups ?? []) {
        store.files.set(backupKey(time), new Uint8Array([1]))
    }
    if (options.fork === true) {
        for (const key of ['blocks/head', 'blocks/000000000001-aaaaaaaa/root', 'database/database.pre-blocks.1']) {
            store.files.set(key, new Uint8Array([1]))
        }
    }
    const armLists = { value: false }
    const backend = hooked(memory, { before: options.before }).backend
    const commitRead = await memory.readCommit()
    let entry: BootImportEntry
    if (options.entry === 'exit') {
        entry = { kind: 'exit', commitRead }
    } else {
        const granted = firstLifeGrant({ decision: { row: 1, mode: 'first-life', action: 'seed' }, commitRead, startupClear: null }, { label: 'import' })
        if (granted.status !== 'granted') {
            throw new Error('No first-life grant.')
        }
        entry = { kind: 'first-life', grant: granted.grant }
    }
    const real = createListDerivation()
    const lists = options.breakLists === true
        ? { ...real, characterAssets: ((...args: Parameters<typeof real.characterAssets>) => {
            if (armLists.value) {
                throw new TypeError('lists broke')
            }
            return real.characterAssets(...args)
        }) as typeof real.characterAssets }
        : real
    const target = createBootImportTarget({
        backend,
        entry,
        owner: freshOwnerId(storeEnv(storeClock(), 1)),
        lists,
        env: storeEnv(storeClock(), 4242),
        oldData: {
            store,
            listBackupTimes: async () => [...store.files.keys()]
                .map((key) => /^database\/dbbackup-(\d+)\.bin$/.exec(key))
                .filter((match): match is RegExpExecArray => match !== null)
                .map((match) => Number(match[1]))
                .sort((a, b) => b - a),
        },
        upstreamMainFile: async () => store.files.has(MAIN),
    }, async () => ({ status: 'missing' }))
    return { memory, store, backend, target, entry, armLists }
}

interface BootRun {
    promise: Promise<BootImportEnd>
    rig: Rig
    opened: Opened
    verdicts: string[]
    accepted: IncompleteItem[][]
}

interface BootRunOptions extends RigOptions {
    stream?: false | { minUnits?: number }
    fallback?: (key: string) => Promise<ColdUnitRead>
    omitted?: ReadonlyMap<string, risuSave.SalvageOmittedBlock>
    /** Runs at the first compare-and-write of the commit key: the marker, after the first read of the entry. */
    onMarker?: (run: BootRun) => void
}

async function startBoot(container: Uint8Array, options: BootRunOptions = {}): Promise<BootRun> {
    const opened = await open(container)
    const holder: { run: BootRun | null } = { run: null }
    const built = await rig({
        ...options,
        before: async (name, count) => {
            if (name === 'casCommit' && count === 1) {
                if (built.armLists.value === false) {
                    built.armLists.value = true
                }
                if (holder.run !== null) {
                    options.onMarker?.(holder.run)
                }
            }
            await options.before?.(name, count)
        },
    })
    const omitted = options.omitted ?? new Map()
    const verdicts: string[] = []
    const accepted: IncompleteItem[][] = []
    const reader = createBinImportReader(opened.file, opened.index, async (key) => options.fallback?.(key) ?? { status: 'missing' })
    const run: BootRun = { promise: Promise.resolve({ kind: 'cancelled' }), rig: built, opened, verdicts, accepted }
    holder.run = run
    run.promise = commitBootImport({
        target: built.target,
        decode: () => readBinDatabaseTree(opened.file, opened.entry, omitted),
        reader,
        onAccepted: (items) => { accepted.push([...items]) },
        ...(options.stream === false ? {} : { stream: { file: opened.file, entry: opened.entry, omitted, minUnits: options.stream?.minUnits, onPrepared: (verdict: string) => { verdicts.push(verdict) } } }),
        yieldToMain: async () => { },
    })
    return run
}

const alertType = (): string => get(alertStore).type
const pendingFor = async (promise: Promise<unknown>, ms = 30): Promise<boolean> => await Promise.race([promise.then(() => false), new Promise<boolean>((resolve) => setTimeout(() => resolve(true), ms))])

async function currentManifest(memory: MemoryBackend): Promise<Manifest> {
    const key = (await parsedCommit(memory)).current
    if (key === null) {
        throw new Error('No manifest is current.')
    }
    const read = await readTreeBytes(memory, key.key)
    if (read.status !== 'ok') {
        throw new Error(`The stored tree reads ${read.status}.`)
    }
    return read.tree.manifest
}

async function readBack(memory: MemoryBackend): Promise<string> {
    const key = await parsedCommit(memory)
    const read = await readTreeBytes(memory, key.current?.key as string)
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

/** What the commit key and the store hold after a boot import that stopped under the marker. */
async function expectMarkerStanding(memory: MemoryBackend): Promise<void> {
    const key = await parsedCommit(memory)
    expect(key.current).toBeNull()
    expect(key.staging?.label).toBe('import')
    const staged = (await memory.listStore2()).filter((name) => name.includes(key.staging?.prefix as string))
    expect(staged.length).toBeGreaterThan(0)
    const decision = classifyBoot({
        commit: classifyCommitRead(await memory.readCommit()), fence: await readFenceVerdict(memory), presence: null, tree: null, upstreamMainFile: false,
        ownerId: 'someone-else', deviceOwner: false,
    })
    expect(decision).toMatchObject({ row: 11, label: 'import' })
}

// ---- T-D1b ----

describe('a streamed boot import installs what the whole path installs', () => {
    // New behaviour, pinned by mutants: first-life and exit, over a store that still holds old upstream files and a fork-format profile.
    test.each(['first-life', 'exit'] as const)('T-D1b (%s): the keep list, legacyKeep, snapshot unit and pointer, and convertedFrom equal the whole arm\'s', async (entry) => {
        const bytes = dbContainer(library(80))
        const results: Array<{ keep: unknown, files: unknown, snapshot: unknown, pointer: unknown, from: unknown, tree: string, verdicts: string[] }> = []
        for (const stream of [false, {}] as const) {
            const run = await startBoot(bytes, { entry, stream, mainFile: true, backups: [100, 200], fork: true })
            const end = await run.promise
            expect(end).toMatchObject({ kind: 'finished', result: { status: 'installed' } })
            const key = await parsedCommit(run.rig.memory)
            const manifest = await currentManifest(run.rig.memory)
            const keep = manifest.fixed.legacyKeep
            const keepUnit = readUnit(run.rig.memory.snapshot().get(keyOfRef(keep!.unit)) as Uint8Array, UNIT_TYPE.legacyList)
            const snapshotUnit = readUnit(run.rig.memory.snapshot().get(key.snapshot!.key) as Uint8Array, UNIT_TYPE.deletionSnapshot)
            results.push({
                keep: keepUnit.status === 'ok' ? keepUnit.value.body : null,
                files: keep?.files,
                snapshot: snapshotUnit.status === 'ok' ? (snapshotUnit.value.body as DeletionSnapshot) : null,
                pointer: { count: key.snapshot?.count },
                from: key.convertedFrom,
                tree: await readBack(run.rig.memory),
                verdicts: run.verdicts,
            })
        }

        expect(results[1].verdicts).toEqual(['stream'])
        expect((results[0].files as Array<{ key: string, status: string }>).map((file) => `${file.key}:${file.status}`).sort()).toEqual([
            `${MAIN}:unreadable`, `${backupKey(100)}:unreadable`, `${backupKey(200)}:unreadable`,
        ])
        expect(results[0].from).toBe('import')
        expect(results[1].keep).toEqual(results[0].keep)
        expect(results[1].files).toEqual(results[0].files)
        expect(results[1].snapshot).toEqual(results[0].snapshot)
        expect(results[1].pointer).toEqual(results[0].pointer)
        expect(results[1].from).toEqual(results[0].from)
        expect(results[1].tree).toBe(results[0].tree)
    })
})

// ---- T-D9 ----

const fileChanged = language.backupFileChangedWhileReading

describe('a boot import whose second read finds the file changed keeps the marker and waits for the notice', () => {
    /** Runs `run` to the point where it holds on the alert it showed, checks what stands, and lets it go. */
    async function expectHeldOnNotice(run: BootRun, text: string): Promise<void> {
        // The promise is still pending a macrotask after the failure: the dispatch must not clear the store under the notice.
        while (alertType() !== 'error') {
            await new Promise((resolve) => setTimeout(resolve, 5))
        }
        expect(get(alertStore)).toMatchObject({ type: 'error', msg: text })
        expect(await pendingFor(run.promise)).toBe(true)
        await expectMarkerStanding(run.rig.memory)
        alertStore.set({ type: 'none', msg: '' })
        expect(await run.promise).toEqual({ kind: 'finished', result: { status: 'reclassify' } })
    }

    test.each(['first-life', 'exit'] as const)('T-D9 (i, %s): a v0 block swapped between the passes shows the file-changed text and ends reclassify', async (entry) => {
        const a = chunk(ENTRY_NAME, v0Database(library(70)))
        let b: Uint8Array | null = null
        for (let n = 0; n < 400 && b === null; n++) {
            const changed = library(70)
            changed.characters[40] = { ...changed.characters[40], lastInteraction: T + 40_000 + 1 + n }
            const candidate = chunk(ENTRY_NAME, v0Database(changed))
            b = candidate.length === a.length ? candidate : null
        }
        expect(b).not.toBeNull()
        const run = await startBoot(a, { entry, onMarker: (started) => started.opened.set(b as Uint8Array) })

        await expectHeldOnNotice(run, fileChanged)
        expect(run.verdicts).toEqual(['stream'])
    })

    test('T-D9 (i): a cold entry changed while the install resolves it shows the file-changed text and ends reclassify', async () => {
        const db = library(70)
        db.characters.push(stubCharacter('stub-cold', COLD_A))
        const bytes = dbContainer(db, coldEntry(COLD_A, stubUnit('stub-cold')))
        const changed = dbContainer(db, coldEntry(COLD_A, { ...(stubUnit('stub-cold') as Obj), padding: 'longer than the walk saw' }))
        const run = await startBoot(bytes, { onMarker: (started) => started.opened.set(changed) })

        await expectHeldOnNotice(run, fileChanged)
    })

    test('T-D9 (ii): the page\'s own reader failing in the install shows the read-failed text and ends reclassify', async () => {
        const db = library(70)
        db.characters.push(stubCharacter('stub-fb', COLD_B))
        const state = { marked: false }
        const run = await startBoot(dbContainer(db), {
            onMarker: () => { state.marked = true },
            fallback: async () => state.marked ? { status: 'error', error: new Error('disk') } : { status: 'ok', value: stubUnit('stub-fb') },
        })

        await expectHeldOnNotice(run, language.store2ImportReadFailed)
    })

    test('T-D9 (iii): 59 units or fewer with a missing cold unit: asked once, accepted once, the whole path decoded, installed', async () => {
        const db = library(1)
        db.characters.push(stubCharacter('stub-iii', COLD_A))
        const run = await startBoot(dbContainer(db))

        expect(await run.promise).toMatchObject({ kind: 'finished', result: { status: 'installed' } })
        expect(run.verdicts).toEqual(['whole'])
        expect(vi.mocked(alertConfirm)).toHaveBeenCalledTimes(1)
        expect(run.accepted).toHaveLength(1)
        expect(phases()).toContain('decoded, boot')
        expect(phases().some((phase) => phase.startsWith('import stream prepared'))).toBe(false)
    })

    test('T-D9 (iv): over 59 units with a missing cold unit: asked once, streamed, installed', async () => {
        const db = library(70)
        db.characters.push(stubCharacter('stub-iv', COLD_A))
        const run = await startBoot(dbContainer(db))

        expect(await run.promise).toMatchObject({ kind: 'finished', result: { status: 'installed' } })
        expect(run.verdicts).toEqual(['stream'])
        expect(vi.mocked(alertConfirm)).toHaveBeenCalledTimes(1)
        expect(run.accepted).toHaveLength(1)
        expect(phases().some((phase) => phase.startsWith('import stream prepared'))).toBe(true)
        expect((await parsedCommit(run.rig.memory)).current).not.toBeNull()
    })

    test('T-D9 (v): a codec TypeError in the install rejects with that TypeError and shows no alert', async () => {
        const run = await startBoot(dbContainer(library(70)), { breakLists: true })

        await expect(run.promise).rejects.toThrow('lists broke')
        expect(alertType()).toBe('none')
    })

    // New behaviour: a device failure of an upload is a blocked boot, not a changed file, and nothing waits on the alert store.
    test('T-D9 (vi): a put that fails at a character is blocked/install-upload-failed, with no error alert and no wait on the alert store', async () => {
        let puts = 0
        const run = await startBoot(dbContainer(library(70)), {
            before: (name) => { if (name === 'putUnit' && ++puts === 7) { throw new Store2BackendFailureError('the device failed') } },
        })

        expect(await Promise.race([run.promise, new Promise((resolve) => setTimeout(() => resolve('held'), 3000))])).toEqual({
            kind: 'finished', result: { status: 'blocked', reason: 'install-upload-failed', detail: expect.any(String) },
        })
        expect(alertType()).toBe('none')
        expect(run.verdicts).toEqual(['stream'])
    })

    test('T-A6 (boot): a short chunk is cancelled with the file-changed alert, and nothing is decoded whole', async () => {
        const bytes = dbContainer(library(70))
        const opened = await open(bytes)
        opened.options.shortFrom = opened.dataStart
        const decodeSpy = vi.spyOn(risuSave, 'decodeRisuSave')
        const salvageSpy = vi.spyOn(risuSave, 'salvageRisuSave')
        const built = await rig()
        const omitted = new Map()
        const end = await commitBootImport({
            target: built.target,
            decode: () => readBinDatabaseTree(opened.file, opened.entry, omitted),
            reader: createBinImportReader(opened.file, opened.index, async () => ({ status: 'missing' })),
            stream: { file: opened.file, entry: opened.entry, omitted },
            yieldToMain: async () => { },
        })

        expect(end).toEqual({ kind: 'cancelled' })
        expect(get(alertStore)).toMatchObject({ type: 'error', msg: fileChanged })
        expect(decodeSpy).not.toHaveBeenCalled()
        expect(salvageSpy).not.toHaveBeenCalled()
        expect((await parsedCommit(built.memory).catch(() => null))).toBeNull()
    })
})
