// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    db: { ltmEngine: true as boolean | undefined, ltmSettings: { retrieval: 'hybrid' } as unknown },
    store: null as unknown,
}))
vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: () => h.db, appVer: '9.9.9' }))
// The real selector pulls the whole app's reactive state in; the byte store a page would resolve is what the tests inject.
vi.mock('src/ts/storage/store/appStore', () => ({
    getAppStore: async () => {
        if (h.store === null) throw new Error('This page has no storage.')
        return h.store
    },
}))

import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { nodeCreatableViolation, tauriCreatableViolation } from 'src/ts/storage/store/keyRules'
import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { recordKeysOf, type IndexedUnit } from '../chatIndex'
import { DenseStore } from '../dense'
import { rawHash, type MessageRecord } from '../records'
import {
    FOLDER_CAP,
    MAGIC,
    MAX_RECORD_BYTES,
    PREFIX,
    chatKeyOf,
    chunkKey,
    classifyHead,
    decodeChunk,
    deleteVectorFolder,
    dropVectorsUnlessWanted,
    encodeChunk,
    encodeHead,
    evictOverCap,
    flushVectorPersist,
    folderPrefix,
    headKey,
    holdVectorPersist,
    listFolders,
    loadPersisted,
    loadVectors,
    parseHead,
    requestDeleteFolder,
    requestPersist,
    resetVectorPersistForTests,
    segOf,
    unitsPerChunk,
    type VectorHead,
} from '../vectorPersist'

const MODEL = 'modelA|u|c|tag'
const OWNER = 'cha-1'
const CHAT = 'chat-1'

let mem: MemoryByteStore

function injectAppStore(store: MemoryByteStore | null): void {
    h.store = store
}

beforeEach(() => {
    mem = createMemoryByteStore()
    injectAppStore(mem)
    setPageStorageMode({ kind: 'store2' })
    resetVectorPersistForTests()
    h.db = { ltmEngine: true, ltmSettings: { retrieval: 'hybrid' } }
    setVisibility('visible')
})
afterEach(() => {
    injectAppStore(null)
    resetPageStorageModeForTests()
    resetVectorPersistForTests()
    setVisibility('visible')
    vi.useRealTimers()
    vi.restoreAllMocks()
})

function setVisibility(state: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
}

function vecOf(i: number, dim: number): Float32Array {
    return Float32Array.from({ length: dim }, (_, d) => ((i * 31 + d * 7) % 97) / 97 + 0.01)
}

function unit(i: number): IndexedUnit {
    return { key: `rec${i}\u0000hash${i}`, ordinal: 0, off: 0, text: `text number ${i}` }
}

function newStore(owner = OWNER, chat = CHAT, modelKey = MODEL): DenseStore {
    const s = new DenseStore()
    s.bindPersist({ chaId: owner, chatId: chat })
    s.useModel(modelKey)
    return s
}

function fill(s: DenseStore, n: number, dim = 8, from = 0): void {
    for (let i = from; i < from + n; i++) s.set(unit(i), vecOf(i, dim))
}

async function persist(s: DenseStore): Promise<void> {
    requestPersist(s)
    await flushVectorPersist()
}

const segOfChat = (owner = OWNER, chat = CHAT): string => segOf(chatKeyOf(owner, chat))
const folderKeys = (seg: string): string[] => [...mem.files.keys()].filter((k) => k.startsWith(folderPrefix(seg))).sort()

async function reload(owner = OWNER, chat = CHAT, modelKey = MODEL): Promise<DenseStore> {
    const s = newStore(owner, chat, modelKey)
    s.loaded = false
    await loadVectors(s)
    return s
}

function readHead(seg = segOfChat()): VectorHead | null {
    return parseHead(mem.files.get(headKey(seg)) ?? null)
}

function putHead(seg: string, over: Partial<VectorHead> = {}): void {
    const head: VectorHead = { f: MAGIC, v: 1, g: 1, w: 'x', owner: `o-${seg}`, chat: `c-${seg}`, model: 'm', label: 'l', dim: 4, chunks: [], at: 1, ...over }
    mem.files.set(headKey(seg), encodeHead(head))
}

