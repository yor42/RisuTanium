import { getAppStore } from '../storage/store/appStore'

/** The key prefix of the numbered backups (`dbbackup-<n>.bin`, `n` in tenths of a second). */
export const NUMBERED_BACKUP_PREFIX = 'database/dbbackup-'

/**
 * The numbered backups, newest first, without pruning: listing must write and delete nothing, because the boot's damage
 * prompt, the restore picker and a read-only page all list before the person has chosen anything.
 */
export async function listBackupTimes(): Promise<number[]> {
    const times: number[] = []
    for (const key of await (await getAppStore()).list(NUMBERED_BACKUP_PREFIX)) {
        const match = /^(\d+)\.bin$/.exec(key.slice(NUMBERED_BACKUP_PREFIX.length))
        if (match) {
            times.push(Number(match[1]))
        }
    }
    return times.sort((a, b) => b - a)
}
