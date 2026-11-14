/**
 * Language Shell Settings Data
 *
 * The rows of the shell Language page (legacy index 10), in sections. The app language group holds the language
 * select (without the translate-it-yourself option), a calm line that says when a change takes effect, and a button
 * that downloads the translation file. The translation group rehosts the legacy translator rows unchanged.
 *
 * Import-pure: TypeScript and `.svelte.ts` modules only, no component import; a component row names its component
 * by string.
 */

import { changeLanguage } from 'src/lang';
import { DBState } from '../stores.svelte';
import { downloadTranslationFile, languageSettingsItems } from './languageSettingsData.svelte';
import { legacyLookup, sectionOfRow, sectionRowIds, settingItemsOf, unplacedIds } from './shellSections';
import type { ShellSection, ShellSettingRow } from './shellSections';
import type { SettingItem } from './types';

const legacy = legacyLookup(languageSettingsItems, 'language');

/** Legacy Language ids the page does not offer: the page title and the legacy "close Settings" banner. */
export const LANGUAGE_NOT_OFFERED_IDS: ReadonlySet<string> = new Set(['lang.header', 'lang.restartWarn']);

/**
 * A language change takes effect when Settings are reopened. The line shows while the stored language differs from
 * the one the page started with, and it is gone again if the choice goes back.
 */
export function languagePending(atMount: string, now: string): boolean {
    return atMount !== now;
}

/** The legacy select without the translate-it-yourself option; the download has its own button. Same `onChange`. */
const uiLanguageItem: SettingItem = (() => {
    const item = legacy('lang.uiLanguage');
    return {
        ...item,
        options: {
            ...item.options,
            selectOptions: (item.options?.selectOptions ?? []).filter((option) => option.value !== 'translang'),
        },
    };
})();

/**
 * Downloads the translation file without changing the stored language. The download may bind the runtime language
 * to the file's language, so the stored one is bound again whether it resolves or rejects.
 */
const translangButton: SettingItem = {
    id: 'lang.translang',
    type: 'button',
    labelKey: 'settingsShellLangTranslang',
    classes: 'mt-4',
    options: {
        onClick: async () => {
            try {
                await downloadTranslationFile();
            } finally {
                changeLanguage(DBState.db.language);
            }
        },
    },
};

function plain(item: SettingItem): ShellSettingRow {
    return { kind: 'setting', item };
}

/** The legacy rows the app-language group shows itself; the translation group holds every other legacy row. */
const APP_ROW_IDS: ReadonlySet<string> = new Set(['lang.uiLanguage']);

export const LANGUAGE_SHELL_SECTIONS: readonly ShellSection[] = [
    {
        id: 'lang.app',
        labelKey: 'settingsShellLangApp',
        collapsed: false,
        rows: [
            plain(uiLanguageItem),
            { kind: 'shell', id: 'lang.pending', component: 'LanguagePendingRow' },
            { kind: 'setting', item: translangButton, hintKey: 'settingsShellLangTranslangHint' },
        ],
    },
    {
        id: 'lang.translate',
        labelKey: 'settingsShellLangTranslation',
        collapsed: false,
        rows: languageSettingsItems
            .filter((item) => !APP_ROW_IDS.has(item.id) && !LANGUAGE_NOT_OFFERED_IDS.has(item.id))
            .map(plain),
    },
];

/** Every setting item the page renders through the registry, including the overrides and the download button. */
export const languageShellItems: readonly SettingItem[] = settingItemsOf(LANGUAGE_SHELL_SECTIONS);

/** The ids of every row the page can show. */
export function languageShellRowIds(): string[] {
    return sectionRowIds(LANGUAGE_SHELL_SECTIONS);
}

/** The section that holds a row, or null when the page has no such row. */
export function languageSectionOfRow(rowId: string): string | null {
    return sectionOfRow(LANGUAGE_SHELL_SECTIONS, rowId)?.id ?? null;
}

/** Legacy ids that are neither on the page nor deliberately left off it. Empty when the page is complete. */
export function unplacedLegacyLanguageIds(): string[] {
    return unplacedIds(languageSettingsItems.map((item) => item.id), languageShellRowIds(), LANGUAGE_NOT_OFFERED_IDS);
}
