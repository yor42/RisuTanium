import type { JsonObject } from '../../blockFrame'
import { StubRefusedError } from './types'

/** The text a chat's first message starts with while the chat is a cold-storage pointer. */
export const COLD_POINTER_HEADER = '\uEF01COLDSTORAGE\uEF01'

/** A character or group that stands in for a cold-storage unit: its `coldstorage` pointer is set. */
export function isColdStub(slot: object): boolean {
    return Boolean((slot as { coldstorage?: unknown }).coldstorage)
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
 * kept exactly. The `coldstorage/` key that text names stays protected because
 * A-lite never deletes `coldstorage/`.
 */
export function assertChatNotPointer(chat: JsonObject, chaId: string, chatIndex: number): void {
    if (isColdPointerChat(chat)) {
        throw new StubRefusedError('chat', chaId, chatIndex)
    }
}
