import { recordCaughtError } from '../caughtErrors'

/**
 * The app-wide toast and undo host: rune state, timers, admission and queue, undo runs and suspension.
 *
 * It touches no DOM, `window` or storage at import or when called, except `suspendWhile`, which creates a Svelte
 * effect and therefore needs a component or `$effect.root` owner. Holds (hover and focus) are written only by the
 * view, from DOM facts; the host never infers one.
 */

export type ToastKind = 'info' | 'success' | 'warning' | 'error'
export type ToastId = number
/** Returned by a refused (blank) post; every call ignores it. */
export const NO_TOAST: ToastId = 0

export interface ToastConfig {
    /** Toasts shown at once. */
    maxVisible: number
    /** Visible warning and error toasts at most; keeps a place free for Undo. */
    stickyCap: number
    infoMs: number
    successMs: number
    undoMs: number
    /** An undo run unsettled this long takes the failure path. */
    undoRunTimeoutMs: number
}

export const DEFAULT_TOAST_CONFIG: Readonly<ToastConfig> = Object.freeze({
    maxVisible: 3,
    stickyCap: 2,
    infoMs: 5000,
    successMs: 5000,
    undoMs: 6000,
    undoRunTimeoutMs: 10000,
})

export interface ToastClock {
    now(): number
    /** Runs `run` once after `ms`; the returned function cancels it. */
    after(ms: number, run: () => void): () => void
}

export interface PlainToastInit {
    kind?: ToastKind
    text: string
    sub?: string
}

/** `ok` must be literally true and `text` a non-blank string for the host to show success. */
export type UndoOutcome =
    | { ok: true, text: string }
    | { ok: false, text: string, after?: 'close' | 'keep' }

export interface UndoAction {
    /** The caller's own id (for example a History entry id). */
    readonly id: string
    run(): UndoOutcome | Promise<UndoOutcome>
    /** Shown when `run` throws, rejects, times out or returns something that is not an outcome. */
    readonly failedText: string
}

export interface UndoToastInit {
    text: string
    sub?: string
    actionLabel: string
    action: UndoAction
}

export interface ToastView {
    readonly id: ToastId
    readonly kind: ToastKind | 'undo'
    readonly text: string
    readonly sub?: string
    /** Present only while Undo is offered. */
    readonly actionLabel?: string
    /** An undo run is in flight. */
    readonly pending: boolean
}

/** `seq` counts the writes of one live region, so identical consecutive texts still render as a new node. */
export interface Announcement {
    readonly text: string
    readonly seq: number
}

export interface ToastHost {
    post(init: PlainToastInit): ToastId
    postUndo(init: UndoToastInit): ToastId
    dismiss(id: ToastId): void
    /** Ends every live toast offering this action id, pending ones included. */
    dismissUndo(actionId: string): void
    /**
     * Suspends the stack while `isActive()` is true. Call during component initialisation or inside
     * `$effect.root`; the suspension ends when `isActive()` turns false or the owner is destroyed, whichever comes
     * first. Outside an effect owner Svelte throws, so an ownerless suspension cannot exist.
     */
    suspendWhile(isActive: () => boolean): void
    readonly suspended: boolean
    /** Oldest first. */
    readonly visible: readonly ToastView[]
    /**
     * Rune state. Increments on every change of `visible` (a toast shown or ended, or any field of a shown toast)
     * and of `suspended`; a call that changes nothing does not increment it. The view re-derives holds and focus
     * after every increment.
     */
    readonly version: number
    readonly polite: Announcement
    readonly assertive: Announcement
    /**
     * Hold inputs, written by the view only. Plain fields, not rune state: `setHold` and `clearHolds` never
     * increment `version`, so the view effects that call `setHold` cannot re-trigger themselves. A change pauses or
     * resumes timers at once.
     */
    setHold(reason: 'hover' | 'focus', on: boolean): void
    clearHolds(): void
    /** The Undo button. */
    activate(id: ToastId): Promise<void>
    count(): { visible: number, queued: number, suspenders: number }
    holds(): { hover: boolean, focus: boolean }
    reset(): void
}

