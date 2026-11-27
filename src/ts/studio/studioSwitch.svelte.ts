import { fromStore } from 'svelte/store'
import { DBState, MobileGUI, selIdState } from '../stores.svelte'

// Device-local switch, kept with the same pattern as the chat shell switch. It moves to the
// shared device-local helper when that lands; the key and the '1' encoding stay unchanged.
const STORAGE_KEY = 'risuStudio.enabled'

function readEnabled(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
        return false
    }
}

export const studioSwitch = $state({ enabled: readEnabled() })

export function setStudioEnabled(value: boolean): void {
    studioSwitch.enabled = value
    try {
        localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
    } catch {
        // The current device still uses the in-memory choice when storage is unavailable.
    }
}

// Created on first use, never at module evaluation: shared components import this module in
// suites that mock stores.svelte without MobileGUI.
let mobileGuiReader: ReturnType<typeof fromStore<boolean>> | null = null

function mobileGuiOn(): boolean {
    mobileGuiReader ??= fromStore(MobileGUI)
    return mobileGuiReader.current
}

// The switch is checked before any store is read, so with the switch off this touches nothing else.
// What a visit of the current selection would be about: null when none is offered, 'group' for a loaded group and
// 'character' for any other loaded selection.
export function studioVisitKind(): 'character' | 'group' | null {
    if (!studioSwitch.enabled) return null
    if (mobileGuiOn()) return null
    const index = selIdState.selId
    if (index < 0) return null
    const character = DBState.db.characters?.[index]
    if (!character || character.chaId === '§playground' || character.coldstorage) return null
    return character.type === 'group' ? 'group' : 'character'
}

// Character content (Home, content links) is offered only for a character; a group has no such content.
export function studioEligible(): boolean {
    return studioVisitKind() === 'character'
}

// A visit, of a character or of a group, is offered.
export function studioVisitEligible(): boolean {
    return studioVisitKind() !== null
}
