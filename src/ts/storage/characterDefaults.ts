import { v4 as uuidv4 } from "uuid"
import type { Database } from "./database.svelte"

/**
 * The per-character rules the application applies to a decoded character
 * before it uses it. They live here, apart from `bootstrap.ts`, so that the
 * boot archive pass can give a character the same shape the running
 * application would give it, without importing the boot module's graph.
 *
 * This module's only runtime import is `uuid`.
 */

type Slot = Database['characters'][number]

/**
 * Fills the fields every character must have, in place, and returns it. A
 * field that is already set is left as it is; only `emotionImages` is
 * assigned unconditionally, as the boot check has always done. A group gets an
 * empty member list when it has none; a group that has members is unchanged.
 */
export function applyCharacterDefaults(v: Slot): Slot {
    v.chaId ??= uuidv4();
    v.type ??= 'character';
    v.chatPage ??= 0;
    v.chats ??= [];
    v.customscript ??= [];
    v.firstMessage ??= '';
    v.globalLore ??= [];
    v.name ??= '';
    v.viewScreen ??= 'none';
    v.emotionImages = v.emotionImages ?? [];

    if (v.type === 'character') {
        v.bias ??= [];
        v.characterVersion ??= '';
        v.creator ??= '';
        v.desc ??= '';
        v.utilityBot ??= false;
        v.tags ??= [];
        v.systemPrompt ??= '';
        v.scenario ??= '';
    }
    if (v.type === 'group') {
        v.characters ??= [];
    }
    return v;
}

/**
 * Clears the streaming state a save can carry from a page that was closed
 * mid-stream, on every chat of `cha`, in place. `setDatabase` does the same to
 * every character it installs. A `chats` value that is not an array, or an
 * entry that is not an object, is left alone: one malformed character must not
 * stop the caller.
 */
export function resetChatStreamingState(cha: Slot): void {
    if (!Array.isArray(cha.chats)) {
        return
    }
    for (const chat of cha.chats) {
        if (typeof chat !== 'object' || chat === null) {
            continue
        }
        chat.isStreaming = false
        chat.activeStreamingDisplayOptimizationMode = undefined
    }
}
