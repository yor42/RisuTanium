// @vitest-environment node
/**
 * The module loader (`process/moduleLoader.ts`) over a real store2 boot: the tree is seeded in a memory backend, the real
 * dispatch opens it (which registers the residency and the module loader), the test then turns chosen module slots into
 * the stubs `moduleStubOf` mints, and every load goes through `acquireModule` or the save loop's valve entry. The backend
 * is wrapped so a test can hold or fail the unit read. Alerts are deferred promises the test answers; a mocked store says
 * nothing about a native backend. Titles starting `guard:` pass before and after the change; the others fail when the
 * loader is missing or when the named mutant is applied.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    events: [] as string[],
    waiting: [] as { kind: 'wait' | 'confirm', resolve: (value: boolean) => void }[],
    state: { db: undefined } as { db: unknown },
    refreshed: 0,
    bumped: 0,
    rejectConfirms: false,
}))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn((msg: string) => { h.events.push(`error:${msg}`) }),
    alertMd: vi.fn((msg: string) => { h.events.push(`md:${msg}`) }),
    waitAlert: vi.fn(() => new Promise<void>((resolve) => {
        h.events.push('wait')
        h.waiting.push({ kind: 'wait', resolve: () => resolve() })
    })),
    alertConfirm: vi.fn((msg: string) => {
        if (h.rejectConfirms) {
            return Promise.reject(new Error('the question could not be shown'))
        }
        return new Promise<boolean>((resolve) => {
            h.events.push(`confirm:${msg}`)
            h.waiting.push({ kind: 'confirm', resolve })
        })
    }),
}) as unknown as typeof import('src/ts/alert'))

const migrate = vi.hoisted(() => vi.fn((book: { bookVersion?: number, content: string }[]) => book.map((entry) => {
    if ((entry.bookVersion ?? 1) >= 2) {
        return entry
    }
    entry.bookVersion = 2
    return entry
})))

vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: migrate,
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
    refreshModules: vi.fn(() => { h.refreshed += 1 }),
    bumpModuleGui: vi.fn(() => { h.bumped += 1 }),
}) as unknown as typeof import('src/ts/process/modules'))

import { crc32 } from 'src/ts/storage/blockFrame'
import type { Database } from 'src/ts/storage/database.svelte'
import { isModuleStub } from 'src/ts/storage/moduleStub'
import { resetPageBlockOwnerForTests } from 'src/ts/storage/pageBlockOwner'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { createMemoryBackend, Store2BackendFailureError, type MemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { resetStore2BootForTest } from 'src/ts/storage/store2/bootActive'
import { IDENTITY, moduleHandles } from 'src/ts/storage/store2/codec'
import { keyOfRef, type ModuleEntry } from 'src/ts/storage/store2/format'
import {
    acquireModule, ModuleAcquireError, ModuleLoadError, ModuleLoaderMissingError, unregisterModuleLoader,
} from 'src/ts/storage/store2/moduleAcquire'
import { moduleStubOf } from 'src/ts/storage/store2/moduleStubMatch'
import { type Residency } from 'src/ts/storage/store2/residency'
import { getResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { getActiveStore2Save, resetStore2SaveForTest } from 'src/ts/storage/store2/saveActive'
import type { SaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import type { RisuModule } from 'src/ts/process/modules'
import { bootThroughDispatch, createClock, seedTree, testEnv } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall, fakeLists, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'

type Plain = Record<string, unknown>

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The save loop's valve exactly as the boot hands it to the loop. */
function loadModuleStubsOf(moduleId: string) {
    const valve = getActiveStore2Save()?.loadModuleStub
    if (valve === undefined) {
        throw new Error('The boot gave the save context no module valve.')
    }
    return valve(moduleId)
}

async function waitFor(condition: () => boolean, what: string, ms = 4000): Promise<void> {
    const until = Date.now() + ms
    while (!condition()) {
        if (Date.now() > until) {
            throw new Error(`Timed out waiting for ${what}.`)
        }
        await sleep(3)
    }
}

/** `pending`, `resolved` or `rejected` after a short real-time grace, without consuming the promise's outcome. */
async function stateOf(promise: Promise<unknown>, graceMs = 60): Promise<'pending' | 'resolved' | 'rejected'> {
    return Promise.race([
        promise.then(() => 'resolved' as const, () => 'rejected' as const),
        sleep(graceMs).then(() => 'pending' as const),
    ])
}

