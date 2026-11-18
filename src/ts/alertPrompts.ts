import { get, writable, type Readable } from 'svelte/store'
import type { alertData } from './alert'
import { coversPage, escapeActionFor } from './alertEscape'
import { alertStore } from './stores.svelte'

/**
 * Prompts: the alerts whose caller waits for an answer. A prompt takes only its
 * own answer, never the close of another alert that covered it and never
 * another prompt's answer.
 *
 * `alertStore` keeps holding what is on screen. This module watches it and
 * keeps, beside it, the prompt that is current (shown, or covered by another
 * alert) and the prompts queued behind it in the order they were asked.
 * Nothing here touches `alertStore` at import: it is read or watched only when
 * a prompt is asked for or a caller asks about, or subscribes to, prompt state.
 *
 * The module also keeps the boot notices (`queueNotice`): informational alerts
 * shown one at a time, each staying current until the person closes it.
 */

/** How long an answer is discarded after a prompt appears on screen, however it got there: asked fresh, back from under a cover, or its turn arrived. */
export const ANSWER_GUARD_MS = 400

/**
 * A prompt is an alert that Escape leaves alone, bar `progress`. Total over `alertData['type']`, because the escape table is.
 * Re-classifying a type in the escape table also changes whether it counts as a prompt waiting for its own answer.
 */
export function isPromptType(type: alertData['type']): boolean {
    return type !== 'progress' && escapeActionFor(type) === 'ignore'
}

/** The prompts that defend their own place on screen (`tos`, `staleAccountNotice`). */
export function isConsentType(type: alertData['type']): boolean {
    return type === 'tos' || type === 'staleAccountNotice'
}

interface WaitingPrompt {
    data: alertData
    resolve: (answer: string) => void
    /** A `performance.now()` reading: an answer given before it is discarded and the prompt stays up. */
    guardUntil: number
}

let current: WaitingPrompt | null = null
let queue: WaitingPrompt[] = []
/** The last value this module saw on the store. */
let previous: alertData | null = null
let watching = false
let stopWatching: (() => void) | undefined
/** Boot notices not yet shown, in the order they were queued. */
let notices: string[] = []
/** The object last written to the store for the notice that is current; a notice is always written as a fresh object. */
let noticeCurrent: alertData | null = null
/** The text of the current notice (shown, or covered by another alert); null when none is current. */
let noticeText: string | null = null
let drainWaiters: Array<() => void> = []

const idleStore = writable(true)

/**
 * True while the store is `none`, no prompt is waiting and no boot notice is
 * current or queued. It is updated after
 * this module has processed each store value, so it never reports the
 * momentary `none` between a cover's close and its prompt's return, and a
 * reader of it does not depend on the order in which readers subscribed to the
 * store.
 */
export const alertIdle: Readable<boolean> = {
    subscribe(run, invalidate) {
        ensureWatching()
        return idleStore.subscribe(run, invalidate)
    },
}

function publishIdle(): void {
    idleStore.set(previous?.type === 'none' && current === null && queue.length === 0 && noticeText === null && notices.length === 0)
}

/** Puts the notice on screen as a fresh object, so that every show restarts the answer pause that keys check. */
function showNotice(text: string): void {
    noticeText = text
    noticeCurrent = { type: 'normal', msg: text }
    alertStore.set(noticeCurrent)
}

function settleDrainWaiters(): void {
    if (noticeText !== null || notices.length > 0) {
        return
    }
    const waiters = drainWaiters
    drainWaiters = []
    for (const resolve of waiters) {
        resolve()
    }
}

/** A cover the user has no way to close: a progress bar, or a wait notice without a Cancel. */
function isCloseless(value: alertData): boolean {
    return value.type === 'progress' || (value.type === 'wait' && !value.onCancel)
}

/** Puts a prompt on screen as one that has come back or reached its turn: answers are discarded for a moment. */
function show(prompt: WaitingPrompt): void {
    prompt.guardUntil = performance.now() + ANSWER_GUARD_MS
    alertStore.set(prompt.data)
}

/** Makes the first queued prompt current when nothing else is waiting. */
function advance(): void {
    if (current !== null || queue.length === 0) {
        return
    }
    if (isPromptType(get(alertStore).type)) {
        return
    }
    current = queue.shift()!
    show(current)
}

