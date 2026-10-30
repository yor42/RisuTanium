/**
 * Page side of the Android host channel. When the host injects one message object into the
 * app's main frame, the system-bar, gesture-inset, keep-alive and opened-files bridges all go
 * through it as JSON strings; otherwise each caller gets the separate host object it used
 * before, unchanged. Every export prefers the channel, so a caller never touches both.
 *
 * Messages to the host: `{bridge, method, args}` plus an `id` on a take. Messages from the
 * host: `{event:'gestureInset', value}` and `{id, result, through}` for a take. The host
 * ignores a message it does not understand, so a bad value never throws here either.
 */
import type { KeepAliveHost } from './keepAliveService'

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
let nextTakeId = 1
let pending: PendingTake[] = []

function send(channel: HostChannel, message: { bridge: string; method: string; args: unknown[]; id?: number }): void {
    // Called as a method: the host object needs its receiver.
    channel.postMessage(JSON.stringify(message))
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
            try {
                send(channel, { bridge: 'gestureInset', method: 'subscribe', args: [] })
            } catch {
                // The inset stays 0 until the host pushes one.
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

export function keepAliveHost(): Partial<KeepAliveHost> | undefined {
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
