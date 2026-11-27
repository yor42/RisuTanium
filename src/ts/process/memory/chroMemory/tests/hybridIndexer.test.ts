// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { KEEP_ALIVE_LINGER_MS } from '../../../../android/keepAliveService'
import { beginInFlight, inFlightKinds, resetInFlightForTest, subscribeInFlight, type InFlightKind } from '../../../inFlightWork'
import { DENSE_BATCH_TIMEOUT_MS, DENSE_IDLE_MS, PAUSE_AUTH_MS, PAUSE_ERROR_MS, type DenseEmbedder, type DenseJob } from '../dense'
import { scheduleDenseIndexing } from '../denseIndexer'
import { discardChroMemoryIndex, getLastChroMemoryTrace, resetChroMemoryShadowForTests, runChroMemorySafely, type ChroMemoryTrace } from '../shadow'
import { buildSend, conceptVector, deps, paraphraseChat } from './denseFixtures'

const unhandled = vi.fn()

beforeEach(() => {
    resetInFlightForTest()
    resetChroMemoryShadowForTests()
    unhandled.mockClear()
    process.on('unhandledRejection', unhandled)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
})
afterEach(() => {
    process.off('unhandledRejection', unhandled)
    setVisibility('visible')
    resetChroMemoryShadowForTests()
    resetInFlightForTest()
    vi.useRealTimers()
    vi.restoreAllMocks()
})

const chat = paraphraseChat('My puppy chewed the sofa again yesterday.', 'Remind me about the dog', { targetAt: 5 })
/** 30 dropped records: two batches of 16 and 14 units. */
const UNITS = 30

interface Call {
    texts: string[]
    resolve(): void
    reject(e: unknown): void
}

/** An embedder whose document calls stay open until the test settles them. */
function deferredEmbedder(modelKey = 'deferred-v1') {
    const calls: Call[] = []
    const queries: string[] = []
    const embedder: DenseEmbedder = {
        modelKey,
        embedQuery: async (t) => {
            queries.push(t)
            return conceptVector(t)
        },
        embedDocuments: (texts) =>
            new Promise((resolve, reject) => {
                calls.push({ texts, resolve: () => resolve(texts.map(conceptVector)), reject })
            }),
    }
    return { embedder, calls, queries }
}

function rejectingEmbedder(body: string) {
    const calls: string[][] = []
    const embedder: DenseEmbedder = {
        modelKey: 'reject-v1',
        embedQuery: async (t) => conceptVector(t),
        embedDocuments: async (texts) => {
            calls.push(texts)
            throw new Error(body)
        },
    }
    return { embedder, calls }
}

/** The store of the latest job the engine handed to the indexer. */
let lastJob: DenseJob | null = null

async function send(embedder: DenseEmbedder | null, chatId = 'chat'): Promise<ChroMemoryTrace> {
    const b = await buildSend({ texts: chat.texts, d0: chat.d0, chatId })
    const hand = (job: DenseJob): void => {
        lastJob = job
        scheduleDenseIndexing(job)
    }
    await runChroMemorySafely(b.args, deps({ embedder: () => ({ embedder, reason: embedder ? null : 'no-provider' }), scheduleDense: hand }).d)
    return getLastChroMemoryTrace() as ChroMemoryTrace
}

function setVisibility(state: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
}

test('G-const guard: the idle time outlasts the keep-alive linger, so a run never starts inside it', () => {
    expect(DENSE_IDLE_MS).toBeGreaterThan(KEEP_ALIVE_LINGER_MS)
})

const chatToken = () => beginInFlight('chat', { target: { chaId: 'owner', chatId: 'chat' } })

describe('G-idx-quiet the indexer waits for a quiet chat', () => {
    test('guard: held while a chat is live, a call exactly 12 s after the chat ends, and a save token does not delay it', async () => {
        const d = deferredEmbedder()
        const endChat = chatToken()
        await send(d.embedder)
        await vi.advanceTimersByTimeAsync(5000)
        endChat()
        for (let i = 0; i < 5; i++) {
            await vi.advanceTimersByTimeAsync(1000)
            beginInFlight('save')()
        }
        // Chat ended at 5 s; the save tokens at 6-10 s must not move the 17 s mark.
        await vi.advanceTimersByTimeAsync(16_999 - 10_000)
        expect(d.calls).toHaveLength(0)
        await vi.advanceTimersByTimeAsync(1)
        expect(d.calls).toHaveLength(1)
    })

    test('guard: no call at all while a chat stays live', async () => {
        const d = deferredEmbedder()
        chatToken()
        await send(d.embedder)
        await vi.advanceTimersByTimeAsync(5 * DENSE_IDLE_MS)
        expect(d.calls).toHaveLength(0)
    })

    test('guard: quiet counts from the chat end, not from the schedule', async () => {
        const d = deferredEmbedder()
        const endChat = chatToken()
        await send(d.embedder)
        await vi.advanceTimersByTimeAsync(30_000)
        endChat()
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS - 1)
        expect(d.calls).toHaveLength(0)
        await vi.advanceTimersByTimeAsync(1)
        expect(d.calls).toHaveLength(1)
    })
})

