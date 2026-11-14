// The in-chat search engine: how stored message text is normalised for matching, a bounded cache of those texts, the filters,
// the prompt-hidden rule and a sliced newest-first scan. Pure: no Svelte, no DB, no DOM; the caller owns reactivity and timers.
import type { Message } from '../storage/database.svelte'
import { replaceThoughtsBlocks } from '../parser/thoughts'
import { localDayStart } from './jumpTarget'

// ---- normalisation (DD-074): the stored text cleaned the same way for the query and for each message; macros and regex scripts are never expanded

const INLINE_TAGS = 'a|b|i|u|s|em|strong|del|ins|mark|small|sub|sup|code|kbd|span|font|abbr|cite|q|time|var|samp|dfn|bdi|bdo|wbr|ruby|rt|rp'
// `thoughts` is listed so a stray, unclosed Thoughts tag never stays searchable.
const BLOCK_TAGS = 'thoughts|p|br|hr|div|ul|ol|li|dl|dt|dd|h[1-6]|blockquote|pre|table|thead|tbody|tfoot|tr|td|th|img|figure|figcaption|details|summary|center|section|article|aside|header|footer|nav|label|button|input|textarea|select|option|audio|video|source|iframe|link|caption|col|colgroup|fieldset|legend|form|picture|svg|path|g|rect|circle|line'
// A tag matches only when `<` or `</` is followed directly by a known name, so `Array<string>` and `a < b and c > d` stay as written.
const INLINE_TAG_RE = new RegExp('</?(?:' + INLINE_TAGS + ')(?:\\s[^<>]*)?/?>', 'gi')
const BLOCK_TAG_RE = new RegExp('</?(?:' + BLOCK_TAGS + ')(?:\\s[^<>]*)?/?>', 'gi')

// Asset and inlay macros, copied from the renderer's macro names. Every other `{{...}}` is ordinary text.
const ASSET_MACRO_RE = /\{\{(?:raw|path|img|image|video|audio|bgm|bg|emotion|asset|video-img|source|inlay|inlayed|inlayeddata)::[\s\S]*?\}\}/gi
const STYLE_BLOCK_RE = /<style[\s\S]*?<\/style>/gi
const LINK_RE = /!?\[([^\]]*)\]\([^)]*\)/g
const FENCE_LINE_RE = /^[ \t]*(?:`{3,}|~{3,}).*$/gm
const HEADING_MARK_RE = /^[ \t]{0,3}#{1,6}[ \t]+/gm
const QUOTE_MARK_RE = /^[ \t]{0,3}>+[ \t]?/gm
const LEADING_UNDERSCORE_RE = /(^|[\s(\[])_+(?=\S)/g
const TRAILING_UNDERSCORE_RE = /(\S)_+(?=$|[\s)\].,!?;:])/g
const ENTITY_RE = /&(?:(amp|lt|gt|quot|apos|nbsp)|#(\d+)|#[xX]([0-9a-fA-F]+));/g
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' }

function codePointText(codePoint: number): string | null {
    if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10FFFF) return null
    if (codePoint >= 0xD800 && codePoint <= 0xDFFF) return null
    return String.fromCodePoint(codePoint)
}

function decodeEntity(whole: string, named: string | undefined, decimal: string | undefined, hex: string | undefined): string {
    if (named !== undefined) return NAMED_ENTITIES[named]
    const codePoint = decimal !== undefined ? parseInt(decimal, 10) : parseInt(hex ?? '', 16)
    return codePointText(codePoint) ?? whole
}

export interface NormalizeOptions {
    // Whether the text of closed Thoughts blocks is searchable.
    thinking: boolean
}

// Steps (a) to (i) minus the lowercasing: what a snippet shows.
function cleanText(text: string, thinking: boolean): string {
    let result = replaceThoughtsBlocks(text, thinking ? (inner) => ' ' + inner + ' ' : () => ' ')
    result = result.replace(STYLE_BLOCK_RE, ' ')
    result = result.replace(ASSET_MACRO_RE, ' ')
    result = result.replace(LINK_RE, '$1')
    result = result.replace(FENCE_LINE_RE, ' ').replace(HEADING_MARK_RE, '').replace(QUOTE_MARK_RE, '')
    result = result.replace(INLINE_TAG_RE, '').replace(BLOCK_TAG_RE, ' ')
    result = result.replace(/\*+/g, '').replace(/~~/g, '').replace(LEADING_UNDERSCORE_RE, '$1').replace(TRAILING_UNDERSCORE_RE, '$1').replace(/`/g, '')
    // Entities decode after the tags are gone, so `&lt;div&gt;` stays searchable text; one pass, so `&amp;lt;` becomes `&lt;`.
    result = result.replace(ENTITY_RE, decodeEntity)
    return result.replace(/\s+/g, ' ').trim().normalize('NFC')
}

