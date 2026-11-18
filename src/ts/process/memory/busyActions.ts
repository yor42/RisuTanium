/**
 * Chat-less actions that write data and must not be cut off by a page reload,
 * plus the in-flight counters of the write choke points. Separate from
 * `chatOrigin.ts`: an action here has no chat to name, and an entry there warns
 * in the delete dialogs.
 *
 * An action registers when its write phase starts (after a file picker has
 * delivered its files, never when the picker opens: a cancelled picker never
 * resolves) and ends in a `finally`. A stale entry only ever answers "busy".
 *
 * The entries, their ages and the recent history can be read through
 * `window.__risuTaniumBusy` (kinds, times and counts only, never content).
 */

import { writable } from 'svelte/store'
import { beginInFlight, inFlightKinds, type InFlightKind } from '../inFlightWork'

/** Names the kind of work in an entry, so entries can be told apart. */
export type BusyKind =
    | 'charImage' | 'charEmotion' | 'groupImage' | 'assetAdd' | 'imageAdd'
    | 'import' | 'export' | 'backupSave' | 'backupLoad' | 'cleanup' | 'integrityCheck'
    | 'hypaBulk' | 'mcpWrite' | 'themePack'

export interface BusyEndedRecord {
    kind: BusyKind
    startedAt: number
    endedAt: number
    durationMs: number
}

export interface BusySnapshot {
    now: number
    /** How many entries were ever begun in this page life. */
    begun: number
    /** Live entries in begin order. */
    entries: { kind: BusyKind, startedAt: number, ageMs: number }[]
    /** The newest ended entries, oldest first, at most `BUSY_HISTORY_LIMIT`. */
    recent: BusyEndedRecord[]
    inFlight: InFlightKind[]
    chokePoints: Record<ChokePoint, number>
}

export interface BusyHandle {
    readonly kind: BusyKind
    /** Idempotent: a second call does nothing. */
    end(): void
}

const entries = new Set<BusyHandle>()

/**
 * A line saying a backup load was refused while other registered work ran. The
 * wait and progress alerts show it under their message until the last entry
 * ends, so the job's next progress write cannot hide the refusal.
 */
export const busyRefusalLine = writable<string | null>(null)

// Every entry also holds an in-flight token, so the page stays alive while a
// data action runs. The max age is a backstop for a stale entry (see above); the
// write choke points are not mirrored.
const BUSY_TOKEN_MAX_AGE_MS = 2 * 60 * 60 * 1000
const inFlightTokens = new Map<BusyHandle, () => void>()

// Diagnostic bookkeeping only: it never feeds a busy answer. Start times live
// beside the handle so `BusyHandle` stays `{ kind, end }`.
export const BUSY_HISTORY_LIMIT = 20
const startedAtByHandle = new Map<BusyHandle, number>()
const recentEnded: BusyEndedRecord[] = []
let begunCount = 0

export function beginBusy(kind: BusyKind): BusyHandle {
    const handle: BusyHandle = {
        kind,
        end: () => {
            const startedAt = startedAtByHandle.get(handle)
            if (startedAt !== undefined) {
                // Only the first effective end is recorded; a second call finds no start time.
                startedAtByHandle.delete(handle)
                const endedAt = Date.now()
                recentEnded.push({ kind, startedAt, endedAt, durationMs: endedAt - startedAt })
                if (recentEnded.length > BUSY_HISTORY_LIMIT) {
                    recentEnded.splice(0, recentEnded.length - BUSY_HISTORY_LIMIT)
                }
            }
            entries.delete(handle)
            if (entries.size === 0) {
                busyRefusalLine.set(null)
            }
            const endToken = inFlightTokens.get(handle)
            if (endToken) {
                inFlightTokens.delete(handle)
                endToken()
            }
        },
    }
    entries.add(handle)
    startedAtByHandle.set(handle, Date.now())
    begunCount += 1
    inFlightTokens.set(handle, beginInFlight('busy', { maxAgeMs: BUSY_TOKEN_MAX_AGE_MS }))
    return handle
}

/**
 * Whether any action is registered. A refusal made by an action that is itself
 * registered passes its own handle as `except`, so it does not refuse itself.
 */
