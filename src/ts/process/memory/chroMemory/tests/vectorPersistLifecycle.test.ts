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
import type { ByteStore } from 'src/ts/storage/store/contract'
import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { beginInFlight, resetInFlightForTest } from '../../../inFlightWork'
import { DENSE_IDLE_MS, DENSE_LOAD_WAIT_MS, DENSE_READY_WAIT_MS, type DenseEmbedder, type DenseJob } from '../dense'
import { scheduleDenseIndexing } from '../denseIndexer'
import { discardChroMemoryIndex, getLastChroMemoryTrace, resetChroMemoryShadowForTests, runChroMemorySafely, type ChroMemoryTrace } from '../shadow'
import { chatKeyOf, flushVectorPersist, headKey, parseHead, segOf, type VectorHead } from '../vectorPersist'
import { buildSend, conceptEmbedder, conceptVector, deps, paraphraseChat, type ConceptEmbedder } from './denseFixtures'

const OWNER = 'owner'
const CHAT = 'chat'
const chat = paraphraseChat('My puppy chewed the sofa again yesterday.', 'Remind me about the dog', { targetAt: 5 })
/** 30 dropped records: two batches of 16 and 14 units. */
const UNITS = 30

let mem: MemoryByteStore
let lastJob: DenseJob | null = null

beforeEach(() => {
    mem = createMemoryByteStore()
    h.store = mem
    h.db = { ltmEngine: true, ltmSettings: { retrieval: 'hybrid' } }
    setPageStorageMode({ kind: 'store2' })
    resetInFlightForTest()
    resetChroMemoryShadowForTests()
    lastJob = null
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
    setVisibility('visible')
    resetChroMemoryShadowForTests()
    resetInFlightForTest()
    resetPageStorageModeForTests()
    h.store = null
    vi.useRealTimers()
    vi.restoreAllMocks()
})

function setVisibility(state: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
}

/** One send of the chat; the returned promise settles when the engine has published the trace. */
async function send(embedder: DenseEmbedder | null, opts: { raws?: string[], chatId?: string, texts?: string[] } = {}): Promise<ChroMemoryTrace> {
    const b = await buildSend({ texts: opts.texts ?? chat.texts, d0: chat.d0, ownerId: OWNER, chatId: opts.chatId ?? CHAT, raws: opts.raws })
    const hand = (job: DenseJob): void => {
        lastJob = job
        scheduleDenseIndexing(job)
    }
    await runChroMemorySafely(b.args, deps({ embedder: () => ({ embedder, reason: embedder ? null : 'no-provider' }), scheduleDense: hand }).d)
    return getLastChroMemoryTrace() as ChroMemoryTrace
}

/** A send whose dense step may wait on a gated load: the timers run while the send is pending. */
async function sendWaiting(embedder: DenseEmbedder, ms = DENSE_LOAD_WAIT_MS + 1): Promise<ChroMemoryTrace> {
    const pending = send(embedder)
    await vi.advanceTimersByTimeAsync(ms)
    return await pending
}

async function idle(ms = DENSE_IDLE_MS + 2000): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms)
    await flushVectorPersist()
}

const docCount = (e: ConceptEmbedder): number => e.documents.reduce((n, d) => n + d.length, 0)

function readHead(): VectorHead | null {
    return parseHead(mem.files.get(headKey(segOf(chatKeyOf(OWNER, CHAT)))) ?? null)
}

/** A store whose reads wait for `open()`; the memory store behind it records what was written. */
function gatedStore(): { store: ByteStore, open(): void } {
    let open!: () => void
    const gate = new Promise<void>((resolve) => {
        open = resolve
    })
    const store: ByteStore = {
        capabilities: mem.capabilities,
        read: async (key) => {
            await gate
            return mem.read(key)
        },
        write: (key, bytes, cond) => mem.write(key, bytes, cond),
        delete: (key, cond) => mem.delete(key, cond),
        deleteMany: (entries) => mem.deleteMany(entries),
        list: (prefix) => mem.list(prefix),
        has: (key) => mem.has(key),
    }
    return { store, open }
}

async function firstSession(): Promise<ConceptEmbedder> {
    const e = conceptEmbedder()
    await send(e)
    await idle()
    expect(docCount(e)).toBe(UNITS)
    expect(readHead()?.g).toBe(1)
    return e
}

