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

const idleStore = writable(true)

/**
 * True while the store is `none` and no prompt is waiting. It is updated after
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
    idleStore.set(previous?.type === 'none' && current === null && queue.length === 0)
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
    idleStore.set(true)
}
