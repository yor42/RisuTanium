import { DBState } from '../stores.svelte'
import { AssetList, toAssetList } from '../storage/assetList'
import { isModuleStub } from '../storage/moduleStub'
import { keyOfRef, type ModuleEntry } from '../storage/store2/format'
import { ModuleLoadError } from '../storage/store2/moduleAcquire'
import { slotIsRecordedStub } from '../storage/store2/moduleStubMatch'
import type { Residency, ResidencyModuleRead } from '../storage/store2/residency'
import { getResidency } from '../storage/store2/residencyActive'
import type { ModuleStubLoad } from '../storage/store2/saveActive'
import { lorebookRepairNeed, repairModuleLorebook } from './moduleLorebookRepair'
import { bumpModuleGui, refreshModules, type RisuModule } from './modules'

/**
 * The module loader: brings a module stub's body in from the store and installs it into the stub's slot.
 *
 * One flight serves every request for a handle. A flight is owned by `flights`, never by a lock or by one caller: it
 * reads, repairs the lorebook (which may ask the person), installs, and ends. Nothing in it takes the page's write lock,
 * so a question that waits for the person can never hold the save loop's lock.
 *
 * Invariants:
 *  - The slot stays the stub for the whole load, so a module is never visible while a question about it is open.
 *  - The install is one synchronous task: the recorded-stub check, the slot write, the digest hydration and the refresh
 *    have no await between them, so nothing can change the list between the check and the write.
 *  - A flight ends in `finally` on every exit: its map entry is gone and `settled` has resolved. `settled` never rejects.
 */

type FlightPhase = 'reading' | 'asking' | 'installing'

interface CallerWaiter {
    detached: boolean
}

interface Flight {
    handle: string
    phase: FlightPhase
    /** Resolves at the moment the flight is about to ask the person; never resolves for a flight that does not ask. */
    asking: Promise<void>
    announceAsking: () => void
    done: Promise<RisuModule | null>
    /** Resolves when the flight has ended and left the map, whatever way it ended. */
    settled: Promise<void>
    finish: () => void
    callers: Set<CallerWaiter>
    /** Set by the save loop's valve and never cleared: the flight installs even when every caller has left. */
    valveInterest: boolean
}

const flights = new Map<string, Flight>()

function idOfHandle(handle: string): string {
    return handle.slice(0, handle.lastIndexOf('#'))
}

function sameEntryUnits(left: ModuleEntry, right: ModuleEntry): boolean {
    return JSON.stringify([left.unit, left.al, left.il]) === JSON.stringify([right.unit, right.al, right.il])
}

/** The list slots that hold a stub or a module of `id`: stubs by index, residents by index. */
function slotsOfId(id: string, entry: ModuleEntry | null): { recorded: number[], stubs: boolean, residents: number[], name: string } {
    const slots: readonly RisuModule[] = DBState.db.modules ?? []
    const found = { recorded: [] as number[], stubs: false, residents: [] as number[], name: entry?.name ?? id }
    for (let index = 0; index < slots.length; index++) {
        const slot = slots[index]
        if (typeof slot !== 'object' || slot === null || slot.id !== id) {
            continue
        }
        found.name = slot.name ?? found.name
        if (!isModuleStub(slot)) {
            found.residents.push(index)
            continue
        }
        found.stubs = true
        // A resident module is never copied: only a slot that is a stub of this id is compared with the recorded stub.
        if (entry !== null && slotIsRecordedStub(slot, entry)) {
            found.recorded.push(index)
        }
    }
    return found
}

async function runFlight(flight: Flight, residency: Residency): Promise<RisuModule | null> {
    try {
        return await loadInto(flight, residency)
    } finally {
        if (flights.get(flight.handle) === flight) {
            flights.delete(flight.handle)
        }
        flight.finish()
    }
}

function liveCallers(flight: Flight): boolean {
    for (const waiter of flight.callers) {
        if (!waiter.detached) {
            return true
        }
    }
    return false
}

