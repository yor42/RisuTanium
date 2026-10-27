/**
 * The module step of the boot format check over the real save loop and the real change effects: `saveDb()` runs for real
 * over an active store2 session whose store is an in-memory backend, the module slots are a reactive `DBState`, and the
 * step is the real `repairModuleListLorebooks`. What this pins: a module whose lorebook needs migration is repaired in
 * place in the live list, the next pass writes that module's unit, and the stored unit decodes to the migrated lorebook.
 * A step that repaired a copy of a body, or left the repaired body out of the list the change effects watch, would leave
 * the stored lorebook in its old format. A mocked success here is not evidence of native backend behaviour.
 *
 * Labels: guard (passes before and after the change to the step; it fails for a step that repairs clones of the bodies).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { createWorldKit, nextCommit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
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
    // The shared save-loop mocks make the lorebook migration an identity; this case needs a migration that changes entries.
    vi.doMock('src/ts/characters', () => ({
        updateLorebooks: (book: Array<{ bookVersion?: number }>) => book.map((entry) => { entry.bookVersion = 2; return entry }),
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
    flush(): void
}

/**
 * `afterSeed` runs after the store was seeded from `db` and before the reactive state is installed over it, which is the
 * boot order: the repair changes the loaded database, and the first run of the change effects marks what it changed.
 */
async function startPage(db: Database, afterSeed: (db: Database, k: Store2Kit) => Promise<void>): Promise<Page> {
    h.db = db as unknown as Entry
    const k = await startStore2({ db, lists: createListDerivation() })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    await afterSeed(h.db as unknown as Database, k)
    const stores = await import('src/ts/stores.svelte')
    const { flushSync } = await import('svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    w.start()
    await sleepReal(150)
    return { w, k, db: h.db, flush: flushSync }
}

function bookVersionsOf(modules: Entry[]): Array<number | undefined> {
    return modules.flatMap((module) => (module.lorebook as Array<{ bookVersion?: number }>).map((entry) => entry.bookVersion))
}

describe('the module step of the boot format check, over the real save loop', () => {
    test('guard: a lorebook migrated by the step is written by the next pass and the stored module unit decodes to the migrated lorebook', async () => {
        let mark: ReturnType<Store2Kit['memory']['snapshot']> | undefined
        let versionsBefore: Array<number | undefined> = []
        let storedBefore: Entry[] = []
        const page = await startPage(buildSmall(2), async (db, k) => {
            const { repairModuleListLorebooks } = await import('src/ts/process/moduleLorebookRepair')
            storedBefore = (await k.saved()).modules as unknown as Entry[]
            versionsBefore = bookVersionsOf(storedBefore)
            mark = k.memory.snapshot()
            await repairModuleListLorebooks(db)
        })
        expect(versionsBefore.length).toBeGreaterThan(0)
        expect(versionsBefore.every((version) => !(version !== undefined && version >= 2))).toBe(true)
        await settled(page.w)

        expect(page.k.writtenSince(mark!)).toContain('module')
        const storedAfter = (await page.k.saved()).modules as unknown as Entry[]
        expect(storedAfter).toHaveLength(storedBefore.length)
        const versionsAfter = bookVersionsOf(storedAfter)
        expect(versionsAfter).toHaveLength(versionsBefore.length)
        expect(versionsAfter.every((version) => version !== undefined && version >= 2)).toBe(true)
        expect(bookVersionsOf(page.db.modules as Entry[]).every((version) => version !== undefined && version >= 2)).toBe(true)
    })
})
