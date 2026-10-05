import { v4 as uuidv4 } from 'uuid'
import type { Database } from './database.svelte'
import type { ColdStorageReadResult } from '../process/coldstorage.svelte'
import { BlockTooLargeError, type BlockLayout, type BlockSetInput } from './blockStore'
import { parseFramedHeader } from './blockFrame'
import { packedNamesOf } from './packedNames'
import {
    RisuSaveEncoder,
    RisuSaveType,
    decodeRisuSave,
    hashRemoteBlockContent,
    listEncodedBlocks,
    type EncodedBlockView,
    type toSaveType,
} from './risuSave'
import { buildColdStub, enrichLegacyStub, isLegacyStub } from '../process/coldCharacter'
import { coldStorageHeader } from '../process/coldstorageData'
import { repairDatabaseIds } from '../process/chatIds'
import { hasEnabledV21Plugin } from '../plugins/v21Plugins'
import { applyCharacterDefaults, resetChatStreamingState } from './characterDefaults'
import type { ArchiveMemo, ArchiveStrikeState } from './bootArchiveMemo'

/**
 * The boot archive pass: on a boot that read and strictly decoded the saved
 * profile, before the database is installed, every eligible full character
 * is written to its own cold-storage unit, replaced in the decoded tree by a
 * stub, and the tree is committed, all under exclusive access. A profile in
 * the block store is committed as a save into its live generation; a legacy
 * profile (no head yet) is converted by that same commit. The caller installs
 * the tree this module returns.
 *
 * The same pass rewrites every stub the upstream application made (a
 * "legacy" stub: no current `coldVersion`, the type always `'character'`, no
 * description or chat count) from its unit, so it carries what the fork's own
 * stubs carry. That runs on a profile with archiving on, in the same commit,
 * and on a profile with archiving off, where it archives nothing, writes no
 * unit, leaves the setting off and posts no notice.
 *
 * A crash-loop breaker counts the passes that started reading or writing units
 * and did not succeed. The count is recorded before the first unit is read,
 * reset when a pass succeeds, and two in a row pause the pass on this device
 * until the setting is turned off and on. A count that cannot be read or
 * recorded stops the pass. A profile with archiving off keeps its own count of
 * enrichment attempts, which stops enrichment on this device after two failed
 * attempts in a row.
 *
 * Every effect the pass makes itself (unit writes and reads, the commit, the
 * re-read after a failed pass, the hold, progress) arrives through
 * `BootArchiveDeps`; the production binding of those effects lives in
 * `bootArchiveHost.ts`, which is loaded only when no deps are given. The pass
 * imports no `coldstorage.svelte` and no lock binding. It does import
 * `risuSave`, which itself reaches the page's byte store (`appStore`, and
 * through it `globalApi.svelte` and `stores.svelte`) for remote character
 * files it reads and `database.svelte` for the live remote-saving flag; a test
 * of this module therefore mocks `globalApi.svelte` and `database.svelte`, and
 * a test whose tree holds remote character blocks also mocks `appStore`. Keep
 * the static imports to `blockStore`, `blockFrame`, `packedNames`, `risuSave`,
 * `coldCharacter`, `coldstorageData`, `chatIds`, `v21Plugins`,
 * `characterDefaults`, `uuid` and type-only imports.
 *
 * The pass's encoder writes nothing to storage: it frames the blocks and the
 * commit seam stores them.
 */

/** Which boot branch of `loadData` is calling. */
export type BootArchiveHost = 'web' | 'tauri'

/** Facts the capability and eligibility gates read, sampled when the session opens. */
export interface BootArchiveEnvironment {
    host: BootArchiveHost
    /** Web only: the self-hosted Node server backs the main file and the units. */
    isNodeServer: boolean
    /** Tauri only: a desktop build (single instance; not a mobile OS). */
    tauriDesktop: boolean
    /** Web only: `locksSupported !== false && !!navigator.locks`. */
    locksSupported: boolean
    /**
     * Web only: the page's byte store is the IndexedDB store. A page that fell
     * back to OPFS must not archive, because the pass writes new units into the
     * page's store.
     */
    indexedDbStore: boolean
    /** `forageStorage.staleAccountProfile`: that boot never reaches plugins or `saveDb`. */
    staleAccountProfile: boolean
}

/**
 * The release function `acquireExclusiveStorageMigrationLock` resolves to.
 * The pass always calls it with no argument: `release(true)` leaves the write
 * lock closed and every later `saveDb` write would wait forever.
 */
export type BootArchiveHoldRelease = (keepWriteLock?: boolean) => Promise<void>

