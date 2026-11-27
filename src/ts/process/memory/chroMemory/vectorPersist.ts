import { reconcileChatDrafts, type ChatDraftSlot } from 'src/ts/chatDraftsModel'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { getPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { chroMemoryOn } from '../memoryEngine'
import { rawHash } from './records'
import { readLtmSettings } from './settings'

/**
 * The search-vector cache of the hybrid retrieval: one folder per chat under the page's byte store, a head naming the
 * chunks that hold the vectors. It is a rebuildable cache: every record validates itself, so a torn write, a race or a
 * newer version's data costs at most a re-embed and never serves a wrong vector.
 *
 * Pinned by the stored format (changing any of these orphans existing folders): `rawHash` (records.ts), the unit key
 * (chatIndex.ts `recordKeysOf`), the model key (denseEmbedder.ts `chroMemoryEmbedder`) and `segOf` below.
 *
 * Folder layout under `PREFIX`: `<seg>/head` (JSON) and `<seg>/c<N>` chunks, N a positive integer without leading zero.
 * A chunk is a u32 LE length J, J bytes of JSON `{v, model, dim, units: [[unitKey, ordinal, textHash]...]}` (padded with
 * spaces so 4 + J is a multiple of 4), then units * dim little-endian f32 values (typed arrays are little-endian on
 * every supported target). Every record is at most `MAX_RECORD_BYTES`.
 */

/** The key prefix of every vector folder; the native store directory is `derived`. */
export const PREFIX = 'derived/chromemory-vectors/'
/** The `f` member of a head, the stem of the folder and of the `.rtb` row. */
export const MAGIC = 'chromemory-vectors'
/** The largest record of any version: the writer complies, the loader drops, the restore rejects. */
export const MAX_RECORD_BYTES = 4_194_304
/** The largest JSON part of a chunk. */
export const MAX_CHUNK_JSON_BYTES = 1_048_576
/** The widest vector a chunk may carry. */
export const MAX_DIM = 8192
/** The most readable folders kept; the oldest head (by `at`) beyond it is evicted. */
export const FOLDER_CAP = 8

const CHUNK_NAME = /^c([1-9][0-9]{0,9})$/
const MAX_CHUNK_NUMBER = 9_999_999_999
const CHUNK_HEADROOM_BYTES = 262_144
const UNIT_META_BUDGET_BYTES = 192
const UNIT_SEPARATOR = '\u0001'

export interface VectorHead {
    f: typeof MAGIC
    v: 1
    /** The generation: one more than the head it replaced. */
    g: number
    /** The app version that wrote it; never validated. */
    w: string
    owner: string
    chat: string
    /** `rawHash` of the embedding model key. */
    model: string
    /** The hypa model id, never a URL. */
    label: string
    dim: number
    /** The chunk numbers in order; a later position wins. */
    chunks: number[]
    at: number
}

/** `readable` is a valid v1 head; `foreign` is a newer version's (kept untouched); anything else is damaged and counts as absent. */
export type HeadClass =
    | { kind: 'readable', head: VectorHead }
    | { kind: 'damaged' }
    | { kind: 'foreign' }

export interface UnitVector {
    key: string
    ordinal: number
    textHash: string
    vec: Float32Array
}

export interface LoadedRow extends UnitVector {
    /** The chunk number it was read from. */
    seq: number
}

export interface PersistRow extends UnitVector {
    /** 0 while the unit has no persisted row; the chunk number otherwise. */
    seq: number
    mark(seq: number): void
}

/** What persistence needs from a chat's vector store (implemented by `DenseStore`). */
export interface PersistSource {
    readonly owner: string
    readonly chat: string
    readonly modelKey: string | null
    readonly disposed: boolean
    /** False until the persisted vectors have been read (or the read gave up). */
    loaded: boolean
    persistedG: number | null
    persistedChunks: number[]
    /** The valid rows in the persisted chunks, shadowed ones included. */
    persistedRows: number
    snapshot(): PersistRow[]
    /** Forgets what is known to be on disk: every unit counts as unpersisted. */
    resetPersistMarks(): void
}

export interface LoadTarget extends PersistSource {
    importLoaded(result: LoadResult): void
}

export interface LoadResult {
    kind: 'absent' | 'mismatch' | 'foreign' | 'loaded'
    modelKey: string
    head: VectorHead | null
    rows: LoadedRow[]
    /** The listed chunks that read and validated. */
    chunks: number[]
    /** Listed chunks that were missing, unreadable or invalid. */
    dropped: number
    rowsRead: number
}

export function chatKeyOf(owner: string, chat: string): string {
    return `${owner}:${chat}`
}

/** The folder name of a chat key: its `rawHash` with the separators made key-safe. */
export function segOf(chatKey: string): string {
    return rawHash(chatKey).replace(/:/g, '-')
}

export function folderPrefix(seg: string): string {
    return `${PREFIX}${seg}/`
}

export function headKey(seg: string): string {
    return `${PREFIX}${seg}/head`
}

export function chunkKey(seg: string, n: number): string {
    return `${PREFIX}${seg}/c${n}`
}

/** The chunk number a folder-relative name carries, or null when it is not a chunk name. */
export function chunkNumberOf(name: string): number | null {
    const m = CHUNK_NAME.exec(name)
    return m ? Number(m[1]) : null
}

/** The label a head carries: the hypa model id, the first part of the model key. */
export function labelOf(modelKey: string): string {
    return modelKey.split('|')[0]
}

/** The most units a chunk of this width is planned for; the writer still shrinks a chunk that would pass a record bound. */
export function unitsPerChunk(dim: number): number {
    return Math.max(1, Math.floor((MAX_RECORD_BYTES - CHUNK_HEADROOM_BYTES) / (dim * 4 + UNIT_META_BUDGET_BYTES)))
}

function parseObject(bytes: Uint8Array): Record<string, unknown> | null {
    if (bytes.length > MAX_RECORD_BYTES) return null
    try {
        const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
        return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
    } catch {
        return null
    }
}

function isChunkNumber(n: unknown): n is number {
    return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_CHUNK_NUMBER
}

/** Classifies a stored head; an absent head is damaged, only a newer version's is foreign. */
export function classifyHead(bytes: Uint8Array | null): HeadClass {
    if (bytes === null) return { kind: 'damaged' }
    const o = parseObject(bytes)
    if (o === null) return { kind: 'damaged' }
    if (o.f !== MAGIC) return { kind: 'damaged' }
    if (typeof o.v === 'number' && Number.isInteger(o.v) && o.v >= 2) return { kind: 'foreign' }
    if (o.v !== 1) return { kind: 'damaged' }
    const { g, owner, chat, model, label, dim, chunks, at, w } = o
    if (typeof g !== 'number' || !Number.isSafeInteger(g) || g < 0) return { kind: 'damaged' }
    if (typeof owner !== 'string' || typeof chat !== 'string' || typeof model !== 'string' || typeof label !== 'string') return { kind: 'damaged' }
    if (typeof dim !== 'number' || !Number.isInteger(dim) || dim < 1 || dim > MAX_DIM) return { kind: 'damaged' }
    if (!Array.isArray(chunks) || !chunks.every(isChunkNumber)) return { kind: 'damaged' }
    if (typeof at !== 'number' || !Number.isFinite(at)) return { kind: 'damaged' }
    return { kind: 'readable', head: { f: MAGIC, v: 1, g, w: typeof w === 'string' ? w : '', owner, chat, model, label, dim, chunks: [...chunks], at } }
}

export function parseHead(bytes: Uint8Array | null): VectorHead | null {
    const cls = classifyHead(bytes)
    return cls.kind === 'readable' ? cls.head : null
}

export function encodeHead(head: VectorHead): Uint8Array {
    const { f, v, g, w, owner, chat, model, label, dim, chunks, at } = head
    return new TextEncoder().encode(JSON.stringify({ f, v, g, w, owner, chat, model, label, dim, chunks, at }))
}

/** One chunk record of `rows`, all of width `dim`. */
export function encodeChunk(model: string, dim: number, rows: readonly UnitVector[]): Uint8Array {
    const json = new TextEncoder().encode(JSON.stringify({ v: 1, model, dim, units: rows.map((r) => [r.key, r.ordinal, r.textHash]) }))
    const j = Math.ceil(json.length / 4) * 4
    const out = new Uint8Array(4 + j + rows.length * dim * 4)
    new DataView(out.buffer).setUint32(0, j, true)
    out.set(json, 4)
    out.fill(0x20, 4 + json.length, 4 + j)
    const values = new Float32Array(out.buffer, 4 + j, rows.length * dim)
    rows.forEach((r, i) => values.set(r.vec, i * dim))
    return out
}

function isFiniteVector(v: Float32Array): boolean {
    for (let i = 0; i < v.length; i++) if (!Number.isFinite(v[i])) return false
    return true
}

/** The rows of a chunk record, or null when the record is not a valid chunk of this model and width; a non-finite vector drops only its unit. */
export function decodeChunk(bytes: Uint8Array, model: string, dim: number): UnitVector[] | null {
    if (bytes.length > MAX_RECORD_BYTES || bytes.length < 4) return null
    const j = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true)
    if (j > MAX_CHUNK_JSON_BYTES || 4 + j > bytes.length) return null
    const dataAt = Math.ceil((4 + j) / 4) * 4
    if (dataAt > bytes.length) return null
    const meta = parseObject(bytes.subarray(4, 4 + j))
    if (meta === null || meta.v !== 1 || meta.model !== model || meta.dim !== dim || !Array.isArray(meta.units)) return null
    const units: unknown[] = meta.units
    if (bytes.length - dataAt !== units.length * dim * 4) return null
    const data = new Uint8Array(bytes.length - dataAt)
    data.set(bytes.subarray(dataAt))
    const values = new Float32Array(data.buffer)
    const rows: UnitVector[] = []
    for (let i = 0; i < units.length; i++) {
        const u = units[i]
        if (!Array.isArray(u) || u.length !== 3) return null
        const [key, ordinal, textHash] = u as unknown[]
        if (typeof key !== 'string' || typeof ordinal !== 'number' || !Number.isInteger(ordinal) || ordinal < 0 || typeof textHash !== 'string') return null
        const vec = values.subarray(i * dim, (i + 1) * dim)
        if (!isFiniteVector(vec)) continue
        rows.push({ key, ordinal, textHash, vec })
    }
    return rows
}

function sameBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
    if (a === null || b === null) return a === b
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
}

/**
 * Reads a chat's persisted vectors. A folder is imported only when its head is a readable v1 head of this model,
 * owner and chat; a bad or missing listed chunk is dropped and counted while the rest loads. A rejected head read
 * rejects; a rejected chunk read only drops that chunk.
 */
export async function loadPersisted(store: ByteStore, id: { owner: string, chat: string, modelKey: string }): Promise<LoadResult> {
    const result: LoadResult = { kind: 'absent', modelKey: id.modelKey, head: null, rows: [], chunks: [], dropped: 0, rowsRead: 0 }
    const seg = segOf(chatKeyOf(id.owner, id.chat))
    const cls = classifyHead((await store.read(headKey(seg))).bytes)
    if (cls.kind === 'foreign') return { ...result, kind: 'foreign' }
    if (cls.kind === 'damaged') return result
    const head = cls.head
    if (head.model !== rawHash(id.modelKey) || head.owner !== id.owner || head.chat !== id.chat) return { ...result, kind: 'mismatch', head }
    const byUnit = new Map<string, LoadedRow>()
    for (const n of head.chunks) {
        let rows: UnitVector[] | null = null
        try {
            const bytes = (await store.read(chunkKey(seg, n))).bytes
            rows = bytes === null ? null : decodeChunk(bytes, head.model, head.dim)
        } catch {
            rows = null
        }
        if (rows === null) {
            result.dropped++
            continue
        }
        result.chunks.push(n)
        result.rowsRead += rows.length
        for (const r of rows) byUnit.set(r.key + UNIT_SEPARATOR + r.ordinal, { ...r, seq: n })
    }
    result.kind = 'loaded'
    result.head = head
    result.rows = [...byUnit.values()]
    return result
}

