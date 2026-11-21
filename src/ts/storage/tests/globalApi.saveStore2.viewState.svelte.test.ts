/**
 * View state on a store2 page (MC-2266, MC-2283, MC-2293, MC-2298): the real, unmocked `saveDb()` loop, the real change
 * effects and the real write hook over a reactive `DBState`, as `globalApi.saveStore2.writeHook.svelte.test.ts` runs
 * them. A write to `chatPage`, `lastInteraction`, the selection or a settings key raises a `judged` mark, which the prompt
 * judges by value; a module edit, a boot-window write and a request for a pass raise `content` marks, which the page
 * counts as unsaved. The store is an in-memory store2 backend (see `store2SaveKit.ts`). A mocked success here is not
 * evidence of native backend behaviour.
 *
 * Marked edits race the world's 5 ms debounce, so a row that needs the prompt to see a mark first parks the page on a
 * peer commit and then writes (the prompt re-judges on every mark), or lets a peer commit land before the write (the
 * marked pass then parks and folds its snapshot back). Labels: reproducer (fails on the base for the defect itself),
 * guard (passes with or without the change; kills the mutant it names).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { createWorldKit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, bootThroughDispatch, createPeerDouble, peerCommit, type DispatchedBoot, type PeerDouble, type Store2Kit, type Store2StartOptions } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall, fakeLists } from 'src/ts/storage/tests/store2/codecFixtures'
import { ffWorldOver } from 'src/ts/storage/tests/store2/ffFixtures'
import { olderBuildCommit } from 'src/ts/storage/tests/store2/lineFixtures'
import { createMemoryBackend } from 'src/ts/storage/store2/backend'
import { PARK_CHECK_MAX_MS } from 'src/ts/storage/store2/saveLoop'
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
    // The real effects: `saveLoopMocks.svelte.ts` replaces them, and the identity tracker is one of the nets the hook sits beside.
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    // The factory runs inside the world's own module graph: the state, the hook, the patched runtime and the marks
    // it reports to must be that graph's copies. The root is a state proxy, what `$state({ db })` compiles to.
    vi.doMock('src/ts/stores.svelte', async () => {
        const { proxy } = await import('svelte/internal/client')
        const { untrack } = await import('svelte')
        const { get, writable } = await import('svelte/store')
        const { installDbWriteHook } = await import('src/ts/storage/dbWriteHook')
        const { markDbWrite } = await import('src/ts/storage/characterSaveMarks')
        const DBState = proxy({ db: {} as Entry })
        const selectedCharID = writable(-1)
        installDbWriteHook(DBState, {
            selectedChaId: () => untrack(() => (DBState.db.characters as Entry[] | undefined)?.[get(selectedCharID)]?.chaId),
            sink: (mark) => { markDbWrite(mark) },
        })
        return {
            DBState,
            selectedCharID,
            selIdState: { selId: -1 },
            alertStore: writable({ type: 'none', msg: '' }),
            MobileGUI: writable(false),
            botMakerMode: writable(false),
            loadedStore: writable(false),
            LoadingStatusState: { text: '' },
            ReloadGUIPointer: writable(0),
            bodyIntercepterStore: writable(null),
            savingStoppedReason: writable(null),
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
    vi.doUnmock('src/ts/storage/svelteStatePatch')
    // Back to the shared stand-in, which a row that needs the rest of the parser replaced.
    vi.doMock('src/ts/parser/parser.svelte', () => ({ hasher: (text: string) => text }))
    vi.doMock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }))
    vi.restoreAllMocks()
})

interface Page {
    w: World
    k: Store2Kit
    /** The database the loop and the change effects read: a reactive proxy. */
    db: Entry
    stores: typeof import('src/ts/stores.svelte')
}

interface PageOptions extends Partial<Store2StartOptions> {
    /** Runs after the page is arranged and before the loop starts. */
    beforeStart?: (page: Page) => Promise<void> | void
}

/**
 * The world's `sleep` shortens every wait to a few milliseconds, which would make the loop's 20 s judgement deadline
 * elapse during a slow check and answer dirty. The deadline sleep keeps its length; every other wait is unchanged.
 */
async function honourCheckDeadline(): Promise<void> {
    const util = await import('src/ts/util')
    const sleep = vi.mocked(util.sleep)
    const shortened = sleep.getMockImplementation()
    sleep.mockImplementation((ms: number) => ms === PARK_CHECK_MAX_MS
        ? new Promise<void>((resolve) => setTimeout(resolve, ms))
        : (shortened ?? ((): Promise<void> => Promise.resolve()))(ms))
}

