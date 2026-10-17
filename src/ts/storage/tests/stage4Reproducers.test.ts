/**
 * Reproducers for the save path of the storage rewrite: each states the
 * property the rewritten save path has and is marked `test.fails` while the
 * block-store save loop is the one wired in, so the suite stays green. The
 * rewrite's cutover turns each into a plain `test`.
 *
 * Tests 1, 3, 4 and 5 read one seam: the bytes and keys the page writes into its
 * byte store (the world's recording store, through `write`, `pageGate.writeTop`
 * and `guarded.writeChecked`), outside the numbered backups. The Node snapshot test reads
 * `getDbBackups()` instead. No assertion names a block key or a loop internal.
 *
 * Notes for the flips:
 * - A1: at the flip also assert that no unit key is written (shard, manifest and
 *   commit key only); the 66 KiB bound alone does not catch a small re-encoded unit.
 * - Node snapshot: flips at the restore-point rewrite, which may change the
 *   return shape of `getDbBackups()`.
 * - Archived open: the fixture is legacy (a `coldstorage` mock and `buildColdStub`)
 *   and must be rebuilt through the kit when flipped. Its zero-write expectation
 *   requires the commit to be skipped when no unit or manifest changed.
 * - `test.fails` also passes on a setup failure or a timeout, so each flip must
 *   re-run the test as a plain `test`.
 *
 * This file drives the REAL, unmocked `saveDb()` loop, `RisuSaveEncoder`, the
 * page's block-store owner and, where an edit must be noticed, the real
 * `registerDbChangeEffects` over a reactive `DBState`, against an in-memory byte
 * store (see `saveLoopWorld.ts`). A mocked success here is not evidence of
 * native backend behaviour. The Node size limit is lowered through the limit
 * module, as `globalApi.nodeSizeGuard.svelte.test.ts` does, so a small database
 * is "over" it.
 *
 * Labels: all five are regression reproducers (they fail on the block-store
 * save loop and are expected to pass on the rewritten one).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { incompressible, makeCharacter, makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { buildColdStub } from 'src/ts/process/coldCharacter'
import type { ByteStore } from 'src/ts/storage/store/contract'

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
    vi.restoreAllMocks()
})

/** Every write the page makes into its store from now on, with its length; the numbered backups and their record are not saves. */
function meterWrites(w: World) {
    return meterStore(w.store)
}

/**
 * Wraps, in place, `write` and, when the store has them, `pageGate.writeTop` and
 * `guarded.writeChecked` (store2 looks each up on the nested object per call;
 * the fake store has neither object today).
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
    /** The database the loop and the change effects read, as the application holds it: a reactive proxy. */
    db: Entry
    stores: typeof import('src/ts/stores.svelte')
    /** Runs the pending effects of the world's Svelte runtime, as the next microtask would. */
    flush(): void
}

