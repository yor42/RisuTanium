// Pure presentation rules for the shell Display page. Every function maps between a stored
// database value and what the page shows; none of them reads or writes the database.

const DEFAULT_ANIMATION_SPEED = 0.4
const MAX_ASSET_WIDTH_REM = 40
const DEFAULT_CUSTOM_ASSET_WIDTH_REM = 20

function round2(value: number): number {
    return Math.round(value * 100) / 100
}

function clampUnit(value: number): number {
    return Math.min(1, Math.max(0, value))
}

/** The page shows a slow-to-fast position; the stored animationSpeed is a duration in seconds. */
export function animationPositionOf(stored: number | undefined): number {
    const seconds = typeof stored === 'number' && Number.isFinite(stored) ? stored : DEFAULT_ANIMATION_SPEED
    return clampUnit(round2(1 - seconds))
}

/** Inverse of animationPositionOf: the duration written back for a slider position, to 2 decimals. */
export function storedAnimationOf(position: number): number {
    return clampUnit(round2(1 - position))
}

export type AssetWidthMode = 'unlimited' | 'hidden' | 'custom'

/** assetWidth is one number: -1 unlimited, 0 hidden, otherwise a width in rem. */
export function assetWidthModeOf(stored: number | undefined): AssetWidthMode {
    if (typeof stored !== 'number' || !Number.isFinite(stored) || stored === -1) {
        return 'unlimited'
    }
    return stored === 0 ? 'hidden' : 'custom'
}

/** The value to store for a mode; the custom mode reuses the last custom width when it is usable. */
export function assetWidthFor(mode: AssetWidthMode, lastCustom?: number): number {
    if (mode === 'unlimited') {
        return -1
    }
    if (mode === 'hidden') {
        return 0
    }
    const usable =
        typeof lastCustom === 'number' &&
        Number.isFinite(lastCustom) &&
        lastCustom > 0 &&
        lastCustom <= MAX_ASSET_WIDTH_REM
    return usable ? lastCustom : DEFAULT_CUSTOM_ASSET_WIDTH_REM
}

/** Block-quote styling only runs while quote styling is on, so the row is dimmed otherwise. */
export function blockquoteDimmed(unformatQuotes: boolean): boolean {
    return unformatQuotes === true
}

/** Showing first-message pages only matters while swipe is on. */
export function firstMessagePagesDimmed(swipe: boolean): boolean {
    return swipe !== true
}

export type SizeStepKey =
    | 'tiniest'
    | 'tinier'
    | 'tiny'
    | 'smaller'
    | 'small'
    | 'default'
    | 'big'
    | 'bigger'
    | 'huge'
    | 'huger'
    | 'hugest'

const SIZE_STEP_KEYS: readonly SizeStepKey[] = [
    'tiniest',
    'tinier',
    'tiny',
    'smaller',
    'small',
    'default',
    'big',
    'bigger',
    'huge',
    'huger',
    'hugest',
]

const SIZE_STEP_ZERO_INDEX = 5

/** Stable key for a named size step in -5..5; anything else is the default step. */
export function sizeStepKeyOf(step: number): SizeStepKey {
    if (!Number.isInteger(step) || step < -5 || step > 5) {
        return 'default'
    }
    return SIZE_STEP_KEYS[step + SIZE_STEP_ZERO_INDEX]
}

/**
 * Display fields with no reader. They are not on the page and not searchable; their stored
 * values stay untouched.
 */
export const DEAD_DISPLAY_IDS: ReadonlySet<string> = new Set([
    'display.showMemoryLimit',
    'display.memoryLimitThickness',
])

/** Ids left out of search: the dead Display fields plus the dead Accessibility field. */
export const SEARCH_EXCLUDED_IDS: ReadonlySet<string> = new Set([
    ...DEAD_DISPLAY_IDS,
    'acc.moveInsteadOfCopyOnCMPConvert',
])

/** The stored default for customQuotesData, used when the stored boxes are missing. */
export const CURLY_QUOTES: readonly [string, string, string, string] = ['“', '”', '‘', '’']