const characters = (db: Entry): Entry[] => db.characters as Entry[]

/** Starts the loop of a store2 session over a reactive `DBState` carrying the hook, as the application runs it. */
async function startPage(db: Database, options: PageOptions = {}): Promise<Page> {
    const { beforeStart, ...kitOptions } = options
    h.db = db as unknown as Entry
    const k = await startStore2({ db, ...kitOptions })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    await honourCheckDeadline()
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    const page: Page = { w, k, db: h.db, stores }
    await beforeStart?.(page)
    w.start()
    await sleepReal(150)
    return page
}

const small = () => buildSmall(4)

function broadcastFromPeer(epoch: string) {
    h.channels.at(-1)!.onmessage?.({ data: { sessionID: 'a peer tab', epoch } })
}

/** The person has not answered the unsaved question: a question asked stays open. */
function unanswered(peer: PeerDouble): void {
    peer.hold = new Promise<void>(() => { })
}

/** A peer commit that this tab hears about: the broadcast parks a page that is not mid-pass. */
async function peerSaves(page: Page): Promise<void> {
    const key = await peerCommit(page.k, (peerDb) => { (peerDb.characters as unknown as Entry[])[3].personality = 'the peer edit' })
    broadcastFromPeer(key.epoch)
}

/** A peer commit this tab has not heard about: the next marked pass finds it, parks, and folds its snapshot back. */
async function peerLands(page: Page): Promise<void> {
    await peerCommit(page.k, (peerDb) => { (peerDb.characters as unknown as Entry[])[3].personality = 'the peer edit' })
}

const prompted = (peer: PeerDouble): boolean => peer.clean.length + peer.asked.length >= 1

async function untilPrompt(page: Page): Promise<void> {
    await until(() => prompted(page.k.peer), 'a prompt', 8000)
}

/** A parked page with the clean prompt up and nothing unsaved. */
async function parkedClean(options: PageOptions = {}, peer: PeerDouble = createPeerDouble('reload')): Promise<Page> {
    unanswered(peer)
    const page = await startPage(small(), { idleNet: { intervalMs: 1_000_000_000 }, peer, ...options })
    await settled(page.w)
    await peerSaves(page)
    await until(() => peer.clean.length >= 1, 'the clean prompt', 8000)
    return page
}

/** The prompt stays the one clean prompt: nothing is asked, nothing reloads, and no second prompt is built. */
async function expectStillClean(page: Page): Promise<void> {
    await sleepReal(400)
    expect(page.k.peer.clean).toHaveLength(1)
    expect(page.k.peer.asked).toEqual([])
    expect(page.k.peer.reloads).toBe(0)
}

async function expectUnsaved(page: Page, offers: string[] = ['reload', 'save-mine']): Promise<void> {
    await until(() => page.k.peer.asked.length >= 1, 'the unsaved question', 8000)
    expect(page.k.peer.asked[0]).toMatchObject({ unsaved: true })
    expect(page.k.peer.asked[0].offers).toEqual(offers)
    expect(page.k.peer.reloads).toBe(0)
}

const moduleOf = (id: string): Entry => ({ name: `Module ${id}`, description: '', lorebook: [], regex: [], trigger: [], id, assets: [] })

