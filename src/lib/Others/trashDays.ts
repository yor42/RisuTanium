import { TRASH_PURGE_AGE_MS } from "../../ts/storage/trashPurge";

const DAY_MS = 86_400_000;

// Whole days left before the purge removes a trashed character. A partial day counts as a day, so a row
// that still exists never reads 0; an overdue row clamps to 0 rather than going negative.
export function trashDaysLeft(trashTime: number, now: number): number {
    return Math.max(0, Math.ceil((trashTime + TRASH_PURGE_AGE_MS - now) / DAY_MS));
}
