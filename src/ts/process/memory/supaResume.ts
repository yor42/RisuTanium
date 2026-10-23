import { v4 } from "uuid";
import type { Chat, Message } from "../../storage/database.svelte";

/**
 * Plain SupaMemory resume pointer: `Chat.supaMemoryData` is `<chatId>\n<summary>`.
 *
 * Invariant: coverage is defined on `chat.message` order, hidden messages
 * included. With first line P and covered-ID field c (c is true iff
 * `supaMemoryCoveredId === P`), the covered set is { m : pos(m) < pos(P) } plus
 * P when c. The pointer moves to an entry Q only (1) in a write whose
 * summariser input contains every sent entry between the old resume point and
 * Q (the summarisation loop), (2) in a delete that removed the old pointer
 * message (`repointSupaMemory`), or (3) when the end-of-chat pair is written.
 * The send-time resolver never writes a resume id other than the stored one.
 * Reset and the empty-chat rule empty the set.
 *
 * `supaMemoryCoveredId` is meaningful only while it equals the first line of
 * `supaMemoryData`; any other value is inert. It is never set for `hypa:` data.
 */

const HYPA_PREFIX = "hypa:";

function firstLine(data: string): string {
    const newline = data.indexOf("\n");
    return newline === -1 ? data : data.slice(0, newline);
}

/**
 * Position of `message` in `previous`: identity first (works for messages
 * without a chatId), then chatId, or -1.
 */
function previousIndex(previous: readonly Message[], message: Message): number {
    const byIdentity = previous.indexOf(message);
    if (byIdentity !== -1) {
        return byIdentity;
    }
    if (message.chatId) {
        return previous.findIndex((candidate) => candidate.chatId === message.chatId);
    }
    return -1;
}

function stampChatId(message: Message): string {
    message.chatId ??= v4();
    return message.chatId;
}

/**
 * After a removal, keep a plain pointer on a message that still exists.
 *
 * Invariant: the pointer moves only because the message it named was removed.
 * (MC-714) A survivor follows the removed message in `chat.message` order,
 * hidden survivors included: the pointer takes the first such survivor, the
 * summary text is unchanged, and a stale covered-ID field is deleted.
 * (MC-715) No survivor follows: the last survivor becomes the pointer and the
 * covered-ID field names it, so nothing that survives is summarised again.
 * Nothing survives, or the pointer was not in `previousMessages`: no change.
 */
export function repointSupaMemory(chat: Chat, previousMessages: readonly Message[]): void {
    const data = chat.supaMemoryData;
    if (!data || data.startsWith(HYPA_PREFIX)) {
        return;
    }
    const id = firstLine(data);
    const removedAt = previousMessages.findIndex((message) => message.chatId === id);
    if (removedAt === -1) {
        return;
    }
    if (chat.message.some((message) => message.chatId === id)) {
        return;
    }
    const summary = data.slice(id.length);

    const after = chat.message.find((message) => previousIndex(previousMessages, message) > removedAt);
    if (after) {
        chat.supaMemoryData = stampChatId(after) + summary;
        delete chat.supaMemoryCoveredId;
        return;
    }

    for (let i = chat.message.length - 1; i >= 0; i--) {
        const survivor = chat.message[i];
        if (previousIndex(previousMessages, survivor) !== -1) {
            const survivorId = stampChatId(survivor);
            chat.supaMemoryData = survivorId + summary;
            chat.supaMemoryCoveredId = survivorId;
            return;
        }
    }
}

/**
 * Empty-chat rule: a chat with no messages keeps no SupaMemory data, plain or
 * `hypa:`, and no covered-ID field.
 */
export function clearSupaMemoryIfEmpty(chat: Chat): void {
    // Plugin writes reach this unvalidated: a chat that is not an object with a message list is left alone.
    if (!chat || !Array.isArray(chat.message) || chat.message.length !== 0) {
        return;
    }
    if (chat.supaMemoryData) {
        chat.supaMemoryData = "";
    }
    if ("supaMemoryCoveredId" in chat) {
        delete chat.supaMemoryCoveredId;
    }
}

/** `clearSupaMemoryIfEmpty` over every chat of the given characters. */
export function clearSupaMemoryIfEmptyIn(chars: readonly { chats?: Chat[] }[]): void {
    for (const char of chars) {
        if (!Array.isArray(char?.chats)) {
            continue;
        }
        for (const chat of char.chats) {
            clearSupaMemoryIfEmpty(chat);
        }
    }
}

/**
 * Run a removal on `chat.message` and keep the SupaMemory pointer valid.
 * The snapshot is skipped when there is no SupaMemory data; the empty-chat
 * rule still applies to `hypa:` data, which is otherwise never repointed.
 */
export function withSupaRepoint<T>(chat: Chat, mutate: () => T): T {
    if (!chat.supaMemoryData) {
        return mutate();
    }
    const previous = chat.message.slice();
    const result = mutate();
    if (chat.message.length === 0) {
        clearSupaMemoryIfEmpty(chat);
        return result;
    }
    if (chat.supaMemoryData?.startsWith(HYPA_PREFIX)) {
        return result;
    }
    repointSupaMemory(chat, previous);
    return result;
}

/**
 * Store the memory a send returned.
 *
 * Invariant: the covered-ID field survives a write only if it was valid before
 * it (it equalled the old first line) and still equals the new first line.
 * A stale field (data cleared or edited by hand, a plugin or an upstream round
 * trip) is deleted even when the new first line happens to match it, so a
 * message that was never summarised is not revalidated as covered by this write.
 */
export function writeSupaMemoryData(chat: Chat, memory: string | undefined): void {
    const wasValid = chat.supaMemoryCoveredId !== undefined
        && chat.supaMemoryCoveredId === firstLine(chat.supaMemoryData ?? "");
    chat.supaMemoryData = memory ?? chat.supaMemoryData;
    if (chat.supaMemoryCoveredId !== undefined && (!wasValid || chat.supaMemoryCoveredId !== firstLine(chat.supaMemoryData ?? ""))) {
        delete chat.supaMemoryCoveredId;
    }
}