/** Starts the loop over a reactive `DBState`, as the application runs, so the real change effects see edits. */
async function startReactive(): Promise<ReactiveWorld> {
    const w = await kit.startWorld({ kind: 'tauri', startLoop: false })
    const stores = await import('src/ts/stores.svelte')
    const { flushSync } = await import('svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    w.start()
    await sleepReal(150)
    return { w, db: h.db, stores, flush: flushSync }
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
    test.fails('A1: switching to an unedited character (its last-interaction time moves) writes no character bytes', async () => {
        const db = makeDb('p', ['a', 'b'])
        for (const character of db.characters as Entry[]) {
            ;((character.chats as Entry[])[0]).note = incompressible(300_000)
        }
        h.db = db
        const { w, db: live, stores, flush } = await startReactive()
        await settled(w)
        const meter = meterWrites(w)

        await nextCommit(w, () => {
            stores.selectedCharID.set(1)
            ;(live.characters as Entry[])[1].lastInteraction = Date.now()
            flush()
        })

        // The shard must persist the moved time, so something is written, and only the constant part of a commit.
        expect(meter.savedBytes()).toBeGreaterThan(0)
        expect(meter.savedBytes()).toBeLessThan(66 * 1024)
    })

    // A restore point still exists when the database is over the Node body limit (flips at the restore-point rewrite).
    test.fails('Node snapshot: a database over the Node size limit still gets its restore point', async () => {
        vi.doMock('src/ts/platform', () => ({ isTauri: false, isNodeServer: true, isIOS: () => false }))
        vi.doMock('src/ts/storage/nodeBodyLimit', () => ({ NODE_BODY_LIMIT_BYTES: NODE_TEST_LIMIT }))
        const characters = Array.from({ length: 30 }, (_, i) => `many-${i}`)
        h.db = makeDb('first', characters)
        const w = await kit.startWorld({ kind: 'node' })
        const before = (await w.api.getDbBackups()).length
        await nextCommit(w, () => {
            h.db!.mainPrompt = 'second'
            w.marks.markCharacterForSave('many-0')
        })

        expect((await w.api.getDbBackups()).length - before).toBe(1)
    })

    // Editing one plugin-storage key writes about that key's data, not the whole storage.
    test.fails('pluginStorage: editing one key writes only that key, not the whole storage', async () => {
        const db = makeDb('p', ['a'])
        const storage: Record<string, string> = {}
        for (let i = 0; i < 12; i++) {
            storage[`key-${i}`] = incompressible(BLOCK).replace(/^./, String(i % 10))
        }
        db.pluginCustomStorage = storage
        h.db = db
        const { w, db: live, flush } = await startReactive()
        await settled(w)
        const meter = meterWrites(w)

        await nextCommit(w, () => {
            ;(live.pluginCustomStorage as Record<string, string>)['key-5'] = `edited-${incompressible(BLOCK - 7)}`
            flush()
        })

        // The edit is persisted (at least the edited key's data) and nothing else is.
        expect(meter.savedBytes()).toBeGreaterThanOrEqual(BLOCK)
        expect(meter.savedBytes()).toBeLessThan(2 * BLOCK)
    })

    // Editing one module writes about that module's bytes, not every module's.
    test.fails('module edit: editing one module writes about that module, not every module', async () => {
        const db = makeDb('p', ['a'])
        db.modules = Array.from({ length: 12 }, (_, i) => ({
            id: `module-${i}`,
            name: `module ${i}`,
            description: incompressible(BLOCK).replace(/^./, String(i % 10)),
        }))
        h.db = db
        const { w, db: live, flush } = await startReactive()
        await settled(w)
        const meter = meterWrites(w)

        await nextCommit(w, () => {
            ;(live.modules as Entry[])[3].description = `edited-${incompressible(BLOCK - 7)}`
            flush()
        })

        // The edit is persisted (at least the edited module's data) and nothing else is.
        expect(meter.savedBytes()).toBeGreaterThanOrEqual(BLOCK)
        expect(meter.savedBytes()).toBeLessThan(2 * BLOCK)
    })

    // Opening an archived character without editing it changes nothing the store holds.
    test.fails('archived character first open: restoring it without an edit writes nothing', async () => {
        const full = makeCharacter('x')
        full.chats = [{ id: 'x-chat', message: [{ role: 'char', data: incompressible(50_000), time: 1 }], note: '', name: '', localLore: [] }]
        units.set('unit-x', { character: full })
        const db = makeDb('p', ['y'])
        ;(db.characters as unknown[]).unshift(buildColdStub(full as never, 'unit-x', []))
        h.db = db
        const { w, db: live, flush } = await startReactive()
        await settled(w)
        const meter = meterWrites(w)
        const { restoreColdCharacter } = await import('src/ts/process/coldCharacterRestore')
        const slot = (live.characters as Entry[]).find((c) => c.chaId === 'x')!

        const outcome = await restoreColdCharacter(slot as never, { byChaId: true, quiet: true })
        flush()
        expect(outcome.status).toBe('restored')
        await sleepReal(100)
        await settled(w)

        expect(meter.saved()).toEqual([])
    })
})
