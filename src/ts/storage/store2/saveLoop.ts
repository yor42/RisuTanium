import type { Database, character, groupChat } from '../database.svelte'
import type { toSaveType } from '../risuSave'
import { createYieldBudget, yieldToEventLoop } from '../saveYield'
import { Store2PayloadTooLargeError, Store2StalePageError } from './backend/errors'
import type { Store2Read } from './backend/types'
import { isBusy } from '../../process/memory/busyActions'
import { MEASURE } from '../../process/memory/measureFlag'
import { netHeldNow, noteNetHeldTick, noteNetPassTick } from '../measureExportHold'
import { isModuleStub } from '../moduleStub'
import { isColdStub, SharedChaIdStubError, StubRefusedError } from './codec'
import { namesManifest, type AbandonResult, type CommitResult, type Committer } from './commit'
import { classifyCommitRead } from './commitKey'
import type { CommitKey } from './format'
import type { Store2SaveContext } from './saveActive'
import { createSaveEncoder, type SavePassRequest, type SavePlan } from './saveEncoder'
import {
    noteNetSlotBegin, noteNetSlotEnd, noteNetSlotMs, noteNetSlotPart, noteNetSlotPassMs, noteSignalAck, noteSignalAdopted, noteSignalKept,
    noteSignalPassStart, noteSignalResidents, noteSignalSkipped, noteSignalSlotClock, noteSignalUnchanged, noteSignalVerdict, peekSaveMarks,
} from './savePassMeter'
import { startYieldGaps, type YieldGapRecorder } from './saveYieldMeter'
import { tooLargeLabel } from './tooLargeLabel'

/**
 * The save loop of a store2 session: the loop `saveDb()` runs when a session is active. It keeps the block-profile
 * loop's marks, debounce, hide path and read-only mode, and replaces what a store2 commit makes unnecessary: the held
 * and frozen indicator, the block-era stale-copy prompts and the numbered backups.
 *
 * One pass, under the page's write lock: the marks are snapshotted and trimmed, the commit key is read as the base,
 * the base is judged (a pending attempt is adopted or left, a foreign `current` parks the loop), the pass is planned
 * over the acknowledged encoding, and the plan is committed, or skipped when it changed nothing. A pending attempt is
 * resolved against the base read before the plan is made, and nothing adopts while a plan is in flight: one task owns
 * the encoder.
 *
 * Marks are cleared only by taking the snapshot, never afterwards: a mark set while a pass runs lands in the live
 * tracker and reaches the next pass, and a snapshot that did not commit is folded back.
 */

export type PeerOffer = 'reload' | 'save-mine' | 'export-first'

/** What the person is asked when the page is parked on a commit it did not make. */
export interface PeerParkPrompt {
    reason: 'peer-commit' | 'replaced'
    unsaved: boolean
    /** The default first: it always starts with 'reload'. */
    offers: readonly PeerOffer[]
    /** Why 'save-mine' is not offered, for the wording the screen chooses. */
    saveMineUnavailable?: 'node' | 'replaced' | 'carries'
    /** Present after a Save mine was refused in this park: the items it could not carry, named when the plan knew their names. */
    blocked?: { names: readonly string[], count: number }
    /**
     * How this park's one automatic export of the tab ended, for the wording: 'saved' means the file was handed to the
     * browser, 'not-finished' means it was declined, failed, threw or was skipped. Absent when none ran.
     */
    autoExport?: 'saved' | 'not-finished'
}

/** What a clean prompt reads when its Reload is pressed: the loop's live state, never a copy taken when it was asked. */
export interface PeerLiveState {
    /** The page is still parked; once the loop unparks, the prompt's Reload does nothing. */
    parked: boolean
    /** Edits that no commit has taken: the unsaved question belongs to the loop's `decide`. */
    dirty: boolean
    /** Typed text outside the database (composer, an open edit): a reload discards it. */
    drafts: boolean
}

/**
 * What the loop made of a Reload press on a clean prompt. `clean`: every resident character matches the acknowledged
 * encoding. `dirty`: a character differs or could not be judged in time; the page is marked unsaved and the loop asks
 * the unsaved question. `moved`: the page is no longer parked.
 */
export type ParkCheck = 'clean' | 'dirty' | 'moved'

/** The longest the loop spends judging the residents for a Reload press; an unfinished judgement counts as dirty. */
export const PARK_CHECK_MAX_MS = 20_000

export interface Store2PeerHandler {
    /**
     * Parked with nothing unsaved: only the reload action exists. Nothing is awaited. The prompt may be answered long
     * after the tab was found clean, so `live()` is read when Reload is pressed. Reload reloads only while the page is
     * still parked and not dirty. A tab that has become dirty reloads nothing and the prompt closes; the loop then asks
     * `decide` with the unsaved wording, on its next iteration at the latest, because `asked` is still false. Typed text
     * is not a dirty edit: it never reaches `decide`, so the prompt itself warns that a reload discards it.
     * Before it reloads, Reload asks the loop through `requestReload()`: the loop judges every resident character in its
     * own step and answers; only `clean` allows the reload, and the page is read again at that instant. A tab found not
     * clean is marked unsaved by the loop, which then asks `decide`. Only the resident judgement is bounded (by
     * `PARK_CHECK_MAX_MS`); the loop's reads and the release of a pending marker wait on the write lock without a bound,
     * so the person can cancel the wait. The promise settles whenever the loop serves the request or the park ends.
     */
    parkedClean(prompt: PeerParkPrompt, live: () => PeerLiveState, requestReload: () => Promise<ParkCheck>): void
    /**
     * A module stub was edited in this tab, so no save pass can encode it: changes to modules are held in memory while
     * characters and chats keep saving. Nothing is awaited and no lock is held. `stillBlocked()` is read when Reload is
     * pressed; it is false once a pass that took module scope has saved cleanly or a different module has been
     * announced, and Reload then does nothing (nothing is lost; the next prompt offers its own Reload). Asked once per
     * module id until such a pass saves.
     */
    moduleEdited(info: { moduleId: string, moduleName: string }, stillBlocked: () => boolean): void
    /**
     * A module stub that a load cannot bring in blocks module saves: changes to modules are held in memory while
     * characters and chats keep saving. Nothing is awaited and no lock is held. Told once per module id until a pass
     * that took module scope has saved cleanly.
     */
    moduleNotSaved(info: { moduleId: string, moduleName: string }): void
    /** Parked with unsaved edits: resolves with one of `prompt.offers`; anything else is read as 'reload'. */
    decide(prompt: PeerParkPrompt): Promise<PeerOffer>
    /**
     * Node's 'export-first': a .bin of this tab's state, then the reload. The export writes this tab's live tree,
     * unsaved edits included, and reads an unloaded character from the units its stub names. Nothing pins those
     * units; the dev GC refuses while this page is parked or an export runs, and a unit that is gone surfaces
     * through the incomplete-data prompt. `manifestKey` is not used by the export.
     * 'saved' resolves only once the person has acknowledged that the file was handed to the browser: a browser
     * download cannot be watched to its end, and the reload that follows would cut an unfinished one off. Anything
     * else is 'declined' (a cancelled prompt or dialog) or 'failed' (a failed write, which its writer has already told
     * the person about): the page asks again and does not reload, silently for both.
     * A throw is a failure of the handler itself and is reported like a failed save.
     */
    exportThisTab(manifestKey: string): Promise<'saved' | 'declined' | 'failed'>
    /**
     * The same partial export without the blocking reload hand-off, run by the loop once per park before the question
     * when a dirty Node tab parks. 'saved' means the file was handed to the browser, not that the download finished.
     * The export's own dialogs still show. A throw counts as a failed automatic export. Absent, none runs.
     */
    autoExport?(manifestKey: string): Promise<'saved' | 'declined' | 'failed'>
    reload(): void
}

export interface IdleNetOptions {
    intervalMs: number
    /** The least time between two ticks that take module scope; defaults to `IDLE_NET_MODULE_INTERVAL_MS`. */
    moduleIntervalMs?: number
    /** Tests only: a clean verdict younger than this lets the net skip that resident's next verdict; 0 disables the skip. */
    backstopMs?: number
}

/** The idle net's default cadence: one resident character per tick. */
export const IDLE_NET_INTERVAL_MS = 2000

/**
 * A resident whose verdict was clean less than this long ago is passed over at its next turn. The rotation itself is
 * unchanged, so a quiet resident is re-verdicted at its first turn at or after this age: this plus up to one rotation.
 */
const NET_VERDICT_BACKSTOP_MS = 30_000

/** The idle net takes module scope at most this often; a module edit that raised no mark waits for the next such tick. */
export const IDLE_NET_MODULE_INTERVAL_MS = 30_000

