import type { BinFile, BinSlice } from './backupContainer'
import type { ImportSource } from '../importSource'

/**
 * A `BinFile` over a source the operating system handed to the app, which the restore reads like a picked `File`.
 * `changed` is the one thing a `File` reports by itself (a read of a changed file throws) and a source does not: it
 * asks whether the file is still the one that was opened.
 */
export interface SourceBinFile extends BinFile {
    /** Whether the file's size or modification time differs from when it was opened; also true when that cannot be told. */
    changed(): Promise<boolean>
}

/** Blob's argument rule: whole numbers toward zero, NaN as 0. */
function wholeNumber(value: number): number {
    return Number.isNaN(value) ? 0 : Math.trunc(value)
}

/** Resolves a Blob.slice bound (negative counts from the end) against a range of `length` bytes. */
function boundIn(value: number, length: number): number {
    const whole = wholeNumber(value)
    return whole < 0 ? Math.max(length + whole, 0) : Math.min(whole, length)
}

/**
 * Presents `source` as a `BinFile`. A slice is a range and does no I/O; `arrayBuffer` reads exactly that range from the
 * source. A nested slice is relative to its parent and never reaches past it. Reads run one after another, so the
 * source's cursor is never shared by two readers. A read error propagates and a short read stays short, so the callers'
 * length checks still see a file that changed.
 */
export function binFileOfSource(source: ImportSource): SourceBinFile {
    let queue: Promise<unknown> = Promise.resolve()
    const serial = <T>(run: () => Promise<T>): Promise<T> => {
        const result = queue.then(run)
        queue = result.catch(() => undefined)
        return result
    }
    const openedModified = source.stat().then((info) => info.modified, () => null)

    const rangeOf = (base: number, length: number): BinSlice => ({
        size: length,
        slice(start = 0, end) {
            const from = boundIn(start, length)
            const to = end === undefined ? length : boundIn(end, length)
            return rangeOf(base + from, Math.max(to - from, 0))
        },
        arrayBuffer() {
            if (length === 0) {
                return Promise.resolve(new ArrayBuffer(0))
            }
            return serial(async () => {
                const bytes = await source.read(base, base + length)
                if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) {
                    return bytes.buffer
                }
                const exact = new Uint8Array(bytes.length)
                exact.set(bytes)
                return exact.buffer
            })
        },
    })

    const whole = rangeOf(0, source.size)
    return {
        size: source.size,
        slice: whole.slice,
        async changed() {
            try {
                const now = await source.stat()
                const modified = await openedModified
                return now.size !== source.size || (modified !== null && now.modified !== modified)
            } catch (error) {
                console.error(error)
                return true
            }
        },
    }
}