function lore(bookVersion?: number): Plain {
    return { comment: 'c', content: 'text', key: 'k', alwaysActive: false, secondkey: '', selective: false, insertorder: 100, mode: 'normal', bookVersion }
}

function moduleBody(name: string, extra: Plain = {}): Obj {
    return { id: `id-${name}`, name, description: `about ${name}`, lorebook: [lore(2)], regex: [], trigger: [], assets: [], ...extra }
}

interface Gate {
    /** While set, every unit read waits for it. */
    hold: Promise<void> | null
    /** While set, every unit read fails with it. */
    fail: Error | null
    reads: number
}

interface World {
    memory: MemoryBackend
    db: Database
    gate: Gate
    residency: Residency
    encoder: SaveEncoder
    handles: string[]
    ids: string[]
}

const worlds: World[] = []

function holdReads(world: World): () => void {
    let release: () => void = () => {}
    world.gate.hold = new Promise<void>((resolve) => { release = resolve })
    return () => {
        world.gate.hold = null
        release()
    }
}

/** Seeds and boots a tree holding `modules`; the database the boot hands back is the live database. */
async function bootWorld(modules: Obj[]): Promise<World> {
    const memory = createMemoryBackend()
    const source = { ...(buildSmall(2) as unknown as Obj), archiveCharacters: false, modules } as unknown as Database
    await seedTree(memory, JSON.parse(JSON.stringify(source)) as Database, testEnv(createClock(), 4242), fakeLists)
    const gate: Gate = { hold: null, fail: null, reads: 0 }
    const backend: Store2Backend = {
        ...memory,
        readUnits: async (keys) => {
            gate.reads += 1
            if (gate.fail !== null) {
                throw gate.fail
            }
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
    if (context?.encoder === undefined || residency === null) {
        throw new Error('The boot registered no residency.')
    }
    const index = context.encoder.acknowledged().objects?.moduleIndex
    if (index === undefined) {
        throw new Error('The boot holds no module index.')
    }
    h.state.db = booted.result.database
    gate.reads = 0
    const world: World = {
        memory, db: booted.result.database, gate, residency, encoder: context.encoder,
        handles: moduleHandles(index.entries), ids: index.entries.map(entry => entry.id),
    }
    worlds.push(world)
    return world
}

function slots(world: World): Plain[] {
    return world.db.modules as unknown as Plain[]
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

/** Turns module `index` into the stub of its recorded entry, with its units as a stub's are: no digest. */
function stubOut(world: World, index: number): ModuleEntry {
    const entry = world.residency.moduleEntryOf(world.handles[index])
    if (entry === null) {
        throw new Error('No entry for the module.')
    }
    for (const prefix of [IDENTITY.module, IDENTITY.alModule, IDENTITY.ilModule]) {
        const unit = world.encoder.acknowledged().units.get(`${prefix}${world.handles[index]}`)
        if (unit !== undefined) {
            delete unit.digest
        }
    }
    slots(world)[index] = moduleStubOf(entry) as unknown as Plain
    return entry
}

function digestOf(world: World, index: number, prefix: string): string | undefined {
    return world.encoder.acknowledged().units.get(`${prefix}${world.handles[index]}`)?.digest
}

function withHeader(bytes: Uint8Array, edit: (header: Uint8Array) => void): Uint8Array {
    const out = new Uint8Array(bytes)
    edit(out.subarray(0, 12))
    new DataView(out.buffer, out.byteOffset + 12, 4).setUint32(0, crc32(out.subarray(0, 12)), true)
    return out
}

/** Answers the oldest pending alert (a wait resolves, a confirm takes `answer`). */
async function answer(response = false): Promise<void> {
    await waitFor(() => h.waiting.length > 0, 'an alert to wait')
    h.waiting.shift()?.resolve(response)
    await sleep(0)
}

/** Walks the corrupted-lorebook question: the notice, no report, then `reset`. */
async function answerCorruptionQuestion(reset: boolean): Promise<void> {
    await answer(true)
    await answer(false)
    await answer(reset)
}

const holdsFullBody = (slot: unknown) => typeof slot === 'object' && slot !== null && !isModuleStub(slot)

beforeEach(() => {
    h.events.length = 0
    h.waiting.length = 0
    h.refreshed = 0
    h.bumped = 0
    h.rejectConfirms = false
    migrate.mockClear()
    // The repair logs the module it asks about; those lines are not what the cases look at.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    // A question left open must not keep the next test's flight waiting.
    for (const waiting of h.waiting.splice(0)) {
        waiting.resolve(false)
    }
    for (const world of worlds.splice(0)) {
        world.gate.hold = null
    }
    unregisterModuleLoader()
    resetStore2SaveForTest()
    resetResidencyForTest()
    resetStore2BootForTest()
    resetPageBlockOwnerForTests()
    resetPageStorageModeForTests()
    h.state.db = undefined
})

describe('the boot registers the loader and a load installs the stored body', () => {
    test('acquireModule on a stub installs the stored body into the slot and returns the live slot', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b', { cjs: 'return 1' }), moduleBody('c')])
        const original = clone(slots(world)[1])
        stubOut(world, 1)
        expect(isModuleStub(slots(world)[1])).toBe(true)
        const got = await acquireModule(world.ids[1])
        expect(got).not.toBeNull()
        expect(got?.module).toBe(slots(world)[1])
        expect(isModuleStub(slots(world)[1])).toBe(false)
        expect(clone(got?.module)).toEqual(original)
        expect(world.gate.reads).toBeGreaterThan(0)
    })

    test('the loader is registered by the boot: a stub never reaches ModuleLoaderMissingError', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b')])
        stubOut(world, 0)
        const outcome = await acquireModule(world.ids[0]).then(() => null, (error: unknown) => error)
        expect(outcome).toBeNull()
    })

    test('the module screens are told: the chat parser cache is cleared and the pointer is bumped once', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b')])
        stubOut(world, 1)
        await acquireModule(world.ids[1])
        expect(h.refreshed).toBe(1)
        expect(h.bumped).toBe(1)
    })

    test('an install gives the module unit and both lists their digests, so an unedited load costs no write', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b', { assets: [['asset-0', 'assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png', 'png']] })])
        stubOut(world, 1)
        expect(digestOf(world, 1, IDENTITY.module)).toBeUndefined()
        await acquireModule(world.ids[1])
        expect(digestOf(world, 1, IDENTITY.module)).toBeDefined()
        expect(digestOf(world, 1, IDENTITY.alModule)).toBeDefined()
    })

    test('guard: a resident module is returned as the live slot and no unit is read', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b')])
        const got = await acquireModule(world.ids[0])
        expect(got?.module).toBe(slots(world)[0])
        expect(world.gate.reads).toBe(0)
    })
})

