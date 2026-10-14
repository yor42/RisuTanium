import type { AssetList, InlayList, LegacyList, ListRef, Manifest, Parsed, Ref, Shard, ModuleIndex } from '../format'

/**
 * Shared types of the sweep decisions. Nothing here touches storage: a reader, a
 * clock or a backend is always an injected function or a plain input.
 */

/** A node the closure needed but could not deliver intact. */
export interface NodeFailure {
    status: 'missing' | 'crc-failed'
    reason: string
}

/** What an injected reader returns for one unit: the parse result, or why no bytes could be trusted. */
export type NodeRead<T> = Parsed<T> | NodeFailure

/**
 * Reads the closure of the manifests a pass protects. Each method verifies the
 * unit against its Ref (length and CRC) before parsing; a mismatch is a
 * `crc-failed` result, never a parse of the damaged bytes.
 */
export interface ClosureReader {
    manifest(key: string): Promise<NodeRead<Manifest>>
    shard(ref: Ref): Promise<NodeRead<Shard>>
    moduleIndex(ref: Ref): Promise<NodeRead<ModuleIndex>>
    assetList(ref: ListRef): Promise<NodeRead<AssetList>>
    inlayList(ref: ListRef): Promise<NodeRead<InlayList>>
    legacyList(ref: Ref): Promise<NodeRead<LegacyList>>
}

/** One owner of a list inside one manifest of the keep-set. `id` is the entity `u`, the module id, or empty for config and legacy. */
export interface OwnerRef {
    kind: 'config' | 'character' | 'module' | 'legacy'
    id: string
    /** Key of the manifest the list was read through. */
    manifest: string
}

export function ownerLabel(owner: OwnerRef): string {
    return `${owner.kind}:${owner.id}@${owner.manifest}`
}

/**
 * Re-derives a list from the owner's core, for an owner whose stored list is
 * below this build's version (or an overflowed inlay list). Returns null when the
 * owner's core cannot be read: the pass then reports incomplete, never a guess.
 */
export interface Rederive {
    assets(owner: OwnerRef): Promise<AssetList | null>
    inlays(owner: OwnerRef): Promise<InlayList | null>
}

export type IncompleteCode =
    | 'no-current'
    | 'node-missing'
    | 'node-crc-failed'
    | 'node-damaged'
    | 'node-too-new'
    | 'list-newer'
    | 'list-stale'
    | 'list-unusable'
    | 'legacy-file-unreadable'

/** Why a keep-set is not complete. A pass that sees any of these deletes nothing. */
export interface Incomplete {
    code: IncompleteCode
    detail: string
    owner?: OwnerRef
}

export type KeepSetResult<K> =
    | { status: 'complete', keep: K }
    | { status: 'incomplete', reasons: Incomplete[] }

/**
 * Brand of a keep-set built from a complete closure read. Only the builders in
 * `keepSet.ts` set it, and the package index does not export it, so a decision
 * function that takes a keep-set cannot be handed a partial one.
 */
export const COMPLETE = Symbol('complete keep-set')

/** Asset keep-set: the protected asset names, queried with `holds`. */
export interface AssetKeepSet {
    readonly [COMPLETE]: true
    holds(name: string): boolean
}

/**
 * Inlay keep-set. `uuids` are lower-case, `stems` are 43-character base64url
 * stems, `others` are literal ids. `owners` lists every list holder read, and
 * `unknownOwners` those whose ids could not all be listed (overflow) and could
 * not be re-derived.
 */
export interface InlayKeepSet {
    readonly [COMPLETE]: true
    uuids: ReadonlySet<string>
    stems: ReadonlySet<string>
    others: ReadonlySet<string>
    owners: readonly OwnerRef[]
    unknownOwners: readonly OwnerRef[]
}

/** The manifest keys a pass protects: `{current} ∪ retained ∪ pins`, in that order, without repeats. */
export type KeepManifestKeys = readonly string[]
