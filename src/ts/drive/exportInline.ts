import type { Database, character, groupChat } from '../storage/database.svelte'
import { applyStubStateOnRestore } from '../process/coldCharacter'
import { readColdCharacterCopy, type ColdCopyOutcome } from '../process/coldCharacterRestore'
import { collectColdStorageBackupPayloads, type ColdStorageBackupCollection, type ColdStorageBackupPayload } from '../process/coldstorage.svelte'
import { getColdStorageBackupName, listColdBackupRoots, listColdPluginStorageKeys } from '../process/coldstorageData'
import { getResidency, isEntityUnitKey } from '../storage/store2/residencyActive'
import { coldUnitCharacter } from '../process/coldCharacter'
import { isCharacterEntry, isUsableCharacterId } from '../storage/characterIds'
import { kvBlockNameOf } from '../storage/risuSaveV0'
import { forkOnlyChatLabels, withoutForkOnlyChatData, type ForkOnlyChatLabel } from './exportAlternatives'
import { v4 as uuidv4 } from 'uuid'
import { MEASURE } from '../process/memory/measureFlag'
import { deflateSync, inflateSync } from 'fflate'
import { shouldBypassFrozenPagePaths } from '../storage/tauriByteTransport'
import { createStubPackClient, type PackResult } from './stubPackClient'

/**
 * A `.bin` carries each character whole, or as an upstream-shaped stub with a unit payload. A store2 page may hold a
 * character as a stub whose `coldstorage` names a store2 entity: that is no unit file an importer places, so the export
 * reads the entity and, by mode, either puts the whole character in the database entry in the stub's place (`inline`) or
 * keeps a stub whose `coldstorage` is a uuid minted for this export and writes the character as the unit
 * `coldstorage_<uuid>.json` (`stub`). In `stub` mode a trashed character, and a character whose chats name a
 * cold-storage root (`hasColdRoots`), are still put whole in the database entry: the trash time is the stub's, and a
 * root inside a unit body would be seen by neither cold-storage collection. A stub whose entity cannot be read stays a
 * stub in the export, is named in the incomplete-data prompt like any unit the backup cannot carry, and is imported as
 * a placeholder.
 */

type Slot = character | groupChat

/** How an export carries a character that a store2 page holds as a stub: whole in the database entry, or as a stub plus a unit entry. */
export type UnloadedCharacterMode = 'stub' | 'inline'

/**
 * The production mode: a character the page holds as a stub stays a stub in the file, with a unit entry. A trashed
 * character and a character that names a cold-storage root are always exported whole, whatever the mode. Tests pass the
 * other mode as a parameter instead of changing this constant.
 */
export const EXPORT_UNLOADED_CHARACTERS: UnloadedCharacterMode = 'stub'

/**
 * How a read of an entity that failed without saying why (a store failure, not a missing or damaged unit) is retried.
 * `pausesMs` are the pauses before the successive retries of one character. For the whole collection, `budgetMs` bounds
 * the total of the pauses and `maxRetries` bounds the number of retry reads, so the added wait is constant in the number
 * of characters. A retry read can itself take as long as the store's own retry of a rate limit (Node's client retries a
 * 429 before a read reports failure); these bounds do not shorten that.
 */
export interface ReadRetryPolicy {
    pausesMs: readonly number[]
    budgetMs: number
    maxRetries: number
    pause: (ms: number) => Promise<void>
}

export const DEFAULT_READ_RETRY: ReadRetryPolicy = {
    pausesMs: [400, 1200],
    budgetMs: 6000,
    maxRetries: 6,
    pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

/**
 * Whether the export has to run the character-id repair on `list`: it is a list and some entry is not a character with a
 * usable id. The repair rewrites ids in the tree it is given (group member lists, chat speakers, folder order), and the
 * bodies of stub unit entries are fixed at collection, so a stub's unit body is written only when the export tree's ids
 * are the ones the body holds. When this holds, the export carries every unloaded character inline instead.
 * `reserved` are the other block names the export writes (`kvBlockNamesOf`): an id that is one of them cannot be saved either.
 */
export function characterListNeedsRepair(list: unknown, reserved?: ReadonlySet<string>): boolean {
    return Array.isArray(list) && !list.every((entry) => isCharacterEntry(entry) && isUsableCharacterId(entry.chaId) && !(reserved?.has(String(entry.chaId)) ?? false))
}

/** The block names an export writes for the upstream data namespaces of `kv`; empty when it holds none. */
export function kvBlockNamesOf(kv: unknown): ReadonlySet<string> {
    const names = new Set<string>()
    if (typeof kv === 'object' && kv !== null) {
        for (const namespace of Object.keys(kv)) {
            names.add(kvBlockNameOf(namespace))
        }
    }
    return names
}

/**
 * How many stubs beyond the one being consumed have their first read started. Reads are consumed in list order, so the
 * collection holds at most this many plus one characters that were read and not yet consumed.
 */
export const STUB_READ_AHEAD = 3

export interface ExportCollectionOptions {
    mode?: UnloadedCharacterMode
    readRetry?: Partial<ReadRetryPolicy>
    /** Test seam: the read-ahead in place of `STUB_READ_AHEAD`; 0 reads one stub at a time. */
    readAhead?: number
    /** Test seam: the bounds of the packing jobs in place of `STUB_PACK_MAX_JOBS` and `STUB_PACK_BUDGET_BYTES`. */
    pack?: { budgetBytes?: number, maxJobs?: number }
}

/** Most packing jobs a stub collection keeps live at once; each holds its character and its encoded body until its job settles. */
export const STUB_PACK_MAX_JOBS = 4

/** Most encoded-body bytes the live packing jobs hold together; one body larger than this is admitted only when no job is live. */
export const STUB_PACK_BUDGET_BYTES = 8 * 1024 * 1024

const READ_AHEAD_KNOB_KEY = 'risu-measure-export-readahead'
const PACK_KNOB_KEY = 'risu-measure-export-pack'

/** The read-ahead a stored knob value names: an integer 0 to 3 as written; anything else is no knob. */
export function parseReadAheadKnob(raw: string | null): number | undefined {
    return raw !== null && /^[0-3]$/.test(raw) ? Number(raw) : undefined
}

/**
 * Measurement builds only (`MEASURE`): the read-ahead the stored knob names, read each time a stub collection starts, so
 * once per export; `undefined` when the knob is absent, invalid or unreadable. An explicit `readAhead` option wins over it.
 */
function readAheadKnob(): number | undefined {
    try {
        return parseReadAheadKnob(typeof localStorage === 'undefined' ? null : localStorage.getItem(READ_AHEAD_KNOB_KEY))
    } catch {
        return undefined
    }
}

/**
 * Measurement builds only (`MEASURE`): whether the stored knob `main` keeps the packing on the main thread, read each time
 * a stub collection starts, so once per export.
 */
function packOnMainKnob(): boolean {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(PACK_KNOB_KEY) === 'main'
    } catch {
        return false
    }
}

