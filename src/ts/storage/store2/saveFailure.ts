import { writable } from 'svelte/store'

/** The kind of failure a save pass ended in, as `describeSaveFailure` tells them apart. */
export type SaveFailureClass = 'storage-full' | 'not-flushed' | 'commit-refused' | 'other'

/**
 * The save pass that is failing now. `attempts` counts the failed passes in a row. Only a save pass writes this:
 * a failure of the peer hand-off handler, or one after a commit landed, is not a counted pass and is never recorded.
 */
export interface SaveFailureState {
    class: SaveFailureClass
    attempts: number
}

/**
 * Null until a failed save pass is reported; set by every reported failed pass (the quiet retries before the first
 * report are not recorded) and cleared by the next pass that saves. If a commit lands and its bookkeeping then
 * throws, that pass is not a saved one for this purpose, so the earlier record stands until the next saved pass.
 * Nothing displays it yet.
 */
export const saveFailureStore = writable<SaveFailureState | null>(null)
