// Spec 5.4 lore recall: ranks the lore entries the scan evaluated and missed on the primary key, and returns the ones to
// place. The scan owns the lore budget and the miss rule and enforces both on whatever this step returns. No import
// from util.ts: the entry hash is injected, so the S4 harness can load this module as it is.
import type { Message } from 'src/ts/storage/database.svelte'
import { loreEntryName } from '../../loreUse'
import { splitLoreKeys } from '../../loreKeys'
import { tokenize, type Bm25Index } from './lexical'
import { createLoreLiveLookup, type LoreIndexInfo, type LoreIndexStore, type LoreScanEntries } from './loreIndex'
import type { LtmSettings } from './settings'
import { chroLoreTrace } from './traceStore'

/** Decorators whose presence on an entry keeps it out of lore recall: the author's own rule decided the miss, or the entry is placed specially. */
export const EXCLUDED_DECORATORS: ReadonlySet<string> = new Set([
    'probability',
    'activate_only_after',
    'activate_only_every',
    'keep_activate_after_match',
    'dont_activate_after_match',
    'is_greeting',
    'activate',
    'dont_activate',
    'additional_keys',
    'exclude_keys',
    'exclude_keys_all',
    'position',
    'depth',
    'reverse_depth',
    'role',
    'disable_ui_prompt',
    'ignore_on_max_context',
    'end',
    'scan_depth',
])

/** Every `inject_*` decorator is excluded by prefix. */
export const EXCLUDED_DECORATOR_PREFIX = 'inject_'

/** Decorators that change how a key matches but not whether the author meant the entry to stay unmatched. */
export const NEUTRAL_DECORATORS: ReadonlySet<string> = new Set([
    'priority',
    'match_full_word',
    'match_partial_word',
    'recursive',
    'unrecursive',
    'no_recursive_search',
])

/** Scan decorators that only return false so the next fallback line runs; judged by the fallback lines' own names. */
export const INERT_DECORATORS: ReadonlySet<string> = new Set([
    'instruct_depth',
    'reverse_instruct_depth',
    'instruct_scan_depth',
    'is_user_icon',
])

export function isExcludedDecorator(name: string): boolean {
    return EXCLUDED_DECORATORS.has(name) || name.startsWith(EXCLUDED_DECORATOR_PREFIX)
}

/** The entry fields lore recall reads, as the scan's `fullLore` carries them. */
export interface LoreRecallEntry {
    key: string
    content: string
    id?: string | null
    mode?: string
    selective?: boolean
    useRegex?: boolean
    comment?: string
}

export interface LoreRender {
    text: string
    tokens: number
}

/** What the scan hands the step after its cut; every field is read-only for the step. */
export interface LoreRecallView extends LoreScanEntries {
    entries: ReadonlyArray<LoreRecallEntry>
    /** Final-pass keyword misses by `entries` index: the stripped body and the decorator names the scan saw. */
    missed: ReadonlyMap<number, { body: string, decorators: readonly string[] }>
    cutForBudget: boolean
    loreToken: number
    unusedTokens: number
    /** `min(unusedTokens, cap)`, the budget the scan will enforce. */
    limit: number
    /** The `id` of every child entry: a parent linked by a child already reaches the prompt through it. */
    linkedIds: ReadonlySet<string>
    /** The scan's side-effect-free render and token count for entry `index`, cached per index. */
    render(index: number): Promise<LoreRender>
}

export interface LoreRecallTap {
    /** The `loreRecallCap` the step was built with. */
    cap: number
    /** The entries to place, best first. Any list is accepted; the scan drops what it must not place. */
    run(view: LoreRecallView): Promise<number[]> | number[]
}

export type LoreRecallOutcome =
    | 'placed'
    | 'would-place'
    | 'budget-cut'
    | 'no-budget'
    | 'no-query'
    | 'index-building'
    | 'no-candidates'
    | 'nothing-admitted'
    | 'nothing-fit'
    | 'error'

export interface ChroLoreTraceItem {
    source: { kind: 'lore', from: 'character' | 'chat' | 'module', index: number, name: string }
    rank: { lexical: number, dense: null, fused: null }
    score: number
    tokens: number
}

export interface ChroLoreTrace {
    v: 1
    chatKey: string
    at: number
    ms: number
    mode: 'shadow' | 'inject'
    outcome: LoreRecallOutcome
    query: { chars: number, terms: number }
    budget: { loreToken: number, unused: number, cap: number, limit: number, used: number }
    candidates: { missed: number, staticExcluded: number, linked: number, duplicate: number, identityMiss: number, eligible: number }
    admission: { tau: number | null, rejected: number }
    index: LoreIndexInfo
    items: ChroLoreTraceItem[]
    renders: number
    droppedEmpty: number
    trimmed: { removed: number } | null
    error?: string
}

/** The admission threshold for lore (an S4 output, tuned by the harness). */
export const LORE_TAU = 0.02

/** The most entries recalled per send (an S4 output). */
export const LORE_MAX_PICKS = 1

