import type { FetchLike } from '../store/nodeHttpStore'

/**
 * The client of the Node server's store2 change feed (`GET /api/store2-feed?since=`): a long poll that answers when a
 * commit-key write lands or after the server's timeout. It only wakes the page's peer check; it never carries store
 * contents and is never a correctness dependency, so a missing, failing or stopped feed loses nothing but promptness.
 *
 * The feed asks only while the page is visible: a hide ends the held request (no failure, no back-off) and a show sends
 * one immediate probe that is compared with the kept baseline, so a commit made while hidden is one event. A hidden page
 * holds no connection. The first request and every probe carry no `since`, which the server answers at once, so a
 * baseline is never a held answer.
 *
 * The first answer is the baseline and is no event. A later answer is one event when its revision is higher or its
 * server instance differs (a restarted server counts from zero). Every failure, including a refusal, backs off with a
 * doubling wait, and an unchanged answer that arrives at once is paced, so a broken server or proxy is never a hot loop.
 */

export interface NodePeerFeedOptions {
    /** The value of the `risu-auth` header, produced fresh for each request: the byte store's own. */
    authHeader: () => Promise<string>
    /** A commit-key revision change was announced after the baseline. Never called for the first answer. */
    onPeerCommit: () => void
    fetch?: FetchLike
    /** Prepended to the route path; defaults to the page's own origin. */
    baseUrl?: string
    /** Resolves after `ms` or as soon as `signal` aborts; defaults to a timer that is cleared on abort. */
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>
    now?: () => number
    /** Whether the page is shown; defaults to `document.visibilityState` (always visible without a document). */
    visibility?: FeedVisibility
}

export interface FeedVisibility {
    isVisible(): boolean
    /** Calls `onChange` on every visibility change and returns the unsubscribe. */
    subscribe(onChange: () => void): () => void
}

export interface NodePeerFeed {
    stop(): void
    /** True while answers keep arriving: the last request was answered and not longer ago than the live window. */
    isPeerFeedLive(): boolean
}

const BACKOFF_START_MS = 1000
const BACKOFF_MAX_MS = 30_000
/** The shortest time between two requests that came back unchanged. */
const MIN_POLL_GAP_MS = 1000
/** The server answers within about 25 s, so a live feed has an answer well inside this window. */
const LIVE_WINDOW_MS = 60_000

interface FeedAnswer {
    rev: number
    instance: string
}

function answerOf(body: unknown): FeedAnswer | null {
    if (typeof body !== 'object' || body === null || !('rev' in body) || !('instance' in body)) {
        return null
    }
    const { rev, instance } = body
    return typeof rev === 'number' && Number.isSafeInteger(rev) && rev >= 0 && typeof instance === 'string' ? { rev, instance } : null
}

function timerSleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
        if (signal.aborted) {
            resolve()
            return
        }
        const done = () => {
            clearTimeout(timer)
            signal.removeEventListener('abort', done)
            resolve()
        }
        const timer = setTimeout(done, ms)
        signal.addEventListener('abort', done, { once: true })
    })
}

function documentVisibility(): FeedVisibility {
    return {
        isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
        subscribe(onChange) {
            if (typeof document === 'undefined') {
                return () => undefined
            }
            document.addEventListener('visibilitychange', onChange)
            return () => document.removeEventListener('visibilitychange', onChange)
        },
    }
}

export function startNodePeerFeed(options: NodePeerFeedOptions): NodePeerFeed {
    const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init))
    const sleep = options.sleep ?? timerSleep
    const now = options.now ?? Date.now
    const baseUrl = options.baseUrl ?? ''
    const visibility = options.visibility ?? documentVisibility()
    const controller = new AbortController()
    let live = false
    let lastAnswerAt = 0
    // The request in flight, so a hide can end it without ending the feed.
    let current: AbortController | null = null
    // Set by a hide, cleared by the next request: the page may have missed commits, so that request is a probe.
    let wasHidden = false
    let wakeVisible: (() => void) | null = null

    const unsubscribe = visibility.subscribe(() => {
        if (visibility.isVisible()) {
            wakeVisible?.()
            return
        }
        wasHidden = true
        live = false
        current?.abort()
    })

    function untilVisibleOrStopped(): Promise<void> {
        if (controller.signal.aborted || visibility.isVisible()) {
            return Promise.resolve()
        }
        return new Promise<void>((resolve) => {
            const done = () => {
                wakeVisible = null
                controller.signal.removeEventListener('abort', done)
                resolve()
            }
            wakeVisible = done
            controller.signal.addEventListener('abort', done, { once: true })
        })
    }

    /** A null `since` is the baseline form: the server answers it at once with its current revision. */
    async function ask(since: number | null, signal: AbortSignal): Promise<FeedAnswer> {
        const auth = await options.authHeader()
        const response = await doFetch(since === null ? `${baseUrl}/api/store2-feed` : `${baseUrl}/api/store2-feed?since=${since}`, {
            method: 'GET',
            cache: 'no-store',
            headers: { 'risu-auth': auth },
            signal,
        })
        if (!response.ok) {
            await response.body?.cancel().catch(() => undefined)
            throw new Error(`The store2 change feed answered ${response.status}.`)
        }
        const body: unknown = await response.json()
        const answer = answerOf(body)
        if (answer === null) {
            throw new Error('The store2 change feed answered a body of an unknown shape.')
        }
        return answer
    }

    function announce(): void {
        try {
            options.onPeerCommit()
        } catch (error) {
            console.error(error)
        }
    }

    async function run(): Promise<void> {
        let baseline: FeedAnswer | null = null
        let failures = 0
        while (!controller.signal.aborted) {
            await untilVisibleOrStopped()
            if (controller.signal.aborted) {
                return
            }
            const startedAt = now()
            const probing = wasHidden
            wasHidden = false
            const request = new AbortController()
            const abortRequest = () => request.abort()
            controller.signal.addEventListener('abort', abortRequest, { once: true })
            current = request
            let answer: FeedAnswer
            try {
                answer = await ask(probing ? null : baseline?.rev ?? null, request.signal)
            } catch {
                if (controller.signal.aborted) {
                    return
                }
                live = false
                if (request.signal.aborted) {
                    // A hide ended the request: no failure, no back-off; the loop waits for the page to be shown.
                    continue
                }
                failures += 1
                await sleep(Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** (failures - 1)), controller.signal)
                continue
            } finally {
                controller.signal.removeEventListener('abort', abortRequest)
                if (current === request) {
                    current = null
                }
            }
            failures = 0
            live = true
            lastAnswerAt = now()
            const previous = baseline
            baseline = answer
            if (previous === null) {
                continue
            }
            if (answer.instance !== previous.instance || answer.rev > previous.rev) {
                announce()
                continue
            }
            if (probing) {
                continue
            }
            const elapsed = now() - startedAt
            if (elapsed < MIN_POLL_GAP_MS) {
                await sleep(MIN_POLL_GAP_MS - elapsed, controller.signal)
            }
        }
    }

    void run()
    return {
        stop() {
            live = false
            unsubscribe()
            controller.abort()
        },
        isPeerFeedLive: () => live && now() - lastAnswerAt <= LIVE_WINDOW_MS,
    }
}

/**
 * The callback the save loop's page installs: it sets the flag the broadcast path sets (the loop's next turn then runs its
 * peer check) and ends the loop's idle wait so that turn comes at once. It counts no save, marks nothing dirty and takes
 * no idle-net slot.
 */
export function peerCommitWake(markPeerHeard: () => void, wakeIdle: () => void): () => void {
    return () => {
        markPeerHeard()
        wakeIdle()
    }
}
