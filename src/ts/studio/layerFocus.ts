import { afterFlush } from '../afterFlush'
import { focusLost } from './historyFocus'

export type StudioLayer = 'history' | 'drawer'

// The surfaces a layer owns: focus inside them is never a place to return to. The restore sheet closes with
// the History panel it sits under.
const LAYER_SURFACES: Record<StudioLayer, string> = {
    history: '[data-part="studio-history"], [data-part="studio-restore-layer"]',
    drawer: '[data-part="studio-tree-drawer"]',
}
const LAYER_OPENERS: Record<StudioLayer, string> = {
    history: '[data-part="studio-history-toggle"]',
    drawer: '[data-part="studio-drawer-toggle"]',
}

let root: HTMLElement | null = null
const lastOutside: Record<StudioLayer, HTMLElement | null> = { history: null, drawer: null }

function onfocusin(event: FocusEvent): void {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    for (const layer of Object.keys(LAYER_SURFACES) as StudioLayer[]) {
        // The root is a holding position, not a place the user worked: it clears the record.
        if (target === root) lastOutside[layer] = null
        else if (!target.closest(LAYER_SURFACES[layer])) lastOutside[layer] = target
    }
}

function forgetRecords(): void {
    lastOutside.history = null
    lastOutside.drawer = null
}

/**
 * Records, per layer, the last element focused in Studio outside that layer, so the layer's close can give focus
 * back to it. Returns the cleanup that removes the listener and drops every held element.
 */
export function trackStudioFocus(element: HTMLElement): () => void {
    root = element
    forgetRecords()
    element.addEventListener('focusin', onfocusin)
    return () => {
        element.removeEventListener('focusin', onfocusin)
        if (root === element) {
            root = null
            forgetRecords()
        }
    }
}

function tryFocus(element: HTMLElement | null | undefined): boolean {
    if (!element || !element.isConnected || element.matches(':disabled')) return false
    element.focus()
    return document.activeElement === element
}

/**
 * After a layer closes (MC-1504): once the layer is gone from the page, if focus is lost, focus goes to the last
 * element focused outside the layer while it is still in the page, else the layer's opener, else the Studio
 * root. `picked` replaces that order with the pick's own target (MC-1507). Live focus is never moved, and a
 * layer open again by then is left alone.
 */
export async function returnFocusAfterClose(layer: StudioLayer, isOpen: () => boolean, picked?: () => HTMLElement | null): Promise<void> {
    const scope = root
    await afterFlush()
    if (isOpen() || !focusLost() || !scope || !scope.isConnected) return
    const candidates = picked
        ? [picked()]
        : [lastOutside[layer], scope.querySelector<HTMLElement>(LAYER_OPENERS[layer])]
    for (const candidate of candidates) if (tryFocus(candidate)) return
    tryFocus(scope)
}
