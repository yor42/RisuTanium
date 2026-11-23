/**
 * Data order after a drag-reorder inside a windowed list. The list's DOM holds only the mounted
 * rows plus spacers, so the order cannot be read from the DOM alone as an unwindowed list does.
 */

/**
 * `domOrder` lists the list element's children after the drop: a row's data index, or `null`
 * for a spacer. The dragged row lands after the nearest row before it, else before the nearest
 * row after it. Returns the new order as data indexes (a permutation of `0..count-1`), or
 * `null` when the DOM does not describe a valid drop.
 */
export function orderAfterDrop(count: number, dragged: number, domOrder: readonly (number | null)[]): number[] | null {
    const at = domOrder.indexOf(dragged)
    if (at === -1 || dragged < 0 || dragged >= count) {
        return null
    }
    let before: number | null = null
    for (let i = at - 1; i >= 0; i--) {
        if (domOrder[i] !== null) {
            before = domOrder[i]
            break
        }
    }
    let after: number | null = null
    for (let i = at + 1; i < domOrder.length; i++) {
        if (domOrder[i] !== null) {
            after = domOrder[i]
            break
        }
    }
    const rest: number[] = []
    for (let i = 0; i < count; i++) {
        if (i !== dragged) {
            rest.push(i)
        }
    }
    let insertAt: number
    if (before !== null) {
        insertAt = rest.indexOf(before) + 1
    } else if (after !== null) {
        insertAt = rest.indexOf(after)
    } else {
        return null
    }
    if (insertAt < 0) {
        return null
    }
    rest.splice(insertAt, 0, dragged)
    return rest
}

/** The list element's children as `domOrder`: `idxOf` reads a row's data index, a child without one is a spacer. */
export function domOrderOf(list: Element, idxOf: (child: Element) => number | null): (number | null)[] {
    return Array.from(list.children).map((child) => (child.hasAttribute('data-window-spacer') ? null : idxOf(child)))
}

/** `orderAfterDrop` for a Sortable list whose rows carry their data index in the `attr` attribute of an element inside the row wrapper. */
export function orderAfterSortableDrop(list: Element, item: Element, attr: string, count: number): number[] | null {
    const idxOf = (child: Element): number | null => {
        const value = child.querySelector(`[${attr}]`)?.getAttribute(attr)
        const parsed = value === undefined || value === null ? NaN : parseInt(value)
        return Number.isNaN(parsed) ? null : parsed
    }
    const dragged = idxOf(item)
    if (dragged === null) {
        return null
    }
    return orderAfterDrop(count, dragged, domOrderOf(list, idxOf))
}
