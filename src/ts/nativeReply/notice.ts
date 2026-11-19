import { language } from '../../lang'
import type { ReplyNoticeState } from '../android/replyNotifications.svelte'

/**
 * What the page hands the native side so it can post this reply's notice itself while the page is hidden. The payload is
 * version 1 of the host's arm contract: the notice of a finished reply, the notice of a failed one, and the strings of
 * the keep-alive card that closes with the reply. It carries the texts the page's own notice carries and nothing of
 * what was said in the chat.
 */

/** The notice of a failed reply (D13): the character's name as title and the existing failed text; it never sounds. */
export function failedNoticeOf(done: ReplyNoticeState): ReplyNoticeState {
    return { ...done, text: language.keepAliveFailed, publicTitle: language.keepAliveFailed, silent: true }
}

/** The JSON string of the arm payload for a reply whose own notice would be `done`. */
export function buildNativeNoticeArm(done: ReplyNoticeState): string {
    return JSON.stringify({
        v: 1,
        done,
        failed: failedNoticeOf(done),
        closing: {
            chaId: done.chaId,
            chatId: done.chatId,
            finishingTitle: language.keepAliveFinishing,
            failedTitle: language.keepAliveFailed,
            failedText: language.keepAliveFailedHint,
        },
    })
}

/** The largest token the host accepts (a positive 32-bit int). */
const TOKEN_MAX = 0x7fffffff

/**
 * A random positive 31-bit token. A counter would let a second page or a restart reuse a live token, so the value is
 * drawn at random and never zero.
 */
export function newNoticeToken(random: (words: Uint32Array) => Uint32Array = (words) => crypto.getRandomValues(words)): number {
    const words = random(new Uint32Array(1))
    const token = words[0] & TOKEN_MAX
    return token === 0 ? 1 : token
}
