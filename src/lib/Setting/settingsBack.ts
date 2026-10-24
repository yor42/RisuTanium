import { get } from 'svelte/store'
import { MobileGUI, SettingsMenuIndex, settingsOpen } from '../../ts/stores.svelte'

/**
 * The close of the Settings screen, called by both X buttons in `Settings.svelte` and by Back, so
 * the two cannot drift. Narrow layout with a detail page open goes back to the list; every other
 * case closes Settings. The Beta Mobile GUI overlay has no X, so Back there closes it as Escape does.
 * The width is read at call time, as the X does.
 */
export function settingsBackClose(): void {
    if (get(MobileGUI) || window.innerWidth >= 700 || get(SettingsMenuIndex) === -1) {
        settingsOpen.set(false)
        return
    }
    SettingsMenuIndex.set(-1)
}
