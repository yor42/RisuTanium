import type { RisuModule } from '../../process/modules'
import { DBState } from '../../stores.svelte'
import { isModuleStub } from '../moduleStub'

/**
 * Brings a module stub's body in: it receives the stub's handle (`${id}#0`) and the caller's signal, installs the body
 * into the slot and returns that live slot, or null when the module is gone.
 */
export type ModuleLoader = (handle: string, signal?: AbortSignal) => Promise<RisuModule | null>

/** A module could not be acquired. Carries the module's id and name; the load errors of the loader extend it. */
export class ModuleAcquireError extends Error {
    constructor(message: string, public readonly moduleId: string, public readonly moduleName: string) {
        super(message)
        this.name = 'ModuleAcquireError'
    }
}

/** A module stub was found and no loader is registered, so its body cannot be brought in. */
export class ModuleLoaderMissingError extends ModuleAcquireError {
    constructor(moduleId: string, moduleName: string) {
        super(`The module "${moduleName}" (${moduleId}) is a module stub and no module loader is registered.`, moduleId, moduleName)
        this.name = 'ModuleLoaderMissingError'
    }
}

/** The first holder of the id is a module stub and another module holds the same id, so the stub's body cannot be told from the other's. */
export class ModuleAmbiguousError extends ModuleAcquireError {
    constructor(moduleId: string, moduleName: string) {
        super(`The module "${moduleName}" (${moduleId}) is a module stub and its id is held by more than one module.`, moduleId, moduleName)
        this.name = 'ModuleAmbiguousError'
    }
}

let registeredLoader: ModuleLoader | null = null

export function registerModuleLoader(loader: ModuleLoader): void {
    registeredLoader = loader
}

export function unregisterModuleLoader(): void {
    registeredLoader = null
}

/**
 * The one way to reach a module's body from its id. A resident module is returned as the live slot; a module stub is
 * loaded through the registered loader. The list is read at call time (`DBState` is never touched at module load),
 * and the first holder of an id wins, as the `find` it replaces did.
 *
 * Resolves null when no module holds `id` (the loader is not called) or when the loader returns null; a loader failure
 * is a rejection. `release` is a no-op until a module can be swapped out again.
 */
export async function acquireModule(
    id: string, signal?: AbortSignal,
): Promise<{ module: RisuModule, release: () => void } | null> {
    const modules: readonly RisuModule[] = DBState.db.modules ?? []
    const first = modules.find((module) => module.id === id)
    if (first === undefined) {
        return null
    }
    if (!isModuleStub(first)) {
        return { module: first, release: releaseNothing }
    }
    if (modules.some((module) => module !== first && module.id === id)) {
        throw new ModuleAmbiguousError(id, first.name)
    }
    if (registeredLoader === null) {
        throw new ModuleLoaderMissingError(id, first.name)
    }
    const loaded = await registeredLoader(`${id}#0`, signal)
    return loaded === null ? null : { module: loaded, release: releaseNothing }
}

function releaseNothing(): void {
}
