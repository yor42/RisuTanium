// The Studio history service: one slot per owner key and page, each with the lifecycle of
// `ownerPhase.ts`, shared claim and open entries that settle once, one marked write path
// (`applyStudioWrite`) for every history action, and a write-behind mirror to the device store.
// Memory is the authority once an owner is `ready`; the store is only ever written in `ready`.

import { getSaveMarkCount } from '../../globalApi.svelte'
import { writeLiveCharacter, writeLiveChat } from '../../liveCharacterWrite'
import { registerLeaveFlush as registerPageLeaveFlush } from '../../process/saveOnHide'
import { studioScreen } from '../studioScreen.svelte'
import type { AssetFileReader, AssetFileState } from '../assets/assetFileState'
import { ASSET_FOLDER_KEY, ASSET_RETAINED_KEY } from '../assets/assetOwnerKeys'
import { applyFolderOps, type FolderRefusal } from '../assets/folderCodec'
import type { AssetArrayName, MergePreview } from '../assets/mergePreview'
import {
    buildAssetDelete,
    buildAssetInsert,
    buildAssetMerge,
    buildAssetRemoveExtras,
    buildAssetRename,
    buildFolderIntent,
    folderOpsOf,
    readRetainedPairs,
    recomputeRetained,
    removesAssetRow,
    touchesAssets,
    type AssetBuildResult,
    type FolderIntent,
    type SurvivorDeps,
} from '../edit/assetSetters'
import { buildGreetingAppendMany, buildGreetingMove, buildGreetingSwap } from '../edit/greetingListOps'
import {
    applyCharacterWrites,
    applyChatWrites,
    buildFieldEdit,
    buildGreetingAdd,
    buildGreetingDelete,
    buildGreetingEdit,
    buildWrittenModule,
    createLiveReader,
    createModuleLiveReader,
    isModuleTarget,
    isRestrictedChaId,
    resolveLiveTarget,
    restoreContextOf,
    writeLiveModule,
    type AssetWriteExtras,
    type EditBuildResult,
    type LiveTarget,
    type ModuleSlotReplaced,
    type SetterRefusal,
} from '../edit/studioSetters'
import type { SaveAck } from '../edit/saveAck.svelte'
import { createElementHashCache, WARM_CHUNK_MS, WARM_MAX_YIELDS, WARM_MS_PER_ELEMENT, WARM_MS_PER_UNIT, type ElementHashCache, type IdleScheduler } from './elementHashCache'
export { browserIdleScheduler } from './elementHashCache'
import type { ListElementHash } from './listFingerprint'
import {
    applyReplayMove,
    assetPathsReplayMayInsert,
    assetStepWrites,
    isStoredAssetPath,
    commitStep,
    createPageSession,
    deriveRestoreWrites,
    emptyRecord,
    invertOp,
    isOpAllowedFor,
    planReplay,
    planRestoreDeleted,
    planRestorePoint,
    planRevert,
    stepIdFor,
    textBeforeOf,
    textPathsFor,
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
    type Op,
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
import { nameOfPathIn, stepNamesAssetPath, stepsOf } from './retainedPaths'
import type {
    ClaimResult,
    LoadResult,
    OpenResult,
    SaveResult,
    StudioClaimPort,
    StudioHistoryStore,
} from './studioHistoryStore'

// The asset refusals: a removal-type write needs a working undo, and these are the states that cannot give one. A
// replay that would put a row back is refused too when the file's state could not be confirmed.
export type AssetRefusal = 'asset-no-undo' | 'asset-other-tab-character' | 'asset-other-tab-module' | 'asset-file-unchecked'

// How long a replay may spend asking whether the files it would put back are there, counted from the call. A toast's
// Undo is given up by its host after 10 s, so a queued replay must reach its answer well before that.
export const REPLAY_BUDGET_MS = 8000

export type StudioRefusal = 'loading' | SetterRefusal | AssetRefusal | 'empty' | 'unknown' | 'pairSplit'

// What a landed action tells the caller. `unchanged` means the value already was the requested one:
// nothing was written, marked or recorded.
export interface StudioWriteNotes {
    unchanged?: boolean
    // A chat-side effect could not be replayed because the chat has no unique id.
    fmNotRestored?: boolean
    // Ops of the replayed step that were skipped because the live value had moved on.
    skipped?: number
    // Replay only: every change was already in the state the replay would produce, so nothing was written
    // and the step moved to the other list. Excludes `dropped` and `unchanged`.
    already?: 'undo' | 'redo'
    // Replay only: the step can no longer be replayed here and was removed from its list.
    dropped?: true
    // Revert only: asset rows whose file is gone and that were not re-inserted.
    goneRows?: string[]
    // The name the first of `goneRows` went by in the replayed steps, for the line shown to the user. Set with `goneRows`,
    // also on an `unchanged` revert.
    goneName?: string
    // Revert only: list ops that were not undone because their step's list no longer fit. Also set on
    // an `unchanged` revert, which lands nothing.
    listSkipped?: number
    // Revert only: steps left whole because they changed the first message together with the alternate first
    // messages and one of the two no longer fit. Also set on an `unchanged` revert.
    pairSkipped?: number
    // Restore point only: the paths whose live value was changed outside Studio's history.
    changedElsewhere?: RestorePath[]
    // An asset intent that landed: the id of the step it recorded.
    stepId?: string
    // Replay of a step that holds a `textEdit`, or asset rows together with a text op: the registry targets of its texts
    // that were left as they were because the live text no longer holds the expected name at the recorded span
    // (`firstMessage`, `desc`, `exampleMessage`, `alternateGreetings/<i>`, `lore/<i>/content`, ...), unique and in the
    // step's order. Absent for every other step and when nothing was left. In memory only: never stored or posted.
    notRestored?: string[]
}

// `name` is the row a refusal is about (`asset-file-unchecked`). `targetChanged` says the steps the replay was asked for
// are no longer the ones on top while it waited for its answers, so nothing was applied. `folderRefusal` says which folder
// rule an explicit folder action broke; the refusal is `precondition` either way.
export type StudioResult = ({ ok: true } & StudioWriteNotes) | { ok: false; reason: StudioRefusal; name?: string; targetChanged?: true; folderRefusal?: FolderRefusal }

// What a replay is asked to do. `expectTop` makes an undo or a redo apply only while that step is still the one it
// would replay.
export type ReplayDesc = { kind: 'undo' | 'redo'; expectTop?: string } | { kind: 'revert'; stepId: string }

// Wraps the replay's synchronous apply. It must call `apply` exactly once, synchronously, and return its result.
export type ReplayAround = (apply: () => StudioResult) => StudioResult

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
    elementHashCache?: ElementHashCache
    scheduleIdle?: IdleScheduler
    // The id of the module whose asset panel is open, or null. A module owner is selected only while this returns its
    // id; the module panel supplies it. Default: no module is open.
    openModuleId?: () => string | null
    // Called after every landed action of any kind (edit, undo, redo, revert, restore point, restore of a deleted
    // item, and a step that only moved or was dropped) with the id of the step now on top of `done`, or null.
    onLanded?: (owner: OwnerKey, topStepId: string | null) => void
    // Opens the reader of file states that `replay` asks before it puts an asset row back. Present: a row is put back
    // only over a file read as present, a gone file's row is left out, and anything else refuses (a synchronous
    // undo, redo or revert never has an answer, so it refuses every insert). Absent: nothing is checked (suites that
    // do not test files). A rejection is an unanswered question.
    openAssetFileReader?: () => Promise<AssetFileReader>
    // Called after a module's slot is replaced by a Studio write: the production port resets the `getModules` memo and
    // tells module screens, as the module loader does. Default: nothing (a service with no module reads).
    onModuleSlotReplaced?: ModuleSlotReplaced
}