describe('G17 the pinned derivations', () => {
    test('guard: rawHash and seg goldens for ASCII, Korean and non-BMP keys', () => {
        const cases: [string, string, string][] = [
            ['owner:chat', rawHash('owner:chat'), segOf('owner:chat')],
            ['한국어 소유자:대화', rawHash('한국어 소유자:대화'), segOf('한국어 소유자:대화')],
            ['😀owner:chat𝒳', rawHash('😀owner:chat𝒳'), segOf('😀owner:chat𝒳')],
        ]
        expect(cases.map((c) => [c[1], c[2]])).toEqual([
            ['10:d37f134:b7a857f8', '10-d37f134-b7a857f8'],
            ['10:49037fb0:8d81c5de', '10-49037fb0-8d81c5de'],
            ['14:9d4bd08d:e4586084', '14-9d4bd08d-e4586084'],
        ])
        for (const c of cases) expect(c[2]).not.toContain(':')
    })

    test('guard: the unit key is chatId, NUL, rawHash, with the duplicate number appended after another NUL', () => {
        const rec = (chatId: string, hash: string): MessageRecord => ({ chatId, index: 0, role: 'user', name: 'n', rawHash: hash, preWrap: '' })
        expect(recordKeysOf([rec('c1', 'h1'), rec('c1', 'h1'), rec('c2', 'h1'), rec('c1', 'h1')])).toEqual([
            'c1\u0000h1',
            'c1\u0000h1\u00001',
            'c2\u0000h1',
            'c1\u0000h1\u00002',
        ])
    })
})

describe('G12 keys and the empty target', () => {
    test('guard: random chat keys give creatable keys of at most 117 bytes on both platforms', () => {
        for (let i = 0; i < 200; i++) {
            const owner = `${Math.random().toString(36).slice(2)}-${i}`.repeat(1 + (i % 4))
            const chat = `c${'x'.repeat(i % 60)}${Math.random()}`
            const seg = segOf(chatKeyOf(owner, chat))
            for (const key of [headKey(seg), chunkKey(seg, 9_999_999_999)]) {
                expect(nodeCreatableViolation(key), key).toBeNull()
                expect(tauriCreatableViolation(key), key).toBeNull()
                expect(new TextEncoder().encode(key).length).toBeLessThanOrEqual(117)
            }
        }
    })

    test('an empty owner or chat persists nothing', async () => {
        for (const [owner, chat] of [['', CHAT], [OWNER, ''], ['', '']] as const) {
            const s = new DenseStore()
            s.bindPersist(owner === '' || chat === '' ? undefined : { chaId: owner, chatId: chat })
            s.useModel(MODEL)
            fill(s, 3)
            await persist(s)
        }
        expect(mem.writes).toEqual([])
    })
})

describe('the head classes', () => {
    const head = (over: Record<string, unknown> = {}): Uint8Array => new TextEncoder().encode(JSON.stringify({ f: MAGIC, v: 1, g: 1, w: 'x', owner: 'o', chat: 'c', model: 'm', label: 'l', dim: 4, chunks: [1], at: 5, ...over }))

    test('guard: a valid v1 head is readable and round-trips', () => {
        const cls = classifyHead(head())
        expect(cls.kind).toBe('readable')
        const parsed = parseHead(head())!
        expect(parseHead(encodeHead(parsed))).toEqual(parsed)
    })

    test('guard: a newer version is foreign, anything else invalid is damaged', () => {
        expect(classifyHead(head({ v: 2 })).kind).toBe('foreign')
        expect(classifyHead(head({ v: 7, dim: 'x', unknown: 1 })).kind).toBe('foreign')
        const damaged: (Uint8Array | null)[] = [
            null,
            new Uint8Array(0),
            new TextEncoder().encode('not json at all'),
            new TextEncoder().encode('[1,2]'),
            head({ f: 'other' }),
            head({ dim: 0 }),
            head({ dim: 9000 }),
            head({ dim: 1.5 }),
            head({ v: 0 }),
            head({ v: 1.5 }),
            head({ v: '2' }),
            head({ chunks: [0] }),
            head({ chunks: 'x' }),
            head({ g: -1 }),
            head({ owner: 3 }),
        ]
        for (const bytes of damaged) expect(classifyHead(bytes).kind).toBe('damaged')
    })
})

