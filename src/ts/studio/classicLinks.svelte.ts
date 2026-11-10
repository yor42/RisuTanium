// Link-outs from Studio to the classic editors. Studio closes first; after that only UI stores change, exactly as
// the classic buttons set them. Nothing here reads or writes the database.
import { CharConfigSubMenu, QuickSettings, SettingsMenuIndex, botMakerMode, settingsOpen, sideBarStore } from '../stores.svelte'
import { shellEligible } from '../chatShell/shellSwitch.svelte'
import { studioOpen } from './studioOpen'
import type { StudioKind } from './ownerModel'
import type { StudioOwnerType } from './studioTarget'

export type ClassicRoute = 'shell' | 'classic'

/** Where a link-out lands: a tab of the character settings, or a page of Settings. */
export type ClassicDestination =
    | { where: 'character', tab: number }
    | { where: 'settings', index: number }

/** Settings pages by their `SettingsMenuIndex`. */
const SETTINGS_PLUGINS = 4
const SETTINGS_PRESET = 1
const SETTINGS_PROMPT = 13
const SETTINGS_MODULES = 14

/**
 * A single-shot request for the new shell's sidebar: open More at Character settings. The sidebar clears it when
 * it consumes it, and the next Studio visit clears a leftover one. Only the shell route stores one.
 */
export interface ClassicLinkRequest {
    view: 'characterSettings'
}

export const classicLinks = $state({ request: null as ClassicLinkRequest | null })

export function clearClassicLinkRequest(): void {
    classicLinks.request = null
}

/** The new shell's sidebar when it is eligible, else the classic sidebar (desktop and phone layouts alike). */
export function routeOf(): ClassicRoute {
    return shellEligible() ? 'shell' : 'classic'
}

/** The character settings tab that edits a kind. */
function characterTabOf(kind: StudioKind | null): number {
    switch (kind) {
        case 'display': return 1
        case 'advanced':
        case 'toggles': return 2
        case 'lore': return 3
        case 'scripts':
        case 'regex':
        case 'html': return 4
        default: return 0
    }
}

/** The classic editor of an owner's kind, or null when none edits it. `kind` null means the owner as a whole. */
export function classicDestinationOf(ownerType: StudioOwnerType, kind: StudioKind | null): ClassicDestination | null {
    switch (ownerType) {
        case 'character': return { where: 'character', tab: characterTabOf(kind) }
        case 'chat': return { where: 'character', tab: 3 }
        case 'module': return { where: 'settings', index: SETTINGS_MODULES }
        case 'preset': return { where: 'settings', index: kind === 'advanced' ? SETTINGS_PROMPT : SETTINGS_PRESET }
        case 'plugin': return { where: 'settings', index: SETTINGS_PLUGINS }
        default: return null
    }
}

// True only while the `studioOpen.set(false)` of a link-out to a character destination runs.
let closingToCharacterEditor = false

/**
 * Whether Studio is being closed for a link-out to a character's classic editor. Read by a `studioOpen`
 * subscriber: that editor opens on the selected character, so the selection must survive this close. A close for
 * a Settings page, or any other close, leaves it false.
 */
export function studioClosingToCharacterEditor(): boolean {
    return closingToCharacterEditor
}

/**
 * Leaves Studio and opens the classic editor of an owner's kind. Studio is closed before any other store moves, so
 * the surfaces it hid are back when the editor opens.
 */
export function openInClassicEditor(ownerType: StudioOwnerType, kind: StudioKind | null): boolean {
    const destination = classicDestinationOf(ownerType, kind)
    if (!destination) return false
    closingToCharacterEditor = destination.where === 'character'
    try {
        studioOpen.set(false)
    } finally {
        closingToCharacterEditor = false
    }
    if (destination.where === 'settings') {
        SettingsMenuIndex.set(destination.index)
        settingsOpen.set(true)
        return true
    }
    CharConfigSubMenu.set(destination.tab)
    if (routeOf() === 'shell') {
        classicLinks.request = { view: 'characterSettings' }
        sideBarStore.set(true)
    } else {
        botMakerMode.set(true)
        QuickSettings.open = false
        sideBarStore.set(true)
    }
    return true
}
