import type { ProgressSink } from './progressSink'
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

export interface TaskHandle {
    setStep(index: number): void
    setFile(index: number, total: number, name?: string): void
    readonly setCount: ProgressSink
    /** An open count: `done` saved of `found` so far. */
    readonly setFound: ProgressSink
    readonly setBytes: ProgressSink
    /**
     * True when Cancel is now locked and no cancel was requested: only then may the caller write.
     * False means the user pressed Cancel (`cancelRequested` is true) or the caller already ended the task.
     * A detached handle returns `!cancelRequested`, so a replacement never reads as a cancel.
     */
    lockCancel(reason?: string): boolean
    readonly cancelRequested: boolean
    /** True once the entry has left the slot: replaced by a newer task, closed or answered. */
    readonly detached: boolean
    settleCancel(summary?: readonly string[]): Promise<TaskCloseAnswer>
    finish(result: TaskResult): Promise<TaskCloseAnswer>
    fail(failure: TaskFailure): Promise<TaskCloseAnswer>
    /** Removes the card at once, whatever its state (the task counterpart of alertClear); resolves `closed`. */
    close(): void
}

interface Entry {
    readonly controller: TaskController
    readonly opener: HTMLElement | null
    readonly closed: Promise<TaskCloseAnswer>
    resolveClosed(answer: TaskCloseAnswer): void
    cancelRequested: boolean
    detached: boolean
    stopListening(): void
}

let entry: Entry | null = null
let shownView = $state.raw<TaskView | null>(null)
let clockOverride: TaskClock | null = null

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
    }
    target.controller.dispose()
    target.stopListening()
    target.resolveClosed(answer)
}

function currentOpener(): HTMLElement | null {
    if (typeof document === 'undefined') return null
    const active = document.activeElement
    return active instanceof HTMLElement && active !== document.body ? active : null
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
        cancelRequested: false,
        detached: false,
        stopListening: () => { },
    }
    const stopView = controller.subscribe((view) => {
        if (entry === self) shownView = view
    })
    const onVisibility = () => controller.flush()
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
    self.stopListening = () => {
        stopView()
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
    }
    entry = self
    shownView = controller.view

    return {
        setStep: (index) => { if (!self.detached) controller.setStep(index) },
        setFile: (index, total, name) => { if (!self.detached) controller.setFile(index, total, name) },
        setCount: (done, total) => { if (!self.detached) controller.setCount(done, total) },
        setFound: (done, found) => { if (!self.detached) controller.setFound(done, found) },
        setBytes: (done, total) => { if (!self.detached) controller.setBytes(done, total) },
        lockCancel: (reason) => (self.detached ? !self.cancelRequested : controller.lockCancel(reason)),
        get cancelRequested() {
            return self.cancelRequested
        },
        get detached() {
            return self.detached
        },
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
 * One Back press: cancels when Cancel is offered, holds while the task cannot be stopped, dismisses a result. Returns true
 * whenever a task is shown, so Back is consumed as a held `progress` alert consumes it.
 */
export function taskBackPress(): boolean {
    if (entry === null || shownView === null) return false
    if (isTaskTerminal(shownView.state)) answerTask({ kind: 'ok' })
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
    entry = null
    shownView = null
    clockOverride = null
    pendingActions.clear()
}