export interface OwnerHistoryService {
    // First use of an owner (idempotent): starts its lifecycle, which ends in `ready`, `memoryOnly`
    // or `excluded`. Later calls change nothing.
    useOwner(owner: OwnerKey): void
    // Resolves when the owner is `ready`, `memoryOnly` or `excluded`; the first use is implied.
    whenReady(owner: OwnerKey): Promise<void>
    view(owner: OwnerKey): OwnerView
    setAck(chaId: string, ack: OwnerAck | null): void
    // The ack told of a landed write to module `moduleId`, kept apart from the character acks (which are keyed by chaId).
    setModuleAck(moduleId: string, ack: OwnerAck | null): void
    editField(owner: OwnerKey, path: SetPath, value: string | boolean): StudioResult
    // A whole-value text edit. `typing` coalesces with the previous typing step of the same path; `single` is always its own step.
    editText(owner: OwnerKey, path: SetPath, value: string, mode?: 'typing' | 'single'): StudioResult
    greetingAdd(owner: OwnerKey): StudioResult
    greetingEdit(owner: OwnerKey, index: number, value: string): StudioResult
    greetingDelete(owner: OwnerKey, index: number): StudioResult
    // Moves entry `from` to `to` (post-removal index); the context chat keeps showing the same text.
    greetingMove(owner: OwnerKey, from: number, to: number): StudioResult
    // Exchanges entry `index` with the default first message; the context chat keeps showing the same text.
    greetingSwapWithMain(owner: OwnerKey, index: number): StudioResult
    // Appends the values at the end of the list as one step.
    greetingAppendMany(owner: OwnerKey, values: readonly string[]): StudioResult
    // Synchronous replays. With a file reader configured they refuse every row they would put back, because they have
    // no answers: callers use `replay`.
    undo(owner: OwnerKey): StudioResult
    redo(owner: OwnerKey): StudioResult
    revertTo(owner: OwnerKey, stepId: string): StudioResult
    // The undo, redo or revert every entry point uses. Calls run one at a time in call order (text-only ones too). Where
    // the replay would put asset rows back, the files are asked for first, within `REPLAY_BUDGET_MS` of the call; the
    // target is read when the job starts and checked again after the answers, and the apply (inside `around`, if given)
    // is one synchronous segment. A job that throws rejects its own promise only; the next job still runs.
    replay(owner: OwnerKey, desc: ReplayDesc, around?: ReplayAround): Promise<StudioResult>
    restore(owner: OwnerKey, keep: ReadonlySet<RestorePath>): StudioResult
    restoreDeleted(owner: OwnerKey, deletedId: string): StudioResult
    // The asset intents of a character or module owner. Each is one step, one owner write and one save request; a
    // removal-type one is refused when history cannot persist, and a refusal changes nothing.
    assetDelete(owner: OwnerKey, array: AssetArrayName, indexes: readonly number[]): StudioResult
    assetRemoveExtras(owner: OwnerKey, array: AssetArrayName, name: string, indexes: readonly number[], survivors: SurvivorDeps): StudioResult
    assetMerge(owner: OwnerKey, model: MergePreview, survivors: SurvivorDeps): StudioResult
    assetRename(owner: OwnerKey, array: AssetArrayName, index: number, newName: string): StudioResult
    // The step is always labelled as an addition with its row count.
    assetInsert(owner: OwnerKey, array: AssetArrayName, tuples: readonly (readonly string[])[]): StudioResult
    assetFolder(owner: OwnerKey, intent: FolderIntent): StudioResult
    // Blur or a visit close: the next write starts a new step.
    closeOpenStep(owner: OwnerKey): void
    // Test seam; no production reader: how many asset steps this owner holds as unsettled retention roots.
    unsettledStepCountForTests(owner: OwnerKey): number
    // Input in Studio that is not a history write: the pending warm-up ends, as at a write, and nothing
    // restarts it.
    cancelWarm(): void
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
    // The record the store last acknowledged (`ok`, or what a load returned): its asset steps are retention roots
    // even after memory has dropped them.
    acked: OwnerRecord = emptyRecord('character:_', 0)
    // The asset steps handed to a save that has not been acknowledged since: such a save may have stored them.
    readonly unsettled = new Set<Step>()
    open: OpenStep | null = null
    deadline: unknown = null
    debounce: unknown = null
    maxWait: unknown = null
    // A save job is queued and has not started; at most one exists per owner.
    jobWaiting = false
    tail: Promise<void> = Promise.resolve()
    waiters: (() => void)[] = []

