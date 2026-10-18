import { BLOCKS_PREFIX, HEAD_KEY, LEGACY_MAIN_FILE_KEY, NUMBERED_BACKUP_PREFIX, PRE_BLOCKS_PREFIX } from '../../blockKeys'
import type { ByteStore } from '../../store/contract'
import { indexedDbAddressableViolation, nodeAddressableViolation, tauriAddressableViolation } from '../../store/keyRules'
import { unitDigest } from '../codec/reuse'
import type { BuiltInstall } from '../firstLife'
import { encodeUnit, isOldDataKey, UNIT_TYPE, type DeletionSnapshot, type DeletionSnapshotKind, type LegacyList } from '../format'

/**
 * The plan of the old-data deletion: which fork-format keys a later pass may delete after a conversion or a seed, taken
 * once while the install is built and persisted with it as a type 24 unit.
 *
 * The kind of a plan is decided from what the store holds when the plan is made and from the legacy files this attempt
 * walked, never from which code path asked: a seed, a row-9 re-run and a recovery fresh start can all run over a profile
 * that still holds the upstream main file, and a plan that trusted the path would delete cold units the upstream files
 * still reference. `coldstorage/` keys are listed only when the plan can show that no upstream file needs them.
 *
 * Nothing here deletes, writes or throws out of a store failure: a listing that fails means no plan, and the install goes
 * on without one (the cleanup is optional).
 */

/** What the plan reads of the page: its byte store and the numbered-backup listing the boot uses. */
export interface OldDataSource {
    store: ByteStore
    /** The numbered backups, newest first, without pruning anything. */
    listBackupTimes: () => Promise<number[]>
    /** The platform's unit naming; the page's own (`coldUnitKeyOfStoreKey`) when absent. */
    unitIdOf?: UnitIdOf
}

/** What the store held when the plan was made. `unknown` is a probe that failed. */
export interface OldDataObservation {
    mainFile: boolean | 'unknown'
    backups: readonly number[] | 'unknown'
    /** The listings of `blocks/`, `database/` and `coldstorage/`; null when any of them failed. */
    listing: { blocks: readonly string[], database: readonly string[], coldstorage: readonly string[] } | null
}

/** The legacy list this attempt built and the union of the unit ids its walks reached (`collectLegacyColdKeys`). */
export interface WalkedLegacy {
    list: LegacyList
    coldKeys: ReadonlySet<string>
}

/** The unit id a listed `coldstorage/` key stands for, or null when it is not a unit directly under that prefix (the platform names units differently). */
export type UnitIdOf = (storeKey: string) => string | null

const COLD_PREFIX = 'coldstorage/'
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACCESS_META_SUFFIX = '_accessMeta'

function compareCodeUnits(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0
}

/**
 * The key names of the numbered backups, sorted and without repeats. The plan records this form and the pass that
 * deletes re-lists through the same function, so the two compare as sets.
 */
export function backupNamesOf(times: readonly number[]): string[] {
    return Array.from(new Set(times.map(time => `${NUMBERED_BACKUP_PREFIX}${time}.bin`))).sort(compareCodeUnits)
}

/** Reads the store; any probe that fails becomes `unknown`, and a failed listing becomes no listing. */
export async function observeOldData(source: OldDataSource): Promise<OldDataObservation> {
    let mainFile: OldDataObservation['mainFile']
    try {
        mainFile = await source.store.has(LEGACY_MAIN_FILE_KEY)
    } catch {
        mainFile = 'unknown'
    }
    let backups: OldDataObservation['backups']
    try {
        backups = await source.listBackupTimes()
    } catch {
        backups = 'unknown'
    }
    let listing: OldDataObservation['listing']
    try {
        const blocks = await source.store.list(BLOCKS_PREFIX)
        const database = await source.store.list('database/')
        const coldstorage = await source.store.list(COLD_PREFIX)
        listing = { blocks, database, coldstorage }
    } catch {
        listing = null
    }
    return { mainFile, backups, listing }
}

/** Whether every store the app runs on can address `key`: the strictest of their rules, so a key one store would refuse is never listed. */
function storeCanAddress(key: string): boolean {
    return nodeAddressableViolation(key) === null
        && indexedDbAddressableViolation(key) === null
        && tauriAddressableViolation(key, 'windows') === null
}

/** Whether the listed key is a companion of a cold unit (`<id>_accessMeta`, with the desktop's `.json`), which no walk names. */
function isAccessMetaKey(storeKey: string): boolean {
    const name = storeKey.slice(COLD_PREFIX.length)
    return name.endsWith(ACCESS_META_SUFFIX) || name.endsWith(`${ACCESS_META_SUFFIX}.json`)
}

/** A `database/` file that looks like a save: a name this build does not recognise but whose absence from the plan could hide an upstream file. */
function looksLikeSave(key: string): boolean {
    return /\.bin$/i.test(key) || key.startsWith('database/database') || key.startsWith('database/dbbackup')
}

