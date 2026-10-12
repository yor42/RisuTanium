/**
 * What this page's boot recorded about archiving: whether its archive session
 * could archive and whether its archive pass committed. Kept apart from the
 * boot so the code that imports files at start-up can read it without pulling
 * the boot in. Nothing here is persisted; a page load starts empty.
 */

let sessionCanArchive = false
let passCommitted = false

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

export function resetBootArchiveStateForTest(): void {
    sessionCanArchive = false
    passCommitted = false
}
