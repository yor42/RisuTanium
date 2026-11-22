import { isModuleStub } from '../storage/moduleStub'
import { ASSET_RETAINED_KEY } from '../studio/assets/assetOwnerKeys'
import { isLightEntry } from './lightCharacters'

/**
 * Keeps the live retained-paths field across a plugin write, as `keepLiveAlt` keeps live alternatives. A plugin holds a
 * copy of an owner taken at read time, so its copy can lack the field or hold an older value; the write must not make
 * the live owner forget a file its history can still restore.
 *
 * Value rule: an incoming owner that continues a live owner takes the live value, whatever it holds. When the live owner
 * has the field the incoming owner gets that value (by reference); when it lacks the field the incoming owner loses the
 * key. Exceptions, which keep the incoming value untouched:
 * - the matched live owner is a module stub (the marker decides, and no body key is read from the stub) and the caller
 *   knows no stored value for it: a stub holds no value, and a plugin copy took its value from the loaded body. With a
 *   `sourceOfStub` answer, the stub's recorded stored value is the live value;
 * - the incoming owner is itself a module stub (it is never changed);
 * - the incoming owner continues no live owner (a new id, or an id either list holds more than once), so there is no
 *   live value to prefer; the field then errs toward keeping more;
 * - the incoming owner is not a plain object, or is a light character entry (it is swapped for its live holder later).
 *
 * Accepted limitation: a plugin module object that lacks the field, written over an unloaded (stub) slot whose stored
 * value this page has not read, or whose unit has moved since it was read, carries nothing. A later sweep may then
 * delete files that module's history names, and Undo takes the file-gone path.
 *
 * Match rule, the one `keepLiveAlt` uses: an incoming owner continues the live owner at the same index with the same id,
 * otherwise the live owner with its id when each list holds that id exactly once.
 */

type IdKey = 'chaId' | 'id'

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false
    }
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

function idOf(value: unknown, idKey: IdKey): string | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined
    }
    const id = Reflect.get(value, idKey)
    return typeof id === 'string' ? id : undefined
}

function countOf(counts: Map<string, number>, id: string): number {
    return counts.get(id) ?? 0
}

/** The live owner each incoming owner continues, by the match rule; undefined where it continues none. */
function liveOwnersFor(live: readonly unknown[], incoming: readonly unknown[], idKey: IdKey): (object | undefined)[] {
    const liveIds = live.map((owner) => idOf(owner, idKey))
    const liveCounts = new Map<string, number>()
    const liveUnique = new Map<string, number>()
    liveIds.forEach((id) => {
        if (id !== undefined) {
            liveCounts.set(id, countOf(liveCounts, id) + 1)
        }
    })
    liveIds.forEach((id, index) => {
        if (id !== undefined && countOf(liveCounts, id) === 1) {
            liveUnique.set(id, index)
        }
    })
    const incomingCounts = new Map<string, number>()
    for (const owner of incoming) {
        const id = idOf(owner, idKey)
        if (id !== undefined) {
            incomingCounts.set(id, countOf(incomingCounts, id) + 1)
        }
    }
    return incoming.map((owner, index) => {
        const id = idOf(owner, idKey)
        if (id === undefined) {
            return undefined
        }
        const liveIndex = liveIds[index] === id
            ? index
            : countOf(incomingCounts, id) === 1 ? liveUnique.get(id) : undefined
        const match: unknown = liveIndex === undefined ? undefined : live[liveIndex]
        return typeof match === 'object' && match !== null && !Array.isArray(match) ? match : undefined
    })
}

/** Whether `owner` is an incoming owner the carry may touch. */
function isCarryTarget(owner: unknown, idKey: IdKey): owner is Record<string, unknown> {
    return isPlainObject(owner) && !(idKey === 'chaId' && isLightEntry(owner))
}

/**
 * The object to carry from: the live owner, or for a module stub whatever `sourceOfStub` answers for it (nothing without
 * a callback). Null for no live owner and for the incoming object itself.
 */
function carrySource(liveOwner: object | undefined, owner: object, sourceOfStub?: (stub: object) => object | null): object | null {
    if (liveOwner === undefined || liveOwner === owner) {
        return null
    }
    if (isModuleStub(liveOwner)) {
        return sourceOfStub?.(liveOwner) ?? null
    }
    return liveOwner
}

/**
 * Sets the retained field of every incoming character that continues a live character to the live value, or removes it
 * when the live character has none. The incoming characters are the plugin's own copies, handed to this write, and are
 * changed in place, as `keepLiveAlt` changes its input.
 */
export function keepLiveRetained(liveCharacters: readonly unknown[] | undefined, incomingCharacters: unknown, idKey: IdKey): void {
    if (!Array.isArray(incomingCharacters)) {
        return
    }
    const matches = liveOwnersFor(liveCharacters ?? [], incomingCharacters, idKey)
    incomingCharacters.forEach((owner: unknown, index) => {
        if (!isCarryTarget(owner, idKey)) {
            return
        }
        const source = carrySource(matches[index], owner)
        if (source === null) {
            return
        }
        if (Object.hasOwn(source, ASSET_RETAINED_KEY)) {
            owner[ASSET_RETAINED_KEY] = Reflect.get(source, ASSET_RETAINED_KEY)
        } else {
            delete owner[ASSET_RETAINED_KEY]
        }
    })
}

/**
 * The module list a plugin write installs, with the retained field carried from the live modules. The incoming value is
 * returned as it is when it is not an array, when it is the live array itself, or when no module's field changes.
 * Otherwise it returns a new array in which each changed module is a shallow copy; the plugin's own objects are never
 * mutated.
 */
export function withLiveRetained<T>(liveModules: readonly unknown[] | undefined, incoming: T, idKey: IdKey, sourceOfStub?: (stub: object) => object | null): T {
    if (!Array.isArray(incoming) || incoming === liveModules) {
        return incoming
    }
    const list: readonly unknown[] = incoming
    const matches = liveOwnersFor(liveModules ?? [], list, idKey)
    let changed: unknown[] | null = null
    for (let index = 0; index < list.length; index++) {
        const owner = list[index]
        if (!isCarryTarget(owner, idKey) || isModuleStub(owner)) {
            continue
        }
        const source = carrySource(matches[index], owner, sourceOfStub)
        if (source === null) {
            continue
        }
        const liveHas = Object.hasOwn(source, ASSET_RETAINED_KEY)
        const liveValue = liveHas ? Reflect.get(source, ASSET_RETAINED_KEY) : undefined
        const ownerHas = Object.hasOwn(owner, ASSET_RETAINED_KEY)
        if (liveHas ? ownerHas && owner[ASSET_RETAINED_KEY] === liveValue : !ownerHas) {
            continue
        }
        const copy = { ...owner }
        if (liveHas) {
            copy[ASSET_RETAINED_KEY] = liveValue
        } else {
            delete copy[ASSET_RETAINED_KEY]
        }
        changed ??= list.slice()
        changed[index] = copy
    }
    return changed === null ? incoming : changed as T
}
