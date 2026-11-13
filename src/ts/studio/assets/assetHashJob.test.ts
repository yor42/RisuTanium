/**
 * Check bytes: the hash job and its cache. Synthetic data; pieces and the worker are doubles at their seams, so
 * nothing here proves native behaviour or device frame budgets.
 */
import { createHash } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import type { ByteStore } from 'src/ts/storage/store/contract'

vi.mock('src/ts/globalApi.svelte', () => ({ pieceStoreOrNull: vi.fn(async () => null) }))
vi.mock('src/ts/storage/store/appStore', () => ({ getAppStoreKind: vi.fn(async () => 'tauri') }))
vi.mock('src/ts/storage/tauriByteTransport', () => ({
    isDesktopTransport: () => false,
    transportKind: () => 'web',
    readRangedPieces: vi.fn(),
    statStoredSize: vi.fn(),
}))

import type { ExportAssetSource } from 'src/ts/drive/assetPieces'
import type { ReadPiece } from 'src/ts/drive/inlayBackupExport'
import { createHashWorkerHandler, type HashWorkerReply, type HashWorkerRequest } from './assetHash.worker'
import {
    HASH_SLICE_BYTES,
    createCheckBytes,
    createHashCache,
    createHashWorkerPort,
    hashCacheKey,
    isImmutableAssetPath,
    progressFigures,
    runHashJob,
    sizeRecheckNeeded,
    type HashItem,
    type HashJobOptions,
    type HashProgress,
    type HashWorkerPort,
    type OpenedPieces,
} from './assetHashJob'
import { createAssetSizeJob } from './assetSizes'

const SOURCE: ExportAssetSource = { kind: 'node', pieces: { node: true, open: async function* () { } }, store: {} as ByteStore }
const MIB = 1024 * 1024

function sha256Of(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex')
}

function bytesOf(text: string): Uint8Array {
    return new TextEncoder().encode(text)
}

/** Pieces for `open`: the first piece and a generator of the rest. */
function piecesOf(chunks: Uint8Array[]): OpenedPieces {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const pieces: ReadPiece[] = chunks.map((bytes) => ({ bytes, total }))
    async function* rest(): AsyncGenerator<ReadPiece, void, undefined> {
        for (const piece of pieces.slice(1)) {
            yield piece
        }
    }
    return { first: pieces[0], rest: rest() }
}

function optionsOf(extra: Partial<HashJobOptions> & Pick<HashJobOptions, 'openPieces'>): HashJobOptions {
    return {
        source: SOURCE,
        signal: new AbortController().signal,
        cache: createHashCache(),
        createWorker: () => null,
        yieldToLoop: async () => { },
        ...extra,
    }
}

/** A worker double that runs the real handler on a structured clone, so a transfer really detaches the source buffer. */
function loopbackPort(): HashWorkerPort & { received: Uint8Array[] } {
    let onReply: (reply: HashWorkerReply) => void = () => { }
    const received: Uint8Array[] = []
    const handle = createHashWorkerHandler((reply) => queueMicrotask(() => onReply(reply)))
    return {
        received,
        post(message: HashWorkerRequest, transfer: Transferable[]) {
            const delivered = structuredClone(message, { transfer })
            if (delivered.t === 'piece') {
                received.push(new Uint8Array(delivered.buffer.slice(0)))
            }
            handle(delivered)
        },
        listen(reply) { onReply = reply },
        terminate() { },
    }
}

