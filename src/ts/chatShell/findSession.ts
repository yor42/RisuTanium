// The in-chat search session: one query's scan, its hits and the position inside them. Pure TypeScript with injected timers, scan
// scheduler and clock: no Svelte, no DB, no DOM. The caller owns reactivity (`onChange`), the jump itself (`onShow`) and the messages.
import type { Message } from '../storage/database.svelte'
import {
    SCAN_BUDGET_MS, createSearchScan, dayBoundsOf, normalizeQuery, sliceMaxFor,
    type SearchFilters, type SearchHit,
} from './inChatSearch'
import type { JumpStatus } from './jumpTarget'

export const AUTO_SHOW_MS = 150

export type FindTimerHandle = number

export interface FindSessionParams {
    // The chat's message count and the message at an index; read at scan and show time, never kept.
    count(): number
    // Whether the first message (index -1) is searched, after every message in the array.
    includeFirst: boolean
    messageAt(index: number): Message
    // The first message's raw text. It is not part of the message array, so its identity is its text.
    firstText(): string
    // The normalised text at `index` (-1 is the first message) for the given thinking flag.
    textAt(index: number, thinking: boolean): string
    passes(index: number, filters: SearchFilters): boolean
    // Whether the hit's message still matches the query and the filters as it reads now.
    stillMatches(hit: SearchHit, query: string, filters: SearchFilters): boolean
    lowPower(): boolean
    schedule?: (run: () => void) => void
    now?: () => number
    setTimer?: (run: () => void, ms: number) => FindTimerHandle
    clearTimer?: (handle: FindTimerHandle) => void
    // Shows a hit: `index` is the message index, -1 for the first message. The status says what the jump did.
    onShow(hit: SearchHit, index: number): Promise<JumpStatus>
    // State changed; read `state`.
    onChange(): void
}

export interface FindSessionState {
    // The normalised query; '' means no search.
    query: string
    // Newest first: position 0 is the newest hit.
    hits: readonly SearchHit[]
    // The position of the hit shown last, or null when there is none or it was lost by a restart.
    current: number | null
    // The current hit was requested and the jump has not been done: the next step re-shows it.
    unshown: boolean
    // The message index of the hit shown last; it survives a lost current so the next step continues from that place.
    anchorIndex: number | null
    complete: boolean
    filters: SearchFilters
}

export interface FindSession {
    readonly state: FindSessionState
    setQuery(raw: string, options?: { composing?: boolean }): void
    // IME composition: while on, input never arms the auto-show; turning it off re-arms it.
    setComposing(on: boolean): void
    setFilters(patch: Partial<SearchFilters>): void
    clearFilters(): void
    step(direction: 1 | -1): void
    show(position: number): Promise<void>
    // Rescans with the same query and filters, keeps the current hit by reference and never shows or auto-shows.
    restart(): void
    dispose(): void
}

export const DEFAULT_FILTERS: SearchFilters = { speaker: 'any', hasImage: false, thinking: false, from: '', to: '' }

