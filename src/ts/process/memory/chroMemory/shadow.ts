import { get } from 'svelte/store'
import { restateForKept, trimChatsToContext, type CountChat } from '../../contextTrim'
import type { OpenAIChat } from '../../index.svelte'
import { ChatUnitIndex, RARE_SHARE, recordKeysOf, type IndexedUnit, type Reconcile } from './chatIndex'
import {
    DENSE_CHAT_CAP,
    DENSE_LOAD_WAIT_MS,
    DenseStore,
    QUERY_TIMEOUT_MS,
    currentDensePause,
    denseOrder,
    fuseOrders,
    pauseDenseAfter,
    queryInput,
    raceTimeout,
    resetDensePauseForTests,
    settleWithin,
    type DenseEmbedder,
    type DenseEmbedderResult,
    type DenseJob,
    type DenseStatus,
    type Fused,
} from './dense'
import { resetDenseIndexerForTests, scheduleDenseIndexing } from './denseIndexer'
import { HEADER, SHADOW_COUNT_CAP, VARYING_COUNT_CAP, packUnits, type PackLine, type PackResult } from './pack'
import { FIRST_MESSAGE_ID, firstRecordOf, recordOf, recordTextOf, type FirstMessageSource, type MessageRecord, type SendCapture } from './records'
import { readLtmSettings } from './settings'
import { chroMemoryDiscarded, chroMemoryTrace } from './traceStore'
import { UNIT_CHARS, splitRecord, type Piece } from './units'
import { loadVectors, requestDeleteFolder, requestPersist, resetVectorPersistForTests, trackVectorSource } from './vectorPersist'
import { persistTargetOf } from '../../../chatDraftsModel'

/** The most line texts the slot's count cache holds; it is cleared before a pack that could pass this. */
export const LINE_CACHE_MAX = 512
/** The message chats make-room keeps at least (S0 output F, MC-2848). */
export const HISTORY_FLOOR = 4
const ERROR_MAX_CHARS = 200

export interface ChroMemoryTraceItem {
    source: { kind: 'turn', chatId: string, index: number, off: number }
    /** `lexical` is the place in the keyword order; `dense` and `fused` are set only when the send ranked by vectors. */
    rank: { lexical: number, dense: number | null, fused: number | null }
    tokens: number
}

export type ChroMemoryRebuildCause = 'fresh' | 'chat-switch' | 'tail-shrink' | 'mid-removal'

export interface ChroMemoryMakeRoom {
    /** The tokens the memory message may take: the window minus the reserve and the history floor's total. */
    room: number
    /** The limit the history was trimmed to: the window minus the reserve and the memory message's tokens. */
    limit: number
    /** The character depth prompt's tokens, counted once and kept out of the history's room. */
    reserved: number
    /** The message chats make-room kept at least. */
    floor: number
    evictedChats: number
    evictedTokens: number
    /** Found items left out of the block so that it fit `room` or the count limit. */
    itemsDropped: number
}

export interface ChroMemoryTimings {
    index: number
    rank: number
    pack: number
    room: number
}

export interface ChroMemoryTrace {
    v: 1
    mode: 'shadow' | 'inject'
    chatKey: string
    at: number
    ms: number
    outcome: 'packed' | 'injected' | 'nothing-packed' | 'no-room' | 'empty-d0' | 'no-query' | 'error' | 'dropped-at-recheck'
    d0: { records: number, units: number, firstChatId: string | null, lastChatId: string | null }
    index: Reconcile | null
    /** Why the whole index was rebuilt on this send; null when it was appended to or truncated. */
    rebuildCause: ChroMemoryRebuildCause | null
    query: { chatId: string, terms: string[] } | null
    admission: 'none'
    budgetTokens: number
    T: number
    countCap: number
    slots: number
    counted: number
    countCapped: boolean
    items: ChroMemoryTraceItem[]
    makeRoom: ChroMemoryMakeRoom | null
    timings: ChroMemoryTimings
    /** The vector side of a hybrid send; null when retrieval is lexical. */
    dense: DenseStatus | null
    timeBox: 'none'
    error: string | null
}