export interface BootArchiveDeps {
    env(): BootArchiveEnvironment
    /** Web only, never called on Tauri: the exclusive hold; `null` when it was not granted within `timeoutMs`. */
    acquireHold(timeoutMs: number): Promise<BootArchiveHoldRelease | null>
    /** `isAppInitiatedReload()`: true when a refused hold meant this page is reloading. */
    isReloading(): boolean
    /**
     * Commits the pass's result: a save into the live generation of a block
     * profile, or the conversion of a legacy one. Resolves only when the commit
     * is durable and acknowledged. Rejects on every other outcome, with
     * `BlockTooLargeError` when a value is over the Node server's limit (the
     * pass reports that as "too large", not as a failure). A rejected commit
     * leaves the previous root (or the legacy main file) authoritative.
     */
    commit(input: BlockSetInput): Promise<void>
    /**
     * What storage holds now, read again after a failed pass; never writes.
     * `bytes` is a legacy main file (the pass decodes it as boot does), `tree` a block
     * profile's committed state already decoded, and `damaged` a committed
     * state that does not read cleanly. Rejects when the read fails.
     */
    reread(): Promise<BootReread>
    /** The `setColdStorageItem` contract: `true` when the unit was written, `false` on any failure. */
    writeUnit(key: string, value: { character: Database['characters'][number] }): Promise<boolean>
    /** The `readColdStorageItem` contract. */
    readUnit(key: string): Promise<ColdStorageReadResult>
    /** Unit ids; defaults to `uuid` v4 (the backup layer requires UUID-shaped keys). */
    newUnitKey?(): string
    /** The encoder the commit is built with; defaults to `new RisuSaveEncoder()`. */
    createEncoder?(): RisuSaveEncoder
    /**
     * The notice memo the pass reads: `chaId`s it does not try again, whether
     * the Node server refused a commit as too large, and whether the user was
     * told archiving is paused. The pass never writes it; `bootstrap.ts` does,
     * after it has posted the notice that carries it. A read that fails
     * answers an empty memo.
     */
    readArchiveMemo(): ArchiveMemo
    /**
     * The strike count of the crash-loop breaker: how many passes in a row
     * started and did not succeed. `paused` is two or more, or a stored value
     * that is not a count; `unreadable` is a storage that cannot be read. Read
     * once per pass. A dep that throws is treated as `unreadable`.
     */
    readArchiveStrikes(): ArchiveStrikeState
    /**
     * Counts a pass that is about to read or write units or commit the main
     * file. Answers true only when the new count reads back from storage; the
     * pass reads and writes nothing when it answers false or throws. Called
     * before the first unit read or write and before the encoder runs.
     */
    recordArchiveStart(): boolean
    /** Sets the count to zero after a pass succeeded. A failure is logged and ignored. */
    resetArchiveStrikes(): void
    /**
     * The count that bounds stub enrichment on a profile with archiving off,
     * with the states of `readArchiveStrikes`. Used only on such a profile that
     * holds a legacy stub; a dep that throws is treated as `unreadable`.
     */
    readStubEnrichStrikes(): ArchiveStrikeState
    /** Counts an enrichment attempt about to read units; the same contract as `recordArchiveStart`. */
    recordStubEnrichStart(): boolean
    /** Removes the enrichment count after an attempt completed. A failure is logged and ignored. */
    clearStubEnrichStrikes(): void
    /**
     * The largest request body, in bytes, the Node server accepts. Applied only
     * when `env().isNodeServer` (web); absent means no limit is applied.
     */
    nodeBodyLimit?: number
    /** Progress text shown while archiving or updating stubs, English, with the count of N. */
    setProgress?(text: string): void
}

/** What `BootArchiveDeps.reread` found. */
export type BootReread =
    | { kind: 'bytes', bytes: Uint8Array | null | undefined }
    | { kind: 'tree', tree: Database }
    | { kind: 'damaged' }

export interface BootArchivePassInput {
    /** The tree `decodeRisuSave(bytes, { strict: true })` returned. The pass may mutate it and return it. */
    tree: Database
    /** `chaId`s that must stay full. The 5c boot never supplies it. */
    keepInline?: ReadonlySet<string>
}

/**
 * A notice the caller translates and posts after the install, awaiting each in
 * order. The caller writes the notice memo a notice carries only after it has
 * posted that notice: `archive-skipped` memoises `characters`,
 * `archive-too-large` memoises the device, and `archive-paused` records that
 * the user was told. The strike count is not part of that memo: the pass
 * writes it itself, through `BootArchiveDeps`.
 */
export type BootArchiveNotice =
    | { kind: 'archive-enabled' }
    /** Characters whose unit could not be stored; they stay fully loaded. In slot order. */
    | { kind: 'archive-skipped', characters: { chaId: string, name: string }[] }
    /** Two units in a row could not be stored, so archiving stopped for this boot; `characterName` is the second one. */
    | { kind: 'archive-stopped', characterName: string }
    /** On the Node server: the encoded commit was over the server's body limit and was not sent. */
    | { kind: 'archive-too-large' }
    /** Two passes in a row started and did not succeed, or the stored count is not a whole number, so archiving is paused on this device until the setting is turned off and on. Always the last notice. */
    | { kind: 'archive-paused' }

export type BootArchiveOutcome =
    /**
     * Install `tree`. `noteBytes` are the legacy main-file bytes the re-read
     * after a failed pass returned, for `noteMainFileBytes`, or `null`: a
     * commit leaves no main file to record, and a pass that wrote nothing
     * leaves the boot's own record standing. `notices` are in the order they
     * are posted. `committed` is present, and true, only when the pass itself
     * committed.
     */
    | { kind: 'install', tree: Database, noteBytes: Uint8Array | null, notices: BootArchiveNotice[], committed?: true }
    /** The re-read returned legacy bytes that do not decode, or the committed state does not read cleanly: the caller takes its existing fallback path. Nothing is written. */
    | { kind: 'backup-fallback' }
    /** Every host (desktop included): the re-read threw or returned nothing. The caller stops the boot with `error` shown; nothing is written and no backup is read. */
    | { kind: 'stop', error: unknown }

export interface BootArchiveSession {
    /** True when this boot may run a pass: capable host, hold granted (web), not a stale-account profile. */
    readonly canArchive: boolean
    /** True when the hold was refused because this page is reloading; the caller must not carry on booting. */
    readonly reloading?: boolean
    /**
     * Runs the pass over a strictly decoded tree. It never rejects: every
     * failure is reported through the outcome. It releases the hold itself
     * once the commit settles, or at once when it will not commit.
     */
    run(input: BootArchivePassInput): Promise<BootArchiveOutcome>
    /** Releases whatever the session still holds; idempotent. The caller invokes it on every path that does not reach `run`. */
    release(): Promise<void>
    /**
     * The exclusive access a whole-state replace chosen at the damage prompt
     * needs. Taken after `release()`, because the boot hold must not stay up
     * while a person reads a prompt, and released by the caller with the
     * returned `release` (the write lock goes back with it).
     */
    acquireReplaceHold(): Promise<ReplaceHold>
}

export type ReplaceHold =
    /** The exclusive hold is held. */
    | { kind: 'held', release(): Promise<void> }
    /** Another tab is alive (or this page is reloading): the replace must not proceed. */
    | { kind: 'refused', reloading: boolean }
    /** Nothing can be held: the desktop app is a single instance, and a browser without Web Locks cannot exclude other tabs, so the caller confirms instead. */
    | { kind: 'unlocked', reason: 'single-instance' | 'no-web-locks' }

type Slot = Database['characters'][number]

/**
 * How long the session waits for the exclusive hold. Short on purpose: a
 * second tab that boots while another is open is refused after this long and
 * boots without a pass, so a long wait would only delay it for nothing.
 */
