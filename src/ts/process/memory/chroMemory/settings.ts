export interface LtmSettings {
    budgetTokens: number
}

/** The most tokens a recalled-memory block may take by default. */
export const BUDGET_CAP_TOKENS = 2400

export function defaultBudgetTokens(maxContext: number): number {
    return Number.isFinite(maxContext) && maxContext > 0 ? Math.min(BUDGET_CAP_TOKENS, Math.floor(0.15 * maxContext)) : BUDGET_CAP_TOKENS
}

/**
 * Reads the persisted settings without touching them: unknown keys stay where
 * they are and a bad shape reads as the defaults. Nothing is written back.
 */
export function readLtmSettings(raw: unknown, maxContext: number): LtmSettings {
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
        const budget = (raw as { budgetTokens?: unknown }).budgetTokens
        if (typeof budget === 'number' && Number.isInteger(budget) && budget > 0) {
            return { budgetTokens: budget }
        }
    }
    return { budgetTokens: defaultBudgetTokens(maxContext) }
}
