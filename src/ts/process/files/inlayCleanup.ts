/**
 * Deletes the inlays of a chat or character that has just been deleted, when
 * nothing left in the profile can still show them.
 *
 * Invariants:
 * - Only the four delete paths queue work (`removeChatConfirmed`,
 *   `removeChar` with a permanent removal, `removeTrashedCharacters`, the boot
 *   purge of long-trashed characters). Every other removal leaves its inlays
 *   behind, which costs space only.
 * - Candidates are the ids in literal inlay tokens of the deleted data, including
 *   the cold units that data points at.
 * - A candidate is deleted only when its id occurs, as a substring, in no string
 *   of the remaining database and of no cold unit reachable from it. Any cold
 *   unit that cannot be read, or cannot be told apart from an absent one, makes
 *   the set of kept ids incomplete and nothing is deleted.
 * - Nothing is deleted before the removal is in the store: every delete is
 *   preceded by a synchronous check that the save loop is clean and that no
 *   save has been requested since the walk started.
 * - No deletion runs while another tab of the page is open, while any registered
 *   busy action (a backup being loaded or made, an import) is running, or where
 *   Web Locks cannot say whether another tab exists.
 * - The walk bounds its own stretches: it reads the clock every `CHECK_EVERY`
 *   work units (one per value, one per KiB of text), gives the event loop a turn
 *   once `SLICE_MS` has passed, and scans a string longer than `CHUNK_CHARS` in
 *   pieces. It does
 *   not bound the decode of one cold unit (decompression is asynchronous, but
 *   `JSON.parse` of the whole unit is one piece inside the unit reader), the
 *   time of one piece, or the work of the page's other code. Cold units are read
 *   one at a time and dropped before the next.
 * - Repeat deletions do not re-read units that have not changed: a scanned unit
 *   is remembered as the uuids and asset hashes it holds (never its text) for as
 *   long as this page has not written or deleted it. A remembered unit that is
 *   missing from the store, or whose summary cannot answer for an id, is read.
 * - Every failure is logged and ends in "nothing deleted".
 */
import { getDatabase, type Chat, type character, type Database, type groupChat } from "../../storage/database.svelte";
import { afterNextSaveCommit, getSaveMarkCount, isSaveClean, locksSupported } from "../../globalApi.svelte";
import { isRestorableColdStorageKey, listColdBackupRoots, listInnerColdStorageKeys, type ColdStorageInnerKey } from "../coldstorageData";
import { isBusy } from "../memory/busyActions";
import { inlayTokenRegex } from "../../util/inlayTokens";
import { STORAGE_TAB_LOCK_NAME } from "../../storage/storageTabLocks";

/** Longest stretch of walking, measured by the clock, before the walk gives the event loop a turn. */
const SLICE_MS = 40
/** Work units (one per value, one per KiB of text) between two clock readings. */
const CHECK_EVERY = 128
/** The most text one scan covers before the clock is read again. */
export const CHUNK_CHARS = 65_536
/** How far consecutive pieces of a long string overlap when token ids are collected. */
const TOKEN_OVERLAP = 1024
/** The most uuids and asset hashes remembered for one unit, and for all units together. */
const MAX_UNIT_IDS = 4096
const MAX_TOTAL_IDS = 100_000
/** How often a pending batch looks at the save loop, and how many looks it makes after a commit before it waits for the next commit. */
const POLL_MS = 200
const POLL_LIMIT = 40
/** How many times one batch is started again after the profile changed under its walk. */
const MAX_ATTEMPTS = 3
/** Deepest nesting the walk follows; anything deeper makes the walk incomplete instead of being skipped. */
const MAX_DEPTH = 100

type Removed =
    | { kind: 'chat', chat: Chat }
    | { kind: 'characters', characters: readonly (character | groupChat)[] }

interface QueuedCleanup {
    removed: Removed
    /** The database the removal happened in; a batch never runs against another one. */
    database: Database
    attempts: number
}

/** What one batch did, as logged. */
export interface InlayCleanupOutcome {
    candidates: number
    kept: number
    deleted: number
    failed: number
    skipped: string | null
    longestSliceMs: number
}

type Disposition = 'done' | 'wait' | 'retry'