describe('hash job: slices', () => {
    test('a 2 GB virtual source never runs a slice over 16 ms of simulated compute and cancels within one slice', async () => {
        const clock = { t: 0 }
        const pieceBuffer = new Uint8Array(4 * MIB)
        const total = 2048 * MIB
        const pieceCount = total / pieceBuffer.length
        async function* rest(): AsyncGenerator<ReadPiece, void, undefined> {
            for (let index = 1; index < pieceCount; index++) {
                yield { bytes: pieceBuffer, total }
            }
        }
        const gaps: number[] = []
        let lastYield = 0
        const controller = new AbortController()
        let updates = 0
        let updatesAtAbort = -1
        const abortAt = 5000
        const result = await runHashJob(
            [{ path: 'assets/big.bin', size: total }],
            optionsOf({
                signal: controller.signal,
                openPieces: async () => ({ first: { bytes: pieceBuffer, total }, rest: rest() }),
                now: () => clock.t,
                yieldToLoop: async () => {
                    gaps.push(clock.t - lastYield)
                    lastYield = clock.t
                },
                createHasher: () => ({
                    update(bytes: Uint8Array) {
                        updates++
                        // 256 KiB costs 3 ms of simulated compute.
                        clock.t += (bytes.length / HASH_SLICE_BYTES) * 3
                        if (updates === abortAt) {
                            updatesAtAbort = updates
                            controller.abort()
                        }
                    },
                    digestHex: () => 'f'.repeat(64),
                }),
            }),
        )
        expect(result.status).toBe('aborted')
        expect(updatesAtAbort).toBe(abortAt)
        expect(updates).toBe(abortAt)
        expect(gaps.length).toBeGreaterThan(100)
        expect(Math.max(...gaps)).toBeLessThanOrEqual(16)
        expect(result.longestSliceMs).toBeLessThanOrEqual(16)
    })

    test('a 256 MiB virtual pass that nobody cancels finishes in short slices', async () => {
        const clock = { t: 0 }
        const pieceBuffer = new Uint8Array(4 * MIB)
        const total = 256 * MIB
        const pieceCount = total / pieceBuffer.length
        async function* rest(): AsyncGenerator<ReadPiece, void, undefined> {
            for (let index = 1; index < pieceCount; index++) {
                yield { bytes: pieceBuffer, total }
            }
        }
        let longest = 0
        let lastYield = 0
        const result = await runHashJob(
            [{ path: 'assets/big.bin', size: total }],
            optionsOf({
                openPieces: async () => ({ first: { bytes: pieceBuffer, total }, rest: rest() }),
                now: () => clock.t,
                yieldToLoop: async () => {
                    longest = Math.max(longest, clock.t - lastYield)
                    lastYield = clock.t
                },
                createHasher: () => ({
                    update(bytes: Uint8Array) { clock.t += (bytes.length / HASH_SLICE_BYTES) * 3 },
                    digestHex: () => 'a'.repeat(64),
                }),
            }),
        )
        expect(result.status).toBe('done')
        expect(longest).toBeLessThanOrEqual(16)
        expect(clock.t).toBe((total / HASH_SLICE_BYTES) * 3)
    })

    test('the inline hasher gives the SHA-256 of the bytes', async () => {
        const data = new Uint8Array(3 * HASH_SLICE_BYTES + 17).map((_, i) => i % 251)
        const result = await runHashJob(
            [{ path: 'assets/a.bin', size: data.length }],
            optionsOf({ openPieces: async () => piecesOf([data.subarray(0, 100000), data.subarray(100000)]) }),
        )
        expect(result.hashes.get('assets/a.bin')).toBe(sha256Of(data))
    })
})