/** The identity of a stub in an export: its entity and its `chaId`, never the object, which a page may replace while the export runs. */
export function inlineKeyOf(u: string, chaId: unknown): string {
    return `${u}\u0000${String(chaId ?? '')}`
}

/**
 * A stub's character as the unit entry of this export: the minted uuid the exported stub names, and the entry's bytes held
 * raw-deflated until its write (`unpackStubEntry`). Only the packed bytes are held, so the entries of a large library
 * stay small across the asset loop.
 */
export interface MintedStubEntry {
    uuid: string
    /** The character's name, for the prompt that names an entry too large for the file. */
    name: string
    /** The entry's name in the file. */
    backupName: string
    /** The byte length of the entry's body, as it is written and as the size checks count it. */
    rawLength: number
    /** The body, raw-deflated; it holds no reference to the body's raw bytes. */
    packed: Uint8Array
    /** Labels of the chats whose fork-only data (alternatives and the other table kinds) the body leaves out; absent when none were left out. */
    omittedChatData?: ForkOnlyChatLabel[]
}

export interface StubsForExport {
    /** The character read from each stub's entity, by `inlineKeyOf`. */
    inlined: ReadonlyMap<string, Slot>
    /** In `stub` mode, the unit entry minted for each stub's entity, by `inlineKeyOf`. Only the entry's bytes are held, not the character. */
    stubEntries: ReadonlyMap<string, MintedStubEntry>
    /** The entities whose read did not give a character. */
    failedKeys: string[]
}

/** Where the stub reads of one export spent their time, as a measurement build records it. */
export interface StubReadStats {
    /** Stubs whose entity was read, whatever the read gave. */
    characters: number
    /** Milliseconds the consumer waited on `readColdCharacterCopy`: the store reads and the character's decode, less what the read-ahead already did. Retry pauses are not counted. */
    readMs: number
    /** Milliseconds on the calling thread for each stub entry: the JSON text and its UTF-8 encode, plus the packing when it ran there. It leaves out the packing a worker did, and the packing done here after the page hid during a wait for a worker job, so a difference between the arms is not a saving. */
    encodeMs: number
    /** The longest single `stubUnitEntry`, in milliseconds. */
    encodeMsMax: number
    /** The summed byte length of the minted entries' bodies. */
    rawBytes: number
    /** The summed byte length of the minted entries as they are held. */
    packedBytes: number
    /** The read-ahead in force. */
    ahead: number
    /** The most characters that were read (or being read) and not yet consumed at one time. */
    heldMax: number
    /** Retry reads made after a read that failed without a kind. */
    retries: number
    /** Entities whose read did not give a character. */
    failed: number
    /**
     * Milliseconds in `hasColdRoots`, summed over the characters it judged. Invariant: disjoint from `readMs` and
     * `encodeMs`, and contained in `loopMs`.
     */
    coldRootsMs: number
    /**
     * Milliseconds from the first to the last step of the `readStubsForExport` loop, retry pauses included. Invariant:
     * it contains `readMs`, `encodeMs` and `coldRootsMs`; what is left of it is the consumer's own work between the reads
     * (read-ahead starts, map operations, the id of each entry). The character assembly runs inside `readColdCharacterCopy`,
     * so it is part of `readMs` and `loopMs`, not a field of its own.
     */
    loopMs: number
    /**
     * Milliseconds `collectBackupColdStorage` spent after the stub loop: the plugin storage and the legacy collector.
     * Invariant: it starts when `loopMs` ends, so the two never overlap.
     */
    legacyCollectMs: number
    /** Milliseconds `snapshotModuleList` took before the collect began. Invariant: it ends before `loopMs` starts. */
    moduleSnapshotMs: number
    /** The modules the snapshot listed. */
    moduleSnapshotCount: number
    /** Milliseconds the loop waited for a packing job to settle before submitting the next one. Invariant: contained in `loopMs`. */
    packWaitMs: number
    /** Milliseconds after the loop spent waiting for the packing jobs still live. Invariant: it follows the loop, so it is not in `loopMs`. */
    packDrainMs: number
    /** Packing jobs whose worker failed and whose body was packed on the main thread instead. */
    packFallbacks: number
    /** The most packing jobs live at one time. */
    packHeldMax: number
}

