// Stored sizes of the assets an asset list shows (tier 2 of the duplicate check). One job and one session cache
// serve the list's rows and Check bytes. Nothing is read until a caller asks, so opening the tree reads nothing.

import { assetStoredSize, type ExportAssetSource } from '../../drive/assetPieces'

/**
 * A size is three-state: a number (known), `null` (the store cannot say) or `undefined` (pending: not read yet).
 * A pending size is never read as "unknown".
 */
export type StoredSize = number | null | undefined

/** A chunk of keys is requested at a time, so a cancel stops between chunks. */
export const SIZE_CHUNK_KEYS = 8

/** On the web each size is a whole `readValue`, so one read runs at a time. */
export const WEB_SIZE_CONCURRENCY = 1

/** The Tauri and Node stores answer from metadata or a first piece. */
export const NATIVE_SIZE_CONCURRENCY = 8

export interface AssetSizeJobOptions {
    /** The store the sizes come from; `null` leaves every size unknown. */
    source: ExportAssetSource | null
    /** The reader of one size. Tests inject a double; the default is `assetStoredSize`. */
    sizeOf?: (key: string, source: ExportAssetSource | null) => Promise<number | null>
}

export interface AssetSizeJob {
    /** The size now known for `path`: `undefined` while pending. */
    peek(path: string): StoredSize
    /** The sizes now known for `paths`; a path not yet read maps to `undefined`. */
    snapshot(paths: readonly string[]): Map<string, StoredSize>
    /**
     * Reads the sizes of the paths not yet in the session cache, in chunks, and resolves `true` once every one is
     * settled. `signal` stops this caller's reads: it resolves `false` and starts no further read. A read already
     * in flight finishes and fills the cache. A read that another caller started is waited on, never repeated.
     * `onSettled` is called for each size this call settles.
     */
    ensure(paths: readonly string[], signal: AbortSignal, onSettled?: (path: string, size: number | null) => void): Promise<boolean>
}

function concurrencyOf(source: ExportAssetSource | null): number {
    return source?.kind === 'web' ? WEB_SIZE_CONCURRENCY : NATIVE_SIZE_CONCURRENCY
}

export function createAssetSizeJob(options: AssetSizeJobOptions): AssetSizeJob {
    const source = options.source
    const sizeOf = options.sizeOf ?? assetStoredSize
    const limit = concurrencyOf(source)
    const cache = new Map<string, number | null>()
    const inFlight = new Map<string, Promise<void>>()
    const waiting: (() => void)[] = []
    let active = 0

    async function acquire(): Promise<void> {
        if (active < limit) {
            active++
            return
        }
        await new Promise<void>((resolve) => waiting.push(resolve))
    }

    function release(): void {
        const next = waiting.shift()
        if (next === undefined) {
            active--
        } else {
            next()
        }
    }

    /** Starts the read of `path` for the caller that owns `signal`; a read the caller aborted before it began is not made. */
    function start(path: string, signal: AbortSignal, onSettled?: (path: string, size: number | null) => void): Promise<void> {
        const read = (async () => {
            await acquire()
            try {
                if (signal.aborted) {
                    return
                }
                const size = await sizeOf(path, source)
                cache.set(path, size)
                onSettled?.(path, size)
            } finally {
                release()
            }
        })().finally(() => {
            inFlight.delete(path)
        })
        inFlight.set(path, read)
        return read
    }

    /** Waits for `work`, or returns as soon as `signal` aborts; the work itself is left running. */
    function waitUnlessAborted(work: Promise<void>, signal: AbortSignal): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const onAbort = () => resolve()
            signal.addEventListener('abort', onAbort, { once: true })
            work.then(
                () => {
                    signal.removeEventListener('abort', onAbort)
                    resolve()
                },
                (error: unknown) => {
                    signal.removeEventListener('abort', onAbort)
                    reject(error)
                },
            )
        })
    }

    async function settle(path: string, signal: AbortSignal, onSettled?: (path: string, size: number | null) => void): Promise<void> {
        while (!cache.has(path) && !signal.aborted) {
            const running = inFlight.get(path)
            await waitUnlessAborted(running ?? start(path, signal, onSettled), signal)
        }
    }

    return {
        peek: (path) => cache.get(path),
        snapshot(paths) {
            const sizes = new Map<string, StoredSize>()
            for (const path of paths) {
                sizes.set(path, cache.get(path))
            }
            return sizes
        },
        async ensure(paths, signal, onSettled) {
            const wanted = [...new Set(paths)].filter((path) => !cache.has(path))
            for (let from = 0; from < wanted.length; from += SIZE_CHUNK_KEYS) {
                if (signal.aborted) {
                    return false
                }
                const chunk = wanted.slice(from, from + SIZE_CHUNK_KEYS)
                await Promise.all(chunk.map((path) => settle(path, signal, onSettled)))
            }
            return !signal.aborted && wanted.every((path) => cache.has(path))
        },
    }
}
