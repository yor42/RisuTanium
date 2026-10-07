import { refKey, type FolderRef, type Gap, type ItemRef, type TopRef } from './sidebarOrder'
import { centreZone, locate, type Layout } from './railLayout'

/**
 * What a drag would do if released at a pointer position, decided from the layout model and
 * the dragged item alone (no DOM). The one gesture-dependent input is `zoneKey`: the row
 * whose centre zone the pointer entered by moving, which the interaction machine owns.
 */

export type Target =
    | { kind: 'none' }
    /** `noop` gaps sit next to the dragged item; releasing there changes nothing. */
    | { kind: 'gap'; gap: Gap; key: string; index: number; noop: boolean }
    | { kind: 'merge'; ref: TopRef; key: string }
    | { kind: 'append'; ref: FolderRef; key: string }

export const NO_TARGET: Target = { kind: 'none' }

export interface ZoneCandidate {
    key: string
    index: number
    ref: TopRef
    /** A folder row that is not open. */
    closedFolder: boolean
}

/**
 * The top-level row whose centre zone holds `y`, when that row can take a merge or an
 * append from `source`: never for a dragged folder, the dragged item's own row, or the
 * folder a dragged member already belongs to.
 */
export function zoneCandidateAt(layout: Layout, y: number, source: ItemRef): ZoneCandidate | null {
    if (source.kind === 'folder') {
        return null
    }
    const index = locate(layout, y)
    if (index < 0) {
        return null
    }
    const item = layout.items[index]
    if ((item.kind !== 'char' && item.kind !== 'folder') || !item.ref || item.ref.kind === 'member') {
        return null
    }
    if (item.key === refKey(source)) {
        return null
    }
    if (source.kind === 'member' && item.ref.kind === 'folder' && item.key === refKey(source.folder)) {
        return null
    }
    const zone = centreZone(layout, index)
    if (y < zone.top || y >= zone.bottom) {
        return null
    }
    return {
        key: item.key,
        index,
        ref: item.ref,
        closedFolder: item.ref.kind === 'folder' && layout.items[index + 1]?.kind !== 'folderHead',
    }
}

function nearestGapIndex(layout: Layout, y: number, from: number, allowed: (gap: Gap) => boolean): number {
    const isCandidate = (i: number) => {
        const gap = layout.items[i].gap
        return gap !== undefined && allowed(gap)
    }
    let before = -1
    for (let i = from; i >= 0; i--) {
        if (isCandidate(i)) {
            before = i
            break
        }
    }
    let after = -1
    for (let i = from; i < layout.items.length; i++) {
        if (isCandidate(i)) {
            after = i
            break
        }
    }
    if (before === -1) {
        return after
    }
    if (after === -1) {
        return before
    }
    const centre = (i: number) => layout.offsets[i] + layout.heights[i] / 2
    return Math.abs(y - centre(before)) <= Math.abs(centre(after) - y) ? before : after
}

/** A gap is a no-op for the dragged item when it is directly before the item or after it. */
export function isNoopGap(layout: Layout, gapIndex: number, source: ItemRef): boolean {
    const sourceKey = refKey(source)
    const sourceIndex = layout.indexByKey.get(sourceKey)
    if (sourceIndex === undefined) {
        return false
    }
    if (gapIndex === sourceIndex - 1) {
        return true
    }
    const after = layout.items[gapIndex].gap?.after
    return after !== null && after !== undefined && refKey(after) === sourceKey
}

export interface TargetInput {
    layout: Layout
    /** Content coordinate of the pointer. */
    y: number
    source: ItemRef
    /** The pointer is too far outside the column for any target. */
    outside: boolean
    /** Key of the row whose centre zone is active, or `null`. */
    zoneKey: string | null
    /** The merge dwell has elapsed on the active zone's character row. */
    mergeArmed: boolean
}

export function resolveTarget(input: TargetInput): Target {
    const { layout, y, source } = input
    if (input.outside || layout.items.length === 0) {
        return NO_TARGET
    }
    const index = locate(layout, y)
    const item = layout.items[index]
    const sourceKey = refKey(source)

    const gapTarget = (): Target => {
        const topOnly = source.kind === 'folder'
        const found = nearestGapIndex(layout, y, index, (gap) => !topOnly || gap.in === 'top')
        if (found === -1) {
            return NO_TARGET
        }
        const gap = layout.items[found].gap!
        return { kind: 'gap', gap, key: layout.items[found].key, index: found, noop: isNoopGap(layout, found, source) }
    }

    if (source.kind === 'folder') {
        return item.key === sourceKey ? NO_TARGET : gapTarget()
    }
    if (item.key === sourceKey) {
        return NO_TARGET
    }
    if (input.zoneKey !== null && item.key === input.zoneKey && item.ref && item.ref.kind !== 'member') {
        const candidate = zoneCandidateAt(layout, y, source)
        if (candidate && candidate.key === input.zoneKey) {
            if (candidate.ref.kind === 'folder') {
                return { kind: 'append', ref: candidate.ref, key: candidate.key }
            }
            if (input.mergeArmed) {
                return { kind: 'merge', ref: candidate.ref, key: candidate.key }
            }
        }
    }
    return gapTarget()
}
