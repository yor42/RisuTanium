/**
 * CHORE-687 TW2: the page's `requestNetSweep` wakes the store2 loop. Runs the real loop over the in-memory kit with every
 * loop sleep parked (a hidden page may run no timer): a hide or Back sweep must still reach an edit that raised no mark,
 * through the sweep's module-scope full tick, without a save request. Mocked store; not native WebView evidence.
 * Labels: regression reproducer (before the wake, the sweep only set a flag that a parked loop never read).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { createWorldKit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall } from 'src/ts/storage/tests/store2/codecFixtures'
import type { Database } from 'src/ts/storage/database.svelte'

vi.setConfig({ testTimeout: 40_000 })

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'android' }))

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
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
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
    vi.useRealTimers()
    worlds.parkAll()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

function characters(db: Entry): Entry[] {
    return db.characters as Entry[]
}

async function startPage(db: Database, idleNet: Store2Kit['context']['idleNet']): Promise<{ w: World, k: Store2Kit, db: Entry }> {
    h.db = db as unknown as Entry
    const k = await startStore2({ db, idleNet })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    w.start()
    await sleepReal(150)
    return { w, k, db: h.db }
}

describe('a hide or Back sweep wakes a parked idle loop', () => {
    test('TW2 an edit that raised no mark is saved by the sweep with no timer firing and no save request', async () => {
        const page = await startPage(buildSmall(1), { intervalMs: 60_000 })
        await settled(page.w)
        // The wall clock is held, so no idle slot is due by time, and every loop sleep is parked.
        vi.useFakeTimers({ toFake: ['Date'] })
        h.parked.add(page.w.id)
        await sleepReal(200)

        characters(page.db)[0].personality = 'an edit with no mark'
        expect(page.w.api.hasUnsavedSaveMarks()).toBe(false)
        await sleepReal(300)
        expect(((await page.k.saved()).characters[0] as unknown as Entry).personality).not.toBe('an edit with no mark')

        page.w.api.requestNetSweep()
        expect(page.w.api.hasUnsavedSaveMarks()).toBe(false)

        await until(async () => ((await page.k.saved()).characters[0] as unknown as Entry).personality === 'an edit with no mark', 'the sweep tick to save the edit', 6000)
        expect(page.w.api.hasUnsavedSaveMarks()).toBe(false)
    })
})
