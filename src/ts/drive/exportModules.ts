import type { Database } from '../storage/database.svelte'
import type { RisuModule } from '../process/modules'
import { isModuleStub, ModuleStubRefusal } from '../storage/moduleStub'
import { CodecInputError } from '../storage/store2/codec/types'
import type { ModuleEntry } from '../storage/store2/format'
import { sameEntryUnits, slotIsRecordedStub } from '../storage/store2/moduleStubMatch'
import { getResidency } from '../storage/store2/residencyActive'
import { ModuleAmbiguousError, ModuleLoadError } from '../storage/store2/moduleAcquire'

/**
 * What a person is told about an unreadable module. `unreadable` claims no cause; `duplicate` states only that the id is
 * shared; `changed` is only a body that moved while it was read. `missing` (a body nothing could be found for) is not
 * produced by the export snapshot; it stays a member because the alert text of `backupFailedModuleUnreadable` words it.
 */
export type ExportModuleFailure = 'damaged' | 'missing' | 'newer' | 'changed' | 'duplicate' | 'unreadable'

function failureOf(cause: unknown): ExportModuleFailure {
    if (cause instanceof ModuleAmbiguousError) {
        return 'duplicate'
    }
    if (cause instanceof ModuleLoadError) {
        switch (cause.reason) {
            case 'ambiguous':
                return 'duplicate'
            case 'stale':
            case 'replaced':
                return 'changed'
            case 'too-new':
                return 'newer'
            case 'damaged':
                return 'damaged'
            default:
                return 'unreadable'
        }
    }
    return 'unreadable'
}

/** A module of the database could not be read for an export; the export stops before it opens a file. */
export class ExportModuleUnreadableError extends Error {
    /** Why, as the alert words it; derived from `cause` once. */
    public readonly reason: ExportModuleFailure

    constructor(public readonly moduleId: string, public readonly moduleName: string, cause: unknown) {
        super(`The module "${moduleName}" (${moduleId}) could not be read for the export.`, { cause })
        this.name = 'ExportModuleUnreadableError'
        this.reason = failureOf(cause)
    }
}

/**
 * The module list an export writes: `modules` is null when the database holds no list (nothing is substituted and no
 * `modules` key is added), otherwise a new array of the slots as they were at the call, in order and with duplicates
 * kept, every one a module body except a module stub kept because the page has no residency. Nothing the snapshot reads
 * is installed, hydrated or held by a handle, so it has nothing to release.
 */
export interface ExportModuleSnapshot {
    modules: RisuModule[] | null
}

/** A slot of the list copy, with the stored entry its stub was recorded under at the call. */
type PlannedSlot =
    | { kind: 'keep', slot: RisuModule }
    | { kind: 'stub', slot: RisuModule, handle: string, entry: ModuleEntry }

function textOf(value: unknown): string {
    return typeof value === 'string' ? value : ''
}

/**
 * The export's check of the live module list. Like `assertNoModuleStubs` it scans an array by element and any other
 * object by its values, but it refuses only a foreign stub: one with no residency, no acknowledged entry for its id, or a
 * marker that is not the recorded stub of that entry. A recorded stub stays in the list and is not refused. A stub that
 * cannot be read as JSON is foreign too and is refused with `ModuleStubRefusal`; any other error thrown while reading a
 * stub is rethrown unchanged. The encoder and snapshot-list
 * checks stay on the total `assertNoModuleStubs`.
 */
export function assertNoForeignModuleStubs(modules: unknown, where: string): void {
    if (typeof modules !== 'object' || modules === null) {
        return
    }
    const residency = getResidency()
    const slots = Array.isArray(modules) ? modules : Object.values(modules)
    for (let index = 0; index < slots.length; index++) {
        const slot: unknown = slots[index]
        if (!isModuleStub(slot)) {
            continue
        }
        const fields = slot as Record<string, unknown>
        const entry = residency === null ? null : residency.moduleEntryOf(`${textOf(fields.id)}#0`)
        let recorded = false
        if (entry !== null) {
            try {
                recorded = slotIsRecordedStub(slot, entry)
            } catch (error) {
                if (!(error instanceof CodecInputError)) {
                    throw error
                }
            }
        }
        if (!recorded) {
            throw new ModuleStubRefusal(textOf(fields.id), textOf(fields.name), where)
        }
    }
}

/**
 * Reads every module the export will write before anything is opened. A resident slot is kept as the same object and
 * never resolved by id (an id resolves to its first holder, which is another module when ids repeat). A module stub is
 * read as a copy of its stored body through the residency: nothing is installed, hydrated or written, and the live list
 * is never touched. The stub's backup copy is the stored body as it was at the call, so the lorebook repair is not
 * applied and no question is asked; for a module edited or imported since the last resident boot this commonly includes
 * lore entries without `bookVersion`. The first load repairs it and the next save pass stores the repaired body.
 *
 * Every stub's checks and its stored entry are settled in one synchronous phase before the first await, so they are the
 * state at the call: a stub that is not the recorded one, has no entry, or shares its id with another slot fails there
 * (`ExportModuleUnreadableError`), and a page with no residency keeps the stub for the live check to refuse. The reads
 * then run in order. An entry that moved after the call (a later save pass, or a removed entry) is `changed`, whether it
 * shows in the read or in the current entry afterwards; the other read failures keep their own reasons. The snapshot is
 * independent of later edits to the live list, so a module removed while the export runs is still written.
 */
export async function snapshotModuleList(db: Database): Promise<ExportModuleSnapshot> {
    const live: unknown = db.modules
    if (!Array.isArray(live)) {
        return { modules: null }
    }
    const slots: RisuModule[] = [...live]
    const residency = getResidency()
    const planned: PlannedSlot[] = []
    for (const slot of slots) {
        if (!isModuleStub(slot) || residency === null) {
            planned.push({ kind: 'keep', slot })
            continue
        }
        try {
            if (slots.some((other) => other !== slot && other.id === slot.id)) {
                throw new ModuleAmbiguousError(slot.id, slot.name)
            }
            const handle = `${slot.id}#0`
            const entry = residency.moduleEntryOf(handle)
            if (entry === null) {
                throw new ModuleLoadError('no-entry', slot.id, slot.name)
            }
            if (!slotIsRecordedStub(slot, entry)) {
                throw new ModuleLoadError('edited', slot.id, slot.name)
            }
            planned.push({ kind: 'stub', slot, handle, entry })
        } catch (error) {
            throw new ExportModuleUnreadableError(slot.id, slot.name, error)
        }
    }
    const modules: RisuModule[] = []
    for (const one of planned) {
        if (one.kind === 'keep' || residency === null) {
            modules.push(one.slot)
            continue
        }
        const { slot, handle, entry } = one
        try {
            const read = await residency.readModule(handle)
            if (read.status === 'error') {
                // No entry after the call means the entry moved since; it is not a missing or damaged body.
                const detail = read.error instanceof Error ? read.error.message : undefined
                throw new ModuleLoadError(read.reason === 'no-entry' ? 'stale' : read.reason, slot.id, entry.name, detail)
            }
            const current = residency.moduleEntryOf(handle)
            if (!sameEntryUnits(read.entry, entry) || current === null || !sameEntryUnits(current, entry)) {
                throw new ModuleLoadError('stale', slot.id, entry.name)
            }
            modules.push(read.value as unknown as RisuModule)
        } catch (error) {
            throw new ExportModuleUnreadableError(slot.id, slot.name, error)
        }
    }
    return { modules }
}