describe('hash job: worker transfer', () => {
    test('a view at an offset is copied before it is posted: the source keeps its bytes and the worker gets exactly the piece', async () => {
        const backing = new Uint8Array(64).map((_, i) => i)
        const view = new Uint8Array(backing.buffer, 16, 32)
        const expectedPiece = new Uint8Array(view)
        const port = loopbackPort()
        const result = await runHashJob(
            [{ path: 'assets/view.bin', size: 32 }],
            optionsOf({ createWorker: () => port, openPieces: async () => piecesOf([view]) }),
        )
        expect(backing.buffer.byteLength).toBe(64)
        expect(view.byteLength).toBe(32)
        expect(port.received).toEqual([expectedPiece])
        expect(result.hashes.get('assets/view.bin')).toBe(sha256Of(expectedPiece))
    })

    test('a piece that covers its buffer is transferred without a copy', async () => {
        const piece = bytesOf('whole buffer piece')
        const expected = sha256Of(new Uint8Array(piece))
        const port = loopbackPort()
        const result = await runHashJob(
            [{ path: 'assets/whole.bin', size: piece.length }],
            optionsOf({ createWorker: () => port, openPieces: async () => piecesOf([piece]) }),
        )
        expect(piece.buffer.byteLength).toBe(0)
        expect(result.hashes.get('assets/whole.bin')).toBe(expected)
    })

    test('several pieces of one asset hash like the whole, one piece in flight', async () => {
        const data = new Uint8Array(10000).map((_, i) => (i * 7) % 256)
        let inFlight = 0
        let maxInFlight = 0
        const inner = loopbackPort()
        const port: HashWorkerPort = {
            post(message, transfer) {
                if (message.t === 'piece') {
                    inFlight++
                    maxInFlight = Math.max(maxInFlight, inFlight)
                }
                inner.post(message, transfer)
            },
            listen(onReply, onFailure) {
                inner.listen((reply) => {
                    if (reply.t === 'piece') {
                        inFlight--
                    }
                    onReply(reply)
                }, onFailure)
            },
            terminate() { },
        }
        const result = await runHashJob(
            [{ path: 'assets/p.bin', size: data.length }],
            optionsOf({
                createWorker: () => port,
                openPieces: async () => piecesOf([data.slice(0, 3000), data.slice(3000, 7000), data.slice(7000)]),
            }),
        )
        expect(result.hashes.get('assets/p.bin')).toBe(sha256Of(data))
        expect(maxInFlight).toBe(1)
    })

    test('a worker that fails hands the item and the rest to the inline hasher', async () => {
        const first = bytesOf('first file')
        const second = bytesOf('second file')
        const port: HashWorkerPort = {
            post() { },
            listen(_, onFailure) { queueMicrotask(onFailure) },
            terminate: vi.fn(),
        }
        const sources: Record<string, Uint8Array> = { 'assets/one.bin': first, 'assets/two.bin': second }
        const result = await runHashJob(
            [{ path: 'assets/one.bin', size: first.length }, { path: 'assets/two.bin', size: second.length }],
            optionsOf({ createWorker: () => port, openPieces: async (path) => piecesOf([new Uint8Array(sources[path])]) }),
        )
        expect(result.status).toBe('done')
        expect(result.unreadable).toEqual([])
        expect(result.hashes.get('assets/one.bin')).toBe(sha256Of(first))
        expect(result.hashes.get('assets/two.bin')).toBe(sha256Of(second))
        expect(port.terminate).toHaveBeenCalled()
    })

    test('without a Worker global no worker port is made', () => {
        const original = globalThis.Worker
        Object.defineProperty(globalThis, 'Worker', { value: undefined, configurable: true, writable: true })
        try {
            expect(createHashWorkerPort()).toBeNull()
        } finally {
            Object.defineProperty(globalThis, 'Worker', { value: original, configurable: true, writable: true })
        }
    })
})

describe('hash job: unreadable files', () => {
    test('a source that throws for two keys marks them, excludes them and finishes the pass', async () => {
        const data: Record<string, Uint8Array> = {}
        for (const name of ['k1', 'k3', 'k5']) {
            data[name] = bytesOf('bytes of ' + name)
        }
        const items: HashItem[] = ['k1', 'k2', 'k3', 'k4', 'k5'].map((name) => ({ path: 'assets/' + name, size: 9 }))
        const result = await runHashJob(
            items,
            optionsOf({
                openPieces: async (path) => {
                    const name = path.slice('assets/'.length)
                    if (name === 'k2') {
                        throw new Error('gone')
                    }
                    if (name === 'k4') {
                        // A source that fails after its first piece.
                        const opened = piecesOf([bytesOf('head'), bytesOf('tail')])
                        async function* failing(): AsyncGenerator<ReadPiece, void, undefined> {
                            throw new Error('broken mid-read')
                        }
                        return { first: opened.first, rest: failing() }
                    }
                    return piecesOf([data[name]])
                },
            }),
        )
        expect(result.status).toBe('done')
        expect(result.unreadable).toEqual(['assets/k2', 'assets/k4'])
        expect([...result.hashes.keys()]).toEqual(['assets/k1', 'assets/k3', 'assets/k5'])
        expect(result.hashes.get('assets/k3')).toBe(sha256Of(data.k3))
    })
})

