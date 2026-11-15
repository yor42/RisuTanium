/**
 * Compare-and-keep for a plugin's whole-list write of `characters`: an incoming element that stores as the live element
 * at the same slot (`sameStoredValue`) is replaced by the live proxy, so the setter can leave that slot unmarked and
 * the next store2 pass does not read or encode it.
 *
 * Invariants:
 * - Strict: `sameStoredValue` answers "equal" only when installing the incoming element would give the same stored
 *   units and the same raw reads of the encoder. Anything not plain (Date, boxed values, class instances, own
 *   `toJSON`, functions, symbols, bigints, nesting past the depth cap) is different. A wrong "different" over-marks
 *   and costs time; a wrong "equal" drops the plugin's write, so every doubt answers "different".
 * - Undefined against absent: inside a plain object, an own enumerable key whose value is exactly `undefined` on one
 *   side is the same as that key being absent on the other, because the encoder drops such a key (`toPlainJson`), and
 *   every raw read the encoder makes of a live slot is by value (`chaId`, `type`, `coldstorage`, `lastInteraction`,
 *   `trashTime` and the stub overlay fields `name`, `creatorNotes`, `image`, `characters`, `tags`, `creator` and
 *   `additionalData.creator`, read by the scoped overlay check and the stub tag and creator helpers). This is the
 *   only widening of the encoder's normalisations. An `undefined` array item against `null`, `-0` against `0`, `NaN`
 *   or an infinity against `null`, and a function- or symbol-valued key against an absent one stay different, so a kept
 *   live proxy never reads differently by value from what the plugin wrote. A kept proxy may still hold
 *   `key: undefined` where the plugin's element had no key, or the reverse; only `in`, `hasOwn` and key enumeration
 *   can tell these apart, and no stored unit differs.
 * - Aliasing: an object reachable from both trees by the same reference compares equal. This holds for the live
 *   `alt` that `keepLiveAlt` places into the incoming chats. It assumes every transform of the incoming list has
 *   finished before the compare. An incoming element that is not itself a live element but shares nested live
 *   objects is outside the guarantee: a transform that wrote through the shared reference would already have
 *   changed live, and the compare would report equal. No production caller builds such input (the only caller is
 *   the V3 bridge, whose arguments are structured clones); tests that call the setter directly must not either.
 * - A slot whose incoming element is itself a live element (`===`, as a light holder or an element of the list
 *   itself) is never kept by the reconcile, and the setter marks it. This is the current conservative behaviour, not a
 *   requirement. The setter separately leaves a swapped-in light holder unmarked when it sits at its own live
 *   position and no transform wrote into it (`cleanHeldSlots` in the setter).
 * - A legacy encoder keys each character block by chaId and never decides the list order by marks, so an unmarked
 *   clean holder changes no legacy block.
 * - The reconcile reads only. It never writes to either list or to any element, so a caller that runs every
 *   per-character transform before it and assigns the returned list afterwards has no write after the keep decision.
 * - Live proxies are read inside `untrack`, and never for a key that is absent from them: the Svelte `get` trap
 *   creates a source for every absent key it is asked about. A key that only the incoming object holds is checked on
 *   the incoming object alone.
 * - Any fault returns `null`, which the caller treats as "keep nothing": the plugin's own list is installed and every
 *   character is marked, as without the reconcile.
 */
import { untrack } from 'svelte'
import { MEASURE } from '../process/memory/measureFlag'

const SWITCH_KEY = 'risu-measure-reconcile'

// Read once, at the first write; null until then.
let switchedOff: boolean | null = null

/**
 * False only in a measurement build whose localStorage `risu-measure-reconcile` says `off`: the setter then keeps
 * nothing and marks every character, as without the reconcile. A normal build is always enabled, and this is not a
 * user setting.
 */
export function reconcileEnabled(): boolean {
    if (!MEASURE) {
        return true
    }
    if (switchedOff === null) {
        try {
            switchedOff = typeof localStorage !== 'undefined' && localStorage.getItem(SWITCH_KEY) === 'off'
        } catch {
            switchedOff = false
        }
    }
    return !switchedOff
}

/** Test-only: forgets the cached switch. */
export function resetReconcileSwitchForTest(): void {
    switchedOff = null
}

