/**
 * Display Shell Settings Data
 *
 * The rows of the shell Display page, in sections. A row is a legacy Display item used as it is (the same object,
 * so the page and the sidebar picker agree), a same-id override that changes only how the value is shown, or a
 * shell component named by id. Every legacy Display id is placed once, left out as dead, or not offered.
 *
 * Import-pure: TypeScript and `.svelte.ts` modules only, no component import. The `settingLabelKeys` guard loads this
 * file under a fixed mock set, so a component row is a `ShellRowComponent` string that the page resolves. The motion
 * rows read this device's choices (`motionPrefs`), which live outside the profile (MC-1529).
 */

import { language } from 'src/lang';
import { animationDimReason, motionPrefs, type AnimationDimReason } from '../chatShell/motionPrefs.svelte';
import {
    animationPositionOf,
    blockquoteDimmed,
    CURLY_QUOTES,
    DEAD_DISPLAY_IDS,
    firstMessagePagesDimmed,
    sizeStepKeyOf,
    storedAnimationOf,
} from '../settingsShell/displayPresentation';
import type { Database } from '../storage/database.svelte';
import { displaySettingsItems } from './displaySettingsData.svelte';
import type { SettingContext, SettingItem } from './types';

export type DisplaySectionId =
    | 'display.themeColor'
    | 'display.fontSize'
    | 'display.chat'
    | 'display.sound'
    | 'display.motion'
    | 'display.advanced';

/** Shell components a row can name; the page maps each to its component. */
export type ShellRowComponent = 'ThemeCards' | 'AssetWidthRow' | 'QuoteBoxesRow' | 'LowPowerRow' | 'ReducedMotionRow';

/** A row that has no effect in the current state: it stays operable and says why. */
export interface DimRule {
    when(db: Database): boolean;
    reasonKey: string;
    /** Overrides `reasonKey` when the reason depends on the current state. */
    reasonKeyOf?: () => string;
    /** A link to the setting that decides the state, as a legacy index. */
    jump?: { labelKey: string; index: number };
}

export interface SettingRowSpec {
    kind: 'setting';
    item: SettingItem;
    dim?: DimRule;
    /** On a phone the control is replaced by this note. */
    phoneNoteKey?: string;
    /** End labels of a slider. */
    ends?: { startKey: string; endKey: string };
    /** A plain line under the control. */
    hintKey?: string;
}

export interface ShellRowSpec {
    kind: 'shell';
    id: string;
    component: ShellRowComponent;
    condition?: (ctx: SettingContext) => boolean;
    /** Row ids the component renders itself, so a search result can still find them. */
    ownedIds?: readonly string[];
}

export type DisplayRowSpec = SettingRowSpec | ShellRowSpec;

export interface DisplaySection {
    id: DisplaySectionId;
    labelKey: string;
    /** A collapsed section opens on demand and starts closed on every mount. */
    collapsed: boolean;
    rows: readonly DisplayRowSpec[];
}

const LEGACY: ReadonlyMap<string, SettingItem> = new Map(displaySettingsItems.map((item) => [item.id, item]));

function legacy(id: string): SettingItem {
    const found = LEGACY.get(id);
    if (!found) {
        throw new Error(`display item ${id} is missing from the legacy Display list`);
    }
    return found;
}

function plain(id: string): SettingRowSpec {
    return { kind: 'setting', item: legacy(id) };
}

function stepText(value: number): string {
    const names: Readonly<Record<string, string>> = language.settingsShellStepNames;
    return names[sizeStepKeyOf(value)];
}

function withStepNames(id: string): SettingItem {
    const item = legacy(id);
    return { ...item, options: { ...item.options, customText: stepText } };
}

function animationText(position: number): string {
    const seconds = storedAnimationOf(position);
    return seconds === 0 ? language.settingsShellAnimationInstant : language.settingsShellAnimationSeconds(seconds);
}

/** The font name row, with the label and help the legacy row lacks. */
const customFontItem: SettingItem = {
    ...legacy('display.customFont'),
    labelKey: 'settingsShellFontName',
    helpKey: 'customFont',
};

