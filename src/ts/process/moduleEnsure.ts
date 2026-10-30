import { untrack } from 'svelte'
import { writable } from 'svelte/store'
import { acquireModule, ModuleLoadError } from '../storage/store2/moduleAcquire'
import { createRunSubject, createSendSubject, originOf, type Origin, type OriginHint } from './chatOrigin'
import { alertError } from '../alert'
import { getCurrentChat, getCurrentCharacter } from '../storage/database.svelte'
import type { RisuModule } from './modules'
import { hasModuleStubs, moduleListOf, moduleLoadFailedText, moduleRefIdsOf, unloadedModulesOf } from './moduleRefList'
import { holdModuleGuiBumps } from './moduleGuiBump'
import { isModuleStub } from '../storage/moduleStub'

// Brings in the bodies of the module stubs a run references. Nothing here may import process/modules at run time
// (see moduleRefList), and no closeless cover (a wait or progress notice without a cancel) may be held across an
// acquireModule await: a lorebook question can keep a load pending until the person answers.

/**
 * One or more referenced modules did not load. `names` holds every failing module, in reference order; `slots` holds
 * the failing slot objects in the same order, so a caller can remember which stub failed.
 */
export class ModuleEnsureError extends Error {
    constructor(public readonly names: string[], public readonly slots: readonly object[] = []) {
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
    const failedSlotObjects: object[] = []
    // Every exit releases the hold, so the installs are announced once before the caller continues and a throw never
    // leaves later bumps suppressed.
    const release = holdModuleGuiBumps()
    try {
        for(const slot of unloadedModulesOf(subject)){
            try {
                await acquireModule(slot.id, signal)
            } catch (error) {
                if(signal?.aborted){
                    throw signal.reason
                }
                names.push(slot.name)
                failedSlotObjects.push(slot)
            }
        }
    } finally {
        release()
    }
    if(names.length > 0){
        throw new ModuleEnsureError(names, failedSlotObjects)
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

/**
 * What one caller remembers about failed stubs. `key` is the origin the memory describes; `slots` holds the stub objects
 * that failed for it; `inFlight` is the settling check that owns the current load, if any.
 */
export interface ModuleFailureMemory {
    key: string
    slots: WeakSet<object>
    inFlight: Promise<boolean> | null
}

export function createModuleFailureMemory(): ModuleFailureMemory {
    return { key: '', slots: new WeakSet(), inFlight: null }
}

/**
 * Either a failure memory (no abort signal: a waiter must never inherit another caller's abort) or a plain wait with an
 * optional signal and alert switch. Each member declares the other's properties as `never`, so the compiler rejects a
 * call that passes a memory together with a signal or an alert; it would otherwise drop them silently.
 */
export type EnsureCurrentOptions =
    { memory: ModuleFailureMemory, signal?: never, alert?: never }
    | { memory?: never, signal?: AbortSignal, alert?: boolean }

/**
 * Waits for the stubs the selected character's current chat references, for callers that are not a send. True when
 * nothing was needed or every module loaded. A failure shows one combined alert (unless `alert` is false) and returns
 * false; an abort returns false silently. No stubs, no selection, a group owner or an id-less chat resolve true without
 * loading. Call sites guard with hasModuleStubs() first so that a database without stubs adds no await.
 *
 * With a memory, a check for a chat whose stub already failed returns false without a load attempt or an alert, and a
 * check that starts while another check for the same chat is still loading waits on it and shares its result, so only
 * the owner of a load can alert. Changing the character or chat clears the memory; a stub replaced by its loaded body
 * is no longer unloaded and is not remembered.
 */
export async function ensureCurrentModules(options: EnsureCurrentOptions = {}): Promise<boolean> {
    if(!hasModuleStubs()){
        return true
    }
    const character = getCurrentCharacter()
    const chat = getCurrentChat()
    if(!character || !chat || character.type === 'group'){
        return true
    }
    const origin = originOf(character, chat)
    if(!origin){
        return true
    }
    const hint: OriginHint = { owner: character, chat }
    if(options.memory){
        return ensureWithMemory(options.memory, origin, hint)
    }
    const signal = options.signal
    try {
        await ensureModulesForOrigin(origin, signal, hint)
        return true
    } catch (error) {
        if(error instanceof ModuleEnsureError){
            if(options.alert !== false){
                alertError(moduleLoadFailedText(error.names))
            }
            return false
        }
        if(signal?.aborted){
            return false
        }
        throw error
    }
}

/** The default call: alerts on a failure, silent on an abort. */
export function ensureCurrentModulesOrAlert(signal?: AbortSignal): Promise<boolean> {
    return ensureCurrentModules({ signal })
}

async function ensureWithMemory(memory: ModuleFailureMemory, origin: Origin, hint: OriginHint): Promise<boolean> {
    const key = origin.chaId + ':' + origin.chatId
    if(memory.key !== key){
        memory.key = key
        memory.slots = new WeakSet()
        memory.inFlight = null
    }
    const unloaded = unloadedModulesOf(createSendSubject(origin, hint))
    if(unloaded.length === 0){
        return true
    }
    if(unloaded.some((slot) => memory.slots.has(slot))){
        return false
    }
    if(memory.inFlight){
        return await memory.inFlight
    }
    // Failing slots go into the set this check saw when it started: a key reset while the load runs must not move them
    // into the new chat's memory.
    const slotsAtStart = memory.slots
    const own: Promise<boolean> = (async () => {
        try {
            await ensureModulesForOrigin(origin, undefined, hint)
            return true
        } catch (error) {
            if(error instanceof ModuleEnsureError){
                for(const slot of error.slots){
                    slotsAtStart.add(slot)
                }
                alertError(moduleLoadFailedText(error.names))
                return false
            }
            throw error
        }
    })()
    memory.inFlight = own
    try {
        return await own
    } finally {
        if(memory.inFlight === own){
            memory.inFlight = null
        }
    }
}

// A stub that failed to load, remembered by its slot object: the trigger does not restart it until the slot is
// replaced. A send's own ensure ignores this memory.
const failedSlots = new WeakMap<object, string>()
// Slots a trigger run owns, claimed before its first await so a re-run during a held load cannot start the queued
// ones in parallel.
const loadingSlots = new WeakSet<object>()
// Module ids claimed by background runs that have not finished, refcounted. An id stays here until the run's single
// coalesced bump has been sent, so the gap between the last install and that bump still reads as pending.
const activeIds = new Map<string, number>()

/** Set when a background run ends, so a derived that tracks it re-evaluates `selectedModulesPending` even when nothing was installed. */
export const moduleRunVersion = writable(0)

function claimActiveIds(slots: RisuModule[]): void {
    for(const slot of slots){
        activeIds.set(slot.id, (activeIds.get(slot.id) ?? 0) + 1)
    }
}

function releaseActiveIds(slots: RisuModule[]): void {
    for(const slot of slots){
        const left = (activeIds.get(slot.id) ?? 0) - 1
        if(left > 0){
            activeIds.set(slot.id, left)
        }
        else{
            activeIds.delete(slot.id)
        }
    }
}

/**
 * True while the selected origin's modules are not yet usable: a referenced stub that has not failed, or an id a
 * running background load still holds. A chat unrelated to every run and every stub reads false. Synchronous, so a
 * derived that calls it tracks the database reads it makes; it never throws and fails open on an error, because
 * rendering without a module is better than loading forever.
 */
export function selectedModulesPending(): boolean {
    try {
        if(!hasModuleStubs() && activeIds.size === 0){
            return false
        }
        return moduleListOf(moduleRefIdsOf()).some((row) => {
            if(activeIds.has(row.id)){
                return true
            }
            return isModuleStub(row) && failedSlots.get(row) !== row.id
        })
    } catch (error) {
        console.error(error)
        return false
    }
}

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
            claimActiveIds(slots)
            void loadSlotsInBackground(slots)
        })
    } catch (error) {
        console.error(error)
    }
}

async function loadSlotsInBackground(slots: RisuModule[]): Promise<void> {
    const names: string[] = []
    const release = holdModuleGuiBumps()
    try {
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
    } finally {
        // The coalesced bump goes out before the ids leave the active set, so a body never sees pending end first.
        release()
        releaseActiveIds(slots)
        moduleRunVersion.update((v) => v + 1)
    }
    if(names.length > 0){
        alertError(moduleLoadFailedText(names))
    }
}
