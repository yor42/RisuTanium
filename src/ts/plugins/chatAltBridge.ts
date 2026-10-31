import { reattachOrphans } from "../process/chatTree";
import type { Chat } from "../storage/database.svelte";

/**
 * A plugin never sees a chat's alternatives (`Chat.alt`) and never changes them:
 * every plugin read hides them (`withoutAlt`, `withoutAltChat`), and every
 * plugin write that replaces a character or a chat gives the replacement the
 * live alternatives of the chat it replaces (`keepLiveAlt`,
 * `captureChatAlt` with `keepCapturedChatAlt`). What a plugin writes in `alt` is
 * dropped.
 *
 * `keepLiveAlt` reads the live side only from a table captured before any
 * incoming object is touched. An incoming character can be the live element
 * itself (a refused stale placeholder is swapped for the live holder), and
 * deleting its `alt` first would then delete the live value.
 *
 * Plugin data reaches this module untyped, so the shapes below are loose
 * structural guards, not domain types.
 */

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChatShape(value: unknown): value is Chat {
    return isFields(value) && Array.isArray(value.message);
}

function idOf(value: unknown): string | undefined {
    return isFields(value) && typeof value.id === "string" ? value.id : undefined;
}

function chaIdOf(value: unknown): string | undefined {
    return isFields(value) && typeof value.chaId === "string" ? value.chaId : undefined;
}

/** `chat` without its `alternatives`, in place; returns it. */
export function withoutAltChat<T extends { alt?: unknown }>(chat: T): T {
    if (isFields(chat) && "alt" in chat) {
        delete chat.alt;
    }
    return chat;
}

/** `character` without the alternatives of its chats, in place; returns it. */
export function withoutAlt<T extends { chats?: readonly { alt?: unknown }[] }>(character: T): T {
    if (isFields(character) && Array.isArray(character.chats)) {
        for (const chat of character.chats) {
            withoutAltChat(chat);
        }
    }
    return character;
}

/** `withoutAlt` over every character of a copied list. */
export function withoutAltIn(characters: readonly { chats?: readonly { alt?: unknown }[] }[] | undefined): void {
    for (const character of characters ?? []) {
        withoutAlt(character);
    }
}

/**
 * A full character written over an archived-character placeholder would erase
 * the archived alternatives, which a plugin cannot see and so cannot send back.
 * The setters restore such a placeholder first (`restoreArchivedTargets`), then
 * merge as for any live character, and refuse the whole write when a target is
 * a placeholder again at the final synchronous point (`placeholderTargets`).
 */

/** Whether `incoming`, a full character, is written over `live`, a placeholder with the same `chaId`. */
export function overwritesPlaceholder(live: unknown, incoming: unknown): boolean {
    const chaId = chaIdOf(incoming);
    return isFields(live) && Boolean(live.coldstorage) && chaId !== undefined && chaIdOf(live) === chaId
        && isFields(incoming) && !incoming.coldstorage;
}

/**
 * The `chaId` of every full character in `incoming` whose `chaId` a placeholder
 * of `live` holds, each once, in incoming order.
 */
export function placeholderTargets(live: readonly unknown[] | undefined, incoming: unknown): string[] {
    if (!Array.isArray(incoming)) {
        return [];
    }
    const placeholders = new Set<string>();
    for (const character of live ?? []) {
        const chaId = chaIdOf(character);
        if (chaId !== undefined && isFields(character) && character.coldstorage) {
            placeholders.add(chaId);
        }
    }
    if (placeholders.size === 0) {
        return [];
    }
    const targets: string[] = [];
    for (const character of incoming) {
        const chaId = chaIdOf(character);
        if (chaId !== undefined && isFields(character) && !character.coldstorage && placeholders.has(chaId) && !targets.includes(chaId)) {
            targets.push(chaId);
        }
    }
    return targets;
}

/** The message that refuses a write whose target is a placeholder at the final check. */
export function placeholderAgainMessage(chaId: string): string {
    return `The character ${chaId} was archived again before the write could finish. Nothing was written.`;
}