    // `chaId` is null for a module owner. The claim key names what is claimed: `c:<chaId>` for the
    // character and chat owners of a character, `m:<id>` for a module, so the two never share an entry.
    constructor(
        readonly key: OwnerKey,
        readonly chaId: string | null,
        readonly claimKey: string,
        readonly claimSubject: { kind: 'character' | 'module'; id: string },
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
    // `coalesce: false` is the `single` mode: the step never merges with a neighbouring typing step.
    | { kind: 'text'; path: SetPath; value: string; coalesce: boolean }
    | { kind: 'replay'; direction: 'undo' | 'redo' }
    | { kind: 'revert'; stepId: string }
    | { kind: 'restore'; keep: ReadonlySet<RestorePath> }
    | { kind: 'restoreDeleted'; deletedId: string }
    | { kind: 'asset'; build: (live: LiveReader) => AssetBuildResult }

export function createOwnerHistoryService(deps: OwnerHistoryDeps): OwnerHistoryService {
    const { store, claim, clock } = deps
    const tauri = deps.tauri ?? false
    const getMarkCount = deps.getMarkCount ?? getSaveMarkCount
    const getVisitId = deps.getVisitId ?? (() => studioScreen.visitId)
    const pageSession = deps.pageSession ?? createPageSession((bytes) => crypto.getRandomValues(bytes))
    const openModuleId = deps.openModuleId ?? (() => null)
    let counter = 0
    // The file states one replay read, set only while that replay's synchronous apply runs and cleared when it ends.
    let answers: Map<string, AssetFileState> | null = null

    const slots = new Map<OwnerKey, OwnerSlot>()
    const claims = new Map<string, Entry<ClaimResult>>()
    const acks = new Map<string, OwnerAck>()
    const moduleAcks = new Map<string, OwnerAck>()
    let openEntry: Entry<OpenResult> | null = null
    // Read by `view`, so a view taken before an owner's first use updates when the owner appears.
    let slotCount = $state(0)
    const elementHashes = deps.elementHashCache ?? createElementHashCache()
    // The only route to the cache: the warm-up and every action hash a character's first messages
    // under that character's id, so both see the same scope.
    function listHashOf(chaId: string): ListElementHash {
        return (list) => elementHashes.forList(list, chaId)
    }
    let warmJob: { owner: OwnerKey; chaId: string; cancel: () => void } | null = null

    // A pending warm-up ends at any write, at Studio input and at the end of its owner's visit; only a later visit
    // starts another.
    function cancelWarm(): void {
        warmJob?.cancel()
        warmJob = null
    }

    function startWarm(owner: OwnerKey): void {
        const schedule = deps.scheduleIdle
        const parsed = parseOwnerKey(owner)
        if (!schedule || !parsed || parsed.kind !== 'character') {
            return
        }
        if (warmJob && warmJob.owner === owner) {
            return
        }
        cancelWarm()
        const resolved = resolveLiveTarget(owner)
        if (resolved.ok === false) {
            return
        }
        const greetings = createLiveReader(resolved.target).greetings()
        if (!greetings) {
            return
        }
        const pending = greetings.filter((value): value is string => typeof value === 'string')
        // The job is one pass over the snapshot; any other pass comes with a write, which ends the job.
        const warmHash = listHashOf(parsed.chaId)(pending)
        let index = 0
        let yields = 0
        const job = { owner, chaId: parsed.chaId, cancel: () => {} }
        const run = (remainingMs: () => number): void => {
            // One chunk spends at most WARM_CHUNK_MS, by the clock and by the estimate: `kept` is the
            // part of the idle period the chunk leaves alone, `planned` the estimate it has used.
            const start = remainingMs()
            const kept = start - Math.min(start, WARM_CHUNK_MS)
            let planned = 0
            let first = true
            while (index < pending.length) {
                const text = pending[index]
                const estimate = text.length * WARM_MS_PER_UNIT + WARM_MS_PER_ELEMENT
                if (estimate > Math.min(remainingMs() - kept, WARM_CHUNK_MS - planned)) {
                    if (!first) {
                        break
                    }
                    yields += 1
                    if (yields <= WARM_MAX_YIELDS) {
                        break
                    }
                    index += 1
                    yields = 0
                    continue
                }
                warmHash(text)
                planned += estimate
                index += 1
                yields = 0
                first = false
            }
            if (index < pending.length && warmJob === job) {
                job.cancel = schedule(run)
            } else if (warmJob === job) {
                warmJob = null
            }
        }
        warmJob = job
        job.cancel = schedule(run)
    }

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
        const known = claims.get(slot.claimKey)
        if (known) {
            return known
        }
        const entry = createEntry<ClaimResult>(slot.key, clock)
        claims.set(slot.claimKey, entry)
        try {
            claim.tryClaim(slot.claimSubject).then(
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
            const entry = claims.get(slot.claimKey)
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
                // Nothing is stored, so nothing stored names a step.
                slot.acked = emptyRecord(slot.key, clock.now())
                deliver(slot, { type: 'load:absent' })
                break
            case 'ok':
                slot.record = result.record
                // The loaded record is what the store holds: its steps are roots until a later `ok` replaces it.
                slot.acked = result.record
                deliver(slot, { type: 'load:ok' })
                break
            case 'unreadable':
                // The unreadable bytes are copied aside, and the next save replaces them.
                slot.acked = emptyRecord(slot.key, clock.now())
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
            slot =
                parsed.kind === 'module'
                    ? new OwnerSlot(owner, null, 'm:' + parsed.moduleId, { kind: 'module', id: parsed.moduleId })
                    : new OwnerSlot(owner, parsed.chaId, 'c:' + parsed.chaId, { kind: 'character', id: parsed.chaId })
            slot.record = emptyRecord(owner, clock.now())
            slot.acked = slot.record
            slots.set(owner, slot)
            slotCount += 1
            deliver(slot, { type: 'firstUse', restricted: parsed.kind !== 'module' && isRestrictedChaId(parsed.chaId) })
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
        if (slot.chaId !== null && isRestrictedChaId(slot.chaId)) {
            return
        }
        // Records are replaced, never mutated, and one owner's saves run one at a time: `saved` is what an `ok`
        // committed. A step a save may have stored stays a retention root until a later `ok` replaces it, whatever
        // this save answers: a reply can be lost or turned into `unwritable` after the commit.
        const saved = slot.record
        for (const step of [...saved.done, ...saved.undone]) {
            if (stepNamesAssetPath(step)) {
                slot.unsettled.add(step)
            }
        }
        let result: SaveResult
        try {
            result = await store.save(slot.key, saved, new Set<OwnerKey>([slot.key]))
        } catch {
            result = { kind: 'unwritable' }
        }
        if (result.kind === 'ok') {
            slot.acked = saved
            slot.unsettled.clear()
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
        pageFm: number | null
        // The plan changes no live value: the owner is neither written nor marked.
        noWrite?: true
        // A step that only moves because its change is already in place: its forward ops still get the removal
        // check, conservatively, so a removal-type step is not moved where it could not be written.
        forwardOps?: readonly Op[]
        // Applies the landed action to the owner's model state.
        land(state: ModelState): ModelState
        notes: StudioWriteNotes
    }

    // The steps a replay or a revert would replay, and the direction their ops are applied in: an undo and a revert
    // undo, a redo redoes. Null for every other intent.
    function replayedSteps(slot: OwnerSlot, intent: Intent): { steps: readonly Step[]; direction: 'undo' | 'redo' } | null {
        if (intent.kind === 'replay') {
            const top = (intent.direction === 'undo' ? slot.record.done : slot.record.undone).at(-1)
            return { steps: top ? [top] : [], direction: intent.direction }
        }
        if (intent.kind === 'revert') {
            const index = slot.record.done.findIndex((step) => step.id === intent.stepId)
            return { steps: index < 0 ? [] : slot.record.done.slice(index + 1), direction: 'undo' }
        }
        return null
    }

    // The paths a replay may put a row over that this replay's answers read as gone.
    function goneRowsFor(slot: OwnerSlot, intent: Intent): ReadonlySet<string> | undefined {
        const replayed = deps.openAssetFileReader && answers ? replayedSteps(slot, intent) : null
        if (!replayed || !answers) {
            return undefined
        }
        const gone = new Set<string>()
        for (const path of assetPathsReplayMayInsert(replayed.steps, replayed.direction)) {
            if (answers.get(path) === 'gone') {
                gone.add(path)
            }
        }
        return gone.size > 0 ? gone : undefined
    }

    // The name `rows[0]` went by in the replayed steps, or undefined when no row is gone.
    function goneNameOf(slot: OwnerSlot, intent: Intent, rows: readonly string[] | undefined): string | undefined {
        return rows === undefined || rows.length === 0 ? undefined : nameOfPathIn(replayedSteps(slot, intent)?.steps ?? [], rows[0])
    }

    // The first path (sorted) the writes would put a row over without this replay having read its file as present. A
    // replay that was not asked has no answers, so every such path is unconfirmed.
    function unconfirmedInsert(writes: readonly WriteOp[]): string | null {
        const paths = new Set<string>()
        for (const write of writes) {
            if (write.op === 'assetRowInsert') {
                paths.add(typeof write.tuple[1] === 'string' ? write.tuple[1] : '')
            } else if (write.op === 'assetRowSet' && write.after[1] !== write.before[1]) {
                paths.add(typeof write.after[1] === 'string' ? write.after[1] : '')
            }
        }
        for (const path of [...paths].sort()) {
            if (isStoredAssetPath(path) && answers?.get(path) !== 'present') {
                return path
            }
        }
        return null
    }

    function planFor(slot: OwnerSlot, intent: Intent, live: LiveReader, target: LiveTarget | null, at: number, goneRows?: ReadonlySet<string>): Planned | StudioResult {
        const visitId = getVisitId()
        const record = slot.record
        // A module owner has no greeting list, so no element hashes.
        const hashFor = slot.chaId === null ? undefined : listHashOf(slot.chaId)
        if (intent.kind === 'asset') {
            // Asset intents belong to a character or a module owner, never to one of a character's chats.
            const assetOwnerKind = parseOwnerKey(slot.key)?.kind
            if (assetOwnerKind === undefined || assetOwnerKind === 'chat') {
                return refused('unknown')
            }
            const built = intent.build(live)
            if (built.ok === false) {
                if (built.reason === 'unchanged') {
                    return { ok: true, unchanged: true }
                }
                return built.folderRefusal === undefined ? refused('precondition') : { ok: false, reason: 'precondition', folderRefusal: built.folderRefusal }
            }
            // Rule K, as for an edit or a text intent: an op the owner's own record would refuse on reading (a merge step
            // carries `set` and `listSet`, which a module record does not hold) is never written, marked or recorded.
            if (!built.ops.every((op) => isOpAllowedFor(assetOwnerKind, op))) {
                return refused('precondition')
            }
            // Every text edit must apply to the live owner as it is now: a stale or unreadable one refuses the
            // intent before anything is written.
            const assetWrites = assetStepWrites(built.ops, live)
            if (assetWrites === null) {
                return refused('precondition')
            }
            const id = stepIdFor(pageSession, ++counter)
            const greetings = live.greetings()
            const restoreWrites = deriveRestoreWrites(
                built.ops,
                greetings === null ? null : [...greetings],
                textBeforeOf((path) => live.field(path)),
            )
            return {
                writes: assetWrites,
                pageFm: null,
                notes: {},
                // An asset step never joins an open step and never replaces the restore point, as a revert does not.
                land: (state) =>
                    commitStep(state, {
                        id,
                        at,
                        visitId,
                        label: built.label,
                        ops: built.ops,
                        restoreWrites,
                        coalesceKey: null,
                        replacesRestore: false,
                    }, hashFor),
            }
        }
        if (intent.kind === 'edit' || intent.kind === 'text') {
            const ownerKind = parseOwnerKey(slot.key)?.kind
            if (ownerKind === undefined) {
                return refused('unknown')
            }
            // A text path the owner kind does not carry (or the boolean field) is refused before any read or write.
            if (intent.kind === 'text' && !textPathsFor(ownerKind).includes(intent.path)) {
                return refused('precondition')
            }
            // A text intent reads only the live reader, so it needs no character target: a module owner has none and
            // still carries `customModuleToggle`. Every edit intent is refused without a character target.
            if (intent.kind === 'edit' && target === null) {
                return refused('gone')
            }
            const id = stepIdFor(pageSession, ++counter)
            let built: EditBuildResult
            if (intent.kind === 'text') {
                built = buildFieldEdit(intent.path, intent.value, live, intent.coalesce)
            } else if (target === null) {
                // Unreachable: an edit intent without a target was refused above.
                built = { ok: false, reason: 'precondition' }
            } else {
                built = intent.build(id, live, target)
            }
            if (built.ok === false) {
                return built.reason === 'unchanged' ? { ok: true, unchanged: true } : refused('precondition')
            }
            // Rule K: an op the owner's own record would refuse on reading is never written, marked or recorded.
            if (!built.ops.every((op) => isOpAllowedFor(ownerKind, op))) {
                return refused('precondition')
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
                    }, hashFor),
            }
        }
        if (intent.kind === 'replay') {
            const plan = planReplay(record, intent.direction, live, hashFor, goneRows)
            if (plan.ok === false) {
                return refused(plan.reason === 'empty' || plan.reason === 'pairSplit' ? plan.reason : 'precondition')
            }
            return {
                writes: plan.writes,
                pageFm: null,
                ...(plan.already !== undefined || plan.dropStep ? { noWrite: true as const } : {}),
                ...(plan.already !== undefined ? { forwardOps: intent.direction === 'undo' ? plan.ops.map(invertOp) : plan.ops } : {}),
                notes: replayNotes(plan, goneNameOf(slot, intent, plan.goneRows)),
                land: (state) => applyReplayMove(state, intent.direction, plan, at, visitId, hashFor),
            }
        }
        const plan =
            intent.kind === 'revert'
                ? planRevert(record, intent.stepId, live, undefined, hashFor, goneRows)
                : intent.kind === 'restore'
                  ? planRestorePoint(record.restore, live, intent.keep)
                  : planRestoreDeleted(record, intent.deletedId, live, target === null ? null : restoreContextOf(target))
        if (plan.ok === false) {
            // A net-nothing revert lands nothing: no write, mark, step or save. It may still tell the
            // caller that older list changes were not undone or that a chat index could not be restored.
            if (plan.reason === 'unchanged') {
                const goneName = goneNameOf(slot, intent, plan.goneRows)
                return {
                    ok: true,
                    unchanged: true,
                    ...(plan.listSkipped === undefined ? {} : { listSkipped: plan.listSkipped }),
                    ...(plan.pairSkipped === undefined ? {} : { pairSkipped: plan.pairSkipped }),
                    ...(plan.fmNotRestored ? { fmNotRestored: true } : {}),
                    ...(plan.goneRows === undefined ? {} : { goneRows: plan.goneRows }),
                    ...(goneName === undefined ? {} : { goneName }),
                }
            }
            return refused(plan.reason)
        }
        const id = stepIdFor(pageSession, ++counter)
        const notes = replayNotes(plan, goneNameOf(slot, intent, plan.goneRows))
        if (isRestorePlan(plan)) {
            notes.changedElsewhere = plan.changedElsewhere
        }
        return {
            writes: plan.writes,
            pageFm: plan.pageFm ?? null,
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
                }, hashFor),
        }
    }

