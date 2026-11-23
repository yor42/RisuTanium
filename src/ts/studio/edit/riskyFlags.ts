// The risky flags of a character: switches that widen what the character can do. Studio never turns one on without a
// confirmation, and the history service enforces that from the writes a plan would make, so the rule here is pure.
// `RISKY_FLAG_PATHS` is a behaviour table, not a persisted fact: the persisted facts of each path are its registry row.

import type { FieldValue, LiveReader, SetPath, WriteOp } from '../history/historyModel'

export const RISKY_FLAG_PATHS = ['lowLevelAccess', 'utilityBot', 'escapeOutput'] as const satisfies readonly SetPath[]
export type RiskyFlagPath = (typeof RISKY_FLAG_PATHS)[number]

export function isRiskyFlagPath(path: SetPath): path is RiskyFlagPath {
    return (RISKY_FLAG_PATHS as readonly SetPath[]).includes(path)
}

function isOn(value: FieldValue): boolean {
    return value.had && value.value === true
}

// The risky paths the writes would turn from not-on to on, in write order and unique. A write of `true` over a live
// `true` turns nothing on, and neither does a write of `false` or of an absent value.
export function riskyTurnOnsOf(writes: readonly WriteOp[], live: LiveReader): SetPath[] {
    const found: SetPath[] = []
    for (const write of writes) {
        if (write.op === 'set' && isRiskyFlagPath(write.path) && isOn(write.value) && !isOn(live.field(write.path)) && !found.includes(write.path)) {
            found.push(write.path)
        }
    }
    return found
}
