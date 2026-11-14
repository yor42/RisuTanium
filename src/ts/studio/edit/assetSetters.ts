// The asset half of Studio's setters. Pure: each builder reads the live owner through a `LiveReader` and returns
// the ops of one step (rows, then folder entries, then text), or a reason; nothing here writes, marks or records.
// The history service lands a build through its one marked write path, which also decides removal refusals, the
// folder result and the retained-path recompute with the helpers below.

import { assetPoolKey, carryFolderOnRename, createFolder, deleteFolder, dropFolderEntries, moveManyToFolder, renameFolder, reorderFolders, type FolderOp, type FolderRefusal } from '../assets/folderCodec'
import type { HashCache } from '../assets/assetHashJob'
import type { AssetArrayName, MergePreview } from '../assets/mergePreview'
import type { LiveReader, Op, Step, StepLabel, WriteOp } from '../history/historyModel'
import { stepPathPairs } from '../history/retainedPaths'

export type AssetBuildResult =
    | { ok: true; label: StepLabel; ops: Op[] }
    | { ok: false; reason: 'precondition' | 'unchanged'; folderRefusal?: FolderRefusal }

type RemoveOp = Extract<Op, { op: 'assetRowRemove' }>
type SetOp = Extract<Op, { op: 'assetRowSet' }>
type FolderStepOp = Extract<Op, { op: 'assetFolderSet' | 'assetFolderOrder' }>

// ---------------------------------------------------------------- rows

function tupleEquals(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((item, i) => item === b[i])
}

function countOf(rows: readonly (readonly string[])[], tuple: readonly string[]): number {
    let count = 0
    for (const row of rows) {
        if (tupleEquals(row, tuple)) {
            count += 1
        }
    }
    return count
}

function copyRows(live: LiveReader, array: AssetArrayName): string[][] | null {
    const rows = live.assetRows ? live.assetRows(array) : null
    return rows === null ? null : rows.map((row) => [...row])
}

function hasFolders(array: AssetArrayName): boolean {
    return array !== 'emotionImages'
}

function rowsLeftOf(rows: readonly (readonly string[])[], name: string): number {
    const key = assetPoolKey(name)
    return rows.filter((row) => assetPoolKey(row[0]) === key).length
}

function fromFolderOp(op: FolderOp): FolderStepOp {
    return op.kind === 'assetFolderSet'
        ? { op: 'assetFolderSet', name: op.name, before: op.before, after: op.after }
        : { op: 'assetFolderOrder', before: [...op.before], after: [...op.after] }
}

// The remove ops of the rows at `indexes`, highest index first so every recorded index is the one the op meets.
function removalOps(array: AssetArrayName, rows: readonly string[][], indexes: readonly number[]): { ops: RemoveOp[]; left: string[][] } | null {
    if (new Set(indexes).size !== indexes.length) {
        return null
    }
    const work = rows.map((row) => [...row])
    const ops: RemoveOp[] = []
    for (const index of [...indexes].sort((a, b) => b - a)) {
        const tuple = work[index]
        if (!Number.isInteger(index) || !tuple) {
            return null
        }
        ops.push({ op: 'assetRowRemove', array, index, tuple: [...tuple], count: countOf(work, tuple) })
        work.splice(index, 1)
    }
    return { ops, left: work }
}

export interface SurvivorDeps {
    // The hash the session cache holds for `path` under the size read now; undefined when it holds none, so a path
    // rewritten in place (a different size) has no hash and no survivor.
    hashOf(path: string): string | undefined
}

// The survivor check over the session hash cache: a path is looked up under the size read for it now, so a file that
// was rewritten in place (a different size, a path that is not content-addressed) misses and has no hash.
export function survivorDepsFrom(cache: Pick<HashCache, 'get'>, sizeNow: (path: string) => number | null): SurvivorDeps {
    return { hashOf: (path) => cache.get(path, sizeNow(path)) }
}

// Every removed row needs a row that stays with an equal path or an equal cached hash. A removal that frees the
// last copy of a file is never a duplicate removal.
export function everyRemovalHasSurvivor(removed: readonly (readonly string[])[], remaining: readonly (readonly string[])[], deps: SurvivorDeps): boolean {
    return removed.every((row) => {
        const path = row[1]
        if (remaining.some((other) => other[1] === path)) {
            return true
        }
        const hash = deps.hashOf(path)
        return hash !== undefined && remaining.some((other) => deps.hashOf(other[1]) === hash)
    })
}

