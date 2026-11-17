/**
 * The asset and inlay plan of a `.rtb` restore (CHORE-128 S11, P.2): which asset entries are copied, which are skipped
 * because the target already holds them, which the page's store cannot create, and which a Node server cannot take. It reads
 * the file's directory and the target's listing only; every store call is injected, and nothing is written.
 *
 * Skip rules (MC-687): an asset is skipped as present only when the target lists the same key with the same size and the
 * key is a hash name (its content is its name). An equal-size literal name is copied with `compare-crc`: the copy step
 * compares the target's CRC-32 with the entry's and skips on equality. A key the listing lacks, or lists with another size,
 * is written. A page whose store has no sized listing writes every asset.
 */
import { assetKeyOf } from '../../storage/store2/sweep/assetKey'
import {
    indexedDbAddressableViolation, indexedDbCreatableViolation, nodeAddressableViolation, nodeAssetRouteViolation,
    nodeCreatableViolation, tauriAddressableViolation, tauriCreatableViolation, type FilePlatform,
} from '../../storage/store/keyRules'
import type { AppStoreKind } from '../../storage/store/appStore'
import { unescAssetName } from './assetName'
import type { InlayPair } from './inlayEntries'
import type { ZipIndex } from './zip64Reader'

/** 0: write the entry. 1: copy it, comparing the target's CRC-32 first and skipping on equality. */
export type AssetMode = 0 | 1

export interface AssetsPlan {
    /** `ZipIndex` entry numbers of the assets to copy. */
    copy: Uint32Array
    /** An `AssetMode` per copy item. */
    mode: Uint8Array
    copyBytes: number
    /** Assets skipped because the target holds them. */
    present: number
    listing: 'tauri-sized' | 'node-sized' | 'none'
    uncreatable: readonly { entry: number, key: string, reason: string }[]
    oversize: readonly { entry: number, key: string, size: number }[]
    /** The Node asset limit after the piece-store probe; null off Node. */
    limit: number | null
}

export interface InlaysPlan {
    copy: readonly InlayPair[]
    copyBytes: number
    oversize: readonly InlayPair[]
    /** The Node inlay limit; null off Node. */
    limit: number | null
}

export interface SizedListing {
    kind: 'tauri-sized' | 'node-sized'
    items: readonly { key: string, size: number }[]
}

export interface CreatableRule {
    kind: AppStoreKind
    platform: FilePlatform
}

export interface AssetPlanDeps {
    isNodeStore(): boolean
    /** Records whether the Node server takes pieces; the asset limit depends on the answer. */
    probePieceStore(): Promise<void>
    assetLimit(): number
    inlayLimit(): number
    /** The store kind and file platform the creatable rule is chosen by. */
    rule(): Promise<CreatableRule>
    /** The target's sized asset listing, or null where the store has none. */
    sizedListing(): Promise<SizedListing | null>
}

/** Why the page's store cannot create `key` (the full store key, `assets/...`), or null. It is the store's own pre-write predicate. */
export function creatableViolation(rule: CreatableRule, key: string): string | null {
    switch (rule.kind) {
        case 'tauri':
            return tauriAddressableViolation(key, rule.platform) ?? tauriCreatableViolation(key)
        case 'node':
            return nodeAddressableViolation(key) ?? nodeCreatableViolation(key) ?? nodeAssetRouteViolation(key)
        case 'indexeddb':
        case 'opfs-transitional':
            return indexedDbAddressableViolation(key) ?? indexedDbCreatableViolation(key)
    }
}

/**
 * The Node limits, read live and never cached: the asset limit depends on whether the server takes pieces, which is
 * recorded by one probe, so the probe comes first.
 */
export async function nodeLimits(deps: AssetPlanDeps): Promise<{ asset: number, inlay: number } | null> {
    if (!deps.isNodeStore()) {
        return null
    }
    await deps.probePieceStore()
    return { asset: deps.assetLimit(), inlay: deps.inlayLimit() }
}

async function listingOrNull(deps: AssetPlanDeps): Promise<SizedListing | null> {
    try {
        return await deps.sizedListing()
    } catch (error) {
        // A listing that fails costs only the skips: every asset is then written.
        console.error(error)
        return null
    }
}

export async function planAssets(index: ZipIndex, pairs: readonly InlayPair[], deps: AssetPlanDeps): Promise<{ assets: AssetsPlan, inlays: InlaysPlan }> {
    const limits = await nodeLimits(deps)
    const rule = await deps.rule()
    const listing = await listingOrNull(deps)
    const sizes = new Map<string, number>()
    for (const item of listing?.items ?? []) {
        sizes.set(item.key, item.size)
    }

    const copy: number[] = []
    const mode: number[] = []
    const uncreatable: { entry: number, key: string, reason: string }[] = []
    const oversize: { entry: number, key: string, size: number }[] = []
    let copyBytes = 0
    let present = 0
    for (let i = 0; i < index.count; i++) {
        const raw = index.nameBytes(i)
        if (raw.length < 2 || raw[0] !== 0x61 || raw[1] !== 0x2F) {
            continue
        }
        const name = index.name(i)
        const key = unescAssetName(name.slice(2))
        if (key === null) {
            throw new TypeError(`${name} is not a canonical asset entry name.`)
        }
        const storeKey = `assets/${key}`
        const reason = creatableViolation(rule, storeKey)
        if (reason !== null) {
            uncreatable.push({ entry: i, key, reason })
            continue
        }
        const size = index.entry(i).uncompressedSize
        if (limits !== null && size > limits.asset) {
            oversize.push({ entry: i, key, size })
            continue
        }
        const listed = sizes.get(storeKey)
        if (listed === size) {
            if (assetKeyOf(key)?.kind === 'hash') {
                present++
                continue
            }
            copy.push(i)
            mode.push(1)
        } else {
            copy.push(i)
            mode.push(0)
        }
        copyBytes += size
    }

    const inlayCopy: InlayPair[] = []
    const inlayOversize: InlayPair[] = []
    let inlayBytes = 0
    for (const pair of pairs) {
        if (limits !== null && pair.bodySize > limits.inlay) {
            inlayOversize.push(pair)
        } else {
            inlayCopy.push(pair)
            inlayBytes += pair.bodySize
        }
    }

    return {
        assets: {
            copy: Uint32Array.from(copy),
            mode: Uint8Array.from(mode),
            copyBytes,
            present,
            listing: listing === null ? 'none' : listing.kind,
            uncreatable,
            oversize,
            limit: limits === null ? null : limits.asset,
        },
        inlays: { copy: inlayCopy, copyBytes: inlayBytes, oversize: inlayOversize, limit: limits === null ? null : limits.inlay },
    }
}