describe('one load serves every request for a handle', () => {
    test('three acquires and a valve call share one read and one body', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b'), moduleBody('c')])
        stubOut(world, 1)
        stubOut(world, 2)
        await acquireModule(world.ids[2])
        const readsForOneLoad = world.gate.reads
        expect(readsForOneLoad).toBeGreaterThan(0)
        world.gate.reads = 0
        const release = holdReads(world)
        const pending = [acquireModule(world.ids[1]), acquireModule(world.ids[1]), acquireModule(world.ids[1])]
        const valve = loadModuleStubsOf(world.ids[1])
        await sleep(20)
        release()
        const results = await Promise.all(pending)
        expect(await valve).toEqual({ kind: 'loaded' })
        expect(world.gate.reads).toBe(readsForOneLoad)
        for (const result of results) {
            expect(result?.module).toBe(slots(world)[1])
        }
    })

    test('a corrupted lorebook is asked once for concurrent acquires', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('bad', { lorebook: { bad: true } })])
        stubOut(world, 1)
        const first = acquireModule(world.ids[1])
        const second = acquireModule(world.ids[1])
        await answerCorruptionQuestion(false)
        const [one, two] = await Promise.all([first, second])
        expect(one?.module).toBe(two?.module)
        expect(h.events.filter(event => event.startsWith('error:'))).toHaveLength(1)
    })
})

