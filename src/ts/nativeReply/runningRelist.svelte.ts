import { requestReconcile } from './pageState'

/**
 * Bounded re-list while the shown chat waits on a native reply. A reply that fails before its response head leaves a
 * terminal record and sends the page no event, so after a reload the running entry that blocks Send stays until some pass
 * runs. The component that renders the blocked Send calls `relistWhileNativeBlocked`; while it holds, the scheduler asks for
 * a reconcile pass after each gap of `RELIST_DELAYS_MS` (the last gap repeats).
 *
 * Invariants: no hold means no timer and no visibility listener; at most one request is outstanding and no timer is armed
 * while it is; gaps only grow, except on a new hold or on the page becoming visible again; a hidden page arms no timer; a
 * failed request keeps the hold and continues the schedule.
 */

export const RELIST_DELAYS_MS: readonly number[] = [2000, 4000, 8000, 16000, 30000]

export interface RelistDeps {
    request(): Promise<void>
    visible(): boolean
    onVisibilityChange(listener: () => void): () => void
}

export interface RelistScheduler {
    /** Starts or joins the schedule; the returned release is idempotent. */
    hold(): () => void
    /** Drops every hold and timer; for tests. */
    reset(): void
}

export function createRelistScheduler(deps: RelistDeps): RelistScheduler {
    let holds = 0
    let step = 0
    let epoch = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    let inFlight = false
    let unlisten: (() => void) | null = null

    function clearTimer(): void {
        if (timer !== null) {
            clearTimeout(timer)
            timer = null
        }
    }

    function arm(): void {
        if (holds === 0 || timer !== null || inFlight || !deps.visible()) {
            return
        }
        const gap = RELIST_DELAYS_MS[Math.min(step, RELIST_DELAYS_MS.length - 1)]
        timer = setTimeout(() => { void tick() }, gap)
    }

    async function tick(): Promise<void> {
        timer = null
        if (holds === 0 || !deps.visible()) {
            return
        }
        const startedIn = epoch
        inFlight = true
        try {
            await deps.request()
        } catch (error) {
            console.error(error)
        } finally {
            inFlight = false
        }
        if (startedIn === epoch) {
            step += 1
        }
        arm()
    }

    function onVisibility(): void {
        if (deps.visible()) {
            step = 0
            arm()
        } else {
            clearTimer()
        }
    }

    return {
        reset(): void {
            holds = 0
            epoch += 1
            inFlight = false
            clearTimer()
            unlisten?.()
            unlisten = null
        },
        hold(): () => void {
            holds += 1
            if (holds === 1) {
                epoch += 1
                step = 0
                unlisten = deps.onVisibilityChange(onVisibility)
                arm()
            }
            let released = false
            const heldIn = epoch
            return () => {
                if (released || heldIn !== epoch) {
                    return
                }
                released = true
                holds -= 1
                if (holds === 0) {
                    clearTimer()
                    unlisten?.()
                    unlisten = null
                }
            }
        },
    }
}

let singleton: RelistScheduler | null = null

// Lazy so that importing this module never touches `document` (node-environment tests).
function scheduler(): RelistScheduler {
    if (!singleton) {
        const inner = createRelistScheduler({
            request: () => requestReconcile(),
            visible: () => document.visibilityState === 'visible',
            onVisibilityChange: (listener) => {
                document.addEventListener('visibilitychange', listener)
                return () => document.removeEventListener('visibilitychange', listener)
            },
        })
        singleton = inner
    }
    return singleton
}

/**
 * Call during component init. `blocked` returns the shown chat while its Send is refused for a native reply and nothing
 * writes in it, else null. The hold follows the chat identity, so a new origin object for the same chat keeps the schedule.
 */
export function relistWhileNativeBlocked(blocked: () => { chaId: string, chatId: string } | null): void {
    const key = $derived.by(() => {
        const origin = blocked()
        return origin ? `${origin.chaId}\u0000${origin.chatId}` : null
    })
    $effect(() => {
        if (key === null) {
            return
        }
        return scheduler().hold()
    })
}

export function resetRelistForTests(): void {
    singleton?.reset()
    singleton = null
}