/** What make-room needs from the send; present only when the memory message may be placed. */
export interface InjectInput {
    /** K0, the live array; the make-room splice is the engine's only mutation of it. */
    chats: OpenAIChat[]
    /** The engine-off trim's result over K0's predecessor: the total, the dropped prefix and every count it took. */
    step1: { currentTokens: number, dropped: readonly OpenAIChat[], counts: ReadonlyMap<OpenAIChat, number> }
    /** As they were before step 1. */
    firstMessageChat: number
    tokensBeforeMessages: number
    tokensAfterMessages: readonly number[]
    maxContextTokens: number
    /** Tokens counted after assembly that never leave the prompt (the character depth prompt). */
    reserveTokens: number
    /** The message chats make-room keeps at least. */
    floor: number
    count: CountChat
}

export interface ShadowInput {
    chatKey: string
    /** The chats before the engine-off trim. */
    before: readonly OpenAIChat[]
    /** The chats after it (K0); the live array when `inject` is set. */
    kept: readonly OpenAIChat[]
    /** Called only for D0 chats; null for a chat without a record (examples, the NewChat marker). */
    recordOf(chat: OpenAIChat): MessageRecord | null
    /** The newest captured message; called only when D0 is non-empty. */
    queryRecord(): MessageRecord | null
    budgetTokens: number
    countVaries: boolean
    /** The counter identity; a change clears the line cache. */
    tokenizerKey: string
    inject?: InjectInput
    /** Set when retrieval is hybrid and the memory message may be placed: the send ranks by vectors too. */
    dense?: DenseEmbedderResult
    /** Hybrid retrieval was asked for but the send is a shadow: it stays lexical and the trace says so. */
    hybridShadow?: boolean
    /** Where this chat's vectors persist: the owner's chaId and the chat's id; absent when either is empty, and nothing persists. */
    persist?: { chaId: string, chatId: string }
}

export interface ShadowDeps {
    countText(text: string): Promise<number>
    /** The token cost of a memory message carrying this block, in the shape the send assembles it. */
    countBlock(block: string): Promise<number>
    now(): number
    /** The make-room trim; the context trim by default. */
    trim?: typeof trimChatsToContext
    /** The embedding model for a hybrid send; read only when retrieval is hybrid in inject mode. */
    embedder?: () => DenseEmbedderResult
    /** Hands the chat's store to the background indexer after a hybrid send; never awaited. The real indexer by default. */
    scheduleDense?: (job: DenseJob) => void
}

interface ShadowSlot {
    index: ChatUnitIndex
    tokenizerKey: string
    lineCache: Map<string, number>
    /** This chat's vectors; shared with the parked store map so a switch back finds them. */
    dense: DenseStore | null
    persist: { chaId: string, chatId: string } | undefined
}

/** The vectors of the most recent chats, oldest first; a chat past the cap loses its vectors. */
const denseStores = new Map<string, DenseStore>()

/** Starts the read of a new store's persisted vectors and times it for the device hook. */
function startVectorLoad(store: DenseStore): void {
    if (store.owner === '' || store.chat === '') return
    store.loaded = false
    const startedAt = typeof performance !== 'undefined' ? performance.now() : 0
    store.ready = loadVectors(store).then(() => {
        try {
            if (typeof performance !== 'undefined' && typeof performance.measure === 'function') {
                performance.measure('chromemory-vector-load', { start: startedAt, duration: Math.max(0, performance.now() - startedAt), detail: { units: store.size } })
            }
        } catch {
            // The measure is a device hook only.
        }
    })
}

function denseStoreFor(chatKey: string, persist: { chaId: string, chatId: string } | undefined, modelKey: string): DenseStore {
    let store = denseStores.get(chatKey)
    if (store) {
        denseStores.delete(chatKey)
    } else {
        store = new DenseStore()
        store.bindPersist(persist)
        store.useModel(modelKey)
        trackVectorSource(store)
        startVectorLoad(store)
    }
    denseStores.set(chatKey, store)
    while (denseStores.size > DENSE_CHAT_CAP) {
        const oldest = denseStores.keys().next().value
        if (oldest === undefined) break
        const evicted = denseStores.get(oldest)
        // The snapshot is taken before the dispose empties the store, so what it holds still persists.
        if (evicted && evicted.hasUnpersisted()) requestPersist(evicted, evicted.snapshot())
        evicted?.dispose()
        prefetchOnly.delete(oldest)
        denseStores.delete(oldest)
    }
    return store
}

/** Chats whose store was opened by a prefetch and no send has used yet; only these are released by the chat's exit. */
const prefetchOnly = new Set<string>()

