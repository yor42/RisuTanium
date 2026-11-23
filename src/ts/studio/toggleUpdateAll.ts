// Update all, the pure half: which uses of a renamed toggle key a rename rewrites, the plan of the rewrite, and the
// apply, check and restore steps over a port. Nothing here reads the database or the screen.
//
// Invariants:
// - A plan writes only when every rename's old and new key pass `isUpdatableToggleKey`; otherwise it writes nothing
//   and every use is listed.
// - Only static hits are rewritten, each exactly at the offset where the stored text reads the expected old span;
//   an owner with any unexpected span writes nothing.
// - All hits of a plan are rewritten in one pass over the text as it was read, so a swap of two keys is exact.
// - `applyUpdate` puts back every owner it reached when one write fails, and `settle` runs once after the writes or
//   the put-back.

import { recordCaughtError } from '../caughtErrors'
import { spliceTextEdits, type TextEdit } from './assets/referenceRewrite'
import type { ClassifiedTarget } from './assets/referenceTargets'
import { textWriteFor, type WriteOp } from './history/historyModel'
import type { OwnerKey } from './history/ownerPhase'
import { keysOfText } from './toggleKeys'
import { scanTextUses, type UseFlag, type UseHit } from './toggleUses'

export type Rename = { readonly from: string, readonly to: string }
export type UseOwnerRef = { readonly kind: 'character', readonly chaId: string } | { readonly kind: 'module', readonly moduleId: string }
export type UseOwner = {
    readonly ref: UseOwnerRef
    readonly key: OwnerKey
    readonly name: string
    readonly toggleText: string
    readonly targets: readonly ClassifiedTarget[]
}
export type Unreached = { readonly name: string, readonly reason: 'notLoaded' | 'sharedId' | 'duplicateCharacter' | 'restricted' }
export type UpdateReach = { readonly owners: readonly UseOwner[], readonly unreached: readonly Unreached[] }
export type ScanHit = UseHit & { readonly owner: OwnerKey }
export type UseScan = { readonly hits: readonly ScanHit[], readonly literalFallback: ReadonlySet<string> }
export type ListedReason = UseFlag | 'calcKey' | 'blocked' | 'mismatch'
export type ListedUse = {
    readonly owner: OwnerKey
    readonly path: string
    readonly key: string
    readonly offset: number
    readonly length: number
    readonly reason: ListedReason
}
export type SkippedSource = { readonly owner: OwnerKey, readonly key: string, readonly count: number }
export type TargetWrite = {
    readonly owner: OwnerKey
    readonly ref: UseOwnerRef
    readonly path: string
    readonly before: string
    readonly after: string
    readonly count: number
    /** The (offset, old key) pairs the write replaces, in offset order. */
    readonly pairs: readonly (readonly [number, string])[]
}
export type UpdatePlan = {
    readonly writes: readonly TargetWrite[]
    readonly listed: readonly ListedUse[]
    readonly skipped: readonly SkippedSource[]
    /** The keys that blocked the plan, in rename order; empty when the plan may write. */
    readonly blocked: readonly string[]
    readonly count: number
    readonly signature: string
}
export type UpdateJournal = { readonly writes: readonly TargetWrite[] }

const UPDATABLE_KEY = /^[\p{L}\p{M}\p{N}_-]+$/u
const CALC_KEY = /^[A-Za-z0-9_]+$/
const WORD = /[A-Za-z0-9_]/

/** Whether update all may rewrite uses of this key: letters of any script with their combining marks, digits, `_` and `-` only. */
export function isUpdatableToggleKey(key: string): boolean {
    return UPDATABLE_KEY.test(key)
}

/** Scans every target of every owner of the reach for the uses of `oldKeys`. */
export function scanReach(reach: UpdateReach, oldKeys: ReadonlySet<string>): UseScan {
    const hits: ScanHit[] = []
    const literalFallback = new Set<string>()
    const seen = new Set<OwnerKey>()
    for (const owner of reach.owners) {
        if (seen.has(owner.key)) {
            continue
        }
        seen.add(owner.key)
        for (const target of owner.targets) {
            for (const hit of scanTextUses(target.text, target.path, target.cls, oldKeys)) {
                hits.push({ ...hit, owner: owner.key })
                if (hit.flag === 'literalBlock') {
                    literalFallback.add(`${owner.key}\u0000${target.path}`)
                }
            }
        }
    }
    return { hits, literalFallback }
}

