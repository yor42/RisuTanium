/**
 * Reproducers for the save path of the storage rewrite: each states the
 * property the rewritten save path has. Every test runs over a store2 session
 * (the store2 save loop is wired behind saveDb()) and is a plain `test`.
 *
 * Tests 1, 3, 4 and 5 read one seam: the bytes and write calls the page makes
 * into its store2 backend (the kit's counting wrapper). The Node snapshot test
 * reads the restore points the commit key names (`listRestorePoints`). No
 * assertion names a loop internal.
 *
 * Notes:
 * - A1 also asserts that no unit besides a shard and the manifest is written;
 *   the 66 KiB bound alone does not catch a small re-encoded unit.
 * - Node snapshot: a compatibility guard plus a list-API test, not a regression
 *   reproducer. The store2 commit path has no size gate, so the property holds by
 *   construction and the size-limit mock is inert on it. It is falsified by a
 *   list that returns nothing (list API) and by a restore that never pushes the
 *   previous current (commit operation). The restore's forced-push flag alone is
 *   guarded by commit.test.ts ("pushes the previous current when other retained
 *   entries keep the admission window closed") and by the window-closed guard in
 *   restorePoints.test.ts.
 * - Archived open: the store is seeded from the full database and the live
 *   database holds the stub of its entity; the real cold-storage reader loads the
 *   character from the store2 units (the residency the kit registers). The
 *   zero-write expectations hold because the load hydrates the units' digests and
 *   tells the identity tracker the installed object is not new. The unload half
 *   starts the real put-back in the world's graph: once the page moves on, the
 *   unchanged loaded character is a stub again and nothing is written.
 * - `test.fails` also passes on a setup failure or a timeout, so a flip must
 *   re-run the test as a plain `test`.
 *
 * This file drives the REAL, unmocked saveDb() loop, the store2 save loop and,
 * where an edit must be noticed, the real `registerDbChangeEffects` over a
 * reactive DBState, against an in-memory store (see saveLoopWorld.ts and
 * store2SaveKit.ts). A mocked success here is not evidence of native backend
 * behaviour. The Node size limit is lowered through the limit module, as
 * globalApi.nodeSizeGuard.svelte.test.ts does, so a small database is "over"
 * it.
 *
 * Labels: tests 1, 3, 4 and 5 are regression reproducers (they fail on the
 * block-store save loop and pass on the store2 loop); the Node snapshot test
 * is a compatibility guard (it passes on the store2 path by construction).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { incompressible, makeCharacter, makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { stubFromEntry } from 'src/ts/storage/store2/codec'
import { startStore2, store2Boot, type Hooks, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import type { Database } from 'src/ts/storage/database.svelte'
import type { ByteStore } from 'src/ts/storage/store/contract'
import type { AppStoreKind } from 'src/ts/storage/store/appStore'
import { ADMISSION_INTERVAL_MS } from 'src/ts/storage/store2/commit'
import { listRestorePoints, restorePoint } from 'src/ts/storage/store2/restorePoints'
import {
    removePluginStorageValue, writePluginStorageValue, writePluginUnitToDb, type PluginColdStorageDb,
} from 'src/ts/plugins/apiV3/pluginColdStorage'

vi.setConfig({ testTimeout: 40_000 })

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

const kit = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

type Entry = Record<string, unknown>

const units = new Map<string, unknown>()
const NODE_TEST_LIMIT = 4096
const BLOCK = 100_000

beforeEach(() => {
    vi.clearAllMocks()
    units.clear()
    // The real effects: `saveLoopMocks.svelte.ts` replaces them, and an edit is noticed only by them.
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    // The kit gives each world a fresh module graph with its own copy of Svelte's runtime; a `$state` created by the
    // shared mock factory belongs to the first copy and its edits never reach the effects of the world. The factory
    // here runs inside the world's graph, so the state and the effects share one runtime.
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
            savingStoppedReason: writable(null),
            frozenSaveKeysStore: writable([]),
        } as unknown as typeof import('src/ts/stores.svelte')
    })
    vi.doMock('src/ts/process/coldstorage.svelte', async () => {
        const { noteReadSize } = await import('src/ts/process/memory/restoredBytes')
        return {
            getColdStorageItem: vi.fn(),
            writeColdStorageUnit: async (key: string, value: unknown) => {
                units.set(key, JSON.parse(JSON.stringify(value)))
                return 'written'
            },
            readColdStorageItem: async (key: string) => {
                const unit = units.get(key)
                if (unit === undefined) {
                    return { status: 'missing' }
                }
                const json = JSON.stringify(unit)
                const result = { status: 'ok', value: JSON.parse(json) }
                noteReadSize(result, json.length)
                return result
            },
        }
    })
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(() => {
    kit.parkAll()
    vi.doMock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }))
    vi.doUnmock('src/ts/storage/nodeBodyLimit')
    vi.doUnmock('src/ts/process/index.svelte')
    vi.restoreAllMocks()
})

/** Every write call the page makes into its store2 backend from now on, with its length. */
function meterWrites(k: Store2Kit) {
    k.counted.reset()
    return {
        saved: () => k.counted.writes.map((write) => ({ key: write.key, bytes: write.bytes })),
        savedBytes: () => k.counted.savedBytes(),
    }
}