    function replayNotes(plan: StepPlan, goneName: string | undefined): StudioWriteNotes {
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
        if (plan.pairSkipped !== undefined && plan.pairSkipped > 0) {
            notes.pairSkipped = plan.pairSkipped
        }
        if (plan.already !== undefined) {
            notes.already = plan.already
        }
        if (plan.dropStep) {
            notes.dropped = true
        }
        if (plan.goneRows !== undefined) {
            notes.goneRows = plan.goneRows
        }
        if (goneName !== undefined) {
            notes.goneName = goneName
        }
        // The plan names skipped texts only for a step that holds a `textEdit`, or rows together with a text op, whatever
        // its label: the notice that lists them belongs to a merge's replay, to the replay of a revert that crossed one,
        // and to any other step that holds rows and a text.
        if (plan.notRestored !== undefined) {
            notes.notRestored = [...plan.notRestored]
        }
        return notes
    }

    // Every history action is one call of this: phase check, the setter guards, the plan, one marked `writeLive*` call,
    // then the record assignment, the save request (in `ready`) and, last, the notifications: the module slot port, the
    // visit ack and the landed callback. Nothing runs between the record assignment and the save request, and no
    // notification runs inside the live write, so a notification that throws never leaves a landed step without its save.
    function applyStudioWrite(owner: OwnerKey, intent: Intent): StudioResult {
        cancelWarm()
        // A module owner that is not selected, shares its id or is a stub is refused before its lifecycle starts, so
        // no claim, load or save is made for it.
        if (parseOwnerKey(owner)?.kind === 'module') {
            const early = resolveLiveTarget(owner, openModuleId)
            if (early.ok === false) {
                return refused(early.reason)
            }
        }
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
        const resolved = resolveLiveTarget(owner, openModuleId)
        if (resolved.ok === false) {
            return refused(resolved.reason)
        }
        const target = resolved.target
        const at = clock.now()
        const characterTarget = isModuleTarget(target) ? null : target
        const live = isModuleTarget(target) ? createModuleLiveReader(target.module) : createLiveReader(target)
        const planned = planFor(slot, intent, live, characterTarget, at, goneRowsFor(slot, intent))
        if (!('writes' in planned)) {
            return planned
        }
        // A replay puts a row back only over a file this replay read as present; a gone file's row was left out by the
        // plan. The check runs before anything changes, so a refusal leaves record, stacks, field and marks as they were.
        if (deps.openAssetFileReader && (intent.kind === 'replay' || intent.kind === 'revert')) {
            const unconfirmed = unconfirmedInsert(planned.writes)
            if (unconfirmed !== null) {
                return { ok: false, reason: 'asset-file-unchecked', name: nameOfPathIn(replayedSteps(slot, intent)?.steps ?? [], unconfirmed) }
            }
        }
        const chaId = slot.chaId
        if (planned.noWrite) {
            if (planned.forwardOps && removesAssetRow(planned.forwardOps)) {
                const stored = isModuleTarget(target) ? target.module[ASSET_RETAINED_KEY] : target.character[ASSET_RETAINED_KEY]
                const refusal = removalRefusal(phase, stored, isModuleTarget(target))
                if (refusal) {
                    return refused(refusal)
                }
            }
            // A step that is already in place, or dropped: no live write, mark, ack or recompute. The stack
            // move still lands and is saved; the save is requested before the landed callback runs.
            const moved = planned.land({ record: slot.record, open: slot.open })
            slot.record = moved.record
            slot.open = moved.open
            if (phase.kind === 'ready') {
                requestSave(slot)
            }
            landedNotice(owner, slot)
            return { ok: true, ...planned.notes }
        }
        // The asset path: every write that changes an asset list or a folder entry carries the retained paths.
        const assetWrite = touchesAssets(planned.writes)
        const removal = removesAssetRow(planned.writes)
        let extras: AssetWriteExtras | null = null
        if (assetWrite) {
            // A removal-type write needs an undo that survives: refused before anything changes, and the open
            // step stays open.
            const stored = isModuleTarget(target) ? target.module[ASSET_RETAINED_KEY] : target.character[ASSET_RETAINED_KEY]
            const refusal = removal ? removalRefusal(phase, stored, isModuleTarget(target)) : null
            if (refusal) {
                return refused(refusal)
            }
            // The folder document is computed from the value stored now, before any write: a failed precondition
            // refuses the whole intent.
            let folder: AssetWriteExtras['folder'] = { kind: 'keep' }
            const folderOps = folderOpsOf(planned.writes)
            if (folderOps.length > 0) {
                const storedFolder = isModuleTarget(target) ? target.module[ASSET_FOLDER_KEY] : target.character.extentions?.[ASSET_FOLDER_KEY]
                const applied = applyFolderOps(storedFolder, folderOps)
                if (applied.ok === false) {
                    return refused('precondition')
                }
                folder = applied.doc === null ? { kind: 'remove' } : { kind: 'set', doc: applied.doc }
            }
            extras = { folder, retained: null }
        }
        if (intent.kind === 'asset') {
            // An asset intent never joins an open step.
            slot.open = null
        }
        const next = planned.land({ record: slot.record, open: slot.open })
        if (extras) {
            const kind = phase.kind === 'ready' ? 'ready' : 'memoryOnly'
            // `ready` keeps exactly what memory, the acknowledged save and the unsettled saves name; `memoryOnly`
            // adds to what the field holds and never drops.
            const roots = stepsOf(next.record, ...(kind === 'ready' ? [slot.acked] : []))
            if (kind === 'ready') {
                for (const step of slot.unsettled) {
                    roots.add(step)
                }
            }
            extras.retained = (existing) => recomputeRetained(existing, kind, roots)
        }
        const before = getMarkCount()
        let landed: boolean
        if (isModuleTarget(target)) {
            const moduleExtras = extras ?? { folder: { kind: 'keep' as const }, retained: null }
            // No port is passed: it is told below, after the save is armed, and never from inside the write.
            landed = writeLiveModule(slot.claimSubject.id, (module) => buildWrittenModule(module, planned.writes, moduleExtras))
        } else if (chaId === null) {
            landed = false
        } else if (target.chat) {
            landed = writeLiveChat(chaId, target.chat, (liveChat) => {
                applyChatWrites(liveChat, planned.writes)
                return true
            })
        } else {
            const writeExtras = extras ?? undefined
            landed = writeLiveCharacter(chaId, (liveCharacter) => applyCharacterWrites(liveCharacter, planned.writes, planned.pageFm, writeExtras))
        }
        if (!landed) {
            return refused('gone')
        }
        slot.record = next.record
        slot.open = next.open
        if (phase.kind === 'ready') {
            // A removal-type write saves at once; any other waits for the debounce.
            if (assetWrite && removal) {
                fireSave(slot)
            } else {
                requestSave(slot)
            }
        }
        // The notifications follow the armed save, in this order, and none is isolated: a throw reaches the caller and
        // skips the ones after it, while the step and its save stand. The port resets the module memo before it tells
        // module screens, and runs once per landed module write, before this returns.
        if (isModuleTarget(target)) {
            deps.onModuleSlotReplaced?.()
        }
        if (chaId !== null) {
            acks.get(chaId)?.noteEdit(chaId, before)
        } else if (isModuleTarget(target)) {
            // `before` was read ahead of the write; the module's own ack reads the count again and finds its mark counted.
            moduleAcks.get(slot.claimSubject.id)?.noteEdit(slot.claimSubject.id, before)
        }
        landedNotice(owner, slot)
        return { ok: true, ...planned.notes, ...(intent.kind === 'asset' ? { stepId: slot.record.done.at(-1)?.id } : {}) }
    }

