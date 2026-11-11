/**
 * Page side of the Android host channel. When the host injects one message object into the
 * app's main frame, the system-bar, gesture-inset, keep-alive, reply-notification and opened-files bridges all go
 * through it as JSON strings; otherwise each caller gets the separate host object it used
 * before, unchanged. Every export prefers the channel, so a caller never touches both.
 *
 * Messages to the host: `{bridge, method, args}` plus an `id` on a take. Messages from the
 * host: `{event:'gestureInset', value}`, `{event:'ime', visible, height}` and `{id, result, through}` for a take. The host
 * ignores a message it does not understand, so a bad value never throws here either.
 */
import type { KeepAliveHostObject } from './keepAliveService'
import type { ReplyNotificationsHost } from './replyNotifications.svelte'

interface HostMessageEvent {
    data: unknown
}

type HostMessageListener = (event: HostMessageEvent) => void

/** The object the host injects: strings out through `postMessage`, strings in through `message` events. */
export interface HostChannel {
    postMessage(message: string): void
    addEventListener?(type: 'message', listener: HostMessageListener): void
    removeEventListener?(type: 'message', listener: HostMessageListener): void
    onmessage?: HostMessageListener | null
}

declare global {
    interface Window {
        /** Android host: the main-frame message channel. Absent elsewhere and where the separate host objects are used. */
        __risuTaniumHost?: HostChannel
    }
}

/** The keyboard as the host reports it: `height` is the space it takes from the page, in CSS px. */
export interface ImeState {
    visible: boolean
    height: number
}

/** The host's keyboard state: `read` is null until the host has reported one, and `subscribe` returns its unsubscribe. */
export interface HostIme {
    read(): ImeState | null
    subscribe(listener: (state: ImeState) => void): () => void
}

/** One take of the host's opened-files queue. */
export interface OpenedFilesTake {
    raw: unknown
    /** True when the host keeps the batches until `confirm` is called; false when the take already removed them. */
    held: boolean
    /** Tells the host the batches were received. A no-op when nothing is held. */
    confirm(): void
}

interface PendingTake {
    id: number
    /** Null when the channel went away before the reply. */
    resolve(reply: { raw: string; through: number } | null): void
}

let bound: HostChannel | null = null
let detachBound: (() => void) | null = null
let cachedInset = 0
let cachedIme: ImeState | null = null
const imeListeners = new Set<(state: ImeState) => void>()
let nextTakeId = 1
let pending: PendingTake[] = []

function send(channel: HostChannel, message: { bridge: string; method: string; args: unknown[]; id?: number }): void {
    // Called as a method: the host object needs its receiver.
    channel.postMessage(JSON.stringify(message))
}

/** A keyboard state from the host, or null when either field is not what the host sends. */
function readImeState(visible: unknown, height: unknown): ImeState | null {
    if (typeof visible !== 'boolean' || typeof height !== 'number' || !Number.isFinite(height) || height < 0) {
        return null
    }
    return { visible, height }
}

function onHostMessage(event: HostMessageEvent): void {
    if (typeof event?.data !== 'string') {
        return
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(event.data)
    } catch {
        return
    }
    if (typeof parsed !== 'object' || parsed === null) {
        return
    }
    const reply = parsed as Record<string, unknown>
    if (reply.event === 'gestureInset') {
        const value = reply.value
        if (typeof value === 'number' && Number.isFinite(value)) {
            cachedInset = value
        }
        return
    }
    if (reply.event === 'ime') {
        const state = readImeState(reply.visible, reply.height)
        if (state) {
            cachedIme = state
            for (const listener of [...imeListeners]) {
                listener(state)
            }
        }
        return
    }
    if (typeof reply.id !== 'number') {
        return
    }
    const entry = pending.find((candidate) => reply.id === candidate.id)
    if (!entry) {
        return
    }
    pending = pending.filter((candidate) => candidate !== entry)
    const through = typeof reply.through === 'number' && Number.isInteger(reply.through) && reply.through > 0 ? reply.through : 0
    entry.resolve({ raw: JSON.stringify(Array.isArray(reply.result) ? reply.result : []), through })
}

