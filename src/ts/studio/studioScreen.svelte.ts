import { untrack } from 'svelte'
import { get } from 'svelte/store'
import { DBState, selIdState, settingsOpen } from '../stores.svelte'
import { studioEligible } from './studioSwitch.svelte'
import { studioOpen } from './studioOpen'
import { clearClassicLinkRequest } from './classicLinks.svelte'
import { resolveStudioTarget, type StudioNotice } from './resolveTarget'
import { ownerKeyOf, type OwnerModel, type StudioKind } from './ownerModel'
import type { StudioLayout } from './studioLayout'
import type { StudioFrom, StudioTarget } from './studioTarget'
import { createPageSession } from './history/historyModel'
import { characterOwnerKey, chatOwnerKey, type OwnerKey } from './history/ownerPhase'

/**
 * Where a visit started. Back returns focus to `element` while it is still in the page, else to the first
 * match of `selector`, else to the chat transcript.
 */
export interface StudioOpener {
    element: HTMLElement | null
    selector?: string
}

/**
 * The state of the Studio visit that is on screen. Nothing here touches a store until the first
 * `openStudio`, so surfaces that import this module (More, the This chat sheet, App) read no
 * stores.svelte export while the switch is off.
 *
 * - `open` mirrors the `studioOpen` flag that App, the chat surface and the hotkeys follow.
 * - `chaId` is the character the visit is bound to; the visit ends when the selection moves away from it.
 * - `visitId` names the visit; every `openStudio` that is accepted gives a new one, unique across page loads,
 *   because a stored restore point compares it to tell a new visit from the one that made the point.
 * - `pickedInVisit` is set only by choosing an item from the list, never by the entry, so Back from a
 *   direct entry goes straight to the origin.
 * - `detailShown` is false while the list is the phone screen.
 * - `historyOpen` shows the History panel of the selected owner; `restoreSheetOpen` shows the restore sheet over
 *   it. The sheet closes with the panel, with the visit and when the selected owner changes.
 * - `targetPending` is true from the open until a pane that has the model places the target.
 * - The selection, the expanded rows, the extra pages and "hide empty kinds" live here, not in the tree, so a
 *   phone layout that unmounts the tree keeps them for the visit.
 */
export const studioScreen = $state({
    open: false,
    chaId: '',
    visitId: '',
    target: {} as StudioTarget,
    from: undefined as StudioFrom | undefined,
    opener: null as StudioOpener | null,
    layout: 'wide' as StudioLayout,
    pickedInVisit: false,
    detailShown: false,
    drawerOpen: false,
    searchOpen: false,
    historyOpen: false,
    restoreSheetOpen: false,
    notice: null as string | null,
    targetPending: false,
    selectedOwnerKey: null as string | null,
    selectedKind: null as StudioKind | null,
    selectedItemId: null as string | null,
    expanded: {} as Record<string, boolean>,
    pages: {} as Record<string, number>,
    hideEmpty: false,
})

let stopWatchers: (() => void) | null = null
let visitSession: string | null = null
let visitCounter = 0

function nextVisitId(): string {
    visitSession ??= createPageSession((bytes) => crypto.getRandomValues(bytes))
    visitCounter += 1
    return `${visitSession}:${visitCounter}`
}

/** The chaId of the selected character, or null when nothing usable is selected. */
export function selectedStudioCharacterId(): string | null {
    return DBState.db.characters?.[selIdState.selId]?.chaId ?? null
}

function resetVisitState(): void {
    studioScreen.pickedInVisit = false
    studioScreen.detailShown = false
    studioScreen.drawerOpen = false
    studioScreen.searchOpen = false
    studioScreen.historyOpen = false
    studioScreen.restoreSheetOpen = false
    studioScreen.notice = null
    studioScreen.targetPending = false
    studioScreen.selectedOwnerKey = null
    studioScreen.selectedKind = null
    studioScreen.selectedItemId = null
    studioScreen.expanded = {}
    studioScreen.pages = {}
    studioScreen.hideEmpty = false
}

