// @vitest-environment happy-dom

/**
 * The batching of a restore's asset writes and of an export's asset reads,
 * with the transport replaced by calls the test settles by hand, so the order
 * in which calls start and settle is the test's to choose. The limits are
 * shrunk so a few bytes stand for megabytes.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AssetPutEntry, AssetPutResult, AssetReadResult } from 'src/ts/storage/tauriAssetBatch'
import { StoreInvalidKeyError } from 'src/ts/storage/store/errors'
import { CHUNK_MAX, type ChunkedWriter } from 'src/ts/storage/tauriByteTransport'
import {
    ExportAssetReader,
    RestoreAssetPipeline,
    foldAssetKey,
    streamAssetEntry,
    type RestoreAssetEntry,
    type StreamedAssetEntry,
} from '../assetBatchPipeline'

vi.mock('src/ts/platform', () => ({ isTauri: true }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'linux' }))

const LIMITS = { batchBytes: 10, budgetBytes: 40, maxEntries: 100, maxFlights: 4 }

interface PendingCall<T> {
    kind: 'batch' | 'entry' | 'read'
    keys: string[]
    settle(value: T): void
    fail(error: unknown): void
}

function bytesOf(size: number, fill = 1): Uint8Array {
    return new Uint8Array(size).fill(fill)
}

let nextIndex = 0
function entry(name: string, size = 4): RestoreAssetEntry {
    nextIndex += 1
    return { key: `assets/${name}`, name, index: nextIndex, data: bytesOf(size) }
}

const OK: AssetPutResult = { k: 'ok' }

function okFor(entries: readonly AssetPutEntry[]): AssetPutResult[] {
    return entries.map(() => OK)
}

interface StreamRecord {
    key: string
    chunks: number[]
    finished: boolean
    aborted: boolean
}

/** Chunked writers that record what they were given, with faults and a hold the test controls. */
function fakeStreams() {
    const ctl = {
        /** The chunk index whose write rejects; -1 for none. */
        failWriteAt: -1,
        failFinish: false,
        refuseOpen: false,
        /** Chunk 0 is refused with the store's key error, as a refused name on the first call would be. */
        refuseAtChunk0: false,
        /** Every write waits for this promise. */
        hold: null as Promise<void> | null,
        /** An abort takes until this promise settles. */
        abortDelay: null as Promise<void> | null,
    }
    const opened: StreamRecord[] = []
    const events: string[] = []
    const openStream = (key: string): ChunkedWriter => {
        if (ctl.refuseOpen) {
            throw new StoreInvalidKeyError(key, 'refused')
        }
        const record: StreamRecord = { key, chunks: [], finished: false, aborted: false }
        opened.push(record)
        events.push(`open ${key}`)
        return {
            async write(data: Uint8Array): Promise<void> {
                if (ctl.hold) {
                    await ctl.hold
                }
                if (ctl.refuseAtChunk0 && record.chunks.length === 0) {
                    throw new StoreInvalidKeyError(key, 'refused')
                }
                if (record.chunks.length === ctl.failWriteAt) {
                    throw new Error('disk full')
                }
                record.chunks.push(data.length)
            },
            async finish(): Promise<void> {
                if (ctl.failFinish) {
                    throw new Error('rename failed')
                }
                record.finished = true
                events.push(`finish ${key}`)
            },
            async abort(): Promise<void> {
                if (ctl.abortDelay) {
                    await ctl.abortDelay
                }
                record.aborted = true
                events.push(`abort ${key}`)
            },
        }
    }
    return { ctl, opened, events, openStream }
}

/** An entry whose body is read in slices; `failAtSlice` rejects that slice, `shortAtSlice` answers it one byte short. */
function streamedEntry(name: string, size: number, options: { failAtSlice?: number, shortAtSlice?: number } = {}) {
    nextIndex += 1
    const slices: [number, number][] = []
    const item: StreamedAssetEntry = {
        key: `assets/${name}`,
        name,
        index: nextIndex,
        size,
        readSlice: async (start, end) => {
            const position = slices.length
            slices.push([start, end])
            if (position === options.failAtSlice) {
                throw new Error('the file is gone')
            }
            return bytesOf(position === options.shortAtSlice ? end - start - 1 : end - start, 7)
        },
    }
    return { item, slices }
}

