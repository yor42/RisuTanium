import { revokePortraitUrl, shrinkPortrait, type ShrinkOutcome } from './portraitDisplay'

/**
 * The app-wide store of shrunk portraits. One ownership relation: a holder (one TransitionImage) references
 * the entries it shows or waits for, and an entry knows its referencing holders. A pending entry whose last
 * reference is dropped is cancelled; a settled entry whose last reference is dropped stays cached and may be
 * evicted, least recently shown first. An entry settles only itself: every asynchronous handler closes over
 * its entry object, `removed` is the only liveness test, and `remove` is the only exit from the map, so a
 * replacement entry for the same key is never touched by an older job's outcome.
 */

export type DisplayImage = { src: string, width?: number, height?: number, key?: string }

export const PORTRAIT_CACHE_MAX_BYTES = 32 * 1024 * 1024
export const PORTRAIT_CACHE_MAX_ENTRIES = 64

export interface PortraitCacheDeps {
    shrink(src: string, maxSide: number, signal: AbortSignal): Promise<ShrinkOutcome>
    revoke(url: string): void
}

export interface PortraitCacheLimits {
    maxBytes?: number
    maxEntries?: number
}

export interface PortraitHolder {
    /**
     * Takes references to the entries `originals` need, then drops every other reference of this holder
     * except those of `keep`, in one synchronous step. Resolves the images in the order of `originals`, or
     * null when an entry it uses was removed before it settled. Never rejects.
     */
    request(originals: string[], maxSide: number, keep: DisplayImage[]): Promise<DisplayImage[] | null>
    /** Drops every reference whose key is not in `keep`, then enforces the bounds. Never adds one. */
    retain(keep: DisplayImage[]): void
    /** Drops every reference. Settled entries stay cached; a pending entry nobody else references is cancelled. */
    dispose(): void
}

export interface PortraitCacheSnapshot {
    entries: { key: string, state: 'pending' | 'shrunk' | 'original', refs: number, cost: number }[]
    total: number
}

export interface PortraitCache {
    createHolder(): PortraitHolder
    snapshotForTest(): PortraitCacheSnapshot
    dispose(): void
}

interface Entry {
    key: string
    state: 'pending' | 'shrunk' | 'original'
    removed: boolean
    refs: Set<HolderState>
    tick: number
    cost: number
    controller: AbortController | null
    listeners: Set<(live: boolean) => void>
    url: string
    width: number
    height: number
}

interface HolderState {
    held: Set<Entry>
    disposed: boolean
}

