import { language } from 'src/lang'
import { restorePersona } from 'src/ts/personaList'
import type { RisuPersona } from 'src/ts/storage/database.svelte'
import { DBState } from 'src/ts/stores.svelte'
import type { UndoAction } from 'src/ts/toast/toastHost.svelte'

/**
 * The Undo for a removed persona. It closes over a plain copy, the index and whether the persona was
 * in use, never a component or a reactive proxy. It re-reads the live list when it runs: it refuses
 * when an entry with the same id is back, otherwise `restorePersona` reinserts the copy with its id,
 * so chat bindings left dangling by the removal resolve again.
 */
export function personaUndoAction(copy: RisuPersona, index: number, wasActive: boolean): UndoAction {
    const kept: RisuPersona = safeStructuredClone(copy)
    return {
        id: 'persona:' + kept.id,
        failedText: language.settingsShellPersonaUndoFailed,
        run() {
            const outcome = restorePersona(DBState.db, kept, index, wasActive)
            if (outcome === 'present') {
                return { ok: false, text: language.settingsShellPersonaUndoRefused }
            }
            return { ok: true, text: language.settingsShellPersonaRestored }
        },
    }
}
