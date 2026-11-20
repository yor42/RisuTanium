import { get } from 'svelte/store'
import { isLite } from '../lite'
import { MobileGUI } from '../stores.svelte'
import { readSettingsShellStoredChoice, SETTINGS_SHELL_STORAGE_KEY } from './settingsShellStoredChoice'

/** The per-device choice of the new Settings screen. Off unless this device stored '1'. */
export const settingsShellSwitch = $state({ enabled: readSettingsShellStoredChoice() })

export function setSettingsShellEnabled(value: boolean): void {
    settingsShellSwitch.enabled = value
    try {
        localStorage.setItem(SETTINGS_SHELL_STORAGE_KEY, value ? '1' : '0')
    } catch {
        // The current device still uses the in-memory choice when storage is unavailable.
    }
}

/**
 * True when Settings should open as the new screen: the switch is on and the build is neither the Beta
 * Mobile GUI nor Lite.
 */
export function settingsShellEligible(): boolean {
    return settingsShellSwitch.enabled && !get(MobileGUI) && !get(isLite)
}