describe('G6 the loader validates every record', () => {
    async function persisted(n = 6, dim = 8): Promise<{ seg: string }> {
        const s = newStore()
        fill(s, n, dim)
        await persist(s)
        return { seg: segOfChat() }
    }

    test('guard: a persisted chat loads its vectors by unit and the text hash guards serving', async () => {
        await persisted(6)
        const s = await reload()
        expect(s.size).toBe(6)
        const u = unit(2)
        expect(s.get({ ...u, text: 'edited text' })).toBeUndefined()
        expect(Array.from(s.get(u)!)).toEqual(Array.from(vecOf(2, 8)))
        expect(s.get(unit(3))).toBeDefined()
        expect(s.persistedG).toBe(1)
    })

    test('guard: a model, owner or chat mismatch imports nothing', async () => {
        await persisted(4)
        expect((await reload(OWNER, CHAT, 'modelB|u|c|tag')).size).toBe(0)
        const head = readHead()!
        mem.files.set(headKey(segOfChat()), encodeHead({ ...head, chat: 'other' }))
        expect((await reload()).size).toBe(0)
        mem.files.set(headKey(segOfChat()), encodeHead({ ...head, owner: 'other' }))
        expect((await reload()).size).toBe(0)
    })

    test('guard: a chunk of another dim or model, or with bad bounds, is dropped and counted', async () => {
        const { seg } = await persisted(4)
        const good = mem.files.get(chunkKey(seg, 1))!
        const head = readHead()!
        const model = head.model
        const load = (): Promise<{ dropped: number, rows: number }> => loadPersisted(mem, { owner: OWNER, chat: CHAT, modelKey: MODEL }).then((r) => ({ dropped: r.dropped, rows: r.rows.length }))
        expect(await load()).toEqual({ dropped: 0, rows: 4 })
        const u = [unit(0)].map((x) => ({ key: x.key, ordinal: 0, textHash: rawHash(x.text), vec: vecOf(0, 5) }))
        mem.files.set(chunkKey(seg, 1), encodeChunk(model, 5, u))
        expect(await load()).toEqual({ dropped: 1, rows: 0 })
        mem.files.set(chunkKey(seg, 1), encodeChunk('other-model', 8, [{ ...u[0], vec: vecOf(0, 8) }]))
        expect((await load()).dropped).toBe(1)
        // The record names another width than its payload and the head: only the dim member tells it apart.
        const lies = good.slice()
        const meta = new TextDecoder().decode(lies.subarray(4, 4 + new DataView(lies.buffer).getUint32(0, true)))
        expect(meta).toContain('"dim":8')
        lies.set(new TextEncoder().encode(meta.replace('"dim":8', '"dim":5')), 4)
        mem.files.set(chunkKey(seg, 1), lies)
        expect((await load()).dropped).toBe(1)
        const hugeJ = good.slice()
        new DataView(hugeJ.buffer).setUint32(0, 1_048_577, true)
        mem.files.set(chunkKey(seg, 1), hugeJ)
        expect((await load()).dropped).toBe(1)
        const pastEnd = good.slice()
        new DataView(pastEnd.buffer).setUint32(0, good.length, true)
        mem.files.set(chunkKey(seg, 1), pastEnd)
        expect((await load()).dropped).toBe(1)
        mem.files.set(chunkKey(seg, 1), good.slice(0, good.length - 4))
        expect((await load()).dropped).toBe(1)
        mem.files.set(chunkKey(seg, 1), new Uint8Array(MAX_RECORD_BYTES + 1))
        expect((await load()).dropped).toBe(1)
        mem.files.set(chunkKey(seg, 1), new Uint8Array(2))
        expect((await load()).dropped).toBe(1)
        mem.files.set(chunkKey(seg, 1), good)
        expect(await load()).toEqual({ dropped: 0, rows: 4 })
    })

    test('guard: a non-finite vector drops only its unit', async () => {
        const { seg } = await persisted(4)
        const head = readHead()!
        const rows = [0, 1, 2].map((i) => ({ key: unit(i).key, ordinal: 0, textHash: rawHash(unit(i).text), vec: vecOf(i, 8) }))
        rows[1].vec = Float32Array.from(rows[1].vec)
        rows[1].vec[3] = Number.NaN
        mem.files.set(chunkKey(seg, 1), encodeChunk(head.model, 8, rows))
        const r = await loadPersisted(mem, { owner: OWNER, chat: CHAT, modelKey: MODEL })
        expect(r.dropped).toBe(0)
        expect(r.rows.map((x) => x.key)).toEqual([unit(0).key, unit(2).key])
    })

    test('guard: a missing chunk drops only that chunk and the rest loads', async () => {
        const dim = 3072
        const per = unitsPerChunk(dim)
        const s = newStore()
        fill(s, per + 3, dim)
        await persist(s)
        const seg = segOfChat()
        expect(readHead()!.chunks).toEqual([1, 2])
        mem.files.delete(chunkKey(seg, 1))
        const r = await loadPersisted(mem, { owner: OWNER, chat: CHAT, modelKey: MODEL })
        expect(r.dropped).toBe(1)
        expect(r.rows).toHaveLength(3)
        expect(r.chunks).toEqual([2])
    })

    test('guard: a rejected chunk read drops that chunk only', async () => {
        const { seg } = await persisted(3)
        mem.failRead = (key) => (key === chunkKey(seg, 1) ? new Error('read failed') : null)
        const r = await loadPersisted(mem, { owner: OWNER, chat: CHAT, modelKey: MODEL })
        expect(r.dropped).toBe(1)
        expect(r.rows).toHaveLength(0)
    })

    test('guard: the later chunk, and the later row within a chunk, wins', async () => {
        const { seg } = await persisted(2)
        const head = readHead()!
        const key = unit(0).key
        const rowA = { key, ordinal: 0, textHash: rawHash(unit(0).text), vec: vecOf(50, 8) }
        const rowB = { ...rowA, vec: vecOf(60, 8) }
        mem.files.set(chunkKey(seg, 2), encodeChunk(head.model, 8, [rowA, rowB]))
        mem.files.set(headKey(seg), encodeHead({ ...head, chunks: [1, 2] }))
        const r = await loadPersisted(mem, { owner: OWNER, chat: CHAT, modelKey: MODEL })
        const row = r.rows.find((x) => x.key === key)!
        expect(Array.from(row.vec)).toEqual(Array.from(vecOf(60, 8)))
        expect(row.seq).toBe(2)
    })
})

