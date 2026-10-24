import { MEASURE } from '../process/memory/measureFlag'
import { inFlightKinds, subscribeInFlight, type InFlightKind } from '../process/inFlightWork'

/**
 * The signal counters of a measurement build (CHORE-205 counter experiment). Per character it counts the three
 * sources that could tell the idle net "this character changed": `api` (`markCharacterForSave`), `identity` (the
 * identity tracker saw a replaced character) and `part` (a selected-character partition effect ran for it). A
 * `markChanged` that no partition tag preceded is a global edit and counts under `partGlobal`; the very first run of an
 * effect under `partFirst`. The counts are cumulative and each lane keeps the `performance.now()` of its latest event,
 * which is all the offline classification needs: whether any event fell between two instants is `lastAt` against the
 * first instant.
 *
 * This module is imported at runtime only by `characterSaveMarks.ts` and `dbChangeEffects.svelte.ts`, and every call
 * sits under `if (MEASURE)`, so a normal build folds the calls away and drops the module. The `saveLoop` chunk must not
 * import it: it reaches this module only through the `globalThis.__risuNetSignals` handle that `ensureInstalled`
 * publishes, and `store2/savePassMeter.ts` types that handle with an `import type`. Two modules, one per chunk, because
 * one module imported from both chunks is hoisted into a shared chunk that keeps its exports in a release build.
 *
 * Use: set localStorage `risu-measure-savepass` to `on`, reload, and read `__risuNetSignals.dump()` for the cumulative
 * counters; the per-slot records are `__risuSavePassMeter.signalSlots()` and `.signalAcks()`. The switch is read once,
 * in `ensureInstalled`, and the cached value gates every note function, so no event handler reads storage. Nothing is
 * counted before `ensureInstalled` has run (a mark made before the loop starts has no baseline anyway).
 *
 * Known leak (6b-front): the front effect can throw between its partition tag and its `markChanged`; the stale tag then
 * books the next global `markChanged(true)` as `part` for the selected character. That leans toward `marked`, the safe
 * direction. It is counted in `tagOverwritten` only when the next consumer is another partition run, so a leak that a
 * global call consumes is not counted.
 *
 * The meter never throws into the caller: every entry point swallows its own failures. All state is created on first
 * use, not at module load: a top-level call is a side effect that keeps this module in a normal build.
 */

export type SignalKind = 'api' | 'identity' | 'part'

export interface SignalLane {
    /** Cumulative count of events. */
    n: number
    /** `performance.now()` of the latest event; 0 when there was none. */
    lastAt: number
}

export type CharSignals = Record<SignalKind, SignalLane>

export interface SignalGlobals {
    input: number
    winMsg: number
    winMsgForeign: number
    inFlight: number
    /** A `markChanged(true)` with no partition tag and no identity booking: a global edit. */
    partGlobal: number
    /** A `markChanged(false)`: an effect's first run. */
    partFirst: number
    /** A partition tag still pending when the next partition run began. */
    tagOverwritten: number
}

export interface NetSignalDump {
    perChar: [string, CharSignals][]
    globals: SignalGlobals
    watches: number
}

/** What the `saveLoop` chunk may call. Every returned object is a fresh copy. */
export interface NetSignalHandle {
    /** Zero lanes for a character with no event yet, so a null record field always means "no handle". */
    signals(chaId: string): CharSignals
    globals(): SignalGlobals
    /** Calls `cb` once at the first `api`, `identity` or `part` event for `chaId` before `untilMs`. False when the cap refused it. */
    watch(chaId: string, untilMs: number, cb: () => void): boolean
    inFlightKinds(): InFlightKind[]
    /** The selected character's `chaId`, or null before the reader is installed or when none is selected. */
    selected(): string | null
    dump(): NetSignalDump
    reset(): void
}

interface Watch {
    chaId: string
    untilMs: number
    cb: () => void
}

interface MeterState {
    perChar: Map<string, CharSignals>
    globals: SignalGlobals
    watches: Watch[]
    pendingTag: boolean
    identityFlag: boolean
}

const SWITCH_KEY = 'risu-measure-savepass'
const WATCH_LIMIT = 64
const INPUT_EVENTS = ['pointerdown', 'touchstart', 'click', 'keydown', 'beforeinput', 'input', 'change', 'drop', 'paste', 'cut'] as const

// Created on first use, not at module load.
let state: MeterState | null = null
// Read once, in `ensureInstalled`; null until then.
let switchedOn: boolean | null = null
let installed = false
let readSelected: (() => string | null) | null = null
// Removes the listeners and the subscription; only a test calls it.
const teardowns: (() => void)[] = []

function freshGlobals(): SignalGlobals {
    return { input: 0, winMsg: 0, winMsgForeign: 0, inFlight: 0, partGlobal: 0, partFirst: 0, tagOverwritten: 0 }
}

function stateNow(): MeterState {
    state ??= { perChar: new Map(), globals: freshGlobals(), watches: [], pendingTag: false, identityFlag: false }
    return state
}

function zeroSignals(): CharSignals {
    return { api: { n: 0, lastAt: 0 }, identity: { n: 0, lastAt: 0 }, part: { n: 0, lastAt: 0 } }
}

function copyLane(lane: SignalLane): SignalLane {
    return { n: lane.n, lastAt: lane.lastAt }
}

function copySignals(entry: CharSignals): CharSignals {
    return { api: copyLane(entry.api), identity: copyLane(entry.identity), part: copyLane(entry.part) }
}

function pruneWatches(now: number): void {
    const watches = stateNow().watches
    stateNow().watches = watches.filter(watch => watch.untilMs >= now)
}