/** Bounds the CBS work a send spends on candidates it may drop: 2N + 2 renders. */
export const LORE_MAX_RENDERS = 2 * LORE_MAX_PICKS + 2

/** The query is the last this many code points of the newest sent message. */
export const LORE_QUERY_CHARS = 500

const ERROR_MAX_CHARS = 200

export function staticExclusion(entry: LoreRecallEntry, decorators: readonly string[], linkedIds: ReadonlySet<string>): 'static' | 'linked' | null {
    for (const name of decorators) if (isExcludedDecorator(name)) return 'static'
    if (entry.selective === true || entry.useRegex === true) return 'static'
    if (entry.mode === 'folder' || entry.mode === 'child' || entry.mode === 'constant') return 'static'
    if (!splitLoreKeys(entry.key ?? '', false).some((k) => k.trim().length > 0)) return 'static'
    if (entry.id != null && linkedIds.has(entry.id)) return 'linked'
    return null
}

export function staticallyEligible(entry: LoreRecallEntry, decorators: readonly string[], linkedIds: ReadonlySet<string>): boolean {
    return staticExclusion(entry, decorators, linkedIds) === null
}

/** The tail of the newest sent message's raw `data`; '' when there is none. A surrogate pair is never split. */
export function loreQueryOf(messages: Message[], splitSent: (messages: Message[]) => { sent: Message[] }): string {
    const newest = splitSent(messages).sent.at(-1)
    const data = newest?.data
    if (typeof data !== 'string') return ''
    const points = Array.from(data)
    return points.length <= LORE_QUERY_CHARS ? data : points.slice(points.length - LORE_QUERY_CHARS).join('')
}

export interface ScoredLoreDoc {
    doc: number
    score: number
}

export interface LoreScoring {
    /** Admitted documents with a positive score, best first, ties to the lower document id. */
    ranked: ScoredLoreDoc[]
    /** Documents that scored but failed admission. */
    rejected: number
    qTokens: string[]
}

/**
 * The single lexical scoring function of lore recall. Admission (spec 5.6) keeps a document only when it holds a query
 * token whose document frequency is at most max(1, floor(tau x N)); that is exactly a positive BM25 score over the rare
 * query tokens, so no document text is tokenized again. A score of 0 is never ranked.
 */
export function scoreLoreCandidates(index: Bm25Index, query: string, tau: number | null): LoreScoring {
    const qTokens = [...new Set(tokenize(query))]
    const scores = index.scoreTokens(qTokens)
    let adm: Float64Array | null = null
    if (tau !== null) {
        const lim = Math.max(1, Math.floor(tau * index.size))
        adm = index.scoreTokens(qTokens.filter((t) => {
            const df = index.df(t)
            return df >= 1 && df <= lim
        }))
    }
    const ranked: ScoredLoreDoc[] = []
    let rejected = 0
    for (let doc = 0; doc < scores.length; doc++) {
        if (!(scores[doc] > 0)) continue
        if (adm !== null && !(adm[doc] > 0)) {
            rejected++
            continue
        }
        ranked.push({ doc, score: scores[doc] })
    }
    ranked.sort((a, b) => b.score - a.score || a.doc - b.doc)
    return { ranked, rejected, qTokens }
}

export interface LoreRecallDeps {
    store: LoreIndexStore
    /** The scan's content-hash fallback, `(c) => pickHashRand(5555, c)`. */
    hash(content: string): number
    now(): number
    tau?: number | null
    maxPicks?: number
    maxRenders?: number
}

export interface LoreRecallStepArgs {
    mode: 'shadow' | 'inject'
    settings: Pick<LtmSettings, 'loreRecallCap'>
    query: string
    /** The owning character's id, the first part of the index key. */
    ownerKey: string
    chatKey: string
    deps: LoreRecallDeps
}

let lastLoreTrace: ChroLoreTrace | null = null

function publishLoreTrace(trace: ChroLoreTrace): void {
    lastLoreTrace = trace
    try {
        chroLoreTrace.set(trace)
    } catch {
        // A subscriber's throw must not fail the send.
    }
}

/** Re-publishes this chat's last lore trace with the number of recalled entries step 1 removed. */
export function markLoreRecallTrimmed(chatKey: string, removed: number): void {
    try {
        const t = lastLoreTrace
        if (!t || t.chatKey !== chatKey) return
        publishLoreTrace({ ...t, trimmed: { removed } })
    } catch {
        // A trace mark never fails a send.
    }
}

/** Drops this chat's lore trace when a send ran no recall, so the modal never shows a send that carried no lore as injected. */
export function clearLoreRecallTrace(chatKey: string): void {
    try {
        if (!lastLoreTrace || lastLoreTrace.chatKey !== chatKey) return
        lastLoreTrace = null
        chroLoreTrace.set(null)
    } catch {
        // A trace clear never fails a send.
    }
}

