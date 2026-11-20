/**
 * Named parameters of the sealed `.rtb` envelope, version 1. Nothing else in the engine inlines
 * these values, and no test vector or golden file depends on the writer defaults.
 *
 * Monotonic rule: once a build can write sealed files for anyone, no later build lowers
 * `M_CEIL_KIB`, `WORK_CAP` or the fixed limits below, or narrows an accepted range. Raising them is
 * compatible: a later build that raises the writer defaults writes files that older builds refuse
 * as "newer".
 */

/** P-1: writer Argon2id memory, KiB (128 MiB). Maintainer's choice, 2026-11-20. */
export const DEFAULT_M_KIB = 131_072
/** P-2: writer Argon2id passes. Maintainer's choice, 2026-11-20. */
export const DEFAULT_T = 3
/** The v1 writer always writes one lane. */
export const DEFAULT_P = 1
/** P-3: reader memory ceiling, KiB (1 GiB). Held by five derivations each at 256, 512 and 1024 MiB in the Android WebView. */
export const M_CEIL_KIB = 1_048_576
/** P-4: reader ceiling for memory times passes, KiB-passes (4 GiB-passes), about 3 s per GiB-pass on the slowest measured phone. */
export const WORK_CAP = 4_194_304
/** P-5: writer plaintext bytes per chunk (1 MiB). */
export const DEFAULT_CHUNK = 1_048_576

/** Fixed limits of the format; these are not tunable parameters. */
export const MIN_CHUNK = 64
export const MAX_CHUNK = 16_777_216
export const MIN_HEADER_LEN = 80
export const MAX_HEADER_LEN = 65_536
export const MAX_SLOTS = 64
export const MAX_LANES = 8

/** The two reader ceilings that the caller may tighten for a test or loosen in a later build. */
export interface SealedCaps {
    /** Largest accepted Argon2id memory, KiB. */
    readonly mCeilKib: number
    /** Largest accepted memory times passes, KiB-passes. */
    readonly workCap: number
}

export const DEFAULT_CAPS: SealedCaps = { mCeilKib: M_CEIL_KIB, workCap: WORK_CAP }

/** Argon2id and chunk parameters the writer takes explicitly: there is no default KDF cost inside the engine API. */
export interface SealParams {
    readonly m: number
    readonly t: number
    readonly chunkSize: number
}

/** The writer parameters a product caller uses. */
export const DEFAULT_SEAL_PARAMS: SealParams = { m: DEFAULT_M_KIB, t: DEFAULT_T, chunkSize: DEFAULT_CHUNK }
