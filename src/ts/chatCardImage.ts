/**
 * The avatar image work of "Copy as card": the only place that fetches, decodes
 * and draws an image for the card. It runs in a live browser (fetch, image
 * decoding and a canvas) and is replaced by a stub wherever the card is tested.
 *
 * Callers pass only an address that is already known to be local to the app
 * (`data:`, `blob:`, an app image path or a Tauri asset address); this module
 * never decides what is local.
 */

export interface EncodeAvatarOptions {
    /** Longest side of the result, in pixels. A smaller image is not enlarged. */
    maxSide: number
    /** Colour the canvas is filled with first, so a transparent image does not turn black. */
    background: string
    /** Aborts the fetch and discards a decode that is still running. */
    signal: AbortSignal
}

const MAX_SOURCE_BYTES = 15 * 1024 * 1024
const MAX_PIXELS = 40_000_000
const JPEG_QUALITY = 0.85
const JPEG_PREFIX = 'data:image/jpeg;base64,'
const FALLBACK_BACKGROUND = '#ffffff'

interface Decoded {
    source: CanvasImageSource
    width: number
    height: number
    release: () => void
}

/**
 * Resolves with `promise`'s value, or with null as soon as `signal` aborts. A
 * value that arrives after an abort is handed to `discard`.
 */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal, discard: (late: T) => void): Promise<T | null> {
    return new Promise<T | null>((resolve, reject) => {
        let done = false
        const onAbort = () => {
            if (done) return
            done = true
            resolve(null)
        }
        if (signal.aborted) {
            onAbort()
        } else {
            signal.addEventListener('abort', onAbort, { once: true })
        }
        promise.then(
            (value) => {
                signal.removeEventListener('abort', onAbort)
                if (done) {
                    discard(value)
                    return
                }
                done = true
                resolve(value)
            },
            (error: unknown) => {
                signal.removeEventListener('abort', onAbort)
                if (done) return
                done = true
                reject(error)
            },
        )
    })
}

async function decodeWithBitmap(blob: Blob, signal: AbortSignal): Promise<Decoded | null> {
    const bitmap = await untilAborted(createImageBitmap(blob), signal, (late) => late.close())
    if (bitmap === null) return null
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
}

async function decodeWithImage(blob: Blob, signal: AbortSignal): Promise<Decoded | null> {
    const objectUrl = URL.createObjectURL(blob)
    const image = new Image()
    const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('image decode failed'))
    })
    image.src = objectUrl
    const release = () => {
        image.onload = null
        image.onerror = null
        image.removeAttribute('src')
        URL.revokeObjectURL(objectUrl)
    }
    try {
        const result = await untilAborted(loaded, signal, () => {})
        if (result === null) {
            release()
            return null
        }
        return { source: result, width: result.naturalWidth, height: result.naturalHeight, release }
    } catch (error) {
        release()
        throw error
    }
}

async function decode(blob: Blob, signal: AbortSignal): Promise<Decoded | null> {
    if (typeof createImageBitmap === 'function') {
        try {
            return await decodeWithBitmap(blob, signal)
        } catch {
            if (signal.aborted) return null
        }
    }
    return await decodeWithImage(blob, signal)
}

/**
 * Fetches the local image at `src`, decodes it, draws it on a canvas filled with
 * `opts.background`, shrinks it to `opts.maxSide` and returns a JPEG data URL.
 * The source is bounded in bytes before decoding; the pixel count is checked
 * after decoding, so it caps the canvas work, not the decode itself. Returns
 * null on any failure: a failed or aborted fetch, an oversized source, a decode
 * error, too many pixels, an empty canvas result.
 */
export async function encodeAvatar(src: string, opts: EncodeAvatarOptions): Promise<string | null> {
    const { signal } = opts
    let decoded: Decoded | null = null
    try {
        if (signal.aborted) return null
        if (src.startsWith('data:') && src.length > MAX_SOURCE_BYTES) return null

        const response = await fetch(src, { signal })
        if (!response.ok) return null
        const declared = Number(response.headers?.get('content-length') ?? '')
        if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) return null
        const blob = await response.blob()
        if (signal.aborted || blob.size === 0 || blob.size > MAX_SOURCE_BYTES) return null

        decoded = await decode(blob, signal)
        if (decoded === null || signal.aborted) return null
        const { width, height } = decoded
        if (!(width > 0) || !(height > 0) || width * height > MAX_PIXELS) return null

        const scale = Math.min(1, opts.maxSide / Math.max(width, height))
        const targetWidth = Math.max(1, Math.round(width * scale))
        const targetHeight = Math.max(1, Math.round(height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight
        const context = canvas.getContext('2d')
        if (!context) return null
        context.fillStyle = FALLBACK_BACKGROUND
        context.fillStyle = opts.background
        context.fillRect(0, 0, targetWidth, targetHeight)
        context.drawImage(decoded.source, 0, 0, targetWidth, targetHeight)
        const url = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
        canvas.width = 0
        canvas.height = 0
        return url.startsWith(JPEG_PREFIX) && url.length > JPEG_PREFIX.length ? url : null
    } catch {
        return null
    } finally {
        decoded?.release()
    }
}