describe('hash job: progress, cancel and the session cache', () => {
    test('progress reports megabytes done of megabytes total and a file count', async () => {
        const events: HashProgress[] = []
        const items: HashItem[] = [
            { path: 'assets/a', size: 2 * MIB },
            { path: 'assets/b', size: 1 * MIB },
        ]
        await runHashJob(
            items,
            optionsOf({
                onProgress: (progress) => events.push({ ...progress }),
                openPieces: async (path) => {
                    const size = path === 'assets/a' ? 2 * MIB : MIB
                    return piecesOf([new Uint8Array(size / 2), new Uint8Array(size / 2)])
                },
            }),
        )
        const last = events[events.length - 1]
        expect(last).toEqual({ doneBytes: 3 * MIB, totalBytes: 3 * MIB, doneFiles: 2, totalFiles: 2 })
        expect(events.some((event) => event.doneBytes === MIB && event.doneFiles === 0)).toBe(true)
        expect(progressFigures(3 * MIB, 12.5 * MIB)).toEqual({ x: '3.0', y: '12.5' })
    })

    test('a size-unknown file adds its length to the total when its first piece arrives', async () => {
        const events: HashProgress[] = []
        await runHashJob(
            [{ path: 'assets/u', size: null }],
            optionsOf({ onProgress: (progress) => events.push({ ...progress }), openPieces: async () => piecesOf([new Uint8Array(100)]) }),
        )
        expect(events[events.length - 1]).toEqual({ doneBytes: 100, totalBytes: 100, doneFiles: 1, totalFiles: 1 })
    })

    test('an abort stops the pass, keeps the finished hashes in the session cache and the next run reuses them', async () => {
        for (const reason of ['finder closed', 'owner changed']) {
            const cache = createHashCache()
            const controller = new AbortController()
            const opened: string[] = []
            const items: HashItem[] = ['a', 'b', 'c', 'd'].map((name) => ({ path: 'assets/' + name, size: 4 }))
            const first = await runHashJob(
                items,
                optionsOf({
                    cache,
                    signal: controller.signal,
                    openPieces: async (path) => {
                        opened.push(path)
                        if (path === 'assets/c') {
                            controller.abort(reason)
                        }
                        return piecesOf([bytesOf(path.slice(-1).repeat(4))])
                    },
                }),
            )
            expect(first.status).toBe('aborted')
            expect([...first.hashes.keys()]).toEqual(['assets/a', 'assets/b'])
            expect(opened).toEqual(['assets/a', 'assets/b', 'assets/c'])
            opened.length = 0
            const second = await runHashJob(items, optionsOf({ cache, openPieces: async (path) => { opened.push(path); return piecesOf([bytesOf(path.slice(-1).repeat(4))]) } }))
            expect(second.status).toBe('done')
            expect(opened).toEqual(['assets/c', 'assets/d'])
            expect(second.hashes.get('assets/a')).toBe(first.hashes.get('assets/a'))
        }
    })

    test('a file opened once is hashed once even when listed twice', async () => {
        const openPieces = vi.fn(async () => piecesOf([bytesOf('same')]))
        const result = await runHashJob(
            [{ path: 'assets/x', size: 4 }, { path: 'assets/x', size: 4 }],
            optionsOf({ openPieces }),
        )
        expect(openPieces).toHaveBeenCalledTimes(1)
        expect(result.hashes.size).toBe(1)
    })
})

describe('hash cache', () => {
    test('the key is the path and the size, so a rewrite of another size never reuses a stale hash', async () => {
        const cache = createHashCache()
        let content = bytesOf('0123456789')
        const openPieces = vi.fn(async () => piecesOf([content]))
        const before = await runHashJob([{ path: 'assets/photo.png', size: 10 }], optionsOf({ cache, openPieces }))
        content = bytesOf('0123456789ab')
        const after = await runHashJob([{ path: 'assets/photo.png', size: 12 }], optionsOf({ cache, openPieces }))
        expect(openPieces).toHaveBeenCalledTimes(2)
        expect(after.hashes.get('assets/photo.png')).toBe(sha256Of(content))
        expect(after.hashes.get('assets/photo.png')).not.toBe(before.hashes.get('assets/photo.png'))
        expect(hashCacheKey('assets/photo.png', 10)).toBe('assets/photo.png\u000010')
        expect(hashCacheKey('assets/photo.png', null)).toBe('assets/photo.png\u0000?')
        expect(createHashCache().get('assets/photo.png', 10)).toBeUndefined()
    })

    test('a non-hash path with an unchanged size is served from the cache', async () => {
        const cache = createHashCache()
        const openPieces = vi.fn(async () => piecesOf([bytesOf('0123456789')]))
        await runHashJob([{ path: 'assets/photo.png', size: 10 }], optionsOf({ cache, openPieces }))
        await runHashJob([{ path: 'assets/photo.png', size: 10 }], optionsOf({ cache, openPieces }))
        expect(openPieces).toHaveBeenCalledTimes(1)
    })

    const STEM = 'ab'.repeat(32)

    test('a content-addressed path is immutable: its hash is reused whatever size a row reported', async () => {
        const cache = createHashCache()
        const openPieces = vi.fn(async () => piecesOf([bytesOf('0123456789')]))
        const path = 'assets/' + STEM + '.png'
        await runHashJob([{ path, size: null }], optionsOf({ cache, openPieces }))
        await runHashJob([{ path, size: 10 }], optionsOf({ cache, openPieces }))
        expect(openPieces).toHaveBeenCalledTimes(1)
    })

    test('which paths are content-addressed, and so skip the size re-read at apply', () => {
        expect(isImmutableAssetPath('assets/' + STEM + '.png')).toBe(true)
        expect(isImmutableAssetPath('assets\\' + STEM + '.webp')).toBe(true)
        expect(isImmutableAssetPath(STEM)).toBe(true)
        expect(isImmutableAssetPath('assets/' + STEM.toUpperCase() + '.png')).toBe(false)
        expect(isImmutableAssetPath('assets/' + STEM.slice(1) + '.png')).toBe(false)
        expect(isImmutableAssetPath('assets/' + STEM + 'a.png')).toBe(false)
        expect(isImmutableAssetPath('assets/photo.png')).toBe(false)
        expect(isImmutableAssetPath('assets/.' + 'png')).toBe(false)
        expect(sizeRecheckNeeded('assets/' + STEM + '.png')).toBe(false)
        expect(sizeRecheckNeeded('assets/photo.png')).toBe(true)
    })

    test('a non-hash path with a null size is not reused for a known size', async () => {
        const cache = createHashCache()
        const openPieces = vi.fn(async () => piecesOf([bytesOf('0123456789')]))
        await runHashJob([{ path: 'assets/photo.png', size: null }], optionsOf({ cache, openPieces }))
        await runHashJob([{ path: 'assets/photo.png', size: 10 }], optionsOf({ cache, openPieces }))
        expect(openPieces).toHaveBeenCalledTimes(2)
    })
})