    function landedNotice(owner: OwnerKey, slot: OwnerSlot): void {
        deps.onLanded?.(owner, slot.record.done.at(-1)?.id ?? null)
    }

    // The states in which a removal-type write cannot be undone later; `memoryOnly` and an unwritable store keep no
    // history, and an unreadable retained field cannot be extended without losing what it holds.
    function removalRefusal(phase: OwnerPhase, retained: unknown, moduleOwner: boolean): AssetRefusal | null {
        if (phase.kind === 'memoryOnly') {
            if (phase.reason === 'otherTab') {
                return moduleOwner ? 'asset-other-tab-module' : 'asset-other-tab-character'
            }
            return 'asset-no-undo'
        }
        if (phase.kind === 'ready' && phase.reason === 'unwritable') {
            return 'asset-no-undo'
        }
        // The caller passes the field's value: `undefined` is an absent key, because no writer stores `undefined`.
        if (retained !== undefined && readRetainedPairs(retained) === null) {
            return 'asset-no-undo'
        }
        return null
    }

    // ---------------------------------------------------------------- replay

    // The one tail every replay runs on: a job starts when the one before it has ended, whatever it ended with.
    let replayTail: Promise<void> = Promise.resolve()

    // What a replay targets, as ids: the top of the list it replays, or the target step and every step above it. Null
    // when there is no such slot or step.
    function replayTargetIds(slot: OwnerSlot | undefined, desc: ReplayDesc): string[] | null {
        if (!slot) {
            return null
        }
        if (desc.kind === 'revert') {
            const index = slot.record.done.findIndex((step) => step.id === desc.stepId)
            return index < 0 ? null : slot.record.done.slice(index).map((step) => step.id)
        }
        const top = (desc.kind === 'undo' ? slot.record.done : slot.record.undone).at(-1)
        return top ? [top.id] : []
    }

