// The asset paths that the steps of one owner still name: the ids an owner keeps as a garbage-collection
// root so an Undo can find the files again. Pure. Each step's paths are computed once (a WeakMap on the
// step object) and an owner's set is kept up to date by diffing the step set by identity, so a call after
// one new step costs that step, not the whole history.

import { portraitPathNames, type OwnerRecord, type Step } from './historyModel'

// A step's named paths, each with the name of the first op that names it: `[name, path]`, in first-named order.
export type PathPair = readonly [string, string]

interface StepPaths {
    pairs: readonly PathPair[]
    paths: readonly string[]
}

const pathsOfStep = new WeakMap<Step, StepPaths>()

// The path of a row is its second element. Every asset op names at least one, and a portrait op names the stored files it
// adds or removes; nothing else names one. This is the one walk of
// "the paths a step names": the unsettled filter, the retained recompute and the toast's row name all read it.
function stepPathsOf(step: Step): StepPaths {
    const known = pathsOfStep.get(step)
    if (known) {
        return known
    }
    const found = new Map<string, string>()
    const note = (tuple: readonly string[]): void => {
        if (typeof tuple[1] === 'string' && !found.has(tuple[1])) {
            found.set(tuple[1], typeof tuple[0] === 'string' ? tuple[0] : '')
        }
    }
    for (const op of step.ops) {
        if (op.op === 'assetRowRemove' || op.op === 'assetRowInsert') {
            note(op.tuple)
        } else if (op.op === 'assetRowSet') {
            note(op.before)
            note(op.after)
        } else if (op.op === 'portraitSet') {
            // Only the stored files a portrait step adds or removes: a path that stays in the portrait is not at risk, and
            // a non-store string is never copied into the retained field.
            for (const [path, name] of portraitPathNames(op)) {
                if (!found.has(path)) {
                    found.set(path, name)
                }
            }
        }
    }
    const paths = [...found.keys()]
    const made: StepPaths = { pairs: paths.map((path): PathPair => [found.get(path) ?? '', path]), paths }
    pathsOfStep.set(step, made)
    return made
}

function stepPaths(step: Step): readonly string[] {
    return stepPathsOf(step).paths
}

// The `[name, path]` pairs the step names, each path once.
export function stepPathPairs(step: Step): readonly PathPair[] {
    return stepPathsOf(step).pairs
}

// The name a row went by in the first of `steps` that names `path`, for a line shown to the user; the path itself when
// no step names it.
export function nameOfPathIn(steps: readonly Step[], path: string): string {
    for (const step of steps) {
        for (const [name, named] of stepPathPairs(step)) {
            if (named === path) {
                return name === '' ? path : name
            }
        }
    }
    return path
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
