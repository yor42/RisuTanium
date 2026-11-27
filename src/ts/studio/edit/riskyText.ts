// The wording of the three risky flags of a character, read from the locale when asked so a language change shows at
// once, and the name a module's Low Level Access question gives the module.

import { language } from '../../../lang'
import { DBState } from '../../stores.svelte'
import { moduleRowOf } from '../assets/openModuleForm.svelte'
import { parseOwnerKey, type OwnerKey } from '../history/ownerPhase'
import { characterFlagOf, type CharacterRiskyFixPath, type CharacterRiskyFlagPath } from './riskyFlags'

/**
 * The name the confirm sheet gives a module: its stored name while that is a non-blank string, else the plural module
 * label the tree falls back to. Read when the sheet opens, from the owner's own row.
 */
export function lowLevelAskName(owner: OwnerKey): string {
    const parsed = parseOwnerKey(owner)
    if (parsed === null || parsed.kind !== 'module') return language.modules
    const row = moduleRowOf(DBState.db.modules, parsed.moduleId)
    // A stored name may be of another type; only a string is shown.
    const name = row === null ? undefined : DBState.db.modules[row.index]?.name
    return typeof name === 'string' && name.trim() !== '' ? name : language.modules
}

export function riskyNameOf(flag: CharacterRiskyFlagPath | CharacterRiskyFixPath): string {
    const path = characterFlagOf(flag)
    switch (path) {
        case 'lowLevelAccess': return language.lowLevelAccess
        case 'utilityBot': return language.utilityBot
        case 'escapeOutput': return language.escapeOutput
    }
}

export function riskyExplainOf(flag: CharacterRiskyFlagPath | CharacterRiskyFixPath): string {
    const path = characterFlagOf(flag)
    switch (path) {
        case 'lowLevelAccess': return language.help.lowLevelAccess
        case 'utilityBot': return language.help.utilityBot
        case 'escapeOutput': return language.studioRiskyEscapeExplain
    }
}

export function riskyAskOf(flag: CharacterRiskyFlagPath | CharacterRiskyFixPath): string {
    const path = characterFlagOf(flag)
    switch (path) {
        case 'lowLevelAccess': return language.studioRiskyAskLow
        case 'utilityBot': return language.studioRiskyAskUtility
        case 'escapeOutput': return language.studioRiskyAskEscape
    }
}
