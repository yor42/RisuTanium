import { DBState } from '../stores.svelte'
import { getCurrentChat, getCurrentCharacter, getDatabase } from '../storage/database.svelte'
import { checkPersonaBinded } from '../util'
import { matchesModuleRef, referencedModuleIds } from './moduleRefs'
import { isModuleStub } from '../storage/moduleStub'
import { language } from 'src/lang'
import type { RunSubject } from './chatOrigin'
import type { RisuModule } from './modules'

// The module list a run reads is derived here, apart from process/modules, so the producers, the exit net and the
// ensure step all name the same modules. Nothing here may import process/modules at run time: tests that mock that
// file would otherwise break every importer of this leaf.

/** Ids a run (the selected origin when no subject is given) references: enabled, chat, character, persona and namespace references. */
export function moduleRefIdsOf(subject?: RunSubject): string[] {
    let currentChat: ReturnType<typeof getCurrentChat>
    let character: ReturnType<typeof getCurrentCharacter>
    let persona: ReturnType<typeof checkPersonaBinded>
    if(subject){
        const ctx = subject.resolve()
        currentChat = ctx?.chat
        character = ctx?.owner
        persona = checkPersonaBinded(ctx?.chat ?? null)
    } else {
        currentChat = getCurrentChat()
        character = getCurrentCharacter()
        persona = checkPersonaBinded()
    }
    const db = getDatabase()
    return referencedModuleIds({
        enabledModules: db.enabledModules,
        chat: currentChat,
        character,
        persona,
        moduleIntergration: db.moduleIntergration,
    })
}

/** The database rows the ids select, with the first holder of each id winning. */
export function moduleListOf(ids: string[]): RisuModule[] {
    const db = getDatabase()
    const idSet = new Set(ids)
    const modules = db.modules.filter(m => matchesModuleRef(m, idSet))
    return deduplicateModuleById(modules)
}

function deduplicateModuleById(modules: RisuModule[]): RisuModule[] {
    const ids: string[] = []
    const newModules: RisuModule[] = []
    for(let i=0;i<modules.length;i++){
        if(ids.includes(modules[i].id)){
            continue
        }
        ids.push(modules[i].id)
        newModules.push(modules[i])
    }
    return newModules
}

/** Cheap pre-check: true when any database row is an unloaded stub. Reads nothing else. */
export function hasModuleStubs(): boolean {
    const modules = DBState.db?.modules
    return Array.isArray(modules) && modules.some((m) => isModuleStub(m))
}

/** The stubs a run would read: the deduplicated referenced list filtered to stubs, so a resident first holder hides a later same-id stub. */
export function unloadedModulesOf(subject?: RunSubject): RisuModule[] {
    return moduleListOf(moduleRefIdsOf(subject)).filter(isModuleStub)
}

/** One combined alert text for several modules that did not load. */
export function moduleLoadFailedText(names: string[]): string {
    return language.moduleLoadFailed(names.join(', '))
}
