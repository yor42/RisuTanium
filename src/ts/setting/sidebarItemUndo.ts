import { language } from 'src/lang'
import { fillLang } from 'src/lang/fill'
import type { CustomSideBarItem } from 'src/ts/storage/database.svelte'
import { DBState } from 'src/ts/stores.svelte'
import type { UndoAction } from 'src/ts/toast/toastHost.svelte'

/**
 * Removes the custom sidebar item with this id by reassigning the list, the shape the dialog's Delete always
 * used. Returns a plain copy of the item and the index it had, or null when no item has that id. The copy is
 * taken before the reassignment so the restored item never aliases a reactive proxy.
 */
export function removeSidebarItem(id: string): { item: CustomSideBarItem, index: number } | null {
    const list = DBState.db.customSidebarItems ?? []
    const index = list.findIndex((entry) => entry.id === id)
    if (index < 0) {
        return null
    }
    const item = { ...list[index] }
    DBState.db.customSidebarItems = list.filter((entry) => entry.id !== id)
    return { item, index }
}

/**
 * The Undo for a removed sidebar item. It re-reads the live list when it runs: it refuses when an entry with
 * the same id is back, otherwise it reinserts a copy at the original index (clamped to the current length) by
 * reassigning the list. It closes over the copy, the index and the store only, never a component.
 */
export function sidebarItemUndoAction(item: CustomSideBarItem, index: number): UndoAction {
    const kept: CustomSideBarItem = { ...item }
    return {
        id: 'sidebar-item:' + kept.id,
        failedText: language.othersUi.sidebarItemUndoFailed,
        run() {
            const list = DBState.db.customSidebarItems ?? []
            if (list.some((entry) => entry.id === kept.id)) {
                return { ok: false, text: fillLang(language.othersUi.sidebarItemUndoRefused, { name: kept.label }) }
            }
            const at = Math.min(index, list.length)
            DBState.db.customSidebarItems = [...list.slice(0, at), { ...kept }, ...list.slice(at)]
            return { ok: true, text: fillLang(language.othersUi.sidebarItemRestored, { name: kept.label }) }
        },
    }
}