    function sameIds(a: readonly string[] | null, b: readonly string[] | null): boolean {
        return a === null || b === null ? a === b : a.length === b.length && a.every((id, index) => id === b[index])
    }

    // Asks for the state of each path, `reader.concurrency` at a time, and records each answer as it arrives. Once
    // `cancelled` says so, no further path is asked and a late answer is dropped.
    async function readStates(reader: AssetFileReader, paths: readonly string[], states: Map<string, AssetFileState>, cancelled: () => boolean): Promise<void> {
        let next = 0
        const worker = async (): Promise<void> => {
            while (next < paths.length && !cancelled()) {
                const path = paths[next++]
                let state: AssetFileState
                try {
                    state = await reader.stateOf(path)
                } catch {
                    state = 'unknown'
                }
                if (cancelled()) {
                    return
                }
                states.set(path, state)
            }
        }
        await Promise.all(Array.from({ length: Math.max(1, reader.concurrency) }, () => worker()))
    }

    // The synchronous end of a replay: `answers` hold the file states for exactly this apply.
    function applyReplay(owner: OwnerKey, intent: Intent, around: ReplayAround | undefined, read: Map<string, AssetFileState> | null): StudioResult {
        answers = read
        try {
            const apply = (): StudioResult => applyStudioWrite(owner, intent)
            return around ? around(apply) : apply()
        } finally {
            answers = null
        }
    }

