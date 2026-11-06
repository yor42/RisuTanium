import type { PanelItem, PanelSource, PanelValueRow } from './togglePanel'

/**
 * Search and the on-only filter of the toggles panel (TOGGLES_SPEC §6). Pure: a query and a reader of "this row counts as
 * on" go in, the visible part of the panel comes out. Nothing here reads or writes a toggle value.
 *
 * A query matches the label of a toggle, its key, the names of its section and its author group, and the labels of a
 * select's options, case-insensitively. A query of consonant jamo (초성) is matched against the initial consonants of
 * the text: two or more jamo match anywhere, one jamo only at the start of a word, because a single common consonant
 * would otherwise match nearly every row. Spaces in the text are ignored for a query of several jamo.
 */

const INITIAL_CONSONANTS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
const HANGUL_FIRST = 0xAC00
const HANGUL_LAST = 0xD7A3
const SYLLABLES_PER_INITIAL = 588
const JAMO_QUERY = /^[ㄱ-ㅎ]+$/

/** The text with every Hangul syllable replaced by its initial consonant; other characters pass through, lower-cased. */
export function choseongOf(text: string): string {
    let out = ''
    for (const char of text) {
        const code = char.codePointAt(0) ?? 0
        out += code >= HANGUL_FIRST && code <= HANGUL_LAST
            ? INITIAL_CONSONANTS[Math.floor((code - HANGUL_FIRST) / SYLLABLES_PER_INITIAL)]
            : char.toLowerCase()
    }
    return out
}

function matchesAtWordStart(consonants: string, jamo: string): boolean {
    let from = consonants.indexOf(jamo)
    while (from !== -1) {
        if (from === 0 || !/[\p{L}\p{N}]/u.test(consonants[from - 1])) {
            return true
        }
        from = consonants.indexOf(jamo, from + 1)
    }
    return false
}

/** Whether `text` matches the trimmed, non-empty `query` under the rules above. */
export function textMatches(text: string, query: string): boolean {
    if (JAMO_QUERY.test(query)) {
        const consonants = choseongOf(text)
        // Several jamo may run across the spaces of the text, as people type initials of a phrase.
        return query.length === 1 ? matchesAtWordStart(consonants, query) : consonants.replace(/\s+/g, '').includes(query)
    }
    return text.toLowerCase().includes(query.toLowerCase())
}

/** Where a shown row sits (source name, then the author group's name) and, when only an option matched, that option. */
export type RowMatch = { path: string[], option: string | null }

export type FilteredSource = {
    source: PanelSource
    // The rows that show, with their author groups narrowed to the shown rows; captions and dividers are left out.
    items: PanelItem[]
    matches: ReadonlyMap<string, RowMatch>
}

export type FilterResult = {
    sources: FilteredSource[]
    // Distinct keys shown and distinct keys in the whole panel: a key defined by two sources counts once.
    shown: number
    total: number
}

export type FilterOptions = {
    query: string
    onlyOn: boolean
    // Whether the row counts for the on-only filter (it is on, or the chat holds its own differing value).
    passesOn: (row: PanelValueRow) => boolean
}

/** The part of the panel that shows for a query and the on-only filter. Both apply together; an empty query lists every row. */
export function filterPanel(sources: readonly PanelSource[], options: FilterOptions): FilterResult {
    const query = options.query.trim()
    const everyKey = new Set<string>()
    const shownKeys = new Set<string>()
    const result: FilteredSource[] = []

    const evaluate = (row: PanelValueRow, path: string[], containerHit: boolean): RowMatch | null => {
        if (options.onlyOn && !options.passesOn(row)) {
            return null
        }
        if (query === '' || containerHit || textMatches(row.label, query) || textMatches(row.key, query)) {
            return { path, option: null }
        }
        const option = row.options.find((candidate) => textMatches(candidate, query))
        return option === undefined ? null : { path, option }
    }

    for (const source of sources) {
        const sourceHit = query !== '' && (textMatches(source.name, query) || textMatches(source.detail, query))
        const matches = new Map<string, RowMatch>()
        const items: PanelItem[] = []
        for (const item of source.items) {
            if (item.type === 'row') {
                everyKey.add(item.key)
                const match = evaluate(item, [source.name], sourceHit)
                if (match) {
                    matches.set(item.uid, match)
                    shownKeys.add(item.key)
                    items.push(item)
                }
            } else if (item.type === 'group') {
                const groupHit = sourceHit || (query !== '' && textMatches(item.label, query))
                const children: PanelValueRow[] = []
                for (const child of item.children) {
                    if (child.type !== 'row') {
                        continue
                    }
                    everyKey.add(child.key)
                    const match = evaluate(child, [source.name, item.label], groupHit)
                    if (match) {
                        matches.set(child.uid, match)
                        shownKeys.add(child.key)
                        children.push(child)
                    }
                }
                if (children.length > 0) {
                    items.push({ ...item, children })
                }
            }
        }
        if (items.length > 0) {
            result.push({ source, items, matches })
        }
    }
    return { sources: result, shown: shownKeys.size, total: everyKey.size }
}
