import { writeLiveChat } from '../liveCharacterWrite'
import type { Chat } from '../storage/database.svelte'
import type { Origin, OriginContext } from './chatOrigin'

/**
 * The persisted new-reply mark of a chat (`Chat.unseenReply`): `'reply'` after a reply finished while the chat was not on
 * screen, `'error'` after one failed or was stopped there. It lives on the chat, so it survives a restart, and it is cleared
 * when the chat is on screen again (see `chatOnScreen.svelte.ts`). Every set and clear goes through `writeLiveChat`, which
 * marks the owner for save; a value this build does not know reads as no mark and is never cleared.
 */

export type ReplyMarkKind = 'reply' | 'error'

/** How one outermost send ended, as far as the mark is concerned. */
export type ReplyOutcome = 'reply' | 'failed' | 'stopped' | 'none'

/** What an off-screen outcome hands to the notice: the chat it belongs to and how it ended. */
export interface ReplyAnnouncement {
    origin: Origin
    outcome: Exclude<ReplyOutcome, 'none'>
}

/** The mark the chat shows: its value when it is one this build knows, else none. */
export function replyMarkOf(chat: Pick<Chat, 'unseenReply'>): ReplyMarkKind | null {
    const value: unknown = chat.unseenReply
    return value === 'reply' || value === 'error' ? value : null
}

/**
 * Sets the mark on the live chat the send was addressed to; the latest outcome wins, whatever the chat held. `chat` is the
 * object the send read the origin through (`hint.chat`): the origin's ids alone cannot name the holder when two chats
 * share an id. Returns whether the mark landed; a gone or archived owner or chat lands nothing.
 */
export function setReplyMark(origin: Origin, chat: Chat, kind: ReplyMarkKind): boolean {
    return writeLiveChat(origin.chaId, chat, (live) => {
        live.unseenReply = kind
        return true
    })
}

/** Removes a known mark from the live chat; a chat with none, or with a value this build does not know, is left as it is. */
export function clearReplyMark(chaId: string, chat: Chat): boolean {
    return writeLiveChat(chaId, chat, (live) => {
        if (replyMarkOf(live) === null) {
            return false
        }
        delete live.unseenReply
        return true
    })
}

// A `throwError` of the body reaches every step and recursion of a unit through the unit's one signal.
const failedUnits = new WeakSet<AbortSignal>()

/** Records that the unit with this signal alerted an error. */
export function noteUnitFailure(signal: AbortSignal): void {
    failedUnits.add(signal)
}

export interface ReplyFacts {
    /** What the body reported. */
    completed: boolean
    /** The unit's signal: whether it was aborted, and whether an error was recorded against it. */
    signal: AbortSignal
    /** The body threw. */
    threw: boolean
    /** The module check refused the send before the body ran. */
    modulesFailed: boolean
}

/**
 * The first match wins: no outcome when the origin no longer resolves (a delete or a move to Trash stopped the unit, so there
 * is no chat to mark and nothing to announce); a reply when the body completed and the unit was not aborted (an error alerted after a
 * finished reply, by the emotion or image step, stays a reply); stopped when the unit was aborted; failed for a throw, a
 * recorded error or a refused module check; otherwise none (a trigger that stopped the send).
 */
export function classifyReplyOutcome(originResolves: boolean, facts: ReplyFacts): ReplyOutcome {
    if (!originResolves) {
        return 'none'
    }
    const aborted = facts.signal.aborted
    if (facts.completed && !aborted) {
        return 'reply'
    }
    if (aborted) {
        return 'stopped'
    }
    if (facts.threw || facts.modulesFailed || failedUnits.has(facts.signal)) {
        return 'failed'
    }
    return 'none'
}

/** What `recordReplyOutcome` needs of the call: the origin, the chat object it was read through, and the subject that resolves it. */
export interface ReplyCall {
    origin: Origin
    hint: { chat: Chat }
    subject: { resolve(): OriginContext | null }
}

/**
 * Decides once whether the chat is on screen; when it is not and the send ended in an outcome, marks the chat and returns
 * what the notice announces. It runs in the `finally` of the outermost send, before the hidden-page flush and while the
 * registration is live, so the mark is saved with the flush and cannot race a put-back. It never throws: a throw there would
 * skip the flush and leave the send flag set for good. A failed mark write still returns the announcement.
 */
export function recordReplyOutcome(call: ReplyCall, facts: ReplyFacts, isOnScreen: (origin: Origin) => boolean): ReplyAnnouncement | null {
    try {
        if (isOnScreen(call.origin)) {
            return null
        }
        // A character moved to Trash is a delete-stop too: its origin still resolves, but nothing is left to mark or announce.
        const context = call.subject.resolve()
        const outcome = classifyReplyOutcome(context !== null && !context.owner.trashTime, facts)
        if (outcome === 'none') {
            return null
        }
        try {
            setReplyMark(call.origin, call.hint.chat, outcome === 'reply' ? 'reply' : 'error')
        } catch (error) {
            console.error('The reply mark could not be written', error)
        }
        return { origin: call.origin, outcome }
    } catch (error) {
        console.error('The reply outcome could not be recorded', error)
        return null
    }
}
