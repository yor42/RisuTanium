// The merge preview model: one plain value that holds everything a merge would write and everything the preview
// lists. Pure.
//
// The preview is built from the owner as it is now. At Merge the setter builds it again from the live owner and
// compares the two with `mergePreviewEquals`; any difference means the owner changed under the preview and nothing
// is written. That guarantee needs two properties of this model:
// - it holds every op the merge writes: the row removals, the folder entry ops (no documents), every text edit in
//   apply order, and the live text of each edited restore-tracked target, so a change to any of them makes the
//   models differ; `folderOutcome` and `partialNames` are listed with them, so a change to what they show does too;
// - it reads the folder document, the rows and the texts from the owner it is given, never from a cache.
// The chat and character counts are not part of it: they arrive progressively and belong to other owners.

import { assetPoolKey, folderOf, readFolderDoc, setFolderEntries, type FolderEntryIntent, type FolderOp } from './folderCodec'
import { ASSET_FOLDER_KEY } from './assetOwnerKeys'
import type { DuplicateGroup, GroupRow } from './duplicateGroups'
import { closeMatch, scanReferences, type AssetKind, type CloseMatchSettings, type NameRow, type PlaceHit } from './referenceScan'
import { planRewrite, type TargetText, type TextEdit } from './referenceRewrite'
import { assertAssetOwner, enumerateClassifiedTargets, type TargetOwner } from './referenceTargets'

export type AssetArrayName = 'additionalAssets' | 'emotionImages' | 'assets'

export interface AssetRowRemoveOp {
    kind: 'assetRowRemove'
    array: AssetArrayName
    index: number
    tuple: string[]
    /** How many identical tuples the array holds when the op runs. */
    count: number
}

export interface CloseNameEntry {
    path: string
    offset: number
    length: number
    /** The literal name as written. */
    name: string
    via: 'macro' | 'imgSrc'
    /** What the name resolves to now, and after the merge. */
    before: string | null
    after: string | null
}

export interface ModuleHolding {
    id: string
    name: string
}

export interface FolderOutcome {
    /** `notApplicable` for emotions, which have no folders. */
    state: 'absent' | 'ok' | 'unreadable' | 'notApplicable'
    /** The folder the kept name shows in after the merge, or null for "No folder". */
    kept: string | null
    /** Whose folder that is: the kept name's own, a removed name's that the kept name takes, or none. */
    from: 'kept' | 'removed' | 'none'
    /** The stored names whose folder entry the merge drops. */
    dropped: string[]
}

/** A removed name that still has rows after the merge, so its references keep naming rows that stay. */
export interface PartialName {
    name: string
    /** The rows of that name's fold key that remain. */
    rowsLeft: number
}

export interface MergePreview {
    ownerKind: 'character' | 'module'
    kind: AssetKind
    keptName: string
    removedNames: string[]
    array: AssetArrayName
    rowOps: AssetRowRemoveOp[]
    /** The rows of the kept name after the merge. */
    keptRows: string[][]
    /** Group rows that no longer match the owner's row at their index: nothing is written for them. */
    missingRows: number[]
    /** Entry-level ops: no document is carried. */
    folderOps: FolderOp[]
    /** Every text edit, in apply order. */
    textEdits: TextEdit[]
    /** The live text of every edited target the restore point tracks, for the restore point. */
    preWrite: TargetText[]
    alreadyShows: PlaceHit[]
    notRewritten: PlaceHit[]
    closeNames: CloseNameEntry[]
    nameLists: PlaceHit[]
    modulesHolding: ModuleHolding[]
    folderOutcome: FolderOutcome
    /** Removed names that keep rows after the merge, counted over the whole array: rows outside the group change it. */
    partialNames: PartialName[]
    /** A module owner: macros match its names exactly, with no near-name lookup. */
    matchedExactly: boolean
}

export interface ModuleSource {
    readonly id: string
    readonly name: string
    readonly assets?: readonly NameRow[]
}

function arrayOf(owner: TargetOwner, kind: AssetKind): { name: AssetArrayName, rows: readonly NameRow[] } {
    if (owner.kind === 'module') {
        return { name: 'assets', rows: owner.source.assets ?? [] }
    }
    return kind === 'emotion'
        ? { name: 'emotionImages', rows: owner.source.emotionImages ?? [] }
        : { name: 'additionalAssets', rows: owner.source.additionalAssets ?? [] }
}

function tupleEquals(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((value, i) => value === b[i])
}

function placeKey(hit: PlaceHit): string {
    return hit.path + '\0' + hit.offset + '\0' + hit.syntax
}