/**
 * Wraps, in place, `write` and, when the store has them, `pageGate.writeTop` and
 * `guarded.writeChecked` (a store2 backend of the Tauri and Node builds reaches
 * the byte store through the nested objects; the in-memory backend of the
 * store2 suites does not).
 */
function meterStore(store: ByteStore) {
    const writes: Array<{ key: string, bytes: number }> = []
    const original = store.write
    store.write = async (key, bytes, condition) => {
        writes.push({ key, bytes: bytes.length })
        return await original.call(store, key, bytes, condition)
    }
    const gate = store.pageGate
    if (gate !== undefined) {
        const writeTop = gate.writeTop
        gate.writeTop = async (generation, key, bytes) => {
            writes.push({ key, bytes: bytes.length })
            return await writeTop.call(gate, generation, key, bytes)
        }
    }
    const guarded = store.guarded
    if (guarded !== undefined) {
        const writeChecked = guarded.writeChecked
        guarded.writeChecked = async (key, bytes, condition, checkOnly) => {
            writes.push({ key, bytes: bytes.length })
            return await writeChecked.call(guarded, key, bytes, condition, checkOnly)
        }
    }
    const saves = () => writes.filter((write) => !write.key.startsWith('database/'))
    return {
        saved: saves,
        savedBytes: () => saves().reduce((sum, write) => sum + write.bytes, 0),
    }
}

interface ReactiveWorld {
    w: World
    /** The store2 session the page saves into. */
    k: Store2Kit
    /** The database the loop and the change effects read, as the application holds it: a reactive proxy. */
    db: Entry
    stores: typeof import('src/ts/stores.svelte')
    /** Runs the pending effects of the world's Svelte runtime, as the next microtask would. */
    flush(): void
}

/**
 * Starts the loop of a store2 session over a reactive `DBState`, as the application runs, so the real change effects
 * see edits. The store is seeded from `seed` when given (the full database of an archived character), else from the
 * live database.
 */
