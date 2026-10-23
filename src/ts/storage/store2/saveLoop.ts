import type { Database, character, groupChat } from '../database.svelte'
import type { toSaveType } from '../risuSave'
import { createYieldBudget } from '../saveYield'
import { Store2StalePageError } from './backend/errors'
import type { Store2Read } from './backend/types'
import { MEASURE } from '../../process/memory/measureFlag'
import { netHeldNow, noteNetHeldTick, noteNetPassTick } from '../measureExportHold'
import { isColdStub, SharedChaIdStubError, StubRefusedError } from './codec'
import type { AbandonResult, CommitResult, Committer } from './commit'
import { classifyCommitRead } from './commitKey'
import type { CommitKey } from './format'
import type { Store2SaveContext } from './saveActive'
import { createSaveEncoder, type SavePassRequest, type SavePlan } from './saveEncoder'
import { noteNetSlotEnd, noteNetSlotMs, noteNetSlotPassMs, peekSaveMarks } from './savePassMeter'
import { startYieldGaps, type YieldGapRecorder } from './saveYieldMeter'

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
    saveMineUnavailable?: 'node' | 'replaced' | 'unloaded-characters'
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

export interface Store2PeerHandler {
    /**
     * Parked with nothing unsaved: only the reload action exists. Nothing is awaited. The prompt may be answered long
     * after the tab was found clean, so `live()` is read when Reload is pressed. Reload reloads only while the page is
     * still parked and not dirty. A tab that has become dirty reloads nothing and the prompt closes; the loop then asks
     * `decide` with the unsaved wording, on its next iteration at the latest, because `asked` is still false. Typed text
     * is not a dirty edit: it never reaches `decide`, so the prompt itself warns that a reload discards it.
     */
    parkedClean(prompt: PeerParkPrompt, live: () => PeerLiveState): void
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
    reload(): void
}

export interface IdleNetOptions {
    intervalMs: number
    /** The least time between two ticks that take module scope; defaults to `IDLE_NET_MODULE_INTERVAL_MS`. */
    moduleIntervalMs?: number
}

/** The idle net's default cadence: one resident character per tick. */
export const IDLE_NET_INTERVAL_MS = 2000

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
function residentChaIds(db: Database): string[] {
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
}

type Outcome =
    | { kind: 'saved', wrote: boolean }
    /** The pass did not land and nothing says it never will: counted, and reported when it persists. */
    | { kind: 'retry', reason: string, detail: string }
    | { kind: 'park', park: Park }
    | { kind: 'not-flushed' }

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

/**
 * Whether this page's save loop is parked on a commit it did not make. A read only: it changes nothing, and answers
 * `false` while no loop runs (a read-only or legacy page has none).
 */
