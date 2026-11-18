/**
 * The archive setting the boot turns on, over the real save loop and the real change effects. A store2 profile whose tree
 * carries no `archiveCharacters` key is opened by the real boot dispatch, which sets the key in memory and tells the
 * person once; `saveDb()` then runs for real over that session with fake timers. What this pins: with no mark beyond the
 * one the effects' first run makes, the first pass (the 500 ms debounce plus the loop's 1000 ms initial wait) commits the
 * tree with `archiveCharacters: true`, so the setting is saved without any person acknowledging the notice. A mocked
 * success here is not evidence of native backend behaviour.
 *
 * Label: (G) a compatibility guard; it passes before and after the notice queue, which writes no mark and no save request.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { createWorldKit, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { bootThroughDispatch, startStore2, type DispatchedBoot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
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
    vi.useRealTimers()
    worlds.parkAll()
    vi.doMock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }))
    vi.restoreAllMocks()
})

interface Page {
    w: World
    k: Store2Kit
    boot: DispatchedBoot
}

/**
 * A page as the boot leaves it: the store holds a key-less tree, the real dispatch opens it in the world's own module
 * graph and installs its database over the reactive state, and the loop has not started.
 */
async function openKeylessPage(): Promise<Page> {
    const db = buildSmall(2)
    expect(Object.hasOwn(db, 'archiveCharacters'), 'the seeded profile carries no archive key').toBe(false)
    h.db = db as unknown as Entry
    const k = await startStore2({ db, kind: 'tauri', lists: createListDerivation() })
    let boot: DispatchedBoot | null = null
    const w = await worlds.startWorld({
        kind: 'tauri',
        startLoop: false,
        boot: async () => {
            boot = await bootThroughDispatch(k.counted.backend, { kind: 'tauri', lists: createListDerivation() })
        },
    })
    if (boot === null || (boot as DispatchedBoot).result.kind !== 'store2') {
        throw new Error('The dispatch did not open the profile.')
    }
    const opened = boot as DispatchedBoot
    const loaded = (opened.result as Extract<DispatchedBoot['result'], { kind: 'store2' }>).database
    h.db = loaded as unknown as Entry
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    return { w, k, boot: opened }
}

// The real timer, taken before any test installs fake ones: the store's digests and the loop's dynamic imports finish on real time.
const realSetTimeout = globalThis.setTimeout

const realWait = (ms: number) => new Promise<void>((resolve) => { realSetTimeout(resolve, ms) })

/** Polls `condition` on real time; false when it did not hold within `timeoutMs`. */
async function realUntil(condition: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<boolean> {
    const start = performance.now()
    while (!(await condition())) {
        if (performance.now() - start > timeoutMs) {
            return false
        }
        await realWait(5)
    }
    return true
}

/** Advances the fake clock by `totalMs` in 50 ms steps, each followed by a short real wait for the work the timers started. */
async function advanceWithRealTurns(totalMs: number): Promise<void> {
    for (let elapsed = 0; elapsed < totalMs; elapsed += 50) {
        await vi.advanceTimersByTimeAsync(50)
        await realWait(5)
    }
}

describe('the archive setting the boot turns on, over the real save loop on a store2 session', () => {
    test('(G) the first pass commits archiveCharacters true although nobody acknowledged the notice and the boot marked nothing', async () => {
        const page = await openKeylessPage()

        // The boot told the person once and changed the setting in memory only: the stored tree still has no key.
        expect(page.boot.notices.filter((notice) => notice.name === 'archive-enabled')).toHaveLength(1)
        expect((h.db as unknown as Database).archiveCharacters).toBe(true)
        expect((await page.k.saved()).archiveCharacters).toBeUndefined()
        const before = await page.k.commitKey()

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        page.w.start()
        // The loop's startup is real asynchronous work; its first timer (the initial wait) is armed once that is done.
        expect(await realUntil(() => vi.getTimerCount() > 0), 'the loop armed its first timer').toBe(true)
        // The debounce (500 ms) plus the loop's initial wait (1000 ms): the clock is advanced in steps, and the store's own asynchronous work gets real turns between them.
        await advanceWithRealTurns(1500)
        const committed = await realUntil(async () => (await page.k.commitKey()).current?.key !== before.current?.key, 3_000)

        expect(committed, 'the first pass committed a new tree').toBe(true)
        expect((await page.k.saved()).archiveCharacters).toBe(true)
    })
})
