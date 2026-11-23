// The risky flags of a character and of a module: switches that widen what the owner can do. Studio never turns one on
// without a confirmation, and the history service enforces that from the writes a plan would make, so the rule here is
// pure. `RISKY_FLAG_PATHS` is a behaviour table, not a persisted fact: the persisted facts of each path are its registry row.

import type { FieldValue, LiveReader, SetPath, WriteOp } from '../history/historyModel'

export const RISKY_FLAG_PATHS = ['lowLevelAccess', 'utilityBot', 'escapeOutput', 'moduleLowLevelAccess'] as const satisfies readonly SetPath[]
export type RiskyFlagPath = (typeof RISKY_FLAG_PATHS)[number]

// The flags of a character: its question sheet and its switches name these three.
export const CHARACTER_RISKY_FLAG_PATHS = ['lowLevelAccess', 'utilityBot', 'escapeOutput'] as const satisfies readonly RiskyFlagPath[]
export type CharacterRiskyFlagPath = (typeof CHARACTER_RISKY_FLAG_PATHS)[number]

export function isRiskyFlagPath(path: SetPath): path is RiskyFlagPath {
    return (RISKY_FLAG_PATHS as readonly SetPath[]).includes(path)
}

export function isCharacterRiskyFlagPath(path: SetPath): path is CharacterRiskyFlagPath {
    return (CHARACTER_RISKY_FLAG_PATHS as readonly SetPath[]).includes(path)
}

// Which write of a plan decides whether a path is turned on. `'lastWrite'` is allowed only for a holder that applies all of
// a plan's writes to one copy and assigns it once, so the engine never sees an intermediate value (a module). A holder
// written in place one write at a time takes `'anyWrite'`: an intermediate turn-on is live whatever the last write says.
// The mapped type makes a choice mandatory for every path added later.
export const RISKY_FLAG_RULE: { readonly [P in RiskyFlagPath]: 'anyWrite' | 'lastWrite' } = {
    lowLevelAccess: 'anyWrite',
    utilityBot: 'anyWrite',
    escapeOutput: 'anyWrite',
    moduleLowLevelAccess: 'lastWrite',
}

// The engine's reading of a flag value: stored `true`, or a truthy value of another type (a foreign reading), is on.
export function engineOn(value: FieldValue): boolean {
    return (value.had === true && value.value === true) || (value.had === 'foreign' && Boolean(value.value))
}

// The risky paths the writes would turn from not-on to on, in the order of the write that decides each and unique. A path
// is decided by any of its writes or by its last one, by `RISKY_FLAG_RULE`. A write of `true` over a live `true` turns
// nothing on, and neither does a write of `false` or of an absent value.
export function riskyTurnOnsOf(writes: readonly WriteOp[], live: LiveReader): SetPath[] {
    const found: SetPath[] = []
    const lastOf = new Map<SetPath, number>()
    writes.forEach((write, index) => {
        if (write.op === 'set' && isRiskyFlagPath(write.path)) {
            lastOf.set(write.path, index)
        }
    })
    writes.forEach((write, index) => {
        if (write.op !== 'set' || !isRiskyFlagPath(write.path) || found.includes(write.path)) {
            return
        }
        // Only the deciding write can name the path: its last `set`, or any `set` that reads on.
        const decides = RISKY_FLAG_RULE[write.path] !== 'lastWrite' || lastOf.get(write.path) === index
        if (decides && engineOn(write.value) && !engineOn(live.field(write.path))) {
            found.push(write.path)
        }
    })
    return found
}