export interface VectorFolder {
    seg: string
    /** Every key of the folder, the head and unknown siblings included. */
    keys: string[]
    kind: 'readable' | 'damaged' | 'foreign'
    head: VectorHead | null
}

/** The folders under the prefix with their classification; a rejected head read rejects (an unreadable folder is never judged). */
export async function listFolders(store: ByteStore): Promise<VectorFolder[]> {
    const bySeg = new Map<string, string[]>()
    for (const key of await store.list(PREFIX)) {
        const rest = key.slice(PREFIX.length)
        const slash = rest.indexOf('/')
        if (slash <= 0) continue
        const seg = rest.slice(0, slash)
        let keys = bySeg.get(seg)
        if (!keys) {
            keys = []
            bySeg.set(seg, keys)
        }
        keys.push(key)
    }
    const out: VectorFolder[] = []
    for (const [seg, keys] of bySeg) {
        const cls = classifyHead((await store.read(headKey(seg))).bytes)
        out.push({ seg, keys, kind: cls.kind, head: cls.kind === 'readable' ? cls.head : null })
    }
    return out
}

async function deleteKeys(store: ByteStore, keys: readonly string[], head: string): Promise<void> {
    if (keys.includes(head)) await store.delete(head, 'unconditional')
    for (const key of keys) if (key !== head) await store.delete(key, 'unconditional')
}