describe('R: an own view write (chatPage, lastInteraction, selection, identity) gives the clean prompt', () => {
    test('R1 reproducer: an own chatPage after the park', async () => {
        const page = await parkedClean()
        characters(page.db)[1].chatPage = 2
        expect(page.w.api.hasUnsavedSaveMarks()).toBe(true)
        await expectStillClean(page)
    })

    test('R2 reproducer: an own lastInteraction after the park', async () => {
        const page = await parkedClean()
        characters(page.db)[1].lastInteraction = 1_900_000_000_000
        expect(page.w.api.hasUnsavedSaveMarks()).toBe(true)
        await expectStillClean(page)
    })

    test('R3 reproducer: an own selection (selectedCharID.set(1)) after the park', async () => {
        const page = await parkedClean()
        page.stores.selectedCharID.set(1)
        await expectStillClean(page)
    })

    test('R4 reproducer: an identity-only globalLore rewrite after the park', async () => {
        const page = await parkedClean()
        const slot = characters(page.db)[1]
        slot.globalLore = [...((slot.globalLore as unknown[] | undefined) ?? [])]
        expect(page.w.api.hasUnsavedSaveMarks()).toBe(true)
        await expectStillClean(page)
    })

    test('R5 reproducer: after R1, Reload reloads and nothing is asked', async () => {
        const page = await parkedClean()
        characters(page.db)[1].chatPage = 2
        await sleepReal(400)
        await page.k.peer.pressReload()
        await sleepReal(400)
        expect(page.k.peer.reloads).toBe(1)
        expect(page.k.peer.asked).toEqual([])
    })

    test('R6 reproducer: a marked pass that snapshots and parks on a peer commit folds back no content claim', async () => {
        const peer = createPeerDouble('reload')
        unanswered(peer)
        const page = await startPage(small(), { idleNet: { intervalMs: 1_000_000_000 }, peer })
        await settled(page.w)
        await peerLands(page)
        characters(page.db)[1].chatPage = 2
        await untilPrompt(page)
        await sleepReal(300)
        expect(peer.clean.length).toBeGreaterThanOrEqual(1)
        expect(peer.asked).toEqual([])
    })

    test('R7 reproducer: a request to save now does not raise the content flag', async () => {
        const peer = createPeerDouble('reload')
        unanswered(peer)
        const page = await startPage(small(), { idleNet: { intervalMs: 1_000_000_000 }, peer })
        await settled(page.w)
        await peerLands(page)
        characters(page.db)[1].chatPage = 2
        page.w.api.requestSaveNow()
        await untilPrompt(page)
        await sleepReal(300)
        expect(peer.clean.length).toBeGreaterThanOrEqual(1)
        expect(peer.asked).toEqual([])
    })
})

describe('C: content edits still ask the unsaved question', () => {
    test('C1 guard: an own personality on a parked page asks the unsaved question and offers Save mine', async () => {
        const peer = createPeerDouble('reload')
        unanswered(peer)
        const page = await startPage(small(), { idleNet: { intervalMs: 1_000_000_000 }, peer })
        await settled(page.w)
        await peerLands(page)
        characters(page.db)[1].personality = 'an own edit'
        await expectUnsaved(page)
    })

    test('C2 guard: an own personality and an own chatPage on one parked page ask the unsaved question', async () => {
        const peer = createPeerDouble('reload')
        unanswered(peer)
        const page = await startPage(small(), { idleNet: { intervalMs: 1_000_000_000 }, peer })
        await settled(page.w)
        await peerLands(page)
        characters(page.db)[1].personality = 'an own edit'
        characters(page.db)[2].chatPage = 2
        await expectUnsaved(page)
    })

    test('C3 guard: an own personality after the clean prompt is up asks the unsaved question', async () => {
        const page = await parkedClean()
        characters(page.db)[1].personality = 'an own edit'
        await expectUnsaved(page)
    })

    test('C3b guard: a judgement that found a view write clean is repeated when a content edit follows it', async () => {
        const page = await parkedClean()
        characters(page.db)[1].chatPage = 2
        await expectStillClean(page)
        characters(page.db)[1].personality = 'an own edit'
        await expectUnsaved(page)
    })

    test('C4b reproducer: a view write after a judged one is no reason to hold Reload back before it is pressed', async () => {
        const page = await parkedClean()
        characters(page.db)[1].chatPage = 2
        await expectStillClean(page)
        // The second mark moves the serial past the judged one, and the press reads the page before the next settle.
        characters(page.db)[1].lastInteraction = 1_900_000_000_000
        await page.k.peer.pressReload()
        await sleepReal(400)
        expect(page.k.peer.reloads).toBe(1)
        expect(page.k.peer.asked).toEqual([])
    })

    test('C4 reproducer: an own chatPage after the clean prompt is up, then Reload, reloads and asks nothing', async () => {
        const page = await parkedClean()
        characters(page.db)[1].chatPage = 2
        await page.k.peer.pressReload()
        await sleepReal(400)
        expect(page.k.peer.reloads).toBe(1)
        expect(page.k.peer.asked).toEqual([])
    })
})

