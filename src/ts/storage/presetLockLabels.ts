import { language } from '../../lang'
import { lockedGroups, type LockHost } from './presetLocks'

/** The name a page shows for a lock group. */
export function lockLabel(id: string): string {
    switch (id) {
        case 'auxModels': return language.presetLockAuxModels
        case 'fallbackModels': return language.presetLockFallbackModels
        case 'separateParameters': return language.presetLockSeparateParameters
        case 'sampling': return language.presetLockSampling
        case 'reasoning': return language.presetLockReasoning
        default: return id
    }
}

/** The locked groups' names, comma separated, in registry order; empty when no group is locked. */
export function keptGroupsText(host: LockHost): string {
    return lockedGroups(host).map(group => lockLabel(group.id)).join(', ')
}