/** The stored flag is "do not format quotes"; the page shows the positive reading and writes the inverse. */
const quoteStyleItem: SettingItem = {
    ...legacy('display.unformatQuotes'),
    labelKey: 'settingsShellQuoteStyle',
    getValue: (db) => !db.unformatQuotes,
    setValue: (db, shown: boolean) => {
        db.unformatQuotes = !shown;
    },
};

/** The stored animationSpeed is a duration; the slider runs from slow to fast, so it shows the inverse. */
const animationSpeedItem: SettingItem = {
    ...legacy('display.animationSpeed'),
    getValue: (db) => animationPositionOf(db.animationSpeed),
    setValue: (db, position: number) => {
        db.animationSpeed = storedAnimationOf(position);
    },
    options: { min: 0, max: 1, step: 0.05, fixed: 2, customText: animationText },
};

function quoteBox(id: string, at: 0 | 1 | 2 | 3): SettingItem {
    const item = legacy(id);
    return {
        ...item,
        getValue: (db) => db.customQuotesData?.[at] ?? CURLY_QUOTES[at],
        setValue: (db, value: string) => {
            db.customQuotesData ??= [...CURLY_QUOTES];
            db.customQuotesData[at] = value;
        },
    };
}

/** The four quote boxes, falling back to the stored curly default rather than straight quotes. */
export const quoteBoxItems: readonly SettingItem[] = [
    quoteBox('display.leadingDoubleQuote', 0),
    quoteBox('display.trailingDoubleQuote', 1),
    quoteBox('display.leadingSingleQuote', 2),
    quoteBox('display.trailingSingleQuote', 3),
];

const QUOTE_BOX_IDS: readonly string[] = quoteBoxItems.map((item) => item.id);

const ANIMATION_DIM_KEYS: Readonly<Record<AnimationDimReason, string>> = {
    lowPower: 'settingsShellAnimationDimLowPower',
    system: 'settingsShellAnimationDimSystem',
    reduced: 'settingsShellAnimationDimReduced',
};

/** The rows of this device's own motion choices; they are not legacy Display items. */
export const DEVICE_MOTION_ROW_IDS: readonly string[] = ['display.lowPower', 'display.reducedMotion'];

/** The animation speed has no effect while low power or reduced motion is on (the engine uses the nominal speed then). */
const animationDim: DimRule = {
    when: () => animationDimReason(motionPrefs) !== null,
    reasonKey: ANIMATION_DIM_KEYS.reduced,
    reasonKeyOf: () => ANIMATION_DIM_KEYS[animationDimReason(motionPrefs) ?? 'reduced'],
};

