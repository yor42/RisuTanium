import type { RisuPlugin } from './plugins.svelte'
import { carrySavedValues } from './pluginListMerge'

/**
 * The pure part of importing several plugin files in one pick: which files are
 * new, which update an installed plugin, which repeat a name already in the
 * batch, and the apply step. No alerts, no database access, no store imports.
 *
 * Unlike the plugin-list merge, a same-script or not-newer file is still an
 * update here: the user picked it on purpose.
 */

/** One file that passed the header, API and transpile steps. */
export interface PreparedPlugin {
    file: string
    entry: RisuPlugin
}

export interface PluginBatchFailure {
    file: string
    reason: string
}

export interface PluginBatchNew {
    file: string
    entry: RisuPlugin
}

export interface PluginBatchUpdate {
    file: string
    entry: RisuPlugin
    /** The installed version, empty when the installed copy has none. */
    fromVersion: string
    /** The incoming version, empty when the header has none. */
    toVersion: string
}

export interface PluginBatchClassification {
    news: PluginBatchNew[]
    updates: PluginBatchUpdate[]
    failed: PluginBatchFailure[]
}

/**
 * Sorts prepared files against the installed list by plugin name. A name that
 * repeats an earlier file of the batch fails with `repeatedReason`; the first
 * file with a name is the one that counts. Nothing is changed.
 */
export function classifyPluginBatch(live: readonly RisuPlugin[], prepared: readonly PreparedPlugin[], repeatedReason: string): PluginBatchClassification {
    const result: PluginBatchClassification = { news: [], updates: [], failed: [] }
    const seen = new Set<string>()
    for (const item of prepared) {
        const name = item.entry.name
        if (seen.has(name)) {
            result.failed.push({ file: item.file, reason: repeatedReason })
            continue
        }
        seen.add(name)
        const installed = live.find((plugin) => plugin?.name === name)
        if (installed === undefined) {
            result.news.push({ file: item.file, entry: item.entry })
        } else {
            result.updates.push({
                file: item.file,
                entry: item.entry,
                fromVersion: installed.versionOfPlugin ?? '',
                toVersion: item.entry.versionOfPlugin ?? '',
            })
        }
    }
    return result
}

/**
 * Applies accepted entries to `live` in place, in the same synchronous step as
 * the write. Each name is looked up now: an installed plugin is replaced where
 * it stands with its saved values and on/off state carried over, an absent one
 * is appended switched on. A plugin no entry names is never removed, replaced
 * or reordered, whether or not it has a name.
 */
export function applyPluginBatch(live: RisuPlugin[], accepted: readonly RisuPlugin[]): void {
    for (const entry of accepted) {
        const index = live.findIndex((plugin) => plugin?.name === entry.name)
        if (index === -1) {
            live.push({ ...entry, enabled: true })
        } else {
            live[index] = carrySavedValues(live[index], entry)
        }
    }
}

const REVIEW_LINE_CAP = 15

/** At most `REVIEW_LINE_CAP` lines of a review section, then `more(n)` for the rest. */
export function capReviewLines(lines: readonly string[], more: (count: number) => string): string[] {
    if (lines.length <= REVIEW_LINE_CAP) {
        return [...lines]
    }
    return [...lines.slice(0, REVIEW_LINE_CAP), more(lines.length - REVIEW_LINE_CAP)]
}
