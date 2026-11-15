/**
 * Shell Sections
 *
 * The pure model shared by the native shell pages that are built from sections of setting rows (Input, Language,
 * Advanced). A row is a legacy setting item used as it is (the same object, so the page and the sidebar picker
 * agree), a same-id override that changes only how the value is shown, a shell component named by id, or a jump
 * link to another page. Every legacy id of a list is placed once, left out as dead, or not offered.
 *
 * Import-pure: types and plain functions only, no component import. The `settingLabelKeys` guard loads the page
 * data files under a fixed mock set, so a component row is a string that the page resolves.
 */

import type { DimRule } from './displayShellSettingsData';
import type { SettingContext, SettingItem } from './types';
import type { Database } from '../storage/database.svelte';

export interface ShellSettingRow {
    kind: 'setting';
    item: SettingItem;
    dim?: DimRule;
    /** A plain line under the control. */
    hintKey?: string;
    /** On a touch-only device the control is replaced by this note. */
    touchNoteKey?: string;
}

export interface ShellComponentRow {
    kind: 'shell';
    id: string;
    /** The key of the component the page maps. */
    component: string;
    condition?: (ctx: SettingContext) => boolean;
    /** Row ids the component renders itself, so a search result can still find them. */
    ownedIds?: readonly string[];
}

/** A link row that opens another page of the legacy index. */
export interface ShellJumpRow {
    kind: 'jump';
    id: string;
    labelKey: string;
    hintKey?: string;
    index: number;
}

export type ShellRow = ShellSettingRow | ShellComponentRow | ShellJumpRow;

export interface ShellSection {
    id: string;
    labelKey: string;
    /** A collapsed section opens on demand and starts closed on every mount. */
    collapsed: boolean;
    /** A section whose gate is off renders nothing. */
    when?: (db: Database) => boolean;
    rows: readonly ShellRow[];
}

/** Looks a legacy item up by id; a missing id throws, so a renamed legacy id fails loudly at import. */
export function legacyLookup(items: readonly SettingItem[], listName: string): (id: string) => SettingItem {
    const byId: ReadonlyMap<string, SettingItem> = new Map(items.map((item) => [item.id, item]));
    return (id: string): SettingItem => {
        const found = byId.get(id);
        if (!found) {
            throw new Error(`${listName} item ${id} is missing from the legacy list`);
        }
        return found;
    };
}

/** The ids a row answers to, including the rows a shell component renders itself. */
export function rowIdsOf(row: ShellRow): string[] {
    if (row.kind === 'setting') return [row.item.id];
    if (row.kind === 'shell') return [row.id, ...(row.ownedIds ?? [])];
    return [row.id];
}

/** The ids of every row of the sections. */
export function sectionRowIds(sections: readonly ShellSection[]): string[] {
    return sections.flatMap((section) => section.rows.flatMap(rowIdsOf));
}

/** The section that holds a row, or null when there is no such row. */
export function sectionOfRow(sections: readonly ShellSection[], rowId: string): ShellSection | null {
    for (const section of sections) {
        if (section.rows.some((row) => rowIdsOf(row).includes(rowId))) {
            return section;
        }
    }
    return null;
}

/** Every setting item the sections render through the registry, including overrides. */
export function settingItemsOf(sections: readonly ShellSection[]): SettingItem[] {
    return sections.flatMap((section) =>
        section.rows.flatMap((row): SettingItem[] => (row.kind === 'setting' ? [row.item] : [])),
    );
}

/** Legacy ids that are neither placed nor deliberately left off. Empty when the page is complete. */
export function unplacedIds(legacyIds: readonly string[], placed: readonly string[], excluded: ReadonlySet<string>): string[] {
    const placedSet = new Set(placed);
    return legacyIds.filter((id) => !placedSet.has(id) && !excluded.has(id));
}
