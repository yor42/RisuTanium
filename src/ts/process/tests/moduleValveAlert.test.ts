// @vitest-environment node
/**
 * The save loop's module valve against the real alert layer. The real `alert.ts`, `alertPrompts.ts`,
 * `repairModuleLorebook` and `moduleLoader.ts` run; a `Mutex` stands in for the page's write lock, a residency double
 * serves the unit read, and the store is the alert store the prompts watch. The cycle these cases guard: a pass holds the
 * write lock, a load asks the person about a corrupted lorebook, a restore-shaped task posts a notice the person cannot
 * close and then waits for the lock, so the question is covered and the lock never frees.
 *
 * Each case builds a fresh module graph, because the repair's ask lock and the loader's loads are module-level and an
 * unanswered question keeps them held. Labels: reproducer (fails against the naive pass or the named mutant), guard
 * (passes before and after).
 */
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    state: { db: undefined } as { db: unknown },
}))

vi.mock(import('src/ts/stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
    DBState: h.state,
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((book: unknown) => book),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/process/modules'), () => ({
    refreshModules: vi.fn(),
    bumpModuleGui: vi.fn(),
}) as unknown as typeof import('src/ts/process/modules'))

import { language } from 'src/lang'
import type { JsonObject } from 'src/ts/storage/blockFrame'
import type { ModuleEntry } from 'src/ts/storage/store2/format'
import { moduleStubOf } from 'src/ts/storage/store2/moduleStubMatch'
import { isModuleStub } from 'src/ts/storage/moduleStub'
import type { Residency, ResidencyModuleRead } from 'src/ts/storage/store2/residency'
import type { RisuModule } from 'src/ts/process/modules'

type Plain = Record<string, unknown>

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

function corrupted(id: string): Plain {
    return { id, name: `Mod ${id}`, description: '', lorebook: { bad: true } }
}

function healthy(id: string): Plain {
    return { id, name: `Mod ${id}`, description: '', lorebook: [{ bookVersion: 2 }] }
}

/** A list whose entries are below book version 2: migrated at load without a question. */
function migrating(id: string): Plain {
    return { id, name: `Mod ${id}`, description: '', lorebook: [{ comment: 'c', content: 'x' }] }
}

function entryOf(body: Plain): ModuleEntry {
    const id = String(body.id)
    return { id, unit: [`unit-${id}`, 10, 1], al: [`al-${id}`, 5, 2, 1], il: null, name: String(body.name), description: '', hasToggle: false, dsp: false }
}

/** A fresh module graph with the real alert layer, the real loader and the page's pieces wired together. */
async function freshGraph() {
    vi.resetModules()
    const stores = await import('src/ts/stores.svelte')
    const alert = await import('src/ts/alert')
    const prompts = await import('src/ts/alertPrompts')
    const repair = await import('src/ts/process/moduleLorebookRepair')
    const loader = await import('src/ts/process/moduleLoader')
    const acquire = await import('src/ts/storage/store2/moduleAcquire')
    const residencyActive = await import('src/ts/storage/store2/residencyActive')
    const mutex = await import('src/ts/mutex')
    const exportModules = await import('src/ts/drive/exportModules')
    return { alert, prompts, repair, loader, acquire, residencyActive, stores, mutex, exportModules }
}

type Graph = Awaited<ReturnType<typeof freshGraph>>

interface Rig {
    g: Graph
    lock: InstanceType<Graph['mutex']['Mutex']>
    db: { modules: Plain[] }
    bodies: Map<string, Plain>
    reads: { count: number, gate: Promise<void> | null }
}

/** Every body becomes a stub of its recorded entry in the live list; the double reads the body back by handle. */
async function rigOf(bodies: Plain[]): Promise<Rig> {
    const g = await freshGraph()
    const entries = new Map<string, ModuleEntry>()
    const byId = new Map<string, Plain>()
    for (const body of bodies) {
        entries.set(`${String(body.id)}#0`, entryOf(body))
        byId.set(String(body.id), body)
    }
    const reads: Rig['reads'] = { count: 0, gate: null }
    const residency = {
        moduleEntryOf: (handle: string) => entries.get(handle) ?? null,
        async readModule(handle: string): Promise<ResidencyModuleRead> {
            reads.count += 1
            if (reads.gate !== null) {
                await reads.gate
            }
            const entry = entries.get(handle)
            const body = byId.get(handle.slice(0, handle.lastIndexOf('#')))
            if (entry === undefined || body === undefined) {
                return { status: 'error', reason: 'no-entry', error: new Error('no entry') }
            }
            for (let tick = 0; tick < 3; tick++) {
                await Promise.resolve()
            }
            return { status: 'ok', value: clone(body) as JsonObject, handle, entry, source: { get: () => undefined }, bytes: 1 }
        },
        hydrateModule: vi.fn(),
    } as unknown as Residency
    g.residencyActive.registerResidency(residency)
    g.acquire.registerModuleLoader(g.loader.loadModule)
    const db = { modules: bodies.map(body => moduleStubOf(entryOf(body)) as unknown as Plain) }
    h.state.db = db
    const rig: Rig = { g, lock: new g.mutex.Mutex(), db, bodies: byId, reads }
    rigs.push(rig)
    return rig
}