describe('Check bytes', () => {
    function rowsOf(...names: string[]) {
        return names.map((name) => ({ name, path: 'assets/' + name }))
    }

    test('every size pending at the press: it completes the sizes, selects, then hashes both equal-bytes rows', async () => {
        const content = bytesOf('identical bytes')
        const sizeOf = vi.fn(async () => content.length)
        const sizes = createAssetSizeJob({ source: SOURCE, sizeOf })
        const phases: string[] = []
        const openPieces = vi.fn(async () => piecesOf([content]))
        const checkBytes = createCheckBytes({
            sizes,
            source: SOURCE,
            cache: createHashCache(),
            openPieces,
            createWorker: () => null,
            yieldToLoop: async () => { },
            onPhase: (phase) => phases.push(phase),
        })
        const rows = rowsOf('smile.png', 'smile2.png')
        expect(rows.map((row) => sizes.peek(row.path))).toEqual([undefined, undefined])
        const result = await checkBytes.runCheckBytes(rows, new AbortController().signal)
        expect(phases).toEqual(['sizes', 'hashing'])
        expect(sizeOf).toHaveBeenCalledTimes(2)
        expect(result.status).toBe('done')
        expect(result.selectedRows).toBe(2)
        expect(result.hashes.get('assets/smile.png')).toBe(sha256Of(content))
        expect(result.hashes.get('assets/smile2.png')).toBe(result.hashes.get('assets/smile.png'))
    })

    test('rows with unique names and unique sizes read no bytes', async () => {
        const sizes = createAssetSizeJob({ source: SOURCE, sizeOf: async (key) => key.length })
        const openPieces = vi.fn(async () => piecesOf([bytesOf('x')]))
        const checkBytes = createCheckBytes({ sizes, source: SOURCE, cache: createHashCache(), openPieces, createWorker: () => null })
        const result = await checkBytes.runCheckBytes(rowsOf('a', 'bb', 'ccc'), new AbortController().signal)
        expect(result.status).toBe('done')
        expect(result.selectedRows).toBe(0)
        expect(openPieces).not.toHaveBeenCalled()
    })

    test('selection follows the real sizes: a same-size pair of other names is hashed and the odd size is not', async () => {
        const sizeByPath: Record<string, number | null> = { 'assets/a': 10, 'assets/b': 10, 'assets/c': 12, 'assets/e': null }
        const sizes = createAssetSizeJob({ source: SOURCE, sizeOf: async (key) => sizeByPath[key] })
        const opened: string[] = []
        const checkBytes = createCheckBytes({
            sizes,
            source: SOURCE,
            cache: createHashCache(),
            openPieces: async (path) => { opened.push(path); return piecesOf([bytesOf(path)]) },
            createWorker: () => null,
        })
        const result = await checkBytes.runCheckBytes(rowsOf('a', 'b', 'c', 'e'), new AbortController().signal)
        expect(result.status).toBe('done')
        expect(opened).toEqual(['assets/a', 'assets/b'])
    })

    test('a cancel during the size wait starts no hash and reports aborted', async () => {
        const controller = new AbortController()
        const sizes = createAssetSizeJob({
            source: SOURCE,
            sizeOf: async () => {
                controller.abort()
                return 5
            },
        })
        const openPieces = vi.fn(async () => piecesOf([bytesOf('x')]))
        const checkBytes = createCheckBytes({ sizes, source: SOURCE, cache: createHashCache(), openPieces, createWorker: () => null })
        const result = await checkBytes.runCheckBytes(rowsOf('a', 'b'), controller.signal)
        expect(result.status).toBe('aborted')
        expect(openPieces).not.toHaveBeenCalled()
    })

    test('a cancel during the size phase of many rows starts no further size read and no hash', async () => {
        const controller = new AbortController()
        const sizeOf = vi.fn(async () => {
            controller.abort()
            return 5
        })
        const sizes = createAssetSizeJob({ source: SOURCE, sizeOf })
        const openPieces = vi.fn(async () => piecesOf([bytesOf('x')]))
        const checkBytes = createCheckBytes({ sizes, source: SOURCE, cache: createHashCache(), openPieces, createWorker: () => null })
        const names = Array.from({ length: 20 }, (_, i) => 'file' + i)
        const result = await checkBytes.runCheckBytes(rowsOf(...names), controller.signal)
        expect(result.status).toBe('aborted')
        expect(sizeOf).toHaveBeenCalledTimes(1)
        expect(sizes.peek('assets/file19')).toBeUndefined()
        expect(openPieces).not.toHaveBeenCalled()
    })

    test('a cancel while waiting on size reads another caller started returns at once and leaves them running', async () => {
        let release: () => void = () => { }
        const gate = new Promise<void>((resolve) => { release = resolve })
        const sizeOf = vi.fn(async () => {
            await gate
            return 5
        })
        const sizes = createAssetSizeJob({ source: SOURCE, sizeOf })
        const openPieces = vi.fn(async () => piecesOf([bytesOf('x')]))
        const checkBytes = createCheckBytes({ sizes, source: SOURCE, cache: createHashCache(), openPieces, createWorker: () => null })
        const rows = rowsOf('a', 'b', 'c')
        const list = sizes.ensure(rows.map((row) => row.path), new AbortController().signal)
        const controller = new AbortController()
        let answered = false
        const check = checkBytes.runCheckBytes(rows, controller.signal).then((result) => {
            answered = true
            return result
        })
        controller.abort()
        await new Promise<void>((resolve) => setTimeout(resolve, 5))
        expect(answered).toBe(true)
        expect((await check).status).toBe('aborted')
        expect(sizes.peek('assets/a')).toBeUndefined()
        release()
        expect(await list).toBe(true)
        expect(sizes.peek('assets/c')).toBe(5)
        expect(openPieces).not.toHaveBeenCalled()
    })

    test('a cancel during hashing aborts the hash job and keeps the finished hashes', async () => {
        const controller = new AbortController()
        const sizes = createAssetSizeJob({ source: SOURCE, sizeOf: async () => 4 })
        const opened: string[] = []
        const checkBytes = createCheckBytes({
            sizes,
            source: SOURCE,
            cache: createHashCache(),
            openPieces: async (path) => {
                opened.push(path)
                if (path === 'assets/b') {
                    controller.abort()
                }
                return piecesOf([bytesOf('data')])
            },
            createWorker: () => null,
        })
        const result = await checkBytes.runCheckBytes(rowsOf('a', 'b', 'c'), controller.signal)
        expect(result.status).toBe('aborted')
        expect([...result.hashes.keys()]).toEqual(['assets/a'])
        expect(opened).toEqual(['assets/a', 'assets/b'])
    })

    test('creating Check bytes reads nothing', () => {
        const sizeOf = vi.fn(async () => 1)
        const openPieces = vi.fn(async () => piecesOf([bytesOf('x')]))
        createCheckBytes({ sizes: createAssetSizeJob({ source: SOURCE, sizeOf }), source: SOURCE, cache: createHashCache(), openPieces })
        expect(sizeOf).not.toHaveBeenCalled()
        expect(openPieces).not.toHaveBeenCalled()
    })
})
