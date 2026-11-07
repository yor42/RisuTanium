// Turns a parsed Studio target into a place in the owner model, plus the notice the visit should show.
// Pure. Only the bound character is in the model, so a target naming another character is not found.
import type { OwnerModel, StudioKind } from './ownerModel'
import { isStudioError, type StudioTarget, type StudioTargetError } from './studioTarget'

export type StudioNotice =
    | { key: 'studioNotFound' }
    | { key: 'studioDeepKindFallback', ownerName: string }
    | { key: 'studioDeepItemMissing', ownerName: string, kind: StudioKind | null }

export interface ResolvedTarget {
    /** The owner to select, or null for the list root (no owner asked for, or the owner was not found). */
    ownerKey: string | null
    kind: StudioKind | null
    itemId: string | null
    notice: StudioNotice | null
}

const ROOT: ResolvedTarget = { ownerKey: null, kind: null, itemId: null, notice: null }

/**
 * - malformed input, an unknown owner or an owner of another type: `studioNotFound` on the root
 * - an owner that does not support the kind: the owner root with `studioDeepKindFallback`
 * - a kind without the item: that kind with `studioDeepItemMissing`
 * - an item without a kind is looked up across the owner's kinds; if it is not there the owner root is opened
 *   with `studioDeepItemMissing`
 */
export function resolveStudioTarget(model: OwnerModel, target: StudioTarget | StudioTargetError): ResolvedTarget {
    if (isStudioError(target)) return { ...ROOT, notice: { key: 'studioNotFound' } }
    if (!target.owner) return ROOT
    const owner = model.ownerOf(target.owner.type, target.owner.id)
    if (!owner) return { ...ROOT, notice: { key: 'studioNotFound' } }

    const kinds = owner.kinds()
    let kind: StudioKind | null = null
    if (target.kind !== undefined) {
        const node = kinds.find((candidate) => candidate.kind === target.kind)
        if (!node) {
            return { ownerKey: owner.key, kind: null, itemId: null, notice: { key: 'studioDeepKindFallback', ownerName: owner.name } }
        }
        kind = node.kind
    }

    if (target.item === undefined) return { ownerKey: owner.key, kind, itemId: null, notice: null }

    const searched = kind === null ? kinds : kinds.filter((candidate) => candidate.kind === kind)
    for (const node of searched) {
        const found = node.items().find((item) => item.id === target.item)
        if (found) return { ownerKey: owner.key, kind: node.kind, itemId: found.id, notice: null }
    }
    return {
        ownerKey: owner.key,
        kind,
        itemId: null,
        notice: { key: 'studioDeepItemMissing', ownerName: owner.name, kind },
    }
}