function emptyStubStats(): StubReadStats {
    return { characters: 0, readMs: 0, encodeMs: 0, encodeMsMax: 0, rawBytes: 0, packedBytes: 0, ahead: 0, heldMax: 0, retries: 0, failed: 0, coldRootsMs: 0, loopMs: 0, legacyCollectMs: 0, moduleSnapshotMs: 0, moduleSnapshotCount: 0, packWaitMs: 0, packDrainMs: 0, packFallbacks: 0, packHeldMax: 0 }
}

/** What the live packing jobs of a collection hold, counted from the records' own fields. */
export interface StubPackProbeEvent {
    /** Live job records. */
    records: number
    /** Records that still hold their character. */
    characters: number
    /** The summed byte length of the encoded bodies the records still hold. */
    bytes: number
}

let stubPackProbe: ((event: StubPackProbeEvent) => void) | null = null

/** Test seam: receives the live-record counts after every record creation and release; `null` removes it. */
export function setStubPackProbeForTest(probe: ((event: StubPackProbeEvent) => void) | null): void {
    stubPackProbe = probe
}

let stubStats: StubReadStats = emptyStubStats()
let stubClock: () => number = () => performance.now()

/** Test seam: replaces the clock the recorder reads; `null` restores it. */
export function setStubReadClockForTest(clock: (() => number) | null): void {
    stubClock = clock ?? (() => performance.now())
}

/**
 * Measurement builds only (`MEASURE`): the stub read stats since `readStubsForExport` began, which also clears them;
 * `null` otherwise. Recording never throws into the export and never changes what is read or encoded.
 */
export function takeStubReadStats(): StubReadStats | null {
    if (!MEASURE) {
        return null
    }
    const stats = stubStats
    stubStats = emptyStubStats()
    return stats
}

function stubMark(): number {
    try {
        return stubClock()
    } catch {
        return Number.NaN
    }
}

/**
 * Measurement builds only (`MEASURE`): clears the two module fields at the start of an export. An export that stops
 * before its snapshot is recorded must not leave an earlier export's figures for the next stub read to keep.
 */
export function clearModuleSnapshotMarks(): void {
    if (!MEASURE) {
        return
    }
    stubStats.moduleSnapshotMs = 0
    stubStats.moduleSnapshotCount = 0
}

/**
 * Measurement builds only (`MEASURE`): the mark taken before `snapshotModuleList`. The snapshot runs before
 * `readStubsForExport` resets the stats, so `readStubsForExport` keeps the two module fields when it does.
 */
export function beginModuleSnapshotMark(): number {
    return MEASURE ? stubMark() : 0
}

/** Measurement builds only (`MEASURE`): records the snapshot that began at `startedAt` and listed `count` modules. */
export function endModuleSnapshotMark(startedAt: number, count: number): void {
    if (!MEASURE) {
        return
    }
    stubStats.moduleSnapshotMs = stubElapsed(startedAt)
    stubStats.moduleSnapshotCount = count
}

function stubElapsed(startedAt: number): number {
    try {
        const elapsed = stubClock() - startedAt
        return Number.isFinite(elapsed) ? elapsed : 0
    } catch {
        return 0
    }
}

/**
 * The body of the unit entry of `character`: `{ character }` without the trash time, which only the stub carries, encoded.
 * A `.bin` carries no fork-only chat data; the body is encoded from a copy without it. A character whose text cannot be
 * encoded gives `null` and is exported whole.
 */
function stubUnitBody(character: Slot): Uint8Array | null {
    try {
        return new TextEncoder().encode(JSON.stringify({ character: withoutForkOnlyChatData(coldUnitCharacter(character)) }))
    } catch {
        return null
    }
}

/** The packed form of a unit body, or `null` when it cannot be packed (the character is then exported whole). */
function packStubBody(encoded: Uint8Array): Uint8Array | null {
    try {
        return deflateSync(encoded, { level: 1 })
    } catch {
        return null
    }
}

/** What a stub's entry holds apart from its uuid and its packed bytes; every field is known once the body is encoded. */
interface StubEntryFields {
    name: string
    rawLength: number
    omittedChatData?: ForkOnlyChatLabel[]
}

/**
 * One packing job. While it is live it holds exactly its encoded body (still attached, for the main-thread fallback) and
 * its character (for the double fault, where neither thread can pack). Its settlement releases both and removes it from
 * the live set; the outcome list holds a record only through its `pending` outcome, which the settlement replaces.
 */
interface PackRecord {
    key: string
    /** The record's position in the outcome list. */
    index: number
    fields: StubEntryFields
    bytes: Uint8Array | undefined
    character: Slot | undefined
    /** Settles once, after the record is released; never rejects. */
    done: Promise<void>
}

/** One consumed slot's result, in consume order. */
type StubOutcome =
    | { kind: 'inline', key: string, character: Slot }
    | { kind: 'stub', key: string, fields: StubEntryFields, packed: Uint8Array }
    | { kind: 'pending', key: string, record: PackRecord }

/** The entry the stub's outcome becomes: the uuid is minted here, so uuids follow consume order and a double fault mints none. */
function mintStubEntry(fields: StubEntryFields, packed: Uint8Array): MintedStubEntry {
    const uuid = uuidv4()
    return { uuid, name: fields.name, backupName: getColdStorageBackupName(uuid), rawLength: fields.rawLength, packed, ...(fields.omittedChatData !== undefined ? { omittedChatData: fields.omittedChatData } : {}) }
}

/** A minted stub entry that does not unpack to the body it was packed from. The export that meets it fails. */
export class StubEntryUnpackError extends Error {
    constructor(backupName: string, detail: string) {
        super(`The stub entry ${backupName} could not be unpacked: ${detail}`)
        this.name = 'StubEntryUnpackError'
    }
}