/** A restore transport whose calls wait until the test settles them. */
function manualWriter() {
    const calls: PendingCall<AssetPutResult[]>[] = []
    const written: string[] = []
    const streams = fakeStreams()
    const deps = {
        writeBatch: (entries: readonly AssetPutEntry[]) => new Promise<AssetPutResult[]>((resolve, reject) => {
            calls.push({
                kind: 'batch',
                keys: entries.map((e) => e.key),
                settle: (value) => { written.push(...entries.map((e) => e.key)); resolve(value) },
                fail: reject,
            })
        }),
        writeEntry: vi.fn(async (item: AssetPutEntry): Promise<AssetPutResult> => {
            written.push(item.key)
            return OK
        }),
        openStream: streams.openStream,
    }
    return { calls, written, deps, streams }
}

/** Lets every promise that can run, run. */
async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 20; i++) {
        await Promise.resolve()
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
}

function isPending(promise: Promise<unknown>): Promise<boolean> {
    let settled = false
    void promise.then(() => { settled = true }, () => { settled = true })
    return flushMicrotasks().then(() => !settled)
}

const unhandled: unknown[] = []
function recordUnhandled(reason: unknown): void {
    unhandled.push(reason)
}

beforeEach(() => {
    unhandled.length = 0
    process.on('unhandledRejection', recordUnhandled)
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    process.off('unhandledRejection', recordUnhandled)
    vi.restoreAllMocks()
})

describe('folding of asset keys', () => {
    test('treats case and Unicode composition as the same key', () => {
        expect(foldAssetKey('assets/A.PNG')).toBe(foldAssetKey('assets/a.png'))
        expect(foldAssetKey('assets/é.png')).toBe(foldAssetKey('assets/é.png'))
        expect(foldAssetKey('assets/a.png')).not.toBe(foldAssetKey('assets/b.png'))
    })

    test('treats long s, final sigma and micro sign as their plain counterparts', () => {
        expect(foldAssetKey('assets/ſ.png')).toBe(foldAssetKey('assets/s.png'))
        expect(foldAssetKey('assets/ς')).toBe(foldAssetKey('assets/σ'))
        expect(foldAssetKey('assets/µ')).toBe(foldAssetKey('assets/μ'))
    })
})

describe('restore pipeline: batching', () => {
    test('closes a batch when the next entry would pass the batch size and sends entries in file order', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)

        await pipeline.add(entry('a', 4))
        await pipeline.add(entry('b', 4))
        await pipeline.add(entry('c', 4))
        await flushMicrotasks()

        expect(writer.calls.map((call) => call.keys)).toEqual([['assets/a', 'assets/b']])

        writer.calls[0].settle([OK, OK])
        const drained = pipeline.drain()
        await flushMicrotasks()
        writer.calls[1].settle([OK])
        await drained

        expect(writer.calls.map((call) => call.keys)).toEqual([['assets/a', 'assets/b'], ['assets/c']])
        expect(pipeline.failure).toBeNull()
    })

    test('never has more calls in flight than the flight limit nor more entry bytes than the budget', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, { ...LIMITS, batchBytes: 10, budgetBytes: 20, maxFlights: 4 })

        const adding = (async () => {
            for (let i = 0; i < 6; i++) {
                await pipeline.add(entry(`f${i}`, 10))
            }
            await pipeline.drain()
        })()
        await flushMicrotasks()

        expect(writer.calls).toHaveLength(2)
        writer.calls[0].settle([OK])
        await flushMicrotasks()
        expect(writer.calls).toHaveLength(3)
        for (let i = 1; i < 6; i++) {
            writer.calls[i].settle([OK])
            await flushMicrotasks()
        }
        await adding

        expect(writer.calls.map((call) => call.keys.length)).toEqual([1, 1, 1, 1, 1, 1])
    })

    test('holds an entry back while the batches in flight plus the batch being assembled would pass the budget', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, { ...LIMITS, batchBytes: 10, budgetBytes: 20 })

        await pipeline.add(entry('f0', 10))
        await pipeline.add(entry('f1', 10))
        expect(writer.calls).toHaveLength(2)
        const small = pipeline.add(entry('small', 4))
        await flushMicrotasks()

        expect(await isPending(small)).toBe(true)
        writer.calls[0].settle([OK])
        await small
        const drained = pipeline.drain()
        await flushMicrotasks()
        writer.calls[1].settle([OK])
        writer.calls[2].settle([OK])
        await drained
    })

    test('caps the entries of one batch however small they are', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, { ...LIMITS, maxEntries: 2 })

        await pipeline.add(entry('a', 0))
        await pipeline.add(entry('b', 0))
        await pipeline.add(entry('c', 0))
        await flushMicrotasks()

        expect(writer.calls[0].keys).toEqual(['assets/a', 'assets/b'])
    })
})