    async function runReplay(owner: OwnerKey, desc: ReplayDesc, around: ReplayAround | undefined, deadline: number): Promise<StudioResult> {
        const intent: Intent = desc.kind === 'revert' ? { kind: 'revert', stepId: desc.stepId } : { kind: 'replay', direction: desc.kind }
        // The target is read now, when this job's turn comes, not when it was asked for.
        const slot = slots.get(owner)
        const ids = replayTargetIds(slot, desc)
        if (desc.kind !== 'revert' && desc.expectTop !== undefined && ids?.[0] !== desc.expectTop) {
            return { ok: false, reason: 'precondition', targetChanged: true }
        }
        const replayed = slot ? replayedSteps(slot, intent) : null
        const paths = replayed ? assetPathsReplayMayInsert(replayed.steps, replayed.direction) : []
        const openReader = deps.openAssetFileReader
        if (!openReader || paths.length === 0) {
            return applyReplay(owner, intent, around, null)
        }
        const nameOf = (path: string): string => nameOfPathIn(replayed?.steps ?? [], path)
        const states = new Map<string, AssetFileState>()
        let ended = false
        let timer: unknown = null
        const timedOut = new Promise<false>((resolve) => {
            timer = clock.setTimeout(() => resolve(false), Math.max(0, deadline - clock.now()))
        })
        const answered: Promise<boolean> = (async () => {
            await readStates(await openReader(), paths, states, () => ended)
            return true
        })().catch(() => false)
        const completed = await Promise.race([answered, timedOut])
        // The job ends here: a late answer is dropped and the apply is never reached.
        ended = true
        clock.clearTimeout(timer)
        if (!completed) {
            return { ok: false, reason: 'asset-file-unchecked', name: nameOf(paths.find((path) => !states.has(path)) ?? paths[0]) }
        }
        // No await from this check to the end of the apply: nothing else can change the target in between.
        if (!sameIds(ids, replayTargetIds(slots.get(owner), desc))) {
            return { ok: false, reason: 'asset-file-unchecked', name: nameOf(paths[0]), targetChanged: true }
        }
        return applyReplay(owner, intent, around, states)
    }