describe('G: settings and list edits are judged by value at the prompt', () => {
    test('G3 guard: an own username on a marked pass that parks asks the unsaved question', async () => {
        const peer = createPeerDouble('reload')
        unanswered(peer)
        const page = await startPage(small(), { idleNet: { intervalMs: 1_000_000_000 }, peer })
        await settled(page.w)
        await peerLands(page)
        ;(page.db as { username?: string }).username = 'an own name'
        await expectUnsaved(page)
    })

    test('G3m guard: an own module edit on a marked pass that parks asks the unsaved question', async () => {
        const peer = createPeerDouble('reload')
        unanswered(peer)
        const page = await startPage(small(), { idleNet: { intervalMs: 1_000_000_000 }, peer })
        await settled(page.w)
        await peerLands(page)
        ;(page.db.modules as Entry[]).push(moduleOf('own-module'))
        await expectUnsaved(page)
    })

    test('G4 guard: personality on one character and chatPage on another are both kept by Save mine (MC-699)', async () => {
        const peer = createPeerDouble('save-mine')
        const page = await startPage(small(), { idleNet: { intervalMs: 1_000_000_000 }, peer })
        await settled(page.w)
        await peerLands(page)
        characters(page.db)[0].personality = 'an own edit'
        characters(page.db)[1].chatPage = 2
        await until(async () => {
            const saved = (await page.k.saved()).characters as unknown as Entry[]
            return saved[0].personality === 'an own edit' && saved[1].chatPage === 2
        }, 'Save mine to store both', 12000)
    })

    test('G5 guard: an own username after the clean prompt is up asks the unsaved question and offers Save mine', async () => {
        const page = await parkedClean()
        ;(page.db as { username?: string }).username = 'an own name'
        await expectUnsaved(page)
    })

    test('G8 guard: two characters swapped after the clean prompt is up ask the unsaved question', async () => {
        const page = await parkedClean()
        const list = characters(page.db)
        const first = list[1]
        list[1] = list[2]
        list[2] = first
        await expectUnsaved(page)
    })

    test('G9 guard: an own username whose pass landed leaves a peer park clean', async () => {
        const peer = createPeerDouble('reload')
        unanswered(peer)
        const page = await startPage(small(), { idleNet: { intervalMs: 1_000_000_000 }, peer })
        await settled(page.w)
        ;(page.db as { username?: string }).username = 'an own name'
        await settled(page.w)
        await peerSaves(page)
        await until(() => peer.clean.length >= 1, 'the clean prompt', 8000)
        await expectStillClean(page)
    })

    test('G9m guard: an own module edit whose pass landed leaves a peer park clean, and a later view write keeps it clean (the snapshot cleared the content flag)', async () => {
        const peer = createPeerDouble('reload')
        unanswered(peer)
        const page = await startPage(small(), { idleNet: { intervalMs: 1_000_000_000 }, peer })
        await settled(page.w)
        ;(page.db.modules as Entry[]).push(moduleOf('own-module'))
        await settled(page.w)
        await peerSaves(page)
        await until(() => peer.clean.length >= 1, 'the clean prompt', 8000)
        await expectStillClean(page)
        // A flag the snapshot had not cleared would turn this judged mark into an unsaved question.
        characters(page.db)[1].chatPage = 2
        await expectStillClean(page)
    })

    test('MOD1 guard: an own module edit after the clean prompt is up asks the unsaved question', async () => {
        const page = await parkedClean()
        ;(page.db.modules as Entry[]).push(moduleOf('own-module'))
        await expectUnsaved(page)
    })
})

describe('B: the boot window and a boot write count as content', () => {
    test('B1 guard: a boot-time import before the window closes asks the unsaved question when a pass parks', async () => {
        const peer = createPeerDouble('reload')
        unanswered(peer)
        const page = await startPage(small(), {
            idleNet: { intervalMs: 1_000_000_000 },
            peer,
            beforeStart: async (started) => {
                const { markBootWrite } = await import('src/ts/bootWindow')
                markBootWrite()
                await peerLands(started)
            },
        })
        await expectUnsaved(page)
    })

    test('B2 guard: a boot write after the window closed asks the unsaved question when a pass parks', async () => {
        const peer = createPeerDouble('reload')
        unanswered(peer)
        const page = await startPage(small(), { idleNet: { intervalMs: 1_000_000_000 }, peer })
        await settled(page.w)
        await peerLands(page)
        const { markBootWrite } = await import('src/ts/bootWindow')
        markBootWrite()
        await expectUnsaved(page)
    })
})

