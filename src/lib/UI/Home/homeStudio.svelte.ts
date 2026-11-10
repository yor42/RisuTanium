import { get } from 'svelte/store'
import { recordCaughtError } from 'src/ts/caughtErrors'
import { changeChar, supersedeChangeChar } from 'src/ts/characters'
import type { character, groupChat } from 'src/ts/storage/database.svelte'
import { DBState, MobileGUI, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import { studioClosingToCharacterEditor } from 'src/ts/studio/classicLinks.svelte'
import { studioOpen } from 'src/ts/studio/studioOpen'
import { openStudio } from 'src/ts/studio/studioScreen.svelte'
import { studioSwitch } from 'src/ts/studio/studioSwitch.svelte'
import { requestHomeLibrary, requestHomeReturnFocus } from './homeView.svelte'

// Open in Studio from the Home library. Home selects the clicked slot and opens Studio in one synchronous
// stretch, then a Home-owned subscriber on `studioOpen` ends each such visit at the library. Nothing here is
// stored: no field, no `.bin` content, no key.

/** The visit Home opened: the clicked slot object, so a moved index cannot mislead the end of the visit. */
interface HomeVisit {
    slot: character | groupChat
    chaId: string
}

let homeVisit: HomeVisit | null = null
let stopVisitEnd: (() => void) | null = null

/**
 * Whether Studio can open on this slot. This is `studioEligible()` for one character without selecting it
 * (the switch on, not Beta Mobile GUI, not a group, not the playground, not an archived stub), and a trashed
 * character is never offered.
 */
export function homeStudioAvailable(slot: character | groupChat | undefined): boolean {
    if (!slot) return false
    if (!studioSwitch.enabled || get(MobileGUI)) return false
    return slot.type !== 'group' && slot.chaId !== '§playground' && !slot.coldstorage && !slot.trashTime
}

// Leaves the state a failed open must leave: nothing selected, the library shown.
function restoreHomeLibrary(): void {
    if (get(selectedCharID) !== -1) selectedCharID.set(-1)
    requestHomeLibrary()
}

function onHomeStudioPickError(error: unknown): void {
    console.error('Open in Studio could not select the character:', error)
    recordCaughtError('home.studio', error)
}

// Installed by the first open. Every end of a Home visit passes here: Back, Settings winning, the watcher
// (a trash or delete, a moved selection), a Settings link-out and a failed chunk load.
function installVisitEnd(): void {
    if (stopVisitEnd) return
    stopVisitEnd = studioOpen.subscribe((open) => {
        if (open) return
        const visit = homeVisit
        homeVisit = null
        if (visit === null) return
        // The classic character editor opens on the selected character, so the selection stays.
        if (studioClosingToCharacterEditor()) return
        const selected = get(selectedCharID)
        // Someone else moved the selection: the visit undoes only its own.
        if (selected !== -1 && DBState.db.characters?.[selected] !== visit.slot) return
        // The library is requested before the selection clears, so the shell that clearing creates starts there.
        requestHomeLibrary()
        if (selected !== -1) selectedCharID.set(-1)
        // After the clear, so the library it reaches already shows no chat. The library takes it on mount.
        requestHomeReturnFocus(visit.chaId)
    })
}

/**
 * Selects the slot at `index` and opens Studio on it, `from: 'home'`; false, with nothing selected and the
 * library shown, when it cannot. All synchronous and in this order, so no flush runs between the select and
 * the open: a flush there would show the opened character's chat uncovered and clear its new-reply mark and
 * notification. The pick keeps the last interaction. `changeChar` is not awaited: for a warm, non-group slot
 * it selects before its first await, and the check below refuses anything else.
 */
export function openStudioFromHome(index: number, opener: HTMLElement): boolean {
    const slot = DBState.db.characters?.[index]
    if (!slot || !homeStudioAvailable(slot)) return false
    installVisitEnd()
    void changeChar(index, { keepInteraction: true, quiet: true }).catch(onHomeStudioPickError)
    // `openStudio` binds through `selIdState`, so that is what must already name this slot.
    if (selIdState.selId !== index || DBState.db.characters[index] !== slot) {
        supersedeChangeChar()
        restoreHomeLibrary()
        return false
    }
    // The opener element unmounts with the library and no selector names a Home control; Home focuses on its own.
    if (!openStudio({ owner: { type: 'character', id: slot.chaId }, from: 'home' }, { element: opener })) {
        restoreHomeLibrary()
        return false
    }
    homeVisit = { slot, chaId: slot.chaId }
    return true
}

/** Test-only: stops following Studio and forgets the visit. */
export function resetHomeStudioForTests(): void {
    stopVisitEnd?.()
    stopVisitEnd = null
    homeVisit = null
}
