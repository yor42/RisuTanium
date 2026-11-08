import { writable } from 'svelte/store'
import { SettingsMenuIndex, settingsOpen } from '../../ts/stores.svelte'
import type { SettingsFix } from '../../ts/process/sendPrerequisites'

/** The Settings page each fix opens: Chat Bot, which shows the model and the selected provider's key. */
const FIX_PAGE: Record<SettingsFix, number> = { botSettings: 1 }

let returnToChat = false
let stopWatching: (() => void) | null = null

/**
 * True from the Fix route until Settings closes. While it is set, Back and X close Settings outright, so one
 * press returns to the chat even on the narrow layout, where Back otherwise goes up to the page list first.
 */
export function isReturnToChat(): boolean {
    return returnToChat
}

/**
 * True when Settings was closed after a Fix route and the chat has not taken the focus yet. The failed-send card
 * moves focus to Try again and clears it, whether it was mounted all along or mounts afterwards.
 */
export const fixPending = writable(false)

/** Opens the Settings page that fixes a refused send and marks the return to the chat. */
export function openSettingsForFix(fix: SettingsFix): void {
    fixPending.set(false)
    returnToChat = true
    SettingsMenuIndex.set(FIX_PAGE[fix])
    settingsOpen.set(true)
    watchClose()
}

// Every close ends the route: the mark clears whichever control closed Settings (Back, X, Escape, the sidebar).
function watchClose(): void {
    if (stopWatching) return
    let seenOpen = false
    stopWatching = settingsOpen.subscribe((open) => {
        if (open) {
            seenOpen = true
            return
        }
        if (!seenOpen) return
        const stop = stopWatching
        stopWatching = null
        returnToChat = false
        fixPending.set(true)
        stop?.()
    })
}

/** Test-only: drops the route state so one test cannot leak a mark into the next. */
export function resetSettingsRouteForTests(): void {
    stopWatching?.()
    stopWatching = null
    returnToChat = false
    fixPending.set(false)
}
