// @vitest-environment happy-dom

/**
 * Large-entry streams of a restore that overlap (`maxStreams` above 1), with the
 * chunked writers and the batch calls replaced by fakes the test holds and
 * releases by hand. The fake store folds case, as a case-insensitive file
 * system does, so a write that lands in the wrong order leaves the wrong bytes
 * and not only a different event order.
 *
 * Classes: the tests of overlap, of the stop rule and of the knob parser fail on
 * a pipeline that has no `maxStreams`; the key-fold tests (T3) and the
 * `maxStreams` 1 pin (T1) also pass on the serial pipeline and are guards that
 * the new rules keep the order the serial pipeline had.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AssetPutResult } from 'src/ts/storage/tauriAssetBatch'
import type { ChunkedWriter } from 'src/ts/storage/tauriByteTransport'
import {
    ASSET_MAX_STREAMS,
    RestoreAssetPipeline,
    foldAssetKey,
    parseCopyMeasureKnob,
    type AssetBatchLimits,
    type RestoreAssetDeps,
    type RestoreAssetEntry,
    type StreamedAssetEntry,
} from '../assetBatchPipeline'

vi.mock('src/ts/platform', () => ({ isTauri: true }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'linux' }))

/** A batch holds 10 bytes; a stream reads 4-byte slices, so a 20-byte entry is five chunks. */
const STREAM_LIMITS: Partial<AssetBatchLimits> = {
    batchBytes: 10,
    budgetBytes: 40,
    maxEntries: 100,
    maxFlights: 4,
    maxStreams: 3,
    streamSliceBytes: 4,
}
const LARGE = 20
const OK: AssetPutResult = { k: 'ok' }

interface Gate {
    promise: Promise<void>
    release(): void
}

function gate(): Gate {
    let release: () => void = () => { }
    const promise = new Promise<void>((resolve) => { release = resolve })
    return { promise, release }
}

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

function sourceBytes(size: number, seed: number): Uint8Array {
    return Uint8Array.from({ length: size }, (_, i) => (seed + i) % 251)
}

function same(actual: Uint8Array | undefined, expected: Uint8Array): boolean {
    return actual !== undefined && Buffer.compare(Buffer.from(actual), Buffer.from(expected)) === 0
}

let nextIndex = 0

/** A large entry whose body is `sourceBytes(size, seed)`, read in slices; `failAtRead` makes that read (0-based) reject. */
function streamed(name: string, size: number, seed: number, options: { failAtRead?: number } = {}) {
    nextIndex += 1
    const reads: [number, number][] = []
    const body = sourceBytes(size, seed)
    const item: StreamedAssetEntry = {
        key: `assets/${name}`,
        name,
        index: nextIndex,
        size,
        readSlice: async (start, end) => {
            const position = reads.length
            reads.push([start, end])
            if (position === options.failAtRead) {
                throw new Error('the file is gone')
            }
            return body.slice(start, end)
        },
    }
    return { item, reads, bytes: body }
}

function batched(name: string, size: number, seed: number): RestoreAssetEntry {
    nextIndex += 1
    return { key: `assets/${name}`, name, index: nextIndex, data: sourceBytes(size, seed) }
}

interface WriterRecord {
    key: string
    chunks: Uint8Array[]
    finished: boolean
    aborted: boolean
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
    let offset = 0
    for (const chunk of chunks) {
        out.set(chunk, offset)
        offset += chunk.length
    }
    return out
}

