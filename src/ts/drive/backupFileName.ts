/**
 * Suggested file name of a local backup: `local-YYYYMMDD.bin`, or `local-partial-YYYYMMDD.bin`
 * for the critical-assets-only backup. The date is the device's local calendar date, so a backup made
 * late in the evening is not named after the next UTC day.
 */
export function localBackupFileName(date: Date, partial = false): string {
    const year = String(date.getFullYear()).padStart(4, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${partial ? 'local-partial' : 'local'}-${year}${month}${day}.bin`
}
