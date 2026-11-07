// Studio search: what matches, what is searched and how a hit is shown. Pure: it reads the owner model and the plain
// text of resident items, and nothing else. It never writes, never loads or acquires a module, and never reads
// the body of a module that is not resident; a private character, its chat and every unloaded module are not searched.
import { textMatches } from '../chatShell/toggleSearch'
import { itemSectionsOf, type ItemTextSources } from './itemText'
import type { OwnerModel, OwnerNode, StudioItem, StudioKind, KindNode } from './ownerModel'
import type { SearchWork } from './searchRunner'
import type { StudioOwnerType } from './studioTarget'

export type SearchChip = 'regex' | 'lore' | 'toggles' | 'scripts' | 'info'

export const SEARCH_CHIPS: readonly SearchChip[] = ['regex', 'lore', 'toggles', 'scripts', 'info']

/** The chip that lists a kind; every kind without a chip of its own is Info. */
export function chipOfKind(kind: StudioKind): SearchChip {
    switch (kind) {
        case 'regex': return 'regex'
        case 'lore': return 'lore'
        case 'toggles': return 'toggles'
        case 'scripts': return 'scripts'
        default: return 'info'
    }
}

/** The characters around a match that a snippet keeps on each side. */
export const SNIPPET_CONTEXT = 40

export interface MarkedSegment {
    text: string
    marked: boolean
}

export interface Snippet {
    segments: MarkedSegment[]
    /** The text goes on before / after the snippet. */
    before: boolean
    after: boolean
}

export interface ItemMatch {
    name: MarkedSegment[]
    /** Where a word matched in the item's text; null when every word matched by name. */
    snippet: Snippet | null
}

export interface PreparedQuery {
    /** The words of the query, split on whitespace runs. */
    words: string[]
    /** One case-insensitive pattern per word, aligned with `words`. */
    patterns: RegExp[]
}