let pending: QueuedCleanup[] = []
let running = false
let timer: ReturnType<typeof setTimeout> | null = null
let polls = 0
let commitArmed = false

//#region walking

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const yieldToMain = () => new Promise<void>((resolve) => { setTimeout(resolve, 0) })
/** Resolves when the page has nothing better to do, or after two seconds where idle callbacks exist. */
const whenIdle = () => new Promise<void>((resolve) => {
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => resolve(), { timeout: 2000 })
    } else {
        setTimeout(resolve, 0)
    }
})

/**
 * Decides when a walk must give the event loop a turn, and records the longest
 * stretch it ran without one. Work is counted in units (one per value, one per
 * KiB of text); the clock is read once per `CHECK_EVERY` units.
 */
export class Pacer {
    longestSliceMs = 0
    private sliceStart = now()
    private units = 0

    /** True when the current stretch has run for `SLICE_MS`. */
    due(weight = 1): boolean {
        this.units += weight
        if (this.units < CHECK_EVERY) {
            return false
        }
        this.units = 0
        return this.overSlice()
    }

    /** True when the current stretch has run for `SLICE_MS`; reads the clock now. */
    overSlice(): boolean {
        return now() - this.sliceStart >= SLICE_MS
    }

    async yield(): Promise<void> {
        this.noteSlice()
        await yieldToMain()
        this.sliceStart = now()
    }

    noteSlice(): void {
        this.longestSliceMs = Math.max(this.longestSliceMs, now() - this.sliceStart)
    }

    /** Awaits work that runs off this walk's own stretch; the time it takes is not a slice of the walk. */
    async io<T>(work: Promise<T>): Promise<T> {
        this.noteSlice()
        try {
            return await work
        } finally {
            this.sliceStart = now()
        }
    }
}

export interface StringWalkResult {
    /** `onString` asked to stop. */
    stopped: boolean
    /** Some value was nested deeper than `MAX_DEPTH` and was not followed. */
    tooDeep: boolean
}

type StringVisit = boolean | void | Promise<boolean | void>

/**
 * Calls `onString` for every string and every object key under `root`; arrays
 * and plain objects are followed, binary values are not strings and are skipped.
 * `onString` may return a promise (a long string scanned in pieces); it answers
 * `true` to stop the walk.
 */
export async function walkStrings(root: unknown, onString: (text: string) => StringVisit, pacer: Pacer): Promise<StringWalkResult> {
    const values: unknown[] = [root]
    const depths: number[] = [0]
    let tooDeep = false
    while (values.length > 0) {
        if (pacer.due()) {
            await pacer.yield()
        }
        const value = values.pop()
        const depth = depths.pop() as number
        if (typeof value === 'string') {
            const visit = onString(value)
            if ((visit instanceof Promise ? await visit : visit) === true) {
                return { stopped: true, tooDeep }
            }
            if (value.length >= 1024 && pacer.due(value.length >> 10)) {
                await pacer.yield()
            }
            continue
        }
        if (value === null || typeof value !== 'object' || ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof Blob) {
            continue
        }
        if (depth >= MAX_DEPTH) {
            tooDeep = true
            continue
        }
        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) {
                values.push(value[i])
                depths.push(depth + 1)
            }
            continue
        }
        const record = value as Record<string, unknown>
        for (const key of Object.keys(record)) {
            const visit = onString(key)
            if ((visit instanceof Promise ? await visit : visit) === true) {
                return { stopped: true, tooDeep }
            }
            values.push(record[key])
            depths.push(depth + 1)
        }
    }
    return { stopped: false, tooDeep }
}

/** Every uuid-shaped substring, overlapping ones included: the lookahead consumes nothing, so the next position is tried too. */
const UUID_AT = /(?=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))/gi
const UUID_EXACT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ASSET_ID = /^assets\/([0-9a-f]{64})\.[A-Za-z0-9]+$/
const ASSET_HASH_AT = /assets\/([0-9a-f]{64})/gi

/**
 * A set of ids still waiting to be found. `scan(text)` removes every id that
 * occurs in `text` as a substring. A uuid is found by one pass over the text for
 * uuid-shaped substrings, so the cost of a scan does not grow with the number of
 * candidates; any other id is searched for with `includes`.
 *
 * A unit summary (`UnitSummary`) answers for the ids that have a fixed shape: a
 * uuid, or an asset path `assets/<64 hex>.<ext>`, whose hash part the summary
 * lists. `canUseSummary()` is false while an id of any other shape remains, and
 * then only a scan of the unit's text can answer.
 */
