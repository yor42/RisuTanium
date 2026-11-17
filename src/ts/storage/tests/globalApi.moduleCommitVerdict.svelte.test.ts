/**
 * `moduleCommitVerdict` against the real store2 loop (Tauri kind, in-memory backend): read inside the next-commit
 * callback, it says whether the commit that fired the callback holds a module's change. A module the loop cannot encode
 * is `unsavable`; every other module is `blocked` while the set is carried whole (a refused stub, an unreadable set) and
 * `saved` otherwise. Mocked store; not native WebView evidence.
 *
 * Labels: new rule (the export is missing before the change); each row fails under a named mutant (M6, M7, M8).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { createWorldKit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall } from 'src/ts/storage/tests/store2/codecFixtures'
import { moduleStubOf } from 'src/ts/storage/store2/moduleStubMatch'
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
type Verdict = 'saved' | 'unsavable' | 'blocked'

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
    worlds.parkAll()
    vi.restoreAllMocks()
})

const modulesOf = (db: Entry): Entry[] => db.modules as Entry[]
// A value JSON cannot store, and one that a reactive proxy can hold (a cyclic one would overflow the change effects).
const unstorable = (): bigint => 10n

interface Page {
    w: World
    k: Store2Kit
    db: Entry
}

/** Starts the loop over a live database that `arrange` has changed before the loop's first pass. */
async function startPage(seed: Database, arrange: (live: Entry, k: Store2Kit) => void, waitForClean = true): Promise<Page> {
    const live = JSON.parse(JSON.stringify(seed)) as Entry
    const k = await startStore2({ db: seed })
    arrange(live, k)
    h.db = live
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    w.start()
    await sleepReal(150)
    if (waitForClean) {
        // A page that stands on a held module never reads clean, so only the other pages wait for it.
        await settled(w)
    }
    return { w, k, db: h.db }
}

/** Marks the modules, asks for a save now, and reads the verdict of each id inside the callback of the commit that follows. */
async function verdictsAfterCommit(page: Page, ids: string[]): Promise<Record<string, Verdict>> {
    const read = new Promise<Record<string, Verdict>>((resolve) => {
        page.w.api.afterNextSaveCommit(() => {
            resolve(Object.fromEntries(ids.map((id) => [id, page.w.api.moduleCommitVerdict(id)])))
        })
    })
    page.w.marks.markDbWrite({ kind: 'setting', key: 'modules' })
    page.w.api.requestSaveNow()
    return read
}

const seedOf = (): Database => buildSmall(4)
const idOf = (db: Entry, index: number): string => String(modulesOf(db)[index].id)

describe('moduleCommitVerdict inside the next-commit callback', () => {
    test('N a clean module save: every module reads saved', async () => {
        const page = await startPage(seedOf(), () => {})
        const ids = modulesOf(page.db).map((_, index) => idOf(page.db, index))
        modulesOf(page.db)[0].name = 'renamed'
        expect(await verdictsAfterCommit(page, ids)).toEqual(Object.fromEntries(ids.map((id) => [id, 'saved'])))
    })

    test('N a skipped module reads unsavable, and the others saved', async () => {
        const page = await startPage(seedOf(), () => {})
        const ids = modulesOf(page.db).map((_, index) => idOf(page.db, index))
        modulesOf(page.db)[1].cyc = unstorable()
        const verdicts = await verdictsAfterCommit(page, ids)
        expect(verdicts).toEqual({ [ids[0]]: 'saved', [ids[1]]: 'unsavable', [ids[2]]: 'saved', [ids[3]]: 'saved' })
    })

    test('N a module set that cannot be told from another: the faulting id reads unsavable, the others blocked', async () => {
        const seed = seedOf()
        modulesOf(seed as unknown as Entry)[1].id = modulesOf(seed as unknown as Entry)[0].id
        const page = await startPage(seed, (live) => {
            modulesOf(live).splice(0, 1)
            modulesOf(live)[0].cyc = unstorable()
        }, false)
        const faulted = idOf(page.db, 0)
        const others = [idOf(page.db, 1), idOf(page.db, 2)]
        const verdicts = await verdictsAfterCommit(page, [faulted, ...others])
        expect(verdicts).toEqual({ [faulted]: 'unsavable', [others[0]]: 'blocked', [others[1]]: 'blocked' })
    })

    test('N an edited stub after a clean commit: the stub reads unsavable and the others blocked, from the commit that fired the callback', async () => {
        const page = await startPage(seedOf(), () => {})
        const ids = modulesOf(page.db).map((_, index) => idOf(page.db, index))
        modulesOf(page.db)[2].name = 'renamed'
        expect(Object.values(await verdictsAfterCommit(page, ids)).every((verdict) => verdict === 'saved')).toBe(true)

        const entry = page.k.context.previous.objects?.moduleIndex?.entries[0]
        if (entry === undefined) {
            throw new Error('The seeded tree holds no module index.')
        }
        modulesOf(page.db)[0] = { ...(moduleStubOf(entry) as unknown as Entry), name: 'Edited module' }
        const verdicts = await verdictsAfterCommit(page, ids)
        expect(verdicts).toEqual({ [ids[0]]: 'unsavable', [ids[1]]: 'blocked', [ids[2]]: 'blocked', [ids[3]]: 'blocked' })
    })
})
