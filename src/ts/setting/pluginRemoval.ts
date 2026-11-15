import { language } from 'src/lang'
import { fillLang } from 'src/lang/fill'
import type { RisuPlugin } from 'src/ts/plugins/plugins.svelte'
import { DBState } from 'src/ts/stores.svelte'
import type { UndoAction } from 'src/ts/toast/toastHost.svelte'

export interface RemovedPlugin {
    /** The identical entry object that was in the list, never a copy: its saved values travel with it. */
    entry: RisuPlugin
    index: number
    /** True when this removal cleared `currentPluginProvider` because the entry was the chosen provider. */
    clearedProvider: boolean
}

/**
 * Removes the entry the user aimed at. The entry is re-found by reference when this runs (after the confirm),
 * the list is reassigned through the database proxy so the plugins block is marked changed, and null means the
 * entry is no longer listed.
 */
export function removePluginEntry(target: RisuPlugin): RemovedPlugin | null {
    const plugins = DBState.db.plugins ?? []
    const index = plugins.indexOf(target)
    if (index === -1) {
        return null
    }
    const clearedProvider = DBState.db.currentPluginProvider === target.name
    if (clearedProvider) {
        DBState.db.currentPluginProvider = ''
    }
    plugins.splice(index, 1)
    DBState.db.plugins = plugins
    return { entry: target, index, clearedProvider }
}

/**
 * The Undo for a removed plugin. It re-reads the live list when it runs: it refuses when a plugin with the same
 * name is installed again, otherwise it reinserts the same entry object at its index (clamped) and restores the
 * provider only when this removal cleared it and nothing was chosen since. An enabled entry reloads the plugins.
 */
export function pluginRemovalUndoAction(removed: RemovedPlugin, reload: () => Promise<void>): UndoAction {
    const { entry, index, clearedProvider } = removed
    const name = entry.displayName ?? entry.name
    return {
        id: 'plugin-remove:' + entry.name,
        failedText: language.pluginsPage.undoFailed,
        async run() {
            const list = DBState.db.plugins ?? []
            if (list.some((plugin) => plugin.name === entry.name)) {
                return { ok: false, text: fillLang(language.pluginsPage.undoRefused, { name }) }
            }
            const at = Math.min(index, list.length)
            DBState.db.plugins = [...list.slice(0, at), entry, ...list.slice(at)]
            if (clearedProvider && DBState.db.currentPluginProvider === '') {
                DBState.db.currentPluginProvider = entry.name
            }
            if (entry.enabled) {
                try {
                    await reload()
                } catch (error) {
                    console.warn('Failed to reload plugins after restoring a plugin:', error)
                }
            }
            return { ok: true, text: fillLang(language.pluginsPage.restored, { name }) }
        },
    }
}