describe('G9 records stay under the cap at dim 3072', () => {
    test.each([1, 2])('guard: counts k*n and k*n+1 round-trip with every record at most 4 MiB (k = %i)', async (k) => {
        const dim = 3072
        const n = unitsPerChunk(dim)
        for (const count of [k * n, k * n + 1]) {
            mem = createMemoryByteStore()
            injectAppStore(mem)
            const s = newStore()
            fill(s, count, dim)
            await persist(s)
            const keys = folderKeys(segOfChat())
            expect(keys.length).toBeGreaterThan(1)
            for (const key of keys) expect(mem.files.get(key)!.length, key).toBeLessThanOrEqual(MAX_RECORD_BYTES)
            const r = await loadPersisted(mem, { owner: OWNER, chat: CHAT, modelKey: MODEL })
            expect(r.dropped).toBe(0)
            expect(r.rows).toHaveLength(count)
            expect(readHead()!.chunks).toHaveLength(Math.ceil(count / n))
        }
    })

    test('guard: encodeChunk and decodeChunk are inverse and the layout is padded to 4', () => {
        const rows = [0, 1].map((i) => ({ key: unit(i).key, ordinal: i, textHash: 'h', vec: vecOf(i, 5) }))
        const bytes = encodeChunk('m', 5, rows)
        const j = new DataView(bytes.buffer).getUint32(0, true)
        expect((4 + j) % 4).toBe(0)
        const back = decodeChunk(bytes, 'm', 5)!
        expect(back.map((r) => Array.from(r.vec))).toEqual(rows.map((r) => Array.from(r.vec)))
        expect(decodeChunk(bytes, 'm', 6)).toBeNull()
    })
})

