import { dropSettingsIndex } from '../setting/settingsSearch'
import { cancelArrival } from './settingsArrival'

/** How long an arrived row stays highlighted. */
export const HIGHLIGHT_MS = 2000

/**
 * The settings search of the shell. In memory only: it starts closed and empty on every launch, and nothing
 * here is stored. `openToken` changes on each open so a search index built for one open is never served to the
 * next; `highlightedRow` is the row an arrival landed on, for a short while.
 */
export const settingsSearchState = $state({
    open: false,
    query: '',
    openToken: 0,
    highlightedRow: null as string | null,
})

let highlightTimer: ReturnType<typeof setTimeout> | null = null

function clearHighlightTimer(): void {
    if (highlightTimer !== null) {
        clearTimeout(highlightTimer)
        highlightTimer = null
    }
}

/** Opens the search on an empty query. Any arrival in flight is invalidated. */
export function openSearch(): void {
    cancelArrival()
    settingsSearchState.openToken += 1
    settingsSearchState.query = ''
    settingsSearchState.open = true
}

/**
 * Closes the search and forgets its query and index. It leaves an arrival in flight alone, because an arrival
 * closes the search itself as its first step.
 */
export function closeSearch(): void {
    settingsSearchState.open = false
    settingsSearchState.query = ''
    dropSettingsIndex()
}

/** Highlights a row for `HIGHLIGHT_MS`; a new highlight replaces the previous one and its timer. */
export function setHighlight(rowId: string): void {
    clearHighlightTimer()
    settingsSearchState.highlightedRow = rowId
    highlightTimer = setTimeout(() => {
        highlightTimer = null
        settingsSearchState.highlightedRow = null
    }, HIGHLIGHT_MS)
}

/** Shell teardown: no query, highlight, timer, index or arrival outlives the shell. */
export function resetSearch(): void {
    cancelArrival()
    clearHighlightTimer()
    settingsSearchState.highlightedRow = null
    closeSearch()
}
