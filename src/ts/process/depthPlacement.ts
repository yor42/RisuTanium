/** A `@@reverse_depth N` prompt: `depth` is N and `chat` is the prompt to place. */
export interface ReverseDepthEntry<T> {
    depth: number
    chat: T
}

/**
 * Places `@@reverse_depth` prompts in the chat list in one pass.
 *
 * Every slot is computed against `chats` as it is before any insertion, so a
 * prompt placed earlier never counts as a message for a later one. Prompts
 * that share a slot keep the order of `entries`. A depth beyond the list puts
 * the prompt at the top.
 *
 * `tail` is 1 when the last message was split off the list into the `lastChat`
 * block and is actually sent: it then counts as one of the N entries after the
 * prompt, and depth 0 is returned in `lastChatAppend` to follow that message
 * instead of being inserted. Otherwise `tail` is 0 and depth 0 is the end of
 * `chats`.
 *
 * The inputs are not modified.
 */
export function placeReverseDepth<T>(
    chats: readonly T[],
    entries: readonly ReverseDepthEntry<T>[],
    options: { tail: 0 | 1 }
): { chats: T[], lastChatAppend: T[] } {
    const length = chats.length
    const slots: T[][] = Array.from({ length: length + 1 }, () => [])
    const lastChatAppend: T[] = []
    for(const entry of entries){
        if(options.tail === 1 && entry.depth === 0){
            lastChatAppend.push(entry.chat)
            continue
        }
        const slot = Math.max(0, Math.min(length, Math.trunc(length - (entry.depth - options.tail))))
        slots[Number.isNaN(slot) ? 0 : slot].push(entry.chat)
    }
    const placed: T[] = []
    for(let i = 0; i <= length; i++){
        placed.push(...slots[i])
        if(i < length){
            placed.push(chats[i])
        }
    }
    return { chats: placed, lastChatAppend }
}
