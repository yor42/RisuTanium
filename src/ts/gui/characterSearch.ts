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
 * One searchable character. `index`, `key`, `chaId` and `trashed` are read from
 * the slot on every build; only the two normalised strings are ever cached.
 */
export interface SearchEntry {
    index: number
    key: string
    chaId: string
    trashed: boolean
    nameCompact: string
    detail: string
}

export interface CharacterMatch {
    index: number
    /** The list key of the slot's character; see `slotKeys`. */
    key: string
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
 * The list key of every slot of `characters`, by slot index; null for a hidden
 * system character, which is in no list. A key names the character, not its
 * position, so a delete, a restore or a put-back of another slot leaves it
 * unchanged: it is `['s', chaId, occurrence]`, where `occurrence` counts the
 * earlier non-hidden slots with the same `chaId`. Every non-hidden slot counts,
 * trashed ones included and whatever a list hides, so a query or a trash filter
 * never changes a key. A `chaId` that is not a string counts as ''.
 *
 * Two slots sharing a `chaId` therefore get different keys. The later holder's
 * key changes when an earlier holder of the same `chaId` is deleted, and a slot
 * whose `chaId` is rewritten gets a new key.
 */
export function slotKeys(characters: readonly Slot[]): (string | null)[] {
    const seen = new Map<string, number>()
    const keys: (string | null)[] = []
    for (const slot of characters) {
        if (!slot || isHiddenSystemCharacter(slot)) {
            keys.push(null)
            continue
        }
        const chaId = typeof slot.chaId === 'string' ? slot.chaId : ''
        const occurrence = seen.get(chaId) ?? 0
        seen.set(chaId, occurrence + 1)
        keys.push(JSON.stringify(['s', chaId, occurrence]))
    }
    return keys
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
    const keys = slotKeys(characters)
    for (let i = 0; i < characters.length; i++) {
        const slot = characters[i]
        const key = keys[i]
        if (!slot || key === null) {
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
            key,
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
        const match: CharacterMatch = { index: entry.index, key: entry.key, chaId: entry.chaId }
        if (entry.trashed) {
            trash.push(match)
        } else {
            live.push(match)
        }
    }
    return { live, trash, matched, trashedTotal }
}
