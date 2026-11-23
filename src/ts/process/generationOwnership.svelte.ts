import { SvelteMap, SvelteSet } from 'svelte/reactivity'

/**
 * State shared by the modules that start, hold and cancel a generation: the
 * composer's action window, the tags that mark a send's requests for the
 * native chat Stop (no abort role), the per-chat count of turns that auto mode
 * reads and the per-chat progress stage. It imports no repository module, so
 * `index.svelte.ts` and every module that imports it can depend on it without
 * a cycle.
 *
 * `doingChat` stays in `index.svelte.ts`. Starters refuse per chat through
 * `sendAdmission.starterRefusalIn`; `doingChat` and `isComposerWindowOpen()`
 * remain the "any" readers.
 */

/** One open composer window: the chat it is held for, never an active unit. */
interface WindowEntry {
    readonly target: { chaId: string, chatId: string }
}

/** The handle `openComposerWindow` returns; closing is idempotent and removes this window only. */
export interface ComposerWindow {
    close(): void
}

const composerWindows = new SvelteSet<WindowEntry>()

/**
 * True while any composer window is open: from a composer Send's take until
 * its hand-off returns, for the whole of a reroll or unreroll, and for a whole
 * auto-mode run. Reactive: the Send button's template reads it.
 */
export function isComposerWindowOpen(): boolean {
    return composerWindows.size > 0
}

/**
 * Opens a window held for `origin`'s chat. Several windows may be open at once;
 * each handle closes its own and nothing else, however often it is closed.
 */
export function openComposerWindow(origin: { chaId: string, chatId: string }): ComposerWindow {
    const entry: WindowEntry = { target: { chaId: origin.chaId, chatId: origin.chatId } }
    composerWindows.add(entry)
    return { close: () => { composerWindows.delete(entry) } }
}

/** True while at least one window is open for this chat. Reactive, like `isComposerWindowOpen`. */
export function composerWindowFor(target: { chaId: string, chatId: string }): boolean {
    for(const entry of composerWindows){
        if(entry.target.chaId === target.chaId && entry.target.chatId === target.chatId){
            return true
        }
    }
    return false
}

/** Test-only: drops every open window. Never called from production code. */
export function resetComposerWindowsForTests(): void {
    composerWindows.clear()
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

/**
 * Tags of the published sends, by the send's own signal. The store only marks
 * requests for the native chat Stop; it never aborts anything. It is weak and
 * cannot be enumerated, so no reader can count it as "busy", and an entry
 * left behind by a send that threw before its release dies with its signal.
 */
const unitTargets = new WeakMap<AbortSignal, { chaId: string, chatId: string } | null>()

/**
 * Publishes the send that has just taken the flag, with the chat it belongs
 * to (the owner's id and the chat's id, the keep-alive notice target). Only
 * those two fields are kept, never a group member's id.
 */
export function publishUnit(controller: AbortController, origin?: { chaId: string, chatId: string }): void {
    unitTargets.set(controller.signal, origin ? { chaId: origin.chaId, chatId: origin.chatId } : null)
}

/** Withdraws `controller`'s own entry; every other published unit stays. */
export function releaseUnit(controller: AbortController): void {
    unitTargets.delete(controller.signal)
}

/**
 * Whether `signal` is a published send unit's own signal. The native request
 * layer marks a request exactly then, so the chat's Stop (a notification tap
 * while the page is frozen) may cancel it natively. A signal derived from the
 * unit's is not the unit's, so a derived signal is never marked (MC-1435).
 */
export function isUnitInProgressSignal(signal?: AbortSignal | null): boolean {
    return signal != null && unitTargets.has(signal)
}

/** A copy of the chat target of the published unit `signal` belongs to, else null. */
export function unitTargetOfSignal(signal?: AbortSignal | null): { chaId: string, chatId: string } | null {
    if(signal == null){
        return null
    }
    const target = unitTargets.get(signal)
    return target ? { ...target } : null
}

const turnsReached = new Map<string, number>()

function chatKey(target: { chaId: string, chatId: string }): string {
    return JSON.stringify([target.chaId, target.chatId])
}

/**
 * Called by a send at the point where it has settled on the character it
 * speaks as, past a group's own dispatch and the member checks, keyed by the
 * chat the send belongs to. Auto mode compares its own chat's count before
 * and after a tick to tell a tick that reached a turn from one that did not.
 */
export function noteTurnReached(target: { chaId: string, chatId: string }): void {
    const key = chatKey(target)
    turnsReached.set(key, (turnsReached.get(key) ?? 0) + 1)
}

export function turnsReachedCount(target: { chaId: string, chatId: string }): number {
    return turnsReached.get(chatKey(target)) ?? 0
}

const processStages = new SvelteMap<string, number>()

/** Sets the progress stage of the send that belongs to `target`; other chats keep theirs. */
export function setProcessStage(target: { chaId: string, chatId: string }, stage: number): void {
    processStages.set(chatKey(target), stage)
}

/**
 * The progress stage of `target`'s send, 0 for no chat or a chat that has
 * none. Reactive, like the store it replaces.
 */
export function processStageIn(target: { chaId: string, chatId: string } | null): number {
    return target ? processStages.get(chatKey(target)) ?? 0 : 0
}
