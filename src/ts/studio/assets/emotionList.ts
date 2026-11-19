// The pure rules of the Studio emotion-image list: how stored `[name, path]` tuples become rows, what the filter keeps,
// which names are refused, and where focus goes after rows leave. The list component holds no rule of its own beyond
// calling these, so a rule can be tested without a browser.

import { textMatches } from '../../chatShell/toggleSearch'
import type { Database } from '../../storage/database.svelte'
import { assetPresentationOf, assetRowExt } from './assetPresentation'
import type { GroupRow } from './duplicateGroups'
import type { MergeSource } from './mergeCommit'
import { countChatMentions } from './mergeCounts'

/** One emotion image row. `index` is the stored position in `emotionImages`: every write addresses the row by it. */
export interface EmotionRow {
    /** `occurrence:path`: a rename keeps the key, two rows over one file are told apart by their order. */
    key: string
    index: number
    name: string
    path: string
    ext: string
    /** `thumb` for an image that always shows, `tile` for anything else. */
    shown: 'thumb' | 'tile'
}

/** A row as the duplicate finder takes it: the stored index and no folder. */
export interface EmotionFinderRow extends GroupRow {
    readonly folder: null
}

/** The rows of the stored `emotionImages` tuples, each with its stored index, in stored order. */
export function emotionRowsOf(tuples: readonly (readonly string[])[] | undefined): EmotionRow[] {
    const seen = new Map<string, number>()
    return (tuples ?? []).map((tuple, index) => {
        const path = tuple[1] ?? ''
        const occurrence = seen.get(path) ?? 0
        seen.set(path, occurrence + 1)
        const ext = assetRowExt(tuple)
        return {
            key: `${occurrence}:${path}`,
            index,
            name: tuple[0] ?? '',
            path,
            ext,
            shown: assetPresentationOf(ext).shown === 'thumb' ? 'thumb' : 'tile',
        }
    })
}

/** Whether a row stays in the list for a trimmed filter text. The name is matched; the path never is. */
export function emotionMatchesFilter(row: Pick<EmotionRow, 'name'>, query: string): boolean {
    return query === '' || textMatches(row.name, query)
}

/** A blank name (empty or only whitespace) names nothing. Any other string is stored as typed, never trimmed. */
export function emotionNameRefused(value: string): boolean {
    return value.trim() === ''
}

/**
 * Where focus goes when rows left the list: a row key, `'container'` for the list itself, or null when focus stays
 * where it is. `knownKeys` are the keys the last flush showed, `keys` those now shown, `focusedKey` the row that held focus.
 */
export function focusAfterRemoval(knownKeys: readonly string[], keys: readonly string[], focusedKey: string | null): string | 'container' | null {
    if (focusedKey === null || keys.length >= knownKeys.length) return null
    const survivors = new Set(keys)
    const at = knownKeys.indexOf(focusedKey)
    if (survivors.has(focusedKey)) {
        // Rows over one file are keyed by their order, so the key of a removed row can name the row after it. Position decides.
        const place = Math.min(Math.max(at, 0), keys.length - 1)
        return keys[place] ?? 'container'
    }
    const next = knownKeys.slice(at + 1).find((candidate) => survivors.has(candidate))
    if (next !== undefined) return next
    const previous = knownKeys.slice(0, Math.max(at, 0)).reverse().find((candidate) => survivors.has(candidate))
    return previous ?? 'container'
}

/** The ticks whose key still names a row. */
export function pickedAfter(picked: Readonly<Record<string, true>>, liveKeys: readonly string[]): Record<string, true> {
    const live = new Set(liveKeys)
    const kept: Record<string, true> = {}
    for (const key of Object.keys(picked)) {
        if (live.has(key)) kept[key] = true
    }
    return kept
}

/** Every row as a finder row: its stored index, so a filter never changes which stored row a finder action touches. */
export function emotionFinderRows(rows: readonly EmotionRow[]): EmotionFinderRow[] {
    return rows.map((row) => ({ name: row.name, path: row.path, index: row.index, folder: null }))
}

/** What the merge source reads, at each call: the database, and the character the list shows. */
export interface EmotionMergeDeps {
    chaId: string
    db(): Partial<Pick<Database, 'characters' | 'assetMaxDifference' | 'legacyMediaFindings' | 'newImageHandlingBeta'>>
}

/**
 * What the merge preview reads of the owner: the live character at every call (never a copy taken earlier, so a stale
 * preview is caught), none for a missing, group or private character. Emotion images never resolve to module assets,
 * and a character is not a module, so no module rows and no enabling count exist.
 */
export function emotionMergeSource(deps: EmotionMergeDeps): MergeSource {
    const liveCharacter = () => {
        const found = deps.db().characters?.find((candidate) => candidate?.chaId === deps.chaId)
        return found && found.type !== 'group' && found.license !== 'private' ? found : undefined
    }
    return {
        targetOwner: () => {
            const found = liveCharacter()
            return found === undefined ? null : { kind: 'character', source: found }
        },
        modules: () => [],
        settings: () => {
            const db = deps.db()
            return {
                assetMaxDifference: db.assetMaxDifference ?? 4,
                legacyMediaFindings: db.legacyMediaFindings === true,
                newImageHandlingBeta: db.newImageHandlingBeta === true,
            }
        },
        countChats: (query, signal, onProgress) => countChatMentions(liveCharacter()?.chats ?? [], query, { signal, onProgress }),
        countCharacters: async () => ({ state: 'done', characters: [], archivedCharacters: 0 }),
        enabledEverywhere: () => false,
        characterName: (id) => deps.db().characters?.find((candidate) => candidate?.chaId === id)?.name ?? id,
    }
}
