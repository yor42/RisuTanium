import type { ProgressSink } from './progressSink'
import { clearPickOpener, takePickOpener } from './pickOpener'
import {
    createTaskController,
    isTaskTerminal,
    type TaskClock,
    type TaskController,
    type TaskDef,
    type TaskFailure,
    type TaskResult,
    type TaskView,
} from '../lib/Nexus/pattern/taskProgress'

/**
 * The task card's slot. A task is not an `alertStore` value: every alert write replaces the store, so a nested prompt
 * or `alertClear` would erase it. The slot keeps one task and its controller; the host renders it and steps aside while a
 * covering alert is up. This module reaches no store and no alert module, so any reader may import it.
 */

export type TaskCloseAnswer =
    | { readonly kind: 'ok' }
    | { readonly kind: 'action', readonly id: string }
    | { readonly kind: 'replaced' }
    | { readonly kind: 'closed' }
    /** A backgrounded result that was dismissed from its toast or hidden by the toast's hold. */
    | { readonly kind: 'dismissed' }

/** How a preflight card ended: `confirm` is the only answer that lets the action start. */
export type TaskConfirmAnswer = 'confirm' | 'declined' | 'replaced' | 'closed'

export interface TaskHandle {
    /**
     * Settles exactly once: `confirm` when the user confirmed (at once for a task without a preflight), `declined` for
     * Cancel, Escape or Back, `replaced` when a newer task took the slot, `closed` when the card was removed.
     */
    readonly confirmation: Promise<TaskConfirmAnswer>
    setStep(index: number): void
    setFile(index: number, total: number, name?: string): void
    readonly setCount: ProgressSink
    /** An open count: `done` saved of `found` so far. */
    readonly setFound: ProgressSink
    readonly setBytes: ProgressSink
    /**
     * True when Cancel is now locked and no cancel was requested: only then may the caller write.
     * False means the user pressed Cancel (`cancelRequested` is true) or the caller already ended the task.
     * A detached handle returns `!cancelRequested`, so a replacement never reads as a cancel; one that left the slot
     * before it was confirmed returns false, so a preflight that never started can never write.
     */
    lockCancel(reason?: string): boolean
    readonly cancelRequested: boolean
    /** True once the entry has left the slot: replaced by a newer task, closed or answered. */
    readonly detached: boolean
    /** True while the task runs or shows its result as a toast, off the screen. */
    readonly inBackground: boolean
    /** True once the task was sent to the background at any time, even if its card was reopened since. */
    readonly backgrounded: boolean
    /** Shows the background button of a task opened with `backgroundHeld`; ignored once withdrawn. */
    offerBackground(): void
    /** Removes the background button for good; ignored on a detached handle. */
    withdrawBackground(): void
    settleCancel(summary?: readonly string[]): Promise<TaskCloseAnswer>
    finish(result: TaskResult): Promise<TaskCloseAnswer>
    fail(failure: TaskFailure): Promise<TaskCloseAnswer>
    /** Removes the card at once, whatever its state (the task counterpart of alertClear); resolves `closed`. */
    close(): void
}

/**
 * Where a backgrounded task is shown. The slot knows no toast host: the host that mounts the cards registers the
 * presenter, so this module still imports no language, store or alert module.
 */
export interface TaskToastPresenter {
    /** Shows the toast for a task that just left the slot; `on.open` reopens the card, `on.end` ends a finished task. */
    post(view: TaskView, on: { open(): void, end(): void }): number
    update(id: number, view: TaskView): void
    end(id: number, opts: { returnFocus: boolean }): void
}

interface Entry {
    readonly controller: TaskController
    readonly opener: HTMLElement | null
    readonly closed: Promise<TaskCloseAnswer>
    resolveClosed(answer: TaskCloseAnswer): void
    resolveConfirmation(answer: TaskConfirmAnswer): void
    /** True from the start of a task with a preflight until it is confirmed. */
    unconfirmed: boolean
    cancelRequested: boolean
    detached: boolean
    inBackground: boolean
    everBackgrounded: boolean
    toastId: number | null
    stopListening(): void
}

