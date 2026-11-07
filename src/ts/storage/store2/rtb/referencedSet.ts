import type { JsonObject } from '../../blockFrame'
import { assembleCharacter, assembleModule, type UnitSource } from '../codec'
import {
    hexStemToBase64url, keyOfRef, splitHashStems,
    type AssetList, type InlayList, type ModuleEntry, type ShardEntry,
} from '../format'
import { createLeafFallback } from '../leafFallback'
import { deriveCharacterAssets, deriveModuleAssets, InlayIdCollector } from '../lists'
import { AssetKeySet } from '../sweep/assetKey'
import type { FlaggedLeaf } from '../treeBytes'

/**
 * The asset and inlay files a `.rtb` export must carry, taken from the derived lists of the closure it exports.
 *
 * A usable list (current version, not an overflow marker) names its owner's files exactly and feeds the filters. A list
 * that cannot be trusted (stale, newer, or an inlay overflow) is replaced by the owner's content: a character or a module
 * is assembled from its units and its files are derived again, with an uncapped inlay collector because a capped
 * derivation would overflow again. The config owner has no assembly of its own in the codec, so it, and an owner whose
 * assembly fails, fall back to "all": every file is carried and a notice says why. Over-inclusion is the safe direction;
 * a file left out of the export is lost.
 */

export type ListKind = 'asset' | 'inlay'

/** The owner of a list, with the shard or module entry that names its units (kept only for owners that need a fallback). */
export type ListOwner =
    | { kind: 'config' }
    | { kind: 'character', entry: ShardEntry }
    | { kind: 'module', entry: ModuleEntry }

export function ownerLabel(owner: ListOwner): string {
    switch (owner.kind) {
        case 'config': return 'config'
        case 'character': return `character ${owner.entry.u}`
        case 'module': return `module ${owner.entry.id}`
    }
}

export type AssetsReferenced =
    | { mode: 'all' }
    /** `holds` is `AssetKeySet.holds`: a stored name this build cannot compare is held. */
    | { mode: 'filter', holds: (name: string) => boolean }

export type InlaysReferenced =
    | { mode: 'all' }
    /** `includes` matches the ids of `others`, a lower-cased uuid, and the stem of an `assets/<hex>.<ext>` id, as the inlay cleanup does. */
    | { mode: 'filter', includes: (id: string) => boolean }

export interface ReferencedNotice {
    owner: string
    list: ListKind
    /** `owner`: the owner's content was derived again. `all`: every file of this kind is carried. */
    level: 'owner' | 'all'
    reason: string
}

export interface ReferencedStats {
    assetKeys: number
    inlayUuids: number
    inlayStems: number
    inlayOthers: number
    fallbackOwners: number
}

export interface ReferencedSet {
    assets: AssetsReferenced
    inlays: InlaysReferenced
    notices: ReferencedNotice[]
    stats: ReferencedStats
}

/** Reads the stored units of `keys`; an absent or unreadable unit maps to null. A backend failure throws. */
export type ReadUnits = (keys: readonly string[]) => Promise<Map<string, Uint8Array | null>>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ASSET_ID = /^assets\/([0-9a-fA-F]{64})\.[A-Za-z0-9]+$/

interface Unusable {
    owner: ListOwner
    kinds: Map<ListKind, string>
}

function ownerKey(owner: ListOwner): string {
    return owner.kind === 'config' ? 'config' : owner.kind === 'character' ? `c:${owner.entry.u}` : `m:${owner.entry.id}`
}

/** Every unit key of a shard entry that assembly reads (the lists are derived, not read). */
function assemblyKeys(entry: ShardEntry): string[] {
    const keys = [keyOfRef(entry.core)]
    for (const ref of [entry.lore, entry.scripts]) {
        if (ref !== null) {
            keys.push(keyOfRef(ref))
        }
    }
    for (const chat of entry.chats) {
        keys.push(keyOfRef(chat.core))
        for (const ref of chat.chunks) {
            keys.push(keyOfRef(ref))
        }
        for (const ref of chat.alt ?? []) {
            keys.push(keyOfRef(ref))
        }
    }
    return keys
}

export class ReferencedSetBuilder {
    private readonly assetKeys = new AssetKeySet()
    private readonly uuids = new Set<string>()
    private readonly stems = new Set<string>()
    private readonly others = new Set<string>()
    private readonly unusable = new Map<string, Unusable>()

    /** A list of the current version: its names are the owner's exact set. */
    addAssetList(owner: ListOwner, list: AssetList): void {
        try {
            this.assetKeys.addList(list)
        } catch (error) {
            if (!(error instanceof RangeError)) {
                throw error
            }
            this.markUnusable(owner, 'asset', `The asset list is malformed: ${error.message}`)
        }
    }