/**
 * Starts a chat's persisted-vector read when the chat opens, so the first hybrid send finds it settled instead of
 * waiting out the load cap. It builds the same store a send would (same key, owner, chat and model), so the send reuses
 * it; nothing is read for a lexical chat, a chat without a persist target or a phone without a usable embedder. A
 * second call for the same chat finds the store and starts nothing. Never throws.
 */
export function prefetchChroMemoryVectors(args: { ownerId: string, chatId: string | undefined, ltmSettings: unknown, embedder: () => DenseEmbedderResult }): void {
    try {
        if (readLtmSettings(args.ltmSettings, 0).retrieval !== 'hybrid') return
        const persist = persistTargetOf(args.ownerId, args.chatId)
        if (!persist) return
        const chatKey = `${args.ownerId}:${args.chatId ?? ''}`
        if (denseStores.has(chatKey)) return
        const embedder = args.embedder().embedder
        if (!embedder) return
        denseStoreFor(chatKey, persist, embedder.modelKey)
        prefetchOnly.add(chatKey)
    } catch {
        // A prefetch is an optimisation; the send builds its own store.
    }
}

/** Frees a prefetched store its chat never used (the chat closed or the retrieval changed); a store a send used stays. */
export function releaseChroMemoryPrefetch(ownerId: string, chatId: string | undefined): void {
    try {
        const chatKey = `${ownerId}:${chatId ?? ''}`
        if (!prefetchOnly.delete(chatKey)) return
        const store = denseStores.get(chatKey)
        if (!store) return
        if (store.hasUnpersisted()) requestPersist(store, store.snapshot())
        store.dispose()
        denseStores.delete(chatKey)
    } catch {
        // Nothing here may reach the UI.
    }
}

interface CoreResult {
    trace: ChroMemoryTrace
    /** Set once make-room has spliced the history, whatever happens afterwards. */
    block: string | null
}

let slot: ShadowSlot | null = null
let lastTrace: ChroMemoryTrace | null = null

function messageOf(e: unknown): string {
    const m = e instanceof Error ? e.message : String(e)
    return m.slice(0, ERROR_MAX_CHARS)
}

function safeNow(deps: ShadowDeps): number {
    try {
        return deps.now()
    } catch {
        return 0
    }
}

function blankTrace(chatKey: string, mode: ChroMemoryTrace['mode'], budgetTokens: number, countCap: number, at: number): ChroMemoryTrace {
    return {
        v: 1,
        mode,
        chatKey,
        at,
        ms: 0,
        outcome: 'empty-d0',
        d0: { records: 0, units: 0, firstChatId: null, lastChatId: null },
        index: null,
        rebuildCause: null,
        query: null,
        admission: 'none',
        budgetTokens,
        T: 0,
        countCap,
        slots: 0,
        counted: 0,
        countCapped: false,
        items: [],
        makeRoom: null,
        timings: { index: 0, rank: 0, pack: 0, room: 0 },
        dense: null,
        timeBox: 'none',
        error: null,
    }
}

/**
 * The pack both modes run: the ranked lines under `budget`, the block also
 * fitting `room` (shadow passes `room = budget`). The walk starts from the
 * block's own count of the heading and keeps two count slots back for block
 * counts, so shadow and inject pick the same items before make-room.
 */
export function packForRoom(args: {
    lineAt: (i: number) => PackLine | undefined
    budget: number
    room: number
    countText(text: string): Promise<number>
    countBlock(block: string): Promise<number>
    countCap: number
    cache: Map<string, number> | undefined
}): Promise<PackResult> {
    return packUnits({
        lines: args.lineAt,
        budget: args.budget,
        countText: args.countText,
        countBlock: args.countBlock,
        maxCounts: args.countCap,
        cache: args.cache,
        headCount: () => args.countBlock(HEADER),
        reserve: 2,
        limit: args.room,
    })
}

/**
 * Publishes a finished trace. Every step has its own guard: a failing
 * subscriber or measure never reaches the send, and never skips a later step.
 */
