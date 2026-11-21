/** What takes focus after the focused row left the displayed rows: a displayed row's key, or the Add button (the list itself when there is none). */
export const FOCUS_ADD = 'add' as const

/**
 * The row that takes focus after a change removed rows from the display, read from the keys alone so that a row which is
 * not mounted (the list is windowed) is still a target.
 *
 * `knownKeys` are the displayed keys before the change, `keys` the displayed keys after it, `focusedKey` the row that held
 * focus. A row that is gone hands focus to the next surviving row, else the previous one, else Add. Rows over one file are
 * keyed by their order, so the key of a removed row can name the row after it, which inherited the node whose menu item
 * held the focus: when the key survives, position decides, and the row now at the old place is the target.
 * The return value is a key of `keys` or `FOCUS_ADD`; the caller falls back to the list when Add does not exist.
 */
export function focusTargetAfterRemoval(knownKeys: readonly string[], keys: readonly string[], focusedKey: string): string {
    const at = knownKeys.indexOf(focusedKey)
    const survivors = new Set(keys)
    if (survivors.has(focusedKey)) {
        const place = Math.min(Math.max(at, 0), keys.length - 1)
        return keys[place] ?? FOCUS_ADD
    }
    for (const candidate of knownKeys.slice(at + 1)) {
        if (survivors.has(candidate)) return candidate
    }
    for (const candidate of knownKeys.slice(0, Math.max(at, 0)).reverse()) {
        if (survivors.has(candidate)) return candidate
    }
    return FOCUS_ADD
}