describe('G7 newer and damaged heads', () => {
    test('guard: a newer head is kept byte-equal through persist, discard, drop and the cap', async () => {
        const seg = segOfChat()
        const v2 = new TextEncoder().encode(JSON.stringify({ f: MAGIC, v: 2, future: { a: 1 } }))
        mem.files.set(headKey(seg), v2)
        mem.files.set(chunkKey(seg, 1), new Uint8Array([1, 2, 3]))
        const before = new Map(mem.files)
        const s = newStore()
        fill(s, 3)
        await persist(s)
        await requestDeleteFolder(chatKeyOf(OWNER, CHAT))
        h.db.ltmEngine = false
        await dropVectorsUnlessWanted()
        await evictOverCap(mem, new Set(), 0)
        expect(new Map(mem.files)).toEqual(before)
        expect(mem.writes).toEqual([])
        expect(mem.deletes).toEqual([])
        expect(await deleteVectorFolder(mem, seg)).toBe(false)
    })

    test.each([
        ['empty', new Uint8Array(0)],
        ['garbage', new TextEncoder().encode('{{{')],
        ['wrong f', new TextEncoder().encode(JSON.stringify({ f: 'x', v: 1 }))],
        ['bad dim', new TextEncoder().encode(JSON.stringify({ f: MAGIC, v: 1, g: 1, w: '', owner: OWNER, chat: CHAT, model: 'm', label: 'l', dim: 0, chunks: [], at: 1 }))],
        ['v 0', new TextEncoder().encode(JSON.stringify({ f: MAGIC, v: 0 }))],
    ])('guard: a damaged head (%s) is overwritten, its old chunks reclaimed and a sibling kept', async (_name, bytes) => {
        const seg = segOfChat()
        mem.files.set(headKey(seg), bytes)
        mem.files.set(chunkKey(seg, 1), new Uint8Array([9]))
        mem.files.set(`${folderPrefix(seg)}x1`, new Uint8Array([7]))
        const s = newStore()
        fill(s, 3)
        await persist(s)
        const head = readHead()!
        expect(head.g).toBe(1)
        expect(head.chunks).toEqual([2])
        expect(mem.files.has(chunkKey(seg, 1))).toBe(false)
        expect(Array.from(mem.files.get(`${folderPrefix(seg)}x1`)!)).toEqual([7])
        expect((await reload()).size).toBe(3)
    })
})