export function isBusy(options: { except?: BusyHandle } = {}): boolean {
    const own = options.except !== undefined && entries.has(options.except) ? 1 : 0
    return entries.size - own > 0
}

export function busyKinds(): BusyKind[] {
    return [...entries].map((entry) => entry.kind)
}

/** Runs `work` registered as `kind`; the entry ends however `work` settles. */
export async function withBusy<T>(kind: BusyKind, work: () => Promise<T>): Promise<T> {
    const handle = beginBusy(kind)
    try {
        return await work()
    } finally {
        handle.end()
    }
}

export type ChokePoint = 'asset' | 'inlay' | 'coldStorage' | 'pluginBridge'

const inFlightByPoint: Record<ChokePoint, number> = { asset: 0, inlay: 0, coldStorage: 0, pluginBridge: 0 }

/** Counts one write in flight at `point`; the returned function ends it once. */
export function beginChokePoint(point: ChokePoint): () => void {
    inFlightByPoint[point] += 1
    let ended = false
    return () => {
        if (ended) {
            return
        }
        ended = true
        inFlightByPoint[point] -= 1
    }
}

export function chokePointInFlight(point: ChokePoint): number {
    return inFlightByPoint[point]
}

export function anyChokePointInFlight(): boolean {
    return inFlightByPoint.asset + inFlightByPoint.inlay + inFlightByPoint.coldStorage + inFlightByPoint.pluginBridge > 0
}

/** What a plugin's visible panel is: the iframe element, whose own state says whether it is still shown. */
export interface PluginPanelHandle {
    readonly isConnected: boolean
    readonly style: { readonly display: string }
}

const shownPluginPanels = new Set<PluginPanelHandle>()
let pluginPanelShownCount = 0

/** Records that a plugin's panel was shown, until `markPluginPanelHidden` or the panel leaves the page. */
export function markPluginPanelShown(panel: PluginPanelHandle): void {
    shownPluginPanels.add(panel)
    pluginPanelShownCount += 1
}

/** How many times a plugin panel was shown in this page life, hidden again or not: a reader that saw a lower count knows a panel was shown since. */
export function getPluginPanelShownCount(): number {
    return pluginPanelShownCount
}

export function markPluginPanelHidden(panel: PluginPanelHandle): void {
    shownPluginPanels.delete(panel)
}

/** True while any plugin panel is shown. A panel removed from the page, or hidden by its own style, does not count. */
export function isPluginPanelOpen(): boolean {
    for (const panel of shownPluginPanels) {
        if (!panel.isConnected || panel.style.display === 'none') {
            shownPluginPanels.delete(panel)
        }
    }
    return shownPluginPanels.size > 0
}

/** A fresh JSON-serialisable copy: kinds, times and counts only, never content. */
export function busySnapshot(): BusySnapshot {
    const now = Date.now()
    return {
        now,
        begun: begunCount,
        entries: [...entries].map((entry) => {
            const startedAt = startedAtByHandle.get(entry) ?? now
            return { kind: entry.kind, startedAt, ageMs: now - startedAt }
        }),
        recent: recentEnded.map((record) => ({ ...record })),
        inFlight: inFlightKinds(),
        chokePoints: { ...inFlightByPoint },
    }
}

declare global {
    interface Window {
        readonly __risuTaniumBusy?: BusySnapshot
    }
}

// Always on: a build-time measurement gate would hide it from a release build.
// A getter without a setter, so a page script cannot replace it.
if (typeof window !== 'undefined') {
    Object.defineProperty(window, '__risuTaniumBusy', {
        configurable: true,
        enumerable: false,
        get: () => busySnapshot(),
    })
}

export function resetBusyActionsForTest(): void {
    for (const endToken of inFlightTokens.values()) {
        endToken()
    }
    inFlightTokens.clear()
    startedAtByHandle.clear()
    recentEnded.length = 0
    begunCount = 0
    entries.clear()
    busyRefusalLine.set(null)
    inFlightByPoint.asset = 0
    inFlightByPoint.inlay = 0
    inFlightByPoint.coldStorage = 0
    inFlightByPoint.pluginBridge = 0
    shownPluginPanels.clear()
    pluginPanelShownCount = 0
}
