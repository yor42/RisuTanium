// The only Studio file that reads the database for the owner model and for item text. (The screen store and the
// switch read the selected character's id and eligibility only.) It hands plain readers to the pure owner model
// and never writes: no database write, no save mark, no module load. A module slot is passed as the app holds
// it; the model reads a stub through its marker and reference fields only.
import { fromStore } from 'svelte/store'
import { DBState, ReloadGUIPointer, selIdState } from '../stores.svelte'
import { moduleListOf } from '../process/moduleRefList'
import { workingPresetsOf, type ItemTextSources } from './itemText'
import { buildOwnerModel, type OwnerModel, type PresetSource } from './ownerModel'

export interface OwnerSnapshot {
    /** Null when the bound character is no longer the selected, readable character. */
    model: OwnerModel | null
    /** Counts every re-derivation, so a running search can tell its model went stale. */
    version: number
}

// The selected character when it is the one the visit is bound to and is readable; null otherwise.
function boundCharacterOf(chaId: string) {
    const character = DBState.db.characters?.[selIdState.selId]
    if (!character || character.type === 'group' || character.coldstorage || character.chaId !== chaId) return null
    return character
}

/**
 * The plain fields item text is read from: the character the visit is bound to, the resident module rows and
 * the working presets. Null when the bound character is not the selected, readable one.
 */
export function readTextSources(chaId: string): ItemTextSources | null {
    const character = boundCharacterOf(chaId)
    if (!character) return null
    const db = DBState.db
    return { character, modules: db.modules ?? [], presets: workingPresetsOf(db) }
}

/**
 * Reads the model for the character bound to the visit. The character is the selected one: a visit is bound to
 * a `chaId`, and a different or unusable selection yields null instead of the other character's content.
 * The context chat is re-read from the character on every call.
 */
export function readOwnerModel(chaId: string): OwnerModel | null {
    const db = DBState.db
    const character = boundCharacterOf(chaId)
    if (!character) return null

    const stored = Array.isArray(db.botPresets) ? db.botPresets : []
    // The active preset's stored entry lags the working settings; the working values are what the engine merges.
    const presets: PresetSource[] = stored.map((preset, index) => index === db.botPresetsId
        ? { name: preset.name, regex: db.presetRegex, toggles: db.customPromptTemplateToggle }
        : { name: preset.name, regex: preset.regex, toggles: preset.customPromptTemplateToggle })

    return buildOwnerModel({
        character,
        presets,
        activePreset: db.botPresetsId,
        plugins: db.plugins ?? [],
        modules: db.modules ?? [],
        enabledModules: db.enabledModules,
        moduleIntergration: db.moduleIntergration,
        personas: db.personas,
        lister: moduleListOf,
    })
}

/**
 * A reactive model of the bound character. It re-derives when the GUI reload pointer moves, when a module slot is
 * replaced or a row's id or namespace changes (read through `moduleListOf`), or when the character's chat page moves.
 */
export function createOwnerSource(chaId: () => string): { readonly current: OwnerSnapshot } {
    const reload = fromStore(ReloadGUIPointer)
    let version = 0
    const snapshot = $derived.by((): OwnerSnapshot => {
        void reload.current
        const model = readOwnerModel(chaId())
        version += 1
        return { model, version }
    })
    return {
        get current() { return snapshot },
    }
}