// Installed by the first open: following the stores earlier would make every importer read them.
function installWatchers(): void {
    if (stopWatchers) return
    // Whoever clears the flag (Back, a link-out, an external reset) also ends the visit's state.
    const stopFlag = studioOpen.subscribe((open) => {
        studioScreen.open = open
        if (!open) resetVisitState()
    })
    // Settings wins: it replaces Studio and Studio does not come back when Settings closes.
    const stopSettings = settingsOpen.subscribe((open) => {
        if (open && studioScreen.open) closeStudio()
    })
    const stopEffects = $effect.root(() => {
        // The visit ends when it can no longer be shown or is no longer about the selected character.
        $effect(() => {
            if (!studioScreen.open) return
            const eligible = studioEligible()
            const selected = eligible ? selectedStudioCharacterId() : null
            if (!eligible || selected !== studioScreen.chaId) untrack(closeStudio)
        })
    })
    stopWatchers = () => {
        stopFlag()
        stopSettings()
        stopEffects()
    }
}

/**
 * Opens Studio on the selected character. Refused, with no state change, when Studio is not eligible or
 * Settings is open. A second call while open starts a new visit.
 */
export function openStudio(target: StudioTarget, opener: StudioOpener | null): boolean {
    if (!studioEligible()) return false
    if (get(settingsOpen)) return false
    const chaId = selectedStudioCharacterId()
    if (chaId === null) return false
    installWatchers()
    // A leftover link-out request belongs to an earlier visit and must not open More under this one.
    clearClassicLinkRequest()
    resetVisitState()
    studioScreen.targetPending = true
    studioScreen.chaId = chaId
    studioScreen.visitId = nextVisitId()
    studioScreen.target = target
    studioScreen.from = target.from
    studioScreen.opener = opener
    // An entry that names an owner lands on its screen; the list is one tap away on phones.
    studioScreen.detailShown = target.owner !== undefined
    studioOpen.set(true)
    return true
}

export function closeStudio(): void {
    studioOpen.set(false)
    resetVisitState()
}

/**
 * A layout change keeps the visit but not the drawer: it exists only in the middle layout, so leaving
 * that layout closes it and its Back handler goes with it.
 */
export function setStudioLayout(next: StudioLayout): void {
    if (studioScreen.layout === 'drawer' && next !== 'drawer') studioScreen.drawerOpen = false
    studioScreen.layout = next
}

/** An item chosen from the tree or the list. */
export function pickStudioItem(): void {
    studioScreen.pickedInVisit = true
    studioScreen.detailShown = true
    studioScreen.drawerOpen = false
    studioScreen.notice = null
}

/** The phone header title: shows the owner list. */
export function showStudioList(): void {
    studioScreen.detailShown = false
    studioScreen.notice = null
}

/** Back on a phone detail goes to the list only when the user came from that list. */
export function studioViaList(): boolean {
    return studioScreen.layout === 'stack' && studioScreen.pickedInVisit && studioScreen.detailShown
}

export function setStudioNotice(message: string | null): void {
    studioScreen.notice = message
}

/** Rows of a long list rendered per page. */
export const TREE_PAGE_SIZE = 100

/** Row ids of the tree. They are also the keys of `expanded` and `pages`. */
export const groupRowId = (group: string): string => `g:${group}`
export const ownerRowId = (ownerKey: string): string => `o:${ownerKey}`
export const kindRowId = (ownerKey: string, kind: StudioKind): string => `k:${ownerKey}/${kind}`

/**
 * The history owner of the selected owner: the bound character, or the chat of its current page. Null for every
 * other selection (modules, presets, plugins, another character) and for no selection. Whether that chat has a
 * unique id is checked where the history is read.
 */
export function selectedHistoryOwner(): OwnerKey | null {
    const key = studioScreen.selectedOwnerKey
    const chaId = studioScreen.chaId
    if (key === null || chaId === '') return null
    if (key === ownerKeyOf('character', chaId)) return characterOwnerKey(chaId)
    const chatPrefix = ownerKeyOf('chat', '')
    if (key.startsWith(chatPrefix) && key.length > chatPrefix.length) return chatOwnerKey(chaId, key.slice(chatPrefix.length))
    return null
}

/**
 * Opens or closes the History panel. Closing it also closes the restore sheet, which only exists under the panel.
 */