/**
 * The body of `entry` as it was minted. Each call returns a new `Uint8Array` that no other entry and no later call
 * shares: a body of 1 MiB or more reaches the writer uncopied, and a writer or a test sink may hold it by reference until
 * it closes, so a buffer reused for the next entry would change a body already handed over. Inflating without an output
 * buffer lets fflate size the result; the length check then catches a packed body paired with another body's length, a
 * cut-off stream and an empty one. It is a framing check, not protection against flipped bits: raw deflate carries no
 * checksum, and the minted bytes were never checksummed either.
 */
export function unpackStubEntry(entry: MintedStubEntry): Uint8Array {
    let body: Uint8Array
    try {
        body = inflateSync(entry.packed)
    } catch (error) {
        throw new StubEntryUnpackError(entry.backupName, error instanceof Error ? error.message : 'the packed bytes cannot be inflated')
    }
    if (body.byteLength !== entry.rawLength) {
        throw new StubEntryUnpackError(entry.backupName, `${body.byteLength} bytes came out, ${entry.rawLength} were expected`)
    }
    return body
}

/**
 * Whether `character` names a cold-storage root (a pointer, an error-text key or archived chats). Such a character is
 * exported whole, so the late collection lists its roots from the encoded tree and carries or reports its units, as it
 * does for an inline export.
 */
function hasColdRoots(character: Slot): boolean {
    return listColdBackupRoots({ characters: [character], pluginCustomStorage: {} }).length > 0
}

/** The entity a slot names and its identity in an export, or `null` when the slot is not a stub of a store2 entity. */
function stubTarget(slot: Slot): { u: string, key: string } | null {
    const u = typeof slot === 'object' && slot !== null ? slot.coldstorage : undefined
    if (typeof u !== 'string' || !isEntityUnitKey(u)) {
        return null
    }
    return { u, key: inlineKeyOf(u, slot.chaId) }
}

/** A first read of a stub, settled either way: a failure waits for the consumer of its slot instead of becoming an unhandled rejection. */
type SettledRead = { copy: ColdCopyOutcome } | { error: unknown }

function startSettledRead(slot: Slot): Promise<SettledRead> {
    let read: Promise<ColdCopyOutcome>
    try {
        read = readColdCharacterCopy(slot)
    } catch (error) {
        read = Promise.reject(error)
    }
    return read.then((copy): SettledRead => ({ copy }), (error: unknown): SettledRead => ({ error }))
}

/**
 * Reads the character of every stub of `db` that names a store2 entity. Installs nothing and marks nothing.
 * The first read of up to `STUB_READ_AHEAD` stubs after the one being consumed is already running, but the stubs are
 * consumed one at a time in list order, so the result maps and `failedKeys` have the order a serial read gives; a
 * retry read is made by the consumer, one at a time.
 * In `stub` mode a stub is kept as a stub and only its unit entry is held, unless the list needs the id repair
 * (`characterListNeedsRepair`): then every stub is inlined, so no unit body is minted with ids the repair will change.
 * A trashed stub (a truthy `trashTime` on the page's stub) and a character with a cold-storage root are inlined in every
 * mode.
 */