export class IdMatcher {
    private readonly uuids = new Set<string>()
    private readonly assets = new Map<string, string>()
    private readonly others = new Set<string>()
    /** The longest id this matcher was built with. */
    readonly maxIdLength: number

    constructor(ids: Iterable<string>) {
        let longest = 0
        for (const id of ids) {
            longest = Math.max(longest, id.length)
            const asset = ASSET_ID.exec(id)
            if (UUID_EXACT.test(id)) {
                this.uuids.add(id)
            } else if (asset) {
                this.assets.set(id, asset[1])
            } else {
                this.others.add(id)
            }
        }
        this.maxIdLength = longest
    }

    get size(): number {
        return this.uuids.size + this.assets.size + this.others.size
    }

    remaining(): string[] {
        return [...this.uuids, ...this.assets.keys(), ...this.others]
    }

    scan(text: string): void {
        if (this.uuids.size > 0 && text.length >= 36) {
            for (const match of text.matchAll(UUID_AT)) {
                this.uuids.delete(match[1])
                if (this.uuids.size === 0) {
                    break
                }
            }
        }
        for (const id of this.assets.keys()) {
            if (text.includes(id)) {
                this.assets.delete(id)
            }
        }
        for (const id of this.others) {
            if (text.includes(id)) {
                this.others.delete(id)
            }
        }
    }

    /** Whether a unit summary can answer for every id still waiting. */
    canUseSummary(): boolean {
        return this.others.size === 0
    }

    /** Removes the ids a unit summary lists; an asset path counts as found when its hash is listed, which may keep an id its extension does not match. */
    applySummary(summary: Pick<UnitSummary, 'uuids' | 'hashes'>): void {
        for (const id of summary.uuids) {
            this.uuids.delete(id)
        }
        for (const [id, hash] of this.assets) {
            if (summary.hashes.has(hash)) {
                this.assets.delete(id)
            }
        }
    }
}

/** Remembers every uuid and asset hash that occurs in a unit's text, up to `MAX_UNIT_IDS`. */
class UnitCollector {
    readonly uuids = new Set<string>()
    readonly hashes = new Set<string>()
    overflow = false

    add(text: string): void {
        if (this.overflow) {
            return
        }
        if (text.length >= 36) {
            for (const match of text.matchAll(UUID_AT)) {
                this.uuids.add(match[1])
            }
        }
        if (text.includes('assets/')) {
            for (const match of text.matchAll(ASSET_HASH_AT)) {
                this.hashes.add(match[1])
            }
        }
        if (this.uuids.size + this.hashes.size > MAX_UNIT_IDS) {
            this.overflow = true
        }
    }
}

/**
 * Feeds the text of a walk to a matcher and, while a unit is being summarised,
 * to the collector. A string longer than `CHUNK_CHARS` is scanned in pieces
 * that overlap by the longest id (at least 80 characters, which covers an asset
 * path), giving the event loop a turn between pieces once `SLICE_MS` has passed,
 * so no stretch runs more than one piece past `SLICE_MS`.
 * A string that cannot be cut soundly (an id longer than half a piece) is scanned
 * whole.
 */
export class Scanner {
    constructor(readonly matcher: IdMatcher, private readonly collector: UnitCollector | null) {}

    private scanPiece(text: string): void {
        this.matcher.scan(text)
        this.collector?.add(text)
    }

    /** `true` when the matcher has nothing left to find; a promise for a long string. */
    scan(text: string, pacer: Pacer): boolean | Promise<boolean> {
        if (text.length <= CHUNK_CHARS) {
            this.scanPiece(text)
            return this.matcher.size === 0
        }
        return this.scanInPieces(text, pacer)
    }