async function startReactive(seed?: Database, hooks?: Hooks, beforeStart?: (k: Store2Kit) => void, stubs?: readonly string[], kind?: AppStoreKind): Promise<ReactiveWorld> {
    const k = await startStore2({ db: seed ?? h.db as unknown as Database, hooks, stubs, kind })
    const w = await kit.startWorld({ kind: kind ?? 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    const { flushSync } = await import('svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    beforeStart?.(k)
    w.start()
    await sleepReal(150)
    return { w, k, db: h.db, stores, flush: flushSync }
}

describe('guard: the write meter sees every write path of a store', () => {
    // Compatibility guard: passes today and after the cutover; it keeps the meter from silently missing a path.
    test('writes through write, pageGate.writeTop and guarded.writeChecked are all recorded', async () => {
        const result = { revision: 1 } as unknown as Awaited<ReturnType<ByteStore['write']>>
        const store = {
            write: async () => result,
            pageGate: { registerPage: async () => 1, removeTop: async () => {}, writeTop: async () => result },
            guarded: { writeChecked: async () => result },
        } as unknown as ByteStore
        const meter = meterStore(store)

        await store.write('plain', new Uint8Array(3), 'unconditional')
        await store.pageGate!.writeTop(1, 'top', new Uint8Array(5))
        await store.guarded!.writeChecked('checked', new Uint8Array(7), 'unconditional', [])
        await store.write('database/dbbackup-1.bin', new Uint8Array(11), 'unconditional')

        expect(meter.saved()).toEqual([
            { key: 'plain', bytes: 3 },
            { key: 'top', bytes: 5 },
            { key: 'checked', bytes: 7 },
        ])
        expect(meter.savedBytes()).toBe(15)
    })
})

describe('the rewritten save path writes in proportion to what changed', () => {
    // A switch between unedited characters writes only the small constant part of a commit, never a character's bytes.
    test('A1: switching to an unedited character (its last-interaction time moves) writes no character bytes', async () => {
        const db = makeDb('p', ['a', 'b'])
        for (const character of db.characters as Entry[]) {
            ;((character.chats as Entry[])[0]).note = incompressible(300_000)
        }
        h.db = db
        const { w, k, db: live, stores, flush } = await startReactive()
        await settled(w)
        const meter = meterWrites(k)
        const before = k.memory.snapshot()

        await nextCommit(w, () => {
            stores.selectedCharID.set(1)
            ;(live.characters as Entry[])[1].lastInteraction = Date.now()
            flush()
        })

        // The shard must persist the moved time, so something is written, and only the constant part of a commit.
        expect(meter.savedBytes()).toBeGreaterThan(0)
        expect(meter.savedBytes()).toBeLessThan(66 * 1024)
        // No unit but the entry's shard and the manifest is written.
        expect(k.writtenSince(before)).toEqual(['manifest', 'shard'])
    })

    // Compatibility guard: a restore point still exists when the database is over the Node body limit. It passes on the
    // store2 path by construction (no size gate in the commit path), and the in-memory backend means "Node" is the session
    // kind only; the list and restore API is what the mutants falsify.
    test('Node snapshot: a database over the Node size limit still gets its restore point', async () => {
        vi.doMock('src/ts/platform', () => ({ isTauri: false, isNodeServer: true, isIOS: () => false }))
        vi.doMock('src/ts/storage/nodeBodyLimit', () => ({ NODE_BODY_LIMIT_BYTES: NODE_TEST_LIMIT }))
        const characters = Array.from({ length: 30 }, (_, i) => `many-${i}`)
        h.db = makeDb('first', characters)
        const { w, k, db: live, flush } = await startReactive(undefined, undefined, undefined, undefined, 'node')
        await settled(w)
        const backend = k.counted.backend
        const points = async () => {
            const listed = await listRestorePoints(backend, await backend.readCommit())
            if (listed.status !== 'ok') {
                throw new Error(`The restore points could not be listed: ${listed.status}.`)
            }
            return listed.rows.map((row) => row.key)
        }
        const seededJson = JSON.stringify(await k.saved())
        const edit = (prompt: string) => nextCommit(w, () => {
            live.mainPrompt = prompt
            flush()
        })

        expect(await points(), 'the seed install leaves nothing retained').toEqual([])

        await edit('second')
        expect(await points()).toEqual([k.seeded.manifestKey])

        // Inside the admission window the previous current is not retained again; past it, it is.
        await edit('third')
        expect(await points()).toEqual([k.seeded.manifestKey])
        k.clock.advance(ADMISSION_INTERVAL_MS + 1)
        await edit('fourth')
        const afterWindow = await points()
        expect(afterWindow).toHaveLength(2)
        expect(afterWindow[1]).toBe(k.seeded.manifestKey)

        // Restoring the seed brings back the seeded database and keeps what was current as a restore point.
        const before = (await k.commitKey()).current?.key as string
        const outcome = await restorePoint(k.committer, backend, k.seeded.manifestKey)
        expect(outcome.status).toBe('restored')
        expect(JSON.stringify(await k.saved())).toBe(seededJson)
        expect(await points()).toContain(before)
    })

    // Editing one plugin-storage key writes about that key's data, not the whole storage.
    test('pluginStorage: editing one key writes only that key, not the whole storage', async () => {
        const db = makeDb('p', ['a'])
        const storage: Record<string, string> = {}
        for (let i = 0; i < 12; i++) {
            storage[`key-${i}`] = incompressible(BLOCK).replace(/^./, String(i % 10))
        }
        db.pluginCustomStorage = storage
        h.db = db
        const { w, k, db: live, flush } = await startReactive()
        await settled(w)
        const meter = meterWrites(k)

        await nextCommit(w, () => {
            ;(live.pluginCustomStorage as Record<string, string>)['key-5'] = `edited-${incompressible(BLOCK - 7)}`
            flush()
        })

        // The edit is persisted (at least the edited key's data) and nothing else is.
        expect(meter.savedBytes()).toBeGreaterThanOrEqual(BLOCK)
        expect(meter.savedBytes()).toBeLessThan(2 * BLOCK)
    })

    /** A store2 page's plugin storage: twelve slots, each a unit id in `_coldplugin` and a value under that id. */
    function pluginSlotsDb() {
        const db = makeDb('p', ['a'])
        const storage: Record<string, unknown> = { _coldplugin: {} as Record<string, string> }
        for (let i = 0; i < 12; i++) {
            ;(storage._coldplugin as Record<string, string>)[`slot-${i}`] = `unit-${i}`
            storage[`unit-${i}`] = incompressible(BLOCK).replace(/^./, String(i % 10))
        }
        db.pluginCustomStorage = storage
        return db
    }

    // Plugin storage on a store2 page (W4c): `pluginStorage.setItem` lands in the entry's own unit, and a save pass writes
    // that unit and no other. New behaviour over the injected writer (it does not exist on the base); the wiring in
    // `v3.svelte.ts` that selects it is the reproducer in `pluginStorageStore2.svelte.test.ts`.
    test('pluginStorage on store2: setItem of one slot persists exactly that key\'s unit and writes no cold unit', async () => {
        h.db = pluginSlotsDb()
        const { w, k, db: live, flush } = await startReactive()
        await settled(w)
        const meter = meterWrites(k)
        const edited = `edited-${incompressible(BLOCK - 7)}`

        const liveDb = live as PluginColdStorageDb
        let write: Promise<void> = Promise.resolve()
        await nextCommit(w, () => {
            write = writePluginStorageValue(liveDb, () => liveDb, 'slot-5', edited, writePluginUnitToDb(() => liveDb), () => 'unused').then(flush)
        })
        await write

        expect(meter.savedBytes()).toBeGreaterThanOrEqual(BLOCK)
        expect(meter.savedBytes()).toBeLessThan(2 * BLOCK)
        const saved = (await k.saved()).pluginCustomStorage as Record<string, unknown>
        expect(saved['unit-5']).toBe(edited)
        expect(saved['unit-4']).toBe((h.db as unknown as Database).pluginCustomStorage['unit-4'])
        expect(Object.keys(saved)).toHaveLength(13)
        expect(units.size, 'no legacy cold unit is written').toBe(0)
    })

    // A new slot adds its map entry and one value; removing a slot removes both from the saved tree.
    test('pluginStorage on store2: a new slot and a removed slot are both persisted', async () => {
        h.db = pluginSlotsDb()
        const { w, k, db: live, flush } = await startReactive()
        await settled(w)
        const liveDb = live as PluginColdStorageDb

        let write: Promise<void> = Promise.resolve()
        await nextCommit(w, () => {
            write = writePluginStorageValue(liveDb, () => liveDb, 'fresh', { n: 1 }, writePluginUnitToDb(() => liveDb), () => 'unit-fresh').then(flush)
        })
        await write
        const afterAdd = (await k.saved()).pluginCustomStorage as Record<string, unknown>
        expect(afterAdd['unit-fresh']).toEqual({ n: 1 })
        expect((afterAdd._coldplugin as Record<string, string>).fresh).toBe('unit-fresh')

        await nextCommit(w, () => {
            removePluginStorageValue(liveDb, 'slot-3', true)
            flush()
        })
        const afterRemove = (await k.saved()).pluginCustomStorage as Record<string, unknown>
        expect(Object.hasOwn(afterRemove, 'unit-3')).toBe(false)
        expect(Object.hasOwn(afterRemove._coldplugin as Record<string, string>, 'slot-3')).toBe(false)
        expect(afterRemove['unit-fresh']).toEqual({ n: 1 })
        expect(units.size).toBe(0)
    })

    // Editing one module writes about that module's bytes, not every module's.
    test('module edit: editing one module writes about that module, not every module', async () => {
        const db = makeDb('p', ['a'])
        db.modules = Array.from({ length: 12 }, (_, i) => ({
            id: `module-${i}`,
            name: `module ${i}`,
            // The bulk is in a field the module index does not list: the index carries every module's description.
            lorebook: [{ key: 'k', comment: 'c', content: incompressible(BLOCK).replace(/^./, String(i % 10)) }],
        }))
        h.db = db
        const { w, k, db: live, flush } = await startReactive()
        await settled(w)
        const meter = meterWrites(k)

        await nextCommit(w, () => {
            ;((live.modules as Entry[])[3].lorebook as Entry[])[0].content = `edited-${incompressible(BLOCK - 7)}`
            flush()
        })

        // The edit is persisted (at least the edited module's data) and nothing else is.
        expect(meter.savedBytes()).toBeGreaterThanOrEqual(BLOCK)
        expect(meter.savedBytes()).toBeLessThan(2 * BLOCK)
    })

    /**
     * The store is seeded from the full database; the page holds the character as the stub of its entity and booted it as a
     * stub (its units were not read, so they carry no digest). The real cold-storage reader serves the load.
     */
    async function startArchivedOpen(onBefore?: Hooks['before']): Promise<ReactiveWorld & { baseReads: () => number, slot: () => Entry, restore: () => Promise<{ status: string }> }> {
        const full = makeCharacter('x')
        full.chats = [{ id: 'x-chat', message: [{ role: 'char', data: incompressible(50_000), time: 1 }], note: '', name: '', localLore: [] }]
        const stored = makeDb('p', ['y'])
        ;(stored.characters as unknown[]).unshift(JSON.parse(JSON.stringify(full)))
        h.db = makeDb('p', ['y'])
        vi.doUnmock('src/ts/process/coldstorage.svelte')
        // The reader pulls in the chat pipeline for `doingChat` only; the world's graph gets that store alone.
        vi.doMock('src/ts/process/index.svelte', async () => {
            const { writable } = await import('svelte/store')
            return { doingChat: writable(false) } as unknown as typeof import('src/ts/process/index.svelte')
        })
        let reads = 0
        const world = await startReactive(stored as unknown as Database, {
            before: (name, count) => {
                if (name === 'readCommit') {
                    reads += 1
                }
                return onBefore?.(name, count)
            },
        }, (started) => {
            // The page holds the stub of the entity the seeded tree holds for the character.
            const u = started.context.previous.entities.get('x#0') as string
            const entry = started.residency.entryOf(u)
            if (entry === null) {
                throw new Error('The seeded tree holds no entity for the character.')
            }
            ;(h.db.characters as Entry[]).unshift(stubFromEntry(entry) as Entry)
        }, ['x'])
        await settled(world.w)
        const slot = () => (world.db.characters as Entry[]).find((c) => c.chaId === 'x')!
        return {
            ...world,
            baseReads: () => reads,
            slot,
            restore: async () => {
                const { restoreColdCharacter } = await import('src/ts/process/coldCharacterRestore')
                const outcome = await restoreColdCharacter(slot() as never, { byChaId: true, quiet: true })
                world.flush()
                await sleepReal(100)
                await settled(world.w)
                return outcome
            },
        }
    }

    // Loading an archived character without editing it changes nothing the store holds, and a pass over it that does run
    // reuses every unit. Regression reproducer: the load is refused where the reader has no redirect to store2 units, and
    // the second half writes the whole character where the load does not hydrate the units' digests.
    test('archived character first open: loading it without an edit writes nothing, and the first pass over it reuses its units', async () => {
        const open = await startArchivedOpen()
        const meter = meterWrites(open.k)
        const stub = open.slot()
        expect(stub.coldstorage).toBeDefined()

        const outcome = await open.restore()

        expect(outcome.status).toBe('restored')
        const loaded = open.slot()
        expect(loaded).not.toBe(stub)
        expect(loaded.coldstorage).toBeUndefined()
        expect(((loaded.chats as Entry[])[0].message as Entry[])[0].data).toHaveLength(50_000)
        expect(open.w.store.ops.filter((op) => op.kind === 'write' || op.kind === 'delete')).toEqual([])
        expect(meter.saved()).toEqual([])

        // Positive control and the hydration check: a pass over the loaded character runs (it reads the base commit key)
        // and writes no unit, because each unit of the load is the acknowledged one.
        const { getActiveStore2Save } = await import('src/ts/storage/store2/saveActive')
        expect(getActiveStore2Save()).not.toBeNull()
        const readsBefore = open.baseReads()
        open.w.marks.markCharacterForSave('x')
        await sleepReal(100)
        await settled(open.w)
        expect(open.baseReads()).toBeGreaterThan(readsBefore)
        expect(meter.saved()).toEqual([])
    })

    // The installed object is the entity's own character, not a new one: the identity tracker must raise no mark and no pass.
    test('archived character first open: the load of an unedited character raises no mark and no pass', async () => {
        const open = await startArchivedOpen()
        const readsBefore = open.baseReads()

        const outcome = await open.restore()
        await sleepReal(300)
        await settled(open.w)

        expect(outcome.status).toBe('restored')
        expect(open.w.api.isSaveClean()).toBe(true)
        expect(open.baseReads()).toBe(readsBefore)
    })

    /** Starts the put-back in the world's graph, as the boot does after the database is installed. */
    async function startPutBack(): Promise<() => void> {
        const { startCharacterPutBack } = await import('src/ts/process/memory/characterPutBack')
        return startCharacterPutBack()
    }

    const indexOf = (open: ReactiveWorld, chaId: string): number => (open.db.characters as Entry[]).findIndex((c) => c.chaId === chaId)

    const isStub = (open: { slot: () => Entry }): boolean => typeof open.slot().coldstorage === 'string'
    const xData = (open: { slot: () => Entry }): Entry => ((open.slot().chats as Entry[])[0].message as Entry[])[0]

    /**
     * Leaves the loaded character 'x' behind in the way that makes it a put-back candidate while a save is still
     * pending, so its unload waits for the commit: the resident 'y' is edited and marked, the selection goes home.
     * `atCommit` runs when the pass has committed and before the put-back's own callback (it is registered first): an
     * in-place edit that nothing marked and no pass encoded.
     */
    function moveOnWhileUnsaved(open: ReactiveWorld, atCommit?: () => void): void {
        if (atCommit !== undefined) {
            open.w.api.afterNextSaveCommit(atCommit)
        }
        ;(open.db.characters as Entry[])[indexOf(open, 'y')].name = 'y renamed'
        open.w.marks.markCharacterForSave('y')
        open.stores.selectedCharID.set(-1)
        open.flush()
    }

    // Diagnostic: the put-back waits for a save commit after a selection change and arms no timer of its own. This is
    // the premise: the selected-character effect marks a pass on a selection alone, and that pass, though it writes
    // nothing, ends in a commit.
    test('observation: selecting a character without an edit is followed by a save commit that writes nothing', async () => {
        const open = await startArchivedOpen()
        await open.restore()
        await settled(open.w)
        const meter = meterWrites(open.k)
        let commits = 0
        open.w.api.afterNextSaveCommit(() => { commits += 1 })

        open.stores.selectedCharID.set(indexOf(open, 'x'))
        open.flush()
        await until(() => commits > 0, 'the commit that follows a selection')
        await settled(open.w)

        expect(commits).toBe(1)
        expect(meter.saved()).toEqual([])
    })

    // S0 test 5, the unload half. Regression reproducer: on the W4b-1 base nothing turns the loaded character back into a stub.
    test('archived character unload: after the page moves on, the unchanged loaded character is a stub again, with no unit written and the shard unchanged', async () => {
        const open = await startArchivedOpen()
        const stop = await startPutBack()
        await open.restore()
        open.stores.selectedCharID.set(indexOf(open, 'x'))
        open.flush()
        await sleepReal(100)
        await settled(open.w)
        expect(isStub(open), 'the selected character stays loaded').toBe(false)
        const meter = meterWrites(open.k)
        const before = open.k.memory.snapshot()

        open.stores.selectedCharID.set(-1)
        open.flush()
        await until(() => isStub(open), 'the character to be unloaded')
        await sleepReal(200)
        await settled(open.w)

        expect(open.slot().coldstorage).toBe(open.k.context.previous.entities.get('x#0'))
        expect(meter.saved()).toEqual([])
        expect(open.k.writtenSince(before)).toEqual([])
        stop()
    })

    // R4b: with a save pending the unload waits for the commit and then happens.
    test('R4b: a clean loaded character is unloaded after the next commit', async () => {
        const open = await startArchivedOpen()
        const stop = await startPutBack()
        await open.restore()
        open.stores.selectedCharID.set(indexOf(open, 'x'))
        open.flush()
        await sleepReal(100)
        await settled(open.w)

        await nextCommit(open.w, () => moveOnWhileUnsaved(open))
        await until(() => isStub(open), 'the character to be unloaded after the commit')
        await settled(open.w)

        expect((await open.k.saved()).characters.map((c) => (c as unknown as Entry).chaId)).toEqual(['x', 'y'])
        stop()
    })

    // A9a: an edit that lands between a pass's encode and its acknowledgement is not in the acknowledged encoding.
    test('A9a: an unmarked edit between a pass\'s encode and its commit keeps the character loaded, and the next pass saves the edit', async () => {
        let edit: (() => void) | null = null
        const open = await startArchivedOpen((name) => {
            if (name === 'commitOrdinary' && edit !== null) {
                const run = edit
                edit = null
                run()
            }
        })
        const stop = await startPutBack()
        await open.restore()
        open.stores.selectedCharID.set(indexOf(open, 'x'))
        open.flush()
        await sleepReal(100)
        await settled(open.w)

        edit = () => { xData(open).data = 'edited between encode and commit' }
        await nextCommit(open.w, () => {
            open.w.marks.markCharacterForSave('x')
            moveOnWhileUnsaved(open)
        })
        await until(() => isStub(open), 'the character to be unloaded once its edit is saved')
        await settled(open.w)

        expect(edit).toBeNull()
        const saved = (await open.k.saved()).characters.find((c) => (c as unknown as Entry).chaId === 'x') as unknown as Entry
        expect(((saved.chats as Entry[])[0].message as Entry[])[0].data).toBe('edited between encode and commit')
        stop()
    })

    // A9b: nothing marked this edit, and no pass encoded the character since.
    test('A9b: an unmarked edit of a loaded character that is not selected keeps it loaded until the edit is saved', async () => {
        const open = await startArchivedOpen()
        const stop = await startPutBack()
        await open.restore()
        open.stores.selectedCharID.set(indexOf(open, 'x'))
        open.flush()
        await sleepReal(100)
        await settled(open.w)

        await nextCommit(open.w, () => moveOnWhileUnsaved(open, () => { xData(open).data = 'edited while not selected' }))
        await until(() => isStub(open), 'the character to be unloaded once its edit is saved')
        await settled(open.w)

        const saved = (await open.k.saved()).characters.find((c) => (c as unknown as Entry).chaId === 'x') as unknown as Entry
        expect(((saved.chats as Entry[])[0].message as Entry[])[0].data).toBe('edited while not selected')
        stop()
    })

    // A9c: `chatPage` lives in the entry only; a verdict over the units alone would miss it.
    test('A9c: an unmarked chatPage edit of a loaded character keeps it loaded until the shard holds it', async () => {
        const open = await startArchivedOpen()
        const stop = await startPutBack()
        await open.restore()
        open.stores.selectedCharID.set(indexOf(open, 'x'))
        open.flush()
        await sleepReal(100)
        await settled(open.w)

        await nextCommit(open.w, () => moveOnWhileUnsaved(open, () => { open.slot().chatPage = 3 }))
        await until(() => isStub(open), 'the character to be unloaded once its edit is saved')
        await settled(open.w)

        const saved = (await open.k.saved()).characters.find((c) => (c as unknown as Entry).chaId === 'x') as unknown as Entry
        expect(saved.chatPage).toBe(3)
        stop()
    })

    // W4-Q2: only a character the load path installed is a candidate. Compatibility guard: it also passes without the
    // unload engine; the port test in characterPutBackStore2 is the reproducer.
    test('guard W4-Q2: a resident character that was not loaded from the store is never judged or unloaded', async () => {
        const open = await startArchivedOpen()
        const stop = await startPutBack()
        const verdict = vi.spyOn(open.k.residency, 'verdict')
        const resident = (open.db.characters as Entry[])[indexOf(open, 'y')]

        open.stores.selectedCharID.set(indexOf(open, 'y'))
        open.flush()
        await sleepReal(100)
        open.stores.selectedCharID.set(-1)
        open.flush()
        await sleepReal(300)
        await settled(open.w)

        expect((open.db.characters as Entry[])[indexOf(open, 'y')]).toBe(resident)
        expect(resident.coldstorage).toBeUndefined()
        expect(verdict).not.toHaveBeenCalled()
        stop()
    })

    // N2: a save attempt of unknown outcome may have landed with units the acknowledged encoding does not hold.
    test('N2: while a save attempt of unknown outcome is pending, no character is judged', async () => {
        const { createResidency } = await import('src/ts/storage/store2/residency')
        const k = await startStore2({ db: makeDb('p', ['a', 'b']) as unknown as Database })
        const slot = JSON.parse(JSON.stringify(k.seedDb.characters[0])) as Database['characters'][number]
        const settledResidency = createResidency({ backend: k.counted.backend, context: { encoder: k.encoder, lists: k.context.lists, env: k.context.env } })
        let pendingKey: string | null = null
        const encoder = Object.create(k.encoder, { pendingKey: { get: () => pendingKey } }) as typeof k.encoder
        const residency = createResidency({ backend: k.counted.backend, context: { encoder, lists: k.context.lists, env: k.context.env } })

        expect(settledResidency.verdict(slot), 'positive control: nothing pending').toBe('clean')
        expect(residency.verdict(slot), 'positive control: nothing pending').toBe('clean')
        pendingKey = 'a manifest key'
        expect(residency.verdict(slot)).toBe('unknown')
    })
})