const rigs: Rig[] = []

function shown(rig: Rig): { type: string, msg: string } {
    return get(rig.g.stores.alertStore) as { type: string, msg: string }
}

/** The person: closes the corruption notice and answers the two questions (no report; `reset` for the reset). Stops once `done`. */
async function walkQuestion(rig: Rig, reset: boolean, done: () => boolean, ms = 4000): Promise<void> {
    const until = Date.now() + ms
    while (!done() && Date.now() < until) {
        await sleep(10)
        const now = shown(rig)
        if (now.type === 'error') {
            ;(rig.g.stores.alertStore as unknown as { set: (value: unknown) => void }).set({ type: 'none', msg: '' })
        } else if (now.type === 'ask') {
            rig.g.prompts.answerShownPrompt(reset && now.msg === language.bootstrap.resetLorebookQuestion ? 'yes' : 'no')
        }
    }
    if (!done()) {
        throw new Error('The question was not walked to its end.')
    }
}

interface PassState {
    done: boolean
    outcome: string
    settled?: Promise<void>
}

/** One save pass: it holds the lock for the whole of the valve call, as `planOf` does. `naive` asks under the lock. */
function startPass(rig: Rig, id: string, naive = false): PassState {
    const state: PassState = { done: false, outcome: '' }
    void (async () => {
        const release = await rig.lock.acquire()
        try {
            if (naive) {
                await rig.g.repair.repairModuleLorebook(clone(rig.bodies.get(id)) as unknown as RisuModule)
                state.outcome = 'saved'
            } else {
                const result = await rig.g.loader.loadModuleStubsOf(id)
                state.outcome = result.kind
                if (result.kind === 'deferred') {
                    state.settled = result.settled
                }
            }
        } catch (error) {
            state.outcome = `error:${String(error)}`
        } finally {
            release()
            state.done = true
        }
    })()
    return state
}

/** A restore: a notice the person cannot close, then the write lock, then the notice is cleared. */
function startRestore(rig: Rig): { done: boolean } {
    const state = { done: false }
    void (async () => {
        rig.g.alert.alertWait('Checking other tabs')
        const release = await rig.lock.acquire()
        release()
        rig.g.alert.alertClear()
        state.done = true
    })()
    return state
}

const isFull = (slot: unknown) => typeof slot === 'object' && slot !== null && !isModuleStub(slot)

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    // The store is shared by every graph of the file: an earlier case's prompt controller must stop watching it.
    for (const rig of rigs.splice(0)) {
        rig.g.prompts.resetAlertPromptsForTests()
        ;(rig.g.stores.alertStore as unknown as { set: (value: unknown) => void }).set({ type: 'none', msg: '' })
    }
    h.state.db = undefined
})

describe('the cycle exists when a pass asks under the lock (diagnostic)', () => {
    test('a naive pass that waits for the question while holding the lock, and a restore queued behind it, never finish', async () => {
        const rig = await rigOf([corrupted('m1')])
        const pass = startPass(rig, 'm1', true)
        await sleep(20)
        expect(shown(rig).type).toBe('error')
        const restore = startRestore(rig)
        await sleep(300)
        expect(shown(rig).type).toBe('wait')
        expect(pass.done).toBe(false)
        expect(restore.done).toBe(false)
        // The deadlock is broken from outside so no question of this graph is left open for the next case.
        rig.g.alert.alertClear()
        await walkQuestion(rig, false, () => pass.done && restore.done)
    })
})

