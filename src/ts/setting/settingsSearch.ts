import { language } from '../../lang'
import { languageEnglish } from '../../lang/en'
import { languageKorean } from '../../lang/ko'
import { textMatches } from '../chatShell/toggleSearch'
import { markedSegmentsOf, type MarkedSegment } from '../studio/studioSearch'

/**
 * Settings search (DS-007, DS-015): what is indexed, how a query matches and how hits rank. Pure apart from the
 * language tables it reads: a list of sources goes in, an index and then ranked hits come out. No UI text lives
 * here, and nothing is stored.
 *
 * Every entry is matchable by its English text, its Korean text and the live UI language, whatever the UI language
 * is. A query is split into words, case-insensitively, and the words other than filler words must all match some
 * field of the same entry; a filler word never has to match when the query holds another word. A word matches at the start
 * of a token of the text, or inside a token when the word has 3 or more characters. A one-letter word matches only
 * at a token start. Spacing is normalised, so "채팅봇" and "채팅 봇" find each other, and a run of consonant jamo
 * (초성) is matched with the shared rule of the toggles panel.
 */

/** Where a result lands: a page or view index, and a row on it (null for the page or view itself). */
export interface SearchTarget {
    readonly index: number
    readonly rowId: string | null
}

export type SearchEntryKind = 'setting' | 'page'

/** An item to index, before any language is applied: only keys, never the text of a language. */
export interface SearchSource {
    readonly id: string
    readonly kind: SearchEntryKind
    readonly target: SearchTarget
    readonly labelKey?: string
    readonly fallbackLabel?: string
    readonly helpKey?: string
    /** Keys of language entries holding synonyms, separated by a comma, a fullwidth comma or an ideographic comma. */
    readonly synonymKeys?: readonly string[]
    readonly keywords?: readonly string[]
}

export type LanguageTable = Readonly<Record<string, unknown>>

/** The tables an index reads: the live UI language first, then the two languages that always match. */
export interface LanguageTables {
    readonly current: LanguageTable
    readonly english: LanguageTable
    readonly korean: LanguageTable
}

interface IndexedText {
    readonly raw: string
    readonly tokens: readonly string[]
    /** The lower-cased text with every separator removed. */
    readonly compact: string
}

export interface SearchEntry {
    readonly id: string
    readonly kind: SearchEntryKind
    readonly target: SearchTarget
    /** The label in the live UI language; what a result shows. */
    readonly label: string
    readonly labels: readonly IndexedText[]
    readonly synonyms: readonly IndexedText[]
    readonly keywords: readonly IndexedText[]
    readonly help: readonly IndexedText[]
}

const SEPARATORS = /[^\p{L}\p{N}]+/u
const SEPARATORS_GLOBAL = /[^\p{L}\p{N}]+/gu
const SYNONYM_SEPARATORS = /[,，、]/u
const JAMO_WORD = /^[ㄱ-ㅎ]+$/u

function indexText(raw: string): IndexedText {
    const lower = raw.toLowerCase()
    return {
        raw,
        tokens: lower.split(SEPARATORS).filter((token) => token !== ''),
        compact: lower.replace(SEPARATORS_GLOBAL, ''),
    }
}

function stringAt(table: LanguageTable, key: string): string | null {
    const value = table[key]
    return typeof value === 'string' && value !== '' ? value : null
}

function helpAt(table: LanguageTable, key: string): string | null {
    const help = table.help
    if (typeof help !== 'object' || help === null) return null
    const value: unknown = Reflect.get(help, key)
    return typeof value === 'string' && value !== '' ? value : null
}

/** The values of `read` over the tables, current language first, without repeats. */
function distinctOver(tables: LanguageTables, read: (table: LanguageTable) => readonly string[]): string[] {
    const seen = new Set<string>()
    for (const table of [tables.current, tables.english, tables.korean]) {
        for (const value of read(table)) seen.add(value)
    }
    return [...seen]
}

