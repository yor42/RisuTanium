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

/**
 * Reads at most `HEADER_BYTES` of the body behind `url` with a ranged GET and
 * cancels the rest, whether the server honoured the range (206) or sent the
 * whole file (200). Copies at most `HEADER_BYTES`; a larger body chunk is cut.
 *
 * `whole` holds only when the bytes received equal the size the server stated:
 * a 206 whose `Content-Range` starts at 0 with a total equal to the bytes
 * received, or a 200 whose body ended within `HEADER_BYTES` with a
 * `Content-Length` equal to the bytes received (a 200 without one that ends
 * short of `HEADER_BYTES` is a failed read). A status other than 200 or 206, a multipart body, a missing, unparseable or non-zero-start
 * `Content-Range`, a prefix that is neither whole nor `HEADER_BYTES` long, and
 * any thrown error (an aborted fetch included) give `null`.
 */
export async function readUrlHeader(url: string, signal: AbortSignal): Promise<ImageHeader | null> {
    try {
        const response = await fetch(url, { headers: { Range: `bytes=0-${HEADER_BYTES - 1}` }, signal })
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
        const out = new Uint8Array(HEADER_BYTES)
        let filled = 0
        try {
            while (filled < HEADER_BYTES) {
                const { done, value } = await reader.read()
                if (done) {
                    break
                }
                if (value === undefined) {
                    continue
                }
                const take = Math.min(value.length, HEADER_BYTES - filled)
                out.set(value.subarray(0, take), filled)
                filled += take
            }
        } finally {
            void reader.cancel().catch(() => {})
        }
        const bytes = out.subarray(0, filled)
        if (rangeTotal !== null) {
            if (filled === rangeTotal) {
                return { bytes, whole: true }
            }
            return filled === HEADER_BYTES && rangeTotal > HEADER_BYTES ? { bytes, whole: false } : null
        }
        const stated = response.headers.get('content-length')
        const statedLength = stated === null ? null : Number(stated)
        if (filled < HEADER_BYTES) {
            return statedLength === filled ? { bytes, whole: true } : null
        }
        return { bytes, whole: statedLength === HEADER_BYTES }
    } catch {
        return null
    }
}

/**
 * Reads the first piece of `key` (`HEADER_BYTES`, passed explicitly) through
 * the ranged transport and closes the piece reader. `null` where the platform
 * has no ranged transport, on any error, and for a piece that is neither the
 * whole file nor `HEADER_BYTES` long.
 */
export async function readTauriHeader(key: string): Promise<ImageHeader | null> {
    if (transportKind() === 'other') {
        return null
    }
    const pieces = readRangedPieces(key, HEADER_BYTES)
    try {
        const first = await pieces.next()
        if (first.done === true) {
            return null
        }
        const piece = first.value
        const whole = piece.bytes.length === piece.total && piece.bytes.length <= HEADER_BYTES
        if (!whole && piece.bytes.length < HEADER_BYTES) {
            return null
        }
        return { bytes: piece.bytes.slice(0, HEADER_BYTES), whole }
    } catch {
        return null
    } finally {
        try {
            await pieces.return(undefined)
        } catch {
            // the reader is being dropped
        }
    }
}
