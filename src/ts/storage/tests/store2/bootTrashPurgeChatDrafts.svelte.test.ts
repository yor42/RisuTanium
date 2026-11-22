/**
 * The boot purge of expired trash followed by the boot reconcile of unsent message edits, over the real save loop and the real
 * change effects on a store2 session over an in-memory backend (the setup of `bootTrashPurgeSaved`). What this pins: after the
 * purge removes a trashed character, the reconcile drops that character's entries from the stored profile and keeps the
 * others, and a boot with nothing purged keeps every entry (a trashed character that is not yet due keeps its own). A boot
 * that purged the character and never reconciled would leave the entries in the stored profile and fail here. The call site in
 * `bootstrap.ts` is not covered by this test. A mocked success here is not evidence of native backend behaviour.
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

const storedIds = async (k: Store2Kit): Promise<unknown[]> => (await k.saved()).characters.map((c) => c.chaId)


type Entry2 = { cha: string, chat: string, drafts: { m: string, text: string, bh: string, at: number }[] }

function withDrafts(db: Database): Database {
    const chatOf = (index: number): string => (db.characters[index] as unknown as { chats: { id: string }[] }).chats[0].id
    const hold = (index: number): Entry2 => ({
        cha: db.characters[index].chaId as string,
        chat: chatOf(index),
        drafts: [{ m: 'id:m1', text: `draft ${index}`, bh: 'f'.repeat(32), at: 1 }],
    })
    ;(db as unknown as { chatDrafts: Entry2[] }).chatDrafts = [hold(0), hold(1)]
    return db
}

const storedDraftChars = async (k: Store2Kit): Promise<string[]> =>
    (((await k.saved()) as unknown as { chatDrafts?: Entry2[] }).chatDrafts ?? []).map((entry) => entry.cha)

/** The boot step after `assignIds`: the stores are loaded, so the reconcile runs on the live profile of the writable page. */
async function reconcileAsBootDoes(): Promise<void> {
    const { reconcileChatDraftsAtBoot } = await import('src/ts/chatDraftStore')
    reconcileChatDraftsAtBoot()
}

describe('the boot purge followed by the draft reconcile, over the real save loop on a store2 session', () => {
    test('T3.14: the purged entries are gone from the stored profile and the others are kept', async () => {
        const { db, trashedId } = profileWithTrash(true)
        const keptId = db.characters[0].chaId as string
        const page = await startPage(withDrafts(db))
        await settled(page.w)
        expect(await storedDraftChars(page.k)).toEqual([keptId, trashedId])

        await reconcileAsBootDoes()
        await settled(page.w)

        expect(await storedDraftChars(page.k)).toEqual([keptId])
    })

    test('a boot with a trashed character that is not yet due keeps every entry', async () => {
        const { db, trashedId } = profileWithTrash(false)
        const keptId = db.characters[0].chaId as string
        const page = await startPage(withDrafts(db))
        await settled(page.w)

        await reconcileAsBootDoes()
        await settled(page.w)

        expect(await storedDraftChars(page.k)).toEqual([keptId, trashedId])
    })
})
