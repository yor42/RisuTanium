/**
 * Input Shell Settings Data
 *
 * The rows of the shell Input and accessibility page (legacy index 11), in sections. A row is a legacy
 * Accessibility item used as it is (the same object, so the page and the sidebar picker agree), a same-id override
 * that changes only the label, a shell component, or a link to another page. Every legacy Accessibility id is
 * placed once, left out as dead, or not offered.
 *
 * Import-pure: TypeScript only, no component import; a component row names its component by string.
 */

import { accessibilitySettingsItems } from './accessibilitySettingsData';
import { sectionOfRow, sectionRowIds, legacyLookup, settingItemsOf, unplacedIds } from './shellSections';
import type { ShellSection, ShellSettingRow } from './shellSections';
import type { SettingItem } from './types';

const legacy = legacyLookup(accessibilitySettingsItems, 'accessibility');

function plain(id: string, extra: Pick<ShellSettingRow, 'hintKey' | 'touchNoteKey'> = {}): ShellSettingRow {
    return { kind: 'setting', item: legacy(id), ...extra };
}

/** The legacy item under a new label; everything else about the row stays the legacy item's. */
function relabelled(id: string, labelKey: string, extra: Pick<ShellSettingRow, 'hintKey' | 'touchNoteKey'> = {}): ShellSettingRow {
    return { kind: 'setting', item: { ...legacy(id), labelKey }, ...extra };
}

export const INPUT_SHELL_SECTIONS: readonly ShellSection[] = [
    {
        id: 'input.send',
        labelKey: 'settingsShellInputSend',
        collapsed: false,
        rows: [
            relabelled('acc.sendWithEnter', 'settingsShellInputSendWithEnter', { hintKey: 'settingsShellInputSendWithEnterHint' }),
            relabelled('acc.fixedChatTextarea', 'settingsShellInputFixedInput'),
            relabelled('acc.showMenuChatList', 'settingsShellInputMenuChatList', { hintKey: 'settingsShellInputMenuChatListHint' }),
            relabelled('acc.showMenuHypaMemoryModal', 'settingsShellInputMenuHypa', { hintKey: 'settingsShellInputMenuHypaHint' }),
            relabelled('acc.sideMenuRerollButton', 'settingsShellInputMenuReroll', { hintKey: 'settingsShellInputMenuRerollHint' }),
        ],
    },
    {
        id: 'input.edit',
        labelKey: 'settingsShellInputEdit',
        collapsed: false,
        rows: [
            relabelled('acc.clickToEdit', 'settingsShellInputClickEdit'),
            relabelled('acc.longPressToPopupEditor', 'settingsShellInputLongPressEdit', { hintKey: 'settingsShellInputLongPressEditHint' }),
            relabelled('acc.enableDragPartialEdit', 'settingsShellInputDragEdit'),
            relabelled('acc.enableBlockPartialEdit', 'settingsShellInputBlockEdit', {
                hintKey: 'settingsShellInputBlockEditHint',
                touchNoteKey: 'settingsShellInputBlockEditTouch',
            }),
        ],
    },
    {
        id: 'input.scroll',
        labelKey: 'settingsShellInputScroll',
        collapsed: false,
        rows: [
            relabelled('acc.autoScrollToNewMessage', 'settingsShellInputAutoScroll'),
            relabelled('acc.alwaysScrollToNewMessage', 'settingsShellInputAlwaysScroll', { hintKey: 'settingsShellInputAlwaysScrollHint' }),
            {
                kind: 'shell',
                id: 'acc.newMessageButtonStyle',
                component: 'NewMessageButtonRow',
                condition: legacy('acc.newMessageButtonStyle').condition,
            },
        ],
    },
    {
        id: 'input.gestures',
        labelKey: 'settingsShellInputGestures',
        collapsed: false,
        rows: [
            relabelled('acc.swipe', 'settingsShellInputSwipe', { hintKey: 'settingsShellInputSwipeHint' }),
            relabelled('acc.hamburgerButtonBottom', 'settingsShellInputMenuBottom', { hintKey: 'settingsShellInputMenuBottomHint' }),
        ],
    },
    {
        id: 'input.menu',
        labelKey: 'settingsShellInputMenu',
        collapsed: false,
        rows: [
            relabelled('acc.botSettingAtStart', 'settingsShellInputBotAtStart'),
            plain('acc.customSidebarConfig', { hintKey: 'settingsShellInputCustomSidebarHint' }),
            relabelled('acc.enableRisuaiProTools', 'settingsShellInputProTools', { hintKey: 'settingsShellInputProToolsHint' }),
        ],
    },
    {
        id: 'input.confirm',
        labelKey: 'settingsShellInputConfirm',
        collapsed: false,
        rows: [
            relabelled('acc.askRemoval', 'settingsShellInputAskRemoval'),
            relabelled('acc.instantRemove', 'settingsShellInputInstantRemove', { hintKey: 'settingsShellInputInstantRemoveHint' }),
            relabelled('acc.inlayErrorResponse', 'settingsShellInputInlayError', { hintKey: 'settingsShellInputInlayErrorHint' }),
            relabelled('acc.showTranslationLoading', 'settingsShellInputShowTransLoading'),
        ],
    },
    {
        id: 'input.a11y',
        labelKey: 'settingsShellInputEasy',
        collapsed: false,
        rows: [
            { kind: 'jump', id: 'input.easyContrast', labelKey: 'settingsShellInputEasyContrast', hintKey: 'settingsShellInputEasyContrastHint', index: 3 },
            { kind: 'jump', id: 'input.easySize', labelKey: 'settingsShellInputEasySize', hintKey: 'settingsShellInputEasySizeHint', index: 3 },
            { kind: 'jump', id: 'input.easyInput', labelKey: 'settingsShellInputEasyInput', hintKey: 'settingsShellInputEasyInputHint', index: 3 },
        ],
    },
    {
        // Rows that belong on other pages (Data, Models) until those pages take them over.
        id: 'input.other',
        labelKey: 'settingsShellOtherSettings',
        collapsed: false,
        rows: [
            plain('acc.goCharacterOnImport'),
            plain('acc.applyAdditionalParamsToAll'),
            plain('acc.localActivationInGlobalLorebook'),
            plain('acc.bulkEnabling'),
        ],
    },
    {
        // Never collapsed and never conditional: this is where the switch back from the new Settings screen lives.
        id: 'input.preview',
        labelKey: 'settingsShellInputPreview',
        collapsed: false,
        rows: [plain('acc.chatShellPreview'), plain('acc.settingsShellPreview'), plain('acc.studio')],
    },
];

