// @vitest-environment happy-dom
/**
 * The `side.chromemory-vectors` row of an `.rtb` file: the store adapter (read and restore), the real persist writer
 * through the real file writer and back, the sealed envelope, an old reader, and the whole-file rules (absent row,
 * settings-only file). Stores are in-memory byte stores; the page store and the native directories are not exercised
 * here (the native key set has its own fixture tests).
 *
 * Labels: G3, G4, G2, G5 and G11 are guards of a new contract (no pre-fix base exists); each turns red on a named
 * scratch mutant, not on a pre-fix run.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    db: { ltmEngine: true as boolean | undefined, ltmSettings: { retrieval: 'hybrid' } as unknown },
    store: null as unknown,
}))
vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: () => h.db, appVer: '9.9.9' }))
vi.mock('src/ts/storage/store/appStore', () => ({
    getAppStore: async () => {
        if (h.store === null) throw new Error('This page has no storage.')
        if (h.store === 'broken') throw new Error('the store could not be selected')
        return h.store
    },
}))

import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { VECTORS_ID, SIDE_SECTION_IDS, type SideSectionId } from 'src/ts/drive/rtb/entryNames'
import { parseManifest } from 'src/ts/drive/rtb/manifest'
import type { RangeSource } from 'src/ts/drive/rtb/rangeSource'
import { classifyRtb } from 'src/ts/drive/rtb/rtbClassify'
import { verifyRtb } from 'src/ts/drive/rtb/rtbVerify'
import { writeRtb, type SideInput } from 'src/ts/drive/rtb/rtbWriter'
import { nobleAead } from 'src/ts/drive/rtb/sealed/aead'
import { openSealedRtb } from 'src/ts/drive/rtb/sealed/decryptingSource'
import { prepareSeal } from 'src/ts/drive/rtb/sealed/sealWriter'
import { parseSectionTable, type SectionRow } from 'src/ts/drive/rtb/sections'
import { decideSideSection, decideSideSections } from 'src/ts/drive/rtb/sideDecision'
import { encodeSideLine } from 'src/ts/drive/rtb/sideLines'
import { VECTORS_KEY_PREFIX, VECTORS_MAX_RECORD_BYTES } from 'src/ts/drive/rtb/sideStoreConfig'
import {
    applySideAction,
    readSideStore,
    type SideBackends,
    type SideBodyReader,
    type SideRestoreResult,
} from 'src/ts/drive/rtb/sideStores'
import { prepareSideValue, RTB_SIDE_TAGS } from 'src/ts/drive/rtb/sideTags'
import { readDirectory, readEntry } from 'src/ts/drive/rtb/zip64Reader'
import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import type { IndexedUnit } from 'src/ts/process/memory/chroMemory/chatIndex'
import { DenseStore } from 'src/ts/process/memory/chroMemory/dense'
import {
    MAGIC,
    MAX_RECORD_BYTES,
    PREFIX,
    chatKeyOf,
    flushVectorPersist,
    loadPersisted,
    requestPersist,
    resetVectorPersistForTests,
    segOf,
} from 'src/ts/process/memory/chroMemory/vectorPersist'
import { classifyRtb as classifyOld } from './oldReader/rtbClassify'
import { SegmentSink } from './segmentSink'
import { settingsFile } from './settingsFileKit'
import { rangeSourceOfBytes } from './sparseSource'

const CREATED = Date.UTC(2024, 1, 3, 4, 5, 6)
const encoder = new TextEncoder()
const MODEL = 'modelA|u|c|tag'
const OWNER = 'cha-1'

async function* iterate<T>(items: readonly T[]): AsyncGenerator<T> {
    for (const item of items) {
        yield item
    }
}

let source: MemoryByteStore

beforeEach(() => {
    source = createMemoryByteStore()
    h.store = source
    h.db = { ltmEngine: true, ltmSettings: { retrieval: 'hybrid' } }
    setPageStorageMode({ kind: 'store2' })
    resetVectorPersistForTests()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

afterEach(() => {
    h.store = null
    resetPageStorageModeForTests()
    resetVectorPersistForTests()
    vi.restoreAllMocks()
})

/** The vectors adapter reads and writes `store`; the other stores are not part of these tests. */
function backendsOver(store: MemoryByteStore): SideBackends {
    return {
        forage: () => { throw new Error('no forage store here') },
        local: () => { throw new Error('no local storage here') },
        vectors: async () => store,
    }
}

