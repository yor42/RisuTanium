import { vi } from 'vitest'
import { trimChatsToContext } from '../../../contextTrim'
import type { OpenAIChat } from '../../../index.svelte'
import type { IndexedUnit } from '../chatIndex'
import type { DenseEmbedder, DenseJob } from '../dense'
import { tokenize } from '../lexical'
import { createSendCapture, type CapturedMessage } from '../records'
import { writeLtmSettings } from '../settings'
import { HISTORY_FLOOR, type ShadowDeps, type ShadowSendArgs } from '../shadow'

export const DIMS = 64

/** Each concept is one dimension; a text's vector counts the terms it holds, English and Korean alike. */
const CONCEPTS: string[][] = [
    ['puppy', 'dog', 'hound', 'canine', 'pooch', '강아지', '반려견', '멍멍이'],
    ['rain', 'drizzle', 'storm', 'downpour', '폭우', '소나기'],
    ['bread', 'loaf', 'bakery', 'baguette', '빵', '베이커리'],
    ['ship', 'vessel', 'harbor', 'sailor', '선박', '항구'],
    ['music', 'melody', 'guitar', 'song', '음악', '기타'],
    ['garden', 'flower', 'tulip', 'soil', '정원', '화단'],
    ['money', 'coin', 'wallet', 'price', '지갑', '동전'],
    ['sleep', 'nap', 'pillow', 'dream', '낮잠', '베개'],
]

function hashOf(s: string): number {
    let h = 2166136261
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
    return h
}

/** A deterministic stand-in for an embedding model: it knows concepts, never the test's target. */
export function conceptVector(text: string): Float32Array {
    const v = new Float32Array(DIMS)
    const lower = text.normalize('NFKC').toLowerCase()
    CONCEPTS.forEach((terms, ci) => {
        for (const t of terms) v[ci] += lower.split(t).length - 1
    })
    for (const word of lower.split(/[^\p{L}\p{N}]+/u)) {
        if (word) v[CONCEPTS.length + (hashOf(word) % (DIMS - CONCEPTS.length))] += 0.05
    }
    let n = 0
    for (let i = 0; i < DIMS; i++) n += v[i] * v[i]
    n = Math.sqrt(n) || 1
    for (let i = 0; i < DIMS; i++) v[i] /= n
    return v
}

export interface ConceptEmbedder extends DenseEmbedder {
    queries: string[]
    documents: string[][]
}

export function conceptEmbedder(modelKey = 'concept-v1', over: Partial<DenseEmbedder> = {}): ConceptEmbedder {
    const queries: string[] = []
    const documents: string[][] = []
    return {
        modelKey,
        queries,
        documents,
        embedQuery: async (text) => {
            queries.push(text)
            return conceptVector(text)
        },
        embedDocuments: async (texts) => {
            documents.push(texts)
            return texts.map(conceptVector)
        },
        ...over,
    }
}

/**
 * A test-local indexer behind `deps.scheduleDense`: it embeds every missing
 * unit of the job's chat and writes while the job stays live. It keeps each
 * job, so a test can seed the store directly.
 */
export function directIndexer() {
    const jobs: DenseJob[] = []
    let pending: Promise<void> = Promise.resolve()
    return {
        jobs,
        schedule: (job: DenseJob): void => {
            jobs.push(job)
            pending = pending.then(async () => {
                const missing = job.units().filter((u) => !job.store.get(u))
                if (!missing.length) return
                const vecs = await job.embedder.embedDocuments(missing.map((u) => u.text))
                if (!job.isLive()) return
                missing.forEach((u, i) => job.store.set(u, vecs[i]))
            })
        },
        idle: async (): Promise<void> => {
            await pending
        },
    }
}

/** The stored settings the real writer produces for this patch. */
export function ltmOf(patch: Parameters<typeof writeLtmSettings>[1]): unknown {
    const db: { ltmSettings?: unknown } = {}
    writeLtmSettings(db, patch)
    return db.ltmSettings
}

export const len = (s: string): number => Math.ceil(s.length / 4)
const countChat = async (c: OpenAIChat): Promise<number> => c.content.length

export function deps(over: Partial<ShadowDeps> = {}) {
    const countText = vi.fn(async (t: string) => len(t))
    const countBlock = vi.fn(async (b: string) => len(b) + 3)
    let t = 1000
    const d: ShadowDeps = { countText, countBlock, now: () => (t += 5), ...over }
    return { d, countText, countBlock }
}

