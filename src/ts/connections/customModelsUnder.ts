import { v4 } from 'uuid'
import type { Database } from 'src/ts/storage/database.svelte'
import { connectionById, isMalformedStore, isRecord, storedConnections, str } from './connections'

/*
 * Custom models under their connection. A model names its connection through the existing
 * `connectionId`; nothing here adds a stored field, so the `.bin` translation is unchanged.
 */

export type UnderModel = { id: string, name: string, internalId: string }

/** Only a `custom` connection owns models. */
export function ownsCustomModels(db: Database, connectionId: string): boolean {
    return connectionById(storedConnections(db), connectionId, 'custom') !== undefined
}

/** The models naming `connectionId`, in stored order. */
export function customModelsUnder(db: Database, connectionId: string): UnderModel[] {
    const models: unknown = db.customModels
    if (!Array.isArray(models)) return []
    const out: UnderModel[] = []
    for (const model of models) {
        if (isRecord(model) && model.connectionId === connectionId) {
            out.push({ id: str(model.id), name: str(model.name), internalId: str(model.internalId) })
        }
    }
    return out
}

/** Appends a blank model under the connection; returns its id, or null for a missing or non-custom connection. */
export function addCustomModelUnder(db: Database, connectionId: string): string | null {
    if (isMalformedStore(db) || !ownsCustomModels(db, connectionId)) return null
    const id = 'xcustom:::' + v4()
    db.customModels.push({ internalId: '', tokenizer: 0, format: 0, id, name: '', params: '', flags: [], connectionId })
    return id
}

/** Edits the name and the provider-side model id of one model under the connection. */
export function editCustomModelUnder(db: Database, connectionId: string, modelId: string, patch: { name?: string, internalId?: string }): boolean {
    const model = db.customModels.find((item) => item.id === modelId && item.connectionId === connectionId)
    if (!model) return false
    if (patch.name !== undefined) model.name = patch.name
    if (patch.internalId !== undefined) model.internalId = patch.internalId
    return true
}

/** Removes one model under the connection; a model of another connection is never touched. */
export function removeCustomModelUnder(db: Database, connectionId: string, modelId: string): boolean {
    const index = db.customModels.findIndex((item) => item.id === modelId && item.connectionId === connectionId)
    if (index < 0) return false
    db.customModels.splice(index, 1)
    return true
}