function publishTrace(trace: ChroMemoryTrace, measure: boolean): void {
    lastTrace = trace
    try {
        chroMemoryTrace.set(trace)
    } catch {
        // A subscriber's throw must not fail the send.
    }
    try {
        if (get(chroMemoryDiscarded) === trace.chatKey) chroMemoryDiscarded.set(null)
    } catch {
        // As above.
    }
    if (!measure) return
    try {
        if (typeof performance !== 'undefined' && typeof performance.measure === 'function') {
            performance.measure('risu:chromemory', {
                start: trace.at,
                duration: trace.ms,
                detail: {
                    mode: trace.mode,
                    outcome: trace.outcome,
                    ms: trace.ms,
                    timings: trace.timings,
                    d0Units: trace.d0.units,
                    rebuildCause: trace.rebuildCause,
                    fresh: trace.index?.fresh ?? false,
                    counted: trace.counted,
                    T: trace.T,
                },
            })
        }
    } catch {
        // The measure is a device hook only.
    }
}

/**
 * The ChroMemory engine core: indexes the chats the engine-off trim dropped
 * (D0), ranks them against the newest message and packs what would be recalled.
 * With `inject` it also makes room and splices the history. It publishes
 * nothing, never rejects and never reads or writes DBState; the index holds
 * strings only. The result is decided where the splice happens: once
 * the history is spliced the block is returned whatever fails afterwards.
 */
async function runChroMemoryCore(input: ShadowInput, deps: ShadowDeps): Promise<CoreResult> {
    const countCap = input.countVaries ? VARYING_COUNT_CAP : SHADOW_COUNT_CAP
    const at = safeNow(deps)
    const trace = blankTrace(input.chatKey, input.inject ? 'inject' : 'shadow', input.budgetTokens, countCap, at)
    const state: { spliced: boolean, block: string | null } = { spliced: false, block: null }
    if (input.hybridShadow) trace.dense = { state: 'off', reason: 'shadow-mode', vectors: 0, units: 0, queryMs: 0, ms: 0 }
    try {
        const { before, kept } = input
        const dropped = before.length - kept.length
        if (kept.length > 0 && kept[0] !== before[dropped]) throw new Error('kept set is not a suffix')
        if (dropped > 0) await shadowOver(input, deps, trace, dropped, countCap, state)
    } catch (e) {
        try {
            trace.outcome = 'error'
            trace.error = messageOf(e)
        } catch {
            // The result below is already decided.
        }
    }
    trace.ms = Math.max(0, safeNow(deps) - at)
    return { trace, block: state.spliced ? state.block : null }
}

/** The engine core, published; returns the published trace. */
export async function runChroMemoryShadow(input: ShadowInput, deps: ShadowDeps): Promise<ChroMemoryTrace> {
    const { trace } = await runChroMemoryCore(input, deps)
    publishTrace(trace, true)
    return trace
}

/**
 * The vector step of a hybrid send: one query embed raced against the send's
 * time limit, then cosine and fusion. Everything sits in one try, so any
 * failure keeps the keyword order (null) and reports why on the trace; a
 * provider failure or timeout also pauses the provider for later sends, an
 * internal fault does not.
 */
async function fuseWithDense(
    dense: DenseEmbedderResult,
    s: ShadowSlot,
    lex: { order: IndexedUnit[], scored: number },
    queryText: string,
    deps: ShadowDeps,
    trace: ChroMemoryTrace,
): Promise<Fused | null> {
    const startedAt = safeNow(deps)
    const units = s.index.units()
    const status: DenseStatus = { state: 'paused', reason: null, vectors: 0, units: units.length, queryMs: 0, ms: 0 }
    trace.dense = status
    try {
        const embedder = dense.embedder
        if (!embedder) {
            status.reason = dense.reason ?? 'no-provider'
            return null
        }
        const store = (s.dense ??= denseStoreFor(s.index.chatKey, s.persist, embedder.modelKey))
        prefetchOnly.delete(s.index.chatKey)
        store.useModel(embedder.modelKey)
        // A late read still imports and serves the next send; this send goes out on the keyword order.
        if (!store.loaded) await settleWithin(store.ready, DENSE_LOAD_WAIT_MS)
        if (store.disposed) {
            status.state = 'building'
            return null
        }
        status.vectors = store.size
        const paused = currentDensePause()
        if (paused) {
            status.reason = paused.reason
            return null
        }
        if (store.size === 0) {
            status.state = 'building'
            return null
        }
        let query: Float32Array
        const queryAt = safeNow(deps)
        try {
            query = await raceTimeout((async () => embedder.embedQuery(queryInput(queryText)))(), QUERY_TIMEOUT_MS)
        } catch (e) {
            status.queryMs = Math.max(0, safeNow(deps) - queryAt)
            status.reason = pauseDenseAfter(e)
            return null
        }
        status.queryMs = Math.max(0, safeNow(deps) - queryAt)
        const ranking = denseOrder(store, units, query)
        const result = fuseOrders(lex.order, lex.scored, units, ranking.top)
        status.vectors = ranking.valid
        status.state = ranking.valid === 0 ? 'building' : ranking.valid < units.length ? 'partial' : 'ready'
        return result
    } catch {
        status.state = 'paused'
        status.reason = 'internal'
        return null
    } finally {
        status.ms = Math.max(0, safeNow(deps) - startedAt)
    }
}

