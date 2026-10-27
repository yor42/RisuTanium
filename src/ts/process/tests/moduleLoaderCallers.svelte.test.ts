/**
 * The callers of `acquireModule` on the real loader: the module list rows (`useModuleById`), the risuaccess tools, and
 * the export's module snapshot. The page is booted through the real dispatch over a memory backend, the database is a
 * reactive `$state` list, chosen modules are turned into their recorded stubs, and the unit read can be held so the list
 * changes while a load is in flight. What these cases pin: the module a caller gets is the live slot of the list (a write
 * through it lands in the list), a stub deleted during its load while another module holds its id fails every editor and
 * tool caller with the loader's `replaced` error and never hands out the other module, and the export snapshot, which
 * reads a stub's stored body as a copy and installs nothing, leaves the slot a stub and ends `changed` only when a save
 * pass moved the entry.
 * Labels: reproducer (fails when the loader is missing or the named mutant is applied), guard (passes before and after).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    // Modules the app's own effects read this store at import, so it is never undefined.
    state: { db: { characters: [], modules: [], enabledModules: [] } } as { db: unknown },
    alerts: [] as string[],
}))

vi.mock(import('katex'), () => ({}))
vi.mock(import('src/ts/lite'), () => ({}))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn((msg: string) => { h.alerts.push(msg) }),
    alertMd: vi.fn(),
    waitAlert: vi.fn(async () => {}),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((book: unknown) => book),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: h.state,
        selectedCharID: writable(-1),
        selIdState: { selId: 0 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        loadedStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: vi.fn(async () => ({
        read: async () => ({ bytes: null, version: null }),
        has: async () => false,
    })),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

vi.mock(import('src/ts/process/modules'), () => ({
    refreshModules: vi.fn(),
    bumpModuleGui: vi.fn(),
}) as unknown as typeof import('src/ts/process/modules'))

import { language } from 'src/lang'
import { ExportModuleUnreadableError, snapshotModuleList } from 'src/ts/drive/exportModules'
import { useModuleById } from 'src/ts/process/moduleUse'
import { ModuleHandler } from 'src/ts/process/mcp/risuaccess/modules'
import type { RPCToolCallTextContent } from 'src/ts/process/mcp/mcplib'
import type { Database } from 'src/ts/storage/database.svelte'
import { isModuleStub } from 'src/ts/storage/moduleStub'
import { resetPageBlockOwnerForTests } from 'src/ts/storage/pageBlockOwner'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { createMemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { resetStore2BootForTest } from 'src/ts/storage/store2/bootActive'
import { IDENTITY, moduleHandles } from 'src/ts/storage/store2/codec'
import { ModuleLoadError, unregisterModuleLoader } from 'src/ts/storage/store2/moduleAcquire'
import { moduleStubOf } from 'src/ts/storage/store2/moduleStubMatch'
import { getResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { getActiveStore2Save, resetStore2SaveForTest } from 'src/ts/storage/store2/saveActive'
import { bootThroughDispatch, createClock, seedTree, testEnv } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall, fakeLists, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'

type Plain = Record<string, unknown>

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function moduleBody(name: string, extra: Plain = {}): Obj {
    return {
        id: `id-${name}`, name, description: `about ${name}`, regex: [], trigger: [], assets: [],
        lorebook: [{ comment: 'c', content: 'text', key: 'k', alwaysActive: false, secondkey: '', selective: false, insertorder: 100, mode: 'normal', bookVersion: 2 }],
        ...extra,
    }
}

interface World {
    /** The live database: a `$state` proxy. */
    live: { modules: Plain[] }
    ids: string[]
    hold(): () => void
}

const holds: Array<() => void> = []

