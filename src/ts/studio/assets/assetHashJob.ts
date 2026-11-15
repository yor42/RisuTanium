// Tier 3 of the duplicate check: Check bytes. It sizes the rows of one array, selects the ones that could share
// bytes, then hashes those piece by piece. It starts only on the button, reads objects in place and writes,
// marks and loads nothing. A worker hashes when the page has one; otherwise the runner hashes in short slices.

import { Sha256 } from '../../assetHash'
import { openExportAssetPieces, type ExportAssetSource } from '../../drive/assetPieces'
import type { ReadPiece } from '../../drive/inlayBackupExport'
import { isHashStemKey } from '../../storage/store2/lists/assetList'
import type { HashWorkerReply, HashWorkerRequest } from './assetHash.worker'
import type { AssetSizeJob } from './assetSizes'
import { selectForHashing, type HashRow } from './hashSelection'
import { createSlicedRunner, type SlicedRunner } from './slicedRunner'

/** The inline hasher feeds the core this many bytes between checkpoints: about 3 ms of work on a phone web view. */
export const HASH_SLICE_BYTES = 256 * 1024

/**
 * Whether `path` names a content-addressed asset: its file stem is 64 lowercase hex digits. Such a path is
 * immutable, so its hash is reused whatever size a row reported and it is never re-sized at apply.
 */
export function isImmutableAssetPath(path: string): boolean {
    const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
    const dot = base.lastIndexOf('.')
    return isHashStemKey(dot > 0 ? base.slice(0, dot) : base)
}

/** Whether the removal setter re-reads the size of `path` at apply: every path that is not content-addressed. */
export function sizeRecheckNeeded(path: string): boolean {
    return !isImmutableAssetPath(path)
}

/** The session hash cache key: a different size is a different object, so a rewrite never reuses a stale hash. */
export function hashCacheKey(path: string, size: number | null): string {
    return path + '\0' + String(size ?? '?')
}

export interface HashCache {
    get(path: string, size: number | null): string | undefined
    set(path: string, size: number | null, hex: string): void
}

export function createHashCache(): HashCache {
    const byKey = new Map<string, string>()
    const immutable = new Map<string, string>()
    return {
        get(path, size) {
            return byKey.get(hashCacheKey(path, size)) ?? (isImmutableAssetPath(path) ? immutable.get(path) : undefined)
        },
        set(path, size, hex) {
            byKey.set(hashCacheKey(path, size), hex)
            if (isImmutableAssetPath(path)) {
                immutable.set(path, hex)
            }
        },
    }
}

/** What the page needs of a worker; `createHashWorkerPort` adapts a real one. */
export interface HashWorkerPort {
    post(message: HashWorkerRequest, transfer: Transferable[]): void
    listen(onReply: (reply: HashWorkerReply) => void, onFailure: () => void): void
    terminate(): void
}

export function createHashWorkerPort(): HashWorkerPort | null {
    if (typeof Worker === 'undefined') {
        return null
    }
    try {
        const worker = new Worker(new URL('./assetHash.worker.ts', import.meta.url), { type: 'module' })
        return {
            post: (message, transfer) => worker.postMessage(message, transfer),
            listen(onReply, onFailure) {
                worker.onmessage = (event: MessageEvent<HashWorkerReply>) => onReply(event.data)
                worker.onerror = () => onFailure()
                worker.onmessageerror = () => onFailure()
            },
            terminate: () => worker.terminate(),
        }
    } catch {
        return null
    }
}

class HashWorkerError extends Error {
    constructor() {
        super('The hash worker failed')
        this.name = 'HashWorkerError'
    }
}

/** One asset's hash in progress. `update` resolves `false` when the job was aborted. */
interface HashSink {
    update(bytes: Uint8Array): Promise<boolean>
    finish(): Promise<string>
    abandon(): void
}

interface HashEngine {
    readonly kind: 'worker' | 'inline'
    begin(): HashSink
    dispose(): void
}

/**
 * The buffer to transfer for a piece. A view that does not cover its whole buffer is copied first: transferring
 * its buffer would detach bytes the source still owns and hand the worker bytes that are not the piece.
 */
function transferableBufferOf(bytes: Uint8Array): ArrayBuffer {
    const buffer = bytes.buffer
    if (buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === buffer.byteLength) {
        return buffer
    }
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return copy.buffer
}