/** Deletes a chat's folder, readable or damaged; a newer version's folder is left alone. Returns whether it deleted. */
export async function deleteVectorFolder(store: ByteStore, seg: string): Promise<boolean> {
    const keys = await store.list(folderPrefix(seg))
    if (keys.length === 0) return false
    const cls = classifyHead((await store.read(headKey(seg))).bytes)
    if (cls.kind === 'foreign') return false
    await deleteKeys(store, keys, headKey(seg))
    return true
}

/** Evicts the readable folders beyond the cap, oldest `at` first; folders in `liveSegs` and foreign folders are never evicted or counted against the cap. */
export async function evictOverCap(store: ByteStore, liveSegs: ReadonlySet<string>, cap: number = FOLDER_CAP): Promise<string[]> {
    const readable = (await listFolders(store)).filter((f) => f.kind === 'readable')
    const excess = readable.length - cap
    if (excess <= 0) return []
    const candidates = readable
        .filter((f) => !liveSegs.has(f.seg))
        .sort((a, b) => a.head!.at - b.head!.at || (a.seg < b.seg ? -1 : 1))
        .slice(0, excess)
    for (const f of candidates) await deleteKeys(store, f.keys, headKey(f.seg))
    return candidates.map((f) => f.seg)
}

function packChunks(model: string, dim: number, rows: readonly PersistRow[]): { bytes: Uint8Array, rows: PersistRow[] }[] {
    const out: { bytes: Uint8Array, rows: PersistRow[] }[] = []
    const per = unitsPerChunk(dim)
    let i = 0
    while (i < rows.length) {
        let n = Math.min(per, rows.length - i)
        let bytes = encodeChunk(model, dim, rows.slice(i, i + n))
        const fits = (b: Uint8Array): boolean => b.length <= MAX_RECORD_BYTES && new DataView(b.buffer).getUint32(0, true) <= MAX_CHUNK_JSON_BYTES
        while (n > 1 && !fits(bytes)) {
            n = Math.max(1, Math.floor(n * 0.9))
            bytes = encodeChunk(model, dim, rows.slice(i, i + n))
        }
        if (fits(bytes)) out.push({ bytes, rows: rows.slice(i, i + n) })
        i += n
    }
    return out
}