/**
 * Whether every upstream file the store holds was read to its end in this attempt's walks, and the `database/` listing
 * holds no save-like file the plan does not know. Derived from the built legacy list itself: the main file and each
 * numbered backup must be listed `ok`, which is false for a tree that came from a backup or the lenient decode.
 */
function exclusionIsComplete(
    observation: OldDataObservation, backupNames: readonly string[] | null, walked: WalkedLegacy | null, database: readonly string[],
): boolean {
    if (walked === null || observation.mainFile === 'unknown' || backupNames === null) {
        return false
    }
    const status = new Map(walked.list.files.map(file => [file.key, file.status] as const))
    for (const file of walked.list.files) {
        if (file.status !== 'ok') {
            return false
        }
    }
    if (observation.mainFile && status.get(LEGACY_MAIN_FILE_KEY) !== 'ok') {
        return false
    }
    for (const name of backupNames) {
        if (status.get(name) !== 'ok') {
            return false
        }
    }
    const known = new Set<string>([LEGACY_MAIN_FILE_KEY, ...backupNames])
    for (const key of database) {
        if (!known.has(key) && !key.startsWith(PRE_BLOCKS_PREFIX) && looksLikeSave(key)) {
            return false
        }
    }
    return true
}

function coldKeysToList(
    kind: DeletionSnapshotKind, coldstorage: readonly string[], walked: WalkedLegacy | null, unitIdOf: UnitIdOf,
): string[] {
    if (kind === 'fork-format-only') {
        return []
    }
    const out: string[] = []
    for (const key of coldstorage) {
        if (isAccessMetaKey(key)) {
            continue
        }
        if (kind === 'exclusion') {
            const unit = unitIdOf(key)
            if (unit === null || !UUID_SHAPE.test(unit) || walked === null || walked.coldKeys.has(unit)) {
                continue
            }
        }
        out.push(key)
    }
    return out
}

/**
 * The snapshot to persist, or null when there is nothing to delete or no safe plan: no `blocks/` key means no fork marker
 * and no plan, and a failed listing means no plan. `walked` is this attempt's legacy list; a seed has none.
 */
export function planOldDataDeletion(
    observation: OldDataObservation, walked: WalkedLegacy | null, unitIdOf: UnitIdOf,
): DeletionSnapshot | null {
    const { listing } = observation
    if (listing === null || listing.blocks.length === 0) {
        return null
    }
    const backupNames = observation.backups === 'unknown' ? null : backupNamesOf(observation.backups)
    let kind: DeletionSnapshotKind
    if (observation.mainFile === false && backupNames !== null && backupNames.length === 0) {
        kind = 'fork-only'
    } else if (exclusionIsComplete(observation, backupNames, walked, listing.database)) {
        kind = 'exclusion'
    } else {
        kind = 'fork-format-only'
    }
    const cold = coldKeysToList(kind, listing.coldstorage, walked, unitIdOf)
    const preBlocks = listing.database.filter(key => key.startsWith(PRE_BLOCKS_PREFIX))
    const blocks = listing.blocks.filter(key => key !== HEAD_KEY)
    const head = listing.blocks.filter(key => key === HEAD_KEY)
    const keys = Array.from(new Set([
        ...cold.sort(compareCodeUnits),
        ...preBlocks.sort(compareCodeUnits),
        ...blocks.sort(compareCodeUnits),
        ...head,
    ])).filter(key => isOldDataKey(key) && storeCanAddress(key))
    if (keys.length === 0) {
        return null
    }
    return {
        v: 1,
        kind,
        upstream: { main: observation.mainFile === true, backups: backupNames ?? [] },
        keys,
    }
}

/**
 * The page's unit naming, loaded when a plan needs it: the module reads the platform at load, so a caller that never plans
 * does not pull it in. A module that cannot load names no unit, which keeps every `coldstorage/` key an exclusion plan would list.
 */
async function pageUnitIdOf(): Promise<UnitIdOf> {
    try {
        return (await import('../../../process/coldUnitLocation')).coldUnitKeyOfStoreKey
    } catch {
        return () => null
    }
}

/** Observes the store and plans over it; null when there is nothing to plan. */
export async function planOldDataSnapshot(source: OldDataSource, walked: WalkedLegacy | null): Promise<DeletionSnapshot | null> {
    const observation = await observeOldData(source)
    return planOldDataDeletion(observation, walked, source.unitIdOf ?? await pageUnitIdOf())
}

/**
 * The install with the snapshot as one more unit, minted from the staging mint so it lands under the marker's prefix,
 * written before the manifest and pointed at from the commit key by the installer. `null` leaves the install as it is.
 */
export function withSnapshot(install: BuiltInstall, snapshot: DeletionSnapshot | null): BuiltInstall {
    if (snapshot === null) {
        return install
    }
    return {
        ...install,
        newUnits: install.newUnits + 1,
        async build(context) {
            const built = await install.build(context)
            const key = context.mint.unit()
            const bytes = encodeUnit(UNIT_TYPE.deletionSnapshot, snapshot)
            built.units.push({ key, bytes })
            built.snapshot = { key, digest: unitDigest(bytes), count: snapshot.keys.length }
            return built
        },
    }
}