function onValue(value: alertData): void {
    const before = previous
    previous = value
    if (value.type === 'none') {
        if (current === null) {
            advance()
        } else if (before === current.data) {
            if (performance.now() < current.guardUntil) {
                alertStore.set(current.data)
            } else {
                const answered = current
                current = null
                answered.resolve(value.msg)
                advance()
            }
        } else {
            show(current)
        }
        // Only the person's close can write this `none` for the current notice: the code paths
        // refuse to close a notice that is on screen.
        if (noticeText !== null && before === noticeCurrent) {
            noticeText = null
            noticeCurrent = null
        }
        // The raw store is read because the prompt branch above may have put a prompt back.
        if (current === null && queue.length === 0 && get(alertStore).type === 'none') {
            const next = noticeText ?? notices.shift()
            if (next !== undefined) {
                showNotice(next)
            }
        }
        settleDrainWaiters()
    }
    publishIdle()
}

function ensureWatching(): void {
    if (watching) {
        return
    }
    watching = true
    stopWatching = alertStore.subscribe(onValue)
}

/**
 * Puts a prompt up and resolves with the `msg` of the `none` that answers it.
 * With no other prompt waiting it is the store's value when this returns,
 * replacing whatever notice was up. Otherwise it waits its turn.
 */
export function askPrompt(data: alertData): Promise<string> {
    ensureWatching()
    return new Promise<string>((resolve) => {
        const prompt: WaitingPrompt = { data, resolve, guardUntil: 0 }
        if (current === null && !isPromptType(get(alertStore).type)) {
            current = prompt
            // A press meant for whatever was on screen must not answer this prompt.
            prompt.guardUntil = performance.now() + ANSWER_GUARD_MS
            alertStore.set(data)
            return
        }
        queue.push(prompt)
        if (current !== null) {
            const shown = get(alertStore)
            if (shown !== current.data && isCloseless(shown)) {
                show(current)
            }
        }
        publishIdle()
    })
}

/**
 * Queues a boot notice: a `normal` alert that nothing waits for. Notices are shown one at a time in
 * the order queued, each until the person closes it. A notice is never overwritten by another
 * notice or dropped: when another alert covers it, it is shown again as a fresh object once the
 * cover closes, and while a prompt is waiting the notices wait behind it. It is shown at once over
 * nothing, or over a cover the person cannot close.
 */
export function queueNotice(msg: string): void {
    ensureWatching()
    const shown = get(alertStore)
    if (noticeText === null && notices.length === 0 && current === null && queue.length === 0
        && (shown.type === 'none' || isCloseless(shown))) {
        showNotice(msg)
    } else {
        notices.push(msg)
    }
    publishIdle()
}

/** Resolves once no notice is current or queued: the person has closed every one queued so far. */
export function noticesSettled(): Promise<void> {
    if (noticeText === null && notices.length === 0) {
        return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
        drainWaiters.push(resolve)
    })
}

/** Whether a queued notice is the value on screen right now. */
export function noticeShowing(): boolean {
    return noticeCurrent !== null && get(alertStore) === noticeCurrent
}

/**
 * Answers the prompt that is on screen right now with `message`, ignoring the answer guard for
 * this one write. Does nothing and returns false unless the raw store holds exactly the current
 * prompt's data object, so a prompt hidden under a cover, a consent alert and a notice are never
 * answered through it. The guard is restored when the write did not answer the prompt. With
 * `honourGuard` the answer is also discarded, and false returned, while the prompt is inside its guard.
 */
export function answerShownPrompt(message: string, honourGuard = false): boolean {
    const prompt = current
    if (prompt === null || get(alertStore) !== prompt.data) {
        return false
    }
    if (honourGuard && performance.now() < prompt.guardUntil) {
        return false
    }
    const guardUntil = prompt.guardUntil
    prompt.guardUntil = 0
    alertStore.set({ type: 'none', msg: message })
    if (current === prompt) {
        prompt.guardUntil = guardUntil
        return false
    }
    return true
}

/** Whether a prompt is waiting for its answer, shown or covered. */
export function promptWaiting(): boolean {
    return current !== null || queue.length > 0 || isPromptType(get(alertStore).type)
}

/** The one predicate for every key and Back path: a prompt is waiting, or an alert covers the page. A toast does not cover it. */
export function pageCovered(): boolean {
    return promptWaiting() || coversPage(get(alertStore).type)
}

/** Whether a prompt is the value on screen. */
export function promptShowing(): boolean {
    return isPromptType(get(alertStore).type)
}

/** Clears controller state between tests. */
export function resetAlertPromptsForTests(): void {
    stopWatching?.()
    stopWatching = undefined
    watching = false
    current = null
    queue = []
    previous = null
    notices = []
    noticeCurrent = null
    noticeText = null
    drainWaiters = []
    idleStore.set(true)
}