/** A commit landed but its backend could not confirm it reached stable storage: the person is told, and the next pass commits again. */
export class Store2NotFlushedError extends Error {
    constructor() {
        super('The data was saved but the storage did not confirm that it reached the disk; saving again.')
        this.name = 'Store2NotFlushedError'
    }
}

/**
 * A commit refused for a reason the loop cannot resolve by retrying quietly: a refusal that points at the code, or a
 * run of retries that does not end (a peer's marker that stands, a conflict that keeps landing first), reported once the
 * quiet retries are spent.
 */
export class Store2CommitRefusedError extends Error {
    constructor(readonly reason: string, detail: string) {
        super(`The commit was refused (${reason}): ${detail}`)
        this.name = 'Store2CommitRefusedError'
    }
}

/** The marks of one pass, taken at its start. `whole` is the full-reload flag as it stood. */
export interface Store2Snapshot {
    toSave: toSaveType
    whole: boolean
}

/** A character the loop's passes cannot save: the pass went on without it. */
export interface UnsavableCharacter {
    chaId: string
    /** A last saved copy exists and is kept; false means the character has never been saved. */
    saved: boolean
    cause: unknown
}

/** What the loop needs from the page: the shared marks and flags, the page's own state and effects. `saveDbStore2` builds it. */
export interface Store2LoopPort {
    /** The live tracker the mark paths write into. */
    tracker: toSaveType
    /** The full-reload flag: the five triggers that need every resident character encoded. */
    reloadFlag: { state: boolean }
    getDatabase(): Database
    /** Folds a snapshot back into a live tracker without discarding what accumulated since. */
    mergeBack(live: toSaveType, snapshot: toSaveType): void
    /** The live character check; a repair requests its own pass. */
    liveCheck(): void
    /** Releases expired draft registrations; runs every iteration. */
    sweep(): void
    /** A pass is due: a debounce elapsed, a save was requested now, or a failed pass asked again. */
    isDue(): boolean
    /** The page holds edits that no commit has taken. */
    isDirty(): boolean
    /** Typed text no commit has taken (composer, an open edit). Not a dirty edit: it never routes a tab to `decide`. */
    hasDrafts(): boolean
    /** A pass that carries marks begins: the save indicator is on and the due flag is consumed. */
    beginIteration(): void
    endIteration(): void
    /** The snapshot was taken: the page counts as clean until the next mark. */
    snapshotTaken(): void
    /** Marks the page dirty and asks for another pass. */
    requestPass(): void
    /**
     * Marks the page dirty without making a pass due and without counting a mark: edits are held that no commit will
     * take until the cause is fixed. Optional so that the many test ports of other behaviours need not declare it; the
     * page's port always has it.
     */
    markUnsaved?(): void
    /**
     * After an attempt whose commit landed (saved, or landed without a flush), before `saved()`: every character that cannot be saved now (`current`) and those
     * that newly cannot (`newly`: not in the set before this attempt, still present after it). Called only when the
     * set changed or `newly` is not empty. It must not report a failure; a throw is logged and ignored.
     */
    unsavable(current: readonly UnsavableCharacter[], newly: readonly UnsavableCharacter[]): void
    /** The pass's data is in the store (or the store already held it): next-commit callbacks fire. */
    saved(): void
    /** Tells the other tabs a commit landed. */
    broadcast(epoch: string): void
    /** A peer announced a save since the last call; clears the flag. */
    peerHeard(): boolean
    /** Parks the saving state with a reason that has a string; the empty reason clears it. */
    setStopped(reason: string, detail?: string): void
    /**
     * The server refused a body as too large and this tab stopped saving: tells the person once, naming `label`. Not a save
     * failure: it records none and promises no retry. The page's port always has it; it is optional only so that the many
     * test ports of other behaviours need not declare it.
     */
    notifyTooLarge?(label: string): void
    /** Tells the person a save failed; answers how long the loop waits before it tries again. */
    reportFailure(error: unknown, attempts: number): number
    /**
     * `reportFailure` for a failure that is not a counted save pass (the peer hand-off handler threw, or a throw after
     * the commit landed): the same alert and wait, with `attempts` only a severity input. It records no failed pass.
     */
    reportUncountedFailure(error: unknown, attempts: number): number
    /** Runs `run` while holding the write lock that every whole-state writer shares. */
    withWriteLock<T>(run: () => Promise<T>): Promise<T>
    /** A sleep that a save request ends early. */
    wait(ms: number): Promise<void>
    sleep(ms: number): Promise<unknown>
    sleepForever(): Promise<never>
    now(): number
    /** The idle-net slot's one yield before its verdict; absent means `yieldToEventLoop`. Tests inject their own. */
    yieldNow?(): Promise<void>
    /** True once after the page asked for a sweep (a hide or Back): every resident is then verdicted at its next turn. Read after the yield. */
    takeNetSweep?(): boolean
    /** Whether the page is hidden; a hidden page's slots never skip a verdict. Read after the yield. */
    pageHidden?(): boolean
    /**
     * Whether the encode's budgeted yields are skipped now: a hidden Android page may be frozen inside a yield, and
     * a frozen page runs no message or timer, so the pass would wait for the user to return. Absent means never.
     */
    yieldImmediately?(): boolean
    /**
     * A back-off that a save request ends early and whose request is kept for the wait after the pass, so a frozen page's
     * page timer is not awaited between the request and the commit. Present only where the page can freeze; absent means
     * the back-offs are the plain timed `sleep`.
     */
    rearmWait?(ms: number): Promise<void>
}

/** Takes the marks of a pass and trims the live tracker to its sticky front, before any await. */
export function takeStore2Snapshot(port: Pick<Store2LoopPort, 'tracker' | 'reloadFlag' | 'snapshotTaken'>): Store2Snapshot {
    const { tracker, reloadFlag } = port
    const toSave: toSaveType = {
        character: [...tracker.character],
        chat: tracker.chat.map(([chaId, chatId]): [string, string] => [chaId, chatId]),
        botPreset: tracker.botPreset,
        modules: tracker.modules,
        loadouts: tracker.loadouts,
        plugins: tracker.plugins,
        pluginCustomStorage: tracker.pluginCustomStorage,
    }
    port.snapshotTaken()
    tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]
    tracker.chat = tracker.chat.length === 0 ? [] : [tracker.chat[0]]
    tracker.botPreset = false
    tracker.modules = false
    tracker.loadouts = false
    tracker.plugins = false
    tracker.pluginCustomStorage = false
    // Cleared before the awaits that follow: a request that arrives during the pass wins.
    const whole = reloadFlag.state
    reloadFlag.state = false
    return { toSave, whole }
}

/** The chaIds of the resident, non-stub characters in list order. */
export function residentChaIds(db: Database): string[] {
    if (!Array.isArray(db.characters)) {
        return []
    }
    const out: string[] = []
    for (const slot of db.characters) {
        if (typeof slot === 'object' && slot !== null && !isColdStub(slot)) {
            out.push(String((slot as { chaId?: unknown }).chaId ?? ''))
        }
    }
    return out
}

/**
 * The items a tab holds only as stand-ins (cold-stub characters and module stubs), named by their own name, else their
 * id. The count is the number of stand-ins, before any name is cleaned or dropped, and the test is the one `hasStubs`
 * uses, so a prompt that withholds Save mine for stubs always has a count. Reads slots only and never throws.
 */
export function stubNamesOf(db: Database): { names: string[], count: number } {
    const names: string[] = []
    const nameOf = (slot: object, idField: string): string => {
        const fields = slot as Record<string, unknown>
        if (typeof fields.name === 'string' && fields.name !== '') {
            return fields.name
        }
        const id = fields[idField]
        return typeof id === 'string' ? id : ''
    }
    if (Array.isArray(db.characters)) {
        for (const slot of db.characters) {
            if (typeof slot === 'object' && slot !== null && isColdStub(slot)) {
                names.push(nameOf(slot, 'chaId'))
            }
        }
    }
    if (Array.isArray(db.modules)) {
        for (const slot of db.modules) {
            if (isModuleStub(slot)) {
                names.push(nameOf(slot as object, 'id'))
            }
        }
    }
    return { names, count: names.length }
}

/** The items a refused Save mine could not carry, as the plan named them; never reads the live database. */
export function blockedOf(plan: Pick<SavePlan, 'carried'>): { names: readonly string[], count: number } {
    const names = [...plan.carried.owners.values(), ...plan.carried.modules]
    return { names, count: names.length > 0 ? names.length : plan.carried.units }
}

function presentChaIds(db: Database): Set<string> {
    const out = new Set<string>()
    if (Array.isArray(db.characters)) {
        for (const slot of db.characters) {
            if (typeof slot === 'object' && slot !== null) {
                out.add(String((slot as { chaId?: unknown }).chaId ?? ''))
            }
        }
    }
    return out
}

type Judged =
    | { kind: 'ok' }
    | { kind: 'stop', reason: 'peer-commit' | 'replaced', key: CommitKey | null, revision: boolean }

