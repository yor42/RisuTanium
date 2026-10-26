import { language } from 'src/lang'
import { alertError } from '../alert'
import { isModuleStub } from '../storage/moduleStub'
import { DBState } from '../stores.svelte'
import { acquireModule } from '../storage/store2/moduleAcquire'
import type { RisuModule } from './modules'

/** A module whose body is resident, and the release the caller owes once it stops using the module. */
export interface UsableModule {
    module: RisuModule
    release: () => void
}

function releaseNothing(): void {
}

/**
 * Makes the module behind a clicked list row usable. A row that is not a module stub is returned as it is, so the
 * caller keeps the row's identity; a stub is loaded by id and the live slot is returned. A failure is shown to the
 * user, naming the module, and resolves null: the caller stops and does nothing with the module.
 */
export async function useModuleRow(row: RisuModule): Promise<UsableModule | null> {
    if (!isModuleStub(row)) {
        return { module: row, release: releaseNothing }
    }
    return await acquireForUse(row.id, row.name)
}

/** Loads the module held by `id` for a caller that only has the id; failures are shown as in `useModuleRow`. */
export async function useModuleById(id: string, name: string): Promise<UsableModule | null> {
    return await acquireForUse(id, name)
}

/**
 * The Realm upload payload of the module in list row `index`: the loaded module serialised with the `risuModule` type
 * tag, and its name. The tag is added to a copy, so the live slot is never written; the row (not its id) selects the
 * module, so a duplicate id cannot substitute another module. Null when the row is absent or its body cannot be loaded
 * (the failure has been shown to the user).
 */
export async function realmModuleJson(index: number): Promise<{ json: string, name: string } | null> {
    const row = DBState.db.modules[index]
    if (!row) {
        return null
    }
    const usable = await useModuleRow(row)
    if (!usable) {
        return null
    }
    try {
        return {
            json: JSON.stringify({ ...usable.module, type: 'risuModule' }),
            name: usable.module.name
        }
    }
    finally {
        usable.release()
    }
}

async function acquireForUse(id: string, name: string): Promise<UsableModule | null> {
    try {
        const acquired = await acquireModule(id)
        if (acquired) {
            return acquired
        }
        alertError(language.moduleLoadFailed(name))
        return null
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        console.error(reason)
        alertError(language.moduleLoadFailed(name))
        return null
    }
}
