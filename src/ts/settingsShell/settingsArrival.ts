/**
 * Arriving on a search result: one sequence owns the whole landing (close the search, set the index, wait for the
 * page, reveal the row, centre it, highlight it, focus it). The sequence holds a token; a new arrival, a reopened
 * search or a torn-down shell invalidates it, and every step after a wait checks it, so an aborted arrival moves
 * no focus and sets no highlight.
 *
 * The in-flight marker is a plain module variable and never reactive: an effect that reads it creates no
 * dependency, and clearing it re-runs nothing. Effects that restore scroll or move focus on a page change read
 * it synchronously in their body and yield while it is true.
 */

interface LiveArrival {
    token: number
    index: number
}

let lastToken = 0
let live: LiveArrival | null = null

/** Starts an arrival on `index` and returns its token; any arrival in flight is invalidated. */
export function beginArrival(index: number): number {
    lastToken += 1
    live = { token: lastToken, index }
    return lastToken
}

/** Ends the arrival that owns `token`; a token that was already invalidated changes nothing. */
export function endArrival(token: number): void {
    if (live?.token === token) live = null
}

/** Invalidates the arrival in flight, if any. */
export function cancelArrival(): void {
    live = null
}

/** Whether an arrival that targets `index` is in flight. */
export function arrivalInFlight(index: number): boolean {
    return live !== null && live.index === index
}

function arrivalIsLive(token: number): boolean {
    return live?.token === token
}

/** Where a result lands: a page or view index, and the row on it (null for the page or view itself). */
export interface ArrivalTarget {
    index: number
    rowId: string | null
}

/** What a mounted page offers an arrival. */
export interface ArrivalPage {
    /** Opens whatever hides the row and resolves with the row element, or null when the page has no such row. */
    reveal(rowId: string): Promise<HTMLElement | null>
    focusHeading(): void
}

export interface ArrivalDeps {
    setIndex(index: number): void
    /** Closes the search without invalidating the arrival that called it. */
    closeSearch(): void
    /** Resolves after the pending render, so the page for the new index is mounted. */
    tick(): Promise<void>
    page(): ArrivalPage | undefined
    setHighlight(rowId: string): void
    reducedMotion(): boolean
    /** Moves focus into a revealed row; defaults to `focusFirstControl`. */
    focusControl?(row: HTMLElement): void
}

const FOCUSABLE_SELECTOR = [
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'button:not([disabled])',
    'a[href]',
    '[tabindex]:not([tabindex="-1"])',
].join(', ')

/** Focuses the first focusable element in the row; false when the row holds none. */
export function focusFirstControl(row: HTMLElement): boolean {
    const control = row.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    if (!control) return false
    control.focus()
    return true
}

/**
 * Lands on a result. A row target is revealed, centred (instantly under reduced motion), highlighted and focused;
 * a page or view target, and a row the page does not have, focus the page heading. The view always lands at the
 * top: scroll memory is not applied on an arrival.
 */
export async function runSettingsArrival(target: ArrivalTarget, deps: ArrivalDeps): Promise<void> {
    const token = beginArrival(target.index)
    try {
        deps.closeSearch()
        deps.setIndex(target.index)
        await deps.tick()
        if (!arrivalIsLive(token)) return
        const page = deps.page()
        if (!page) return
        if (target.rowId === null) {
            page.focusHeading()
            return
        }
        const row = await page.reveal(target.rowId)
        if (!arrivalIsLive(token)) return
        if (!row) {
            page.focusHeading()
            return
        }
        row.scrollIntoView({ block: 'center', behavior: deps.reducedMotion() ? 'instant' : 'smooth' })
        deps.setHighlight(target.rowId)
        if (deps.focusControl) deps.focusControl(row)
        else focusFirstControl(row)
    } finally {
        endArrival(token)
    }
}