let entry: Entry | null = null
let shownView = $state.raw<TaskView | null>(null)
let clockOverride: TaskClock | null = null
let presenter: TaskToastPresenter | null = null
// Entries whose card is off the screen; plain, because no reader needs to react to the list itself.
let backgroundEntries: Entry[] = []
// Set and cleared with `entry`: true while the shown card is one that `reopenEntry` brought back from a toast.
let reopenedShown = $state(false)
// Modules rounds that may still answer Replace, counted from the round's start until it ends; reactive, so a card hides its button.
let detachedModulesRounds = $state(0)

const defaultClock: TaskClock = {
    now: () => performance.now(),
    setTimeout: (run, ms) => setTimeout(run, ms),
    clearTimeout: (timer) => clearTimeout(timer),
    hidden: () => typeof document !== 'undefined' && document.hidden,
}

/** The one way an entry leaves the slot: answer, close, replacement and test reset all end here. */
function clearEntry(target: Entry, answer: TaskCloseAnswer): void {
    if (target.detached) return
    target.detached = true
    if (entry === target) {
        entry = null
        shownView = null
        reopenedShown = false
    }
    if (target.inBackground) {
        target.inBackground = false
        backgroundEntries = backgroundEntries.filter((candidate) => candidate !== target)
        if (target.toastId !== null) presenter?.end(target.toastId, { returnFocus: true })
        target.toastId = null
    }
    target.controller.dispose()
    target.stopListening()
    // A pending confirmation settles too, so no path leaves the preflight's wait hanging.
    if (target.unconfirmed) target.resolveConfirmation(answer.kind === 'replaced' ? 'replaced' : 'closed')
    target.resolveClosed(answer)
}

function currentOpener(): HTMLElement | null {
    if (typeof document === 'undefined') return null
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body) {
        // Focus that is somewhere real beats the picker's button, and that button is spent either way.
        clearPickOpener()
        return active
    }
    return takePickOpener()
}

/** Opens a task card. A task already shown is replaced: it resolves `replaced` and its handle detaches. */
export function alertTask(def: TaskDef): TaskHandle {
    let opener = currentOpener()
    const previous = entry
    if (previous && opener) {
        const layer = opener.closest('[data-part="pattern-layer"]')
        if (layer?.querySelector('[data-part="pattern-task-root"]')) opener = previous.opener
    }
    if (previous) clearEntry(previous, { kind: 'replaced' })

    let resolveClosed: (answer: TaskCloseAnswer) => void = () => { }
    const closed = new Promise<TaskCloseAnswer>((resolve) => {
        resolveClosed = resolve
    })
    let resolveConfirmation: (answer: TaskConfirmAnswer) => void = () => { }
    const confirmation = new Promise<TaskConfirmAnswer>((resolve) => {
        resolveConfirmation = resolve
    })
    // Assigned right after the controller exists; the cancel callback below runs only later, from a press.
    let self: Entry
    const onCancel = def.onCancel
    const controller = createTaskController(
        {
            ...def,
            onCancel: onCancel === undefined ? undefined : () => {
                self.cancelRequested = true
                onCancel()
            },
        },
        clockOverride ?? defaultClock,
    )
    self = {
        controller,
        opener,
        closed,
        resolveClosed,
        resolveConfirmation,
        unconfirmed: def.confirm !== undefined,
        cancelRequested: false,
        detached: false,
        inBackground: false,
        everBackgrounded: false,
        toastId: null,
        stopListening: () => { },
    }
    const stopView = controller.subscribe((view) => {
        if (entry === self) shownView = view
        else if (self.inBackground && self.toastId !== null) presenter?.update(self.toastId, view)
    })
    const onVisibility = () => controller.flush()
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
    self.stopListening = () => {
        stopView()
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
    }
    entry = self
    shownView = controller.view
    reopenedShown = false
    if (def.confirm === undefined) resolveConfirmation('confirm')

    return {
        confirmation,
        setStep: (index) => { if (!self.detached) controller.setStep(index) },
        setFile: (index, total, name) => { if (!self.detached) controller.setFile(index, total, name) },
        setCount: (done, total) => { if (!self.detached) controller.setCount(done, total) },
        setFound: (done, found) => { if (!self.detached) controller.setFound(done, found) },
        setBytes: (done, total) => { if (!self.detached) controller.setBytes(done, total) },
        lockCancel: (reason) => (self.detached ? !self.unconfirmed && !self.cancelRequested : controller.lockCancel(reason)),
        get cancelRequested() {
            return self.cancelRequested
        },
        get detached() {
            return self.detached
        },
        get inBackground() {
            return self.inBackground
        },
        get backgrounded() {
            return self.everBackgrounded
        },
        offerBackground: () => { if (!self.detached) controller.offerBackground() },
        withdrawBackground: () => { if (!self.detached) controller.withdrawBackground() },
        settleCancel: (summary) => {
            if (!self.detached) controller.settleCancel(summary)
            return self.closed
        },
        finish: (result) => {
            if (!self.detached) controller.finish(result)
            return self.closed
        },
        fail: (failure) => {
            if (!self.detached) controller.fail(failure)
            return self.closed
        },
        close: () => clearEntry(self, { kind: 'closed' }),
    }
}

