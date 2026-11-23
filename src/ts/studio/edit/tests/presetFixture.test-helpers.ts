// Shared by the preset owner tests: presets are minted the way the product mints them (assignPresetIds at load,
// freshPresetMeta at a creation site) and the keyless slot is built exactly like importPreset's NAI branch builds
// it. The caller replaces `src/ts/stores.svelte` with a `$state` DBState.

import { DBState } from 'src/ts/stores.svelte'
import type { Database, botPreset } from 'src/ts/storage/database.svelte'
import { assignPresetIds, freshPresetMeta } from 'src/ts/storage/presetMeta'
import { prebuiltPresets } from 'src/ts/process/templates/templates'
import { safeStructuredClone } from 'src/ts/polyfill'

// A preset that carries a toggle text; the id is minted by `seedPresetDb`.
export function presetNamed(name: string, toggle?: unknown): botPreset {
    const preset = { name, mainPrompt: `${name} prompt` } as unknown as botPreset
    if (toggle !== undefined) {
        Object.assign(preset, { customPromptTemplateToggle: toggle })
    }
    return preset
}

// The slot importPreset's NAI branch creates: it carries no `customPromptTemplateToggle` key.
export function keylessPreset(name = 'Keyless'): botPreset {
    const preset = freshPresetMeta(safeStructuredClone(prebuiltPresets.NAI), { keepFolder: false })
    preset.name = name
    return preset
}

// Replaces the page database with one holding `presets`, the one at `activeIndex` active, and `working` as the
// working setting. Returns the ids the presets hold afterwards, in order.
export function seedPresetDb(presets: botPreset[], activeIndex: number, working = ''): string[] {
    DBState.db = {
        characters: [],
        modules: [],
        botPresets: presets,
        botPresetsId: activeIndex,
        customPromptTemplateToggle: working,
        mainPrompt: 'working prompt',
        apiType: 'working-api',
        temperature: 77,
        NAIsettings: {},
        personas: [],
        selectedPersona: 0,
        enabledModules: [],
        globalChatVariables: {},
    } as unknown as Database
    assignPresetIds(DBState.db)
    return DBState.db.botPresets.map((preset) => preset.id as string)
}

export function slotText(index: number): unknown {
    return DBState.db.botPresets[index].customPromptTemplateToggle
}
