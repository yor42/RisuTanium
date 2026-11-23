import { keyOfRef, type ModuleEntry } from 'src/ts/storage/store2/format'
import { acquireModule, ModuleAmbiguousError, ModuleLoadError } from 'src/ts/storage/store2/moduleAcquire'
import { sameEntryUnits, slotIsRecordedStub } from 'src/ts/storage/store2/moduleStubMatch'
import type { Residency, ResidencyModuleRead } from 'src/ts/storage/store2/residency'
import { getResidency } from 'src/ts/storage/store2/residencyActive'
import { isModuleStub } from 'src/ts/storage/moduleStub'
import type { RisuModule } from 'src/ts/process/modules'
import { DBState } from 'src/ts/stores.svelte'
import { noteStoredRetained } from '../moduleStubWrite'

/**
 * The module list a plugin's `getDatabase` copies when some slots are module stubs.
 *
 * A read pass reads the stored body of each stub into a private copy without installing anything, so the live list, the
 * GUI and the save see no change. The caller then takes its copy in one synchronous step (`modulesCopyAt`) that checks
 * every stub slot against the entry its body was read from.
 *
 * Invariants:
 *  - At most one pass runs. A call that wants modules while a pass runs joins it, so a stub is read at most once for
 *    all the overlapping calls (twice for a stub that needs the question: the loader reads it again).
 *  - The bodies of a pass live until every caller of the pass has taken its copy or failed, and are dropped then, or at
 *    once when the pass rejects. Nothing is kept between passes.
 *  - A body is the stored module as it is read, migrated on the private copy; a corrupted lorebook that needs the
 *    person's answer goes through the loader's single flight instead, which installs the answered module.
 *  - The copy of a caller is made in one task with no await after its first slot is read, so it is the live list at
 *    that moment; a caller never shares an object with another caller's copy, the live list or the pass.
 */

interface StubBody {
    entry: ModuleEntry
    body: RisuModule
}

/** One pass: the bodies it read, the calls that joined it, and the settled read. */
export interface StubPass {
    residency: Residency | null
    bodies: Map<string, StubBody>
    callers: number
    unreleased: number
    done: Promise<void>
}

/** What a caller holds after its pass: the bodies to copy from, and the release of its share of them. */
export interface StubBodies {
    readonly pass: StubPass
    release(): void
}

type ReadOk = Extract<ResidencyModuleRead, { status: 'ok' }>

let pass: StubPass | null = null

function textOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/** The message a plugin sees for a module that could not be brought in. */
function couldNotLoad(id: string, name: string, reason: string): Error {
    return new Error(`The module "${name}" (${id}) could not be loaded: ${reason}`)
}

function liveSlots(): readonly RisuModule[] {
    const modules: readonly RisuModule[] | undefined = DBState.db?.modules
    return Array.isArray(modules) ? modules : []
}

/** The ids of the stubs in the live list, once each, in list order. */
function stubIdsOf(slots: readonly RisuModule[]): string[] {
    const ids = new Set<string>()
    for (const slot of slots) {
        if (isModuleStub(slot)) {
            ids.add(slot.id)
        }
    }
    return [...ids]
}

/** The module is a stub in the live list now, whatever else holds the id. */
function stubHolds(id: string): boolean {
    return liveSlots().some((slot) => slot.id === id && isModuleStub(slot))
}

/** The loader's own marker for a repaired body: its module unit must not be digested, so the next pass writes it. */
function withoutModuleUnit(read: ReadOk): ReadOk {
    const withheld = keyOfRef(read.entry.unit)
    return { ...read, source: { get: (key: string) => key === withheld ? undefined : read.source.get(key) } }
}

/** Brings the module in through the loader (which installs it and asks the person when it must) and lets go of it at once. */
async function loadThroughLoader(id: string): Promise<void> {
    const acquired = await acquireModule(id)
    if (acquired === null) {
        throw new Error('the module list has no module with that id.')
    }
    acquired.release()
}