function dropEntriesOps(array: AssetArrayName, stored: unknown, names: readonly string[], left: readonly (readonly string[])[]): Op[] {
    if (!hasFolders(array)) {
        return []
    }
    const dropped = dropFolderEntries(stored, names.map((name) => ({ name, rowsLeft: rowsLeftOf(left, name) })))
    return dropped.ok ? dropped.ops.map(fromFolderOp) : []
}

// ---------------------------------------------------------------- builders

// Deletes the rows at `indexes` of one array; the folder entry of a name that keeps no row goes with them.
export function buildAssetDelete(array: AssetArrayName, indexes: readonly number[], live: LiveReader): AssetBuildResult {
    if (indexes.length === 0) {
        return { ok: false, reason: 'unchanged' }
    }
    const rows = copyRows(live, array)
    const removal = rows === null ? null : removalOps(array, rows, indexes)
    if (rows === null || removal === null) {
        return { ok: false, reason: 'precondition' }
    }
    const names = removal.ops.map((op) => op.tuple[0])
    const folderOps = dropEntriesOps(array, live.folderValue ? live.folderValue() : undefined, names, removal.left)
    const label: StepLabel = indexes.length === 1 ? { kind: 'assetDelete', count: 1, name: names[0] } : { kind: 'assetDelete', count: indexes.length, name: null }
    return { ok: true, label, ops: [...removal.ops, ...folderOps] }
}

// Removes the extra rows of one name (the group keeps its survivor); each removed row needs a surviving row.
export function buildAssetRemoveExtras(array: AssetArrayName, name: string, indexes: readonly number[], live: LiveReader, survivors: SurvivorDeps): AssetBuildResult {
    if (indexes.length === 0) {
        return { ok: false, reason: 'unchanged' }
    }
    const rows = copyRows(live, array)
    const removal = rows === null ? null : removalOps(array, rows, indexes)
    if (rows === null || removal === null || !everyRemovalHasSurvivor(removal.ops.map((op) => op.tuple), removal.left, survivors)) {
        return { ok: false, reason: 'precondition' }
    }
    const names = removal.ops.map((op) => op.tuple[0])
    const folderOps = dropEntriesOps(array, live.folderValue ? live.folderValue() : undefined, names, removal.left)
    return { ok: true, label: { kind: 'assetRemoveExtras', count: indexes.length, name }, ops: [...removal.ops, ...folderOps] }
}

// Applies a rebuilt merge preview as one step: its row removals, its folder entry ops and its text edits. Every row
// op is checked against the live rows, and every removed row needs a survivor.
export function buildAssetMerge(model: MergePreview, live: LiveReader, survivors: SurvivorDeps): AssetBuildResult {
    const rows = copyRows(live, model.array)
    if (rows === null) {
        return { ok: false, reason: 'precondition' }
    }
    const ops: Op[] = []
    const removed: string[][] = []
    for (const rowOp of model.rowOps) {
        const tuple = rows[rowOp.index]
        if (!tuple || !tupleEquals(tuple, rowOp.tuple) || countOf(rows, rowOp.tuple) !== rowOp.count) {
            return { ok: false, reason: 'precondition' }
        }
        ops.push({ op: 'assetRowRemove', array: rowOp.array, index: rowOp.index, tuple: [...rowOp.tuple], count: rowOp.count })
        removed.push([...rowOp.tuple])
        rows.splice(rowOp.index, 1)
    }
    if (removed.length > 0 && !everyRemovalHasSurvivor(removed, rows, survivors)) {
        return { ok: false, reason: 'precondition' }
    }
    for (const folderOp of model.folderOps) {
        ops.push(fromFolderOp(folderOp))
    }
    for (const edit of model.textEdits) {
        ops.push({ op: 'textEdit', target: edit.target, offset: edit.offset, from: edit.from, to: edit.to })
    }
    if (ops.length === 0) {
        return { ok: false, reason: 'unchanged' }
    }
    return { ok: true, label: { kind: 'assetMerge', from: model.removedNames.join(', '), to: model.keptName }, ops }
}

