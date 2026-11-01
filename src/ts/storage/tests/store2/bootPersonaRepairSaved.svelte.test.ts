/**
 * The boot persona repair over the real save loop and the real change effects on an active store2 session whose store is
 * an in-memory backend. What this pins: a repaired persona list is written by the boot's normal save once the boot marks
 * it (`markBootWrite`), and a tab that is not the owner of the store's head (a peer committed first) writes nothing and
 * is asked instead. A repair that only changed the in-memory list, or a tab that committed over a peer, would fail here.
 * A mocked success here is not evidence of native backend behaviour.
 *
 * Labels: (R) fails against a boot that does not repair the list; (G) passes before and after the change.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { createWorldKit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { peerCommit, startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall } from 'src/ts/storage/tests/store2/codecFixtures'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
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
}

/** A database whose persona list the boot has to repair: the stored list is empty. */
function brokenProfile(): Database {
    const db = buildSmall(2)
    db.personas = []
    db.selectedPersona = 0
    return db
}

/**
 * The boot order: the store is seeded from `db`, `beforeStart` may act as another tab, the repair and the boot mark run
 * on the loaded database, then the reactive state is installed over it and the loop starts.
 */
async function startPage(db: Database, beforeStart: (k: Store2Kit) => Promise<void> = async () => { }): Promise<Page> {
    h.db = db as unknown as Entry
    const k = await startStore2({ db, lists: createListDerivation() })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    await beforeStart(k)
    const { repairPersonas } = await import('src/ts/storage/characterTreeRepair')
    const { markBootWrite } = await import('src/ts/bootWindow')
    const loaded = h.db as unknown as Database
    repairPersonas(loaded)
    loaded.personas = loaded.personas.map((persona) => {
        persona.id ??= 'repaired-persona'
        return persona
    })
    markBootWrite()
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    w.start()
    await sleepReal(150)
    return { w, k }
}

describe('the boot persona repair, over the real save loop on a store2 session', () => {
    test('(R) the repaired persona list is written by the boot\'s normal save, once', async () => {
        const page = await startPage(brokenProfile())
        await settled(page.w)

        const saved = await page.k.saved()
        expect(saved.personas).toHaveLength(1)
        expect(saved.selectedPersona).toBe(0)
        expect(typeof saved.personas[0].id).toBe('string')

        const mark = page.k.memory.snapshot()
        await sleepReal(300)
        await settled(page.w)
        expect(page.k.writtenSince(mark)).toEqual([])
    })

    test('(G) a tab whose head was moved by a peer writes nothing and is asked instead', async () => {
        const page = await startPage(brokenProfile(), async (k) => {
            await peerCommit(k, (peerDb) => { peerDb.globalNote = 'the peer edit' })
        })
        const mark = page.k.memory.snapshot()

        await until(() => page.k.peer.asked.length + page.k.peer.clean.length >= 1, 'the peer double to be told')
        expect(page.k.peer.asked).toHaveLength(1)
        expect(page.k.peer.clean).toHaveLength(0)

        expect(page.k.writtenSince(mark)).toEqual([])
        const saved = await page.k.saved()
        expect(saved.personas).toHaveLength(0)
        expect(saved.globalNote).toBe('the peer edit')
    })
})
