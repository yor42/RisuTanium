import type { UnitType } from './format'

/**
 * The save-pass meter of a measurement build: per encode pass the kind, whether the modules were encoded, how many
 * characters were encoded and the pass's wall time; per committed pass the identity and key of every unit the commit
 * wrote (a unit that was not reused). It exists only in a measurement build: `saveEncoder.ts` calls it only under
 * `if (MEASURE)`, so a normal build folds the calls away and drops this module and the global name with it.
 *
 * Use: set localStorage `risu-measure-savepass` to `on`, reload, and in the console of a store2 page call
 * `__risuSavePassMeter.last()`, `.all()`, `.units()` and `.reset()`. Every pass also reaches a `risu-measure-savepass`
 * console line, but the build strips `console.*` in every vite build, so that line exists only under `pnpm dev`; on a
 * measurement build the global is the only output.
 *
 * `ms` is the wall time of the whole planning pass, the waits at its yields included. It is not the longest
 * main-thread slice: the loop's budget decides whether a call to the pass's `yield` really yields, and the real
 * yield function is private to that budget, so a slice cannot be measured here without changing the loop. The slice
 * criterion is judged from a device trace.
 *
 * `units()` holds one record per committed pass, in commit order, written when the pass is acknowledged: only the
 * attempt that landed is recorded, and a plan that was never acknowledged leaves no record.
 *
 * The meter never throws into the save path: every entry point swallows its own failures.
 */

export type SavePassKind = 'rewriteAll' | 'whole' | 'tick' | 'edit'

export interface SavePassRecord {
    kind: SavePassKind
    /** Whether the pass encoded the modules. */
    modules: boolean
    /** How many characters the pass encoded. */
    characters: number
    ms: number
}

export interface SavePassUnitRecord {
    identity: string
    key: string
    type: UnitType
    bytes: number
}

export interface SavePassCommitRecord {
    kind: SavePassKind
    units: SavePassUnitRecord[]
}

export interface SavePassMeterHandle {
    last(): SavePassRecord | null
    all(): SavePassRecord[]
    units(): SavePassCommitRecord[]
    reset(): void
}

/** The part of a save request that decides the kind. */
export interface SavePassShape {
    whole: boolean
    rewriteAll?: boolean
    net?: object
}

/** The part of an encoded unit the meter reads. */
export interface MeteredUnit {
    identity: string
    key: string
    type: UnitType
    bytes: Uint8Array
    reused: boolean
}

const RECORD_LIMIT = 1000
const SWITCH_KEY = 'risu-measure-savepass'

const passes: SavePassRecord[] = []
const commits: SavePassCommitRecord[] = []

const handle: SavePassMeterHandle = {
    last: () => passes.length === 0 ? null : passes[passes.length - 1],
    all: () => [...passes],
    units: () => [...commits],
    reset: () => {
        passes.length = 0
        commits.length = 0
    },
}

function switchedOn(): boolean {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(SWITCH_KEY) === 'on'
    } catch {
        return false
    }
}

function installGlobal(target: object): void {
    ;(target as { __risuSavePassMeter?: SavePassMeterHandle }).__risuSavePassMeter = handle
}

function pushLimited<T>(ring: T[], record: T): void {
    ring.push(record)
    if (ring.length > RECORD_LIMIT) {
        ring.shift()
    }
}

/** The kind of a pass: a save-mine pass is `rewriteAll`, then a whole-resident pass, then an idle-net tick, else an edit. */
export function savePassKindOf(request: SavePassShape): SavePassKind {
    if (request.rewriteAll === true) {
        return 'rewriteAll'
    }
    if (request.whole) {
        return 'whole'
    }
    return request.net !== undefined ? 'tick' : 'edit'
}

/** The clock reading to hand to `finishSavePass`, or null when the meter is off or failed. Installs the global when on. */
export function startSavePass(target: object = globalThis): number | null {
    try {
        if (!switchedOn()) {
            return null
        }
        installGlobal(target)
        return performance.now()
    } catch {
        return null
    }
}

export function finishSavePass(started: number | null, request: SavePassShape, modules: boolean, characters: number): void {
    try {
        if (started === null) {
            return
        }
        const record: SavePassRecord = { kind: savePassKindOf(request), modules, characters, ms: performance.now() - started }
        pushLimited(passes, record)
        console.log('risu-measure-savepass', record)
    } catch {
        // A measurement failure never reaches the save.
    }
}

/** At acknowledge: the identity and key of every unit of the committed tree that was written. */
export function noteSavePassCommit(request: SavePassShape, units: readonly MeteredUnit[]): void {
    try {
        if (!switchedOn()) {
            return
        }
        const written: SavePassUnitRecord[] = []
        for (const unit of units) {
            if (!unit.reused) {
                written.push({ identity: unit.identity, key: unit.key, type: unit.type, bytes: unit.bytes.length })
            }
        }
        pushLimited(commits, { kind: savePassKindOf(request), units: written })
    } catch {
        // A measurement failure never reaches the save.
    }
}
