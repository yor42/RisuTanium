// Gives every row of a first-message list an id that is local to one form instance, so a keyed each block can keep
// the DOM node of a row whose text survives a list change (delete, insert, undo, redo, restore) instead of
// rewriting every row after the change.
//
// Matching is by string identity: the common prefix and the common suffix of the previous and the new list keep
// their rows, and the remainder is paired by position, with any excess dropped or minted. Correctness never
// depends on the matching: every row shows the text at its own position, and the ids only decide whether a node
// is reused. Surviving ids keep their relative order, so a keyed reconcile only inserts and removes nodes.
export interface GreetingRow {
    readonly id: number
    readonly text: string
}

export interface GreetingRowKeys {
    // The rows for `list`. The same array is returned while the list holds the same strings, and a row object is
    // reused while its id and text are unchanged.
    rows(list: readonly string[]): readonly GreetingRow[]
}

export function createGreetingRowKeys(): GreetingRowKeys {
    // Plain variables, not state: the helper runs inside a derived, where writing state is forbidden.
    let previousRows: readonly GreetingRow[] = []
    // The strings of the last list. Comparing against these (not against row texts) keeps later comparisons on
    // identical string references.
    let previousTexts: readonly string[] = []
    let nextId = 0

    function rows(list: readonly string[]): readonly GreetingRow[] {
        const count = list.length
        const next: string[] = []
        for (let i = 0; i < count; i++) next.push(list[i])
        const oldCount = previousTexts.length

        const shared = Math.min(oldCount, count)
        let prefix = 0
        while (prefix < shared && previousTexts[prefix] === next[prefix]) prefix++
        let suffix = 0
        while (suffix < shared - prefix && previousTexts[oldCount - 1 - suffix] === next[count - 1 - suffix]) suffix++

        if (prefix + suffix === oldCount && prefix + suffix === count) {
            previousTexts = next
            return previousRows
        }

        const out: GreetingRow[] = []
        for (let i = 0; i < prefix; i++) out.push(previousRows[i])
        const oldMiddle = oldCount - prefix - suffix
        const newMiddle = count - prefix - suffix
        for (let i = 0; i < newMiddle; i++) {
            const text = next[prefix + i]
            if (i < oldMiddle) {
                const old = previousRows[prefix + i]
                out.push(old.text === text ? old : { id: old.id, text })
            } else {
                out.push({ id: nextId++, text })
            }
        }
        for (let i = 0; i < suffix; i++) out.push(previousRows[oldCount - suffix + i])

        previousTexts = next
        previousRows = out
        return out
    }

    return { rows }
}
