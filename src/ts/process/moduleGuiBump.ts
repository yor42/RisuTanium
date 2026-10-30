import { get } from 'svelte/store'
import { ReloadGUIPointer } from '../stores.svelte'

// A leaf on purpose: moduleEnsure imports it, so it must not import process/modules.

let openHolds = 0
let pendingBump = false

function setPointer(){
    ReloadGUIPointer.set(get(ReloadGUIPointer) + 1)
}

/**
 * The module screens and chat bodies reload on this pointer. While any hold is open the bump is only recorded, so a loop
 * of installs ends in one reload instead of one per install.
 */
export function bumpModuleGui(){
    if(openHolds > 0){
        pendingBump = true
        return
    }
    setPointer()
}

/**
 * Suppresses bumps until the returned release is called. A release that finds a recorded bump sets the pointer once,
 * even when another hold is still open, so a caller never continues before the installs it waited for are announced.
 * Releasing twice does nothing.
 */
export function holdModuleGuiBumps(): () => void {
    openHolds += 1
    let released = false
    return () => {
        if(released){
            return
        }
        released = true
        openHolds -= 1
        if(pendingBump){
            pendingBump = false
            setPointer()
        }
    }
}
