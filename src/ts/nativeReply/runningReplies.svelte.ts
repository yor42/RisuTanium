/**
 * The replies the native side is still receiving for a chat this page does not hold: after a reload the page has lost the
 * request that started them, so the reconcile pass lists them and publishes them here for the two surfaces that say so
 * (the note on an interrupted message and the status of a chat with no message for the key).
 *
 * The map is memory only. Every reader reads `version` first, and every publish that changes a key or a key's target bumps
 * it, so a reader re-runs when a target is learned later than the key.
 */

export interface RunningReplyTarget {
    chaId: string
    chatId: string
    name: string
}

/** `null`: the key is running but the listing carried no readable target, so it matches no chat. */
export interface RunningReplyEntry {
    key: string
    target: RunningReplyTarget | null
}

const running = new Map<string, RunningReplyTarget | null>()
const waitingForUnit = new Set<string>()
let version = $state(0)

function sameTarget(a: RunningReplyTarget | null | undefined, b: RunningReplyTarget | null | undefined): boolean {
    if (!a || !b) {
        return !a && !b
    }
    return a.chaId === b.chaId && a.chatId === b.chatId && a.name === b.name
}

/** Whether the latest pass found this key still being received elsewhere, or waiting for a send to end. */
export function isNativeReplyRunning(key: string | undefined): boolean {
    void version
    return key !== undefined && running.has(key)
}

/**
 * The first running reply targeting this chat that has no message in it yet; null when there is none. A key whose message
 * exists is shown on that message instead, never here.
 */
export function runningReplyInChat(
    chaId: string | undefined,
    chatId: string | undefined,
    messages: ReadonlyArray<{ chatId?: string }> | undefined,
): { name: string } | null {
    void version
    if (chaId === undefined || chatId === undefined) {
        return null
    }
    for (const [key, target] of running) {
        if (target && target.chaId === chaId && target.chatId === chatId && !(messages ?? []).some((message) => message.chatId === key)) {
            return { name: target.name }
        }
    }
    return null
}

/** Adds entries; a key already present keeps a known target over a null one and publishes a changed target. */
export function addRunningReplies(entries: readonly RunningReplyEntry[]): void {
    let changed = false
    for (const { key, target } of entries) {
        if (!running.has(key)) {
            running.set(key, target)
            changed = true
        } else if (!sameTarget(running.get(key), target) && target !== null) {
            running.set(key, target)
            changed = true
        }
    }
    if (changed) {
        version++
    }
}

/** Replaces the map with the entries of one pass. */
export function setRunningReplies(entries: readonly RunningReplyEntry[]): void {
    const next = new Map<string, RunningReplyTarget | null>()
    for (const { key, target } of entries) {
        next.set(key, target)
    }
    let changed = next.size !== running.size
    if (!changed) {
        for (const [key, target] of next) {
            if (!running.has(key) || !sameTarget(running.get(key), target)) {
                changed = true
                break
            }
        }
    }
    if (!changed) {
        return
    }
    running.clear()
    for (const [key, target] of next) {
        running.set(key, target)
    }
    version++
}

/** A recovered reply waited for a send to end: the key stays running until the pass that places it. */
export function noteWaitingForUnit(key: string): void {
    waitingForUnit.add(key)
}

export function takeWaitingForUnit(key: string): boolean {
    return waitingForUnit.delete(key)
}

export function resetRunningRepliesForTests(): void {
    running.clear()
    waitingForUnit.clear()
    version++
}