export async function readStubsForExport(db: Pick<Database, 'characters' | 'upstreamKvBlocks'>, options: ExportCollectionOptions = {}): Promise<StubsForExport> {
    const requestedAhead = options.readAhead ?? (MEASURE ? readAheadKnob() : undefined) ?? STUB_READ_AHEAD
    const ahead = Number.isFinite(requestedAhead) ? Math.max(0, Math.floor(requestedAhead)) : STUB_READ_AHEAD
    if (MEASURE) {
        // The partial export reads stubs too, so each read of the stubs starts its own stats.
        const { moduleSnapshotMs, moduleSnapshotCount } = stubStats
        stubStats = emptyStubStats()
        stubStats.ahead = ahead
        stubStats.moduleSnapshotMs = moduleSnapshotMs
        stubStats.moduleSnapshotCount = moduleSnapshotCount
    }
    const loopAt = MEASURE ? stubMark() : 0
    const mode = (options.mode ?? EXPORT_UNLOADED_CHARACTERS) === 'stub' && !characterListNeedsRepair(db.characters, kvBlockNamesOf(db.upstreamKvBlocks)) ? 'stub' : 'inline'
    const retry: ReadRetryPolicy = { ...DEFAULT_READ_RETRY, ...options.readRetry }
    const inlined = new Map<string, Slot>()
    const stubEntries = new Map<string, MintedStubEntry>()
    const failedKeys: string[] = []
    const list: unknown = db.characters
    if (!Array.isArray(list)) {
        return { inlined, stubEntries, failedKeys }
    }
    let waitedMs = 0
    let retries = 0
    // A copy: the list is the page's own and may change across the awaits below, which must not make a stub skipped.
    const slots = [...(list as Slot[])]
    // The started first reads by slot index, until their slot is consumed.
    const firstReads = new Map<number, { key: string, settled: Promise<SettledRead>, ahead: boolean }>()
    // Every key that has an outcome, inline or stub, packing or settled. It is what tells a later slot of the same entity
    // from a first one; the result maps are filled only after the loop, in the order of `outcomes`.
    const taken = new Set<string>()
    // One entry per consumed slot that gave a character, in consume order. A `pending` entry is replaced in place when its job settles.
    const outcomes: StubOutcome[] = []
    // The live packing jobs, oldest first.
    const records = new Set<PackRecord>()
    const maxJobs = Math.max(1, Math.floor(options.pack?.maxJobs ?? STUB_PACK_MAX_JOBS))
    const budgetBytes = options.pack?.budgetBytes ?? STUB_PACK_BUDGET_BYTES
    const packClient = createStubPackClient({ disabled: MEASURE && packOnMainKnob() })
    // Set before the client ends on a failed collection, so no settlement packs a body nobody will read.
    let aborted = false
    const probe = () => {
        if (stubPackProbe === null) {
            return
        }
        let characters = 0
        let bytes = 0
        for (const record of records) {
            characters += record.character === undefined ? 0 : 1
            bytes += record.bytes?.byteLength ?? 0
        }
        stubPackProbe({ records: records.size, characters, bytes })
    }
    // A record's job has settled (or the client ended): its outcome is replaced in place, and the record, with its body and
    // its character, is released whatever happens. It never throws, so `done` never rejects.
    const settleRecord = (record: PackRecord, result: PackResult): void => {
        try {
            let outcome: StubOutcome | null = null
            if ('packed' in result) {
                outcome = { kind: 'stub', key: record.key, fields: record.fields, packed: result.packed }
            } else if (!aborted && record.bytes !== undefined && record.character !== undefined) {
                // The worker failed: the same encoded body is packed here. Neither thread can pack it: the character is inlined.
                const packed = packStubBody(record.bytes)
                if (packed !== null) {
                    outcome = { kind: 'stub', key: record.key, fields: record.fields, packed }
                    if (MEASURE) {
                        stubStats.packFallbacks += 1
                    }
                } else {
                    outcome = { kind: 'inline', key: record.key, character: record.character }
                }
            }
            if (outcome !== null) {
                outcomes[record.index] = outcome
            }
        } finally {
            record.bytes = undefined
            record.character = undefined
            records.delete(record)
            probe()
        }
    }
    const startPackJob = (key: string, fields: StubEntryFields, bytes: Uint8Array, character: Slot): void => {
        const record: PackRecord = { key, index: outcomes.length, fields, bytes, character, done: Promise.resolve() }
        record.done = packClient.submit(bytes).then((result) => settleRecord(record, result))
        records.add(record)
        outcomes.push({ kind: 'pending', key, record })
        if (MEASURE) {
            stubStats.packHeldMax = Math.max(stubStats.packHeldMax, records.size)
        }
        probe()
    }
    // Whether the next body must wait for a live job: the count cap, or the byte budget. A body larger than the budget is admitted alone.
    const mustWaitForJob = (rawLength: number): boolean => {
        if (records.size === 0) {
            return false
        }
        if (records.size >= maxJobs) {
            return true
        }
        let held = 0
        for (const record of records) {
            held += record.fields.rawLength
        }
        return held + rawLength > budgetBytes
    }
    const startAhead = (from: number) => {
        const last = Math.min(from + ahead, slots.length - 1)
        for (let index = from; index <= last; index++) {
            if (firstReads.has(index)) {
                continue
            }
            const target = stubTarget(slots[index])
            // A stub whose entity is read, or being read, for an earlier slot waits for that slot's outcome.
            if (target === null || taken.has(target.key) || [...firstReads.values()].some((started) => started.key === target.key)) {
                continue
            }
            firstReads.set(index, { key: target.key, settled: startSettledRead(slots[index]), ahead: index > from })
            if (MEASURE) {
                stubStats.heldMax = Math.max(stubStats.heldMax, firstReads.size)
            }
        }
    }
    try {
        for (let index = 0; index < slots.length; index++) {
            startAhead(index)
            const slot = slots[index]
            const target = stubTarget(slot)
            const started = firstReads.get(index)
            firstReads.delete(index)
            if (target === null) {
                continue
            }
            const { u, key } = target
            if (taken.has(key)) {
                continue
            }
            // The slot may have changed since its read started; a read of another entity or character is not this slot's.
            const prefetched = started !== undefined && started.key === key
            const firstRead = prefetched ? started.settled : startSettledRead(slot)
            const firstReadAt = MEASURE ? stubMark() : 0
            let settled = await firstRead
            // A store failure that hit several concurrent reads together must not be charged once per read: a read made
            // ahead that failed without a kind is made again at its slot's own turn, outside the retry budget. The read
            // made ahead is a free extra attempt, and a shared failure is charged once, at the slot's own turn.
            if (prefetched && started.ahead && 'copy' in settled && settled.copy.status === 'unreadable' && settled.copy.kind === undefined) {
                settled = await startSettledRead(slot)
            }
            if ('error' in settled) {
                throw settled.error
            }
            let copy = settled.copy
            if (MEASURE) {
                stubStats.characters += 1
                stubStats.readMs += stubElapsed(firstReadAt)
            }
            // A read that failed without a kind of its own may succeed a moment later; a missing or damaged unit never will.
            for (const pause of retry.pausesMs) {
                if (copy.status !== 'unreadable' || copy.kind !== undefined || waitedMs + pause > retry.budgetMs || retries >= retry.maxRetries) {
                    break
                }
                waitedMs += pause
                retries++
                if (MEASURE) {
                    stubStats.retries += 1
                }
                await retry.pause(pause)
                const retryReadAt = MEASURE ? stubMark() : 0
                copy = await readColdCharacterCopy(slot)
                if (MEASURE) {
                    stubStats.readMs += stubElapsed(retryReadAt)
                }
            }
            if (copy.status !== 'ok') {
                if (MEASURE) {
                    stubStats.failed += 1
                }
                if (!failedKeys.includes(u)) {
                    failedKeys.push(u)
                }
                continue
            }
            const coldRootsAt = MEASURE && mode === 'stub' && !slot.trashTime ? stubMark() : 0
            const asStub = mode === 'stub' && !slot.trashTime && !hasColdRoots(copy.character)
            if (MEASURE && mode === 'stub' && !slot.trashTime) {
                stubStats.coldRootsMs += stubElapsed(coldRootsAt)
            }
            if (!asStub) {
                taken.add(key)
                outcomes.push({ kind: 'inline', key, character: copy.character })
                continue
            }
            const encodeAt = MEASURE ? stubMark() : 0
            const noteEncode = () => {
                if (MEASURE) {
                    const encodeElapsed = stubElapsed(encodeAt)
                    stubStats.encodeMs += encodeElapsed
                    stubStats.encodeMsMax = Math.max(stubStats.encodeMsMax, encodeElapsed)
                }
            }
            const omitted = forkOnlyChatLabels(copy.character)
            const body = stubUnitBody(copy.character)
            if (body === null) {
                noteEncode()
                taken.add(key)
                outcomes.push({ kind: 'inline', key, character: copy.character })
                continue
            }
            const fields: StubEntryFields = { name: copy.character.name, rawLength: body.byteLength, ...(omitted.length > 0 ? { omittedChatData: omitted } : {}) }
            if (packClient.available()) {
                // The wait holds this step's character and body, outside the budget of the live jobs.
                noteEncode()
                if (mustWaitForJob(fields.rawLength)) {
                    const waitAt = MEASURE ? stubMark() : 0
                    while (mustWaitForJob(fields.rawLength)) {
                        const oldest = records.values().next().value
                        if (oldest === undefined) {
                            break
                        }
                        await oldest.done
                        // A settled record that is still live would make this loop spin without yielding.
                        if (records.has(oldest)) {
                            throw new Error('Internal error: a settled stub packing job was not released.')
                        }
                    }
                    if (MEASURE) {
                        stubStats.packWaitMs += stubElapsed(waitAt)
                    }
                }
                // No job is posted while the page may be frozen: the body is packed here, as without a worker.
                if (!shouldBypassFrozenPagePaths()) {
                    taken.add(key)
                    startPackJob(key, fields, body, copy.character)
                    continue
                }
                const packedHere = packStubBody(body)
                taken.add(key)
                outcomes.push(packedHere === null ? { kind: 'inline', key, character: copy.character } : { kind: 'stub', key, fields, packed: packedHere })
                continue
            }
            const packed = packStubBody(body)
            noteEncode()
            taken.add(key)
            outcomes.push(packed === null ? { kind: 'inline', key, character: copy.character } : { kind: 'stub', key, fields, packed })
        }
        if (MEASURE) {
            stubStats.loopMs = stubElapsed(loopAt)
        }
        // Every job settles, and none rejects; each settlement has replaced its `pending` outcome.
        const drainAt = MEASURE ? stubMark() : 0
        await Promise.all([...records].map((record) => record.done))
        if (MEASURE) {
            stubStats.packDrainMs += stubElapsed(drainAt)
        }
        // The uuids are minted here, in consume order, so a stub that fell back to inline mints none.
        for (const outcome of outcomes) {
            if (outcome.kind === 'inline') {
                inlined.set(outcome.key, outcome.character)
            } else if (outcome.kind === 'stub') {
                const entry = mintStubEntry(outcome.fields, outcome.packed)
                if (MEASURE) {
                    stubStats.rawBytes += entry.rawLength
                    stubStats.packedBytes += entry.packed.byteLength
                }
                stubEntries.set(outcome.key, entry)
            } else {
                throw new Error('Internal error: a stub packing job was still pending after the drain.')
            }
        }
        return { inlined, stubEntries, failedKeys }
    } catch (error) {
        aborted = true
        throw error
    } finally {
        packClient.terminate()
    }
}

