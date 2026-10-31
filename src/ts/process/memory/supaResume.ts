import { v4 } from "uuid";
import type { Chat, ChatAlt, Message } from "../../storage/database.svelte";
import { clearAltOnFullClear, isChatAltReadable, reattachOrphans } from "../chatTree";

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
/**
 * The MC-714/715 decision for one plain pair over one message order: the survivor that becomes the
 * pointer and whether the covered-ID field names it (MC-715), or null when nothing changes. The caller
 * stamps the survivor's id and writes the pair.
 */
function repointedPair(
    data: string,
    previousMessages: readonly Message[],
    currentMessages: readonly Message[],
): { survivor: Message, covered: boolean } | null {
    const id = firstLine(data);
    const removedAt = previousMessages.findIndex((message) => message.chatId === id);
    if (removedAt === -1) {
        return null;
    }
    if (currentMessages.some((message) => message.chatId === id)) {
        return null;
    }

    const after = currentMessages.find((message) => previousIndex(previousMessages, message) > removedAt);
    if (after) {
        return { survivor: after, covered: false };
    }

    for (let i = currentMessages.length - 1; i >= 0; i--) {
        const survivor = currentMessages[i];
        if (previousIndex(previousMessages, survivor) !== -1) {
            return { survivor, covered: true };
        }
    }
    return null;
}

export function repointSupaMemory(chat: Chat, previousMessages: readonly Message[]): void {
    const data = chat.supaMemoryData;
    if (!data || data.startsWith(HYPA_PREFIX)) {
        return;
    }
    const repointed = repointedPair(data, previousMessages, chat.message);
    if (!repointed) {
        return;
    }
    const survivorId = stampChatId(repointed.survivor);
    chat.supaMemoryData = survivorId + data.slice(firstLine(data).length);
    if (repointed.covered) {
        chat.supaMemoryCoveredId = survivorId;
    } else {
        delete chat.supaMemoryCoveredId;
    }
}

/**
 * The messages an arrival at alternative record `k` would put up to `k`: the path prefix up to the
 * record's attach point, the alternative ancestors between that point and `k` (the first record in list
 * order owns an id, as in the tree index; a seen-set stops cycles), then `k` itself. A record that
 * reaches no path message hangs from the root.
 */
function branchPath(
    path: readonly Message[],
    alt: readonly ChatAlt[],
    parents: readonly (string | null)[],
    k: number,
): Message[] {
    const pathAt = new Map<string, number>();
    path.forEach((message, index) => {
        if (message.chatId && !pathAt.has(message.chatId)) {
            pathAt.set(message.chatId, index);
        }
    });
    const altAt = new Map<string, number>();
    alt.forEach((record, index) => {
        if (record.m.chatId && !altAt.has(record.m.chatId)) {
            altAt.set(record.m.chatId, index);
        }
    });
    const ancestors: Message[] = [];
    const seen = new Set<number>([k]);
    let attachedAt = -1;
    let parent = parents[k];
    while (parent !== null && parent !== undefined) {
        const onPath = pathAt.get(parent);
        if (onPath !== undefined) {
            attachedAt = onPath;
            break;
        }
        const ancestor = altAt.get(parent);
        if (ancestor === undefined || seen.has(ancestor)) {
            break;
        }
        seen.add(ancestor);
        ancestors.unshift(alt[ancestor].m);
        parent = parents[ancestor];
    }
    return [...path.slice(0, attachedAt + 1), ...ancestors, alt[k].m];
}

/**
 * After a removal, repoint every parked plain pair that names a removed message, on the branch its
 * record would arrive at. Same rules as the live pair (MC-714/715), computed per branch; the parked
 * `mem` keeps all six keys, and the covered-ID field is `null` unless MC-715 names a survivor.
 * Parked `hypa:` data is left alone, as live `hypa:` data is.
 */
function repointParkedPairs(chat: Chat, previous: readonly Message[], parentsBefore: readonly (string | null)[]): void {
    const alt = chat.alt;
    if (!alt) {
        return;
    }
    const onPath = new Set<string>();
    for (const message of chat.message) {
        if (message.chatId) {
            onPath.add(message.chatId);
        }
    }
    const removed = new Set<string>();
    for (const message of previous) {
        if (message.chatId && !onPath.has(message.chatId)) {
            removed.add(message.chatId);
        }
    }
    if (removed.size === 0) {
        return;
    }
    const parentsNow = alt.map((record) => record.p);
    for (let k = 0; k < alt.length; k++) {
        const mem = alt[k].mem;
        if (typeof mem !== "object" || mem === null) {
            continue;
        }
        const data = mem.supaMemoryData;
        if (typeof data !== "string" || data === "" || data.startsWith(HYPA_PREFIX) || !removed.has(firstLine(data))) {
            continue;
        }
        const repointed = repointedPair(
            data,
            branchPath(previous, alt, parentsBefore, k),
            branchPath(chat.message, alt, parentsNow, k),
        );
        if (!repointed) {
            continue;
        }
        const survivorId = stampChatId(repointed.survivor);
        mem.supaMemoryData = survivorId + data.slice(firstLine(data).length);
        mem.supaMemoryCoveredId = repointed.covered ? survivorId : null;
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
 * The snapshot is skipped when there is neither SupaMemory data nor
 * alternatives; the empty-chat rule still applies to `hypa:` data, which is
 * otherwise never repointed.
 *
 * Alternatives follow the path: a record whose parent the removal took off the
 * path is attached to the nearest earlier survivor (`reattachOrphans`), and a
 * removal that empties a non-empty path is a full clear, which clears them.
 * A chat whose `alt` cannot be read keeps it as it is.
 */
export function withSupaRepoint<T>(chat: Chat, mutate: () => T): T {
    const tracksAlt = Array.isArray(chat.alt) && chat.alt.length > 0 && isChatAltReadable(chat);
    const hadSupaMemory = Boolean(chat.supaMemoryData);
    if (!hadSupaMemory && !tracksAlt) {
        return mutate();
    }
    const previous = chat.message.slice();
    const altBefore = tracksAlt ? chat.alt : undefined;
    const altLengthBefore = chat.alt?.length ?? 0;
    const parentsBefore = tracksAlt ? (chat.alt ?? []).map((record) => record.p) : [];
    const result = mutate();
    if (tracksAlt) {
        if (previous.length > 0 && chat.message.length === 0) {
            clearAltOnFullClear(chat);
        } else {
            reattachOrphans(chat, previous);
            // Runs before the empty-live-pair return: a chat with no live pair can still park pairs. A mutation
            // that replaced or resized `alt` itself has no trustworthy `parentsBefore`, so it is skipped.
            if (chat.alt === altBefore && chat.alt?.length === altLengthBefore) {
                repointParkedPairs(chat, previous, parentsBefore);
            }
        }
    }
    if (!hadSupaMemory) {
        return result;
    }
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