/** A parked loop: what it is parked on, and what has been told or asked. */
interface Park {
    reason: 'peer-commit' | 'replaced'
    /** The epoch the commit key held when the park was judged; Save mine's consent covers this one only. */
    epoch: string | null
    /** The base still names this page's acknowledged manifest (current, retained or pinned). */
    namedMine: boolean
    /** The base is compared by revision (Node). */
    revision: boolean
    asked: boolean
    noticed: boolean
    /** The park's one automatic export: carried to a newer park by `recheckPark`, so a later peer save never exports again. */
    autoExport: 'pending' | 'running' | 'done' | 'failed'
    /** Set when a Save mine was refused in this park: its presence, not its names, withholds Save mine from every later prompt. */
    blocked?: { names: readonly string[], count: number }
}

type Outcome =
    | { kind: 'saved', wrote: boolean }
    /** The pass did not land and nothing says it never will: counted, and reported when it persists. */
    | { kind: 'retry', reason: string, detail: string }
    | { kind: 'park', park: Park }
    /** The server refused a body as too large: nothing was applied and the same bytes never fit, so this tab stops saving. */
    | { kind: 'stop', cause: Store2PayloadTooLargeError, label: string, cleared: AbandonResult | null }
    | { kind: 'not-flushed' }
    /** A module's load is waiting for the person's answer: nothing was written, nothing is counted, and the loop makes no further pass until `settled`. */
    | { kind: 'deferred', settled: Promise<void> }

/**
 * Thrown by `planOf` when the module valve reports a load that waits for the person. `attemptRun` turns it into the
 * `deferred` outcome before any commit is built, so it never leaves the loop and is never counted as a failure.
 */
class ModuleLoadDeferred extends Error {
    constructor(public readonly settled: Promise<void>) {
        super('A module load is waiting for the person\'s answer.')
        this.name = 'ModuleLoadDeferred'
    }
}

/** What one pass records for the code after it: the marks it took, whether its commit landed, and how it treated the modules. */
interface PassRun {
    snapshot: Store2Snapshot | null
    landed: boolean
    plan: SavePlan | null
    /** The module refusal the pass went on without (the modules were carried whole); null when none was met. */
    moduleRefusal: StubRefusedError | null
    /** The pass's request asked for module scope, so a clean save proves no module stub blocks it. */
    moduleScope: boolean
}

/** The failures that name the page's own state as stale for good: only a reload ends them. */
const REPLACED_REFUSALS: ReadonlySet<string> = new Set(['absent', 'no-current', 'damaged', 'too-new'])

/** Consecutive retries the loop makes without a report; the next one goes through the failure path. */
const QUIET_RETRIES = 2

/** The longest wait the loop adds after repeated reports of a commit that lands but is not confirmed durable. */
const NOT_FLUSHED_BACKOFF_MAX_MS = 60_000

/** The wait before the next attempt after `attempts` reports: the port's own wait up to the fifth, doubling after it. */
export function backedOffWait(wait: number, attempts: number): number {
    return attempts <= 5 ? wait : Math.min(wait * 2 ** (attempts - 5), NOT_FLUSHED_BACKOFF_MAX_MS)
}

/** Reads the running loop's parked state; `null` until a loop starts on this page. */
let readParked: (() => boolean) | null = null

/** Reads the running loop's stopped state (a body the server refuses as too large); `null` until a loop starts on this page. */
let readStopped: (() => boolean) | null = null

/**
 * Whether this page's save loop is parked on a commit it did not make. A read only: it changes nothing, and answers
 * `false` while no loop runs (a read-only or legacy page has none).
 */
export function isSaveLoopParked(): boolean {
    return readParked !== null && readParked()
}

/**
 * Whether this page's save loop has stopped for good because a body is over what the server accepts; only a reload ends
 * it. A read only, `false` while no loop runs.
 */
export function isSaveLoopStopped(): boolean {
    return readStopped !== null && readStopped()
}