/** Chunked writers and batch calls over a store that folds case; the test holds, fails and counts them. */
function createWorld() {
    const files = new Map<string, Uint8Array>()
    const writers: WriterRecord[] = []
    const events: string[] = []
    const batchCalls: { keys: string[]; streamsActive: number }[] = []
    let active = 0
    const ctl = {
        maxActive: 0,
        /** Runs before a chunk write of `key` is taken, with the 0-based index of that chunk; may wait. */
        beforeWrite: null as ((key: string, index: number) => Promise<void> | undefined) | null,
        /** Whether the chunk write of `key` at that index rejects. */
        failWrite: null as ((key: string, index: number) => boolean) | null,
        /** Runs when a batch call starts; may wait, or throw to reject the call. */
        beforeBatch: null as ((index: number) => Promise<void> | undefined) | null,
    }
    const openStream = (key: string): ChunkedWriter => {
        const record: WriterRecord = { key, chunks: [], finished: false, aborted: false }
        writers.push(record)
        active += 1
        ctl.maxActive = Math.max(ctl.maxActive, active)
        events.push(`open ${key}`)
        let open = true
        const close = (): void => {
            if (open) {
                open = false
                active -= 1
            }
        }
        return {
            async write(data: Uint8Array): Promise<void> {
                const index = record.chunks.length
                await ctl.beforeWrite?.(key, index)
                if (ctl.failWrite?.(key, index)) {
                    throw new Error('disk full')
                }
                record.chunks.push(data.slice())
            },
            async finish(): Promise<void> {
                files.set(foldAssetKey(key), concatChunks(record.chunks))
                record.finished = true
                events.push(`finish ${key}`)
                close()
            },
            async abort(): Promise<void> {
                record.aborted = true
                events.push(`abort ${key}`)
                close()
            },
        }
    }
    const deps: RestoreAssetDeps = {
        async writeBatch(entries) {
            const index = batchCalls.length
            const keys = entries.map((entry) => entry.key)
            batchCalls.push({ keys, streamsActive: active })
            events.push(`batch ${keys.join()}`)
            await ctl.beforeBatch?.(index)
            for (const entry of entries) {
                files.set(foldAssetKey(entry.key), entry.data.slice())
            }
            events.push(`batch done ${keys.join()}`)
            return entries.map(() => OK)
        },
        writeEntry: async () => OK,
        openStream,
    }
    return { files, writers, events, batchCalls, ctl, deps, active: () => active }
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

describe('maxStreams 1', () => {
    // Guard: the explicit default is the serial pipeline, so this passes before and after.
    test('guard: a stream runs alone: no batch call is in flight while it runs, and it reads CHUNK_MAX slices whatever streamSliceBytes says', async () => {
        const world = createWorld()
        const pipeline = new RestoreAssetPipeline(world.deps, { ...STREAM_LIMITS, maxStreams: 1 })
        const hold = gate()
        world.ctl.beforeWrite = () => hold.promise
        const big = streamed('big', LARGE, 3)

        await pipeline.add(batched('before', 4, 1))
        const streaming = pipeline.addStreamed(big.item)
        await flushMicrotasks()

        // The assembled batch was sent and settled before the stream opened, and the stream is still running.
        expect(world.events).toEqual(['batch assets/before', 'batch done assets/before', 'open assets/big'])
        expect(await isPending(streaming)).toBe(true)
        hold.release()
        expect(await streaming).toBe(false)
        await pipeline.add(batched('after', 10, 2))
        await pipeline.drain()

        expect(world.batchCalls.map((call) => call.streamsActive)).toEqual([0, 0])
        expect(big.reads).toEqual([[0, LARGE]])
        expect(same(world.files.get('assets/big'), big.bytes)).toBe(true)
        expect(pipeline.failure).toBeNull()
    })

    test('the default is one stream', () => {
        expect(ASSET_MAX_STREAMS).toBe(1)
    })
})

describe('overlapping streams', () => {
    test('three entries with distinct keys write at once, a fourth waits for a free slot, and batches go meanwhile', async () => {
        const world = createWorld()
        const pipeline = new RestoreAssetPipeline(world.deps, STREAM_LIMITS)
        const hold = gate()
        world.ctl.beforeWrite = () => hold.promise
        const larges = ['a', 'b', 'c', 'd'].map((name, n) => streamed(name, LARGE, n * 10))
        const driver = (async () => {
            await pipeline.addStreamed(larges[0].item)
            await pipeline.add(batched('s0', 10, 90))
            await pipeline.addStreamed(larges[1].item)
            await pipeline.add(batched('s1', 10, 91))
            await pipeline.addStreamed(larges[2].item)
            await pipeline.addStreamed(larges[3].item)
        })()
        await flushMicrotasks()

        // The maximum is reached, and the fourth entry has not opened a writer.
        expect(world.active()).toBe(3)
        expect(world.writers.map((writer) => writer.key)).toEqual(['assets/a', 'assets/b', 'assets/c'])
        expect(await isPending(driver)).toBe(true)
        // The batches went while the first and the second stream ran.
        expect(world.batchCalls.map((call) => call.streamsActive)).toEqual([1, 2])
        hold.release()
        await driver
        await pipeline.drain()

        // Never above the maximum, whatever the order the streams ended in.
        expect(world.ctl.maxActive).toBe(3)
        expect(world.writers).toHaveLength(4)
        for (const large of larges) {
            const writer = world.writers.find((candidate) => candidate.key === large.item.key)
            expect(writer?.chunks.map((chunk) => chunk.length)).toEqual([4, 4, 4, 4, 4])
            expect(same(world.files.get(large.item.key), large.bytes)).toBe(true)
        }
        expect(same(world.files.get('assets/s0'), sourceBytes(10, 90))).toBe(true)
        expect(same(world.files.get('assets/s1'), sourceBytes(10, 91))).toBe(true)
        expect(pipeline.failure).toBeNull()
        expect(unhandled).toEqual([])
    })

    test('drain waits for every stream to finish', async () => {
        const world = createWorld()
        const pipeline = new RestoreAssetPipeline(world.deps, STREAM_LIMITS)
        const hold = gate()
        world.ctl.beforeWrite = () => hold.promise
        const first = streamed('a', LARGE, 1)
        const second = streamed('b', LARGE, 2)
        let finishedAtDrain: boolean | null = null
        const driver = (async () => {
            await pipeline.addStreamed(first.item)
            await pipeline.addStreamed(second.item)
            await pipeline.drain()
            finishedAtDrain = world.writers.every((writer) => writer.finished)
        })()
        await flushMicrotasks()

        expect(world.active()).toBe(2)
        expect(await isPending(driver)).toBe(true)
        expect(world.files.size).toBe(0)
        hold.release()
        await driver

        expect(finishedAtDrain).toBe(true)
        expect(same(world.files.get('assets/a'), first.bytes)).toBe(true)
        expect(same(world.files.get('assets/b'), second.bytes)).toBe(true)
    })
})

describe('streams and the last entry of a key in file order', () => {
    // Guards on the serial pipeline; each is red against a pipeline that lets the key's earlier write finish last.
    test('two streams whose keys fold equal: the second waits for the first, and the later entry is what the store holds', async () => {
        const world = createWorld()
        const pipeline = new RestoreAssetPipeline(world.deps, STREAM_LIMITS)
        const hold = gate()
        world.ctl.beforeWrite = (key) => key === 'assets/Pic.png' ? hold.promise : undefined
        const first = streamed('Pic.png', LARGE, 1)
        const second = streamed('pic.png', LARGE, 2)
        const driver = (async () => {
            await pipeline.addStreamed(first.item)
            await pipeline.addStreamed(second.item)
        })()
        await flushMicrotasks()

        expect(world.writers.map((writer) => writer.key)).toEqual(['assets/Pic.png'])
        expect(await isPending(driver)).toBe(true)
        hold.release()
        await driver
        await pipeline.drain()

        expect(world.writers.map((writer) => writer.key)).toEqual(['assets/Pic.png', 'assets/pic.png'])
        expect(same(world.files.get(foldAssetKey('assets/pic.png')), second.bytes)).toBe(true)
    })

    test('a stream, then a batched entry whose key folds equal: the batch is not sent until the stream settled, and the batched entry is what the store holds', async () => {
        const world = createWorld()
        const pipeline = new RestoreAssetPipeline(world.deps, STREAM_LIMITS)
        const hold = gate()
        world.ctl.beforeWrite = () => hold.promise
        const first = streamed('Pic.PNG', LARGE, 1)
        const later = batched('pic.png', 10, 2)
        const driver = (async () => {
            await pipeline.addStreamed(first.item)
            await pipeline.add(later)
        })()
        await flushMicrotasks()

        expect(world.writers).toHaveLength(1)
        expect(world.batchCalls).toEqual([])
        expect(await isPending(driver)).toBe(true)
        hold.release()
        await driver
        await pipeline.drain()

        expect(world.events.indexOf('finish assets/Pic.PNG')).toBeLessThan(world.events.indexOf('batch assets/pic.png'))
        expect(same(world.files.get(foldAssetKey('assets/pic.png')), later.data)).toBe(true)
    })

    test('a batch in flight, then a stream whose key folds equal: the stream does not open until the batch settled, and the stream is what the store holds', async () => {
        const world = createWorld()
        const pipeline = new RestoreAssetPipeline(world.deps, STREAM_LIMITS)
        const batchHold = gate()
        world.ctl.beforeBatch = () => batchHold.promise
        const later = streamed('PIC.png', LARGE, 2)

        await pipeline.add(batched('pic.png', 10, 1))
        const streaming = pipeline.addStreamed(later.item)
        await flushMicrotasks()

        expect(world.batchCalls).toHaveLength(1)
        expect(world.writers).toEqual([])
        expect(await isPending(streaming)).toBe(true)
        batchHold.release()
        await streaming
        await pipeline.drain()

        expect(world.events.indexOf('batch done assets/pic.png')).toBeLessThan(world.events.indexOf('open assets/PIC.png'))
        expect(same(world.files.get(foldAssetKey('assets/pic.png')), later.bytes)).toBe(true)
    })

    test('a batch still being assembled, then a stream whose key folds equal: the batch is sent first, and the stream is what the store holds', async () => {
        const world = createWorld()
        const pipeline = new RestoreAssetPipeline(world.deps, STREAM_LIMITS)
        const later = streamed('PIC.png', LARGE, 2)

        await pipeline.add(batched('pic.png', 4, 1))
        expect(world.batchCalls).toEqual([])
        expect(await pipeline.addStreamed(later.item)).toBe(false)
        await pipeline.drain()

        expect(world.events.indexOf('batch done assets/pic.png')).toBeLessThan(world.events.indexOf('open assets/PIC.png'))
        expect(same(world.files.get(foldAssetKey('assets/pic.png')), later.bytes)).toBe(true)
    })
})

describe('stopping streams at the next chunk', () => {
    /** Streams a, b and c of five chunks each; a and c wait at their second chunk write for `release`. */
    function threeHeldStreams(world: ReturnType<typeof createWorld>, release: Gate, options: { failB?: 'sink' | 'source' } = {}) {
        world.ctl.beforeWrite = (key, index) => index === 1 && key !== 'assets/b' ? release.promise : undefined
        if (options.failB === 'sink') {
            world.ctl.failWrite = (key, index) => key === 'assets/b' && index === 1
        }
        return [
            streamed('a', LARGE, 1),
            streamed('b', LARGE, 2, options.failB === 'source' ? { failAtRead: 1 } : {}),
            streamed('c', LARGE, 3),
        ]
    }

    test('a sink failure in one stream stops the others before their next slice, in slices of the writer chunk size, and they abort without finishing', async () => {
        const world = createWorld()
        const pipeline = new RestoreAssetPipeline(world.deps, STREAM_LIMITS)
        const release = gate()
        const [a, b, c] = threeHeldStreams(world, release, { failB: 'sink' })
        const driver = (async () => {
            for (const large of [a, b, c]) {
                await pipeline.addStreamed(large.item)
            }
        })()
        await flushMicrotasks()

        expect((pipeline.failure?.error as Error | undefined)?.message).toBe('disk full')
        // The others have read the slice they hold and no more.
        expect(a.reads).toEqual([[0, 4], [4, 8]])
        expect(c.reads).toEqual([[0, 4], [4, 8]])
        release.release()
        await driver
        await pipeline.drain()

        expect(a.reads).toHaveLength(2)
        expect(c.reads).toHaveLength(2)
        expect(world.writers).toHaveLength(3)
        expect(world.writers.every((writer) => writer.aborted && !writer.finished)).toBe(true)
        expect(world.files.size).toBe(0)
        expect(unhandled).toEqual([])
    })

    test('a failed batch call stops the streams the same way', async () => {
        const world = createWorld()
        const pipeline = new RestoreAssetPipeline(world.deps, STREAM_LIMITS)
        const release = gate()
        const [a, , c] = threeHeldStreams(world, release)
        world.ctl.beforeBatch = () => Promise.reject(new Error('the batch call failed'))
        const driver = (async () => {
            await pipeline.addStreamed(a.item)
            await pipeline.addStreamed(c.item)
            await pipeline.add(batched('s', 10, 9))
        })()
        await flushMicrotasks()

        expect((pipeline.failure?.error as Error | undefined)?.message).toBe('the batch call failed')
        expect(a.reads).toEqual([[0, 4], [4, 8]])
        release.release()
        await driver
        await pipeline.drain()

        expect(a.reads).toHaveLength(2)
        expect(c.reads).toHaveLength(2)
        expect(world.writers.every((writer) => writer.aborted && !writer.finished)).toBe(true)
        expect(unhandled).toEqual([])
    })

    test('a source failure in one stream stops the others, is not a failure of the pipeline, and addStreamed then resolves true without opening anything', async () => {
        const world = createWorld()
        const pipeline = new RestoreAssetPipeline(world.deps, STREAM_LIMITS)
        const release = gate()
        const [a, b, c] = threeHeldStreams(world, release, { failB: 'source' })
        const driver = (async () => {
            for (const large of [a, b, c]) {
                await pipeline.addStreamed(large.item)
            }
        })()
        await flushMicrotasks()

        expect(pipeline.sourceChanged).toBe(true)
        expect(pipeline.failure).toBeNull()
        const later = streamed('d', LARGE, 4)
        expect(await pipeline.addStreamed(later.item)).toBe(true)
        expect(later.reads).toEqual([])
        // Nothing more is sent once the source is known to have changed.
        await pipeline.add(batched('s', 10, 9))
        expect(world.batchCalls).toEqual([])
        release.release()
        await driver
        await pipeline.drain()

        expect(a.reads).toHaveLength(2)
        expect(c.reads).toHaveLength(2)
        expect(world.writers.map((writer) => writer.key)).toEqual(['assets/a', 'assets/b', 'assets/c'])
        expect(world.writers.every((writer) => writer.aborted && !writer.finished)).toBe(true)
        expect(pipeline.invalidAssets()).toEqual([])
        expect(unhandled).toEqual([])
    })

    test('a waiter for a free slot returns false without opening a writer when a stream fails meanwhile', async () => {
        const world = createWorld()
        const pipeline = new RestoreAssetPipeline(world.deps, STREAM_LIMITS)
        const release = gate()
        const [a, b, c] = threeHeldStreams(world, release, { failB: 'sink' })
        const fourth = streamed('d', LARGE, 4)
        const driver = (async () => {
            for (const large of [a, b, c]) {
                await pipeline.addStreamed(large.item)
            }
            return await pipeline.addStreamed(fourth.item)
        })()
        await flushMicrotasks()
        release.release()

        expect(await driver).toBe(false)
        await pipeline.drain()

        expect(world.writers.map((writer) => writer.key)).toEqual(['assets/a', 'assets/b', 'assets/c'])
        expect(fourth.reads).toEqual([])
    })

    test('stopStreams stops an active stream at its next check as a failure would, and changes nothing else', async () => {
        const world = createWorld()
        const pipeline = new RestoreAssetPipeline(world.deps, STREAM_LIMITS)
        const release = gate()
        const [a] = threeHeldStreams(world, release)

        await pipeline.addStreamed(a.item)
        await flushMicrotasks()
        pipeline.stopStreams()
        release.release()
        await pipeline.drain()

        expect(a.reads).toEqual([[0, 4], [4, 8]])
        expect(world.writers[0].aborted).toBe(true)
        expect(world.writers[0].finished).toBe(false)
        expect(pipeline.failure).toBeNull()
        expect(pipeline.sourceChanged).toBe(false)
        // An entry added after the stop is sent as usual.
        await pipeline.add(batched('s', 10, 9))
        await pipeline.drain()
        expect(world.batchCalls).toHaveLength(1)
    })

    // Guard: at maxStreams 1 no stream is ever active at the caller, so the stop has nothing to act on.
    test('guard: stopStreams has no effect at maxStreams 1', async () => {
        const world = createWorld()
        const pipeline = new RestoreAssetPipeline(world.deps, { ...STREAM_LIMITS, maxStreams: 1 })
        const hold = gate()
        world.ctl.beforeWrite = () => hold.promise
        const big = streamed('big', LARGE, 1)

        const streaming = pipeline.addStreamed(big.item)
        await flushMicrotasks()
        pipeline.stopStreams()
        hold.release()

        expect(await streaming).toBe(false)
        expect(world.writers[0].finished).toBe(true)
        expect(same(world.files.get('assets/big'), big.bytes)).toBe(true)
    })
})

describe('the measurement knob parser', () => {
    test('one number is the streams, two add the flights, three add the slice in KiB', () => {
        expect(parseCopyMeasureKnob(true, '3')).toEqual({ maxStreams: 3 })
        expect(parseCopyMeasureKnob(true, '3,2')).toEqual({ maxStreams: 3, maxFlights: 2 })
        expect(parseCopyMeasureKnob(true, ' 8 , 1 , 512 ')).toEqual({ maxStreams: 8, maxFlights: 1, streamSliceBytes: 512 * 1024 })
        expect(parseCopyMeasureKnob(true, '1,1,64')).toEqual({ maxStreams: 1, maxFlights: 1, streamSliceBytes: 64 * 1024 })
        expect(parseCopyMeasureKnob(true, '2,2,4096')).toEqual({ maxStreams: 2, maxFlights: 2, streamSliceBytes: 4096 * 1024 })
    })

    test.each(['', ' ', '0', '9', '3,', ',3', '3,x', '3.5', '-1', '1,2,3,4', '3,0', '3,9', '3,2,63', '3,2,4097', '3,2,', 'on', '1e1'])('ignores %j as a whole', (raw) => {
        expect(parseCopyMeasureKnob(true, raw)).toEqual({})
    })

    test('gives no override outside a measurement build or without a stored value', () => {
        expect(parseCopyMeasureKnob(false, '3,2')).toEqual({})
        expect(parseCopyMeasureKnob(true, null)).toEqual({})
        expect(parseCopyMeasureKnob(false, null)).toEqual({})
    })
})
