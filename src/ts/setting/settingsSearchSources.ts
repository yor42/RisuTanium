import { SEARCH_EXCLUDED_IDS } from '../settingsShell/displayPresentation'
import { orderedPages } from '../settingsShell/settingsPages'
import { accessibilitySettingsItems } from './accessibilitySettingsData'
import { advancedSettingsItems } from './advancedSettingsData'
import { basicParameterItems, modelSpecificParameterItems, penaltyParameterItems, samplingParameterItems, seedSetting } from './botSettingsParamsData'
import { chatFormatSettingsItems } from './chatFormatSettingsData'
import { displayShellItems } from './displayShellSettingsData'
import { displaySettingsItems } from './displaySettingsData.svelte'
import { languageSettingsItems } from './languageSettingsData.svelte'
import type { SearchSource } from './settingsSearch'
import type { SettingContext, SettingItem } from './types'

/**
 * Where the legacy setting lists are found in the new Settings screen. Each list opens one view; only the Display
 * list names a row, because the Display page marks its rows. The page and view of an index come from
 * `settingsPages`, so this table names only the legacy index.
 */
export interface LegacyListTarget {
    readonly name: string
    readonly items: readonly SettingItem[]
    readonly index: number
    /** Whether a result opens the row itself rather than the view. */
    readonly rows: boolean
}

export function legacyListTargets(): readonly LegacyListTarget[] {
    return [
        { name: 'accessibility', items: accessibilitySettingsItems, index: 11, rows: false },
        { name: 'advanced', items: advancedSettingsItems, index: 6, rows: false },
        { name: 'language', items: languageSettingsItems, index: 10, rows: false },
        { name: 'basicParameters', items: basicParameterItems, index: 1, rows: false },
        { name: 'seed', items: [seedSetting], index: 1, rows: false },
        { name: 'samplingParameters', items: samplingParameterItems, index: 1, rows: false },
        { name: 'penaltyParameters', items: penaltyParameterItems, index: 1, rows: false },
        { name: 'modelSpecificParameters', items: modelSpecificParameterItems, index: 1, rows: false },
        { name: 'chatFormat', items: chatFormatSettingsItems, index: 1, rows: false },
        { name: 'display', items: displayPageItems(), index: 3, rows: true },
    ]
}

/** The Display list as the shell page shows it: an item the page overrides is found by the name the page gives it. */
function displayPageItems(): readonly SettingItem[] {
    const shown = new Map(displayShellItems.map((item) => [item.id, item]))
    return displaySettingsItems.map((item) => shown.get(item.id) ?? item)
}

/**
 * Language keys holding intent synonyms of a setting, by setting id. Entries are separated by a comma, a
 * fullwidth comma or an ideographic comma, so a translation keeps the punctuation of its language.
 */
export const SETTING_SYNONYM_KEYS: Readonly<Record<string, readonly string[]>> = {
    'display.zoomsize': ['settingsShellSynonymZoomsize'],
}

/** The language key of each legacy index's old menu name; a search for the old name finds the page. */
const OLD_PAGE_NAME_KEYS: Readonly<Record<number, string>> = {
    0: 'backupAndFiles',
    1: 'chatBot',
    2: 'otherBots',
    3: 'display',
    4: 'plugin',
    6: 'advancedSettings',
    10: 'language',
    11: 'accessibility',
    12: 'persona',
    14: 'modules',
    15: 'hotkey',
}

/** Whether the setting is available right now: its own condition holds. */
function isAvailable(item: SettingItem, ctx: SettingContext): boolean {
    return item.condition === undefined || item.condition(ctx)
}

function settingSources(
    list: LegacyListTarget,
    items: readonly SettingItem[],
    ctx: SettingContext,
    synonyms: Readonly<Record<string, readonly string[]>>,
    out: SearchSource[],
): void {
    for (const item of items) {
        if (SEARCH_EXCLUDED_IDS.has(item.id) || !isAvailable(item, ctx)) continue
        if (item.type === 'accordion') {
            settingSources(list, item.options?.children ?? [], ctx, synonyms, out)
            continue
        }
        if (item.type === 'header' || (item.labelKey === undefined && !item.fallbackLabel)) continue
        out.push({
            id: item.id,
            kind: 'setting',
            target: { index: list.index, rowId: list.rows ? item.id : null },
            labelKey: item.labelKey,
            fallbackLabel: item.fallbackLabel,
            helpKey: item.helpKey,
            synonymKeys: synonyms[item.id],
            keywords: item.keywords,
        })
    }
}

/** Pages and views, each carrying its old menu name as a synonym. */
function pageSources(): SearchSource[] {
    const out: SearchSource[] = []
    for (const page of orderedPages()) {
        page.views.forEach((view, at) => {
            const oldName = OLD_PAGE_NAME_KEYS[view.legacyIndex]
            out.push({
                id: at === 0 ? `page.${page.id}` : `view.${view.id}`,
                kind: 'page',
                target: { index: view.legacyIndex, rowId: null },
                labelKey: view.labelKey,
                synonymKeys: oldName === undefined ? undefined : [oldName],
            })
        })
    }
    return out
}

/**
 * Everything the search indexes today: the legacy setting lists with their view targets, then the pages and
 * views. Dead fields and settings whose condition is false for `ctx` are left out. Strings are read later, per
 * language; nothing here holds text.
 */
export function buildSearchSources(ctx: SettingContext, synonyms: Readonly<Record<string, readonly string[]>> = SETTING_SYNONYM_KEYS): SearchSource[] {
    const out: SearchSource[] = []
    for (const list of legacyListTargets()) settingSources(list, list.items, ctx, synonyms, out)
    return [...out, ...pageSources()]
}
