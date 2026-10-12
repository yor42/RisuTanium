/**
 * Deletes the unit a re-archive replaced (`characterRearchive.ts`): the stub of
 * the new unit K2 has taken the character's slot, and the old unit K1 is only
 * kept alive by copies of earlier saves. This module deletes K1 and nothing
 * else: never K2, never a chat unit, never a unit it was not handed as
 * superseded. It is not the startup trash purge or the permanent delete or the
 * empty trash (CHORE-201, MC-304), which leave their units to the manual
 * cleanup, and it shares no code with them.
 *
 * Deleting K1 is safe only when no copy of the profile that could be loaded
 * again names it. Every condition below must hold, checked again immediately
 * before the delete, and a condition that cannot be established withholds:
 * - The commit proof. The save loop is clean (`isSaveClean`) and its mark count
 *   has passed the placement's mark, so the latest iteration committed a state
 *   taken after the stub was placed. As a backstop the committed stubs pack must
 *   name K2 and neither the pack nor the character's own block may name K1.
 * - No numbered automatic backup (`database/dbbackup-<n>.bin`) that existed at
 *   the proof is still stored. Any backup that names K1 was written before the
 *   proof, so the keys listed at the proof are the whole set to wait out; they
 *   are compared as keys, never as times, so a clock moved back cannot make an
 *   old backup look new. Only a backup write prunes them, so this takes about
 *   twenty further backups. The filter is deliberate: the backups are written
 *   only under the digit names (`getDbBackups` ignores any other name), so a
 *   name without digits is not one this app wrote.
 * - No older copy of the profile exists: a pre-blocks copy, the legacy main
 *   file, a kept or leftover block generation (MC-308 2).
 * - No other tab: the presence lock has exactly one holder (on the desktop too,
 *   where a single window is configured, when the lock API exists), and no peer
 *   announced a save since the job started. A failed lock query withholds.
 * - Never on a Node server, where a second device cannot be observed (MC-308 1).
 * - The database is the one the job started on, nothing is busy, no write choke
 *   point is in flight, and no live stub, recoverable error or retained record
 *   still names K1. This live set is narrower than the manual cleanup's, which
 *   also follows archived chats: K1 is a character unit under its own key, which
 *   no chat unit names.
 *
 * The pending set is memory only: a reload forgets it and K1 is left to the
 * manual cleanup. A failed delete is ignored and not retried.
 *
 * The modules that load the stores and the cold-storage code are imported on
 * demand: this module is on the start-up import path through the put-back.
 */

import { afterNextSaveCommit, getPeerSaveCount, getSaveMarkCount, isSaveClean } from '../../globalApi.svelte'
import { isNodeServer, isTauri } from '../../platform'
import type { Database } from '../../storage/database.svelte'
import { DBState } from '../../stores.svelte'
import { retainedUnitKeys } from '../coldRetained'
import { anyChokePointInFlight, isBusy } from './busyActions'
import { MEASURE } from './measureFlag'
import { noteSuperseded, type SupersededOutcome } from './putBackMeasure'

export interface SupersededJob {
    chaId: string
    /** The unit the new stub names. */
    newKey: string
    /** The unit the character's earlier stub named. */
    oldKey: string
    /** `getPeerSaveCount()` when the re-archive job started. */
    peerSavesAt: number
    /** The database the job ran on. */
    db: Database
}

interface Entry {
    readonly job: Omit<SupersededJob, 'db'>
    /** Weak: a replaced database is not kept alive by a pending deletion. */
    readonly db: WeakRef<Database>
    readonly markAfter: number
    state: 'await-commit' | 'await-backups'
    /** The numbered backup keys stored at the proof. */
    heldBy: Set<string>
    /** Commits at which the proof found the committed bytes still naming the old unit. */
    staleProofs: number
    lastStaleCommit: number
}

const DB_BACKUP_KEY_PREFIX = 'database/dbbackup-'
const BACKUP_NAME = /^\d+\.bin$/

/** Most entries pending at once; one is added per re-archive that replaced a unit. */
const MAX_ENTRIES = 64
/** How many commits may find the committed pack still naming the old unit before the entry is dropped. */
const MAX_STALE_PROOFS = 5

const timing = { pollMs: 500, polls: 20, checkEveryMs: 60_000 }

const entries: Entry[] = []
let armed = false
/** Counts commit callbacks, so that the polls after one commit count as one attempt. */
let commitSeq = 0
let checking = false
let lastCheckAt = 0

function count(outcome: SupersededOutcome): void {
    if (MEASURE) {
        noteSuperseded(outcome)
    }
}

/**
 * Hands over a superseded unit. `markAfter` is the save mark count read after
 * the re-archive placed its stub. Does nothing on a Node server.
 */
