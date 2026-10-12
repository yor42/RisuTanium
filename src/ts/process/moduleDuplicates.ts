import { alertSelect } from "../alert"
import { language } from "src/lang"
import type { RisuModule } from "./modules"

/**
 * Duplicate handling for the Module button: a module is a duplicate of an installed one when the trimmed, case-sensitive
 * names are equal and the installed one is not an MCP module. A name that is not a string never matches, on either
 * side: modules read from a `.risum` or stored from unvalidated JSON can lack one.
 */

//The part of a stored module that matching reads. `name` is unchecked at run time, so it is typed as what a caller may hold.
type NamedModule = {name?: unknown, mcp?: unknown}

function nameKey(name:unknown):string|null {
    return typeof name === 'string' ? name.trim() : null
}

/** Position of the first installed module the name duplicates, in list order; -1 when none does. */
export function findDuplicateIndex(modules:readonly NamedModule[], name:unknown):number {
    const key = nameKey(name)
    if(key === null){
        return -1
    }
    return modules.findIndex((m) => !m.mcp && nameKey(m.name) === key)
}

export type DuplicateChoice = 'replace' | 'skip' | 'add'

/** What to do with the incoming module. `replace` names the installed module by id, not by position. */
export type DuplicateDecision =
    | {choice: 'add'}
    | {choice: 'skip'}
    | {choice: 'replace', targetId: string}

export type ModulePlacement =
    | {kind: 'added'}
    | {kind: 'replaced', previous: RisuModule}

/**
 * The one write of an incoming module into the list, with no await. A replace looks the target up again by its id and
 * stores the incoming module under that id at the target's position, so the position and the references that key on the
 * id stay; the rest comes from the incoming module. A target that is gone makes it an add.
 */
export function applyModulePlacement(modules:RisuModule[], incoming:RisuModule, decision:DuplicateDecision):ModulePlacement {
    if(decision.choice === 'replace'){
        const index = modules.findIndex((m) => m.id === decision.targetId)
        if(index !== -1){
            const previous = modules[index]
            modules[index] = {...incoming, id: previous.id}
            return {kind: 'replaced', previous}
        }
    }
    modules.push(incoming)
    return {kind: 'added'}
}

/** What the user is told about a replace beyond the import itself: a changed namespace changes what the integration list enables. */
export function describeReplace(previous:Pick<RisuModule, 'name' | 'namespace'>, incoming:Pick<RisuModule, 'name' | 'namespace'>):string[] {
    const before = typeof previous.namespace === 'string' ? previous.namespace : ''
    const after = typeof incoming.namespace === 'string' ? incoming.namespace : ''
    if(before === after){
        return []
    }
    const name = typeof incoming.name === 'string' ? incoming.name : ''
    return [language.moduleReplaceNamespaceChanged(name, before, after)]
}

/**
 * The duplicate answers of one import action. An "all remaining" answer is sticky for the rest of the action: later
 * duplicates are not asked. The "all remaining" options are offered only while a later file exists.
 */
export class DuplicateSession {
    private sticky:DuplicateChoice|null = null
    //True once any module of the action was replaced in place, so the caller refreshes the module screens once.
    replaced = false

    async decide(modules:readonly (NamedModule & {id?: string})[], name:unknown, file:string, laterFiles:boolean):Promise<DuplicateDecision> {
        const index = findDuplicateIndex(modules, name)
        if(index === -1){
            return {choice: 'add'}
        }
        const choice = this.sticky ?? await this.ask(typeof name === 'string' ? name.trim() : '', file, laterFiles)
        if(choice === 'replace'){
            const targetId = modules[index].id
            return typeof targetId === 'string' ? {choice: 'replace', targetId} : {choice: 'add'}
        }
        return {choice}
    }

    private async ask(name:string, file:string, laterFiles:boolean):Promise<DuplicateChoice> {
        const labels = [language.moduleDuplicateReplace, language.moduleDuplicateSkip, language.moduleDuplicateAddAnyway]
        const options = laterFiles ? [...labels, ...labels.map((label) => language.moduleDuplicateAll(label))] : labels
        //The select joins its options with the separator, so no run of bars may stay in the header, whatever the number of bars.
        const display = language.moduleDuplicatePrompt(name, file).replace(/\|{2,}/g, '|')
        const answer = parseInt(await alertSelect(options, display))
        //An answer that is not an option leaves the file out: nothing is written.
        if(!(answer >= 0 && answer < options.length)){
            return 'skip'
        }
        const choices:DuplicateChoice[] = ['replace', 'skip', 'add']
        const choice = choices[answer % 3]
        if(answer >= 3){
            this.sticky = choice
        }
        return choice
    }
}