function unit(i: number): IndexedUnit {
    return { key: `rec${i}\u0000hash${i}`, ordinal: 0, off: 0, text: `text number ${i}` }
}

function vecOf(i: number, dim: number): Float32Array {
    return Float32Array.from({ length: dim }, (_, d) => ((i * 31 + d * 7) % 97) / 97 + 0.01)
}

/** Persists `n` units of a chat through the real writer into the page store (`source`). */
async function persistChat(chat: string, n: number, dim = 8): Promise<string> {
    const store = new DenseStore()
    store.bindPersist({ chaId: OWNER, chatId: chat })
    store.useModel(MODEL)
    for (let i = 0; i < n; i++) {
        store.set(unit(i), vecOf(i, dim))
    }
    requestPersist(store)
    await flushVectorPersist()
    return segOf(chatKeyOf(OWNER, chat))
}

function vectorFiles(store: MemoryByteStore): Map<string, string> {
    return new Map([...store.files].filter(([key]) => key.startsWith(PREFIX)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, bytes]) => [key, Buffer.from(bytes).toString('base64')]))
}

async function fileOf(sides: Record<string, SideInput>): Promise<SegmentSink> {
    const out = new SegmentSink()
    await writeRtb({
        sink: out,
        clock: () => CREATED,
        keyEnv: { random: (n) => Uint8Array.from({ length: n }, (_, i) => (i * 11 + 5) & 255), now: () => CREATED },
        writer: { app: 'risutanium', version: '1.0.0', build: 'test' },
        source: { device: { label: 'pc', platform: 'web' }, committedAt: CREATED - 1000, unsavedExcluded: false },
        store2: { units: iterate([]), root: ['t0', 40, 7], req: [], refs: [] },
        sides,
        sideTags: RTB_SIDE_TAGS,
    })
    return out
}

async function exportedFile(store: MemoryByteStore): Promise<Uint8Array> {
    const input = await readSideStore(VECTORS_ID, backendsOver(store))
    return (await fileOf({ [VECTORS_ID]: input })).toBytes()
}

/** Restores every side section of a file into `store` as the finish does, and returns the vectors result. */
async function restoreVectors(file: RangeSource, store: MemoryByteStore): Promise<SideRestoreResult> {
    const walk = await readDirectory(file)
    const index = walk.index
    if (!index) {
        throw new Error('no index')
    }
    const entry = (name: string): number => {
        for (let i = 0; i < index.count; i++) {
            if (index.entry(i).name === name) {
                return i
            }
        }
        throw new Error(`no entry ${name}`)
    }
    const parts: Uint8Array[] = []
    await readEntry(file, index, entry('manifest.json'), (chunk) => {
        parts.push(chunk.slice())
    })
    const manifest = parseManifest(Uint8Array.from(parts.flatMap((p) => [...p])))
    if (manifest.kind !== 'ok') {
        throw new Error('manifest')
    }
    const table = parseSectionTable(manifest.manifest.sections)
    if (table.kind !== 'ok') {
        throw new Error('table')
    }
    const action = decideSideSections(table.rows, manifest.manifest.omitted).find((candidate) => candidate.id === VECTORS_ID)
    if (action === undefined) {
        throw new Error('no vectors action')
    }
    const body: SideBodyReader | null = action.kind === 'restore'
        ? (sink) => readEntry(file, index, entry('s/chromemory-vectors/data.jsonl'), sink).then((r): Awaited<ReturnType<SideBodyReader>> => ('finding' in r ? { ok: false, reason: r.finding.detail } : { ok: true }))
        : null
    return applySideAction(action, body, backendsOver(store))
}

