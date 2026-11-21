/**
 * The decisive guard of the automatic clean-up: the maintenance step's pass over a store that the REAL, unmocked save loop
 * filled. The loop commits the same way the application does (the store2 save loop over a reactive `DBState`, the real
 * encoder and committer, `kit.clock` driving the admission window), so the store holds what the application leaves behind:
 * manifests that were never admitted to `retained`, manifests evicted from it, a manifest kept alive by a pin, the units
 * of a character the page holds as a stub, and units that nothing names.
 *
 * Label: guard plus reproducer. Its orphan and dropped-tree clauses are red on the base (no pass exists there). Its
 * invariant clauses (every unit of the current, retained and pinned trees survives; every stub still loads) pass before
 * and after and are proven by the mark mutant (a reference kind left out of the mark's walk in `gc/mark.ts`).
 *
 * Module graphs: `kit.memory` belongs to this file's graph, while `maintenance`, `autoGc` and `gcPass` belong to the
 * world's, so a conflict error thrown by the file-graph backend would not be recognised by the pass. The save loop is
 * therefore quiescent while the pass runs: no commit is in flight and the test awaits `settled` before the trigger.
 *
 * Rows of the reference table this database produces: the commit key's key positions and the manifest, shard, module index,
 * module bucket and plugin-storage bucket positions below them, down to the units of a character's chats and a plugin value (the test
 * asserts the unit types the named trees hold). `legacyKeep` cannot come from this encoder (it writes null), and
 * `gcMark.test.ts` covers that row. Mocked storage here says nothing about a native backend.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { incompressible, makeCharacter, makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { peerPin, startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { stubFromEntry } from 'src/ts/storage/store2/codec'
import { ADMISSION_INTERVAL_MS } from 'src/ts/storage/store2/commit'
import { RETAINED_MAX } from 'src/ts/storage/store2/commitKey'
import { encodeUnit, keyOfTail, newUnitKey, readUnit, refsOf, UNIT_TYPE } from 'src/ts/storage/store2/format'
import type { MemoryBackend } from 'src/ts/storage/store2/backend'
import { readTree } from 'src/ts/storage/store2/tree'
import type { Database } from 'src/ts/storage/database.svelte'
import type { MaintenanceSeams } from 'src/ts/storage/store2/maintenance'
import { TEST_DESCENT } from './descentTable'
import { flushConfirming, nodeWorld, plantSeenUnits } from './flushConfirmBackend'

// The line a sweep logs when its page yields before listing anything (`shouldStop: () => true`).
const SWEEP_YIELDED = 'store2 asset sweep: status=done phase=none candidates=0 deleted=0 failed=0 kept-live=0 batches=0 recorded=false stopped=yielded'

// The line the inlay sweep logs when its page yields before listing anything (`shouldStop: () => true`).
const INLAY_YIELDED = 'store2 inlay sweep: status=done candidates=0 deleted=0 bodies=0 failed=0 kept-live=0 kept-legacy=0 batches=0 stopped=yielded'

// The inlay sweep follows the asset sweep; these cases are about the clean-up, so its page yields at once.
const QUIET_INLAYS: MaintenanceSeams['inlayFacts'] = {
    shouldStop: () => true, saveMarks: () => 0, writtenThisPage: () => false,
    legacyInlayIds: async () => [], residentInlays: async () => null, lock: (_id, work) => work(),
}

vi.setConfig({ testTimeout: 60_000 })

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

beforeEach(() => {
    vi.clearAllMocks()
    // The real effects: `saveLoopMocks.svelte.ts` replaces them, and an edit is noticed only by them.
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    // The factory runs inside the world's graph, so the reactive state and the effects share one Svelte runtime.
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
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(() => {
    kit.parkAll()
    vi.doMock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }))
    vi.doUnmock('src/ts/process/index.svelte')
    vi.doUnmock('src/ts/process/coldstorage.svelte')
    vi.restoreAllMocks()
})

/** The database every tree of this test holds besides the stub: characters, modules, a preset and plugin storage. */
function baseDb(): Record<string, unknown> {
    const db = makeDb('p', ['a', 'b'])
    db.modules = Array.from({ length: 3 }, (_, i) => ({
        id: `module-${i}`,
        name: `module ${i}`,
        lorebook: [{ key: 'k', comment: 'c', content: incompressible(2000).replace(/^./, String(i)) }],
    }))
    db.pluginCustomStorage = { _coldplugin: { 'slot-0': 'unit-0' }, 'unit-0': incompressible(2000) }
    return db
}