describe('restore pipeline: the skip report', () => {
    test('is in file order when a later batch settles first', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)
        const first = [entry('one', 5), entry('two', 5)]
        const second = [entry('three', 5), entry('four', 5)]

        for (const item of [...first, ...second]) {
            await pipeline.add(item)
        }
        const drained = pipeline.drain()
        await flushMicrotasks()
        expect(writer.calls).toHaveLength(2)
        writer.calls[1].settle([{ k: 'invalid', reason: 'x' }, OK])
        await flushMicrotasks()
        writer.calls[0].settle([OK, { k: 'invalid', reason: 'y' }])
        await drained

        expect(pipeline.invalidAssets().map((item) => item.name)).toEqual(['two', 'three'])
        expect(pipeline.failure).toBeNull()
    })

    test('an invalid entry does not stop the entries around it', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)

        await pipeline.add(entry('ok1', 3))
        await pipeline.add(entry('.bad', 3))
        await pipeline.add(entry('ok2', 3))
        const drained = pipeline.drain()
        await flushMicrotasks()
        writer.calls[0].settle([OK, { k: 'invalid', reason: 'dot' }, OK])
        await drained

        expect(pipeline.failure).toBeNull()
        expect(pipeline.invalidAssets().map((item) => item.name)).toEqual(['.bad'])
    })
})

const MIB = 1024 * 1024

function gate() {
    let release: () => void = () => { }
    const promise = new Promise<void>((resolve) => { release = resolve })
    return { promise, release }
}

