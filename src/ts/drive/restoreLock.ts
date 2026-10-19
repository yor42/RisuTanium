/**
 * How long the local restore and the internal-backup load
 * (`loadInternalBackup` in `internalBackup.ts`) wait for the exclusive storage
 * lock (MC-093) before refusing with "another tab is open". A tab that is simply open, with no
 * exclusive operation of its own in progress, never releases its presence
 * lock -- so this wait can never turn a genuinely open tab into a grant;
 * every value of this timeout refuses that case identically, only sooner or
 * later. What this wait actually bounds is how long this restore waits
 * behind another tab's own IN-PROGRESS exclusive operation (the copy back
 * from OPFS at startup, or another restore) before giving up on it and
 * refusing instead. Kept well under that copy back's own 5000ms default so a
 * restore doesn't make
 * its own user wait for however long an unrelated tab's operation takes to
 * finish, at the cost of occasionally refusing an in-progress operation of
 * similar length that would have finished moments later.
 *
 * A leaf module: `backuplocal.ts`, `internalBackup.ts` and `storeRestore.ts` all need it, and none of them may
 * import another only for this constant.
 */
export const RESTORE_EXCLUSIVE_LOCK_TIMEOUT_MS = 2000;