function readerOf(text: string): SideBodyReader {
    const bytes = encoder.encode(text)
    return async (sink) => {
        await sink(bytes)
        return { ok: true }
    }
}

function row(id: SideSectionId): SectionRow {
    return { id, v: 1, required: false, prefix: `s/${id.slice(5)}/`, entries: 1, bytes: 0, meta: null }
}

async function lineOf(key: string, bytes: Uint8Array | string): Promise<string> {
    const value = typeof bytes === 'string' ? bytes : await prepareSideValue(bytes)
    return new TextDecoder().decode(encodeSideLine(key, value, RTB_SIDE_TAGS))
}

async function seedWorld(): Promise<{ seg: string, foreignSeg: string }> {
    const seg = await persistChat('chat-1', 20)
    await persistChat('chat-2', 5)
    const foreignSeg = 'foreignseg'
    source.files.set(`${PREFIX}${foreignSeg}/head`, encoder.encode(JSON.stringify({ f: MAGIC, v: 2, next: { shape: 'unknown' } })))
    source.files.set(`${PREFIX}${foreignSeg}/c1`, Uint8Array.of(9, 8, 7, 6))
    source.files.set(`${PREFIX}${seg}/x1`, Uint8Array.of(1, 1, 2, 3))
    return { seg, foreignSeg }
}

describe('the constants the adapter shares with the cache', () => {
    test('the adapter prefix and record bound are the cache engine\'s (guard; a drift orphans every restored folder)', () => {
        expect(VECTORS_KEY_PREFIX).toBe(PREFIX)
        expect(VECTORS_MAX_RECORD_BYTES).toBe(MAX_RECORD_BYTES)
    })
})

describe('reading the vector folders (S5)', () => {
    test('records are sorted, relative to the prefix, bytes, and read lazily; a vanished key is skipped', async () => {
        source.files.set(`${PREFIX}b/head`, Uint8Array.of(2))
        source.files.set(`${PREFIX}a/c2`, Uint8Array.of(1))
        source.files.set(`${PREFIX}a/c1`, Uint8Array.of(0))
        source.files.set('database/other', Uint8Array.of(7))
        const list = source.list.bind(source)
        source.list = async (prefix) => [...await list(prefix), `${PREFIX}gone/c1`]
        const input = await readSideStore(VECTORS_ID, backendsOver(source))
        expect(source.reads).toEqual([])
        if ('unreadable' in input) {
            throw new Error('unreadable')
        }
        const seen: string[] = []
        for await (const record of input.records) {
            seen.push(record.key)
        }
        expect(seen).toEqual(['a/c1', 'a/c2', 'b/head'])
        expect(source.reads).not.toContain('database/other')
    })

    test('a failing list makes the row unreadable', async () => {
        source.list = async () => { throw new Error('the listing failed') }
        expect(await readSideStore(VECTORS_ID, backendsOver(source))).toEqual({ unreadable: true })
    })

    test('a page whose store cannot be selected has no vectors: an empty list, not an unreadable row', async () => {
        const bare: SideBackends = { forage: () => { throw new Error('x') }, local: () => { throw new Error('x') } }
        h.store = null
        const none = await readSideStore(VECTORS_ID, bare)
        if ('unreadable' in none) {
            throw new Error('a storeless page is not unreadable')
        }
        const keys: string[] = []
        for await (const record of none.records) {
            keys.push(record.key)
        }
        expect(keys).toEqual([])
        h.store = 'broken'
        const broken = await readSideStore(VECTORS_ID, bare)
        expect('unreadable' in broken).toBe(false)
    })
})