describe('restore pipeline: an entry too large for a batch', () => {
    test('add refuses an entry above the batch size and sends nothing', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)

        await expect(pipeline.add(entry('big', 11))).rejects.toBeInstanceOf(RangeError)

        expect(writer.calls).toHaveLength(0)
        expect(pipeline.failure).toBeNull()
    })

    test('an entry exactly the batch size is an ordinary batch of its own', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)

        await pipeline.add(entry('edge', 10))
        const drained = pipeline.drain()
        await flushMicrotasks()

        expect(writer.calls.map((call) => call.keys)).toEqual([['assets/edge']])
        writer.calls[0].settle([OK])
        await drained
    })

    test('a streamed entry waits for the batch being assembled and every call in flight, runs alone, and is written in slices of at most CHUNK_MAX', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)
        const big = streamedEntry('big', 9 * MIB)
        const hold = gate()
        writer.streams.ctl.hold = hold.promise

        await pipeline.add(entry('small', 4))
        const streaming = pipeline.addStreamed(big.item)
        await flushMicrotasks()
        // The assembled batch was sent; the stream has not opened while it is in flight.
        expect(writer.calls.map((call) => call.keys)).toEqual([['assets/small']])
        expect(writer.streams.opened).toHaveLength(0)

        writer.calls[0].settle([OK])
        await flushMicrotasks()
        expect(writer.streams.opened.map((record) => record.key)).toEqual(['assets/big'])
        expect(await isPending(streaming)).toBe(true)
        hold.release()
        expect(await streaming).toBe(false)
        await pipeline.add(entry('next', 4))
        const drained = pipeline.drain()
        await flushMicrotasks()
        expect(writer.calls.map((call) => call.keys)).toEqual([['assets/small'], ['assets/next']])
        writer.calls[1].settle([OK])
        await drained

        expect(big.slices).toEqual([[0, CHUNK_MAX], [CHUNK_MAX, 2 * CHUNK_MAX], [2 * CHUNK_MAX, 9 * MIB]])
        expect(writer.streams.opened[0].chunks).toEqual([CHUNK_MAX, CHUNK_MAX, MIB])
        expect(writer.streams.opened[0].finished).toBe(true)
        expect(pipeline.failure).toBeNull()
    })

    test('a streamed entry whose key folds to the key of a call in flight waits for that call', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)

        await pipeline.add(entry('Pic.PNG', 4))
        const streaming = pipeline.addStreamed(streamedEntry('pic.png', 5 * MIB).item)
        await flushMicrotasks()
        expect(await isPending(streaming)).toBe(true)
        expect(writer.streams.opened).toHaveLength(0)

        writer.calls[0].settle([OK])
        await streaming

        expect(writer.streams.opened).toHaveLength(1)
        expect(writer.written).toEqual(['assets/Pic.PNG'])
    })

    test('a name the store refuses, at open or on the first chunk, is skipped and reported in file order with the refusals of batches', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)

        await pipeline.add(entry('a', 4))
        writer.streams.ctl.refuseOpen = true
        const refusedAtOpen = pipeline.addStreamed(streamedEntry('bigOpen', 5 * MIB).item)
        await flushMicrotasks()
        writer.calls[0].settle([{ k: 'invalid', reason: 'x' }])
        expect(await refusedAtOpen).toBe(false)
        writer.streams.ctl.refuseOpen = false
        writer.streams.ctl.refuseAtChunk0 = true
        expect(await pipeline.addStreamed(streamedEntry('bigChunk', 5 * MIB).item)).toBe(false)
        await pipeline.add(entry('b', 4))
        const drained = pipeline.drain()
        await flushMicrotasks()
        writer.calls[1].settle([{ k: 'invalid', reason: 'y' }])
        await drained

        expect(pipeline.failure).toBeNull()
        expect(pipeline.invalidAssets().map((item) => item.name)).toEqual(['a', 'bigOpen', 'bigChunk', 'b'])
        expect(writer.streams.opened.every((record) => record.aborted && !record.finished)).toBe(true)
    })

    test('a write that fails at a chunk is the failure of the restore, and the write is aborted before addStreamed resolves', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)
        const big = streamedEntry('big', 9 * MIB)
        const abortGate = gate()
        writer.streams.ctl.failWriteAt = 1
        writer.streams.ctl.abortDelay = abortGate.promise

        const streaming = pipeline.addStreamed(big.item)
        await flushMicrotasks()
        expect(await isPending(streaming)).toBe(true)
        expect(writer.streams.opened[0].aborted).toBe(false)
        abortGate.release()
        expect(await streaming).toBe(false)

        expect(writer.streams.opened[0].aborted).toBe(true)
        expect((pipeline.failure?.error as Error).message).toBe('disk full')
        // The third slice is never read once the write has failed.
        expect(big.slices).toHaveLength(2)
    })

    test('a write that fails when it is finished is a failure and is aborted', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)
        writer.streams.ctl.failFinish = true

        await pipeline.addStreamed(streamedEntry('big', 5 * MIB).item)

        expect((pipeline.failure?.error as Error).message).toBe('rename failed')
        expect(writer.streams.opened[0].aborted).toBe(true)
    })

    test('after a failure nothing more is opened, read or sent', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)
        writer.streams.ctl.failWriteAt = 0
        await pipeline.addStreamed(streamedEntry('first', 5 * MIB).item)
        const later = streamedEntry('later', 5 * MIB)

        expect(await pipeline.addStreamed(later.item)).toBe(false)
        await pipeline.add(entry('small', 4))
        await pipeline.drain()

        expect(writer.streams.opened).toHaveLength(1)
        expect(later.slices).toEqual([])
        expect(writer.calls).toHaveLength(0)
    })

    test.each([
        ['cannot be read', { failAtSlice: 1 }],
        ['comes back short', { shortAtSlice: 1 }],
    ])('a slice that %s ends the write as a source failure: aborted before addStreamed resolves, not a failure of the pipeline', async (_title, options) => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)
        const abortGate = gate()
        writer.streams.ctl.abortDelay = abortGate.promise

        const streaming = pipeline.addStreamed(streamedEntry('big', 9 * MIB, options).item)
        await flushMicrotasks()
        expect(await isPending(streaming)).toBe(true)
        abortGate.release()

        expect(await streaming).toBe(true)
        expect(writer.streams.opened[0].aborted).toBe(true)
        expect(writer.streams.opened[0].finished).toBe(false)
        expect(pipeline.failure).toBeNull()
        expect(pipeline.invalidAssets()).toEqual([])
    })

    test('keeps streaming once a batch was refused for a body that is not raw', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)

        await pipeline.add(entry('a', 5))
        await pipeline.add(entry('b', 5))
        await flushMicrotasks()
        writer.calls[0].fail('not-raw: the body arrived as text')
        await flushMicrotasks()
        await pipeline.addStreamed(streamedEntry('big', 5 * MIB).item)
        await pipeline.add(entry('c', 5))
        await pipeline.drain()

        expect(pipeline.failure).toBeNull()
        expect(writer.streams.opened[0].finished).toBe(true)
        expect(writer.written).toEqual(['assets/a', 'assets/b', 'assets/c'])
        expect(writer.calls).toHaveLength(1)
    })
})

