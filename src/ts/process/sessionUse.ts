/**
 * Whether the person has used the app since it started: a character was opened or a chat ran. Edits that open
 * no character are read from the save mark count against the baseline taken once the page is ready.
 * Plain module state; a page reload starts it over.
 */
import { flushSync } from 'svelte'
import { loadedStore, selectedCharID } from '../stores.svelte'
import { getSaveMarkCount } from '../globalApi.svelte'
import { inFlightKinds, subscribeInFlight } from './inFlightWork'
import type { SessionUse } from '../drive/reloadFirstPolicy'

let characterOpened = false
let chatSeen = false
let marksAtReady = 0
let stopTracking: (() => void) | null = null

/** Starts watching; calling it again while it runs does nothing. The returned function stops the watch. */
export function startSessionUseTracking(): () => void {
    if (stopTracking !== null) {
        return stopTracking
    }
    const stopSelection = selectedCharID.subscribe((value) => {
        if (value >= 0) {
            characterOpened = true
        }
    })
    // The baseline is read after the save loop's change effects have run once: each counts a mark on its first
    // run, and those marks belong to the ready page, not to the person. flushSync forces those first runs, so the
    // baseline does not depend on a Svelte batch happening to be pending at the flip. The read waits one
    // microtask past the store flip so the rest of the synchronous ready run has requested its marks too. No user
    // event can run before the microtask.
    let baselineTaken = false
    const stopLoaded = loadedStore.subscribe((loaded) => {
        if (loaded && !baselineTaken) {
            baselineTaken = true
            queueMicrotask(() => {
                flushSync()
                marksAtReady = getSaveMarkCount()
            })
        }
    })
    const stopFlight = subscribeInFlight(() => {
        if (inFlightKinds().includes('chat')) {
            chatSeen = true
        }
    })
    stopTracking = () => {
        stopSelection()
        stopLoaded()
        stopFlight()
        stopTracking = null
    }
    return stopTracking
}

/** Sets the mark count of the ready page directly; later marks above it count as use. */
export function noteReadyBaseline(marks: number): void {
    marksAtReady = marks
}

export function sessionUse(marksNow: number): SessionUse {
    return { characterOpened, chatSeen, marksNow, marksAtReady }
}

export function resetSessionUseForTest(): void {
    stopTracking?.()
    characterOpened = false
    chatSeen = false
    marksAtReady = 0
}
