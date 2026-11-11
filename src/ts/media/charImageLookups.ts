import { onDestroy } from 'svelte'
import { getCharImage } from '../characters'
import type { ThumbAborted } from './avatarThumb'
import { isAndroidTransport } from '../storage/tauriByteTransport'
import { DBState } from '../stores.svelte'

/**
 * Per-consumer holds for display reads of avatar and background images.
 *
 * `getCharImage` waits in the app-wide whole-read queue only when it is given a signal, and the file it
 * reads stays referenced until that signal aborts. A display consumer therefore needs a signal that lives
 * as long as the component, not as long as one call. This helper gives every read position ("slot") one
 * hold on Android and gives it back when the slot gets another key, when `getIf` turns false, or when the
 * lookups are disposed. Off Android every call passes straight through to the two-argument `getCharImage`:
 * same arguments, same count, no memo and no signal.
 *
 * Follow rule: replacing a slot's key aborts the old hold, and the old promise adopts the outcome of the new
 * one (rejection included) unless it has already settled. A consumer that still awaits the old promise
 * therefore ends with the newest image, never with an aborted one. The helper never resolves with
 * `THUMB_ABORTED`; only promises cut off by `dispose` stay pending for good.
 *
 * U1, one owner per slot. A slot name belongs to exactly one read position. The only exception is a slot
 * whose name is its location, or whose location is a pure function of its name at every moment: those
 * sharers always ask the same key and so share one promise. Inside an `{#each}` the slot name carries the
 * each key, which is the index when the block is index-keyed or unkeyed. Two owners with different keys
 * would abort each other's hold and re-paint the loser with the winner's image.
 *
 * U2, release on every branch where the result is written later. A caller that writes the awaited result
 * into state which a newer run neither overwrites nor discards must call the slot on every branch, using
 * `getIf(slot, false, ...)` on the branches that need no image. `{#await}` heads discard a superseded
 * result and are exempt.
 */

type CharImageType = Parameters<typeof getCharImage>[1]

export interface CharImageLookups {
    /** The image for `loc` in this slot; the same promise while the slot keeps its key. */
    get(slot: string, loc: string, type: CharImageType): Promise<string | null>
    /**
     * `get` while `use` is true. When false it releases the slot (the old hold aborts, followers adopt
     * `empty`), makes no `getCharImage` call, and returns `empty` itself.
     */
    getIf(slot: string, use: boolean, loc: string, type: CharImageType, empty: string | null): Promise<string | null> | string | null
    /** Aborts every hold. Promises that have not settled stay pending, and no later call starts a read. */
    dispose(): void
}

interface SlotEntry {
    key: string
    controller: AbortController | null
    promise: Promise<string | null>
    /** Resolves this entry's promise with another outcome; a no-op once the promise has settled or adopted one. */
    adopt(outcome: Promise<string | null>): void
}

// The abort outcome of a read is neither a string nor null; only a resolved image settles a promise of this module.
function isResolvedImage(result: string | null | ThumbAborted): result is string | null {
    return result === null || typeof result === 'string'
}

// Key of the entry that getIf(false) leaves behind; it cannot collide with `hideAllImages|type|loc`.
const RELEASED_KEY = 'released'

/** Creates lookups with no component lifecycle; the owner must call `dispose`. Components use `useCharImageLookups`. */
export function createCharImageLookups(): CharImageLookups {
    const slots = new Map<string, SlotEntry>()
    let disposed = false

    function replace(slot: string, entry: SlotEntry): SlotEntry {
        const old = slots.get(slot)
        slots.set(slot, entry)
        if (old !== undefined) {
            old.controller?.abort()
            old.adopt(entry.promise)
        }
        return entry
    }

    function startEntry(slot: string, key: string, loc: string, type: CharImageType): SlotEntry {
        const controller = new AbortController()
        let resolveEntry!: (value: string | null | Promise<string | null>) => void
        let rejectEntry!: (reason: unknown) => void
        const promise = new Promise<string | null>((resolve, reject) => {
            resolveEntry = resolve
            rejectEntry = reject
        })
        const entry: SlotEntry = { key, controller, promise, adopt: (outcome) => resolveEntry(outcome) }
        // getCharImage for the new key is called before the old hold is aborted, so a shared thumbnail task
        // keeps at least one waiter.
        const lookup = Promise.resolve(getCharImage(loc, type, { signal: controller.signal }))
        replace(slot, entry)
        lookup.then((result) => {
            if (isResolvedImage(result)) {
                resolveEntry(result)
            }
        }, (reason: unknown) => {
            if (slots.get(slot) === entry) {
                slots.delete(slot)
            }
            rejectEntry(reason)
        })
        return entry
    }

    function releasedEntry(slot: string, empty: string | null): SlotEntry {
        const outcome = Promise.resolve(empty)
        return replace(slot, { key: RELEASED_KEY, controller: null, promise: outcome, adopt: () => {} })
    }

    function get(slot: string, loc: string, type: CharImageType): Promise<string | null> {
        if (!isAndroidTransport()) {
            return Promise.resolve(getCharImage(loc, type))
        }
        if (disposed) {
            return new Promise<string | null>(() => {})
        }
        const key = `${DBState.db?.hideAllImages ? 1 : 0}|${type}|${loc}`
        const current = slots.get(slot)
        if (current !== undefined && current.key === key) {
            return current.promise
        }
        return startEntry(slot, key, loc, type).promise
    }

    function getIf(slot: string, use: boolean, loc: string, type: CharImageType, empty: string | null): Promise<string | null> | string | null {
        if (use) {
            return get(slot, loc, type)
        }
        if (isAndroidTransport() && !disposed) {
            const current = slots.get(slot)
            if (current === undefined || current.key !== RELEASED_KEY) {
                releasedEntry(slot, empty)
            }
        }
        return empty
    }

    function dispose(): void {
        disposed = true
        for (const entry of slots.values()) {
            entry.controller?.abort()
        }
        slots.clear()
    }

    return { get, getIf, dispose }
}

/** Creates lookups that are disposed with the calling component. Call it during component initialisation. */
export function useCharImageLookups(): CharImageLookups {
    const lookups = createCharImageLookups()
    onDestroy(lookups.dispose)
    return lookups
}
