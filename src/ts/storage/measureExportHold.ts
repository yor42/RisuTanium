import { MEASURE } from '../process/memory/measureFlag'
import type { BusyKind } from '../process/memory/busyActions'

/**
 * Measurement builds only (`MEASURE`): the switch that holds the store2 save loop's idle-net ticks while a local backup
 * export is running, and the counts the export notes print. This module imports no save-loop or busy-action code, so the
 * export and the loop can both reach it without a static import of each other. Every reader folds away in a normal build.
 */

export const HOLD_NET_KEY = 'risu-measure-export-holdnet'

/** Whether the idle net is held right now; it may throw, and the loop treats a throw as "not held". */
export type NetHoldCheck = () => boolean

export interface NetTickStats {
    /** Idle-net ticks skipped because the hold was in force. */
    held: number
    /** Idle-net ticks that ran. */
    ticks: number
    /** The milliseconds those ticks took, added up. */
    tickMs: number
}

let holdCheck: NetHoldCheck | null = null
let netStats: NetTickStats = { held: 0, ticks: 0, tickMs: 0 }

function readHoldSwitch(): string | null {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage.getItem(HOLD_NET_KEY)
    } catch {
        return null
    }
}

/** The check that holds the idle net exactly while a `backupSave` entry is registered; any other busy kind never holds. */
export function createNetHoldCheck(busyKinds: () => readonly BusyKind[]): NetHoldCheck {
    return () => busyKinds().includes('backupSave')
}

/** Test seam and installer: `null` removes the hold. */
export function setNetHoldCheck(check: NetHoldCheck | null): void {
    holdCheck = check
}

/**
 * Installs the hold when the build measures and the stored switch says `on`; read once, here. Returns whether it holds.
 * A page that does not call this never holds.
 */
export function installNetHold(busyKinds: () => readonly BusyKind[], readSwitch?: () => string | null): boolean {
    if (!MEASURE) {
        return false
    }
    let on = false
    try {
        on = (readSwitch ?? readHoldSwitch)() === 'on'
    } catch {
        on = false
    }
    holdCheck = on ? createNetHoldCheck(busyKinds) : null
    return on
}

/** Whether the loop skips this idle-net tick. Never throws: a failing check means "not held". */
export function netHeldNow(): boolean {
    if (!MEASURE || holdCheck === null) {
        return false
    }
    try {
        return holdCheck() === true
    } catch {
        return false
    }
}

export function noteNetHeldTick(): void {
    netStats.held += 1
}

export function noteNetPassTick(ms: number): void {
    netStats.ticks += 1
    if (Number.isFinite(ms)) {
        netStats.tickMs += ms
    }
}

/** Clears the counts; an export does this when it starts, so its notes cover that export. */
export function resetNetTickStats(): void {
    netStats = { held: 0, ticks: 0, tickMs: 0 }
}

/** The counts since the last reset, left in place. */
export function peekNetTickStats(): NetTickStats {
    return { ...netStats }
}

/** The resident (non-stub) characters of a character list: the ones the idle net re-encodes in turn. */
export function residentCharacterCount(characters: unknown): number {
    if (!Array.isArray(characters)) {
        return 0
    }
    let count = 0
    for (const slot of characters) {
        if (typeof slot === 'object' && slot !== null && !(slot as { coldstorage?: unknown }).coldstorage) {
            count += 1
        }
    }
    return count
}
