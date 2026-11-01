import { writable } from 'svelte/store'
import type { PageStorageMode } from '../../ts/storage/pageStorageMode'
import { isDesktopTransport } from '../../ts/storage/tauriByteTransport'

/** Whether the Utility screen replaces the home menu. It is only shown while `utilityVisible` also holds. */
export const utilityOpen = writable(false)

/**
 * Whether this page offers Utility: the desktop app, on a page whose profile is a writable store2 tree. Callers pass
 * the value of the reactive page-mode store, so the answer follows the mode after mount.
 */
export function utilityVisible(mode: PageStorageMode): boolean {
    return mode.kind === 'store2' && isDesktopTransport()
}
