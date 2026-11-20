/**
 * The per-device choice of the new Settings screen as stored, readable before any store or window exists. This module
 * must stay free of svelte, stores and anything that touches `window` at load: the boot screens import it.
 */
export const SETTINGS_SHELL_STORAGE_KEY = 'risuSettings.enabled'

/** True only when this device stored '1'. Missing, other values and unavailable or throwing storage all read as off. */
export function readSettingsShellStoredChoice(): boolean {
    try {
        if (typeof localStorage === 'undefined') {
            return false
        }
        return localStorage.getItem(SETTINGS_SHELL_STORAGE_KEY) === '1'
    } catch {
        return false
    }
}
