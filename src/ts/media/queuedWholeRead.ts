import { isAndroidTransport } from '../storage/tauriByteTransport'
import { ANDROID_DEFERRED_WHOLE_READ_MIN_BYTES, androidWholeReadQueue, wholeReadBytesOfUrl, type InFlightGrant } from '../storage/assetUrlGate'

/**
 * Lets a list avatar's full-size file wait in the app-wide whole-read queue (the one chat images use) before the
 * WebView is asked to read it. The queue admits a read from its grant until the read settles, so the file is
 * loaded here once, through a detached `Image`, while the slot is held. The `Image` stays referenced until the
 * caller's `hold` signal fires, so the CSS background that follows reuses the bytes instead of reading again.
 */

/** A read that ends neither in `load` nor in `error` releases its slot after this long, so one stuck file cannot stop the queue. */
const SETTLE_TIMEOUT_MS = 30_000

export type QueuedWholeReadOutcome = 'direct' | 'queued' | 'aborted'

// Detached images kept alive until their caller's `hold` fires.
const held = new Set<HTMLImageElement>()

/** Test seam: how many detached images are referenced now. */
export function heldQueuedWholeReadsForTest(): number {
    return held.size
}

/** Test seam: forgets every referenced image. */
export function resetQueuedWholeReadsForTest(): void {
    held.clear()
}

/**
 * Resolves `'direct'` at once when `url` needs no queue: it is not a registered whole read of at least
 * `ANDROID_DEFERRED_WHOLE_READ_MIN_BYTES` (the registry is filled on Android only, and the lookup is skipped
 * elsewhere so a large `data:` URL is never hashed). Otherwise it waits for a slot, loads the URL once and
 * resolves `'queued'` when that read settles (load, error or the timeout), keeping the image referenced
 * until `hold` aborts. `'aborted'` resolves as soon as `hold` aborts; a slot already granted is still given
 * back only when its read settles, and a grant that arrives after the abort is given back without a read.
 */
export function awaitQueuedWholeRead(url: string, hold: AbortSignal): Promise<QueuedWholeReadOutcome> {
    if (hold.aborted) {
        return Promise.resolve('aborted')
    }
    if (!isAndroidTransport()) {
        return Promise.resolve('direct')
    }
    const bytes = wholeReadBytesOfUrl(url)
    if (bytes === undefined || bytes < ANDROID_DEFERRED_WHOLE_READ_MIN_BYTES) {
        return Promise.resolve('direct')
    }
    return new Promise<QueuedWholeReadOutcome>((resolve) => {
        let image: HTMLImageElement | null = null
        let grant: InFlightGrant | null = null
        let timer: ReturnType<typeof setTimeout> | undefined
        let settled = false

        const dropImage = () => {
            if (image !== null) {
                image.removeEventListener('load', onLoad)
                image.removeEventListener('error', onError)
                held.delete(image)
                image = null
            }
        }
        const onAbort = () => {
            resolve('aborted')
            if (settled) {
                dropImage()
            }
        }
        const settle = () => {
            if (settled) {
                return
            }
            settled = true
            clearTimeout(timer)
            image?.removeEventListener('load', onLoad)
            image?.removeEventListener('error', onError)
            grant?.release()
            if (hold.aborted) {
                dropImage()
                resolve('aborted')
                return
            }
            resolve('queued')
        }
        const onLoad = () => settle()
        const onError = () => settle()

        hold.addEventListener('abort', onAbort, { once: true })
        void androidWholeReadQueue().acquire(bytes).then((granted) => {
            grant = granted
            if (hold.aborted) {
                granted.release()
                settled = true
                return
            }
            image = new Image()
            held.add(image)
            image.addEventListener('load', onLoad)
            image.addEventListener('error', onError)
            timer = setTimeout(settle, SETTLE_TIMEOUT_MS)
            image.src = url
        })
    })
}