async function shadowOver(input: ShadowInput, deps: ShadowDeps, trace: ChroMemoryTrace, dropped: number, countCap: number, state: { spliced: boolean, block: string | null }): Promise<void> {
    const d0: MessageRecord[] = []
    for (const chat of input.before.slice(0, dropped)) {
        const rec = input.recordOf(chat)
        if (rec) d0.push(rec)
    }
    if (!d0.length) return
    trace.d0 = { records: d0.length, units: 0, firstChatId: d0[0].chatId, lastChatId: d0[d0.length - 1].chatId }

    let lapAt = safeNow(deps)
    const lap = (): number => {
        const n = safeNow(deps)
        const d = Math.max(0, n - lapAt)
        lapAt = n
        return d
    }

    let chatSwitch = false
    let s = slot
    if (!s || s.index.chatKey !== input.chatKey) {
        chatSwitch = s !== null
        s = { index: new ChatUnitIndex(input.chatKey), tokenizerKey: input.tokenizerKey, lineCache: new Map(), dense: null, persist: input.persist }
        slot = s
    } else if (s.tokenizerKey !== input.tokenizerKey) {
        s.lineCache.clear()
        s.tokenizerKey = input.tokenizerKey
    }
    if (s.lineCache.size + countCap > LINE_CACHE_MAX) s.lineCache.clear()

    const rec = s.index.reconcile(d0)
    trace.index = rec
    trace.d0.units = rec.units
    trace.rebuildCause = rec.rebuildCause === 'fresh' && chatSwitch ? 'chat-switch' : rec.rebuildCause
    trace.timings.index = lap()
    const q = input.queryRecord()
    const queryText = q ? recordTextOf(q.preWrap) : ''
    if (!q || !queryText) {
        trace.outcome = 'no-query'
        if (q) trace.query = { chatId: q.chatId, terms: [] }
        return
    }
    const lex = s.index.rank(queryText, RARE_SHARE)
    const terms = lex.terms
    let order = lex.order
    trace.query = { chatId: q.chatId, terms }
    trace.timings.rank = lap()
    let fused: Fused | null = null
    if (input.dense) {
        fused = await fuseWithDense(input.dense, s, lex, queryText, deps, trace)
        if (fused) order = fused.order
        lap()
    }

    const keys = recordKeysOf(d0)
    const byKey = new Map<string, { rec: MessageRecord, pos: number }>()
    keys.forEach((k, pos) => byKey.set(k, { rec: d0[pos], pos }))
    const fresh = new Map<string, Piece[]>()
    const lineAt = (i: number): PackLine | undefined => {
        const unit = order[i]
        if (!unit) return undefined
        const owner = byKey.get(unit.key)
        if (!owner) throw new Error('indexed unit without a record')
        let pieces = fresh.get(unit.key)
        if (!pieces) {
            pieces = splitRecord(recordTextOf(owner.rec.preWrap), UNIT_CHARS)
            fresh.set(unit.key, pieces)
        }
        return {
            unit,
            pos: owner.pos,
            label: owner.rec.chatId === FIRST_MESSAGE_ID ? 'first' : String(owner.rec.index),
            name: owner.rec.name,
            text: pieces[unit.ordinal]?.text ?? unit.text,
            rank: fused ? (fused.ranks.get(unit)?.fused ?? i + 1) : i + 1,
        }
    }

    const inject = input.inject
    let room = input.budgetTokens
    let restated = { firstMessageChat: 0, tokensBeforeMessages: 0 }
    let keep = 0
    let merged: Map<OpenAIChat, number> | null = null
    if (inject) {
        // K0's chats make-room may evict: all but the newest `keep` message chats.
        restated = restateForKept({
            firstMessageChat: inject.firstMessageChat,
            tokensBeforeMessages: inject.tokensBeforeMessages,
            dropped: inject.step1.dropped,
            counts: inject.step1.counts,
        })
        keep = Math.max(1, Math.min(inject.floor, inject.chats.length - restated.firstMessageChat))
        merged = new Map(inject.step1.counts)
        let droppableTokens = 0
        for (const chat of inject.chats.slice(0, inject.chats.length - keep)) {
            let c = merged.get(chat)
            if (c === undefined) {
                c = await inject.count(chat)
                merged.set(chat, c)
            }
            droppableTokens += c
        }
        room = inject.maxContextTokens - inject.reserveTokens - (inject.step1.currentTokens - droppableTokens)
        if (!(room > 0)) {
            trace.outcome = 'no-room'
            return
        }
    }

    const packed = await packForRoom({
        lineAt,
        budget: input.budgetTokens,
        room,
        countText: deps.countText,
        countBlock: deps.countBlock,
        countCap,
        cache: input.countVaries ? undefined : s.lineCache,
    })
    trace.timings.pack = lap()
    trace.T = packed.T
    trace.slots = packed.slots
    trace.counted = packed.counted
    trace.countCapped = packed.capped
    trace.items = packed.picks
        .map((p, i) => ({ p, tokens: packed.pickTokens[i] }))
        .sort((a, b) => a.p.pos - b.p.pos || a.p.unit.off - b.p.unit.off)
        .map(({ p, tokens }) => {
            const r = fused?.ranks.get(p.unit)
            return {
                source: { kind: 'turn' as const, chatId: byKey.get(p.unit.key)?.rec.chatId ?? '', index: byKey.get(p.unit.key)?.rec.index ?? 0, off: p.unit.off },
                rank: r ? { lexical: r.lexical, dense: r.dense, fused: r.fused } : { lexical: p.rank, dense: null, fused: null },
                tokens,
            }
        })
    if (!packed.picks.length) {
        trace.outcome = inject && packed.droppedForFit > 0 && !packed.capped ? 'no-room' : 'nothing-packed'
        return
    }
    if (!inject || !merged) {
        trace.outcome = 'packed'
        return
    }

    // The last await: the trim splices as its final step, so a failure before it leaves K0.
    const limit = inject.maxContextTokens - inject.reserveTokens - packed.T
    const trim = deps.trim ?? trimChatsToContext
    const trimmed = await trim({
        chats: inject.chats,
        firstMessageChat: restated.firstMessageChat,
        tokensBeforeMessages: restated.tokensBeforeMessages,
        tokensAfterMessages: inject.tokensAfterMessages,
        countedMessages: merged,
        maxContextTokens: limit,
        count: inject.count,
        keepAtLeast: keep,
    })
    if (!trimmed.fits) {
        trace.outcome = 'no-room'
        return
    }
    state.block = packed.block
    state.spliced = true
    let evictedTokens = 0
    for (const chat of trimmed.dropped) evictedTokens += trimmed.counts.get(chat) ?? merged.get(chat) ?? 0
    trace.makeRoom = {
        room,
        limit,
        reserved: inject.reserveTokens,
        floor: keep,
        evictedChats: trimmed.dropped.length,
        evictedTokens,
        itemsDropped: packed.droppedForFit,
    }
    trace.timings.room = lap()
    trace.outcome = 'injected'
}

