import type { IndexedUnit } from './chatIndex'
import { rawHash } from './records'
import { UNIT_CHARS } from './units'
import type { LoadResult, LoadTarget, PersistRow } from './vectorPersist'

/** The dense list's length: only the best this many vectored units join the fusion (no similarity floor). */
export const DENSE_TOP_K = 200
/** The reciprocal-rank-fusion constant: a unit at rank r adds 1 / (RRF_K + r) per list it appears in. */
export const RRF_K = 60
/** The longest a send waits for the query's vector before it goes out on the keyword order. */
export const QUERY_TIMEOUT_MS = 1500
/** How long the page must be idle before the indexer embeds; it must outlast the keep-alive linger. */
export const DENSE_IDLE_MS = 12_000
/** The units one embedding request carries. */
export const DENSE_BATCH = 16
/** The longest one indexer batch may run before it is abandoned. */
export const DENSE_BATCH_TIMEOUT_MS = 30_000
/** The provider pause after an authorization or quota failure. */
export const PAUSE_AUTH_MS = 10 * 60_000
/** The provider pause after any other failure or a timeout. */
export const PAUSE_ERROR_MS = 60_000
/** The most chats whose vectors are held in memory at once. */
export const DENSE_CHAT_CAP = 2
/** The longest a send waits for a chat's persisted vectors before it goes out on the keyword order. */
export const DENSE_LOAD_WAIT_MS = 1000
/** The longest the indexer waits for the persisted vectors before it embeds what is missing. */
export const DENSE_READY_WAIT_MS = 10_000
/** The indexer persists after this many embedded batches of one run. */
export const PERSIST_EVERY_BATCHES = 32

/** Resolves true when `p` settled within `ms`, false at the timeout; the timer never outlives `p`. */
export function settleWithin(p: Promise<void>, ms: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), ms)
        p.then(() => {
            clearTimeout(timer)
            resolve(true)
        }, () => {
            clearTimeout(timer)
            resolve(true)
        })
    })
}

/** Embedding models trained on English only; a chat in another language matches poorly by meaning with them. */
export const ENGLISH_ONLY_HYPA_MODELS: readonly string[] = ['MiniLM', 'MiniLMGPU', 'bgeSmallEn', 'bgeSmallEnGPU', 'nomic', 'nomicGPU']

export function isEnglishOnlyHypaModel(model: string | undefined): boolean {
    return model !== undefined && ENGLISH_ONLY_HYPA_MODELS.includes(model)
}

export type DenseState ='off' | 'building' | 'partial' | 'ready' | 'paused'

/** What the trace reports about the dense side of one send; null on the trace when retrieval is lexical. */
export interface DenseStatus {
    state: DenseState
    /** Why the state is paused or off: a provider reason, 'internal', 'shadow-mode' or an embedder refusal; null otherwise. */
    reason: string | null
    /** Units of this chat that have a usable vector. */
    vectors: number
    units: number
    /** Time spent waiting for the query's vector. */
    queryMs: number
    /** Time spent on the whole dense step of the send, with the query, cosine and fusion. */
    ms: number
}

/** One embedding model's calls; the vectors it returns are plain Float32Arrays. */
export interface DenseEmbedder {
    /** Names the model and its settings: vectors of different keys are never compared. */
    modelKey: string
    embedQuery(text: string): Promise<Float32Array>
    embedDocuments(texts: string[]): Promise<Float32Array[]>
}

/** The embedder a send may use, or why it has none. */
export interface DenseEmbedderResult {
    embedder: DenseEmbedder | null
    reason: string | null
}

/** What the indexer needs to fill one chat's store. */
export interface DenseJob {
    store: DenseStore
    /** Re-read at every tick: the chat's units as the engine holds them now. */
    units(): readonly IndexedUnit[]
    embedder: DenseEmbedder
    /** False once the chat is no longer the engine's current one or its store was discarded. */
    isLive(): boolean
}

interface Entry {
    vec: Float32Array
    /** The text the vector was embedded from; absent on an entry loaded from disk until its unit is first looked up. */
    text?: string
    /** `rawHash` of that text; what a persisted entry is validated by. */
    textHash: string
    /** 0 while the entry has no persisted row; the chunk number it was persisted in otherwise. */
    seq: number
}

/**
 * One chat's vectors, in memory and, once persisted, on disk. An entry belongs to a record key and an
 * ordinal and counts only while the unit's text still equals the text it was
 * embedded from: a record's key hashes its raw data, but a unit's text comes
 * from the wrapped message, so the same key may carry new text.
 */
export class DenseStore implements LoadTarget {
    modelKey: string | null = null
    disposed = false
    /** The owner and chat the vectors persist under; empty means the store persists nothing. */
    owner = ''
    chat = ''
    /** Settles when the persisted vectors were imported or the read gave up; a store without persistence is ready at once. */
    ready: Promise<void> = Promise.resolve()
    loaded = true
    persistedG: number | null = null
    persistedChunks: number[] = []
    persistedRows = 0
    private entries = new Map<string, (Entry | undefined)[]>()
    private count = 0