describe('TK-P: a take in the real page, then an immediate park, gives the clean prompt', () => {
    // The scheduler's 500 ms debounce is a real timer, so the park that follows the take lands before the pass.
    test('TK-P reproducer: an insertion take (real host, real liveCheck) raises judged marks only, and the park right after it is clean', async () => {
        const memory = createMemoryBackend()
        const seeded = await ffWorldOver(memory, { mintLine: true })
        let booted: DispatchedBoot | null = null
        h.db = {} as Entry
        // The shared mocks stand in for the parser with `hasher` alone, and the real fast-forward host imports the page
        // modules that use the rest of it. Every other export of the stand-in returns its first argument.
        vi.doMock('src/ts/parser/parser.svelte', () => {
            const defined: Record<string, unknown> = { hasher: (text: string) => text }
            return new Proxy(defined, {
                has: (target, key) => typeof key === 'string' && key !== 'then' ? true : key in target,
                get: (target, key) => key in target || typeof key !== 'string' || key === 'then' || key === '__esModule'
                    ? Reflect.get(target, key)
                    : (text: unknown) => text,
            })
        })
        const w = await worlds.startWorld({
            kind: 'tauri',
            startLoop: false,
            boot: async (world) => {
                booted = await bootThroughDispatch(memory, { lists: fakeLists })
                if (booted.result.kind !== 'store2') {
                    throw new Error(`The boot answered ${booted.result.kind}.`)
                }
                h.db = booted.result.database as unknown as Entry
                world.pageMode.setPageStorageMode({ kind: 'unset' })
            },
        })
        await honourCheckDeadline()
        const stores = await import('src/ts/stores.svelte')
        ;(stores.DBState as { db: unknown }).db = h.db
        h.db = (stores.DBState as { db: unknown }).db as Entry
        const dispatched = booted as DispatchedBoot | null
        if (dispatched === null) {
            throw new Error('The boot did not run.')
        }
        unanswered(dispatched.peer)
        w.start()
        await sleepReal(200)
        await settled(w)
        const { getActiveStore2Save } = await import('src/ts/storage/store2/saveActive')
        const fastForward = getActiveStore2Save()?.fastForward
        if (fastForward === undefined) {
            throw new Error('The page has no fast-forward.')
        }
        const runSpy = vi.spyOn(fastForward, 'run')
        const key = await seeded.page.commitEdit((db) => {
            const added = JSON.parse(JSON.stringify((db.characters as unknown as Entry[])[0])) as Entry
            added.chaId = 'take-added'
            added.name = 'Added by the peer'
            ;(db.characters as unknown as Entry[]).splice(1, 0, added as never)
            db.characterOrder = [...db.characterOrder, 'take-added']
        })
        broadcastFromPeer(key.epoch)
        await until(() => characters(h.db).some(slot => slot.chaId === 'take-added'), 'the take', 20_000)
        expect(await runSpy.mock.results[0].value).toEqual({ kind: 'applied' })
        const older = await olderBuildCommit(memory, seeded.page, (db) => { (db.characters as unknown as Entry[])[3].personality = 'a later older-build edit' })
        broadcastFromPeer(older.epoch)
        await until(() => dispatched.peer.clean.length + dispatched.peer.asked.length >= 1, 'a prompt', 20_000)
        await sleepReal(300)
        expect(dispatched.peer.clean).toHaveLength(1)
        expect(dispatched.peer.asked).toEqual([])
        expect(w.api.hasUnsavedSaveMarks()).toBe(true)
    })
})

describe('S: a view write is saved without a park', () => {
    test.each([
        ['S1 chatPage', (page: Page) => { characters(page.db)[1].chatPage = 2 }, (saved: Entry) => (saved.characters as Entry[])[1].chatPage === 2],
        ['S2 lastInteraction', (page: Page) => { characters(page.db)[1].lastInteraction = 1_900_000_000_000 }, (saved: Entry) => (saved.characters as Entry[])[1].lastInteraction === 1_900_000_000_000],
        ['S3 username', (page: Page) => { (page.db as { username?: string }).username = 'an own name' }, (saved: Entry) => saved.username === 'an own name'],
    ])('%s: the write is a save mark before the pass and stored after it', async (_label, write, stored) => {
        const page = await startPage(small(), { idleNet: { intervalMs: 1_000_000_000 } })
        await settled(page.w)
        write(page)
        expect(page.w.api.hasUnsavedSaveMarks()).toBe(true)
        await until(async () => stored(await page.k.saved() as unknown as Entry), 'the write to be stored', 12000)
    })
})
