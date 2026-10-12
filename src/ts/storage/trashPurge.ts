/** How long a character stays in the trash before the startup purge (`checkNewFormat` in bootstrap.ts) removes it for good; the trash texts in src/lang say "3 days". */
export const TRASH_PURGE_AGE_MS = 1000 * 60 * 60 * 24 * 3

/**
 * Whether the startup purge removes a character with this `trashTime` at `now`.
 * The expression matches upstream's purge (a truthy `trashTime` older than
 * TRASH_PURGE_AGE_MS, strictly), so every saved value, odd ones included, is
 * purged on the same boot here and upstream.
 * The boot archive pass uses the same predicate: it runs before the purge in the
 * same boot, so a unit written for a character this answers true for would be
 * orphaned at once.
 */
export function isTrashPurgeDue(trashTime: number | undefined, now: number): boolean {
    const target = trashTime ? trashTime + TRASH_PURGE_AGE_MS : 0
    return !!trashTime && target < now
}
