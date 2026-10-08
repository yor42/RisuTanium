/**
 * What the parser shows for an inlay id, kept for the page's life so that a
 * render of an unchanged id reads nothing.
 *
 * - An entry names the URL the markup carries and, when that URL is an object
 *   URL this module made, the URL to revoke when the entry goes.
 * - Every write of an id, and its delete, drops the entry while it holds the
 *   id's lock (`withInlayLock`), so a cached URL never outlives the body it
 *   shows by more than the moment before the drop. A cache miss is resolved
 *   under the same lock, so no render made before a write is cached after it.
 * - A render is never requested from inside the lock of its own id: the lock is
 *   a FIFO that does not re-enter.
 */

/** How the URL of a render reaches the media element. */
export type InlayRenderSource =
    /** A signature: model-facing data that is never shown, so there is no URL. */
    | 'signature'
    /** The store serves the body by URL; nothing is held in the page. */
    | 'store-url'
    /** An object URL over the Blob the store holds, so the browser keeps it on disk. */
    | 'stored-blob'
    /** An object URL over a Blob the page holds: built in memory from the body bytes or a data URI, or the old store's own (disk-backed) Blob as read. */
    | 'memory-blob'

export interface InlayRender {
    /** `image`, `video`, `audio` or `signature`; anything else is a type the parser does not show. */
    type: string
    /** Empty for a signature. */
    url: string
    source: InlayRenderSource
}

interface InlayRenderEntry extends InlayRender {
    /** The object URL this module made for the entry, or `null` when `url` is not one. */
    objectUrl: string | null
}

const entries = new Map<string, InlayRenderEntry>()

export function cachedInlayRender(id: string): InlayRender | null {
    const entry = entries.get(id)
    return entry === undefined ? null : { type: entry.type, url: entry.url, source: entry.source }
}

export function cacheInlayRender(id: string, render: InlayRender, objectUrl: string | null): void {
    entries.set(id, { ...render, objectUrl })
}

/**
 * Forgets the render of `id`. With `revoke` its object URL is released too, which
 * breaks media in markup that still shows it; without it the URL stays valid.
 */
export function dropInlayRender(id: string, revoke = true): void {
    const entry = entries.get(id)
    if (entry === undefined) {
        return
    }
    entries.delete(id)
    if (revoke && entry.objectUrl !== null) {
        URL.revokeObjectURL(entry.objectUrl)
    }
}
