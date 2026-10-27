import type { JsonObject } from '../../blockFrame'
import { carryUnknownFields, KNOWN_FIELDS, type ModuleEntry, type ModuleIndex, type Ref } from '../format'
import type { ModuleBody } from './bodies'
import { isModuleStub } from '../../moduleStub'
import { CodecAssembleError, CodecInputError } from './types'

/**
 * Modules: one unit each (type 9), plus the module index (type 10) that lists
 * them with the few fields a module list shows without reading the units.
 */

/** The module as the unit holds it: the whole object, so a field the build does not know travels with it. */
export function storedModule(module: JsonObject): JsonObject {
    return module
}

/**
 * A module holding the stub marker is never a unit body: a real stub stands for a module this pass has no body for, and
 * a foreign module that holds the marker key cannot be told apart from one. A pass with a previous module index carries
 * or refuses a stub with a `StubRefusedError` before reaching this body path; here it is refused with a `CodecInputError`
 * when there is no previous index at all (convert, import, first encode), where no entry can stand for the stub. The
 * message is a noun phrase that reads correctly for both, inside "cannot be saved as it is".
 */
export function moduleBodyOf(module: JsonObject): ModuleBody {
    if (isModuleStub(module)) {
        const id = typeof module.id === 'string' ? module.id : ''
        const name = typeof module.name === 'string' ? module.name : ''
        throw new CodecInputError(`the module "${name}" (${id}) with the module stub marker`)
    }
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
    if (typeof module.mcp === 'object' && module.mcp !== null) {
        entry.mcp = true
    }
    return entry
}

/**
 * The entry-fields version this build writes: the fourth element of an entry's `unit` Ref. Every field
 * `moduleEntryFields` derives must be listed in `KNOWN_FIELDS.moduleEntry`, otherwise `carryModuleIndex` would carry a
 * stale previous value under this version. A later derived field bumps the version, and a reader accepts only its own.
 * It is the only element a module entry `unit` Ref carries beyond the three of a plain Ref: the rekey recognises a Ref
 * of three or four elements only.
 */
export const ENTRY_FIELDS_VERSION = 1

/** Whether the derived fields of `entry` were computed by a build that knows this entry-fields version. Any other value, or no fourth element, reads as no tag. */
export function hasCurrentEntryFields(entry: Pick<ModuleEntry, 'unit'>): boolean {
    return entry.unit[3] === ENTRY_FIELDS_VERSION
}

/** A module entry `unit` Ref: the three elements of the unit's Ref plus the entry-fields version. */
export function taggedUnitRef(ref: Ref): Ref {
    return [ref[0], ref[1], ref[2], ENTRY_FIELDS_VERSION]
}

/** Module handle: the id, told apart from a repeated id by occurrence (the same handle the units are named by). */
export function moduleHandles(entries: readonly Pick<ModuleEntry, 'id'>[]): string[] {
    const seen = new Map<string, number>()
    return entries.map((entry) => {
        const occurrence = seen.get(entry.id) ?? 0
        seen.set(entry.id, occurrence + 1)
        return `${entry.id}#${occurrence}`
    })
}

/** The handles of entries whose id is non-empty, does not start with `~` (the positional-handle prefix) and is held by exactly one entry of `entries`. */
export function uniqueIdHandles(entries: readonly Pick<ModuleEntry, 'id'>[]): Set<string> {
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

/** The modules in index order, from the module units `read` returns; `read` also gets the entry's handle (`moduleHandles` over the index). */
export function assembleModules(index: ModuleIndex, read: (entry: ModuleEntry, handle: string) => JsonObject): JsonObject[] {
    const handles = moduleHandles(index.entries)
    return index.entries.map((entry, position) => {
        const module = read(entry, handles[position])
        if (typeof module !== 'object' || module === null || Array.isArray(module)) {
            throw new CodecAssembleError(`Module ${entry.id} is not an object.`)
        }
        return module
    })
}
