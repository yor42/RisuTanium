import type { BottomFollower } from './bottomAnchor'

// The window of mounted rows is the newest row down to an oldest position. A pin freezes that oldest position while an
// alternative step swaps the reply chain, so a shorter or longer chain neither mounts older rows above the reader nor
// unmounts the row the reader is on. The first message counts as position -1: row 0 and the first message are both mounted.

// The first mounted row counts down from the fold target when the chat is folded, else from the newest message.
export function windowStart(foldIndex: number, length: number): number {
    return foldIndex >= 0 ? foldIndex : length - 1
}

// The oldest mounted position of the current window: -1 when the first message is mounted, else the oldest row index.
export function windowPin(start: number, loadPages: number, length: number): number {
    return length <= loadPages ? -1 : Math.max(0, start - loadPages)
}

export function windowEnd(start: number, loadPages: number, pin: number | null): number {
    return pin !== null ? Math.max(0, pin) : Math.max(0, start - loadPages)
}

export function firstMessageMounted(length: number, loadPages: number, pin: number | null): boolean {
    return pin !== null ? pin === -1 : length <= loadPages
}

// The page count that gives the unpinned window the same oldest position as the pin, so releasing the pin changes no mounted row.
// A pin of -1 never lowers the count (a very large window stays large); a pin of 0 or more is exact, because any larger count
// would mount rows older than the one the reader holds.
export function pagesForPin(start: number, length: number, loadPages: number, pin: number): number {
    return pin === -1 ? Math.max(loadPages, length) : Math.max(0, start - pin)
}

// Moves smaller than this are layout rounding, not a shift to correct.
const POSITION_EPSILON = 0.5

// Runs one alternative step for the row at `idx` (-1 is the first message) and resolves once the step has settled.
export type StepRowRunner = (idx: number, step: () => Promise<void> | void) => Promise<void>

export interface StepHoldDeps {
    host: () => HTMLElement | undefined
    // False while the chat surface is hidden: the step runs and nothing is held.
    active: () => boolean
    follower: () => Pick<BottomFollower, 'isFollowing' | 'release' | 'sync'> | undefined
    // The element that holds the rows. While a hold runs it gets a bottom padding as large as the scrolled extent, so a step that
    // briefly lays out fewer rows than before cannot clamp the correcting write; the padding leaves the rows' tops unchanged.
    content?: () => HTMLElement | undefined
    newestIndex: () => number
    // The pin lives in the list's reactive state, so the rendered window follows it.
    pin: () => number | null
    setPin: (pin: number | null) => void
    // The pin for the window as currently mounted, read from state and never from the DOM.
    windowPin: () => number
    // Releases the held pin: raises or lowers the page count so the window keeps the pinned oldest position, then clears the pin.
    commitPin: (held: number) => void
    row: (idx: number) => HTMLElement | null
    // Counts reader-intent events; a changed count means the reader moved the view after the hold started.
    intentSeq: () => number
    tick: () => Promise<void>
    requestFrame: (callback: () => void) => number
    cancelFrame: (id: number) => void
}

export interface StepHold {
    run: StepRowRunner
    isInFlight: () => boolean
    // Drops every pending hold without committing: the list is going away or now shows another chat.
    cancel: () => void
}

const ANCHOR_PROPERTY = 'overflow-anchor'
const RESERVE_PROPERTY = 'padding-bottom'

