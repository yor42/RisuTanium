import { language } from 'src/lang'
import type { SalvageOmittedBlock } from '../storage/risuSave'

/**
 * The lines of a partial-backup confirm: every character and kind the intact
 * tree lacks. A character is named by `names` (chaId to display name) when the
 * caller knows it, and by its block name otherwise. Empty when nothing the
 * person cares about was left out.
 */
export function describeOmitted(omitted: ReadonlyMap<string, SalvageOmittedBlock>, names?: ReadonlyMap<string, string>): string[] {
    const lines: string[] = []
    const kinds = new Set<string>()
    let unreadable = 0
    for (const [blockName, block] of omitted) {
        switch (block.kind) {
            case 'character':
                lines.push(names?.get(blockName) ?? blockName)
                break
            case 'other':
                unreadable++
                break
            case 'ignored':
                break
            default:
                kinds.add(block.kind)
        }
    }
    if (kinds.has('presets')) lines.push(language.internalBackupLeftOutPresets)
    if (kinds.has('modules')) lines.push(language.internalBackupLeftOutModules)
    if (kinds.has('loadouts')) lines.push(language.internalBackupLeftOutLoadouts)
    if (kinds.has('plugins')) lines.push(language.internalBackupLeftOutPlugins)
    if (kinds.has('pluginStorage')) lines.push(language.internalBackupLeftOutPluginData)
    if (unreadable > 0) lines.push(`${unreadable} ${language.internalBackupLeftOutUnreadable}`)
    return lines
}

/**
 * The lines of a read-only legacy page's partial notice and its export prompt: characters are counted, never named
 * (a block name is not a name the person knows), then each kind that is missing in `describeOmitted`'s order, then the
 * count of parts this version cannot read. Empty exactly when nothing the person cares about was left out: the ignored
 * config block gives no line.
 */
export function describeOmittedCounts(omitted: ReadonlyMap<string, SalvageOmittedBlock>): string[] {
    const lines: string[] = []
    const kinds = new Set<string>()
    let characters = 0
    let unreadable = 0
    for (const block of omitted.values()) {
        switch (block.kind) {
            case 'character':
                characters++
                break
            case 'other':
                unreadable++
                break
            case 'ignored':
            case 'chats':
                break
            default:
                kinds.add(block.kind)
        }
    }
    if (characters > 0) lines.push(language.legacyPartialCharacters(characters))
    if (kinds.has('presets')) lines.push(language.internalBackupLeftOutPresets)
    if (kinds.has('modules')) lines.push(language.internalBackupLeftOutModules)
    if (kinds.has('loadouts')) lines.push(language.internalBackupLeftOutLoadouts)
    if (kinds.has('plugins')) lines.push(language.internalBackupLeftOutPlugins)
    if (kinds.has('pluginStorage')) lines.push(language.internalBackupLeftOutPluginData)
    if (unreadable > 0) lines.push(language.legacyPartialUnreadable(unreadable))
    return lines
}
