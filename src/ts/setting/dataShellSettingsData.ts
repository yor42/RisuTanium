/**
 * Data Shell Settings Data
 *
 * The rows of the shell Data page (legacy index 0), in sections: the backup actions, the export and import group,
 * and storage. An action row is a shell component named by id; its search entry is the matching item of
 * `DATA_ACTION_ITEMS`, and the row component reads its label from that same item. A setting row is a legacy item
 * used as it is (the same object, so the page and the sidebar picker agree).
 *
 * Import-pure: TypeScript only, no component and no engine import; a component row names its component by string.
 */

import { accessibilitySettingsItems } from './accessibilitySettingsData';
import { advancedSettingsItems } from './advancedSettingsData';
import { legacyLookup, sectionOfRow, sectionRowIds, settingItemsOf } from './shellSections';
import type { ShellSection } from './shellSections';
import type { SettingItem } from './types';

const legacyAccessibility = legacyLookup(accessibilitySettingsItems, 'accessibility');
const legacyAdvanced = legacyLookup(advancedSettingsItems, 'advanced');

/** The four action rows, as search sees them. They have no stored value: each one starts a flow. */
export const DATA_ACTION_ITEMS: readonly SettingItem[] = [
    {
        id: 'data.backup',
        type: 'button',
        labelKey: 'settingsShellDataMakeBackup',
        keywords: ['backup', 'bin', 'rtb', 'export', 'save'],
    },
    {
        id: 'data.restoreFile',
        type: 'button',
        labelKey: 'settingsShellDataRestoreFile',
        keywords: ['restore', 'import', 'load', 'bin', 'rtb'],
    },
    {
        id: 'data.restoreSnapshot',
        type: 'button',
        labelKey: 'loadInternalBackup',
        keywords: ['restore', 'internal', 'load', 'backup'],
    },
    {
        id: 'data.dataset',
        type: 'button',
        labelKey: 'exportAsDataset',
        keywords: ['dataset', 'export', 'training'],
    },
];

/** The action item of a row id; a missing id throws, so a renamed id fails loudly. */
export function dataActionItem(id: string): SettingItem {
    const found = DATA_ACTION_ITEMS.find((item) => item.id === id);
    if (!found) {
        throw new Error(`Data action item ${id} is missing`);
    }
    return found;
}

export const DATA_SHELL_SECTIONS: readonly ShellSection[] = [
    {
        id: 'data.backup',
        labelKey: 'settingsShellDataBackup',
        collapsed: false,
        rows: [
            { kind: 'shell', id: 'data.backup', component: 'DataBackupRow' },
            { kind: 'shell', id: 'data.restoreFile', component: 'DataRestoreFileRow' },
            { kind: 'shell', id: 'data.restoreSnapshot', component: 'DataRestoreSnapshotRow' },
        ],
    },
    {
        id: 'data.transfer',
        labelKey: 'settingsShellDataTransfer',
        collapsed: false,
        rows: [
            { kind: 'shell', id: 'data.dataset', component: 'DataDatasetRow' },
            { kind: 'setting', item: legacyAccessibility('acc.goCharacterOnImport') },
        ],
    },
    {
        id: 'data.storage',
        labelKey: 'settingsShellDataStorage',
        collapsed: false,
        rows: [{ kind: 'setting', item: legacyAdvanced('adv.coldstorage') }],
    },
];

/** Every setting item the page renders through the registry; the action rows are components. */
export const dataShellItems: readonly SettingItem[] = settingItemsOf(DATA_SHELL_SECTIONS);

/** The ids of every row the page can show. */
export function dataShellRowIds(): string[] {
    return sectionRowIds(DATA_SHELL_SECTIONS);
}

/** The section that holds a row, or null when the page has no such row. */
export function dataSectionOfRow(rowId: string): string | null {
    return sectionOfRow(DATA_SHELL_SECTIONS, rowId)?.id ?? null;
}
