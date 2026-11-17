import type { Step } from './prepare'

/**
 * The write half of the fast-forward, run in the same synchronous task as the prepare. Every step is journaled with its
 * undo; check A then verifies that each live value is what the decision wrote. On a failed check, or a throw, the journal
 * is undone in reverse and the database equals its value before the apply.
 */

export type ApplyResult = 'applied' | 'check-failed'

/** An apply that kept its journal: `undo` restores the database as it was before the steps, whatever the later checks find. */
export interface AppliedJournal {
    result: ApplyResult
    undo: () => void
}

/**
 * Applies and verifies `steps`; it runs no `after` hook. A failed check or a throw undoes the journal. After an
 * `applied` result, `undo` still restores the database, for a check that runs later in the same synchronous task.
 */
export function applyVerified(steps: readonly Step[]): AppliedJournal {
    const undo: Array<() => void> = []
    const restoreAll = (): void => {
        for (const restore of undo.splice(0).reverse()) {
            restore()
        }
    }
    let verified = false
    try {
        for (const step of steps) {
            undo.push(step.apply())
        }
        verified = steps.every(step => step.verify())
    } finally {
        if (!verified) {
            restoreAll()
        }
    }
    return { result: verified ? 'applied' : 'check-failed', undo: restoreAll }
}

/** Runs the `after` hooks of `steps`, each caught: a hook that throws is reported and does not stop the others. */
export function runAfter(steps: readonly Step[]): void {
    for (const step of steps) {
        try {
            step.after?.()
        } catch (error) {
            console.error(error)
        }
    }
}

/** The apply the factory uses unless a test substitutes one (`createFastForward({ apply })`). */
export function realApply(steps: readonly Step[]): ApplyResult {
    const applied = applyVerified(steps)
    if (applied.result === 'applied') {
        runAfter(steps)
    }
    return applied.result
}
