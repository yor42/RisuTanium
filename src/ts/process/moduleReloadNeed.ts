import type { RisuModule } from "./modules"
import { isModuleStub } from "../storage/moduleStub"

/**
 * Fork-specific: decides whether a change of the referenced module set must rebuild the chat body (ReloadGUIPointer).
 * A pure leaf: it imports no store, so its reads are plain values and the caller decides what is tracked.
 */

/**
 * `ids` is the row-id array of the call, never a split of the joined id string: ids may contain the join character.
 */
export interface ModuleReloadBase{
    ids: string[]
    selection: string
}

/**
 * Module fields that cannot change what the chat body shows by themselves. `hideIcon` and `backgroundEmbedding` reach
 * their stores through moduleUpdate, `mcp` is read at request time, and `cjs`, `lowLevelAccess` and `icon` have no
 * display read. Any other field, including a future one, counts as display-affecting.
 */
export const POINTER_INERT_KEYS: ReadonlySet<string> = new Set([
    'id', 'name', 'description', 'icon', 'mcp', 'cjs', 'lowLevelAccess', 'hideIcon', 'backgroundEmbedding',
])

function isEmptyValue(value: unknown): boolean{
    if(value === undefined || value === null || value === false || value === ''){
        return true
    }
    return Array.isArray(value) && value.length === 0
}

/**
 * Whether a module can be added or removed without changing the displayed body. A stub is never inert: its body is
 * not resident. Only present keys are read, because a missing-key read through a `$state` proxy creates a source.
 */
export function isPointerInertModule(module: RisuModule): boolean{
    if(isModuleStub(module)){
        return false
    }
    const fields = module as unknown as Record<string, unknown>
    for(const key of Object.keys(fields)){
        if(POINTER_INERT_KEYS.has(key)){
            continue
        }
        if(!isEmptyValue(fields[key])){
            return false
        }
    }
    return true
}

/**
 * Whether the body must be rebuilt after the referenced module set changed from `prev` to `nextRows`.
 * True when there is no base, the selection changed, no id was added or removed, an added row is not inert, or a
 * removed id has no current row or any current row with that id is not inert.
 * `rowsWithId` returns the current db rows holding an id, so removed bodies are judged by their current content.
 */
export function moduleChangeNeedsReload(
    prev: ModuleReloadBase | null,
    nextRows: RisuModule[],
    selection: string,
    rowsWithId: (id: string) => RisuModule[],
): boolean{
    if(prev === null || prev.selection !== selection){
        return true
    }
    const prevIds = new Set(prev.ids)
    const nextIds = new Set(nextRows.map((row) => row.id))
    const added = nextRows.filter((row) => !prevIds.has(row.id))
    const removed = prev.ids.filter((id) => !nextIds.has(id))
    if(added.length === 0 && removed.length === 0){
        return true
    }
    if(added.some((row) => !isPointerInertModule(row))){
        return true
    }
    for(const id of removed){
        const rows = rowsWithId(id)
        if(rows.length === 0 || rows.some((row) => !isPointerInertModule(row))){
            return true
        }
    }
    return false
}
