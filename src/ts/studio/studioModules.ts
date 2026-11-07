// Which modules a Studio visit shows as active, and why. Classification only: nothing here loads, acquires or
// reads the body of a module. A row is read through its reference fields (`id`, `namespace`) and its stub marker;
// the app's own module effect is what turns a referenced stub into a resident module.
import { matchesModuleRef, referencedModuleIds } from '../process/moduleRefs'
import { isModuleStub } from '../storage/moduleStub'
import type { RisuModule } from '../process/modules'

export type ModuleBadge = 'allChats' | 'thisChat' | 'character' | 'persona' | 'integration' | 'namespace'

/** Maps reference ids to the database rows they select, the way `moduleListOf` does (first holder of an id wins). */
export type ModuleLister = (ids: string[]) => RisuModule[]

export interface ModuleReferenceSources {
    enabledModules: readonly string[] | undefined
    chat: { modules?: readonly string[] } | null | undefined
    character: { modules?: readonly string[] } | null | undefined
    persona: { embeddedModule?: { id: string } } | null | undefined
    moduleIntergration: string | undefined
}

export interface ActiveModuleRow {
    module: RisuModule
    /** In reference-source order: all chats, this chat, the character, the persona, the integration setting, then namespace. */
    badges: ModuleBadge[]
}

export interface ModuleClassification {
    /** The reference ids the engine builds for this origin, in selection order. */
    ids: string[]
    /** Active rows in database (load) order, without a repeated id. */
    active: ActiveModuleRow[]
    /** Rows that match a reference but lost the id to an earlier row. */
    notApplied: RisuModule[]
    /** Every other row. */
    others: RisuModule[]
}

/** The persona entry a chat is bound to, as `checkPersonaBinded(chat)` reads it (no fallback to the selection). */
export function boundPersonaOf<P extends { id?: string }>(
    chat: { bindedPersona?: string } | null | undefined,
    personas: readonly P[] | undefined,
): P | null {
    if (!chat || !chat.bindedPersona) return null
    return personas?.find((p) => p.id === chat.bindedPersona) ?? null
}

function sourceSets(sources: ModuleReferenceSources): [ModuleBadge, ReadonlySet<string>][] {
    const sets: [ModuleBadge, ReadonlySet<string>][] = [['allChats', new Set(sources.enabledModules ?? [])]]
    if (sources.chat) sets.push(['thisChat', new Set(sources.chat.modules ?? [])])
    if (sources.character) sets.push(['character', new Set(sources.character.modules ?? [])])
    const personaModule = sources.persona?.embeddedModule
    if (personaModule) sets.push(['persona', new Set([personaModule.id])])
    if (sources.moduleIntergration) {
        sets.push(['integration', new Set(sources.moduleIntergration.split(',').map((s) => s.trim()))])
    }
    return sets
}

function mutableRefs(source: { modules?: readonly string[] } | null | undefined): { modules?: string[] } | null {
    if (source == null) return null
    return { modules: source.modules ? [...source.modules] : undefined }
}

/**
 * Splits `allRows` into the rows active for the given origin, the rows that match but lost their id, and the rest.
 * The active set is `lister(referencedModuleIds(...))`, the pair of calls the engine's `getModules()` makes, with the
 * origin passed in explicitly. Reads `id` and `namespace` of every row and nothing else of a row that is not shown.
 */
export function classifyModules(
    sources: ModuleReferenceSources,
    allRows: readonly RisuModule[],
    lister: ModuleLister,
): ModuleClassification {
    // referencedModuleIds takes mutable lists; it only reads and concatenates them.
    const ids = referencedModuleIds({
        enabledModules: sources.enabledModules ? [...sources.enabledModules] : undefined,
        chat: mutableRefs(sources.chat),
        character: mutableRefs(sources.character),
        persona: sources.persona,
        moduleIntergration: sources.moduleIntergration,
    })
    const sets = sourceSets(sources)
    const activeRows = lister(ids)
    const activeSet = new Set<RisuModule>(activeRows)
    const idSet = new Set(ids)

    const active: ActiveModuleRow[] = activeRows.map((module) => {
        const badges: ModuleBadge[] = []
        let byNamespace = false
        for (const [badge, set] of sets) {
            if (!matchesModuleRef(module, set)) continue
            badges.push(badge)
            if (!set.has(module.id)) byNamespace = true
        }
        if (byNamespace) badges.push('namespace')
        return { module, badges }
    })

    const notApplied: RisuModule[] = []
    const others: RisuModule[] = []
    for (const row of allRows) {
        if (activeSet.has(row)) continue
        if (matchesModuleRef(row, idSet)) notApplied.push(row)
        else others.push(row)
    }
    return { ids, active, notApplied, others }
}

/** True for a slot whose body is not resident. Reads the marker only. */
export function isStubRow(module: RisuModule): boolean {
    return isModuleStub(module)
}
