/**
 * The time and space a large `.bin` import asks of an Android phone, for the warning shown before anything is written.
 * Pure arithmetic: the shell around it (`confirmImportScale` in storeImport.ts) decides on which platform it applies.
 */

/** Above this many non-database bytes (assets and unit entries) an Android import is announced. A test replaces it through the module mock. */
export const IMPORT_TIME_WARNING_BYTES = 1024 * 1024 * 1024

const MIB = 1024 * 1024

/** Seconds per file entry visited by the copy, from the 1 KiB runs on the measured phone (0.77 to 1.03 ms). */
const SECONDS_PER_ENTRY = 0.001

/** Bytes per second of the asset copy, from the two large runs on the measured phone (about 4.0 MiB/s). */
const COPY_BYTES_PER_SECOND = 4.2 * MIB

/** Fixed seconds of the end of the import that do not scale with the file. */
const FIXED_SECONDS = 6

/** Saved data (the database entry plus the unit entries) above this many bytes is taken to have the long commit tail. */
const LONG_TAIL_DATABASE_BYTES = 16 * MIB

/**
 * Seconds of the per-unit durable upload at the end of the import, from the commit tail measurements. Two profiles are
 * measured: the 49 MiB database entry (about 10,000 units) and the 86 MiB one (about 12,300 units), both 429 to 471 s.
 * Below 16 MiB the tail is unmeasured: the 60 s is a guess, not a fit, and the step at 16 MiB is not fitted either.
 */
const LONG_TAIL_SECONDS = 480
const SHORT_TAIL_SECONDS = 60

/** Seconds to go from now (the walk of the file is already spent) on a mid-range phone, to the end of the import. */
export function estimateImportSeconds(entries: number, assetBytes: number, savedDataBytes: number): number {
    const tail = savedDataBytes > LONG_TAIL_DATABASE_BYTES ? LONG_TAIL_SECONDS : SHORT_TAIL_SECONDS
    return entries * SECONDS_PER_ENTRY + assetBytes / COPY_BYTES_PER_SECOND + FIXED_SECONDS + tail
}

/** Rounds a duration up for display: to the next 5 minutes below 2 hours, to the next half hour from there on. */
export function roundImportMinutes(seconds: number): number {
    const minutes = Math.max(1, Math.ceil(seconds / 60))
    return minutes < 120 ? Math.ceil(minutes / 5) * 5 : Math.ceil(minutes / 30) * 30
}

/** Free bytes the import may need: the assets are added next to the profile in use, plus working room. */
export function importFreeSpaceBytes(assetBytes: number): number {
    return 1.1 * assetBytes + 512 * MIB
}

/** Decimal gigabytes (as a phone shows them), one decimal, rounded up. */
export function importGigabytesText(bytes: number): number {
    return Math.ceil(bytes / 1e9 * 10) / 10
}

/** The non-database bytes of a file (assets and unit entries): what is not the database entry. Never negative. */
export function importAssetBytes(fileSize: number, databaseEntryBytes: number): number {
    return Math.max(0, fileSize - databaseEntryBytes)
}
