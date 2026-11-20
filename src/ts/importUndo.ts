import { language } from 'src/lang'
import { markBootWrite } from './bootWindow'
import { restoreInProgress } from './drive/restoreInProgress'
import type { ImportCreated } from './importProgress'
import type { RisuModule } from './process/modules'
import type { character, Database, groupChat } from './storage/database.svelte'
import { DBState } from './stores.svelte'
import { postToast } from './toast/toastHost.svelte'

/**
 * What one import action created, kept in memory for its result card's Undo. Every entry is the exact reactive slot the
 * commit read in the same synchronous stretch as its write, so Undo finds it again by reference. Nothing is persisted.
 */
export interface ImportUndoRecord {
    /** The `DBState.db` object at the first commit; a replaced database (a restore) refuses the Undo. */
    root: Database | null
    characters: { slot: character | groupChat, chaId: string }[]
    modules: { slot: RisuModule, id: string }[]
    /** Why this action can offer no Undo: a Replace or a preset was part of it. */
    blocked: Set<'replace' | 'preset'>
    /** True once any round of the action went to the background. */
    backgrounded: boolean
}

export function createUndoRecord(): ImportUndoRecord {
    return { root: null, characters: [], modules: [], blocked: new Set(), backgrounded: false }
}

/** Notes one commit. A bare commit (no `created`) records nothing. */
export function recordCreated(record: ImportUndoRecord, created: ImportCreated | undefined): void {
    if (created === undefined) {
        return
    }
    if (created.kind === 'notUndoable') {
        record.blocked.add(created.why)
        return
    }
    record.root ??= DBState.db
    if (created.kind === 'character') {
        record.characters.push({ slot: created.slot, chaId: created.slot.chaId })
    } else {
        record.modules.push({ slot: created.slot, id: created.slot.id })
    }
}

/** A result card offers Undo while the action created something and nothing blocks it (MC-2572..2574). */
export function undoOffered(record: ImportUndoRecord): boolean {
    return record.characters.length + record.modules.length > 0 && record.blocked.size === 0 && !record.backgrounded
}

export type UndoResult = { trashed: number, removed: number, missing: number } | { refused: true }

function uniqueUntrashed(list: readonly (character | groupChat)[], chaId: string): character | groupChat | undefined {
    const matches = list.filter((c) => c.chaId === chaId && !c.trashTime)
    return matches.length === 1 ? matches[0] : undefined
}

/**
 * Undoes one action: its characters move to the Trash and its modules leave the module list, in one synchronous stretch
 * after the dynamic imports resolve. It refuses while a restore runs or after the database object was replaced. A slot
 * is found by reference; a character whose reference is gone falls back to the one untrashed slot with its chaId (an
 * archive or restore swap), and anything else counts as missing. No asset, inlay, unit or store call is made.
 */
export async function undoImport(record: ImportUndoRecord): Promise<UndoResult> {
    const { trashImportedCharacters } = await import('./characters')
    const { refreshModules } = await import('./process/modules')
    if (restoreInProgress() || DBState.db !== record.root) {
        return { refused: true }
    }
    markBootWrite()
    let missing = 0
    const listed = DBState.db.characters
    const targets: (character | groupChat)[] = []
    for (const entry of record.characters) {
        const found = listed.includes(entry.slot) ? entry.slot : uniqueUntrashed(listed, entry.chaId)
        if (found === undefined) {
            missing++
        } else if (!found.trashTime && !targets.includes(found)) {
            targets.push(found)
        }
    }
    const trashed = targets.length > 0 ? trashImportedCharacters(targets) : 0

    let removed = 0
    const removedIds = new Set<string>()
    for (const entry of record.modules) {
        const at = DBState.db.modules.indexOf(entry.slot)
        if (at === -1) {
            missing++
            continue
        }
        DBState.db.modules.splice(at, 1)
        removed++
        removedIds.add(entry.id)
    }
    if (removed > 0) {
        DBState.db.modules = DBState.db.modules
        for (const id of removedIds) {
            const enabled = DBState.db.enabledModules
            if (!DBState.db.modules.some((m) => m.id === id) && enabled.includes(id)) {
                enabled.splice(enabled.indexOf(id), 1)
                DBState.db.enabledModules = DBState.db.enabledModules
            }
        }
        refreshModules()
    }
    return { trashed, removed, missing }
}

/** The plain toast of MC-2576 for an Undo result, or the refusal. */
export function reportUndo(result: UndoResult): void {
    if ('refused' in result) {
        postToast({ kind: 'warning', text: language.importUndoRefused })
        return
    }
    postToast({ kind: 'info', text: language.importUndoDone(result.trashed, result.removed, result.missing) })
}