/** Legacy Accessibility ids the page does not offer: the page title. */
export const INPUT_NOT_OFFERED_IDS: ReadonlySet<string> = new Set(['acc.header']);

/** Legacy Accessibility ids that no longer do anything. */
export const INPUT_DEAD_IDS: ReadonlySet<string> = new Set(['acc.moveInsteadOfCopyOnCMPConvert']);

/** Legacy Accessibility ids that live on the Advanced page (Troubleshooting) instead. */
export const INPUT_MOVED_OUT_IDS: ReadonlySet<string> = new Set(['acc.requestInfoInsideChat']);

/** Every setting item the page renders through the registry, including the overrides. */
export const inputShellItems: readonly SettingItem[] = settingItemsOf(INPUT_SHELL_SECTIONS);

/** The ids of every row the page can show. */
export function inputShellRowIds(): string[] {
    return sectionRowIds(INPUT_SHELL_SECTIONS);
}

/** The section that holds a row, or null when the page has no such row. */
export function inputSectionOfRow(rowId: string): string | null {
    return sectionOfRow(INPUT_SHELL_SECTIONS, rowId)?.id ?? null;
}

/** Legacy ids that are neither on the page nor deliberately left off it. Empty when the page is complete. */
export function unplacedLegacyInputIds(): string[] {
    const excluded = new Set([...INPUT_NOT_OFFERED_IDS, ...INPUT_DEAD_IDS, ...INPUT_MOVED_OUT_IDS]);
    return unplacedIds(accessibilitySettingsItems.map((item) => item.id), inputShellRowIds(), excluded);
}