/** Builds the entries of `sources` for `tables`. An absent or empty language entry is skipped, never indexed as text. */
export function buildSearchEntries(sources: readonly SearchSource[], tables: LanguageTables): SearchEntry[] {
    const entries: SearchEntry[] = []
    for (const source of sources) {
        const labelKey = source.labelKey
        const helpKey = source.helpKey
        const synonymKeys = source.synonymKeys ?? []
        const labelTexts = distinctOver(tables, (table) => {
            const text = labelKey === undefined ? null : stringAt(table, labelKey)
            return text === null ? [] : [text]
        })
        if (labelTexts.length === 0 && source.fallbackLabel) labelTexts.push(source.fallbackLabel)
        if (labelTexts.length === 0) continue
        const current = labelKey === undefined ? null : stringAt(tables.current, labelKey)
        entries.push({
            id: source.id,
            kind: source.kind,
            target: source.target,
            label: current ?? labelTexts[0],
            labels: labelTexts.map(indexText),
            synonyms: distinctOver(tables, (table) => synonymKeys.flatMap((key) => {
                const text = stringAt(table, key)
                return text === null ? [] : text.split(SYNONYM_SEPARATORS).map((part) => part.trim()).filter((part) => part !== '')
            })).map(indexText),
            keywords: (source.keywords ?? []).filter((keyword) => keyword !== '').map(indexText),
            help: distinctOver(tables, (table) => {
                const text = helpKey === undefined ? null : helpAt(table, helpKey)
                return text === null ? [] : [text]
            }).map(indexText),
        })
    }
    return entries
}

let memo: { token: number, table: object, entries: SearchEntry[] } | null = null

/**
 * The index for the current open of the search and the current UI language. It is built on first use, and the
 * live `language` binding's identity is part of the key because a language switch replaces it. Closing the search
 * drops it.
 */
export function getSettingsIndex(token: number, makeSources: () => readonly SearchSource[]): readonly SearchEntry[] {
    if (memo !== null && memo.token === token && memo.table === language) return memo.entries
    const entries = buildSearchEntries(makeSources(), { current: language, english: languageEnglish, korean: languageKorean })
    memo = { token, table: language, entries }
    return entries
}

export function dropSettingsIndex(): void {
    memo = null
}

// Tiers, best first. A hit in a label is exact, a prefix, at a word start, or inside a word; a synonym or keyword
// comes next, and a help text last.
const TIER_EXACT = 0
const TIER_PREFIX = 1
const TIER_WORD_START = 2
const TIER_INSIDE = 3
const TIER_SYNONYM = 4
const TIER_HELP = 5

/** The shown results of a group, and how many more than that the group holds. */
export const GROUP_SHOWN = 5
/** A group stops collecting at this many hits, before sorting, so a broad query stays cheap. */
export const GROUP_COLLECT_CAP = 50

/**
 * Words that carry no meaning of their own. A filler word never has to match when the query holds another word
 * (DS-015). Match tokens: English words lower-cased, Korean words as they are written.
 */
export const FILLER_WORDS: ReadonlySet<string> = new Set([
    'to', 'the', 'a', 'an', 'how', 'change', 'set', 'make',
    '설정', '변경', '바꾸기',
])

const NO_TIER = Number.POSITIVE_INFINITY

/** The tier a word matches a text at (word start, or inside a token for 3 or more characters), or `NO_TIER`. */
function tokenTier(word: string, text: IndexedText): number {
    if (text.tokens.some((token) => token.startsWith(word))) return TIER_WORD_START
    if (word.length >= 3 && text.tokens.some((token) => token.includes(word))) return TIER_INSIDE
    return NO_TIER
}

