/**
 * Work the page is doing right now that must not be cut off by the page going
 * to the background: a reply, speech, an image, a translation, an embedding, a
 * request, or a data action. The registry only records what is in flight and
 * tells subscribers when that changes; it holds no persistent state.
 *
 * A unit of work begins a token and ends it in a `finally`. A token that is
 * ended by an event (audio `onended`, a speech `onend`, a busy entry's end)
 * carries a max age, so an event that never fires cannot hold the page forever;
 * a token ended by a `finally` carries none.
 *
 * Leaf module: it imports nothing from the chat pipeline so any unit may use it.
 */

/**
 * 'save' is a finished reply whose save has not yet landed while the page is hidden; it keeps the
 * process alive but is not work the user can stop.
 */
export type InFlightKind = 'chat' | 'tts' | 'image' | 'request' | 'translate' | 'embed' | 'busy' | 'save'

/** The chat a unit of work belongs to: the owner (a group by its own id) and the chat. Never the speaking member. */
export interface InFlightTarget {
    chaId: string
    chatId: string
}

/** How a chat unit ended, as the reply classification reports it. */
export type InFlightOutcome = 'reply' | 'failed' | 'stopped' | 'none'

/** What the last chat to end says about the run: only a stop or a failure is recorded. */
export interface RunOutcome {
    outcome: 'stopped' | 'failed'
    target: InFlightTarget | null
}

interface InFlightEntry {
    readonly kind: InFlightKind
    readonly startedAt: number
    readonly target: InFlightTarget | null
    timer: ReturnType<typeof setTimeout> | null
}

const entries = new Set<InFlightEntry>()
const listeners = new Set<() => void>()

// Set by a chat end, before the subscribers hear of it; reset by every begin of a kind other than
// 'save' (a hidden reply's save begins after its chat ended and must not erase the outcome), and
// consumed by `takeRunOutcome`, so it never outlives the all-ended sync that reads it.
let runOutcome: RunOutcome | null = null

function notify(): void {
    for (const listener of [...listeners]) {
        try {
            listener()
        } catch (error) {
            console.error('in-flight work subscriber failed', error)
        }
    }
}

/**
 * Registers one unit of work of `kind` and returns the function that ends it.
 * Ending is idempotent. With `maxAgeMs` the token ends itself (and logs) once
 * that time has passed. A chat token may carry its `target`, of which only the
 * owner's id and the chat's id are kept. Ending a chat token with an outcome
 * records a stop or a failure as the run outcome; any other end of a chat
 * clears it, so the last chat to end describes the run.
 */
export function beginInFlight(
    kind: InFlightKind,
    options: { maxAgeMs?: number, target?: InFlightTarget } = {},
): (outcome?: InFlightOutcome) => void {
    const target = kind === 'chat' && options.target
        ? { chaId: options.target.chaId, chatId: options.target.chatId }
        : null
    const entry: InFlightEntry = { kind, startedAt: Date.now(), target, timer: null }
    if (kind !== 'save') {
        runOutcome = null
    }
    entries.add(entry)
    const end = (outcome?: InFlightOutcome): void => {
        if (!entries.delete(entry)) {
            return
        }
        if (entry.timer !== null) {
            clearTimeout(entry.timer)
            entry.timer = null
        }
        if (kind === 'chat') {
            runOutcome = outcome === 'stopped' || outcome === 'failed'
                ? { outcome, target: entry.target }
                : null
        }
        notify()
    }
    if (options.maxAgeMs !== undefined) {
        entry.timer = setTimeout(() => {
            entry.timer = null
            if (entries.has(entry)) {
                console.warn(`in-flight ${kind} work outlived its max age and was released`)
                end()
            }
        }, options.maxAgeMs)
    }
    notify()
    return end
}

/** The kinds that have at least one token, in first-begun order. */
export function inFlightKinds(): InFlightKind[] {
    const kinds: InFlightKind[] = []
    for (const entry of entries) {
        if (!kinds.includes(entry.kind)) {
            kinds.push(entry.kind)
        }
    }
    return kinds
}

/** When the earliest live token of `kind` began, in epoch milliseconds; null when none is live. */
export function inFlightSince(kind: InFlightKind): number | null {
    let earliest: number | null = null
    for (const entry of entries) {
        if (entry.kind === kind && (earliest === null || entry.startedAt < earliest)) {
            earliest = entry.startedAt
        }
    }
    return earliest
}

/** The target of the latest-begun live chat token that carries one, or null. */
export function inFlightChatTarget(): InFlightTarget | null {
    let latest: InFlightTarget | null = null
    for (const entry of entries) {
        if (entry.kind === 'chat' && entry.target) {
            latest = { chaId: entry.target.chaId, chatId: entry.target.chatId }
        }
    }
    return latest
}

/** The run outcome, once: reading it clears it. */
export function takeRunOutcome(): RunOutcome | null {
    const taken = runOutcome
    runOutcome = null
    return taken
}

/** Calls `callback` after every begin and end; the returned function unsubscribes. */
export function subscribeInFlight(callback: () => void): () => void {
    listeners.add(callback)
    return () => {
        listeners.delete(callback)
    }
}

/** Runs `work` under a token of `kind`; the token ends however `work` settles. */
export async function withInFlight<T>(kind: InFlightKind, work: () => Promise<T>): Promise<T> {
    const end = beginInFlight(kind)
    try {
        return await work()
    } finally {
        end()
    }
}

export function resetInFlightForTest(): void {
    for (const entry of entries) {
        if (entry.timer !== null) {
            clearTimeout(entry.timer)
        }
    }
    entries.clear()
    listeners.clear()
    runOutcome = null
}
