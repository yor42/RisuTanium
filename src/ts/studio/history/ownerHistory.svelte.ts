// The Studio history service: one slot per owner key and page, each with the lifecycle of
// `ownerPhase.ts`, shared claim and open entries that settle once, one marked write path
// (`applyStudioWrite`) for every history action, and a write-behind mirror to the device store.
// Memory is the authority once an owner is `ready`; the store is only ever written in `ready`.

import { getSaveMarkCount } from '../../globalApi.svelte'
import { writeLiveCharacter, writeLiveChat } from '../../liveCharacterWrite'
import { registerLeaveFlush as registerPageLeaveFlush } from '../../process/saveOnHide'
import { studioScreen } from '../studioScreen.svelte'
import {
    applyCharacterWrites,
    applyChatWrites,
    buildFieldEdit,
    buildGreetingAdd,
    buildGreetingDelete,
    buildGreetingEdit,
    createLiveReader,
    isRestrictedChaId,
    resolveLiveTarget,
    type EditBuildResult,
    type LiveTarget,
    type SetterRefusal,
} from '../edit/studioSetters'
import type { SaveAck } from '../edit/saveAck.svelte'
import {
    applyReplayMove,
    commitStep,
    createPageSession,
    deriveRestoreWrites,
    emptyRecord,
    planReplay,
    planRestoreDeleted,
    planRestorePoint,
    planRevert,
    stepIdFor,
    type DeletedItem,
    type HistoryClock,
    type LiveReader,
    type ModelState,
    type OpenStep,
    type OwnerRecord,
    type RestorePath,
    type RestorePlan,
    type RestorePoint,
    type SetPath,
    type Step,
    type StepPlan,
    type WriteOp,
} from './historyModel'
import {
    isWaitingPhase,
    nextPhase,
    parseOwnerKey,
    READY_DEADLINE_MS,
    SAVE_DEBOUNCE_MS,
    SAVE_MAX_WAIT_MS,
    type MemoryOnlyReason,
    type OwnerEvent,
    type OwnerKey,
    type OwnerPhase,
    type ReadyReason,
} from './ownerPhase'
import type {
    ClaimResult,
    LoadResult,
    OpenResult,
    SaveResult,
    StudioClaimPort,
    StudioHistoryStore,
} from './studioHistoryStore'

export type StudioRefusal = 'loading' | SetterRefusal | 'empty' | 'unknown'

// What a landed action tells the caller. `unchanged` means the value already was the requested one:
// nothing was written, marked or recorded.
export interface StudioWriteNotes {
    unchanged?: boolean
    // A chat-side effect could not be replayed because the chat has no unique id.
    fmNotRestored?: boolean
    // Ops of the replayed step that were skipped because the live value had moved on.
    skipped?: number
    // Revert only: list ops that were not undone because their step's list no longer fit. Also set on
    // an `unchanged` revert, which lands nothing.
    listSkipped?: number
    // Restore point only: the paths whose live value was changed outside Studio's history.
    changedElsewhere?: RestorePath[]
}

export type StudioResult = ({ ok: true } & StudioWriteNotes) | { ok: false; reason: StudioRefusal }

export type OwnerAck = Pick<SaveAck, 'noteEdit'>

export interface OwnerView {
    ownerKey: OwnerKey
    // 'unused' until the owner's first use.
    phase: OwnerPhase['kind'] | 'unused'
    // The reason a banner is shown for, or null.
    banner: MemoryOnlyReason | ReadyReason | null
    // A group or private owner (checked on every read): nothing is shown for it.
    restricted: boolean
    // Edits are accepted: `ready` or `memoryOnly`, not restricted.
    editable: boolean
    // History is mirrored to the device store.
    persisted: boolean
    done: readonly Step[]
    undone: readonly Step[]
    deleted: readonly DeletedItem[]
    restore: RestorePoint | null
}

export interface OwnerHistoryDeps {
    store: StudioHistoryStore
    claim: StudioClaimPort
    clock: HistoryClock
    // True on Tauri, where a page without Web Locks is treated as the one live page.
    tauri?: boolean
    pageSession?: string
    // Default: the page's save mark counter.
    getMarkCount?: () => number
    // Default: the current Studio visit.
    getVisitId?: () => string
    // Default: the page's leave rule in saveOnHide.ts, read when the service is created.
    registerLeaveFlush?: (flush: () => void) => () => void
}