// Holds the stepped row on screen. The step changes heights around the row; the hold measures the row's top before and after
// and moves scrollTop by the difference, once after the step has rendered (before the next paint) and once more in the next
// frame. While a hold runs the transcript's native scroll anchoring is suppressed with an inline declaration and its scroll
// range is kept, so the hold is the only owner of the position; both are removed on every exit. A reader who is following
// the newest message is not held while the stepped row stays the newest: the follower keeps the bottom. A step that leaves
// newer messages after the stepped row ends following and the hold owns the position from then on.
export function createStepHold(deps: StepHoldDeps): StepHold {
    let generation = 0
    let pendingFrame: number | null = null
    let inFlight = false
    let suppressed: HTMLElement | null = null
    let reserved: HTMLElement | null = null

    function suppress(host: HTMLElement): void {
        if (suppressed === host) return
        suppressed?.style.removeProperty(ANCHOR_PROPERTY)
        host.style.setProperty(ANCHOR_PROPERTY, 'none')
        suppressed = host
    }
    function reserve(extent: number): void {
        const content = deps.content?.()
        if (!content || reserved === content) return
        reserved?.style.removeProperty(RESERVE_PROPERTY)
        content.style.setProperty(RESERVE_PROPERTY, `${extent}px`)
        reserved = content
    }
    function unsuppress(): void {
        suppressed?.style.removeProperty(ANCHOR_PROPERTY)
        suppressed = null
        reserved?.style.removeProperty(RESERVE_PROPERTY)
        reserved = null
    }
    function cancelPendingFrame(): void {
        if (pendingFrame === null) return
        deps.cancelFrame(pendingFrame)
        pendingFrame = null
    }
    function commit(): void {
        const held = deps.pin()
        if (held !== null) deps.commitPin(held)
    }
    function topOf(host: HTMLElement, idx: number): number | null {
        const row = deps.row(idx)
        return row ? row.getBoundingClientRect().top - host.getBoundingClientRect().top : null
    }
    function correct(host: HTMLElement, idx: number, before: number | null): void {
        if (before === null) return
        const after = topOf(host, idx)
        if (after === null) return
        const delta = after - before
        if (Math.abs(delta) > POSITION_EPSILON) host.scrollTop += delta
    }

    async function run(idx: number, step: () => Promise<void> | void): Promise<void> {
        const host = deps.host()
        if (!host || !deps.active()) {
            await step()
            return
        }
        const mine = ++generation
        cancelPendingFrame()
        let completed = false
        try {
            const follower = deps.follower()
            // A step on a row that is not the newest holds that row even for a reader who was following.
            if (follower && follower.isFollowing() && idx < deps.newestIndex()) follower.release()
            let following = follower?.isFollowing() ?? false
            inFlight = true
            suppress(host)
            const intentAtStart = deps.intentSeq()
            // The pin and the row's top are taken even for a following reader: the step may leave newer messages after the row.
            const tookPin = deps.pin() === null
            if (tookPin) deps.setPin(deps.windowPin())
            const extent = host.scrollHeight
            const before = topOf(host, idx)
            if (!following) reserve(extent)
            await step()
            if (following && mine === generation) {
                if (follower && deps.newestIndex() > idx) {
                    // Newer messages follow the stepped row now. The follower leaves before the DOM update so its resize write cannot move the row.
                    follower.release()
                    following = false
                    reserve(extent)
                } else if (tookPin) {
                    deps.setPin(null)
                }
            }
            await deps.tick()
            // A later hold owns the pin, the suppression and the frame pass.
            if (mine !== generation) {
                completed = true
                return
            }
            commit()
            if (!following) correct(host, idx, before)
            pendingFrame = deps.requestFrame(() => {
                pendingFrame = null
                if (mine !== generation) return
                if (!following && deps.intentSeq() === intentAtStart) correct(host, idx, before)
                unsuppress()
                inFlight = false
                deps.follower()?.sync()
            })
            completed = true
        } finally {
            // Only a failed step lands here with work undone; a finished hold leaves the suppression to its frame pass.
            if (!completed && mine === generation) {
                commit()
                unsuppress()
                inFlight = false
                cancelPendingFrame()
            }
        }
    }

    return {
        run,
        isInFlight: () => inFlight,
        cancel: () => {
            generation += 1
            cancelPendingFrame()
            unsuppress()
            inFlight = false
            deps.setPin(null)
        },
    }
}