describe('the lorebook is repaired before the module is visible, and a repaired body is saved', () => {
    test('a corrupted lorebook is asked about while the slot is still the stub; a reset installs an empty list', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('bad', { lorebook: { bad: true } })])
        stubOut(world, 1)
        const loading = acquireModule(world.ids[1])
        await waitFor(() => h.waiting.length > 0, 'the question')
        expect(isModuleStub(slots(world)[1])).toBe(true)
        expect(h.refreshed).toBe(0)
        await answer(true)
        await answer(false)
        expect(isModuleStub(slots(world)[1])).toBe(true)
        await answer(true)
        const got = await loading
        expect(got?.module.lorebook).toEqual([])
        expect(holdsFullBody(slots(world)[1])).toBe(true)
    })

    test('a repaired body keeps no digest for its module unit, and its lists keep theirs', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('bad', { lorebook: { bad: true } })])
        stubOut(world, 1)
        const loading = acquireModule(world.ids[1])
        await answerCorruptionQuestion(true)
        await loading
        expect(digestOf(world, 1, IDENTITY.module)).toBeUndefined()
        expect(digestOf(world, 1, IDENTITY.alModule)).toBeDefined()
    })

    test('a person who keeps the corrupted lorebook gets the body as stored, hydrated like any unedited load', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('bad', { lorebook: { bad: true } })])
        stubOut(world, 1)
        const loading = acquireModule(world.ids[1])
        await answerCorruptionQuestion(false)
        const got = await loading
        expect(got?.module.lorebook).toEqual({ bad: true })
        expect(digestOf(world, 1, IDENTITY.module)).toBeDefined()
    })

    test('an entry below book version 2 is migrated without a question and the module unit is left to be written', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('old', { lorebook: [lore(undefined)] })])
        stubOut(world, 1)
        const got = await acquireModule(world.ids[1])
        expect(migrate).toHaveBeenCalledTimes(1)
        expect(h.events).toEqual([])
        expect(got?.module.lorebook?.[0].bookVersion).toBe(2)
        expect(digestOf(world, 1, IDENTITY.module)).toBeUndefined()
    })

    test('a current lorebook is neither migrated nor asked about', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b')])
        stubOut(world, 1)
        await acquireModule(world.ids[1])
        expect(migrate).not.toHaveBeenCalled()
        expect(h.events).toEqual([])
    })
})

describe('data the loader cannot read is never installed and never lost', () => {
    async function unreadable(edit: (world: World, key: string, original: Uint8Array) => void) {
        const world = await bootWorld([moduleBody('a'), moduleBody('b')])
        const entry = stubOut(world, 1)
        const key = keyOfRef(entry.unit)
        const original = world.memory.snapshot().get(key) as Uint8Array
        edit(world, key, original)
        const error = await acquireModule(world.ids[1]).then(() => null, (thrown: unknown) => thrown)
        return { world, error, key, original }
    }

    function expectLoadError(error: unknown, reason: string): void {
        expect(error).toBeInstanceOf(ModuleLoadError)
        expect(error).toBeInstanceOf(ModuleAcquireError)
        expect(error).not.toBeInstanceOf(ModuleLoaderMissingError)
        expect((error as ModuleLoadError).reason).toBe(reason)
        expect((error as ModuleLoadError).moduleId).toBe('id-b')
        expect((error as ModuleLoadError).message).toContain('id-b')
    }

    test('a module unit that is absent is damaged: the slot stays the stub', async () => {
        const { world, error } = await unreadable((current, key) => current.memory.poke(key, null))
        expectLoadError(error, 'damaged')
        expect(isModuleStub(slots(world)[1])).toBe(true)
    })

    test('a module unit that fails its check is damaged and the stored bytes are untouched', async () => {
        const { world, error, key, original } = await unreadable((current, key, bytes) => {
            const flipped = new Uint8Array(bytes)
            flipped[flipped.length - 1] ^= 0xff
            current.memory.poke(key, flipped)
        })
        expectLoadError(error, 'damaged')
        expect(isModuleStub(slots(world)[1])).toBe(true)
        expect(world.memory.snapshot().get(key)).not.toEqual(original)
    })

    test('a module unit a newer build wrote is too-new', async () => {
        const { world, error } = await unreadable((current, key, bytes) => current.memory.poke(key, withHeader(bytes, header => { header[4] = 9 })))
        expectLoadError(error, 'too-new')
        expect(isModuleStub(slots(world)[1])).toBe(true)
    })

    test('a failing store is unreadable, never damage', async () => {
        const { world, error } = await unreadable((current) => { current.gate.fail = new Store2BackendFailureError('the disk went away') })
        expectLoadError(error, 'unreadable')
        expect(isModuleStub(slots(world)[1])).toBe(true)
    })

    test('a stub whose handle the acknowledged encoding does not hold is no-entry', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b')])
        stubOut(world, 1)
        const index = world.encoder.acknowledged().objects?.moduleIndex
        if (index === undefined) {
            throw new Error('No module index.')
        }
        world.encoder.acknowledged().objects = { ...world.encoder.acknowledged().objects, moduleIndex: { ...index, entries: index.entries.filter(entry => entry.id !== world.ids[1]) } }
        const error = await acquireModule(world.ids[1]).then(() => null, (thrown: unknown) => thrown)
        expectLoadError(error, 'no-entry')
    })

    test('a damaged asset list is not a failure: the body loads, the list keeps no digest for the next pass to derive', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b', { assets: [['asset-0', 'assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png', 'png']] })])
        const entry = stubOut(world, 1)
        world.memory.poke(keyOfRef(entry.al), null)
        const got = await acquireModule(world.ids[1])
        expect(got?.module.name).toBe('b')
        expect(digestOf(world, 1, IDENTITY.module)).toBeDefined()
        expect(digestOf(world, 1, IDENTITY.alModule)).toBeUndefined()
    })

    test('the next pass still finds the stub after a failed load, and the load can be tried again', async () => {
        const { world, key, original } = await unreadable((current, unitKey) => current.memory.poke(unitKey, null))
        world.memory.poke(key, original)
        const got = await acquireModule(world.ids[1])
        expect(got?.module.name).toBe('b')
    })
})