export interface OwnerHistoryService {
    // First use of an owner (idempotent): starts its lifecycle, which ends in `ready`, `memoryOnly`
    // or `excluded`. Later calls change nothing.
    useOwner(owner: OwnerKey): void
    // Resolves when the owner is `ready`, `memoryOnly` or `excluded`; the first use is implied.
    whenReady(owner: OwnerKey): Promise<void>
    view(owner: OwnerKey): OwnerView
    setAck(chaId: string, ack: OwnerAck | null): void
    editField(owner: OwnerKey, path: SetPath, value: string | boolean): StudioResult
    greetingAdd(owner: OwnerKey): StudioResult
    greetingEdit(owner: OwnerKey, index: number, value: string): StudioResult
    greetingDelete(owner: OwnerKey, index: number): StudioResult
    undo(owner: OwnerKey): StudioResult
    redo(owner: OwnerKey): StudioResult
    revertTo(owner: OwnerKey, stepId: string): StudioResult
    restore(owner: OwnerKey, keep: ReadonlySet<RestorePath>): StudioResult
    restoreDeleted(owner: OwnerKey, deletedId: string): StudioResult
    // Blur or a visit close: the next write starts a new step.
    closeOpenStep(owner: OwnerKey): void
}

interface Entry<T> {
    readonly promise: Promise<T>
    readonly creator: OwnerKey | null
    settled: boolean
    timer: unknown
    // The first settle wins; later ones change nothing.
    settle(value: T): void
}

function createEntry<T>(creator: OwnerKey | null, clock: HistoryClock): Entry<T> {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => {
        resolve = done
    })
    const entry: Entry<T> = {
        promise,
        creator,
        settled: false,
        timer: null,
        settle(value) {
            if (entry.settled) {
                return
            }
            entry.settled = true
            if (entry.timer !== null) {
                clock.clearTimeout(entry.timer)
                entry.timer = null
            }
            resolve(value)
        },
    }
    return entry
}

class OwnerSlot {
    phase = $state.raw<OwnerPhase | null>(null)
    record = $state.raw<OwnerRecord>(emptyRecord('character:_', 0))
    open: OpenStep | null = null
    deadline: unknown = null
    debounce: unknown = null
    maxWait: unknown = null
    // A save job is queued and has not started; at most one exists per owner.
    jobWaiting = false
    tail: Promise<void> = Promise.resolve()
    waiters: (() => void)[] = []

    constructor(
        readonly key: OwnerKey,
        readonly chaId: string,
    ) {}
}

function isRestorePlan(plan: StepPlan): plan is RestorePlan {
    return 'changedElsewhere' in plan
}

function claimEvent(result: ClaimResult, tauri: boolean): OwnerEvent {
    switch (result) {
        case 'granted':
            return { type: 'claim:granted' }
        case 'held':
            return { type: 'claim:held' }
        case 'unsupported':
            return { type: 'claim:unsupported', tauri }
        case 'failed':
            return { type: 'claim:failed' }
    }
}

function saveEvent(result: SaveResult): OwnerEvent {
    switch (result.kind) {
        case 'ok':
            return { type: 'save:ok', asided: result.asided, trimmed: result.trimmed }
        case 'unwritable':
            return { type: 'save:unwritable' }
        case 'kept':
            return { type: 'save:kept' }
        case 'notLoaded':
            return { type: 'save:notLoaded' }
    }
}

type Intent =
    | { kind: 'edit'; build: (id: string, live: LiveReader, target: LiveTarget) => EditBuildResult }
    | { kind: 'replay'; direction: 'undo' | 'redo' }
    | { kind: 'revert'; stepId: string }
    | { kind: 'restore'; keep: ReadonlySet<RestorePath> }
    | { kind: 'restoreDeleted'; deletedId: string }

