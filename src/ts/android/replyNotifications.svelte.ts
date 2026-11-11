/**
 * Page side of the Android reply notifications: a system notification when a reply finishes in a
 * chat the user is not looking at. The switch is off until the user turns it on (`enable`); the
 * host then asks Android for the notification permission and pushes the real state back (on every
 * resume too, since the user may change the system settings away from the app). Until the host
 * has reported a state that is both opted in and enabled, `notifyReply` does nothing, so the path
 * is harmless on the web, on desktop, on an old host and while the permission is missing.
 */
import type { Origin } from '../process/chatOrigin'
import { replyNotificationsHost } from './hostBridge'

/** The host object `ReplyNotificationsBridge` exposes to the page. */
export interface ReplyNotificationsHost {
    refresh(): unknown
    enable(): unknown
    disable(): unknown
    /** One notification per `key`: a later call with the same key replaces the earlier one. `silent` suppresses the notification's own sound. */
    notify(key: string, title: string, body: string, silent: boolean): unknown
    /** Contract v2: the notice as the JSON string of a `ReplyNoticeState`. A host without it is an old one and gets `notify`. */
    notifyState(json: string): unknown
    cancel(key: string): unknown
    /** Opens the app's system notification settings. It never changes the reply opt-in. */
    openNotificationSettings(): unknown
}

/**
 * The contract-v2 reply notice. `key` is the notification's tag: the same key `cancelReplyNotification` removes it by.
 * Native shows `name` as the title and `text` as the body, and on a locked screen only `publicTitle`; the chat's own name
 * and anything said in it never travel. `chaId` and `chatId` are the target a tap opens. `avatar` is a thumbnail data URL,
 * or null for no large icon.
 */
export interface ReplyNoticeState {
    v: 2
    key: string
    name: string
    text: string
    publicTitle: string
    chaId: string
    chatId: string
    avatar: string | null
    /** Suppresses the notification's own sound. */
    silent: boolean
}

declare global {
    interface Window {
        /** Android host: the reply-notification bridge on the separate-object path. Absent elsewhere. */
        __risuTaniumReplyNotificationsHost?: Partial<ReplyNotificationsHost>
        /** Called by the host with the opt-in and the real enabled state. */
        __risuTaniumReplyNotificationsState?: (value: unknown) => void
        /** Called by the host with the answer to the keep-alive notification permission ask. */
        __risuTaniumNotificationPermissionResult?: (granted: unknown) => void
    }
}

/** The longest key the host accepts; a longer one never reaches it. */
export const REPLY_KEY_MAX_LENGTH = 200

/** `known` is false until the host has reported once; `enabled` is whether Android would show a notification now. */
export const state = $state({ known: false, optedIn: false, enabled: false })

/**
 * The notice after the notification permission is denied (DD-009), held in memory only:
 * - `appNotifications` is the host's app-level answer, null until a host that reports it has pushed.
 * - `phase` runs idle -> pending (a denial arrived) -> consumed (one chat instance took it) -> done.
 *   `done` is terminal for the process: a later denial, a later result and any later push never show
 *   the notice again. That includes a boot push with notifications already on, so a user who
 *   granted at the first ask sees the Settings line only if they switch them off later.
 * Only the instance that consumed the notice shows it; an instance that unmounts takes it with it.
 */
export type NotificationsOffPhase = 'idle' | 'pending' | 'consumed' | 'done'
export const notificationsOff = $state({ appNotifications: null as boolean | null, phase: 'idle' as NotificationsOffPhase })

/** The notification key of a chat: one notification per chat. */
export function replyNotificationKey(origin: Origin): string {
    return `${origin.chaId}/${origin.chatId}`
}

/** A missing method is skipped and a failing call is logged: neither may break the work that triggered it. */
function callHost<K extends keyof ReplyNotificationsHost>(method: K, ...args: Parameters<ReplyNotificationsHost[K]>): void {
    try {
        const host = replyNotificationsHost()
        const call = host?.[method] as ((...callArgs: Parameters<ReplyNotificationsHost[K]>) => unknown) | undefined
        // Called as a method: the host bridge object needs its receiver.
        call?.apply(host, args)
    } catch (error) {
        console.error('reply notifications host call failed', error)
    }
}

function isReplyKey(key: string): boolean {
    return key.length > 0 && key.length <= REPLY_KEY_MAX_LENGTH
}

