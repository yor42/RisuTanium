import { untrack } from 'svelte'
import { get } from 'svelte/store'
import { afterFlush } from '../afterFlush'
import { returnFocusAfterClose } from './layerFocus'
import { DBState, selIdState, settingsOpen } from '../stores.svelte'
import { studioEligible } from './studioSwitch.svelte'
import { studioOpen } from './studioOpen'
import { flushStudioFields } from './fieldFlush'
import { clearClassicLinkRequest } from './classicLinks.svelte'
import { resolveStudioTarget, type StudioNotice } from './resolveTarget'
import { ownerKeyOf, type OwnerModel, type StudioKind } from './ownerModel'
import type { StudioLayout } from './studioLayout'
import type { StudioFrom, StudioTarget } from './studioTarget'
import { createPageSession } from './history/historyModel'
import { characterOwnerKey, chatOwnerKey, moduleOwnerKey, parseOwnerKey, type OwnerKey } from './history/ownerPhase'
import { openStudioModuleId } from './assets/openModuleForm.svelte'
import { presetOwnerKey } from './edit/presetTarget'

/**
 * Where a visit started. Back returns focus to `element` while it is still in the page, else to the first
 * match of `selector`, else to the chat transcript.
 */
export interface StudioOpener {
    element: HTMLElement | null
    selector?: string
}

/** The registry targets a merge undo left as they were, and the kind of owner whose labels name them. */
export interface StudioNoticePlaces {
    ownerKind: 'character' | 'module'
    places: readonly string[]
}

