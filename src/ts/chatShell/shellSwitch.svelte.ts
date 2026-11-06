import { DBState, selIdState } from '../stores.svelte'

const STORAGE_KEY = 'risuChatShell.enabled'

function readEnabled(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
        return false
    }
}

export const shellSwitch = $state({ enabled: readEnabled() })

export function setShellEnabled(value: boolean): void {
    shellSwitch.enabled = value
    try {
        localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
    } catch {
        // The current device still uses the in-memory choice when storage is unavailable.
    }
}

export function shellEligible(): boolean {
    if (!shellSwitch.enabled || DBState.db.theme !== '') return false
    const index = selIdState.selId
    if (index < 0) return false
    const character = DBState.db.characters?.[index]
    return !!character && character.type !== 'group' && character.chaId !== '§playground'
        && !!character.chats?.[character.chatPage]
}