const HOLD_TIMEOUT_MS = 1000

/** How long the hold for a replace chosen at the damage prompt waits: the person is already waiting, so longer than the boot's. */
const REPLACE_HOLD_TIMEOUT_MS = 2000

/**
 * The oldest `formatversion` the pass archives. `checkNewFormat` migrates
 * character fields (image and emotion paths, `sdData`) only for a save whose
 * `formatversion` is falsy or below 3, and it sets `formatversion` itself, so
 * the value is read here from the raw decoded tree, before it runs. A save
 * below 5 has not been through every migration `checkNewFormat` runs, and the
 * pass archives only saves that have (Report 49 D10); such a save boots as it
 * always has, and a later boot archives it once the save holds 5.
 */
const MIN_FORMAT_VERSION = 5

/**
 * True when a request body of `length` bytes is accepted by a server whose body
 * parsers refuse a body larger than `limit` (`raw-body` refuses `length > limit`).
 */
export function fitsNodeBodyLimit(length: number, limit: number): boolean {
    return length <= limit
}

/** A block of the commit is over the Node server's body limit; the commit is not sent. */
class CommitTooLargeError extends Error { }

/** Block names the save file keeps for itself; a character block of the same name replaces or collides with one of them. */
const FIXED_BLOCK_NAMES: ReadonlySet<string> = new Set(['root', 'preset', 'modules', 'loadouts', 'plugins', 'pluginStorage', 'config'])

/** The block header holds a name's byte length in one byte. */
const MAX_BLOCK_NAME_BYTES = 255

/**
 * Opens the session. Call it after `forageStorage.Init()` (web) or at the
 * start of the Tauri read, and before the saved profile is read: the exclusive
 * hold is taken here, on every capable boot. `deps` defaults to the
 * production binding.
 */
export async function openBootArchiveSession(host: BootArchiveHost, deps?: BootArchiveDeps): Promise<BootArchiveSession> {
    let resolved = deps
    if (!resolved) {
        try {
            const { createProductionBootArchiveDeps } = await import('./bootArchiveHost')
            resolved = await createProductionBootArchiveDeps(host)
        } catch (error) {
            console.error('The boot archive pass is unavailable:', error)
            return disabledSession()
        }
    }
    return await createSession(host, resolved)
}

function installUntouched(tree: Database): BootArchiveOutcome {
    return { kind: 'install', tree, noteBytes: null, notices: [] }
}

function disabledSession(): BootArchiveSession {
    return {
        canArchive: false,
        async run(input) {
            return installUntouched(input.tree)
        },
        async release() { },
        async acquireReplaceHold() {
            return { kind: 'unlocked', reason: 'no-web-locks' }
        },
    }
}

async function createSession(host: BootArchiveHost, deps: BootArchiveDeps): Promise<BootArchiveSession> {
    const env = deps.env()
    const capable = host === 'web'
        ? env.locksSupported && (env.isNodeServer || env.indexedDbStore)
        : env.tauriDesktop
    let releaseHold: BootArchiveHoldRelease | null = null
    let canArchive = false
    let reloading = false
    if (capable && !env.staleAccountProfile) {
        if (host === 'web') {
            try {
                releaseHold = await deps.acquireHold(HOLD_TIMEOUT_MS)
            } catch (error) {
                console.error('The exclusive hold could not be requested:', error)
                releaseHold = null
            }
            canArchive = releaseHold !== null
            reloading = releaseHold === null && deps.isReloading()
        } else {
            canArchive = true
        }
    }

    let released = false
    const release = async () => {
        if (released) {
            return
        }
        released = true
        const give = releaseHold
        releaseHold = null
        if (give) {
            try {
                // No argument: the write lock goes back with the hold.
                await give()
            } catch (error) {
                console.error('Releasing the exclusive hold failed:', error)
            }
        }
    }

    let ran = false
    return {
        canArchive,
        reloading,
        async run(input) {
            // The pass archives and commits only under the boot hold: once the
            // session released it (a damage prompt did), the tree installs as it is.
            if (ran || released) {
                return installUntouched(input.tree)
            }
            ran = true
            try {
                return await runPass(host, deps, input, canArchive, host === 'web' && env.isNodeServer)
            } catch (error) {
                console.error('The boot archive pass failed before it changed anything:', error)
                return installUntouched(input.tree)
            } finally {
                await release()
            }
        },
        release,
        async acquireReplaceHold() {
            if (host === 'tauri') {
                return { kind: 'unlocked', reason: 'single-instance' }
            }
            if (!env.locksSupported) {
                return { kind: 'unlocked', reason: 'no-web-locks' }
            }
            let give: BootArchiveHoldRelease | null = null
            try {
                give = await deps.acquireHold(REPLACE_HOLD_TIMEOUT_MS)
            } catch (error) {
                console.error('The exclusive hold could not be requested:', error)
            }
            if (give === null) {
                return { kind: 'refused', reloading: deps.isReloading() }
            }
            const held = give
            return { kind: 'held', release: () => held() }
        },
    }
}

//#region eligibility

function isObjectSlot(value: unknown): value is Slot {
    return typeof value === 'object' && value !== null
}

/** The pass-wide gates P4 to P6 on the raw decoded tree. */
function passesTreeGates(tree: Database): boolean {
    return typeof tree.formatversion === 'number'
        && tree.formatversion >= MIN_FORMAT_VERSION
        && !hasEnabledV21Plugin(tree.plugins)
        && Array.isArray(tree.characters)
        && Array.isArray(tree.botPresets)
}

/**
 * The slots the pass archives. An array slot is never eligible: its `chaId`
 * property does not survive the unit's JSON round trip, so its read-back could
 * never match. A `chaId` the device memo lists is not tried again.
 */