function sourceOfIndex(view: LoreScanEntries, i: number): { from: 'character' | 'chat' | 'module', index: number } {
    if (i < view.characterCount) return { from: 'character', index: i }
    const chatIndex = i - view.characterCount
    if (chatIndex < view.chatCount) return { from: 'chat', index: chatIndex }
    return { from: 'module', index: chatIndex - view.chatCount }
}

function errorText(e: unknown): string {
    return (e instanceof Error ? e.message : String(e)).slice(0, ERROR_MAX_CHARS)
}

export function createLoreRecallStep(args: LoreRecallStepArgs): LoreRecallTap {
    const { mode, settings, query, ownerKey, chatKey, deps } = args
    const tau = deps.tau === undefined ? LORE_TAU : deps.tau
    const maxPicks = deps.maxPicks ?? LORE_MAX_PICKS
    const maxRenders = deps.maxRenders ?? LORE_MAX_RENDERS
    const safeNow = (): number => {
        try {
            return deps.now()
        } catch {
            return 0
        }
    }
    return {
        cap: settings.loreRecallCap,
        async run(view) {
            const startedAt = safeNow()
            const trace: ChroLoreTrace = {
                v: 1,
                chatKey,
                at: startedAt,
                ms: 0,
                mode,
                outcome: 'no-candidates',
                query: { chars: query.length, terms: 0 },
                budget: { loreToken: view.loreToken, unused: view.unusedTokens, cap: settings.loreRecallCap, limit: view.limit, used: 0 },
                candidates: { missed: view.missed.size, staticExcluded: 0, linked: 0, duplicate: 0, identityMiss: 0, eligible: 0 },
                admission: { tau, rejected: 0 },
                index: { state: 'none', entries: 0, buildMs: 0 },
                items: [],
                renders: 0,
                droppedEmpty: 0,
                trimmed: null,
            }
            let picks: number[] = []
            try {
                picks = await recallInto(trace, view)
            } catch (e) {
                picks = []
                trace.outcome = 'error'
                trace.error = errorText(e)
                trace.items = []
                trace.budget.used = 0
            }
            trace.ms = Math.max(0, safeNow() - startedAt)
            publishLoreTrace(trace)
            return mode === 'inject' && trace.outcome === 'placed' ? picks : []
        },
    }

    async function recallInto(trace: ChroLoreTrace, view: LoreRecallView): Promise<number[]> {
        const ready = deps.store.ensure(ownerKey, view)
        trace.index = deps.store.info()
        if (view.cutForBudget) {
            trace.outcome = 'budget-cut'
            return []
        }
        if (!(view.limit > 0)) {
            trace.outcome = 'no-budget'
            return []
        }
        if (query === '') {
            trace.outcome = 'no-query'
            return []
        }
        if (!ready) {
            trace.outcome = 'index-building'
            return []
        }
        const scoring = scoreLoreCandidates(ready.bm25, query, tau)
        trace.query.terms = scoring.qTokens.length
        trace.admission.rejected = scoring.rejected
        if (scoring.ranked.length === 0) {
            trace.outcome = scoring.rejected > 0 ? 'nothing-admitted' : 'no-candidates'
            return []
        }
        const lookup = createLoreLiveLookup(view, (i) => view.missed.has(i), deps.hash)
        const taken: number[] = []
        const takenSet = new Set<number>()
        let used = 0
        let rebuild = false
        for (let rank = 0; rank < scoring.ranked.length; rank++) {
            if (taken.length >= maxPicks || trace.renders >= maxRenders) break
            const { doc, score } = scoring.ranked[rank]
            const res = lookup.resolve(ready.docs[doc])
            if (res.kind === 'prefiltered') continue
            if (res.indexes.length === 0) {
                trace.candidates.identityMiss++
                rebuild = true
                continue
            }
            if (res.indexes.length >= 2) {
                trace.candidates.duplicate++
                continue
            }
            const i = res.indexes[0]
            if (takenSet.has(i)) continue
            const record = view.missed.get(i)
            if (!record) continue
            const exclusion = staticExclusion(view.entries[i], record.decorators, view.linkedIds)
            if (exclusion === 'linked') {
                trace.candidates.linked++
                continue
            }
            if (exclusion === 'static') {
                trace.candidates.staticExcluded++
                continue
            }
            trace.candidates.eligible++
            trace.renders++
            const rendered = await view.render(i)
            if (rendered.text.trim() === '') {
                trace.droppedEmpty++
                continue
            }
            if (!(used + rendered.tokens <= view.limit)) continue
            used += rendered.tokens
            taken.push(i)
            takenSet.add(i)
            const src = sourceOfIndex(view, i)
            trace.items.push({
                source: { kind: 'lore', from: src.from, index: src.index, name: loreEntryName(view.entries[i]) },
                rank: { lexical: rank + 1, dense: null, fused: null },
                score,
                tokens: rendered.tokens,
            })
        }
        trace.budget.used = used
        if (rebuild) deps.store.requestRebuild(ownerKey, view)
        if (taken.length === 0) {
            trace.outcome = 'nothing-fit'
            return []
        }
        trace.outcome = mode === 'inject' ? 'placed' : 'would-place'
        return taken
    }
}