describe('a caller can leave a load; the others and the load itself are unaffected', () => {
    test('an aborted caller is rejected with the signal reason before the read ends, and nothing is installed', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b')])
        stubOut(world, 1)
        const release = holdReads(world)
        const controller = new AbortController()
        const reason = new Error('the person left')
        const loading = acquireModule(world.ids[1], controller.signal)
        await sleep(10)
        controller.abort(reason)
        expect(await stateOf(loading)).toBe('rejected')
        await expect(loading).rejects.toBe(reason)
        release()
        await sleep(40)
        expect(isModuleStub(slots(world)[1])).toBe(true)
    })

    test('one caller aborting leaves the joiner loading', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b')])
        stubOut(world, 1)
        const release = holdReads(world)
        const controller = new AbortController()
        const leaving = acquireModule(world.ids[1], controller.signal)
        const staying = acquireModule(world.ids[1])
        await sleep(10)
        controller.abort(new Error('left'))
        await expect(leaving).rejects.toThrow('left')
        release()
        const got = await staying
        expect(got?.module).toBe(slots(world)[1])
        expect(isModuleStub(slots(world)[1])).toBe(false)
    })

    test('a load nobody waits for installs nothing, and a later request starts a new load that does', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b')])
        stubOut(world, 1)
        const release = holdReads(world)
        const controller = new AbortController()
        const loading = acquireModule(world.ids[1], controller.signal)
        await sleep(10)
        controller.abort(new Error('left'))
        await expect(loading).rejects.toThrow('left')
        release()
        await sleep(40)
        expect(isModuleStub(slots(world)[1])).toBe(true)
        const again = await acquireModule(world.ids[1])
        expect(again?.module).toBe(slots(world)[1])
        expect(isModuleStub(slots(world)[1])).toBe(false)
    })

    test('an already aborted signal rejects at once and starts no read', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b')])
        stubOut(world, 1)
        const controller = new AbortController()
        controller.abort(new Error('already'))
        await expect(acquireModule(world.ids[1], controller.signal)).rejects.toThrow('already')
        expect(world.gate.reads).toBe(0)
    })
})