describe('G13 a failed write or delete costs at most a re-embed', () => {
    async function scenario(k: number | null, steps: 'first' | 'compaction'): Promise<number> {
        mem = createMemoryByteStore()
        injectAppStore(mem)
        resetVectorPersistForTests()
        const s = newStore()
        const dim = 3072
        const n = unitsPerChunk(dim)
        const units = steps === 'first' ? n + 5 : 20
        fill(s, units, dim)
        await persist(s)
        if (steps === 'compaction') {
            fill(s, units, dim, 0)
            await persist(s)
            fill(s, units, dim, 0)
        }
        const baseline = readHead()?.g ?? 0
        let calls = 0
        const fail = (): Error | null => (k !== null && ++calls === k ? new Error('injected') : null)
        if (k !== null) {
            const base = mem.writes.length + mem.deletes.length
            void base
            mem.failWrite = () => fail()
            mem.failDelete = () => fail()
        } else {
            mem.failWrite = () => (calls++, null)
            mem.failDelete = () => (calls++, null)
        }
        if (steps === 'first') {
            // The first persist is the operation under test: start over with an empty folder.
            mem.files.clear()
            s.resetPersistMarks()
            calls = 0
        }
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        await persist(s)
        const loaded = await loadPersisted(mem, { owner: OWNER, chat: CHAT, modelKey: MODEL })
        expect(loaded.dropped, `k=${k}`).toBe(0)
        expect(['absent', 'loaded']).toContain(loaded.kind)
        if (steps === 'compaction') {
            expect(loaded.kind).toBe('loaded')
            expect(loaded.rows).toHaveLength(units)
            expect(readHead()!.g).toBeGreaterThanOrEqual(baseline)
        }
        return calls
    }

    test.each(['first', 'compaction'] as const)('guard: failing the k-th mutation of a %s persist leaves every listed chunk loadable', async (steps) => {
        const total = await scenario(null, steps)
        expect(total).toBeGreaterThan(2)
        for (let k = 1; k <= total + 1; k++) await scenario(k, steps)
    })

    test('guard: the head is written after the chunks and the replaced chunks are deleted last', async () => {
        const s = newStore()
        fill(s, 20)
        await persist(s)
        fill(s, 20)
        await persist(s)
        fill(s, 20)
        const seg = segOfChat()
        const writesBefore = mem.writes.length
        const deletesBefore = mem.deletes.length
        await persist(s)
        const newWrites = mem.writes.slice(writesBefore)
        expect(newWrites[newWrites.length - 1]).toBe(headKey(seg))
        expect(newWrites.slice(0, -1).every((key) => key.startsWith(`${PREFIX}${seg}/c`))).toBe(true)
        expect(mem.deletes.slice(deletesBefore)).toEqual([chunkKey(seg, 1), chunkKey(seg, 2)])
        expect(readHead()!.chunks).toEqual([3])
    })
})

describe('G21 concurrent writers', () => {
    test('guard: a head that moved aborts the persist and writes nothing', async () => {
        const s = newStore()
        fill(s, 3)
        await persist(s)
        const seg = segOfChat()
        const moved = { ...readHead()!, g: 9 }
        mem.files.set(headKey(seg), encodeHead(moved))
        const writes = mem.writes.length
        fill(s, 1, 8, 10)
        await persist(s)
        expect(mem.writes.length).toBe(writes)
        expect(readHead()!.g).toBe(9)
    })

    test('guard: a head that changes between the check and the head write aborts and leaves only orphans', async () => {
        const s = newStore()
        fill(s, 3)
        await persist(s)
        const seg = segOfChat()
        fill(s, 2, 8, 10)
        let headReads = 0
        mem.failRead = (key) => {
            if (key === headKey(seg) && ++headReads === 2) mem.files.set(headKey(seg), encodeHead({ ...readHead()!, g: 4 }))
            return null
        }
        await persist(s)
        mem.failRead = null
        expect(readHead()!.g).toBe(4)
        expect(readHead()!.chunks).toEqual([1])
        expect((await reload()).size).toBe(3)
    })

    test('guard: orphans below the head are compacted, a sibling and a chunk written meanwhile survive', async () => {
        const s = newStore()
        fill(s, 3)
        await persist(s)
        const seg = segOfChat()
        const c1 = mem.files.get(chunkKey(seg, 1))!
        for (let n = 2; n <= 21; n++) mem.files.set(chunkKey(seg, n), c1)
        mem.files.set(`${folderPrefix(seg)}x1`, new Uint8Array([1]))
        fill(s, 1, 8, 10)
        let headReads = 0
        mem.failRead = (key) => {
            if (key === headKey(seg) && ++headReads === 2) mem.files.set(chunkKey(seg, 5000), c1)
            return null
        }
        await persist(s)
        mem.failRead = null
        const names = folderKeys(seg).map((k) => k.slice(folderPrefix(seg).length))
        expect(names).toEqual(['c22', 'c5000', 'head', 'x1'].sort())
        expect(readHead()!.chunks).toEqual([22])
        expect((await reload()).size).toBe(4)
    })
})