// Renames the row at `index`. The folder entry follows the name (`carryFolderOnRename`); a same-name rename is no step.
export function buildAssetRename(array: AssetArrayName, index: number, newName: string, live: LiveReader): AssetBuildResult {
    const rows = copyRows(live, array)
    const row = rows?.[index]
    if (!rows || !row || newName === '') {
        return { ok: false, reason: 'precondition' }
    }
    if (row[0] === newName) {
        return { ok: false, reason: 'unchanged' }
    }
    const after = [newName, ...row.slice(1)]
    const rowOp: SetOp = { op: 'assetRowSet', array, index, before: [...row], after }
    let folderOps: Op[] = []
    if (hasFolders(array)) {
        const left = rows.filter((_, at) => at !== index)
        const carried = carryFolderOnRename(live.folderValue ? live.folderValue() : undefined, row[0], newName, rowsLeftOf(left, row[0]))
        folderOps = carried.ok ? carried.ops.map(fromFolderOp) : []
    }
    return { ok: true, label: { kind: 'assetRename', from: row[0], to: newName }, ops: [rowOp, ...folderOps] }
}

// Inserts rows at the end of one array. The step is always labelled `assetAdd` with the row count, so no caller can
// mislabel an addition.
export function buildAssetInsert(array: AssetArrayName, tuples: readonly (readonly string[])[], live: LiveReader): AssetBuildResult {
    if (tuples.length === 0) {
        return { ok: false, reason: 'unchanged' }
    }
    const rows = copyRows(live, array)
    if (rows === null) {
        return { ok: false, reason: 'precondition' }
    }
    const ops: Op[] = []
    for (const tuple of tuples) {
        ops.push({ op: 'assetRowInsert', array, index: rows.length, tuple: [...tuple], count: countOf(rows, tuple) })
        rows.push([...tuple])
    }
    return { ok: true, label: { kind: 'assetAdd', count: tuples.length }, ops }
}

export type FolderIntent =
    | { kind: 'create'; name: string }
    | { kind: 'rename'; from: string; to: string }
    | { kind: 'delete'; name: string }
    | { kind: 'move'; names: readonly string[]; folder: string | null }
    | { kind: 'reorder'; order: readonly string[] }

// An explicit folder action. A codec refusal (a newer document, a taken name) refuses the intent; no ops is no step.
// A created folder is labelled with its name as the codec stores it (trimmed, never case-folded).
export function buildFolderIntent(intent: FolderIntent, live: LiveReader): AssetBuildResult {
    const stored = live.folderValue ? live.folderValue() : undefined
    let result
    let label: StepLabel
    switch (intent.kind) {
        case 'create':
            result = createFolder(stored, intent.name)
            label = { kind: 'folderCreate', name: intent.name.trim() }
            break
        case 'rename':
            result = renameFolder(stored, intent.from, intent.to)
            label = { kind: 'folderRename', from: intent.from, to: intent.to.trim() }
            break
        case 'delete':
            result = deleteFolder(stored, intent.name)
            label = { kind: 'folderDelete', name: intent.name }
            break
        case 'move':
            result = moveManyToFolder(stored, intent.names, intent.folder)
            label = { kind: 'assetMove', count: intent.names.length, folder: intent.folder }
            break
        case 'reorder':
            return buildFolderReorder(intent.order, live)
    }
    if (!result.ok) {
        return { ok: false, reason: 'precondition', folderRefusal: result.reason }
    }
    return result.ops.length === 0 ? { ok: false, reason: 'unchanged' } : { ok: true, label, ops: result.ops.map(fromFolderOp) }
}

// Reorders the folders to `order`, which must name exactly the listed folders once each. Only entry-level folder ops
// are emitted, never a whole document. An unreadable or newer document refuses, like every explicit folder intent.
export function buildFolderReorder(order: readonly string[], live: LiveReader): AssetBuildResult {
    const result = reorderFolders(live.folderValue ? live.folderValue() : undefined, order)
    if (result.ok === false) {
        return { ok: false, reason: 'precondition', folderRefusal: result.reason }
    }
    return result.ops.length === 0 ? { ok: false, reason: 'unchanged' } : { ok: true, label: { kind: 'folderReorder' }, ops: result.ops.map(fromFolderOp) }
}

// ---------------------------------------------------------------- write helpers

// True when the forward ops remove a row from the list or move a row to another file: the writes after which a
// file may be left unreferenced, and so the ones that need a working undo.
export function removesAssetRow(forwardOps: readonly (Op | WriteOp)[]): boolean {
    return forwardOps.some((op) => op.op === 'assetRowRemove' || (op.op === 'assetRowSet' && op.before[1] !== op.after[1]))
}

// Whether the write changes any asset list or folder document, so the retained paths follow it.
export function touchesAssets(forwardOps: readonly (Op | WriteOp)[]): boolean {
    return forwardOps.some(
        (op) => op.op === 'assetRowRemove' || op.op === 'assetRowInsert' || op.op === 'assetRowSet' || op.op === 'assetFolderSet' || op.op === 'assetFolderOrder',
    )
}

