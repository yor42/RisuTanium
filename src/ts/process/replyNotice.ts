import { language } from '../../lang'
import { fillLang } from '../../lang/fill'
import sendSound from '../../etc/send.mp3'
import { notifyReply, replyNotificationKey, state as replyNotificationState } from '../android/replyNotifications.svelte'
import { readNotificationStatus } from '../gui/notificationPermission'
import { isAndroidTransport } from '../storage/tauriByteTransport'
import { DBState } from '../stores.svelte'
import { postToast } from '../toast/toastHost.svelte'
import { readAt } from './chatOrigin'
import { isPageVisible } from './chatOnScreen.svelte'
import type { ReplyAnnouncement, ReplyOutcome } from './replyMarks'

/**
 * The notice of an off-screen outcome (CHORE-685 R6, R12): one chip per outermost send, and for a finished reply one sound
 * and one system notification. A failed or stopped reply posts its chip only: no sound and no system notification.
 */

// The sends whose reply already sounded, keyed by the caller's signal, so the composer's own `playMessage` chime does not
// sound a second time for the same reply.
const chimedFor = new WeakSet<AbortSignal>()

/** Whether the notice already sounded for the send that was started with this signal. */
export function hasChimedFor(signal: AbortSignal | undefined): boolean {
    return signal !== undefined && chimedFor.has(signal)
}

// The sends that ended failed or stopped, keyed by the caller's signal: such a reply plays no sound at all, so the composer's
// own `playMessage` chime stays silent for it too.
const silencedFor = new WeakSet<AbortSignal>()

/** Whether the send that was started with this signal ended failed or stopped, so no sound may follow it. */
export function hasSilencedFor(signal: AbortSignal | undefined): boolean {
    return signal !== undefined && silencedFor.has(signal)
}

/** Records how a send ended, on screen or off: a failed or stopped one silences the composer's chime, any other outcome does not. */
export function noteReplySound(signal: AbortSignal | undefined, outcome: ReplyOutcome): void {
    if (signal !== undefined && (outcome === 'failed' || outcome === 'stopped')) {
        silencedFor.add(signal)
    }
}

interface ChatNames {
    /** The character or group the chat belongs to. */
    owner: string
    /** The chat's own name, empty when it has none. */
    chat: string
}

function namesOf(announcement: ReplyAnnouncement): ChatNames | null {
    const found: { names: ChatNames | null } = { names: null }
    readAt(announcement.origin, (ctx) => {
        found.names = { owner: ctx.owner.name || language.settingsPage.unnamed, chat: ctx.chat.name || '' }
    })
    return found.names
}

function playPageChime(): void {
    if (typeof Audio === 'undefined') {
        return
    }
    try {
        void new Audio(sendSound).play().catch(() => {})
    } catch {
        // A page that cannot play audio stays silent; the chip still shows.
    }
}

/** The web Notification of the existing opt-in: silent, because the page chime is the one sound. */
function postWebNotification(title: string, body: string): void {
    if (!DBState.db.notification || readNotificationStatus() !== 'granted') {
        return
    }
    try {
        const notification = new Notification(title, { body, silent: true })
        notification.onclick = () => {
            window.focus()
        }
    } catch {
        // A browser that refuses the constructor shows no system notification; the chip still shows.
    }
}

/**
 * Announces how an off-screen send ended. Called once per outermost send, after its registration has ended, so the chat no
 * longer reads as writing when the chip appears. `callerSignal` is the signal the send was started with.
 *
 * One sound per finished reply: the page chime plays while the page is visible, or when the system notification will not
 * sound; otherwise the notification's own channel sound is the one. Either way the signal is recorded, so a `playMessage`
 * chime of the composer adds none.
 */
export function announceReply(announcement: ReplyAnnouncement | null, callerSignal: AbortSignal | undefined): void {
    if (announcement === null) {
        return
    }
    noteReplySound(callerSignal, announcement.outcome)
    const names = namesOf(announcement)
    if (names === null) {
        return
    }
    const sub = names.chat || undefined
    if (announcement.outcome === 'failed') {
        postToast({ kind: 'error', text: fillLang(language.replyFailedElsewhere, { name: names.owner }), sub })
        return
    }
    if (announcement.outcome === 'stopped') {
        postToast({ kind: 'warning', text: fillLang(language.replyStoppedElsewhere, { name: names.owner }), sub })
        return
    }
    const title = fillLang(language.replyFinishedElsewhere, { name: names.owner })
    const body = names.chat || names.owner
    const visible = isPageVisible()
    const android = isAndroidTransport()
    const systemSounds = android && replyNotificationState.optedIn && replyNotificationState.enabled
    if (visible || !systemSounds) {
        playPageChime()
    }
    postToast({ kind: 'info', text: title, sub })
    if (android) {
        notifyReply(replyNotificationKey(announcement.origin), title, body, visible)
    } else {
        postWebNotification(title, body)
    }
    if (callerSignal !== undefined) {
        chimedFor.add(callerSignal)
    }
}
