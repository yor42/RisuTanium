/**
 * AV-2: a shared
 * Svelte action that reports whether an element is near enough to its
 * scrolling ancestor to resolve its avatar, and far enough away to release
 * it again.
 *
 * `use:nearViewport={{ onChange }}` calls `onChange(true)` once the element
 * comes within one root-height of its scroll root (the "near" band,
 * `rootMargin: '100% 0px'`), and `onChange(false)` once it leaves a wider,
 * three-root-height band (the "far" band, `rootMargin: '300% 0px'`). The gap
 * between the two bands is deliberate hysteresis: an item becomes visible
 * only via the near band, and becomes invisible only via the far band, so it
 * never thrashes right at one edge.
 *
 * Root selection: the nearest ancestor whose COMPUTED `overflow-y` is `auto`
 * or `scroll`, else `null` (the real viewport). This is always a real
 * ancestor of the target, so the observer can never be handed a box that
 * isn't one -- per spec that would simply never report an intersection, and
 * avatars would never load. If the chosen box doesn't actually scroll, every
 * item intersects it immediately and behaviour degrades to "everything
 * resolves", never to "nothing loads".
 *
 * Sharing: one IntersectionObserver per (root, rootMargin) pair, not one per
 * item, keyed by a registry documented on `rootRegistry` below.
 *
 * Test seam: the observer constructor is read from
 * `globalThis.IntersectionObserver` at use time (not imported), so tests can
 * `vi.stubGlobal` a controllable fake before any element ever calls this
 * action. If the global is missing entirely (very old WebViews), every
 * target is treated as immediately, permanently visible -- fail open,
 * today's behaviour.
 */

export const NEAR_MARGIN = '100% 0px'
export const FAR_MARGIN = '300% 0px'

/**
 * `node` is the element THIS action instance is attached to. Callers that
 * key visibility by something other than the element itself (an index, an
 * id shared across several DOM nodes over a session -- see the module doc
 * below on "ownership") need it to resolve the on-unmount ownership hazard: it
 * lets a caller record which element currently "owns" a given key, and
 * only clear that key when the element clearing it still owns it.
 */
export interface NearViewportOptions {
    onChange: (visible: boolean, node: Element) => void
    /**
     * Bands for this action instance, fixed at setup: `update()` swaps only `onChange`. Setup, the failure
     * path and destroy all resolve the same pair, so a custom band's observers are torn down with the node.
     * Omitted, the shared NEAR_MARGIN and FAR_MARGIN apply.
     */
    margins?: { near: string, far: string }
}

interface Entry {
    observer: IntersectionObserver
    targets: Map<Element, (isIntersecting: boolean) => void>
    /** Dev-only, near-band-only: has the oversubscription signal already logged for this root? */
    loggedOversubscription?: boolean
}

/**
 * Registry lifecycle: roots come and go
 * (a dialog's own `overflow-y-auto` box is a fresh element every time it
 * opens), so nothing here may pin a detached root alive. Keying live roots
 * in a `WeakMap` lets a detached root, and everything hung off it in this
 * module, be collected once nothing else references it. `null` (the real
 * viewport) can't be a `WeakMap` key, so it gets one separate slot instead.
 *
 * On an action's destroy: `unobserve` and delete the target from its entry.
 * When an entry's target map empties, `disconnect()` it and delete the entry
 * itself, and once a root's whole margin-map is empty, delete that too (or,
 * for the null-root slot, null it out).
 */
const rootRegistry = new WeakMap<Element, Map<string, Entry>>()
let nullRootRegistry: Map<string, Entry> | null = null

function getOrCreateRootMap(root: Element | null): Map<string, Entry> {
    if (root === null) {
        if (!nullRootRegistry) {
            nullRootRegistry = new Map()
        }
        return nullRootRegistry
    }
    let map = rootRegistry.get(root)
    if (!map) {
        map = new Map()
        rootRegistry.set(root, map)
    }
    return map
}