export interface ShadowSendArgs {
    capture: SendCapture
    first: FirstMessageSource | null
    charName: string
    userName(): string
    before: readonly OpenAIChat[]
    kept: readonly OpenAIChat[]
    ownerId: string
    chatId: string | undefined
    ltmSettings: unknown
    maxContextTokens: number
    countVaries: boolean
    tokenizerKey(): string
    /** Set when the memory message may be placed; the shadow otherwise. */
    inject: Omit<InjectInput, 'maxContextTokens'> | null
}

/**
 * The send adapter: resolves the records and settings, runs the engine and
 * publishes its trace. It never rejects. It returns the block to place when
 * make-room has spliced the history, and null otherwise; the history is
 * untouched whenever it returns null.
 */
export async function runChroMemorySafely(args: ShadowSendArgs, deps: ShadowDeps): Promise<{ block: string } | null> {
    let chatKey = ''
    let budgetTokens = 0
    let result: CoreResult
    let dense: DenseEmbedderResult | undefined
    try {
        chatKey = `${args.ownerId}:${args.chatId ?? ''}`
        const settings = readLtmSettings(args.ltmSettings, args.maxContextTokens)
        budgetTokens = settings.budgetTokens
        const hybrid = settings.retrieval === 'hybrid'
        if (hybrid && args.inject) {
            try {
                dense = deps.embedder?.() ?? { embedder: null, reason: 'no-provider' }
            } catch {
                dense = { embedder: null, reason: 'no-provider' }
            }
        }
        let user: string | undefined
        const userName = (): string => (user ??= args.userName())
        result = await runChroMemoryCore(
            {
                chatKey,
                before: args.before,
                kept: args.kept,
                recordOf: (chat) => {
                    if (args.first && chat === args.first.chat) return firstRecordOf(args.first, args.charName)
                    const ref = args.capture.refs.get(chat)
                    return ref ? recordOf(ref, userName()) : null
                },
                queryRecord: () => (args.capture.newest ? recordOf(args.capture.newest, userName()) : null),
                budgetTokens,
                countVaries: args.countVaries,
                tokenizerKey: args.tokenizerKey(),
                inject: args.inject ? { ...args.inject, maxContextTokens: args.maxContextTokens } : undefined,
                dense,
                hybridShadow: hybrid && !args.inject ? true : undefined,
                persist: persistTargetOf(args.ownerId, args.chatId),
            },
            deps,
        )
    } catch (e) {
        const at = safeNow(deps)
        const trace = blankTrace(chatKey, args.inject ? 'inject' : 'shadow', budgetTokens, args.countVaries ? VARYING_COUNT_CAP : SHADOW_COUNT_CAP, at)
        try {
            trace.outcome = 'error'
            trace.error = messageOf(e)
        } catch {
            // The send continues without a block either way.
        }
        result = { trace, block: null }
    }
    publishTrace(result.trace, true)
    if (dense?.embedder) scheduleDense(chatKey, dense.embedder, deps)
    return result.block === null ? null : { block: result.block }
}