export function createPortraitCache(deps: PortraitCacheDeps, limits: PortraitCacheLimits = {}): PortraitCache {
    const maxBytes = limits.maxBytes ?? PORTRAIT_CACHE_MAX_BYTES
    const maxEntries = limits.maxEntries ?? PORTRAIT_CACHE_MAX_ENTRIES
    const map = new Map<string, Entry>()
    let total = 0
    let tickCounter = 0
    let cacheDisposed = false

    function remove(entry: Entry): void {
        if (entry.removed) return
        entry.removed = true
        if (map.get(entry.key) === entry) map.delete(entry.key)
        for (const holder of entry.refs) holder.held.delete(entry)
        entry.refs.clear()
        if (entry.state === 'pending') {
            entry.controller?.abort()
            const listeners = [...entry.listeners]
            entry.listeners.clear()
            for (const listener of listeners) listener(false)
            return
        }
        total -= entry.cost
        if (entry.state === 'shrunk') deps.revoke(entry.url)
    }

    function trim(): void {
        while (total > maxBytes || map.size > maxEntries) {
            let victim: Entry | null = null
            for (const entry of map.values()) {
                if (entry.state === 'pending' || entry.refs.size > 0) continue
                if (victim === null || entry.tick < victim.tick) victim = entry
            }
            if (victim === null) return
            remove(victim)
        }
    }

    function settle(entry: Entry, outcome: ShrinkOutcome): void {
        if (entry.removed) {
            if (outcome.kind === 'shrunk') deps.revoke(outcome.url)
            return
        }
        if (outcome.kind === 'cancelled') {
            remove(entry)
            return
        }
        if (outcome.kind === 'shrunk') {
            entry.state = 'shrunk'
            entry.url = outcome.url
            entry.width = outcome.width
            entry.height = outcome.height
            entry.cost = outcome.bytes + 2 * entry.key.length
        } else {
            entry.state = 'original'
            entry.cost = 2 * entry.key.length
        }
        entry.controller = null
        total += entry.cost
        const listeners = [...entry.listeners]
        entry.listeners.clear()
        for (const listener of listeners) listener(true)
        trim()
    }

    function release(holder: HolderState, entry: Entry): void {
        if (!holder.held.has(entry)) return
        holder.held.delete(entry)
        entry.refs.delete(holder)
        if (entry.refs.size > 0) return
        if (entry.state === 'pending') {
            remove(entry)
        } else {
            entry.tick = ++tickCounter
        }
    }

    function reference(holder: HolderState, entry: Entry): void {
        holder.held.add(entry)
        entry.refs.add(holder)
        entry.tick = ++tickCounter
    }

    function create(key: string): Entry {
        const entry: Entry = {
            key,
            state: 'pending',
            removed: false,
            refs: new Set(),
            tick: 0,
            cost: 0,
            controller: new AbortController(),
            listeners: new Set(),
            url: '',
            width: 0,
            height: 0,
        }
        map.set(key, entry)
        return entry
    }

    function startJob(entry: Entry, original: string, maxSide: number): void {
        let job: Promise<ShrinkOutcome>
        try {
            job = deps.shrink(original, maxSide, (entry.controller as AbortController).signal)
        } catch (error) {
            job = Promise.reject(error)
        }
        // The handlers close over this entry, never over its key.
        job.then(
            (outcome) => settle(entry, outcome),
            () => settle(entry, { kind: 'original' }),
        )
    }

    function dropExcept(holder: HolderState, keepKeys: Set<string>): void {
        for (const entry of [...holder.held]) {
            if (!keepKeys.has(entry.key)) release(holder, entry)
        }
    }

    function keysOf(keep: DisplayImage[]): Set<string> {
        const keys = new Set<string>()
        for (const image of keep) {
            if (image.key !== undefined) keys.add(image.key)
        }
        return keys
    }

    function plainImages(originals: string[]): DisplayImage[] {
        return originals.map((src) => ({ src }))
    }

    return {
        createHolder(): PortraitHolder {
            const holder: HolderState = { held: new Set(), disposed: false }
            return {
                request(originals, maxSide, keep) {
                    if (cacheDisposed || holder.disposed) return Promise.resolve(plainImages(originals))
                    const used: (Entry | null)[] = []
                    const added = new Set<string>()
                    for (const original of originals) {
                        if (original === '') {
                            used.push(null)
                            continue
                        }
                        const key = `${maxSide}|${original}`
                        let entry = map.get(key)
                        if (entry === undefined) {
                            entry = create(key)
                            reference(holder, entry)
                            startJob(entry, original, maxSide)
                        } else {
                            reference(holder, entry)
                        }
                        added.add(key)
                        used.push(entry)
                    }
                    const keepKeys = keysOf(keep)
                    for (const key of added) keepKeys.add(key)
                    dropExcept(holder, keepKeys)
                    return resolveImages(originals, used)
                },
                retain(keep) {
                    dropExcept(holder, keysOf(keep))
                    trim()
                },
                dispose() {
                    dropExcept(holder, new Set())
                    trim()
                    holder.disposed = true
                },
            }
        },
        snapshotForTest() {
            return {
                entries: [...map.values()].map((entry) => ({ key: entry.key, state: entry.state, refs: entry.refs.size, cost: entry.cost })),
                total,
            }
        },
        dispose() {
            for (const entry of [...map.values()]) remove(entry)
            cacheDisposed = true
        },
    }
}

async function resolveImages(originals: string[], used: (Entry | null)[]): Promise<DisplayImage[] | null> {
    const waits: Promise<boolean>[] = []
    for (const entry of new Set(used)) {
        if (entry !== null && entry.state === 'pending') {
            waits.push(new Promise<boolean>((resolve) => entry.listeners.add(resolve)))
        }
    }
    const live = await Promise.all(waits)
    if (live.some((ok) => !ok) || used.some((entry) => entry !== null && entry.removed)) return null
    return originals.map((original, index) => {
        const entry = used[index]
        if (entry === null) return { src: original }
        if (entry.state === 'shrunk') return { src: entry.url, width: entry.width, height: entry.height, key: entry.key }
        return { src: original, key: entry.key }
    })
}

let singleton: PortraitCache | null = null

export function portraitCache(): PortraitCache {
    if (singleton === null) {
        singleton = createPortraitCache({
            shrink: (src, maxSide, signal) => shrinkPortrait(src, maxSide, signal),
            revoke: (url) => revokePortraitUrl(url),
        })
    }
    return singleton
}

/** Test seam: revokes and forgets every entry of the singleton; the next `portraitCache()` is a new cache. */
export function resetPortraitCacheForTest(): void {
    singleton?.dispose()
    singleton = null
}
