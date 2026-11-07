// Keyboard model of the Studio tree (WAI-ARIA tree pattern) over the rows that are visible right now.
// Pure: the component feeds the visible rows, the focused row and the key, and applies the answer.

export interface TreeRowInfo {
    id: string
    /** 1 for the top rows. */
    level: number
    /** The row this one sits under, or null for a top row. */
    parentId: string | null
    expandable: boolean
    expanded: boolean
    /** The text type-ahead matches against. */
    label: string
}

export interface TreeKeyInput {
    key: string
    shiftKey?: boolean
    ctrlKey?: boolean
    metaKey?: boolean
    altKey?: boolean
    isComposing?: boolean
    keyCode?: number
}

export type TreeKeyResult =
    | { action: 'none', typeAhead: string }
    | { action: 'focus' | 'expand' | 'collapse' | 'activate' | 'menu', id: string, typeAhead: string }

const NONE: TreeKeyResult = { action: 'none', typeAhead: '' }

function isPrintable(key: string): boolean {
    return [...key].length === 1 && key !== ' '
}

function allSame(text: string): boolean {
    return [...text].every((char) => char === [...text][0])
}

/**
 * The answer to one key press. `typeAhead` is the letters typed so far in the current burst; the result carries the
 * buffer to keep (empty for every key that is not a letter). A key the tree does not own, or a key that belongs to
 * an IME composition or carries Ctrl, Meta or Alt, yields `none`, so the page keeps its own shortcuts.
 */
export function treeKeyAction(
    rows: readonly TreeRowInfo[],
    focusId: string | null,
    input: TreeKeyInput,
    typeAhead = '',
): TreeKeyResult {
    if (rows.length === 0) return NONE
    if (input.isComposing || input.keyCode === 229) return NONE
    if (input.ctrlKey || input.metaKey || input.altKey) return NONE

    const at = focusId === null ? -1 : rows.findIndex((row) => row.id === focusId)
    const current = at === -1 ? undefined : rows[at]
    const focus = (index: number): TreeKeyResult => {
        const row = rows[Math.max(0, Math.min(rows.length - 1, index))]
        return { action: 'focus', id: row.id, typeAhead: '' }
    }

    switch (input.key) {
        case 'ArrowDown':
            return focus(at === -1 ? 0 : at + 1)
        case 'ArrowUp':
            return focus(at === -1 ? 0 : at - 1)
        case 'Home':
            return focus(0)
        case 'End':
            return focus(rows.length - 1)
        case 'ArrowRight': {
            if (!current || !current.expandable) return NONE
            if (!current.expanded) return { action: 'expand', id: current.id, typeAhead: '' }
            const child = rows[at + 1]
            return child && child.parentId === current.id ? { action: 'focus', id: child.id, typeAhead: '' } : NONE
        }
        case 'ArrowLeft': {
            if (!current) return NONE
            if (current.expandable && current.expanded) return { action: 'collapse', id: current.id, typeAhead: '' }
            return current.parentId !== null ? { action: 'focus', id: current.parentId, typeAhead: '' } : NONE
        }
        case 'Enter':
            return current ? { action: 'activate', id: current.id, typeAhead: '' } : NONE
        case 'ContextMenu':
            return current ? { action: 'menu', id: current.id, typeAhead: '' } : NONE
        case 'F10':
            return input.shiftKey && current ? { action: 'menu', id: current.id, typeAhead: '' } : NONE
        case ' ':
            // A space inside a typed word continues the word; on its own it activates the row.
            if (typeAhead === '') return current ? { action: 'activate', id: current.id, typeAhead: '' } : NONE
            return matchTypeAhead(rows, at, typeAhead + ' ')
        default:
            if (!isPrintable(input.key)) return NONE
            return matchTypeAhead(rows, at, typeAhead + input.key)
    }
}

// Repeating one letter cycles through the rows that start with it; a longer word narrows to the first row
// from the focused one (inclusive) that starts with the whole word.
function matchTypeAhead(rows: readonly TreeRowInfo[], at: number, typed: string): TreeKeyResult {
    const needle = typed.toLowerCase()
    const cycling = allSame(needle)
    const prefix = cycling ? [...needle][0] : needle
    const start = cycling ? at + 1 : Math.max(at, 0)
    for (let step = 0; step < rows.length; step++) {
        const row = rows[(start + step) % rows.length]
        if (row.label.toLowerCase().startsWith(prefix)) return { action: 'focus', id: row.id, typeAhead: typed }
    }
    return { action: 'none', typeAhead: typed }
}
