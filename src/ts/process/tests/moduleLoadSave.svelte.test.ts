/**
 * A loaded module over the real save loop and the real change effects: `saveDb()` runs for real over an active store2
 * session whose store is an in-memory backend, the module slots are a reactive `DBState`, and the module loader is the
 * real one. A module stub is made the way the boot will (the recorded stub, its units without digests), then loaded.
 * What these cases pin: an unedited load costs no commit, a repaired body is written, a digest set by a load survives
 * the next commit, and a deferral that starts in an idle-net tick ends in a save made by the install's own mark.
 * A mocked success here is not evidence of native backend behaviour.
 *
 * Labels: reproducer (fails against the base or the named mutant), guard (passes before and after).
 */
import { types } from 'node:util'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AssetList } from 'src/ts/storage/assetList'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { createWorldKit, nextCommit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit, type Store2StartOptions } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall } from 'src/ts/storage/tests/store2/codecFixtures'
import { IDENTITY, moduleHandles } from 'src/ts/storage/store2/codec'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
import { isModuleStub } from 'src/ts/storage/moduleStub'
import { moduleStubOf } from 'src/ts/storage/store2/moduleStubMatch'
import type { Database } from 'src/ts/storage/database.svelte'

vi.setConfig({ testTimeout: 40_000 })

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

const worlds = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

type Entry = Record<string, unknown>

beforeAll(() => {
    class FakeChannel {
        onmessage: ((event: { data: unknown }) => void) | null = null
        constructor(public name: string) { h.channels.push(this) }
        postMessage(data: unknown) { h.broadcasts.push(data) }
        close() {}
    }
    Object.defineProperty(window, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
})

beforeEach(() => {
    vi.clearAllMocks()
    h.broadcasts.length = 0
    h.channels.length = 0
    // The real effects: `saveLoopMocks.svelte.ts` replaces them, and an edit is noticed only by them.
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    // The loader refreshes the module screens after an install.
    vi.doMock('src/ts/process/modules', () => ({
        moduleUpdate: vi.fn(async () => {}),
        refreshModules: vi.fn(),
        bumpModuleGui: vi.fn(),
    }))
    // The kit gives each world a fresh module graph with its own copy of Svelte's runtime; the state and the effects
    // must share one runtime, so the factory runs inside the world's graph.
    vi.doMock('src/ts/stores.svelte', async () => {
        const { proxy } = await import('svelte/internal/client')
        const { writable } = await import('svelte/store')
        return {
            DBState: proxy({ db: {} as Entry }),
            selectedCharID: writable(-1),
            selIdState: { selId: -1 },
            alertStore: writable({ type: 'none', msg: '' }),
            MobileGUI: writable(false),
            botMakerMode: writable(false),
            loadedStore: writable(false),
            LoadingStatusState: { text: '' },
            ReloadGUIPointer: writable(0),
            bodyIntercepterStore: writable(null),
            savingStoppedReason: writable(''),
            frozenSaveKeysStore: writable([]),
        } as unknown as typeof import('src/ts/stores.svelte')
    })
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(() => {
    worlds.parkAll()
    vi.doMock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }))
    vi.restoreAllMocks()
})

interface Page {
    w: World
    k: Store2Kit
    /** The database the loop and the change effects read: a reactive proxy. */
    db: Entry
    /** What the loop's module valve answered, in call order. */
    valveOutcomes: string[]
    flush(): void
    acquire: typeof import('src/ts/storage/store2/moduleAcquire').acquireModule
    ids: string[]
    handles: string[]
}

