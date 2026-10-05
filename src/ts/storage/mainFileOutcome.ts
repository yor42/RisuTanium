/**
 * What this page knows about the outcome of its own writes to the main
 * database file (`database/database.bin`). Everything here is synchronous
 * bookkeeping with no I/O and no await, so a writer can call it between its busy
 * check and its store write without opening a gap for another task.
 *
 * A writer of the legacy main file skips or refuses a write only while the main
 * file is known to hold exactly the bytes it compares against; the save loop
 * writes the block store and never this file, so it does not use this module.
 * This module says whether that is known:
 * - A write attempt that has begun and has not returned makes the file's
 *   content unknown. A throw is not a confirmed success, because on the Node
 *   server a write can land and then throw.
 * - The newest write attempt returning, or a read whose bytes were then
 *   recorded with `noteMainFileBytes`, makes the content known again.
 *
 * `getMainFileEpoch` changes on every event here, so a caller that saved it
 * after its own write can tell that another reader or writer has acted since.
 */

let epoch = 0
let attempts = 0
/** A write has begun and no later write has returned, and no recorded read has resolved it. */
let unresolved = false
/** A read returned and its bytes have not been recorded yet. */
let readAwaitingRecord = false

/** A main-file write is about to be sent. Returns the attempt's number for `confirmMainFileWrite`. */
export function beginMainFileWrite(): number {
    attempts += 1
    epoch += 1
    unresolved = true
    // The write is now the newest event on the file, so a read made before it
    // is stale.
    readAwaitingRecord = false
    return attempts
}

/** The store's write returned for the attempt `beginMainFileWrite` numbered. */
export function confirmMainFileWrite(attempt: number): void {
    epoch += 1
    if (attempt === attempts) {
        unresolved = false
        readAwaitingRecord = false
    }
}

/** A main-file read returned. The file is known again once its bytes are recorded. */
export function noteMainFileRead(): void {
    epoch += 1
    readAwaitingRecord = true
}

/** `noteMainFileBytes` recorded some bytes. */
export function noteMainFileRecorded(): void {
    epoch += 1
    if (readAwaitingRecord) {
        readAwaitingRecord = false
        unresolved = false
    }
}

/** False while a write attempt's outcome is unresolved or a read has not been recorded. */
export function isMainFileOutcomeKnown(): boolean {
    return !unresolved && !readAwaitingRecord
}

export function getMainFileEpoch(): number {
    return epoch
}

/** Forgets every attempt and read; the epoch still moves so an older stamp never matches. */
export function resetMainFileOutcomeForTests(): void {
    epoch += 1
    attempts = 0
    unresolved = false
    readAwaitingRecord = false
}
