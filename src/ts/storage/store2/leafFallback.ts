import type { JsonObject } from '../blockFrame'
import { formatColdStorageLoadError } from '../../process/coldstorageData'
import {
    assembleChat, chunkCountMismatch, CodecAssembleError, defineOwn, ENTRY_MOVED_FIELDS, movedValueOf, readAbsentList,
    readCheckedUnit, readObjectField, type UnitSource,
} from './codec'
import { keyOfRef, UNIT_TYPE, type ChatChunk, type ChatCore, type ContentBody, type ShardEntry } from './format'
import type { FlaggedLeaf } from './treeBytes'

/**
 * The assembly of an entity whose tree has damaged or missing leaves.
 *
 * Invariant: the assembled entity is the normal assembly (`assembleCharacter`) with each damaged unit's contribution
 * replaced by that unit's empty value; every readable unit contributes exactly what normal assembly gives it, so a flag
 * removes nothing a readable unit holds.
 *   character core  the identity fields the shard entry carries, then the moved fields the entry holds
 *   lore, scripts   that bag absent
 *   al, il          nothing: assembly never reads the lists, the first save derives them again
 *   chat core       empty core fields and one load-error message ahead of the first message
 *   chat chunk      one load-error message in the chunk's position; a damaged tail also loses the per-send state it held
 * Only units named by a flag are replaced. Any other unit that fails the check still throws `CodecAssembleError`, because
 * a failure no flag explains is not an empty value.
 */

/** A flagged leaf with the name of the character it belongs to, for the prompt that asks whether to open the profile. */
export type FlaggedItem = FlaggedLeaf & { name: string }

export interface LeafFallback {
    /** Builds one entity; the `character` option of `assembleDatabase`. */
    character: (entry: ShardEntry, source: UnitSource) => JsonObject
    /** The flags, each with the name of the entity that holds the unit; complete once the database is assembled. */
    items: () => readonly FlaggedItem[]
}

function copyInto(target: JsonObject, bag: JsonObject): void {
    for (const key of Object.keys(bag)) {
        defineOwn(target, key, bag[key])
    }
}

/** Every unit key one shard entry names. */
function keysOfEntry(entry: ShardEntry): Set<string> {
    const keys = new Set<string>([keyOfRef(entry.core), keyOfRef(entry.al)])
    for (const ref of [entry.lore, entry.scripts, entry.il]) {
        if (ref !== null) {
            keys.add(keyOfRef(ref))
        }
    }
    for (const chat of entry.chats) {
        keys.add(keyOfRef(chat.core))
        for (const chunk of chat.chunks) {
            keys.add(keyOfRef(chunk))
        }
    }
    return keys
}

/** The identity the shard entry carries, in the form the entry holds it (a shortened description, not the full one). */
function identityOf(entry: ShardEntry): JsonObject {
    const identity: JsonObject = {}
    defineOwn(identity, 'type', entry.type)
    defineOwn(identity, 'name', entry.name)
    if (entry.image !== undefined) {
        defineOwn(identity, 'image', entry.image)
    }
    defineOwn(identity, 'chaId', entry.chaId)
    if (entry.characters !== undefined) {
        defineOwn(identity, 'characters', entry.characters)
    }
    if (entry.tags !== undefined) {
        defineOwn(identity, 'tags', entry.tags)
    }
    if (entry.creator !== undefined) {
        defineOwn(identity, 'creator', entry.creator)
    }
    defineOwn(identity, 'creatorNotes', entry.creatorNotes)
    return identity
}

/**
 * The override for `flagged`. `now` stamps the load-error messages. The result's `items` lists the flags in the order given,
 * each with the name of the entity that names its unit.
 */
export function createLeafFallback(flagged: readonly FlaggedLeaf[], now: () => number): LeafFallback {
    const damaged = new Set(flagged.map(leaf => leaf.key))
    const names = new Map<string, string>()

    function loadError(key: string): JsonObject {
        return { time: now(), data: formatColdStorageLoadError(key), role: 'char' }
    }

    function character(entry: ShardEntry, source: UnitSource): JsonObject {
        const where = `character ${entry.u}`
        for (const key of keysOfEntry(entry)) {
            if (damaged.has(key)) {
                names.set(key, entry.name)
            }
        }
        const result: JsonObject = {}
        let absent: string[] = []
        const coreKey = keyOfRef(entry.core)
        if (damaged.has(coreKey)) {
            copyInto(result, identityOf(entry))
        } else {
            const coreBody = readCheckedUnit(source, entry.core, UNIT_TYPE.characterCore, `${where} core`) as ContentBody
            copyInto(result, readObjectField(coreBody, 'f', `${where} core`))
            absent = readAbsentList(coreBody, `${where} core`)
        }
        if (entry.lore !== null && !damaged.has(keyOfRef(entry.lore))) {
            copyInto(result, readObjectField(readCheckedUnit(source, entry.lore, UNIT_TYPE.lore, `${where} lore`) as ContentBody, 'f', `${where} lore`))
        }
        if (entry.scripts !== null && !damaged.has(keyOfRef(entry.scripts))) {
            copyInto(result, readObjectField(readCheckedUnit(source, entry.scripts, UNIT_TYPE.scripts, `${where} scripts`) as ContentBody, 'f', `${where} scripts`))
        }
        for (const name of ENTRY_MOVED_FIELDS) {
            if (Object.hasOwn(result, name) || absent.includes(name)) {
                continue
            }
            const value = movedValueOf(entry, name)
            if (value !== undefined) {
                defineOwn(result, name, value)
            }
        }
        const chats = entry.chats.map((chatEntry, index) => {
            const chatWhere = `${where} chat ${index}`
            const chatCoreKey = keyOfRef(chatEntry.core)
            const coreDamaged = damaged.has(chatCoreKey)
            // A positional handle is never a chat id: a chat without one takes the id the boot tail mints.
            const core: ChatCore = coreDamaged
                ? { v: 1, f: chatEntry.cid.startsWith('~') ? {} : { id: chatEntry.cid } }
                : readCheckedUnit(source, chatEntry.core, UNIT_TYPE.chatCore, `${chatWhere} core`) as ChatCore
            const chunks = chatEntry.chunks.map((ref, chunkIndex): ChatChunk => {
                const key = keyOfRef(ref)
                if (damaged.has(key)) {
                    return { v: 1, msgs: [loadError(key)] }
                }
                const chunk = readCheckedUnit(source, ref, UNIT_TYPE.chatChunk, `${chatWhere} chunk ${chunkIndex}`) as ChatChunk
                if (chunkCountMismatch(chunk, ref)) {
                    throw new CodecAssembleError(`${chatWhere} chunk ${chunkIndex} holds ${chunk.msgs.length} messages, its Ref says ${ref[3]}.`)
                }
                return chunk
            })
            if (coreDamaged && chunks.length > 0) {
                chunks[0] = { ...chunks[0], msgs: [loadError(chatCoreKey), ...chunks[0].msgs] }
            }
            return assembleChat(core, chunks, chatWhere)
        })
        defineOwn(result, 'chats', chats)
        return result
    }

    return {
        character,
        items: () => flagged.map(leaf => ({ ...leaf, name: names.get(leaf.key) ?? '' })),
    }
}
