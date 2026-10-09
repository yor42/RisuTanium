/**
 * Page side of the Android keep-alive foreground service. The service keeps the
 * app process alive while work is in flight (a reply, speech, an image, a
 * translation, an import or export); this module mirrors the in-flight
 * registry onto the host bridge and delivers the notification's Stop action to
 * the running work. Everywhere the bridge is absent (web, desktop, iOS, an old
 * host) it does nothing.
 */
import { language } from 'src/lang'
import { inFlightKinds, subscribeInFlight, type InFlightKind } from '../process/inFlightWork'
import { isAndroidTransport } from '../storage/tauriByteTransport'

/** The host object `KeepAliveBridge` exposes to the page. */
export interface KeepAliveHost {
    start(title: string, stopLabel: string): unknown
    update(title: string, stopLabel: string): unknown
    stop(): unknown
    requestNotificationPermissionOnce(): unknown
}

declare global {
    interface Window {
        /** Android host: the keep-alive service bridge. Absent elsewhere. */
        __risuTaniumKeepAlive?: Partial<KeepAliveHost>
        /** Called by the host when the notification's Stop action is tapped. */
        __risuTaniumKeepAliveStop?: () => void
        /** Called by the host when the system ended the service on its time limit. */
        __risuTaniumKeepAliveTimeout?: () => void
    }
}

/**
 * How long the service outlives the last work. Short gaps between units of
 * work (auto mode, a reply followed by speech) keep one service and one
 * notification instead of flapping.
 */
export const KEEP_ALIVE_LINGER_MS = 2000

export interface KeepAliveLabels {
    generating: string
    working: string
    stop: string
}

export interface KeepAliveDeps {
    host: Partial<KeepAliveHost>
    kinds: () => InFlightKind[]
    subscribe: (callback: () => void) => () => void
    labels: () => KeepAliveLabels
    /** Aborts the reply being generated and the speech being played. */
    stopWork: () => void
    lingerMs?: number
}

export interface KeepAliveConsumer {
    /** Detaches from the registry and the window hooks; does not stop the service. */
    dispose(): void
}

interface Notice {
    title: string
    stopLabel: string
}

/** A missing method is skipped and a failing call is logged: neither may break the work that triggered it. */
function callHost<K extends keyof KeepAliveHost>(host: Partial<KeepAliveHost>, method: K, ...args: Parameters<KeepAliveHost[K]>): void {
    try {
        const call = host[method] as ((...callArgs: Parameters<KeepAliveHost[K]>) => unknown) | undefined
        // Called as a method: the host bridge object needs its receiver.
        call?.apply(host, args)
    } catch (error) {
        console.error('keep-alive host call failed', error)
    }
}

function noticeFor(kinds: InFlightKind[], labels: KeepAliveLabels): Notice {
    const chat = kinds.includes('chat')
    const stoppable = chat || kinds.includes('tts')
    return {
        title: chat ? labels.generating : labels.working,
        stopLabel: stoppable ? labels.stop : '',
    }
}

export function createKeepAliveConsumer(deps: KeepAliveDeps): KeepAliveConsumer {
    const { host } = deps
    const lingerMs = deps.lingerMs ?? KEEP_ALIVE_LINGER_MS
    let running = false
    let shown: Notice | null = null
    let lingerTimer: ReturnType<typeof setTimeout> | null = null

    const cancelLinger = (): void => {
        if (lingerTimer !== null) {
            clearTimeout(lingerTimer)
            lingerTimer = null
        }
    }

    const stopService = (): void => {
        cancelLinger()
        running = false
        shown = null
        callHost(host, 'stop')
    }

    const sync = (): void => {
        const kinds = deps.kinds()
        if (kinds.length === 0) {
            if (running && lingerTimer === null) {
                lingerTimer = setTimeout(stopService, lingerMs)
            }
            return
        }
        // A begin during the linger cancels it before anything else is decided.
        cancelLinger()
        const notice = noticeFor(kinds, deps.labels())
        if (!running) {
            running = true
            shown = notice
            callHost(host, 'requestNotificationPermissionOnce')
            callHost(host, 'start', notice.title, notice.stopLabel)
            return
        }
        if (shown === null || shown.title !== notice.title || shown.stopLabel !== notice.stopLabel) {
            shown = notice
            callHost(host, 'update', notice.title, notice.stopLabel)
        }
    }

    const unsubscribe = deps.subscribe(sync)

    const stopHook = (): void => {
        const kinds = deps.kinds()
        if (kinds.includes('chat') || kinds.includes('tts')) {
            deps.stopWork()
            return
        }
        stopService()
    }
    const timeoutHook = (): void => {
        // The host already ended the service; the next unit of work starts it again.
        cancelLinger()
        running = false
        shown = null
    }
    window.__risuTaniumKeepAliveStop = stopHook
    window.__risuTaniumKeepAliveTimeout = timeoutHook

    // A recreated page finds a service its predecessor started: it is stopped
    // when nothing is in flight, and kept (re-announced) when work is.
    if (deps.kinds().length === 0) {
        callHost(host, 'stop')
    } else {
        sync()
    }

    return {
        dispose() {
            unsubscribe()
            cancelLinger()
            if (window.__risuTaniumKeepAliveStop === stopHook) {
                delete window.__risuTaniumKeepAliveStop
            }
            if (window.__risuTaniumKeepAliveTimeout === timeoutHook) {
                delete window.__risuTaniumKeepAliveTimeout
            }
        },
    }
}

/**
 * Starts the consumer in the Android app. A no-op where the host bridge is
 * absent. The work-stopping modules load only when Stop is delivered.
 */
export function startKeepAliveService(): KeepAliveConsumer | null {
    if (!isAndroidTransport()) {
        return null
    }
    const host = window.__risuTaniumKeepAlive
    if (!host) {
        return null
    }
    return createKeepAliveConsumer({
        host,
        kinds: inFlightKinds,
        subscribe: subscribeInFlight,
        labels: () => ({
            generating: language.keepAliveGenerating,
            working: language.keepAliveWorking,
            stop: language.keepAliveStop,
        }),
        stopWork: () => {
            void Promise.all([
                import('../process/composerActions.svelte'),
                import('../process/tts'),
            ]).then(([composer, tts]) => {
                composer.abortChat()
                tts.stopTTS()
            }).catch((error) => {
                console.error('keep-alive stop failed', error)
            })
        },
    })
}