export function queueSupersededUnit(job: SupersededJob, markAfter: number): void {
    if (job.oldKey === job.newKey) {
        return
    }
    if (isNodeServer) {
        count('withheld-node')
        return
    }
    if (entries.length >= MAX_ENTRIES) {
        // Not deleting is always safe: the unit is left to the manual cleanup.
        count('dropped-state')
        return
    }
    const { db, ...rest } = job
    entries.push({ job: rest, db: new WeakRef(db), markAfter, state: 'await-commit', heldBy: new Set(), staleProofs: 0, lastStaleCommit: -1 })
    count('queued')
    arm()
}

function arm(): void {
    if (!armed && entries.length > 0) {
        armed = true
        afterNextSaveCommit(onCommit)
    }
}

/** Runs inside the save iteration: it only schedules, because the page is never clean in here. */
function onCommit(): void {
    armed = false
    commitSeq += 1
    if (entries.length === 0) {
        return
    }
    arm()
    let polls = 0
    const poll = (): void => {
        polls += 1
        void step().then((again) => {
            if (again && polls < timing.polls) {
                setTimeout(poll, timing.pollMs)
            }
        }).catch((error) => console.error('Superseded unit step failed', error))
    }
    setTimeout(poll, timing.pollMs)
}

/** One pass over the pending entries; true while an entry still waits for the proof. */
async function step(): Promise<boolean> {
    if (checking) {
        return true
    }
    checking = true
    try {
        let waiting = false
        for (const entry of [...entries]) {
            if (entry.state === 'await-commit') {
                const proven = await tryProof(entry)
                if (proven === 'wait') {
                    waiting = true
                }
            }
        }
        const now = Date.now()
        if (entries.some((entry) => entry.state === 'await-backups') && (lastCheckAt === 0 || now - lastCheckAt >= timing.checkEveryMs)) {
            lastCheckAt = now
            for (const entry of [...entries]) {
                if (entry.state === 'await-backups') {
                    await tryDelete(entry)
                }
            }
        }
        return waiting
    } finally {
        checking = false
    }
}

function drop(entry: Entry, outcome: SupersededOutcome): void {
    const index = entries.indexOf(entry)
    if (index !== -1) {
        entries.splice(index, 1)
    }
    count(outcome)
}

interface Loaded {
    appStore: typeof import('../../storage/store/appStore')
    owner: typeof import('../../storage/pageBlockOwner')
    keys: typeof import('../../storage/blockKeys')
    fingerprint: typeof import('../../storage/mainFileFingerprint')
    data: typeof import('../coldstorageData')
    cold: typeof import('../coldstorage.svelte')
    tabs: typeof import('../../storage/storageTabLocks')
}

async function load(): Promise<Loaded> {
    const [appStore, owner, keys, fingerprint, data, cold, tabs] = await Promise.all([
        import('../../storage/store/appStore'),
        import('../../storage/pageBlockOwner'),
        import('../../storage/blockKeys'),
        import('../../storage/mainFileFingerprint'),
        import('../coldstorageData'),
        import('../coldstorage.svelte'),
        import('../../storage/storageTabLocks'),
    ])
    return { appStore, owner, keys, fingerprint, data, cold, tabs }
}

function contains(bytes: Uint8Array | null, text: string): boolean {
    return bytes !== null && new TextDecoder().decode(bytes).includes(text)
}

/**
 * The commit proof for `entry`. 'wait' while the loop is not clean yet (a later
 * poll or commit tries again); otherwise the entry has moved on or been dropped.
 */
async function tryProof(entry: Entry): Promise<'wait' | 'done'> {
    if (entry.db.deref() !== DBState.db) {
        drop(entry, 'dropped-db')
        return 'done'
    }
    if (getPeerSaveCount() !== entry.job.peerSavesAt) {
        drop(entry, 'dropped-peer')
        return 'done'
    }
    if (!isSaveClean() || getSaveMarkCount() < entry.markAfter) {
        return 'wait'
    }
    const loaded = await load()
    const store = await loaded.appStore.getAppStore()
    const owner = await loaded.owner.getPageBlockOwner()
    const committed = owner?.committedState()
    if (!owner || !committed) {
        // No live block owner (a page running from the transitional store): nothing to prove against.
        drop(entry, 'dropped-state')
        return 'done'
    }
    // The state may have moved while the reads were awaited; a later clean point proves again.
    const backups = (await store.list(DB_BACKUP_KEY_PREFIX)).filter((key) => BACKUP_NAME.test(key.slice(DB_BACKUP_KEY_PREFIX.length)))
    const pack = (await store.read(loaded.keys.stubsKey(committed.generation))).bytes
    const own = (await store.read(loaded.keys.characterBlockKey(committed.generation, entry.job.chaId))).bytes
    if (!isSaveClean() || getSaveMarkCount() < entry.markAfter || entry.db.deref() !== DBState.db) {
        return 'wait'
    }
    if (contains(pack, entry.job.oldKey) || contains(own, entry.job.oldKey)) {
        // A second stub on the same unit keeps this true for good; the delete-side live check would drop it, but is never reached from here.
        if (entry.lastStaleCommit !== commitSeq) {
            entry.lastStaleCommit = commitSeq
            entry.staleProofs += 1
        }
        if (entry.staleProofs >= MAX_STALE_PROOFS) {
            drop(entry, 'dropped-live')
            return 'done'
        }
        return 'wait'
    }
    if (!contains(pack, entry.job.newKey)) {
        // The character is no longer the stub of K2 in the committed state: nothing to supersede.
        drop(entry, 'dropped-state')
        return 'done'
    }
    entry.heldBy = new Set(backups)
    entry.state = 'await-backups'
    return 'done'
}

