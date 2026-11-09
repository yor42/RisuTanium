/**
 * The hidden reply-end flush against the real store2 save loop with the production idle net (default
 * quiet back-off) engaged and every loop sleep parked. The reply-end guard in
 * saveOnHide.replyEnd.store2.svelte.test.ts runs with the idle net off, so it cannot see the back-off.
 * The clock is stepped (Date only) until the net has gone quiet: it still reads, but no longer scans.
 * Mocked store; not native WebView evidence.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { createWorldKit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall } from 'src/ts/storage/tests/store2/codecFixtures'
import { IDLE_NET_INTERVAL_MS } from 'src/ts/storage/store2/saveLoop'
import type { Database } from 'src/ts/storage/database.svelte'

vi.setConfig({ testTimeout: 60_000 })

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

/** The production idle net: the default cadence, and no `quiet` option, so the default quiet back-off applies. */
async function startPage(db: Database): Promise<{ w: World, k: Store2Kit, db: Entry }> {
    h.db = db as unknown as Entry
    const k = await startStore2({ db, idleNet: { intervalMs: IDLE_NET_INTERVAL_MS } })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    w.start()
    await sleepReal(150)
    return { w, k, db: h.db }
}

async function savedPersonality(k: Store2Kit, index: number): Promise<unknown> {
    return ((await k.saved()).characters[index] as unknown as Entry).personality
}

/**
 * Steps the clock until a quiet period has elapsed, then once more in short steps. Returns what the loop did in each
 * step: net reads and scans of the live context. A backed-off net still reads but no longer scans.
 */
async function backOffTheNet(page: { w: World, k: Store2Kit }): Promise<Array<{ reads: number, scans: number }>> {
    const counts = { reads: 0, scans: 0 }
    const encoder = page.k.context.encoder as { netScan: (db: unknown) => unknown }
    const innerScan = encoder.netScan.bind(encoder)
    encoder.netScan = (db: unknown) => { counts.scans += 1; return innerScan(db) }
    const committer = page.k.context.session.committer as unknown as { readCommit: () => Promise<unknown> }
    const innerRead = committer.readCommit.bind(committer)
    committer.readCommit = () => { counts.reads += 1; return innerRead() }

    vi.useFakeTimers({ toFake: ['Date'] })
    const steps: Array<{ reads: number, scans: number }> = []
    for (const jump of [61_000, 61_000, 61_000, 61_000, 2_500, 2_500]) {
        const before = { ...counts }
        vi.setSystemTime(Date.now() + jump)
        await sleepReal(1800)
        steps.push({ reads: counts.reads - before.reads, scans: counts.scans - before.scans })
    }
    return steps
}

describe('hidden reply-end flush with the idle net backed off (store2, tauri kind)', () => {
    // Compatibility guard: expected to pass before and after the change; it pins the reply-end commit against the back-off.
    for (const markFirst of [true, false]) {
        test(`${markFirst ? 'mark first, then the hide flush' : 'the hide flush alone'}: the reply is committed with every loop sleep parked`, async () => {
            setVisibility('visible')
            const page = await startPage(buildSmall(4))
            await settled(page.w)
            const steps = await backOffTheNet(page)

            // The back-off is engaged: the net still reads in the last two steps, none of them scans, and nothing is unsaved.
            const lastTwo = steps.slice(-2)
            expect(lastTwo.map(step => step.scans)).toEqual([0, 0])
            expect(lastTwo.every(step => step.reads > 0)).toBe(true)
            expect(page.w.api.hasUnsavedSaveMarks()).toBe(false)

            h.parked.add(page.w.id)
            await sleepReal(200)
            setVisibility('hidden')
            const { flushPageReplyEndWhenHidden } = await import('src/ts/process/saveOnHide')
            const chaId = characters(page.db)[2].chaId as string
            characters(page.db)[2].personality = 'final reply'
            if (markFirst) {
                page.w.marks.markCharacterForSave(chaId)
            }
            flushPageReplyEndWhenHidden({ chaId })

            await until(async () => (await savedPersonality(page.k, 2)) === 'final reply', 'the requested pass with parked sleeps', 4000)
        })
    }
})
