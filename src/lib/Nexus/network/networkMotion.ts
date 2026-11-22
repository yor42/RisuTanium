import { resolveReducedMotion, type ReducedMotionMode } from 'src/ts/chatShell/motionPrefs.svelte'

export interface NetworkMotionInputs {
    /** The caller wants a still frame regardless of preferences (a phone or mid band). */
    still: boolean
    /** The app's Low power choice. */
    lowPower: boolean
    /** The app's Reduce motion choice: on, off or follow the system. */
    reducedMotion: ReducedMotionMode
    /** The OS reduced-motion query. */
    systemReduced: boolean
}

/**
 * Whether the lattice shows one still frame and runs no loop. The app's own choice beats the OS query in both
 * directions, the rule that drives the root's `rm` class.
 */
export function networkFrozen({ still, lowPower, reducedMotion, systemReduced }: NetworkMotionInputs): boolean {
    return still || lowPower || resolveReducedMotion(reducedMotion, systemReduced)
}