/**
 * The tab-lock rule: this page is the only holder, and no exclusive storage
 * operation is held or requested (a tab that has requested one has released its
 * own presence hold, so only the request shows it). A failed query withholds.
 * Without the lock API the web withholds. On the desktop and Android a second
 * page cannot exist: the desktop build registers the single-instance plugin,
 * which focuses the running window on a second launch, and the Android activity
 * is launched singleTask; a build without either must withhold here instead.
 */
async function aloneInTabs(tabs: Loaded['tabs']): Promise<boolean> {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
    if (!locks || typeof locks.query !== 'function') {
        return isTauri
    }
    try {
        const snapshot = await locks.query()
        const own = (snapshot.held ?? []).filter((lock) => lock.name === tabs.STORAGE_TAB_LOCK_NAME).length
        return own === 1 && !tabs.tabLockSnapshotShowsOthers(snapshot)
    } catch (error) {
        return false
    }
}

async function tryDelete(entry: Entry): Promise<void> {
    const loaded = await load()
    const store = await loaded.appStore.getAppStore()
    const alone = await aloneInTabs(loaded.tabs)
    const backups = (await store.list(DB_BACKUP_KEY_PREFIX)).filter((key) => BACKUP_NAME.test(key.slice(DB_BACKUP_KEY_PREFIX.length)))
    const preBlocks = (await store.list(loaded.keys.PRE_BLOCKS_PREFIX)).filter(loaded.fingerprint.isPreBlocksKey)
    const legacy = await store.has(loaded.keys.LEGACY_MAIN_FILE_KEY)
    const owner = await loaded.owner.getPageBlockOwner()
    const inventory = owner ? await owner.inventory() : null

    // From here to the delete nothing awaits: the conditions below are the ones
    // the delete relies on.
    if (isNodeServer) {
        count('withheld-node')
        return
    }
    if (entry.db.deref() !== DBState.db) {
        drop(entry, 'dropped-db')
        return
    }
    if (getPeerSaveCount() !== entry.job.peerSavesAt) {
        drop(entry, 'dropped-peer')
        return
    }
    if (!alone) {
        count('withheld-tab')
        return
    }
    if (backups.some((key) => entry.heldBy.has(key))) {
        count('withheld-backup')
        return
    }
    if (preBlocks.length > 0 || legacy || inventory === null || inventory.kept.length > 0 || inventory.leftover.length > 0) {
        count('withheld-copy')
        return
    }
    if (isBusy() || anyChokePointInFlight()) {
        count('withheld-busy')
        return
    }
    const live = new Set([
        ...loaded.data.listColdDataKeysFromDb(DBState.db),
        ...loaded.data.listRecoverableErrorKeysFromDb(DBState.db),
        ...retainedUnitKeys(),
    ])
    if (live.has(entry.job.oldKey)) {
        drop(entry, 'dropped-live')
        return
    }
    drop(entry, 'deleted')
    // A failure falls to the manual cleanup and is not retried.
    loaded.cold.deleteColdStorageUnits([entry.job.oldKey]).then((failed) => {
        if (failed.length > 0) {
            count('delete-failed')
        }
    }).catch((error) => {
        count('delete-failed')
        console.error('Deleting a superseded unit failed', error)
    })
}

/** Tests only: shorter waits. */
export function setSupersededTimingForTest(next: Partial<typeof timing>): void {
    Object.assign(timing, next)
}

export function pendingSupersededCount(): number {
    return entries.length
}

export function resetSupersededUnitsForTest(): void {
    entries.length = 0
    armed = false
    commitSeq = 0
    checking = false
    lastCheckAt = 0
    timing.pollMs = 500
    timing.polls = 20
    timing.checkEveryMs = 60_000
}
