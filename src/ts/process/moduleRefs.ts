// Pure reference rule shared by module selection and anything that must agree
// with it. This file has no imports, so storage code can use it without
// creating a cycle with process code.

export type ModuleRefShape = {
    id: string
    namespace?: string
}

export type ModuleRefInput = {
    enabledModules?: string[]
    chat?: { modules?: string[] } | null
    character?: { modules?: string[] } | null
    persona?: { embeddedModule?: { id: string } } | null | false
    moduleIntergration?: string
}

/**
 * Builds the reference list in selection order: enabled, chat, character,
 * persona-embedded id, then the comma-separated integration string. Empty
 * integration segments are kept as empty-string references.
 */
export function referencedModuleIds(input: ModuleRefInput): string[]{
    let ids = input.enabledModules ?? []
    if(input.chat){
        ids = ids.concat(input.chat.modules ?? [])
    }
    if(input.character && input.character.modules){
        ids = ids.concat(input.character.modules)
    }
    if(input.persona && input.persona.embeddedModule){
        ids = ids.concat([input.persona.embeddedModule.id])
    }
    if(input.moduleIntergration){
        const intList = input.moduleIntergration.split(',').map((s) => s.trim())
        ids = ids.concat(intList)
    }
    return ids
}

/**
 * A module is referenced by its own id or by a non-empty namespace it holds.
 * An empty namespace never matches.
 */
export function matchesModuleRef(module: ModuleRefShape, refSet: ReadonlySet<string>): boolean{
    return refSet.has(module.id) || !!(module.namespace && refSet.has(module.namespace))
}
