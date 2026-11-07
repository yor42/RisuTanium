import { get } from 'svelte/store'
import { alertStore } from '../stores.svelte'
import { keyEventBlocked } from '../keyEventBlocked'
import { hasOpenShell } from '../../lib/Nexus/pattern/patternFocus'
import { adjacentChat, chatListItems } from './chatListModel'
import { openChatOf, selectedOwner } from './chatOpen'
import { readChatSort } from './deviceSettings'

/**
 * Alt+Up and Alt+Down open the neighbouring chat of the selected character in
 * the order the sidebar lists them (the sort this device chose). They are the
 * new shell's own shortcuts: the sidebar installs them while it is mounted.
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

function onKeydown(event: KeyboardEvent): void {
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
    openChatOf(owner, next)
}

/** Registers the shortcuts on the window; returns the function that removes them. */
export function installShellSidebarKeys(): () => void {
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
}