    /** Entries held, whether or not their units are still current. */
    get size(): number {
        return this.count
    }

    /** Vectors of a different model are meaningless to this one: they are dropped. */
    useModel(modelKey: string): void {
        if (this.modelKey === modelKey) return
        this.clear()
        this.modelKey = modelKey
    }

    get(unit: IndexedUnit): Float32Array | undefined {
        const entry = this.entries.get(unit.key)?.[unit.ordinal]
        if (!entry) return undefined
        if (entry.text === undefined) {
            if (entry.textHash !== rawHash(unit.text)) return undefined
        } else if (entry.text !== unit.text) {
            return undefined
        }
        entry.text = unit.text
        return entry.vec
    }

    set(unit: IndexedUnit, vec: Float32Array): void {
        if (this.disposed) return
        let row = this.entries.get(unit.key)
        if (!row) {
            row = []
            this.entries.set(unit.key, row)
        }
        if (!row[unit.ordinal]) this.count++
        row[unit.ordinal] = { vec, text: unit.text, textHash: rawHash(unit.text), seq: 0 }
    }

    clear(): void {
        this.entries.clear()
        this.count = 0
        this.resetPersistMarks()
    }

    resetPersistMarks(): void {
        this.persistedG = null
        this.persistedChunks = []
        this.persistedRows = 0
        for (const row of this.entries.values()) for (const entry of row) if (entry) entry.seq = 0
    }

    /** Binds the owner and chat the vectors persist under; no target means nothing persists. */
    bindPersist(target: { chaId: string, chatId: string } | undefined): void {
        this.owner = target?.chaId ?? ''
        this.chat = target?.chatId ?? ''
    }

    /** Every entry as a persistable row; the rows stay valid after the store is disposed. */
    snapshot(): PersistRow[] {
        const rows: PersistRow[] = []
        for (const [key, row] of this.entries) {
            row.forEach((entry, ordinal) => {
                if (entry) rows.push({ key, ordinal, textHash: entry.textHash, vec: entry.vec, seq: entry.seq, mark: (seq) => { entry.seq = seq } })
            })
        }
        return rows
    }

    hasUnpersisted(): boolean {
        for (const row of this.entries.values()) for (const entry of row) if (entry && entry.seq === 0) return true
        return false
    }

    /** Adds the persisted rows the store has no entry for; a head of another model, owner or chat was already refused by the loader. */
    importLoaded(result: LoadResult): void {
        if (this.disposed || result.kind !== 'loaded' || result.head === null || this.modelKey !== result.modelKey) return
        for (const r of result.rows) {
            let row = this.entries.get(r.key)
            if (!row) {
                row = []
                this.entries.set(r.key, row)
            }
            if (row[r.ordinal]) continue
            row[r.ordinal] = { vec: r.vec, textHash: r.textHash, seq: r.seq }
            this.count++
        }
        this.persistedG = result.head.g
        this.persistedChunks = result.chunks
        this.persistedRows = result.rowsRead
    }

    /** Drops every entry whose unit is no longer indexed; only the indexer calls this. */
    prune(units: readonly IndexedUnit[]): void {
        const live = new Map<string, Set<number>>()
        for (const u of units) {
            let ords = live.get(u.key)
            if (!ords) {
                ords = new Set()
                live.set(u.key, ords)
            }
            ords.add(u.ordinal)
        }
        let count = 0
        for (const [key, row] of this.entries) {
            const ords = live.get(key)
            if (!ords) {
                this.entries.delete(key)
                continue
            }
            for (let i = 0; i < row.length; i++) {
                if (row[i] && !ords.has(i)) row[i] = undefined
                if (row[i]) count++
            }
        }
        this.count = count
    }

    /** Drops the entries but keeps the persist marks: a snapshot taken before the dispose still persists incrementally. */
    dispose(): void {
        this.disposed = true
        this.entries.clear()
        this.count = 0
    }
}

export interface DenseRanking {
    /** Indices into the units array, best first, at most DENSE_TOP_K. */
    top: number[]
    /** Units with a usable vector (the same dimension as the query and a nonzero norm). */
    valid: number
}

function norm(v: Float32Array): number {
    let s = 0
    for (let i = 0; i < v.length; i++) s += v[i] * v[i]
    return Math.sqrt(s)
}