describe('the save loop valve answers without ever waiting for the person', () => {
    test('a stub is loaded and the valve answers loaded', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b')])
        stubOut(world, 1)
        expect(await loadModuleStubsOf(world.ids[1])).toEqual({ kind: 'loaded' })
        expect(holdsFullBody(slots(world)[1])).toBe(true)
    })

    test('a module that holds no stub is loaded without a read', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b')])
        expect(await loadModuleStubsOf(world.ids[0])).toEqual({ kind: 'loaded' })
        expect(world.gate.reads).toBe(0)
    })

    test('a stub deleted during the read is success: no stub is left, nothing is resurrected', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b'), moduleBody('c')])
        stubOut(world, 1)
        const release = holdReads(world)
        const valve = loadModuleStubsOf(world.ids[1])
        await sleep(10)
        slots(world).splice(1, 1)
        release()
        expect(await valve).toEqual({ kind: 'loaded' })
        expect(slots(world).map(slot => slot.id)).toEqual([world.ids[0], world.ids[2]])
    })

    test('an edited stub of the id is never loaded: the valve answers refused without a read', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b')])
        stubOut(world, 1)
        slots(world)[1].name = 'renamed by someone'
        expect(await loadModuleStubsOf(world.ids[1])).toEqual({ kind: 'refused' })
        expect(world.gate.reads).toBe(0)
        expect(slots(world)[1].name).toBe('renamed by someone')
    })

    test('an edited stub behind a resident of the same id is refused after no load, and the resident is not touched', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b')])
        stubOut(world, 1)
        const stub = slots(world)[1]
        stub.name = 'edited stub'
        const resident = { ...moduleBody('b'), description: 'a resident of the same id' }
        slots(world)[1] = resident
        slots(world).push(stub)
        expect(await loadModuleStubsOf(world.ids[1])).toEqual({ kind: 'refused' })
        expect(world.gate.reads).toBe(0)
        expect(slots(world)[1]).toBe(resident)
    })

    test('two copies of the recorded stub of a module that needs the question are refused: no read, no question, no deferral', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('bad', { lorebook: { bad: true } })])
        stubOut(world, 1)
        slots(world).push(clone(slots(world)[1]))
        expect(await loadModuleStubsOf(world.ids[1])).toEqual({ kind: 'refused' })
        // A second call is refused the same way: nothing was started that could ask the person later.
        expect(await loadModuleStubsOf(world.ids[1])).toEqual({ kind: 'refused' })
        expect(world.gate.reads).toBe(0)
        expect(h.waiting).toHaveLength(0)
        expect(h.events.filter(event => event.startsWith('error:'))).toHaveLength(0)
        expect(slots(world).filter(isModuleStub)).toHaveLength(2)
    })

    test('a failed load is refused, so the pass reports its own refusal; the stub stays', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b')])
        const entry = stubOut(world, 1)
        world.memory.poke(keyOfRef(entry.unit), null)
        const failure = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            expect(await loadModuleStubsOf(world.ids[1])).toEqual({ kind: 'refused' })
        } finally {
            failure.mockRestore()
        }
        expect(isModuleStub(slots(world)[1])).toBe(true)
    })

    test('a corrupted lorebook defers the valve at once with no question wait, then the answer installs the module', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('bad', { lorebook: { bad: true } })])
        stubOut(world, 1)
        const outcome = await loadModuleStubsOf(world.ids[1])
        expect(outcome.kind).toBe('deferred')
        if (outcome.kind !== 'deferred') {
            return
        }
        expect(await stateOf(outcome.settled)).toBe('pending')
        expect(isModuleStub(slots(world)[1])).toBe(true)
        await answerCorruptionQuestion(true)
        await outcome.settled
        expect(holdsFullBody(slots(world)[1])).toBe(true)
        expect(await loadModuleStubsOf(world.ids[1])).toEqual({ kind: 'loaded' })
    })

    test('repeated valve calls while the question is open start no second load and no second question', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('bad', { lorebook: { bad: true } })])
        stubOut(world, 1)
        const first = await loadModuleStubsOf(world.ids[1])
        expect(first.kind).toBe('deferred')
        const readsAfterFirst = world.gate.reads
        for (let call = 0; call < 5; call++) {
            expect((await loadModuleStubsOf(world.ids[1])).kind).toBe('deferred')
        }
        expect(world.gate.reads).toBe(readsAfterFirst)
        expect(h.events.filter(event => event.startsWith('error:'))).toHaveLength(1)
        await answerCorruptionQuestion(false)
        if (first.kind === 'deferred') {
            await first.settled
        }
    })

    test('a valve that joined a question keeps the answer even though every caller left', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('bad', { lorebook: { bad: true } })])
        stubOut(world, 1)
        const controller = new AbortController()
        const caller = acquireModule(world.ids[1], controller.signal)
        await waitFor(() => h.waiting.length > 0, 'the question')
        const outcome = await loadModuleStubsOf(world.ids[1])
        expect(outcome.kind).toBe('deferred')
        controller.abort(new Error('left'))
        await expect(caller).rejects.toThrow('left')
        await answerCorruptionQuestion(true)
        if (outcome.kind === 'deferred') {
            await outcome.settled
        }
        expect(holdsFullBody(slots(world)[1])).toBe(true)
    })

    test('guard: without a valve the answer of a load nobody waits for is dropped, and the question returns on the next load', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('bad', { lorebook: { bad: true } })])
        stubOut(world, 1)
        const controller = new AbortController()
        const caller = acquireModule(world.ids[1], controller.signal)
        await waitFor(() => h.waiting.length > 0, 'the question')
        controller.abort(new Error('left'))
        await expect(caller).rejects.toThrow('left')
        await answerCorruptionQuestion(true)
        await sleep(40)
        expect(isModuleStub(slots(world)[1])).toBe(true)
        const again = acquireModule(world.ids[1])
        await answerCorruptionQuestion(true)
        expect(holdsFullBody((await again)?.module)).toBe(true)
    })

    test('a valve that joins a load still reading is released the moment it starts asking', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('bad', { lorebook: { bad: true } })])
        stubOut(world, 1)
        const release = holdReads(world)
        const caller = acquireModule(world.ids[1])
        const valve = loadModuleStubsOf(world.ids[1])
        await sleep(10)
        expect(await stateOf(valve)).toBe('pending')
        release()
        const outcome = await valve
        expect(outcome.kind).toBe('deferred')
        await answerCorruptionQuestion(true)
        await caller
    })

    test('a migration-only module loads under the valve while another module\'s question is open', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('bad', { lorebook: { bad: true } }), moduleBody('old', { lorebook: [lore(undefined)] })])
        stubOut(world, 1)
        stubOut(world, 2)
        const open = await loadModuleStubsOf(world.ids[1])
        expect(open.kind).toBe('deferred')
        expect(await loadModuleStubsOf(world.ids[2])).toEqual({ kind: 'loaded' })
        expect((await loadModuleStubsOf(world.ids[1])).kind).toBe('deferred')
        await answerCorruptionQuestion(false)
        if (open.kind === 'deferred') {
            await open.settled
        }
    })
})