/**
 * `slot` with its `coldstorage` replaced by the uuid minted for its entity in `stub` mode, or `null` when no entry was
 * minted for it. The stub keeps its last interaction and every other field. A slot that is trashed when the export is
 * encoded gets `null` too, so a character trashed after its entry was minted is exported whole and trashed, never as a
 * stub.
 */
export function stubWithMintedKey(slot: Slot, stubEntries: ReadonlyMap<string, MintedStubEntry>): Slot | null {
    const u = typeof slot === 'object' && slot !== null ? slot.coldstorage : undefined
    if (typeof u !== 'string' || !isEntityUnitKey(u) || slot.trashTime) {
        return null
    }
    const entry = stubEntries.get(inlineKeyOf(u, slot.chaId))
    return entry === undefined ? null : { ...slot, coldstorage: entry.uuid }
}

/**
 * The whole character of a stub that has a minted entry, read back from the entry's bytes, with the stub's trash time and
 * last interaction; `null` only when no entry was minted for it. The fallback of an export whose list turns out to need the
 * id repair after the entries were minted, or whose stub was trashed after its entry was minted. An entry that is found
 * and does not give a character throws, because the caller would otherwise leave the stub of an entity in the file as a
 * placeholder, and an export that reports saved must carry every character it minted.
 */
export function inlinedFromMinted(slot: Slot, stubEntries: ReadonlyMap<string, MintedStubEntry>): Slot | null {
    const u = typeof slot === 'object' && slot !== null ? slot.coldstorage : undefined
    if (typeof u !== 'string' || !isEntityUnitKey(u)) {
        return null
    }
    const entry = stubEntries.get(inlineKeyOf(u, slot.chaId))
    if (entry === undefined) {
        return null
    }
    const body: unknown = JSON.parse(new TextDecoder().decode(unpackStubEntry(entry)))
    const character = typeof body === 'object' && body !== null ? (body as { character?: Slot }).character : undefined
    if (character === undefined || character === null) {
        throw new StubEntryUnpackError(entry.backupName, 'the body holds no character')
    }
    return applyStubStateOnRestore(slot, character)
}

/**
 * The unit entries to write for `characters`, the list that is encoded: one for each minted uuid some stub of it names,
 * in list order. An entry whose stub is not in the list (the character was loaded while the export ran) is not written.
 */
