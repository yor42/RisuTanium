// The asset paths that the steps of one owner still name: the ids an owner keeps as a garbage-collection
// root so an Undo can find the files again. Pure. Each step's paths are computed once (a WeakMap on the
// step object) and an owner's set is kept up to date by diffing the step set by identity, so a call after
// one new step costs that step, not the whole history.

import type { OwnerRecord, Step } from './historyModel'

const pathsOfStep = new WeakMap<Step, readonly string[]>()

// The path of a row is its second element. Every asset op names at least one; nothing else names one.
function stepPaths(step: Step): readonly string[] {
    const known = pathsOfStep.get(step)
    if (known) {
        return known
    }
    const found = new Set<string>()
    for (const op of step.ops) {
        if (op.op === 'assetRowRemove' || op.op === 'assetRowInsert') {
            if (typeof op.tuple[1] === 'string') {
                found.add(op.tuple[1])
            }
        } else if (op.op === 'assetRowSet') {
            for (const tuple of [op.before, op.after]) {
                if (typeof tuple[1] === 'string') {
                    found.add(tuple[1])
                }
            }
        }
    }
    const paths = [...found]
    pathsOfStep.set(step, paths)
    return paths
}

// Every `done` and `undone` step of each record, as one identity set: a step held by two records is one
// member.
export function stepsOf(...records: readonly OwnerRecord[]): Set<Step> {
    const steps = new Set<Step>()
    for (const record of records) {
        for (const step of record.done) {
            steps.add(step)
        }
        for (const step of record.undone) {
            steps.add(step)
        }
    }
    return steps
}

// Whether the step names an asset path, so it is worth a retention root.
export function stepNamesAssetPath(step: Step): boolean {
    return stepPaths(step).length > 0
}

export interface RetainedPaths {
    // The sorted unique paths of `steps`. Steps that joined since the last call add their paths and steps
    // that left subtract theirs.
    update(steps: ReadonlySet<Step>): string[]
}

// One per owner: the reference count of each path over the steps seen by the last `update`.
export function createRetainedPaths(): RetainedPaths {
    let held = new Set<Step>()
    const counts = new Map<string, number>()
    let sorted: string[] | null = null
    return {
        update(steps) {
            for (const step of held) {
                if (!steps.has(step)) {
                    for (const path of stepPaths(step)) {
                        const left = (counts.get(path) ?? 0) - 1
                        if (left <= 0) {
                            counts.delete(path)
                        } else {
                            counts.set(path, left)
                        }
                    }
                    sorted = null
                }
            }
            for (const step of steps) {
                if (!held.has(step)) {
                    for (const path of stepPaths(step)) {
                        counts.set(path, (counts.get(path) ?? 0) + 1)
                    }
                    sorted = null
                }
            }
            held = new Set(steps)
            sorted ??= [...counts.keys()].sort()
            return [...sorted]
        },
    }
}

// The same union, from scratch, for a caller that keeps no per-owner state.
export function retainedPathsOf(steps: ReadonlySet<Step>): string[] {
    return createRetainedPaths().update(steps)
}
