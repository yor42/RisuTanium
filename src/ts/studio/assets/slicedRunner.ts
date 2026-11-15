// Runs long, synchronous work in short slices so a large asset list or a hash pass never blocks the page. The
// runner knows nothing about what is walked: callers hand it one unit of work at a time and call `checkpoint()`
// after each. It reads objects in place and never writes, marks or loads anything.

/** A slice yields to the event loop once it has run this long; one unit of work may overshoot it. */
export const SLICE_BUDGET_MS = 8

/** A string longer than this is scanned in windows (see `textWindows`). */
export const WINDOWED_SCAN_MIN_CHARS = 256 * 1024

export interface SlicedRunnerOptions {
    /** One signal per job: closing the finder, an owner change or an applied edit aborts it. */
    signal?: AbortSignal
    /** The clock slices are measured on; tests inject a simulated one. */
    now?: () => number
    sliceMs?: number
    yieldToLoop?: () => Promise<void>
}

export interface SlicedRunner {
    /**
     * Call after each unit of work. Yields to the event loop once the slice has used its budget. Resolves
     * `false` when the job was aborted: the caller stops, and no further unit runs.
     */
    checkpoint(): Promise<boolean>
    /**
     * Awaits `wait` outside the slice: time spent waiting on a read is not compute and does not count towards
     * the slice, and the next slice starts when the wait ends.
     */
    io<T>(wait: Promise<T>): Promise<T>
    /** `work` for each item in order, checkpointing after each. Resolves `false` when aborted. */
    forEach<T>(items: readonly T[], work: (item: T, index: number) => void): Promise<boolean>
    aborted(): boolean
    /** The longest slice measured so far, in milliseconds of the injected clock. */
    longestSliceMs(): number
}

function yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
}

export function createSlicedRunner(options: SlicedRunnerOptions = {}): SlicedRunner {
    const signal = options.signal
    const now = options.now ?? (() => performance.now())
    const sliceMs = options.sliceMs ?? SLICE_BUDGET_MS
    const yieldToLoop = options.yieldToLoop ?? yieldToEventLoop
    let sliceStart = now()
    let longest = 0

    function elapsed(): number {
        const used = now() - sliceStart
        if (used > longest) {
            longest = used
        }
        return used
    }

    function aborted(): boolean {
        return signal?.aborted === true
    }

    async function checkpoint(): Promise<boolean> {
        if (aborted()) {
            return false
        }
        if (elapsed() < sliceMs) {
            return true
        }
        await yieldToLoop()
        sliceStart = now()
        return !aborted()
    }

    async function io<T>(wait: Promise<T>): Promise<T> {
        elapsed()
        try {
            return await wait
        } finally {
            sliceStart = now()
        }
    }

    async function forEach<T>(items: readonly T[], work: (item: T, index: number) => void): Promise<boolean> {
        for (let index = 0; index < items.length; index++) {
            if (aborted()) {
                return false
            }
            work(items[index], index)
            if (!await checkpoint()) {
                return false
            }
        }
        return true
    }

    return { checkpoint, io, forEach, aborted, longestSliceMs: () => longest }
}

/** One window of a long string. A match that starts in `[ownedFrom, ownedTo)` belongs to this window alone. */
export interface TextWindow {
    start: number
    end: number
    ownedFrom: number
    ownedTo: number
}

/**
 * The windows a string is scanned in. A string of at most `WINDOWED_SCAN_MIN_CHARS` is one window. A longer one is
 * cut into windows of at most that length that overlap by `longestMatch`, the longest match the scan can find, so a
 * match that straddles a cut lies whole inside the window that owns its start. The owned ranges partition the
 * string, so no match is counted twice.
 */
export function* textWindows(
    length: number,
    longestMatch: number,
    windowChars: number = WINDOWED_SCAN_MIN_CHARS,
): Generator<TextWindow, void, undefined> {
    if (length <= windowChars) {
        yield { start: 0, end: length, ownedFrom: 0, ownedTo: length }
        return
    }
    const overlap = Math.min(Math.max(longestMatch, 0), windowChars - 1)
    const owned = windowChars - overlap
    for (let from = 0; from < length; from += owned) {
        const ownedTo = Math.min(length, from + owned)
        yield { start: from, end: Math.min(length, ownedTo + overlap), ownedFrom: from, ownedTo }
    }
}
