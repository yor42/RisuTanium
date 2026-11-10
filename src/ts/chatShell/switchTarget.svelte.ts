import { get } from 'svelte/store'
import { recordCaughtError } from '../caughtErrors'
import { changeChar, supersedeChangeChar, type ChangeCharOutcome } from '../characters'
import type { ColdRestoreFailure } from '../process/coldCharacterRestore'
import type { Database } from '../storage/database.svelte'
import { DBState, selectedCharID } from '../stores.svelte'

type Entry = Database['characters'][number]

export interface SwitchTargetState {
    /** The character being switched to while `phase` is not `idle`. */
    target: Entry | null
    phase: 'idle' | 'loading' | 'failed'
    /** Why the restore was refused while `phase` is `failed`. */
    reason: ColdRestoreFailure | null
}

/**
 * The switch the chat shell is waiting on. An archived character, or a Retry,
 * is pending while it runs; a failed restore or a thrown switch stays here for
 * the frame to show instead of an alert.
 */
export const switchTarget: SwitchTargetState = $state({ target: null, phase: 'idle', reason: null })

/** Counts the switches and clears; a switch whose number is no longer current may not touch the state. */
let seq = 0
let stopWatching: (() => void) | null = null

/** Ends any pending switch and stops watching the selection. Safe to call when idle. */
export function clearPending(): void {
    seq++
    stopWatching?.()
    stopWatching = null
    switchTarget.target = null
    switchTarget.phase = 'idle'
    switchTarget.reason = null
}

/**
 * The slot to switch to, resolved when the switch is requested: the entry's
 * own slot, else the sole holder of its `chaId`, else -1.
 */
function resolveIndex(entry: Entry): number {
    const characters = DBState.db.characters
    const own = characters.indexOf(entry)
    if(own !== -1){
        return own
    }
    let found = -1
    for(let i = 0; i < characters.length; i++){
        if(characters[i]?.chaId === entry.chaId){
            if(found !== -1){
                return -1
            }
            found = i
        }
    }
    return found
}

/**
 * Ends the switch on a selection move. A move to another character, or to
 * none, ends switch `mine` and supersedes its restore, so the restore cannot
 * select the target after the user has left. The restore's own landing reaches
 * here too; superseding then is inert because the call has already passed its
 * check. A re-index of the character selected at the start (same entry, new
 * slot) keeps the switch: the restore resolves its slot again when it lands.
 * The `mine === seq` check also covers a store that queues subscriber calls,
 * where an already unsubscribed watcher can still run.
 */
function watchSelection(mine: number, from: Entry | null): () => void {
    let initial = true
    return selectedCharID.subscribe((value) => {
        if(initial){
            initial = false
            return
        }
        if(mine === seq){
            if(from !== null && DBState.db.characters[value] === from){
                return
            }
            supersedeChangeChar()
            clearPending()
        }
    })
}

/**
 * Ends a switch whose `changeChar` threw. The error is logged and recorded and
 * never alerted: the switch is quiet. While `mine` is still current the switch
 * ends `failed`, like a refused restore, with the selection watcher kept. A
 * switch that was ended meanwhile, or whose selection moved before the throw
 * (`watching` is false only on the immediate path), resolves `superseded` and
 * touches no state. Every non-cold `changeChar` path throws before it writes
 * the selection, so an unmoved selection is the normal case.
 */
function settleThrown(mine: number, entry: Entry, from: Entry | null, watching: boolean, error: unknown): ChangeCharOutcome {
    console.error('Switch failed:', error)
    recordCaughtError('switch.pick', error)
    if(mine !== seq){
        return 'superseded'
    }
    if(!watching){
        if((DBState.db.characters[get(selectedCharID)] ?? null) !== from){
            return 'superseded'
        }
        stopWatching = watchSelection(mine, from)
    }
    switchTarget.target = entry
    switchTarget.phase = 'failed'
    switchTarget.reason = 'unreadable'
    return { failed: 'unreadable' }
}

/**
 * Switches to `entry`. Never shows an alert for a failed restore or a throw:
 * those stay pending as `failed`. A warm character or a group switches at once
 * and leaves nothing pending, unless it throws; a throw ends `failed`, like a
 * refused restore, when the selection has not moved. Never rejects.
 */
export function switchCharacter(entry: Entry): Promise<ChangeCharOutcome> {
    return runSwitch(entry, false)
}

/** The call for `slot`: a group takes the plain call, everything else the quiet one. */
function callFor(slot: Entry, index: number): Promise<ChangeCharOutcome> {
    return slot.type === 'group' && !slot.coldstorage ? changeChar(index) : changeChar(index, { quiet: true })
}

/**
 * `retrying` makes a warm slot take the pending path too, so a Retry keeps the
 * frame shown (`failed -> loading -> failed | idle`) instead of passing through
 * `idle`.
 */
async function runSwitch(entry: Entry, retrying: boolean): Promise<ChangeCharOutcome> {
    const index = resolveIndex(entry)
    if(index === -1){
        clearPending()
        return 'gone'
    }
    const slot = DBState.db.characters[index]
    if(!slot.coldstorage && !retrying){
        clearPending()
        const mine = seq
        // The character selected when the switch started, if any.
        const from = DBState.db.characters[get(selectedCharID)] ?? null
        try{
            return await callFor(slot, index)
        }
        catch(error){
            return settleThrown(mine, entry, from, false, error)
        }
    }

    clearPending()
    const mine = seq
    switchTarget.target = entry
    switchTarget.phase = 'loading'
    // The character selected when the switch started, if any.
    const from = DBState.db.characters[get(selectedCharID)] ?? null
    stopWatching = watchSelection(mine, from)
    let outcome: ChangeCharOutcome
    try{
        outcome = await callFor(slot, index)
    }
    catch(error){
        return settleThrown(mine, entry, from, true, error)
    }
    if(outcome === 'selected'){
        if(mine === seq){
            clearPending()
        }
        return outcome
    }
    if(mine !== seq){
        return outcome
    }
    if(typeof outcome === 'object'){
        switchTarget.phase = 'failed'
        switchTarget.reason = outcome.failed
    }
    else{
        clearPending()
    }
    return outcome
}

/** Runs the failed switch again, keeping the frame shown while it runs; nothing otherwise. */
export function retrySwitch(): Promise<ChangeCharOutcome> | undefined {
    const target = switchTarget.target
    if(switchTarget.phase !== 'failed' || !target){
        return undefined
    }
    return runSwitch(target, true)
}

/**
 * Drops a loading or failed switch for good: the restore still running is
 * superseded, so it cannot select the abandoned character when it lands.
 * Does nothing when idle.
 */
export function abandonPendingSwitch(): void {
    if(switchTarget.phase === 'idle'){
        return
    }
    supersedeChangeChar()
    clearPending()
}

/** Gives up the pending switch. The selection never moved while it was pending. */
export function backToPrevious(): void {
    clearPending()
}
