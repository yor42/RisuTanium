/**
 * The one way the `.rtb` reader touches bytes: a range source that returns exactly
 * the requested bytes or reports that it could not.
 *
 * `ImportSource.read` may return fewer bytes than asked when the source ended or
 * shrank. The `.rtb` reader never parses a short result: a short read, a read
 * outside the size the source reported, and a read that rejects are all "could not
 * read", which is its own outcome and never "damaged".
 */
import type { ImportSource } from '../../importSource'

export class RtbCouldNotReadError extends Error {
    readonly offset: number
    readonly length: number

    constructor(message: string, offset: number, length: number, cause?: unknown) {
        super(message, cause === undefined ? undefined : { cause })
        this.name = 'RtbCouldNotReadError'
        this.offset = offset
        this.length = length
    }
}

export interface RangeSource {
    /** Size of the file when the source was opened. */
    readonly size: number
    /** Exactly `length` bytes at `offset`, or a rejection with `RtbCouldNotReadError`. */
    read(offset: number, length: number): Promise<Uint8Array>
}

/** Wraps an import source so that nothing short or out of range is ever returned. */
export function rangeSourceFrom(source: Pick<ImportSource, 'size' | 'read'>): RangeSource {
    return {
        size: source.size,
        async read(offset: number, length: number): Promise<Uint8Array> {
            if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
                throw new RtbCouldNotReadError(`invalid read of ${length} bytes at ${offset}`, offset, length)
            }
            if (offset + length > source.size) {
                throw new RtbCouldNotReadError(`read of ${length} bytes at ${offset} is outside the ${source.size} byte file`, offset, length)
            }
            if (length === 0) {
                return new Uint8Array(0)
            }
            let bytes: Uint8Array
            try {
                bytes = await source.read(offset, offset + length)
            } catch (error) {
                throw new RtbCouldNotReadError(`reading ${length} bytes at ${offset} failed`, offset, length, error)
            }
            if (bytes.length !== length) {
                throw new RtbCouldNotReadError(`read of ${length} bytes at ${offset} returned ${bytes.length}`, offset, length)
            }
            return bytes
        },
    }
}
