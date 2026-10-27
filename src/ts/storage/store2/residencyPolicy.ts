import { isUsableCharacterId } from '../characterIds'
import { matchesModuleRef, referencedModuleIds } from '../../process/moduleRefs'
import { moduleHandles, uniqueIdHandles } from './codec/modules'
import { stubEligible } from './codec/split'
import type { ListDerivation } from './codec/types'
import type { ResidentPlanInput } from './treeBytes'

/**
 * Which entities are resident at boot: the `u` of every entry whose units the boot reads and whose character is
 * assembled whole. Every other entry becomes a stub that names its units and reads none of them.
 *
 * With archiving off, or when the setting cannot be read, everything is resident. Otherwise an entity is resident
 * when it cannot be told apart from another by its `chaId`: the id is empty or not a string, starts with the `§` of a
 * hidden character, cannot name a block, or is held by two entries (a stub is matched to its entry by id).
 */
export function residentSetOf(input: ResidentPlanInput): ReadonlySet<string> {
    const everything = new Set(input.entries.map(entry => entry.u))
    if (input.config === null || input.config.archiveCharacters === false) {
        return everything
    }
    const holders = new Map<string, number>()
    for (const entry of input.entries) {
        if (typeof entry.chaId === 'string') {
            holders.set(entry.chaId, (holders.get(entry.chaId) ?? 0) + 1)
        }
    }
    const resident = new Set<string>()
    for (const entry of input.entries) {
        const chaId: unknown = entry.chaId
        if (typeof chaId !== 'string' || chaId.length === 0 || chaId.startsWith('§') || !isUsableCharacterId(chaId) || holders.get(chaId) !== 1) {
            resident.add(entry.u)
        }
    }
    return resident
}

function isStringList(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string')
}

/**
 * Which modules are resident at boot: the handles (`moduleHandles` over the index) of every module the boot assembles
 * whole. Every other module becomes the stub its index entry stands for and none of its units is read. `null` means
 * every module is resident: no index, no readable config, archiving off, or a global reference list that cannot be read.
 *
 * A module stays resident when the global lists name it (`enabledModules`, `moduleIntergration`, matched as the trigger
 * and the exit net match them) or when the save encoder could not carry its stub (`stubEligible` over the whole index),
 * so a minted stub is always carriable. The selected character and chat, always-resident characters' module lists,
 * personas, loadouts and presets are deliberately not consulted: a later selection loads what it needs.
 */
export function residentModuleHandlesOf(
    input: Pick<ResidentPlanInput, 'modules' | 'config'>, versions: ListDerivation['moduleListVersions'],
): ReadonlySet<string> | null {
    const { modules, config } = input
    if (modules === undefined || config === null || config.archiveCharacters === false) {
        return null
    }
    const enabled: unknown = config.enabledModules
    const integration: unknown = config.moduleIntergration
    const enabledList = enabled === undefined ? [] : isStringList(enabled) ? enabled : null
    const integrationText = integration === undefined ? '' : typeof integration === 'string' ? integration : null
    if (enabledList === null || integrationText === null) {
        return null
    }
    const referenced = new Set(referencedModuleIds({ enabledModules: enabledList, moduleIntergration: integrationText }))
    const stubbable = uniqueIdHandles(modules)
    const handles = moduleHandles(modules)
    const resident = new Set<string>()
    modules.forEach((entry, position) => {
        if (matchesModuleRef(entry, referenced) || !stubEligible(entry, stubbable, versions)) {
            resident.add(handles[position])
        }
    })
    return resident
}