async function bootWorld(modules: Obj[], stubIndex = 1): Promise<World> {
    const memory = createMemoryBackend()
    const source = { ...(buildSmall(2) as unknown as Obj), archiveCharacters: false, modules } as unknown as Database
    await seedTree(memory, JSON.parse(JSON.stringify(source)) as Database, testEnv(createClock(), 4242), fakeLists)
    const gate = { hold: null as Promise<void> | null }
    const backend: Store2Backend = {
        ...memory,
        readUnits: async (keys) => {
            if (gate.hold !== null) {
                await gate.hold
            }
            return memory.readUnits(keys)
        },
    }
    const booted = await bootThroughDispatch(backend)
    if (booted.result.kind !== 'store2') {
        throw new Error(`The boot answered ${booted.result.kind}.`)
    }
    const context = getActiveStore2Save()
    const residency = getResidency()
    const index = context?.encoder?.acknowledged().objects?.moduleIndex
    if (context?.encoder === undefined || residency === null || index === undefined) {
        throw new Error('The boot registered no residency.')
    }
    const handles = moduleHandles(index.entries)
    const entry = residency.moduleEntryOf(handles[stubIndex])
    if (entry === null) {
        throw new Error('No entry for the module.')
    }
    for (const prefix of [IDENTITY.module, IDENTITY.alModule, IDENTITY.ilModule]) {
        const unit = context.encoder.acknowledged().units.get(`${prefix}${handles[stubIndex]}`)
        if (unit !== undefined) {
            delete unit.digest
        }
    }
    const database = booted.result.database as unknown as { modules: Plain[], enabledModules: string[] }
    database.modules[stubIndex] = moduleStubOf(entry) as unknown as Plain
    database.enabledModules = []
    // Svelte's own proxy, taken from the runtime: a `$state()` that nothing in this scope mutates compiles to the plain object.
    const { proxy } = await import('svelte/internal/client')
    const live = proxy(database)
    h.state.db = live
    return {
        live, ids: index.entries.map(held => held.id),
        hold() {
            let release: () => void = () => {}
            gate.hold = new Promise<void>((resolve) => { release = resolve })
            const free = () => {
                gate.hold = null
                release()
            }
            holds.push(free)
            return free
        },
    }
}

const text = (responses: unknown): string => ((responses as RPCToolCallTextContent[])[0]).text

/** One module-flagged save pass through the active save context, committed and acknowledged. */
async function savePass(db: Database): Promise<void> {
    const active = getActiveStore2Save()
    if (active?.encoder === undefined) {
        throw new Error('No save context.')
    }
    const plan = await active.encoder.plan(db, { marked: new Set(), modules: true, whole: true })
    const result = await active.session.committer.commit(await active.session.committer.readCommit(), plan.commitRequest())
    if (result.status !== 'committed') {
        throw new Error(`The pass came to ${result.status}.`)
    }
    plan.acknowledge()
}

beforeEach(() => {
    h.alerts.length = 0
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    for (const release of holds.splice(0)) {
        release()
    }
    unregisterModuleLoader()
    resetStore2SaveForTest()
    resetResidencyForTest()
    resetStore2BootForTest()
    resetPageBlockOwnerForTests()
    resetPageStorageModeForTests()
    h.state.db = { characters: [], modules: [], enabledModules: [] }
})

describe('a caller gets the live slot of the list', () => {
    test('a module row is loaded and the module is the slot the list now holds', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b'), moduleBody('c')])
        const usable = await useModuleById(world.ids[1], 'b')
        expect(usable?.module).toBe(world.live.modules[1])
        expect(isModuleStub(world.live.modules[1])).toBe(false)
        expect(h.alerts).toEqual([])
    })

    test('a risuaccess write lands in the list slot, and a read sees the stored body', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b'), moduleBody('c')])
        const handler = new ModuleHandler()
        expect(JSON.parse(text(await handler.getModuleInfo(world.ids[1], ['name', 'description'])))).toEqual({ name: 'b', description: 'about b' })
        expect(text(await handler.setModuleInfo(world.ids[1], { description: 'rewritten by a tool' }))).toContain('Successfully updated')
        expect(world.live.modules[1].description).toBe('rewritten by a tool')
    })

    test('an export snapshot holds a copy of the stored body that is not the slot, and the slot stays the stub', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b'), moduleBody('c')])
        const stub = world.live.modules[1]
        const snapshot = await snapshotModuleList(world.live as unknown as Database)
        expect(snapshot.modules).toHaveLength(3)
        expect(snapshot.modules?.[1]).not.toBe(stub)
        expect(isModuleStub(snapshot.modules?.[1])).toBe(false)
        expect(snapshot.modules?.[1].description).toBe('about b')
        expect(world.live.modules[1]).toBe(stub)
        expect(isModuleStub(world.live.modules[1])).toBe(true)
    })
})

