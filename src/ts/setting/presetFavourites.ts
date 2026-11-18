import type { Database } from '../storage/database.svelte'
import { newPresetId } from '../storage/presetMeta'
import { currentFavourites, updateFavourites } from '../chatShell/toggleFavouritesStore.svelte'
import { sameRef, type FavouriteRef } from '../chatShell/toggleFavourites'

/**
 * Preset favourites use the device-local favourites list of the toggle panel (CHORE-566): a star on a preset is
 * `{s: 'preset', k: <preset id>}`. Keyed by id, a star follows its preset through reorder and rename. The list is never
 * part of the database, the `.bin` or a preset.
 */
export const PRESET_FAVOURITE_SOURCE = 'preset'

export const presetFavouriteRef = (id: string): FavouriteRef => ({ s: PRESET_FAVOURITE_SOURCE, k: id })

export function isPresetFavourite(items: readonly FavouriteRef[], id: string | undefined): boolean {
    if (!id) {
        return false
    }
    const ref = presetFavouriteRef(id)
    return items.some((item) => sameRef(item, ref))
}

/**
 * Stars or unstars the preset at `index`. A preset without an id is given one first, which is a database write the
 * caller's save picks up. Returns whether the preset is starred afterwards, or null when `index` names no preset.
 */
export function togglePresetFavourite(db: Pick<Database, 'botPresets'>, index: number): boolean | null {
    const preset = db.botPresets[index]
    if (!preset) {
        return null
    }
    preset.id ||= newPresetId()
    const ref = presetFavouriteRef(preset.id)
    const starred = isPresetFavourite(currentFavourites().items, preset.id)
    updateFavourites(starred ? { type: 'remove', ref } : { type: 'add', ref })
    return !starred
}