    /** A list of the current version; an overflow marker (`x: true`) names nothing and so is unusable. */
    addInlayList(owner: ListOwner, list: InlayList): void {
        if (list.x === true) {
            this.markUnusable(owner, 'inlay', 'The inlay list is an overflow marker.')
            return
        }
        let held: string[]
        try {
            held = splitHashStems(list.h)
        } catch (error) {
            if (!(error instanceof RangeError)) {
                throw error
            }
            this.markUnusable(owner, 'inlay', `The inlay list is malformed: ${error.message}`)
            return
        }
        for (const id of list.u) {
            this.uuids.add(id.toLowerCase())
        }
        for (const stem of held) {
            this.stems.add(stem)
        }
        for (const id of list.o) {
            this.others.add(id)
        }
    }

    /** A list that cannot be trusted (stale, newer or unusable): the owner's content stands in for it. */
    markUnusable(owner: ListOwner, kind: ListKind, reason: string): void {
        const key = ownerKey(owner)
        const known = this.unusable.get(key) ?? { owner, kinds: new Map<ListKind, string>() }
        known.kinds.set(kind, reason)
        this.unusable.set(key, known)
    }

    /**
     * Derives the files of every owner marked unusable and closes the set. `omittedKeys` are the alternatives units the
     * export leaves out: the character is assembled without them, as the restore leaves them out too.
     */
    async resolve(read: ReadUnits, omittedKeys: ReadonlySet<string>): Promise<ReferencedSet> {
        const notices: ReferencedNotice[] = []
        const all: Record<ListKind, boolean> = { asset: false, inlay: false }
        let fallbackOwners = 0
        const goAll = (owner: ListOwner, kind: ListKind, reason: string): void => {
            all[kind] = true
            notices.push({ owner: ownerLabel(owner), list: kind, level: 'all', reason })
        }
        for (const { owner, kinds } of this.unusable.values()) {
            if (owner.kind === 'config') {
                for (const [kind, reason] of kinds) {
                    goAll(owner, kind, `${reason} The config has no assembly of its own.`)
                }
                continue
            }
            const needed = [...kinds].filter(([kind]) => !all[kind])
            if (needed.length === 0) {
                continue
            }
            // The read is outside the try: a backend failure fails the export, an assembly failure only widens the filter.
            const units = await read(owner.kind === 'character' ? assemblyKeys(owner.entry) : [keyOfRef(owner.entry.unit)])
            const source: UnitSource = { get: key => units.get(key) ?? undefined }
            let content: JsonObject
            try {
                content = owner.kind === 'character' ? this.assembleCharacterOf(owner.entry, source, omittedKeys) : assembleModule(owner.entry, source)
            } catch (error) {
                const why = error instanceof Error ? error.message : 'The owner could not be assembled.'
                for (const [kind, reason] of needed) {
                    goAll(owner, kind, `${reason} ${why}`)
                }
                continue
            }
            fallbackOwners++
            for (const [kind, reason] of needed) {
                if (kind === 'asset') {
                    this.assetKeys.addList(owner.kind === 'character' ? deriveCharacterAssets(content) : deriveModuleAssets(content))
                } else {
                    const collector = new InlayIdCollector()
                    collector.addAll(content)
                    for (const id of collector.uuids) {
                        this.uuids.add(id)
                    }
                    for (const stem of collector.stems()) {
                        this.stems.add(stem)
                    }
                    for (const id of collector.others) {
                        this.others.add(id)
                    }
                }
                notices.push({ owner: ownerLabel(owner), list: kind, level: 'owner', reason })
            }
        }
        const { assetKeys, uuids, stems, others } = this
        return {
            assets: all.asset ? { mode: 'all' } : { mode: 'filter', holds: name => assetKeys.holds(name) },
            inlays: all.inlay
                ? { mode: 'all' }
                : {
                    mode: 'filter',
                    includes: (id) => {
                        if (others.has(id)) {
                            return true
                        }
                        if (UUID.test(id)) {
                            return uuids.has(id.toLowerCase())
                        }
                        const asset = ASSET_ID.exec(id)
                        return asset !== null && stems.has(hexStemToBase64url(asset[1]))
                    },
                },
            notices,
            stats: { assetKeys: assetKeys.size, inlayUuids: uuids.size, inlayStems: stems.size, inlayOthers: others.size, fallbackOwners },
        }
    }

    private assembleCharacterOf(entry: ShardEntry, source: UnitSource, omittedKeys: ReadonlySet<string>): JsonObject {
        const flagged: FlaggedLeaf[] = []
        for (const chat of entry.chats) {
            for (const ref of chat.alt ?? []) {
                if (omittedKeys.has(keyOfRef(ref))) {
                    flagged.push({ kind: 'chat', chaId: entry.chaId, chatId: chat.cid, part: 'alt', key: keyOfRef(ref), why: 'damaged' })
                }
            }
        }
        // The flagged-leaf assembly only skips the named alternatives units; it builds no load-error text for them.
        return flagged.length > 0 ? createLeafFallback(flagged, () => 0).character(entry, source) : assembleCharacter(entry, source)
    }
}
