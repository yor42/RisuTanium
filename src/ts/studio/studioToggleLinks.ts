import { get } from 'svelte/store'
import { DBState, SettingsMenuIndex, settingsOpen } from '../stores.svelte'
import { isModuleStub } from '../storage/moduleStub'
import { openStudio, selectedStudioCharacterId, type StudioOpener } from './studioScreen.svelte'
import { studioEligible } from './studioSwitch.svelte'
import type { StudioTarget } from './studioTarget'

/** The classic toggle-definition field a link sits beside. A preset has no link until Studio can edit its toggles. */
export type ToggleLinkOwner =
    | { readonly type: 'character' }
    | { readonly type: 'module', readonly moduleId: string }

/**
 * Where "Edit in Studio" leads, or null when Studio cannot open on that owner now. A module links only while exactly
 * one row of the module list holds its id and that row is loaded: a duplicate id or a stub would land on another
 * owner or on a kind-fallback notice.
 */
export function toggleLinkTarget(owner: ToggleLinkOwner): StudioTarget | null {
    if (!studioEligible()) return null
    const chaId = selectedStudioCharacterId()
    if (chaId === null) return null
    if (owner.type === 'character') return { owner: { type: 'character', id: chaId }, kind: 'toggles', from: 'chat' }
    const rows = (DBState.db.modules ?? []).filter((row) => row.id === owner.moduleId)
    if (rows.length !== 1 || isModuleStub(rows[0])) return null
    return { owner: { type: 'module', id: owner.moduleId }, kind: 'toggles', from: 'settings' }
}

/**
 * Opens the owner's toggle definition in Studio. Studio refuses to open over Settings, so the page index is read
 * before Settings closes (its surface resets the index when it goes), and Settings is put back as it was when Studio
 * refuses. An owner with no target changes nothing.
 */
export function openToggleDefinitionInStudio(owner: ToggleLinkOwner, opener: StudioOpener | null): boolean {
    const target = toggleLinkTarget(owner)
    if (target === null) return false
    if (!get(settingsOpen)) return openStudio(target, opener)
    const index = get(SettingsMenuIndex)
    settingsOpen.set(false)
    if (openStudio(target, opener, index)) return true
    SettingsMenuIndex.set(index)
    settingsOpen.set(true)
    return false
}
