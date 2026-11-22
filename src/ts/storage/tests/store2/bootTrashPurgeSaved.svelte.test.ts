/**
 * The boot purge of expired trash over the real save loop and the real change effects on an active store2 session whose
 * store is an in-memory backend. The purge only shortens the in-memory character list and marks nothing; what saves it
 * is the boot's first pass (the change effects schedule one on their first run) and that every pass builds the manifest
 * from the live list. What this pins: the purged character is gone from the stored profile once the boot settles, so the
 * next boot does not load it again, and a boot with nothing to purge writes nothing. A boot that left the shortened list
 * in memory only would fail here. A mocked success here is not evidence of native backend behaviour.
 *
 * Labels: (G) compatibility guards, passing before and after: no application code changes with them.
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

/** Two characters, the second one trashed long past the retention period, unless `expired` is false. */
function profileWithTrash(expired: boolean): { db: Database, trashedId: string } {
    const db = buildSmall(2)
    const trashed = db.characters[1] as unknown as Entry
    trashed.trashTime = expired ? 1 : Date.now()
    // As in a real profile: trashing took the id out of the order.
    db.characterOrder = (db.characterOrder ?? []).filter((id) => id !== trashed.chaId)
    return { db, trashedId: trashed.chaId as string }
}

/**
 * The boot order: the store is seeded from `db`, the purge runs on the loaded database as `checkNewFormat` does (it
 * marks no write), then the reactive state is installed over it and the loop starts.
 */
async function startPage(db: Database): Promise<Page> {
    h.db = db as unknown as Entry
    const k = await startStore2({ db, lists: createListDerivation() })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const { isTrashPurgeDue } = await import('src/ts/storage/trashPurge')
    const loaded = h.db as unknown as Database
    loaded.characters = loaded.characters.filter((c) => !isTrashPurgeDue(c.trashTime, Date.now()))
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    w.start()
    await sleepReal(150)
    return { w, k }
}

const storedIds = async (k: Store2Kit): Promise<unknown[]> => (await k.saved()).characters.map((c) => (c as Entry).chaId)

describe('the boot purge of expired trash, over the real save loop on a store2 session', () => {
    test('(G) the purged character is gone from the store once the boot settles, and nothing more is written', async () => {
        const { db, trashedId } = profileWithTrash(true)
        const page = await startPage(db)
        await settled(page.w)

        expect(await storedIds(page.k)).not.toContain(trashedId)
        expect(await storedIds(page.k)).toHaveLength(1)

        const mark = page.k.memory.snapshot()
        await sleepReal(300)
        await settled(page.w)
        expect(page.k.writtenSince(mark)).toEqual([])
    })

    test('(G) a boot with a trashed character that is not yet due keeps it and writes nothing', async () => {
        const { db, trashedId } = profileWithTrash(false)
        const page = await startPage(db)
        const mark = page.k.memory.snapshot()
        await sleepReal(300)
        await settled(page.w)

        expect(page.k.writtenSince(mark)).toEqual([])
        expect(await storedIds(page.k)).toContain(trashedId)
    })
})