    private async scanInPieces(text: string, pacer: Pacer): Promise<boolean> {
        const overlap = Math.max(80, this.matcher.maxIdLength)
        if (overlap * 2 > CHUNK_CHARS) {
            this.scanPiece(text)
            return this.matcher.size === 0
        }
        for (let start = 0; start < text.length; start += CHUNK_CHARS - overlap) {
            this.scanPiece(text.slice(start, start + CHUNK_CHARS))
            if (this.matcher.size === 0) {
                return true
            }
            if (pacer.overSlice()) {
                await pacer.yield()
            }
        }
        return false
    }
}

/** The ids of the literal inlay tokens in every string under `root`. A token longer than `TOKEN_OVERLAP` that straddles two pieces of a long string is not seen, which leaves its inlay alone. */
export async function collectInlayIds(root: unknown, into: Set<string>, pacer: Pacer): Promise<void> {
    const collect = (text: string) => {
        if (text.includes('{{inlay')) {
            for (const match of text.matchAll(inlayTokenRegex)) {
                into.add(match[2])
            }
        }
    }
    const collectInPieces = async (text: string): Promise<void> => {
        for (let start = 0; start < text.length; start += CHUNK_CHARS - TOKEN_OVERLAP) {
            collect(text.slice(start, start + CHUNK_CHARS))
            if (pacer.overSlice()) {
                await pacer.yield()
            }
        }
    }
    await walkStrings(root, (text) => {
        if (text.length <= CHUNK_CHARS) {
            collect(text)
            return
        }
        return collectInPieces(text)
    }, pacer)
}
interface ColdRoot {
    key: string
    kind: 'normal' | 'errorText'
}

interface ColdWalkResult {
    /** Every unit reached was read, answered by a summary, or reported absent. */
    complete: boolean
    /** Why it is not complete, when it is not. */
    reason: string | null
    /** Keys whose unit was read, answered by a summary, or reported absent. */
    settled: Set<string>
    /** `visit` asked to stop. */
    stopped: boolean
}

/**
 * What the page remembers of a unit it has scanned: the uuids and asset hashes
 * its text holds and the units it points at, never its text. Valid only while
 * the unit's write stamp (`getColdUnitStamp`) equals `stamp`, that is, while no
 * write or delete of the unit by this page has started since the scan.
 * At most `MAX_UNIT_IDS` ids per unit and `MAX_TOTAL_IDS` over all units, which
 * bounds the cache at about 10 MB; a unit that does not fit is read each time.
 */
export interface UnitSummary {
    stamp: number
    uuids: ReadonlySet<string>
    hashes: ReadonlySet<string>
    inner: ColdStorageInnerKey[]
}

const summaries = new Map<string, UnitSummary>()
let summarizedIds = 0

function forgetSummary(key: string): void {
    const summary = summaries.get(key)
    if (summary) {
        summarizedIds -= summary.uuids.size + summary.hashes.size
        summaries.delete(key)
    }
}

function rememberSummary(key: string, summary: UnitSummary): void {
    forgetSummary(key)
    const ids = summary.uuids.size + summary.hashes.size
    if (summarizedIds + ids <= MAX_TOTAL_IDS) {
        summaries.set(key, summary)
        summarizedIds += ids
    }
}

/** What a walk over the units can do with a summary: whether it can answer now, and what applying one means. */
interface SummaryUse {
    usable(): boolean
    /** Applies the summary; `true` asks the walk to stop. */
    apply(summary: UnitSummary): boolean
}

/**
 * Reads the units reachable from `roots`, one at a time, following the pointers
 * and load-error texts inside them exactly as the backup collector does, and
 * hands each value to `visit` (with a collector while the unit may be
 * remembered). A value is dropped before the next unit is read. An absent unit
 * contributes nothing; any other failure makes the walk incomplete.
 *
 * With `use`, a unit whose summary is current is not read: the store is only
 * asked whether it still holds the unit, and an answer other than yes sends the
 * walk to an ordinary read. A summary is made from a unit that was read whole
 * with no write of this page overlapping the read.
 */