// Canonical composition only: width is never folded (no NFKC), so a full-width letter does not match its ASCII form.
export function normalizeForSearch(text: string, options: NormalizeOptions): string {
    return cleanText(text, options.thinking).toLowerCase()
}

// The cleaned text with its original case, for results snippets.
export function displayText(text: string, options: NormalizeOptions): string {
    return cleanText(text, options.thinking)
}

// The query goes through the same normaliser as the text. A whitespace-only query is '' and means "no search".
export function normalizeQuery(raw: string): string {
    return normalizeForSearch(raw, { thinking: true })
}

// A literal substring test, never a pattern built from the query.
export function matchesQuery(text: string, normalisedQuery: string): boolean {
    return normalisedQuery !== '' && text.includes(normalisedQuery)
}

// ---- the normalised-text cache

export interface SearchCache {
    // The normalised text of `message` for this raw text and thinking flag, from the cache when it is current.
    textFor(message: object, raw: string, thinking: boolean): string
    has(message: object): boolean
    readonly size: number
    clear(): void
}

interface CacheEntry {
    raw: string
    thinking: boolean
    text: string
}

// Keyed by message object so nothing is written onto a message. When full, new messages are computed but not stored: the scan
// is newest first, so the newest entries stay cached, where evicting in insertion order would thrash on a very long chat.
export function createSearchCache(cap = 3000): SearchCache {
    const entries = new Map<object, CacheEntry>()
    return {
        textFor(message, raw, thinking) {
            const entry = entries.get(message)
            if (entry && entry.raw === raw && entry.thinking === thinking) return entry.text
            const text = normalizeForSearch(raw, { thinking })
            if (entry) {
                entry.raw = raw
                entry.thinking = thinking
                entry.text = text
            }
            else if (entries.size < cap) entries.set(message, { raw, thinking, text })
            return text
        },
        has(message) {
            return entries.has(message)
        },
        get size() {
            return entries.size
        },
        clear() {
            entries.clear()
        },
    }
}

// ---- filters

export interface SearchFilters {
    speaker: 'any' | 'me' | 'char'
    hasImage: boolean
    // Read by the caller when it normalises message text; passesFilters does not use it.
    thinking: boolean
    // Local days as `<input type="date">` values, '' for no bound.
    from: string
    to: string
}

// The start of the first local day (inclusive) and of the day after the last one (exclusive); null is no bound.
export interface DayBounds {
    from: number | null
    to: number | null
}

export function dayBoundsOf(from: string, to: string): DayBounds {
    const start = localDayStart(from)
    const last = localDayStart(to)
    let end: number | null = null
    if (last !== null) {
        const day = new Date(last)
        end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()
    }
    return { from: start, to: end }
}

