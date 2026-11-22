/**
 * Unsent message edits over the real store2 save loop (Tauri kind, in-memory backend) and the real change effects, with the
 * loop sleeps parked where a hidden page's timers would stop. What this pins: a hide writes the draft into the profile and
 * lands the effect's mark before the save request (one commit, the page clean right after it, no second commit); a save or
 * a discard reaches the committed tree. Mocked store; not native WebView evidence.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { createWorldKit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall } from 'src/ts/storage/tests/store2/codecFixtures'
import { COMMIT_KEY } from 'src/ts/storage/store2/format/keys'
import { readUnit, UNIT_TYPE, type Manifest } from 'src/ts/storage/store2/format'
import type { ChatDraftEntry, Database } from 'src/ts/storage/database.svelte'
import type { MessageIdentity } from 'src/ts/draftContents'

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
type Message = { data: string, chatId?: string }

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
    Reflect.deleteProperty(document, 'visibilityState')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

function setVisibility(state: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

function characters(db: Entry): Entry[] {
    return db.characters as Entry[]
}

async function startPage(db: Database): Promise<{ w: World, k: Store2Kit, db: Entry }> {
    h.db = db as unknown as Entry
    const k = await startStore2({ db })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    w.start()
    await sleepReal(150)
    return { w, k, db: h.db }
}

/** The page's modules, loaded in the world's own graph so the sink and the gate share the loop's reactive state. */
async function draftModules() {
    const gate = await import('src/ts/draftContentOrphanGate')
    const store = await import('src/ts/chatDraftStore')
    const hide = await import('src/ts/process/saveOnHide')
    return { gate: gate.draftContentOrphanGate, store, hide }
}

function identityOf(page: { db: Entry }, chatId: string): MessageIdentity {
    const owner = characters(page.db)[2] as { chaId: string, chats: { id: string }[] }
    return { kind: 'msg', chatKey: 'window', chatId, index: 1, persist: { chaId: owner.chaId, chatId: owner.chats[0].id } }
}

const draftsOf = async (k: Store2Kit): Promise<ChatDraftEntry[]> => ((await k.saved()) as unknown as { chatDrafts?: ChatDraftEntry[] }).chatDrafts ?? []
const messageOf = async (k: Store2Kit, chatId: string): Promise<Message | undefined> =>
    (((await k.saved()).characters[2] as unknown as { chats: { message: Message[] }[] }).chats[0].message).find((message) => message.chatId === chatId)
const commitCount = (k: Store2Kit): number => k.counted.writes.filter((write) => write.key === COMMIT_KEY).length

async function currentManifest(k: Store2Kit): Promise<Manifest> {
    const key = await k.commitKey()
    const bytes = k.memory.snapshot().get((key.current as { key: string }).key)
    const parsed = readUnit(bytes as Uint8Array, UNIT_TYPE.manifest)
    if (parsed.status !== 'ok') {
        throw new Error(`manifest ${parsed.status}`)
    }
    return parsed.value.body as Manifest
}

/** Gives the character two messages with known chat ids, committed, so a later edit has a message to change. */
async function seedMessages(page: { w: World, k: Store2Kit, db: Entry }): Promise<void> {
    const messages = ((characters(page.db)[2] as { chats: { message: Message[] }[] }).chats[0].message)
    messages[1].chatId = 'm-1'
    messages[2].chatId = 'm-2'
    page.w.marks.markCharacterForSave(characters(page.db)[2].chaId)
    await until(async () => (await messageOf(page.k, 'm-1')) !== undefined, 'the seeded message ids to commit', 8000)
    await settled(page.w)
}

describe('unsent message edits against the real store2 loop', () => {
    test('T3.H1: a hide writes the draft, lands its mark before the request, commits once and leaves the page clean', async () => {
        const page = await startPage(buildSmall(4))
        await seedMessages(page)
        const { gate, store, hide } = await draftModules()
        h.parked.add(page.w.id)
        await sleepReal(200)
        setVisibility('hidden')
        const commitsBefore = commitCount(page.k)

        gate.set(identityOf(page, 'm-1'), 'typed before the hide', 'the saved text')
        hide.flushPageBeforeLeaving()
        await until(async () => (await draftsOf(page.k)).length === 1, 'the requested pass with parked sleeps', 4000)

        const saved = (await draftsOf(page.k))[0].drafts?.[0]
        expect(saved).toMatchObject({ m: 'id:m-1', text: 'typed before the hide', bh: store.chatDraftBaseDigest('the saved text') })
        const manifest = await currentManifest(page.k)
        expect((manifest.fixed as unknown as { chatDrafts?: unknown }).chatDrafts).toBeDefined()
        expect(manifest.req).toContain('chat-drafts')
        expect(page.w.api.isSaveClean()).toBe(true)

        await sleepReal(900)
        expect(commitCount(page.k)).toBe(commitsBefore + 1)
        expect(page.w.api.isSaveClean()).toBe(true)
    })

    test('T3.H2: a saved edit commits the new message text with no draft entry', async () => {
        const page = await startPage(buildSmall(4))
        await seedMessages(page)
        const { gate, store } = await draftModules()
        const identity = identityOf(page, 'm-1')
        gate.set(identity, 'typed', 'the saved text')
        store.flushChatDrafts()
        await until(async () => (await draftsOf(page.k)).length === 1, 'the draft to commit', 8000)

        // The controller's commit of an edit: the text is written, then the draft is deleted in the same stretch.
        ;((characters(page.db)[2] as { chats: { message: Message[] }[] }).chats[0].message[1]).data = 'typed'
        page.w.marks.markCharacterForSave(characters(page.db)[2].chaId)
        gate.delete(identity)
        await until(async () => (await messageOf(page.k, 'm-1'))?.data === 'typed' && (await draftsOf(page.k)).length === 0, 'the edit to commit with no draft', 8000)

        expect((await messageOf(page.k, 'm-1'))?.data).toBe('typed')
        expect(await draftsOf(page.k)).toEqual([])
        expect(((await page.k.saved()) as unknown as { chatDrafts?: unknown }).chatDrafts).toBeUndefined()
    })

    test('T3.H3: a discarded draft is gone from the committed tree and the other stays', async () => {
        const page = await startPage(buildSmall(4))
        await seedMessages(page)
        const { gate, store } = await draftModules()
        gate.set(identityOf(page, 'm-1'), 'first draft', 'the saved text')
        gate.set(identityOf(page, 'm-2'), 'second draft', 'the saved text')
        store.flushChatDrafts()
        await until(async () => ((await draftsOf(page.k))[0]?.drafts?.length ?? 0) === 2, 'both drafts to commit', 8000)

        gate.delete(identityOf(page, 'm-2'))
        await until(async () => ((await draftsOf(page.k))[0]?.drafts?.length ?? 0) === 1, 'the discard to commit', 8000)

        expect((await draftsOf(page.k))[0].drafts?.map((draft) => draft.m)).toEqual(['id:m-1'])
    })
})
