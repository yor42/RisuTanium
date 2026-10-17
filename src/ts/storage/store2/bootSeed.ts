import type { Database } from '../database.svelte'
import type { Store2Backend } from './backend/types'
import type { ListDerivation } from './codec'
import { firstLifeInstall, type FirstLifeGrant, type FirstLifeResult } from './firstLife'
import type { KeyEnv } from './format'
import { planWholeTreeInstall } from './legacy/install'

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
    | { status: 'blocked', reason: string, detail: string }

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

/** Installs the empty profile under `grant`: the unfenced marker, the staged tree and the one final compare-and-write. */
export async function seedStore2Profile(backend: Store2Backend, grant: FirstLifeGrant, options: SeedOptions): Promise<SeedOutcome> {
    const request = await planWholeTreeInstall(emptySeedProfile(), { lists: options.lists, env: options.env, convertedFrom: 'seed' })
    const result = await firstLifeInstall(backend, grant, request, { owner: options.owner, env: options.env })
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
