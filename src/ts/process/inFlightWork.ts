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

/**
 * What the chats that ended say about the run: only a stop or a failure is recorded. With one bad chat
 * `target` names it; with several `target` is null and `count` is how many (see `takeRunOutcome`).
 */
export interface RunOutcome {
    outcome: 'stopped' | 'failed'
    target: InFlightTarget | null
    count: number
}

/** The recorded end of one chat: only a stop or a failure. */
interface ChatEnd {
    outcome: 'stopped' | 'failed'
    target: InFlightTarget | null
}

interface InFlightEntry {
    readonly kind: InFlightKind
    readonly startedAt: number
    readonly target: InFlightTarget | null
    /** The chat's identity in the outcome map: its target, or a key of its own when it has none. */
    readonly key: string
    timer: ReturnType<typeof setTimeout> | null
}

const entries = new Set<InFlightEntry>()
const listeners = new Set<() => void>()

// One stop or failure per chat, set by a chat end before the subscribers hear of it. A chat's own next
// begin replaces its entry, so another chat's end or another kind's begin never erases it. A begin of
// a kind other than 'save' (a hidden reply's save begins after its chat ended and must not erase the
// outcome) clears the map only when nothing is live, which starts a new run and bounds the map where
// no consumer takes it. `takeRunOutcome` consumes it, so it never outlives the all-ended sync.
const chatEnds = new Map<string, ChatEnd>()
let untargetedCounter = 0

function chatKey(target: InFlightTarget | null): string {
    return target === null ? `\u0000token:${untargetedCounter++}` : `${target.chaId}\u0000${target.chatId}`
}

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
 * records a stop or a failure for its chat; any other end of a chat clears
 * only that chat's record, so every chat that ended badly stays in the run outcome.
 */
export function beginInFlight(
    kind: InFlightKind,
    options: { maxAgeMs?: number, target?: InFlightTarget } = {},
): (outcome?: InFlightOutcome) => void {
    const target = kind === 'chat' && options.target
        ? { chaId: options.target.chaId, chatId: options.target.chatId }
        : null
    const entry: InFlightEntry = { kind, startedAt: Date.now(), target, key: chatKey(target), timer: null }
    if (kind !== 'save' && entries.size === 0) {
        chatEnds.clear()
    }
    if (kind === 'chat') {
        chatEnds.delete(entry.key)
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
            if (outcome === 'stopped' || outcome === 'failed') {
                chatEnds.set(entry.key, { outcome, target: entry.target })
            } else {
                chatEnds.delete(entry.key)
            }
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

/** How many chats are live: distinct targets, with a token that has no target counting as one of its own. */
export function inFlightChatCount(): number {
    const keys = new Set<string>()
    for (const entry of entries) {
        if (entry.kind === 'chat') {
            keys.add(entry.key)
        }
    }
    return keys.size
}

/**
 * The run outcome, once: reading it clears it. Failed chats outrank stopped ones. One failed chat is
 * reported by itself, whatever else stopped; several failed give a count of the failed ones. With none
 * failed, one stopped chat is named and several give a count.
 */
export function takeRunOutcome(): RunOutcome | null {
    const ends = [...chatEnds.values()]
    chatEnds.clear()
    const failed = ends.filter((end) => end.outcome === 'failed')
    const bad = failed.length > 0 ? failed : ends
    if (bad.length === 0) {
        return null
    }
    return {
        outcome: bad[0].outcome,
        target: bad.length === 1 ? bad[0].target : null,
        count: bad.length,
    }
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
    chatEnds.clear()
}
