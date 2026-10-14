/**
 * Tunable parameters of the sweep decisions. Every decision function takes the
 * value it needs as an argument that defaults to the constant here, so a caller
 * (and a test) can state the value instead of relying on a hidden default.
 */

/** Age a candidate list must reach before anything is deleted: 24 hours. */
export const SWEEP_MIN_AGE_MS = 24 * 60 * 60 * 1000

/**
 * A record dated further ahead than this is treated as absent; a smaller skew is
 * read as young. Covers clock drift between devices sharing one store.
 */
export const SWEEP_FUTURE_SKEW_MS = 10 * 60 * 1000

/** Candidates that may enter the record in one Node pass: each needs a revision read (a whole-file read server-side). */
export const NODE_RECORD_CAP = 500

/** Assets in one guarded remove on Node. */
export const NODE_REMOVE_BATCH = 25

/** Asset count above which the sweep runs only from the Settings button: a placeholder until measured. */
export const SWEEP_AUTO_LIMIT = 50_000