function createWorkerEngine(port: HashWorkerPort): HashEngine {
    let nextId = 0
    let failure: HashWorkerError | null = null
    let waiter: { id: number, resolve: (reply: HashWorkerReply) => void, reject: (error: HashWorkerError) => void } | null = null
    port.listen(
        (reply) => {
            if (waiter !== null && waiter.id === reply.id) {
                const answered = waiter
                waiter = null
                answered.resolve(reply)
            }
        },
        () => {
            failure = new HashWorkerError()
            const pending = waiter
            waiter = null
            pending?.reject(failure)
        },
    )
    function expect(id: number): Promise<HashWorkerReply> {
        if (failure !== null) {
            return Promise.reject(failure)
        }
        return new Promise((resolve, reject) => {
            waiter = { id, resolve, reject }
        })
    }
    return {
        kind: 'worker',
        begin() {
            const id = ++nextId
            port.post({ t: 'begin', id }, [])
            return {
                async update(bytes) {
                    const buffer = transferableBufferOf(bytes)
                    const acknowledged = expect(id)
                    port.post({ t: 'piece', id, buffer }, [buffer])
                    await acknowledged
                    return true
                },
                async finish() {
                    const answered = expect(id)
                    port.post({ t: 'end', id }, [])
                    const reply = await answered
                    if (reply.t !== 'digest') {
                        throw new HashWorkerError()
                    }
                    return reply.hex
                },
                abandon() {
                    port.post({ t: 'abandon', id }, [])
                },
            }
        },
        dispose: () => port.terminate(),
    }
}

/** The incremental hash the inline engine drives; `Sha256` by default. */
export interface HashAccumulator {
    update(bytes: Uint8Array): unknown
    digestHex(): string
}

function createInlineEngine(runner: SlicedRunner, createHasher: () => HashAccumulator): HashEngine {
    return {
        kind: 'inline',
        begin() {
            const hash = createHasher()
            return {
                async update(bytes) {
                    for (let start = 0; start < bytes.length; start += HASH_SLICE_BYTES) {
                        hash.update(bytes.subarray(start, Math.min(start + HASH_SLICE_BYTES, bytes.length)))
                        if (!await runner.checkpoint()) {
                            return false
                        }
                    }
                    return true
                },
                finish: async () => hash.digestHex(),
                abandon() { },
            }
        },
        dispose() { },
    }
}

export interface HashItem {
    path: string
    /** The settled size: a number, or `null` where the store cannot say. */
    size: number | null
}

export interface HashProgress {
    doneBytes: number
    totalBytes: number
    doneFiles: number
    totalFiles: number
}

export interface OpenedPieces {
    first: ReadPiece
    rest: AsyncGenerator<ReadPiece, void, undefined>
}

export interface HashJobOptions {
    source: ExportAssetSource
    signal: AbortSignal
    cache: HashCache
    /** Tests inject a piece source; the default is `openExportAssetPieces`. */
    openPieces?: (path: string) => Promise<OpenedPieces>
    /** `null` hashes inline on the runner. Tests inject a port. */
    createWorker?: () => HashWorkerPort | null
    /** The inline hasher. Tests inject one that spends simulated time. */
    createHasher?: () => HashAccumulator
    now?: () => number
    yieldToLoop?: () => Promise<void>
    onProgress?: (progress: HashProgress) => void
}

export interface HashJobResult {
    status: 'done' | 'aborted'
    /** The hash of every item hashed or found in the session cache, by path. Kept on abort. */
    hashes: Map<string, string>
    /** Paths whose source threw: excluded from `hashes`, and the pass went on. */
    unreadable: string[]
    longestSliceMs: number
}

/** The figures of "{x} of {y} MB". */
export function progressFigures(doneBytes: number, totalBytes: number): { x: string, y: string } {
    const megabytes = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1)
    return { x: megabytes(doneBytes), y: megabytes(totalBytes) }
}

type ItemOutcome = { kind: 'hashed', hex: string, bytes: number } | { kind: 'aborted' }

