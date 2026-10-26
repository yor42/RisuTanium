// @vitest-environment node
/**
 * The install of a loaded module over a reactive `$state` database: what the list can do while the read is in flight
 * (delete, reorder, replace, edit, duplicate) and what the install must never do about it. The database is a real Svelte
 * proxy, so a slot read after the install is the proxy of the body, not the body. The read is held by a wrapped backend.
 * Titles starting `guard:` pass before and after the change; the others fail when the loader is missing or when the named
 * mutant is applied.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    state: { db: undefined } as { db: unknown },
}))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertMd: vi.fn(),
    waitAlert: vi.fn(async () => {}),
    alertConfirm: vi.fn(async () => false),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((book: unknown) => book),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: h.state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
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

import type { Database } from 'src/ts/storage/database.svelte'
import { isModuleStub } from 'src/ts/storage/moduleStub'
import { resetPageBlockOwnerForTests } from 'src/ts/storage/pageBlockOwner'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { createMemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { resetStore2BootForTest } from 'src/ts/storage/store2/bootActive'
import { IDENTITY, moduleHandles } from 'src/ts/storage/store2/codec'
import { ModuleLoadError, unregisterModuleLoader, acquireModule } from 'src/ts/storage/store2/moduleAcquire'
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
    stubIndex: number
    hold(): () => void
}

const holds: Array<() => void> = []

/**
 * Seeds `modules`, boots through the real dispatch, makes the booted database reactive and turns module `stubIndex` into
 * its recorded stub. `hold` pauses the unit read until the returned release is called.
 */
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
    const database = booted.result.database as unknown as { modules: Plain[] }
    database.modules[stubIndex] = moduleStubOf(entry) as unknown as Plain
    // Svelte's own proxy, taken from the runtime: a `$state()` that nothing in this scope mutates compiles to the plain object.
    const { proxy } = await import('svelte/internal/client')
    const live = proxy(database)
    h.state.db = live
    return {
        live, ids: index.entries.map(held => held.id), stubIndex,
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

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(() => null, (thrown: unknown) => thrown)
}

beforeEach(() => {
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
    h.state.db = undefined
})

describe('the installed module is the live slot of the reactive list', () => {
    test('acquireModule returns the proxy the list holds, not the decoded body', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b'), moduleBody('c')])
        const got = await acquireModule(world.ids[1])
        expect(got?.module).toBe(world.live.modules[1])
        expect(isModuleStub(world.live.modules[1])).toBe(false)
    })

    test('an edit made through the returned module is an edit of the list', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b'), moduleBody('c')])
        const got = await acquireModule(world.ids[1])
        if (got === null) {
            throw new Error('The module did not load.')
        }
        got.module.description = 'edited through the handle'
        expect(world.live.modules[1].description).toBe('edited through the handle')
    })

    test('guard: the other slots of the list are untouched', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b'), moduleBody('c')])
        const before = [world.live.modules[0], world.live.modules[2]]
        await acquireModule(world.ids[1])
        expect([world.live.modules[0], world.live.modules[2]]).toEqual(before)
        expect(world.live.modules).toHaveLength(3)
    })
})

