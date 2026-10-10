import { isHiddenSystemCharacter } from '../hiddenCharacters'
import { stubDescription } from '../process/coldCharacter'
import type { character, groupChat } from '../storage/database.svelte'

/**
 * The character list search: pure text matching over a precomputed index of
 * `db.characters`. It never reads storage and never restores an archived
 * character; an archived character is searched by the name and description its
 * stub carries.
 *
 * What a query matches, per character:
 * - the name, with every space and zero-width character ignored;
 * - the description, which is the text the list shows (`stubDescription`: the
 *   `en` section, else the text outside sections, at most 500 characters), for
 *   loaded and archived characters alike, so archiving never changes a result;
 * - tags and creator, for a loaded individual character only. An archived
 *   character and a group are not searched by them even when the slot carries
 *   them.
 * Text is compared after NFKC normalisation and lower-casing (composed Hangul,
 * full-width Latin and half-width kana fold; the result does not depend on the
 * locale). A query is split on whitespace into words and every word must be
 * found in the name or in the description/tags/creator text, in any order.
 * Hidden system characters are in no list.
 */

type Slot = character | groupChat

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g
const INVISIBLE_RUN = /[\s\u200B-\u200D\uFEFF]+/
const INVISIBLE_RUNS = /[\s\u200B-\u200D\uFEFF]+/g
const WHITESPACE_RUNS = /\s+/g

/** Counts the characters whose text had to be normalised; for tests and measurement. */
export interface SearchStats {
    entriesNormalised: number
}

/** The normalised text of one character, valid while the watched strings stay equal. */
interface CachedText {
    name: string
    notes: string
    tags: string
    creator: string
    nameCompact: string
    detail: string
}

export interface SearchCache {
    texts: WeakMap<object, CachedText>
    stats?: SearchStats
}

/**
 * One searchable character. `index`, `chaId` and `trashed` are read from the
 * slot on every build; only the two normalised strings are ever cached.
 */
export interface SearchEntry {
    index: number
    chaId: string
    trashed: boolean
    nameCompact: string
    detail: string
}

export interface CharacterMatch {
    index: number
    chaId: string
}

export interface CharacterSearchResult {
    /** Matching characters that are not in the trash, in `db.characters` order. */
    live: CharacterMatch[]
    /** Matching characters that are in the trash, in `db.characters` order. */
    trash: CharacterMatch[]
    /** The `db.characters` positions of `live` and `trash` together. */
    matched: ReadonlySet<number>
    /** Every trashed, non-hidden character, whatever the query. */
    trashedTotal: number
}

export function createSearchCache(stats?: SearchStats): SearchCache {
    return { texts: new WeakMap(), stats }
}

export function normalizeForSearch(text: string): string {
    return text.normalize('NFKC').toLowerCase()
}

/** The words of a query; an empty list matches everything. */
export function parseQuery(query: string): string[] {
    return normalizeForSearch(query).split(INVISIBLE_RUN).filter(Boolean)
}

function buildText(name: string, notes: string, tags: string, creator: string): CachedText {
    const nameCompact = normalizeForSearch(name).replace(INVISIBLE_RUNS, '')
    const detail = normalizeForSearch([stubDescription(notes), tags, creator].join('\n'))
        .replace(ZERO_WIDTH, '')
        .replace(WHITESPACE_RUNS, ' ')
        .trim()
    return { name, notes, tags, creator, nameCompact, detail }
}

/**
 * The index of `characters`. Reads exactly what the search depends on: the
 * length, and per slot `chaId`, `trashTime`, `type`, `coldstorage`, `name`,
 * `creatorNotes` and, for a loaded individual character, `tags` and `creator`.
 * It must not read `chats`, `lastInteraction`, `image` or group members: a chat
 * in progress would otherwise rebuild the index on every message.
 */
export function buildIndex(characters: readonly Slot[], cache: SearchCache): SearchEntry[] {
    const entries: SearchEntry[] = []
    for (let i = 0; i < characters.length; i++) {
        const slot = characters[i]
        if (!slot || isHiddenSystemCharacter(slot)) {
            continue
        }
        const name = typeof slot.name === 'string' ? slot.name : ''
        const notes = typeof slot.creatorNotes === 'string' ? slot.creatorNotes : ''
        let tags = ''
        let creator = ''
        if (slot.type !== 'group' && !slot.coldstorage) {
            if (Array.isArray(slot.tags)) {
                tags = slot.tags.filter((tag): tag is string => typeof tag === 'string').join('\n')
            }
            if (typeof slot.creator === 'string') {
                creator = slot.creator
            }
        }
        let text = cache.texts.get(slot)
        if (!text || text.name !== name || text.notes !== notes || text.tags !== tags || text.creator !== creator) {
            text = buildText(name, notes, tags, creator)
            cache.texts.set(slot, text)
            if (cache.stats) {
                cache.stats.entriesNormalised++
            }
        }
        entries.push({
            index: i,
            chaId: typeof slot.chaId === 'string' ? slot.chaId : '',
            trashed: !!slot.trashTime,
            nameCompact: text.nameCompact,
            detail: text.detail,
        })
    }
    return entries
}

/** Splits the entries matching every word of the query into the live and the trash list. */
export function searchIndex(index: readonly SearchEntry[], tokens: readonly string[]): CharacterSearchResult {
    const live: CharacterMatch[] = []
    const trash: CharacterMatch[] = []
    const matched = new Set<number>()
    let trashedTotal = 0
    for (const entry of index) {
        if (entry.trashed) {
            trashedTotal++
        }
        if (!tokens.every((token) => entry.nameCompact.includes(token) || entry.detail.includes(token))) {
            continue
        }
        matched.add(entry.index)
        const match: CharacterMatch = { index: entry.index, chaId: entry.chaId }
        if (entry.trashed) {
            trash.push(match)
        } else {
            live.push(match)
        }
    }
    return { live, trash, matched, trashedTotal }
}