describe('streaming one entry', () => {
    test('reads and writes slices of at most the slice size, one after another, and finishes the write', async () => {
        const log: string[] = []
        const writer = {
            async write(data: Uint8Array) { log.push(`write ${data.length}`) },
            async finish() { log.push('finish') },
            async abort() { log.push('abort') },
        }
        const item: StreamedAssetEntry = {
            key: 'assets/x',
            name: 'x',
            index: 1,
            size: 10,
            readSlice: async (start, end) => { log.push(`read ${start}-${end}`); return bytesOf(end - start) },
        }

        const outcome = await streamAssetEntry(item, () => writer, 4)

        expect(outcome).toEqual({ k: 'ok' })
        expect(log).toEqual(['read 0-4', 'write 4', 'read 4-8', 'write 4', 'read 8-10', 'write 2', 'finish'])
    })

    test('a failing open that is not a refused name is a sink failure', async () => {
        const item = streamedEntry('x', 5).item

        const outcome = await streamAssetEntry(item, () => { throw new RangeError('no') })

        expect(outcome.k).toBe('sink')
    })
})

describe('restore pipeline: duplicate keys', () => {
    test('a key repeated right after itself is sent in a later batch than the first, which has settled by then', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)

        await pipeline.add(entry('dup', 2))
        const second = pipeline.add(entry('dup', 2))
        await flushMicrotasks()

        expect(writer.calls.map((call) => call.keys)).toEqual([['assets/dup']])
        expect(await isPending(second)).toBe(true)

        writer.calls[0].settle([OK])
        await second
        const drained = pipeline.drain()
        await flushMicrotasks()
        expect(writer.calls.map((call) => call.keys)).toEqual([['assets/dup'], ['assets/dup']])
        writer.calls[1].settle([OK])
        await drained

        expect(writer.written).toEqual(['assets/dup', 'assets/dup'])
    })

    test('a key repeated after other entries waits for the batch in flight that holds it, not for a batch not yet sent', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)

        await pipeline.add(entry('dup', 5))
        await pipeline.add(entry('other1', 5))
        // The first batch ([dup, other1]) is full and in flight; this one starts a second batch.
        await pipeline.add(entry('other2', 3))
        expect(writer.calls).toHaveLength(1)
        const repeated = pipeline.add(entry('dup', 3))
        await flushMicrotasks()

        expect(await isPending(repeated)).toBe(true)
        writer.calls[0].settle([OK, OK])
        await repeated
        const drained = pipeline.drain()
        await flushMicrotasks()
        writer.calls[1].settle([OK, OK])
        await drained

        expect(writer.written).toEqual(['assets/dup', 'assets/other1', 'assets/other2', 'assets/dup'])
        expect(writer.calls.map((call) => call.keys)).toEqual([['assets/dup', 'assets/other1'], ['assets/other2', 'assets/dup']])
    })

    test('a key that differs only in case or Unicode composition counts as a repeat', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)

        await pipeline.add(entry('Pic.PNG', 2))
        const lower = pipeline.add(entry('pic.png', 2))
        await flushMicrotasks()
        expect(writer.calls.map((call) => call.keys)).toEqual([['assets/Pic.PNG']])
        expect(await isPending(lower)).toBe(true)
        writer.calls[0].settle([OK])
        await lower

        await pipeline.add(entry('café.png', 2))
        const decomposed = pipeline.add(entry('café.png', 2))
        await flushMicrotasks()
        expect(writer.calls.map((call) => call.keys)).toEqual([['assets/Pic.PNG'], ['assets/pic.png', 'assets/café.png']])
        expect(await isPending(decomposed)).toBe(true)
        writer.calls[1].settle([OK, OK])
        await decomposed
        const drained = pipeline.drain()
        await flushMicrotasks()
        writer.calls[2].settle([OK])
        await drained

        expect(writer.calls[2].keys).toEqual(['assets/café.png'])
    })
})

