import type { JsonObject } from '../../blockFrame'

/**
 * The copy that keep both makes of a chat this page changed. It is pure: it reads no page state, so any owner works
 * (unlike `duplicateChat`, which needs the selected character) and the name is checked against the chat list the
 * merge produces.
 */

/**
 * The name of a copy: the original name without a trailing "(Copy)" or "(Copy 2)" marker, then "(Copy)", or the first
 * "(Copy N)" no chat of the owner already has. The pure form of `createChatCopyName`, which reads the selected character.
 */
export function copyNameFor(originalName: string, ownerChatNames: ReadonlySet<string>): string {
    const base = originalName.replaceAll(/\(((Copy|Branch)( \d+)?)\)$/g, '').trim()
    let index = 1
    let name = `${base} (Copy)`
    while (ownerChatNames.has(name)) {
        index++
        name = `${base} (Copy ${index})`
    }
    return name
}

/** A chat as plain JSON copied for keep both: a fresh id, a copy name and no streaming flag. */
export function makeChatCopy(chat: JsonObject, ownerChatNames: ReadonlySet<string>, newId: string): JsonObject {
    const copy: JsonObject = structuredClone(chat)
    copy.id = newId
    copy.name = copyNameFor(typeof chat.name === 'string' ? chat.name : '', ownerChatNames)
    delete copy.isStreaming
    return copy
}