function attach(channel: HostChannel): () => void {
    if (typeof channel.addEventListener === 'function') {
        channel.addEventListener('message', onHostMessage)
        return () => {
            channel.removeEventListener?.('message', onHostMessage)
        }
    }
    channel.onmessage = onHostMessage
    return () => {
        if (channel.onmessage === onHostMessage) {
            channel.onmessage = null
        }
    }
}

/** Lets go of the current channel; a take still waiting on it resolves empty. */
function release(): void {
    if (bound === null) {
        return
    }
    const stale = pending
    pending = []
    detachBound?.()
    bound = null
    detachBound = null
    cachedInset = 0
    cachedIme = null
    for (const entry of stale) {
        entry.resolve(null)
    }
}

/**
 * The channel when the host injected one, bound on first sight: its listener is attached, the
 * host is asked for the gesture inset, and the cached inset starts at 0. A different channel
 * object replaces the old binding. Null when there is no channel, and the caller then uses the
 * separate host object.
 */
function bind(): HostChannel | null {
    if (typeof window === 'undefined') {
        return null
    }
    const channel = window.__risuTaniumHost
    if (typeof channel?.postMessage === 'function') {
        if (channel !== bound) {
            release()
            bound = channel
            detachBound = attach(channel)
            cachedInset = 0
            cachedIme = null
            try {
                send(channel, { bridge: 'gestureInset', method: 'subscribe', args: [] })
            } catch {
                // The inset stays 0 until the host pushes one.
            }
            try {
                send(channel, { bridge: 'ime', method: 'subscribe', args: [] })
            } catch {
                // The keyboard state stays unknown until the host pushes one.
            }
        }
        return channel
    }
    release()
    return null
}

/** Binds the channel now, so the host starts pushing the gesture inset before the first read. */
export function connectHostBridge(): void {
    bind()
}

export function systemBarsHost(): Window['__risuTaniumSystemBars'] {
    const channel = bind()
    const legacy = window.__risuTaniumSystemBars
    if (channel) {
        return {
            setBackground: (red: number, green: number, blue: number) => {
                send(channel, { bridge: 'systemBars', method: 'setBackground', args: [red, green, blue] })
            },
        }
    }
    return legacy
}

/** The keep-alive host: over the channel, which carries contract v2 as well, else the separate object (which has v2 methods only when the host does). */
export function keepAliveHost(): KeepAliveHostObject | undefined {
    const channel = bind()
    const legacy = window.__risuTaniumKeepAlive
    if (channel) {
        const call = (method: string, args: unknown[]): void => {
            send(channel, { bridge: 'keepAlive', method, args })
        }
        return {
            start: (title: string, stopLabel: string) => call('start', [title, stopLabel]),
            update: (title: string, stopLabel: string) => call('update', [title, stopLabel]),
            stop: () => call('stop', []),
            stopAfter: (ms: number) => call('stopAfter', [ms]),
            requestNotificationPermissionOnce: () => call('requestNotificationPermissionOnce', []),
            startState: (json: string) => call('startState', [json]),
            updateState: (json: string) => call('updateState', [json]),
            stopAfterWithOutcome: (ms: number, json: string) => call('stopAfterWithOutcome', [ms, json]),
            requestOpenTarget: () => call('requestOpenTarget', []),
        }
    }
    return legacy
}

/** The reply-notification bridge: over the channel when the host injected one, else the separate object (undefined when the host has none). */
export function replyNotificationsHost(): Partial<ReplyNotificationsHost> | undefined {
    const channel = bind()
    const legacy = window.__risuTaniumReplyNotificationsHost
    if (channel) {
        const call = (method: string, args: unknown[]): void => {
            send(channel, { bridge: 'replyNotifications', method, args })
        }
        return {
            refresh: () => call('refresh', []),
            enable: () => call('enable', []),
            disable: () => call('disable', []),
            notify: (key: string, title: string, body: string, silent: boolean) => call('notify', [key, title, body, silent]),
            notifyState: (json: string) => call('notifyState', [json]),
            cancel: (key: string) => call('cancel', [key]),
        }
    }
    return legacy
}