describe('restore pipeline: after a failure', () => {
    test('an error result stops further sends: later entries are not sent and drain does not send the batch being assembled', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)

        await pipeline.add(entry('a', 5))
        await pipeline.add(entry('b', 5))
        await pipeline.add(entry('pending', 2))
        writer.calls[0].settle([{ k: 'error', message: 'disk full' }, OK])
        await flushMicrotasks()
        expect(pipeline.failure).not.toBeNull()

        await pipeline.add(entry('later', 5))
        await pipeline.drain()

        expect(writer.calls).toHaveLength(1)
        expect((pipeline.failure?.error as Error).message).toBe('disk full')
    })

    test('a rejected call is a failure and leaves no unhandled rejection', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)

        await pipeline.add(entry('a', 10))
        writer.calls[0].fail(new Error('transport went away'))
        await pipeline.drain()
        await flushMicrotasks()

        expect((pipeline.failure?.error as Error).message).toBe('transport went away')
        expect(unhandled).toEqual([])
    })

    test('a call that answers for the wrong number of entries is a failure', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)

        await pipeline.add(entry('a', 5))
        await pipeline.add(entry('b', 5))
        writer.calls[0].settle([OK])
        await pipeline.drain()

        expect(pipeline.failure).not.toBeNull()
    })

    test('an add that was waiting on a call returns once that call fails, without sending anything', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)

        await pipeline.add(entry('dup', 2))
        const waiting = pipeline.add(entry('dup', 2))
        await flushMicrotasks()
        writer.calls[0].settle([{ k: 'error', message: 'denied' }])
        await waiting
        await pipeline.drain()

        expect(writer.calls).toHaveLength(1)
        expect(pipeline.failure).not.toBeNull()
    })
})

describe('restore pipeline: drain', () => {
    test('sends the batch being assembled and resolves only when every call in flight has settled', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)

        await pipeline.add(entry('a', 5))
        await pipeline.add(entry('b', 5))
        await pipeline.add(entry('c', 2))
        const drained = pipeline.drain()
        await flushMicrotasks()

        expect(writer.calls.map((call) => call.keys)).toEqual([['assets/a', 'assets/b'], ['assets/c']])
        expect(await isPending(drained)).toBe(true)
        writer.calls[1].settle([OK])
        await flushMicrotasks()
        expect(await isPending(drained)).toBe(true)
        writer.calls[0].settle([OK, OK])
        await drained
    })

    test('resolves at once for a pipeline that was given nothing', async () => {
        const writer = manualWriter()

        await new RestoreAssetPipeline(writer.deps, LIMITS).drain()

        expect(writer.calls).toHaveLength(0)
    })
})

describe('restore pipeline: a command that refuses a body that is not raw', () => {
    test('is not a failure: its entries and every later one are written one at a time through the per-entry writer', async () => {
        const writer = manualWriter()
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)

        await pipeline.add(entry('a', 5))
        await pipeline.add(entry('b', 5))
        await flushMicrotasks()
        writer.calls[0].fail('not-raw: the body arrived as text')
        await flushMicrotasks()
        await pipeline.add(entry('c', 5))
        await pipeline.add(entry('d', 5))
        await pipeline.drain()

        expect(pipeline.failure).toBeNull()
        expect(writer.calls).toHaveLength(1)
        expect(writer.written).toEqual(['assets/a', 'assets/b', 'assets/c', 'assets/d'])
    })

    test('a name the per-entry writer refuses is still reported in the skip list', async () => {
        const writer = manualWriter()
        writer.deps.writeEntry.mockImplementation(async (item) => item.key === 'assets/.bad' ? { k: 'invalid', reason: 'dot' } : OK)
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)

        await pipeline.add(entry('a', 5))
        await pipeline.add(entry('.bad', 5))
        writer.calls[0].fail('not-raw: text')
        await pipeline.drain()

        expect(pipeline.invalidAssets().map((item) => item.name)).toEqual(['.bad'])
    })

    test('a failure of the per-entry writer is a failure of the restore', async () => {
        const writer = manualWriter()
        writer.deps.writeEntry.mockRejectedValue(new Error('disk full'))
        const pipeline = new RestoreAssetPipeline(writer.deps, LIMITS)

        await pipeline.add(entry('a', 10))
        writer.calls[0].fail('not-raw: text')
        await pipeline.drain()

        expect((pipeline.failure?.error as Error).message).toBe('disk full')
    })
})

/** A read transport whose calls wait until the test settles them. */
function manualReader() {
    const calls: PendingCall<AssetReadResult[]>[] = []
    const deps = {
        readBatch: (keys: readonly string[]) => new Promise<AssetReadResult[]>((resolve, reject) => {
            calls.push({ kind: 'read', keys: [...keys], settle: resolve, fail: reject })
        }),
    }
    return { calls, deps }
}

function found(...fills: number[]): AssetReadResult[] {
    return fills.map((fill) => ({ status: 'ok', bytes: bytesOf(2, fill) }))
}

function sized(...sizes: number[]): { key: string; size: number }[] {
    return sizes.map((size, index) => ({ key: `assets/k${index}`, size }))
}