/**
 * The host's state as a JSON string or the object itself, or null unless both flags are booleans.
 * `appNotifications` is optional: a value that is not a boolean counts as absent (null) and never
 * rejects the two flags.
 */
function readState(value: unknown): { optedIn: boolean; enabled: boolean; appNotifications: boolean | null } | null {
    let parsed: unknown = value
    if (typeof value === 'string') {
        try {
            parsed = JSON.parse(value)
        } catch {
            return null
        }
    }
    if (typeof parsed !== 'object' || parsed === null) {
        return null
    }
    const fields = parsed as Record<string, unknown>
    if (typeof fields.optedIn !== 'boolean' || typeof fields.enabled !== 'boolean') {
        return null
    }
    return {
        optedIn: fields.optedIn,
        enabled: fields.enabled,
        appNotifications: typeof fields.appNotifications === 'boolean' ? fields.appNotifications : null,
    }
}

function receiveState(value: unknown): void {
    const next = readState(value)
    if (next === null) {
        return
    }
    state.known = true
    state.optedIn = next.optedIn
    state.enabled = next.enabled
    notificationsOff.appNotifications = next.appNotifications
    // Notifications allowed ends the notice in every phase, an idle one included (see notificationsOff).
    if (next.appNotifications === true) {
        notificationsOff.phase = 'done'
    }
}

/** The keep-alive permission answer: a denial arms the notice once; an allow ends it; anything else is ignored. */
function receiveNotificationPermissionResult(granted: unknown): void {
    if (granted === false) {
        if (notificationsOff.phase === 'idle') {
            notificationsOff.phase = 'pending'
        }
    } else if (granted === true) {
        notificationsOff.phase = 'done'
    }
}

/** Compare-and-set: the first caller while pending takes the notice and gets true; every other call gets false. */
export function consumeNotificationsOffNotice(): boolean {
    if (notificationsOff.phase !== 'pending') {
        return false
    }
    notificationsOff.phase = 'consumed'
    return true
}

/** Close: the notice is gone for the process. */
export function dismissNotificationsOffNotice(): void {
    notificationsOff.phase = 'done'
}

/** [Open settings]: opens the app's notification settings through the host (never `enable`) and ends the notice. */
export function openNotificationSettings(): void {
    callHost('openNotificationSettings')
    notificationsOff.phase = 'done'
}

/** The Settings line shows while the host says app notifications are off; an old host reports nothing, so nothing shows. */
export function notificationsOffLineShown(): boolean {
    return notificationsOff.appNotifications === false
}

/** Test-only: returns the notice to its initial state. */
export function resetNotificationsOffNoticeForTests(): void {
    notificationsOff.appNotifications = null
    notificationsOff.phase = 'idle'
}

/** Listens for the host's state and asks for it once. Safe to call again and where there is no host. */
export function installReplyNotifications(): void {
    if (typeof window === 'undefined') {
        return
    }
    window.__risuTaniumReplyNotificationsState = receiveState
    window.__risuTaniumNotificationPermissionResult = receiveNotificationPermissionResult
    callHost('refresh')
}

/** The user turned the switch on: the host asks for the permission or opens the system settings, then reports the state. */
export function enable(): void {
    callHost('enable')
}

/** The user turned the switch off. */
export function disable(): void {
    callHost('disable')
}

/** Whether a notification for `key` may be posted now: the host reported opted in and enabled, and the key fits. */
function mayPost(key: string): boolean {
    return state.known && state.optedIn && state.enabled && isReplyKey(key)
}

/** Posts the chat's notification; does nothing unless the host reported opted in and enabled. */
export function notifyReply(key: string, title: string, body: string, silent: boolean): void {
    if (!mayPost(key)) {
        return
    }
    callHost('notify', key, title, body, silent)
}

/** True when the host takes the v2 notice. An old host has only `notify`. */
export function hasReplyStateHost(): boolean {
    try {
        return typeof replyNotificationsHost()?.notifyState === 'function'
    } catch {
        return false
    }
}

/** Posts the chat's v2 notification under the same gate as `notifyReply`. */
export function notifyReplyState(notice: ReplyNoticeState): void {
    if (!mayPost(notice.key)) {
        return
    }
    callHost('notifyState', JSON.stringify(notice))
}

/** Removes the chat's notification, if any. */
export function cancelReplyNotification(key: string): void {
    if (!isReplyKey(key)) {
        return
    }
    callHost('cancel', key)
}