export function setStudioHistoryOpen(open: boolean): void {
    studioScreen.historyOpen = open
    if (!open) studioScreen.restoreSheetOpen = false
}

/** Opens or closes the restore sheet. It opens only while the History panel is open. */
export function setStudioRestoreSheetOpen(open: boolean): void {
    studioScreen.restoreSheetOpen = open && studioScreen.historyOpen
}

/**
 * Shows an item, a kind or an owner in the detail without leaving the list (no phone navigation). Moving to a
 * different owner closes the restore sheet, so the content it was opened over cannot change behind it.
 */
export function setStudioSelection(ownerKey: string, kind: StudioKind | null, itemId: string | null): void {
    if (studioScreen.selectedOwnerKey !== ownerKey) studioScreen.restoreSheetOpen = false
    studioScreen.selectedOwnerKey = ownerKey
    studioScreen.selectedKind = kind
    studioScreen.selectedItemId = itemId
}

/** Drops the selection, for an owner that no longer exists in the model; `notice` says why the detail emptied. */
export function clearStudioSelection(notice: string): void {
    studioScreen.restoreSheetOpen = false
    studioScreen.selectedOwnerKey = null
    studioScreen.selectedKind = null
    studioScreen.selectedItemId = null
    studioScreen.notice = notice
}

/** A choice made in the tree or the list: selects, then moves a phone to the detail. */
export function selectStudioNode(ownerKey: string, kind: StudioKind | null, itemId: string | null): void {
    setStudioSelection(ownerKey, kind, itemId)
    pickStudioItem()
}

export function setStudioExpanded(rowId: string, expanded: boolean): void {
    studioScreen.expanded[rowId] = expanded
}

/** Shows one more page of a long list. */
export function showMoreStudioRows(rowId: string): void {
    studioScreen.pages[rowId] = (studioScreen.pages[rowId] ?? 0) + 1
}

// The rows that must be open to see an owner.
function groupPathOf(owner: { type: string, active: boolean }): string[] {
    switch (owner.type) {
        case 'module': return [owner.active ? 'modules' : 'otherModules']
        case 'preset': return owner.active ? ['presets'] : ['presets', 'otherPresets']
        case 'plugin': return ['plugins']
        default: return []
    }
}

/**
 * Places the target of the opening on the model, once per visit: selects what it resolves to, opens the rows
 * that lead there and shows the notice for a target that could not be honoured. `noticeText` turns the
 * resolver's notice into the visible message.
 */
export function applyStudioTarget(model: OwnerModel, noticeText: (notice: StudioNotice) => string): void {
    if (!studioScreen.targetPending) return
    studioScreen.targetPending = false
    const resolved = resolveStudioTarget(model, studioScreen.target)
    if (resolved.notice) studioScreen.notice = noticeText(resolved.notice)
    if (resolved.ownerKey === null) return
    const owner = model.ownerByKey(resolved.ownerKey)
    if (!owner) return
    for (const group of groupPathOf(owner)) studioScreen.expanded[groupRowId(group)] = true
    studioScreen.expanded[ownerRowId(owner.key)] = true
    if (resolved.kind !== null && resolved.itemId !== null) {
        const rowId = kindRowId(owner.key, resolved.kind)
        studioScreen.expanded[rowId] = true
        // The row must be on a rendered page for the tree to show where the target is.
        const index = owner.kinds().find((node) => node.kind === resolved.kind)?.items().findIndex((item) => item.id === resolved.itemId) ?? -1
        if (index >= TREE_PAGE_SIZE) studioScreen.pages[rowId] = Math.floor(index / TREE_PAGE_SIZE)
    }
    setStudioSelection(owner.key, resolved.kind, resolved.itemId)
}

/** Test-only: ends the visit, stops the watchers and returns the state to its initial values. */
export function resetStudioScreenForTests(): void {
    stopWatchers?.()
    stopWatchers = null
    studioOpen.set(false)
    studioScreen.open = false
    studioScreen.chaId = ''
    studioScreen.visitId = ''
    studioScreen.target = {}
    studioScreen.from = undefined
    studioScreen.opener = null
    studioScreen.layout = 'wide'
    resetVisitState()
}
