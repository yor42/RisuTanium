import { language } from '../../lang'

/** Stored on the device as the last page shown, so a later rename must map old ids. */
export type SettingsPageId =
    | 'models' | 'features' | 'display' | 'input' | 'language'
    | 'personas' | 'extensions' | 'data' | 'shortcuts' | 'advanced'

export type SettingsViewId =
    | 'chatBot' | 'prompt' | 'features' | 'display' | 'input' | 'language'
    | 'personas' | 'plugins' | 'modules' | 'data' | 'shortcuts' | 'advanced'

export interface SettingsViewEntry {
    id: SettingsViewId
    /** The index `SettingsMenuIndex` holds while this view shows; the legacy numbering stays the page state. */
    legacyIndex: number
    labelKey: string
}

export interface SettingsPageEntry {
    id: SettingsPageId
    labelKey: string
    /** In chip order; the first view opens when the page is chosen. */
    views: readonly SettingsViewEntry[]
}

function single(id: SettingsViewId, legacyIndex: number, labelKey: string): readonly SettingsViewEntry[] {
    return [{ id, legacyIndex, labelKey }]
}

// The order is the index order of the screen.
const PAGES: readonly SettingsPageEntry[] = [
    {
        id: 'models', labelKey: 'settingsShellPageModels',
        views: [
            { id: 'chatBot', legacyIndex: 1, labelKey: 'settingsShellViewChatBot' },
            { id: 'prompt', legacyIndex: 13, labelKey: 'settingsShellViewPrompt' },
        ],
    },
    { id: 'features', labelKey: 'settingsShellPageFeatures', views: single('features', 2, 'settingsShellPageFeatures') },
    { id: 'display', labelKey: 'settingsShellPageDisplay', views: single('display', 3, 'settingsShellPageDisplay') },
    { id: 'input', labelKey: 'settingsShellPageInput', views: single('input', 11, 'settingsShellPageInput') },
    { id: 'language', labelKey: 'settingsShellPageLanguage', views: single('language', 10, 'settingsShellPageLanguage') },
    { id: 'personas', labelKey: 'settingsShellPagePersonas', views: single('personas', 12, 'settingsShellPagePersonas') },
    {
        id: 'extensions', labelKey: 'settingsShellPageExtensions',
        views: [
            { id: 'plugins', legacyIndex: 4, labelKey: 'settingsShellViewPlugins' },
            { id: 'modules', legacyIndex: 14, labelKey: 'settingsShellViewModules' },
        ],
    },
    { id: 'data', labelKey: 'settingsShellPageData', views: single('data', 0, 'settingsShellPageData') },
    { id: 'shortcuts', labelKey: 'settingsShellPageShortcuts', views: single('shortcuts', 15, 'settingsShellPageShortcuts') },
    { id: 'advanced', labelKey: 'settingsShellPageAdvanced', views: single('advanced', 6, 'settingsShellPageAdvanced') },
]

/** The text of a registry label key in the current language; the key itself when it has no string entry. */
export function settingsLabel(key: string): string {
    const entries: Record<string, unknown> = language
    const value = entries[key]
    return typeof value === 'string' ? value : key
}

/** The pages in index order. */
export function orderedPages(): readonly SettingsPageEntry[] {
    return PAGES
}

export function isSettingsPageId(value: unknown): value is SettingsPageId {
    return typeof value === 'string' && PAGES.some((page) => page.id === value)
}

export function pageEntry(id: SettingsPageId): SettingsPageEntry {
    const entry = PAGES.find((page) => page.id === id)
    if (!entry) throw new Error(`Unknown settings page ${id}`)
    return entry
}

/** The page and view a legacy index shows, or null for -1 and any index no page hosts. */
export function pageForIndex(index: number): { page: SettingsPageId, view: SettingsViewId } | null {
    for (const page of PAGES) {
        const view = page.views.find((candidate) => candidate.legacyIndex === index)
        if (view) return { page: page.id, view: view.id }
    }
    return null
}

/** The index a page opens on: its first view. */
export function firstIndexOf(page: SettingsPageId): number {
    return pageEntry(page).views[0].legacyIndex
}