export function stubEntriesInTree(characters: unknown, stubEntries: ReadonlyMap<string, MintedStubEntry>): MintedStubEntry[] {
    if (!Array.isArray(characters) || stubEntries.size === 0) {
        return []
    }
    const byUuid = new Map<string, MintedStubEntry>()
    for (const entry of stubEntries.values()) {
        byUuid.set(entry.uuid, entry)
    }
    const written = new Set<string>()
    const entries: MintedStubEntry[] = []
    for (const slot of characters as unknown[]) {
        const key = typeof slot === 'object' && slot !== null ? (slot as Slot).coldstorage : undefined
        const entry = typeof key === 'string' ? byUuid.get(key) : undefined
        if (entry !== undefined && !written.has(key as string)) {
            written.add(key as string)
            entries.push(entry)
        }
    }
    return entries
}

/**
 * `slot`, or the whole character that was read for it. The stub's trash time and last interaction are applied here, at
 * the time of the encode, so a character trashed while the export copies assets is exported trashed.
 */
export function inlinedCharacter(slot: Slot, inlined: ReadonlyMap<string, Slot>): Slot {
    const u = typeof slot === 'object' && slot !== null ? slot.coldstorage : undefined
    if (typeof u !== 'string' || !isEntityUnitKey(u)) {
        return slot
    }
    const whole = inlined.get(inlineKeyOf(u, slot.chaId))
    return whole === undefined ? slot : applyStubStateOnRestore(slot, whole)
}

export interface BackupColdStorage {
    /** The legacy units to carry. No store2 entity is among them. */
    collected: ColdStorageBackupCollection
    inlined: ReadonlyMap<string, Slot>
    /** In `stub` mode, the unit entries minted for the stubs that stay stubs; which are written is decided by the encoded tree. */
    stubEntries: ReadonlyMap<string, MintedStubEntry>
    failedKeys: readonly string[]
    /** Every key the backup cannot carry; the incomplete-data prompt names them. */
    unavailableKeys: string[]
}

/**
 * The first cold-storage collection of an export: the stubs are read first, and the collector is given the roots that
 * are legacy units and the unreadable entities as already settled, so it neither reads an entity nor carries one under
 * a payload name.
 */
export async function collectBackupColdStorage(db: Database, options: ExportCollectionOptions = {}): Promise<BackupColdStorage> {
    const { inlined, stubEntries, failedKeys } = await readStubsForExport(db, options)
    const legacyAt = MEASURE ? stubMark() : 0
    const plugin = pluginStorageForExport(db)
    const collected = await collectColdStorageBackupPayloads(db, {
        roots: listColdBackupRoots(db).filter((root) => !isEntityUnitKey(root.key) && !plugin.ids.has(root.key)),
        settledKeys: new Set([...failedKeys, ...plugin.ids]),
    })
    const merged = mergePluginStorage(collected, plugin)
    if (MEASURE) {
        stubStats.legacyCollectMs = stubElapsed(legacyAt)
    }
    return { collected: merged, inlined, stubEntries, failedKeys, unavailableKeys: [...merged.missingKeys, ...merged.invalidKeys, ...failedKeys] }
}

export interface PluginStorageForExport {
    /** `db` without the plain keys of the values carried as units; `db` itself when none are. */
    tree: Database
    /** One unit payload per mapped id that has a value in the tree, in the shape the legacy collector writes. */
    payloads: ColdStorageBackupPayload[]
    /** The mapped ids with no value in the tree. */
    missingKeys: string[]
    /** For each missing id, the plugin slot that names it, in the form the incomplete-data prompt lists characters. */
    owners: Map<string, string[]>
    /** Every mapped id: the legacy collector must not read, carry or report these. */
    ids: Set<string>
}

/**
 * While a store2 residency is registered, a plugin slot's value lives in `pluginCustomStorage[<id>]` of the tree and the
 * legacy unit store holds none or a stale one. The export writes each mapped value as the `coldstorage_<id>` payload the
 * legacy collector would write, so the fork's re-import restores it, and leaves the plain key out of the exported copy,
 * never out of the page.
 * `skip` holds ids an earlier collection already settled. Without a residency nothing changes: the legacy collector
 * reads the units.
 */
export function pluginStorageForExport(db: Database, skip: ReadonlySet<string> = new Set()): PluginStorageForExport {
    const result: PluginStorageForExport = { tree: db, payloads: [], missingKeys: [], owners: new Map(), ids: new Set() }
    const storage = db.pluginCustomStorage
    if (getResidency() === null || typeof storage !== 'object' || storage === null) {
        return result
    }
    const slots = new Map<string, string>()
    for (const [slot, id] of Object.entries(storage._coldplugin ?? {})) {
        if (typeof id === 'string' && !slots.has(id)) {
            slots.set(id, slot)
        }
    }
    // The listing the legacy collector uses, so the two cannot disagree on which ids are mapped.
    for (const id of listColdPluginStorageKeys(db)) {
        result.ids.add(id)
    }
    for (const id of result.ids) {
        if (skip.has(id)) {
            continue
        }
        let encoded: Uint8Array | null = null
        try {
            const json: string | undefined = storage[id] === undefined ? undefined : JSON.stringify(storage[id])
            encoded = json === undefined ? null : new TextEncoder().encode(json)
        } catch {
            encoded = null
        }
        if (encoded === null) {
            result.missingKeys.push(id)
            result.owners.set(id, [`Plugin storage "${slots.get(id)}"`])
        } else {
            result.payloads.push({ key: id, backupName: getColdStorageBackupName(id), encoded })
        }
    }
    if (result.ids.size > 0) {
        result.tree = {
            ...db,
            pluginCustomStorage: Object.fromEntries(Object.entries(storage).filter(([key]) => !result.ids.has(key))),
        }
    }
    return result
}

