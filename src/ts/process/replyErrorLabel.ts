import { language } from '../../lang'
import { fillLang } from '../../lang/fill'
import { readAt, type Origin } from './chatOrigin'

/** What a send holds about the chat it was addressed to: used when the origin no longer reads. */
interface ReplyChatHint {
    owner?: { name?: string }
    chat?: { name?: string }
}

/**
 * The "Character: chat" first line of a reply's error: the owner's name (the group's, in a group chat) and the chat
 * list's own label for the chat, `unnamed` included. Names are read through the failing unit's own origin, never the
 * selection; when the origin no longer reads (the chat was deleted or moved during the send) the send's hint stands in.
 * Null when neither names the chat, and the error then shows without the line. Never throws.
 */
export function replyChatLabel(origin: Origin, hint?: ReplyChatHint): string | null {
    try {
        const found: { owner: string | null; chat: string | null } = { owner: null, chat: null }
        readAt(origin, (ctx) => {
            found.owner = ctx.owner.name || language.settingsPage.unnamed
            found.chat = ctx.chat.name || language.settingsPage.unnamed
        })
        if (found.owner !== null && found.chat !== null) {
            return fillLang(language.replyErrorChatLabel, { name: found.owner, chat: found.chat })
        }
        if (hint?.owner && hint.chat) {
            return fillLang(language.replyErrorChatLabel, {
                name: hint.owner.name || language.settingsPage.unnamed,
                chat: hint.chat.name || language.settingsPage.unnamed,
            })
        }
        return null
    } catch (error) {
        console.error(error)
        return null
    }
}