describe('R1 the vectors survive a reload', () => {
    test('guard (new API; the reviewer ran a base-API variant red on 43e665869 with expected 0, received 30): the second session after a reload embeds nothing; an edited unit embeds once and a third session embeds none', async () => {
        await firstSession()
        resetChroMemoryShadowForTests()
        const second = conceptEmbedder()
        const trace = await send(second)
        await idle()
        expect(docCount(second)).toBe(0)
        expect(second.queries).toHaveLength(1)
        expect(trace.dense?.state).toBe('ready')
        expect(trace.dense?.vectors).toBe(UNITS)

        // The same records with one unit's text edited: only that unit embeds, and the next session needs none.
        resetChroMemoryShadowForTests()
        const texts = chat.texts.slice()
        texts[7] = `${texts[7]} (edited)`
        const edited = conceptEmbedder()
        await send(edited, { texts, raws: chat.texts })
        await idle()
        expect(docCount(edited)).toBe(1)
        resetChroMemoryShadowForTests()
        const third = conceptEmbedder()
        await send(third, { texts, raws: chat.texts })
        await idle()
        expect(docCount(third)).toBe(0)
    })

    test('guard: a different embedding model uses nothing and rewrites the head under the new model', async () => {
        await firstSession()
        const firstModel = readHead()!.model
        resetChroMemoryShadowForTests()
        const other = conceptEmbedder('concept-v2')
        await send(other)
        await idle()
        expect(docCount(other)).toBe(UNITS)
        expect(readHead()?.model).not.toBe(firstModel)
        resetChroMemoryShadowForTests()
        const again = conceptEmbedder('concept-v2')
        await send(again)
        await idle()
        expect(docCount(again)).toBe(0)
    })
})

describe('G18 and G19 a gated store', () => {
    test('guard: no document embeds while the read is gated, and none for the loaded units after it opens', async () => {
        await firstSession()
        resetChroMemoryShadowForTests()
        const gate = gatedStore()
        h.store = gate.store
        const second = conceptEmbedder()
        await sendWaiting(second)
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS + 1000)
        expect(docCount(second)).toBe(0)
        gate.open()
        await idle()
        expect(docCount(second)).toBe(0)
        expect(lastJob?.store.size).toBe(UNITS)
    })

    test('guard: a load that arrives in time serves the query; a late one leaves the send lexical and serves the next', async () => {
        await firstSession()
        resetChroMemoryShadowForTests()
        const gate = gatedStore()
        h.store = gate.store
        const inTime = conceptEmbedder()
        const pending = send(inTime)
        await vi.advanceTimersByTimeAsync(DENSE_LOAD_WAIT_MS / 2)
        gate.open()
        await vi.advanceTimersByTimeAsync(10)
        const trace = await pending
        expect(inTime.queries).toHaveLength(1)
        expect(trace.dense?.vectors).toBe(UNITS)

        resetChroMemoryShadowForTests()
        const late = gatedStore()
        h.store = late.store
        const lateEmbedder = conceptEmbedder()
        const lateTrace = await sendWaiting(lateEmbedder)
        expect(lateEmbedder.queries).toHaveLength(0)
        expect(lateTrace.dense?.state).toBe('building')
        late.open()
        await vi.advanceTimersByTimeAsync(10)
        const next = await send(lateEmbedder)
        expect(lateEmbedder.queries).toHaveLength(1)
        expect(next.dense?.vectors).toBe(UNITS)
    })

    test('guard: a chat discarded while the send waits is served nothing', async () => {
        await firstSession()
        resetChroMemoryShadowForTests()
        const gate = gatedStore()
        h.store = gate.store
        const e = conceptEmbedder()
        const pending = send(e)
        await vi.advanceTimersByTimeAsync(100)
        discardChroMemoryIndex(chatKeyOf(OWNER, CHAT))
        gate.open()
        await vi.advanceTimersByTimeAsync(DENSE_LOAD_WAIT_MS)
        const trace = await pending
        expect(e.queries).toHaveLength(0)
        expect(trace.dense?.state).toBe('building')
    })
})

describe('G24 the load binds to the model, owner and chat', () => {
    test('guard: a head of another owner or chat is not imported', async () => {
        await firstSession()
        const head = readHead()!
        mem.files.set(headKey(segOf(chatKeyOf(OWNER, CHAT))), new TextEncoder().encode(JSON.stringify({ ...head, owner: 'someone-else' })))
        resetChroMemoryShadowForTests()
        const e = conceptEmbedder()
        await send(e)
        expect(lastJob?.store.size).toBe(0)
        await idle()
        expect(docCount(e)).toBe(UNITS)
        expect(readHead()?.owner).toBe(OWNER)
    })

    test('guard: a read that never settles lets indexing start after the wait, writes no head, and on settling fills only absent keys then persists', async () => {
        await firstSession()
        resetChroMemoryShadowForTests()
        const gate = gatedStore()
        h.store = gate.store
        const writesBefore = mem.writes.length
        const e = conceptEmbedder()
        await sendWaiting(e)
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS + DENSE_READY_WAIT_MS + 1000)
        expect(docCount(e)).toBe(UNITS)
        await flushVectorPersist()
        expect(mem.writes.length).toBe(writesBefore)
        gate.open()
        await idle()
        const head = readHead()!
        expect(head.g).toBeGreaterThan(1)
        expect(lastJob?.store.size).toBe(UNITS)
        resetChroMemoryShadowForTests()
        h.store = mem
        const again = conceptEmbedder()
        await send(again)
        await idle()
        expect(docCount(again)).toBe(0)
    })

    test('guard: a chat discarded mid-batch writes nothing afterwards', async () => {
        const calls: { resolve(): void, texts: string[] }[] = []
        const e: DenseEmbedder = {
            modelKey: 'deferred-v1',
            embedQuery: async (t) => conceptVector(t),
            embedDocuments: (texts) => new Promise((resolve) => calls.push({ texts, resolve: () => resolve(texts.map(conceptVector)) })),
        }
        await send(e)
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS + 100)
        expect(calls).toHaveLength(1)
        discardChroMemoryIndex(chatKeyOf(OWNER, CHAT))
        calls[0].resolve()
        await vi.advanceTimersByTimeAsync(1000)
        await flushVectorPersist()
        expect(mem.writes).toEqual([])
        expect([...mem.files.keys()]).toEqual([])
    })
})

