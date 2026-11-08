/** How long a character stays in the trash before the startup purge (`checkNewFormat` in bootstrap.ts) removes it for good: 30 days in this fork, where upstream and older builds purge at 3 days; the trash texts in src/lang name this age. */
export const TRASH_PURGE_AGE_MS = 1000 * 60 * 60 * 24 * 30

/**
 * Whether the startup purge removes a character with this `trashTime` at `now`.
 * The expression has upstream's shape (a truthy `trashTime` older than
 * TRASH_PURGE_AGE_MS, strictly), so odd saved values behave as upstream's
 * expression does; only the age differs (this fork 30 days, upstream 3).
 * The boot archive pass uses the same predicate: it runs before the purge in the
 * same boot, so a unit written for a character this answers true for would be
 * orphaned at once.
 */
export function isTrashPurgeDue(trashTime: number | undefined, now: number): boolean {
    const target = trashTime ? trashTime + TRASH_PURGE_AGE_MS : 0
    return !!trashTime && target < now
}