describe('the round trip of real persisted folders (G3)', () => {
    test('persist, export, restore into a fresh store gives equal bytes, a v2 head and an unknown sibling included; stale folders are gone', async () => {
        const { seg, foreignSeg } = await seedWorld()
        const before = vectorFiles(source)
        expect(before.has(`${PREFIX}${foreignSeg}/head`)).toBe(true)
        expect(before.has(`${PREFIX}${seg}/x1`)).toBe(true)

        const bytes = await exportedFile(source)
        const target = createMemoryByteStore()
        target.files.set(`${PREFIX}stale/head`, Uint8Array.of(1))
        target.files.set(`${PREFIX}${foreignSeg}/c9`, Uint8Array.of(5))
        target.files.set('database/untouched', Uint8Array.of(4))
        const result = await restoreVectors(rangeSourceOfBytes(bytes), target)

        expect(result).toMatchObject({ id: VECTORS_ID, status: 'ok', skipped: [] })
        expect(vectorFiles(target)).toEqual(before)
        expect(target.files.get('database/untouched')).toEqual(Uint8Array.of(4))

        h.store = target
        const loaded = await loadPersisted(target, { owner: OWNER, chat: 'chat-1', modelKey: MODEL })
        expect(loaded.kind).toBe('loaded')
        expect(loaded.rows).toHaveLength(20)
        expect(loaded.dropped).toBe(0)
    })

    test('G4: the same file sealed under a password restores to equal bytes through the real sealed open', async () => {
        await seedWorld()
        const before = vectorFiles(source)
        const aead = nobleAead()
        const kdf = async () => new Uint8Array(32).fill(9)
        const seal = await prepareSeal('correct horse', { m: 8, t: 1, chunkSize: 65_536 }, { kdf, aead })
        const out = new SegmentSink()
        const enc = seal.sink((chunk) => { out.write(chunk) })
        const input = await readSideStore(VECTORS_ID, backendsOver(source))
        await writeRtb({
            sink: enc,
            clock: () => CREATED,
            keyEnv: { random: (n) => Uint8Array.from({ length: n }, (_, i) => (i * 11 + 5) & 255), now: () => CREATED },
            writer: { app: 'risutanium', version: '1.0.0', build: 'test' },
            source: { device: { label: 'pc', platform: 'web' }, committedAt: CREATED - 1000, unsavedExcluded: false },
            store2: { units: iterate([]), root: ['t0', 40, 7], req: [], refs: [] },
            sides: { [VECTORS_ID]: input },
            sideTags: RTB_SIDE_TAGS,
        })
        await enc.finish()
        const opened = await openSealedRtb(rangeSourceOfBytes(out.toBytes()), { askPassword: async () => 'correct horse', kdf, aead })
        if (opened.kind !== 'open') {
            throw new Error(`the sealed file did not open: ${opened.detail}`)
        }
        const target = createMemoryByteStore()
        const result = await restoreVectors(opened.source, target)
        expect(result).toMatchObject({ status: 'ok' })
        expect(vectorFiles(target)).toEqual(before)
    })
})

describe('an old reader and the other rows (G2, G5)', () => {
    test('G2: a reader that does not know the row classifies the file ok and names the row as unknown optional', async () => {
        await seedWorld()
        const bytes = await exportedFile(source)
        const old = await classifyOld(rangeSourceOfBytes(bytes))
        expect(old.kind).toBe('ok')
        expect(old.kind === 'ok' && old.notice.unknownOptionalRows.map((unknownRow) => unknownRow.id)).toContain(VECTORS_ID)
        const current = await classifyRtb(rangeSourceOfBytes(bytes))
        expect(current.kind === 'ok' && current.notice.unknownOptionalRows).toEqual([])
    })

    test('G5: a file with no vectors row clears the store, and is named nothing', async () => {
        await seedWorld()
        const bytes = (await fileOf({})).toBytes()
        const target = createMemoryByteStore()
        target.files.set(`${PREFIX}old/head`, Uint8Array.of(1))
        target.files.set(`${PREFIX}foreign/head`, encoder.encode(JSON.stringify({ f: MAGIC, v: 2 })))
        const result = await restoreVectors(rangeSourceOfBytes(bytes), target)
        expect(result).toEqual({ id: VECTORS_ID, status: 'absent' })
        expect(vectorFiles(target).size).toBe(0)
    })

    test('a row of a newer version clears the store and is named newer', async () => {
        const target = createMemoryByteStore()
        target.files.set(`${PREFIX}old/head`, Uint8Array.of(1))
        const action = decideSideSection(VECTORS_ID, [{ ...row(VECTORS_ID), v: 2 }], [])
        expect(await applySideAction(action, null, backendsOver(target))).toEqual({ id: VECTORS_ID, status: 'newer', v: 2 })
        expect(vectorFiles(target).size).toBe(0)
    })

    test('an unreadable export is omitted and the target store is left alone', async () => {
        const target = createMemoryByteStore()
        target.files.set(`${PREFIX}keep/head`, Uint8Array.of(1))
        const action = decideSideSection(VECTORS_ID, [], [{ kind: 'side', name: VECTORS_ID, reason: 'unreadable' }])
        expect(await applySideAction(action, null, backendsOver(target))).toEqual({ id: VECTORS_ID, status: 'omitted', reason: 'unreadable' })
        expect(vectorFiles(target).size).toBe(1)
    })

    test('G5: a settings-only file carries no side verdict, so no side action is issued', async () => {
        const file = await settingsFile({ settings: [{ key: 'theme', value: 'x' }] })
        const verdict = await verifyRtb(file.source)
        expect(verdict.kind).toBe('settings')
        expect('side' in verdict).toBe(false)
    })

    test('the ten ids are all decided: the vectors row is the last action', () => {
        const actions = decideSideSections([], [])
        expect(actions.map((a) => a.id)).toEqual(SIDE_SECTION_IDS)
        expect(actions.at(-1)).toMatchObject({ id: VECTORS_ID, kind: 'clear', status: 'absent' })
    })
})