/** `collected` with the plugin payloads, missing ids and their owners added; `collected` itself when there are none. */
export function mergePluginStorage(collected: ColdStorageBackupCollection, plugin: PluginStorageForExport): ColdStorageBackupCollection {
    if (plugin.ids.size === 0) {
        return collected
    }
    const owners = new Map(collected.owners ?? [])
    for (const [key, names] of plugin.owners) {
        owners.set(key, names)
    }
    return {
        payloads: [...collected.payloads, ...plugin.payloads],
        missingKeys: [...collected.missingKeys, ...plugin.missingKeys],
        invalidKeys: collected.invalidKeys,
        owners: owners.size > 0 ? owners : undefined,
        settledKeys: new Set([...(collected.settledKeys ?? []), ...plugin.ids]),
        ...(collected.omittedChatData !== undefined ? { omittedChatData: collected.omittedChatData } : {}),
    }
}

/**
 * The chats whose fork-only data this export leaves out, known before the writer opens: those of the page's resident
 * characters, of the characters read for stubs (inlined or minted as unit entries) and of the units already collected.
 * Each chat appears once; the same chat read through two sources holds the kinds of both. The prompts before the export
 * name them; a kind found only later is reported afterwards.
 */
export function exportForkOnlyLabels(db: Pick<Database, 'characters'>, cold: BackupColdStorage): ForkOnlyChatLabel[] {
    const labels = new Map<string, ForkOnlyChatLabel>()
    const add = (label: ForkOnlyChatLabel) => {
        const known = labels.get(label.key)
        if (known === undefined) {
            labels.set(label.key, { ...label, kinds: [...label.kinds] })
        } else {
            known.kinds.push(...label.kinds.filter((kind) => !known.kinds.includes(kind)))
        }
    }
    for (const slot of Array.isArray(db.characters) ? db.characters : []) {
        forkOnlyChatLabels(slot).forEach(add)
    }
    for (const character of cold.inlined.values()) {
        forkOnlyChatLabels(character).forEach(add)
    }
    for (const entry of cold.stubEntries.values()) {
        entry.omittedChatData?.forEach(add)
    }
    cold.collected.omittedChatData?.forEach(add)
    return [...labels.values()]
}

/**
 * The size at which a backup entry no longer fits: 4 GiB, 2^32 bytes. The container states an entry's length in 32 bits
 * (`encodeBackupEntryHeader` in `exportWriters.ts`, and `LocalWriter.writeBackup`, which throws above 0xFFFFFFFF), and
 * upstream's `LocalWriter.writeBackup` writes `new Uint32Array([data.byteLength])`, which wraps a length of 2^32 or more
 * into a smaller one that no reader can parse. So an item of exactly this many bytes or more cannot be saved.
 *
 * Known limit: only what is sized before the writer opens is checked: the in-memory payloads of the first collection and
 * the stub entries, and, where the desktop listing gives sizes (a full backup on Tauri), the assets. On the web, on
 * Node and in the partial writer an asset's size is unknown until it is read, and the database entry and late payloads
 * are encoded after the writer opens, so an item of this size there still fails the whole export loudly, as before.
 * Sizing them earlier is a stage 0b carry (chunked Node upload changes what a Node page can hold).
 */
export const UPSTREAM_HARD_LIMIT_BYTES = 0x100000000

/** An item the backup cannot carry because it is `size` bytes: its name for the prompt, and its size. */
export interface OversizeItem {
    name: string
    size: number
}

/**
 * `cold` without the units and stub entries of `limitBytes` or more, and the items left out. A unit left out is settled
 * (the late collection does not carry it either) and is missing from the file; a stub whose entry is left out stays the
 * page's own stub in the file and is imported as a placeholder, like an entity that could not be read. `cold` itself when
 * nothing is too large.
 */
export function leaveOutOversizePayloads(cold: BackupColdStorage, limitBytes: number = UPSTREAM_HARD_LIMIT_BYTES): { cold: BackupColdStorage, items: OversizeItem[] } {
    const items: OversizeItem[] = []
    const droppedKeys: string[] = []
    const payloads = cold.collected.payloads.filter((payload) => {
        if (payload.encoded.byteLength < limitBytes) {
            return true
        }
        droppedKeys.push(payload.key)
        items.push({ name: cold.collected.owners?.get(payload.key)?.join(', ') ?? `Cold storage unit ${payload.key}`, size: payload.encoded.byteLength })
        return false
    })
    const stubEntries = new Map<string, MintedStubEntry>()
    const failedKeys = [...cold.failedKeys]
    for (const [key, entry] of cold.stubEntries) {
        if (entry.rawLength < limitBytes) {
            stubEntries.set(key, entry)
            continue
        }
        items.push({ name: entry.name, size: entry.rawLength })
        failedKeys.push(key.split('\u0000')[0])
    }
    if (items.length === 0) {
        return { cold, items }
    }
    const collected: ColdStorageBackupCollection = {
        ...cold.collected,
        payloads,
        settledKeys: new Set([...(cold.collected.settledKeys ?? []), ...droppedKeys]),
    }
    return { cold: { ...cold, collected, stubEntries, failedKeys }, items }
}

/**
 * The keys the late collection must not read again: everything the first collection settled, every entity it could not
 * read, and every uuid minted for a stub of this export, which names an entry this export writes and no legacy unit.
 */
export function lateSettledKeys(collected: ColdStorageBackupCollection, failedKeys: readonly string[], stubEntries: ReadonlyMap<string, MintedStubEntry> = new Map()): Set<string> {
    return new Set([...(collected.settledKeys ?? []), ...failedKeys, ...[...stubEntries.values()].map((entry) => entry.uuid)])
}