export function createOwnerHistoryService(deps: OwnerHistoryDeps): OwnerHistoryService {
    const { store, claim, clock } = deps
    const tauri = deps.tauri ?? false
    const getMarkCount = deps.getMarkCount ?? getSaveMarkCount
    const getVisitId = deps.getVisitId ?? (() => studioScreen.visitId)
    const pageSession = deps.pageSession ?? createPageSession((bytes) => crypto.getRandomValues(bytes))
    let counter = 0

    const slots = new Map<OwnerKey, OwnerSlot>()
    const claims = new Map<string, Entry<ClaimResult>>()
    const acks = new Map<string, OwnerAck>()
    let openEntry: Entry<OpenResult> | null = null
    // Read by `view`, so a view taken before an owner's first use updates when the owner appears.
    let slotCount = $state(0)

    // ---------------------------------------------------------------- queue

    // A job starts in a promise continuation, never through a timer: a hide flush must not wait for
    // timers that a hidden page may have stopped.
    function enqueue(slot: OwnerSlot, job: () => Promise<void>): void {
        slot.tail = slot.tail.then(job).catch((error) => {
            console.error(error)
        })
    }

    // ---------------------------------------------------------------- lifecycle

    function clearDeadline(slot: OwnerSlot): void {
        if (slot.deadline !== null) {
            clock.clearTimeout(slot.deadline)
            slot.deadline = null
        }
    }

    function clearSaveTimers(slot: OwnerSlot): void {
        if (slot.debounce !== null) {
            clock.clearTimeout(slot.debounce)
            slot.debounce = null
        }
        if (slot.maxWait !== null) {
            clock.clearTimeout(slot.maxWait)
            slot.maxWait = null
        }
    }

    function claimEntryFor(slot: OwnerSlot): Entry<ClaimResult> {
        const known = claims.get(slot.chaId)
        if (known) {
            return known
        }
        const entry = createEntry<ClaimResult>(slot.key, clock)
        claims.set(slot.chaId, entry)
        try {
            claim.tryClaim(slot.chaId).then(
                (result) => entry.settle(result),
                () => entry.settle('failed'),
            )
        } catch {
            entry.settle('failed')
        }
        return entry
    }

    function openEntryFor(): Entry<OpenResult> {
        if (openEntry) {
            return openEntry
        }
        const entry = createEntry<OpenResult>(null, clock)
        openEntry = entry
        // The entry expires on its own, whatever the owners that wait on it do.
        entry.timer = clock.setTimeout(() => {
            entry.timer = null
            entry.settle('unavailable')
        }, READY_DEADLINE_MS)
        try {
            store.open().then(
                (result) => entry.settle(result),
                () => entry.settle('unavailable'),
            )
        } catch {
            entry.settle('unavailable')
        }
        return entry
    }

    function onDeadline(slot: OwnerSlot): void {
        slot.deadline = null
        if (slot.phase?.kind === 'claiming') {
            // Only the owner that created the claim request settles its entry.
            const entry = claims.get(slot.chaId)
            if (entry && !entry.settled && entry.creator === slot.key) {
                entry.settle('failed')
            }
        }
        deliver(slot, { type: 'deadline' })
    }

    async function runLoad(slot: OwnerSlot): Promise<void> {
        let result: LoadResult
        try {
            result = await store.load(slot.key)
        } catch {
            result = { kind: 'failed' }
        }
        // A result for an owner that left `loading` (deadline, closed connection) changes nothing.
        if (slot.phase?.kind !== 'loading') {
            return
        }
        switch (result.kind) {
            case 'absent':
                deliver(slot, { type: 'load:absent' })
                break
            case 'ok':
                slot.record = result.record
                deliver(slot, { type: 'load:ok' })
                break
            case 'unreadable':
                deliver(slot, { type: 'load:unreadable' })
                break
            case 'keptUnreadable':
                deliver(slot, { type: 'load:keptUnreadable' })
                break
            case 'failed':
                deliver(slot, { type: 'load:failed' })
                break
        }
    }

    function release(slot: OwnerSlot): void {
        for (const resolve of slot.waiters.splice(0)) {
            resolve()
        }
    }

    function enter(slot: OwnerSlot, from: OwnerPhase | null, to: OwnerPhase): void {
        if (from?.kind === 'ready') {
            // Leaving `ready` drops the waiting debounce: nothing is written outside `ready`.
            clearSaveTimers(slot)
        }
        switch (to.kind) {
            case 'claiming': {
                slot.deadline = clock.setTimeout(() => onDeadline(slot), READY_DEADLINE_MS)
                const entry = claimEntryFor(slot)
                void entry.promise.then((result) => deliver(slot, claimEvent(result, tauri)))
                break
            }
            case 'opening': {
                const entry = openEntryFor()
                void entry.promise.then((result) =>
                    deliver(slot, result === 'ok' ? { type: 'open:ok' } : { type: 'open:unavailable' }),
                )
                break
            }
            case 'loading':
                enqueue(slot, () => runLoad(slot))
                break
            case 'ready':
            case 'memoryOnly':
            case 'excluded':
                clearDeadline(slot)
                release(slot)
                break
        }
    }

    // The only place a phase changes. An event without a row leaves the phase as it was.
    function deliver(slot: OwnerSlot, event: OwnerEvent): void {
        const from = slot.phase
        const to = nextPhase(from, event)
        if (to === null || to === from) {
            return
        }
        slot.phase = to
        if (from === null || from.kind !== to.kind) {
            enter(slot, from, to)
        }
    }

    function handleClosed(): void {
        const stale = openEntry
        // The next first use finds a settled failure and goes straight to memory-only.
        const replaced = createEntry<OpenResult>(null, clock)
        replaced.settle('unavailable')
        openEntry = replaced
        stale?.settle('unavailable')
        for (const slot of [...slots.values()]) {
            deliver(slot, { type: 'closed' })
        }
    }

    function useOwner(owner: OwnerKey): OwnerSlot | null {
        const parsed = parseOwnerKey(owner)
        if (!parsed) {
            return null
        }
        let slot = slots.get(owner)
        if (!slot) {
            slot = new OwnerSlot(owner, parsed.chaId)
            slot.record = emptyRecord(owner, clock.now())
            slots.set(owner, slot)
            slotCount += 1
            deliver(slot, { type: 'firstUse', restricted: isRestrictedChaId(parsed.chaId) })
        }
        return slot
    }

    // ---------------------------------------------------------------- saves

    function enqueueSave(slot: OwnerSlot): void {
        if (slot.jobWaiting) {
            return
        }
        slot.jobWaiting = true
        enqueue(slot, () => runSave(slot))
    }

    async function runSave(slot: OwnerSlot): Promise<void> {
        slot.jobWaiting = false
        if (slot.phase?.kind !== 'ready') {
            return
        }
        // A timer or job armed before the character became private or a group writes nothing.
        if (isRestrictedChaId(slot.chaId)) {
            return
        }
        let result: SaveResult
        try {
            result = await store.save(slot.key, slot.record, new Set<OwnerKey>([slot.key]))
        } catch {
            result = { kind: 'unwritable' }
        }
        deliver(slot, saveEvent(result))
    }

    function fireSave(slot: OwnerSlot): void {
        clearSaveTimers(slot)
        enqueueSave(slot)
    }

    // Debounced: 1 s after the last request, and at most 5 s after the first unsaved one.
    function requestSave(slot: OwnerSlot): void {
        if (slot.debounce !== null) {
            clock.clearTimeout(slot.debounce)
        }
        slot.debounce = clock.setTimeout(() => fireSave(slot), SAVE_DEBOUNCE_MS)
        if (slot.maxWait === null) {
            slot.maxWait = clock.setTimeout(() => fireSave(slot), SAVE_MAX_WAIT_MS)
        }
    }

    // A page leave enqueues at once the waiting save of every `ready` owner whose timer is pending.
    // It marks nothing, and an owner with nothing pending is left alone.
    function flushOnLeave(): void {
        for (const slot of slots.values()) {
            if (slot.phase?.kind === 'ready' && (slot.debounce !== null || slot.maxWait !== null)) {
                fireSave(slot)
            }
        }
    }

    // Read when the service is created, not at module load.
    const register = deps.registerLeaveFlush ?? registerPageLeaveFlush
    register(flushOnLeave)
    store.onClosed(handleClosed)

    // ---------------------------------------------------------------- the marked write path

    function refused(reason: StudioRefusal): StudioResult {
        return { ok: false, reason }
    }

    interface Planned {
        writes: readonly WriteOp[]
        pageFm: boolean
        // Applies the landed action to the owner's model state.
        land(state: ModelState): ModelState
        notes: StudioWriteNotes
    }

    function planFor(slot: OwnerSlot, intent: Intent, live: LiveReader, target: LiveTarget, at: number): Planned | StudioResult {
        const visitId = getVisitId()
        const record = slot.record
        if (intent.kind === 'edit') {
            const id = stepIdFor(pageSession, ++counter)
            const built = intent.build(id, live, target)
            if (built.ok === false) {
                return built.reason === 'unchanged' ? { ok: true, unchanged: true } : refused('precondition')
            }
            const greetings = live.greetings()
            // Read before the write: the live list is mutated in place.
            const restoreWrites = deriveRestoreWrites(built.ops, greetings === null ? null : [...greetings])
            return {
                writes: built.writes,
                pageFm: built.pageFm,
                notes: {},
                land: (state) =>
                    commitStep(state, {
                        id,
                        at,
                        visitId,
                        label: built.label,
                        ops: built.ops,
                        restoreWrites,
                        coalesceKey: built.coalesceKey,
                        replacesRestore: true,
                    }),
            }
        }
        if (intent.kind === 'replay') {
            const plan = planReplay(record, intent.direction, live)
            if (plan.ok === false) {
                return refused(plan.reason === 'empty' ? 'empty' : 'precondition')
            }
            return {
                writes: plan.writes,
                pageFm: false,
                notes: replayNotes(plan),
                land: (state) => applyReplayMove(state, intent.direction, plan, at, visitId),
            }
        }
        const plan =
            intent.kind === 'revert'
                ? planRevert(record, intent.stepId, live)
                : intent.kind === 'restore'
                  ? planRestorePoint(record.restore, live, intent.keep)
                  : planRestoreDeleted(record, intent.deletedId, live)
        if (plan.ok === false) {
            // A net-nothing revert lands nothing: no write, mark, step or save. It may still tell the
            // caller that older list changes were not undone or that a chat index could not be restored.
            if (plan.reason === 'unchanged') {
                return {
                    ok: true,
                    unchanged: true,
                    ...(plan.listSkipped === undefined ? {} : { listSkipped: plan.listSkipped }),
                    ...(plan.fmNotRestored ? { fmNotRestored: true } : {}),
                }
            }
            return refused(plan.reason)
        }
        const id = stepIdFor(pageSession, ++counter)
        const notes = replayNotes(plan)
        if (isRestorePlan(plan)) {
            notes.changedElsewhere = plan.changedElsewhere
        }
        return {
            writes: plan.writes,
            pageFm: false,
            notes,
            land: (state) =>
                commitStep(state, {
                    id,
                    at,
                    visitId,
                    label: plan.label,
                    ops: plan.ops,
                    restoreWrites: plan.restoreWrites,
                    coalesceKey: null,
                    replacesRestore: false,
                    deletedRemove: plan.deletedRemove,
                    liveListHash: plan.liveListHash,
                    afterListHash: plan.afterListHash,
                }),
        }
    }

    function replayNotes(plan: StepPlan): StudioWriteNotes {
        const notes: StudioWriteNotes = {}
        if (plan.skipped > 0) {
            notes.skipped = plan.skipped
        }
        if (plan.fmNotRestored) {
            notes.fmNotRestored = true
        }
        if (plan.listSkipped !== undefined && plan.listSkipped > 0) {
            notes.listSkipped = plan.listSkipped
        }
        return notes
    }

    // Every history action is one call of this: phase check, the setter guards, the plan, one
    // marked `writeLive*` call, then the stack move, the visit ack and the save request.
    function applyStudioWrite(owner: OwnerKey, intent: Intent): StudioResult {
        const slot = useOwner(owner)
        if (!slot || !slot.phase) {
            return refused('gone')
        }
        const phase = slot.phase
        if (isWaitingPhase(phase)) {
            return refused('loading')
        }
        if (phase.kind === 'excluded') {
            return refused('restricted')
        }
        const resolved = resolveLiveTarget(owner)
        if (resolved.ok === false) {
            return refused(resolved.reason)
        }
        const target = resolved.target
        const at = clock.now()
        const planned = planFor(slot, intent, createLiveReader(target), target, at)
        if (!('writes' in planned)) {
            return planned
        }
        const chaId = slot.chaId
        const before = getMarkCount()
        const landed = target.chat
            ? writeLiveChat(chaId, target.chat, (live) => {
                  applyChatWrites(live, planned.writes)
                  return true
              })
            : writeLiveCharacter(chaId, (live) => applyCharacterWrites(live, planned.writes, planned.pageFm))
        if (!landed) {
            return refused('gone')
        }
        const next = planned.land({ record: slot.record, open: slot.open })
        slot.record = next.record
        slot.open = next.open
        acks.get(chaId)?.noteEdit(chaId, before)
        if (phase.kind === 'ready') {
            requestSave(slot)
        }
        return { ok: true, ...planned.notes }
    }

    // ---------------------------------------------------------------- views

    function view(owner: OwnerKey): OwnerView {
        void slotCount
        const slot = slots.get(owner)
        const parsed = parseOwnerKey(owner)
        const restricted = parsed !== null && isRestrictedChaId(parsed.chaId)
        const phase = slot?.phase ?? null
        const kind = phase ? phase.kind : 'unused'
        const shown = slot !== undefined && !restricted
        const record = slot?.record ?? emptyRecord(owner, 0)
        return {
            ownerKey: owner,
            phase: kind,
            banner: phase?.kind === 'memoryOnly' ? phase.reason : phase?.kind === 'ready' ? phase.reason : null,
            restricted: restricted || kind === 'excluded',
            editable: !restricted && (kind === 'ready' || kind === 'memoryOnly'),
            persisted: kind === 'ready',
            done: shown ? record.done : [],
            undone: shown ? record.undone : [],
            deleted: shown ? record.deleted : [],
            restore: shown ? record.restore : null,
        }
    }

    function whenReady(owner: OwnerKey): Promise<void> {
        const slot = useOwner(owner)
        const kind = slot?.phase?.kind
        if (!slot || kind === 'ready' || kind === 'memoryOnly' || kind === 'excluded') {
            return Promise.resolve()
        }
        return new Promise<void>((resolve) => {
            slot.waiters.push(resolve)
        })
    }

    return {
        useOwner(owner) {
            useOwner(owner)
        },
        whenReady,
        view,
        setAck(chaId, ack) {
            if (ack) {
                acks.set(chaId, ack)
            } else {
                acks.delete(chaId)
            }
        },
        editField: (owner, path, value) =>
            applyStudioWrite(owner, { kind: 'edit', build: (_id, live) => buildFieldEdit(path, value, live) }),
        greetingAdd: (owner) => applyStudioWrite(owner, { kind: 'edit', build: (_id, live) => buildGreetingAdd(live) }),
        greetingEdit: (owner, index, value) =>
            applyStudioWrite(owner, { kind: 'edit', build: (_id, live) => buildGreetingEdit(index, value, live) }),
        greetingDelete: (owner, index) =>
            applyStudioWrite(owner, {
                kind: 'edit',
                build: (id, live, target) => buildGreetingDelete(index, id, target, live),
            }),
        undo: (owner) => applyStudioWrite(owner, { kind: 'replay', direction: 'undo' }),
        redo: (owner) => applyStudioWrite(owner, { kind: 'replay', direction: 'redo' }),
        revertTo: (owner, stepId) => applyStudioWrite(owner, { kind: 'revert', stepId }),
        restore: (owner, keep) => applyStudioWrite(owner, { kind: 'restore', keep }),
        restoreDeleted: (owner, deletedId) => applyStudioWrite(owner, { kind: 'restoreDeleted', deletedId }),
        closeOpenStep(owner) {
            const slot = slots.get(owner)
            if (slot) {
                slot.open = null
            }
        },
    }
}