describe('export reader', () => {
    test('hands entries out in listing order even when a later batch is read first', async () => {
        const reader = manualReader()
        const exporter = new ExportAssetReader(reader.deps, sized(6, 6, 6, 6), LIMITS)
        await flushMicrotasks()

        expect(reader.calls.map((call) => call.keys)).toEqual([['assets/k0'], ['assets/k1'], ['assets/k2'], ['assets/k3']])
        reader.calls[1].settle(found(2))
        reader.calls[0].settle(found(1))
        reader.calls[2].settle(found(3))
        reader.calls[3].settle(found(4))

        const taken = []
        for (let i = 0; i < 4; i++) {
            taken.push(await exporter.take(i))
        }
        await exporter.close()

        expect(taken.map((item) => item.kind === 'bytes' ? item.bytes[0] : item.kind)).toEqual([1, 2, 3, 4])
    })

    test('reports a key the batch could not find as missing and one it could not read as a fallback, and goes on', async () => {
        const reader = manualReader()
        const exporter = new ExportAssetReader(reader.deps, sized(3, 3, 3, 3), LIMITS)
        await flushMicrotasks()
        reader.calls[0].settle([
            { status: 'ok', bytes: bytesOf(2) },
            { status: 'missing' },
            { status: 'invalid', reason: 'refused' },
        ])
        reader.calls[1].settle([{ status: 'error', message: 'denied' }])

        const kinds = []
        for (let i = 0; i < 4; i++) {
            kinds.push((await exporter.take(i)).kind)
        }
        await exporter.close()

        expect(kinds).toEqual(['bytes', 'missing', 'fallback', 'fallback'])
    })

    test('a call that rejects, or answers for the wrong number of keys, makes every key of its batch a fallback and leaves no unhandled rejection', async () => {
        const reader = manualReader()
        const exporter = new ExportAssetReader(reader.deps, sized(4, 4, 8, 4), LIMITS)
        await flushMicrotasks()
        expect(reader.calls.map((call) => call.keys)).toEqual([['assets/k0', 'assets/k1'], ['assets/k2'], ['assets/k3']])
        reader.calls[0].fail(new Error('transport went away'))
        reader.calls[1].settle(found(1, 1))
        reader.calls[2].settle(found(5))

        const kinds = []
        for (let i = 0; i < 4; i++) {
            kinds.push((await exporter.take(i)).kind)
        }
        await exporter.close()
        await flushMicrotasks()

        expect(kinds).toEqual(['fallback', 'fallback', 'fallback', 'bytes'])
        expect(unhandled).toEqual([])
    })

    test('reads ahead only within the byte budget', async () => {
        const reader = manualReader()
        const exporter = new ExportAssetReader(reader.deps, sized(10, 10, 10, 10, 10, 2), { ...LIMITS, budgetBytes: 40 })
        await flushMicrotasks()

        // 40 bytes in flight; the fifth entry waits.
        expect(reader.calls.map((call) => call.keys)).toEqual([['assets/k0'], ['assets/k1'], ['assets/k2'], ['assets/k3']])
        for (const call of reader.calls) {
            call.settle(found(1))
        }
        // Nothing has been handed out, so every byte read is still held.
        await flushMicrotasks()
        expect(reader.calls).toHaveLength(4)

        await exporter.take(0)
        await flushMicrotasks()
        expect(reader.calls.map((call) => call.keys)).toEqual([['assets/k0'], ['assets/k1'], ['assets/k2'], ['assets/k3'], ['assets/k4']])

        reader.calls[4].settle(found(9))
        await exporter.take(1)
        await flushMicrotasks()
        expect(reader.calls).toHaveLength(6)
        reader.calls[5].settle(found(8))
        for (let i = 2; i < 6; i++) {
            await exporter.take(i)
        }
        await exporter.close()
    })

    test('a listed size above the batch size is never requested in a batch: the key comes out as a fallback with the keys around it still read', async () => {
        const reader = manualReader()
        const exporter = new ExportAssetReader(reader.deps, sized(2, 11, 2), LIMITS)
        await flushMicrotasks()

        expect(reader.calls.map((call) => call.keys)).toEqual([['assets/k0'], ['assets/k2']])
        reader.calls[0].settle(found(1))
        reader.calls[1].settle(found(3))
        const kinds = []
        for (let i = 0; i < 3; i++) {
            kinds.push((await exporter.take(i)).kind)
        }
        await exporter.close()

        expect(kinds).toEqual(['bytes', 'fallback', 'bytes'])
    })

    test('a key answered large comes out as a fallback', async () => {
        const reader = manualReader()
        const exporter = new ExportAssetReader(reader.deps, sized(3, 3), LIMITS)
        await flushMicrotasks()
        reader.calls[0].settle([{ status: 'ok', bytes: bytesOf(2) }, { status: 'large' }])

        const kinds = [(await exporter.take(0)).kind, (await exporter.take(1)).kind]
        await exporter.close()

        expect(kinds).toEqual(['bytes', 'fallback'])
    })

    test('keys answered deferred are asked for again in a later call, and every key comes out with its own bytes', async () => {
        const reader = manualReader()
        const exporter = new ExportAssetReader(reader.deps, sized(3, 3, 3), LIMITS)
        await flushMicrotasks()
        expect(reader.calls.map((call) => call.keys)).toEqual([['assets/k0', 'assets/k1', 'assets/k2']])
        reader.calls[0].settle([{ status: 'ok', bytes: bytesOf(2, 1) }, { status: 'deferred' }, { status: 'deferred' }])
        await flushMicrotasks()
        expect(reader.calls.map((call) => call.keys)).toEqual([['assets/k0', 'assets/k1', 'assets/k2'], ['assets/k1', 'assets/k2']])
        reader.calls[1].settle([{ status: 'ok', bytes: bytesOf(2, 2) }, { status: 'deferred' }])
        await flushMicrotasks()
        expect(reader.calls[2].keys).toEqual(['assets/k2'])
        reader.calls[2].settle([{ status: 'ok', bytes: bytesOf(2, 3) }])

        const taken = []
        for (let i = 0; i < 3; i++) {
            taken.push(await exporter.take(i))
        }
        await exporter.close()

        expect(taken.map((item) => item.kind === 'bytes' ? item.bytes[0] : item.kind)).toEqual([1, 2, 3])
    })

    test('a call that delivers nothing but deferred answers is not repeated: those keys come out as fallbacks', async () => {
        const reader = manualReader()
        const exporter = new ExportAssetReader(reader.deps, sized(3, 3, 3), LIMITS)
        await flushMicrotasks()
        reader.calls[0].settle([{ status: 'ok', bytes: bytesOf(2) }, { status: 'deferred' }, { status: 'deferred' }])
        await flushMicrotasks()
        reader.calls[1].settle([{ status: 'deferred' }, { status: 'deferred' }])

        const kinds = []
        for (let i = 0; i < 3; i++) {
            kinds.push((await exporter.take(i)).kind)
        }
        await exporter.close()

        expect(kinds).toEqual(['bytes', 'fallback', 'fallback'])
        expect(reader.calls).toHaveLength(2)
    })

    test('a repeated call that rejects keeps what the earlier call delivered and leaves the rest as fallbacks', async () => {
        const reader = manualReader()
        const exporter = new ExportAssetReader(reader.deps, sized(3, 3), LIMITS)
        await flushMicrotasks()
        reader.calls[0].settle([{ status: 'ok', bytes: bytesOf(2, 5) }, { status: 'deferred' }])
        await flushMicrotasks()
        reader.calls[1].fail(new Error('transport went away'))

        const taken = [await exporter.take(0), await exporter.take(1)]
        await exporter.close()
        await flushMicrotasks()

        expect(taken.map((item) => item.kind === 'bytes' ? item.bytes[0] : item.kind)).toEqual([5, 'fallback'])
        expect(unhandled).toEqual([])
    })

    test('close waits for a read still outstanding and starts no further read', async () => {
        const reader = manualReader()
        const exporter = new ExportAssetReader(reader.deps, sized(10, 10, 10, 10, 10, 10), { ...LIMITS, budgetBytes: 20 })
        await flushMicrotasks()
        expect(reader.calls).toHaveLength(2)

        const closing = exporter.close()
        await flushMicrotasks()
        expect(await isPending(closing)).toBe(true)
        reader.calls[0].settle(found(1))
        reader.calls[1].fail(new Error('late failure'))
        await closing
        await flushMicrotasks()

        expect(reader.calls).toHaveLength(2)
        expect(unhandled).toEqual([])
    })

    test('batches consecutive keys up to the batch size, and caps the keys of one call', async () => {
        const reader = manualReader()
        const exporter = new ExportAssetReader(reader.deps, sized(4, 4, 4, 0, 0, 0), { ...LIMITS, maxEntries: 2, budgetBytes: 100 })
        await flushMicrotasks()

        expect(reader.calls.map((call) => call.keys)).toEqual([
            ['assets/k0', 'assets/k1'],
            ['assets/k2', 'assets/k3'],
            ['assets/k4', 'assets/k5'],
        ])
        for (const call of reader.calls) {
            call.settle(found(1, 1))
        }
        await exporter.close()
    })
})