function eligibleIndexes(
    characters: readonly Slot[],
    keepInline: ReadonlySet<string> | undefined,
    skippedBefore: ReadonlySet<string>,
): number[] {
    const holders = new Map<string, number>()
    for (const cha of characters) {
        const id = String(cha.chaId)
        holders.set(id, (holders.get(id) ?? 0) + 1)
    }
    const indexes: number[] = []
    for (let i = 0; i < characters.length; i++) {
        const cha = characters[i]
        if (
            Array.isArray(cha)
            || cha.coldstorage
            || cha.trashTime
            || typeof cha.chaId !== 'string'
            || cha.chaId.length === 0
            || cha.chaId.startsWith('§')
            || holders.get(cha.chaId) !== 1
            || keepInline?.has(cha.chaId)
            || skippedBefore.has(cha.chaId)
        ) {
            continue
        }
        indexes.push(i)
    }
    return indexes
}

/** The slots `enrichLegacyStub` may rewrite, in slot order. */
function legacyStubIndexes(characters: readonly Slot[]): number[] {
    const indexes: number[] = []
    for (let i = 0; i < characters.length; i++) {
        if (isLegacyStub(characters[i])) {
            indexes.push(i)
        }
    }
    return indexes
}

/**
 * Why the commit of this tree would fail on every boot, or null when it would
 * not. Evaluated on the tree the commit would encode, so the answer is a pure
 * function of it and a refused profile pays no write cost on any boot. It never
 * names a character: the reason is all that is logged.
 */
function refusalReason(tree: Database, characters: readonly Slot[]): string | null {
    for (const container of ['modules', 'plugins', 'loadouts'] as const) {
        if (!Array.isArray(tree[container])) {
            return `the ${container} container is not a list`
        }
    }
    const seen = new Set<string>()
    for (const cha of characters) {
        const id = String(cha.chaId)
        if (FIXED_BLOCK_NAMES.has(id)) {
            return 'a character id is the name of a block the save file keeps for itself'
        }
        if (id === '__proto__') {
            return 'a character id is __proto__'
        }
        if (seen.has(id)) {
            return 'two characters have the same id'
        }
        seen.add(id)
        const bytes = textEncoder.encode(id)
        if (bytes.length > MAX_BLOCK_NAME_BYTES) {
            return `a character id is longer than ${MAX_BLOCK_NAME_BYTES} bytes`
        }
        if (textDecoder.decode(bytes) !== id) {
            return 'a character id does not survive a UTF-8 round trip'
        }
    }
    return null
}

//#endregion

function pointerChatKeys(cha: Slot): string[] {
    const keys: string[] = []
    if (!Array.isArray(cha.chats)) {
        return keys
    }
    for (const chat of cha.chats) {
        const data = chat?.message?.[0]?.data
        if (typeof data === 'string' && data.startsWith(coldStorageHeader)) {
            keys.push(data.slice(coldStorageHeader.length))
        }
    }
    return keys
}

function characterOf(value: unknown): Slot | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const character = (value as { character?: unknown }).character
    return isObjectSlot(character) ? character : null
}