/** Hashes each distinct path once, one piece in flight, and stops at `options.signal`. */
export async function runHashJob(items: readonly HashItem[], options: HashJobOptions): Promise<HashJobResult> {
    const runner = createSlicedRunner({ signal: options.signal, now: options.now, yieldToLoop: options.yieldToLoop })
    const open = options.openPieces ?? ((path: string) => openExportAssetPieces(path, options.source))
    const hashes = new Map<string, string>()
    const unreadable: string[] = []
    const distinct: HashItem[] = []
    const seen = new Set<string>()
    for (const item of items) {
        if (!seen.has(item.path)) {
            seen.add(item.path)
            distinct.push(item)
        }
    }
    let totalBytes = 0
    for (const item of distinct) {
        totalBytes += item.size ?? 0
    }
    let doneBytes = 0
    let doneFiles = 0
    const report = (partial: number) => options.onProgress?.({ doneBytes: doneBytes + partial, totalBytes, doneFiles, totalFiles: distinct.length })

    const port = (options.createWorker ?? createHashWorkerPort)()
    const createHasher = options.createHasher ?? (() => new Sha256())
    let engine: HashEngine = port === null ? createInlineEngine(runner, createHasher) : createWorkerEngine(port)

    async function hashOne(item: HashItem): Promise<ItemOutcome> {
        const opened = await runner.io(open(item.path))
        const sink = engine.begin()
        let partial = 0
        let counted = false
        try {
            if (item.size === null) {
                totalBytes += opened.first.total
                counted = true
            }
            let piece: ReadPiece | undefined = opened.first
            while (piece !== undefined) {
                if (!await sink.update(piece.bytes) || runner.aborted()) {
                    sink.abandon()
                    return { kind: 'aborted' }
                }
                partial += piece.bytes.length
                report(partial)
                const next: IteratorResult<ReadPiece, void> = await runner.io(opened.rest.next())
                piece = next.done === true ? undefined : next.value
            }
            return { kind: 'hashed', hex: await sink.finish(), bytes: partial }
        } catch (error) {
            sink.abandon()
            if (counted) {
                totalBytes -= opened.first.total
            }
            throw error
        } finally {
            await opened.rest.return(undefined).catch(() => { })
        }
    }

    try {
        report(0)
        for (const item of distinct) {
            if (runner.aborted()) {
                return { status: 'aborted', hashes, unreadable, longestSliceMs: runner.longestSliceMs() }
            }
            const cached = options.cache.get(item.path, item.size)
            if (cached !== undefined) {
                hashes.set(item.path, cached)
                doneBytes += item.size ?? 0
                doneFiles += 1
                report(0)
                continue
            }
            let outcome: ItemOutcome | null = null
            while (outcome === null) {
                try {
                    outcome = await hashOne(item)
                } catch (error) {
                    if (runner.aborted()) {
                        outcome = { kind: 'aborted' }
                    } else if (error instanceof HashWorkerError && engine.kind === 'worker') {
                        // A failing worker is not a failing file: hash this item and the rest inline.
                        engine.dispose()
                        engine = createInlineEngine(runner, createHasher)
                    } else {
                        unreadable.push(item.path)
                        doneBytes += item.size ?? 0
                        doneFiles += 1
                        report(0)
                        break
                    }
                }
            }
            if (outcome === null) {
                continue
            }
            if (outcome.kind === 'aborted') {
                return { status: 'aborted', hashes, unreadable, longestSliceMs: runner.longestSliceMs() }
            }
            options.cache.set(item.path, item.size, outcome.hex)
            hashes.set(item.path, outcome.hex)
            doneBytes += item.size ?? outcome.bytes
            doneFiles += 1
            report(0)
        }
        return { status: 'done', hashes, unreadable, longestSliceMs: runner.longestSliceMs() }
    } finally {
        engine.dispose()
    }
}

export interface CheckBytesDeps extends Omit<HashJobOptions, 'signal'> {
    sizes: AssetSizeJob
    /** The finder shows its `loading` text with Cancel while `sizes` runs, and the progress while `hashing` does. */
    onPhase?: (phase: 'sizes' | 'hashing') => void
}

export interface CheckBytesResult extends HashJobResult {
    /** The rows `selectForHashing` chose. */
    selectedRows: number
}

export interface CheckBytes {
    /**
     * Check bytes for the rows of one array. It completes the size job for every row whose size is pending, then
     * selects, then hashes. `signal` aborts either phase: the wait for sizes, the size reads this call started
     * and the hash job. Size reads another caller started keep that caller's signal.
     */
    runCheckBytes<R extends HashRow>(rows: readonly R[], signal: AbortSignal): Promise<CheckBytesResult>
}

export function createCheckBytes(deps: CheckBytesDeps): CheckBytes {
    return {
        async runCheckBytes(rows, signal) {
            const aborted: CheckBytesResult = { status: 'aborted', hashes: new Map(), unreadable: [], longestSliceMs: 0, selectedRows: 0 }
            const paths = rows.map((row) => row.path)
            deps.onPhase?.('sizes')
            if (!await deps.sizes.ensure(paths, signal)) {
                return aborted
            }
            const selection = selectForHashing(rows, deps.sizes.snapshot(paths))
            if (selection.kind === 'pending') {
                return aborted
            }
            deps.onPhase?.('hashing')
            const items = selection.rows.map((row) => ({ path: row.path, size: deps.sizes.peek(row.path) ?? null }))
            const result = await runHashJob(items, { ...deps, signal })
            return { ...result, selectedRows: selection.rows.length }
        },
    }
}
