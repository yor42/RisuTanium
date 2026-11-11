import { fingerprintElement, type ElementHash } from './listFingerprint'

export interface ElementHashCacheLimits {
    maxUnits: number
    maxEntries: number
    maxEntryUnits: number
}

export const ELEMENT_HASH_CACHE_LIMITS: ElementHashCacheLimits = {
    maxUnits: 2_500_000,
    maxEntries: 32_768,
    maxEntryUnits: 1_250_000,
}

export interface ElementHashCache {
    // Outside any pass: a hit returns the stored value; a miss is stored only when it fits as it is.
    // Nothing is evicted outside a pass.
    hash: ElementHash
    // Starts a pass over `list` and returns its element hash. `scope` names whose list it is (the
    // character); the cache holds one scope, so a pass for another scope starts from an empty cache.
    // A list larger than the cache's unit or entry limit gets a lookup that never stores.
    forList(list: readonly unknown[], scope: string): ElementHash
    // `sweeps` counts sweeps since the cache was created.
    stats(): { entries: number; units: number; sweeps: number }
}

interface Entry {
    hash: number
    // The last pass that read or stored the entry; OUTSIDE_PASS if none did.
    seen: number
}

const OUTSIDE_PASS = 0

// One Map from text to its hash and the last pass that met it. A store that does not fit sweeps, at most
// once per pass: the sweep deletes every entry met in neither the current nor the previous pass, so the
// texts of the list being hashed and of the list hashed just before it are never the ones dropped. If the
// text still does not fit, it is not stored, and for the rest of that pass a text is stored only if it
// fits as it is. So the work of a pass is its own lookups plus at most one walk over the entries held, and
// a list that fits the limits, each of its texts within the per-entry limit, is held whole after two
// consecutive passes over it. The cache holds the texts of one scope (the open card, MC-1453): a pass
// for another scope replaces the Map with an empty one first, so that pass sweeps nothing while its list
// fits.
export function createElementHashCache(limits: ElementHashCacheLimits = ELEMENT_HASH_CACHE_LIMITS): ElementHashCache {
    let entries = new Map<string, Entry>()
    let units = 0
    // The current pass. It starts two above OUTSIDE_PASS, so an entry no pass met is never in the
    // current or the previous pass.
    let pass = OUTSIDE_PASS + 2
    let sweptPass = OUTSIDE_PASS
    let sweeps = 0
    let held: string | undefined = undefined

    function fits(length: number): boolean {
        return units + length <= limits.maxUnits && entries.size + 1 <= limits.maxEntries
    }

    function storeInPass(value: string, hashed: number): void {
        if (value.length > limits.maxEntryUnits) {
            return
        }
        if (!fits(value.length)) {
            if (sweptPass === pass) {
                return
            }
            sweptPass = pass
            sweeps += 1
            for (const [text, entry] of entries) {
                if (entry.seen < pass - 1) {
                    entries.delete(text)
                    units -= text.length
                }
            }
            if (!fits(value.length)) {
                return
            }
        }
        entries.set(value, { hash: hashed, seen: pass })
        units += value.length
    }

    const hash: ElementHash = (value) => {
        if (typeof value !== 'string') {
            return fingerprintElement(value)
        }
        const known = entries.get(value)
        if (known !== undefined) {
            return known.hash
        }
        const hashed = fingerprintElement(value)
        if (value.length <= limits.maxEntryUnits && fits(value.length)) {
            entries.set(value, { hash: hashed, seen: OUTSIDE_PASS })
            units += value.length
        }
        return hashed
    }

    const inPass: ElementHash = (value) => {
        if (typeof value !== 'string') {
            return fingerprintElement(value)
        }
        const known = entries.get(value)
        if (known !== undefined) {
            known.seen = pass
            return known.hash
        }
        const hashed = fingerprintElement(value)
        storeInPass(value, hashed)
        return hashed
    }

    const lookupOnly: ElementHash = (value) => {
        if (typeof value !== 'string') {
            return fingerprintElement(value)
        }
        const known = entries.get(value)
        if (known !== undefined) {
            known.seen = pass
            return known.hash
        }
        return fingerprintElement(value)
    }

    return {
        hash,
        forList(list, scope) {
            // Another card's pass starts from an empty cache (no per-entry work).
            if (scope !== held) {
                held = scope
                entries = new Map<string, Entry>()
                units = 0
            }
            pass += 1
            if (list.length > limits.maxEntries) {
                return lookupOnly
            }
            let total = 0
            for (let i = 0; i < list.length; i++) {
                const value = list[i]
                if (typeof value === 'string') {
                    total += value.length
                    if (total > limits.maxUnits) {
                        return lookupOnly
                    }
                }
            }
            return inPass
        },
        stats() {
            return { entries: entries.size, units, sweeps }
        },
    }
}

// One idle period: `remainingMs` reads the time left in it.
export type IdleScheduler = (run: (remainingMs: () => number) => void) => () => void

export function browserIdleScheduler(): IdleScheduler | undefined {
    if (typeof requestIdleCallback !== 'function' || typeof cancelIdleCallback !== 'function') {
        return undefined
    }
    return (run) => {
        const handle = requestIdleCallback((deadline) => run(() => deadline.timeRemaining()))
        return () => cancelIdleCallback(handle)
    }
}

// Estimated cost of warming one element on a slow phone core after an idle: per UTF-16 unit hashed
// (Note 9: 50-112 ns) plus a fixed cost per element for the lookup and the store.
export const WARM_MS_PER_UNIT = 120e-6
export const WARM_MS_PER_ELEMENT = 0.03
// The most one idle callback spends warming: half a 60 Hz frame, so a tap that arrives during a
// chunk waits at most this long plus one element's estimate error.
export const WARM_CHUNK_MS = 8
export const WARM_MAX_YIELDS = 3