function emptyToSave(): toSaveType {
    return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

async function runPass(
    host: BootArchiveHost,
    deps: BootArchiveDeps,
    input: BootArchivePassInput,
    canArchive: boolean,
    nodeServer: boolean,
): Promise<BootArchiveOutcome> {
    const tree = input.tree
    if (!canArchive || !passesTreeGates(tree)) {
        return installUntouched(tree)
    }
    // P7 (`archiveCharacters` false) archives nothing and writes no unit; only
    // the rewrite of legacy stubs can run, and the scan comes before anything
    // touches the tree, so a profile with none is installed exactly as decoded.
    const enrichOnly = tree.archiveCharacters === false
    if (enrichOnly && !tree.characters.some(isLegacyStub)) {
        return installUntouched(tree)
    }
    const keyAbsent = tree.archiveCharacters === undefined
    const attempt: PassAttempt = { reachedTwo: false }
    try {
        return await archiveAndCommit(deps, input, keyAbsent, enrichOnly, nodeServer, attempt)
    } catch (error) {
        // A pass that threw keeps the strike its start record made (the
        // enrichment count, on a profile with archiving off).
        const tooLarge = error instanceof CommitTooLargeError || error instanceof BlockTooLargeError
        if (tooLarge) {
            console.warn('The boot archive pass did not send its commit; installing the saved profile as it is:', error instanceof Error ? error.message : error)
        } else {
            console.error('The boot archive pass failed; installing the saved profile as it is:', error)
        }
        const outcome = await installCommittedAsItIs(host, deps, keyAbsent)
        // A profile with archiving off is never told about archiving.
        if (outcome.kind === 'install' && !enrichOnly) {
            if (tooLarge) {
                outcome.notices.push({ kind: 'archive-too-large' })
            } else if (attempt.reachedTwo) {
                outcome.notices.push({ kind: 'archive-paused' })
            }
        }
        return outcome
    }
}

function readMemoOrEmpty(deps: BootArchiveDeps): ArchiveMemo {
    try {
        return deps.readArchiveMemo()
    } catch (error) {
        return { skipped: new Set<string>(), tooLarge: false, pausedTold: false }
    }
}

/** The count read fails closed: a dep that throws reads as `unreadable`, never as zero. */
function readStrikesOrUnreadable(deps: BootArchiveDeps): ArchiveStrikeState {
    try {
        return deps.readArchiveStrikes()
    } catch (error) {
        return 'unreadable'
    }
}

/** True only when the start record was written; a dep that throws answers false. */
function recordStartOrFalse(deps: BootArchiveDeps): boolean {
    try {
        return deps.recordArchiveStart()
    } catch (error) {
        return false
    }
}

/** The enrichment count read fails closed like the strike count: a dep that throws reads as `unreadable`. */
function readStubEnrichStrikesOrUnreadable(deps: BootArchiveDeps): ArchiveStrikeState {
    try {
        return deps.readStubEnrichStrikes()
    } catch (error) {
        return 'unreadable'
    }
}

/** True only when the enrichment start record was written; a dep that throws answers false. */
function recordStubEnrichStartOrFalse(deps: BootArchiveDeps): boolean {
    try {
        return deps.recordStubEnrichStart()
    } catch (error) {
        return false
    }
}

/** A failed clear leaves the count, which costs an earlier stop of enrichment and nothing else. */
function clearStubEnrichStrikes(deps: BootArchiveDeps): void {
    try {
        deps.clearStubEnrichStrikes()
    } catch (error) {
        console.warn('The boot archive pass could not clear its stub-enrichment count:', error)
    }
}

/** A failed reset leaves a stale strike, which costs an earlier pause and nothing else. */
function resetStrikes(deps: BootArchiveDeps): void {
    try {
        deps.resetArchiveStrikes()
    } catch (error) {
        console.warn('The boot archive pass could not reset its strike count:', error)
    }
}

/** What `archiveAndCommit` tells `runPass`, which cannot see inside a pass that threw. */
interface PassAttempt {
    /** This pass's own start record took the count from one to two. */
    reachedTwo: boolean
}

/**
 * Rewrites the legacy stubs from their units and archives what is eligible,
 * then commits the result. Any throw is a pass failure: the caller discards
 * the tree and reads again what storage holds.
 *
 * With `enrichOnly` (archiving is off) nothing is archived, no unit is
 * written, no archive memo or strike count is read or written and no notice is
 * returned; the enrichment count stands in for the strike count.
 *
 * Order of the checks, after the tree has its ids repaired, its slots filtered
 * and its container defaults filled in: the Node too-large memo, then the
 * strike count (paused: the pass writes nothing and returns the paused notice
 * unless the user was told; unreadable: it writes nothing), then the refusal,
 * then the legacy stubs and the eligible characters, then the start record. The
 * start record is made only when a unit will be read or written or the main
 * file will be committed, before the first unit read or write and before the
 * encoder runs; when it cannot be stored the pass reads and writes nothing.
 * The legacy stubs are read first, one unit at a time, so a pass that dies
 * while reading has written no unit.
 * A stub whose unit cannot be read as its own character is left as it is.
 *
 * Enriched stubs are not archived characters: they never make a pass count as
 * having made progress, so a pass whose unit writes stopped with nothing
 * archived keeps its strike even when it enriched stubs.
 *
 * A unit that cannot be written or read back is not a failure. An isolated one
 * leaves that character fully loaded and the loop carries on; it is reported in
 * a skip notice that travels on the committing outcome and on the
 * nothing-changed outcome (which commits nothing), and never on a failed pass.
 * Two in a row mean the storage itself is failing: archiving stops there, what
 * was archived so far (if anything, or the absent key) is committed, and
 * neither of the two is reported as a skip.
 *
 * A pass that made its start record and returns succeeds, and resets the
 * strike count, unless it stopped on two failed units and archived no
 * character; that pass keeps its strike, as does one that throws or never
 * finishes. A return before the start record leaves the count as it is.
 *
 * Nothing is committed that the pass could not write whole: a tree that would
 * fail its commit on every boot is refused before any unit is read or written, and on
 * the Node server an encoded commit over the server's body limit is not sent.
 */
async function archiveAndCommit(
    deps: BootArchiveDeps,
    input: BootArchivePassInput,
    keyAbsent: boolean,
    enrichOnly: boolean,
    nodeServer: boolean,
    attempt: PassAttempt,
): Promise<BootArchiveOutcome> {
    const tree = input.tree

    // Ids first: the encoder keeps one block per chaId, so a duplicate left in
    // place would drop a character from the committed file. The same repaired
    // tree is the one the app installs.
    const idsBefore = tree.characters.map((cha) => (isObjectSlot(cha) ? cha.chaId : undefined))
    repairDatabaseIds(tree)
    tree.characters.forEach((cha, i) => {
        if (isObjectSlot(cha) && cha.coldstorage && idsBefore[i] !== undefined && idsBefore[i] !== cha.chaId) {
            console.warn(`The id repair changed the chaId of an archived character (was ${idsBefore[i]}); it cannot be restored.`)
        }
    })
    tree.characters = tree.characters.filter(isObjectSlot)

    // The container fields `setDatabase` would give the tree before its first
    // save. A missing one is written as an empty block that a strict decode
    // rejects.
    Reflect.deleteProperty(tree, 'account')
    tree.modules ??= []
    tree.loadouts ??= []
    tree.plugins ??= []

    const characters = tree.characters
    let memo: ArchiveMemo = { skipped: new Set<string>(), tooLarge: false, pausedTold: false }
    let strikes: ArchiveStrikeState = 'none'
    if (enrichOnly) {
        const enrichStrikes = readStubEnrichStrikesOrUnreadable(deps)
        if (enrichStrikes === 'paused') {
            console.warn('The boot did not update upstream-made characters: two attempts in a row did not finish on this device. Changing the archive setting in Settings (for example on, then off again) tries once more.')
            return installUntouched(tree)
        }
        if (enrichStrikes !== 'none' && enrichStrikes !== 'one') {
            console.warn('The boot did not update upstream-made characters: its attempt count could not be read on this device.')
            return installUntouched(tree)
        }
    } else {
        memo = readMemoOrEmpty(deps)
        if (nodeServer && memo.tooLarge) {
            // The commit of this save was over the server's limit on an earlier
            // boot: until the setting is turned off and on, no unit is written and
            // nothing is committed.
            return installUntouched(tree)
        }
        strikes = readStrikesOrUnreadable(deps)
        if (strikes === 'paused') {
            // Nothing is written on a paused device; the tree installs as it is.
            return { kind: 'install', tree, noteBytes: null, notices: memo.pausedTold ? [] : [{ kind: 'archive-paused' }] }
        }
        if (strikes !== 'none' && strikes !== 'one') {
            console.warn('The boot archive pass did not run: its strike count could not be read on this device.')
            return installUntouched(tree)
        }
    }
    const refusal = refusalReason(tree, characters)
    if (refusal !== null) {
        console.warn(`The boot archive pass did not run: ${refusal}.`)
        return installUntouched(tree)
    }

    const legacy = legacyStubIndexes(characters)
    const eligible = enrichOnly ? [] : eligibleIndexes(characters, input.keepInline, memo.skipped)
    if (legacy.length === 0 && eligible.length === 0 && !keyAbsent) {
        return installUntouched(tree)
    }
    if (enrichOnly) {
        if (!recordStubEnrichStartOrFalse(deps)) {
            console.warn('The boot did not update upstream-made characters: its start could not be recorded on this device.')
            return installUntouched(tree)
        }
    } else {
        if (!recordStartOrFalse(deps)) {
            console.warn('The boot archive pass did not run: its start could not be recorded on this device.')
            return installUntouched(tree)
        }
        attempt.reachedTwo = strikes === 'one'
    }

    // The stubs this pass rewrote; they are registered with the block check
    // apart from the archived characters, which decide whether the pass made
    // progress.
    const enrichedInfo = new Map<number, { key: string, stubJson: string }>()
    for (let n = 0; n < legacy.length; n++) {
        const index = legacy[n]
        const slot = characters[index]
        deps.setProgress?.(`Updating archived characters ${n + 1}/${legacy.length}`)
        // Only this unit is held, and only until its stub is built.
        const read = await deps.readUnit(slot.coldstorage)
        const unitCharacter = read.status === 'ok' ? characterOf(read.value) : null
        if (unitCharacter && unitCharacter.chaId === slot.chaId) {
            const stub = enrichLegacyStub(slot, unitCharacter)
            characters[index] = stub
            enrichedInfo.set(index, { key: slot.coldstorage, stubJson: JSON.stringify(stub) })
        }
    }

    const archivedInfo = new Map<number, { key: string, stubJson: string }>()
    const skipped: { chaId: string, name: string }[] = []
    // A failed unit waits here until the next unit shows the failure was
    // isolated; a second failure in a row drops it and stops the loop.
    let pendingSkip: { chaId: string, name: string } | null = null
    let stoppedAt: string | null = null
    const makeKey = deps.newUnitKey ?? uuidv4
    for (let n = 0; n < eligible.length; n++) {
        const index = eligible[n]
        const slot = characters[index]
        deps.setProgress?.(`Archiving characters ${n + 1}/${eligible.length}`)
        // The unit holds the character as the application would hold it after
        // install.
        applyCharacterDefaults(slot)
        resetChatStreamingState(slot)
        const key = makeKey()
        let readBack: Slot | null = null
        if (await deps.writeUnit(key, { character: slot })) {
            const read = await deps.readUnit(key)
            const candidate = read.status === 'ok' ? characterOf(read.value) : null
            if (candidate && candidate.chaId === slot.chaId) {
                readBack = candidate
            }
        }
        const name = typeof slot.name === 'string' ? slot.name : ''
        if (!readBack) {
            if (pendingSkip) {
                pendingSkip = null
                stoppedAt = name
                break
            }
            pendingSkip = { chaId: String(slot.chaId), name }
            continue
        }
        if (pendingSkip) {
            skipped.push(pendingSkip)
            pendingSkip = null
        }
        // The slot's full object is dropped as soon as its stub replaces it.
        const stub = buildColdStub(readBack, key, pointerChatKeys(readBack))
        characters[index] = stub
        archivedInfo.set(index, { key, stubJson: JSON.stringify(stub) })
    }
    if (pendingSkip) {
        skipped.push(pendingSkip)
    }

    // A stop with no archived character made no progress, so it keeps its
    // strike; every other pass that returns succeeds. An enriched stub is not
    // progress: a device whose every unit write fails would otherwise reset
    // its count each boot and never pause.
    const succeeded = stoppedAt === null || archivedInfo.size > 0
    const notices: BootArchiveNotice[] = []
    // The attempt is over once it returns or commits; one that throws keeps
    // its count.
    const finishAttempt = () => {
        if (enrichOnly) {
            clearStubEnrichStrikes(deps)
        } else if (succeeded) {
            resetStrikes(deps)
        }
    }
    if (archivedInfo.size === 0 && enrichedInfo.size === 0 && !keyAbsent) {
        // Nothing changed that is worth a write: the boot's own record of the
        // file stands.
        finishAttempt()
        if (skipped.length > 0) {
            notices.push({ kind: 'archive-skipped', characters: skipped })
        }
        if (stoppedAt !== null) {
            notices.push({ kind: 'archive-stopped', characterName: stoppedAt })
        }
        if (!succeeded && attempt.reachedTwo) {
            notices.push({ kind: 'archive-paused' })
        }
        return { kind: 'install', tree, noteBytes: null, notices }
    }

    if (keyAbsent) {
        tree.archiveCharacters = true
    }
    // The encoder only frames the blocks: it writes no remote file and no
    // cache, so a pass that fails before its commit has changed nothing but
    // the units it archived into.
    const encoder = deps.createEncoder?.() ?? new RisuSaveEncoder()
    await encoder.init(tree, { compression: false })
    await encoder.set(tree, emptyToSave())
    const layout = encoder.snapshotLayout()
    if (!layout) {
        throw new Error('The encoder produced no layout.')
    }
    if (nodeServer && deps.nodeBodyLimit !== undefined) {
        for (let i = 0; i < layout.blocks.length; i++) {
            if (!fitsNodeBodyLimit(layout.blocks[i].length, deps.nodeBodyLimit)) {
                throw new CommitTooLargeError(`the block "${layout.keys[i]}" is ${layout.blocks[i].length} bytes, over the server's limit of ${deps.nodeBodyLimit} bytes`)
            }
        }
    }
    const expected: CommittedCharacterExpectation[] = characters.map((cha, index) => {
        const info = archivedInfo.get(index) ?? enrichedInfo.get(index)
        return info
            ? { chaId: String(cha.chaId), archivedUnitKey: info.key, stubJson: info.stubJson }
            : { chaId: String(cha.chaId), archivedUnitKey: null }
    })
    const check = await checkCommittedLayout(layout, expected)
    if (check.ok === false) {
        throw new Error(`The encoded save failed its block check: ${check.reason}`)
    }
    await deps.commit({ layout, packed: packedNamesOf(characters, encoder.getFrozenKeys()) })
    finishAttempt()

    if (keyAbsent) {
        notices.push({ kind: 'archive-enabled' })
    }
    if (skipped.length > 0) {
        notices.push({ kind: 'archive-skipped', characters: skipped })
    }
    if (stoppedAt !== null) {
        notices.push({ kind: 'archive-stopped', characterName: stoppedAt })
    }
    if (!succeeded && attempt.reachedTwo) {
        notices.push({ kind: 'archive-paused' })
    }
    return { kind: 'install', tree, noteBytes: null, notices, committed: true }
}

/**
 * The main file decoded the way the boot decodes it, and never through the
 * pass: strictly first, then as the boot has always decoded. Null when neither
 * decode works.
 */
async function decodeLikeBoot(bytes: Uint8Array): Promise<Database | null> {
    try {
        return await decodeRisuSave(bytes, { strict: true })
    } catch (error) {
        try {
            return await decodeRisuSave(bytes)
        } catch (looseError) {
            return null
        }
    }
}

/**
 * The outcome after a failed pass: what storage holds is read again under the
 * same hold and installed as it is. Nothing is written back: a pass that fails
 * before its commit leaves the previous root (or the legacy main file)
 * authoritative, and this reads exactly that.
 *
 * On every host a re-read that throws or returns nothing stops the boot: the
 * profile was readable when the boot read it, so a failed read says nothing
 * about it and a backup copy must not stand in for it. Only bytes that are
 * read but do not decode, and a committed state that does not read cleanly,
 * take the backup path.
 */
async function installCommittedAsItIs(
    host: BootArchiveHost,
    deps: BootArchiveDeps,
    keyAbsent: boolean,
): Promise<BootArchiveOutcome> {
    let reread: BootReread | null = null
    let readError: unknown = undefined
    let readFailed = false
    try {
        reread = await deps.reread()
    } catch (error) {
        readFailed = true
        readError = error
    }
    let bytes: Uint8Array | null = null
    if (reread !== null && reread.kind === 'bytes') {
        bytes = reread.bytes ?? null
    }
    if (readFailed || (reread !== null && reread.kind === 'bytes' && (!bytes || bytes.length === 0))) {
        // With no reading of the profile there is nothing safe to install; on
        // the Node server the file is also the authority and may belong to
        // another device. A numbered backup never stands in for a profile that
        // was readable at this boot.
        return { kind: 'stop', error: readFailed ? readError : new Error('The main save file could not be read again after the archive pass failed: nothing was returned.') }
    }
    let tree: Database | null = null
    if (reread !== null && reread.kind === 'tree') {
        tree = reread.tree
    } else if (bytes) {
        tree = await decodeLikeBoot(bytes)
    }
    if (!tree) {
        return { kind: 'backup-fallback' }
    }
    // Shown when the profile the app now installs holds the key the boot read
    // lacked, whichever write put it there.
    const notices: BootArchiveNotice[] = keyAbsent && tree.archiveCharacters === true ? [{ kind: 'archive-enabled' }] : []
    return { kind: 'install', tree, noteBytes: reread !== null && reread.kind === 'bytes' ? bytes : null, notices }
}

//#region block check

/** One character the committed file must hold, in tree order. */
export interface CommittedCharacterExpectation {
    chaId: string
    /** The unit key the stub carries when this slot was archived; `null` for a slot kept as the encoder produced it. */
    archivedUnitKey: string | null
    /** `JSON.stringify` of the stub the encoder was given; compared byte for byte, or by name and hash when the block is a remote pointer. Present exactly when `archivedUnitKey` is. */
    stubJson?: string
}

export type CommitCheckResult = { ok: true } | { ok: false, reason: string }

/** Blocks up to this size are parsed whole by the check; a larger one is only checked for the shape of a JSON array. */
const CHECK_PARSE_LIMIT_BYTES = 4 * 1024 * 1024

const REQUIRED_BLOCKS: readonly { name: string, type: RisuSaveType, array: boolean }[] = [
    { name: 'root', type: RisuSaveType.ROOT, array: false },
    { name: 'config', type: RisuSaveType.CONFIG, array: false },
    { name: 'preset', type: RisuSaveType.BOTPRESET, array: true },
    { name: 'modules', type: RisuSaveType.MODULES, array: true },
    { name: 'loadouts', type: RisuSaveType.LOADOUTS, array: true },
    { name: 'plugins', type: RisuSaveType.PLUGINS, array: true },
]

const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()

function isCharacterBlockType(type: RisuSaveType): boolean {
    return type === RisuSaveType.CHARACTER_WITH_CHAT
        || type === RisuSaveType.CHARACTER_WITHOUT_CHAT
        || type === RisuSaveType.REMOTE
}

function parseJson(data: Uint8Array): { ok: true, value: unknown } | { ok: false } {
    try {
        return { ok: true, value: JSON.parse(textDecoder.decode(data)) }
    } catch (error) {
        return { ok: false }
    }
}

/** Why a required non-character block is unusable, or null when it is fine. */
function containerBlockProblem(block: EncodedBlockView, array: boolean): string | null {
    if (block.data.length === 0) {
        return `the "${block.name}" block is empty`
    }
    if (block.data.length > CHECK_PARSE_LIMIT_BYTES) {
        const open = array ? 0x5B : 0x7B
        const close = array ? 0x5D : 0x7D
        return block.data[0] === open && block.data[block.data.length - 1] === close
            ? null
            : `the "${block.name}" block is not JSON of the expected shape`
    }
    const parsed = parseJson(block.data)
    if (!parsed.ok) {
        return `the "${block.name}" block does not parse`
    }
    const shapeOk = array
        ? Array.isArray(parsed.value)
        : typeof parsed.value === 'object' && parsed.value !== null && !Array.isArray(parsed.value)
    return shapeOk ? null : `the "${block.name}" block is not the expected kind of JSON`
}

/**
 * The order in which the encoder's block table lists character keys: the
 * table is a plain object, whose integer-like keys come first in ascending
 * order, then the others in insertion order.
 */
function inEncoderKeyOrder(expected: readonly CommittedCharacterExpectation[]): CommittedCharacterExpectation[] {
    const isIndexKey = (key: string) => /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < 4294967295
    const indexKeyed = expected.filter((e) => isIndexKey(e.chaId)).sort((a, b) => Number(a.chaId) - Number(b.chaId))
    return [...indexKeyed, ...expected.filter((e) => !isIndexKey(e.chaId))]
}

interface RemotePointer {
    v: number
    type: number
    name: string
    hash: string
}

function asRemotePointer(value: unknown): RemotePointer | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const pointer = value as Partial<RemotePointer>
    return pointer.v === 2
        && typeof pointer.type === 'number'
        && typeof pointer.name === 'string'
        && typeof pointer.hash === 'string'
        ? pointer as RemotePointer
        : null
}