// ---- the serialized write path -------------------------------------------------------------------------------------

interface Op {
    id: string
    /** True when done (or nothing to do); false when the gate was closed and the request is remembered. */
    run(): Promise<boolean>
}

type Gate = { store: ByteStore } | 'gated' | 'skip'

let chain: Promise<void> = Promise.resolve()
let holds = 0
const remembered = new Map<string, Op>()
const tracked = new Set<PersistSource>()
let watching = false

function hidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

/**
 * The database module is loaded on first use, so importing the search engine never pulls the whole database module
 * (and its reactive state) into a page or test that never persists.
 */
function databaseModule(): Promise<typeof import('src/ts/storage/database.svelte')> {
    return import('src/ts/storage/database.svelte')
}

/** The page's byte store, resolved lazily for the same reason as the database module. */
async function getAppStore(): Promise<ByteStore> {
    return (await import('src/ts/storage/store/appStore')).getAppStore()
}

/** Vectors are wanted only while ChroMemory is the engine and its retrieval is hybrid. */
export async function vectorsWanted(): Promise<boolean> {
    try {
        const db = (await databaseModule()).getDatabase()
        return db !== undefined && chroMemoryOn(db) && readLtmSettings(db.ltmSettings, 0).retrieval === 'hybrid'
    } catch {
        return false
    }
}

/**
 * The write gate: only a writable store2 page writes, never while a hold is active or the page is hidden (those
 * requests are remembered), and a page with no byte store writes nothing. `needWanted` also requires the vector
 * retrieval to be on.
 */
async function openGate(needWanted: boolean): Promise<Gate> {
    if (getPageStorageMode().kind !== 'store2') return 'skip'
    if (needWanted && !(await vectorsWanted())) return 'skip'
    if (holds > 0 || hidden()) return 'gated'
    try {
        return { store: await getAppStore() }
    } catch {
        return 'skip'
    }
}

function enqueue(op: Op): Promise<void> {
    const next = chain.then(async () => {
        try {
            if (await op.run()) {
                if (remembered.get(op.id) === op) remembered.delete(op.id)
            } else {
                remembered.set(op.id, op)
                watchVisibility()
            }
        } catch (e) {
            console.warn('chromemory vector persistence failed', e)
        }
    })
    chain = next
    return next
}

function drainRemembered(): void {
    const ops = [...remembered.values()]
    remembered.clear()
    for (const op of ops) void enqueue(op)
}

function watchVisibility(): void {
    if (watching || typeof document === 'undefined') return
    watching = true
    document.addEventListener('visibilitychange', () => {
        if (!hidden()) drainRemembered()
    })
}

/** Resolves once every queued operation has run. */
export async function flushVectorPersist(): Promise<void> {
    let seen: Promise<void>
    do {
        seen = chain
        await seen
    } while (seen !== chain)
}

/**
 * Flushes the queue and blocks every write and delete until the returned release runs; requests made meanwhile are
 * remembered and run on release. The release is idempotent.
 */
export async function holdVectorPersist(): Promise<() => void> {
    await flushVectorPersist()
    holds++
    let released = false
    return () => {
        if (released) return
        released = true
        holds--
        if (holds === 0) drainRemembered()
    }
}

export function trackVectorSource(source: PersistSource): void {
    tracked.add(source)
}

function isPersistable(source: PersistSource): boolean {
    return source.owner !== '' && source.chat !== ''
}

function segOfSource(source: PersistSource): string {
    return segOf(chatKeyOf(source.owner, source.chat))
}

function liveSegs(): Set<string> {
    const out = new Set<string>()
    for (const s of tracked) {
        if (s.disposed) {
            tracked.delete(s)
        } else if (isPersistable(s)) {
            out.add(segOfSource(s))
        }
    }
    return out
}