/** Hands the current chat's store to the indexer hook; a failure here never reaches the send. */
function scheduleDense(chatKey: string, embedder: DenseEmbedder, deps: ShadowDeps): void {
    try {
        const s = slot
        const store = s?.dense
        if (!s || !store || s.index.chatKey !== chatKey) return
        const hand = deps.scheduleDense ?? scheduleDenseIndexing
        hand({
            store,
            units: () => s.index.units(),
            embedder,
            isLive: () => slot === s && s.dense === store && !store.disposed,
        })
    } catch {
        // Indexing is optional; the send is already decided.
    }
}

/**
 * Re-publishes the last trace of this chat as dropped at the recheck. The
 * send's measure entry was already written, so it is not written twice.
 */
export function markChroMemoryDroppedAtRecheck(chatKey: string): void {
    try {
        const t = lastTrace
        if (!t || t.chatKey !== chatKey) return
        publishTrace({ ...t, outcome: 'dropped-at-recheck' }, false)
    } catch {
        // A trace mark never fails a send.
    }
}

/**
 * Discards this chat's index at once; the next send rebuilds it. Another chat's
 * slot is left alone, and the notice is still set because this chat's next send
 * builds fresh either way.
 */
export function discardChroMemoryIndex(chatKey: string): void {
    if (slot && slot.index.chatKey === chatKey) slot = null
    prefetchOnly.delete(chatKey)
    const store = denseStores.get(chatKey)
    if (store) {
        store.dispose()
        denseStores.delete(chatKey)
    }
    // The persisted folder goes with the index: a discard means the chat's text is no longer what it was embedded from.
    void requestDeleteFolder(chatKey)
    chroMemoryDiscarded.set(chatKey)
}

export function getLastChroMemoryTrace(): Readonly<ChroMemoryTrace> | null {
    return lastTrace
}

export function resetChroMemoryShadowForTests(): void {
    slot = null
    for (const store of denseStores.values()) store.dispose()
    denseStores.clear()
    prefetchOnly.clear()
    resetDensePauseForTests()
    resetDenseIndexerForTests()
    resetVectorPersistForTests()
    lastTrace = null
    chroMemoryTrace.set(null)
    chroMemoryDiscarded.set(null)
}

export function shadowLineCacheSizeForTests(): number {
    return slot?.lineCache.size ?? 0
}
