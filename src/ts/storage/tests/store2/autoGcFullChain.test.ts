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
 * Rows of the reference table this database produces: the commit key's key positions and the manifest, shard, module index
 * and plugin-storage bucket positions below them, down to the units of a character's chats and a plugin value (the test
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
import { encodeUnit, keyOfTail, newUnitKey, readUnit, refsOf, UNIT_TYPE, type UnitType } from 'src/ts/storage/store2/format'
import type { MemoryBackend } from 'src/ts/storage/store2/backend'
import { readTree } from 'src/ts/storage/store2/tree'
import type { Database } from 'src/ts/storage/database.svelte'
import { flushConfirming } from './flushConfirmBackend'

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

const CHILD_TYPE: Readonly<Record<string, UnitType>> = {
    'shards[]': UNIT_TYPE.shard,
    'fixed.moduleIndex': UNIT_TYPE.moduleIndex,
    'fixed.pluginStorage.refs[]': UNIT_TYPE.pluginStorageBucket,
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
        const type = CHILD_TYPE[target.path]
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
        for (const type of ['manifest', 'shard', 'moduleIndex', 'pluginStorageBucket', 'pluginStorageValue']) {
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
                gcPageFacts: { isBusy: () => false, saveLoopParked: () => false, isSaveClean: () => true },
            },
        )
        expect(started).not.toBeNull()
        ;(fire as (() => void) | null)?.()
        await getStartupCleanup()
        w.pageMode.setPageStorageMode({ kind: 'block' })

        expect(info.mock.calls.map(call => String(call[0]))).toHaveLength(1)
        expect(String(info.mock.calls[0][0])).toContain(`status=done deleted=${deadKeys.size}`)
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
})
