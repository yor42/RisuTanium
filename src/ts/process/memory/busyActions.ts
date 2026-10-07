/**
 * Chat-less actions that write data and must not be cut off by a page reload,
 * plus the in-flight counters of the write choke points. Separate from
 * `chatOrigin.ts`: an action here has no chat to name, and an entry there warns
 * in the delete dialogs.
 *
 * An action registers when its write phase starts (after a file picker has
 * delivered its files, never when the picker opens: a cancelled picker never
 * resolves) and ends in a `finally`. A stale entry only ever answers "busy".
 */

/** Names the kind of work in an entry, so entries can be told apart. */
export type BusyKind =
    | 'charImage' | 'charEmotion' | 'groupImage' | 'assetAdd' | 'imageAdd'
    | 'import' | 'export' | 'backupSave' | 'backupLoad' | 'cleanup' | 'integrityCheck'
    | 'hypaBulk' | 'mcpWrite'

export interface BusyHandle {
    readonly kind: BusyKind
    /** Idempotent: a second call does nothing. */
    end(): void
}

const entries = new Set<BusyHandle>()

export function beginBusy(kind: BusyKind): BusyHandle {
    const handle: BusyHandle = {
        kind,
        end: () => { entries.delete(handle) },
    }
    entries.add(handle)
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

let lastPluginActivityAt = 0

/** Stamps the time a V3 plugin last called into the host. */
export function stampPluginActivity(now: number = Date.now()): void {
    lastPluginActivityAt = now
}

/** 0 until a plugin has called into the host. */
export function getLastPluginActivityAt(): number {
    return lastPluginActivityAt
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

let pluginDevModeStarted = false

/** Set once the plugin dev-mode poll starts; it never ends within a page life. */
export function markPluginDevModeStarted(): void {
    pluginDevModeStarted = true
}

export function isPluginDevModeStarted(): boolean {
    return pluginDevModeStarted
}

export function resetBusyActionsForTest(): void {
    entries.clear()
    inFlightByPoint.asset = 0
    inFlightByPoint.inlay = 0
    inFlightByPoint.coldStorage = 0
    inFlightByPoint.pluginBridge = 0
    lastPluginActivityAt = 0
    pluginDevModeStarted = false
    shownPluginPanels.clear()
    pluginPanelShownCount = 0
}
