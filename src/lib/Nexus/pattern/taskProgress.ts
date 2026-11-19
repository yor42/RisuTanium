/**
 * The task card's model: steps, an optional count or byte total, an optional batch file, and the states a task passes
 * through. The functions are pure; `createTaskController` adds the throttled view the card reads. Nothing here reads
 * `language`, the DOM or a global timer, so every text it returns comes from the labels its caller passes in.
 */

import type { BrandStatus } from '../brand/brandStatus'
import type { ProgressSink } from '../../../ts/progressSink'

export type TaskState = 'running' | 'cancelling' | 'done' | 'done-with-skips' | 'failed'
export type TaskStepState = 'next' | 'now' | 'done' | 'failed'
export type TaskDataState = 'same' | 'partial' | 'unknown'

export interface TaskStepDef {
    /** Already translated. */
    readonly label: string
    /** Item noun for the count line, already translated, e.g. "Assets". */
    readonly noun?: string
    /** The mark while this step runs; defaults to `scanning`. */
    readonly mark?: BrandStatus
}
/** `open` marks a count whose `total` is still growing: items found so far. It never fills the bar. */
export interface TaskAmount { readonly done: number, readonly total: number, readonly open?: boolean }
/** `index` is 0-based. */
export interface TaskFile { readonly index: number, readonly total: number, readonly name?: string }
/** Both fields already translated. */
export interface TaskSkip { readonly name: string, readonly reason: string }
export interface TaskResultAction { readonly id: string, readonly label: string }
export interface TaskResult {
    readonly headline: string
    /** Counts by kind, already translated ("12 characters, 3 modules"). */
    readonly summary?: readonly string[]
    readonly skipped?: readonly TaskSkip[]
    /** Shown before OK; the slot for "Retry the {n} that failed". */
    readonly actions?: readonly TaskResultAction[]
}
export interface TaskFailure {
    readonly headline: string
    readonly dataState: TaskDataState
    readonly kept?: number
    readonly failed?: number
    readonly detail?: string
    readonly skipped?: readonly TaskSkip[]
    readonly actions?: readonly TaskResultAction[]
}
export interface TaskDef {
    readonly title: string
    readonly subtitle?: string
    /** At least one; fixed for the task's life so the bar never jumps back. */
    readonly steps: readonly TaskStepDef[]
    /** Cancel is offered only when this is set, and only until `lockCancel`. */
    readonly onCancel?: () => void
}
export interface TaskSnapshot {
    readonly title: string
    readonly subtitle?: string
    readonly steps: readonly TaskStepDef[]
    readonly stepIndex: number
    readonly file?: TaskFile
    readonly count?: TaskAmount
    readonly bytes?: TaskAmount
    readonly state: TaskState
    readonly cancelOffered: boolean
    readonly lockReason?: string
    readonly cancelled: boolean
    readonly result?: TaskResult
    readonly failure?: TaskFailure
}
export interface TaskView extends TaskSnapshot {
    /** Unique per task; re-keys the card. */
    readonly id: number
    /** Largest fraction published so far, 0..1; 1 at done. */
    readonly fraction: number
    /** True after TASK_SLOW_AFTER_MS without visible progress while running. */
    readonly slow: boolean
}
/** The strings the text helpers need, so the model stays free of `language`. */
export interface TaskLabels {
    stepOf(index: number, total: number): string
    fileOf(index: number, total: number): string
    count(noun: string, done: number, total: number): string
    /** The text of an open count ("n saved, m found so far"). A caller that never opens a count may omit it. */
    countFound?(noun: string, done: number, found: number): string
    bytes(done: string, total: string): string
    cancelling: string
    /** The headline of a task that ended by a cancel. */
    cancelledHeadline: string
    skippedTitle(count: number): string
}

export const TASK_WRITE_INTERVAL_MS = 250
export const TASK_SLOW_AFTER_MS = 8000
export const TASK_SKIPS_SHOWN = 3

function validTotal(amount: TaskAmount | undefined): amount is TaskAmount {
    return amount !== undefined && Number.isFinite(amount.total) && amount.total > 0
}

