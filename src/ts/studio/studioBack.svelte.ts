import { afterFlush } from '../afterFlush'
import { backCloseHandler, registerBackHandler } from '../backHandlers'
import { returnFocusAfterClose } from './layerFocus'
import {
    closeStudio,
    setStudioHistoryOpen,
    setStudioRestoreSheetOpen,
    showStudioList,
    studioScreen,
    studioViaList,
    type StudioOpener,
} from './studioScreen.svelte'

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
    // The chat surface is laid out again only after the flush that follows the close: its own release waits one
    // flush, so the opener is focused one flush later, and never while the surface is still hidden.
    void afterFlush().then(() => afterFlush()).then(() => focusTargetOf(opener)?.focus())
}

/** The Back layers of the screen, called once while the Studio root is created. */
export function installStudioBack(): void {
    registerStudioBackLayer({ isOpen: () => studioScreen.open, close: leaveStudio })
    registerStudioBackLayer({ isOpen: () => studioScreen.drawerOpen, close: closeStudioDrawer })
    registerStudioBackLayer({ isOpen: () => studioScreen.searchOpen, close: closeStudioSearch })
    registerStudioBackLayer({ isOpen: () => studioScreen.historyOpen, close: closeStudioHistory })
    // Detail to list sits below search, the drawer and the History panel, whichever of them opened last: it
    // registers only while none is open, so it is always the newest handler once they are closed.
    registerStudioBackLayer({
        isOpen: () => studioViaList() && !studioScreen.searchOpen && !studioScreen.drawerOpen && !studioScreen.historyOpen,
        close: showStudioList,
    })
}

/**
 * The restore sheet's Back layer, called from the sheet's own initialisation. The sheet is mounted only while
 * it is open, so the layer lives exactly as long, and it registers after the History panel it opens over: Back
 * closes the sheet before the panel.
 */
export function registerStudioSheetBack(): void {
    registerStudioBackLayer({ isOpen: () => studioScreen.restoreSheetOpen, close: closeStudioRestoreSheet })
}

export function closeStudioSearch(): void {
    studioScreen.searchOpen = false
}

export function closeStudioHistory(): void {
    setStudioHistoryOpen(false)
    void returnFocusAfterClose('history', () => studioScreen.historyOpen)
}

export function closeStudioDrawer(): void {
    studioScreen.drawerOpen = false
    void returnFocusAfterClose('drawer', () => studioScreen.drawerOpen)
}

export function closeStudioRestoreSheet(): void {
    setStudioRestoreSheetOpen(false)
}
