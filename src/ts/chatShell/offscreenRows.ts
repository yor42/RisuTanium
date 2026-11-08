const ROW_SELECTOR = 'article[data-part="chat-message"]'
const CONTAINER_SELECTOR = '[data-part="chat-message-container"]'

// Mounted articles that lie wholly below (newer) or above (older) the scroller's viewport.
// Each row is classified by its container's box, else its own: a read inside a skipped (content-visibility) container forces that row's layout,
// while the container's own box is ordinary layout. The container is the article's only enclosing box, so both classify a row the same way.
// A render-failed row has no article and is not counted.
export function offscreenRowCounts(scroller: HTMLElement, rows: HTMLElement | undefined): { newer: number, older: number } {
    const viewport = scroller.getBoundingClientRect()
    let newer = 0
    let older = 0
    for (const row of rows?.querySelectorAll<HTMLElement>(ROW_SELECTOR) ?? []) {
        const box = (row.closest<HTMLElement>(CONTAINER_SELECTOR) ?? row).getBoundingClientRect()
        if (box.top >= viewport.bottom) newer += 1
        else if (box.bottom <= viewport.top) older += 1
    }
    return { newer, older }
}
