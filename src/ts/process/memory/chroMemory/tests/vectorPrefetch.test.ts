// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DENSE_LOAD_WAIT_MS, type DenseEmbedderResult } from '../dense'
import { getLastChroMemoryTrace, prefetchChroMemoryVectors, releaseChroMemoryPrefetch, resetChroMemoryShadowForTests, runChroMemorySafely } from '../shadow'
import type { LoadTarget } from '../vectorPersist'
import { buildSend, conceptEmbedder, deps, ltmOf, paraphraseChat } from './denseFixtures'

const LOAD_MS = 1600
const h = vi.hoisted(() => ({ loads: [] as { chat: string, disposedAtEnd: boolean }[] }))

// The persisted read takes longer than the send's wait, as it does on the phone; it imports one row.
vi.mock('../vectorPersist', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../vectorPersist')>()
    return {
        ...actual,
        loadVectors: async (source: LoadTarget) => {
            const entry = { chat: source.chat, disposedAtEnd: false }
            h.loads.push(entry)
            await new Promise<void>((r) => setTimeout(r, LOAD_MS))
            source.importLoaded({
                kind: 'loaded',
                modelKey: source.modelKey ?? '',
                head: { f: 'x', v: 1, g: 1, w: 'x', owner: source.owner, chat: source.chat, model: 'm', label: 'l', dim: 4, chunks: [1], at: 1 } as never,
                rows: [{ key: 'persisted-key', ordinal: 0, textHash: 'h', vec: new Float32Array(4), seq: 1 } as never],
                chunks: [1],
                dropped: 0,
                rowsRead: 1,
            })
            source.loaded = true
            entry.disposedAtEnd = source.disposed
        },
    }
})

const hybrid = ltmOf({ budgetTokens: 400, retrieval: 'hybrid' })
const lexical = ltmOf({ budgetTokens: 400 })
/** One embedder for the whole test, so its query count shows whether a send got as far as the vector step. */
let embedder = conceptEmbedder()
const embedderOf = (): (() => DenseEmbedderResult) => () => ({ embedder, reason: null })
const chat = paraphraseChat('My puppy chewed the sofa again yesterday.', 'Remind me about the dog', { targetAt: 5 })

/** Sends and returns how many query embeds the send made: one when the store held vectors in time, none when it fell back to keyword order. */
async function sendNow(chatId: string): Promise<number> {
    const before = embedder.queries.length
    const b = await buildSend({ ...chat, chatId })
    const run = runChroMemorySafely(b.args, deps({ embedder: embedderOf(), scheduleDense: () => {} }).d)
    await vi.advanceTimersByTimeAsync(DENSE_LOAD_WAIT_MS + 10)
    await run
    expect(getLastChroMemoryTrace()?.dense).toBeTruthy()
    return embedder.queries.length - before
}

beforeEach(() => {
    resetChroMemoryShadowForTests()
    h.loads.length = 0
    embedder = conceptEmbedder()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
})
afterEach(() => {
    resetChroMemoryShadowForTests()
    vi.useRealTimers()
})

describe('the vector load starts when the chat opens', () => {
    test('reproducer: a load that outlasts the send wait is ready for the first send when it started at chat open', async () => {
        prefetchChroMemoryVectors({ ownerId: 'owner', chatId: 'a', ltmSettings: hybrid, embedder: embedderOf() })
        await vi.advanceTimersByTimeAsync(LOAD_MS + 10)
        expect(await sendNow('a')).toBe(1)
        expect(h.loads).toHaveLength(1)
    })

    test('reproducer: without a prefetch the first send times out before the same load finishes and keeps the keyword order', async () => {
        expect(await sendNow('a')).toBe(0)
    })

    test('a send during the prefetch joins the one in-flight load instead of starting another', async () => {
        prefetchChroMemoryVectors({ ownerId: 'owner', chatId: 'a', ltmSettings: hybrid, embedder: embedderOf() })
        prefetchChroMemoryVectors({ ownerId: 'owner', chatId: 'a', ltmSettings: hybrid, embedder: embedderOf() })
        await vi.advanceTimersByTimeAsync(LOAD_MS - DENSE_LOAD_WAIT_MS)
        expect(await sendNow('a')).toBe(1)
        expect(h.loads).toHaveLength(1)
    })

    test('guard: hybrid off, no persist target or no embedder starts nothing', () => {
        prefetchChroMemoryVectors({ ownerId: 'owner', chatId: 'a', ltmSettings: lexical, embedder: embedderOf() })
        prefetchChroMemoryVectors({ ownerId: 'owner', chatId: undefined, ltmSettings: hybrid, embedder: embedderOf() })
        prefetchChroMemoryVectors({ ownerId: '', chatId: 'a', ltmSettings: hybrid, embedder: embedderOf() })
        prefetchChroMemoryVectors({ ownerId: 'owner', chatId: 'a', ltmSettings: hybrid, embedder: () => ({ embedder: null, reason: 'no-provider' }) })
        prefetchChroMemoryVectors({ ownerId: 'owner', chatId: 'a', ltmSettings: hybrid, embedder: () => { throw new Error('boom') } })
        expect(h.loads).toHaveLength(0)
    })

    test('guard: another chat never receives this chat\'s prefetched vectors', async () => {
        prefetchChroMemoryVectors({ ownerId: 'owner', chatId: 'a', ltmSettings: hybrid, embedder: embedderOf() })
        await vi.advanceTimersByTimeAsync(LOAD_MS + 10)
        expect(await sendNow('b')).toBe(0)
        expect(h.loads.map((l) => l.chat)).toEqual(['a', 'b'])
    })

    test('a prefetch no send used is released with its chat, and a late read does not import into it', async () => {
        prefetchChroMemoryVectors({ ownerId: 'owner', chatId: 'a', ltmSettings: hybrid, embedder: embedderOf() })
        releaseChroMemoryPrefetch('owner', 'a')
        await vi.advanceTimersByTimeAsync(LOAD_MS + 10)
        expect(h.loads[0].disposedAtEnd).toBe(true)
        // The chat reopened: a fresh load starts, since the released store is gone.
        prefetchChroMemoryVectors({ ownerId: 'owner', chatId: 'a', ltmSettings: hybrid, embedder: embedderOf() })
        expect(h.loads).toHaveLength(2)
    })

    test('guard: a prefetch a send already used survives the chat\'s release', async () => {
        prefetchChroMemoryVectors({ ownerId: 'owner', chatId: 'a', ltmSettings: hybrid, embedder: embedderOf() })
        await vi.advanceTimersByTimeAsync(LOAD_MS + 10)
        expect(await sendNow('a')).toBe(1)
        // The chat's effect re-runs after the send (a settings edit): the used store must not turn back into a prefetch.
        prefetchChroMemoryVectors({ ownerId: 'owner', chatId: 'a', ltmSettings: hybrid, embedder: embedderOf() })
        releaseChroMemoryPrefetch('owner', 'a')
        expect(await sendNow('a')).toBe(1)
        expect(h.loads).toHaveLength(1)
    })
})
