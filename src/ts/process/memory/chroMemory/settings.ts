import type { Database } from 'src/ts/storage/database.svelte'

export interface LtmSettings {
    budgetTokens: number
    /** Run the engine without injecting; only an explicit `true` turns it on. */
    shadow: boolean
    /** Recall lore entries the scan did not activate; only an explicit boolean is read. */
    searchLore: boolean
    /** The most tokens recalled lore may take in one send. */
    loreRecallCap: number
}

/** The most tokens a recalled-memory block may take by default. */
export const BUDGET_CAP_TOKENS = 2400

/** Lore recall ships off until the S4 usefulness gate passes. */
export const SEARCH_LORE_DEFAULT = false

/** The default ceiling on recalled lore tokens per send. */
export const LORE_RECALL_CAP_DEFAULT = 5000

export function defaultBudgetTokens(maxContext: number): number {
    return Number.isFinite(maxContext) && maxContext > 0 ? Math.min(BUDGET_CAP_TOKENS, Math.floor(0.15 * maxContext)) : BUDGET_CAP_TOKENS
}

/**
 * Reads the persisted settings without touching them: unknown keys stay where
 * they are and a bad shape reads as the defaults. Nothing is written back.
 */
export function readLtmSettings(raw: unknown, maxContext: number): LtmSettings {
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
        const { budgetTokens, shadow, searchLore, loreRecallCap } = raw as { budgetTokens?: unknown, shadow?: unknown, searchLore?: unknown, loreRecallCap?: unknown }
        return {
            budgetTokens: normalizeBudgetInput(budgetTokens) ?? defaultBudgetTokens(maxContext),
            shadow: shadow === true,
            searchLore: typeof searchLore === 'boolean' ? searchLore : SEARCH_LORE_DEFAULT,
            loreRecallCap: normalizeBudgetInput(loreRecallCap) ?? LORE_RECALL_CAP_DEFAULT,
        }
    }
    return { budgetTokens: defaultBudgetTokens(maxContext), shadow: false, searchLore: SEARCH_LORE_DEFAULT, loreRecallCap: LORE_RECALL_CAP_DEFAULT }
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

/** The stored lore recall cap when it is a positive integer, else null (the input shows blank). */
export function loreRecallCapInputValue(raw: unknown): number | null {
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
        return normalizeBudgetInput((raw as { loreRecallCap?: unknown }).loreRecallCap)
    }
    return null
}

/**
 * The only writer of `ltmSettings`; call it from a user action only, never from
 * a reader, getter or mount. An object is replaced by a copy that keeps every
 * unknown key, and `budgetTokens: null` or `loreRecallCap: null` removes the key
 * (blank means automatic). A value that is not an object is replaced by the patch alone.
 */
export function writeLtmSettings(
    db: Pick<Database, 'ltmSettings'>,
    patch: { shadow?: boolean, budgetTokens?: number | null, searchLore?: boolean, loreRecallCap?: number | null },
): void {
    const set: { shadow?: boolean, budgetTokens?: number, searchLore?: boolean, loreRecallCap?: number } = {}
    if (patch.shadow !== undefined) set.shadow = patch.shadow
    if (typeof patch.budgetTokens === 'number') set.budgetTokens = patch.budgetTokens
    if (patch.searchLore !== undefined) set.searchLore = patch.searchLore
    if (typeof patch.loreRecallCap === 'number') set.loreRecallCap = patch.loreRecallCap
    const old = db.ltmSettings
    if (typeof old === 'object' && old !== null && !Array.isArray(old)) {
        const next: Record<string, unknown> = { ...old, ...set }
        if (patch.budgetTokens === null) delete next.budgetTokens
        if (patch.loreRecallCap === null) delete next.loreRecallCap
        db.ltmSettings = next
    } else {
        db.ltmSettings = set
    }
}