describe('what a restore accepts (G11)', () => {
    async function restoreText(text: string, target: MemoryByteStore): Promise<SideRestoreResult> {
        return applySideAction({ kind: 'restore', id: VECTORS_ID, row: row(VECTORS_ID) }, readerOf(text), backendsOver(target))
    }

    function seeded(): MemoryByteStore {
        const target = createMemoryByteStore()
        target.files.set(`${PREFIX}keep/head`, Uint8Array.of(1, 2, 3))
        return target
    }

    test('a bad key, a non-bytes value, an oversize record and a folder-vs-file pair each leave the store untouched as malformed', async () => {
        const cases: [string, string][] = [
            ['../x', await lineOf('../x', Uint8Array.of(1))],
            ['/x', await lineOf('/x', Uint8Array.of(1))],
            ['x', await lineOf('x', Uint8Array.of(1))],
            ['s/head', await lineOf('s/head', 'not bytes')],
            ['s/c1', await lineOf('s/c1', new Uint8Array(VECTORS_MAX_RECORD_BYTES + 1))],
            ['pair', (await lineOf('x/head', Uint8Array.of(1))) + (await lineOf('x/head/y', Uint8Array.of(2)))],
            ['file-with-folder-interleaved', (await lineOf('a', Uint8Array.of(1))) + (await lineOf('a-b/c1', Uint8Array.of(1))) + (await lineOf('a/c', Uint8Array.of(2)))],
        ]
        for (const [name, text] of cases) {
            const target = seeded()
            const before = vectorFiles(target)
            const result = await restoreText(text, target)
            expect(result.status, name).toBe('malformed')
            expect(vectorFiles(target), name).toEqual(before)
            expect(target.deletes, name).toEqual([])
        }
    })

    test('a record at the bound and a folder of head plus chunks are written verbatim after the old keys are cleared', async () => {
        const big = new Uint8Array(VECTORS_MAX_RECORD_BYTES).fill(7)
        const text = (await lineOf('s/c1', big)) + (await lineOf('s/head', Uint8Array.of(1, 2))) + (await lineOf('t/head', Uint8Array.of(3)))
        const target = seeded()
        const result = await restoreText(text, target)
        expect(result).toMatchObject({ status: 'ok', written: 3 })
        expect([...vectorFiles(target).keys()]).toEqual([`${PREFIX}s/c1`, `${PREFIX}s/head`, `${PREFIX}t/head`])
        expect(target.files.get(`${PREFIX}s/c1`)).toEqual(big)
        expect(target.files.has(`${PREFIX}keep/head`)).toBe(false)
    })
})