describe('G20 the cap', () => {
    test('guard: nine readable folders and a foreign one evict the oldest readable, the foreign one is not counted', async () => {
        for (let i = 0; i < 8; i++) putHead(`seg${i}`, { at: 2000 + i })
        mem.files.set(headKey('foreign'), new TextEncoder().encode(JSON.stringify({ f: MAGIC, v: 3 })))
        mem.files.set(chunkKey('seg0', 1), new Uint8Array([1]))
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(90_000)
        const s = newStore()
        fill(s, 2)
        await persist(s)
        const segs = (await listFolders(mem)).map((f) => f.seg).sort()
        expect(segs).toEqual(['foreign', segOfChat(), 'seg1', 'seg2', 'seg3', 'seg4', 'seg5', 'seg6', 'seg7'].sort())
        expect(mem.files.has(chunkKey('seg0', 1))).toBe(false)
        expect(mem.files.has(headKey('foreign'))).toBe(true)
        expect((await listFolders(mem)).filter((f) => f.kind === 'readable')).toHaveLength(FOLDER_CAP)
    })

    test('guard: a folder of a live store is never evicted (G23c)', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(1000)
        const a = newStore('chaA', 'chatA')
        fill(a, 2)
        await persist(a)
        for (let i = 0; i < 7; i++) putHead(`seg${i}`, { at: 2000 + i })
        vi.setSystemTime(90_000)
        const b = newStore('chaB', 'chatB')
        fill(b, 2)
        await persist(b)
        const segs = (await listFolders(mem)).map((f) => f.seg)
        expect(segs).toContain(segOfChat('chaA', 'chatA'))
        expect(segs).toContain(segOfChat('chaB', 'chatB'))
        expect(segs).not.toContain('seg0')
        expect(segs).toHaveLength(FOLDER_CAP)
    })
})

describe('G23 the markers follow what is on disk', () => {
    test('guard: hybrid off drops the folder and the live store, hybrid on again rewrites the head and a reload embeds nothing', async () => {
        const s = newStore()
        fill(s, 4)
        await persist(s)
        const seg = segOfChat()
        expect(readHead()!.g).toBe(1)
        h.db.ltmSettings = { retrieval: 'lexical' }
        await dropVectorsUnlessWanted()
        expect(folderKeys(seg)).toEqual([])
        expect(s.persistedG).toBeNull()
        expect(s.hasUnpersisted()).toBe(true)
        h.db.ltmSettings = { retrieval: 'hybrid' }
        await persist(s)
        expect(readHead()!.g).toBe(1)
        const again = await reload()
        expect(again.size).toBe(4)
        expect(again.hasUnpersisted()).toBe(false)
    })

    test('guard: a folder deleted under a live store is rewritten whole at generation 1 with one head write', async () => {
        const s = newStore()
        fill(s, 4)
        await persist(s)
        const seg = segOfChat()
        for (const key of folderKeys(seg)) mem.files.delete(key)
        fill(s, 1, 8, 10)
        const before = mem.writes.length
        await persist(s)
        const head = readHead()!
        expect(head.g).toBe(1)
        expect(mem.writes.slice(before).filter((k) => k === headKey(seg))).toHaveLength(1)
        expect((await reload()).size).toBe(5)
    })

    test('guard: a snapshot taken before the dispose still persists, a plain request on the disposed store does not', async () => {
        const s = newStore()
        fill(s, 3)
        const rows = s.snapshot()
        s.dispose()
        requestPersist(s)
        await flushVectorPersist()
        expect(mem.writes).toEqual([])
        requestPersist(s, rows)
        await flushVectorPersist()
        expect(readHead()?.g).toBe(1)
        expect((await reload()).size).toBe(3)
    })

    test('guard: a persist with nothing unpersisted writes nothing', async () => {
        const s = newStore()
        fill(s, 4)
        await persist(s)
        const before = mem.writes.length
        await persist(s)
        expect(mem.writes.length).toBe(before)
    })

    test('guard: an edit of one unit is persisted by one more chunk, then a reload serves the edited unit', async () => {
        const s = newStore()
        fill(s, 5)
        await persist(s)
        s.set({ ...unit(1), text: 'edited' }, vecOf(77, 8))
        await persist(s)
        expect(readHead()!.chunks).toEqual([1, 2])
        const again = await reload()
        expect(Array.from(again.get({ ...unit(1), text: 'edited' })!)).toEqual(Array.from(vecOf(77, 8)))
        expect(again.get(unit(1))).toBeUndefined()
    })
})