async function walkColdUnits(
    roots: readonly ColdRoot[],
    visit: (value: unknown, collector: UnitCollector | null) => Promise<boolean | void>,
    shouldAbort: () => boolean,
    pacer: Pacer,
    use: SummaryUse | null = null,
): Promise<ColdWalkResult> {
    const queue: string[] = []
    const scheduled = new Set<string>()
    const settled = new Set<string>()
    let complete = true
    let reason: string | null = null
    const schedule = (key: string) => {
        if (!scheduled.has(key)) {
            scheduled.add(key)
            queue.push(key)
        }
    }
    const scheduleInner = (inner: readonly ColdStorageInnerKey[]) => {
        for (const entry of inner) {
            if (entry.kind === 'errorText' && !isRestorableColdStorageKey(entry.key)) {
                continue
            }
            schedule(entry.key)
        }
    }
    for (const root of roots) {
        if (root.kind === 'errorText' && !isRestorableColdStorageKey(root.key)) {
            continue
        }
        schedule(root.key)
    }
    if (queue.length === 0) {
        return { complete, reason, settled, stopped: false }
    }
    // Loaded on first use: the unit reader pulls in the chat pipeline, which a profile without cold units never needs.
    const cold = await pacer.io(import("../coldstorage.svelte"))
    for (let i = 0; i < queue.length; i++) {
        if (shouldAbort()) {
            return { complete: false, reason: 'the profile changed during the walk', settled, stopped: false }
        }
        const key = queue[i]
        const stampBefore = use ? cold.getColdUnitStamp(key) : null
        const known = use ? summaries.get(key) : undefined
        if (known && (stampBefore === null || known.stamp !== stampBefore)) {
            forgetSummary(key)
        } else if (known && use && use.usable()) {
            let held = false
            try {
                held = await pacer.io(cold.hasColdUnitInStore(key))
            } catch (error) {
                complete = false
                reason = reason ?? 'a cold unit could not be read'
                continue
            }
            if (held && cold.getColdUnitStamp(key) === known.stamp) {
                settled.add(key)
                if (use.apply(known)) {
                    return { complete, reason, settled, stopped: true }
                }
                scheduleInner(known.inner)
                continue
            }
            forgetSummary(key)
        }
        let result: Awaited<ReturnType<typeof cold.readColdStorageItem>>
        try {
            result = await pacer.io(cold.readColdStorageItem(key))
        } catch (error) {
            result = { status: 'error', error }
        }
        if (result.status === 'missing') {
            settled.add(key)
            continue
        }
        if (result.status === 'error') {
            complete = false
            reason = reason ?? 'a cold unit could not be read'
            continue
        }
        settled.add(key)
        const value: unknown = result.value
        const collector = stampBefore === null ? null : new UnitCollector()
        if (await visit(value, collector) === true) {
            return { complete, reason, settled, stopped: true }
        }
        let inner: ColdStorageInnerKey[] = []
        let listed = true
        try {
            inner = listInnerColdStorageKeys(value)
        } catch (error) {
            listed = false
            complete = false
            reason = reason ?? 'a cold unit could not be searched for references'
        }
        if (collector && listed && !collector.overflow && stampBefore !== null && cold.getColdUnitStamp(key) === stampBefore) {
            rememberSummary(key, { stamp: stampBefore, uuids: collector.uuids, hashes: collector.hashes, inner })
        }
        scheduleInner(inner)
    }
    return { complete, reason, settled, stopped: false }
}

/** The cold roots of `db`, without plugin storage, whose content is never searched. */
function coldRootsOf(db: Pick<Database, 'characters' | 'pluginCustomStorage'>): ColdRoot[] {
    const roots: ColdRoot[] = []
    for (const root of listColdBackupRoots(db)) {
        if (root.kind !== 'plugin') {
            roots.push({ key: root.key, kind: root.kind })
        }
    }
    return roots
}

//#endregion

//#region the checks that gate a deletion

type TabState = 'alone' | 'others' | 'unsupported'

/**
 * Whether another tab of this page's origin is open or an exclusive storage
 * operation has been requested, read from the Web Locks the tabs hold for
 * their lifetime. Where Web Locks are missing there is no way to tell, and
 * a lock query that fails counts as "another tab".
 */