interface Entry {
    readonly id: ToastId
    kind: ToastKind | 'undo'
    text: string
    sub?: string
    actionLabel?: string
    action?: UndoAction
    pending: boolean
    /** Milliseconds still to run; null for a toast with no timer (warning, error). */
    remaining: number | null
    /** Clock reading when the running timer started; null while the timer is not running. */
    startedAt: number | null
    cancel: (() => void) | null
    ended: boolean
}

type Region = 'polite' | 'assertive'

type Settlement =
    | { type: 'value', value: unknown }
    | { type: 'error', error: unknown }
    | { type: 'timeout' }

type ParsedOutcome =
    | { ok: true, text: string }
    | { ok: false, text: string, after: 'close' | 'keep' | undefined }

function isBlank(value: unknown): boolean {
    return typeof value !== 'string' || value.trim() === ''
}

function isSticky(kind: Entry['kind']): boolean {
    return kind === 'warning' || kind === 'error'
}

function isTimedPlain(kind: Entry['kind']): boolean {
    return kind === 'info' || kind === 'success'
}

function isRefusalAfter(value: unknown): value is 'close' | 'keep' | undefined {
    return value === undefined || value === 'close' || value === 'keep'
}

function parseOutcome(value: unknown): ParsedOutcome | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const candidate = value as { ok?: unknown, text?: unknown, after?: unknown }
    if (isBlank(candidate.text)) {
        return null
    }
    const text = candidate.text as string
    if (candidate.ok === true) {
        return { ok: true, text }
    }
    const after = candidate.after
    if (candidate.ok === false && isRefusalAfter(after)) {
        return { ok: false, text, after }
    }
    return null
}

const realClock: ToastClock = {
    now: () => Date.now(),
    // Resolved at call time so timers installed by a test after import govern the singleton.
    after(ms, run) {
        const handle = globalThis.setTimeout(run, ms)
        return () => globalThis.clearTimeout(handle)
    },
}