function fireWatches(chaId: string, at: number): void {
    const kept: Watch[] = []
    const fired: Watch[] = []
    for (const watch of stateNow().watches) {
        if (watch.untilMs < at) {
            continue
        }
        if (watch.chaId === chaId) {
            fired.push(watch)
        } else {
            kept.push(watch)
        }
    }
    stateNow().watches = kept
    for (const watch of fired) {
        try {
            watch.cb()
        } catch {
            // A callback failure never reaches the caller.
        }
    }
}

/** Counts one event of `kind` for `chaId`. Ignored until `ensureInstalled` found the switch on. */
export function noteSignal(kind: SignalKind, chaId: string): void {
    try {
        if (switchedOn !== true) {
            return
        }
        const perChar = stateNow().perChar
        let entry = perChar.get(chaId)
        if (entry === undefined) {
            entry = zeroSignals()
            perChar.set(chaId, entry)
        }
        const at = performance.now()
        entry[kind].n++
        entry[kind].lastAt = at
        fireWatches(chaId, at)
    } catch {
        // A measurement failure never reaches the caller.
    }
}

/** A partition effect ran: its next `markChanged` belongs to the selected character. */
export function notePartitionTag(): void {
    try {
        if (switchedOn !== true) {
            return
        }
        if (stateNow().pendingTag) {
            stateNow().globals.tagOverwritten++
        }
        stateNow().pendingTag = true
    } catch {
        // A measurement failure never reaches the caller.
    }
}

/** The identity tracker saw `chaId` replaced; its own `markChanged(true)` is not booked again as `part`. */
export function noteIdentity(chaId: string): void {
    try {
        if (switchedOn !== true) {
            return
        }
        noteSignal('identity', chaId)
        stateNow().identityFlag = true
    } catch {
        // A measurement failure never reaches the caller.
    }
}

/**
 * Reads and clears the identity flag and the partition tag, then classifies one `markChanged(d)` call, first match
 * winning: an identity-booked call is skipped, a `d === false` call is `partFirst`, a tagged call is `part` and
 * anything else `partGlobal`. True only for `part`: the caller then resolves the selected id and calls `noteSignal`.
 */
export function classifyChange(d: boolean): boolean {
    try {
        if (switchedOn !== true) {
            return false
        }
        const current = stateNow()
        const identity = current.identityFlag
        const tagged = current.pendingTag
        current.identityFlag = false
        current.pendingTag = false
        if (identity && d) {
            return false
        }
        if (!d) {
            current.globals.partFirst++
            return false
        }
        if (tagged) {
            return true
        }
        current.globals.partGlobal++
        return false
    } catch {
        return false
    }
}

function buildHandle(): NetSignalHandle {
    return {
        signals: (chaId) => copySignals(state?.perChar.get(chaId) ?? zeroSignals()),
        globals: () => ({ ...stateNow().globals }),
        watch: (chaId, untilMs, cb) => {
            pruneWatches(performance.now())
            if (stateNow().watches.length >= WATCH_LIMIT) {
                return false
            }
            stateNow().watches.push({ chaId, untilMs, cb })
            return true
        },
        inFlightKinds: () => inFlightKinds(),
        selected: () => readSelected === null ? null : readSelected(),
        dump: () => ({
            perChar: [...stateNow().perChar].map(([chaId, entry]): [string, CharSignals] => [chaId, copySignals(entry)]),
            globals: { ...stateNow().globals },
            watches: stateNow().watches.length,
        }),
        reset: () => {
            state = null
        },
    }
}

/**
 * Reads the switch once and, when it is on, installs the passive listeners, the in-flight subscription and the
 * `globalThis.__risuNetSignals` handle. `selectedReader` returns the selected character's `chaId` without subscribing;
 * the latest registration's reader replaces an earlier one. Idempotent.
 */
export function ensureInstalled(selectedReader: () => string | null): void {
    try {
        if (!MEASURE) {
            return
        }
        readSelected = selectedReader
        if (installed) {
            return
        }
        installed = true
        switchedOn = typeof localStorage !== 'undefined' && localStorage.getItem(SWITCH_KEY) === 'on'
        if (!switchedOn) {
            return
        }
        // A page always has a window; a worker or a node test has none and counts no input.
        if (typeof window !== 'undefined') {
            const onInput = (event: Event): void => {
                if (event.isTrusted) {
                    stateNow().globals.input++
                }
            }
            for (const type of INPUT_EVENTS) {
                window.addEventListener(type, onInput, { capture: true, passive: true })
                teardowns.push(() => window.removeEventListener(type, onInput, { capture: true }))
            }
            const onMessage = (event: MessageEvent): void => {
                stateNow().globals.winMsg++
                if (event.source !== window) {
                    stateNow().globals.winMsgForeign++
                }
            }
            window.addEventListener('message', onMessage, { capture: true })
            teardowns.push(() => window.removeEventListener('message', onMessage, { capture: true }))
        }
        teardowns.push(subscribeInFlight(() => {
            stateNow().globals.inFlight++
        }))
        ;(globalThis as { __risuNetSignals?: NetSignalHandle }).__risuNetSignals = buildHandle()
    } catch {
        // A measurement failure never reaches the caller.
    }
}

/** Test-only: forgets the cached switch and the installation state, so the next `ensureInstalled` reads the switch again. */
export function resetNetSignalsForTest(): void {
    for (const teardown of teardowns.splice(0)) {
        teardown()
    }
    state = null
    switchedOn = null
    installed = false
    readSelected = null
    delete (globalThis as { __risuNetSignals?: NetSignalHandle }).__risuNetSignals
}
