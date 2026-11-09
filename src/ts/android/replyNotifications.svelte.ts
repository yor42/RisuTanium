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
    cancel(key: string): unknown
}

declare global {
    interface Window {
        /** Android host: the reply-notification bridge on the separate-object path. Absent elsewhere. */
        __risuTaniumReplyNotificationsHost?: Partial<ReplyNotificationsHost>
        /** Called by the host with the opt-in and the real enabled state. */
        __risuTaniumReplyNotificationsState?: (value: unknown) => void
    }
}

/** The longest key the host accepts; a longer one never reaches it. */
export const REPLY_KEY_MAX_LENGTH = 200

/** `known` is false until the host has reported once; `enabled` is whether Android would show a notification now. */
export const state = $state({ known: false, optedIn: false, enabled: false })

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

/** The host's state as a JSON string or the object itself, or null unless both flags are booleans. */
function readState(value: unknown): { optedIn: boolean; enabled: boolean } | null {
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
    return { optedIn: fields.optedIn, enabled: fields.enabled }
}

function receiveState(value: unknown): void {
    const next = readState(value)
    if (next === null) {
        return
    }
    state.known = true
    state.optedIn = next.optedIn
    state.enabled = next.enabled
}

/** Listens for the host's state and asks for it once. Safe to call again and where there is no host. */
export function installReplyNotifications(): void {
    if (typeof window === 'undefined') {
        return
    }
    window.__risuTaniumReplyNotificationsState = receiveState
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

/** Posts the chat's notification; does nothing unless the host reported opted in and enabled. */
export function notifyReply(key: string, title: string, body: string, silent: boolean): void {
    if (!state.known || !state.optedIn || !state.enabled || !isReplyKey(key)) {
        return
    }
    callHost('notify', key, title, body, silent)
}

/** Removes the chat's notification, if any. */
export function cancelReplyNotification(key: string): void {
    if (!isReplyKey(key)) {
        return
    }
    callHost('cancel', key)
}