/** Cosine order of the units that have a usable vector, best first, newer first on a tie. */
export function denseOrder(store: DenseStore, units: readonly IndexedUnit[], query: Float32Array): DenseRanking {
    const dim = query.length
    const qn = norm(query)
    if (!(qn > 0)) return { top: [], valid: 0 }
    const scored: Array<{ i: number, s: number }> = []
    for (let i = 0; i < units.length; i++) {
        const v = store.get(units[i])
        if (!v || v.length !== dim) continue
        const vn = norm(v)
        if (!(vn > 0)) continue
        let dot = 0
        for (let d = 0; d < dim; d++) dot += query[d] * v[d]
        scored.push({ i, s: dot / (qn * vn) })
    }
    scored.sort((a, b) => b.s - a.s || b.i - a.i)
    return { top: scored.slice(0, DENSE_TOP_K).map((x) => x.i), valid: scored.length }
}

export interface UnitRank {
    /** 1-based place in the full lexical order. */
    lexical: number
    /** 1-based place in the dense top list, or null when the unit is not in it. */
    dense: number | null
    /** 1-based place in the fused order. */
    fused: number
}

export interface Fused {
    order: IndexedUnit[]
    ranks: Map<IndexedUnit, UnitRank>
}

/**
 * Reciprocal rank fusion of the lexical scored prefix and the dense top list.
 * Fused units sort by score, the later unit winning a tie; every other unit
 * follows in its lexical order, so the result still covers every unit and a
 * unit without a vector keeps the place its keywords gave it.
 */
export function fuseOrders(lexical: readonly IndexedUnit[], scored: number, units: readonly IndexedUnit[], denseTop: readonly number[]): Fused {
    const pos = new Map<IndexedUnit, number>()
    units.forEach((u, i) => pos.set(u, i))
    const score = new Map<IndexedUnit, number>()
    const denseRank = new Map<IndexedUnit, number>()
    for (let r = 0; r < scored; r++) score.set(lexical[r], 1 / (RRF_K + r + 1))
    denseTop.forEach((i, r) => {
        const u = units[i]
        denseRank.set(u, r + 1)
        score.set(u, (score.get(u) ?? 0) + 1 / (RRF_K + r + 1))
    })
    const head = [...score.keys()].sort((a, b) => score.get(b)! - score.get(a)! || pos.get(b)! - pos.get(a)!)
    const order: IndexedUnit[] = head
    for (let r = scored; r < lexical.length; r++) if (!score.has(lexical[r])) order.push(lexical[r])
    const lexPos = new Map<IndexedUnit, number>()
    lexical.forEach((u, r) => lexPos.set(u, r + 1))
    const ranks = new Map<IndexedUnit, UnitRank>()
    order.forEach((u, r) => ranks.set(u, { lexical: lexPos.get(u) ?? 0, dense: denseRank.get(u) ?? null, fused: r + 1 }))
    return { order, ranks }
}

/** The query's text for embedding: its last `limit` code points, never splitting a surrogate pair. */
export function queryInput(text: string, limit: number = UNIT_CHARS): string {
    const cps = Array.from(text)
    return cps.length <= limit ? text : cps.slice(cps.length - limit).join('')
}

export class DenseTimeoutError extends Error {
    constructor() {
        super('embedding request timed out')
        this.name = 'DenseTimeoutError'
    }
}

/**
 * Settles with `p` or, after `ms`, rejects with a DenseTimeoutError. The loser
 * keeps its own handlers, so a rejection after the timeout is never unhandled,
 * and the timer is cleared as soon as `p` settles.
 */
export function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new DenseTimeoutError()), ms)
        p.then(
            (v) => {
                clearTimeout(timer)
                resolve(v)
            },
            (e: unknown) => {
                clearTimeout(timer)
                reject(e)
            },
        )
    })
}

export type DensePauseReason = 'timeout' | 'auth' | 'error'

/** A provider failure's class. The thrown value is the response body only, so this is a heuristic that only picks the pause length. */
export function classifyDenseError(e: unknown): 'auth' | 'error' {
    const text = e instanceof Error ? e.message : String(e)
    return /\b40[13]\b|\b429\b|unauthori[sz]ed|forbidden|invalid[_ ]?api[_ ]?key|api key|quota|rate.?limit|insufficient/i.test(text) ? 'auth' : 'error'
}

let pause: { until: number, reason: DensePauseReason } | null = null

/** The provider pause shared by the query and the indexer, or null once it has run out. */
export function currentDensePause(): { until: number, reason: DensePauseReason } | null {
    if (pause && Date.now() >= pause.until) pause = null
    return pause
}

/** Starts the pause a failure earns and returns its reason. A timeout pauses like an ordinary error. */
export function pauseDenseAfter(e: unknown): DensePauseReason {
    const reason: DensePauseReason = e instanceof DenseTimeoutError ? 'timeout' : classifyDenseError(e)
    pause = { until: Date.now() + (reason === 'auth' ? PAUSE_AUTH_MS : PAUSE_ERROR_MS), reason }
    return reason
}

export function resetDensePauseForTests(): void {
    pause = null
}
