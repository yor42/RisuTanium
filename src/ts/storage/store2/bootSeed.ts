import type { Database } from '../database.svelte'
import type { Store2Backend, Store2Read } from './backend/types'
import type { BlockedReason } from './bootActive'
import type { ListDerivation } from './codec'
import { firstLifeInstall, installBuilt, type FirstLifeGrant, type FirstLifeResult } from './firstLife'
import { defaultKeyEnv, type KeyEnv } from './format'
import { planWholeTreeInstall } from './legacy/install'
import type { ForeignClearHook } from './owner'
import { runExit, type ExitResult } from './recovery'

/**
 * The seed driver of the boot dispatch: the first-life install of an empty profile, and the probe that decides whether
 * seeding is allowed at all. A store with no main file but a numbered backup is never seeded: the backup is the profile.
 */

/** The profile an empty install starts from: the containers every save holds, and nothing else. */
export function emptySeedProfile(): Database {
    return {
        characters: [],
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
    } as unknown as Database
}

export type BackupProbe =
    | { status: 'none' }
    | { status: 'some', backups: readonly number[] }
    /** The listing failed: it is never read as "none". */
    | { status: 'unknown', reason: string }

/** The numbered backups the page's store holds, through the non-pruning listing. */
export async function probeNumberedBackups(list: () => Promise<number[]>): Promise<BackupProbe> {
    try {
        const backups = await list()
        return backups.length > 0 ? { status: 'some', backups } : { status: 'none' }
    } catch (error) {
        return { status: 'unknown', reason: error instanceof Error ? error.message : String(error) }
    }
}

/**
 * What a seed came to. `reclassify` is a state a peer or a lost response moved: the dispatch opens a new session and
 * decides again. `blocked` names why nothing more is attempted this boot; a marker or staged units it leaves are the
 * next boot's to classify.
 */
export type SeedOutcome =
    | { status: 'installed', manifestKey: string, flushed: boolean | undefined }
    | { status: 'reclassify' }
    | { status: 'blocked', reason: BlockedReason, detail: string }
    /** An `exit` entry only: the fenced exit did not end `marked`. No marker landed, except that after `unknown` it may have. */
    | { status: 'exit', exit: Exclude<ExitResult, { status: 'marked' }> }

/**
 * How the seed gets its marker: the unfenced marker of a first-life grant, or a fenced recovery exit over `commitRead`
 * (the compare basis of the marker; `foreignClear` is the question for another owner's standing marker).
 */
export type SeedEntry =
    | { kind: 'first-life', grant: FirstLifeGrant }
    | { kind: 'exit', commitRead: Store2Read, foreignClear?: ForeignClearHook | null }

export interface SeedOptions {
    owner: string
    lists: ListDerivation
    env?: KeyEnv
}

/**
 * A marker that did not land. A conflict, an abandonment, a lost response and a store that is no longer empty mean a
 * peer moved first or the write may have landed: the boot is classified again. A failed listing or write blocks.
 */
function outcomeOfMarker(marker: Extract<FirstLifeResult, { status: 'not-marked' }>['marker']): SeedOutcome {
    switch (marker.status) {
        case 'conflict':
        case 'abandoned':
        case 'unknown':
            return { status: 'reclassify' }
        case 'refused':
            return marker.reason === 'store-not-empty'
                ? { status: 'reclassify' }
                : { status: 'blocked', reason: 'presence-unknown', detail: 'The store2 listing failed before the seed marker was written.' }
        case 'failed':
            return { status: 'blocked', reason: 'marker-failed', detail: marker.cause.message }
    }
}

/**
 * Installs the empty profile under `entry`: the marker (unfenced on a grant, fenced on an exit), the staged tree and the
 * one final compare-and-write. On the `exit` entry the fenced exit is the first write; a fence that does not end
 * `written`, or any other non-`marked` outcome, is passed through with nothing staged.
 */
export async function seedStore2Profile(backend: Store2Backend, entry: SeedEntry, options: SeedOptions): Promise<SeedOutcome> {
    const request = await planWholeTreeInstall(emptySeedProfile(), { lists: options.lists, env: options.env, convertedFrom: 'seed' })
    let result: FirstLifeResult
    if (entry.kind === 'first-life') {
        result = await firstLifeInstall(backend, entry.grant, request, { owner: options.owner, env: options.env })
    } else {
        const env: KeyEnv = { ...defaultKeyEnv, ...options.env }
        const exit = await runExit(backend, entry.commitRead, { kind: 'seed' }, { owner: options.owner, env, foreignClear: entry.foreignClear })
        if (exit.status !== 'marked') {
            return { status: 'exit', exit }
        }
        result = await installBuilt({ backend, env, marked: exit }, request)
    }
    switch (result.status) {
        case 'installed':
            return { status: 'installed', manifestKey: result.manifestKey, flushed: result.flushed }
        case 'abandoned':
            return { status: 'reclassify' }
        case 'not-marked':
            return outcomeOfMarker(result.marker)
        case 'unknown':
            return { status: 'blocked', reason: 'install-unknown', detail: result.cause.message }
        case 'invalid':
            return { status: 'blocked', reason: 'install-invalid', detail: result.problem.kind }
        case 'upload-failed':
        case 'failed':
            return { status: 'blocked', reason: `install-${result.status}`, detail: result.cause.message }
    }
}
