import type { Database } from '../../database.svelte'
import {
    coldStorageHeader, listInnerColdStorageKeys, matchColdStorageLoadErrorKey, type ColdStorageInnerKey,
} from '../../../process/coldstorageData'
import { pluginIndexPointer } from '../../../process/pluginStorageIndex'

/**
 * The enumeration of the cold-storage references a legacy tree holds. The
 * per-character enumerator (`legacyRefsOfCharacter`) and the plugin one
 * (`legacyPluginRefs`) are shared: the walk reaches them through
 * `legacyRefsOfDatabase`, the resolver calls them directly for each inline
 * character and for the character a stub's unit holds. Inside a unit the walk
 * follows `legacyRefsOfUnit`; the resolver instead resolves the unit's own
 * character and chat through the per-character enumerator. The two routes are
 * kept in agreement by a test (every unit the resolver reads is in the walk's
 * result), not by sharing one function.
 */

export type LegacyRefKind = 'stub' | 'stubChat' | 'chatPointer' | 'errorText' | 'plugin'

export interface LegacyRef {
    /** The unit id, as stored: not checked to be a storage name. */
    key: string
    kind: LegacyRefKind
    /** The position of the character the reference was found on; null for a plugin reference. */
    characterIndex: number | null
    /** The position of the chat the reference was found on; null unless the kind is `chatPointer` or `errorText`. */
    chatIndex: number | null
    /** The plugin storage key the `_coldplugin` mapping holds the unit under; null unless the kind is `plugin`. */
    slotKey: string | null
}

type Fields = Record<string, unknown>

function isFields(value: unknown): value is Fields {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The kind and key a chat's first message stands for, or null when it is plain text. */
export function legacyFirstMessageRef(chat: unknown): { key: string, kind: 'chatPointer' | 'errorText' } | null {
    if (!isFields(chat) || !Array.isArray(chat.message) || !isFields(chat.message[0])) {
        return null
    }
    const data = chat.message[0].data
    if (typeof data !== 'string') {
        return null
    }
    if (data.startsWith(coldStorageHeader)) {
        return { key: data.slice(coldStorageHeader.length), kind: 'chatPointer' }
    }
    const errorKey = matchColdStorageLoadErrorKey(data)
    return errorKey === null ? null : { key: errorKey, kind: 'errorText' }
}

/** The references one character or group holds: its stub unit, the chat units its stub lists, and every chat whose first message names a unit. */
export function legacyRefsOfCharacter(slot: unknown, characterIndex: number): LegacyRef[] {
    const refs: LegacyRef[] = []
    if (!isFields(slot)) {
        return refs
    }
    // Any truthy `coldstorage` makes a stub, as in the codec; a value that is not a string has no unit id, so its key is ''.
    if (slot.coldstorage) {
        refs.push({ key: typeof slot.coldstorage === 'string' ? slot.coldstorage : '', kind: 'stub', characterIndex, chatIndex: null, slotKey: null })
        if (Array.isArray(slot.coldStoragedChats)) {
            for (const key of slot.coldStoragedChats) {
                if (typeof key === 'string') {
                    refs.push({ key, kind: 'stubChat', characterIndex, chatIndex: null, slotKey: null })
                }
            }
        }
    }
    if (Array.isArray(slot.chats)) {
        slot.chats.forEach((chat: unknown, chatIndex: number) => {
            const first = legacyFirstMessageRef(chat)
            if (first !== null) {
                refs.push({ key: first.key, kind: first.kind, characterIndex, chatIndex, slotKey: null })
            }
        })
    }
    return refs
}

/** The `_coldplugin` mapping's units, one reference per mapped plugin storage key. */
export function legacyPluginRefs(db: Pick<Database, 'pluginCustomStorage'>): LegacyRef[] {
    const mapping: unknown = db.pluginCustomStorage?._coldplugin
    if (!isFields(mapping)) {
        return []
    }
    const refs: LegacyRef[] = []
    for (const slotKey of Object.keys(mapping)) {
        const key = mapping[slotKey]
        if (typeof key === 'string') {
            refs.push({ key, kind: 'plugin', characterIndex: null, chatIndex: null, slotKey })
        }
    }
    return refs
}

/** The upstream plugin storage index unit a tree points at, or null when it holds no pointer. Not part of `legacyRefsOfDatabase`: the walk reads this unit itself. */
export function legacyPluginIndexPointer(db: Pick<Database, 'pluginCustomStorage'>): string | null {
    return pluginIndexPointer(db.pluginCustomStorage)
}

/** Every reference of a decoded legacy tree: characters in order, then plugin storage. */
export function legacyRefsOfDatabase(db: Pick<Database, 'characters' | 'pluginCustomStorage'>): LegacyRef[] {
    const refs: LegacyRef[] = []
    const characters: unknown = db.characters
    if (Array.isArray(characters)) {
        characters.forEach((slot: unknown, index: number) => {
            refs.push(...legacyRefsOfCharacter(slot, index))
        })
    }
    refs.push(...legacyPluginRefs(db))
    return refs
}

/** The references a unit's value holds. Total: a malformed value contributes none. */
export function legacyRefsOfUnit(value: unknown): ColdStorageInnerKey[] {
    return listInnerColdStorageKeys(value)
}
