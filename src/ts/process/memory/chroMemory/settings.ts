import type { Database } from 'src/ts/storage/database.svelte'

export interface LtmSettings {
    budgetTokens: number
    /** Run the engine without injecting; only an explicit `true` turns it on. */
    shadow: boolean
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
        const { budgetTokens, shadow } = raw as { budgetTokens?: unknown, shadow?: unknown }
        return {
            budgetTokens: normalizeBudgetInput(budgetTokens) ?? defaultBudgetTokens(maxContext),
            shadow: shadow === true,
        }
    }
    return { budgetTokens: defaultBudgetTokens(maxContext), shadow: false }
}

/** A positive integer, else null: any other value is treated as no budget set, as the reader does. */
export function normalizeBudgetInput(v: unknown): number | null {
    return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null
}

/** The stored budget when it is a positive integer, else null (the input shows blank). */
export function budgetInputValue(raw: unknown): number | null {
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
        return normalizeBudgetInput((raw as { budgetTokens?: unknown }).budgetTokens)
    }
    return null
}

/**
 * The only writer of `ltmSettings`; call it from a user action only, never from
 * a reader, getter or mount. An object is replaced by a copy that keeps every
 * unknown key, and `budgetTokens: null` removes the key (blank means automatic).
 * A value that is not an object is replaced by the patch alone.
 */
export function writeLtmSettings(
    db: Pick<Database, 'ltmSettings'>,
    patch: { shadow?: boolean, budgetTokens?: number | null },
): void {
    const set: { shadow?: boolean, budgetTokens?: number } = {}
    if (patch.shadow !== undefined) set.shadow = patch.shadow
    if (typeof patch.budgetTokens === 'number') set.budgetTokens = patch.budgetTokens
    const old = db.ltmSettings
    if (typeof old === 'object' && old !== null && !Array.isArray(old)) {
        const next: Record<string, unknown> = { ...old, ...set }
        if (patch.budgetTokens === null) delete next.budgetTokens
        db.ltmSettings = next
    } else {
        db.ltmSettings = set
    }
}
