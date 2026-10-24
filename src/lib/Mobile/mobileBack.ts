import { get } from 'svelte/store'
import { backCloseHandler, type BackHandler } from '../../ts/backHandlers'
import { MobileGUIStack, MobileSideBar, selectedCharID, SettingsMenuIndex } from '../../ts/stores.svelte'

/**
 * The header arrows of the Beta Mobile GUI shell. Each function is the arrow's own action, called
 * by `MobileHeader.svelte` for the tap and by the Back handler, so the two cannot drift.
 */

export function closeShellSidebarPage(): void {
    MobileSideBar.set(0)
}

export function closeShellChat(): void {
    selectedCharID.set(-1)
}

export function closeShellSettingsDetail(): void {
    SettingsMenuIndex.set(-1)
}

/** The arrow that `MobileHeader.svelte` shows now, in the order of its branches; null at a tab root. */
function currentShellArrow(): (() => void) | null {
    if (get(selectedCharID) !== -1 && get(MobileSideBar) > 0) {
        return closeShellSidebarPage
    }
    if (get(selectedCharID) !== -1) {
        return closeShellChat
    }
    if (get(MobileGUIStack) === 2 && get(SettingsMenuIndex) > -1) {
        return closeShellSettingsDetail
    }
    return null
}

/** Back for the shell: does what the visible header arrow does; not handled at a tab root. */
export function createMobileShellBackHandler(): BackHandler {
    return backCloseHandler({
        isOpen: () => currentShellArrow() !== null,
        snapshot: () => `${get(selectedCharID)}|${get(MobileSideBar)}|${get(SettingsMenuIndex)}`,
        close: () => currentShellArrow()?.(),
    })
}