async function readOne(current: StubPass, id: string, stub: RisuModule): Promise<void> {
    const residency = current.residency
    const handle = `${id}#0`
    const entry = residency === null ? null : residency.moduleEntryOf(handle)
    if (residency === null || entry === null || !slotIsRecordedStub(stub, entry)) {
        await loadThroughLoader(id)
        return
    }
    const read = await residency.readModule(handle)
    if (read.status === 'error') {
        throw new ModuleLoadError(read.reason, id, entry.name, read.error instanceof Error ? read.error.message : undefined)
    }
    const body = read.value as unknown as RisuModule
    noteStoredRetained(residency, id, read.entry, read.value)
    // A static import of the repair module would load the alert and character code into every importer of this file.
    const repair = await import('src/ts/process/moduleLorebookRepair')
    const need = repair.lorebookRepairNeed(body)
    if (need === 'ask') {
        await loadThroughLoader(id)
        return
    }
    const changed = need === 'migrate' && (await repair.repairModuleLorebook(body)).changed
    residency.hydrateModule(changed ? withoutModuleUnit(read) : read)
    current.bodies.set(id, { entry: read.entry, body })
}

async function runPass(current: StubPass): Promise<void> {
    let failed = true
    try {
        for (const id of stubIdsOf(liveSlots())) {
            const holders = liveSlots().filter((slot) => slot.id === id)
            const stub = holders.find((slot) => isModuleStub(slot))
            if (stub === undefined) {
                continue
            }
            // The loader resolves an id to its first holder, so another slot holding the id would be handed this stub's body.
            if (holders.length > 1) {
                throw new Error(new ModuleAmbiguousError(id, stub.name).message)
            }
            try {
                await readOne(current, id, stub)
            } catch (error) {
                // A module that is no longer a stub (loaded, or deleted) needs no body.
                if (stubHolds(id)) {
                    throw couldNotLoad(id, stub.name, textOf(error))
                }
            }
        }
        failed = false
    } finally {
        if (pass === current) {
            pass = null
        }
        if (failed) {
            current.bodies.clear()
        }
    }
}

function startPass(): StubPass {
    const current: StubPass = { residency: getResidency(), bodies: new Map(), callers: 0, unreleased: 0, done: Promise.resolve() }
    // The record exists before the first step runs, so a step that throws still clears it.
    pass = current
    current.done = runPass(current)
    return current
}

/** Reads the bodies of the live stubs, joining the pass already running when there is one. Rejects naming the module that failed. */
export async function readStubBodies(): Promise<StubBodies> {
    const joined = pass ?? startPass()
    joined.callers++
    joined.unreleased++
    await joined.done
    let released = false
    return {
        pass: joined,
        release() {
            if (released) {
                return
            }
            released = true
            joined.unreleased--
            if (joined.unreleased === 0) {
                joined.bodies.clear()
            }
        },
    }
}

/**
 * The copy of the module list at this moment: a snapshot of each slot that is not a stub, and for each stub the body the
 * pass read for it. Synchronous. A stub the pass cannot vouch for is refused by name: one that another stub shares its id
 * with, one with no body or whose entry or residency is no longer the one its body was read from, and one that was edited.
 */
export function modulesCopyAt(live: readonly RisuModule[] | undefined, bodies: StubBodies): RisuModule[] {
    const slots = live ?? []
    const stubCounts = new Map<string, number>()
    for (const slot of slots) {
        if (isModuleStub(slot)) {
            stubCounts.set(slot.id, (stubCounts.get(slot.id) ?? 0) + 1)
        }
    }
    const residency = getResidency()
    const copy: RisuModule[] = []
    for (const slot of slots) {
        if (!isModuleStub(slot)) {
            copy.push($state.snapshot(slot) as RisuModule)
            continue
        }
        const refuse = (reason: 'ambiguous' | 'stale' | 'edited') =>
            couldNotLoad(slot.id, slot.name, new ModuleLoadError(reason, slot.id, slot.name).message)
        if ((stubCounts.get(slot.id) ?? 0) > 1) {
            throw refuse('ambiguous')
        }
        const held = bodies.pass.bodies.get(slot.id)
        const entry = residency === null ? null : residency.moduleEntryOf(`${slot.id}#0`)
        if (held === undefined || residency === null || residency !== bodies.pass.residency || entry === null || !sameEntryUnits(entry, held.entry)) {
            throw refuse('stale')
        }
        if (!slotIsRecordedStub(slot, entry)) {
            throw refuse('edited')
        }
        copy.push(bodies.pass.callers > 1 ? structuredClone(held.body) : held.body)
    }
    return copy
}
