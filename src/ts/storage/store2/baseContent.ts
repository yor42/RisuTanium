import { isStore2Key } from '../store/keyRules'
import type { Store2Backend, Store2Read } from './backend/types'
import { unitDigest, type ReusableUnit } from './codec'
import { classifyCommitRead } from './commitKey'
import {
    decodeFrame, FRAME_OVERHEAD, keyOfTail, PARENT_UNIT_TYPES, readUnit, refOfFrame, refsOf, UNIT_TYPE,
    type RefTarget, type UnitType,
} from './format'
import { checkManifestKey, readBatch, TREE_READ_TYPES } from './tree'

/**
 * The content index of the base tree an import is built over: every unit the commit key's `current` manifest names,
 * by the digest of its framed bytes, so an import can take a stored unit's key for a unit of equal content.
 *
 * Indexed: the units the manifest names and the units its parents name (shards, the module index and its buckets, the
 * plugin-storage buckets), the module index, module buckets and plugin-storage buckets included. Never indexed: the
 * manifest, shards, the `order` unit (the only units that hold an entity id), the legacy keep and legacy lists. Only
 * `current` is walked: a retained or pinned manifest is not named by the commit that carries this index, so a unit
 * only it names could be freed while the carried manifest stays named.
 *
 * A unit enters the index only when its bytes are the unit its referrer's Ref names (length and CRC) and its frame
 * decodes. A parent is walked only when it also reads as its expected type. Any problem only removes candidates (the
 * import never refuses or waits on the index): an absent, damaged or mismatched unit, a body whose references are
 * malformed, a batch with a non-binary entry (retried key by key) are skipped with the units only they name, and a
 * backend failure ends the walk and keeps what was indexed. A programming error still throws.
 *
 * Keys are never written twice, so a digest stays true for its key. The index is frozen once returned and holds no
 * unit bytes; candidates per digest are in walk order, which is deterministic for a given base.
 */

/** Keys per backend read. */
export const BASE_INDEX_BATCH_KEYS = 256
/** Summed framed length (from the referrers' Refs) after which a read batch ends. A batch holds at least one key. */
export const BASE_INDEX_BATCH_BYTES = 8 * 1024 * 1024

export interface BaseContentStats {
    /** Units indexed. */
    units: number
    /** Framed bytes of the units indexed. */
    bytes: number
    /** Units the walk could not use: absent, damaged, mismatched, malformed, or unreadable as a parent. */
    skipped: number
    /** The walk ended on a backend failure; the index holds what was read before it. */
    backendError: boolean
}

export interface BaseContentIndex {
    /** The key of the manifest the index was read from; null when there is no usable base (the index is then empty). */
    from: string | null
    /** Candidates per digest of the framed bytes, in walk order. */
    units: ReadonlyMap<string, readonly ReusableUnit[]>
    stats: BaseContentStats
}

export interface BaseContentOptions {
    /** Awaited after each read batch. */
    yieldFn?: () => Promise<void>
    batchKeys?: number
    batchBytes?: number
}

/** A unit still to read: the Ref its referrer holds and, for a parent, the type its body must read as. */
interface Pending {
    key: string
    bytes: number
    crc: number
    parent: UnitType | null
}

const NOT_INDEXED: ReadonlySet<UnitType> = new Set<UnitType>([UNIT_TYPE.manifest, UNIT_TYPE.shard, UNIT_TYPE.order, UNIT_TYPE.legacyList])
const PARENT_TYPES: ReadonlySet<UnitType> = PARENT_UNIT_TYPES
/** Manifest positions that are never read: the order unit holds entity ids and the legacy keep travels by value. */
const MANIFEST_SKIPPED_PATHS: ReadonlySet<string> = new Set(['fixed.order', 'fixed.legacyKeep.unit'])

function emptyIndex(skipped: number, backendError: boolean): BaseContentIndex {
    return { from: null, units: new Map(), stats: { units: 0, bytes: 0, skipped, backendError } }
}

/** `refsOf` of a stored body; a malformed reference is data, not a programming error, and answers null. */
function targetsOf(type: UnitType, body: object): RefTarget[] | null {
    try {
        return refsOf(type, body)
    } catch (error) {
        if (error instanceof TypeError) {
            return null
        }
        throw error
    }
}

/**
 * The bytes of `keys`, or null when the backend failed. A batch with a non-binary entry is read again key by key, so
 * only that entry is lost (it answers null, as an absent unit does).
 */
async function readKeys(backend: Store2Backend, keys: readonly string[]): Promise<Map<string, Uint8Array | null> | null> {
    const first = await readBatch(backend, keys)
    if (first.status === 'read') {
        return first.units
    }
    if (first.status === 'unreadable') {
        return null
    }
    const units = new Map<string, Uint8Array | null>()
    for (const key of keys) {
        const one = await readBatch(backend, [key])
        if (one.status === 'unreadable') {
            return null
        }
        units.set(key, one.status === 'read' ? one.units.get(key) ?? null : null)
    }
    return units
}