async function startPage(db: Database, options: Partial<Store2StartOptions> = {}): Promise<Page> {
    h.db = db as unknown as Entry
    // The real list derivation: only it opts into list versions, and a module stub is carried only then.
    const k = await startStore2({ db, lists: createListDerivation(), ...options })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    const { flushSync } = await import('svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    // The real loader, in the world's own module graph, registered as the dispatch registers it.
    const loader = await import('src/ts/process/moduleLoader')
    const acquireModule = await import('src/ts/storage/store2/moduleAcquire')
    acquireModule.registerModuleLoader(loader.loadModule)
    const valveOutcomes: string[] = []
    k.context.loadModuleStub = async (moduleId) => {
        const result = await loader.loadModuleStubsOf(moduleId)
        valveOutcomes.push(result.kind)
        return result
    }
    const index = k.encoder.acknowledged().objects?.moduleIndex
    if (index === undefined) {
        throw new Error('The seeded tree holds no module index.')
    }
    w.start()
    await sleepReal(150)
    return { w, k, db: h.db, valveOutcomes, flush: flushSync, acquire: acquireModule.acquireModule, ids: index.entries.map(entry => entry.id), handles: moduleHandles(index.entries) }
}

function modules(page: Page): Entry[] {
    return page.db.modules as Entry[]
}

/** Turns module `index` into its recorded stub, its units without digests as a boot leaves them, and lets the loop settle. */
async function stubOut(page: Page, index: number): Promise<void> {
    const entry = page.k.residency.moduleEntryOf(page.handles[index])
    if (entry === null) {
        throw new Error('No entry for the module.')
    }
    for (const prefix of [IDENTITY.module, IDENTITY.alModule, IDENTITY.ilModule]) {
        const unit = page.k.encoder.acknowledged().units.get(`${prefix}${page.handles[index]}`)
        if (unit !== undefined) {
            delete unit.digest
        }
    }
    modules(page)[index] = moduleStubOf(entry) as unknown as Entry
    page.flush()
    await settled(page.w)
}

const digestOf = (page: Page, index: number, prefix: string) => page.k.encoder.acknowledged().units.get(`${prefix}${page.handles[index]}`)?.digest

const small = () => buildSmall(2)

/** The small profile with every module lorebook entry at the current book version, so loading a module repairs nothing. */
function current(): Database {
    const db = small() as unknown as { modules: Array<{ lorebook: Array<{ bookVersion?: number }> }> }
    for (const module of db.modules) {
        for (const entry of module.lorebook) {
            entry.bookVersion = 2
        }
    }
    return db as unknown as Database
}

describe('a load that changes nothing costs no commit', () => {
    test('load-then-pass-writes-nothing: the pass the install causes runs, finds every unit unchanged and writes none', async () => {
        const page = await startPage(current())
        await stubOut(page, 1)
        const writes =page.k.counted.writeCalls()
        const reads = vi.spyOn(page.k.committer, 'readCommit')
        expect(isModuleStub(modules(page)[1])).toBe(true)
        const got = await page.acquire(page.ids[1])
        expect(got?.module).toBe(modules(page)[1])
        expect(isModuleStub(modules(page)[1])).toBe(false)
        page.flush()
        await until(() => reads.mock.calls.length > 0, 'the pass the install causes')
        await settled(page.w)
        expect(page.k.counted.writeCalls()).toBe(writes)
        expect(digestOf(page, 1, IDENTITY.module)).toBeDefined()
        expect(digestOf(page, 1, IDENTITY.alModule)).toBeDefined()
    })

    test('hydration-survives-acknowledge: the digests a load set are still the saved ones after another edit has been committed', async () => {
        const page = await startPage(current())
        await stubOut(page, 1)
        await page.acquire(page.ids[1])
        page.flush()
        await settled(page.w)
        // Another edit commits: the acknowledged encoding is replaced by the one that pass produced.
        await nextCommit(page.w, () => {
            ;(page.db.characters as Entry[])[0].personality = 'edited after the load'
            page.w.marks.markCharacterForSave(String((page.db.characters as Entry[])[0].chaId))
            page.flush()
        })
        const mark = page.k.memory.snapshot()
        // An equal-content swap marks the modules; no module unit may be written for it.
        await nextCommit(page.w, () => {
            modules(page)[1] = JSON.parse(JSON.stringify(modules(page)[1])) as Entry
            page.flush()
        })
        expect(page.k.writtenSince(mark)).toEqual([])
    })
})

/** The small profile with the stored module 1 holding one asset tuple. */
function withAssetModule(): Database {
    const db = current() as unknown as { modules: Array<{ assets: string[][] }> }
    db.modules[1].assets = [['asset-0', 'assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png', 'png']]
    return db as unknown as Database
}

/** The world's module graph holds its own AssetList class, so the list is recognised by its prototype chain, not by `instanceof`. */
function holdsAssetList(value: unknown): boolean {
    return Array.isArray(value) && Object.getPrototypeOf(value) !== Array.prototype && Object.getPrototypeOf(value)?.constructor?.name === 'AssetList'
}

describe('a loaded module with assets', () => {
    test('a-loaded-module-has-an-AssetList-in-the-slot-and-its-tuples-are-not-proxied', async () => {
        const page = await startPage(withAssetModule())
        await stubOut(page, 1)
        await page.acquire(page.ids[1])
        page.flush()
        const assets = modules(page)[1].assets as AssetList
        expect(holdsAssetList(assets)).toBe(true)
        expect(Array.from(assets)).toEqual([['asset-0', 'assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png', 'png']])
        expect(types.isProxy(assets)).toBe(false)
        expect(types.isProxy(assets[0])).toBe(false)
    })

    test('guard: a-loaded-asset-module-is-not-rewritten-by-the-next-pass', async () => {
        const page = await startPage(withAssetModule())
        await stubOut(page, 1)
        const writes = page.k.counted.writeCalls()
        const reads = vi.spyOn(page.k.committer, 'readCommit')
        await page.acquire(page.ids[1])
        page.flush()
        await until(() => reads.mock.calls.length > 0, 'the pass the install causes')
        await settled(page.w)
        expect(page.k.counted.writeCalls()).toBe(writes)
        expect(digestOf(page, 1, IDENTITY.module)).toBeDefined()
        expect(digestOf(page, 1, IDENTITY.alModule)).toBeDefined()
    })
})

describe('a repaired body is written by the pass the install causes', () => {
    test('a module that was migrated at load has its module unit written, and the store holds the body', async () => {
        const page = await startPage(small())
        await stubOut(page, 1)
        const mark = page.k.memory.snapshot()
        await nextCommit(page.w, () => {
            void page.acquire(page.ids[1]).then(() => page.flush())
        })
        expect(page.k.writtenSince(mark)).toContain('module')
        expect(((await page.k.saved()).modules as unknown as Entry[])[1].id).toBe(page.ids[1])
    })
})

describe('a deferral that starts in an idle-net tick', () => {
    test('the load is answered outside the lock and the install\'s own mark saves the repaired module once', async () => {
        // The stored module 0 has a lorebook that is not a list: loading it asks the person (the alerts answer yes at once).
        const seed = small() as unknown as { modules: Entry[] }
        seed.modules[0].lorebook = { bad: true }
        const page = await startPage(seed as unknown as Database, { idleNet: { intervalMs: 1, moduleIntervalMs: 1 } })
        await stubOut(page, 0)
        const mark = page.k.memory.snapshot()
        // A second module of the stub's id: the planner cannot carry the stub, so the next tick refuses it.
        modules(page).push({ ...(JSON.parse(JSON.stringify(modules(page)[1])) as Entry), id: page.ids[0], name: 'second module of the same id' })
        page.flush()
        await until(() => !isModuleStub(modules(page)[0]), 'the install of the stub', 15_000)
        page.flush()
        await settled(page.w)
        expect(page.k.writtenSince(mark)).toContain('module')
        const saved = (await page.k.saved()).modules as unknown as Entry[]
        expect(saved[0].lorebook).toEqual([])
        expect(saved).toHaveLength(5)
        expect(page.valveOutcomes[0]).toBe('deferred')
        expect(page.valveOutcomes).not.toContain('refused')
        expect(page.w.api.isSaveClean()).toBe(true)
    })
})
