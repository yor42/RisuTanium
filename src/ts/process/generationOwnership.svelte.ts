/**
 * State shared by the modules that start, hold and cancel a generation: the
 * composer's action window, the abort controller of the one send in progress,
 * and the count of turns that auto mode reads. It imports
 * nothing, so `index.svelte.ts` and every module that imports it can depend on
 * it without a cycle.
 *
 * `doingChat` stays in `index.svelte.ts`. A starter is busy while that flag is
 * set or while `isComposerWindowOpen()` is true.
 */

let windowOpen = $state(false)

/** The chat the open window belongs to; null while it is closed or was opened without one. */
let windowOrigin = $state<{ chaId: string, chatId: string } | null>(null)

/**
 * True from the composer Send's take until its hand-off returns, for the whole
 * of a reroll or unreroll, and for a whole auto-mode run. Reactive: the Send
 * button's template reads it.
 */
export function isComposerWindowOpen(): boolean {
    return windowOpen
}

/**
 * Opens or closes the window. `origin` names the chat the window is held for;
 * closing always clears it.
 */
export function setComposerWindow(open: boolean, origin?: { chaId: string, chatId: string }): void {
    windowOpen = open
    windowOrigin = open && origin ? { chaId: origin.chaId, chatId: origin.chatId } : null
}

/**
 * True while the window is open for this chat. A window opened without an
 * origin belongs to no chat. Reactive, like `isComposerWindowOpen`.
 */
export function composerWindowFor(target: { chaId: string, chatId: string }): boolean {
    return windowOpen && windowOrigin !== null
        && windowOrigin.chaId === target.chaId && windowOrigin.chatId === target.chatId
}

let replyVersion = $state(0)
let replyVersionCount = 0

/**
 * Bumped whenever a reply or preview registration starts or ends, and only
 * then, so a reader of `readReplyVersion()` re-runs exactly when the set of
 * writing chats changes. Takes, trees and commands never bump it. The bump
 * only writes, so a send started inside an effect does not subscribe that
 * effect to the version.
 */
export function bumpReplyVersion(): void {
    replyVersion = ++replyVersionCount
}

export function readReplyVersion(): number {
    return replyVersion
}

let unitController: AbortController | null = null
let unitTarget: { chaId: string, chatId: string } | null = null

/**
 * Publishes the abort controller of the send that has just taken the flag,
 * with the chat it belongs to (the owner's id and the chat's id, the
 * keep-alive notice target). Only those two fields are kept, never a
 * group member's id.
 */
export function publishUnit(controller: AbortController, origin?: { chaId: string, chatId: string }): void {
    unitController = controller
    unitTarget = origin ? { chaId: origin.chaId, chatId: origin.chatId } : null
}

/** Withdraws `controller` and its target if it is still the published one. */
export function releaseUnit(controller: AbortController): void {
    if(unitController === controller){
        unitController = null
        unitTarget = null
    }
}

/**
 * Whether `signal` is the published send unit's own signal. The native
 * request layer marks a request exactly then, so the chat's Stop (a
 * notification tap while the page is frozen) may cancel it natively. A signal
 * derived from the unit's is not the unit's, so a derived signal is never
 * marked (MC-1435).
 */
export function isUnitInProgressSignal(signal?: AbortSignal | null): boolean {
    return signal != null && unitController !== null && unitController.signal === signal
}

/** A copy of the published unit's chat target when `signal` is the unit's own, else null. */
export function unitTargetOfSignal(signal?: AbortSignal | null): { chaId: string, chatId: string } | null {
    if(!isUnitInProgressSignal(signal) || unitTarget === null){
        return null
    }
    return { ...unitTarget }
}

/** Aborts the send in progress, if any. */
export function abortUnitInProgress(): void {
    unitController?.abort()
}

let turnsReached = 0

/**
 * Called by a send at the point where it has settled on the character it
 * speaks as, past a group's own dispatch and the member checks. Auto mode
 * compares the count before and after a tick to tell a tick that reached a
 * turn from one that did not.
 */
export function noteTurnReached(): void {
    turnsReached++
}

export function turnsReachedCount(): number {
    return turnsReached
}
