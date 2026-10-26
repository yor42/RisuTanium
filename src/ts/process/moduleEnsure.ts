import { untrack } from 'svelte'
import { acquireModule, ModuleLoadError } from '../storage/store2/moduleAcquire'
import { createRunSubject, createSendSubject, type Origin, type OriginHint } from './chatOrigin'
import { alertError } from '../alert'
import type { RisuModule } from './modules'
import { hasModuleStubs, moduleLoadFailedText, unloadedModulesOf } from './moduleRefList'

// Brings in the bodies of the module stubs a run references. Nothing here may import process/modules at run time
// (see moduleRefList), and no closeless cover (a wait or progress notice without a cancel) may be held across an
// acquireModule await: a lorebook question can keep a load pending until the person answers.

/** One or more referenced modules did not load. `names` holds every failing module, in reference order. */
export class ModuleEnsureError extends Error {
    constructor(public readonly names: string[]) {
        super(names.join(', '))
        this.name = 'ModuleEnsureError'
    }
}

/**
 * Loads, one at a time, every stub the origin's run would read. With the caller's hint the run is resolved as the send
 * resolves it, so a duplicated id names the same holder here as in the producers and the exit net. Resolves when none
 * is left. A module deleted meanwhile is not a failure. An abort rethrows the signal's reason; any other failure is
 * collected and thrown once as a ModuleEnsureError naming all of them. It ignores the trigger's failure memory, so a
 * send retries.
 */
export async function ensureModulesForOrigin(origin: Origin, signal?: AbortSignal, hint?: OriginHint): Promise<void> {
    if(!hasModuleStubs()){
        return
    }
    const subject = hint ? createSendSubject(origin, hint) : createRunSubject(origin)
    const names: string[] = []
    for(const slot of unloadedModulesOf(subject)){
        try {
            await acquireModule(slot.id, signal)
        } catch (error) {
            if(signal?.aborted){
                throw signal.reason
            }
            names.push(slot.name)
        }
    }
    if(names.length > 0){
        throw new ModuleEnsureError(names)
    }
}

/**
 * True when nothing was needed or every module loaded. A failure shows one combined alert and returns false; an abort
 * returns false silently. Call sites guard with hasModuleStubs() first so that a database without stubs adds no await.
 */
export async function ensureModulesOrAlert(origin: Origin, signal?: AbortSignal, hint?: OriginHint): Promise<boolean> {
    try {
        await ensureModulesForOrigin(origin, signal, hint)
        return true
    } catch (error) {
        if(error instanceof ModuleEnsureError){
            alertError(moduleLoadFailedText(error.names))
            return false
        }
        if(signal?.aborted){
            return false
        }
        throw error
    }
}

// A stub that failed to load, remembered by its slot object: the trigger does not restart it until the slot is
// replaced. A send's own ensure ignores this memory.
const failedSlots = new WeakMap<object, string>()
// Slots a trigger run owns, claimed before its first await so a re-run during a held load cannot start the queued
// ones in parallel.
const loadingSlots = new WeakSet<object>()

/**
 * The reactive load trigger, called from the module effect. Inert until boot has finished (`ready`); the effect
 * re-runs when it flips. Loads the selected origin's referenced stubs in the background; a display pass never waits.
 * One alert per run names every failing module; a stub the saver reports as edited stays silent here.
 */
export function ensureSelectedModules(ready: boolean): void {
    if(!ready){
        return
    }
    // The effect that calls this must keep running after any failure here, so the synchronous part never throws.
    try {
        untrack(() => {
            if(!hasModuleStubs()){
                return
            }
            const slots = unloadedModulesOf().filter((slot) => failedSlots.get(slot) !== slot.id && !loadingSlots.has(slot))
            if(slots.length === 0){
                return
            }
            for(const slot of slots){
                loadingSlots.add(slot)
            }
            void loadSlotsInBackground(slots)
        })
    } catch (error) {
        console.error(error)
    }
}

async function loadSlotsInBackground(slots: RisuModule[]): Promise<void> {
    const names: string[] = []
    for(const slot of slots){
        try {
            await acquireModule(slot.id)
        } catch (error) {
            failedSlots.set(slot, slot.id)
            if(!(error instanceof ModuleLoadError && error.reason === 'edited')){
                names.push(slot.name)
            }
        } finally {
            loadingSlots.delete(slot)
        }
    }
    if(names.length > 0){
        alertError(moduleLoadFailedText(names))
    }
}