export function runStore2SaveLoop(context: Store2SaveContext, port: Store2LoopPort): Promise<never> {
    const sessionCommitter = context.session.committer
    if (sessionCommitter === null) {
        return Promise.reject(new Store2CommitRefusedError('no-committer', 'The session has no committer.'))
    }
    const committer: Committer = sessionCommitter
    const encoder = context.encoder ?? createSaveEncoder({ previous: context.previous, lists: context.lists, env: context.env })
    const netMs = context.idleNet === null ? null : (context.idleNet?.intervalMs ?? IDLE_NET_INTERVAL_MS)
    const moduleMs = context.idleNet?.moduleIntervalMs ?? IDLE_NET_MODULE_INTERVAL_MS
    const backstopMs = context.idleNet?.backstopMs ?? NET_VERDICT_BACKSTOP_MS

    let savetrys = 0
    let retries = 0
    /** The module id whose edited-stub prompt was asked; cleared by a pass that took module scope and saved cleanly, so a later edit asks again. */
    let editedAnnounced: string | null = null
    /** The module id whose not-saved notice was told; cleared like `editedAnnounced`. */
    let unsavedAnnounced: string | null = null
    let park: Park | null = null
    readParked = () => park !== null
    /** Set once by a too-large refusal and never cleared: no pass, idle net or park handling runs again on this page load. */
    let stopped = false
    /** The stop followed a bulk commit whose own marker may still stand: the stopped loop keeps clearing it until it is gone. */
    let markerPending = false
    readStopped = () => stopped
    /** The epoch the person agreed to overwrite with Save mine. */
    let consent: string | null = null
    /** Set while a module load waits for the person's answer; `null` otherwise. Gates the passes and the idle net, never the park handling or the peer check. */
    let deferral: Promise<void> | null = null
    /** A commit reported that it was not flushed: the next pass commits even when it changed nothing. */
    let forced = false
    let peerSignal = false
    /** A Reload press waiting for the loop's check: the one owner of the park runs it inside `settlePark`. */
    let reloadAsk: { result: Promise<ParkCheck>, settle: (verdict: ParkCheck) => void } | null = null
    let netIndex = 0
    /**
     * When each resident's last clean verdict was taken (`port.now()`). An entry lives from a clean `verdictOf` until that
     * resident's next turn, whether `netDecision` or the full tick takes it; a skipped turn puts the same value back, so
     * the age counts from the last real verdict. A hide or Back sweep clears every entry, and the prune drops the entries
     * of ids no longer resident; no ack, peer commit or adoption touches it.
     */
    const cleanVerdictAt = new Map<string, number>()
    let lastNetAt = port.now()
    /** When a tick last took module scope; the next such tick is `moduleMs` later, whatever the first one came to. */
    let lastModuleNetAt = port.now()
    /** The gap recorder of the attempt in flight, a measurement build only; one attempt runs at a time under the write lock. */
    let activeGaps: YieldGapRecorder | null = null
    /** Whether the current idle-net slot's base read and judgement finished, a measurement build only; it tells a failed read from a later fault. */
    let netReadDone = false
    /** The clock reads that bound the current slot's spans, set by `netDecision` and read by `netSlot`; a measurement build only. */
    let netJudgeStartedAt: number | null = null
    let netYieldCalledAt: number | null = null
    let netResumedAt: number | null = null
    /**
     * The characters the latest attempts whose commit landed could not encode. A character leaves it when a pass encodes
     * it, or when it is no longer in the database; an attempt whose commit did not land changes nothing here.
     */
    const unsavable = new Map<string, UnsavableCharacter>()

    function namedByBase(key: CommitKey): boolean {
        return namesManifest(key, encoder.manifestKey)
    }

    /** Whether the page may save over this base. A pending attempt that is the base's `current` is adopted here, before any plan. */
    function judge(read: Store2Read): Judged {
        const pendingBefore = MEASURE ? encoder.pendingKey : null
        const classified = classifyCommitRead(read)
        const revision = read.token.kind === 'revision'
        if (classified.status !== 'parsed' || classified.value.current === null) {
            return { kind: 'stop', reason: 'replaced', key: classified.status === 'parsed' ? classified.value : null, revision }
        }
        const current = classified.value.current.key
        if (current === encoder.manifestKey || encoder.adoptIfCurrent(current)) {
            if (MEASURE && pendingBefore !== null && encoder.pendingKey === null) {
                noteSignalAdopted()
            }
            return { kind: 'ok' }
        }
        return { kind: 'stop', reason: 'peer-commit', key: classified.value, revision }
    }

    function parkOf(judged: Extract<Judged, { kind: 'stop' }>): Park {
        return {
            reason: judged.reason,
            epoch: judged.key?.epoch ?? null,
            namedMine: judged.key === null ? false : namedByBase(judged.key),
            revision: judged.revision,
            asked: false,
            noticed: false,
            autoExport: 'pending',
        }
    }

    /** Ends the park. A Reload press still waiting for its check is answered `moved`. */
    function unpark(): void {
        park = null
        port.setStopped('')
        const waiting = reloadAsk
        reloadAsk = null
        waiting?.settle('moved')
    }

    function isParked(): boolean {
        return park !== null
    }

    /** Hands a Reload press to the loop; presses made before the loop serves one share its answer. */
    function requestReload(): Promise<ParkCheck> {
        if (park === null) {
            return Promise.resolve('moved')
        }
        if (reloadAsk === null) {
            let settle: (verdict: ParkCheck) => void = () => { }
            const result = new Promise<ParkCheck>((resolve) => { settle = resolve })
            reloadAsk = { result, settle }
        }
        return reloadAsk.result
    }

    /**
     * The verdict over every resident character, run by `settlePark` for a Reload press. Undecided (a pending attempt
     * that a base read does not settle, an unheld or stub slot, an unsavable character, a verdict that is not clean, an
     * unfinished judgement) counts as dirty and marks the page, so the loop's unsaved question follows in the same step.
     * No pass runs while the loop is here. The judgement itself changes no park state, so one that outlives its
     * deadline cannot race the loop. A clean answer covers marked changes; the person's Reload reads the page again at
     * the instant of reload.
     */
    async function checkBeforeReload(parked: Park): Promise<ParkCheck> {
        if (encoder.pendingKey !== null) {
            await recheckPark(parked)
        }
        if (!isParked()) {
            return 'moved'
        }
        if (port.isDirty()) {
            return 'dirty'
        }
        let cancelled = false
        const judgeResidents = async (): Promise<ParkCheck> => {
            if (encoder.pendingKey !== null) {
                return 'dirty'
            }
            const db = port.getDatabase()
            const scan = encoder.netScan(db)
            if (scan.unheld || scan.stubsNeedFull || unsavable.size > 0) {
                return 'dirty'
            }
            const slots = (db.characters as Array<character | groupChat | null>).filter(
                (candidate): candidate is character | groupChat => typeof candidate === 'object' && candidate !== null && !isColdStub(candidate))
            for (const slot of slots) {
                if (cancelled) {
                    return 'dirty'
                }
                if (encoder.verdictOf(slot) !== 'clean') {
                    return 'dirty'
                }
                if (port.yieldImmediately?.() !== true) {
                    await (port.yieldNow !== undefined ? port.yieldNow() : yieldToEventLoop())
                }
                if (port.getDatabase() !== db) {
                    return 'dirty'
                }
            }
            return 'clean'
        }
        let result: ParkCheck
        try {
            result = await Promise.race([judgeResidents(), port.sleep(PARK_CHECK_MAX_MS).then((): ParkCheck => 'dirty')])
        } catch (error) {
            console.error(error)
            result = 'dirty'
        }
        cancelled = true
        // Defensive: only settlePark changes the park while it is here, so this does not fire today.
        if (!isParked()) {
            return 'moved'
        }
        // A mark that arrived while the residents were judged outranks a clean verdict.
        if (result === 'clean' && port.isDirty()) {
            return 'dirty'
        }
        if (result === 'dirty') {
            port.markUnsaved?.()
        }
        return result
    }

    function setPark(next: Park): void {
        consent = null
        park = next
        if (next.reason === 'replaced') {
            port.setStopped('replaced')
        }
    }

    function promptOf(parked: Park, unsaved: boolean): PeerParkPrompt {
        if (parked.reason === 'replaced') {
            return { reason: parked.reason, unsaved, offers: ['reload'], saveMineUnavailable: 'replaced' }
        }
        if (context.session.kind === 'node' || parked.revision) {
            return unsaved
                ? { reason: parked.reason, unsaved, offers: ['reload', 'export-first'], saveMineUnavailable: 'node' }
                : { reason: parked.reason, unsaved, offers: ['reload'], saveMineUnavailable: 'node' }
        }
        if (!unsaved) {
            return { reason: parked.reason, unsaved, offers: ['reload'] }
        }
        if (parked.blocked !== undefined) {
            return { reason: parked.reason, unsaved, offers: ['reload'], saveMineUnavailable: 'carries', blocked: parked.blocked }
        }
        if (encoder.hasStubs(port.getDatabase()) && !parked.namedMine) {
            return { reason: parked.reason, unsaved, offers: ['reload'], saveMineUnavailable: 'carries', blocked: stubNamesOf(port.getDatabase()) }
        }
        return { reason: parked.reason, unsaved, offers: ['reload', 'save-mine'] }
    }

    /** Reads the base and re-judges a parked loop: a base that is the page's again unparks, a newer one is asked about afresh. */
    async function recheckPark(parked: Park): Promise<void> {
        let read: Store2Read
        try {
            read = await port.withWriteLock(() => committer.readCommit())
        } catch (error) {
            console.error(error)
            return
        }
        const judged = judge(read)
        if (judged.kind === 'ok') {
            unpark()
            return
        }
        const next = parkOf(judged)
        if (next.epoch === parked.epoch && next.reason === parked.reason) {
            return
        }
        next.noticed = parked.noticed
        next.autoExport = parked.autoExport
        if (parked.blocked !== undefined && !next.namedMine) {
            next.blocked = parked.blocked
        }
        setPark(next)
    }

    async function settlePark(): Promise<void> {
        let parked = park
        if (parked === null) {
            return
        }
        if (peerSignal) {
            peerSignal = false
            await recheckPark(parked)
            parked = park
            if (parked === null) {
                return
            }
        }
        const asked = reloadAsk
        if (asked !== null) {
            reloadAsk = null
            asked.settle(await checkBeforeReload(parked))
            parked = park
            if (parked === null) {
                return
            }
        }
        if (!port.isDirty()) {
            if (!parked.noticed) {
                parked.noticed = true
                context.peer.parkedClean(promptOf(parked, false), () => ({
                    parked: park !== null,
                    dirty: port.isDirty(),
                    drafts: port.hasDrafts(),
                }), requestReload)
            }
            return
        }
        if (parked.asked) {
            return
        }
        parked.asked = true
        const asking = promptOf(parked, true)
        // Once per park lifetime, before the question, and only where the tab can neither save over the peer nor be replaced.
        if (asking.saveMineUnavailable === 'node' && parked.autoExport === 'pending' && context.peer.autoExport !== undefined) {
            parked.autoExport = 'running'
            // No await sits between the busy check and the call to the handler. The handler itself may await before its own
            // busy entry registers, so a busy action starting in that narrow window is not excluded.
            if (isBusy()) {
                parked.autoExport = 'failed'
            } else {
                try {
                    parked.autoExport = await context.peer.autoExport(encoder.manifestKey) === 'saved' ? 'done' : 'failed'
                } catch (error) {
                    parked.autoExport = 'failed'
                    port.reportUncountedFailure(error, 5)
                }
            }
        }
        const prompt: PeerParkPrompt = parked.autoExport === 'done'
            ? { ...asking, autoExport: 'saved' }
            : parked.autoExport === 'failed' ? { ...asking, autoExport: 'not-finished' } : asking
        let answer: PeerOffer
        try {
            answer = await context.peer.decide(prompt)
        } catch (error) {
            parked.asked = false
            port.reportUncountedFailure(error, 1)
            await port.sleep(1000)
            return
        }
        const choice: PeerOffer = prompt.offers.includes(answer) ? answer : 'reload'
        if (choice === 'save-mine' && parked.epoch !== null) {
            consent = parked.epoch
            unpark()
            port.requestPass()
            return
        }
        if (choice === 'export-first') {
            try {
                if (await context.peer.exportThisTab(encoder.manifestKey) !== 'saved') {
                    // A cancel is not a save failure, and a failed write was already told by its writer: the person is asked again, without the failure alert.
                    parked.asked = false
                    return
                }
            } catch (error) {
                // The person keeps an in-app action: the question is asked again after the wait.
                parked.asked = false
                await port.sleep(port.reportUncountedFailure(error, 5))
                return
            }
        }
        context.peer.reload()
        await port.sleepForever()
    }

    function marksOf(snapshot: Store2Snapshot, db: Database): Set<string> {
        const present = presentChaIds(db)
        const marked = new Set<string>()
        for (const chaId of snapshot.toSave.character) {
            if (typeof chaId === 'string' && present.has(chaId)) {
                marked.add(chaId)
            }
        }
        return marked
    }

    function requestOf(snapshot: Store2Snapshot | null, db: Database, rewriteAll: boolean, netChaId: string | null): SavePassRequest {
        const gaps = MEASURE ? startYieldGaps() : null
        // `skip` sits in the budget, not in `yieldFn`, so a measurement build's replaced yield is bypassed too.
        const skip = () => port.yieldImmediately?.() === true
        const budget = MEASURE && gaps !== null ? createYieldBudget({ yieldFn: () => gaps.yield(), skip }) : createYieldBudget({ skip })
        const request = shapeOf(snapshot, db, rewriteAll, netChaId, { yield: () => budget.maybeYield() })
        if (MEASURE) {
            activeGaps = gaps
            gaps?.describe(request)
            if (snapshot === null) {
                request.peekMarks = () => peekSaveMarks(port)
            }
        }
        return request
    }

    /**
     * The request of one pass. A marked pass takes its modules from the snapshot's flag. A tick takes module scope at
     * most once per `moduleMs`: with no resident character the tick still runs and carries the modules until they are
     * due; with residents the character round-robin is unchanged and module scope rides on whichever tick is next once
     * due. The module clock advances when a tick takes module scope, so a check that fails waits for the next one.
     * A tick given `netChaId` is a verdict slot's pass: it names that character, takes no module scope, and leaves the
     * round-robin index and the module clock alone, because the slot that judged the character already consumed its turn.
     */
    function shapeOf(snapshot: Store2Snapshot | null, db: Database, rewriteAll: boolean, netChaId: string | null, yielding: { yield: () => Promise<void> }): SavePassRequest {
        if (snapshot !== null) {
            return { marked: marksOf(snapshot, db), modules: snapshot.toSave.modules, whole: snapshot.whole, rewriteAll, ...yielding }
        }
        if (netChaId !== null) {
            return { marked: new Set(), modules: false, whole: false, net: { chaId: netChaId, modules: false }, ...yielding }
        }
        const now = port.now()
        const modulesDue = now - lastModuleNetAt >= moduleMs
        if (modulesDue) {
            lastModuleNetAt = now
        }
        const residents = residentChaIds(db)
        if (residents.length === 0) {
            return { marked: new Set(), modules: modulesDue, whole: false, net: { chaId: null, modules: modulesDue }, ...yielding }
        }
        const index = netIndex % residents.length
        netIndex = (index + 1) % residents.length
        cleanVerdictAt.delete(residents[index])
        return { marked: new Set(), modules: false, whole: false, net: { chaId: residents[index], modules: modulesDue }, ...yielding }
    }

    /**
     * The plan of one pass over the live list. A module stub the planner cannot carry is brought in through the context's
     * valve and the pass is planned again with the same request. The valve never waits for the person while the write
     * lock is held: a load that would ask answers `deferred`, and the pass ends quietly (`ModuleLoadDeferred`). One load
     * is made per module id and pass. A module refusal that survives its load (or that no load can help: an edited stub,
     * or no valve) does not fail the pass: the pass is planned again with the modules carried whole, and the refusal is
     * returned beside that plan so the caller holds the module mark. Characters and chats still save. The modules are
     * carried only when the acknowledged encoding holds them; otherwise the planner's own error surfaces.
     */
    async function planOf(db: Database, request: SavePassRequest): Promise<{ plan: SavePlan, moduleRefusal: StubRefusedError | null }> {
        const loaded = new Set<string>()
        let planDb = db
        let planRequest = request
        for (;;) {
            try {
                return { plan: await planWithStubLoads(planDb, planRequest), moduleRefusal: null }
            } catch (error) {
                if (!(error instanceof StubRefusedError) || error.kind !== 'module') {
                    throw error
                }
                const loadable = error.reason === 'uncarriable' && context.loadModuleStub !== undefined && !loaded.has(error.chaId)
                if (loadable && context.loadModuleStub !== undefined) {
                    loaded.add(error.chaId)
                    if (MEASURE) {
                        activeGaps?.pause()
                    }
                    const result = await context.loadModuleStub(error.chaId)
                    if (result.kind === 'deferred') {
                        throw new ModuleLoadDeferred(result.settled)
                    }
                    if (MEASURE) {
                        activeGaps?.resume()
                    }
                    if (result.kind !== 'refused') {
                        planDb = port.getDatabase()
                        planRequest = MEASURE ? { ...request, retry: true } : request
                        continue
                    }
                }
                if (!encoder.carriesModules()) {
                    throw error
                }
                return { plan: await planWithStubLoads(planDb, { ...planRequest, carryModules: true }), moduleRefusal: error }
            }
        }
    }

    async function planWithStubLoads(db: Database, request: SavePassRequest): Promise<SavePlan> {
        try {
            return await encoder.plan(db, request)
        } catch (error) {
            const loadable = error instanceof SharedChaIdStubError || (error instanceof StubRefusedError && error.kind === 'character')
            if (!loadable || context.loadStub === undefined) {
                throw error
            }
            // The stub that shares its id, or that names units its entry no longer holds, is loaded, and the pass is
            // planned once more over the live list. A pass that stays blocked is a failed save the person is told about.
            if (MEASURE) {
                activeGaps?.pause()
            }
            if (!await context.loadStub(error.chaId)) {
                throw error
            }
            if (MEASURE) {
                activeGaps?.resume()
            }
            const retried: SavePassRequest = { ...request, marked: new Set([...request.marked, error.chaId]) }
            if (MEASURE) {
                retried.retry = true
            }
            return await encoder.plan(port.getDatabase(), retried)
        }
    }

    function outcomeOf(result: CommitResult, plan: SavePlan, flags: { landed: boolean }): Outcome {
        switch (result.status) {
            case 'committed':
                flags.landed = true
                plan.acknowledge()
                if (MEASURE) {
                    noteSignalAck(plan.encoded)
                }
                consent = null
                port.broadcast(result.value.epoch)
                // The commit landed and is the acknowledged encoding; only its durability is unconfirmed.
                if (result.flushed === false) {
                    return { kind: 'not-flushed' }
                }
                forced = false
                savetrys = 0
                return { kind: 'saved', wrote: true }
            case 'conflict': {
                const judged = judge(result.current)
                return judged.kind === 'ok'
                    ? { kind: 'retry', reason: 'conflict', detail: 'A peer\'s write kept landing first.' }
                    : { kind: 'park', park: parkOf(judged) }
            }
            case 'failed':
                if (result.cause instanceof Store2StalePageError) {
                    return { kind: 'park', park: parkOf({ kind: 'stop', reason: 'replaced', key: null, revision: false }) }
                }
                if (result.cause instanceof Store2PayloadTooLargeError) {
                    return { kind: 'stop', cause: result.cause, label: tooLargeLabel(result.cause), cleared: null }
                }
                throw result.cause
            case 'abandoned':
                if (result.cause === undefined) {
                    return { kind: 'retry', reason: result.reason, detail: 'The bulk commit did not land.' }
                }
                if (result.cause instanceof Store2PayloadTooLargeError) {
                    return { kind: 'stop', cause: result.cause, label: tooLargeLabel(result.cause), cleared: result.cleared }
                }
                if (result.cause instanceof Store2StalePageError) {
                    return { kind: 'park', park: parkOf({ kind: 'stop', reason: 'replaced', key: null, revision: false }) }
                }
                throw result.cause
            case 'unknown':
                plan.keepAsPending()
                if (MEASURE) {
                    noteSignalKept(plan.encoded)
                }
                throw result.cause
            case 'refused':
                if (REPLACED_REFUSALS.has(result.reason)) {
                    return { kind: 'park', park: parkOf({ kind: 'stop', reason: 'replaced', key: null, revision: false }) }
                }
                if (result.reason === 'marker-present') {
                    return { kind: 'retry', reason: result.reason, detail: result.detail }
                }
                throw new Store2CommitRefusedError(result.reason, result.detail)
        }
    }

    /**
     * Clears the bulk marker on `read` when this page load set it; a foreign marker stands and keeps the data marked.
     * Answers what the clear came to, or `null` when no clear ran or it threw.
     */
    async function clearOwnMarker(read: Store2Read): Promise<AbandonResult | null> {
        const classified = classifyCommitRead(read)
        const staging = classified.status === 'parsed' ? classified.value.staging : null
        if (staging === null || staging.owner !== committer.owner) {
            return null
        }
        try {
            return await committer.abandonClear(read, staging.owner, staging.prefix)
        } catch (error) {
            console.error(error)
            return null
        }
    }

    /**
     * One try, while stopped, at removing this page load's own bulk marker so that no marker stands on the commit key for
     * peers. A fresh read decides: no own marker means done. The retry ends on `cleared`, `nothing` or `refused` (or a
     * clear a newer page refuses, which never succeeds here); a throw, `failed`, `unknown` or `conflict` is tried again.
     */
    async function releaseOwnMarkerWhileStopped(): Promise<void> {
        try {
            const read = await committer.readCommit()
            const classified = classifyCommitRead(read)
            const staging = classified.status === 'parsed' ? classified.value.staging : null
            if (staging === null || staging.owner !== committer.owner) {
                markerPending = false
                return
            }
            const cleared = await committer.abandonClear(read, staging.owner, staging.prefix)
            if (cleared.status === 'cleared' || cleared.status === 'nothing' || cleared.status === 'refused'
                || ((cleared.status === 'failed' || cleared.status === 'unknown') && cleared.cause instanceof Store2StalePageError)) {
                markerPending = false
            }
        } catch (error) {
            console.error(error)
        }
    }

    /** Stops this tab's saving for the rest of the page load; the edits stay in memory and the tab stays dirty. */
    function stopForTooLarge(cause: Store2PayloadTooLargeError, label: string, cleared: AbandonResult | null): void {
        if (stopped) {
            return
        }
        stopped = true
        console.error(cause)
        markerPending = markerPending || (cleared !== null && cleared.status !== 'cleared' && cleared.status !== 'nothing')
        port.setStopped('too-large', label)
        port.notifyTooLarge?.(label)
    }

    /**
     * Folds the plan of an attempt whose commit landed into `unsavable` and tells the port when the set changed. `newly` is read
     * from the final set, so a character deleted while the pass committed gets no notice.
     */
    function settleUnsavable(plan: SavePlan): void {
        if (unsavable.size === 0 && plan.skipped.length === 0) {
            return
        }
        const before = new Set(unsavable.keys())
        for (const skipped of plan.skipped) {
            unsavable.set(skipped.chaId, skipped)
        }
        for (const chaId of plan.encoded) {
            unsavable.delete(chaId)
        }
        const present = presentChaIds(port.getDatabase())
        for (const chaId of [...unsavable.keys()]) {
            if (!present.has(chaId)) {
                unsavable.delete(chaId)
            }
        }
        const current = [...unsavable.values()]
        const newly = plan.skipped.filter(skipped => !before.has(skipped.chaId) && unsavable.has(skipped.chaId))
        const changed = before.size !== unsavable.size || current.some(entry => !before.has(entry.chaId))
        if (!changed && newly.length === 0) {
            return
        }
        try {
            port.unsavable(current, newly)
        } catch (error) {
            // A notice that fails must not turn a pass that saved into a failed one.
            console.error(error)
        }
    }

    /** `attemptRun` with the gap recorder closed on every exit, a throw included, before the pass's own waits begin. */
    async function attemptOf(run: PassRun, tick: boolean, netChaId: string | null): Promise<Outcome> {
        try {
            return await attemptRun(run, tick, netChaId)
        } finally {
            if (MEASURE) {
                activeGaps?.finish()
                activeGaps = null
            }
        }
    }

    async function attemptRun(run: PassRun, tick: boolean, netChaId: string | null): Promise<Outcome> {
        if (MEASURE && !tick) {
            noteSignalPassStart()
        }
        run.snapshot = tick ? null : takeStore2Snapshot(port)
        const read = await committer.readCommit()
        peerSignal = false
        const judged = judge(read)
        if (judged.kind === 'stop' && !(consent !== null && judged.reason === 'peer-commit' && judged.key?.epoch === consent)) {
            return { kind: 'park', park: parkOf(judged) }
        }
        const saveMine = judged.kind === 'stop'
        if (!saveMine) {
            consent = null
        }
        const db = port.getDatabase()
        if (MEASURE && tick) {
            noteSignalPassStart()
        }
        const planRequest = requestOf(run.snapshot, db, saveMine, netChaId)
        run.moduleScope = planRequest.whole || planRequest.rewriteAll === true || planRequest.modules || planRequest.net?.modules === true
        let plan: SavePlan
        try {
            const planned = await planOf(db, planRequest)
            plan = planned.plan
            if (planned.moduleRefusal !== null) {
                // Folded before the commit so that every later outcome keeps it: the held module changes are retried by
                // each marked pass until the refusal is gone, and the page stays dirty meanwhile. It sets dirty only and
                // makes no pass due, so the idle net and the character cadence keep running. A tick folds it too, so a
                // refusal found without any mark still keeps the page dirty.
                run.moduleRefusal = planned.moduleRefusal
                port.tracker.modules = true
                port.markUnsaved?.()
            }
        } catch (error) {
            if (error instanceof ModuleLoadDeferred) {
                return { kind: 'deferred', settled: error.settled }
            }
            throw error
        }
        run.plan = plan
        if (MEASURE) {
            activeGaps?.planned()
        }
        // A page that is asked to overwrite a peer's commit has something to write even when it changed nothing.
        if (plan.unchanged && !forced && !saveMine) {
            if (MEASURE) {
                noteSignalUnchanged(plan.encoded)
            }
            return { kind: 'saved', wrote: false }
        }
        const planned = plan.commitRequest()
        const request = MEASURE && activeGaps !== null ? activeGaps.wrapBuild(planned) : planned
        const result = saveMine ? await committer.saveMine(read, request) : await committer.commit(read, request)
        if (MEASURE) {
            activeGaps?.committed()
        }
        if (result.status === 'refused' && result.reason === 'marker-present') {
            // A marker of this page load that an earlier bulk could not clear would refuse every later bulk.
            if (MEASURE) {
                activeGaps?.pause()
            }
            const cleared = await clearOwnMarker(read)
            if (MEASURE) {
                activeGaps?.resume()
            }
            // A clear refused because a newer page owns the generation never succeeds on this page: it is replaced, not retried.
            if ((cleared?.status === 'failed' || cleared?.status === 'unknown') && cleared.cause instanceof Store2StalePageError) {
                return { kind: 'park', park: parkOf({ kind: 'stop', reason: 'replaced', key: null, revision: false }) }
            }
        }
        if (result.status === 'refused' && result.reason === 'base-unnamed') {
            // The final write of a bulk commit was refused and its own-marker clear did not land: the marker may still stand.
            if (result.cleared != null && result.cleared.status !== 'cleared' && result.cleared.status !== 'nothing') {
                markerPending = true
            }
            if (saveMine && judged.kind === 'stop') {
                // The refused write never reached the compare-and-write, so `judged` is still the base.
                const next = parkOf(judged)
                next.blocked = blockedOf(plan)
                return { kind: 'park', park: next }
            }
            let fresh: Judged | null = null
            try {
                fresh = judge(await committer.readCommit())
            } catch (error) {
                console.error(error)
            }
            return fresh !== null && fresh.kind === 'stop'
                ? { kind: 'park', park: parkOf(fresh) }
                : { kind: 'retry', reason: result.reason, detail: result.detail }
        }
        return outcomeOf(result, plan, run)
    }

    function foldBack(snapshot: Store2Snapshot | null): void {
        if (snapshot === null) {
            return
        }
        port.mergeBack(port.tracker, snapshot.toSave)
        if (snapshot.whole) {
            port.reloadFlag.state = true
        }
        port.requestPass()
    }

    /**
     * Tells the person about a module stub the pass went on without, once per module id. Outside the write lock and
     * never awaited; a handler that throws is logged, because a notice must not turn a pass that saved into a failed one.
     */
    function announceModuleRefusal(refusal: StubRefusedError | null): void {
        if (refusal === null || refusal.kind !== 'module') {
            return
        }
        const moduleId = refusal.chaId
        try {
            if (refusal.reason === 'edited') {
                if (editedAnnounced !== moduleId) {
                    editedAnnounced = moduleId
                    console.error(refusal)
                    context.peer.moduleEdited({ moduleId, moduleName: refusal.moduleName }, () => editedAnnounced === moduleId)
                }
            } else if (unsavedAnnounced !== moduleId) {
                unsavedAnnounced = moduleId
                console.error(refusal)
                context.peer.moduleNotSaved({ moduleId, moduleName: refusal.moduleName })
            }
        } catch (error) {
            console.error(error)
        }
    }

    /**
     * A back-off after a pass or a peer read. `rearmWait` ends it on a save request and keeps that request for the wait
     * after the pass; without it the back-off is the plain timed sleep. The delay is computed by the caller, once.
     */
    function backOff(ms: number): Promise<unknown> {
        return port.rearmWait !== undefined ? port.rearmWait(ms) : port.sleep(ms)
    }

    /** A tick that judged or planned a change and ended in a park or a stop has no mark to fold back: the page is marked unsaved instead. */
    function markUnlandedTick(run: PassRun, tick: boolean, netChaId: string | null): void {
        if (tick && !run.landed && (netChaId !== null || (run.plan !== null && !run.plan.unchanged))) {
            port.markUnsaved?.()
        }
    }

    async function pass(tick: boolean, netChaId: string | null = null): Promise<void> {
        const run: PassRun = { snapshot: null, landed: false, plan: null, moduleRefusal: null, moduleScope: false }
        if (!tick) {
            port.beginIteration()
        }
        try {
            const outcome = await port.withWriteLock(() => attemptOf(run, tick, netChaId))
            announceModuleRefusal(run.moduleRefusal)
            switch (outcome.kind) {
                case 'saved':
                    retries = 0
                    if (run.moduleScope && run.moduleRefusal === null) {
                        // Only a pass that planned the modules proves no stub blocks them; a character-only pass or a
                        // degraded one says nothing, so the person is not asked again while the same stub stands.
                        editedAnnounced = null
                        unsavedAnnounced = null
                    }
                    if (run.plan !== null) {
                        settleUnsavable(run.plan)
                    }
                    if (!tick || outcome.wrote) {
                        port.saved()
                    }
                    break
                case 'retry':
                    retries += 1
                    foldBack(run.snapshot)
                    if (retries <= QUIET_RETRIES) {
                        await backOff(1000)
                        break
                    }
                    // A run of retries that does not end is a failed save: the person is told and the attempts are counted.
                    savetrys += 1
                    const refusedDelay = port.reportFailure(new Store2CommitRefusedError(outcome.reason, outcome.detail), savetrys)
                    await backOff(refusedDelay)
                    break
                case 'deferred': {
                    // Quiet by design: no counter, no report, no sleep. The marks are kept so the page stays dirty, and
                    // the loop plans nothing until the flight settles, then makes one pass over the installed module.
                    foldBack(run.snapshot)
                    const clearDeferral = (): void => {
                        if (deferral === waiting) {
                            deferral = null
                        }
                    }
                    const waiting: Promise<void> = outcome.settled.then(clearDeferral, clearDeferral)
                    deferral = waiting
                    break
                }
                case 'park':
                    retries = 0
                    foldBack(run.snapshot)
                    markUnlandedTick(run, tick, netChaId)
                    setPark(outcome.park)
                    break
                case 'stop':
                    retries = 0
                    foldBack(run.snapshot)
                    markUnlandedTick(run, tick, netChaId)
                    stopForTooLarge(outcome.cause, outcome.label, outcome.cleared)
                    break
                case 'not-flushed':
                    // The snapshot's data is in the store: nothing is folded back, and the next pass writes again. The
                    // commit landed and is acknowledged, so what it skipped is settled now: the next pass does not
                    // necessarily name a skipped saved character. The retry is arranged first, so a settle cannot drop it.
                    forced = true
                    savetrys += 1
                    port.requestPass()
                    if (run.plan !== null) {
                        settleUnsavable(run.plan)
                    }
                    const notFlushedDelay = backedOffWait(port.reportFailure(new Store2NotFlushedError(), savetrys), savetrys)
                    await backOff(notFlushedDelay)
                    break
            }
        } catch (error) {
            retries = 0
            // A throw after the degraded plan (a commit that landed, a failed hand-off) still tells the person once.
            announceModuleRefusal(run.moduleRefusal)
            if (!run.landed && error instanceof StubRefusedError && error.kind === 'module' && error.reason === 'edited') {
                // Reached only when the acknowledged encoding holds no module set to carry. Outside the write lock. The
                // marks are kept, so the edit is never dropped; the prompt is not awaited, and the wait is the
                // request-interruptible one so a hide or Back flush still retries at once.
                savetrys += 1
                foldBack(run.snapshot)
                announceModuleRefusal(error)
                const editedDelay = port.reportFailure(error, savetrys)
                await (port.rearmWait !== undefined ? port.rearmWait(editedDelay) : port.wait(editedDelay))
            } else if (!run.landed) {
                savetrys += 1
                foldBack(run.snapshot)
                const failedDelay = port.reportFailure(error, savetrys)
                await backOff(failedDelay)
            } else {
                const landedDelay = port.reportUncountedFailure(error, 5)
                await backOff(landedDelay)
            }
        } finally {
            if (!tick) {
                port.endIteration()
            }
        }
    }

    async function checkPeer(): Promise<void> {
        peerSignal = false
        try {
            const read = await port.withWriteLock(() => committer.readCommit())
            const judged = judge(read)
            // The epoch the person agreed to overwrite is not a new peer commit: a deferral that gates the pass must not
            // make this check clear the consent and ask again.
            if (judged.kind === 'stop' && !(consent !== null && judged.reason === 'peer-commit' && judged.key?.epoch === consent)) {
                setPark(parkOf(judged))
            }
        } catch (error) {
            console.error(error)
            peerSignal = true
            await backOff(1000)
        }
    }

    /** What an idle-net slot does: nothing, a full tick, or a silent pass that names one judged character. */
    type NetDecision = { kind: 'none' } | { kind: 'full' } | { kind: 'character', chaId: string }

    /**
     * Decides one idle-net slot without planning. Order matters: the checks a full pass would answer by loading, writing
     * or refusing come before any verdict, because a verdict reads only the acknowledged encoding of one character.
     * The peer is read here, never through `checkPeer`: a failed read must not leave `peerSignal` set, and the full tick
     * it falls back to reads again and reports the failure itself. A slot that reaches the verdict yields once first and
     * re-checks only what the yield can change: a pass became due, or the database object was replaced.
     */
    async function netDecision(): Promise<NetDecision> {
        const modulesDue = port.now() - lastModuleNetAt >= moduleMs
        if (modulesDue || consent !== null) {
            if (MEASURE) {
                noteNetSlotEnd(modulesDue ? 'modulesDue' : 'consent')
            }
            return { kind: 'full' }
        }
        const lockRequestedAt = MEASURE ? performance.now() : 0
        // The measured read notes the lock wait when the lock is granted and the read time even when the read throws.
        const readUnderLock = MEASURE
            ? async () => {
                const lockedAt = performance.now()
                noteNetSlotPart('lockWaitMs', lockedAt - lockRequestedAt)
                try {
                    return await committer.readCommit()
                } finally {
                    noteNetSlotPart('readMs', performance.now() - lockedAt)
                }
            }
            : () => committer.readCommit()
        const read = await port.withWriteLock(readUnderLock)
        const judgeStartedAt = MEASURE ? performance.now() : 0
        const judged = judge(read)
        if (MEASURE) {
            noteNetSlotPart('judgeMs', performance.now() - judgeStartedAt)
            netJudgeStartedAt = judgeStartedAt
            netReadDone = true
        }
        if (judged.kind === 'stop') {
            setPark(parkOf(judged))
            if (MEASURE) {
                noteNetSlotEnd('parked')
            }
            return { kind: 'none' }
        }
        if (port.isDue()) {
            if (MEASURE) {
                noteNetSlotEnd('dueAfterRead')
            }
            return { kind: 'none' }
        }
        if (encoder.pendingKey !== null) {
            if (MEASURE) {
                noteNetSlotEnd('pending')
            }
            return { kind: 'full' }
        }
        const db = port.getDatabase()
        const checksStartedAt = MEASURE ? performance.now() : 0
        // Each check's sub-part runs from the previous check's end, and an exit closes `checksMs` at the same clock read as
        // its last sub-part, so the sub-parts sum to `checksMs`; a check the slot did not run leaves its sub-part null.
        let checkLapAt = checksStartedAt
        // Where the prune's lap began, which a yielding slot's `pruneMs` measures from.
        let pruneLapAt = checksStartedAt
        // One pass answers the unheld, stub and resident checks; unheld is the first exit, as when they ran apart.
        const scan = encoder.netScan(db)
        if (MEASURE) {
            const scanDoneAt = performance.now()
            noteNetSlotPart('scanMs', scanDoneAt - checkLapAt)
            checkLapAt = scanDoneAt
        }
        if (scan.unheld || scan.stubsNeedFull) {
            if (MEASURE) {
                noteNetSlotPart('checksMs', checkLapAt - checksStartedAt)
                noteNetSlotEnd(scan.unheld ? 'unheld' : 'stub')
            }
            return { kind: 'full' }
        }
        if (unsavable.size > 0) {
            const present = presentChaIds(db)
            for (const chaId of unsavable.keys()) {
                if (!present.has(chaId)) {
                    if (MEASURE) {
                        const checksDoneAt = performance.now()
                        noteNetSlotPart('unsavableMs', checksDoneAt - checkLapAt)
                        noteNetSlotPart('checksMs', checksDoneAt - checksStartedAt)
                        noteNetSlotEnd('unsavableAbsent')
                    }
                    return { kind: 'full' }
                }
            }
            if (MEASURE) {
                const unsavableDoneAt = performance.now()
                noteNetSlotPart('unsavableMs', unsavableDoneAt - checkLapAt)
                checkLapAt = unsavableDoneAt
            }
        }
        const residents = scan.residents
        // Before any early return: a slot that ends here with no resident left must still release the shadow of a character
        // that was put back. Its own lap, so the sub-parts still sum to `checksMs`.
        const residentSet = new Set(residents)
        encoder.pruneShadows(residentSet)
        for (const clockId of cleanVerdictAt.keys()) {
            if (!residentSet.has(clockId)) {
                cleanVerdictAt.delete(clockId)
            }
        }
        if (MEASURE) {
            const pruneDoneAt = performance.now()
            noteNetSlotPart('pruneMs', pruneDoneAt - checkLapAt)
            pruneLapAt = checkLapAt
            checkLapAt = pruneDoneAt
            noteSignalResidents(residents.length)
        }
        if (residents.length === 0) {
            if (MEASURE) {
                noteNetSlotPart('checksMs', checkLapAt - checksStartedAt)
                noteNetSlotEnd('noResident')
            }
            return { kind: 'none' }
        }
        // One yield before the verdict, so the work above and the work below are separate stretches of the event loop. It
        // sits before the `netIndex` advance: a slot that leaves at `dueAfterYield` or `dbChanged` uses no resident's turn.
        // This loop is suspended during the yield, so `previous`'s identity, `pendingKey`, the shadow map, `netIndex`,
        // `cleanVerdictAt`, `lastModuleNetAt`, `unsavable`, `park` and `consent` cannot change; `pageHidden` and
        // `takeNetSweep` are the page's and are read after it; character loads may fill missing unit digests
        // in place, which depends only on the bytes and does not change a verdict. The write lock is not held across it.
        // `pruneMs` ends at the yield (the `noResident` check falls inside it) and `checksMs` is closed up to it; a later
        // exit that runs the `find` adds `findMs` to it, and one that does not leaves it as it is.
        const yieldCalledAt = MEASURE ? performance.now() : 0
        if (MEASURE) {
            netYieldCalledAt = yieldCalledAt
            noteNetSlotPart('pruneMs', yieldCalledAt - pruneLapAt)
            noteNetSlotPart('checksMs', yieldCalledAt - checksStartedAt)
        }
        let resumedAt = 0
        try {
            // A hidden Android page may be frozen inside the yield, which would hold the slot until the user returns.
            if (port.yieldImmediately?.() !== true) {
                await (port.yieldNow !== undefined ? port.yieldNow() : yieldToEventLoop())
            }
        } finally {
            // Read right after the await, also when it rejects: a rejection is a throw after the yield, whose span B starts here.
            if (MEASURE) {
                resumedAt = performance.now()
                netResumedAt = resumedAt
            }
        }
        // A hide or Back asked for a sweep: every resident is verdicted at its next turn. Consumed on every slot that passes the yield.
        if (port.takeNetSweep?.() === true) {
            cleanVerdictAt.clear()
        }
        if (port.isDue()) {
            if (MEASURE) {
                noteNetSlotEnd('dueAfterYield')
            }
            return { kind: 'none' }
        }
        // A different database object appeared during the yield. A restore's installed path keeps the write lock closed by
        // design until the reload, so neither answer changes that; `none` skips a verdict on a database this slot did not scan.
        if (port.getDatabase() !== db) {
            if (MEASURE) {
                noteNetSlotEnd('dbChanged')
            }
            return { kind: 'none' }
        }
        const index = netIndex % residents.length
        netIndex = (index + 1) % residents.length
        const chaId = residents[index]
        const cleanAt = cleanVerdictAt.get(chaId)
        cleanVerdictAt.delete(chaId)
        if (unsavable.has(chaId)) {
            if (MEASURE) {
                noteNetSlotEnd('verdictUnknown', 'unknown')
                noteSignalVerdict(chaId, 'unknown', null)
            }
            return { kind: 'character', chaId }
        }
        const slot = (db.characters as Array<character | groupChat | null>).find(
            (candidate): candidate is character | groupChat => typeof candidate === 'object' && candidate !== null && !isColdStub(candidate)
                && String((candidate as { chaId?: unknown }).chaId ?? '') === chaId)
        if (MEASURE) {
            const findDoneAt = performance.now()
            noteNetSlotPart('findMs', findDoneAt - resumedAt)
            noteNetSlotPart('checksMs', (yieldCalledAt - checksStartedAt) + (findDoneAt - resumedAt))
        }
        if (slot === undefined) {
            if (MEASURE) {
                noteNetSlotEnd('slotMissing')
                noteSignalVerdict(chaId, 'unknown', null)
            }
            return { kind: 'full' }
        }
        // The verdict alone is skipped: everything above ran as on the base, and the rotation has advanced. The old clock
        // goes back unchanged so the age counts from the last real verdict. A hidden page never skips.
        if (cleanAt !== undefined && backstopMs > 0 && !(port.pageHidden?.() ?? false)) {
            const age = port.now() - cleanAt
            if (age >= 0 && age < backstopMs) {
                cleanVerdictAt.set(chaId, cleanAt)
                if (MEASURE) {
                    noteSignalSkipped(chaId)
                    noteNetSlotEnd('verdictSkipped')
                }
                return { kind: 'none' }
            }
        }
        const verdictStartedAt = MEASURE ? performance.now() : 0
        const verdict = encoder.verdictOf(slot)
        if (verdict === 'clean') {
            cleanVerdictAt.set(chaId, port.now())
        }
        if (MEASURE) {
            const verdictDoneAt = performance.now()
            noteNetSlotPart('verdictMs', verdictDoneAt - verdictStartedAt)
            noteSignalVerdict(chaId, verdict, verdictDoneAt)
            noteNetSlotEnd(verdict === 'clean' ? 'verdictClean' : verdict === 'dirty' ? 'verdictDirty' : 'verdictUnknown', verdict)
        }
        return verdict === 'clean' ? { kind: 'none' } : { kind: 'character', chaId }
    }

    /**
     * One idle-net slot. Modules due, a pending attempt, a character or stub the full pass would load or write, and any
     * fault in the checks all take the full tick; otherwise one resident character is judged against the acknowledged
     * encoding and only a character that differs is passed, silently, with no mark and no indicator.
     */
    async function netSlot(): Promise<void> {
        let decision: NetDecision
        const decisionStartedAt = MEASURE ? performance.now() : 0
        if (MEASURE) {
            netReadDone = false
            netJudgeStartedAt = null
            netYieldCalledAt = null
            netResumedAt = null
            noteNetSlotBegin()
        }
        try {
            decision = await netDecision()
        } catch (error) {
            console.error(error)
            if (MEASURE) {
                noteNetSlotEnd(netReadDone ? 'guardThrow' : 'readFailed')
            }
            decision = { kind: 'full' }
        }
        // The one end-of-decision read, shared by the normal exits and the guard's catch. A slot that reached `judge` splits
        // into span A (judge start to the yield, or to this read when it exited before the yield), the yield, and span B
        // (the resume to this read); a slot that failed its read or took the full tick before `judge` has none of the three.
        const decisionEndAt = MEASURE ? performance.now() : 0
        if (MEASURE) {
            if (netJudgeStartedAt !== null) {
                noteNetSlotPart('spanAMs', (netYieldCalledAt ?? decisionEndAt) - netJudgeStartedAt)
                if (netYieldCalledAt !== null && netResumedAt !== null) {
                    noteNetSlotPart('yieldMs', netResumedAt - netYieldCalledAt)
                    noteNetSlotPart('spanBMs', decisionEndAt - netResumedAt)
                }
            }
            noteSignalSlotClock(decisionStartedAt, decisionEndAt)
            noteNetSlotMs(decisionEndAt - decisionStartedAt)
        }
        const passStartedAt = MEASURE ? performance.now() : 0
        if (decision.kind === 'full') {
            await pass(true)
        } else if (decision.kind === 'character') {
            await pass(true, decision.chaId)
        }
        if (MEASURE && decision.kind !== 'none') {
            noteNetSlotPassMs(performance.now() - passStartedAt)
        }
    }

    async function loop(): Promise<never> {
        await port.wait(1000)
        while (true) {
            port.sweep()
            if (stopped) {
                // Nothing else runs: only this page load's own marker is still released, on the retry interval.
                if (markerPending) {
                    await port.withWriteLock(releaseOwnMarkerWhileStopped)
                    await port.sleep(1000)
                } else {
                    await port.wait(500)
                }
                continue
            }
            if (port.peerHeard()) {
                peerSignal = true
            }
            port.liveCheck()
            if (park !== null) {
                // A refused bulk whose own-marker clear did not land would otherwise keep a marker standing for peers while parked.
                if (markerPending) {
                    await port.withWriteLock(releaseOwnMarkerWhileStopped)
                }
                await settlePark()
                if (park !== null) {
                    await port.wait(500)
                    continue
                }
            }
            if (port.isDue() && deferral === null) {
                await pass(false)
                await port.wait(500)
                continue
            }
            if (peerSignal) {
                await checkPeer()
                await port.wait(500)
                continue
            }
            if (netMs !== null && deferral === null && port.now() - lastNetAt >= netMs) {
                lastNetAt = port.now()
                if (MEASURE && netHeldNow()) {
                    noteNetHeldTick()
                } else if (MEASURE) {
                    const tickStartedAt = port.now()
                    await netSlot()
                    noteNetPassTick(port.now() - tickStartedAt)
                } else {
                    await netSlot()
                }
            }
            // Over a deferral the loop wakes the moment the flight settles instead of at its next turn.
            await (deferral === null ? port.wait(500) : Promise.race([deferral, port.wait(500)]))
        }
    }

    return loop()
}
