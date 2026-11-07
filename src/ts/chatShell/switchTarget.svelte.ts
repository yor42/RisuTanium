import { get } from 'svelte/store'
import { language } from 'src/lang'
import { alertNormal } from '../alert'
import { changeChar, type ChangeCharOutcome } from '../characters'
import { doingChat } from '../process/index.svelte'
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
 * The switch the chat shell is waiting on. Only an archived character takes
 * long enough to be pending; a failed restore stays here for the frame to
 * show instead of an alert.
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

/** True, after telling the user why, when a reply is being written: a character switch would orphan it. */
export function refuseSwitchWhileWriting(): boolean {
    if(!get(doingChat)){
        return false
    }
    alertNormal(language.chatShellSwitchRefusedWriting)
    return true
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
 * Switches to `entry`. Never shows an alert for a failed restore: that stays
 * pending as `failed`. A warm character or a group switches at once and
 * leaves nothing pending.
 */
export async function switchCharacter(entry: Entry): Promise<ChangeCharOutcome> {
    if(refuseSwitchWhileWriting()){
        return 'busy'
    }
    const index = resolveIndex(entry)
    if(index === -1){
        clearPending()
        return 'gone'
    }
    const slot = DBState.db.characters[index]
    if(!slot.coldstorage){
        clearPending()
        return slot.type === 'group' ? await changeChar(index) : await changeChar(index, { quiet: true })
    }

    clearPending()
    const mine = seq
    switchTarget.target = entry
    switchTarget.phase = 'loading'
    let initial = true
    const stop = selectedCharID.subscribe(() => {
        if(initial){
            initial = false
            return
        }
        // Any later selection change, ours included, ends this switch.
        if(mine === seq){
            clearPending()
        }
    })
    stopWatching = stop
    const outcome = await changeChar(index, { quiet: true })
    if(outcome === 'selected'){
        if(mine === seq){
            clearPending()
        }
        return outcome
    }
    if(mine !== seq){
        return outcome
    }
    if(outcome === 'busy'){
        clearPending()
        alertNormal(language.chatShellSwitchRefusedWriting)
    }
    else if(typeof outcome === 'object'){
        switchTarget.phase = 'failed'
        switchTarget.reason = outcome.failed
    }
    else{
        clearPending()
    }
    return outcome
}

/** Runs the failed switch again; nothing otherwise. */
export function retrySwitch(): Promise<ChangeCharOutcome> | undefined {
    const target = switchTarget.target
    if(switchTarget.phase !== 'failed' || !target){
        return undefined
    }
    return switchCharacter(target)
}

/** Gives up the pending switch. The selection never moved while it was pending. */
export function backToPrevious(): void {
    clearPending()
}
