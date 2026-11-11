import { get } from 'svelte/store'
import { language } from 'src/lang'
import { alertError } from 'src/ts/alert'
import { registerBackHandler } from 'src/ts/backHandlers'
import { recordCaughtError } from 'src/ts/caughtErrors'
import { changeChar, changeCharGeneration, characterFormatUpdate, supersedeChangeChar } from 'src/ts/characters'
import { restoreColdCharacter, type ColdRestoreOutcome } from 'src/ts/process/coldCharacterRestore'
import type { character, groupChat } from 'src/ts/storage/database.svelte'
import { DBState, MobileGUI, selIdState, selectedCharID, settingsOpen } from 'src/ts/stores.svelte'
import { studioClosingToCharacterEditor } from 'src/ts/studio/classicLinks.svelte'
import { studioOpen } from 'src/ts/studio/studioOpen'
import { openStudio } from 'src/ts/studio/studioScreen.svelte'
import { studioSwitch } from 'src/ts/studio/studioSwitch.svelte'
import { requestHomeLibrary, requestHomeReturnFocus } from './homeView.svelte'

// Open in Studio from the Home library. Home selects the clicked slot and opens Studio in one synchronous
// stretch, then a Home-owned subscriber on `studioOpen` ends each such visit at the library. Nothing here is
// stored: no field, no `.bin` content, no key.
//
// An archived slot is loaded first, through the restore a row tap uses, without selecting it. After the await
// the slot is found again by identity, an install is formatted before any stop (as `changeChar` does), and
// only then does the same synchronous select-and-open run: no flush falls between the select and the open
// (CHORE-685). The Back handler belongs to its request: only that request registers and releases it.

/** The visit Home opened: the clicked slot object, so a moved index cannot mislead the end of the visit. */
interface HomeVisit {
    slot: character | groupChat
    chaId: string
}

let homeVisit: HomeVisit | null = null
let stopVisitEnd: (() => void) | null = null

/**
 * Whether the control is offered for this slot: `studioEligible()` for one character once it is loaded, without
 * selecting it (the switch on, not Beta Mobile GUI, not a group, not the playground), and a trashed character is
 * never offered. An archived stub is offered: the open loads it first (`startStudioFromHome`).
 */
export function homeStudioAvailable(slot: character | groupChat | undefined): boolean {
    if (!slot) return false
    if (!studioSwitch.enabled || get(MobileGUI)) return false
    return slot.type !== 'group' && slot.chaId !== '§playground' && !slot.trashTime
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
 * it selects before its first await, so an archived slot is refused here before any `changeChar`; the cold
 * entry is `startStudioFromHome`, which loads the slot and then calls this with the loaded slot's index.
 */
export function openStudioFromHome(index: number, opener: HTMLElement): boolean {
    const slot = DBState.db.characters?.[index]
    if (!slot || !homeStudioAvailable(slot) || slot.coldstorage) return false
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

/** An archived slot's open while it loads. Only the request `pending` names may open, and only while no `changeChar` has started. */
interface ColdOpenRequest {
    seq: number
    /** `changeCharGeneration()` at the tap: a later value means a `changeChar` or a supersede ran since. */
    generation: number
    /** Unregisters this request's Back handler; idempotent, and never touches another request's. */
    releaseBack: () => void
}

let pending: ColdOpenRequest | null = null
let seq = 0

function isCurrentRequest(request: ColdOpenRequest): boolean {
    return pending === request && request.seq === seq
}

function clearIfPending(request: ColdOpenRequest): void {
    if (pending === request) pending = null
}

/**
 * The Home library's open. A loaded slot opens at once (`openStudioFromHome`). An archived one is loaded, and
 * then opened if nothing has changed. The latest tap wins: this cancels any earlier request first. A request
 * ends without opening when Back is pressed, the library unmounts (`cancelHomeStudioOpen`), a `changeChar`
 * starts, Settings opens, the slot is gone, trashed or no longer available, or the load is refused. A refused
 * load alerts through the restore when this tap is the installer, as a row tap does. A tap that joins a quiet
 * restore that is then refused shows no alert.
 */
export function startStudioFromHome(index: number, opener: HTMLElement): boolean | Promise<boolean> {
    cancelHomeStudioOpen()
    const stub = DBState.db.characters?.[index]
    if (!stub?.coldstorage) return openStudioFromHome(index, opener)
    return openArchivedStudioFromHome(stub, opener)
}

async function openArchivedStudioFromHome(stub: character | groupChat, opener: HTMLElement): Promise<boolean> {
    if (!homeStudioAvailable(stub)) return false
    // An earlier `changeChar` still waiting on a restore can no longer select: the latest tap wins.
    supersedeChangeChar()
    const request: ColdOpenRequest = { seq: ++seq, generation: changeCharGeneration(), releaseBack: () => {} }
    request.releaseBack = registerBackHandler(() => {
        if (pending !== request) return false
        cancelHomeStudioOpen()
        return true
    })
    pending = request
    try {
        let outcome: ColdRestoreOutcome
        try {
            outcome = await restoreColdCharacter(stub)
        } finally {
            request.releaseBack()
        }
        // Nothing below awaits: the stop checks, the select and the open are one synchronous stretch.
        if (outcome.status !== 'restored') {
            // A refused load has alerted unless a quiet restore decided; a gone slot is silent.
            clearIfPending(request)
            return false
        }
        const index = DBState.db.characters.indexOf(outcome.character)
        if (index === -1) {
            clearIfPending(request)
            return false
        }
        // The call that made the install formats it, whether or not this request goes on to open. A request that
        // joined another caller's restore does not format here: `changeChar` and the send's member restore each
        // format for every call they serve.
        if (outcome.installedHere) characterFormatUpdate(index)
        if (!isCurrentRequest(request) || changeCharGeneration() !== request.generation) {
            clearIfPending(request)
            return false
        }
        const loaded = DBState.db.characters[index]
        // The availability and coldstorage clauses are defence in depth: `openStudioFromHome` checks both again.
        if (get(selectedCharID) !== -1 || get(settingsOpen) || !homeStudioAvailable(loaded) || loaded.coldstorage) {
            clearIfPending(request)
            return false
        }
        pending = null
        return openStudioFromHome(index, opener)
    } catch (error) {
        console.error('Open in Studio could not load the character:', error)
        recordCaughtError('home.studio', error)
        if (isCurrentRequest(request) && changeCharGeneration() === request.generation) {
            alertError(language.errors.coldStorageRestoreUnreadable)
        }
        clearIfPending(request)
        return false
    }
}

/**
 * Cancels the archived slot's open that is still loading, if any: it opens nothing. The load goes on: if it
 * lands, the character is installed, formatted and left unselected; if it is refused, the stub stays. Never
 * supersedes a `changeChar` and never touches the visit.
 */
export function cancelHomeStudioOpen(): void {
    pending?.releaseBack()
    pending = null
    seq++
}

/** Test-only: stops following Studio and forgets the visit. */
export function resetHomeStudioForTests(): void {
    cancelHomeStudioOpen()
    stopVisitEnd?.()
    stopVisitEnd = null
    homeVisit = null
}