/**
 * The block check made before the commit writes anything. The encoded blocks
 * (as one file's bytes here, as a layout in `checkCommittedLayout`) must hold, in their own block order, exactly one
 * character block (inline or a remote pointer) per entry of `expected`; each
 * archived slot's block is a stub carrying its unit key (a remote pointer is
 * compared by name and hash with `stubJson`); the root (with `__directory`),
 * config, presets, modules, loadouts and plugins blocks are present and
 * parse; and every `__directory` entry has its block. It reads no remote file
 * and never holds a second decoded copy of the full characters: only the root,
 * the small container blocks and the stubs are parsed.
 */
export async function checkCommittedBlocks(bytes: Uint8Array, expected: readonly CommittedCharacterExpectation[]): Promise<CommitCheckResult> {
    let blocks: EncodedBlockView[]
    try {
        blocks = listEncodedBlocks(bytes)
    } catch (error) {
        return { ok: false, reason: `the encoded file cannot be walked: ${error instanceof Error ? error.message : String(error)}` }
    }
    return await checkBlockViews(blocks, expected)
}

/**
 * The same check over a layout of framed blocks, the form the commit takes, so
 * a bad result is refused before the first value is written and the whole
 * file is never assembled for it. The names the layout lists must be the names
 * the blocks carry.
 */