export interface SendSpec {
    /** Every message of the send in order; the last is the newest (the query). */
    texts: string[]
    /** The messages the engine-off trim drops (D0): the first `d0` of them. */
    d0: number
    ownerId?: string
    chatId?: string
    budget?: number
    /** The raw data each message hashes by; a message defaults to its own text. A different preWrap with the same raw keeps the record key. */
    raws?: string[]
    ltm?: unknown
}

export interface BuiltSend {
    chats: OpenAIChat[]
    args: ShadowSendArgs
}

/** The send the engine sees at its call site: real step-1 trim over real captures, make-room input as the inject tests build it. */
export async function buildSend(spec: SendSpec): Promise<BuiltSend> {
    const { texts, d0 } = spec
    const total = texts.length
    const messages: OpenAIChat[] = texts.map((t, i) => ({ role: i % 2 ? 'assistant' : 'user', content: t }))
    const refs: CapturedMessage[] = messages.map((m, i) => ({
        msg: { chatId: `c${i}`, role: i % 2 ? 'char' : 'user', data: spec.raws?.[i] ?? m.content },
        chatIndex: i,
        name: 'Bot',
        preWrap: m.content,
        data: spec.raws?.[i] ?? m.content,
    }))
    const capture = createSendCapture()
    messages.forEach((m, i) => capture.add(m, refs[i]))
    const all = messages.slice()
    const before = all.slice()
    const keptTotal = messages.slice(d0).reduce((a, m) => a + m.content.length, 0)
    const step1 = await trimChatsToContext({
        chats: all,
        firstMessageChat: 0,
        tokensBeforeMessages: 0,
        tokensAfterMessages: [],
        countedMessages: new Map(),
        maxContextTokens: keptTotal,
        count: countChat,
    })
    if (!step1.fits || all.length !== total - d0) throw new Error('fixture step 1 did not drop the intended prefix')
    const maxContextTokens = keptTotal + 4000
    const budget = spec.budget ?? 400
    return {
        chats: all,
        args: {
            capture,
            first: null,
            charName: 'Bot',
            userName: () => 'User',
            before,
            kept: all,
            ownerId: spec.ownerId ?? 'owner',
            chatId: spec.chatId ?? 'chat',
            ltmSettings: 'ltm' in spec ? spec.ltm : ltmOf({ budgetTokens: budget, retrieval: 'hybrid' }),
            maxContextTokens,
            countVaries: false,
            tokenizerKey: () => 'tk',
            inject: {
                chats: all,
                step1: { currentTokens: step1.currentTokens, dropped: step1.dropped, counts: step1.counts },
                firstMessageChat: 0,
                tokensBeforeMessages: 0,
                tokensAfterMessages: [],
                reserveTokens: 0,
                floor: HISTORY_FLOOR,
                count: vi.fn(countChat),
            },
        },
    }
}

/** A chat of `fillers` unrelated dropped records with `target` among them, then a kept tail whose last message is the query. */
export function paraphraseChat(target: string, query: string, opts: { fillers?: number, targetAt?: number, keptTail?: number } = {}): { texts: string[], d0: number } {
    const fillers = opts.fillers ?? 29
    const at = opts.targetAt ?? 5
    const texts: string[] = []
    const stuff = ['rain', 'bread', 'ship', 'music', 'garden', 'money', 'sleep']
    for (let i = 0; i < fillers + 1; i++) {
        if (i === at) texts.push(target)
        else texts.push(`Entry ${i}: the ${stuff[i % stuff.length]} item${i} moved along near place${i}.`)
    }
    const d0 = texts.length
    const tail = opts.keptTail ?? 5
    for (let i = 0; i < tail - 1; i++) texts.push(`Tail ${i} keeps going with filler${i}.`)
    texts.push(query)
    return { texts, d0 }
}

/** A unit as the engine holds it, for tests that call the pure functions directly. */
export function unitOf(key: string, text = key, ordinal = 0, off = 0): IndexedUnit {
    return { key, ordinal, off, text }
}

/** Query tokens shared with any text; the paraphrase fixtures must have none, so the keyword order cannot find the target. */
export function sharedTokens(query: string, text: string): string[] {
    const have = new Set(tokenize(text))
    return [...new Set(tokenize(query))].filter((t) => have.has(t))
}