/** A folder deleted in this page: a live store of that chat forgets what it believed was on disk. */
function resetLiveMarks(seg: string): void {
    for (const s of tracked) if (!s.disposed && isPersistable(s) && segOfSource(s) === seg) s.resetPersistMarks()
}

async function runPersist(source: PersistSource, given: PersistRow[] | null, seg: string): Promise<boolean> {
    const modelKey = source.modelKey
    if (!isPersistable(source) || modelKey === null) return true
    if (given === null && source.disposed) return true
    if (!source.loaded) return false
    const gate = await openGate(true)
    if (gate === 'skip') return true
    if (gate === 'gated') return false
    const store = gate.store
    const all = given ?? source.snapshot()
    if (all.length === 0 || all.every((r) => r.seq > 0)) return true
    const dim = all[0].vec.length
    if (dim < 1 || dim > MAX_DIM) return true
    const rows = all.filter((r) => r.vec.length === dim)
    const model = rawHash(modelKey)
    const folder = folderPrefix(seg)
    const grammar: number[] = []
    for (const key of await store.list(folder)) {
        const n = chunkNumberOf(key.slice(folder.length))
        if (n !== null) grammar.push(n)
    }
    const headBytes = (await store.read(headKey(seg))).bytes
    const cls = classifyHead(headBytes)
    if (cls.kind === 'foreign') return true
    const head = cls.kind === 'readable' ? cls.head : null
    if (head !== null && source.persistedG !== null && head.g !== source.persistedG) return true
    if (head === null && source.persistedG !== null) source.resetPersistMarks()
    const full = head === null || source.persistedG === null || head.model !== model || head.owner !== source.owner || head.chat !== source.chat || head.dim !== dim
    let compact = full
    if (!compact) {
        const dead = source.persistedRows - rows.filter((r) => r.seq > 0).length
        compact = dead > rows.length || grammar.length > 2 * Math.ceil(rows.length / unitsPerChunk(dim)) + 8
    }
    const writeRows = compact ? rows : rows.filter((r) => r.seq === 0)
    if (writeRows.length === 0) return true
    let next = 1
    for (const n of head?.chunks ?? []) next = Math.max(next, n + 1)
    for (const n of grammar) next = Math.max(next, n + 1)
    const written: { n: number, rows: PersistRow[] }[] = []
    for (const group of packChunks(model, dim, writeRows)) {
        if (next > MAX_CHUNK_NUMBER) throw new Error('chunk numbers exhausted')
        await store.write(chunkKey(seg, next), group.bytes, 'unconditional')
        written.push({ n: next, rows: group.rows })
        next++
    }
    if (written.length === 0) return true
    if (!sameBytes((await store.read(headKey(seg))).bytes, headBytes)) return true
    const chunks = compact ? written.map((w) => w.n) : [...source.persistedChunks, ...written.map((w) => w.n)]
    const newHead: VectorHead = { f: MAGIC, v: 1, g: (head?.g ?? 0) + 1, w: (await databaseModule()).appVer, owner: source.owner, chat: source.chat, model, label: labelOf(modelKey), dim, chunks, at: Date.now() }
    await store.write(headKey(seg), encodeHead(newHead), 'unconditional')
    for (const w of written) for (const r of w.rows) r.mark(w.n)
    source.persistedG = newHead.g
    source.persistedChunks = chunks
    source.persistedRows = compact ? writeRows.length : source.persistedRows + writeRows.length
    try {
        if (compact) {
            const top = written[written.length - 1].n
            for (const n of grammar) if (n < top && !chunks.includes(n)) await store.delete(chunkKey(seg, n), 'unconditional')
        }
        await evictOverCap(store, liveSegs())
    } catch (e) {
        console.warn('chromemory vector cleanup failed', e)
    }
    return true
}

/**
 * Queues a persist of a chat's vectors. `rows` is a snapshot taken before the store was disposed (LRU eviction); without
 * it the store is read when the request runs, and a disposed store persists nothing. Never throws.
 */