function isTerminal(state: TaskState): boolean {
    return state === 'done' || state === 'done-with-skips' || state === 'failed'
}

/** The count that fills the bar: a closed count with a real total. An open count never does. */
function closedCount(s: TaskSnapshot): TaskAmount | undefined {
    return s.count !== undefined && !s.count.open && validTotal(s.count) ? s.count : undefined
}

/** Share of the current step that is done, 0..1; 0 while no total is known. */
function withinStep(s: TaskSnapshot): number {
    const amount = closedCount(s) ?? (validTotal(s.bytes) ? s.bytes : undefined)
    if (!amount) return 0
    return Math.min(1, Math.max(0, amount.done / amount.total))
}

/** Each step takes an equal share of the bar; a batch file takes an equal share of all steps. */
export function taskFraction(s: TaskSnapshot): number {
    if (s.state === 'done' || s.state === 'done-with-skips') return 1
    const steps = Math.max(1, s.steps.length)
    const perFile = (s.stepIndex + withinStep(s)) / steps
    const value = s.file ? (s.file.index + perFile) / Math.max(1, s.file.total) : perFile
    return Math.min(1, Math.max(0, value))
}

/** A real total exists, so the bar can fill; otherwise the card shows the sweep. */
export function taskDeterminate(s: TaskSnapshot): boolean {
    return s.state === 'running' && (closedCount(s) !== undefined || validTotal(s.bytes))
}

export function taskStepStates(s: TaskSnapshot): readonly TaskStepState[] {
    return s.steps.map((_, index): TaskStepState => {
        if (index < s.stepIndex) return 'done'
        if (index > s.stepIndex) return 'next'
        if (s.state === 'running' || s.state === 'cancelling') return 'now'
        if (s.state === 'failed') return 'failed'
        return s.cancelled ? 'next' : 'done'
    })
}

function resultSkipCount(s: TaskSnapshot): number {
    return s.result?.skipped?.length ?? 0
}

/**
 * The live-region text. It changes only on a step, file or state change: counts, bytes and the slow hint never appear in it.
 */
export function taskAnnouncement(s: TaskSnapshot, labels: TaskLabels): string {
    switch (s.state) {
        case 'running': {
            const label = s.steps[s.stepIndex]?.label ?? ''
            return s.file ? `${labels.fileOf(s.file.index + 1, s.file.total)}: ${label}` : label
        }
        case 'cancelling':
            return labels.cancelling
        case 'done':
        case 'done-with-skips': {
            const headline = s.cancelled ? labels.cancelledHeadline : (s.result?.headline ?? '')
            const skips = resultSkipCount(s)
            return skips > 0 ? `${headline}. ${labels.skippedTitle(skips)}` : headline
        }
        case 'failed':
            return s.failure?.headline ?? ''
    }
}

