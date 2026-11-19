// The visit run of update all: one synchronous task that rescans, compares with the plan the user saw, writes, and
// keeps the journal for one Undo in the same Studio visit. It records no owner history step (the History list and the
// stored history format are untouched); the only service calls are closing open typing steps and the save acks.
//
// Invariants:
// - The scan and the plan are rebuilt in the click's own task after the held fields are flushed; the display scan is
//   never passed in. A plan whose signature differs from the shown one writes nothing, closes nothing and touches no ack.
// - Open steps of every written owner are closed after the compare and before the first write, so a later typing
//   step never coalesces across the update.
// - The mark count is read before the first write and noted on the visit acks after a landed run or Undo.
// - Undo works only in the run's visit while Studio is open, once, and only when every target still reads what the
//   run wrote.
import { getSaveMarkCount } from '../globalApi.svelte'
import { flushStudioFields } from './fieldFlush'
import { createUpdateDbPort, readUpdateReach } from './edit/toggleUpdateAllDb'
import { characterOwnerKey, type OwnerKey } from './history/ownerPhase'
import { beginModuleAck, beginOwnerVisit, getStudioHistoryService } from './history/studioHistoryService.svelte'
import type { SaveAck } from './edit/saveAck.svelte'
import { studioScreen } from './studioScreen.svelte'
import type { ToggleTarget } from './toggleBuilder.svelte'
import {
    applyUpdate, checkUndo, planFromScan, restoreUpdate, scanReach,
    type Rename, type UpdateJournal, type UpdatePort, type UpdatePlan, type UpdateReach,
} from './toggleUpdateAll'

export type UpdateRunDeps = { port: () => UpdatePort, markCount: () => number }

const productionDeps: UpdateRunDeps = { port: createUpdateDbPort, markCount: getSaveMarkCount }

export type UpdateRequest = {
    readonly target: ToggleTarget
    readonly chaId: string
    /** Read again after the held fields are flushed. */
    readonly renames: () => readonly Rename[]
    readonly optIn: ReadonlySet<string>
    readonly shownSignature: string
}

export type LastUpdate = {
    readonly visitId: string
    readonly token: number
    readonly journal: UpdateJournal
    readonly count: number
    readonly target: ToggleTarget
    readonly chaId: string
}

let lastUpdate = $state.raw<LastUpdate | null>(null)
let tokenCounter = 0

/** The update the current visit can still undo, or null. Reactive. */
export function currentUpdate(): LastUpdate | null {
    return lastUpdate !== null && studioScreen.open && lastUpdate.visitId === studioScreen.visitId ? lastUpdate : null
}

/**
 * The reach the list shows and the run rescans: the one place both read it from, so they cannot disagree. Every owner,
 * the toggle owner included, is judged by DD-117 on its own live toggle text: an owner whose text defines an old key is
 * skipped or listed, never silently rewritten.
 */
export function readShownReach(target: ToggleTarget, chaId: string): UpdateReach {
    return readUpdateReach(target, chaId)
}

/** Builds the plan from the live database now: the reach, a scan of it, and the plan over the given renames. */
export function buildUpdatePlan(target: ToggleTarget, chaId: string, renames: readonly Rename[], optIn: ReadonlySet<string>): UpdatePlan {
    const reach = readShownReach(target, chaId)
    return planFromScan(reach, scanReach(reach, new Set(renames.map((rename) => rename.from))), renames, optIn)
}

// The acks a landed run or Undo notes: the visit ack when the character was written, and the held module ack when the
// toggle owner module was written. Other active modules have no ack of their own.
function acksFor(journal: UpdateJournal, target: ToggleTarget, chaId: string): { character: SaveAck | null, module: SaveAck | null } {
    const writesCharacter = journal.writes.some((write) => write.ref.kind === 'character')
    const writesOwnModule = target.kind === 'module'
        && journal.writes.some((write) => write.ref.kind === 'module' && write.ref.moduleId === target.moduleId)
    return {
        character: writesCharacter ? beginOwnerVisit(characterOwnerKey(chaId)) : null,
        module: writesOwnModule && target.kind === 'module' ? beginModuleAck(target.moduleId) : null,
    }
}

function closeSteps(journal: UpdateJournal): void {
    const service = getStudioHistoryService()
    const closed = new Set<OwnerKey>()
    for (const write of journal.writes) {
        if (!closed.has(write.owner)) {
            closed.add(write.owner)
            service?.closeOpenStep(write.owner)
        }
    }
}

function noteAcks(acks: { character: SaveAck | null, module: SaveAck | null }, target: ToggleTarget, chaId: string, before: number): void {
    acks.character?.noteEdit(chaId, before)
    if (target.kind === 'module') {
        acks.module?.noteEdit(target.moduleId, before)
    }
}

export function runUpdateAll(req: UpdateRequest, deps: UpdateRunDeps = productionDeps):
    { ok: true, token: number, count: number } | { ok: false, reason: 'stale' | 'failed' | 'unavailable' } {
    if (!getStudioHistoryService()) {
        return { ok: false, reason: 'unavailable' }
    }
    flushStudioFields('leave')
    const plan = buildUpdatePlan(req.target, req.chaId, req.renames(), req.optIn)
    if (plan.signature !== req.shownSignature) {
        return { ok: false, reason: 'stale' }
    }
    if (plan.count === 0) {
        // Nothing to write: an Undo all from an earlier run in this visit stays as it is.
        return { ok: true, token: currentUpdate()?.token ?? 0, count: 0 }
    }
    const journal: UpdateJournal = { writes: plan.writes }
    closeSteps(journal)
    const acks = acksFor(journal, req.target, req.chaId)
    const before = deps.markCount()
    const applied = applyUpdate(plan, deps.port())
    if (!applied.ok) {
        return { ok: false, reason: 'failed' }
    }
    noteAcks(acks, req.target, req.chaId, before)
    const token = ++tokenCounter
    lastUpdate = { visitId: studioScreen.visitId, token, journal: applied.journal, count: plan.count, target: req.target, chaId: req.chaId }
    return { ok: true, token, count: plan.count }
}

export function undoLastUpdate(token?: number, deps: UpdateRunDeps = productionDeps):
    { ok: true } | { ok: false, reason: 'changed', owner: OwnerKey } | { ok: false, reason: 'failed' | 'gone' } {
    const last = lastUpdate
    if (!last || !studioScreen.open || last.visitId !== studioScreen.visitId || (token !== undefined && token !== last.token)) {
        return { ok: false, reason: 'gone' }
    }
    lastUpdate = null
    flushStudioFields('leave')
    const port = deps.port()
    const checked = checkUndo(last.journal, port)
    if (checked.ok === false) {
        return { ok: false, reason: 'changed', owner: checked.owner }
    }
    closeSteps(last.journal)
    const acks = acksFor(last.journal, last.target, last.chaId)
    const before = deps.markCount()
    const restored = restoreUpdate(last.journal, port)
    if (!restored.ok) {
        return { ok: false, reason: 'failed' }
    }
    noteAcks(acks, last.target, last.chaId, before)
    return { ok: true }
}

export function resetUpdateRunForTests(): void {
    lastUpdate = null
    tokenCounter = 0
}
