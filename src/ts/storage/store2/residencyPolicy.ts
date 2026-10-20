import { isUsableCharacterId } from '../characterIds'
import type { ResidentPlanInput } from './treeBytes'

/**
 * Which entities are resident at boot: the `u` of every entry whose units the boot reads and whose character is
 * assembled whole. Every other entry becomes a stub that names its units and reads none of them.
 *
 * With archiving off, or when the setting cannot be read, everything is resident. Otherwise an entity is resident
 * when it cannot be told apart from another by its `chaId`: the id is empty or not a string, starts with the `§` of a
 * hidden character, cannot name a block, or is held by two entries (a stub is matched to its entry by id). An enabled
 * V2.1 plugin does not change the set: it needs every character in memory, which `loadPlugins` provides by loading
 * the stubs before any plugin code runs.
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
