/** How long a quiet page may go between two walks of its character list. */
export const LIVE_CHECK_IDLE_INTERVAL_MS = 30_000

/**
 * What the page reads at one `liveCheck` call. The gate compares it with the reading of the last walk; every field
 * is a cheap read, none walks the character list.
 */
export interface LiveCheckSignal {
    /** The database object itself: a replaced object is a changed one. */
    db: object | null | undefined
    /** The character array itself: a replaced array is a changed one. */
    characters: object | null | undefined
    /** The character count; 0 when the list is not an array. */
    length: number
    /** The count of save marks taken so far; a mark moves it. */
    marks: number
    /** Edits wait for a save pass. */
    dirty: boolean
    /** A save pass is due. */
    due: boolean
    /** The last save pass failed, so a bad entry may be the cause and the walk repairs it at the next call. */
    failed: boolean
}

export interface LiveCheckGate {
    /** True when the character list must be walked now. */
    due(signal: LiveCheckSignal, now: number): boolean
    /** Records that the list was walked at `now` with `signal` as the reading. */
    walked(signal: LiveCheckSignal, now: number): void
}

/**
 * Decides when `liveCheck` walks the character list. A page that changed nothing it can see (no new object, array,
 * length or mark, nothing dirty or due, no failed pass) walks once per interval: an in-place write that moves none
 * of those is repaired within one interval. The first call always walks, and so does a clock that moved backwards.
 */
export function createLiveCheckGate(options: { intervalMs?: number } = {}): LiveCheckGate {
    const intervalMs = options.intervalMs ?? LIVE_CHECK_IDLE_INTERVAL_MS
    let last: { signal: LiveCheckSignal, at: number } | null = null
    return {
        due(signal, now) {
            if (last === null) {
                return true
            }
            if (signal.dirty || signal.due || signal.failed) {
                return true
            }
            if (signal.db !== last.signal.db || signal.characters !== last.signal.characters) {
                return true
            }
            if (signal.length !== last.signal.length || signal.marks !== last.signal.marks) {
                return true
            }
            return now < last.at || now - last.at >= intervalMs
        },
        walked(signal, now) {
            last = { signal: { ...signal }, at: now }
        },
    }
}