export function createToastHost(opts: { clock?: ToastClock, config?: Partial<ToastConfig> } = {}): ToastHost {
    const clock = opts.clock ?? realClock
    const cfg: ToastConfig = { ...DEFAULT_TOAST_CONFIG, ...opts.config }
    if (!(cfg.stickyCap >= 1) || !(cfg.stickyCap < cfg.maxVisible)) {
        throw new Error('toast config: stickyCap must be at least 1 and below maxVisible')
    }
    for (const key of ['infoMs', 'successMs', 'undoMs', 'undoRunTimeoutMs'] as const) {
        if (!(cfg[key] > 0)) {
            throw new Error('toast config: ' + key + ' must be positive')
        }
    }

    // Source of truth for shown toasts (plain, mutated in place); `shown` is the published copy.
    let entries: Entry[] = []
    let queue: Entry[] = []
    let shown = $state<ToastView[]>([])
    let version = $state(0)
    let suspended = $state(false)
    // Plain mirror of `suspended` for internal decisions: an effect that called `setSuspended` must not subscribe to it.
    let isSuspended = false
    let polite = $state<Announcement>({ text: '', seq: 0 })
    let assertive = $state<Announcement>({ text: '', seq: 0 })
    // Write-only counter: reading a rune inside an effect would subscribe the effect to it.
    let versionCounter = 0
    let politeSeq = 0
    let assertiveSeq = 0
    let nextId = 1
    let generation = 0
    let hold = { hover: false, focus: false }
    const tokens = new Set<object>()
    const runCancels = new Set<() => void>()
    // Lets `reset` finish the promise of an `activate` whose run it abandons.
    const runResolvers = new Set<() => void>()
    const pendingAnnouncements: Record<Region, string[]> = { polite: [], assertive: [] }

    function toView(entry: Entry): ToastView {
        return {
            id: entry.id,
            kind: entry.kind,
            text: entry.text,
            ...(entry.sub !== undefined ? { sub: entry.sub } : {}),
            ...(entry.actionLabel !== undefined ? { actionLabel: entry.actionLabel } : {}),
            pending: entry.pending,
        }
    }

    /** Every mutation of `visible` or `suspended` ends here. */
    function touch(): void {
        shown = entries.map(toView)
        versionCounter += 1
        version = versionCounter
    }

    function queueAnnouncement(region: Region, text: string): void {
        pendingAnnouncements[region].push(text)
    }

    /** One write per region for everything queued; nothing is written while suspended. */
    function flushAnnouncements(): void {
        if (isSuspended) {
            return
        }
        if (pendingAnnouncements.polite.length > 0) {
            politeSeq += 1
            polite = { text: pendingAnnouncements.polite.join('\n'), seq: politeSeq }
            pendingAnnouncements.polite = []
        }
        if (pendingAnnouncements.assertive.length > 0) {
            assertiveSeq += 1
            assertive = { text: pendingAnnouncements.assertive.join('\n'), seq: assertiveSeq }
            pendingAnnouncements.assertive = []
        }
    }

    function announceShown(entry: Entry): void {
        const text = entry.sub !== undefined ? entry.text + ' ' + entry.sub : entry.text
        queueAnnouncement(isSticky(entry.kind) ? 'assertive' : 'polite', text)
    }

    function durationFor(kind: Entry['kind']): number | null {
        switch (kind) {
            case 'info': return cfg.infoMs
            case 'success': return cfg.successMs
            case 'undo': return cfg.undoMs
            default: return null
        }
    }

    function shouldRun(entry: Entry): boolean {
        return entry.remaining !== null && !isSuspended &&!hold.hover && !hold.focus && !entry.pending && !entry.ended
    }

    function pauseTimer(entry: Entry): void {
        if (entry.cancel === null) {
            return
        }
        entry.cancel()
        entry.cancel = null
        if (entry.remaining !== null && entry.startedAt !== null) {
            entry.remaining = Math.max(0, entry.remaining - (clock.now() - entry.startedAt))
        }
        entry.startedAt = null
    }

    function startTimer(entry: Entry): void {
        if (entry.cancel !== null || entry.remaining === null) {
            return
        }
        entry.startedAt = clock.now()
        entry.cancel = clock.after(entry.remaining, () => expire(entry))
    }

    /** Starts or pauses each timer according to the current holds, suspension and pending state. */
    function reconcile(): void {
        for (const entry of entries) {
            if (shouldRun(entry)) {
                startTimer(entry)
            } else {
                pauseTimer(entry)
            }
        }
    }

    /** Expiry ends the toast and never calls `run`. */
    function expire(entry: Entry): void {
        entry.cancel = null
        entry.startedAt = null
        if (!entries.includes(entry)) {
            return
        }
        endEntries([entry])
    }

    function removeEntry(entry: Entry): void {
        if (entry.cancel !== null) {
            entry.cancel()
            entry.cancel = null
        }
        entry.startedAt = null
        entry.ended = true
        entries = entries.filter((candidate) => candidate !== entry)
    }

    function stickyCount(): number {
        return entries.filter((entry) => isSticky(entry.kind)).length
    }

    function show(entry: Entry): void {
        entry.remaining = durationFor(entry.kind)
        entries = [...entries, entry]
        announceShown(entry)
    }

    /** Queue release: shows each queued entry that admission allows without evicting, oldest first. */
    function releaseQueue(): void {
        if (queue.length === 0) {
            return
        }
        const waiting = queue
        queue = []
        for (const entry of waiting) {
            if (isSticky(entry.kind) && stickyCount() >= cfg.stickyCap) {
                queue.push(entry)
            } else if (entries.length < cfg.maxVisible) {
                show(entry)
            } else {
                queue.push(entry)
            }
        }
    }

    /** Removes the entries, clears holds when the stack empties, releases the queue and publishes. */
    function endEntries(ended: Entry[]): void {
        for (const entry of ended) {
            removeEntry(entry)
        }
        if (entries.length === 0) {
            hold = { hover: false, focus: false }
        }
        releaseQueue()
        reconcile()
        touch()
        flushAnnouncements()
    }

    /** Admission of an arriving toast; true when it was shown, false when it was queued. */
    function admit(entry: Entry): boolean {
        if (isSticky(entry.kind) && stickyCount() >= cfg.stickyCap) {
            queue.push(entry)
            return false
        }
        if (entries.length < cfg.maxVisible) {
            show(entry)
            return true
        }
        const plain = entries.find((candidate) => isTimedPlain(candidate.kind))
        if (plain !== undefined) {
            removeEntry(plain)
            show(entry)
            return true
        }
        if (entry.kind === 'undo') {
            const undo = entries.find((candidate) => candidate.kind === 'undo' && !candidate.pending)
            if (undo !== undefined) {
                removeEntry(undo)
            }
            // With no evictable undo every non-sticky toast is a pending run, which settles or times out and
            // leaves a timed outcome; the overflow is bounded by the pending runs and drains.
            show(entry)
            return true
        }
        queue.push(entry)
        return false
    }

    function newEntry(kind: Entry['kind'], text: string, sub: unknown): Entry {
        const entry: Entry = {
            id: nextId,
            kind,
            text,
            pending: false,
            remaining: null,
            startedAt: null,
            cancel: null,
            ended: false,
        }
        nextId += 1
        if (!isBlank(sub)) {
            entry.sub = sub as string
        }
        return entry
    }

    function refuse(name: string): ToastId {
        recordCaughtError('toast.post', new Error('blank toast field: ' + name))
        return NO_TOAST
    }

    function publishAfterAdmission(): void {
        reconcile()
        touch()
        flushAnnouncements()
    }

    function post(init: PlainToastInit): ToastId {
        try {
            if (isBlank(init.text)) {
                return refuse('text')
            }
            const entry = newEntry(init.kind ?? 'info', init.text, init.sub)
            // A queued toast changes nothing visible until it is released.
            if (admit(entry)) {
                publishAfterAdmission()
            }
            return entry.id
        } catch (error) {
            recordCaughtError('toast.post', error)
            return NO_TOAST
        }
    }

    function postUndo(init: UndoToastInit): ToastId {
        try {
            if (isBlank(init.text)) {
                return refuse('text')
            }
            if (isBlank(init.actionLabel)) {
                return refuse('actionLabel')
            }
            if (isBlank(init.action?.failedText)) {
                return refuse('failedText')
            }
            if (isBlank(init.action.id)) {
                return refuse('action.id')
            }
            const entry = newEntry('undo', init.text, init.sub)
            entry.actionLabel = init.actionLabel
            entry.action = init.action
            admit(entry)
            publishAfterAdmission()
            return entry.id
        } catch (error) {
            recordCaughtError('toast.post', error)
            return NO_TOAST
        }
    }

    function dismiss(id: ToastId): void {
        const entry = entries.find((candidate) => candidate.id === id)
        if (entry !== undefined) {
            endEntries([entry])
            return
        }
        // A queued toast has no Dismiss button, but a caller holding its id may withdraw it.
        queue = queue.filter((candidate) => candidate.id !== id)
    }

    function dismissUndo(actionId: string): void {
        const matches = entries.filter((entry) => entry.action !== undefined && entry.action.id === actionId)
        if (matches.length > 0) {
            endEntries(matches)
        }
    }

    function setSuspended(): void {
        const next = tokens.size > 0
        if (next === isSuspended) {
            return
        }
        isSuspended = next
        suspended = next
        reconcile()
        touch()
        flushAnnouncements()
    }

    function suspendWhile(isActive: () => boolean): void {
        // A derived value changes only when the answer does, so an unchanged answer never churns the token.
        const active = $derived.by(() => isActive() === true)
        $effect(() => {
            if (!active) {
                return
            }
            const token = {}
            tokens.add(token)
            setSuspended()
            return () => {
                // A token removed by `reset` is ignored.
                if (tokens.delete(token)) {
                    setSuspended()
                }
            }
        })
    }

    function setHold(reason: 'hover' | 'focus', on: boolean): void {
        if (hold[reason] === on) {
            return
        }
        hold = { ...hold, [reason]: on }
        reconcile()
    }

    function clearHolds(): void {
        if (!hold.hover && !hold.focus) {
            return
        }
        hold = { hover: false, focus: false }
        reconcile()
    }

    function recordLate(settlement: Settlement): void {
        if (settlement.type === 'timeout') {
            return
        }
        const ok = settlement.type === 'value' && typeof settlement.value === 'object' && settlement.value !== null
            ? (settlement.value as { ok?: unknown }).ok
            : settlement.type
        recordCaughtError('toast.undo.late', new Error('undo settled after timeout: ok=' + String(ok)))
    }

    /**
     * Applies a settled run. The result text is announced even when the toast ended while the run was pending;
     * an ended toast is never brought back.
     */
    function applyOutcome(entry: Entry, action: UndoAction, settlement: Settlement): void {
        let outcome: ParsedOutcome | null = null
        if (settlement.type === 'value') {
            outcome = parseOutcome(settlement.value)
            if (outcome === null) {
                recordCaughtError('toast.undo', new Error('invalid undo outcome'))
            }
        } else if (settlement.type === 'error') {
            recordCaughtError('toast.undo', settlement.error)
        } else {
            recordCaughtError('toast.undo', new Error('undo run timed out'))
        }
        const text = outcome !== null ? outcome.text : action.failedText
        queueAnnouncement('polite', text)

        if (!entries.includes(entry)) {
            flushAnnouncements()
            return
        }
        entry.pending = false
        if (outcome !== null && outcome.ok === false && outcome.after === 'close') {
            endEntries([entry])
            return
        }
        if (outcome !== null && outcome.ok === false && outcome.after === 'keep') {
            entry.text = text
            entry.remaining = cfg.undoMs
        } else {
            entry.kind = outcome !== null && outcome.ok ? 'success' : 'info'
            entry.text = text
            delete entry.sub
            delete entry.actionLabel
            delete entry.action
            entry.remaining = durationFor(entry.kind)
        }
        releaseQueue()
        reconcile()
        touch()
        flushAnnouncements()
    }

    async function activate(id: ToastId): Promise<void> {
        const entry = entries.find((candidate) => candidate.id === id)
        if (entry === undefined || entry.action === undefined || entry.kind !== 'undo' || entry.pending) {
            return
        }
        const action = entry.action
        const runGeneration = generation
        let settled = false
        let cancelTimeout: () => void = () => { }

        entry.pending = true
        reconcile()
        touch()

        await new Promise<void>((resolve) => {
            runResolvers.add(resolve)
            const settle = (settlement: Settlement): void => {
                if (settled || runGeneration !== generation) {
                    recordLate(settlement)
                    resolve()
                    return
                }
                settled = true
                runResolvers.delete(resolve)
                cancelTimeout()
                runCancels.delete(cancelTimeout)
                try {
                    applyOutcome(entry, action, settlement)
                } catch (error) {
                    recordCaughtError('toast.undo', error)
                }
                resolve()
            }
            cancelTimeout = clock.after(cfg.undoRunTimeoutMs, () => {
                runCancels.delete(cancelTimeout)
                settle({ type: 'timeout' })
            })
            runCancels.add(cancelTimeout)
            try {
                Promise.resolve(action.run()).then(
                    (value) => settle({ type: 'value', value }),
                    (error: unknown) => settle({ type: 'error', error }),
                )
            } catch (error) {
                settle({ type: 'error', error })
            }
        })
    }

    function reset(): void {
        generation += 1
        for (const entry of entries) {
            if (entry.cancel !== null) {
                entry.cancel()
                entry.cancel = null
            }
            entry.startedAt = null
            entry.ended = true
        }
        for (const cancel of runCancels) {
            cancel()
        }
        runCancels.clear()
        entries = []
        queue = []
        tokens.clear()
        isSuspended = false
        suspended = false
        for (const release of runResolvers) {
            release()
        }
        runResolvers.clear()
        hold = { hover: false, focus: false }
        pendingAnnouncements.polite = []
        pendingAnnouncements.assertive = []
        politeSeq = 0
        assertiveSeq = 0
        polite = { text: '', seq: 0 }
        assertive = { text: '', seq: 0 }
        nextId = 1
        touch()
    }

    return {
        post,
        postUndo,
        dismiss,
        dismissUndo,
        suspendWhile,
        get suspended() { return suspended },
        get visible() { return shown },
        get version() { return version },
        get polite() { return polite },
        get assertive() { return assertive },
        setHold,
        clearHolds,
        activate,
        count: () => ({ visible: entries.length, queued: queue.length, suspenders: tokens.size }),
        holds: () => ({ ...hold }),
        reset,
    }
}

export const toastHost: ToastHost = createToastHost()

export const postToast = (init: PlainToastInit): ToastId => toastHost.post(init)
export const postUndoToast = (init: UndoToastInit): ToastId => toastHost.postUndo(init)
export const dismissToast = (id: ToastId): void => toastHost.dismiss(id)
export const dismissUndo = (actionId: string): void => toastHost.dismissUndo(actionId)
export const suspendToastsWhile = (isActive: () => boolean): void => toastHost.suspendWhile(isActive)
export const resetToastHostForTests = (): void => toastHost.reset()
