/**
 * Advanced Shell Settings Data
 *
 * The rows of the shell Advanced page (legacy index 6), in sections. A row is a legacy Advanced item used as it is
 * (the same object, so the page and the sidebar picker agree), a same-id override that changes only the label and
 * the options' labels, a shell component, or a link to another page. The experimental and the not-recommended
 * groups are collapsed sections that show only while their gate is on. Every legacy Advanced id is placed once,
 * left out as dead, or not offered.
 *
 * Import-pure: TypeScript only, no component import; a component row names its component by string.
 */

import { isNodeServer, isTauri } from '../platform';
import { accessibilitySettingsItems } from './accessibilitySettingsData';
import { advancedSettingsItems } from './advancedSettingsData';
import { legacyLookup, sectionOfRow, sectionRowIds, settingItemsOf, unplacedIds } from './shellSections';
import type { ShellSection, ShellSettingRow } from './shellSections';
import type { SettingItem } from './types';

const legacy = legacyLookup(advancedSettingsItems, 'advanced');
const legacyAccessibility = legacyLookup(accessibilitySettingsItems, 'accessibility');

/** Legacy Advanced ids the page does not offer: the title, the red warning, and the streaming optimisation row. */
export const ADVANCED_NOT_OFFERED_IDS: ReadonlySet<string> = new Set([
    'adv.header',
    'adv.warn',
    'adv.streamingDisplayOpt',
]);

type RowExtra = Pick<ShellSettingRow, 'hintKey'>;

function plain(id: string, extra: RowExtra = {}): ShellSettingRow {
    return { kind: 'setting', item: legacy(id), ...extra };
}

/** The legacy item under a new label; everything else about the row stays the legacy item's. */
function relabelled(id: string, labelKey: string, extra: RowExtra = {}): ShellSettingRow {
    return { kind: 'setting', item: { ...legacy(id), labelKey }, ...extra };
}

const HEIGHT_OPTION_KEYS: Readonly<Record<string, string>> = {
    normal: 'settingsShellAdvHeightNormal',
    percent: 'settingsShellAdvHeightPercent',
    vh: 'settingsShellAdvHeightVh',
    dvh: 'settingsShellAdvHeightDvh',
    svh: 'settingsShellAdvHeightSvh',
    lvh: 'settingsShellAdvHeightLvh',
};

/** The height mode row with a plain-words label for each stored value; the values themselves are untouched. */
const heightModeItem: SettingItem = (() => {
    const item = legacy('adv.heightMode');
    return {
        ...item,
        labelKey: 'settingsShellAdvHeightMode',
        options: {
            ...item.options,
            selectOptions: (item.options?.selectOptions ?? []).map((option) => ({
                ...option,
                label: undefined,
                labelKey: HEIGHT_OPTION_KEYS[option.value] ?? option.labelKey,
            })),
        },
    };
})();

/** The old media finder is an unrecommended setting, so it shows only with the unrecommended gate on. */
const legacyMediaItem: SettingItem = {
    ...legacy('adv.legacyMedia'),
    labelKey: 'settingsShellAdvLegacyMedia',
    condition: (ctx) => ctx.db.showUnrecommended,
};

/** The request-info row, moved here from the Input page under the label the specification gives it. */
const requestInfoItem: SettingItem = {
    ...legacyAccessibility('acc.requestInfoInsideChat'),
    labelKey: 'settingsShellAdvRequestInfo',
};