/** The host's left gesture inset as last pushed (0 before the first push), or the separate object's answer. The caller sanitises it. */
export function gestureInsetLeft(): unknown {
    const channel = bind()
    const legacy = window.__risuTaniumGestureInset
    if (channel) {
        return cachedInset
    }
    if (!legacy || typeof legacy.left !== 'function') {
        return 0
    }
    // Called as a method: the host bridge object needs its receiver.
    return legacy.left()
}

/** The separate object's answer as a state, or null when it is absent or answers with something else. */
function readLegacyIme(): ImeState | null {
    const legacy = window.__risuTaniumIme
    if (!legacy || typeof legacy.visible !== 'function' || typeof legacy.height !== 'function') {
        return null
    }
    try {
        // Called as methods: the host bridge object needs its receiver.
        return readImeState(legacy.visible(), legacy.height())
    } catch {
        return null
    }
}

/**
 * The host's keyboard state, or null where the host reports none (the caller then falls back to
 * the browser's viewport). Over the channel `read` is null until the host's first push, which
 * is sent on subscribe. On the separate object `read` asks it each time, and `subscribe` re-reads
 * when the visual viewport resizes: the padding that makes room for the keyboard always resizes
 * the page.
 */
export function hostIme(): HostIme | null {
    const channel = bind()
    if (channel) {
        return {
            read: () => cachedIme,
            subscribe: (listener) => {
                imeListeners.add(listener)
                return () => {
                    imeListeners.delete(listener)
                }
            },
        }
    }
    const legacy = window.__risuTaniumIme
    if (!legacy || typeof legacy.visible !== 'function' || typeof legacy.height !== 'function') {
        return null
    }
    return {
        read: readLegacyIme,
        subscribe: (listener) => {
            const target: EventTarget = window.visualViewport ?? window
            const onResize = (): void => {
                const state = readLegacyIme()
                if (state) {
                    listener(state)
                }
            }
            target.addEventListener('resize', onResize)
            return () => {
                target.removeEventListener('resize', onResize)
            }
        },
    }
}

/** True when the host offers an opened-files queue, through the channel or the separate object. */
export function hasOpenedFilesHost(): boolean {
    return bind() !== null || !!window.__risuTaniumOpenedFilesHost
}

/**
 * Takes the host's opened-files queue. Undefined when there is no queue to take from. A legacy
 * take runs synchronously inside this call and may throw; a channel take resolves with the
 * host's reply, which keeps its batches until `confirm`.
 */
export function openedFilesTake(): Promise<OpenedFilesTake> | undefined {
    const channel = bind()
    const legacy = window.__risuTaniumOpenedFilesHost
    if (channel) {
        const id = nextTakeId++
        return new Promise<OpenedFilesTake>((resolve, reject) => {
            pending.push({
                id,
                resolve: (reply) => {
                    if (reply === null) {
                        resolve({ raw: '[]', held: false, confirm: () => { } })
                        return
                    }
                    resolve({
                        raw: reply.raw,
                        held: true,
                        confirm: () => {
                            if (reply.through <= 0) {
                                return
                            }
                            try {
                                send(channel, { bridge: 'openedFiles', method: 'confirm', args: [reply.through] })
                            } catch (error) {
                                console.warn('Opened files could not be confirmed', error)
                            }
                        },
                    })
                },
            })
            try {
                send(channel, { bridge: 'openedFiles', method: 'take', args: [], id })
            } catch (error) {
                pending = pending.filter((candidate) => candidate.id !== id)
                reject(error)
            }
        })
    }
    if (typeof legacy?.take !== 'function') {
        return undefined
    }
    // Called as a method: the host bridge object needs its receiver.
    const raw: unknown = legacy.take()
    return Promise.resolve({ raw, held: false, confirm: () => { } })
}

bind()