describe('G-idx-token one embed token spans the run', () => {
    test('guard: the registry is never empty between the batches of one run', async () => {
        const seen: InFlightKind[][] = []
        subscribeInFlight(() => seen.push(inFlightKinds()))
        const calls: string[][] = []
        const embedder: DenseEmbedder = {
            modelKey: 'plain-v1',
            embedQuery: async (t) => conceptVector(t),
            embedDocuments: async (texts) => {
                calls.push(texts)
                return texts.map(conceptVector)
            },
        }
        await send(embedder)
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS + 1000)
        expect(calls.map((c) => c.length)).toEqual([16, 14])
        const firstEmbed = seen.findIndex((k) => k.includes('embed'))
        expect(firstEmbed).toBeGreaterThanOrEqual(0)
        const empties = seen.slice(firstEmbed).filter((k) => k.length === 0)
        expect(empties).toHaveLength(1)
        expect(seen[seen.length - 1]).toEqual([])
    })

    test('guard: a reply in a fully indexed chat never begins an embed token and embeds nothing', async () => {
        const calls: string[][] = []
        const embedder: DenseEmbedder = {
            modelKey: 'plain-v1',
            embedQuery: async (t) => conceptVector(t),
            embedDocuments: async (texts) => {
                calls.push(texts)
                return texts.map(conceptVector)
            },
        }
        await send(embedder)
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS + 1000)
        expect(calls.map((c) => c.length)).toEqual([16, 14])
        const full = await send(embedder)
        expect(full.dense?.state).toBe('ready')
        const seen: InFlightKind[][] = []
        subscribeInFlight(() => seen.push(inFlightKinds()))
        await vi.advanceTimersByTimeAsync(60_000)
        expect(seen.some((k) => k.includes('embed'))).toBe(false)
        expect(calls).toHaveLength(2)
    })
})

describe('G-idx-prune a run drops the vectors of units no longer in the chat', () => {
    test('guard: after a message is deleted and the run goes on, the store holds only the remaining units', async () => {
        const embedder: DenseEmbedder = {
            modelKey: 'plain-v1',
            embedQuery: async (t) => conceptVector(t),
            embedDocuments: async (texts) => texts.map(conceptVector),
        }
        await send(embedder)
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS + 1000)
        const store = lastJob!.store
        expect(store.size).toBe(UNITS)
        const b = await buildSend({ texts: chat.texts.filter((_, i) => i !== 2), d0: chat.d0 - 1 })
        const hand = (job: DenseJob): void => {
            lastJob = job
            scheduleDenseIndexing(job)
        }
        await runChroMemorySafely(b.args, deps({ embedder: () => ({ embedder, reason: null }), scheduleDense: hand }).d)
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS + 1000)
        expect(lastJob!.store.size).toBe(lastJob!.units().length)
        expect(lastJob!.store.size).toBeLessThan(UNITS)
    })
})

describe('G-idx-stop and G-idx-live the loop re-checks between batches', () => {
    test('guard: a chat that begins during batch 1 holds batch 2 until it has ended and 12 s have passed', async () => {
        const d = deferredEmbedder()
        await send(d.embedder)
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS)
        expect(d.calls).toHaveLength(1)
        const endChat = chatToken()
        d.calls[0].resolve()
        await vi.advanceTimersByTimeAsync(60_000)
        expect(d.calls).toHaveLength(1)
        endChat()
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS - 1)
        expect(d.calls).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(d.calls).toHaveLength(2)
        expect(d.calls[1].texts).not.toEqual(d.calls[0].texts)
    })

    test('guard: a hidden page holds batch 2 and a visible one resumes it 12 s later', async () => {
        const d = deferredEmbedder()
        await send(d.embedder)
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS)
        setVisibility('hidden')
        d.calls[0].resolve()
        await vi.advanceTimersByTimeAsync(60_000)
        expect(d.calls).toHaveLength(1)
        expect(inFlightKinds()).not.toContain('embed')
        setVisibility('visible')
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS)
        expect(d.calls).toHaveLength(2)
    })

    test('guard: a send of another chat between batches stops chat A, and batch 1 is still written', async () => {
        const d = deferredEmbedder()
        await send(d.embedder)
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS)
        await send(null, 'other')
        d.calls[0].resolve()
        await vi.advanceTimersByTimeAsync(60_000)
        expect(d.calls).toHaveLength(1)
        expect(lastJob!.store.size).toBe(16)
        const back = await send(d.embedder)
        expect(back.dense?.vectors).toBe(16)
    })

    test('guard: a discard disposes the store, so batch 1 is not written, and the next send re-embeds', async () => {
        const d = deferredEmbedder()
        await send(d.embedder)
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS)
        const discarded = lastJob!.store
        discardChroMemoryIndex('owner:chat')
        d.calls[0].resolve()
        await vi.advanceTimersByTimeAsync(1000)
        expect(d.calls).toHaveLength(1)
        expect(discarded.disposed).toBe(true)
        expect(discarded.size).toBe(0)
        const next = await send(d.embedder)
        expect(next.dense?.vectors).toBe(0)
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS)
        expect(d.calls).toHaveLength(2)
        expect(d.calls[1].texts).toEqual(d.calls[0].texts)
    })
})

