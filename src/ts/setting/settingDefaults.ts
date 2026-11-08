import type { Database } from '../storage/database.svelte'

/** A stored default that can be compared by identity. */
export type DefaultValue = string | number | boolean

/**
 * The value a fresh profile holds for each Display field, as `setDatabase` fills it. Only fields it fills have an
 * entry: a field without a known default shows no changed-from-default marker. The table is explicit because
 * `setDatabase` writes as it normalises and cannot be called to ask for a default.
 */
const DISPLAY_DEFAULTS: Readonly<Partial<Record<keyof Database, DefaultValue>>> = {
    theme: '',
    waifuWidth: 100,
    waifuWidth2: 100,
    colorSchemeName: 'default',
    textTheme: 'standard',
    font: 'default',
    customFont: '',
    zoomsize: 100,
    lineHeight: 1.25,
    iconsize: 100,
    textAreaSize: 0,
    textAreaTextSize: 0,
    sideBarSize: 0,
    assetWidth: -1,
    animationSpeed: 0.4,
    settingsCloseButtonSize: 24,
    fullScreen: false,
    showFirstMessagePages: false,
    playMessage: false,
    showSavingIcon: false,
    showPromptComparison: false,
    hideAllImages: false,
    hideApiKey: true,
    unformatQuotes: false,
    customQuotes: false,
    customCSS: '',
}

/** The default of a Display field, or undefined when none is known. */
export function defaultOf(field: keyof Database): DefaultValue | undefined {
    return DISPLAY_DEFAULTS[field]
}

/** The fields that have a known default. */
export function fieldsWithDefault(): (keyof Database)[] {
    return (Object.keys(DISPLAY_DEFAULTS) as (keyof Database)[])
}

/**
 * Whether `value` differs from the field's default. A field without a known default never counts as changed, so it
 * shows no marker.
 */
export function changedFromDefault(field: keyof Database, value: unknown): boolean {
    const known = defaultOf(field)
    if (known === undefined) return false
    return !Object.is(known, value)
}
