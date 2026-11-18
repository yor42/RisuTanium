import type { TokenUsage, UsageMeterState } from './usageTypes'

/**
 * One meter per request attempt. It sums every reported response (tool rounds
 * of one attempt add up) and carries a failed flag for attempts that ended in a
 * provider failure; `reported()` returns a copy.
 */
export function createUsageMeter(): UsageMeterState {
    let total: TokenUsage | null = null
    let failed = false
    return {
        report(usage: TokenUsage): void {
            total = {
                input: (total?.input ?? 0) + usage.input,
                output: (total?.output ?? 0) + usage.output,
                cacheRead: (total?.cacheRead ?? 0) + usage.cacheRead,
                cacheWrite: (total?.cacheWrite ?? 0) + usage.cacheWrite,
            }
        },
        markFailed(): void {
            failed = true
        },
        reported(): TokenUsage | null {
            return total === null ? null : { ...total }
        },
        failed(): boolean {
            return failed
        },
    }
}
