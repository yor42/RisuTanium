import { compareVersions } from './pluginListMerge'
import type { RisuPlugin } from './plugins.svelte'

/**
 * The Plugins page's update check: one probe per plugin that declares an update address, a device-local
 * record of the last check, and the rule for when the page may check by itself. Nothing here writes the
 * plugin list; installing an update stays with `updatePlugin`.
 */

export const PLUGIN_UPDATE_CHECK_KEY = 'risuSettings.pluginUpdateCheck'
const DAY_MS = 24 * 60 * 60 * 1000

export type UpdateOutcome =
    | { kind: 'update', version: string }
    | { kind: 'current' }
    | { kind: 'failed' }

export type RecordedOutcome = UpdateOutcome & { name: string, label: string }

export interface UpdateRecord {
    checkedAt: number
    outcomes: RecordedOutcome[]
}

export interface UpdateFetchInit {
    method: 'GET'
    headers: { Range: string }
}

export type UpdateFetcher = (url: string, init: UpdateFetchInit) => Promise<Pick<Response, 'status' | 'text'>>

export interface UpdateCheckDeps {
    fetcher: UpdateFetcher
    now: () => number
}

export interface UpdateRecordStorage {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
}

export interface UpdateSummary {
    /** Display names of the plugins whose check failed. */
    failed: string[]
    /** Plugins with a newer version than the installed one. */
    updates: number
    /** True only when something was checked and nothing failed and nothing is newer. */
    allCurrent: boolean
}

const versionPattern = /\/\/@version\s+([^\s]+)/

/** Same request as the legacy per-render check: a ranged GET and the `//@version` header line. */
export async function probePluginUpdate(
    plugin: Pick<RisuPlugin, 'updateURL' | 'versionOfPlugin'>,
    fetcher: UpdateFetcher,
): Promise<UpdateOutcome> {
    if (!plugin.updateURL) {
        return { kind: 'current' }
    }
    try {
        const response = await fetcher(plugin.updateURL, { method: 'GET', headers: { Range: 'bytes=0-512' } })
        if (response.status < 200 || response.status >= 300) {
            return { kind: 'failed' }
        }
        const match = (await response.text()).match(versionPattern)
        if (!match || !match[1]) {
            return { kind: 'failed' }
        }
        const latest = match[1].trim()
        if (compareVersions(latest, plugin.versionOfPlugin || '0.0.0') === 1) {
            return { kind: 'update', version: latest }
        }
        return { kind: 'current' }
    } catch {
        return { kind: 'failed' }
    }
}

const labelOf = (plugin: Pick<RisuPlugin, 'name' | 'displayName'>): string => plugin.displayName || plugin.name

/** Probes every entry with an update address once, concurrently; the list itself is never touched. */
export async function checkPluginUpdates(plugins: readonly RisuPlugin[], deps: UpdateCheckDeps): Promise<UpdateRecord> {
    const checkable = plugins.filter((plugin) => !!plugin.updateURL)
    const outcomes = await Promise.all(checkable.map(async (plugin): Promise<RecordedOutcome> => ({
        ...(await probePluginUpdate(plugin, deps.fetcher)),
        name: plugin.name,
        label: labelOf(plugin),
    })))
    return { checkedAt: deps.now(), outcomes }
}

/** The newer version recorded for this plugin while it is still newer than the installed one. */
export function pluginUpdateVersion(record: UpdateRecord | null, plugin: Pick<RisuPlugin, 'name' | 'versionOfPlugin'>): string | null {
    const found = record?.outcomes.find((outcome) => outcome.name === plugin.name)
    if (!found || found.kind !== 'update') {
        return null
    }
    return compareVersions(found.version, plugin.versionOfPlugin || '0.0.0') === 1 ? found.version : null
}

/** The record judged against the plugins installed now: removed plugins and installed updates drop out. */
export function summarizeUpdateRecord(record: UpdateRecord | null, installed: readonly RisuPlugin[]): UpdateSummary {
    const failed: string[] = []
    let updates = 0
    let seen = 0
    for (const outcome of record?.outcomes ?? []) {
        const plugin = installed.find((entry) => entry.name === outcome.name && !!entry.updateURL)
        if (!plugin) {
            continue
        }
        seen++
        if (outcome.kind === 'failed') {
            failed.push(labelOf(plugin))
        } else if (pluginUpdateVersion(record, plugin) !== null) {
            updates++
        }
    }
    return { failed, updates, allCurrent: seen > 0 && failed.length === 0 && updates === 0 }
}

/** At most one automatic check per 24 h; a stored time in the future counts as stale. */
export function shouldAutoCheck(record: UpdateRecord | null, now: number): boolean {
    if (!record || record.checkedAt > now) {
        return true
    }
    return now - record.checkedAt >= DAY_MS
}

function isOutcome(value: unknown): value is RecordedOutcome {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const item = value as Record<string, unknown>
    if (typeof item.name !== 'string' || typeof item.label !== 'string') {
        return false
    }
    if (item.kind === 'update') {
        return typeof item.version === 'string'
    }
    return item.kind === 'current' || item.kind === 'failed'
}

/** Corrupt data, a missing record or a throwing storage all read as no record. */
export function readUpdateRecord(storage: UpdateRecordStorage): UpdateRecord | null {
    try {
        const text = storage.getItem(PLUGIN_UPDATE_CHECK_KEY)
        if (!text) {
            return null
        }
        const data: unknown = JSON.parse(text)
        if (typeof data !== 'object' || data === null) {
            return null
        }
        const { checkedAt, outcomes } = data as Record<string, unknown>
        if (typeof checkedAt !== 'number' || !Number.isFinite(checkedAt) || !Array.isArray(outcomes) || !outcomes.every(isOutcome)) {
            return null
        }
        return { checkedAt, outcomes }
    } catch {
        return null
    }
}

/** The record is a convenience; a storage that refuses the write loses only the cached results. */
export function writeUpdateRecord(storage: UpdateRecordStorage, record: UpdateRecord): void {
    try {
        storage.setItem(PLUGIN_UPDATE_CHECK_KEY, JSON.stringify(record))
    } catch {
        // The next page open checks again.
    }
}

let inFlight: Promise<UpdateRecord> | null = null

/** Runs a check and stores its record; a run that starts while another is in flight shares its result. */
export function runPluginUpdateCheck(
    plugins: readonly RisuPlugin[],
    deps: UpdateCheckDeps & { storage: UpdateRecordStorage },
): Promise<UpdateRecord> {
    if (inFlight) {
        return inFlight
    }
    const run = checkPluginUpdates(plugins, deps)
        .then((record) => {
            writeUpdateRecord(deps.storage, record)
            return record
        })
        .finally(() => {
            inFlight = null
        })
    inFlight = run
    return run
}
