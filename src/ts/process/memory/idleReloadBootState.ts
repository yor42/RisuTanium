/**
 * What this page's boot recorded for the idle reload: whether it was started
 * by one, whether its archive session could archive, and whether its archive
 * pass committed. Kept apart from the reload itself so the code that
 * imports files at start-up can read it without pulling the reload in. Nothing
 * here is persisted; a page load starts empty.
 */

let startedByIdleReload = false
let sessionCanArchive = false
let passCommitted = false

/** The boot consumed a fresh idle reload record. */
export function markBootedByIdleReload(): void {
    startedByIdleReload = true
}

export function wasBootedByIdleReload(): boolean {
    return startedByIdleReload
}

/** Whether this boot's archive session was able to archive on this device. */
export function noteBootArchiveSession(canArchive: boolean): void {
    sessionCanArchive = canArchive
}

export function canBootArchive(): boolean {
    return sessionCanArchive
}

/** Whether this boot's archive pass committed. */
export function noteBootPassCommitted(committed: boolean): void {
    passCommitted = committed
}

export function didBootPassCommit(): boolean {
    return passCommitted
}

export function resetIdleReloadBootStateForTest(): void {
    startedByIdleReload = false
    sessionCanArchive = false
    passCommitted = false
}