async function loadInto(flight: Flight, residency: Residency): Promise<RisuModule | null> {
    const { handle } = flight
    const id = idOfHandle(handle)
    const entry = residency.moduleEntryOf(handle)
    if (entry === null) {
        throw new ModuleLoadError('no-entry', id, id)
    }
    const before = slotsOfId(id, entry)
    const startIndex = before.recorded[0] ?? -1
    // A stub of this id that is not the recorded one has been edited: refused before the body is read or a question is
    // asked, since the answer could never be installed.
    if (before.recorded.length === 0 && before.stubs) {
        throw new ModuleLoadError('edited', id, before.name)
    }
    // Two recorded copies of one id cannot be installed over either: refused before the body is read or a question is
    // asked. A copy that appears while the read or the question is pending is refused by the check after them.
    if (before.recorded.length > 1) {
        throw new ModuleLoadError('ambiguous', id, before.name)
    }

    const read = await residency.readModule(handle)
    if (read.status === 'error') {
        throw new ModuleLoadError(read.reason, id, entry.name, read.error instanceof Error ? read.error.message : undefined)
    }
    // assembleModule has checked the unit's shape; this is the boundary where a decoded body becomes a module.
    const body = read.value as unknown as RisuModule

    // Judged from the body alone and before any notice: a body that needs a question says so first, so a waiter on the
    // flight is released before the question exists.
    if (lorebookRepairNeed(body) === 'ask') {
        flight.phase = 'asking'
        flight.announceAsking()
    }
    const repair = await repairModuleLorebook(body)
    flight.phase = 'installing'

    // Abandoned: no caller is waiting and no save pass wants the answer. The flight leaves the map in this task, so a
    // later request starts a new one; the question, if there was one, comes again on the next load.
    if (!flight.valveInterest && !liveCallers(flight)) {
        flights.delete(handle)
        return null
    }

    const current = residency.moduleEntryOf(handle)
    if (current === null || !sameEntryUnits(current, entry)) {
        throw new ModuleLoadError('stale', id, entry.name)
    }
    const found = slotsOfId(id, current)
    if (found.recorded.length > 1) {
        throw new ModuleLoadError('ambiguous', id, found.name)
    }
    if (found.recorded.length === 0) {
        if (found.stubs) {
            // A stub of this id that is not the recorded one has been edited: it is never overwritten.
            throw new ModuleLoadError('edited', id, found.name)
        }
        // Limit: a stub deleted so that another module's slot shifts into its index reads the same as a replacement in
        // place, and then that module is returned. The copy loaded here is never installed over anything.
        if (startIndex >= 0 && found.residents.includes(startIndex)) {
            return DBState.db.modules[startIndex]
        }
        if (found.residents.length > 0) {
            throw new ModuleLoadError('replaced', id, found.name)
        }
        return null
    }

    const index = found.recorded[0]
    // Svelte's proxy leaves a value with a non-plain prototype unwrapped, so an AssetList keeps its tuples out of the
    // reactive graph only when it is in place before the slot write; a plain array written first is proxied deeply.
    // This mirrors the boot path's wrapModuleAssets. A body without assets gets no field.
    if (Array.isArray(body.assets) && !(body.assets instanceof AssetList)) {
        body.assets = toAssetList(body.assets)
    }
    DBState.db.modules[index] = body
    // A repaired body is deliberately left without its module unit's digest, so the next pass writes it; the lists are
    // untouched by the repair and keep theirs.
    residency.hydrateModule(repair.changed ? withoutModuleUnit(read) : read)
    refreshModules()
    bumpModuleGui()
    return DBState.db.modules[index]
}

function withoutModuleUnit(read: Extract<ResidencyModuleRead, { status: 'ok' }>): Extract<ResidencyModuleRead, { status: 'ok' }> {
    const withheld = keyOfRef(read.entry.unit)
    return { ...read, source: { get: (key: string) => key === withheld ? undefined : read.source.get(key) } }
}

function startFlight(handle: string): Flight {
    const residency = getResidency()
    const id = idOfHandle(handle)
    if (residency === null) {
        throw new ModuleLoadError('no-entry', id, id)
    }
    let announceAsking: () => void = () => {}
    const asking = new Promise<void>((resolve) => { announceAsking = resolve })
    let finish: () => void = () => {}
    const settled = new Promise<void>((resolve) => { finish = resolve })
    const flight: Flight = {
        handle, phase: 'reading', asking, announceAsking, settled, finish,
        done: Promise.resolve(null), callers: new Set(), valveInterest: false,
    }
    flights.set(handle, flight)
    flight.done = runFlight(flight, residency)
    // A failure is reported to whoever waits; a flight kept alive only by the valve has no waiter left, so it is logged.
    flight.done.catch((error) => {
        if (flight.valveInterest) {
            console.error(error)
        }
    })
    return flight
}

/**
 * The registered module loader: loads the body of the stub `handle` (`${id}#0`) and returns the live slot, or null when
 * the module is gone. Concurrent calls share one flight. An aborted caller is rejected with the signal's reason and
 * leaves the others waiting; the flight itself cannot be cancelled, so a flight nobody waits for is dropped before it installs.
 */
export async function loadModule(handle: string, signal?: AbortSignal): Promise<RisuModule | null> {
    signal?.throwIfAborted()
    const flight = flights.get(handle) ?? startFlight(handle)
    const waiter: CallerWaiter = { detached: false }
    flight.callers.add(waiter)
    if (signal === undefined) {
        return flight.done
    }
    return new Promise<RisuModule | null>((resolve, reject) => {
        const onAbort = () => {
            waiter.detached = true
            reject(signal.reason)
        }
        signal.addEventListener('abort', onAbort, { once: true })
        flight.done.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
    })
}

/**
 * The save loop's valve for a module stub the planner cannot carry. It runs under the page's write lock, so it never
 * waits for the person: a flight that is asking, or that starts asking while the valve waits, answers `deferred` with
 * the promise that settles when that flight ends. The valve sets interest on the flight, so the load it started is
 * installed with the person's answer even though the pass has already ended.
 *
 * `loaded` means no module stub holding `moduleId` is left in the live list, whatever the flight came to; a load that
 * failed is logged by the flight and leaves the stub, which the caller reports as the original refusal.
 */
export async function loadModuleStubsOf(moduleId: string): Promise<ModuleStubLoad> {
    const handle = `${moduleId}#0`
    const residency = getResidency()
    const entry = residency === null ? null : residency.moduleEntryOf(handle)
    let recorded = false
    try {
        // Exactly one live slot must be the recorded stub: with two, the load would be refused as ambiguous before any
        // question, so no flight is started and the caller reports the original refusal.
        recorded = entry !== null && slotsOfId(moduleId, entry).recorded.length === 1
    } catch (error) {
        console.error(error)
    }
    if (recorded) {
        const flight = flights.get(handle) ?? startFlight(handle)
        flight.valveInterest = true
        if (flight.phase === 'asking') {
            return { kind: 'deferred', settled: flight.settled }
        }
        const first = await Promise.race([
            flight.done.then(() => 'done' as const, () => 'done' as const),
            flight.asking.then(() => 'asking' as const),
        ])
        if (first === 'asking') {
            return { kind: 'deferred', settled: flight.settled }
        }
    }
    const left = (DBState.db.modules ?? []).some((slot) => isModuleStub(slot) && slot.id === moduleId)
    return left ? { kind: 'refused' } : { kind: 'loaded' }
}