/**
 * Restores each target one after the other. Returns the message of the first
 * restore that fails (the user was already told), or null when all are full.
 */
export async function restoreArchivedTargets(chaIds: readonly string[]): Promise<string | null> {
    // Loaded when a restore is needed: this module is imported by code that must not load the cold-storage graph.
    const { restoreArchivedForWrite } = await import("../process/coldCharacterAccess");
    for (const chaId of chaIds) {
        const ready = await restoreArchivedForWrite(chaId);
        if (ready.status === "failed") {
            return ready.message;
        }
        if (ready.status === "gone") {
            return `The character ${chaId} is not in the character list. Nothing was written.`;
        }
    }
    return null;
}

/** What the live side of one chat held when it was captured. */
export interface ChatAltCapture {
    id: string | undefined;
    /** The live `alt` value (a reference, not a copy); undefined when the chat held none or an empty list. */
    alt: unknown;
    /** The ids of the live path, for `reattachOrphans`. */
    path: { chatId?: string }[];
    messageLength: number;
}

function holdsAlt(alt: unknown): boolean {
    return alt !== undefined && !(Array.isArray(alt) && alt.length === 0);
}

/** Captures `chat` before the write that replaces it. */
export function captureChatAlt(chat: unknown): ChatAltCapture {
    const fields: Fields = isFields(chat) ? chat : {};
    const message: unknown[] = Array.isArray(fields.message) ? fields.message : [];
    const hasAlt = holdsAlt(fields.alt);
    return {
        id: idOf(fields),
        alt: hasAlt ? fields.alt : undefined,
        path: hasAlt ? message.map((m) => {
            const chatId = isFields(m) ? m.chatId : undefined;
            return typeof chatId === "string" ? { chatId } : {};
        }) : [],
        messageLength: message.length,
    };
}

/**
 * Gives `incoming`, a chat that replaces the captured one, the captured
 * alternatives when it has the same `id`, then re-attaches records whose parent
 * the incoming path no longer holds. An incoming path that is empty over a
 * non-empty live path is a full clear and keeps none. Whatever `alt` the
 * incoming chat carried is dropped.
 */
export function keepCapturedChatAlt(capture: ChatAltCapture, incoming: unknown): void {
    if (!isFields(incoming)) {
        return;
    }
    if ("alt" in incoming) {
        delete incoming.alt;
    }
    if (capture.alt === undefined || capture.id === undefined || idOf(incoming) !== capture.id) {
        return;
    }
    const emptied = Array.isArray(incoming.message) && incoming.message.length === 0 && capture.messageLength > 0;
    if (emptied) {
        return;
    }
    incoming.alt = capture.alt;
    if (isChatShape(incoming)) {
        reattachOrphans(incoming, capture.path);
    }
}

interface LiveCharacter {
    chats: ChatAltCapture[];
}

interface LiveTable {
    chaIdAt: (string | undefined)[];
    uniqueIndexOf: Map<string, number>;
    /** Only a character with at least one chat holding alternatives has an entry. */
    characters: Map<number, LiveCharacter>;
}

function countOf(counts: Map<string, number>, id: string): number {
    return counts.get(id) ?? 0;
}

function captureLive(liveCharacters: readonly unknown[] | undefined): LiveTable {
    const chaIdAt: (string | undefined)[] = [];
    const counts = new Map<string, number>();
    const characters = new Map<number, LiveCharacter>();
    const live = liveCharacters ?? [];
    for (let j = 0; j < live.length; j++) {
        const character = live[j];
        const chaId = chaIdOf(character);
        chaIdAt.push(chaId);
        if (chaId !== undefined) {
            counts.set(chaId, countOf(counts, chaId) + 1);
        }
        const chats = isFields(character) ? character.chats : undefined;
        if (!Array.isArray(chats) || !chats.some((chat) => isFields(chat) && holdsAlt(chat.alt))) {
            continue;
        }
        characters.set(j, { chats: chats.map((chat) => captureChatAlt(chat)) });
    }
    const uniqueIndexOf = new Map<string, number>();
    chaIdAt.forEach((chaId, j) => {
        if (chaId !== undefined && countOf(counts, chaId) === 1) {
            uniqueIndexOf.set(chaId, j);
        }
    });
    return { chaIdAt, uniqueIndexOf, characters };
}