/** One decimal and " MiB", the same format the backup size lines use. */
export function taskMiB(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

/** The count with its noun, otherwise bytes in MiB, otherwise empty. Never a percentage. An open count reads "found so far". */
export function taskAmountText(s: TaskSnapshot, labels: TaskLabels): string {
    if (s.count?.open) {
        return s.count.total > 0 && labels.countFound ? labels.countFound(s.steps[s.stepIndex]?.noun ?? '', s.count.done, s.count.total) : ''
    }
    if (validTotal(s.count)) return labels.count(s.steps[s.stepIndex]?.noun ?? '', s.count.done, s.count.total)
    if (validTotal(s.bytes)) return labels.bytes(taskMiB(s.bytes.done), taskMiB(s.bytes.total))
    return ''
}

/** The progressbar's `aria-valuetext`: where the task is, plus the amount while one step is counted. */
export function taskValueText(s: TaskSnapshot, labels: TaskLabels): string {
    if (s.state !== 'running' && s.state !== 'cancelling') return taskAnnouncement(s, labels)
    const label = s.steps[s.stepIndex]?.label ?? ''
    const file = s.file ? `${labels.fileOf(s.file.index + 1, s.file.total)}: ` : ''
    const amount = taskAmountText(s, labels)
    return `${file}${labels.stepOf(s.stepIndex + 1, s.steps.length)}: ${label}${amount ? `, ${amount}` : ''}`
}

export function taskMarkStatus(s: TaskSnapshot): BrandStatus {
    switch (s.state) {
        case 'running': return s.steps[s.stepIndex]?.mark ?? 'scanning'
        case 'cancelling': return 'finishing'
        case 'failed': return 'error'
        case 'done':
        case 'done-with-skips': return s.cancelled ? 'stopped' : 'done'
    }
}

export function canMoveTo(from: TaskState, to: TaskState): boolean {
    if (from === 'running') return to === 'cancelling' || to === 'done' || to === 'done-with-skips' || to === 'failed'
    if (from === 'cancelling') return to === 'done' || to === 'done-with-skips' || to === 'failed'
    return false
}

export interface TaskClock {
    now(): number
    setTimeout(run: () => void, ms: number): ReturnType<typeof setTimeout>
    clearTimeout(id: ReturnType<typeof setTimeout>): void
    hidden(): boolean
}

export interface TaskController {
    readonly view: TaskView
    subscribe(listener: (view: TaskView) => void): () => void
    setStep(index: number): void
    setFile(index: number, total: number, name?: string): void
    readonly setCount: ProgressSink
    /** An open count: `done` saved of `found` so far. A later `setCount` closes it; a step change clears it. */
    readonly setFound: ProgressSink
    readonly setBytes: ProgressSink
    /** True when Cancel is now locked and no cancel was requested; only then may the caller write. */
    lockCancel(reason?: string): boolean
    requestCancel(): boolean
    settleCancel(summary?: readonly string[]): void
    finish(result: TaskResult): void
    fail(failure: TaskFailure): void
    flush(): void
    dispose(): void
}

let nextTaskId = 1

function sanitizeAmount(done: number, total: number): TaskAmount {
    const knownTotal = Number.isFinite(total) && total > 0 ? total : 0
    const knownDone = Number.isFinite(done) && done > 0 ? done : 0
    return { done: knownTotal > 0 ? Math.min(knownDone, knownTotal) : knownDone, total: knownTotal }
}

/**
 * The state machine and the throttled view. Model changes apply at once; what the card reads (`view`) is republished at
 * most once per TASK_WRITE_INTERVAL_MS while running, skipped while the tab is hidden, and always carries the latest
 * model. A transition publishes at once and drops any pending publish, so the final state is never lost. Progress
 * reporting never throws: a call that does not apply is ignored.
 */
export function createTaskController(def: TaskDef, clock: TaskClock): TaskController {
    const id = nextTaskId++
    const listeners = new Set<(view: TaskView) => void>()

    let state: TaskState = 'running'
    let stepIndex = 0
    let file: TaskFile | undefined
    let count: TaskAmount | undefined
    let bytes: TaskAmount | undefined
    let locked = def.onCancel === undefined
    let lockReason: string | undefined
    let cancelled = false
    let result: TaskResult | undefined
    let failure: TaskFailure | undefined
    let slow = false
    let maxFraction = 0
    let disposed = false

    let lastPublish = 0
    let dirty = false
    let trailing: ReturnType<typeof setTimeout> | null = null
    let slowTimer: ReturnType<typeof setTimeout> | null = null

    function snapshot(): TaskSnapshot {
        return {
            title: def.title,
            subtitle: def.subtitle,
            steps: def.steps,
            stepIndex,
            file,
            count,
            bytes,
            state,
            cancelOffered: def.onCancel !== undefined && !locked && state === 'running',
            lockReason,
            cancelled,
            result,
            failure,
        }
    }

    let view: TaskView

    function publish(): void {
        if (trailing !== null) {
            clock.clearTimeout(trailing)
            trailing = null
        }
        const snap = snapshot()
        maxFraction = state === 'done' || state === 'done-with-skips' ? 1 : Math.max(maxFraction, taskFraction(snap))
        view = { ...snap, id, fraction: maxFraction, slow: slow && state === 'running' }
        lastPublish = clock.now()
        dirty = false
        for (const listener of [...listeners]) listener(view)
    }

    /** The one publisher for running-state changes: leading when the interval has passed, otherwise one trailing. */
    function request(): void {
        if (disposed || state !== 'running') return
        if (clock.hidden()) {
            dirty = true
            return
        }
        if (trailing !== null) return
        const due = lastPublish + TASK_WRITE_INTERVAL_MS
        const now = clock.now()
        if (now >= due) {
            publish()
            return
        }
        trailing = clock.setTimeout(() => {
            trailing = null
            if (disposed || state !== 'running') return
            if (clock.hidden()) {
                dirty = true
                return
            }
            publish()
        }, due - now)
    }

    function stopSlowTimer(): void {
        if (slowTimer !== null) {
            clock.clearTimeout(slowTimer)
            slowTimer = null
        }
    }

    function restartSlowTimer(): void {
        stopSlowTimer()
        slow = false
        if (disposed || state !== 'running') return
        slowTimer = clock.setTimeout(() => {
            slowTimer = null
            if (disposed || state !== 'running') return
            slow = true
            request()
        }, TASK_SLOW_AFTER_MS)
    }

    function transition(to: TaskState): boolean {
        if (disposed || !canMoveTo(state, to)) return false
        state = to
        stopSlowTimer()
        slow = false
        publish()
        return true
    }

    view = { ...snapshot(), id, fraction: 0, slow: false }
    lastPublish = clock.now()
    restartSlowTimer()

    return {
        get view() {
            return view
        },
        subscribe(listener) {
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
            }
        },
        setStep(index) {
            if (disposed || state !== 'running') return
            if (!Number.isInteger(index) || index <= stepIndex || index >= def.steps.length) return
            stepIndex = index
            count = undefined
            bytes = undefined
            restartSlowTimer()
            request()
        },
        setFile(index, total, name) {
            if (disposed || state !== 'running') return
            if (!Number.isInteger(index) || !Number.isInteger(total) || index < 0 || total < 1) return
            if (file !== undefined && index <= file.index) return
            file = { index, total, name }
            stepIndex = 0
            count = undefined
            bytes = undefined
            restartSlowTimer()
            request()
        },
        setCount(done, total) {
            if (disposed || state !== 'running') return
            const next = sanitizeAmount(done, total)
            const advanced = next.done > (count?.done ?? 0)
            count = next
            if (advanced) restartSlowTimer()
            request()
        },
        setFound(done, found) {
            if (disposed || state !== 'running') return
            const next = { ...sanitizeAmount(done, found), open: true }
            const advanced = next.done > (count?.done ?? 0) || next.total > (count?.total ?? 0)
            count = next
            if (advanced) restartSlowTimer()
            request()
        },
        setBytes(done, total) {
            if (disposed || state !== 'running') return
            const next = sanitizeAmount(done, total)
            const advanced = next.done > (bytes?.done ?? 0)
            bytes = next
            if (advanced) restartSlowTimer()
            request()
        },
        lockCancel(reason) {
            if (disposed || state !== 'running') return false
            if (reason !== undefined && lockReason === undefined) lockReason = reason
            locked = true
            publish()
            return true
        },
        requestCancel() {
            if (disposed || state !== 'running' || def.onCancel === undefined || locked) return false
            transition('cancelling')
            def.onCancel()
            return true
        },
        settleCancel(summary) {
            if (disposed || !canMoveTo(state, 'done')) return
            cancelled = true
            result = { headline: '', summary }
            transition('done')
        },
        finish(finished) {
            const to: TaskState = finished.skipped && finished.skipped.length > 0 ? 'done-with-skips' : 'done'
            if (disposed || !canMoveTo(state, to)) return
            result = finished
            transition(to)
        },
        fail(failed) {
            if (disposed || !canMoveTo(state, 'failed')) return
            failure = failed
            transition('failed')
        },
        flush() {
            if (disposed || state !== 'running') return
            if (dirty || trailing !== null) publish()
        },
        dispose() {
            disposed = true
            if (trailing !== null) clock.clearTimeout(trailing)
            trailing = null
            stopSlowTimer()
            listeners.clear()
        },
    }
}

export function isTaskTerminal(state: TaskState): boolean {
    return isTerminal(state)
}
