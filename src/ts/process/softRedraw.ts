import { get, writable } from 'svelte/store'
import { ReloadGUIPointer } from '../stores.svelte'

// A leaf: the chat surface and the chat rows import it, so it must not import process code.

/**
 * Counts the GUI pointer bumps that only ask the chat bodies to draw again. The chat row key is the pointer minus this
 * count, so such a bump re-parses each body (a render revision) but does not remount it: a body whose HTML is unchanged
 * writes no DOM, and its animations and open popups survive.
 */
export const SoftRedrawCount = writable(0)

/**
 * The redraw a Lua or trigger script asks for. Every other pointer reader still refreshes; only the chat body
 * remount is skipped. The count is set first, so a reader that sees the new pointer also sees the new count.
 */
export function redrawGuiSoft(){
    SoftRedrawCount.set(get(SoftRedrawCount) + 1)
    ReloadGUIPointer.set(get(ReloadGUIPointer) + 1)
}