export const DISPLAY_SHELL_SECTIONS: readonly DisplaySection[] = [
    {
        id: 'display.themeColor',
        labelKey: 'settingsShellDisplayThemeColor',
        collapsed: false,
        rows: [
            { kind: 'shell', id: 'display.theme', component: 'ThemeCards' },
            plain('display.waifuWidth'),
            plain('display.waifuWidth2'),
            plain('display.guiHTML'),
            plain('display.colorScheme'),
            plain('display.customColorScheme'),
            plain('display.textTheme'),
            plain('display.customTextTheme'),
            plain('display.customBackground'),
            plain('display.textScreenColor'),
            plain('display.textScreenBorder'),
            plain('display.textScreenRounded'),
            plain('display.textBorder'),
        ],
    },
    {
        id: 'display.fontSize',
        labelKey: 'settingsShellDisplayFontSize',
        collapsed: false,
        rows: [
            plain('display.font'),
            { kind: 'setting', item: customFontItem },
            plain('display.zoomsize'),
            plain('display.lineHeight'),
            plain('display.iconsize'),
            { kind: 'setting', item: withStepNames('display.textAreaSize') },
            { kind: 'setting', item: withStepNames('display.textAreaTextSize') },
            { kind: 'setting', item: withStepNames('display.sideBarSize') },
            { kind: 'shell', id: 'display.assetWidth', component: 'AssetWidthRow' },
            { kind: 'setting', item: legacy('display.settingsCloseButtonSize'), phoneNoteKey: 'settingsShellCloseButtonPhone' },
        ],
    },
    {
        id: 'display.chat',
        labelKey: 'settingsShellDisplayChat',
        collapsed: false,
        rows: [
            { kind: 'setting', item: quoteStyleItem },
            {
                kind: 'setting',
                item: legacy('display.blockquoteStyling'),
                dim: { when: (db) => blockquoteDimmed(db.unformatQuotes), reasonKey: 'settingsShellBlockquoteDimmed' },
            },
            plain('display.customQuotes'),
            {
                kind: 'shell',
                id: 'display.quoteBoxes',
                component: 'QuoteBoxesRow',
                condition: (ctx) => ctx.db.customQuotes === true,
                ownedIds: QUOTE_BOX_IDS,
            },
            {
                kind: 'setting',
                item: legacy('display.showFirstMessagePages'),
                dim: {
                    when: (db) => firstMessagePagesDimmed(db.swipe),
                    reasonKey: 'settingsShellFirstPagesDimmed',
                    jump: { labelKey: 'settingsShellFirstPagesJump', index: 11 },
                },
            },
            plain('display.useChatCopy'),
            plain('display.showSavingIcon'),
            plain('display.roundIcons'),
            plain('display.showFolderName'),
            plain('display.hideAllImages'),
            plain('display.hideRealm'),
        ],
    },
    {
        id: 'display.sound',
        labelKey: 'settingsShellDisplaySound',
        collapsed: false,
        rows: [
            plain('display.playMessage'),
            plain('display.playMessageOnTranslateEnd'),
            plain('display.notification'),
            plain('display.replyNotifications'),
        ],
    },
    {
        id: 'display.motion',
        labelKey: 'settingsShellDisplayMotion',
        collapsed: false,
        rows: [
            { kind: 'shell', id: 'display.lowPower', component: 'LowPowerRow' },
            { kind: 'shell', id: 'display.reducedMotion', component: 'ReducedMotionRow' },
            {
                kind: 'setting',
                item: animationSpeedItem,
                dim: animationDim,
                ends: { startKey: 'settingsShellAnimationSlow', endKey: 'settingsShellAnimationFast' },
                hintKey: 'settingsShellAnimationHint',
            },
        ],
    },
    {
        id: 'display.advanced',
        labelKey: 'settingsShellDisplayAdvanced',
        collapsed: true,
        rows: [
            plain('display.customCSS'),
            plain('display.useChatSticker'),
            plain('display.fullScreen'),
            plain('display.hideApiKey'),
            plain('display.useLegacyGUI'),
            plain('display.menuSideBar'),
            plain('display.showPromptComparison'),
            plain('display.useAdditionalAssetsPreview'),
        ],
    },
];

/** Legacy Display ids the shell page does not offer: the custom chat theme and its editor button. */
export const DISPLAY_NOT_OFFERED_IDS: ReadonlySet<string> = new Set(['display.customGui']);

/** Every setting item the page renders through the registry, including the overrides and the quote boxes. */
export const displayShellItems: readonly SettingItem[] = [
    ...DISPLAY_SHELL_SECTIONS.flatMap((section) =>
        section.rows.flatMap((row): SettingItem[] => (row.kind === 'setting' ? [row.item] : [])),
    ),
    ...quoteBoxItems,
];

/** The ids of every row the page can show, including the rows a shell component renders itself. */
export function displayShellRowIds(): string[] {
    return DISPLAY_SHELL_SECTIONS.flatMap((section) =>
        section.rows.flatMap((row) => (row.kind === 'setting' ? [row.item.id] : [row.id, ...(row.ownedIds ?? [])])),
    );
}

/** The section that holds a row, or null when the page has no such row. */
export function displaySectionOfRow(rowId: string): DisplaySectionId | null {
    for (const section of DISPLAY_SHELL_SECTIONS) {
        for (const row of section.rows) {
            const ids = row.kind === 'setting' ? [row.item.id] : [row.id, ...(row.ownedIds ?? [])];
            if (ids.includes(rowId)) {
                return section.id;
            }
        }
    }
    return null;
}

/** Legacy ids that are neither on the page nor deliberately left off it. Empty when the page is complete. */
export function unplacedLegacyDisplayIds(): string[] {
    const placed = new Set(displayShellRowIds());
    return displaySettingsItems
        .map((item) => item.id)
        .filter((id) => !placed.has(id) && !DEAD_DISPLAY_IDS.has(id) && !DISPLAY_NOT_OFFERED_IDS.has(id));
}
