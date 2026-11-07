// The combined per-kind view: every owner's items for one kind, in the order the engine merges that kind.
// Pure. Absolute numbers are given only up to the first segment Studio cannot show; after it the rows keep
// their position inside their own segment and carry no absolute number.
import type { OwnerModel, OwnerNode, StudioItem, StudioKind } from './ownerModel'

export type MergedKind = 'toggles' | 'regex' | 'lore' | 'scripts'

export interface MergedRow {
    ownerKey: string
    item: StudioItem
    /** 1-based position over the whole group, or null where numbering has stopped (and always for scripts). */
    ordinal: number | null
    /** 1-based position inside the owner's own list for the kind. */
    position: number
}

export interface MergedGroup {
    kind: MergedKind
    /** False for scripts: their run order is not verified, so no number is claimed. */
    numbered: boolean
    /** Owner keys in merge order; includes the segments that cannot be shown. */
    segments: string[]
    /** Segments Studio cannot show: an unloaded module or private content. */
    unshownSegments: number
    /** Builds the rows on demand. */
    rows(): MergedRow[]
}

export interface MergedView {
    groups: MergedGroup[]
}

const GROUP_ORDER: readonly MergedKind[] = ['toggles', 'regex', 'lore', 'scripts']

// Engine orders: regex = preset, character, modules; lore = character, chat, modules;
// toggles = preset, modules, character. Scripts keep the character-then-modules reading order but are unnumbered.
function segmentOwners(kind: MergedKind, model: OwnerModel): OwnerNode[] {
    const preset = model.presets[0]
    const optional = (owner: OwnerNode | null | undefined): OwnerNode[] => owner ? [owner] : []
    switch (kind) {
        case 'regex':
            return [...optional(preset), model.character, ...model.modules]
        case 'lore':
            return [model.character, ...optional(model.chat), ...model.modules]
        case 'toggles':
            return [...optional(preset), ...model.modules, model.character]
        case 'scripts':
            return [model.character, ...model.modules]
    }
}

function canShow(owner: OwnerNode): boolean {
    return !owner.restricted && !owner.stub
}

function itemsOf(owner: OwnerNode, kind: StudioKind): StudioItem[] {
    return owner.kinds().find((node) => node.kind === kind)?.items() ?? []
}

export function buildMergedView(model: OwnerModel): MergedView {
    return {
        groups: GROUP_ORDER.map((kind): MergedGroup => {
            const owners = segmentOwners(kind, model)
            const numbered = kind !== 'scripts'
            return {
                kind,
                numbered,
                segments: owners.map((owner) => owner.key),
                unshownSegments: owners.filter((owner) => !canShow(owner)).length,
                rows() {
                    const rows: MergedRow[] = []
                    let numbering = numbered
                    for (const owner of owners) {
                        if (!canShow(owner)) {
                            numbering = false
                            continue
                        }
                        itemsOf(owner, kind).forEach((item, offset) => {
                            rows.push({
                                ownerKey: owner.key,
                                item,
                                ordinal: numbering ? rows.length + 1 : null,
                                position: offset + 1,
                            })
                        })
                    }
                    return rows
                },
            }
        }),
    }
}
