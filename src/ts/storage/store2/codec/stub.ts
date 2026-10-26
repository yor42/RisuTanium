import { v4 as uuidv4 } from 'uuid'
import type { JsonObject } from '../../blockFrame'
import { COLD_STUB_VERSION } from '../../../process/coldCharacter'
import type { ShardEntry } from '../format'
import { StubRefusedError } from './types'

/** The text a chat's first message starts with while the chat is a cold-storage pointer. */
export const COLD_POINTER_HEADER = '\uEF01COLDSTORAGE\uEF01'

/** A character or group that stands in for a cold-storage unit: its `coldstorage` pointer is set. */
export function isColdStub(slot: object): boolean {
    return Boolean((slot as { coldstorage?: unknown }).coldstorage)
}

/**
 * The stub a shard entry stands for, with the fields `buildColdStub` gives an archived character: `coldstorage` is the
 * entry's `u`, so the units are read from the store and not from a legacy cold-storage file. `chatPage`,
 * `firstMsgIndex` and the one dummy chat are placeholders; the encoder takes none of them from a stub. Every field
 * the entry holds that a stub may change (`name`, `image`, `creatorNotes`, `lastInteraction`, `trashTime`, a group's
 * `characters`, `tags`, `creator`) is copied as it stands, so `overlayStub(entry, stubFromEntry(entry))` equals
 * `entry` and a stub nobody touched carries its entry unchanged.
 */
export function stubFromEntry(entry: ShardEntry): JsonObject {
    const stub: JsonObject = {
        type: entry.type,
        name: entry.name,
    }
    if (entry.image !== undefined) {
        stub.image = entry.image
    }
    stub.chaId = entry.chaId
    stub.creatorNotes = entry.creatorNotes
    stub.coldstorage = entry.u
    stub.coldStoragedChats = []
    stub.chats = [{
        id: uuidv4(),
        message: [{ time: Date.now(), data: '', role: 'char' }],
        note: '',
        name: '',
        localLore: [],
    }]
    stub.chatPage = 0
    stub.firstMsgIndex = 0
    stub.coldVersion = COLD_STUB_VERSION
    stub.coldChatCount = entry.chats.length
    if (entry.lastInteraction !== undefined) {
        stub.lastInteraction = entry.lastInteraction
    }
    if (entry.trashTime !== undefined) {
        stub.trashTime = entry.trashTime
    }
    if (entry.type === 'group') {
        stub.characters = [...(entry.characters ?? [])]
    } else {
        stub.tags = [...(entry.tags ?? [])]
        stub.creator = entry.creator ?? ''
    }
    return stub
}

/** A chat whose first message is still the cold-storage pointer. */
export function isColdPointerChat(chat: JsonObject): boolean {
    const messages = chat.message
    if (!Array.isArray(messages) || messages.length === 0) {
        return false
    }
    const first = messages[0]
    if (typeof first !== 'object' || first === null || Array.isArray(first)) {
        return false
    }
    const data = first.data
    return typeof data === 'string' && data.startsWith(COLD_POINTER_HEADER)
}

/** Throws `StubRefusedError` for a stub character. Runs before any of the character's units is built. */
export function assertNotStub(slot: object, chaId: string): void {
    if (isColdStub(slot)) {
        throw new StubRefusedError('character', chaId, null)
    }
}

/**
 * Throws `StubRefusedError` for a chat that is still a cold-storage pointer. A
 * legacy load-error chat (first message `[Cold storage data could not be loaded.
 * Key: ...]`) is not a pointer: it is encoded verbatim, because refusing it
 * would block converting a chat whose content cannot be loaded and its text is
 * kept exactly. The `coldstorage/` key that text names stays because the old-data
 * deletion never lists a key in the legacy walk's exclusion set, and the walk
 * records the load-error key there.
 */
export function assertChatNotPointer(chat: JsonObject, chaId: string, chatIndex: number): void {
    if (isColdPointerChat(chat)) {
        throw new StubRefusedError('chat', chaId, chatIndex)
    }
}