function idCounts(chats: readonly unknown[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const chat of chats) {
        const id = idOf(chat);
        if (id !== undefined) {
            counts.set(id, countOf(counts, id) + 1);
        }
    }
    return counts;
}

/**
 * Which captured chat each incoming chat continues: the one with its id when
 * both sides hold that id once, otherwise the one at the same index with the
 * same id. A captured chat left over whose id an unmatched incoming chat holds
 * passes its alternatives to the first such chat; a captured chat whose id the
 * incoming list does not hold was deleted by the plugin and its alternatives go
 * with it.
 */
function matchChats(live: LiveCharacter, incoming: readonly unknown[]): (ChatAltCapture | null)[] {
    const liveCounts = idCounts(live.chats);
    const incomingCounts = idCounts(incoming);
    const matched: (ChatAltCapture | null)[] = incoming.map(() => null);
    const used = new Set<ChatAltCapture>();
    incoming.forEach((chat, k) => {
        const id = idOf(chat);
        if (id === undefined) {
            return;
        }
        const candidate = countOf(liveCounts, id) === 1 && countOf(incomingCounts, id) === 1
            ? live.chats.find((captured) => captured.id === id)
            : live.chats[k]?.id === id ? live.chats[k] : undefined;
        if (candidate && !used.has(candidate)) {
            matched[k] = candidate;
            used.add(candidate);
        }
    });
    for (const captured of live.chats) {
        if (used.has(captured) || captured.alt === undefined || captured.id === undefined || !incomingCounts.has(captured.id)) {
            continue;
        }
        const holder = incoming.findIndex((chat, k) => matched[k] === null && idOf(chat) === captured.id);
        if (holder !== -1) {
            console.warn(`[WARN] A plugin write held the chat id ${captured.id} more than once. Its alternative replies went to the first chat with that id.`);
            matched[holder] = captured;
            used.add(captured);
        }
    }
    return matched;
}

/**
 * Makes `incomingCharacters`, the characters a plugin writes in place of
 * `liveCharacters`, carry the live alternatives. A character continues the live
 * one at the same index with the same `chaId`, otherwise the live one with its
 * `chaId` when each list holds that id once; chats continue by `matchChats`.
 * Every matched chat loses the `alt` it was given and takes the captured one
 * (none for a full clear), then re-attaches records whose parent left the path.
 * An incoming character that continues no live character is left as it is.
 */
export function keepLiveAlt(liveCharacters: readonly unknown[] | undefined, incomingCharacters: unknown): void {
    if (!Array.isArray(incomingCharacters)) {
        return;
    }
    const table = captureLive(liveCharacters);
    const incomingCounts = new Map<string, number>();
    for (const character of incomingCharacters) {
        const chaId = chaIdOf(character);
        if (chaId !== undefined) {
            incomingCounts.set(chaId, countOf(incomingCounts, chaId) + 1);
        }
    }
    incomingCharacters.forEach((character, j) => {
        const chaId = chaIdOf(character);
        if (chaId === undefined || !isFields(character) || !Array.isArray(character.chats)) {
            return;
        }
        const liveIndex = table.chaIdAt[j] === chaId
            ? j
            : countOf(incomingCounts, chaId) === 1 ? table.uniqueIndexOf.get(chaId) : undefined;
        if (liveIndex === undefined) {
            return;
        }
        const live = table.characters.get(liveIndex);
        if (live === undefined) {
            for (const chat of character.chats) {
                withoutAltChat(isFields(chat) ? chat : {});
            }
            return;
        }
        const matched = matchChats(live, character.chats);
        character.chats.forEach((chat, k) => {
            const captured = matched[k];
            if (captured) {
                keepCapturedChatAlt(captured, chat);
            } else if (isFields(chat)) {
                withoutAltChat(chat);
            }
        });
    });
}