function escapeRegExp(word: string): string {
    return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function searchWordsOf(query: string): string[] {
    return query.split(/\s+/u).filter((word) => word !== '')
}

export function prepareQuery(query: string): PreparedQuery {
    const words = searchWordsOf(query)
    return { words, patterns: words.map((word) => new RegExp(escapeRegExp(word), 'iu')) }
}

/** The text cut into runs that are, or are not, an occurrence of one of the words. */
export function markedSegmentsOf(text: string, words: readonly string[]): MarkedSegment[] {
    if (text === '') return []
    if (words.length === 0) return [{ text, marked: false }]
    // The longer word first, so a word that contains another is marked whole.
    const ordered = [...words].sort((a, b) => b.length - a.length)
    const pattern = new RegExp(ordered.map(escapeRegExp).join('|'), 'giu')
    const segments: MarkedSegment[] = []
    let from = 0
    for (const hit of text.matchAll(pattern)) {
        if (hit.index > from) segments.push({ text: text.slice(from, hit.index), marked: false })
        segments.push({ text: hit[0], marked: true })
        from = hit.index + hit[0].length
    }
    if (from < text.length) segments.push({ text: text.slice(from), marked: false })
    return segments
}

// A cut must not fall between the two halves of a surrogate pair.
function safeCut(text: string, at: number, direction: 1 | -1): number {
    if (at <= 0) return 0
    if (at >= text.length) return text.length
    const code = text.charCodeAt(at)
    if (code >= 0xdc00 && code <= 0xdfff) return at + direction
    return at
}

function snippetOf(text: string, index: number, length: number, words: readonly string[]): Snippet {
    const start = safeCut(text, index - SNIPPET_CONTEXT, 1)
    const end = safeCut(text, index + length + SNIPPET_CONTEXT, -1)
    return {
        segments: markedSegmentsOf(text.slice(start, end), words),
        before: start > 0,
        after: end < text.length,
    }
}

/** What matching needs to know of one item. `texts` is read only when a word did not match by name. */
export interface MatchTarget {
    label: string
    kindLabel: string
    texts: () => readonly string[]
}

/**
 * Whether every word of the query matches the item's name, its kind's name or one of its texts, in any order.
 * A word is matched against the names the way the toggles panel matches (초성 included); against the texts it is
 * a plain case-insensitive occurrence, so a consonant query never matches a text by its initials.
 * An empty query matches everything.
 */
export function matchItem(query: PreparedQuery, target: MatchTarget): ItemMatch | null {
    const { words, patterns } = query
    let texts: readonly string[] | null = null
    let anchor: { text: string, index: number, length: number } | null = null
    for (let at = 0; at < words.length; at++) {
        const word = words[at]
        if (textMatches(target.label, word) || textMatches(target.kindLabel, word)) continue
        texts ??= target.texts()
        let found = false
        for (const text of texts) {
            const hit = patterns[at].exec(text)
            if (!hit) continue
            found = true
            anchor ??= { text, index: hit.index, length: hit[0].length }
            break
        }
        if (!found) return null
    }
    return {
        name: markedSegmentsOf(target.label, words),
        snippet: anchor ? snippetOf(anchor.text, anchor.index, anchor.length, words) : null,
    }
}

/** Search covers resident modules and the presets; a module whose body is not resident is only counted. */
export interface SearchUnit {
    owner: OwnerNode
    node: KindNode
    /** The owner is not active (an unused module or preset): its hits are tagged Off. */
    off: boolean
}

export interface SearchPlan {
    units: SearchUnit[]
    /** Modules that were not searched because their body is not loaded. */
    unloaded: number
}

/** The number of owners that are not searched because their body is not resident. Plugins are not searched. */
export function unloadedCountOf(model: OwnerModel): number {
    let unloaded = 0
    for (const owner of model.owners) {
        if (owner.type !== 'plugin' && owner.stub) unloaded += 1
    }
    return unloaded
}

/**
 * The kinds to scan, in tree order: the bound character, this chat, active modules, other resident modules,
 * the active preset and the other presets. Plugins, unloaded modules and private content are left out.
 */
export function planSearch(model: OwnerModel): SearchPlan {
    const units: SearchUnit[] = []
    for (const owner of model.owners) {
        if (owner.type === 'plugin' || owner.stub || owner.restricted) continue
        for (const node of owner.kinds()) {
            if (node.count + node.folderCount === 0) continue
            units.push({ owner, node, off: !owner.active })
        }
    }
    return { units, unloaded: unloadedCountOf(model) }
}

export interface SearchLabels {
    kind(kind: StudioKind): string
    item(item: StudioItem): string
}

export interface SearchResult {
    /** The item id; valid for the visit only. */
    id: string
    ownerKey: string
    ownerType: StudioOwnerType
    ownerName: string
    off: boolean
    kind: StudioKind
    index: number
    chip: SearchChip
    label: string
    kindLabel: string
    match: ItemMatch
}

export interface SearchRequest {
    query: PreparedQuery
    chips: ReadonlySet<SearchChip>
    labels: SearchLabels
    /** The plain fields item text is read from; without them only names are searched. */
    sources: ItemTextSources | null
}

/** Whether a request lists anything: a query, or a chip that lists a whole kind. */
export function searchIsActive(query: PreparedQuery, chips: ReadonlySet<SearchChip>): boolean {
    return query.words.length > 0 || chips.size > 0
}

/**
 * The work a run walks. An empty query with chips lists every item of the chosen chips; an empty query without
 * chips searches nothing. A chip limits a query to its kinds.
 */
export function createSearchWork(plan: SearchPlan, request: SearchRequest): SearchWork<SearchResult> | null {
    if (!searchIsActive(request.query, request.chips)) return null
    let loaded: { unit: number, items: StudioItem[] } | null = null
    const wanted = (unit: SearchUnit): boolean => request.chips.size === 0 || request.chips.has(chipOfKind(unit.node.kind))
    const itemsOf = (unit: number): StudioItem[] => {
        if (loaded?.unit !== unit) {
            const entry = plan.units[unit]
            loaded = { unit, items: entry && wanted(entry) ? entry.node.items() : [] }
        }
        return loaded.items
    }
    return {
        unitCount: plan.units.length,
        itemCount: (unit) => itemsOf(unit).length,
        scan(unit, index) {
            const entry = plan.units[unit]
            const item = itemsOf(unit)[index]
            // A list that shrank since it was read leaves no item at the index.
            if (!entry || !item) return null
            const label = request.labels.item(item)
            const kindLabel = request.labels.kind(item.kind)
            const match = matchItem(request.query, {
                label,
                kindLabel,
                texts: () => {
                    const sections = request.sources ? itemSectionsOf(entry.owner, item, request.sources) : null
                    return sections ? sections.map((section) => section.text) : []
                },
            })
            if (!match) return null
            return {
                id: item.id,
                ownerKey: entry.owner.key,
                ownerType: entry.owner.type,
                ownerName: entry.owner.name,
                off: entry.off,
                kind: item.kind,
                index: item.index,
                chip: chipOfKind(item.kind),
                label,
                kindLabel,
                match,
            }
        },
    }
}

/** The tree rows to open, and the pages to show, so that a result's owner row is on screen. */
export interface ResultPlacement {
    /** Group names (`modules`, `otherModules`, `presets`, `otherPresets`, `plugins`) to expand. */
    groups: string[]
    /** The group whose page list holds the owner, with the zero-based page the owner sits on. */
    page: { group: string, index: number } | null
}

export function placementOf(model: OwnerModel, owner: OwnerNode, pageSize: number): ResultPlacement {
    const pageOf = (list: readonly OwnerNode[], group: string): { group: string, index: number } | null => {
        const at = list.indexOf(owner)
        return at < 0 ? null : { group, index: Math.floor(at / pageSize) }
    }
    switch (owner.type) {
        case 'module':
            return owner.active
                ? { groups: ['modules'], page: pageOf(model.modules, 'modules') }
                : { groups: ['otherModules'], page: pageOf(model.otherModules, 'otherModules') }
        case 'preset':
            return owner.active
                ? { groups: ['presets'], page: null }
                : { groups: ['presets', 'otherPresets'], page: pageOf(model.otherPresets, 'otherPresets') }
        case 'plugin':
            return { groups: ['plugins'], page: pageOf(model.plugins, 'plugins') }
        default:
            return { groups: [], page: null }
    }
}