/** The best tier at which one word matches the entry, or null when it matches nothing of the entry. */
function wordTier(word: string, entry: SearchEntry): number | null {
    let best = NO_TIER
    if (JAMO_WORD.test(word)) {
        // 초성 queries read names only: labels and synonyms, never keywords or help text.
        if (entry.labels.some((label) => textMatches(label.raw, word))) best = TIER_INSIDE
        else if (entry.synonyms.some((synonym) => textMatches(synonym.raw, word))) best = TIER_SYNONYM
        return best === NO_TIER ? null : best
    }
    for (const label of entry.labels) best = Math.min(best, tokenTier(word, label))
    if (best === TIER_WORD_START) return best
    if (entry.synonyms.some((text) => tokenTier(word, text) !== NO_TIER)
        || entry.keywords.some((text) => tokenTier(word, text) !== NO_TIER)) best = Math.min(best, TIER_SYNONYM)
    if (best === NO_TIER && entry.help.some((text) => tokenTier(word, text) !== NO_TIER)) best = TIER_HELP
    return best === NO_TIER ? null : best
}

/**
 * The tier of the whole query, spacing removed, against a label (exact, prefix, or inside when `inside`) and
 * against a synonym. `compact` is the query with its separators removed.
 */
function wholeTier(compact: string, inside: boolean, entry: SearchEntry): number | null {
    if (compact === '') return null
    let best: number | null = null
    for (const label of entry.labels) {
        if (label.compact === compact) return TIER_EXACT
        if (label.compact.startsWith(compact)) best = best === null ? TIER_PREFIX : Math.min(best, TIER_PREFIX)
        else if (inside && compact.length >= 3 && label.compact.includes(compact)) best = best === null ? TIER_INSIDE : Math.min(best, TIER_INSIDE)
    }
    if (best !== null) return best
    for (const synonym of entry.synonyms) {
        if (synonym.compact === compact || synonym.compact.startsWith(compact)
            || (inside && compact.length >= 3 && synonym.compact.includes(compact))) return TIER_SYNONYM
    }
    return null
}

/** Whether the compact query is a label's start: the rule that pins a page. */
function labelStartsWith(compact: string, entry: SearchEntry): boolean {
    return compact !== '' && entry.labels.some((label) => label.compact.startsWith(compact))
}

/** A query's words with their spacing removed, and whether the joined form may match inside a label. */
interface JoinedForm {
    readonly compact: string
    readonly inside: boolean
}

/**
 * The tier at which the entry qualifies: every required word matches some field of it, or one of the joined forms
 * matches. It is the best of the applicable tiers, and null when none applies.
 */
function strictTier(required: readonly string[], joined: readonly JoinedForm[], entry: SearchEntry): number | null {
    let worst = TIER_EXACT
    let everyWord = true
    for (const word of required) {
        const tier = wordTier(word, entry)
        if (tier === null) {
            everyWord = false
            break
        }
        if (tier > worst) worst = tier
    }
    let best: number | null = everyWord ? worst : null
    for (const form of joined) {
        const whole = wholeTier(form.compact, form.inside, entry)
        if (whole !== null && (best === null || whole < best)) best = whole
    }
    return best
}

/** How many of the words match the entry, and the best tier among those that do; null when none does. */
function anyWordScore(words: readonly string[], entry: SearchEntry): { matched: number, tier: number } | null {
    let matched = 0
    let best = TIER_HELP
    for (const word of words) {
        const tier = wordTier(word, entry)
        if (tier === null) continue
        matched += 1
        if (tier < best) best = tier
    }
    return matched === 0 ? null : { matched, tier: best }
}

export interface SearchHit {
    readonly entry: SearchEntry
    readonly tier: number
    /** How many required query words matched; fewer than the required words only in the any-word pass. */
    readonly matched: number
    /** The current-language label cut into marked and plain runs, for display. */
    readonly label: readonly MarkedSegment[]
}

export interface SearchGroup {
    readonly kind: SearchEntryKind
    /** Ranked hits, at most `GROUP_COLLECT_CAP`. */
    readonly hits: readonly SearchHit[]
    /** The first `GROUP_SHOWN` hits. */
    readonly shown: readonly SearchHit[]
}

