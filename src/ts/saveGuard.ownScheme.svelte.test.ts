/**
 * Both branches of `showSaveFailure` in `globalApi.svelte.ts` raise their error alert with `ownScheme: 'saveGuard'`:
 * the described alert (a commit the storage could not confirm, after the fifth failed pass) and the raw alert (an
 * unmapped error, after the fifth failed pass). The real `saveDb()` runs over an active store2 session, as in
 * `globalApi.saveStore2.svelte.test.ts`, whose harness this file repeats. Every test is a compatibility guard: the
 * flag is new, so none fails for a defect that existed before it. A mocked success here is not evidence of native
 * backend behaviour.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { createWorldKit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall } from 'src/ts/storage/tests/store2/codecFixtures'
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
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    // The state and the effects must share one Svelte runtime, so the factory runs inside the world's graph.
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
    db: Entry
}

function characters(db: Entry): Entry[] {
    return db.characters as Entry[]
}

/** Starts the loop of a store2 session over a reactive `DBState`, as the application runs it. */
async function startPage(db: Database, hooks: NonNullable<Parameters<typeof startStore2>[0]['hooks']>): Promise<Page> {
    h.db = db as unknown as Entry
    const k = await startStore2({ db, hooks })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    const page: Page = { w, k, db: h.db }
    w.start()
    await sleepReal(150)
    return page
}

describe('showSaveFailure raises its error alerts with the save-guard flag', () => {
    test('the described alert: a commit the storage could not confirm, after the fifth failed pass', async () => {
        const page = await startPage(buildSmall(4), {
            flushed: (name) => name === 'commitOrdinary' ? false : undefined,
        })
        const { alertStore } = await import('src/ts/alert')
        const setAlert = vi.spyOn(alertStore, 'set')
        characters(page.db)[0].personality = 'unflushed edit'
        page.w.marks.markCharacterForSave(characters(page.db)[0].chaId)
        await until(() => setAlert.mock.calls.some(([alert]) => alert.type === 'error'), 'the error alert after the fifth failed pass', 20000)
        const shown = setAlert.mock.calls.map(([alert]) => alert).find((alert) => alert.type === 'error')
        expect(shown?.ownScheme).toBe('saveGuard')
        await settled(page.w).catch(() => { })
    })

    test('the raw alert: an unmapped error, after the fifth failed pass', async () => {
        const page = await startPage(buildSmall(4), {
            before: (name) => {
                if (name === 'commitOrdinary') {
                    throw new Error('the storage refused the commit')
                }
            },
        })
        const { alertError } = await import('src/ts/alert')
        characters(page.db)[0].personality = 'refused edit'
        page.w.marks.markCharacterForSave(characters(page.db)[0].chaId)
        await until(() => vi.mocked(alertError).mock.calls.length > 0, 'the raw error alert after the fifth failed pass', 20000)
        const [raised, options] = vi.mocked(alertError).mock.calls[0]
        expect(raised).toBeInstanceOf(Error)
        expect(options).toEqual({ ownScheme: 'saveGuard' })
    })
})
