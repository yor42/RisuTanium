import { v4 } from 'uuid'
import { language } from 'src/lang'
import { alertConfirm, alertError } from '../alert'
import { checkCharOrder } from '../globalApi.svelte'
import { convertModuleToCharacter } from '../interchangeability'
import type { character, Database } from '../storage/database.svelte'
import { DBState } from '../stores.svelte'
import { exportModule, exportModuleLegacy, refreshModules, type RisuModule } from './modules'
import { useModuleRow } from './moduleUse'
import { matchesModuleRef } from './moduleRefs'

// The module list operations shared by the classic Modules page and the Studio module list. Each takes the clicked row
// object, never an index or an id alone: the list can change while an alert is open, so the row is found again at the
// moment of the write.

export type ModuleIntegrationState = 'global' | 'integration' | 'off'

/** Pushes a module of the classic shape under a fresh id and returns the slot as it is stored. */
export function createModule(name: string): RisuModule {
    DBState.db.modules.push({
        name,
        description: '',
        id: v4(),
    })
    return DBState.db.modules[DBState.db.modules.length - 1]
}

/**
 * Removes `row` after the caller's confirmation. The row is found by reference, so a list that changed while the
 * confirmation was open never removes another module; a row that left the list changes nothing and returns false. The id
 * leaves `enabledModules` only when no remaining row holds it. A stub is never acquired. The module memo is refreshed at
 * once, so a module that a character or chat still references stops feeding prompts.
 */
export function removeModuleRow(row: RisuModule): boolean {
    const index = DBState.db.modules.indexOf(row)
    if (index === -1) {
        return false
    }
    DBState.db.modules.splice(index, 1)
    DBState.db.modules = DBState.db.modules
    if (!DBState.db.modules.some((v) => v.id === row.id) && DBState.db.enabledModules.includes(row.id)) {
        DBState.db.enabledModules.splice(DBState.db.enabledModules.indexOf(row.id), 1)
        DBState.db.enabledModules = DBState.db.enabledModules
    }
    refreshModules()
    return true
}

/** Turns the global enable of module id `id` on or off; turning off removes the first occurrence. */
export function setModuleGlobal(id: string, on: boolean): void {
    const at = DBState.db.enabledModules.indexOf(id)
    if (on) {
        if (at === -1) {
            DBState.db.enabledModules.push(id)
        }
    } else if (at !== -1) {
        DBState.db.enabledModules.splice(at, 1)
    }
    DBState.db.enabledModules = DBState.db.enabledModules
}

/**
 * Exports the module behind `row`. An MCP module is refused here, by the resident body or by the stub's flag: its URL may
 * carry a token and leaves no device. A stub is acquired for the export and released when it ends, however it ends.
 */
export async function exportModuleRow(row: RisuModule, format: 'charx' | 'risum'): Promise<void> {
    if (row.mcp) {
        alertError(language.errors.mcpModuleConversionUnsupported)
        return
    }
    const used = await useModuleRow(row)
    if (!used) {
        return
    }
    try {
        if (used.module.mcp) {
            alertError(language.errors.mcpModuleConversionUnsupported)
            return
        }
        if (format === 'charx') {
            await exportModule(used.module)
        } else {
            await exportModuleLegacy(used.module)
        }
    } finally {
        used.release()
    }
}

/**
 * Makes a character from the module behind `row` and pushes it. A module with Low Level Access on asks first, and Cancel
 * makes no character; the flag is read from the acquired body, because a stub's index entry keeps it only as a boolean.
 * An MCP module, or any other throw of the conversion, shows its message and makes no character. A stub is released when
 * the conversion ends, however it ends.
 */
export async function convertModuleRow(row: RisuModule): Promise<character | null> {
    const used = await useModuleRow(row)
    if (!used) {
        return null
    }
    try {
        if (used.module.lowLevelAccess && !await alertConfirm(language.studioModuleListConvertLowLevel(used.module.name))) {
            return null
        }
        let made: character
        try {
            made = convertModuleToCharacter(used.module)
        } catch (error) {
            alertError(error instanceof Error ? error.message : String(error))
            return null
        }
        DBState.db.characters.push(made)
        checkCharOrder()
        return made
    } finally {
        used.release()
    }
}

/**
 * Why `row` is on: `global` when its id is in `enabledModules`; `integration` when the Module Integration string names
 * its id or its namespace, as the engine selects a module; otherwise `off`.
 */
export function moduleIntegrationState(row: RisuModule, db: Pick<Database, 'enabledModules' | 'moduleIntergration'>): ModuleIntegrationState {
    if (db.enabledModules.includes(row.id)) {
        return 'global'
    }
    const text = db.moduleIntergration
    if (!text) {
        return 'off'
    }
    return matchesModuleRef(row, new Set(text.split(',').map((entry) => entry.trim()))) ? 'integration' : 'off'
}
