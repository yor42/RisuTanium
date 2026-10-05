/**
 * What this page knows about its own reads of the main database file
 * (`database/database.bin`). Everything here is synchronous bookkeeping with no
 * I/O and no await.
 *
 * The application's saves do not write that file (the one writer is the
 * copy-back in `opfsCopyBack.ts`, at store selection), so the only thing to
 * know is whether the bytes the last read returned have been recorded with
 * `noteMainFileBytes`: a read is "known" once its bytes are recorded.
 *
 * `getMainFileEpoch` changes on every event here, so a caller that saved it can
 * tell that another read has happened since.
 */

let epoch = 0
/** A read returned and its bytes have not been recorded yet. */
let readAwaitingRecord = false

/** A main-file read returned. The file is known again once its bytes are recorded. */
export function noteMainFileRead(): void {
    epoch += 1
    readAwaitingRecord = true
}

/** `noteMainFileBytes` recorded some bytes. */
export function noteMainFileRecorded(): void {
    epoch += 1
    readAwaitingRecord = false
}

/** False while a read has not been recorded. */
export function isMainFileOutcomeKnown(): boolean {
    return !readAwaitingRecord
}

export function getMainFileEpoch(): number {
    return epoch
}

/** Forgets every read; the epoch still moves so an older stamp never matches. */
export function resetMainFileOutcomeForTests(): void {
    epoch += 1
    readAwaitingRecord = false
}
