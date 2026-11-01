import type { character, groupChat } from '../storage/database.svelte'
import { isCharacterEntry, isMissingCharacterId } from '../storage/characterIds'
import { characterCreator, coldStubChatCount, stubDescription, stubTags } from '../process/coldCharacter'

/**
 * Fork-specific light character list: what the character lists show, read from
 * top-level fields only, with no chats, lorebook, assets or messages. A resident
 * and an archived character give the same entry shape.
 *
 * A light entry is never a character. It is written back only through the V3
 * whole-list setters, which swap each entry for the live character that holds
 * its `chaId`, so a plugin cannot replace, drop or reorder a character's heavy
 * parts through it. The entry's own fields are ignored on write.
 */

type Slot = character | groupChat

/** The entry `getLightCharacters` returns for one character or group. Every object field is a fresh plain value. */
export interface LightCharacterEntry {
    lightEntry: true
    chaId: string
    name: string
    image?: string
    type: 'character' | 'group'
    creatorNotes: string
    tags?: string[]
    creator?: string
    characters?: string[]
    lastInteraction?: number
    trashTime?: number
    chatCount: number
    archived: boolean
}

/** What a write that held light entries did with them: entries swapped for a live holder, and entries left out. */
export interface LightWriteCounts {
    lightKept: number
    lightLeftOut: number
}

/** Why a light entry is refused as a single character. */
export const LIGHT_ENTRY_SINGLE_MESSAGE = 'A light character entry is not a character; read the character with getCharacterFromIndex and write that.'

/** Why the V2 live wrapper refuses a character list that holds a light entry. */
export const LIGHT_ENTRY_WRAPPER_MESSAGE = 'Light character entries are written through setDatabase.'

/** A light entry: a character entry that says so. */
export function isLightEntry(value: unknown): value is Record<string, unknown> {
    return isCharacterEntry(value) && value.lightEntry === true
}

/** Whether any element of `list` is a light entry. */
export function hasLightEntry(list: unknown): boolean {
    return Array.isArray(list) && list.some(isLightEntry)
}

/**
 * Why a light entry cannot be written: it has no id to find its holder by, or it
 * carries chats (a light entry holds none, so chats here mean the plugin took the
 * entry for a character). Null when it can be written. Ids that cannot be saved
 * are judged by the character list check, as for any character.
 */
export function lightEntryRefusal(entry: Record<string, unknown>): string | null {
    if (isMissingCharacterId(entry.chaId)) {
        return 'A light character entry needs a chaId.'
    }
    if (Object.hasOwn(entry, 'chats')) {
        return 'A light entry cannot carry chats; read the character with getCharacterFromIndex.'
    }
    return null
}

/** The light entries of a character list, read from top-level fields of each live element only. */
export function lightCharacterEntries(live: readonly Slot[] | undefined): LightCharacterEntry[] {
    const entries: LightCharacterEntry[] = []
    for (const source of live ?? []) {
        if (!isCharacterEntry(source)) {
            continue
        }
        const archived = Boolean(source.coldstorage)
        const entry: LightCharacterEntry = {
            lightEntry: true,
            chaId: source.chaId,
            name: source.name,
            image: source.image,
            type: source.type === 'group' ? 'group' : 'character',
            creatorNotes: stubDescription(source.creatorNotes),
            chatCount: archived || Array.isArray(source.chats) ? coldStubChatCount(source) : 0,
            archived,
        }
        if (typeof source.lastInteraction === 'number') {
            entry.lastInteraction = source.lastInteraction
        }
        if (source.trashTime) {
            entry.trashTime = source.trashTime
        }
        if (source.type === 'group') {
            entry.characters = Array.isArray(source.characters) ? Array.from(source.characters) : []
        } else {
            entry.tags = stubTags(source)
            entry.creator = characterCreator(source)
        }
        entries.push(entry)
    }
    return entries
}

/**
 * `incoming`, a character list written by a plugin, with each light entry
 * replaced by the live element that holds its `chaId`. Holders are indexed once
 * by the raw `chaId` (SameValueZero, as the stub reconcile does): the k-th light
 * entry of an id becomes the k-th live holder of that id in list order, and an
 * entry with no such holder is left out. Other elements pass through. Returns
 * `incoming` itself when it holds no light entry. `counts` is set to the number
 * of entries swapped and left out.
 */
export function swapLightEntries(live: readonly unknown[] | undefined, incoming: readonly unknown[], counts: LightWriteCounts): unknown[] {
    let kept = 0
    let leftOut = 0
    let holdersById: Map<unknown, unknown[]> | undefined
    let used: Map<unknown, number> | undefined
    const swapped: unknown[] = []
    for (const entry of incoming) {
        if (!isLightEntry(entry)) {
            swapped.push(entry)
            continue
        }
        if (!holdersById || !used) {
            holdersById = new Map()
            used = new Map()
            for (const candidate of live ?? []) {
                if (!isCharacterEntry(candidate)) {
                    continue
                }
                const held = holdersById.get(candidate.chaId)
                if (held) {
                    held.push(candidate)
                } else {
                    holdersById.set(candidate.chaId, [candidate])
                }
            }
        }
        const holders = holdersById.get(entry.chaId)
        const next = used.get(entry.chaId) ?? 0
        if (holders && next < holders.length) {
            swapped.push(holders[next])
            used.set(entry.chaId, next + 1)
            kept++
        } else {
            leftOut++
        }
    }
    counts.lightKept = kept
    counts.lightLeftOut = leftOut
    return holdersById ? swapped : (incoming as unknown[])
}
