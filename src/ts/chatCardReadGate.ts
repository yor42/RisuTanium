/**
 * The admission seam of "Copy as card": every image read the card starts asks
 * here first. On Android a whole read puts one Java array of the file's size in
 * the WebView heap, so a read whose size is unknown or above the card's own
 * limit never starts, and a read of the queue's threshold or more holds a grant
 * of the app-wide whole-read queue until its encode settles.
 */

import { isAndroidTransport } from './storage/tauriByteTransport'
import {
    ANDROID_DEFERRED_WHOLE_READ_MIN_BYTES,
    androidWholeReadQueue,
    wholeReadBytesOfUrl,
} from './storage/assetUrlGate'

/** The largest source file the card reads for one image. */
export const CARD_IMAGE_MAX_SOURCE_BYTES = 15 * 1024 * 1024

/** A read that was admitted. `release` is idempotent and gives back what the admission held. */
export interface ImageReadPermit {
    release(): void
}

/** Resolves with a permit when the read of `src` may start, or null when the image is to be left out. */
export type AdmitImageRead = (src: string, signal: AbortSignal) => Promise<ImageReadPermit | null>

const NO_GRANT: ImageReadPermit = { release() {} }

/**
 * The live admission. Off Android, and for an Android `data:` or `blob:` source
 * (which is not an asset read), the permit is empty and nothing is looked up. An
 * Android source whose registered size is unknown or above the card's limit is
 * refused; one of at least the queue's threshold waits for a grant, and an abort
 * while waiting resolves null at once with a late grant given back.
 */
export const admitCardImageRead: AdmitImageRead = (src, signal) => {
    if (signal.aborted) {
        return Promise.resolve(null)
    }
    if (!isAndroidTransport() || /^(data|blob):/i.test(src)) {
        return Promise.resolve(NO_GRANT)
    }
    const bytes = wholeReadBytesOfUrl(src)
    if (bytes === undefined || bytes > CARD_IMAGE_MAX_SOURCE_BYTES) {
        return Promise.resolve(null)
    }
    if (bytes < ANDROID_DEFERRED_WHOLE_READ_MIN_BYTES) {
        return Promise.resolve(NO_GRANT)
    }
    return new Promise<ImageReadPermit | null>((resolve) => {
        let aborted = false
        const onAbort = () => {
            aborted = true
            resolve(null)
        }
        signal.addEventListener('abort', onAbort, { once: true })
        void androidWholeReadQueue().acquire(bytes).then((grant) => {
            signal.removeEventListener('abort', onAbort)
            if (aborted || signal.aborted) {
                grant.release()
                resolve(null)
                return
            }
            resolve(grant)
        })
    })
}
