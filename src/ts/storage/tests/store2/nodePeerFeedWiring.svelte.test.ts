/**
 * CHORE-808 stage 1b: the production wiring of the Node change feed. Runs the real `saveDb()` store2 loop with
 * `isNodeServer: true`, a `NodeStorage` as the page's real storage and a scripted `fetch`, over the in-memory kit with every
 * loop sleep parked. W1 and W2 are new-path guards of the wiring (their killing mutants are their evidence); W3 is a
 * compatibility guard that passes before and after. Mocked store and fetch; not browser or server evidence.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { createWorldKit, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall } from 'src/ts/storage/tests/store2/codecFixtures'

vi.setConfig({ testTimeout: 40_000 })

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'android' }))

const platform = vi.hoisted(() => ({ node: true }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    get isNodeServer() { return platform.node },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

const worlds = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

type Entry = Record<string, unknown>

const FEED_PATH = '/api/store2-feed'
const TOKEN = 'a-stubbed-token'

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
    platform.node = true
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
    Reflect.deleteProperty(document, 'visibilityState')
    worlds.parkAll()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

/** A fetch that holds every feed request until the test answers it; any other URL is refused. */
function stubFeedFetch() {
    const waiting: Array<{ resolve: (response: Response) => void, reject: (error: unknown) => void }> = []
    const urls: string[] = []
    const headers: unknown[] = []
    vi.stubGlobal('fetch', (input: unknown, init?: RequestInit): Promise<Response> => {
        const url = String(input)
        if (!url.includes(FEED_PATH)) {
            return Promise.reject(new Error(`An unexpected request: ${url}`))
        }
        return new Promise<Response>((resolve, reject) => {
            urls.push(url)
            headers.push(init?.headers)
            const entry = { resolve, reject }
            waiting.push(entry)
            init?.signal?.addEventListener('abort', () => {
                const at = waiting.indexOf(entry)
                if (at >= 0) {
                    waiting.splice(at, 1)
                }
                reject(new DOMException('aborted', 'AbortError'))
            }, { once: true })
        })
    })
    return {
        urls,
        headers,
        pending: () => waiting.length,
        answer(rev: number) {
            const entry = waiting.shift()
            if (entry === undefined) {
                throw new Error('No feed request is waiting.')
            }
            entry.resolve(new Response(JSON.stringify({ rev, instance: 'instance-a' }), { status: 200 }))
        },
    }
}

interface Page {
    w: World
    k: Store2Kit
    reads: { commit: number }
}

/** Starts the page's real save loop; the page's real storage is a `NodeStorage` whose token is the stubbed one. */
async function startNodePage(): Promise<Page> {
    const reads = { commit: 0 }
    const db = buildSmall(1)
    h.db = db as unknown as Entry
    const k = await startStore2({ db, hooks: { before: (name) => { if (name === 'readCommit') { reads.commit += 1 } } } })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const { NodeStorage } = await import('src/ts/storage/nodeStorage')
    const nodeStorage = new NodeStorage()
    vi.spyOn(nodeStorage, 'authHeader').mockResolvedValue(TOKEN)
    w.api.forageStorage.realStorage = nodeStorage
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    w.start()
    return { w, k, reads }
}

describe('the production wiring of the Node change feed', () => {
    test('W1 the page asks the feed with its token, and one event is exactly one peer-check commit read and no write', async () => {
        const feed = stubFeedFetch()
        const page = await startNodePage()
        await until(() => feed.pending() === 1, 'the baseline request', 6000)
        expect(feed.urls[0]).toMatch(/\/api\/store2-feed$/)
        expect(feed.headers[0]).toMatchObject({ 'risu-auth': TOKEN })
        feed.answer(1)
        await until(() => feed.pending() === 1 && feed.urls.length === 2, 'the held request', 6000)
        expect(feed.urls[1]).toMatch(/store2-feed\?since=1$/)

        // The wall clock is held and every loop sleep is parked: only the feed's wake can run a peer check now.
        vi.useFakeTimers({ toFake: ['Date'] })
        h.parked.add(page.w.id)
        await sleepReal(300)
        const readsBefore = page.reads.commit
        page.k.counted.reset()

        feed.answer(2)
        await until(() => page.reads.commit === readsBefore + 1, 'the peer check to read the commit key', 6000)
        await sleepReal(300)
        expect(page.reads.commit).toBe(readsBefore + 1)
        expect(page.k.counted.writeCalls()).toBe(0)
    })

    test('W2 a hide aborts the held request and sends no new one; a show sends one probe without since', async () => {
        const feed = stubFeedFetch()
        await startNodePage()
        await until(() => feed.pending() === 1, 'the baseline request', 6000)
        feed.answer(1)
        await until(() => feed.pending() === 1 && feed.urls.length === 2, 'the held request', 6000)

        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))
        expect(feed.pending()).toBe(0)
        await sleepReal(200)
        expect(feed.urls.length).toBe(2)

        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))
        await until(() => feed.urls.length === 3, 'the probe', 6000)
        expect(feed.urls[2]).toMatch(/\/api\/store2-feed$/)
    })

    test('W3 a page that is not on the Node server asks no feed even with a NodeStorage', async () => {
        platform.node = false
        const feed = stubFeedFetch()
        await startNodePage()
        await sleepReal(500)
        expect(feed.urls).toEqual([])
    })
})