function getExistingRootMap(root: Element | null): Map<string, Entry> | undefined {
    return root === null ? (nullRootRegistry ?? undefined) : rootRegistry.get(root)
}

function deleteRootMapIfEmpty(root: Element | null, map: Map<string, Entry>): void {
    if (map.size > 0) {
        return
    }
    if (root === null) {
        nullRootRegistry = null
    } else {
        rootRegistry.delete(root)
    }
}

function findScrollRoot(node: Element): Element | null {
    let ancestor = node.parentElement
    while (ancestor) {
        const overflowY = getComputedStyle(ancestor).overflowY
        if (overflowY === 'auto' || overflowY === 'scroll') {
            return ancestor
        }
        ancestor = ancestor.parentElement
    }
    return null
}

function getOrCreateEntry(root: Element | null, margin: string, IO: typeof IntersectionObserver): Entry {
    const map = getOrCreateRootMap(root)
    let entry = map.get(margin)
    if (!entry) {
        const targets = new Map<Element, (isIntersecting: boolean) => void>()
        const observer = new IO(
            (records) => {
                for (const record of records) {
                    const callback = targets.get(record.target)
                    callback?.(record.isIntersecting)
                }
                if (margin === NEAR_MARGIN) {
                    checkOversubscription(root, entry!, records)
                }
            },
            { root, rootMargin: margin },
        )
        entry = { observer, targets }
        map.set(margin, entry)
    }
    return entry
}

/**
 * Removes `node` from the (root, margin) entry, if any, and tears the entry
 * down once nothing observes it anymore. Safe to call for a target that was
 * never actually added (e.g. a partially-constructed entry left behind by a
 * throw mid-setup, see `nearViewport`'s catch block below): `Map.delete` on
 * an absent key is a no-op, so the size check below still correctly decides
 * whether to disconnect an entry that in fact never held anything.
 *
 * Deliberately defensive:
 * a broken/throwing `unobserve`/`disconnect` on the underlying observer must
 * never stop the registry bookkeeping itself from completing, since this is
 * also the cleanup path used to recover from a construction-time failure.
 */
function removeTarget(root: Element | null, margin: string, node: Element): void {
    const map = getExistingRootMap(root)
    if (!map) {
        return
    }
    const entry = map.get(margin)
    if (!entry) {
        return
    }
    try {
        entry.observer.unobserve(node)
    } catch (error) {
        console.warn('[nearViewport] IntersectionObserver.unobserve threw; continuing cleanup.', error)
    }
    entry.targets.delete(node)
    if (entry.targets.size === 0) {
        try {
            entry.observer.disconnect()
        } catch (error) {
            console.warn('[nearViewport] IntersectionObserver.disconnect threw; continuing cleanup.', error)
        }
        map.delete(margin)
        deleteRootMapIfEmpty(root, map)
    }
}

/**
 * Accepted-gap mitigation: happy-dom has no layout, so
 * there is no automated guard that the chosen root actually clips its
 * items. As a cheap, dev-only signal, log once per root when more than
 * three root-heights' worth of targets are simultaneously intersecting at
 * mount -- a sign the root isn't clipping the way this design assumes.
 */
function checkOversubscription(root: Element | null, entry: Entry, records: IntersectionObserverEntry[]): void {
    if (!import.meta.env.DEV || entry.loggedOversubscription) {
        return
    }
    const rootHeight = root ? root.clientHeight : (globalThis.innerHeight ?? 0)
    if (!rootHeight) {
        return
    }
    const intersecting = records.filter((record) => record.isIntersecting)
    if (intersecting.length === 0) {
        return
    }
    const heights = intersecting.map((record) => record.boundingClientRect?.height || 0).filter((height) => height > 0)
    if (heights.length === 0) {
        return
    }
    const avgHeight = heights.reduce((sum, height) => sum + height, 0) / heights.length
    if (avgHeight <= 0) {
        return
    }
    const itemsPerRootHeight = rootHeight / avgHeight
    if (itemsPerRootHeight > 0 && intersecting.length > itemsPerRootHeight * 3) {
        entry.loggedOversubscription = true
        console.warn(
            '[nearViewport] more than 3 root-heights of items intersected at mount; the chosen scroll root may not be clipping.',
            { root, intersectingCount: intersecting.length, rootHeight, avgItemHeight: avgHeight },
        )
    }
}

