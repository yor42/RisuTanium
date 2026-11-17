import { SettingsMenuIndex, settingsOpen } from '../../stores.svelte'

/** Settings page index of the Other bots page, whose default submenu holds the long-term memory settings. */
const OTHER_BOTS_PAGE = 2

/** Opens the settings page that holds the long-term memory settings. */
export function openMemorySettings(): void {
    SettingsMenuIndex.set(OTHER_BOTS_PAGE)
    settingsOpen.set(true)
}
