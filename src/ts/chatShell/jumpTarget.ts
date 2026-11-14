// The reader is at the bottom when the end of the conversation is within this distance. The same distance clears the new-reply count,
// so there is one rule for "at the bottom" on the button and the count. It is separate from the bottom follower's sub-pixel tolerance.
export const BOTTOM_PX = 100
export const TRAVEL_MS = 260
const CUT_SCREENS = 2
const BADGE_CAP = 99

export type ScrollMetrics = Pick<HTMLElement, 'scrollHeight' | 'clientHeight' | 'scrollTop'>

export function distanceFromEnd(host: ScrollMetrics): number {
    return host.scrollHeight - host.clientHeight - host.scrollTop
}

// A window that does not mount the newest message is never at the bottom of the conversation, whatever its own rows say.
export function isAtBottom(distance: number, slid: boolean): boolean {
    return !slid && distance <= BOTTOM_PX
}

export function isFar(distance: number, viewport: number, slid: boolean): boolean {
    return slid || distance > viewport
}

export interface LatestButtonState {
    atBottom: boolean
    far: boolean
    unread: boolean
    count: number
}

export function latestButtonVisible(state: LatestButtonState): boolean {
    return !state.atBottom && (state.far || state.unread || state.count > 0)
}

export function badgeText(count: number): string {
    return count > BADGE_CAP ? `${BADGE_CAP}+` : String(count)
}

// Replies are the character's messages; a message the reader sent never counts.
export function appendedReplies(messages: readonly { role: string }[], previousLength: number): number {
    let replies = 0
    for (let index = Math.max(0, previousLength); index < messages.length; index++) {
        if (messages[index]?.role === 'char') replies += 1
    }
    return replies
}

export interface TravelPlan {
    // The distance from the end to cut to before the glide, or null when the glide starts where the reader is.
    cutTo: number | null
    duration: number
}

export function travelPlan(input: { distance: number, viewport: number, reduced: boolean }): TravelPlan {
    if (input.reduced) return { cutTo: null, duration: 0 }
    const limit = CUT_SCREENS * input.viewport
    return { cutTo: input.distance > limit ? limit : null, duration: TRAVEL_MS }
}

export interface TravelDeps {
    requestFrame: (callback: () => void) => number
    cancelFrame: (id: number) => void
    now: () => number
    // The current position and the live end: the end is read again every frame because the content under the reader keeps growing.
    read: () => { top: number, end: number }
    write: (top: number) => void
    // Checked before every write; true ends the travel without writing.
    stop: () => boolean
}

export interface Travel {
    // `done` receives true when the travel reached the end and false when `stop` ended it. A cancelled travel never calls it.
    run: (duration: number, done: (completed: boolean) => void) => void
    cancel: () => void
}

export function createTravel(deps: TravelDeps): Travel {
    let frame: number | null = null
    let generation = 0
    function cancel(): void {
        generation += 1
        if (frame !== null) deps.cancelFrame(frame)
        frame = null
    }
    return {
        run: (duration, done) => {
            cancel()
            const mine = generation
            const from = deps.read().top
            const started = deps.now()
            const step = (): void => {
                frame = null
                if (mine !== generation) return
                if (deps.stop()) { done(false); return }
                const { end } = deps.read()
                const progress = duration > 0 ? Math.min(1, (deps.now() - started) / duration) : 1
                if (progress >= 1) {
                    deps.write(end)
                    done(true)
                    return
                }
                const eased = 1 - (1 - progress) * (1 - progress) * (1 - progress)
                deps.write(from + (end - from) * eased)
                frame = deps.requestFrame(step)
            }
            frame = deps.requestFrame(step)
        },
        cancel,
    }
}
