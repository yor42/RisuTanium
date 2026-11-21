import type { Chat } from '../../../ts/storage/database.svelte'
import { matchColdStorageLoadErrorKey } from '../../../ts/process/coldstorageData'
import { isArchivedChat, previewText } from '../../../ts/chatShell/chatListModel'

/**
 * The last line of a story card: the last message of any role as plain text.
 * The result is never markup and is rendered as a text node. Markup and macros
 * are stripped, never resolved, and nothing here loads a chat.
 */

/** Only the head can reach the 200 character result, so a huge message is never scanned whole. */
const HEAD_LIMIT = 4000
const BLOCK_ELEMENTS = /<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi

/** Removes every outermost `{{...}}` span with what is nested inside; an unclosed span drops to the end. */
function dropMacros(text: string): string {
    let out = ''
    let depth = 0
    let i = 0
    while (i < text.length) {
        if (text.startsWith('{{', i)) {
            depth++
            i += 2
        } else if (depth > 0 && text.startsWith('}}', i)) {
            depth--
            i += 2
        } else {
            if (depth === 0) {
                out += text[i]
            }
            i++
        }
    }
    return out
}

export function storySnippet(chat: Chat | null): string {
    const messages = chat?.message
    if (!chat || !Array.isArray(messages) || messages.length === 0) {
        return ''
    }
    if (isArchivedChat(chat) || matchColdStorageLoadErrorKey(messages[0].data) !== null) {
        return ''
    }
    const data = messages[messages.length - 1].data
    if (typeof data !== 'string') {
        return ''
    }
    return previewText(dropMacros(data.slice(0, HEAD_LIMIT).replace(BLOCK_ELEMENTS, '')))
}