export function createFindSession(params: FindSessionParams): FindSession {
    const now = params.now ?? (() => performance.now())
    const setTimer = params.setTimer ?? ((run, ms) => window.setTimeout(run, ms))
    const clearTimer = params.clearTimer ?? ((handle) => { window.clearTimeout(handle) })

    let query = ''
    let hits: readonly SearchHit[] = []
    let complete = true
    let filters: SearchFilters = { ...DEFAULT_FILTERS }
    let current: number | null = null
    // The hit shown last by reference. It outlives a restart so a late jump result still lands on it.
    let currentHit: SearchHit | null = null
    let restartTarget: SearchHit | null = null
    let unshown = false
    let anchorIndex: number | null = null

    let cancelScan: (() => void) | null = null
    let scanId = 0
    // The first message's text when the current scan was created; a hit at index -1 is valid only while it is unchanged.
    let scanFirst = ''

    // Bumped by show, setQuery, the filter calls and dispose; a jump result applies only while its token is the latest.
    let showSeq = 0
    let disposed = false

    let composing = false
    let pendingAuto = false
    let lastInput = 0
    let timer: FindTimerHandle | null = null

    function clearAuto(): void {
        if (timer !== null) {
            clearTimer(timer)
            timer = null
        }
    }

    function armAuto(): void {
        if (!pendingAuto || composing || timer !== null || hits.length === 0) return
        const wait = Math.max(0, AUTO_SHOW_MS - (now() - lastInput))
        timer = setTimer(onAutoTimer, wait)
    }

    function onAutoTimer(): void {
        timer = null
        if (disposed || composing || !pendingAuto || hits.length === 0) return
        pendingAuto = false
        void show(0)
    }

    function isRestartTarget(hit: SearchHit, target: SearchHit): boolean {
        if (target.message === null) return hit.index === -1 && target.index === -1
        return hit.message === target.message
    }

    function repointCurrent(): void {
        const target = restartTarget
        if (target === null) return
        const found = hits.findIndex((hit) => isRestartTarget(hit, target))
        if (found >= 0) {
            current = found
            currentHit = hits[found]
            anchorIndex = hits[found].index
            restartTarget = null
        }
        else if (complete) {
            restartTarget = null
            currentHit = null
            unshown = false
        }
    }

    function startScan(): void {
        cancelScan?.()
        const id = ++scanId
        scanFirst = params.firstText()
        const scanFilters = filters
        const bounds = dayBoundsOf(scanFilters.from, scanFilters.to)
        cancelScan = createSearchScan({
            count: params.count(),
            includeFirst: params.includeFirst,
            messageAt: params.messageAt,
            textAt: (index) => params.textAt(index, scanFilters.thinking),
            passes: (index) => params.passes(index, scanFilters),
            query,
            sliceMax: sliceMaxFor(params.lowPower()),
            budgetMs: SCAN_BUDGET_MS,
            now: params.now,
            schedule: params.schedule,
            onProgress(found, done) {
                if (disposed || id !== scanId) return
                hits = found
                complete = done
                repointCurrent()
                armAuto()
                params.onChange()
            },
        })
    }

    // A new query or new filters: everything about the old search is dropped, including the anchor.
    function beginSearch(): void {
        showSeq++
        clearAuto()
        hits = []
        complete = false
        current = null
        currentHit = null
        restartTarget = null
        unshown = false
        anchorIndex = null
        startScan()
        params.onChange()
    }

    function stillValid(hit: SearchHit): boolean {
        if (hit.index < 0) {
            if (params.firstText() !== scanFirst) return false
        }
        else if (hit.index >= params.count() || params.messageAt(hit.index) !== hit.message) return false
        return params.stillMatches(hit, query, filters)
    }

    function show(position: number): Promise<void> {
        if (disposed || !Number.isInteger(position) || position < 0 || position >= hits.length) return Promise.resolve()
        const hit = hits[position]
        clearAuto()
        pendingAuto = false
        if (!stillValid(hit)) {
            restart()
            return Promise.resolve()
        }
        current = position
        currentHit = hit
        restartTarget = null
        anchorIndex = hit.index
        unshown = true
        const token = ++showSeq
        params.onChange()
        let requested: Promise<JumpStatus>
        try {
            requested = params.onShow(hit, hit.index)
        }
        catch {
            requested = Promise.resolve('cancelled')
        }
        return requested.catch((): JumpStatus => 'cancelled').then((status) => {
            if (disposed || token !== showSeq || currentHit === null) return
            if (status === 'done' || status === 'blocked' || status === 'outOfRange') {
                unshown = false
                params.onChange()
            }
        })
    }

    function nextPosition(direction: 1 | -1): number | null {
        if (current === null) {
            if (anchorIndex === null) return direction > 0 ? 0 : hits.length - 1
            const anchor = anchorIndex
            if (direction > 0) {
                const below = hits.findIndex((hit) => hit.index < anchor)
                if (below >= 0) return below
                return complete ? 0 : null
            }
            for (let k = hits.length - 1; k >= 0; k--) {
                if (hits[k].index > anchor) return k
            }
            return hits.length - 1
        }
        const target = current + direction
        if (target < 0) return hits.length - 1
        if (target >= hits.length) {
            if (complete) return 0
            return hits.length === 1 ? current : null
        }
        return target
    }

    function step(direction: 1 | -1): void {
        if (disposed || hits.length === 0) return
        if (unshown && current !== null) {
            void show(current)
            return
        }
        const position = nextPosition(direction)
        if (position !== null) void show(position)
    }

    function restart(): void {
        if (disposed) return
        clearAuto()
        pendingAuto = false
        restartTarget = currentHit
        current = null
        hits = []
        complete = false
        startScan()
        params.onChange()
    }

    return {
        get state(): FindSessionState {
            return { query, hits, current, unshown, anchorIndex, complete, filters }
        },
        setQuery(raw, options) {
            if (disposed) return
            query = normalizeQuery(raw)
            composing = options?.composing ?? false
            if (!composing) lastInput = now()
            pendingAuto = query !== ''
            beginSearch()
        },
        setComposing(on) {
            if (disposed) return
            composing = on
            if (!on) {
                lastInput = now()
                clearAuto()
                armAuto()
            }
        },
        setFilters(patch) {
            if (disposed) return
            filters = { ...filters, ...patch }
            lastInput = now()
            pendingAuto = query !== ''
            beginSearch()
        },
        clearFilters() {
            if (disposed) return
            filters = { ...DEFAULT_FILTERS }
            lastInput = now()
            pendingAuto = query !== ''
            beginSearch()
        },
        step,
        show,
        restart,
        dispose() {
            if (disposed) return
            disposed = true
            showSeq++
            cancelScan?.()
            cancelScan = null
            clearAuto()
        },
    }
}

// ---- the fingerprint that tells the shell the chat changed under a scan

export interface SearchFingerprint {
    array: object
    length: number
    // The last message's text length, null while a reply streams so streamed chunks never restart the scan.
    lastLength: number | null
    firstText: string
}

export function searchFingerprint(input: { messages: readonly Pick<Message, 'data'>[], streaming: boolean, firstText: string }): SearchFingerprint {
    const { messages } = input
    const last = messages.length > 0 ? messages[messages.length - 1].data.length : 0
    return { array: messages, length: messages.length, lastLength: input.streaming ? null : last, firstText: input.firstText }
}

export function sameFingerprint(a: SearchFingerprint, b: SearchFingerprint): boolean {
    return a.array === b.array && a.length === b.length && a.lastLength === b.lastLength && a.firstText === b.firstText
}
