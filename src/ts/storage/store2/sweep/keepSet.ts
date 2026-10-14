import {
    ASSET_REF_V, IL_REF_V, splitHashStems,
    type AssetList, type CommitKey, type InlayList, type LegacyList, type Manifest, type ModuleEntry, type ShardEntry,
} from '../format'
import { AssetKeySet } from './assetKey'
import {
    ownerLabel,
    type AssetKeepSet, type ClosureReader, type Incomplete, type IncompleteCode, type InlayKeepSet,
    type KeepManifestKeys, type KeepSetResult, type NodeRead, type OwnerRef, type Rederive,
    COMPLETE,
} from './types'

/**
 * Keep-set builders. A keep-set is the union of what every manifest the commit
 * key still names (`current`, `retained`, `pins`) and the legacy unit protect.
 * A builder returns either a complete keep-set or the reasons it is incomplete;
 * a partial keep-set is never returned, so a caller cannot delete against one.
 * Over-protection is the safe direction: when a node or list cannot be trusted
 * the result is incomplete, not a guess.
 */

export interface KeepSetInput {
    /** A commit key that parsed with a known format; fences are checked by `checkFences`. */
    commitKey: CommitKey
    reader: ClosureReader
    /** Re-derives a stale list from the owner's core; absent means "cannot", so a stale list makes the result incomplete. */
    rederive?: Rederive
}

export interface AssetKeepSetInput extends KeepSetInput {
    /** Asset names the live database refers to right now. */
    residentRefs?: Iterable<string>
    /** Asset names this page wrote since the commit that `commitKey` is. */
    writtenThisPage?: Iterable<string>
}

/** `{current} ∪ retained ∪ pins`, without repeats. A null `current` yields none: the caller reports it. */
export function keepManifestKeys(commitKey: CommitKey): KeepManifestKeys {
    const keys: string[] = []
    const add = (key: string): void => {
        if (!keys.includes(key)) {
            keys.push(key)
        }
    }
    if (commitKey.current !== null) {
        add(commitKey.current.key)
    }
    for (const entry of commitKey.retained) {
        add(entry.key)
    }
    for (const pin of commitKey.pins) {
        add(pin.key)
    }
    return keys
}

/** The legacy files of every manifest in `manifests`, for the fence check. */
export function legacyFilesOf(manifests: readonly Manifest[]): { key: string, status: 'ok' | 'unreadable' | 'gone' }[] {
    return manifests.flatMap(manifest => manifest.fixed.legacyKeep?.files ?? [])
}

/** Whether a stored list version is usable as is, older than this build's, or newer. */
type VersionState = 'current' | 'stale' | 'newer'

function versionState(v: number, known: number): VersionState {
    return v > known ? 'newer' : v < known ? 'stale' : 'current'
}

interface Sinks {
    config(manifest: Manifest, owner: OwnerRef): Promise<void>
    character(entry: ShardEntry, owner: OwnerRef): Promise<void>
    module(entry: ModuleEntry, owner: OwnerRef): Promise<void>
    legacy(unit: LegacyList, owner: OwnerRef): Promise<void>
}

/** Walk state: the injected reader, the reasons collected, and one read per unit however many manifests share it. */
class Walk {
    readonly reasons: Incomplete[] = []
    private readonly cache = new Map<string, Promise<NodeRead<unknown>>>()

    constructor(readonly reader: ClosureReader) {}

    fail(code: IncompleteCode, detail: string, owner?: OwnerRef): void {
        this.reasons.push(owner === undefined ? { code, detail } : { code, detail, owner })
    }

    /** One read per `kind` and unit key; a reader that throws is a node that could not be read. */
    async read<T>(kind: string, key: string, load: () => Promise<NodeRead<T>>): Promise<NodeRead<T>> {
        const id = `${kind} ${key}`
        let pending = this.cache.get(id)
        if (pending === undefined) {
            pending = load().catch((error: unknown): NodeRead<T> => ({
                status: 'missing',
                reason: error instanceof Error ? error.message : 'The reader failed.',
            }))
            this.cache.set(id, pending)
        }
        return (await pending) as NodeRead<T>
    }

    /** The value of a read, or null after recording why it cannot be used. */
    value<T>(result: NodeRead<T>, what: string, owner?: OwnerRef): T | null {
        switch (result.status) {
            case 'ok':
            case 'stale':
                return result.value
            case 'missing':
                this.fail('node-missing', `${what}: ${result.reason}`, owner)
                return null
            case 'crc-failed':
                this.fail('node-crc-failed', `${what}: ${result.reason}`, owner)
                return null
            case 'damaged':
                this.fail('node-damaged', `${what}: ${result.reason}`, owner)
                return null
            case 'too-new':
                this.fail('node-too-new', `${what}: ${result.reason}`, owner)
                return null
            case 'unreadable':
                this.fail('list-newer', `${what}: ${result.reason}`, owner)
                return null
        }
    }
}

