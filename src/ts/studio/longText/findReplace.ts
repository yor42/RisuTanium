import type { Edit } from './highlightSpans'

/**
 * Literal find and replace over the field's LF text. Offsets are UTF-16 offsets into that text, the same ones the
 * textarea's selection uses.
 */
export type FindOptions = { caseSensitive: boolean }
export type Match = { start: number; end: number }

/** The most matches listed; one more is reported as `capped`. */
export const MATCH_LIMIT = 10_000

/** A hyphen is left alone: `\-` is a SyntaxError under the `u` flag. */
function escaped(query: string): string {
    return query.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

function expressionOf(query: string, o: FindOptions): RegExp {
    return new RegExp(escaped(query), o.caseSensitive ? 'gu' : 'giu')
}

export function findMatches(text: string, query: string, o: FindOptions): { matches: Match[]; capped: boolean } {
    const matches: Match[] = []
    if (query === '') return { matches, capped: false }
    for (const found of text.matchAll(expressionOf(query, o))) {
        if (matches.length === MATCH_LIMIT) return { matches, capped: true }
        matches.push({ start: found.index, end: found.index + found[0].length })
    }
    return { matches, capped: false }
}

/** Every match replaced by `replacement` as typed: a function replacer keeps `$&`, `$1` and `$$` literal. */
export function replaceAllIn(text: string, query: string, replacement: string, o: FindOptions): { text: string; count: number } {
    if (query === '') return { text, count: 0 }
    let count = 0
    const next = text.replace(expressionOf(query, o), () => {
        count += 1
        return replacement
    })
    return { text: next, count }
}

/** The index of the first match starting at or after `caret` (direction 1) or the last one ending at or before it (-1); wraps. */
export function nearestMatch(matches: readonly Match[], caret: number, direction: 1 | -1): number | null {
    if (matches.length === 0) return null
    if (direction === 1) {
        const at = matches.findIndex((match) => match.start >= caret)
        return at < 0 ? 0 : at
    }
    for (let at = matches.length - 1; at >= 0; at--) {
        if (matches[at].end <= caret) return at
    }
    return matches.length - 1
}

/** An offset before the edit stays, one after it shifts by the length change, one inside it goes to the end of the new text. */
export function mapCaret(offset: number, edit: Edit): number {
    if (offset <= edit.start) return offset
    if (offset >= edit.start + edit.removed) return offset + edit.inserted - edit.removed
    return edit.start + edit.inserted
}

/** The surface of the field a find bar drives. The field component's exports satisfy it. */
export interface FindTarget {
    value(): string
    selection(): { start: number; end: number }
    reveal(start: number, end: number, refocus?: HTMLElement | null): void
    keepScroll(fn: () => void): void
    insertText(start: number, end: number, text: string, caret: number): void
}
