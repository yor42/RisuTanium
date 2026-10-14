import type { JsonObject } from '../../blockFrame'
import { carryUnknownFields, KNOWN_FIELDS, type ModuleEntry, type ModuleIndex } from '../format'
import type { ModuleBody } from './bodies'
import { CodecAssembleError } from './types'

/**
 * Modules: one unit each (type 9), plus the module index (type 10) that lists
 * them with the few fields a module list shows without reading the units.
 */

/** The module as the unit holds it: the whole object, so a field the build does not know travels with it. */
export function storedModule(module: JsonObject): JsonObject {
    return module
}

export function moduleBodyOf(module: JsonObject): ModuleBody {
    return { v: 1, module: storedModule(module) }
}

/** The index entry fields of a module, projected from the stored object; the unit stays authoritative. */
export function moduleEntryFields(module: JsonObject): Omit<ModuleEntry, 'unit' | 'al' | 'il'> {
    const entry: Omit<ModuleEntry, 'unit' | 'al' | 'il'> = {
        id: typeof module.id === 'string' ? module.id : '',
        name: typeof module.name === 'string' ? module.name : '',
        description: typeof module.description === 'string' ? module.description : '',
        hasToggle: Boolean(module.customModuleToggle),
        // Whether the module needs display scripts is not traced yet; unsure means true.
        dsp: true,
    }
    if (typeof module.namespace === 'string') {
        entry.namespace = module.namespace
    }
    if (typeof module.icon === 'string') {
        entry.icon = module.icon
    }
    if (typeof module.hideIcon === 'boolean') {
        entry.hideIcon = module.hideIcon
    }
    if (typeof module.lowLevelAccess === 'boolean') {
        entry.lowLevelAccess = module.lowLevelAccess
    }
    return entry
}

/** Module handle: the id, told apart from a repeated id by occurrence (the same handle the units are named by). */
function moduleHandles(entries: readonly ModuleEntry[]): string[] {
    const seen = new Map<string, number>()
    return entries.map((entry) => {
        const occurrence = seen.get(entry.id) ?? 0
        seen.set(entry.id, occurrence + 1)
        return `${entry.id}#${occurrence}`
    })
}

/** The handles of entries whose id is non-empty, does not start with `~` (the positional-handle prefix) and is held by exactly one entry of `entries`. */
function uniqueIdHandles(entries: readonly ModuleEntry[]): Set<string> {
    const counts = new Map<string, number>()
    for (const entry of entries) {
        counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1)
    }
    const handles = moduleHandles(entries)
    return new Set(handles.filter((_, index) => entries[index].id.length > 0 && !entries[index].id.startsWith('~') && counts.get(entries[index].id) === 1))
}

/**
 * `next` with the fields of the previous module index this build does not know,
 * at the top level and on each entry. An entry is matched by module handle and
 * carries only when its id is non-empty and unique in both indexes: a repeated
 * or empty id is told apart by occurrence only, and deleting one holder would
 * move the field onto another module, so a lost field is preferred. An entry the
 * previous index lacks carries nothing.
 */
export function carryModuleIndex(prev: ModuleIndex | undefined, next: ModuleIndex): ModuleIndex {
    if (prev === undefined) {
        return next
    }
    carryUnknownFields(prev, next, KNOWN_FIELDS.moduleIndex)
    const before = new Map(moduleHandles(prev.entries).map((handle, index) => [handle, prev.entries[index]]))
    const stablePrevious = uniqueIdHandles(prev.entries)
    const stableNext = uniqueIdHandles(next.entries)
    moduleHandles(next.entries).forEach((handle, index) => {
        const earlier = before.get(handle)
        if (earlier !== undefined && stablePrevious.has(handle) && stableNext.has(handle)) {
            carryUnknownFields(earlier, next.entries[index], KNOWN_FIELDS.moduleEntry)
        }
    })
    return next
}

/** The modules in index order, from the module units `read` returns. */
export function assembleModules(index: ModuleIndex, read: (entry: ModuleEntry) => JsonObject): JsonObject[] {
    return index.entries.map((entry) => {
        const module = read(entry)
        if (typeof module !== 'object' || module === null || Array.isArray(module)) {
            throw new CodecAssembleError(`Module ${entry.id} is not an object.`)
        }
        return module
    })
}