async function walkManifests(input: KeepSetInput, walk: Walk, sinks: Sinks): Promise<void> {
    if (input.commitKey.current === null) {
        walk.fail('no-current', 'The commit key names no current manifest.')
        return
    }
    const { reader } = walk
    for (const key of keepManifestKeys(input.commitKey)) {
        const manifest = walk.value(await walk.read('manifest', key, () => reader.manifest(key)), `manifest ${key}`)
        if (manifest === null) {
            continue
        }
        const config: OwnerRef = { kind: 'config', id: '', manifest: key }
        await sinks.config(manifest, config)

        for (const [index, ref] of manifest.shards.entries()) {
            const shard = walk.value(await walk.read('shard', ref[0], () => reader.shard(ref)), `shard ${index} of ${key}`)
            for (const entry of shard?.entries ?? []) {
                await sinks.character(entry, { kind: 'character', id: entry.u, manifest: key })
            }
        }

        const index = walk.value(
            await walk.read('moduleIndex', manifest.fixed.moduleIndex[0], () => reader.moduleIndex(manifest.fixed.moduleIndex)),
            `module index of ${key}`,
        )
        for (const entry of index?.entries ?? []) {
            await sinks.module(entry, { kind: 'module', id: entry.id, manifest: key })
        }

        const keep = manifest.fixed.legacyKeep
        if (keep !== null) {
            const owner: OwnerRef = { kind: 'legacy', id: '', manifest: key }
            for (const file of keep.files) {
                if (file.status === 'unreadable') {
                    walk.fail('legacy-file-unreadable', `Legacy file ${file.key} is unreadable, so its references are unknown.`, owner)
                }
            }
            const unit = walk.value(
                await walk.read('legacyList', keep.unit[0], () => reader.legacyList(keep.unit)),
                `legacy list of ${key}`,
                owner,
            )
            if (unit !== null) {
                await sinks.legacy(unit, owner)
            }
        }
    }
}

// ---- Asset keep-set ----

async function usableAssetList(
    list: AssetList, owner: OwnerRef, walk: Walk, rederive: Rederive | undefined,
): Promise<AssetList | null> {
    const state = versionState(list.v, ASSET_REF_V)
    if (state === 'newer') {
        walk.fail('list-newer', `Asset list version ${list.v} is above ${ASSET_REF_V}.`, owner)
        return null
    }
    if (state === 'current') {
        return list
    }
    const derived = (await rederive?.assets(owner)) ?? null
    if (derived === null) {
        walk.fail('list-stale', `Asset list version ${list.v} is below ${ASSET_REF_V} and cannot be re-derived.`, owner)
        return null
    }
    if (derived.v !== ASSET_REF_V) {
        walk.fail('list-unusable', `The re-derived asset list is version ${derived.v}, not ${ASSET_REF_V}.`, owner)
        return null
    }
    return derived
}

export async function buildClosureAssetKeepSet(input: AssetKeepSetInput): Promise<KeepSetResult<AssetKeepSet>> {
    const walk = new Walk(input.reader)
    const keep = new AssetKeySet()
    const { reader, rederive } = input

    const add = async (list: AssetList | null, owner: OwnerRef): Promise<void> => {
        const usable = list === null ? null : await usableAssetList(list, owner, walk, rederive)
        if (usable === null) {
            return
        }
        try {
            keep.addList(usable)
        } catch (error) {
            if (!(error instanceof RangeError)) {
                throw error
            }
            walk.fail('list-unusable', `An asset list of ${ownerLabel(owner)} is malformed: ${error.message}`, owner)
        }
    }

    await walkManifests(input, walk, {
        config: async (manifest, owner) => {
            const ref = manifest.fixed.configAl
            await add(walk.value(await walk.read('assetList', ref[0], () => reader.assetList(ref)), `config asset list of ${owner.manifest}`, owner), owner)
        },
        character: async (entry, owner) => {
            const ref = entry.al
            await add(walk.value(await walk.read('assetList', ref[0], () => reader.assetList(ref)), `asset list of character ${entry.u}`, owner), owner)
        },
        module: async (entry, owner) => {
            const ref = entry.al
            await add(walk.value(await walk.read('assetList', ref[0], () => reader.assetList(ref)), `asset list of module ${entry.id}`, owner), owner)
        },
        legacy: async (unit, owner) => {
            await add({ v: unit.v, h: unit.h, l: unit.l }, owner)
        },
    })

    for (const name of input.residentRefs ?? []) {
        keep.addName(name)
    }
    for (const name of input.writtenThisPage ?? []) {
        keep.addName(name)
    }
    return walk.reasons.length > 0
        ? { status: 'incomplete', reasons: walk.reasons }
        : { status: 'complete', keep: { [COMPLETE]: true, holds: name => keep.holds(name) } }
}

