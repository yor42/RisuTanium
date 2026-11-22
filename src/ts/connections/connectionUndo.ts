import { DBState } from 'src/ts/stores.svelte'
import type { UndoAction } from 'src/ts/toast/toastHost.svelte'
import { restoreConnection, type RemovedConnection } from './connectionEditor'

export type ConnectionUndoTexts = { restored: string, refused: string, failed: string }

/**
 * The Undo for a deleted connection, after `personaUndoAction`. It closes over a plain copy rebuilt
 * from the whitelisted snapshot fields, so it holds no key, and it re-reads the live store when it
 * runs. The key is never restored: the connection returns empty and its card asks for the key again.
 */
export function connectionUndoAction(removed: RemovedConnection, texts: ConnectionUndoTexts): UndoAction {
    const { snapshot, index, refs } = removed
    const kept: RemovedConnection = {
        snapshot: {
            id: snapshot.id,
            name: snapshot.name,
            provider: snapshot.provider,
            ...(snapshot.url !== undefined ? { url: snapshot.url } : {}),
        },
        index,
        refs: { presetIds: [...refs.presetIds], working: refs.working, modelIds: [...refs.modelIds] },
    }
    return {
        id: 'connection:' + kept.snapshot.id,
        failedText: texts.failed,
        run() {
            const outcome = restoreConnection(DBState.db, kept)
            if (outcome === 'restored') {
                return { ok: true, text: texts.restored }
            }
            return { ok: false, text: outcome === 'malformed' ? texts.failed : texts.refused }
        },
    }
}
