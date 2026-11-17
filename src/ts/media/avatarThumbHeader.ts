import { readRangedPieces, transportKind } from '../storage/tauriByteTransport'

/**
 * The first bytes of an avatar file, read without reading the file: from the
 * Node server's asset route (a ranged GET) or through the Tauri ranged
 * transport (one piece). Either returns `null` whenever the bytes cannot be
 * trusted as "the start of this file", and the caller then reads the whole
 * file instead.
 */

/** How much of the file a header read keeps. */
export const HEADER_BYTES = 65536

export interface ImageHeader {
    bytes: Uint8Array
    /** True only when `bytes` is every byte of the file. */
    whole: boolean
}

const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(\d+)$/

function discard(response: Response): void {
    try {
        void response.body?.cancel().catch(() => {})
    } catch {
        // best-effort: the body is not needed
    }
}

/** A prefix of a file together with the file's size as the server stated it. */
export interface UrlPrefix {
    header: ImageHeader
    /** The file's size from the 206 `Content-Range` or the 200 `Content-Length`; `null` when the server gave none. */
    total: number | null
}

/**
 * Reads at most `maxBytes` of the body behind `url` with a ranged GET and
 * cancels the rest, whether the server honoured the range (206) or sent the
 * whole file (200). Copies at most `maxBytes`; a larger body chunk is cut.
 *
 * `whole` holds only when the bytes received equal the size the server stated:
 * a 206 whose `Content-Range` starts at 0 with a total equal to the bytes
 * received, or a 200 whose body ended within `maxBytes` with a
 * `Content-Length` equal to the bytes received (a 200 without one that ends
 * short of `maxBytes` is a failed read). A status other than 200 or 206, a multipart body, a missing, unparseable or non-zero-start
 * `Content-Range`, a prefix that is neither whole nor `maxBytes` long, and
 * any thrown error (an aborted fetch included) give `null`.
 */
export async function readUrlPrefix(url: string, signal: AbortSignal, maxBytes: number = HEADER_BYTES): Promise<UrlPrefix | null> {
    try {
        const response = await fetch(url, { headers: { Range: `bytes=0-${maxBytes - 1}` }, signal })
        if (response.status !== 200 && response.status !== 206) {
            discard(response)
            return null
        }
        if (/multipart/i.test(response.headers.get('content-type') ?? '')) {
            discard(response)
            return null
        }
        let rangeTotal: number | null = null
        if (response.status === 206) {
            const match = CONTENT_RANGE.exec(response.headers.get('content-range') ?? '')
            if (match === null || Number(match[1]) !== 0 || !Number.isSafeInteger(Number(match[3]))) {
                discard(response)
                return null
            }
            rangeTotal = Number(match[3])
        }
        if (response.body === null) {
            return null
        }
        const reader = response.body.getReader()
        const out = new Uint8Array(maxBytes)
        let filled = 0
        try {
            while (filled < maxBytes) {
                const { done, value } = await reader.read()
                if (done) {
                    break
                }
                if (value === undefined) {
                    continue
                }
                const take = Math.min(value.length, maxBytes - filled)
                out.set(value.subarray(0, take), filled)
                filled += take
            }
        } finally {
            void reader.cancel().catch(() => {})
        }
        const bytes = out.subarray(0, filled)
        if (rangeTotal !== null) {
            if (filled === rangeTotal) {
                return { header: { bytes, whole: true }, total: rangeTotal }
            }
            return filled === maxBytes && rangeTotal > maxBytes ? { header: { bytes, whole: false }, total: rangeTotal } : null
        }
        const stated = response.headers.get('content-length')
        const statedLength = stated === null ? null : Number(stated)
        const total = statedLength !== null && Number.isSafeInteger(statedLength) ? statedLength : null
        if (filled < maxBytes) {
            return statedLength === filled ? { header: { bytes, whole: true }, total } : null
        }
        return { header: { bytes, whole: statedLength === maxBytes }, total }
    } catch {
        return null
    }
}

/** The first `maxBytes` of the file behind `url`, without the size; see `readUrlPrefix`. */
export async function readUrlHeader(url: string, signal: AbortSignal, maxBytes: number = HEADER_BYTES): Promise<ImageHeader | null> {
    return (await readUrlPrefix(url, signal, maxBytes))?.header ?? null
}

/**
 * What the first piece of a file said. `none`: the platform has no ranged
 * transport, so no read was attempted. `failed`: a read was attempted and
 * errored. `piece`: the first piece arrived, with the file's size as the
 * trailer reported it; `header` is the piece as a usable prefix, or `null` for
 * a piece that is neither the whole file nor `maxBytes` long.
 */
export type TauriPrefix =
    | { kind: 'none' }
    | { kind: 'failed' }
    | { kind: 'piece', header: ImageHeader | null, total: number }

/**
 * Reads the first piece of `key` (`maxBytes`, passed explicitly) through the
 * ranged transport and closes the piece reader.
 */
export async function readTauriPrefix(key: string, maxBytes: number = HEADER_BYTES): Promise<TauriPrefix> {
    if (transportKind() === 'other') {
        return { kind: 'none' }
    }
    const pieces = readRangedPieces(key, maxBytes)
    try {
        const first = await pieces.next()
        if (first.done === true) {
            return { kind: 'failed' }
        }
        const piece = first.value
        const whole = piece.bytes.length === piece.total && piece.bytes.length <= maxBytes
        if (!whole && piece.bytes.length < maxBytes) {
            return { kind: 'piece', header: null, total: piece.total }
        }
        return { kind: 'piece', header: { bytes: piece.bytes.slice(0, maxBytes), whole }, total: piece.total }
    } catch {
        return { kind: 'failed' }
    } finally {
        try {
            await pieces.return(undefined)
        } catch {
            // the reader is being dropped
        }
    }
}

/**
 * The first piece of `key` as a header. `null` where the platform has no
 * ranged transport, on any error, and for a piece that is neither the whole
 * file nor `maxBytes` long.
 */
export async function readTauriHeader(key: string, maxBytes: number = HEADER_BYTES): Promise<ImageHeader | null> {
    const prefix = await readTauriPrefix(key, maxBytes)
    return prefix.kind === 'piece' ? prefix.header : null
}
