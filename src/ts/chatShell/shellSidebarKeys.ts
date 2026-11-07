import { tick } from 'svelte'
import { get } from 'svelte/store'
import { alertStore, sideBarClosing, sideBarStore } from '../stores.svelte'
import { keyEventBlocked } from '../keyEventBlocked'
import { hasOpenShell } from '../../lib/Nexus/pattern/patternFocus'
import { adjacentChat, chatListItems } from './chatListModel'
import { openChatOf, selectedOwner } from './chatOpen'
import { readChatSort } from './deviceSettings'
import { abandonPendingSwitch } from './switchTarget.svelte'

/**
 * Alt+Up and Alt+Down open the neighbouring chat of the selected character in
 * the order the sidebar lists them (the sort this device chose). Ctrl+K (Cmd+K)
 * opens the sidebar and focuses its search field. They are the new shell's own
 * shortcuts: the sidebar installs them while it is mounted.
 */

const TEXT_INPUT_BLOCKED_TYPES = new Set(['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'range', 'color', 'file'])

// A control that keeps the arrow keys for itself.
function keepsArrowKeys(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false
    }
    if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return true
    }
    return target.tagName === 'INPUT' && !TEXT_INPUT_BLOCKED_TYPES.has((target as HTMLInputElement).type)
}

// Ctrl or Cmd with K and nothing else. Under a non-Latin layout `key` is not "k", so the physical key stands in for it.
function isSearchKey(event: KeyboardEvent): boolean {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
        return false
    }
    if (event.key === 'k' || event.key === 'K') {
        return true
    }
    return event.code === 'KeyK' && !/^[a-z]$/i.test(event.key)
}

function focusSearch(): void {
    document.querySelector<HTMLElement>('[data-part="chat-sidebar-search-field"]')?.focus()
}

// A text field keeps Ctrl+K for itself (the search field included): the shortcut is deliberately inert there.
function onSearchKey(event: KeyboardEvent): void {
    if (event.defaultPrevented || keyEventBlocked(event) || keepsArrowKeys(event.target) || hasOpenShell()) {
        return
    }
    const alertType = get(alertStore).type
    if (alertType !== 'none' && alertType !== 'toast') {
        return
    }
    event.preventDefault()
    sideBarClosing.set(false)
    sideBarStore.set(true)
    // The field exists once the panel has drawn.
    void tick().then(focusSearch)
}

function onKeydown(event: KeyboardEvent): void {
    if (isSearchKey(event)) {
        onSearchKey(event)
        return
    }
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
        return
    }
    if (event.defaultPrevented || keyEventBlocked(event) || keepsArrowKeys(event.target) || hasOpenShell()) {
        return
    }
    const alertType = get(alertStore).type
    if (alertType !== 'none' && alertType !== 'toast') {
        return
    }
    // Resolved now, not when the sidebar last drew: the selection may have just moved.
    const owner = selectedOwner()
    if (!owner) {
        return
    }
    const next = adjacentChat(chatListItems(owner, readChatSort()), owner.chats[owner.chatPage], event.key === 'ArrowDown' ? 1 : -1)
    if (!next) {
        return
    }
    event.preventDefault()
    // Opening a chat of the character that is still selected drops a loading or failed switch to another one for good:
    // the restore still running is superseded, so it cannot move the selection later.
    if (openChatOf(owner, next) === 'opened') {
        abandonPendingSwitch()
    }
}

/** Registers the shortcuts on the window; returns the function that removes them. */
export function installShellSidebarKeys(): () => void {
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
}
