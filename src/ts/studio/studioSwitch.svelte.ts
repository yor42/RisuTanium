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
export function studioEligible(): boolean {
    if (!studioSwitch.enabled) return false
    if (mobileGuiOn()) return false
    const index = selIdState.selId
    if (index < 0) return false
    const character = DBState.db.characters?.[index]
    return !!character && character.type !== 'group' && character.chaId !== '§playground'
        && !character.coldstorage
}