    function replay(owner: OwnerKey, desc: ReplayDesc, around?: ReplayAround): Promise<StudioResult> {
        const deadline = clock.now() + REPLAY_BUDGET_MS
        const result = replayTail.then(() => runReplay(owner, desc, around, deadline))
        // A failure reaches this caller through `result` and is logged here; the next job still runs.
        replayTail = result.then(
            () => {},
            (error: unknown) => {
                console.error(error)
            },
        )
        return result
    }

    // ---------------------------------------------------------------- views

    function view(owner: OwnerKey): OwnerView {
        void slotCount
        const slot = slots.get(owner)
        const parsed = parseOwnerKey(owner)
        const restricted = parsed !== null && parsed.kind !== 'module' && isRestrictedChaId(parsed.chaId)
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
            startWarm(owner)
        },
        whenReady,
        view,
        setAck(chaId, ack) {
            if (ack) {
                acks.set(chaId, ack)
            } else {
                acks.delete(chaId)
                // The visit of `chaId` ended.
                if (warmJob?.chaId === chaId) {
                    cancelWarm()
                }
            }
        },
        setModuleAck(moduleId, ack) {
            if (ack) {
                moduleAcks.set(moduleId, ack)
            } else {
                moduleAcks.delete(moduleId)
            }
        },
        editField: (owner, path, value) =>
            applyStudioWrite(owner, { kind: 'edit', build: (_id, live) => buildFieldEdit(path, value, live) }),
        editText: (owner, path, value, mode = 'typing') =>
            applyStudioWrite(owner, { kind: 'text', path, value, coalesce: mode === 'typing' }),
        greetingAdd: (owner) => applyStudioWrite(owner, { kind: 'edit', build: (_id, live, target) => buildGreetingAdd(live, target) }),
        greetingMove: (owner, from, to) =>
            applyStudioWrite(owner, { kind: 'edit', build: (_id, live, target) => buildGreetingMove(from, to, target, live) }),
        greetingSwapWithMain: (owner, index) =>
            applyStudioWrite(owner, { kind: 'edit', build: (_id, live, target) => buildGreetingSwap(index, target, live) }),
        greetingAppendMany: (owner, values) =>
            applyStudioWrite(owner, { kind: 'edit', build: (_id, live, target) => buildGreetingAppendMany(values, target, live) }),
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
        replay,
        restore: (owner, keep) => applyStudioWrite(owner, { kind: 'restore', keep }),
        restoreDeleted: (owner, deletedId) => applyStudioWrite(owner, { kind: 'restoreDeleted', deletedId }),
        assetDelete: (owner, array, indexes) => applyStudioWrite(owner, { kind: 'asset', build: (live) => buildAssetDelete(array, indexes, live) }),
        assetRemoveExtras: (owner, array, name, indexes, survivors) =>
            applyStudioWrite(owner, { kind: 'asset', build: (live) => buildAssetRemoveExtras(array, name, indexes, live, survivors) }),
        assetMerge: (owner, model, survivors) => applyStudioWrite(owner, { kind: 'asset', build: (live) => buildAssetMerge(model, live, survivors) }),
        assetRename: (owner, array, index, newName) => applyStudioWrite(owner, { kind: 'asset', build: (live) => buildAssetRename(array, index, newName, live) }),
        assetInsert: (owner, array, tuples) => applyStudioWrite(owner, { kind: 'asset', build: (live) => buildAssetInsert(array, tuples, live) }),
        assetFolder: (owner, intent) => applyStudioWrite(owner, { kind: 'asset', build: (live) => buildFolderIntent(intent, live) }),
        closeOpenStep(owner) {
            const slot = slots.get(owner)
            if (slot) {
                slot.open = null
            }
        },
        unsettledStepCountForTests: (owner) => slots.get(owner)?.unsettled.size ?? 0,
        cancelWarm,
    }
}