export async function checkCommittedLayout(layout: BlockLayout, expected: readonly CommittedCharacterExpectation[]): Promise<CommitCheckResult> {
    const blocks: EncodedBlockView[] = []
    try {
        if (layout.keys.length !== layout.blocks.length) {
            return { ok: false, reason: 'the layout lists a different number of names and blocks' }
        }
        for (let i = 0; i < layout.blocks.length; i++) {
            const header = parseFramedHeader(layout.blocks[i], 0)
            if (header.name !== layout.keys[i]) {
                return { ok: false, reason: `the layout lists "${layout.keys[i]}" for a block named "${header.name}"` }
            }
            blocks.push({
                type: header.type as RisuSaveType,
                compression: header.compression,
                name: header.name,
                data: layout.blocks[i].subarray(header.dataStart, header.dataEnd),
            })
        }
    } catch (error) {
        return { ok: false, reason: `the encoded blocks cannot be walked: ${error instanceof Error ? error.message : String(error)}` }
    }
    return await checkBlockViews(blocks, expected)
}

async function checkBlockViews(blocks: readonly EncodedBlockView[], expected: readonly CommittedCharacterExpectation[]): Promise<CommitCheckResult> {
    const fail = (reason: string): CommitCheckResult => ({ ok: false, reason })

    const byName = new Map<string, EncodedBlockView>()
    for (const block of blocks) {
        if (byName.has(block.name)) {
            return fail(`the block name "${block.name}" appears twice`)
        }
        byName.set(block.name, block)
        if (block.compression) {
            return fail(`the "${block.name}" block is compressed`)
        }
    }

    const fixedNames = new Set<string>(REQUIRED_BLOCKS.map((required) => required.name))
    fixedNames.add('pluginStorage')
    for (const required of REQUIRED_BLOCKS) {
        const block = byName.get(required.name)
        if (!block || block.type !== required.type) {
            return fail(`the "${required.name}" block is missing`)
        }
        const problem = containerBlockProblem(block, required.array)
        if (problem) {
            return fail(problem)
        }
    }
    const storage = byName.get('pluginStorage')
    if (storage && storage.type !== RisuSaveType.PLUGIN_STORAGE) {
        return fail('the "pluginStorage" block has the wrong kind')
    }

    const root = parseJson((byName.get('root') as EncodedBlockView).data)
    const directory = root.ok ? (root.value as { __directory?: unknown }).__directory : undefined
    if (!Array.isArray(directory)) {
        return fail('the root block has no directory')
    }
    for (const entry of directory) {
        if (typeof entry !== 'string' || !byName.has(entry)) {
            return fail(`the directory names a block the file does not hold: ${String(entry)}`)
        }
    }

    // Every block that is not one of the fixed ones is a character block. A
    // character whose chaId is a fixed name was refused above by that block's
    // kind (preset, modules, loadouts, plugins, pluginStorage) or is refused by
    // the count below (root, config, whose block replaced the character's).
    const characterBlocks: EncodedBlockView[] = []
    for (const block of blocks) {
        if (fixedNames.has(block.name)) {
            continue
        }
        if (!isCharacterBlockType(block.type)) {
            return fail(`the "${block.name}" block is not a character block`)
        }
        characterBlocks.push(block)
    }
    const wanted = inEncoderKeyOrder(expected)
    if (characterBlocks.length !== wanted.length) {
        return fail(`the file holds ${characterBlocks.length} character blocks, expected ${wanted.length}`)
    }
    for (let i = 0; i < wanted.length; i++) {
        const block = characterBlocks[i]
        const want = wanted[i]
        if (block.name !== want.chaId) {
            return fail(`character block ${i} is "${block.name}", expected "${want.chaId}"`)
        }
        let pointer: RemotePointer | null = null
        if (block.type === RisuSaveType.REMOTE) {
            const parsed = parseJson(block.data)
            pointer = parsed.ok ? asRemotePointer(parsed.value) : null
            if (!pointer || pointer.name !== want.chaId) {
                return fail(`the remote pointer of "${want.chaId}" is not valid`)
            }
        }
        if (want.archivedUnitKey === null) {
            continue
        }
        if (want.stubJson === undefined) {
            return fail(`no stub was given for "${want.chaId}"`)
        }
        const stubBytes = textEncoder.encode(want.stubJson)
        if (pointer) {
            if (pointer.hash !== await hashRemoteBlockContent(stubBytes)) {
                return fail(`the remote pointer of "${want.chaId}" does not name its stub`)
            }
        } else if (!sameBytes(block.data, stubBytes)) {
            return fail(`the block of "${want.chaId}" is not its stub`)
        }
    }
    return { ok: true }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
        return false
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false
        }
    }
    return true
}

//#endregion
