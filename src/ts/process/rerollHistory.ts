import type { Message } from '../storage/database.svelte'

/**
 * Where a reroll cuts the chat. Counting from the end of the chat, it stops at
 * the last speaker's previous message (the nearest earlier message with the
 * same speaker as the chat's last message), or at the last user message,
 * whichever comes first, and keeps everything up to and including that message. Null when the chat is empty or
 * the count reaches the start of the chat without stopping. The messages from
 * that position on are the piece a reroll replaces; it equals the chat's length
 * when the last message is a user message, which leaves nothing to cut.
 */
export function rerollBase(messages: Message[]): number | null {
    let end = messages.length
    if(end === 0){
        return null
    }
    const saying = messages[end - 1].saying
    let quota = 2
    while(messages[end - 1].role !== 'user'){
        if(messages[end - 1].saying === saying){
            quota -= 1
            if(quota === 0){
                break
            }
        }
        end -= 1
        if(end === 0){
            return null
        }
    }
    return end
}