// Whether the stored text reads the old key where the hit says, and nothing longer: the prefix before the key, the
// whole key, and a closing character after it.
function expectedSpanAt(text: string, hit: UseHit): boolean {
    const prefix = hit.syntax === 'when' ? '::' : 'toggle_'
    if (hit.length !== hit.key.length || hit.offset < prefix.length) {
        return false
    }
    if (!text.startsWith(prefix + hit.key, hit.offset - prefix.length)) {
        return false
    }
    const after = text[hit.offset + hit.key.length]
    if (hit.syntax === 'calc') {
        return after === undefined || !WORD.test(after)
    }
    return after === undefined || after === ':' || after === '}'
}

function listedOf(hit: ScanHit, reason: ListedReason): ListedUse {
    return { owner: hit.owner, path: hit.path, key: hit.key, offset: hit.offset, length: hit.length, reason }
}

function signatureOf(
    renames: readonly Rename[],
    optIn: ReadonlySet<string>,
    blocked: readonly string[],
    writes: readonly TargetWrite[],
    listed: readonly ListedUse[],
    skipped: readonly SkippedSource[],
): string {
    return JSON.stringify({
        renames: renames.map((rename) => [rename.from, rename.to]),
        optIn: [...optIn].sort(),
        blocked,
        writes: writes.map((write) => [write.owner, write.path, write.pairs, write.count]),
        listed,
        skipped,
    })
}

/**
 * The plan of one update: what is rewritten, listed or skipped, from a scan of the reach. The scan is an input so a
 * caller can reuse one scan for display; the run always scans again.
 */
export function planFromScan(reach: UpdateReach, scan: UseScan, renames: readonly Rename[], optIn: ReadonlySet<string>): UpdatePlan {
    const active = renames.filter((rename) => rename.from !== rename.to)
    const toOf = new Map<string, string>()
    for (const rename of active) {
        if (!toOf.has(rename.from)) {
            toOf.set(rename.from, rename.to)
        }
    }
    const blocked: string[] = []
    for (const rename of active) {
        for (const key of [rename.from, rename.to]) {
            if (!isUpdatableToggleKey(key) && !blocked.includes(key)) {
                blocked.push(key)
            }
        }
    }
    const hits = scan.hits.filter((hit) => toOf.has(hit.key))
    const listed: ListedUse[] = []
    const skipped = new Map<string, { owner: OwnerKey, key: string, count: number }>()
    const writes: TargetWrite[] = []
    let count = 0

    if (blocked.length > 0) {
        for (const hit of hits) {
            listed.push(listedOf(hit, hit.flag ?? 'blocked'))
        }
        return { writes, listed, skipped: [], blocked, count, signature: signatureOf(active, optIn, blocked, writes, listed, []) }
    }

    const ownerOf = new Map<OwnerKey, UseOwner>()
    for (const owner of reach.owners) {
        if (!ownerOf.has(owner.key)) {
            ownerOf.set(owner.key, owner)
        }
    }
    const definedKeys = new Map<OwnerKey, ReadonlySet<string>>()
    const candidates = new Map<OwnerKey, ScanHit[]>()
    for (const hit of hits) {
        const owner = ownerOf.get(hit.owner)
        if (!owner) {
            continue
        }
        const to = toOf.get(hit.key) as string
        if (hit.flag) {
            listed.push(listedOf(hit, hit.flag))
            continue
        }
        let defined = definedKeys.get(owner.key)
        if (!defined) {
            defined = keysOfText(owner.toggleText)
            definedKeys.set(owner.key, defined)
        }
        if (defined.has(hit.key) && !optIn.has(owner.key)) {
            const id = `${owner.key}\u0000${hit.key}`
            const entry = skipped.get(id) ?? { owner: owner.key, key: hit.key, count: 0 }
            entry.count++
            skipped.set(id, entry)
            continue
        }
        if (hit.syntax === 'calc' && !CALC_KEY.test(to)) {
            listed.push(listedOf(hit, 'calcKey'))
            continue
        }
        const list = candidates.get(owner.key)
        if (list) {
            list.push(hit)
        } else {
            candidates.set(owner.key, [hit])
        }
    }

    const written = new Set<OwnerKey>()
    for (const owner of reach.owners) {
        const list = candidates.get(owner.key)
        if (!list || written.has(owner.key)) {
            continue
        }
        written.add(owner.key)
        const textOf = new Map(owner.targets.map((target) => [target.path, target.text]))
        if (!list.every((hit) => expectedSpanAt(textOf.get(hit.path) ?? '', hit))) {
            for (const hit of list) {
                listed.push(listedOf(hit, 'mismatch'))
            }
            continue
        }
        for (const target of owner.targets) {
            const own = list.filter((hit) => hit.path === target.path)
            if (own.length === 0) {
                continue
            }
            const edits: TextEdit[] = own
                .slice()
                .sort((a, b) => b.offset - a.offset)
                .map((hit) => ({ target: target.path, offset: hit.offset, from: hit.key, to: toOf.get(hit.key) as string }))
            writes.push({
                owner: owner.key,
                ref: owner.ref,
                path: target.path,
                before: target.text,
                after: spliceTextEdits(target.text, edits),
                count: edits.length,
                pairs: own.slice().sort((a, b) => a.offset - b.offset).map((hit) => [hit.offset, hit.key] as const),
            })
            count += edits.length
        }
    }
    const skippedList = [...skipped.values()]
    return { writes, listed, skipped: skippedList, blocked, count, signature: signatureOf(active, optIn, blocked, writes, listed, skippedList) }
}