async function tabState(): Promise<TabState> {
    let manager: LockManager | undefined
    try {
        manager = locksSupported === false || typeof navigator === 'undefined' ? undefined : navigator.locks
    } catch (error) {
        manager = undefined
    }
    if (!manager || typeof manager.query !== 'function') {
        return 'unsupported'
    }
    try {
        const snapshot = await manager.query()
        const held = (snapshot.held ?? []).filter((lock) => lock.name === STORAGE_TAB_LOCK_NAME)
        const requested = (snapshot.pending ?? []).some((lock) => lock.name === STORAGE_TAB_LOCK_NAME && lock.mode === 'exclusive')
        const exclusiveHeld = held.some((lock) => lock.mode === 'exclusive')
        return held.length > 1 || requested || exclusiveHeld ? 'others' : 'alone'
    } catch (error) {
        return 'others'
    }
}

/** True while everything the walk assumed still holds; read synchronously, right before an irreversible step. */
function stillCurrent(startMarks: number, database: Database): boolean {
    return getSaveMarkCount() === startMarks && isSaveClean() && getDatabase() === database && !isBusy()
}

//#endregion

//#region one batch

async function candidatesOf(removed: Removed, into: Set<string>, pacer: Pacer): Promise<void> {
    let roots: ColdRoot[]
    if (removed.kind === 'chat') {
        await collectInlayIds(removed.chat, into, pacer)
        roots = listInnerColdStorageKeys(removed.chat).map((entry) => ({ key: entry.key, kind: entry.kind === 'pointer' ? 'normal' : 'errorText' }))
    } else {
        await collectInlayIds(removed.characters, into, pacer)
        roots = coldRootsOf({ characters: [...removed.characters], pluginCustomStorage: {} })
    }
    // A unit of the deleted data that cannot be read yields no candidates; its inlays stay.
    await walkColdUnits(roots, async (value) => {
        await collectInlayIds(value, into, pacer)
    }, () => false, pacer)
}

interface KeepResult {
    /** The candidates that no remaining string mentions; meaningful only when `reason` is null. */
    unreferenced: string[]
    reason: string | null
}

/** Removes from `candidates` every id the remaining database or a cold unit reachable from it still mentions. */
async function findUnreferenced(
    candidates: ReadonlySet<string>,
    database: Database,
    pacer: Pacer,
    shouldAbort: () => boolean,
): Promise<KeepResult> {
    const matcher = new IdMatcher(candidates)
    const memoryScanner = new Scanner(matcher, null)
    const memory = await walkStrings(database, (text) => memoryScanner.scan(text, pacer), pacer)
    if (matcher.size === 0) {
        return { unreferenced: [], reason: null }
    }
    if (memory.tooDeep) {
        return { unreferenced: [], reason: 'the database is nested too deeply to search' }
    }
    const walked = await walkColdUnits(coldRootsOf(database), async (value, collector) => {
        const scanner = new Scanner(matcher, collector)
        const result = await walkStrings(value, (text) => scanner.scan(text, pacer), pacer)
        if (result.tooDeep && matcher.size > 0) {
            throw new Error('a cold unit is nested too deeply to search')
        }
        return matcher.size === 0
    }, shouldAbort, pacer, {
        usable: () => matcher.canUseSummary(),
        apply: (summary) => {
            matcher.applySummary(summary)
            return matcher.size === 0
        },
    })
    if (matcher.size === 0) {
        return { unreferenced: [], reason: null }
    }
    if (!walked.complete) {
        return { unreferenced: [], reason: walked.reason ?? 'the cold units could not all be searched' }
    }
    // Roots that appeared while the units were being read were not read.
    for (const root of coldRootsOf(getDatabase())) {
        if (root.kind === 'errorText' && !isRestorableColdStorageKey(root.key)) {
            continue
        }
        if (!walked.settled.has(root.key)) {
            return { unreferenced: [], reason: 'a cold unit appeared during the walk' }
        }
    }
    return { unreferenced: matcher.remaining(), reason: null }
}