describe('settled resolves whatever way the load ends', () => {
    test('an install that throws still resolves settled and clears the load', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('bad', { lorebook: { bad: true } })])
        stubOut(world, 1)
        const outcome = await loadModuleStubsOf(world.ids[1])
        expect(outcome.kind).toBe('deferred')
        if (outcome.kind !== 'deferred') {
            return
        }
        // A value no JSON copy can hold makes the recorded-stub check throw when the install scans the list.
        slots(world)[1].unstorable = 10n
        const failure = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            await answerCorruptionQuestion(true)
            expect(await stateOf(outcome.settled, 1000)).toBe('resolved')
        } finally {
            failure.mockRestore()
        }
        delete slots(world)[1].unstorable
        const reads = world.gate.reads
        const again = acquireModule(world.ids[1])
        await answerCorruptionQuestion(true)
        expect((await again)?.module.name).toBe('bad')
        expect(world.gate.reads).toBeGreaterThan(reads)
    })

    test('a repair that throws still resolves settled and clears the load', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('bad', { lorebook: { bad: true } })])
        stubOut(world, 1)
        const outcome = await loadModuleStubsOf(world.ids[1])
        expect(outcome.kind).toBe('deferred')
        if (outcome.kind !== 'deferred') {
            return
        }
        h.rejectConfirms = true
        const failure = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            await answer(true)
            expect(await stateOf(outcome.settled, 1000)).toBe('resolved')
        } finally {
            failure.mockRestore()
        }
        expect(isModuleStub(slots(world)[1])).toBe(true)
        h.rejectConfirms = false
        const again = acquireModule(world.ids[1])
        await answerCorruptionQuestion(true)
        expect(holdsFullBody((await again)?.module)).toBe(true)
    })
})

describe('the install is judged against the encoding at install time', () => {
    test('an acknowledged encoding replaced during the read discards the load as stale', async () => {
        const world = await bootWorld([moduleBody('a'), moduleBody('b')])
        const entry = stubOut(world, 1)
        const release = holdReads(world)
        const loading = acquireModule(world.ids[1]).then(() => null, (thrown: unknown) => thrown)
        await sleep(10)
        const acknowledged = world.encoder.acknowledged()
        const index = acknowledged.objects?.moduleIndex
        if (index === undefined) {
            throw new Error('No module index.')
        }
        const moved: ModuleEntry = { ...entry, unit: [entry.unit[0], entry.unit[1], entry.unit[2] ^ 1] }
        acknowledged.objects = { ...acknowledged.objects, moduleIndex: { ...index, entries: index.entries.map(held => held === entry ? moved : held) } }
        release()
        const error = await loading
        expect(error).toBeInstanceOf(ModuleLoadError)
        expect((error as ModuleLoadError).reason).toBe('stale')
        expect(isModuleStub(slots(world)[1])).toBe(true)
    })
})