// ---- Inlay keep-set ----

async function usableInlayList(
    list: InlayList, owner: OwnerRef, walk: Walk, rederive: Rederive | undefined,
): Promise<{ list: InlayList, unknown: boolean } | null> {
    const state = versionState(list.v, IL_REF_V)
    if (state === 'newer') {
        walk.fail('list-newer', `Inlay list version ${list.v} is above ${IL_REF_V}.`, owner)
        return null
    }
    if (state === 'current' && list.x !== true) {
        return { list, unknown: false }
    }
    const derived = (await rederive?.inlays(owner)) ?? null
    if (state === 'stale') {
        if (derived === null) {
            walk.fail('list-stale', `Inlay list version ${list.v} is below ${IL_REF_V} and cannot be re-derived.`, owner)
            return null
        }
        if (derived.v !== IL_REF_V) {
            walk.fail('list-unusable', `The re-derived inlay list is version ${derived.v}, not ${IL_REF_V}.`, owner)
            return null
        }
        return { list: derived, unknown: derived.x === true }
    }
    // A current-version overflow: exact when re-derived, otherwise the owner stays unknown.
    if (derived !== null && derived.v === IL_REF_V && derived.x !== true) {
        return { list: derived, unknown: false }
    }
    return { list, unknown: true }
}

export async function buildInlayKeepSet(input: KeepSetInput): Promise<KeepSetResult<InlayKeepSet>> {
    const walk = new Walk(input.reader)
    const uuids = new Set<string>()
    const stems = new Set<string>()
    const others = new Set<string>()
    const owners: OwnerRef[] = []
    const unknownOwners: OwnerRef[] = []
    const { reader, rederive } = input

    const add = async (list: InlayList | null, owner: OwnerRef): Promise<void> => {
        owners.push(owner)
        const usable = list === null ? null : await usableInlayList(list, owner, walk, rederive)
        if (usable === null) {
            return
        }
        if (usable.unknown) {
            unknownOwners.push(owner)
            return
        }
        let held: string[]
        try {
            held = splitHashStems(usable.list.h)
        } catch (error) {
            if (!(error instanceof RangeError)) {
                throw error
            }
            walk.fail('list-unusable', `An inlay list of ${ownerLabel(owner)} is malformed: ${error.message}`, owner)
            return
        }
        for (const id of usable.list.u) {
            uuids.add(id.toLowerCase())
        }
        for (const stem of held) {
            stems.add(stem)
        }
        for (const id of usable.list.o) {
            others.add(id)
        }
    }

    await walkManifests(input, walk, {
        config: async (manifest, owner) => {
            const ref = manifest.fixed.il
            await add(walk.value(await walk.read('inlayList', ref[0], () => reader.inlayList(ref)), `config inlay list of ${owner.manifest}`, owner), owner)
        },
        character: async (entry, owner) => {
            const ref = entry.il
            if (ref !== null) {
                await add(walk.value(await walk.read('inlayList', ref[0], () => reader.inlayList(ref)), `inlay list of character ${entry.u}`, owner), owner)
            }
        },
        module: async (entry, owner) => {
            const ref = entry.il
            if (ref !== null) {
                await add(walk.value(await walk.read('inlayList', ref[0], () => reader.inlayList(ref)), `inlay list of module ${entry.id}`, owner), owner)
            }
        },
        legacy: async (unit, owner) => {
            // One body carries two inlay versions (`iv` and the inner list's `v`): any above known is newer, otherwise any below is stale.
            const above = unit.iv > IL_REF_V || unit.i.v > IL_REF_V
            await add({ ...unit.i, v: above ? Math.max(unit.iv, unit.i.v) : Math.min(unit.iv, unit.i.v) }, owner)
        },
    })

    return walk.reasons.length > 0
        ? { status: 'incomplete', reasons: walk.reasons }
        : { status: 'complete', keep: { [COMPLETE]: true, uuids, stems, others, owners, unknownOwners } }
}
