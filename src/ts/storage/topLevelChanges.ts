/**
 * Counts changes to the settings-level `DBState.db` keys (everything except the character
 * library). The save effects in `dbChangeEffects.svelte.ts` bump it on every run after their
 * first, so a reader that stores the count and compares it later learns whether any such key
 * changed in between, without snapshotting or comparing values.
 */
let count = 0

/** Called by a save effect that covers non-character top-level keys, on a run that marks a change. */
export function noteTopLevelChange(): void {
    count += 1
}

export function topLevelChangeCount(): number {
    return count
}

/** Test-only: returns the counter to zero. */
export function resetTopLevelChangesForTests(): void {
    count = 0
}
