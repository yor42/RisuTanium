const ROW_SELECTOR = '[data-part="chat-message-container"], [data-part="chat-first-message"]'
const PROPERTY = 'content-visibility'
const FIRST_BATCH = 2

// How far, in px, the settled rows must reach above the target's top and below it (measured from the target's top).
export interface SettleReach {
    above: number
    below: number
}

// Lays out the target and the rows around it at their real sizes: a row whose `content-visibility: auto` skips it is sized by an estimate
// until something reads inside it, and a jump that measures before that moves its target afterwards. The rows are forced with an inline
// `content-visibility: visible`, so the caller's next geometry read sees the real sizes; the engine remembers them once the property is removed.
// The list is laid out newest first, so the DOM order runs newest to oldest: older rows are the following siblings and newer rows the preceding ones.
// A sibling that is not a message row (the load-more button) is passed over and never forced.
// The returned release removes the property from the rows this call set. It is idempotent and works on rows that have left the document.
export function settleBand(target: HTMLElement, reach: SettleReach): () => void {
    const touched: HTMLElement[] = []
    function force(row: HTMLElement): void {
        if (row.style.getPropertyValue(PROPERTY) === 'visible') return
        row.style.setProperty(PROPERTY, 'visible')
        touched.push(row)
    }
    // Forces up to `count` rows from the cursor on and returns the last row forced (or `last` when none was) with the cursor after it.
    function take(cursor: Element | null, step: (row: Element) => Element | null, count: number, last: HTMLElement): { cursor: Element | null, last: HTMLElement } {
        let taken = 0
        let current = cursor
        let latest = last
        while (current !== null && taken < count) {
            if (current instanceof HTMLElement && current.matches(ROW_SELECTOR)) {
                force(current)
                latest = current
                taken += 1
            }
            current = step(current)
        }
        return { cursor: current, last: latest }
    }
    force(target)
    let olderCursor: Element | null = target.nextElementSibling
    let newerCursor: Element | null = target.previousElementSibling
    let oldest: HTMLElement = target
    let newest: HTMLElement = target
    let olderDone = false
    let newerDone = false
    for (let batch = FIRST_BATCH; !olderDone || !newerDone; batch *= 2) {
        // One rect read lays out everything forced so far, so the spans below are measured on settled rows.
        const targetTop = target.getBoundingClientRect().top
        if (!olderDone && (olderCursor === null || targetTop - oldest.getBoundingClientRect().top >= reach.above)) olderDone = true
        if (!newerDone && (newerCursor === null || newest.getBoundingClientRect().bottom - targetTop >= reach.below)) newerDone = true
        if (!olderDone) {
            const result = take(olderCursor, (row) => row.nextElementSibling, batch, oldest)
            olderCursor = result.cursor
            oldest = result.last
        }
        if (!newerDone) {
            const result = take(newerCursor, (row) => row.previousElementSibling, batch, newest)
            newerCursor = result.cursor
            newest = result.last
        }
    }
    let released = false
    return () => {
        if (released) return
        released = true
        for (const row of touched) row.style.removeProperty(PROPERTY)
        touched.length = 0
    }
}
