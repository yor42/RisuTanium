import { carryUnknownFields, KNOWN_FIELDS, unionReq, type ListRef, type Manifest, type Ref } from '../format'
import { PLUGIN_STORAGE_BUCKETS } from './pluginStorage'
import { SHARD_COUNT } from './shard'

/**
 * Manifest assembly. The manifest is write-once, names only fixed-size sets of
 * units (the shards, the fixed units, one Ref per preset, plugin and plugin
 * storage bucket) and never a per-character or per-module list, so its size does
 * not grow with the number of characters, chats or modules.
 */

/** This step uses no feature a reader must know: the `req` of every manifest it writes. */
export const MANIFEST_REQ: readonly string[] = []

export interface ManifestParts {
    seq: number
    createdAt: number
    shards: Ref[]
    config: Ref
    configAl: ListRef
    il: ListRef
    statics: Ref
    order: Ref
    loadouts: Ref
    moduleIndex: Ref
    presets: Ref[]
    plugins: Ref[]
    pluginStorageRefs: Ref[]
}

/**
 * `next` with the fields of the previous manifest this build does not know, at
 * the top level, in `fixed` and in `fixed.pluginStorage`, and with the union of
 * both `req` lists: a writer never drops a field or a requirement a newer build
 * added.
 */
export function carryManifest(prev: Manifest | undefined, next: Manifest): Manifest {
    if (prev === undefined) {
        return next
    }
    carryUnknownFields(prev, next, KNOWN_FIELDS.manifest)
    carryUnknownFields(prev.fixed, next.fixed, KNOWN_FIELDS.manifestFixed)
    carryUnknownFields(prev.fixed.pluginStorage, next.fixed.pluginStorage, KNOWN_FIELDS.manifestPluginStorage)
    next.req = unionReq(next.req, prev.req)
    return next
}

/**
 * The manifest body. `legacyKeep` is written null: the legacy list belongs to
 * the conversion step, which must take it from the previous manifest (carrying
 * the unknown fields inside it) before the codec is wired, because a re-encode
 * here erases a previous keep set.
 */
export function buildManifest(parts: ManifestParts): Manifest {
    return {
        fmt: 1,
        req: [...MANIFEST_REQ],
        seq: parts.seq,
        createdAt: parts.createdAt,
        shardCount: SHARD_COUNT,
        shards: parts.shards,
        fixed: {
            config: parts.config,
            configAl: parts.configAl,
            il: parts.il,
            statics: parts.statics,
            order: parts.order,
            loadouts: parts.loadouts,
            moduleIndex: parts.moduleIndex,
            presets: parts.presets,
            plugins: parts.plugins,
            pluginStorage: { buckets: PLUGIN_STORAGE_BUCKETS, refs: parts.pluginStorageRefs },
            legacyKeep: null,
        },
    }
}