export interface SearchOutcome {
    /** Pages whose name equals or starts with the query, ahead of the groups. */
    readonly pinned: readonly SearchHit[]
    /** The settings group, then the pages group. */
    readonly groups: readonly SearchGroup[]
    /** True when the hits come from the any-word retry: only some of the words matched. */
    readonly partial: boolean
}

function wordsOf(query: string): string[] {
    return query.toLowerCase().split(/\s+/u).filter((word) => word !== '')
}

function compactOf(words: readonly string[]): string | null {
    if (words.some((word) => JAMO_WORD.test(word))) return null
    return words.join('').toLowerCase().replace(SEPARATORS_GLOBAL, '')
}

interface Scored {
    entry: SearchEntry
    tier: number
    matched: number
}

function collect(entries: readonly SearchEntry[], score: (entry: SearchEntry) => { tier: number, matched: number } | null): Scored[] {
    const counts: Record<SearchEntryKind, number> = { setting: 0, page: 0 }
    const scored: Scored[] = []
    for (const entry of entries) {
        if (counts[entry.kind] >= GROUP_COLLECT_CAP) continue
        const result = score(entry)
        if (result === null) continue
        counts[entry.kind] += 1
        scored.push({ entry, tier: result.tier, matched: result.matched })
    }
    return scored
}

function outcomeOf(scored: Scored[], words: readonly string[], pinForms: readonly string[], partial: boolean): SearchOutcome {
    const hitOf = (item: Scored): SearchHit => ({
        entry: item.entry,
        tier: item.tier,
        matched: item.matched,
        label: markedSegmentsOf(item.entry.label, words),
    })
    const ranked = [...scored].sort((a, b) => a.tier - b.tier || b.matched - a.matched)
    const pinnedItems = partial || pinForms.length === 0
        ? []
        : ranked.filter((item) => item.entry.kind === 'page' && pinForms.some((form) => labelStartsWith(form, item.entry)))
    const groups: SearchGroup[] = (['setting', 'page'] as const).map((kind) => {
        const hits = ranked
            .filter((item) => item.entry.kind === kind && !pinnedItems.includes(item))
            .map(hitOf)
        return { kind, hits, shown: hits.slice(0, GROUP_SHOWN) }
    })
    return { pinned: pinnedItems.map(hitOf), groups, partial }
}

const EMPTY_OUTCOME: SearchOutcome = {
    pinned: [],
    groups: [
        { kind: 'setting', hits: [], shown: [] },
        { kind: 'page', hits: [], shown: [] },
    ],
    partial: false,
}

/**
 * Runs a query over an index. Filler words never have to match when the query holds another word: the required
 * words are the non-filler words, or all the words when every one is a filler. The strict pass keeps an entry when
 * every required word matches it, or when the joined form of the query as typed or of the required words does.
 * Only when that finds nothing does the any-word pass run, which sets `partial`. An empty query finds nothing.
 */
export function searchSettings(entries: readonly SearchEntry[], query: string): SearchOutcome {
    const words = wordsOf(query)
    if (words.length === 0) return EMPTY_OUTCOME

    const kept = words.filter((word) => !FILLER_WORDS.has(word))
    const required = kept.length > 0 ? kept : words
    const typedCompact = compactOf(words)
    const requiredCompact = compactOf(required)
    const joined: JoinedForm[] = []
    if (typedCompact !== null) joined.push({ compact: typedCompact, inside: words.length > 1 })
    if (requiredCompact !== null && requiredCompact !== typedCompact) joined.push({ compact: requiredCompact, inside: required.length > 1 })
    const pinForms = joined.map((form) => form.compact)

    const scored = collect(entries, (entry) => {
        const tier = strictTier(required, joined, entry)
        return tier === null ? null : { tier, matched: required.length }
    })
    if (scored.length > 0) return outcomeOf(scored, required, pinForms, false)

    if (required.length > 1) {
        const anyWord = collect(entries, (entry) => anyWordScore(required, entry))
        if (anyWord.length > 0) return outcomeOf(anyWord, required, [], true)
    }
    return EMPTY_OUTCOME
}
