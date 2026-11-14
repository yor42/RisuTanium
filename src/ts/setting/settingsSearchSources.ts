import { SEARCH_EXCLUDED_IDS } from '../settingsShell/displayPresentation'
import { orderedPages } from '../settingsShell/settingsPages'
import { accessibilitySettingsItems } from './accessibilitySettingsData'
import { advancedSettingsItems } from './advancedSettingsData'
import { ADVANCED_NOT_OFFERED_IDS, advancedShellItems, advancedShellRowIds } from './advancedShellSettingsData'
import { basicParameterItems, modelSpecificParameterItems, penaltyParameterItems, samplingParameterItems, seedSetting } from './botSettingsParamsData'
import { chatFormatSettingsItems } from './chatFormatSettingsData'
import { displayShellItems, displayShellRowIds } from './displayShellSettingsData'
import { displaySettingsItems } from './displaySettingsData.svelte'
import { INPUT_NOT_OFFERED_IDS, inputShellItems, inputShellRowIds } from './inputShellSettingsData'
import { languageSettingsItems } from './languageSettingsData.svelte'
import { LANGUAGE_NOT_OFFERED_IDS, languageShellItems, languageShellRowIds } from './languageShellSettingsData'
import type { SearchSource } from './settingsSearch'
import type { SettingContext, SettingItem } from './types'

/**
 * Where the legacy setting lists are found in the new Settings screen. Each list opens one view; a list whose page
 * marks its rows (a native shell page) names the row. The page and view of an index come from `settingsPages`, so
 * this table names only the legacy index.
 */
export interface LegacyListTarget {
    readonly name: string
    readonly items: readonly SettingItem[]
    readonly index: number
    /** Whether a result opens the row itself rather than the view. */
    readonly rows: boolean
}

/** A native shell page: the rows it shows, the items it renders under another name, and the ids it leaves off. */
interface NativePage {
    readonly index: number
    readonly rowIds: () => string[]
    readonly items: readonly SettingItem[]
    readonly notOffered: ReadonlySet<string>
}

function nativePages(): readonly NativePage[] {
    return [
        { index: 3, rowIds: displayShellRowIds, items: displayShellItems, notOffered: new Set() },
        { index: 11, rowIds: inputShellRowIds, items: inputShellItems, notOffered: INPUT_NOT_OFFERED_IDS },
        { index: 10, rowIds: languageShellRowIds, items: languageShellItems, notOffered: LANGUAGE_NOT_OFFERED_IDS },
        { index: 6, rowIds: advancedShellRowIds, items: advancedShellItems, notOffered: ADVANCED_NOT_OFFERED_IDS },
    ]
}

/** The page that owns a row: a result for a row opens that page, whichever legacy list the row came from. */
function homeOfRows(): ReadonlyMap<string, number> {
    return new Map(nativePages().flatMap((page) => page.rowIds().map((id): [string, number] => [id, page.index])))
}

export function legacyListTargets(): readonly LegacyListTarget[] {
    return [
        { name: 'accessibility', items: pageItems(accessibilitySettingsItems), index: 11, rows: true },
        { name: 'advanced', items: pageItems(advancedSettingsItems), index: 6, rows: true },
        { name: 'language', items: pageItems(languageSettingsItems), index: 10, rows: true },
        { name: 'basicParameters', items: basicParameterItems, index: 1, rows: false },
        { name: 'seed', items: [seedSetting], index: 1, rows: false },
        { name: 'samplingParameters', items: samplingParameterItems, index: 1, rows: false },
        { name: 'penaltyParameters', items: penaltyParameterItems, index: 1, rows: false },
        { name: 'modelSpecificParameters', items: modelSpecificParameterItems, index: 1, rows: false },
        { name: 'chatFormat', items: chatFormatSettingsItems, index: 1, rows: false },
        { name: 'display', items: pageItems(displaySettingsItems), index: 3, rows: true },
    ]
}

/**
 * A legacy list as its native page shows it: an item the page overrides is found by the name the page gives it,
 * and an id the page does not offer is not searchable.
 */
function pageItems(list: readonly SettingItem[]): readonly SettingItem[] {
    const shown = new Map(nativePages().flatMap((page) => page.items.map((item): [string, SettingItem] => [item.id, item])))
    const notOffered = new Set(nativePages().flatMap((page) => [...page.notOffered]))
    return list.filter((item) => !notOffered.has(item.id)).map((item) => shown.get(item.id) ?? item)
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
    homes: ReadonlyMap<string, number>,
    out: SearchSource[],
): void {
    for (const item of items) {
        if (SEARCH_EXCLUDED_IDS.has(item.id) || !isAvailable(item, ctx)) continue
        if (item.type === 'accordion') {
            settingSources(list, item.options?.children ?? [], ctx, synonyms, homes, out)
            continue
        }
        if (item.type === 'header' || (item.labelKey === undefined && !item.fallbackLabel)) continue
        out.push({
            id: item.id,
            kind: 'setting',
            target: { index: homes.get(item.id) ?? list.index, rowId: list.rows ? item.id : null },
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
    const homes = homeOfRows()
    for (const list of legacyListTargets()) settingSources(list, list.items, ctx, synonyms, homes, out)
    return [...out, ...pageSources()]
}