function mergePlaces(into: PlaceHit[], more: readonly PlaceHit[], seen: Set<string>): void {
    for (const hit of more) {
        const key = placeKey(hit)
        if (!seen.has(key)) {
            seen.add(key)
            into.push(hit)
        }
    }
}

/**
 * The merge of the group's rows into `keptName`. The rows of the group whose name is not `keptName` are removed;
 * their references are rewritten to `keptName` where the planner allows. `modules` are the enabled modules, which
 * the near-name lookup and the "modules holding the name" list read. `settings` are the three lookup settings. A
 * group is not an owner: a `character` owner whose `type` is `group` throws a `TypeError`.
 */
export function buildMergePreview(
    owner: TargetOwner,
    kind: AssetKind,
    group: DuplicateGroup<GroupRow>,
    keptName: string,
    modules: readonly ModuleSource[],
    settings: CloseMatchSettings,
): MergePreview {
    assertAssetOwner(owner)
    const { name: array, rows } = arrayOf(owner, kind)
    const removedRows = group.rows.filter((row) => row.name !== keptName)
    const missingRows: number[] = []
    const removedByIndex = new Map<number, GroupRow>()
    for (const row of removedRows) {
        const live = rows[row.index]
        if (live !== undefined && live[0] === row.name && live[1] === row.path) {
            removedByIndex.set(row.index, row)
        } else {
            missingRows.push(row.index)
        }
    }
    const removedNames: string[] = []
    for (const row of removedByIndex.values()) {
        if (!removedNames.includes(row.name)) {
            removedNames.push(row.name)
        }
    }

    // Row ops: highest index first, each count read from the array as the earlier removals leave it.
    const simulated = rows.map((row): [string, ...string[]] => [row[0], ...row.slice(1)])
    const rowOps: AssetRowRemoveOp[] = []
    for (const index of [...removedByIndex.keys()].sort((a, b) => b - a)) {
        const tuple = simulated[index].slice()
        const count = simulated.filter((candidate) => tupleEquals(candidate, tuple)).length
        rowOps.push({ kind: 'assetRowRemove', array, index, tuple, count })
        simulated.splice(index, 1)
    }
    const remaining = simulated
    const keptRows = remaining.filter((row) => row[0] === keptName).map((row) => row.slice())

    // The removed names by fold key, the first name of each, leaving out the key of the kept name.
    const keptKey = assetPoolKey(keptName)
    const rowsLeftOf = (name: string): number => remaining.filter((row) => assetPoolKey(row[0]) === assetPoolKey(name)).length
    const otherNames: string[] = []
    const seenKeys = new Set<string>()
    for (const name of removedNames) {
        const key = assetPoolKey(name)
        if (key !== keptKey && !seenKeys.has(key)) {
            seenKeys.add(key)
            otherNames.push(name)
        }
    }
    const partialNames: PartialName[] = []
    for (const name of otherNames) {
        const rowsLeft = rowsLeftOf(name)
        if (rowsLeft > 0) {
            partialNames.push({ name, rowsLeft })
        }
    }

    // Folder ops: emotions have no folders. The kept name keeps its folder, or takes the folder of the first removed
    // name that has one (the carry); a name with no row left then drops its entry. A document this build cannot read
    // or that is absent gets no op.
    const folderOutcome: FolderOutcome = { state: 'notApplicable', kept: null, from: 'none', dropped: [] }
    let folderOps: FolderOp[] = []
    if (kind === 'asset') {
        const stored = owner.kind === 'character' ? owner.source.extentions?.[ASSET_FOLDER_KEY] : owner.source[ASSET_FOLDER_KEY]
        const read = readFolderDoc(stored)
        folderOutcome.state = read.state
        if (read.state === 'ok') {
            const intents: FolderEntryIntent[] = []
            const keptFolder = folderOf(read.doc, keptName)
            if (keptFolder !== null) {
                folderOutcome.kept = keptFolder
                folderOutcome.from = 'kept'
            } else {
                const donor = otherNames.find((name) => folderOf(read.doc, name) !== null)
                if (donor !== undefined) {
                    folderOutcome.kept = folderOf(read.doc, donor)
                    folderOutcome.from = 'removed'
                    intents.push({ name: keptName, folder: folderOutcome.kept })
                }
            }
            for (const name of otherNames) {
                if (rowsLeftOf(name) === 0) {
                    intents.push({ name, folder: null })
                }
            }
            const result = setFolderEntries(stored, intents)
            if (result.ok) {
                folderOps = result.ops
                folderOutcome.dropped = result.ops.flatMap((op) => op.kind === 'assetFolderSet' && !op.after.had ? [op.name] : [])
            }
        }
    }

    // Text edits: one plan per removed name over the same texts, merged by target and offset.
    const targets = enumerateClassifiedTargets(owner)
    const targetOrder = new Map(targets.map((target, i) => [target.path, i]))
    const editsByKey = new Map<string, TextEdit>()
    const rewritten: PlaceHit[] = []
    const alreadyShows: PlaceHit[] = []
    const notRewritten: PlaceHit[] = []
    const nameLists: PlaceHit[] = []
    const seenRewritten = new Set<string>()
    const seenAlready = new Set<string>()
    const seenNot = new Set<string>()
    const seenLists = new Set<string>()
    const preWriteByTarget = new Map<string, TargetText>()
    for (const removed of removedNames) {
        const plan = planRewrite(targets, kind, removed, keptName)
        for (const edit of plan.edits) {
            editsByKey.set(edit.target + '\0' + edit.offset, edit)
        }
        for (const text of plan.preWrite) {
            preWriteByTarget.set(text.target, text)
        }
        mergePlaces(rewritten, plan.rewritten, seenRewritten)
        mergePlaces(alreadyShows, plan.alreadyShows, seenAlready)
        mergePlaces(notRewritten, plan.notRewritten, seenNot)
        mergePlaces(nameLists, plan.nameLists, seenLists)
    }
    const textEdits = [...editsByKey.values()].sort((a, b) =>
        (targetOrder.get(a.target) ?? 0) - (targetOrder.get(b.target) ?? 0) || b.offset - a.offset)
    const preWrite = targets.flatMap((target) => preWriteByTarget.get(target.path) ?? [])

    // Near names: a literal reference that the merge leaves in place, that has no exact row once it is done, and
    // that the engine's lookup would still resolve to some other row, now or afterwards.
    const modulesRows = modules.flatMap((module) => module.assets ?? [])
    const closeNames: CloseNameEntry[] = []
    if (kind === 'asset') {
        const isCharacter = owner.kind === 'character'
        const rowsBefore = isCharacter ? rows : []
        const rowsAfter = isCharacter ? remaining : []
        const moduleBefore = isCharacter ? modulesRows : rows
        const moduleAfter = isCharacter ? modulesRows : remaining
        const settled = new Set([...rewritten, ...alreadyShows].map(placeKey))
        for (const target of targets) {
            if (target.cls !== 'rewritable') {
                continue
            }
            for (const reference of scanReferences(target.text, 'asset', target.path)) {
                if (reference.flag || (reference.syntax !== 'macro' && reference.syntax !== 'imgSrc')) {
                    continue
                }
                if (settled.has(target.path + '\0' + reference.offset + '\0' + reference.syntax)) {
                    continue
                }
                const via = reference.syntax
                const before = closeMatch(rowsBefore, moduleBefore, reference.name, via, settings)
                const after = closeMatch(rowsAfter, moduleAfter, reference.name, via, settings)
                const exactAfter = after !== null && assetPoolKey(after) === assetPoolKey(reference.name)
                if (!exactAfter && (before !== null || after !== null)) {
                    closeNames.push({ path: target.path, offset: reference.offset, length: reference.length, name: reference.name, via, before, after })
                }
            }
        }
    }

    const removedKeys = new Set(removedNames.map(assetPoolKey))
    const modulesHolding: ModuleHolding[] = kind === 'asset' && owner.kind === 'character'
        ? modules
            .filter((module) => (module.assets ?? []).some((row) => removedKeys.has(assetPoolKey(row[0]))))
            .map((module) => ({ id: module.id, name: module.name }))
        : []

    return {
        ownerKind: owner.kind,
        kind,
        keptName,
        removedNames,
        array,
        rowOps,
        keptRows,
        missingRows,
        folderOps,
        textEdits,
        preWrite,
        alreadyShows,
        notRewritten,
        closeNames,
        nameLists,
        modulesHolding,
        folderOutcome,
        partialNames,
        matchedExactly: owner.kind === 'module',
    }
}

function valuesEqual(a: unknown, b: unknown): boolean {
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
        return a === b
    }
    if (Array.isArray(a) || Array.isArray(b)) {
        return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => valuesEqual(item, b[i]))
    }
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) {
        return false
    }
    const recordB: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(b))
    const recordA: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(a))
    return keysA.every((key) => Object.hasOwn(recordB, key) && valuesEqual(recordA[key], recordB[key]))
}

/** Structural deep equality of two previews: the same keys, arrays in the same order, strings and numbers by `===`. */
export function mergePreviewEquals(a: MergePreview, b: MergePreview): boolean {
    return valuesEqual(a, b)
}