/**
 * Shared shape for every "this element is just permanently visible" case:
 * no `IntersectionObserver` global at all, and (below) a global that exists
 * but throws while this action tries to use it. Both fail open the same way
 * -- the avatar resolves and stays resolved -- and both
 * still call `onChange(false, node)` on unmount so a caller's ownership map
 * (the on-unmount ownership hazard) doesn't accumulate a stale entry for an
 * element that never actually got observed.
 */
function alwaysVisibleAction(node: Element, initialOnChange: NearViewportOptions['onChange']) {
    let onChange = initialOnChange
    onChange(true, node)
    return {
        update(newOptions: NearViewportOptions) {
            onChange = newOptions.onChange
        },
        destroy() {
            onChange(false, node)
        },
    }
}

export function nearViewport(node: Element, options: NearViewportOptions) {
    const IO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver
    if (!IO) {
        // Fail open: no observer support means every avatar resolves and
        // stays resolved.
        return alwaysVisibleAction(node, options.onChange)
    }

    let onChange = options.onChange
    const nearMargin = options.margins?.near ?? NEAR_MARGIN
    const farMargin = options.margins?.far ?? FAR_MARGIN

    // Fail open: a real but
    // broken/throwing IntersectionObserver -- the constructor, `.observe()`,
    // or (via `findScrollRoot`) even `getComputedStyle` -- must not abort
    // this action's setup uncaught. An uncaught throw here happens inside a
    // Svelte `use:` directive's synchronous initialization, which propagates
    // out of the whole enclosing block's mount, not just this one element:
    // for Sidebar that means the entire sidebar (navigation included) fails
    // to render. So on any failure, undo whatever registry state this call
    // may have partially created, fail open the same way as the missing
    // global, and return the same no-op action shape.
    let root: Element | null = null
    try {
        root = findScrollRoot(node)
        const nearEntry = getOrCreateEntry(root, nearMargin, IO)
        const farEntry = getOrCreateEntry(root, farMargin, IO)

        nearEntry.targets.set(node, (isIntersecting) => {
            if (isIntersecting) {
                onChange(true, node)
            }
        })
        nearEntry.observer.observe(node)

        farEntry.targets.set(node, (isIntersecting) => {
            if (!isIntersecting) {
                onChange(false, node)
            }
        })
        farEntry.observer.observe(node)
    } catch (error) {
        console.warn('[nearViewport] failed to observe an element; falling back to always-visible.', error)
        // `removeTarget` is itself defensive (see its own doc comment) and
        // correctly no-ops for a target/entry that was never actually
        // registered, so calling it unconditionally for both bands is safe
        // and leaves no half-created entry in the registry either way.
        removeTarget(root, nearMargin, node)
        removeTarget(root, farMargin, node)
        return alwaysVisibleAction(node, onChange)
    }

    return {
        update(newOptions: NearViewportOptions) {
            onChange = newOptions.onChange
        },
        destroy() {
            removeTarget(root, nearMargin, node)
            removeTarget(root, farMargin, node)
            // An item must leave its
            // caller's visible-set on unmount, not only via the far band --
            // otherwise a tab switch, a folder closing, or a search that
            // narrows the list leaks that item's key forever, since nothing
            // else ever fires its far-band callback once its own observer
            // entry is torn down. Passing `node` lets the caller implement
            // per-key ownership (only clear a key if the clearing element
            // still owns it), which is what makes this safe regardless of
            // whether this destroy or a same-keyed replacement element's
            // mount runs first within the same reactive flush.
            onChange(false, node)
        },
    }
}