describe('G-idx-err provider errors pause the indexer', () => {
    test('guard: an auth body waits 600 s, a network body 60 s, and nothing is unhandled', async () => {
        const auth = rejectingEmbedder('{"error":{"code":"invalid_api_key"}}')
        await send(auth.embedder)
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS)
        expect(auth.calls).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(PAUSE_AUTH_MS - 1)
        expect(auth.calls).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(auth.calls).toHaveLength(2)

        resetChroMemoryShadowForTests()
        const net = rejectingEmbedder('socket hang up')
        await send(net.embedder)
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS)
        expect(net.calls).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(PAUSE_ERROR_MS - 1)
        expect(net.calls).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(net.calls).toHaveLength(2)
        expect(unhandled).not.toHaveBeenCalled()
    })
})

describe('G-idx-hang a hung batch is abandoned', () => {
    test('guard: at 30 s the run token is released, the next send shows the timeout pause and makes no query, and the retry waits 60 s', async () => {
        const d = deferredEmbedder()
        await send(d.embedder)
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS)
        expect(inFlightKinds()).toContain('embed')
        await vi.advanceTimersByTimeAsync(DENSE_BATCH_TIMEOUT_MS - 1)
        expect(inFlightKinds()).toContain('embed')
        await vi.advanceTimersByTimeAsync(1)
        expect(inFlightKinds()).not.toContain('embed')
        const next = await send(d.embedder)
        expect(next.dense).toMatchObject({ state: 'paused', reason: 'timeout' })
        expect(d.queries).toEqual([])
        await vi.advanceTimersByTimeAsync(PAUSE_ERROR_MS - 1)
        expect(d.calls).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(d.calls).toHaveLength(2)
    })

    test('guard: a batch that settles at 29.999 s sets no pause and the run goes on', async () => {
        const d = deferredEmbedder()
        await send(d.embedder)
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS)
        await vi.advanceTimersByTimeAsync(DENSE_BATCH_TIMEOUT_MS - 1)
        d.calls[0].resolve()
        await vi.advanceTimersByTimeAsync(1)
        expect(d.calls).toHaveLength(2)
        const next = await send(d.embedder)
        expect(next.dense?.state).not.toBe('paused')
        expect(next.dense?.vectors).toBe(16)
    })
})

describe('G-idx-late a result after the timeout is discarded', () => {
    test.each([['resolves', true], ['rejects', false]])('guard: the batch %s late, nothing is written or unhandled, and the same keys are requested again', async (_n, ok) => {
        const d = deferredEmbedder()
        await send(d.embedder)
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS + DENSE_BATCH_TIMEOUT_MS)
        if (ok) d.calls[0].resolve()
        else d.calls[0].reject(new Error('late socket error'))
        await vi.advanceTimersByTimeAsync(1000)
        const next = await send(d.embedder)
        expect(next.dense?.vectors).toBe(0)
        expect(next.dense).toMatchObject({ state: 'paused', reason: 'timeout' })
        await vi.advanceTimersByTimeAsync(PAUSE_ERROR_MS)
        expect(d.calls).toHaveLength(2)
        expect(d.calls[1].texts).toEqual(d.calls[0].texts)
        expect(unhandled).not.toHaveBeenCalled()
    })
})

describe('G-idx-cap at most two abandoned requests are outstanding', () => {
    test('guard: two hangs hold the indexer until one of them settles', async () => {
        const d = deferredEmbedder()
        await send(d.embedder)
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS + DENSE_BATCH_TIMEOUT_MS)
        await vi.advanceTimersByTimeAsync(PAUSE_ERROR_MS)
        expect(d.calls).toHaveLength(2)
        await vi.advanceTimersByTimeAsync(DENSE_BATCH_TIMEOUT_MS + PAUSE_ERROR_MS + 5000)
        expect(d.calls).toHaveLength(2)
        d.calls[0].resolve()
        await vi.advanceTimersByTimeAsync(1000)
        expect(d.calls).toHaveLength(3)
    })
})

describe('G-await the send never waits for the indexer', () => {
    test('guard: with embedDocuments never resolving, the send still resolves without a timer advance', async () => {
        const d = deferredEmbedder()
        const trace = await send(d.embedder)
        expect(trace.outcome).toBe('injected')
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS)
        const again = await send(d.embedder)
        expect(again.outcome).toBe('injected')
    }, 2000)
})
