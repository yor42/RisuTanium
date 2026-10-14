import { Store2BackendError, Store2NotBinaryError } from './backend/errors'
import type { Store2Backend } from './backend/types'
import { isStore2Key } from '../store/keyRules'
import {
    keyOfTail, parseStore2Key, readUnit, refOfFrame, refsOf, UNIT_TYPE, type Manifest, type UnitType,
} from './format'

/**
 * The read-only tree read: a manifest and the units a mark or a load of it needs
 * to decide whether the tree is usable, each checked by its own frame and against
 * the size and checksum its referrer holds. It never writes and never deletes.
 *
 * The units read are the ones a mark reads (manifest, shards, module index,
 * plugin-storage buckets, the asset list `configAl` and the inlay list `fixed.il`),
 * chosen from the manifest's references by path, so a position `refsOf` knows is
 * read here without a second list of references. Leaves named by those units
 * (cores, chat chunks, presets, plugins) are not read: a caller that needs their
 * presence compares them with a listing.
 */

/** The manifest positions this read opens, with the unit type each must hold. */
export const TREE_READ_TYPES: Readonly<Record<string, UnitType>> = {
    'shards[]': UNIT_TYPE.shard,
    'fixed.moduleIndex': UNIT_TYPE.moduleIndex,
    'fixed.pluginStorage.refs[]': UNIT_TYPE.pluginStorageBucket,
    'fixed.configAl': UNIT_TYPE.assetList,
    'fixed.il': UNIT_TYPE.inlayList,
}

/**
 * What a tree read came to.
 *   ok:         every unit was present and valid; `keys` is every full key read, the manifest first. `newerLists` holds
 *               the asset or inlay list keys whose version is above this build's: still a readable tree node, but
 *               a pass that needs the list's contents is incomplete and deletes nothing.
 *   missing:    the units in `keys` are absent and none read was damaged or too new.
 *   damaged:    a unit failed its frame, schema, size or checksum; `keys` lists those, `missing` the absent ones.
 *   too-new:    a unit has a valid header this build does not understand (a newer format, an unknown codec, type or `req`
 *               token); `keys` lists those. Wins over every other outcome, because a newer writer's tree must not be
 *               treated as broken.
 *   unreadable: the backend failed; nothing is known about the tree.
 */
export type TreeRead =
    | { status: 'ok', manifestKey: string, manifest: Manifest, keys: string[], newerLists: string[] }
    | { status: 'missing', manifestKey: string, keys: string[] }
    | { status: 'damaged', manifestKey: string, keys: string[], missing: string[], reason: string }
    | { status: 'too-new', manifestKey: string, keys: string[], reason: string }
    | { status: 'unreadable', manifestKey: string, cause: Store2BackendError }

interface Expectation {
    type: UnitType
    bytes: number | null
    crc: number | null
}

function lengthAndCrcMatch(key: string, bytes: Uint8Array, expected: Expectation): boolean {
    return (expected.bytes === null || bytes.length === expected.bytes)
        && (expected.crc === null || refOfFrame(key, bytes)[2] === expected.crc)
}

/** Reads `keys` in one batch; a backend failure is the caller's `unreadable`, a non-binary entry is damaged data. */
async function readBatch(backend: Store2Backend, keys: readonly string[]): Promise<
    { status: 'read', units: Map<string, Uint8Array | null> } | { status: 'not-binary', key: string } | { status: 'unreadable', cause: Store2BackendError }
> {
    try {
        return { status: 'read', units: await backend.readUnits(keys) }
    } catch (error) {
        if (error instanceof Store2NotBinaryError) {
            return { status: 'not-binary', key: error.key }
        }
        if (error instanceof Store2BackendError) {
            return { status: 'unreadable', cause: error }
        }
        throw error
    }
}

/**
 * Reads the tree of `manifestKey`. Two batched reads at most: the manifest, then
 * every unit it names at a position of `TREE_READ_TYPES`, deduplicated by key
 * (`readUnits` bounds its own parallelism).
 */