/** Registers the toast presenter of the mounted task host; null detaches it and ends every backgrounded task as `closed`. */
export function setTaskToastPresenter(next: TaskToastPresenter | null): void {
    if (next === null) {
        for (const background of [...backgroundEntries]) clearEntry(background, { kind: 'closed' })
        backgroundEntries = []
    }
    presenter = next
}

/**
 * Registers a Modules round that may still answer Replace, from the round's start; the returned end is idempotent.
 * A round in front holds its own button anyway, so the count matters once another card is shown.
 */
export function registerDetachedModulesRound(): () => void {
    detachedModulesRounds += 1
    let ended = false
    return () => {
        if (ended) return
        ended = true
        detachedModulesRounds = Math.max(0, detachedModulesRounds - 1)
    }
}

/**
 * Whether a task card may offer "Keep going in the background". It is false while a registered Modules round that may
 * still answer Replace is running: the page must stay covered until that round can no longer replace a module under an
 * open editor.
 */
export function backgroundOffered(): boolean {
    return detachedModulesRounds === 0
}

/** Sends the shown running task to the background; false and no change unless every rule below holds. */
export function backgroundTask(): boolean {
    const target = entry
    if (target === null || presenter === null || shownView === null) return false
    if (shownView.state !== 'running' || shownView.background !== true || !backgroundOffered()) return false
    entry = null
    shownView = null
    reopenedShown = false
    target.inBackground = true
    target.everBackgrounded = true
    backgroundEntries.push(target)
    target.toastId = presenter.post(target.controller.view, {
        open: () => reopenEntry(target),
        end: () => endBackground(target),
    })
    return true
}

/** Whether the shown card is one that came back from its toast. */
export function taskReopened(): boolean {
    return reopenedShown
}

/** The number of tasks running or waiting as toasts; a test seam. */
export function backgroundTaskCount(): number {
    return backgroundEntries.length
}

/** The toast's Open: the same controller returns to the slot, only while no card is shown. */
function reopenEntry(target: Entry): void {
    if (entry !== null || !target.inBackground) return
    backgroundEntries = backgroundEntries.filter((candidate) => candidate !== target)
    target.inBackground = false
    if (target.toastId !== null) presenter?.end(target.toastId, { returnFocus: false })
    target.toastId = null
    entry = target
    shownView = target.controller.view
    reopenedShown = true
}

