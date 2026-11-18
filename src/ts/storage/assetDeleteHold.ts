/**
 * One-slot hold on a store2 asset deletion, so a same-page writer of an
 * `assets/` key never races the sweep that is removing an asset.
 *
 * Contract for every writer of an `assets/` key on this page: note the key as
 * written this page, then await `assetDeletionSettled()`, before any `has`,
 * write or finish of that key. The note and the capture of the slot happen in
 * one synchronous run, so either the sweep saw the note and skipped the key, or
 * the writer waits for the delete in flight and writes afterwards.
 *
 * The sweep deletes one asset at a time and awaits each delete before the next,
 * so one slot is enough; a writer waits for at most one unrelated delete.
 *
 * There is no timeout: a delete that never settles blocks same-page asset
 * writes. That is accepted because the native invoke and the IndexedDB delete
 * always settle.
 *
 * This module imports nothing from the app so any writer can use it.
 */

/** A hold was requested while another is pending: a programming error, not a store failure. */
export class AssetDeleteHoldOverlapError extends Error {
    constructor() {
        super('An asset deletion hold is already pending.')
        this.name = 'AssetDeleteHoldOverlapError'
    }
}

let pending: Promise<void> | null = null

/**
 * Runs `remove` with the slot held. The slot is registered before the first
 * await and cleared before the caller resumes, whether `remove` resolves or
 * rejects; a rejection is rethrown. Throws `AssetDeleteHoldOverlapError` when a
 * hold is pending.
 */
export function holdAssetDeletion(remove: () => Promise<void>): Promise<void> {
    if (pending !== null) {
        throw new AssetDeleteHoldOverlapError()
    }
    let release: () => void = () => undefined
    // The settle promise only ever resolves, so a writer that waits on it is never failed by the remover's error.
    pending = new Promise<void>((resolve) => {
        release = resolve
    })
    return (async () => {
        try {
            await remove()
        } finally {
            pending = null
            release()
        }
    })()
}

/**
 * Resolves once the deletion pending at the time of the call has settled, at
 * once when none is pending. Never rejects.
 */
export function assetDeletionSettled(): Promise<void> {
    return pending ?? Promise.resolve()
}

/** Whether a deletion is pending. */
export function isAssetDeletionHeld(): boolean {
    return pending !== null
}

/** Empties the slot; tests that use the real slot call it before and after each case. */
export function resetAssetDeleteHoldForTests(): void {
    pending = null
}
