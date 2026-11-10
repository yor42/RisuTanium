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
 *
 * Every URL has at most one read record at a time, shared by all loaders and all nodes of that URL. The record is made
 * when the URL is first asked for, holds the URL's single queue grant, and gives the real `src` to each node attached to
 * it. A real `src` is set only while the URL's record holds a grant; settling a record writes none.
 */

/** Chromium's own lazy-load distance for an image. */
const OBSERVER_MARGIN = '1250px 0px'

/** The same distance as a pixel count: a warm node within it of the viewport asks for its read at once. */
const BAND_PX = 1250

/** A read that ends neither in `load` nor in `error` releases its slot after this long, so one stuck image cannot stop the queue. */
const SETTLE_TIMEOUT_MS = 30_000

/**
 * URLs whose read finished lately: a new node for one of them asks at once when it is within the observer margin; it
 * still waits for the slot.
 */
const WARM_URL_LIMIT = 32

/** One read of one URL: `queued` until the queue grants it, `reading` while it holds the grant, `done` after it settled. */
interface ReadRecord {
    url: string
    state: 'queued' | 'reading' | 'done'
    nodes: Set<HTMLImageElement>
    grant: InFlightGrant | null
    timer: ReturnType<typeof setTimeout> | undefined
    listeners: Map<HTMLImageElement, { load: () => void, error: () => void }>
}

const warm = new Set<string>()
// URL -> its record, from the moment it is asked for until it settles. Module-wide, like the queue behind it.
const records = new Map<string, ReadRecord>()
// Node -> the record it is attached to. Invariant: an attached node is in `nodes` of its record.
let attachedTo = new WeakMap<HTMLImageElement, ReadRecord>()

