import { STORAGE_TAB_LOCK_NAME, tabLockSnapshotShowsOthers } from './storageTabLocks'
import type { GcPeerAnswer } from './store2/gc/pass'

/** What the sole-tab proof reads: the lock query (absent without Web Locks) and this tab's own presence claim. */
export interface SoleTabInput {
    query: (() => Promise<LockManagerSnapshot>) | undefined
    holdsOwnPresence: () => boolean
}

/**
 * The web sole-tab proof, in the order that keeps a missing API apart from a busy page: no query is `'unsupported'`; a
 * false own claim, a failed query, a snapshot that shows others, a holder count other than one, or an own claim that went
 * false during the query is `'others'`; otherwise `'alone'`.
 */
export async function soleTabAnswer(input: SoleTabInput): Promise<GcPeerAnswer> {
    if (typeof input.query !== 'function') {
        return 'unsupported'
    }
    if (!input.holdsOwnPresence()) {
        return 'others'
    }
    let snapshot: LockManagerSnapshot
    try {
        snapshot = await input.query()
    } catch {
        return 'others'
    }
    if (tabLockSnapshotShowsOthers(snapshot)) {
        return 'others'
    }
    const holders = (snapshot.held ?? []).filter(lock => lock.name === STORAGE_TAB_LOCK_NAME).length
    if (holders !== 1) {
        return 'others'
    }
    return input.holdsOwnPresence() ? 'alone' : 'others'
}

/**
 * The lock query as the page has it at call time: `navigator.locks` is absent on plain HTTP and null under some test
 * hosts, so the decision rests on the query function itself and never on a cached support flag.
 */
export function liveLockQuery(): (() => Promise<LockManagerSnapshot>) | undefined {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
    return typeof locks?.query === 'function' ? () => locks.query() : undefined
}

/**
 * Whether the tab rule lets a superseded cold unit be deleted. Without a lock query the web withholds and the app
 * (`tauri`: one window by the single-instance plugin, one singleTask activity) allows; with one, only the sole-tab
 * proof allows. The no-query branch comes first because the proof answers `'unsupported'` there.
 */
export async function tabsAllowSupersededDelete(input: SoleTabInput & { tauri: boolean }): Promise<boolean> {
    if (typeof input.query !== 'function') {
        return input.tauri
    }
    return (await soleTabAnswer(input)) === 'alone'
}
