/**
 * The arm guard of a control that must ignore input right after it appears. A tap counts by its own event time: under
 * input lag the click of a tap made before arming can be dispatched after the arming timer fired. The component keeps
 * the timer and sets `armed`; the time threshold is a second condition, so a click stamped on another clock origin is
 * never accepted earlier than the timer allows.
 */
export interface ArmGuard {
    /** Called by the component's timer once the delay has passed. */
    arm(): void
    /** Whether a click with this event time may act. */
    accepts(timeStamp: number): boolean
}

/** `now` is `performance.now()` when the guard starts; `delay` is in milliseconds. */
export function createArmGuard(now: number, delay: number): ArmGuard {
    const armAt = now + delay
    let armed = false
    return {
        arm() {
            armed = true
        },
        accepts(timeStamp) {
            return armed && timeStamp >= armAt
        },
    }
}
