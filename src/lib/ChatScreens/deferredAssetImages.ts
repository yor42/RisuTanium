import {
    ANDROID_DEFERRED_WHOLE_READ_MIN_BYTES, DEFERRED_IMAGE_PLACEHOLDER_SRC,
    DEFERRED_IMAGE_SRC_ATTRIBUTE, androidWholeReadQueue, resetAndroidWholeReadQueueForTest, wholeReadBytesOfUrl, type InFlightGrant,
} from '../../ts/storage/assetUrlGate'

/**
 * Loads the large asset images of chat bodies one budget at a time. The sanitizer leaves such an image with a
 * placeholder `src` and its real URL in `data-risu-deferred-src`; a loader observes those images and gives each its real
 * `src` once it is within `OBSERVER_MARGIN` of the viewport and the app-wide queue has room for its read. The queue is
 * shared by every loader and by the list avatars (`queuedWholeRead.ts`), because the WebView holds one Java array per
 * read, whichever message or list the file is in.
 */

/** Chromium's own lazy-load distance for an image. */
const OBSERVER_MARGIN = '1250px 0px'

/** A read that ends neither in `load` nor in `error` releases its slot after this long, so one stuck image cannot stop the queue. */
const SETTLE_TIMEOUT_MS = 30_000

/** URLs whose read finished lately: a re-rendered node for one of them takes its real `src` without a slot. */
const WARM_URL_LIMIT = 32

const warm = new Set<string>()
// URL -> the nodes that wait for the read already in flight for that URL.
const inFlight = new Map<string, Set<HTMLImageElement>>()

/** Test seam: forgets the app-wide queue, the warm URLs and every read in flight. */
export function resetDeferredImagesForTest(): void {
    resetAndroidWholeReadQueueForTest()
    warm.clear()
    inFlight.clear()
}

function rememberWarm(url: string): void {
    warm.delete(url)
    warm.add(url)
    while (warm.size > WARM_URL_LIMIT) {
        const oldest = warm.values().next()
        if (oldest.done) {
            break
        }
        warm.delete(oldest.value)
    }
}

/** Gives `img` the real source it waits for; its `loading` mode is left as it is. */
function promote(img: HTMLImageElement, url: string): void {
    img.removeAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE)
    img.setAttribute('src', url)
}

/** Whether this WebView can scroll-margin an observer past the scroller; where it cannot, nothing is deferred. */
function observerSupported(): boolean {
    return typeof IntersectionObserver !== 'undefined' && 'scrollMargin' in IntersectionObserver.prototype
}

export interface DeferredImageLoader {
    /** Routes every deferred image under `root`; a call replaces what the previous call observed. */
    scan(root: ParentNode): void
    /** Sets `url` as the source of `img`, deferring the load when the file is large and the queue is in use. */
    assign(img: HTMLImageElement, url: string): void
    /** Stops observing. Reads already granted run to their end and release their slot. */
    dispose(): void
}

export function createDeferredImageLoader(): DeferredImageLoader {
    let observer: IntersectionObserver | null = null
    // Nodes asked for a slot and not granted yet; a scan in between does not ask again.
    const queued = new WeakSet<HTMLImageElement>()

    const start = (img: HTMLImageElement, url: string, grant: InFlightGrant) => {
        const waiters = new Set<HTMLImageElement>()
        inFlight.set(url, waiters)
        let done = false
        let timer: ReturnType<typeof setTimeout> | undefined
        const settle = (loaded: boolean) => {
            if (done) {
                return
            }
            done = true
            clearTimeout(timer)
            img.removeEventListener('load', onLoad)
            img.removeEventListener('error', onError)
            if (inFlight.get(url) === waiters) {
                inFlight.delete(url)
            }
            if (loaded) {
                rememberWarm(url)
            }
            grant.release()
            for (const waiter of waiters) {
                if (waiter.getAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE) === url) {
                    waiter.setAttribute('loading', 'eager')
                    promote(waiter, url)
                }
            }
        }
        const onLoad = () => {
            // The placeholder's own load can arrive after the swap; only the real source counts.
            if (img.getAttribute('src') === url) {
                settle(true)
            }
        }
        const onError = () => {
            if (img.getAttribute('src') === url) {
                settle(false)
            }
        }
        img.addEventListener('load', onLoad)
        img.addEventListener('error', onError)
        timer = setTimeout(() => settle(false), SETTLE_TIMEOUT_MS)
        img.setAttribute('loading', 'eager')
        promote(img, url)
    }

    const request = (img: HTMLImageElement) => {
        const url = img.getAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE)
        if (!url || queued.has(img)) {
            return
        }
        if (routeKnown(img, url)) {
            return
        }
        queued.add(img)
        const bytes = wholeReadBytesOfUrl(url) ?? ANDROID_DEFERRED_WHOLE_READ_MIN_BYTES
        void androidWholeReadQueue().acquire(bytes).then((grant) => {
            queued.delete(img)
            if (!img.isConnected || img.getAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE) !== url) {
                grant.release()
                return
            }
            // Another node may have been granted the same URL while this one waited.
            if (routeKnown(img, url)) {
                grant.release()
                return
            }
            start(img, url, grant)
        })
    }

    /** Handles an image whose URL is warm or already being read; true when it did. */
    const routeKnown = (img: HTMLImageElement, url: string): boolean => {
        if (warm.has(url)) {
            rememberWarm(url)
            promote(img, url)
            return true
        }
        const waiters = inFlight.get(url)
        if (waiters !== undefined) {
            waiters.add(img)
            return true
        }
        return false
    }

    const route = (img: HTMLImageElement) => {
        const url = img.getAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE)
        if (!url || queued.has(img)) {
            return
        }
        if (!routeKnown(img, url)) {
            observer?.observe(img)
        }
    }

    const ensureObserver = (): IntersectionObserver => {
        if (observer === null) {
            observer = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        observer?.unobserve(entry.target)
                        request(entry.target as HTMLImageElement)
                    }
                }
            }, { root: null, rootMargin: OBSERVER_MARGIN, scrollMargin: OBSERVER_MARGIN } as IntersectionObserverInit)
        }
        return observer
    }

    return {
        scan(root) {
            const images = root.querySelectorAll<HTMLImageElement>(`img[${DEFERRED_IMAGE_SRC_ATTRIBUTE}]`)
            if (!observerSupported()) {
                for (const img of images) {
                    promote(img, img.getAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE) ?? '')
                }
                return
            }
            ensureObserver().disconnect()
            for (const img of images) {
                route(img)
            }
        },
        assign(img, url) {
            const bytes = wholeReadBytesOfUrl(url)
            if (bytes === undefined || bytes < ANDROID_DEFERRED_WHOLE_READ_MIN_BYTES || !observerSupported()) {
                img.setAttribute('src', url)
                return
            }
            img.setAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE, url)
            img.setAttribute('src', DEFERRED_IMAGE_PLACEHOLDER_SRC)
            ensureObserver()
            route(img)
        },
        dispose() {
            observer?.disconnect()
            observer = null
        },
    }
}