describe('the valve never holds the write lock while a question is open', () => {
    test('a corrupted lorebook defers the pass; a restore queued behind it finishes, the question returns and the load completes', async () => {
        const rig = await rigOf([corrupted('m1')])
        const pass = startPass(rig, 'm1')
        const restore = startRestore(rig)
        await sleep(100)
        expect(pass.done).toBe(true)
        expect(pass.outcome).toBe('deferred')
        expect(restore.done).toBe(true)
        // The question is still reachable: the notice or a prompt is on screen again, or it is about to be.
        await walkQuestion(rig, true, () => isFull(rig.db.modules[0]))
        expect((rig.db.modules[0] as Plain).lorebook).toEqual([])
        expect(rig.reads.count).toBe(1)
        const next = startPass(rig, 'm1')
        await sleep(20)
        expect(next.outcome).toBe('loaded')
    })

    test('the reset question covered by a notice the person cannot close comes back once the cover is cleared', async () => {
        const rig = await rigOf([corrupted('m1')])
        const pass = startPass(rig, 'm1')
        await sleep(30)
        expect(pass.done).toBe(true)
        // The person closes the corruption notice; the report question is next.
        ;(rig.g.stores.alertStore as unknown as { set: (value: unknown) => void }).set({ type: 'none', msg: '' })
        await sleep(30)
        expect(shown(rig).type).toBe('ask')
        const restore = startRestore(rig)
        await sleep(100)
        expect(restore.done).toBe(true)
        expect(shown(rig).type).toBe('ask')
        await walkQuestion(rig, true, () => isFull(rig.db.modules[0]))
    })

    test('a valve call for a second corrupted module and one for a migration-only module are answered at once while another module\'s question holds the ask lock', async () => {
        const rig = await rigOf([corrupted('a'), corrupted('b'), migrating('c')])
        const loadingA = rig.g.acquire.acquireModule('a')
        await sleep(30)
        expect(shown(rig).type).toBe('error')
        const second = startPass(rig, 'b')
        const migrationOnly = startPass(rig, 'c')
        await sleep(60)
        expect(second.done).toBe(true)
        expect(second.outcome).toBe('deferred')
        expect(migrationOnly.done).toBe(true)
        expect(migrationOnly.outcome).toBe('loaded')
        expect(isFull(rig.db.modules[2])).toBe(true)
        // Both questions are asked in turn once the person walks them.
        await walkQuestion(rig, true, () => isFull(rig.db.modules[0]) && isFull(rig.db.modules[1]))
        await loadingA
    })

    test('a valve call that joins a load still reading is released the moment that load starts asking', async () => {
        const rig = await rigOf([corrupted('m1')])
        let release: () => void = () => {}
        rig.reads.gate = new Promise<void>((resolve) => { release = resolve })
        const loading = rig.g.acquire.acquireModule('m1')
        await sleep(10)
        const pass = startPass(rig, 'm1')
        await sleep(40)
        expect(pass.done).toBe(false)
        release()
        await sleep(60)
        expect(pass.done).toBe(true)
        expect(pass.outcome).toBe('deferred')
        expect(rig.reads.count).toBe(1)
        await walkQuestion(rig, false, () => !isModuleStub(rig.db.modules[0]))
        await loading
    })

    test('five more passes while the question is open start no second load and no second question, and the answer is kept', async () => {
        const rig = await rigOf([corrupted('m1')])
        const first = startPass(rig, 'm1')
        await sleep(40)
        expect(first.outcome).toBe('deferred')
        for (let call = 0; call < 5; call++) {
            const pass = startPass(rig, 'm1')
            await sleep(10)
            expect(pass.done).toBe(true)
            expect(pass.outcome).toBe('deferred')
        }
        expect(rig.reads.count).toBe(1)
        expect(shown(rig).type).toBe('error')
        await walkQuestion(rig, true, () => isFull(rig.db.modules[0]))
        await first.settled
        expect(rig.reads.count).toBe(1)
        const after = startPass(rig, 'm1')
        await sleep(20)
        expect(after.outcome).toBe('loaded')
        expect(rig.reads.count).toBe(1)
    })
})

describe('an export that waits for a module\'s question', () => {
    // Re-hosting, not a reproducer: the export snapshot reads a stub's stored copy and never loads it, so a lorebook that
    // needs repair raises no question; the row passed before on the loader and now pins the silent copy.
    test('re-hosting, not a reproducer: the snapshot of a stub whose lorebook needs repair asks nothing and exports the lorebook as stored', async () => {
        const rig = await rigOf([healthy('a'), corrupted('m1')])
        const snapshot = rig.g.exportModules.snapshotModuleList(rig.db as never)
        await sleep(40)
        expect(shown(rig).type).toBe('none')
        const result = await snapshot
        expect(shown(rig).type).toBe('none')
        expect(result.modules).toHaveLength(2)
        expect((result.modules?.[1] as unknown as Plain).lorebook).toEqual({ bad: true })
        expect(isModuleStub(rig.db.modules[1] as never)).toBe(true)
    })

    test('a cover the person can cancel, put up while the load is asking, hands the question back when it is cancelled', async () => {
        const rig = await rigOf([corrupted('m1')])
        const loading = rig.g.acquire.acquireModule('m1')
        await sleep(30)
        ;(rig.g.stores.alertStore as unknown as { set: (value: unknown) => void }).set({ type: 'none', msg: '' })
        await sleep(30)
        expect(shown(rig).type).toBe('ask')
        // The export's own notice offers Cancel; running it clears the notice.
        rig.g.alert.alertWait('Exporting', () => rig.g.alert.alertClear())
        expect(shown(rig).type).toBe('wait')
        ;(shown(rig) as unknown as { onCancel: () => void }).onCancel()
        await sleep(30)
        expect(shown(rig).type).toBe('ask')
        await walkQuestion(rig, true, () => isFull(rig.db.modules[0]))
        await loading
    })

    test('guard: a notice the person cannot close, held across an await of a load that asks, hides the question (callers must not hold one)', async () => {
        const rig = await rigOf([corrupted('m1')])
        rig.g.alert.alertWait('Preparing the export')
        const loading = rig.g.acquire.acquireModule('m1')
        await sleep(60)
        expect(shown(rig).type).toBe('error')
        rig.g.alert.alertWait('Preparing the export')
        await sleep(30)
        expect(shown(rig).type).toBe('wait')
        expect(isModuleStub(rig.db.modules[0])).toBe(true)
        rig.g.alert.alertClear()
        await walkQuestion(rig, false, () => !isModuleStub(rig.db.modules[0]))
        await loading
    })
})
