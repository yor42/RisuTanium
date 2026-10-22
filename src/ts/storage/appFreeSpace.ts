import { invoke } from '@tauri-apps/api/core'

/**
 * The free bytes under the app data directory, from the native `app_data_free_bytes` command (the filesystem every
 * import write lands on). `null` when the command fails, is missing on this platform, or answers something that is not
 * a byte count the page can compare. Never throws: the callers treat `null` as "cannot check" and go on.
 */
export async function readAppDataFreeBytes(): Promise<number | null> {
    try {
        const value: unknown = await invoke('app_data_free_bytes')
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
            return null
        }
        return value
    } catch {
        return null
    }
}