export function isSaveLoopParked(): boolean {
    return readParked !== null && readParked()
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

    let savetrys = 0
    let retries = 0
    let park: Park | null = null
    readParked = () => park !== null
    /** The epoch the person agreed to overwrite with Save mine. */
    let consent: string | null = null
    /** A commit reported that it was not flushed: the next pass commits even when it changed nothing. */
    let forced = false
    let peerSignal = false
    let netIndex = 0
    let lastNetAt = port.now()
    /** When a tick last took module scope; the next such tick is `moduleMs` later, whatever the first one came to. */
    let lastModuleNetAt = port.now()
    /** The gap recorder of the attempt in flight, a measurement build only; one attempt runs at a time under the write lock. */
    let activeGaps: YieldGapRecorder | null = null
    /** Whether the current idle-net slot's base read and judgement finished, a measurement build only; it tells a failed read from a later fault. */
    let netReadDone = false
    /**
     * The characters the latest attempts whose commit landed could not encode. A character leaves it when a pass encodes
     * it, or when it is no longer in the database; an attempt whose commit did not land changes nothing here.
     */
    const unsavable = new Map<string, UnsavableCharacter>()

    function namedByBase(key: CommitKey): boolean {
        const mine = encoder.manifestKey
        return key.current?.key === mine || key.retained.some(entry => entry.key === mine) || key.pins.some(pin => pin.key === mine)
    }

    /** Whether the page may save over this base. A pending attempt that is the base's `current` is adopted here, before any plan. */
    function judge(read: Store2Read): Judged {
        const classified = classifyCommitRead(read)
        const revision = read.token.kind === 'revision'
        if (classified.status !== 'parsed' || classified.value.current === null) {
            return { kind: 'stop', reason: 'replaced', key: classified.status === 'parsed' ? classified.value : null, revision }
        }
        const current = classified.value.current.key
        if (current === encoder.manifestKey || encoder.adoptIfCurrent(current)) {
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
        }
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
        if (encoder.hasStubs(port.getDatabase()) && !parked.namedMine) {
            return { reason: parked.reason, unsaved, offers: ['reload'], saveMineUnavailable: 'unloaded-characters' }
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
            park = null
            port.setStopped('')
            return
        }
        const next = parkOf(judged)
        if (next.epoch === parked.epoch && next.reason === parked.reason) {
            return
        }
        next.noticed = parked.noticed
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
        if (!port.isDirty()) {
            if (!parked.noticed) {
                parked.noticed = true
                context.peer.parkedClean(promptOf(parked, false), () => ({
                    parked: park !== null,
                    dirty: port.isDirty(),
                    drafts: port.hasDrafts(),
                }))
            }
            return
        }
        if (parked.asked) {
            return
        }
        parked.asked = true
        const prompt = promptOf(parked, true)
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
            park = null
            port.setStopped('')
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
        const budget = MEASURE && gaps !== null ? createYieldBudget({ yieldFn: () => gaps.yield() }) : createYieldBudget()
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
        return { marked: new Set(), modules: false, whole: false, net: { chaId: residents[index], modules: modulesDue }, ...yielding }
    }

    async function planOf(db: Database, request: SavePassRequest): Promise<SavePlan> {
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
                throw result.cause
            case 'abandoned':
                if (result.cause === undefined) {
                    return { kind: 'retry', reason: result.reason, detail: 'The bulk commit did not land.' }
                }
                if (result.cause instanceof Store2StalePageError) {
                    return { kind: 'park', park: parkOf({ kind: 'stop', reason: 'replaced', key: null, revision: false }) }
                }
                throw result.cause
            case 'unknown':
                plan.keepAsPending()
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
    async function attemptOf(run: { snapshot: Store2Snapshot | null, landed: boolean, plan: SavePlan | null }, tick: boolean, netChaId: string | null): Promise<Outcome> {
        try {
            return await attemptRun(run, tick, netChaId)
        } finally {
            if (MEASURE) {
                activeGaps?.finish()
                activeGaps = null
            }
        }
    }

    async function attemptRun(run: { snapshot: Store2Snapshot | null, landed: boolean, plan: SavePlan | null }, tick: boolean, netChaId: string | null): Promise<Outcome> {
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
        const plan = await planOf(db, requestOf(run.snapshot, db, saveMine, netChaId))
        run.plan = plan
        if (MEASURE) {
            activeGaps?.planned()
        }
        // A page that is asked to overwrite a peer's commit has something to write even when it changed nothing.
        if (plan.unchanged && !forced && !saveMine) {
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

    async function pass(tick: boolean, netChaId: string | null = null): Promise<void> {
        const run: { snapshot: Store2Snapshot | null, landed: boolean, plan: SavePlan | null } = { snapshot: null, landed: false, plan: null }
        if (!tick) {
            port.beginIteration()
        }
        try {
            const outcome = await port.withWriteLock(() => attemptOf(run, tick, netChaId))
            switch (outcome.kind) {
                case 'saved':
                    retries = 0
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
                        await port.sleep(1000)
                        break
                    }
                    // A run of retries that does not end is a failed save: the person is told and the attempts are counted.
                    savetrys += 1
                    await port.sleep(port.reportFailure(new Store2CommitRefusedError(outcome.reason, outcome.detail), savetrys))
                    break
                case 'park':
                    retries = 0
                    foldBack(run.snapshot)
                    setPark(outcome.park)
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
                    await port.sleep(backedOffWait(port.reportFailure(new Store2NotFlushedError(), savetrys), savetrys))
                    break
            }
        } catch (error) {
            retries = 0
            if (!run.landed) {
                savetrys += 1
                foldBack(run.snapshot)
                await port.sleep(port.reportFailure(error, savetrys))
            } else {
                await port.sleep(port.reportUncountedFailure(error, 5))
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
            if (judged.kind === 'stop') {
                setPark(parkOf(judged))
            }
        } catch (error) {
            console.error(error)
            peerSignal = true
            await port.sleep(1000)
        }
    }

    /** What an idle-net slot does: nothing, a full tick, or a silent pass that names one judged character. */
    type NetDecision = { kind: 'none' } | { kind: 'full' } | { kind: 'character', chaId: string }

    /**
     * Decides one idle-net slot without planning. Order matters: the checks a full pass would answer by loading, writing
     * or refusing come before any verdict, because a verdict reads only the acknowledged encoding of one character.
     * The peer is read here, never through `checkPeer`: a failed read must not leave `peerSignal` set, and the full tick
     * it falls back to reads again and reports the failure itself.
     */
    async function netDecision(): Promise<NetDecision> {
        const modulesDue = port.now() - lastModuleNetAt >= moduleMs
        if (modulesDue || consent !== null) {
            if (MEASURE) {
                noteNetSlotEnd(modulesDue ? 'modulesDue' : 'consent')
            }
            return { kind: 'full' }
        }
        const read = await port.withWriteLock(() => committer.readCommit())
        const judged = judge(read)
        if (MEASURE) {
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
        const unheld = encoder.unheldChaIds(db).length > 0
        if (unheld || encoder.stubsNeedFullPass(db)) {
            if (MEASURE) {
                noteNetSlotEnd(unheld ? 'unheld' : 'stub')
            }
            return { kind: 'full' }
        }
        if (unsavable.size > 0) {
            const present = presentChaIds(db)
            for (const chaId of unsavable.keys()) {
                if (!present.has(chaId)) {
                    if (MEASURE) {
                        noteNetSlotEnd('unsavableAbsent')
                    }
                    return { kind: 'full' }
                }
            }
        }
        const residents = residentChaIds(db)
        if (residents.length === 0) {
            if (MEASURE) {
                noteNetSlotEnd('noResident')
            }
            return { kind: 'none' }
        }
        const index = netIndex % residents.length
        netIndex = (index + 1) % residents.length
        const chaId = residents[index]
        if (unsavable.has(chaId)) {
            if (MEASURE) {
                noteNetSlotEnd('verdictUnknown', 'unknown')
            }
            return { kind: 'character', chaId }
        }
        const slot = (db.characters as Array<character | groupChat | null>).find(
            (candidate): candidate is character | groupChat => typeof candidate === 'object' && candidate !== null && !isColdStub(candidate)
                && String((candidate as { chaId?: unknown }).chaId ?? '') === chaId)
        if (slot === undefined) {
            if (MEASURE) {
                noteNetSlotEnd('slotMissing')
            }
            return { kind: 'full' }
        }
        const verdict = encoder.verdictOf(slot)
        if (MEASURE) {
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
        if (MEASURE) {
            noteNetSlotMs(performance.now() - decisionStartedAt)
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
            if (port.peerHeard()) {
                peerSignal = true
            }
            port.liveCheck()
            if (park !== null) {
                await settlePark()
                if (park !== null) {
                    await port.wait(500)
                    continue
                }
            }
            if (port.isDue()) {
                await pass(false)
                await port.wait(500)
                continue
            }
            if (peerSignal) {
                await checkPeer()
                await port.wait(500)
                continue
            }
            if (netMs !== null && port.now() - lastNetAt >= netMs) {
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
            await port.wait(500)
        }
    }

    return loop()
}