/** Splits `items` into read batches of at most `maxKeys` keys and about `maxBytes` bytes; a batch holds at least one item. */
function batchesOf(items: readonly Pending[], maxKeys: number, maxBytes: number): Pending[][] {
    const batches: Pending[][] = []
    let batch: Pending[] = []
    let bytes = 0
    for (const item of items) {
        if (batch.length > 0 && (batch.length >= maxKeys || bytes + item.bytes > maxBytes)) {
            batches.push(batch)
            batch = []
            bytes = 0
        }
        batch.push(item)
        bytes += item.bytes
    }
    if (batch.length > 0) {
        batches.push(batch)
    }
    return batches
}

/**
 * Builds the content index of the manifest `read` (the commit key's bytes) names as `current`. Never writes. An empty
 * index with `from: null` answers a commit key that is not parsed or names no current, and a manifest that is absent,
 * damaged, too new or whose references are malformed.
 */
export async function readBaseContentIndex(
    backend: Store2Backend, read: Pick<Store2Read, 'bytes'>, options: BaseContentOptions = {},
): Promise<BaseContentIndex> {
    const maxKeys = Math.max(1, options.batchKeys ?? BASE_INDEX_BATCH_KEYS)
    const maxBytes = options.batchBytes ?? BASE_INDEX_BATCH_BYTES
    const commit = classifyCommitRead(read)
    if (commit.status !== 'parsed' || commit.value.current === null) {
        return emptyIndex(0, false)
    }
    const from = commit.value.current.key
    if (checkManifestKey(from) !== null) {
        return emptyIndex(1, false)
    }
    const manifestRead = await readKeys(backend, [from])
    if (manifestRead === null) {
        return emptyIndex(0, true)
    }
    const manifestBytes = manifestRead.get(from) ?? null
    const manifestUnit = manifestBytes === null ? null : readUnit(manifestBytes, UNIT_TYPE.manifest)
    if (manifestUnit === null || (manifestUnit.status !== 'ok' && manifestUnit.status !== 'stale')) {
        return emptyIndex(1, false)
    }
    const manifestTargets = targetsOf(UNIT_TYPE.manifest, manifestUnit.value.body)
    if (manifestTargets === null) {
        return emptyIndex(1, false)
    }

    const units = new Map<string, ReusableUnit[]>()
    const stats: BaseContentStats = { units: 0, bytes: 0, skipped: 0, backendError: false }
    const seen = new Set<string>()
    const enqueue = (target: RefTarget, parent: UnitType | null, into: Pending[]): void => {
        const key = keyOfTail(target.tail)
        if (!isStore2Key(key) || target.bytes === null || target.crc === null) {
            stats.skipped++
            return
        }
        if (seen.has(key)) {
            return
        }
        seen.add(key)
        into.push({ key, bytes: target.bytes, crc: target.crc, parent })
    }

    let level: Pending[] = []
    for (const target of manifestTargets) {
        if (MANIFEST_SKIPPED_PATHS.has(target.path)) {
            continue
        }
        const type = TREE_READ_TYPES[target.path]
        enqueue(target, type !== undefined && PARENT_TYPES.has(type) ? type : null, level)
    }

    while (level.length > 0 && !stats.backendError) {
        const next: Pending[] = []
        for (const batch of batchesOf(level, maxKeys, maxBytes)) {
            const bytesOf = await readKeys(backend, batch.map(item => item.key))
            if (bytesOf === null) {
                stats.backendError = true
                break
            }
            for (const item of batch) {
                const bytes = bytesOf.get(item.key) ?? null
                if (bytes === null || bytes.length < FRAME_OVERHEAD) {
                    stats.skipped++
                    continue
                }
                const ref = refOfFrame(item.key, bytes)
                if (ref[1] !== item.bytes || ref[2] !== item.crc) {
                    stats.skipped++
                    continue
                }
                let type: UnitType
                if (item.parent !== null) {
                    const parsed = readUnit(bytes, item.parent)
                    const children = parsed.status === 'ok' || parsed.status === 'stale' ? targetsOf(item.parent, parsed.value.body) : null
                    if (children === null) {
                        stats.skipped++
                        continue
                    }
                    for (const child of children) {
                        enqueue(child, null, next)
                    }
                    type = item.parent
                } else {
                    const frame = decodeFrame(bytes)
                    if (frame.status !== 'ok') {
                        stats.skipped++
                        continue
                    }
                    type = frame.type
                }
                if (NOT_INDEXED.has(type)) {
                    continue
                }
                const digest = unitDigest(bytes)
                const candidates = units.get(digest)
                const entry: ReusableUnit = { key: item.key, type, ref, digest }
                if (candidates === undefined) {
                    units.set(digest, [entry])
                } else {
                    candidates.push(entry)
                }
                stats.units++
                stats.bytes += bytes.length
            }
            await options.yieldFn?.()
        }
        level = next
    }

    if (stats.skipped > 0 || stats.backendError) {
        console.warn(`The base content index is partial: ${stats.units} units indexed, ${stats.skipped} skipped${stats.backendError ? ', the walk ended on a backend failure' : ''}.`)
    }
    for (const candidates of units.values()) {
        Object.freeze(candidates)
    }
    return Object.freeze({ from, units, stats })
}
