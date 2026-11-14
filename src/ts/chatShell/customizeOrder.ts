import { ACTION_IDS, type ActionId } from './actionSlots'

// deleteAfter and customizeButtons are never listed in the sheet, so a reorder must never move them.
export const CUSTOMIZABLE: readonly ActionId[] = ACTION_IDS.filter(id => id !== 'deleteAfter' && id !== 'customizeButtons')

function isCustomizable(id: ActionId): boolean {
    return CUSTOMIZABLE.includes(id)
}

// Built-ins absent from storage are appended in ACTION_IDS order, the order `partition` gives them.
export function withMissing(order: readonly ActionId[]): ActionId[] {
    return [...order, ...CUSTOMIZABLE.filter(id => !order.includes(id))]
}

export function customizableIds(order: readonly ActionId[]): ActionId[] {
    return withMissing(order).filter(isCustomizable)
}

// The visible ids are written back into the indices the visible ids already held, so every hidden id keeps its index.
// `nextVisible` must be a permutation of `customizableIds(order)`.
export function writeVisible(order: readonly ActionId[], nextVisible: readonly ActionId[]): ActionId[] {
    const result = withMissing(order)
    let next = 0
    for (let index = 0; index < result.length; index++) {
        if (isCustomizable(result[index])) result[index] = nextVisible[next++]
    }
    return result
}

export function moveVisible(order: readonly ActionId[], id: ActionId, delta: -1 | 1): ActionId[] | null {
    const visible = customizableIds(order)
    const from = visible.indexOf(id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= visible.length) return null
    const next = [...visible]
    next[from] = visible[to]
    next[to] = visible[from]
    return writeVisible(order, next)
}

// The gap is the number of row midpoints above `y`; both are in content coordinates.
export function dropGap(mids: readonly number[], y: number): number {
    return mids.filter(mid => mid < y).length
}

// Gap g is the line before visible row g. The gaps directly before and after the row are no-ops.
export function reorderVisible(order: readonly ActionId[], id: ActionId, gap: number): ActionId[] | null {
    const visible = customizableIds(order)
    const from = visible.indexOf(id)
    if (from < 0 || gap < 0 || gap > visible.length || gap === from || gap === from + 1) return null
    const next = visible.filter(item => item !== id)
    next.splice(gap > from ? gap - 1 : gap, 0, id)
    return writeVisible(order, next)
}
