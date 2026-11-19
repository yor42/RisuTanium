import { presetTemplate, type botPreset, type Database } from './database.svelte'
import { freshPresetMeta } from './presetMeta'

/**
 * The Default preset a profile without a preset list gets, as `setDatabase` makes it. The construction the restore
 * completion and the legacy conversion share; each call returns a fresh clone.
 */
export function makeDefaultPreset(): botPreset {
    return freshPresetMeta({ ...JSON.parse(JSON.stringify(presetTemplate)), name: 'Default' }, { keepFolder: false })
}

/**
 * Gives a decoded backup the containers the encoder reads: a backup from an
 * older build may lack a list, and a missing preset list would be written as an
 * empty block, which the strict decode at the next start reports as damage. A
 * missing preset list becomes the default preset, as `setDatabase` makes it.
 * Every whole-state write of a tree decoded from a backup calls this first.
 */
export function completeRestoredTree(tree: Database): void {
    tree.characters ??= []
    tree.modules ??= []
    tree.loadouts ??= []
    tree.plugins ??= []
    if (!Array.isArray(tree.botPresets)) {
        tree.botPresets = [makeDefaultPreset()]
    }
}
