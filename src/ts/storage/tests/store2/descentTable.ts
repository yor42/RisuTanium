import { bucketOfKey, moduleIndexOfParts, type EncodedTree } from '../../store2/codec'
import { keyOfRef, parseModuleBucket, parseModuleIndex, readUnit, UNIT_TYPE, type Manifest, type ModuleBucket, type ModuleIndex, type ModuleIndexRoot, type UnitType } from '../../store2/format'
import { bodyIn, identitiesWhere, unitOf } from './codecFixtures'

/**
 * The manifest positions whose unit names further units, which every test walker
 * (the commit invariant, the replay checker, the recovery closure and the live
 * server observer) must open. One table for all of them, written by hand and
 * independent of the production tables: a walker that shared a production table
 * would stop checking the unit that table lost. `descentTable.test.ts` compares the
 * three production tables against it.
 */
export const TEST_DESCENT: Readonly<Record<string, UnitType>> = {
    'shards[]': UNIT_TYPE.shard,
    'fixed.moduleIndex': UNIT_TYPE.moduleIndex,
    'fixed.moduleBuckets[]': UNIT_TYPE.moduleBucket,
    'fixed.pluginStorage.refs[]': UNIT_TYPE.pluginStorageBucket,
}

/** The unit types whose bodies name further units: the manifest and every type `TEST_DESCENT` descends into. */
export const TEST_PARENT_TYPES: ReadonlySet<UnitType> = new Set<UnitType>([UNIT_TYPE.manifest, ...Object.values(TEST_DESCENT)])

/** Identity prefix of the type 27 units the encoder names `moduleIndex:bucket:<position>`. */
export const MODULE_BUCKET_IDENTITY = 'moduleIndex:bucket:'

/** The identity of the bucket unit that holds the entry of module `moduleId` in `tree`, whose manifest names the bucket count. */
export function moduleBucketIdentity(tree: EncodedTree, moduleId: string): string {
    const count = tree.manifest.fixed.moduleBuckets?.length
    if (count === undefined) {
        throw new Error('The tree has no module buckets.')
    }
    return `${MODULE_BUCKET_IDENTITY}${bucketOfKey(moduleId, count)}`
}

/**
 * The logical module index of `tree`, whatever layout wrote it: the type 10 unit itself under layout 1, or the root
 * resolved through the buckets in manifest order under layout 2. `earlier` names the encodes that wrote reused units.
 */
export function logicalModuleIndex(tree: EncodedTree, ...earlier: EncodedTree[]): ModuleIndex {
    const root = parseModuleIndex(bodyIn(unitOf(tree, 'moduleIndex'), ...earlier))
    if (root.status !== 'ok') {
        throw new Error(`The module index root does not parse: ${root.reason}`)
    }
    const identities = identitiesWhere(tree, MODULE_BUCKET_IDENTITY)
        .sort((a, b) => Number(a.slice(MODULE_BUCKET_IDENTITY.length)) - Number(b.slice(MODULE_BUCKET_IDENTITY.length)))
    const buckets = tree.manifest.fixed.moduleBuckets === undefined ? undefined : identities.map((identity) => {
        const parsed = parseModuleBucket(bodyIn(unitOf(tree, identity), ...earlier))
        if (parsed.status !== 'ok') {
            throw new Error(`A module bucket does not parse: ${parsed.reason}`)
        }
        return parsed.value
    })
    return moduleIndexOfParts(root.value, buckets)
}

/**
 * The logical module index of `manifest` as the stored bytes hold it: the root and, under the bucketed layout, the
 * buckets the manifest names, read through `unitAt` (a snapshot of a backend). A unit that is absent or does not parse is a
 * test error.
 */
export function storedLogicalModuleIndex(unitAt: (key: string) => Uint8Array | undefined, manifest: Manifest): ModuleIndex {
    const rootBytes = unitAt(keyOfRef(manifest.fixed.moduleIndex))
    if (rootBytes === undefined) {
        throw new Error('The module index unit is not stored.')
    }
    const root = readUnit(rootBytes, UNIT_TYPE.moduleIndex)
    if (root.status !== 'ok') {
        throw new Error(`The module index is ${root.status}.`)
    }
    const buckets = manifest.fixed.moduleBuckets?.map((ref, position) => {
        const bytes = unitAt(keyOfRef(ref))
        if (bytes === undefined) {
            throw new Error(`Module bucket ${position} is not stored.`)
        }
        const bucket = readUnit(bytes, UNIT_TYPE.moduleBucket)
        if (bucket.status !== 'ok') {
            throw new Error(`Module bucket ${position} is ${bucket.status}.`)
        }
        return bucket.value.body as ModuleBucket
    })
    return moduleIndexOfParts(root.value.body as ModuleIndexRoot, buckets)
}