describe('the in-memory cap', () => {
    test('guard: a chat pushed out of the two held stores persists what it held before its store is disposed', async () => {
        const e = conceptEmbedder()
        await send(e, { chatId: 'a' })
        const stored = lastJob!
        stored.units().slice(0, 3).forEach((u) => stored.store.set(u, conceptVector(u.text)))
        await send(e, { chatId: 'b' })
        await send(e, { chatId: 'c' })
        expect(stored.store.disposed).toBe(true)
        await flushVectorPersist()
        const head = parseHead(mem.files.get(headKey(segOf(chatKeyOf(OWNER, 'a')))) ?? null)
        expect(head?.chat).toBe('a')
        expect(head?.chunks).toHaveLength(1)
    })
})

describe('G16 the indexer on a hidden page', () => {
    test('guard: nothing embeds or persists while hidden; on visible the run and the persist follow', async () => {
        const e = conceptEmbedder()
        setVisibility('hidden')
        await send(e)
        await vi.advanceTimersByTimeAsync(3 * DENSE_IDLE_MS)
        expect(docCount(e)).toBe(0)
        expect(mem.writes).toEqual([])
        setVisibility('visible')
        await idle()
        expect(docCount(e)).toBe(UNITS)
        expect(readHead()?.g).toBe(1)
    })

    test('guard: a run that ends while the page is hidden persists when it is visible again', async () => {
        const gates: (() => void)[] = []
        const e: DenseEmbedder = {
            modelKey: 'deferred-v1',
            embedQuery: async (t) => conceptVector(t),
            embedDocuments: (texts) => new Promise((resolve) => gates.push(() => resolve(texts.map(conceptVector)))),
        }
        await send(e)
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS + 100)
        setVisibility('hidden')
        while (gates.length) {
            gates.shift()!()
            await vi.advanceTimersByTimeAsync(10)
        }
        await flushVectorPersist()
        expect(mem.writes).toEqual([])
        setVisibility('visible')
        await vi.advanceTimersByTimeAsync(DENSE_IDLE_MS + 100)
        while (gates.length) {
            gates.shift()!()
            await vi.advanceTimersByTimeAsync(10)
        }
        await idle()
        expect(readHead()).not.toBeNull()
    })
})

describe('G15 and G7 the engine turned off', () => {
    test('guard: no vector is written while the engine is off or retrieval is lexical', async () => {
        h.db.ltmEngine = false
        await send(conceptEmbedder())
        await idle()
        expect(mem.writes).toEqual([])
        h.db.ltmEngine = true
        h.db.ltmSettings = { retrieval: 'lexical' }
        resetChroMemoryShadowForTests()
        await send(conceptEmbedder())
        await idle()
        expect(mem.writes).toEqual([])
    })

    test('guard: a discarded chat loses its folder and the next session embeds everything again', async () => {
        await firstSession()
        discardChroMemoryIndex(chatKeyOf(OWNER, CHAT))
        await flushVectorPersist()
        expect([...mem.files.keys()]).toEqual([])
        const e = conceptEmbedder()
        await send(e)
        await idle()
        expect(docCount(e)).toBe(UNITS)
    })

    test('guard: another chat of the same owner has its own folder', async () => {
        await firstSession()
        resetChroMemoryShadowForTests()
        const e = conceptEmbedder()
        await send(e, { chatId: 'chat-b' })
        await idle()
        expect(docCount(e)).toBe(UNITS)
        expect([...mem.files.keys()].filter((k) => k.endsWith('/head'))).toHaveLength(2)
    })
})

describe('a chat that is live holds the indexer', () => {
    test('guard: the persisted vectors need no embed token while the chat is live', async () => {
        await firstSession()
        resetChroMemoryShadowForTests()
        const end = beginInFlight('chat', { target: { chaId: OWNER, chatId: CHAT } })
        const e = conceptEmbedder()
        await send(e)
        await vi.advanceTimersByTimeAsync(5 * DENSE_IDLE_MS)
        expect(docCount(e)).toBe(0)
        end()
    })
})
