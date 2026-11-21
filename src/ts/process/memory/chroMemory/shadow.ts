import type { OpenAIChat } from '../../index.svelte'
import { ChatUnitIndex, RARE_SHARE, recordKeysOf, type Reconcile } from './chatIndex'
import { SHADOW_COUNT_CAP, VARYING_COUNT_CAP, packUnits, type PackLine } from './pack'
import { FIRST_MESSAGE_ID, firstRecordOf, recordOf, recordTextOf, type FirstMessageSource, type MessageRecord, type SendCapture } from './records'
import { readLtmSettings } from './settings'
import { UNIT_CHARS, splitRecord, type Piece } from './units'

/** The most line texts the slot's count cache holds; it is cleared before a pack that could pass this. */
export const LINE_CACHE_MAX = 512
const ERROR_MAX_CHARS = 200

export interface ChroMemoryTraceItem {
    source: { kind: 'turn', chatId: string, index: number, off: number }
    rank: { lexical: number, dense: null, fused: null }
    tokens: number
}

export type ChroMemoryRebuildCause = 'fresh' | 'chat-switch' | 'tail-shrink' | 'mid-removal'

export interface ChroMemoryTrace {
    v: 1
    mode: 'shadow'
    chatKey: string
    at: number
    ms: number
    outcome: 'packed' | 'nothing-packed' | 'empty-d0' | 'no-query' | 'error'
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
    makeRoom: null
    timeBox: 'none'
    error: string | null
}

export interface ShadowInput {
    chatKey: string
    /** The chats before the engine-off trim. */
    before: readonly OpenAIChat[]
    /** The chats after it (K0). */
    kept: readonly OpenAIChat[]
    /** Called only for D0 chats; null for a chat without a record (examples, the NewChat marker). */
    recordOf(chat: OpenAIChat): MessageRecord | null
    /** The newest captured message; called only when D0 is non-empty. */
    queryRecord(): MessageRecord | null
    budgetTokens: number
    countVaries: boolean
    /** The counter identity; a change clears the line cache. */
    tokenizerKey: string
}

export interface ShadowDeps {
    countText(text: string): Promise<number>
    countBlock(block: string): Promise<number>
    now(): number
}

interface ShadowSlot {
    index: ChatUnitIndex
    tokenizerKey: string
    lineCache: Map<string, number>
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

function blankTrace(chatKey: string, budgetTokens: number, countCap: number, at: number): ChroMemoryTrace {
    return {
        v: 1,
        mode: 'shadow',
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
        timeBox: 'none',
        error: null,
    }
}

/**
 * The ChroMemory shadow: indexes the chats the engine-off trim dropped (D0),
 * ranks them against the newest message and packs what would be recalled, and
 * keeps a trace. It never rejects, never reads or writes DBState, and never
 * changes its inputs; the index holds strings only.
 */
export async function runChroMemoryShadow(input: ShadowInput, deps: ShadowDeps): Promise<ChroMemoryTrace> {
    const countCap = input.countVaries ? VARYING_COUNT_CAP : SHADOW_COUNT_CAP
    const at = safeNow(deps)
    const trace = blankTrace(input.chatKey, input.budgetTokens, countCap, at)
    try {
        const { before, kept } = input
        const dropped = before.length - kept.length
        if (kept.length > 0 && kept[0] !== before[dropped]) throw new Error('kept set is not a suffix')
        if (dropped > 0) await shadowOver(input, deps, trace, dropped, countCap)
    } catch (e) {
        trace.outcome = 'error'
        trace.error = messageOf(e)
    }
    trace.ms = Math.max(0, safeNow(deps) - at)
    lastTrace = trace
    return trace
}

async function shadowOver(input: ShadowInput, deps: ShadowDeps, trace: ChroMemoryTrace, dropped: number, countCap: number): Promise<void> {
    const d0: MessageRecord[] = []
    for (const chat of input.before.slice(0, dropped)) {
        const rec = input.recordOf(chat)
        if (rec) d0.push(rec)
    }
    if (!d0.length) return
    trace.d0 = { records: d0.length, units: 0, firstChatId: d0[0].chatId, lastChatId: d0[d0.length - 1].chatId }

    let chatSwitch = false
    let s = slot
    if (!s || s.index.chatKey !== input.chatKey) {
        chatSwitch = s !== null
        s = { index: new ChatUnitIndex(input.chatKey), tokenizerKey: input.tokenizerKey, lineCache: new Map() }
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
    const q = input.queryRecord()
    const queryText = q ? recordTextOf(q.preWrap) : ''
    if (!q || !queryText) {
        trace.outcome = 'no-query'
        if (q) trace.query = { chatId: q.chatId, terms: [] }
        return
    }
    const { order, terms } = s.index.rank(queryText, RARE_SHARE)
    trace.query = { chatId: q.chatId, terms }

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
            rank: i + 1,
        }
    }
    const packed = await packUnits({
        lines: lineAt,
        budget: input.budgetTokens,
        countText: deps.countText,
        countBlock: deps.countBlock,
        maxCounts: countCap,
        cache: input.countVaries ? undefined : s.lineCache,
    })
    trace.T = packed.T
    trace.slots = packed.slots
    trace.counted = packed.counted
    trace.countCapped = packed.capped
    trace.items = packed.picks
        .map((p, i) => ({ p, tokens: packed.pickTokens[i] }))
        .sort((a, b) => a.p.pos - b.p.pos || a.p.unit.off - b.p.unit.off)
        .map(({ p, tokens }) => ({
            source: { kind: 'turn' as const, chatId: byKey.get(p.unit.key)?.rec.chatId ?? '', index: byKey.get(p.unit.key)?.rec.index ?? 0, off: p.unit.off },
            rank: { lexical: p.rank, dense: null, fused: null },
            tokens,
        }))
    trace.outcome = packed.picks.length ? 'packed' : 'nothing-packed'
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
}

/** The send adapter: resolves the records and settings, runs the shadow, and never rejects. */
export async function runShadowSafely(args: ShadowSendArgs, deps: ShadowDeps): Promise<void> {
    let chatKey = ''
    let budgetTokens = 0
    try {
        chatKey = `${args.ownerId}:${args.chatId ?? ''}`
        budgetTokens = readLtmSettings(args.ltmSettings, args.maxContextTokens).budgetTokens
        let user: string | undefined
        const userName = (): string => (user ??= args.userName())
        await runChroMemoryShadow(
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
            },
            deps,
        )
    } catch (e) {
        const at = safeNow(deps)
        const trace = blankTrace(chatKey, budgetTokens, args.countVaries ? VARYING_COUNT_CAP : SHADOW_COUNT_CAP, at)
        trace.outcome = 'error'
        trace.error = messageOf(e)
        lastTrace = trace
    }
}

export function getLastChroMemoryTrace(): Readonly<ChroMemoryTrace> | null {
    return lastTrace
}

export function resetChroMemoryShadowForTests(): void {
    slot = null
    lastTrace = null
}

export function shadowLineCacheSizeForTests(): number {
    return slot?.lineCache.size ?? 0
}