/** Test seam: forgets the app-wide queue, the warm URLs and every read record. */
export function resetDeferredImagesForTest(): void {
    resetAndroidWholeReadQueueForTest()
    warm.clear()
    for (const record of records.values()) {
        clearTimeout(record.timer)
        removeListeners(record)
        record.state = 'done'
    }
    records.clear()
    attachedTo = new WeakMap()
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

/** Whether `img` lies within `BAND_PX` above or below the viewport. A node without a box (hidden, or no layout) counts as near. */
function inBand(img: HTMLImageElement): boolean {
    const rect = img.getBoundingClientRect()
    if (rect.top === 0 && rect.bottom === 0 && rect.left === 0 && rect.right === 0) {
        return true
    }
    return rect.bottom >= -BAND_PX && rect.top <= window.innerHeight + BAND_PX
}

function removeListeners(record: ReadRecord): void {
    for (const [node, listener] of record.listeners) {
        node.removeEventListener('load', listener.load)
        node.removeEventListener('error', listener.error)
    }
    record.listeners.clear()
}

/** A record is live from its ask until it settles or is reset. */
function isLive(record: ReadRecord): boolean {
    return records.get(record.url) === record && record.state !== 'done'
}

/** Ends a record once: the first load or error of a promoted node, or the timer. It writes no `src`; no node waits on it. */
function settle(record: ReadRecord, loaded: boolean): void {
    if (record.state === 'done') {
        return
    }
    clearTimeout(record.timer)
    removeListeners(record)
    if (records.get(record.url) === record) {
        records.delete(record.url)
    }
    record.state = 'done'
    if (loaded) {
        rememberWarm(record.url)
    }
    record.grant?.release()
}

/** Gives `img` the real source of `record`, which holds the grant, and lets its load or error settle the record. */
function promoteUnder(record: ReadRecord, img: HTMLImageElement): void {
    img.setAttribute('loading', 'eager')
    promote(img, record.url)
    record.nodes.add(img)
    attachedTo.set(img, record)
    const onLoad = () => {
        // The placeholder's own load can arrive after the swap; only the real source counts.
        if (img.getAttribute('src') === record.url) {
            settle(record, true)
        }
    }
    const onError = () => {
        if (img.getAttribute('src') === record.url) {
            settle(record, false)
        }
    }
    img.addEventListener('load', onLoad)
    img.addEventListener('error', onError)
    record.listeners.set(img, { load: onLoad, error: onError })
}

function liveRecordFor(url: string): ReadRecord | undefined {
    const record = records.get(url)
    return record !== undefined && isLive(record) ? record : undefined
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
    // Nodes this loader's observer is watching; dropped with the observer at each scan.
    let observed = new WeakSet<HTMLImageElement>()

    const observe = (img: HTMLImageElement) => {
        ensureObserver().observe(img)
        observed.add(img)
    }

    const unobserve = (img: HTMLImageElement) => {
        observer?.unobserve(img)
        observed.delete(img)
    }

    /** Takes `img` out of its record and the observer. A queued record with no node left gives its slot back at its grant. */
    const detach = (img: HTMLImageElement) => {
        unobserve(img)
        const record = attachedTo.get(img)
        if (record === undefined) {
            return
        }
        record.nodes.delete(img)
        const listener = record.listeners.get(img)
        if (listener !== undefined) {
            img.removeEventListener('load', listener.load)
            img.removeEventListener('error', listener.error)
            record.listeners.delete(img)
        }
        attachedTo.delete(img)
    }

    const onGrant = (record: ReadRecord, grant: InFlightGrant) => {
        if (!isLive(record)) {
            grant.release()
            return
        }
        const kept: HTMLImageElement[] = []
        for (const node of [...record.nodes]) {
            if (node.isConnected && node.getAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE) === record.url && attachedTo.get(node) === record) {
                kept.push(node)
                continue
            }
            // A dropped node must not stay attached to a record that reads without it.
            record.nodes.delete(node)
            if (attachedTo.get(node) === record) {
                attachedTo.delete(node)
            }
        }
        if (kept.length === 0) {
            record.state = 'done'
            records.delete(record.url)
            grant.release()
            return
        }
        record.state = 'reading'
        record.grant = grant
        record.timer = setTimeout(() => settle(record, false), SETTLE_TIMEOUT_MS)
        for (const node of kept) {
            promoteUnder(record, node)
        }
    }

    /** Creates the URL's record around `img` and asks the queue for its bytes. Callers have checked that no live record exists. */
    const ask = (img: HTMLImageElement, url: string) => {
        const record: ReadRecord = { url, state: 'queued', nodes: new Set([img]), grant: null, timer: undefined, listeners: new Map() }
        records.set(url, record)
        attachedTo.set(img, record)
        if (warm.has(url)) {
            rememberWarm(url)
        }
        const bytes = wholeReadBytesOfUrl(url) ?? ANDROID_DEFERRED_WHOLE_READ_MIN_BYTES
        void androidWholeReadQueue().acquire(bytes).then((grant) => onGrant(record, grant))
    }

    /** Joins `img` to a live record: it waits with its placeholder while the record is queued, and is real at once while it reads. */
    const attach = (img: HTMLImageElement, record: ReadRecord) => {
        detach(img)
        if (record.state === 'queued') {
            record.nodes.add(img)
            attachedTo.set(img, record)
            return
        }
        promoteUnder(record, img)
    }

    /** `near` is the band test the caller already made for a warm node; without it the test is made here. */
    const route = (img: HTMLImageElement, near?: boolean) => {
        const url = img.getAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE)
        if (!url) {
            return
        }
        const live = liveRecordFor(url)
        if (live !== undefined) {
            if (attachedTo.get(img) !== live) {
                attach(img, live)
            }
            return
        }
        if (warm.has(url) && (near ?? inBand(img))) {
            ask(img, url)
            return
        }
        observe(img)
    }

    const ensureObserver = (): IntersectionObserver => {
        if (observer === null) {
            observer = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) {
                        continue
                    }
                    const img = entry.target as HTMLImageElement
                    unobserve(img)
                    const url = img.getAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE)
                    if (!url) {
                        continue
                    }
                    const live = liveRecordFor(url)
                    if (live === undefined) {
                        ask(img, url)
                    } else if (attachedTo.get(img) !== live) {
                        attach(img, live)
                    }
                }
            }, { root: null, rootMargin: OBSERVER_MARGIN, scrollMargin: OBSERVER_MARGIN } as IntersectionObserverInit)
        }
        return observer
    }

    return {
        scan(root) {
            const images = Array.from(root.querySelectorAll<HTMLImageElement>(`img[${DEFERRED_IMAGE_SRC_ATTRIBUTE}]`))
            if (!observerSupported()) {
                for (const img of images) {
                    promote(img, img.getAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE) ?? '')
                }
                return
            }
            ensureObserver().disconnect()
            observed = new WeakSet()
            // The band rects are all read before any attribute is written, so one scan costs one layout.
            const near = new Map<HTMLImageElement, boolean>()
            for (const img of images) {
                const url = img.getAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE)
                if (url && warm.has(url) && attachedTo.get(img) === undefined && liveRecordFor(url) === undefined) {
                    near.set(img, inBand(img))
                }
            }
            for (const img of images) {
                route(img, near.get(img))
            }
        },
        assign(img, url) {
            const bytes = wholeReadBytesOfUrl(url)
            if (bytes === undefined || bytes < ANDROID_DEFERRED_WHOLE_READ_MIN_BYTES || !observerSupported()) {
                const record = attachedTo.get(img)
                if (record !== undefined && record.url !== url) {
                    detach(img)
                    img.removeAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE)
                }
                img.setAttribute('src', url)
                return
            }
            // The same URL again, in any state, changes nothing: a re-assign must not make a node wait on its own read.
            if (img.getAttribute('src') === url && !img.hasAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE)) {
                return
            }
            const record = attachedTo.get(img)
            if (record !== undefined && record.url === url && isLive(record)) {
                return
            }
            if (observed.has(img) && img.getAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE) === url) {
                return
            }
            detach(img)
            img.setAttribute(DEFERRED_IMAGE_SRC_ATTRIBUTE, url)
            img.setAttribute('src', DEFERRED_IMAGE_PLACEHOLDER_SRC)
            ensureObserver()
            route(img)
        },
        dispose() {
            observer?.disconnect()
            observer = null
            observed = new WeakSet()
        },
    }
}
