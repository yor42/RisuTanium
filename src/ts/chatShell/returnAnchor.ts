// The transcript host's native scroll anchoring is switched off while the chat surface is hidden and for a short while after it returns.
// Un-hiding the surface lays the rows out again, and anchoring would then move the reader on its own; the list restores the position itself.
// The hold is never permanent: reading upward through rows that have not rendered yet, and late resolves above the reader, need anchoring `auto`.
import type { JumpOrigin } from './jumpTarget'

// Animation frames to wait after the return has settled before anchoring is switched back on.
export const RETURN_HOLD_RELEASE_FRAMES = 2

const ANCHOR_PROPERTY = 'overflow-anchor'

export interface ReturnAnchorHoldDeps {
    host: () => HTMLElement | undefined
    // True while a step hold runs: it suppresses anchoring itself, so the return hold must not end under it.
    held: () => boolean
    requestFrame: (callback: () => void) => number
    cancelFrame: (id: number) => void
    // Frames to wait before the release; defaults to `RETURN_HOLD_RELEASE_FRAMES`.
    frames?: number
}

export interface ReturnAnchorHold {
    // Suppresses anchoring on the host and ends any pending release. Returns the id of this engagement.
    engage: () => number
    // Sets the suppression again while engaged: a step hold's frame pass may have removed it while the surface was hidden.
    reassert: () => void
    // True only for the latest engagement; a later `engage` or `dispose` makes every earlier id stale.
    isCurrent: (id: number | null) => boolean
    // Ends the suppression after the configured frames, and then only while no step hold is in flight. A stale id or a missing engagement does nothing.
    releaseAfterFrames: (id: number | null) => void
    // Ends the suppression at once and cancels a pending release; nothing happens when the hold never engaged.
    dispose: () => void
}

export function createReturnAnchorHold(deps: ReturnAnchorHoldDeps): ReturnAnchorHold {
    const frames = deps.frames ?? RETURN_HOLD_RELEASE_FRAMES
    let latest = 0
    let engaged = false
    let applied: HTMLElement | null = null
    let pending: number | null = null

    // Always writes the value: a step hold may have removed the property from the element this hold still remembers.
    function apply(): void {
        const host = deps.host()
        if (!host) return
        if (applied !== null && applied !== host) applied.style.removeProperty(ANCHOR_PROPERTY)
        host.style.setProperty(ANCHOR_PROPERTY, 'none')
        applied = host
    }
    function remove(): void {
        applied?.style.removeProperty(ANCHOR_PROPERTY)
        applied = null
        engaged = false
    }
    function cancelPending(): void {
        if (pending === null) return
        deps.cancelFrame(pending)
        pending = null
    }
    // Counts down one frame at a time, then keeps waiting one frame at a time while a step hold is in flight.
    function wait(remaining: number): void {
        if (remaining <= 0 && !deps.held()) { remove(); return }
        pending = deps.requestFrame(() => { pending = null; wait(remaining - 1) })
    }

    return {
        engage: () => {
            cancelPending()
            latest += 1
            engaged = true
            apply()
            return latest
        },
        reassert: () => { if (engaged) apply() },
        isCurrent: (id) => id !== null && id === latest,
        releaseAfterFrames: (id) => {
            if (!engaged || id === null || id !== latest) return
            cancelPending()
            wait(frames)
        },
        dispose: () => {
            cancelPending()
            // Every earlier id is stale from here on.
            latest += 1
            if (engaged) remove()
        },
    }
}

// What the list remembers at the hide about where the reader was.
export interface ReturnRecord {
    // The message at the top of the screen and its offset; null when no message row could be identified.
    origin: JumpOrigin | null
    // The reader was following the newest message at the hide: auto-scroll on, the follower engaged and resting at the exact end with the newest row mounted.
    // A reader at the exact end whom the app does not follow is not `atEnd`, so a reply that arrived meanwhile does not move them.
    atEnd: boolean
    // The host's scroll position at the hide; the way back only when no message could be identified and the rows were rebuilt.
    pixel: number | null
    // The window key of the chat that was open; a different chat at the return is not restored.
    owner: string
}

export interface BeginReturnInput {
    record: ReturnRecord | null
    ownerNow: string
    rebuilt: boolean
    // The return replaced the window with a smaller page size.
    lowered: boolean
    // A deferred jump or a ScrollToMessage request waits at the return and owns the position.
    waiting: boolean
}

export interface BeginReturnResult {
    restorable: boolean
    // The page-size reset is left to the single exit, which applies it unless the restore landed.
    deferBump: boolean
}

// Decided synchronously in the return, before anything is restored.
export function beginReturn(input: BeginReturnInput): BeginReturnResult {
    const { record } = input
    if (!record || record.owner !== input.ownerNow || input.waiting) return { restorable: false, deferBump: false }
    const restorable = record.atEnd || record.origin !== null || (input.rebuilt && record.pixel !== null)
    return { restorable, deferBump: input.lowered && !record.atEnd && record.origin !== null }
}

export type ReturnPlan =
    | { kind: 'none' }
    | { kind: 'newest' }
    // The anchor message is mounted: put it back at its offset; `settle` is set when the rows were rebuilt, so their sizes are real first.
    | { kind: 'align', index: number, offset: number, settle: boolean }
    // The anchor message is not mounted: reload the window around it the way a jump does.
    | { kind: 'jump', index: number, offset: number }
    | { kind: 'pixel', top: number }

export interface ReturnPlanInput {
    record: ReturnRecord | null
    rebuilt: boolean
    length: number
    mounted: (index: number) => boolean
}

// Decided after the return's flush, over the rows that are mounted by then.
export function returnPlan(input: ReturnPlanInput): ReturnPlan {
    const { record } = input
    if (!record) return { kind: 'none' }
    if (record.atEnd) return { kind: 'newest' }
    if (record.origin !== null) {
        const index = Math.max(-1, Math.min(record.origin.index, input.length - 1))
        const offset = record.origin.offset
        return input.mounted(index) ? { kind: 'align', index, offset, settle: input.rebuilt } : { kind: 'jump', index, offset }
    }
    if (input.rebuilt && record.pixel !== null) return { kind: 'pixel', top: record.pixel }
    return { kind: 'none' }
}

export type ReturnOutcome = 'landed' | 'jumpBlocked' | 'jumpOutOfRange' | 'jumpCancelled' | 'skipped' | 'failed'

export interface FallbackRestInput {
    // The return left the page-size reset to the single exit.
    deferred: boolean
    outcome: ReturnOutcome
    readerActed: boolean
    // A newer jump took over the position.
    overtaken: boolean
    chatChanged: boolean
    // A newer hide took over the visit.
    superseded: boolean
}

// Whether the deferred page-size reset still has to rest the reader at the newest message.
export function fallbackRest(input: FallbackRestInput): boolean {
    return input.deferred && input.outcome !== 'landed' && !input.readerActed && !input.overtaken && !input.chatChanged && !input.superseded
}