describe('a stub deleted during its load while another module holds its id fails every caller', () => {
    async function replacedDuringLoad(): Promise<{ world: World, release: () => void }> {
        const world = await bootWorld([moduleBody('a'), moduleBody('b'), moduleBody('c'), moduleBody('d')])
        const release = world.hold()
        return { world, release }
    }

    function swapStubForOtherHolder(world: World): void {
        world.live.modules.splice(1, 1)
        world.live.modules.push({ ...moduleBody('b'), description: 'another module of the same id' })
    }

    test('the module list row stops with the module load failure and leaves the other module alone', async () => {
        const { world, release } = await replacedDuringLoad()
        const loading = useModuleById(world.ids[1], 'b')
        await sleep(10)
        swapStubForOtherHolder(world)
        release()
        expect(await loading).toBeNull()
        expect(h.alerts).toEqual([language.moduleLoadFailed('b')])
        expect(world.live.modules[world.live.modules.length - 1].description).toBe('another module of the same id')
    })

    test('the risuaccess tool answers with the loader\'s reason as error text and changes nothing', async () => {
        const { world, release } = await replacedDuringLoad()
        const handler = new ModuleHandler()
        const loading = handler.setModuleInfo(world.ids[1], { description: 'must not land' })
        await sleep(10)
        swapStubForOtherHolder(world)
        release()
        const answer = text(await loading)
        expect(answer.startsWith('Error:')).toBe(true)
        expect(answer).toContain('replaced')
        expect(world.live.modules[world.live.modules.length - 1].description).toBe('another module of the same id')
    })

})

// The export snapshot never installs a module, so the loader's `replaced` failure cannot reach it; the two rows above
// keep `replaced` for the editor and tool paths. What the snapshot does with the same swap is pinned here.
describe('a stub deleted while the export snapshot reads it, another module holding its id', () => {
    function swapStubForOtherHolder(world: World): void {
        world.live.modules.splice(1, 1)
        world.live.modules.push({ ...moduleBody('b'), description: 'another module of the same id' })
    }

    test('without a save pass the snapshot is the list at the call: the stub\'s stored body is exported and the other holder is not mixed in', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b'), moduleBody('c'), moduleBody('d')])
        const release = world.hold()
        const loading = snapshotModuleList(world.live as unknown as Database)
        await sleep(10)
        swapStubForOtherHolder(world)
        release()
        const snapshot = await loading
        expect(snapshot.modules?.map(slot => slot.description)).toEqual(['about a', 'about b', 'about c', 'about d'])
    })

    test('with the delete saved before the read ends, the snapshot stops as changed and names the module', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b'), moduleBody('c'), moduleBody('d')])
        const release = world.hold()
        const loading = snapshotModuleList(world.live as unknown as Database).then(() => null, (thrown: unknown) => thrown)
        await sleep(10)
        world.live.modules.splice(1, 1)
        await savePass(world.live as unknown as Database)
        release()
        const error = await loading
        expect(error).toBeInstanceOf(ExportModuleUnreadableError)
        expect((error as ExportModuleUnreadableError).reason).toBe('changed')
        expect((error as ExportModuleUnreadableError).cause).toBeInstanceOf(ModuleLoadError)
        expect(((error as ExportModuleUnreadableError).cause as ModuleLoadError).reason).toBe('stale')
        expect((error as ExportModuleUnreadableError).moduleName).toBe('b')
    })
})