// Rows first, then folder entries, then the rest (text, fields, lists), each group in the plan's order.
export function orderAssetWrites(writes: readonly WriteOp[]): WriteOp[] {
    const rank = (write: WriteOp): number =>
        write.op === 'assetRowRemove' || write.op === 'assetRowInsert' || write.op === 'assetRowSet' ? 0 : write.op === 'assetFolderSet' || write.op === 'assetFolderOrder' ? 1 : 2
    return [0, 1, 2].flatMap((group) => writes.filter((write) => rank(write) === group))
}

export function folderOpsOf(writes: readonly WriteOp[]): FolderOp[] {
    const ops: FolderOp[] = []
    for (const write of writes) {
        if (write.op === 'assetFolderSet') {
            ops.push({ kind: 'assetFolderSet', name: write.name, before: write.before, after: write.after })
        } else if (write.op === 'assetFolderOrder') {
            ops.push({ kind: 'assetFolderOrder', before: [...write.before], after: [...write.after] })
        }
    }
    return ops
}

// Every module slot that holds `id`, stubs included: a stub counts, so an id shared with an unloaded module is shared.
export function moduleSlotsWithId(modules: readonly unknown[] | undefined, id: string): { index: number; module: unknown }[] {
    const slots: { index: number; module: unknown }[] = []
    if (!Array.isArray(modules)) {
        return slots
    }
    modules.forEach((module, index) => {
        if (typeof module === 'object' && module !== null && (module as { id?: unknown }).id === id) {
            slots.push({ index, module })
        }
    })
    return slots
}

// ---------------------------------------------------------------- retained paths

export type RetainedPairs = [string, string][]

// A present value that is an array whose every item is an array of exactly two strings.
export function readRetainedPairs(value: unknown): RetainedPairs | null {
    if (!Array.isArray(value)) {
        return null
    }
    const pairs: RetainedPairs = []
    for (const item of value) {
        if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string' || typeof item[1] !== 'string') {
            return null
        }
        pairs.push([item[0], item[1]])
    }
    return pairs
}

// The pairs a set of steps names, unique by path and sorted by path; a path keeps the name of its first naming op.
export function retainedPairsOf(steps: ReadonlySet<Step>): RetainedPairs {
    const names = new Map<string, string>()
    for (const step of steps) {
        for (const [name, path] of stepPathPairs(step)) {
            if (!names.has(path)) {
                names.set(path, name)
            }
        }
    }
    return [...names.keys()].sort().map((path): [string, string] => [names.get(path) ?? '', path])
}

export type RetainedResult = { kind: 'keep' } | { kind: 'set'; value: RetainedPairs } | { kind: 'remove' }

function samePairs(a: readonly (readonly string[])[], b: readonly (readonly string[])[]): boolean {
    return a.length === b.length && a.every((pair, i) => pair[0] === b[i][0] && pair[1] === b[i][1])
}

// The owner's retained field after one asset write. `ready`: exactly the paths of `steps` (memory, the last
// acknowledged save and every unsettled save). `memoryOnly`: what the field holds plus those paths, never fewer. An
// unreadable present value is left as it is. The key is removed when nothing is retained.
export function recomputeRetained(existing: unknown, phase: 'ready' | 'memoryOnly', steps: ReadonlySet<Step>): RetainedResult {
    // The caller passes the field's value, not its owner: no writer stores `undefined` under the key (`writeRetained`
    // deletes it instead), so `undefined` here is the same as an absent key.
    const present = existing !== undefined
    const known = present ? readRetainedPairs(existing) : []
    if (known === null) {
        return { kind: 'keep' }
    }
    const fromSteps = retainedPairsOf(steps)
    let next = fromSteps
    if (phase === 'memoryOnly') {
        const byPath = new Map<string, string>()
        for (const [name, path] of known) {
            byPath.set(path, name)
        }
        for (const [name, path] of fromSteps) {
            if (!byPath.has(path)) {
                byPath.set(path, name)
            }
        }
        next = [...byPath.keys()].sort().map((path): [string, string] => [byPath.get(path) ?? '', path])
    }
    if (next.length === 0) {
        return present ? { kind: 'remove' } : { kind: 'keep' }
    }
    return present && samePairs(next, known) ? { kind: 'keep' } : { kind: 'set', value: next }
}