/** The toast of a finished task was dismissed or its hold ran out: the action ends like an OK. */
function endBackground(target: Entry): void {
    if (!target.inBackground || !isTaskTerminal(target.controller.view.state)) return
    clearEntry(target, { kind: 'dismissed' })
}

/** The view of the shown task, or null. Reactive: it changes with each published view. */
export function taskHostView(): TaskView | null {
    return shownView
}

/** The element that had focus when the shown task was opened, or null. */
export function taskOpener(): HTMLElement | null {
    return entry?.opener ?? null
}

/** Whether a task is in the slot, running or showing its result. It covers the page whether or not the card is yielded. */
export function taskShown(): boolean {
    return shownView !== null
}

/** Whether the shown task has ended and its card waits for an answer. */
export function taskResultShowing(): boolean {
    return shownView !== null && isTaskTerminal(shownView.state)
}

/** Resolves when the shown result leaves the slot, however it leaves; already resolved when no result is showing. */
export function taskResultRead(): Promise<void> {
    if (entry === null || !taskResultShowing()) return Promise.resolve()
    return entry.closed.then(() => undefined)
}

/** Whether the shown task is a preflight card waiting for its answer. */
export function taskConfirmShowing(): boolean {
    return shownView !== null && shownView.state === 'confirm'
}

/** The preflight's primary: starts the task. Only a task in `confirm` accepts. */
export function confirmTask(): void {
    if (entry === null || !taskConfirmShowing()) return
    entry.unconfirmed = false
    entry.controller.confirm()
    entry.resolveConfirmation('confirm')
}

/** The preflight's Cancel, Escape or Back: the card leaves the slot and nothing has started. */
export function declineTask(): void {
    if (entry === null || !taskConfirmShowing()) return
    const declined = entry
    declined.resolveConfirmation('declined')
    clearEntry(declined, { kind: 'closed' })
}

/** Asks the shown task to cancel; only a task that offers Cancel accepts. */
export function requestTaskCancel(): void {
    entry?.controller.requestCancel()
}

/** Answers the shown result. A running task ignores it. */
export function answerTask(answer: { kind: 'ok' } | { kind: 'action', id: string }): void {
    if (entry === null || !taskResultShowing()) return
    clearEntry(entry, answer)
}

/**
 * One Back press: declines a preflight, cancels when Cancel is offered, holds while the task cannot be stopped, dismisses a
 * result. Returns true whenever a task is shown, so Back is consumed as a held `progress` alert consumes it.
 */
export function taskBackPress(): boolean {
    if (entry === null || shownView === null) return false
    if (isTaskTerminal(shownView.state)) answerTask({ kind: 'ok' })
    else if (shownView.state === 'confirm') declineTask()
    else if (shownView.cancelOffered) requestTaskCancel()
    return true
}

const pendingActions = new Set<Promise<unknown>>()

/**
 * Registers a whole task action (every round of an import, Retry rounds included) until it settles, so a reader can wait
 * for the action's final answer and not only for the answer to one round's card.
 */
export function trackTaskAction<T>(action: Promise<T>): Promise<T> {
    pendingActions.add(action)
    const forget = () => { pendingActions.delete(action) }
    action.then(forget, forget)
    return action
}

/** Resolves once no tracked task action is pending, however each ends; a newer action that starts meanwhile is awaited too. */
export async function taskActionSettled(): Promise<void> {
    while (pendingActions.size > 0) {
        await Promise.allSettled([...pendingActions])
    }
}

/** Replaces the clock tasks opened afterwards use; null restores the real one. */
export function setTaskClockForTests(clock: TaskClock | null): void {
    clockOverride = clock
}

export function resetTaskHostForTests(): void {
    if (entry) clearEntry(entry, { kind: 'closed' })
    for (const background of [...backgroundEntries]) clearEntry(background, { kind: 'closed' })
    backgroundEntries = []
    entry = null
    shownView = null
    reopenedShown = false
    detachedModulesRounds = 0
    presenter = null
    clockOverride = null
    pendingActions.clear()
}
