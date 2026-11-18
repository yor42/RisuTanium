/**
 * The boot's preset id minting over the real save loop and the real change effects on an active store2 session whose
 * store is an in-memory backend. What this pins: ids minted in memory for id-less presets are written by the boot's
 * normal save once the boot marks the write (`markBootWrite` after `takePresetIdsMinted`), they are written once, and a
 * reload reads the same ids back; a tab that is not the owner of the store's head (a peer committed first) writes
 * nothing over the peer's ids and is asked instead. It claims no production placement of the mark. A mocked success
 * here is not evidence of native backend behaviour.
 *
 * Labels: (N) a new rule of the feature, no mutant of the feature is killed by it; (G) passes before and after.
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
    /** The ids the boot minted in memory, in list order. */
    minted: unknown[]
}

/** A database whose presets carry no id: the boot has to mint them. */
function idlessProfile(): Database {
    const db = buildSmall(2)
    for (const preset of db.botPresets) {
        Reflect.deleteProperty(preset, 'id')
    }
    return db
}

/**
 * The boot order: the store is seeded from `db`, `beforeStart` may act as another tab, the ids are minted on the loaded
 * database and the boot marks its write when something was minted, then the reactive state is installed over it and the
 * loop starts.
 */
async function startPage(db: Database, beforeStart: (k: Store2Kit) => Promise<void> = async () => { }): Promise<Page> {
    h.db = db as unknown as Entry
    const k = await startStore2({ db, lists: createListDerivation() })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    await beforeStart(k)
    const { assignPresetIds, takePresetIdsMinted } = await import('src/ts/storage/presetMeta')
    const { markBootWrite } = await import('src/ts/bootWindow')
    const loaded = h.db as unknown as Database
    assignPresetIds(loaded)
    if (takePresetIdsMinted()) {
        markBootWrite()
    }
    const minted = loaded.botPresets.map((preset) => preset.id)
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    w.start()
    await sleepReal(150)
    return { w, k, minted }
}

describe('the boot preset id minting, over the real save loop on a store2 session', () => {
    test('(G) ids minted before the loop starts are written once and a reload reads the same ids; passes with or without the boot mark', async () => {
        const page = await startPage(idlessProfile())
        await settled(page.w)

        expect(page.minted.length).toBeGreaterThan(0)
        for (const id of page.minted) {
            expect(typeof id).toBe('string')
        }
        expect(new Set(page.minted).size).toBe(page.minted.length)

        const saved = await page.k.saved()
        expect(saved.botPresets.map((preset) => preset.id)).toEqual(page.minted)

        const mark = page.k.memory.snapshot()
        await sleepReal(300)
        await settled(page.w)
        expect(page.k.writtenSince(mark)).toEqual([])

        // A reload reads the stored list: the ids are the same, and the boot has nothing left to mint.
        const reloaded = await page.k.saved()
        expect(reloaded.botPresets.map((preset) => preset.id)).toEqual(page.minted)
        const { assignPresetIds, takePresetIdsMinted } = await import('src/ts/storage/presetMeta')
        assignPresetIds(reloaded)
        expect(takePresetIdsMinted()).toBe(false)
        expect(reloaded.botPresets.map((preset) => preset.id)).toEqual(page.minted)
    })

    test('(G) a tab whose head was moved by a peer writes nothing over the peer\'s ids and is asked instead', async () => {
        const peerIds = ['peer-id-0', 'peer-id-1', 'peer-id-2', 'peer-id-3']
        const page = await startPage(idlessProfile(), async (k) => {
            await peerCommit(k, (peerDb) => {
                peerDb.botPresets.forEach((preset, index) => { preset.id = peerIds[index] })
            })
        })
        const mark = page.k.memory.snapshot()

        await until(() => page.k.peer.asked.length + page.k.peer.clean.length >= 1, 'the peer double to be told')
        expect(page.k.peer.asked).toHaveLength(1)
        expect(page.k.peer.clean).toHaveLength(0)

        expect(page.k.writtenSince(mark)).toEqual([])
        const saved = await page.k.saved()
        expect(saved.botPresets.map((preset) => preset.id)).toEqual(peerIds)
    })
})