export async function readTree(backend: Store2Backend, manifestKey: string): Promise<TreeRead> {
    const shape = parseStore2Key(manifestKey)
    if (shape === null || (shape.shape !== 'manifest' && shape.shape !== 'staged-manifest')) {
        return { status: 'damaged', manifestKey, keys: [manifestKey], missing: [], reason: `${manifestKey} is not a manifest key.` }
    }

    const first = await readBatch(backend, [manifestKey])
    if (first.status === 'unreadable') {
        return { status: 'unreadable', manifestKey, cause: first.cause }
    }
    if (first.status === 'not-binary') {
        return { status: 'damaged', manifestKey, keys: [manifestKey], missing: [], reason: `${manifestKey} is not binary data.` }
    }
    const manifestBytes = first.units.get(manifestKey) ?? null
    if (manifestBytes === null) {
        return { status: 'missing', manifestKey, keys: [manifestKey] }
    }
    const manifestUnit = readUnit(manifestBytes, UNIT_TYPE.manifest)
    if (manifestUnit.status === 'too-new' || manifestUnit.status === 'unreadable') {
        return { status: 'too-new', manifestKey, keys: [manifestKey], reason: manifestUnit.reason }
    }
    if (manifestUnit.status === 'damaged') {
        return { status: 'damaged', manifestKey, keys: [manifestKey], missing: [], reason: manifestUnit.reason }
    }
    const manifest = manifestUnit.value.body as Manifest

    const expectations = new Map<string, Expectation[]>()
    const invalid: string[] = []
    for (const target of refsOf(UNIT_TYPE.manifest, manifest)) {
        const type = TREE_READ_TYPES[target.path]
        if (type === undefined) {
            continue
        }
        const key = keyOfTail(target.tail)
        if (!isStore2Key(key)) {
            invalid.push(key)
            continue
        }
        const list = expectations.get(key) ?? []
        list.push({ type, bytes: target.bytes, crc: target.crc })
        expectations.set(key, list)
    }

    const keys = [manifestKey, ...expectations.keys()]
    const second = await readBatch(backend, [...expectations.keys()])
    if (second.status === 'unreadable') {
        return { status: 'unreadable', manifestKey, cause: second.cause }
    }
    if (second.status === 'not-binary') {
        return { status: 'damaged', manifestKey, keys: [second.key], missing: [], reason: `${second.key} is not binary data.` }
    }

    const missing: string[] = []
    const damaged: string[] = [...invalid]
    const tooNew: string[] = []
    const newerLists: string[] = []
    let reason = invalid.length > 0 ? `${invalid[0]} is not a store2 unit key.` : ''
    let tooNewReason = ''
    for (const [key, wanted] of expectations) {
        const bytes = second.units.get(key) ?? null
        if (bytes === null) {
            missing.push(key)
            continue
        }
        for (const expected of wanted) {
            const unit = readUnit(bytes, expected.type)
            if (unit.status === 'too-new') {
                tooNew.push(key)
                tooNewReason ||= unit.reason
                break
            }
            // A derived list above this build's version has a valid frame: its size and checksum are still checked, and it is not a newer tree format.
            if (unit.status === 'unreadable' && lengthAndCrcMatch(key, bytes, expected)) {
                if (!newerLists.includes(key)) {
                    newerLists.push(key)
                }
                continue
            }
            if (unit.status === 'damaged' || unit.status === 'unreadable' || !lengthAndCrcMatch(key, bytes, expected)) {
                damaged.push(key)
                reason ||= unit.status === 'damaged' ? unit.reason : `${key} does not match the size or checksum its referrer holds.`
                break
            }
        }
    }

    if (tooNew.length > 0) {
        return { status: 'too-new', manifestKey, keys: tooNew, reason: tooNewReason }
    }
    if (damaged.length > 0) {
        return { status: 'damaged', manifestKey, keys: damaged, missing, reason }
    }
    if (missing.length > 0) {
        return { status: 'missing', manifestKey, keys: missing }
    }
    return { status: 'ok', manifestKey, manifest, keys, newerLists }
}
