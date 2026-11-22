import type { RisuModule } from '../process/modules'
import { isModuleStub } from '../storage/moduleStub'
import { keyOfRef, type ModuleEntry } from '../storage/store2/format'
import { slotIsRecordedStub } from '../storage/store2/moduleStubMatch'
import { getResidency } from '../storage/store2/residencyActive'
import type { Residency } from '../storage/store2/residency'
import { ASSET_RETAINED_KEY } from '../studio/assets/assetOwnerKeys'

/**
 * What a plugin write may say about a module that is a stub in the live list.
 *
 * Retained paths: a stub holds no value, but a module read from its stored unit does, and `noteStoredRetained` records
 * that value against the unit it came from. While the module's entry still names that unit, the recorded value is the
 * live value of the stub, so a plugin write carries it as it carries the value of a resident module. A unit that has
 * moved, or a module this page never read, has no recorded value and carries nothing.
 *
 * Keeping the stub: a plugin that read a module and writes it back unchanged hands this write a full copy. When the live
 * slot is the recorded stub of the module and the copy is exactly what the stored unit and lists would be reused for, the
 * copy is replaced by the live stub, so nothing of the module is rewritten and it stays unloaded.
 *
 * This module is shared by `plugins.svelte.ts` (the write) and `apiV3/moduleStubCopy.svelte.ts` (the read) and imports neither.
 */

interface StoredRetained {
    unitKey: string
    present: boolean
    value: unknown
}

const records = new WeakMap<Residency, Map<string, StoredRetained>>()

/** Records the retained-paths field of the stored body `body` read for module `id` from the unit `entry` names. */
export function noteStoredRetained(residency: Residency, id: string, entry: ModuleEntry, body: object): void {
    const present = Object.hasOwn(body, ASSET_RETAINED_KEY)
    const held: StoredRetained = {
        unitKey: keyOfRef(entry.unit),
        present,
        value: present ? structuredClone(Reflect.get(body, ASSET_RETAINED_KEY)) : undefined,
    }
    let ids = records.get(residency)
    if (ids === undefined) {
        ids = new Map()
        records.set(residency, ids)
    }
    ids.set(id, held)
}

function idOf(module: unknown): string | undefined {
    if (typeof module !== 'object' || module === null || Array.isArray(module)) {
        return undefined
    }
    const id = Reflect.get(module, 'id')
    return typeof id === 'string' ? id : undefined
}

/**
 * The object a plugin write carries the retained field from for the live stub `stub`: a fresh object holding a fresh copy
 * of the recorded value, or lacking the key when the stored body lacked it. Null when no value was recorded for the unit
 * the stub's module names now.
 */
export function retainedSourceOfStub(stub: object): object | null {
    const residency = getResidency()
    const id = idOf(stub)
    if (residency === null || id === undefined) {
        return null
    }
    const held = records.get(residency)?.get(id)
    const entry = residency.moduleEntryOf(`${id}#0`)
    if (held === undefined || entry === null || keyOfRef(entry.unit) !== held.unitKey) {
        return null
    }
    const source: Record<string, unknown> = {}
    if (held.present) {
        source[ASSET_RETAINED_KEY] = structuredClone(held.value)
    }
    return source
}

function countIds(list: readonly unknown[]): Map<string, number> {
    const counts = new Map<string, number>()
    for (const module of list) {
        const id = idOf(module)
        if (id !== undefined) {
            counts.set(id, (counts.get(id) ?? 0) + 1)
        }
    }
    return counts
}

/** Whether `live` is the recorded stub of module `id` and `module` would reuse everything that stub stands for; never throws. */
function keepsStub(residency: Residency, id: string, live: unknown, module: unknown): boolean {
    try {
        const handle = `${id}#0`
        const entry = residency.moduleEntryOf(handle)
        return entry !== null && isModuleStub(live) && slotIsRecordedStub(live, entry) && residency.moduleIsStored(handle, module)
    } catch {
        return false
    }
}

/**
 * The module list a plugin write installs, with each module that is an unchanged copy of a live recorded stub replaced
 * by that stub. The incoming value is returned as it is when it is not an array, when it is the live array itself, when
 * no live slot is a stub or when no residency exists; otherwise a changed list is a new array and the plugin's own
 * objects are never mutated. A resident slot is never turned into a stub.
 */
export function withRecordedStubs<T>(live: readonly RisuModule[] | undefined, incoming: T): T {
    if (!Array.isArray(incoming) || incoming === live || live === undefined || !live.some(isModuleStub)) {
        return incoming
    }
    const residency = getResidency()
    if (residency === null) {
        return incoming
    }
    const list: readonly unknown[] = incoming
    const liveCounts = countIds(live)
    const incomingCounts = countIds(list)
    let changed: unknown[] | null = null
    list.forEach((module, index) => {
        const id = idOf(module)
        if (id === undefined || isModuleStub(module) || liveCounts.get(id) !== 1 || incomingCounts.get(id) !== 1) {
            return
        }
        const holder = live.find((candidate) => idOf(candidate) === id)
        if (holder !== undefined && keepsStub(residency, id, holder, module)) {
            changed ??= list.slice()
            changed[index] = holder
        }
    })
    return changed === null ? incoming : changed as T
}
