/**
 * The boot's connections migration over the real save loop and the real change effects on an active store2 session whose
 * store is an in-memory backend. What this pins: a legacy-key profile whose presets already hold ids, migrated on the loaded
 * database and marked for the boot write (`markBootWrite` after `takeConnectionsMigrated`), has its `connections` written
 * to the saved config once, with the legacy key cleared, and a reload's migration finds nothing left to absorb. It claims no
 * production placement of the mark (the production boot is exercised by `bootstrap.connectionsBootWrite.test.ts`). A mocked
 * success here is not evidence of native backend behaviour.
 *
 * Post-fix file: it imports the connections migration by value. Keys are synthetic.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { createWorldKit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall } from 'src/ts/storage/tests/store2/codecFixtures'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
import type { Database, StoredDatabase } from 'src/ts/storage/database.svelte'

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

/** A profile whose presets carry ids (so nothing is minted) and whose OpenAI key is a legacy field. */
function legacyKeyProfile(): Database {
    const db = buildSmall(2)
    ;(db as unknown as Record<string, unknown>).openAIKey = 'sk-a'
    return db
}

/** The boot order: the store is seeded, the loaded database is migrated and the boot marks its write, then the loop starts. */
async function startPage(db: Database): Promise<Page> {
    h.db = db as unknown as Entry
    const k = await startStore2({ db, lists: createListDerivation() })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const { migrateConnectionsOnLoad, takeConnectionsMigrated } = await import('src/ts/connections/migrate')
    const { markBootWrite } = await import('src/ts/bootWindow')
    takeConnectionsMigrated()
    migrateConnectionsOnLoad(h.db as unknown as StoredDatabase)
    if (takeConnectionsMigrated()) {
        markBootWrite()
    }
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    w.start()
    await sleepReal(150)
    return { w, k }
}

describe('the boot connections migration, over the real save loop on a store2 session', () => {
    test('T6s: the migrated connections are written once, the legacy key is cleared, and a reload has nothing to absorb', async () => {
        const page = await startPage(legacyKeyProfile())
        await settled(page.w)

        const saved = await page.k.saved() as unknown as StoredDatabase
        expect(saved.connections).toContainEqual(expect.objectContaining({ provider: 'openai', key: 'sk-a' }))
        expect(saved.openAIKey).toBe('')

        const mark = page.k.memory.snapshot()
        await sleepReal(300)
        await settled(page.w)
        expect(page.k.writtenSince(mark)).toEqual([])

        const { migrateConnections } = await import('src/ts/connections/migrate')
        const reloaded = await page.k.saved() as unknown as StoredDatabase
        expect(migrateConnections(reloaded)).toBe('none')
    })
})