describe('G10b and G16 the write gate', () => {
    test('guard: a persist during a hold writes nothing and runs on release', async () => {
        const s = newStore()
        fill(s, 3)
        const release = await holdVectorPersist()
        requestPersist(s)
        await flushVectorPersist()
        expect(mem.writes).toEqual([])
        release()
        await flushVectorPersist()
        expect(readHead()).not.toBeNull()
        release()
    })

    test('guard: a hold flushes the queued persist first', async () => {
        const s = newStore()
        fill(s, 3)
        requestPersist(s)
        const release = await holdVectorPersist()
        expect(readHead()).not.toBeNull()
        release()
    })

    test('guard: a read-only page, a hybrid-off profile and a page without a store write nothing', async () => {
        const s = newStore()
        fill(s, 3)
        setPageStorageMode({ kind: 'read-only', reason: 'older-version' } as never)
        await persist(s)
        expect(mem.writes).toEqual([])
        setPageStorageMode({ kind: 'store2' })
        h.db.ltmEngine = false
        await persist(s)
        expect(mem.writes).toEqual([])
        h.db.ltmEngine = true
        h.db.ltmSettings = { retrieval: 'lexical' }
        await persist(s)
        expect(mem.writes).toEqual([])
        h.db.ltmSettings = { retrieval: 'hybrid' }
        injectAppStore(null)
        await persist(s)
        expect(mem.writes).toEqual([])
    })

    test('guard: a hidden page writes nothing and the remembered request runs when it is visible again', async () => {
        const s = newStore()
        fill(s, 3)
        setVisibility('hidden')
        await persist(s)
        expect(mem.writes).toEqual([])
        setVisibility('visible')
        await flushVectorPersist()
        expect(readHead()).not.toBeNull()
    })

    test('guard: a discard while held is remembered and deletes on release', async () => {
        const s = newStore()
        fill(s, 3)
        await persist(s)
        const release = await holdVectorPersist()
        void requestDeleteFolder(chatKeyOf(OWNER, CHAT))
        await flushVectorPersist()
        expect(readHead()).not.toBeNull()
        release()
        await flushVectorPersist()
        expect(folderKeys(segOfChat())).toEqual([])
    })
})

describe('engine off', () => {
    test('guard: dropping deletes readable and damaged folders, keeps foreign ones and does nothing while the engine is on', async () => {
        putHead('good', { at: 1 })
        mem.files.set(chunkKey('good', 1), new Uint8Array([1]))
        mem.files.set(headKey('bad'), new Uint8Array([0]))
        mem.files.set(chunkKey('headless', 1), new Uint8Array([1]))
        const foreign = new TextEncoder().encode(JSON.stringify({ f: MAGIC, v: 2 }))
        mem.files.set(headKey('newer'), foreign)
        await dropVectorsUnlessWanted()
        expect(folderKeys('good')).toHaveLength(2)
        h.db.ltmEngine = false
        await dropVectorsUnlessWanted()
        expect([...mem.files.keys()]).toEqual([headKey('newer')])
        expect(Array.from(mem.files.get(headKey('newer'))!)).toEqual(Array.from(foreign))
        const s = newStore()
        fill(s, 2)
        await persist(s)
        expect(mem.writes).toEqual([])
    })
})