/** The write for a registry path of this owner kind; a module text is always a `textSet`, which lands the same value a replay's `set` would. */
export function writeOpFor(kind: UseOwnerRef['kind'], path: string, value: string): WriteOp {
    return kind === 'character' ? textWriteFor(path, value) : { op: 'textSet', target: path, value }
}

export interface UpdatePort {
    read(ref: UseOwnerRef, path: string): string | null | 'gone'
    /** One owner's writes: assignment and mark. false = nothing written (gone, shared, refused). May throw after a partial write. */
    write(ref: UseOwnerRef, writes: readonly { path: string, value: string }[]): boolean
    /** The notifications that follow module slot writes; once per apply or restore, after the writes or the put-back. */
    settle(): void
}

function groupsOf(writes: readonly TargetWrite[]): TargetWrite[][] {
    const groups = new Map<OwnerKey, TargetWrite[]>()
    for (const write of writes) {
        const group = groups.get(write.owner)
        if (group) {
            group.push(write)
        } else {
            groups.set(write.owner, [write])
        }
    }
    return [...groups.values()]
}

function valuesOf(group: readonly TargetWrite[], side: 'before' | 'after'): { path: string, value: string }[] {
    return group.map((write) => ({ path: write.path, value: write[side] }))
}

// Writes each owner's `target` side, owner by owner in order. A refused or throwing owner ends the run and every
// owner reached, the failing one included, is put back to the `putBack` side, last first.
function runWrites(writes: readonly TargetWrite[], port: UpdatePort, site: string, target: 'before' | 'after', putBack: 'before' | 'after'): { ok: true } | { ok: false, reason: 'failed' } {
    const attempted: TargetWrite[][] = []
    let failed = false
    try {
        for (const group of groupsOf(writes)) {
            attempted.push(group)
            if (!port.write(group[0].ref, valuesOf(group, target))) {
                throw new Error('A toggle update write was refused')
            }
        }
    } catch (error) {
        failed = true
        recordCaughtError(site, error)
        for (const group of attempted.reverse()) {
            try {
                port.write(group[0].ref, valuesOf(group, putBack))
            } catch (putBackError) {
                recordCaughtError(site, putBackError)
            }
        }
    }
    try {
        port.settle()
    } catch (error) {
        recordCaughtError(site, error)
    }
    return failed ? { ok: false, reason: 'failed' } : { ok: true }
}

export function applyUpdate(plan: UpdatePlan, port: UpdatePort): { ok: true, journal: UpdateJournal } | { ok: false, reason: 'failed' } {
    const result = runWrites(plan.writes, port, 'studio.toggleUpdate.apply', 'after', 'before')
    if (result.ok === false) {
        return result
    }
    return { ok: true, journal: { writes: plan.writes } }
}

/** Every journal target must still read exactly what the update wrote; otherwise the first owner that differs. Writes nothing. */
export function checkUndo(journal: UpdateJournal, port: UpdatePort): { ok: true } | { ok: false, owner: OwnerKey } {
    for (const write of journal.writes) {
        if (port.read(write.ref, write.path) !== write.after) {
            return { ok: false, owner: write.owner }
        }
    }
    return { ok: true }
}

export function restoreUpdate(journal: UpdateJournal, port: UpdatePort): { ok: true } | { ok: false, reason: 'failed' } {
    return runWrites(journal.writes, port, 'studio.toggleUpdate.undo', 'before', 'after')
}