export const ADVANCED_SHELL_SECTIONS: readonly ShellSection[] = [
    {
        id: 'adv.request',
        labelKey: 'settingsShellAdvRequest',
        collapsed: false,
        rows: [
            relabelled('adv.genTime', 'settingsShellAdvGenTime', { hintKey: 'settingsShellAdvGenTimeHint' }),
            relabelled('adv.visionQual', 'settingsShellAdvVisionQual'),
            relabelled('adv.reqLoc', 'settingsShellAdvReqLoc'),
            relabelled('adv.autoCont', 'settingsShellAdvAutoCont'),
            relabelled('adv.autoContinueMin', 'settingsShellAdvAutoContinueMin', { hintKey: 'settingsShellAdvAutoContinueMinHint' }),
            relabelled('adv.remIncomp', 'settingsShellAdvRemIncomp'),
            relabelled('adv.antiOverload', 'settingsShellAdvAntiOverload'),
            relabelled('adv.forceProxy', 'settingsShellAdvForceProxy'),
            relabelled('adv.autoFill', 'settingsShellAdvAutoFill'),
            relabelled('adv.newOai', 'settingsShellAdvNewOai'),
            relabelled('adv.sayNothing', 'settingsShellAdvSayNothing'),
            relabelled('adv.tokCache', 'settingsShellAdvTokCache'),
            relabelled('adv.auxModelUnderModelSettings', 'settingsShellAdvAuxModel'),
            relabelled('adv.disableSeperateParameterChangeOnPresetChange', 'settingsShellAdvDisableSeparate'),
            relabelled('adv.dynamicModelRegistry', 'settingsShellAdvDynamicModelRegistry'),
            relabelled('adv.noWaitTrans', 'settingsShellAdvNoWaitTrans'),
            relabelled('adv.newImgBeta', 'settingsShellAdvNewImgBeta'),
            relabelled('adv.remPunc', 'settingsShellAdvRemPunc'),
            relabelled('adv.openAIFlex', 'settingsShellAdvOpenAIFlex', { hintKey: 'settingsShellAdvStillExperimental' }),
            relabelled('adv.claudeCache', 'settingsShellAdvClaudeCache', { hintKey: 'settingsShellAdvStillExperimental' }),
            relabelled('adv.claudeBatch', 'settingsShellAdvClaudeBatch', { hintKey: 'settingsShellAdvStillExperimental' }),
            plain('adv.retries'),
            relabelled('adv.localNetworkMode', 'settingsShellAdvLocalNetworkMode'),
            relabelled('adv.localNetworkTimeout', 'settingsShellAdvLocalNetworkTimeout'),
            {
                kind: 'shell',
                id: 'adv.privateNetwork',
                component: 'PrivateNetworkControls',
                condition: () => isTauri || isNodeServer,
            },
        ],
    },
    {
        id: 'adv.lorebook',
        labelKey: 'settingsShellAdvLorebook',
        collapsed: false,
        rows: [
            relabelled('adv.lbDepth', 'settingsShellAdvLbDepth'),
            relabelled('adv.lbToken', 'settingsShellAdvLbToken'),
        ],
    },
    {
        id: 'adv.chatload',
        labelKey: 'settingsShellAdvChatLoad',
        collapsed: false,
        rows: [
            relabelled('adv.chatLoadInitial', 'settingsShellAdvChatLoadInitial', { hintKey: 'settingsShellAdvChatLoadInitialHint' }),
            relabelled('adv.chatLoadAdditional', 'settingsShellAdvChatLoadAdditional', { hintKey: 'settingsShellAdvChatLoadAdditionalHint' }),
        ],
    },
    {
        id: 'adv.display',
        labelKey: 'settingsShellAdvScreen',
        collapsed: false,
        rows: [
            { kind: 'setting', item: heightModeItem, hintKey: 'settingsShellAdvHeightModeHint' },
            relabelled('adv.imgComp', 'settingsShellAdvImgComp'),
            relabelled('adv.scrollToActive', 'settingsShellAdvScrollToActive'),
            relabelled('adv.dynAssets', 'settingsShellAdvDynAssets'),
            relabelled('adv.assetAlloc', 'settingsShellAdvAssetAlloc', { hintKey: 'settingsShellAdvAssetAllocHint' }),
            relabelled('adv.dynAssetsEdit', 'settingsShellAdvDynAssetsEdit'),
            relabelled('adv.realmOpen', 'settingsShellAdvRealmOpen'),
        ],
    },
    {
        id: 'adv.prompt',
        labelKey: 'settingsShellAdvPrompt',
        collapsed: false,
        rows: [
            relabelled('adv.addPrompt', 'settingsShellAdvAddPrompt'),
            relabelled('adv.descPrefix', 'settingsShellAdvDescPrefix'),
            relabelled('adv.presetChain', 'settingsShellAdvPresetChain'),
            plain('adv.emoPrompt'),
        ],
    },
    {
        id: 'adv.trouble',
        labelKey: 'settingsShellAdvTrouble',
        collapsed: false,
        rows: [
            plain('adv.export'),
            relabelled('adv.devTools', 'settingsShellAdvDevTools'),
            relabelled('adv.devMode', 'settingsShellAdvDevMode'),
            relabelled('adv.cssErr', 'settingsShellAdvCssErr'),
            relabelled('adv.promptInfo', 'settingsShellAdvPromptInfo'),
            relabelled('adv.promptTextInfo', 'settingsShellAdvPromptTextInfo'),
            { kind: 'setting', item: requestInfoItem, hintKey: 'settingsShellAdvRequestInfoHint' },
            relabelled('adv.simpleTool', 'settingsShellAdvSimpleTool'),
            relabelled('adv.toolUsage', 'settingsShellAdvToolUsage'),
            plain('adv.keepSessionAlive'),
            relabelled('adv.allowExt', 'settingsShellAdvAllowExt'),
            relabelled('adv.bookmark', 'settingsShellAdvBookmark'),
        ],
    },
    {
        id: 'adv.gates',
        labelKey: 'settingsShellAdvGates',
        collapsed: false,
        rows: [
            relabelled('adv.useExp', 'settingsShellAdvUseExp', { hintKey: 'settingsShellAdvUseExpHint' }),
            relabelled('adv.showUnrec', 'settingsShellAdvShowUnrec', { hintKey: 'settingsShellAdvShowUnrecHint' }),
            { kind: 'jump', id: 'adv.proToolsLink', labelKey: 'settingsShellAdvProToolsLink', index: 11 },
        ],
    },
    {
        id: 'adv.experimental',
        labelKey: 'settingsShellAdvExperimental',
        collapsed: true,
        when: (db) => db.useExperimental === true,
        rows: [
            relabelled('adv.exp.googleToken', 'settingsShellAdvGoogleToken'),
            relabelled('adv.exp.cachePoint', 'settingsShellAdvCachePoint'),
            relabelled('adv.exp.googleTrans', 'settingsShellAdvGoogleTrans'),
            relabelled('adv.exp.claudeRet', 'settingsShellAdvClaudeRet'),
        ],
    },
    {
        id: 'adv.unrecommended',
        labelKey: 'settingsShellAdvUnrecommended',
        collapsed: true,
        when: (db) => db.showUnrecommended === true,
        rows: [
            relabelled('adv.cot', 'settingsShellAdvCot'),
            relabelled('adv.plainFetch', 'settingsShellAdvPlainFetch'),
            { kind: 'setting', item: { ...legacy('adv.depTrig'), labelKey: 'settingsShellAdvDepTrig' }, hintKey: 'settingsShellAdvMaybeDead' },
            { kind: 'setting', item: legacyMediaItem, hintKey: 'settingsShellAdvMaybeDead' },
        ],
    },
    {
        id: 'adv.custom',
        labelKey: 'settingsShellAdvCustom',
        collapsed: false,
        rows: [plain('adv.banChar'), plain('adv.customModels')],
    },
    {
        // A row that belongs on another page until that page takes it over.
        id: 'adv.other',
        labelKey: 'settingsShellOtherSettings',
        collapsed: false,
        rows: [plain('adv.coldstorage')],
    },
];

/** Every setting item the page renders through the registry, including the overrides. */
export const advancedShellItems: readonly SettingItem[] = settingItemsOf(ADVANCED_SHELL_SECTIONS);

/** The ids of every row the page can show. */
export function advancedShellRowIds(): string[] {
    return sectionRowIds(ADVANCED_SHELL_SECTIONS);
}

/** The section that holds a row, or null when the page has no such row. */
export function advancedSectionOfRow(rowId: string): string | null {
    return sectionOfRow(ADVANCED_SHELL_SECTIONS, rowId)?.id ?? null;
}

/** Legacy ids that are neither on the page nor deliberately left off it. Empty when the page is complete. */
export function unplacedLegacyAdvancedIds(): string[] {
    return unplacedIds(advancedSettingsItems.map((item) => item.id), advancedShellRowIds(), ADVANCED_NOT_OFFERED_IDS);
}
