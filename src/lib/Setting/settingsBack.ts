import { get } from 'svelte/store'
import { SettingsMenuIndex, settingsOpen } from '../../ts/stores.svelte'
import { isReturnToChat } from './settingsRoute'

/**
 * The close of the Settings screen, called by both X buttons in `Settings.svelte` and by Back, so
 * the two cannot drift. Narrow layout with a detail page open goes back to the list; every other
 * case closes Settings.
 * After the failed-send card's Fix route, Back and X close Settings outright, so one press returns
 * to the chat. The width is read at call time, as the X does.
 */
export function settingsBackClose(): void {
    if (isReturnToChat() || window.innerWidth >= 700 || get(SettingsMenuIndex) === -1) {
        settingsOpen.set(false)
        return
    }
    SettingsMenuIndex.set(-1)
}
