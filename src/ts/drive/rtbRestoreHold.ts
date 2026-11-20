import { alertConfirm, alertError, alertWait } from '../alert'
import { acquireExclusiveStorageMigrationLock, dbWriteLock, locksSupported, tabPresenceLockAcquired } from '../globalApi.svelte'
import { isAppInitiatedReload } from '../reloadGuard'
import { isTauri } from 'src/ts/platform'
import { language } from 'src/lang'
import type { BusyHandle } from '../process/memory/busyActions'
import type { Store2Read } from '../storage/store2/backend/types'
import { Store2BulkAbortError, type Committer, type CommitRequest, type HeldBulk } from '../storage/store2/commit'
import { classifyCommitRead } from '../storage/store2/commitKey'
import { refuseBackupLoadWhileBusy } from './backupWorkGuard'
import { RESTORE_EXCLUSIVE_LOCK_TIMEOUT_MS } from './restoreLock'
import { UnsavedGuard } from './storeImport'

/**
 * The tab hold of a `.rtb` restore (CHORE-128 S11, R0.3-R0.4) and the helpers its commit step (S12) calls to re-check the
 * page before the flip.
 *
 * `acquireRestoreHold` takes the same locks in the same order as the restore-point shell (`storeRestore.ts`): on the
 * desktop and Android apps `dbWriteLock`; on the web the exclusive storage lock, which already holds `dbWriteLock` inside
 * it and so must not be acquired a second time; on a browser without Web Locks, a confirmation and then `dbWriteLock`.
 * While it is held the save loop cannot commit. Whoever holds a hold releases it on every exit that does not land the
 * restore; a hold that landed it stays closed for the life of the page.
 */

export interface RestoreHold {
    /** The busy entry of the run, asked again at the flip. */
    readonly busy: BusyHandle
    /** The one guard of the run: edits already accepted are not asked about again unless the tab was marked dirty since. */
    readonly guard: UnsavedGuard
    readonly lock: 'web-hold' | 'write-lock'
    /** Idempotent. `true` keeps `dbWriteLock` closed for the life of the page. */
    release(keepWriteLock: boolean): Promise<void>
}

export type HoldAcquire =
    | { kind: 'held', hold: RestoreHold }
    /** Another tab is open (or a reload is in flight): the message was shown unless the app is reloading. */
    | { kind: 'refused' }
    /** The person declined to restore without a cross-tab check. */
    | { kind: 'declined' }

export interface HoldOptions {
    /** Called once when the lock is granted, before `acquireRestoreHold` resolves. */
    onGranted?: () => void
}

export async function acquireRestoreHold(busy: BusyHandle, options: HoldOptions = {}): Promise<HoldAcquire> {
    let releaseExclusiveHold: ((keepWriteLock?: boolean) => Promise<void>) | null = null
    let releaseDbWriteLock: (() => void) | null = null
    if (!isTauri) {
        if (locksSupported === false) {
            if (!await alertConfirm(language.restoreNoLockWarningConfirm)) {
                return { kind: 'declined' }
            }
        } else {
            await tabPresenceLockAcquired
            alertWait(language.restoreCheckingOtherTabs)
            releaseExclusiveHold = await acquireExclusiveStorageMigrationLock(RESTORE_EXCLUSIVE_LOCK_TIMEOUT_MS)
            if (!releaseExclusiveHold) {
                // A reload already in flight needs no message: this page is on its way out.
                if (!isAppInitiatedReload()) {
                    alertError(language.restoreOtherTabRefused)
                }
                return { kind: 'refused' }
            }
        }
    }
    if (!releaseExclusiveHold) {
        releaseDbWriteLock = await dbWriteLock.acquire()
    }

    let released = false
    const held = releaseExclusiveHold
    const hold: RestoreHold = {
        busy,
        guard: new UnsavedGuard(),
        lock: held ? 'web-hold' : 'write-lock',
        async release(keepWriteLock) {
            if (released) {
                return
            }
            released = true
            if (held) {
                await held(keepWriteLock)
            } else if (releaseDbWriteLock && !keepWriteLock) {
                releaseDbWriteLock()
            }
        },
    }
    // The hold exists before the callback runs, so a callback that throws cannot leave the lock taken with no handle.
    try {
        options.onGranted?.()
    } catch (error) {
        await hold.release(false)
        throw error
    }
    return { kind: 'held', hold }
}

// ---- the commit key as the restore bases itself on it ----

/** The commit key's `current` at the time the page was read: what the restore is based on. */
export interface BaseRead {
    seq: number
    at: number
    currentKey: string
}

export type BaseCheck =
    | { kind: 'ok', base: BaseRead }
    | { kind: 'too-new' }
    | { kind: 'commit-key-unusable' }
    | { kind: 'no-current-manifest' }

/** The base of a classifying read of the commit key. */
export function baseOfRead(read: Store2Read): BaseCheck {
    const classified = classifyCommitRead(read)
    switch (classified.status) {
        case 'too-new':
            return { kind: 'too-new' }
        case 'absent':
        case 'damaged':
            return { kind: 'commit-key-unusable' }
        case 'parsed':
            if (classified.value.current === null) {
                return { kind: 'no-current-manifest' }
            }
            return { kind: 'ok', base: { seq: classified.value.seq, at: classified.value.current.at, currentKey: classified.value.current.key } }
    }
}

export type AuthoritativeBase =
    | { kind: 'ok' }
    | { kind: 'base-unreadable' }
    | { kind: 'base-moved' }

/** The authoritative read before the flip: it must parse, name a current manifest, and carry the `seq` the plan was based on. */
export function checkAuthoritativeBase(base: BaseRead, read: Store2Read): AuthoritativeBase {
    const checked = baseOfRead(read)
    if (checked.kind !== 'ok') {
        return { kind: 'base-unreadable' }
    }
    return checked.base.seq === base.seq ? { kind: 'ok' } : { kind: 'base-moved' }
}

/** The busy check at the flip refused: nothing was written. */
export class RtbRestoreBusyError extends Error {
    constructor() {
        super('Work started while the restore was being prepared.')
        this.name = 'RtbRestoreBusyError'
    }
}

export function isRtbBusyAbort(error: unknown): boolean {
    return error instanceof RtbRestoreBusyError || (error instanceof Store2BulkAbortError && error.original instanceof RtbRestoreBusyError)
}

/**
 * The committer whose commits ask the busy guard once more at the flip: in the build, which runs after the last read and
 * before the first unit upload (after the marker of a bulk commit, which a refusal clears). The held commit of a Node
 * restore (`commitHeld`) is wrapped the same way; `openHeldBulk` and `clearHeld` pass through unchanged.
 */
export function rtbGuardedCommitter(committer: Committer, busy: BusyHandle): Committer {
    const commitHeld = committer.commitHeld
    const guardBuild = (build: CommitRequest['build']): CommitRequest['build'] => (context) => {
        if (refuseBackupLoadWhileBusy(busy)) {
            throw new RtbRestoreBusyError()
        }
        return build(context)
    }
    return {
        ...committer,
        commit: (read, request) => committer.commit(read, { ...request, build: guardBuild(request.build) }),
        ...(commitHeld === undefined ? {} : {
            commitHeld: (held: HeldBulk, read: Store2Read, request: CommitRequest) => commitHeld.call(committer, held, read, { ...request, build: guardBuild(request.build) }),
        }),
    }
}