interface ChainWorld {
    w: World
    k: Store2Kit
    live: Entry
    flush: () => void
}

/**
 * The store is seeded from the full database; the live database holds the character 'x' as the stub of its entity and booted
 * it as a stub, so the real cold-storage reader serves its load from the store2 units.
 */
async function startChain(): Promise<ChainWorld> {
    const full = makeCharacter('x')
    full.chats = [{ id: 'x-chat', message: [{ role: 'char', data: incompressible(50_000), time: 1 }], note: '', name: '', localLore: [] }]
    const stored = baseDb()
    ;(stored.characters as unknown[]).unshift(JSON.parse(JSON.stringify(full)))
    h.db = baseDb()
    vi.doUnmock('src/ts/process/coldstorage.svelte')
    // The reader pulls in the chat pipeline for `doingChat` only; the world's graph gets that store alone.
    vi.doMock('src/ts/process/index.svelte', async () => {
        const { writable } = await import('svelte/store')
        return { doingChat: writable(false) } as unknown as typeof import('src/ts/process/index.svelte')
    })
    const k = await startStore2({ db: stored as unknown as Database, stubs: ['x'] })
    const w = await kit.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    const { flushSync } = await import('svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    // The page holds the stub of the entity the seeded tree holds for the character.
    const u = k.context.previous.entities.get('x#0') as string
    const entry = k.residency.entryOf(u)
    if (entry === null) {
        throw new Error('The seeded tree holds no entity for the character.')
    }
    ;(h.db.characters as Entry[]).unshift(stubFromEntry(entry) as Entry)
    w.start()
    await sleepReal(150)
    await settled(w)
    return { w, k, live: h.db, flush: flushSync }
}

const TYPE_NAME: ReadonlyMap<number, string> = new Map(Object.entries(UNIT_TYPE).map(([name, id]) => [id, name]))

/** Every unit key a stored manifest names, by an independent walk over `refsOf` (not the collector's mark). */
async function treeKeys(memory: MemoryBackend, manifestKey: string): Promise<Set<string>> {
    const keys = new Set<string>([manifestKey])
    const bytes = (await memory.readUnits([manifestKey])).get(manifestKey) ?? null
    const manifest = bytes === null ? null : readUnit(bytes, UNIT_TYPE.manifest)
    if (manifest === null || manifest.status !== 'ok') {
        throw new Error(`The manifest ${manifestKey} is not readable.`)
    }
    for (const target of refsOf(UNIT_TYPE.manifest, manifest.value.body)) {
        const key = keyOfTail(target.tail)
        keys.add(key)
        const type = TEST_DESCENT[target.path]
        if (type === undefined) {
            continue
        }
        const childBytes = (await memory.readUnits([key])).get(key) ?? null
        const child = childBytes === null ? null : readUnit(childBytes, type)
        if (child === null || child.status !== 'ok') {
            throw new Error(`The unit ${key} is not readable.`)
        }
        for (const leaf of refsOf(type, child.value.body)) {
            keys.add(keyOfTail(leaf.tail))
        }
    }
    return keys
}

describe('the automatic clean-up over a store the real save loop filled', () => {
    test('A3: the pass deletes exactly the orphans and the units of dropped and evicted trees; every named tree and every stub survives', async () => {
        const { w, k, live, flush } = await startChain()
        const history: string[] = [k.seeded.manifestKey]
        const everRetained = new Set<string>()
        let edits = 0
        async function edit(): Promise<void> {
            edits++
            await nextCommit(w, () => {
                live.mainPrompt = `prompt-${edits}`
                flush()
            })
            const key = await k.commitKey()
            history.push((key.current as { key: string }).key)
            for (const entry of key.retained) {
                everRetained.add(entry.key)
            }
        }

        // Each interval: the first two commits admit their predecessors (the window opens with the advance), the third and
        // later ones are dropped at once. More than RETAINED_MAX admissions evict the oldest retained entries.
        let pinned = ''
        for (let interval = 0; interval < 13; interval++) {
            k.clock.advance(ADMISSION_INTERVAL_MS + 1)
            await edit()
            await edit()
            if (interval === 3) {
                // Current after two commits since the advance, followed by one more before the next advance: never admitted.
                await peerPin(k)
                pinned = (await k.commitKey()).current?.key as string
            }
            await edit()
        }
        await settled(w)

        const key = await k.commitKey()
        const current = key.current?.key as string
        const retained = key.retained.map(entry => entry.key)
        const pins = key.pins.map(pin => pin.key)
        const named = new Set([current, ...retained, ...pins])
        const dropped = history.filter(manifest => !named.has(manifest) && !everRetained.has(manifest))
        const evicted = [...everRetained].filter(manifest => !named.has(manifest))
        expect(dropped.length, 'precondition: manifests that were never admitted exist').toBeGreaterThan(0)
        expect(evicted.length, 'precondition: a manifest was evicted from retained').toBeGreaterThan(0)
        expect(pins, 'precondition: the pin is held').toContain(pinned)
        expect(retained, 'precondition: the pinned manifest is not retained').not.toContain(pinned)
        expect(retained, 'precondition: retained is full').toHaveLength(RETAINED_MAX)

        const orphans: string[] = []
        for (let i = 0; i < 6; i++) {
            const orphan = newUnitKey(k.context.env)
            await k.memory.putUnit(orphan, encodeUnit(UNIT_TYPE.preset, { v: 1, orphan }))
            orphans.push(orphan)
        }
        const namedKeys = new Set<string>()
        for (const manifest of named) {
            for (const unit of await treeKeys(k.memory, manifest)) {
                namedKeys.add(unit)
            }
        }
        const deadKeys = new Set<string>(orphans)
        for (const manifest of [...dropped, ...evicted]) {
            for (const unit of await treeKeys(k.memory, manifest)) {
                if (!namedKeys.has(unit)) {
                    deadKeys.add(unit)
                }
            }
        }
        expect(deadKeys.size, 'precondition: dropped trees own units of their own').toBeGreaterThan(orphans.length)
        const types = new Set<string>()
        const snapshot = k.memory.snapshot()
        for (const unit of namedKeys) {
            types.add(TYPE_NAME.get((snapshot.get(unit) as Uint8Array)[5]) ?? 'unknown')
        }
        for (const type of ['manifest', 'shard', 'moduleIndex', 'moduleBucket', 'module', 'pluginStorageBucket', 'pluginStorageValue']) {
            expect([...types], `precondition: the named trees hold a ${type} unit`).toContain(type)
        }

        // The pass runs through the maintenance step, in the world's graph, over a tauri session that confirms its flushes.
        const { Store2Session } = await import('src/ts/storage/store2/session')
        const { createMemoryByteStore } = await import('src/ts/process/files/tests/memoryByteStore')
        const maintenance = await import('src/ts/storage/store2/maintenance')
        const { getStartupCleanup } = await import('src/ts/storage/startupCleanupState')
        const over = flushConfirming(k.memory)
        const session = await Store2Session.open(createMemoryByteStore(), { kind: 'tauri', backend: over.backend, upstreamMainFile: async () => false })
        expect(session.decision).toMatchObject({ row: 5, mode: 'normal' })
        expect(session.idleReason).toBeNull()
        const info = vi.spyOn(console, 'info').mockImplementation(() => { })
        w.pageMode.setPageStorageMode({ kind: 'store2' })
        let fire: (() => void) | null = null
        const started = maintenance.startStore2Maintenance(
            { store: async () => createMemoryByteStore(), listBackupTimes: async () => [] },
            {
                session: () => session,
                startTrigger: run => { fire = run; return { arm: () => { }, stop: () => { } } },
                deletion: async () => ({ status: 'completed', deleted: 0, abandoned: 0, flushed: undefined }),
                gcPageFacts: {
                    isBusy: () => false, saveLoopParked: () => false, isSaveClean: () => true,
                    restoreInProgress: () => false, peers: async () => 'alone', ownBase: () => null,
                },
                // The asset sweep follows the clean-up; this case is about the clean-up, so the sweep's page yields at once.
                sweepFacts: {
                    residentRefs: () => [], writtenCount: () => 0, writtenThisPage: () => [], peers: async () => 'alone',
                    shouldStop: () => true, release: () => { }, hold: remove => remove(),
                },
                inlayFacts: QUIET_INLAYS,
            },
        )
        expect(started).not.toBeNull()
        ;(fire as (() => void) | null)?.()
        await getStartupCleanup()
        w.pageMode.setPageStorageMode({ kind: 'unset' })

        // The step logs exactly the clean-up line, then the asset sweep line, then the inlay sweep line.
        expect(info.mock.calls.map(call => String(call[0]))).toEqual([expect.stringContaining(`store2 clean-up: status=done deleted=${deadKeys.size} batches=`), SWEEP_YIELDED, INLAY_YIELDED])
        const after = new Set(await k.memory.listStore2())
        expect([...deadKeys].filter(unit => after.has(unit)), 'orphans and the units of dropped and evicted trees are gone').toEqual([])
        expect([...namedKeys].filter(unit => !after.has(unit)), 'every unit of the current, retained and pinned trees is present').toEqual([])
        expect([...after].filter(unit => !namedKeys.has(unit)), 'nothing else is left').toEqual([])
        for (const manifest of named) {
            expect((await readTree(k.memory, manifest)).status).toBe('ok')
        }

        // Every stub still loads: the character the page holds as a stub is served from the units the pass kept.
        const slot = () => (live.characters as Entry[]).find(character => character.chaId === 'x') as Entry
        expect(slot().coldstorage).toBeDefined()
        const { restoreColdCharacter } = await import('src/ts/process/coldCharacterRestore')
        const outcome = await restoreColdCharacter(slot() as never, { byChaId: true, quiet: true })
        flush()
        expect(outcome.status).toBe('restored')
        expect(((slot().chats as Entry[])[0].message as Entry[])[0].data).toHaveLength(50_000)
    })

    /**
     * A `node` page over the same units: the real loop filled the store (three edits after an admission advance leave a dropped
     * tree) and an orphan is planted; the store's files are then copied into one Node world, with an earlier pass's record
     * naming every dead unit as seen before. The pass runs through the maintenance step with the page facts of a Node page,
     * which logs exactly the clean-up line and then the asset sweep line (the inlay sweep is a Tauri step).
     */
    async function runNodeStep(facts: { alone: boolean, ownBase: 'current' | 'stale' }): Promise<{ k: Store2Kit, deleted: boolean, lines: string[], dead: string[], named: Set<string>, after: Set<string>, droppedBase: string, droppedUnits: string[] }> {
        const { w, k, live, flush } = await startChain()
        let edits = 0
        const history: string[] = [k.seeded.manifestKey]
        for (let i = 0; i < 3; i++) {
            if (i === 0) {
                k.clock.advance(ADMISSION_INTERVAL_MS + 1)
            }
            edits++
            await nextCommit(w, () => {
                live.mainPrompt = `web-${edits}`
                flush()
            })
            history.push(((await k.commitKey()).current as { key: string }).key)
        }
        await settled(w)
        const key = await k.commitKey()
        const current = (key.current as { key: string }).key
        const named = new Set<string>()
        for (const manifest of [current, ...key.retained.map(entry => entry.key), ...key.pins.map(pin => pin.key)]) {
            for (const unit of await treeKeys(k.memory, manifest)) {
                named.add(unit)
            }
        }
        const dead: string[] = []
        for (const manifest of history.filter(candidate => ![current, ...key.retained.map(entry => entry.key)].includes(candidate))) {
            for (const unit of await treeKeys(k.memory, manifest)) {
                if (!named.has(unit)) {
                    dead.push(unit)
                }
            }
        }
        const orphan = newUnitKey(k.context.env)
        await k.memory.putUnit(orphan, encodeUnit(UNIT_TYPE.preset, { v: 1, orphan }))
        dead.push(orphan)
        // Three edits after one admission advance: the first admits the seed, the later two commits' predecessors are dropped.
        // The stale base is a dropped manifest, so no list of the commit key reaches the units only it reaches.
        const droppedBase = history[2]
        const droppedUnits = [...await treeKeys(k.memory, droppedBase)].filter(unit => !named.has(unit))

        const { Store2Session } = await import('src/ts/storage/store2/session')
        const { createMemoryByteStore } = await import('src/ts/process/files/tests/memoryByteStore')
        const maintenance = await import('src/ts/storage/store2/maintenance')
        const { getStartupCleanup } = await import('src/ts/storage/startupCleanupState')
        const node = nodeWorld()
        for (const [unit, bytes] of k.memory.snapshot()) {
            await node.store.write(unit, bytes, 'unconditional')
        }
        await plantSeenUnits(node, dead)
        const session = await Store2Session.open(node.store, { kind: 'node', backend: node.backend, upstreamMainFile: async () => false })
        expect(session.decision).toMatchObject({ row: 5, mode: 'normal' })
        const info = vi.spyOn(console, 'info').mockImplementation(() => { })
        w.pageMode.setPageStorageMode({ kind: 'store2' })
        let fire: (() => void) | null = null
        maintenance.startStore2Maintenance(
            { store: async () => node.store, listBackupTimes: async () => [] },
            {
                session: () => session,
                startTrigger: run => { fire = run; return { arm: () => { }, stop: () => { } } },
                deletion: async () => ({ status: 'completed', deleted: 0, abandoned: 0, flushed: undefined }),
                gcPageFacts: {
                    isBusy: () => false, saveLoopParked: () => false, isSaveClean: () => true, restoreInProgress: () => false,
                    peers: async () => facts.alone ? 'alone' : 'others',
                    ownBase: () => facts.ownBase === 'current' ? current : droppedBase,
                },
                sweepFacts: {
                    residentRefs: () => [], writtenCount: () => 0, writtenThisPage: () => [], peers: async () => 'alone',
                    shouldStop: () => true, release: () => { }, hold: remove => remove(),
                },
                inlayFacts: QUIET_INLAYS,
            },
        )
        ;(fire as (() => void) | null)?.()
        await getStartupCleanup()
        w.pageMode.setPageStorageMode({ kind: 'unset' })
        const lines = info.mock.calls.map(call => String(call[0]))
        const after = new Set(await node.backend.listStore2())
        return { k, deleted: dead.every(unit => !after.has(unit)), lines, dead, named, after, droppedBase, droppedUnits }
    }

    test('A4a: a Node page that is alone on its own base collects the seen dropped tree and orphan, and keeps every named unit', async () => {
        const result = await runNodeStep({ alone: true, ownBase: 'current' })

        expect(result.dead.length, 'precondition: dead units exist').toBeGreaterThan(1)
        expect(result.lines).toEqual([expect.stringContaining(`store2 clean-up: status=done deleted=${result.dead.length} batches=`), SWEEP_YIELDED])
        expect(result.deleted).toBe(true)
        expect([...result.named].filter(unit => !result.after.has(unit))).toEqual([])
    })

    test('A4b: a Node page with another tab open deletes nothing', async () => {
        const others = await runNodeStep({ alone: false, ownBase: 'current' })

        expect(others.lines).toEqual([expect.stringContaining('store2 clean-up: status=refused reason=other-tab'), SWEEP_YIELDED])
        expect(others.dead.every(unit => others.after.has(unit))).toBe(true)
    })

    test('A4c: a Node page whose base is a dropped manifest deletes nothing, and every unit only that base reaches stays', async () => {
        const stale = await runNodeStep({ alone: true, ownBase: 'stale' })
        const key = await stale.k.commitKey()

        expect([(key.current as { key: string }).key, ...key.retained.map(entry => entry.key), ...key.pins.map(pin => pin.key)], 'precondition: the base is in no list of the commit key').not.toContain(stale.droppedBase)
        expect(stale.droppedUnits.length, 'precondition: the dropped base reaches units no named tree reaches').toBeGreaterThan(0)
        expect(stale.droppedUnits.every(unit => stale.dead.includes(unit)), 'precondition: those units are among the dead').toBe(true)
        expect(stale.lines).toEqual([expect.stringContaining('store2 clean-up: status=refused reason=stale-base'), SWEEP_YIELDED])
        expect(stale.droppedUnits.filter(unit => !stale.after.has(unit)), 'the dropped base\'s units are still stored').toEqual([])
        expect(stale.dead.every(unit => stale.after.has(unit))).toBe(true)
    })
})