/** A merged list's own selection and the row of it that opened the current detail. */
export interface StudioListReturn {
    ownerKey: string
    kind: StudioKind
    rowId: string
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
 * - `togglePreviewOpen` shows the toggle preview sheet of the builder or of the combined view. It is visit state only
 *   and closes with the visit, an owner or kind change, a cleared selection, the phone list and a layout change.
 * - `toggleEditorPageOpen` is set by the toggle builder while its editor is a page of its own over the list. Detail to
 *   list yields to it, so Back closes the editor page before the phone returns to the list.
 * - `settingsReturn` is the Settings page index a link from Settings left, or null. Leaving the visit reopens Settings
 *   there; every other end of a visit leaves it null, so only the visit the link opened returns.
 * - `targetPending` is true from the open until a pane that has the model places the target.
 * - `listReturn` is the merged (Combined) list an entry was opened from, with the row that opened it. Back on a phone
 *   detail returns to that list instead of the tree; any other selection, the list and the end of the visit drop it.
 * - `revealListRow` is the row the list the detail shows (a merged list, or the module list) scrolls into view and
 *   focuses once it is shown: after Back from an entry opened there, or after a module's "Show in module list".
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
    togglePreviewOpen: false,
    toggleEditorPageOpen: false,
    settingsReturn: null as number | null,
    notice: null as string | null,
    // The places a merge undo left as they were, behind the notice's Show. Set only with the notice text it belongs
    // to; every other write of the notice clears it.
    noticePlaces: null as StudioNoticePlaces | null,
    targetPending: false,
    listReturn: null as StudioListReturn | null,
    revealListRow: null as string | null,
    selectedOwnerKey: null as string | null,
    // The id of the preset the selection pinned when a `preset:<index>` row was chosen, or null. The index key follows a
    // reorder; the id decides which preset the builder and the history belong to.
    selectedPresetId: null as string | null,
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
    studioScreen.togglePreviewOpen = false
    studioScreen.toggleEditorPageOpen = false
    studioScreen.settingsReturn = null
    studioScreen.notice = null
    studioScreen.noticePlaces = null
    studioScreen.targetPending = false
    studioScreen.listReturn = null
    studioScreen.revealListRow = null
    studioScreen.selectedOwnerKey = null
    studioScreen.selectedPresetId = null
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
 * Settings is open. A second call while open starts a new visit. `settingsReturn` is the Settings page the caller
 * closed to open this visit; Back from the visit reopens Settings there.
 */
export function openStudio(target: StudioTarget, opener: StudioOpener | null, settingsReturn: number | null = null): boolean {
    flushStudioFields('leave')
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
    studioScreen.settingsReturn = settingsReturn
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
    if (next !== studioScreen.layout) {
        flushStudioFields('leave')
        // The sheet's host may not exist in the next layout, and its Back layer must not outlive it.
        studioScreen.togglePreviewOpen = false
    }
    if (studioScreen.layout === 'drawer' && next !== 'drawer' && studioScreen.drawerOpen) {
        studioScreen.drawerOpen = false
        void returnFocusAfterClose('drawer', () => studioScreen.drawerOpen)
    }
    studioScreen.layout = next
}

/**
 * An item chosen from the tree or the list. A pick from the open drawer ends on the detail pane that shows it
 * (MC-1507), not on the control that opened the drawer.
 */
export function pickStudioItem(): void {
    const fromDrawer = studioScreen.drawerOpen
    studioScreen.pickedInVisit = true
    studioScreen.detailShown = true
    studioScreen.drawerOpen = false
    if (fromDrawer) void returnFocusAfterClose('drawer', () => studioScreen.drawerOpen, () => document.querySelector<HTMLElement>('[data-part="studio"] [data-part="studio-detail"]'))
    studioScreen.notice = null
    studioScreen.noticePlaces = null
}

/**
 * Closes the toggle preview sheet from its X, Esc or Back and returns focus to the control that opened it. Only this
 * path moves focus: a clear by a selection or layout change leaves it where the author put it.
 */
export function closeStudioTogglePreview(): void {
    studioScreen.togglePreviewOpen = false
    void afterFlush().then(() => document.querySelector<HTMLElement>('[data-part="studio-toggle-preview-eye"], [data-part="studio-tg-combined-all"]')?.focus())
}

/** The phone header title: shows the owner list. */
export function showStudioList(): void {
    flushStudioFields('leave')
    studioScreen.togglePreviewOpen = false
    studioScreen.detailShown = false
    studioScreen.listReturn = null
    studioScreen.revealListRow = null
    studioScreen.notice = null
    studioScreen.noticePlaces = null
}

/** Back on a phone detail goes to the list only when the user came from that list. */
export function studioViaList(): boolean {
    return studioScreen.layout === 'stack' && studioScreen.pickedInVisit && studioScreen.detailShown
}

/**
 * Back on a phone detail: to the merged list the entry was opened from, at its row, else to the tree. The merged list is
 * itself a detail, so a second Back goes on to the tree.
 */
export function studioDetailBack(): void {
    const origin = studioScreen.listReturn
    if (origin === null) {
        showStudioList()
        return
    }
    setStudioSelection(origin.ownerKey, origin.kind, null)
    studioScreen.revealListRow = origin.rowId
    studioScreen.notice = null
    studioScreen.noticePlaces = null
}

/** What Back on a phone detail changes: a press that leaves this unchanged did nothing. */
export function studioDetailBackSnapshot(): string {
    return `${studioScreen.detailShown}|${studioScreen.selectedOwnerKey}|${studioScreen.selectedKind}|${studioScreen.selectedItemId}`
}

/** The merged list scrolled to and focused `rowId`; the request is spent. */
export function takeStudioListReveal(rowId: string): void {
    if (studioScreen.revealListRow === rowId) studioScreen.revealListRow = null
}

/** Shows one message, or none. A newer notice replaces an older one whole: the places of the older one go with it. */
export function setStudioNotice(message: string | null): void {
    studioScreen.notice = message
    studioScreen.noticePlaces = null
}

function noticeOwnerKindOf(owner: OwnerKey): 'module' | 'character' {
    const parsed = parseOwnerKey(owner)
    if (parsed === null) {
        return 'character'
    }
    switch (parsed.kind) {
        case 'module':
            return 'module'
        case 'character':
        case 'chat':
        case 'preset':
            return 'character'
        default: {
            // Adding an owner kind must decide its place kind here; the fallback is the character wording.
            const unhandled: never = parsed
            void unhandled
            return 'character'
        }
    }
}

/**
 * The notice of a merge undo that left places as they were: `message` ("{j} places not restored") with the list behind
 * Show. Ctrl+Z and the History panel call it from their own replay, which has already checked its visit and owner.
 */
export function setStudioNotRestoredNotice(owner: OwnerKey, message: string, places: readonly string[]): void {
    studioScreen.notice = message
    studioScreen.noticePlaces = { ownerKind: noticeOwnerKindOf(owner), places: [...places] }
}

/**
 * The same notice for the Undo toast's outcome, which arrives after an await and can outlive the visit or the owner it
 * was posted for: it lands only while Studio is open in that visit with that owner selected, else nothing is shown.
 */
export function setStudioNotRestoredNoticeFromToast(visitId: string, owner: OwnerKey, message: string, places: readonly string[]): void {
    if (!studioScreen.open || studioScreen.visitId !== visitId || selectedHistoryOwner() !== owner) return
    setStudioNotRestoredNotice(owner, message, places)
}

/** Rows of a long list rendered per page. */
export const TREE_PAGE_SIZE = 100

/** Row ids of the tree. They are also the keys of `expanded` and `pages`. */
export const groupRowId = (group: string): string => `g:${group}`
export const ownerRowId = (ownerKey: string): string => `o:${ownerKey}`
export const kindRowId = (ownerKey: string, kind: StudioKind): string => `k:${ownerKey}/${kind}`

/**
 * The history owner of the selected owner: the bound character, the chat of its current page, or the module the
 * detail has selected. A module is the owner only while the selection is that module's own row (the first row of its
 * id) and the detail publishes the id, which it does not while the module is unloaded or another module shares it.
 * Null for every other selection (presets, plugins, another character, an unpublished module) and for no selection. Whether that chat has a
 * unique id is checked where the history is read.
 */
export function selectedHistoryOwner(): OwnerKey | null {
    const key = studioScreen.selectedOwnerKey
    const chaId = studioScreen.chaId
    const openModule = openStudioModuleId()
    if (key !== null && openModule !== null && key === ownerKeyOf('module', openModule)) return moduleOwnerKey(openModule)
    if (key === null || chaId === '') return null
    if (key.startsWith(PRESET_KEY_PREFIX)) return studioScreen.selectedPresetId === null ? null : presetOwnerKey(studioScreen.selectedPresetId)
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
    flushStudioFields('leave')
    if (studioScreen.selectedOwnerKey !== ownerKey) {
        studioScreen.restoreSheetOpen = false
    }
    // A line selection inside a builder changes neither the owner nor the kind, so the sheet stays open across it.
    if (studioScreen.selectedOwnerKey !== ownerKey || studioScreen.selectedKind !== kind) studioScreen.togglePreviewOpen = false
    // A new selection leaves the merged list the detail came from; only `openStudioListRow` sets it again.
    studioScreen.listReturn = null
    studioScreen.revealListRow = null
    studioScreen.selectedOwnerKey = ownerKey
    studioScreen.selectedPresetId = presetIdOfKey(ownerKey)
    studioScreen.selectedKind = kind
    studioScreen.selectedItemId = itemId
}

const PRESET_KEY_PREFIX = ownerKeyOf('preset', '')

/** The id of the preset a `preset:<index>` key names right now; null for any other key, a non-integer index or an index out of range. */
function presetIdOfKey(ownerKey: string): string | null {
    if (!ownerKey.startsWith(PRESET_KEY_PREFIX)) return null
    const text = ownerKey.slice(PRESET_KEY_PREFIX.length)
    const index = Number(text)
    if (!/^\d+$/.test(text) || !Number.isInteger(index)) return null
    const id = DBState.db.botPresets?.[index]?.id
    return typeof id === 'string' && id !== '' ? id : null
}

/**
 * The pinned preset moved to another row: only the index key follows. The selection, the kind, the item and every open
 * sheet stay as they were, so the builder that is mounted for the pin is not rebuilt.
 */
export function followStudioPreset(index: number): void {
    studioScreen.selectedOwnerKey = ownerKeyOf('preset', String(index))
}

/** Drops the selection, for an owner that no longer exists in the model; `notice` says why the detail emptied. */
export function clearStudioSelection(notice: string): void {
    studioScreen.restoreSheetOpen = false
    studioScreen.togglePreviewOpen = false
    studioScreen.selectedOwnerKey = null
    studioScreen.selectedPresetId = null
    studioScreen.selectedKind = null
    studioScreen.selectedItemId = null
    studioScreen.notice = notice
    studioScreen.noticePlaces = null
}

/** A choice made in the tree or the list: selects, then moves a phone to the detail. */
export function selectStudioNode(ownerKey: string, kind: StudioKind | null, itemId: string | null): void {
    setStudioSelection(ownerKey, kind, itemId)
    pickStudioItem()
}

/**
 * A row chosen in a merged list: opens the entry in its owner, and Back on a phone returns to `list` at that row.
 * `list` is the merged list's own selection (its key and kind), which the entry's selection replaces. `revealId` names
 * what the list shows again when it is not the entry's own row (a source of the merged toggles view, a lore test result).
 */
export function openStudioListRow(list: { ownerKey: string, kind: StudioKind }, ownerKey: string, itemId: string | null, revealId: string | null = itemId): void {
    selectStudioNode(ownerKey, list.kind, itemId)
    studioScreen.listReturn = revealId === null ? null : { ownerKey: list.ownerKey, kind: list.kind, rowId: revealId }
}

/**
 * The selection key of the module list page. `list` is no owner type, so no owner model, history owner or target parser
 * ever reads it as an owner.
 */
export const MODULE_LIST_KEY = 'list:modules'

/**
 * Shows the module list page. Held text of the page being left is written first (through `setStudioSelection`). With
 * `revealKey` (a `moduleRowKeys` key) the page scrolls that row into view and focuses it once.
 */
export function openStudioModuleList(revealKey: string | null = null): void {
    selectStudioNode(MODULE_LIST_KEY, null, null)
    studioScreen.revealListRow = revealKey
}

/**
 * Selects the owner of module row `row` at `kind`, and opens the rows that lead to it. `model` is the owner model read
 * after any push of `row`, because the owner is looked up in it. False when `model` has no owner for the row, in which
 * case nothing changes.
 */
export function openStudioModuleOwner(model: OwnerModel, row: { id: string }, kind: StudioKind): boolean {
    // The first row holding an id keeps it; a later row with the same id gets a row-suffixed owner id (see the owner model).
    const used = new Set<string>()
    let ownerId: string | null = null
    const rows = DBState.db.modules ?? []
    for (let index = 0; index < rows.length; index++) {
        const id = used.has(rows[index].id) ? `${rows[index].id}#${index}` : rows[index].id
        used.add(id)
        if (rows[index] === row) {
            ownerId = id
            break
        }
    }
    if (ownerId === null) return false
    const owner = model.ownerByKey(ownerKeyOf('module', ownerId))
    if (!owner) return false
    for (const group of groupPathOf(owner)) studioScreen.expanded[groupRowId(group)] = true
    studioScreen.expanded[ownerRowId(owner.key)] = true
    selectStudioNode(owner.key, kind, null)
    return true
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
    if (resolved.notice) setStudioNotice(noticeText(resolved.notice))
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
