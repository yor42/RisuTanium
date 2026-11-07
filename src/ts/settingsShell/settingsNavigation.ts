import { get } from 'svelte/store'
import { isReturnToChat } from '../../lib/Setting/settingsRoute'
import type { BackHandler } from '../backHandlers'
import { SettingsMenuIndex, settingsOpen } from '../stores.svelte'
import { firstIndexOf, isSettingsPageId, type SettingsPageId } from './settingsPages'

const LAST_PAGE_KEY = 'risuSettings.lastPage'

/** The widest viewport that shows the index and a page one at a time; the spec's wide layout starts at 600. */
export const PHONE_MAX_WIDTH = 599

export function isPhoneWidth(width: number): boolean {
    return width <= PHONE_MAX_WIDTH
}

/**
 * The index to show when Settings is open. A requested page (anything but -1) and a phone width keep the
 * index as it is; otherwise the stored last page opens, or Chat bot when nothing valid is stored.
 */
export function resolveOpenIndex(options: { index: number, width: number, stored: string | null }): number {
    if (options.index !== -1 || isPhoneWidth(options.width)) return options.index
    return isSettingsPageId(options.stored) ? firstIndexOf(options.stored) : 1
}

/** The last page shown on this device, or null when nothing valid is stored or storage cannot be read. */
export function readLastPage(): SettingsPageId | null {
    try {
        const stored = localStorage.getItem(LAST_PAGE_KEY)
        return isSettingsPageId(stored) ? stored : null
    } catch {
        return null
    }
}

export function writeLastPage(page: SettingsPageId): void {
    try {
        localStorage.setItem(LAST_PAGE_KEY, page)
    } catch {
        // The choice is only a convenience; Settings opens on the default page when it cannot be kept.
    }
}

/**
 * The one close step of the shell, shared by the header Back, Android Back and Escape. After the Fix route
 * Back closes outright; on a phone a page goes up to the index; every other case closes Settings. The width is
 * read at call time.
 */
export function settingsShellBackStep(): void {
    if (isReturnToChat() || !isPhoneWidth(window.innerWidth) || get(SettingsMenuIndex) === -1) {
        settingsOpen.set(false)
        return
    }
    SettingsMenuIndex.set(-1)
}

let shellBackHandler: BackHandler | null = null

/** The shell registers the same handler instance that sits on the Back stack, and clears it on teardown. */
export function setShellBackHandler(handler: BackHandler | null): void {
    shellBackHandler = handler
}

/**
 * Escape while Settings is open. A mounted shell runs its registered handler, which blurs the focused field
 * and flushes effects before the close step, and the press counts as handled whatever the handler answered.
 * Returns false when no shell is mounted, so the caller closes Settings as the legacy screen does.
 */
export function settingsShellEscape(): boolean {
    if (!shellBackHandler) return false
    shellBackHandler()
    return true
}