export function requestPersist(source: PersistSource, rows: PersistRow[] | null = null): void {
    try {
        if (!isPersistable(source)) return
        trackVectorSource(source)
        const seg = segOfSource(source)
        void enqueue({ id: `persist:${seg}`, run: () => runPersist(source, rows, seg) })
    } catch {
        // Persistence is optional; the caller's work is unaffected.
    }
}

/**
 * Reads a chat's persisted vectors into its store. Never rejects; a failed read costs a re-embed. Marks the store
 * loaded either way and then persists whatever the indexer added meanwhile.
 */
export async function loadVectors(source: LoadTarget): Promise<void> {
    try {
        // A page whose storage boot has not decided has nothing to read.
        if (isPersistable(source) && source.modelKey !== null && getPageStorageMode().kind !== 'unset') {
            const store = await getAppStore()
            source.importLoaded(await loadPersisted(store, { owner: source.owner, chat: source.chat, modelKey: source.modelKey }))
        }
    } catch {
        // Nothing persisted is usable; the indexer embeds what is missing.
    } finally {
        source.loaded = true
        if (!source.disposed) requestPersist(source)
        drainRemembered()
    }
}

/** Whether the store holds any key under the vector prefix (a newer version's folder counts); a failing list is false. */
export async function vectorsPresent(): Promise<boolean> {
    try {
        return (await (await getAppStore()).list(PREFIX)).length > 0
    } catch {
        return false
    }
}

/** Deletes a discarded chat's folder (readable or damaged, never a newer version's). */
export function requestDeleteFolder(chatKey: string): Promise<void> {
    const seg = segOf(chatKey)
    remembered.delete(`persist:${seg}`)
    return enqueue({
        id: `delete:${seg}`,
        run: async () => {
            const gate = await openGate(false)
            if (gate === 'skip') return true
            if (gate === 'gated') return false
            await deleteVectorFolder(gate.store, seg)
            resetLiveMarks(seg)
            return true
        },
    })
}

/** Deletes every readable and damaged folder unless the vector retrieval is on; newer versions' folders stay. */
export function dropVectorsUnlessWanted(): Promise<void> {
    return enqueue({
        id: 'drop',
        run: async () => {
            const gate = await openGate(false)
            if (gate === 'skip') return true
            if (gate === 'gated') return false
            if (await vectorsWanted()) return true
            for (const folder of await listFolders(gate.store)) {
                if (folder.kind === 'foreign') continue
                await deleteKeys(gate.store, folder.keys, headKey(folder.seg))
                resetLiveMarks(folder.seg)
            }
            return true
        },
    })
}

/**
 * The start-of-page pass of a writable page, after the boot trash purge and id assignment. With the vector retrieval off
 * every readable and damaged folder goes; otherwise a readable folder is kept while the draft rule keeps its chat (a cold
 * stub or a trashed slot holds its folders, a deleted owner or a chat no non-stub slot holds loses them) and a damaged
 * one goes. A newer version's folder is never touched. Never rejects.
 */
export function sweepVectorsAtBoot(slots: readonly ChatDraftSlot[]): Promise<void> {
    return enqueue({
        id: 'sweep',
        run: async () => {
            const gate = await openGate(false)
            if (gate === 'skip') return true
            if (gate === 'gated') return false
            const wanted = await vectorsWanted()
            const folders = (await listFolders(gate.store)).filter((f) => f.kind !== 'foreign')
            const readable = folders.filter((f) => f.kind === 'readable').map((f) => ({ cha: f.head!.owner, chat: f.head!.chat, folder: f }))
            const keptSegs = new Set(wanted ? reconcileChatDrafts(readable, slots).map((e) => e.folder.seg) : [])
            for (const folder of folders) {
                if (keptSegs.has(folder.seg)) continue
                await deleteKeys(gate.store, folder.keys, headKey(folder.seg))
                resetLiveMarks(folder.seg)
            }
            return true
        },
    })
}

export function resetVectorPersistForTests(): void {
    chain = Promise.resolve()
    holds = 0
    remembered.clear()
    tracked.clear()
}
