/**
 * Keys for the rows of the chat message list. A row is keyed by its message's `chatId`, or by the owner id and the
 * message index when the message has none. `chatId` is meant to be unique within a chat, but stored data may break
 * that (an imported or plugin-written chat, or a test fixture), and a keyed each throws on a repeated key, which
 * would stop the whole chat from opening. So a key already taken by another row of the same pass is qualified with
 * the row's index (and a counter if that is taken as well): every row gets a distinct key, and a chat with unique
 * ids keeps exactly the keys it had. The stored messages are never changed.
 */
export function claimRowKey(taken: Set<string>, chatId: string | undefined, owner: string, index: number): string {
    const base = chatId ?? `${owner}:${index}`
    let key = base
    if (taken.has(key)) {
        key = `${base}#${index}`
        for (let n = 1; taken.has(key); n++) key = `${base}#${index}.${n}`
    }
    taken.add(key)
    return key
}
