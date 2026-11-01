import { MEASURE } from '../process/memory/measureFlag'

/**
 * The plugin-cost counters of a measurement build (CHORE-17 stage 0): where the time of a plugin's database read, of the
 * bridge round trip, of a database write and of the identity tracker goes. Every call site sits under `if (MEASURE)`, so
 * a normal build folds the calls away and drops this module and the global name with it.
 *
 * Use: set localStorage `risu-measure-savepass` to `on`, reload, and read `__risuPluginMeter.last()`, `.all()` and
 * `.reset()`. The switch is read once, at the first record. A record has a `kind` (`read`, `bridge`, `write`,
 * `identity`), the clock reading `at` at its start (the key for joining it offline to the bridge record of the same
 * call and to the save-pass records), `wallMs` and the named `fields` its call site noted. The ring keeps the newest 64.
 *
 * Observation only: the meter never throws into the caller, never awaits and writes nothing but its own ring. A clock
 * that throws reads as 0. The clock is module-local so a test can replace it without touching `performance.now`, which
 * the other meters and the save loop also read.
 *
 * Save-loop timings are not recorded here: the `saveLoop` chunk must not import this module (one module imported from
 * two chunks is hoisted into a shared chunk that a release build keeps), so they go through `store2/savePassMeter.ts`.
 * All state is created on first use, not at module load: a top-level call is a side effect that keeps a module in a
 * normal build.
 */

export type PluginRecordKind = 'read' | 'bridge' | 'write' | 'identity'

export type PluginMeterValue = number | string | boolean | string[] | Record<string, number>

export interface PluginCostRecord {
    /** Monotonic per page. */
    seq: number
    kind: PluginRecordKind
    /** The clock reading at the record's start. */
    at: number
    wallMs: number
    fields: Record<string, PluginMeterValue>
}

export interface PluginMeterHandle {
    last(): PluginCostRecord | null
    all(): PluginCostRecord[]
    reset(): void
}

const SWITCH_KEY = 'risu-measure-savepass'
const RING_LIMIT = 64

// Created on first use, not at module load.
let ring: PluginCostRecord[] | null = null
let seqCounter = 0
// Read once, at the first record; null until then.
let switchedOn: boolean | null = null
let clock: (() => number) | null = null

function readClock(): number {
    return (clock ?? (() => performance.now()))()
}

/** The clock reading, or 0 when the clock throws. */
export function pluginMeterNow(): number {
    try {
        return readClock()
    } catch {
        return 0
    }
}

/** Replaces the module's clock (a test's counting or throwing clock); null restores `performance.now()`. */
export function setPluginMeterClockForTest(next: (() => number) | null): void {
    clock = next
}

/** Test-only: forgets the ring, the cached switch and the clock. */
export function resetPluginMeterForTest(): void {
    ring = null
    seqCounter = 0
    switchedOn = null
    clock = null
    delete (globalThis as { __risuPluginMeter?: PluginMeterHandle }).__risuPluginMeter
}

function ringNow(): PluginCostRecord[] {
    ring ??= []
    return ring
}

const handle: PluginMeterHandle = {
    last: () => ring === null || ring.length === 0 ? null : ring[ring.length - 1],
    all: () => (ring ?? []).map(record => ({ ...record, fields: { ...record.fields } })),
    reset: () => {
        ring = null
        seqCounter = 0
    },
}

function isSwitchedOn(): boolean {
    if (switchedOn === null) {
        try {
            switchedOn = typeof localStorage !== 'undefined' && localStorage.getItem(SWITCH_KEY) === 'on'
        } catch {
            switchedOn = false
        }
    }
    return switchedOn
}

/**
 * The recorder of one record. `lap` adds the time since the previous lap (or the start, or the last `restart`) to a
 * field, so a span that awaits something unrelated is cut with `restart` and the wait is left out of every lap while
 * `wallMs` still covers it. Every method is total.
 */
export class PluginRecordBuilder {
    private readonly fields: Record<string, PluginMeterValue> = {}
    private lapAt: number
    private finished = false

    constructor(private readonly kind: PluginRecordKind, private readonly startAt: number) {
        this.lapAt = startAt
    }

    /** Adds the span since the previous lap to `name`, or to `name[key]` when a key is given. */
    lap(name: string, key?: string): void {
        try {
            const at = readClock()
            const ms = at - this.lapAt
            this.lapAt = at
            if (key === undefined) {
                const held = this.fields[name]
                this.fields[name] = (typeof held === 'number' ? held : 0) + ms
            } else {
                const held = this.fields[name]
                const table: Record<string, number> = typeof held === 'object' && !Array.isArray(held) ? held : {}
                table[key] = (table[key] ?? 0) + ms
                this.fields[name] = table
            }
        } catch {
            // A measurement failure never reaches the caller.
        }
    }

    /** Starts the next lap now, leaving the time since the previous lap uncounted. */
    restart(): void {
        try {
            this.lapAt = readClock()
        } catch {
            // A measurement failure never reaches the caller.
        }
    }

    set(name: string, value: PluginMeterValue): void {
        try {
            this.fields[name] = value
        } catch {
            // A measurement failure never reaches the caller.
        }
    }

    /** Adds `amount` to a numeric field. */
    add(name: string, amount: number = 1): void {
        try {
            const held = this.fields[name]
            this.fields[name] = (typeof held === 'number' ? held : 0) + amount
        } catch {
            // A measurement failure never reaches the caller.
        }
    }

    /** Pushes the record; a second call does nothing. */
    finish(): void {
        try {
            if (this.finished) {
                return
            }
            this.finished = true
            const records = ringNow()
            seqCounter++
            records.push({ seq: seqCounter, kind: this.kind, at: this.startAt, wallMs: readClock() - this.startAt, fields: this.fields })
            if (records.length > RING_LIMIT) {
                records.shift()
            }
        } catch {
            // A measurement failure never reaches the caller.
        }
    }
}

/** The recorder of one record, or null when this is not a measurement build, the switch is off or the meter failed. Installs the global when on. */
export function startPluginRecord(kind: PluginRecordKind): PluginRecordBuilder | null {
    try {
        if (!MEASURE || !isSwitchedOn()) {
            return null
        }
        ;(globalThis as { __risuPluginMeter?: PluginMeterHandle }).__risuPluginMeter = handle
        return new PluginRecordBuilder(kind, readClock())
    } catch {
        return null
    }
}
