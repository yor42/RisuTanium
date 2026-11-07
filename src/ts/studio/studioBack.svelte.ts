import { tick } from 'svelte'
import { backCloseHandler, registerBackHandler } from '../backHandlers'
import { closeStudio, showStudioList, studioScreen, studioViaList, type StudioOpener } from './studioScreen.svelte'

interface BackLayer {
    isOpen: () => boolean
    close: () => void
}

/**
 * Registers a Back handler for one layer, only while that layer is open, from the calling component's
 * lifetime. A layer registers after the layers it sits on, so the newest open layer closes first; a
 * close that changes nothing is not a handled press and falls through to the layer below.
 */
export function registerStudioBackLayer(layer: BackLayer): void {
    $effect(() => {
        if (!layer.isOpen()) return
        return registerBackHandler(backCloseHandler({ isOpen: layer.isOpen, snapshot: layer.isOpen, close: layer.close }))
    })
}

function focusTargetOf(opener: StudioOpener | null): HTMLElement | null {
    if (opener?.element?.isConnected) return opener.element
    if (opener?.selector) {
        const found = document.querySelector<HTMLElement>(opener.selector)
        if (found) return found
    }
    return document.querySelector<HTMLElement>('[data-part="chat-transcript"]')
}

/** Leaves Studio for the origin and hands focus back to the control that opened it. */
export function leaveStudio(): void {
    const opener = studioScreen.opener
    closeStudio()
    // The chat surface is laid out again only after the flush that follows the close.
    void tick().then(() => tick()).then(() => focusTargetOf(opener)?.focus())
}

/** The Back layers of the screen, called once while the Studio root is created. */
export function installStudioBack(): void {
    registerStudioBackLayer({ isOpen: () => studioScreen.open, close: leaveStudio })
    registerStudioBackLayer({ isOpen: () => studioScreen.drawerOpen, close: () => { studioScreen.drawerOpen = false } })
    registerStudioBackLayer({ isOpen: () => studioScreen.searchOpen, close: closeStudioSearch })
    // Detail to list sits below search and the drawer, whichever of them opened last: it registers
    // only while neither is open, so it is always the newest handler once they are closed.
    registerStudioBackLayer({
        isOpen: () => studioViaList() && !studioScreen.searchOpen && !studioScreen.drawerOpen,
        close: showStudioList,
    })
}

export function closeStudioSearch(): void {
    studioScreen.searchOpen = false
}
