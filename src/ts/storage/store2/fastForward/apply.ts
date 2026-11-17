import type { Step } from './prepare'

/**
 * The write half of the fast-forward, run in the same synchronous task as the prepare. Every step is journaled with its
 * undo; check A then verifies that each live value is what the decision wrote. On a failed check, or a throw, the journal
 * is undone in reverse and the database equals its value before the apply.
 */

export type ApplyResult = 'applied' | 'check-failed'

/** The apply the factory uses unless a test substitutes one (`createFastForward({ apply })`). */
export function realApply(steps: readonly Step[]): ApplyResult {
    const undo: Array<() => void> = []
    let verified = false
    try {
        for (const step of steps) {
            undo.push(step.apply())
        }
        verified = steps.every(step => step.verify())
    } finally {
        if (!verified) {
            for (const restore of undo.reverse()) {
                restore()
            }
        }
    }
    if (!verified) {
        return 'check-failed'
    }
    for (const step of steps) {
        step.after?.()
    }
    return 'applied'
}
