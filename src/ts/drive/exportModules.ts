import type { Database } from '../storage/database.svelte'
import type { RisuModule } from '../process/modules'
import { isModuleStub } from '../storage/moduleStub'
import { acquireModule, ModuleAmbiguousError, ModuleLoaderMissingError, ModuleLoadError } from '../storage/store2/moduleAcquire'

/**
 * What a person is told about an unreadable module. `unreadable` claims no cause; `duplicate` states only that the id is
 * shared; `changed` is only a body that moved while it was read; `missing` is a body nothing could be found for.
 */
export type ExportModuleFailure = 'damaged' | 'missing' | 'newer' | 'changed' | 'duplicate' | 'unreadable'

/** The acquire resolved null: no body was found. Private marker so the catch never reads message text. */
class NullBodyError extends Error {
    constructor(moduleId: string, moduleName: string) {
        super(`No body was found for the module "${moduleName}" (${moduleId}).`)
        this.name = 'NullBodyError'
    }
}

function failureOf(cause: unknown): ExportModuleFailure {
    if (cause instanceof NullBodyError) {
        return 'missing'
    }
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
 * kept, every one a module body except a module stub kept because no loader is registered. `release` lets go of every
 * handle the snapshot acquired, once.
 */
export interface ExportModuleSnapshot {
    modules: RisuModule[] | null
    release(): void
}

/**
 * With no module loader registered a stub cannot be brought in at all; it stays in the snapshot as the stub object, and
 * the export's marker check on the live list refuses it as it refuses any marker (an encoder would refuse it too).
 * Every other failure, and a null result, is a read failure.
 */
async function acquireOrKeep(id: string): Promise<Awaited<ReturnType<typeof acquireModule>> | 'unloadable'> {
    try {
        return await acquireModule(id)
    } catch (error) {
        if (error instanceof ModuleLoaderMissingError) {
            return 'unloadable'
        }
        throw error
    }
}

/**
 * Reads every module the export will write before anything is opened. A resident slot is kept as the same object and
 * never resolved by id (an id resolves to its first holder, which is another module when ids repeat). A module stub is
 * brought in through `acquireModule`, except when another slot holds its id, because its body cannot then be told from
 * that slot's. Any failure other than a missing loader throws `ExportModuleUnreadableError` after releasing the handles already acquired. The
 * snapshot is independent of later edits to the live list, so a module removed while the export runs is still written.
 */
export async function snapshotModuleList(db: Database): Promise<ExportModuleSnapshot> {
    const live: unknown = db.modules
    if (!Array.isArray(live)) {
        return { modules: null, release: () => { } }
    }
    const slots: RisuModule[] = [...live]
    const releases: (() => void)[] = []
    let released = false
    const release = () => {
        if (released) {
            return
        }
        released = true
        for (const one of releases) {
            one()
        }
    }
    const modules: RisuModule[] = []
    for (const slot of slots) {
        if (!isModuleStub(slot)) {
            modules.push(slot)
            continue
        }
        try {
            if (slots.some((other) => other !== slot && other.id === slot.id)) {
                throw new ModuleAmbiguousError(slot.id, slot.name)
            }
            const acquired = await acquireOrKeep(slot.id)
            if (acquired === 'unloadable') {
                modules.push(slot)
                continue
            }
            if (acquired === null) {
                throw new NullBodyError(slot.id, slot.name)
            }
            releases.push(acquired.release)
            modules.push(acquired.module)
        } catch (error) {
            release()
            throw new ExportModuleUnreadableError(slot.id, slot.name, error)
        }
    }
    return { modules, release }
}