const IMAGE_MACRO_RE = /\{\{(?:inlay|inlayed|inlayeddata|img|image|emotion|asset|bg)::/i
const IMG_TAG_RE = /<img[\s/>]/i
const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/

// The stored text carries an inlay or image asset macro, an img tag or a markdown image.
export function hasImageContent(data: string): boolean {
    return IMAGE_MACRO_RE.test(data) || IMG_TAG_RE.test(data) || MARKDOWN_IMAGE_RE.test(data)
}

export function passesFilters(message: Pick<Message, 'role' | 'data' | 'time'>, filters: SearchFilters, bounds: DayBounds): boolean {
    if (filters.speaker === 'me' && message.role !== 'user') return false
    if (filters.speaker === 'char' && message.role !== 'char') return false
    if (filters.hasImage && !hasImageContent(message.data)) return false
    if (bounds.from !== null || bounds.to !== null) {
        const time = message.time
        if (typeof time !== 'number') return false
        if (bounds.from !== null && time < bounds.from) return false
        if (bounds.to !== null && time >= bounds.to) return false
    }
    return true
}

// ---- messages hidden from the prompt

// The index of the latest `allBefore` flag, or -1. The same rule as the prompt split, duplicated to keep that module's graph out.
export function promptResetIndex(messages: readonly Pick<Message, 'disabled'>[]): number {
    for (let index = messages.length - 1; index >= 0; index--) {
        if (messages[index].disabled === 'allBefore') return index
    }
    return -1
}

// Hidden: flagged disabled, or at or before the latest reset. The first message (index -1) is never hidden. Evaluated at render
// time so a flag changed after the scan shows without a rescan.
export function isHiddenAt(messages: readonly Pick<Message, 'disabled'>[], index: number, resetIndex: number): boolean {
    if (index < 0) return false
    return messages[index]?.disabled === true || index <= resetIndex
}

// ---- the scan

export const SCAN_SLICE_MAX = 500
export const SCAN_SLICE_MAX_LOW_POWER = 250
export const SCAN_BUDGET_MS = 8

export function sliceMaxFor(lowPower: boolean): number {
    return lowPower ? SCAN_SLICE_MAX_LOW_POWER : SCAN_SLICE_MAX
}

// A hit keeps the message object so a later check can tell whether the chat still has it at that index. `index` is -1 and
// `message` is null for the first message, which is not part of the message array.
export interface SearchHit {
    index: number
    message: Message | null
}

export interface SearchScanParams {
    // Number of messages in the chat array; indexes count-1 down to 0 are scanned, then -1 when `includeFirst`.
    count: number
    includeFirst: boolean
    messageAt(index: number): Message
    // The normalised text of the message at `index`, read at slice time; -1 is the first message.
    textAt(index: number): string
    passes(index: number): boolean
    // Already normalised. '' completes at once with no hits and reads nothing.
    query: string
    sliceMax: number
    budgetMs: number
    now?: () => number
    // Runs `run` later; the default waits for an idle period.
    schedule?: (run: () => void) => void
    onProgress(hits: readonly SearchHit[], complete: boolean): void
}

function scheduleIdle(run: () => void): void {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => { run() }, { timeout: 50 })
    else setTimeout(run, 0)
}

// Message proxies are read only inside scheduled callbacks, never while the scan is being set up, so starting a scan creates no
// reactive dependency. Returns `cancel`; nothing runs or reports after it.
export function createSearchScan(params: SearchScanParams): () => void {
    const now = params.now ?? (() => performance.now())
    const schedule = params.schedule ?? scheduleIdle
    const last = params.includeFirst ? -1 : 0
    let next = params.count - 1 >= last ? params.count - 1 : last - 1
    if (params.query === '') next = last - 1
    let cancelled = false
    const hits: SearchHit[] = []

    function slice(): void {
        if (cancelled) return
        const start = now()
        let processed = 0
        while (next >= last && processed < params.sliceMax) {
            const index = next
            next--
            processed++
            if (params.passes(index) && matchesQuery(params.textAt(index), params.query)) {
                hits.push({ index, message: index >= 0 ? params.messageAt(index) : null })
            }
            if (now() - start >= params.budgetMs) break
        }
        const complete = next < last
        params.onProgress(hits.slice(), complete)
        if (!complete && !cancelled) schedule(slice)
    }

    schedule(slice)
    return () => { cancelled = true }
}
