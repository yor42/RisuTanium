import { SWEEP_AUTO_LIMIT } from './params'

/**
 * The automatic-sweep limit decision. A backend reports how many files `assets/`
 * holds, or that it cannot (an old server, an unrecognised answer): an unknown
 * count is treated as over the limit, so the sweep then runs only from the
 * Settings button.
 */

export type AssetCount = number | 'unknown'

export interface AutoSweepDecision {
    auto: boolean
    reason: 'within-limit' | 'over-limit' | 'unknown-count'
}

export function decideAutoSweep(count: AssetCount, limit: number = SWEEP_AUTO_LIMIT): AutoSweepDecision {
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
        return { auto: false, reason: 'unknown-count' }
    }
    return count <= limit ? { auto: true, reason: 'within-limit' } : { auto: false, reason: 'over-limit' }
}