async function runBatch(batch: QueuedCleanup[], stats: InlayCleanupOutcome, pacer: Pacer): Promise<Disposition> {
    const database = getDatabase()
    const startMarks = getSaveMarkCount()
    const skip = (reason: string, disposition: Disposition): Disposition => {
        stats.skipped = reason
        return disposition
    }
    if (!isSaveClean() || isBusy()) {
        return 'wait'
    }
    const tabs = await pacer.io(tabState())
    if (tabs === 'unsupported') {
        return skip('Web Locks are not available, so another open tab cannot be ruled out', 'done')
    }
    if (tabs === 'others') {
        return 'wait'
    }

    const candidates = new Set<string>()
    for (const item of batch) {
        await candidatesOf(item.removed, candidates, pacer)
    }
    stats.candidates = candidates.size
    if (candidates.size === 0) {
        return 'done'
    }

    const shouldAbort = () => getSaveMarkCount() !== startMarks || getDatabase() !== database
    const keep = await findUnreferenced(candidates, database, pacer, shouldAbort)
    if (keep.reason !== null) {
        return skip(keep.reason, shouldAbort() ? 'retry' : 'done')
    }
    stats.kept = candidates.size - keep.unreferenced.length
    if (keep.unreferenced.length === 0) {
        return 'done'
    }
    if (!stillCurrent(startMarks, database)) {
        return skip('the profile changed during the walk', 'retry')
    }

    const { removeInlayAsset } = await pacer.io(import("./inlays"))
    for (const id of keep.unreferenced) {
        const state = await pacer.io(tabState())
        if (state !== 'alone' || !stillCurrent(startMarks, database)) {
            return skip('the profile changed while deleting', 'retry')
        }
        try {
            await pacer.io(removeInlayAsset(id))
            stats.deleted++
        } catch (error) {
            stats.failed++
            console.warn('An inlay of a deleted chat could not be removed:', error)
        }
    }
    return 'done'
}

async function processPending(): Promise<void> {
    const batch = pending.filter((item) => item.database === getDatabase())
    pending = []
    if (batch.length === 0) {
        return
    }
    const pacer = new Pacer()
    const stats: InlayCleanupOutcome = { candidates: 0, kept: 0, deleted: 0, failed: 0, skipped: null, longestSliceMs: 0 }
    let disposition: Disposition = 'done'
    try {
        disposition = await runBatch(batch, stats, pacer)
    } catch (error) {
        stats.skipped = 'the walk failed'
        console.warn('The inlay cleanup stopped:', error)
    }
    pacer.noteSlice()
    stats.longestSliceMs = pacer.longestSliceMs
    if (disposition === 'wait') {
        pending.push(...batch)
        return
    }
    if (disposition === 'retry') {
        for (const item of batch) {
            if (item.attempts + 1 < MAX_ATTEMPTS) {
                pending.push({ ...item, attempts: item.attempts + 1 })
            }
        }
    }
    console.info('inlay cleanup', { ...stats })
}

//#endregion

//#region scheduling

function waitForCommit(): void {
    if (commitArmed) {
        return
    }
    commitArmed = true
    afterNextSaveCommit(() => {
        commitArmed = false
        polls = 0
        schedulePoll()
    })
}

function schedulePoll(): void {
    if (timer !== null || pending.length === 0) {
        return
    }
    timer = setTimeout(() => {
        timer = null
        void poke()
    }, POLL_MS)
}

async function poke(): Promise<void> {
    if (running || pending.length === 0) {
        return
    }
    try {
        if (!isSaveClean()) {
            polls++
            if (polls < POLL_LIMIT) {
                schedulePoll()
            } else {
                polls = 0
                waitForCommit()
            }
            return
        }
        polls = 0
        running = true
        try {
            await whenIdle()
            await processPending()
        } finally {
            running = false
        }
        if (pending.length > 0) {
            waitForCommit()
        }
    } catch (error) {
        pending = []
        console.warn('The inlay cleanup could not run:', error)
    }
}

function enqueue(removed: Removed): void {
    try {
        pending.push({ removed, database: getDatabase(), attempts: 0 })
        schedulePoll()
    } catch (error) {
        console.warn('The inlay cleanup could not be queued:', error)
    }
}

/** Queues the cleanup of a chat just removed from its owner. Never throws. */
export function queueInlayCleanupForChat(chat: Chat): void {
    enqueue({ kind: 'chat', chat })
}

/** Queues the cleanup of characters or groups just removed from the database. Never throws. */
export function queueInlayCleanupForCharacters(characters: readonly (character | groupChat)[]): void {
    if (characters.length > 0) {
        enqueue({ kind: 'characters', characters: [...characters] })
    }
}

/** How many removals wait for a batch and whether a batch is walking. */
export function getInlayCleanupState(): { pending: number, running: boolean } {
    return { pending: pending.length, running }
}

//#endregion