/** The deepest nesting compared; a deeper pair counts as different. */
const MAX_DEPTH = 256

/** The list to install and the slots whose element is the live proxy of that slot. */
export interface ReconcileResult<T> {
    characters: T[]
    keptSlots: Set<number>
}

function usableChaId(value: unknown): string | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const chaId = (value as { chaId?: unknown }).chaId
    return typeof chaId === 'string' && chaId !== '' ? chaId : null
}

function sameArray(a: object, b: object, depth: number): boolean {
    if (Object.getPrototypeOf(a) !== Array.prototype || Object.getPrototypeOf(b) !== Array.prototype) {
        return false
    }
    const left = a as readonly unknown[]
    const right = b as readonly unknown[]
    if (left.length !== right.length) {
        return false
    }
    for (let i = 0; i < left.length; i++) {
        if (!sameStoredValue(left[i], right[i], depth + 1)) {
            return false
        }
    }
    return true
}

function plainPrototype(value: object): boolean {
    const proto = Object.getPrototypeOf(value)
    return proto === Object.prototype || proto === null
}

function sameObject(a: object, b: object, depth: number): boolean {
    if (!plainPrototype(a) || !plainPrototype(b) || Object.hasOwn(a, 'toJSON')) {
        return false
    }
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    const setA = new Set(keysA)
    let matched = 0
    for (const key of keysB) {
        if (setA.has(key)) {
            if (!sameStoredValue(left[key], right[key], depth + 1)) {
                return false
            }
            matched++
        } else if (right[key] !== undefined) {
            // The key is one of the live object's own, so this read cannot create a proxy source for an absent key.
            return false
        }
    }
    if (matched < keysA.length) {
        const setB = new Set(keysB)
        for (const key of keysA) {
            // The live object is never asked about a key it does not own.
            if (!setB.has(key) && left[key] !== undefined) {
                return false
            }
        }
    }
    return true
}

/**
 * Whether `a`, the incoming value, would store exactly as `b`, the live value. Only plain data compares equal.
 */
export function sameStoredValue(a: unknown, b: unknown, depth = 0): boolean {
    if (typeof a !== typeof b) {
        return false
    }
    switch (typeof a) {
        case 'string':
        case 'boolean':
            return a === b
        case 'number':
            return Object.is(a, b)
        case 'undefined':
            return true
        case 'object':
            break
        default:
            return false
    }
    if (a === null || b === null) {
        return a === b
    }
    if (a === b) {
        return true
    }
    if (depth >= MAX_DEPTH) {
        return false
    }
    const left = a as object
    const right = b as object
    if (Array.isArray(left) !== Array.isArray(right)) {
        return false
    }
    return Array.isArray(left) ? sameArray(left, right, depth) : sameObject(left, right, depth)
}

function reconcile<T>(live: readonly T[], incoming: readonly T[]): ReconcileResult<T> | null {
    if (incoming === live || live.length !== incoming.length) {
        return null
    }
    for (let i = 0; i < live.length; i++) {
        const liveId = usableChaId(live[i])
        if (liveId === null || !Object.is(liveId, usableChaId(incoming[i]))) {
            return null
        }
    }
    const liveElements = new Set<unknown>(live)
    const characters: T[] = []
    const keptSlots = new Set<number>()
    for (let i = 0; i < incoming.length; i++) {
        const element = incoming[i]
        if (!liveElements.has(element) && sameStoredValue(element, live[i])) {
            characters.push(live[i])
            keptSlots.add(i)
        } else {
            characters.push(element)
        }
    }
    return keptSlots.size === 0 ? null : { characters, keptSlots }
}

/**
 * The list to install for a plugin's write of `incoming` over `live`, with the slots that keep the live proxy.
 * `null` means keep nothing: the caller installs `incoming` and marks every character. That covers the same array, a
 * non-array on either side, a length difference, an unusable or different `chaId` at any slot, no equal element, and
 * any exception.
 */
export function reconcileCharacters<T>(live: readonly T[] | null | undefined, incoming: readonly T[] | null | undefined): ReconcileResult<T> | null {
    if (!Array.isArray(live) || !Array.isArray(incoming)) {
        return null
    }
    try {
        return untrack(() => reconcile<T>(live, incoming))
    } catch {
        return null
    }
}
