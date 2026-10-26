import { isModuleStub } from "../storage/moduleStub"
import type { RisuModule } from "../process/modules"

/**
 * Fork-specific: the plugin setters refuse a module stub (the stand-in for a
 * module whose body is not resident) as a replacement for a module. The rule
 * is keyed by module id, not by slot: an incoming stub is replaced by the
 * first live module holding its id, whether that one is full or itself a
 * stub, and is left out when no live module has its id. An incoming slot
 * without the stub marker is an ordinary write, even when it carries no body:
 * `getDatabase` hands plugins full modules only, so a plugin never receives a
 * stub to trim.
 *
 * This module is shared by `plugins.svelte.ts` and `apiV3/v3.svelte.ts` and
 * imports neither.
 */

function moduleIdOf(module: unknown): string | undefined {
    const id = (module as { id?: unknown } | null | undefined)?.id
    return typeof id === 'string' ? id : undefined
}

function warnModuleStubRefused(pluginName: string | undefined, moduleId: string | undefined, kept: boolean) {
    console.warn(`[WARN] Plugin ${pluginName ?? '(unknown)'} tried to put a module stub (module id ${moduleId ?? '(none)'}) into the module list, but ${kept ? 'the module list already holds that module' : 'no module in the list has that id'}. The stub was refused.`)
}

/**
 * `newDb.modules`, when the plugin sends an array, comes back with each module
 * stub swapped for the live module holding its id, or left out when no live
 * module has it. An array without a stub comes back as it is, and a value that
 * is not an array passes through.
 */
export function withoutModuleStubDowngrades<T extends { modules?: unknown }>(liveModules: readonly RisuModule[] | undefined, newDb: T, pluginName?: string): T {
    const incoming = newDb.modules
    if (!Array.isArray(incoming) || !incoming.some(isModuleStub)) {
        return newDb
    }
    const live = liveModules ?? []
    const modules: unknown[] = []
    for (const slot of incoming) {
        if (!isModuleStub(slot)) {
            modules.push(slot)
            continue
        }
        const id = moduleIdOf(slot)
        const holder = id === undefined ? undefined : live.find((module) => moduleIdOf(module) === id)
        warnModuleStubRefused(pluginName, id, holder !== undefined)
        if (holder !== undefined) {
            modules.push(holder)
        }
    }
    return { ...newDb, modules }
}
