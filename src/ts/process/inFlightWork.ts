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

export type InFlightKind = 'chat' | 'tts' | 'image' | 'request' | 'translate' | 'embed' | 'busy'

interface InFlightEntry {
    readonly kind: InFlightKind
    timer: ReturnType<typeof setTimeout> | null
}

const entries = new Set<InFlightEntry>()
const listeners = new Set<() => void>()

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
 * that time has passed.
 */
export function beginInFlight(kind: InFlightKind, options: { maxAgeMs?: number } = {}): () => void {
    const entry: InFlightEntry = { kind, timer: null }
    entries.add(entry)
    const end = (): void => {
        if (!entries.delete(entry)) {
            return
        }
        if (entry.timer !== null) {
            clearTimeout(entry.timer)
            entry.timer = null
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
}