describe('the list changes while the read is in flight', () => {
    test('a stub deleted during the load is not resurrected: the load resolves null and the list is unchanged', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b'), moduleBody('c')])
        const release = world.hold()
        const loading = acquireModule(world.ids[1])
        await sleep(10)
        world.live.modules.splice(1, 1)
        release()
        await expect(loading).resolves.toBeNull()
        expect(world.live.modules.map(slot => slot.id)).toEqual([world.ids[0], world.ids[2]])
        expect(world.live.modules.some(slot => isModuleStub(slot))).toBe(false)
    })

    test('a stub moved during the load is filled where it now is, and the slot it left is untouched', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b'), moduleBody('c')])
        const release = world.hold()
        const loading = acquireModule(world.ids[1])
        await sleep(10)
        const [stub] = world.live.modules.splice(1, 1)
        world.live.modules.push(stub)
        release()
        const got = await loading
        expect(world.live.modules.map(slot => slot.id)).toEqual([world.ids[0], world.ids[2], world.ids[1]])
        expect(got?.module).toBe(world.live.modules[2])
        expect(isModuleStub(world.live.modules[2])).toBe(false)
        expect(world.live.modules[1].name).toBe('c')
    })

    test('a stub replaced in place by a full module of the same id returns that module and overwrites nothing', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b'), moduleBody('c')])
        const release = world.hold()
        const loading = acquireModule(world.ids[1])
        await sleep(10)
        world.live.modules[1] = { ...moduleBody('b'), description: 'written by an import while loading' }
        release()
        const got = await loading
        expect(got?.module).toBe(world.live.modules[1])
        expect(world.live.modules[1].description).toBe('written by an import while loading')
    })

    test('a plugin that assigns a whole new list during the load keeps its write', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b'), moduleBody('c')])
        const release = world.hold()
        const loading = acquireModule(world.ids[1])
        await sleep(10)
        const written = { ...moduleBody('b'), description: 'plugin write' }
        world.live.modules = [world.live.modules[0], written, world.live.modules[2]]
        release()
        const got = await loading
        expect(got?.module).toBe(world.live.modules[1])
        expect(world.live.modules[1].description).toBe('plugin write')
    })

    test('an edited stub is never overwritten: the load fails with the reason edited', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b'), moduleBody('c')])
        const release = world.hold()
        const loading = failureOf(acquireModule(world.ids[1]))
        await sleep(10)
        world.live.modules[1].name = 'renamed while loading'
        release()
        const error = await loading
        expect(error).toBeInstanceOf(ModuleLoadError)
        expect((error as ModuleLoadError).reason).toBe('edited')
        expect(isModuleStub(world.live.modules[1])).toBe(true)
        expect(world.live.modules[1].name).toBe('renamed while loading')
    })

    test('a resident of the same id does not hide an edited stub of that id', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b'), moduleBody('c')])
        const release = world.hold()
        const loading = failureOf(acquireModule(world.ids[1]))
        await sleep(10)
        const stub = world.live.modules[1]
        stub.name = 'edited stub'
        world.live.modules[1] = { ...moduleBody('b'), description: 'resident' }
        world.live.modules.push(stub)
        release()
        const error = await loading
        expect(error).toBeInstanceOf(ModuleLoadError)
        expect((error as ModuleLoadError).reason).toBe('edited')
        expect(world.live.modules[1].description).toBe('resident')
    })

    test('a duplicate id created during the load does not stop the recorded stub from loading', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b'), moduleBody('c')])
        const release = world.hold()
        const loading = acquireModule(world.ids[1])
        await sleep(10)
        world.live.modules.push({ ...moduleBody('b'), description: 'a second module of the same id' })
        release()
        const got = await loading
        expect(got?.module).toBe(world.live.modules[1])
        expect(isModuleStub(world.live.modules[1])).toBe(false)
        expect(world.live.modules[3].description).toBe('a second module of the same id')
    })

    test('a stub deleted while another module holds its id is a replaced failure, never the other module', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b'), moduleBody('c'), moduleBody('d')])
        const release = world.hold()
        const loading = failureOf(acquireModule(world.ids[1]))
        await sleep(10)
        world.live.modules.splice(1, 1)
        world.live.modules.push({ ...moduleBody('b'), description: 'another module of the same id' })
        release()
        const error = await loading
        expect(error).toBeInstanceOf(ModuleLoadError)
        expect((error as ModuleLoadError).reason).toBe('replaced')
        expect(world.live.modules[world.live.modules.length - 1].description).toBe('another module of the same id')
    })
})

describe('the scan reads only what it must', () => {
    test('a slot of another id that no JSON copy can hold does not fail the load', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b'), moduleBody('c')])
        world.live.modules[2].unstorable = 10n
        const got = await acquireModule(world.ids[1])
        expect(got?.module).toBe(world.live.modules[1])
    })
})
