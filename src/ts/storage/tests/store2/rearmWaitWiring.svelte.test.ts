/**
 * The page's store2 loop port wires `rearmWait` by transport, once, when the port is built (`saveDbStore2`). Runs the real
 * loop over the in-memory kit with every loop sleep parked (a frozen page delivers no timer): after a failed pass the loop
 * sits in its back-off, and a save request either ends that back-off (Android transport) or leaves it to its timer
 * (every other transport). The operating-system plugin is a box. Mocked store; not native WebView evidence.
 * Labels: wiring guard (passes on the base for the non-Android case, fails on it for the Android case).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { createWorldKit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { createPeerDouble, peerCommit, savedDatabase, startStore2, store2Boot, type Hooks, type PeerDouble, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { createMemoryBackend } from 'src/ts/storage/store2/backend/memory'
import { COMMIT_KEY } from 'src/ts/storage/store2/format/keys'
import { buildSmall } from 'src/ts/storage/tests/store2/codecFixtures'
import type { Database } from 'src/ts/storage/database.svelte'

vi.setConfig({ testTimeout: 40_000 })

const osBox = vi.hoisted(() => ({ os: 'android' as string }))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => osBox.os }))

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
    osBox.os = 'android'
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
    delete (document as { visibilityState?: unknown }).visibilityState
    worlds.parkAll()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

function characters(db: Entry): Entry[] {
    return db.characters as Entry[]
}

/** Fails the commit write of the pass that takes the snapshot, while `on`. */
function failingCommit() {
    const fault = {
        on: false,
        hits: 0,
        hooks: {
            before: async (name: string) => {
                if (name === 'commitOrdinary' && fault.on) {
                    fault.hits += 1
                    throw new Error('the commit write failed')
                }
            },
        } satisfies Hooks,
    }
    return fault
}

async function startPage(db: Database, hooks: Hooks, idleNet?: Store2Kit['context']['idleNet'], peer?: PeerDouble): Promise<{ w: World, k: Store2Kit, db: Entry }> {
    h.db = db as unknown as Entry
    const k = await startStore2({ db, hooks, idleNet, peer })
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

/** The page is idle, every sleep is parked, and one failed pass has put the loop into its back-off. */
async function pageInBackOff(): Promise<{ w: World, k: Store2Kit, db: Entry, fault: ReturnType<typeof failingCommit> }> {
    const fault = failingCommit()
    const page = await startPage(buildSmall(4), fault.hooks)
    await settled(page.w)
    h.parked.add(page.w.id)
    await sleepReal(200)
    fault.on = true
    characters(page.db)[2].personality = 'first edit'
    page.w.marks.markCharacterForSave(characters(page.db)[2].chaId)
    page.w.api.requestSaveNow()
    await until(() => fault.hits >= 1, 'the failed pass')
    await sleepReal(200)
    fault.on = false
    return { ...page, fault }
}

/**
 * The page is hidden and its first idle tick sits in a yield that never resolves (a freeze inside the yield): a
 * `MessageChannel` message on the Android transport's raced yield, `scheduler.yield` on every other transport. Every
 * clock read is 10 ms apart so each budget check finds the budget spent. Resolves with the yield count over both.
 */
async function pageWithParkedTick(): Promise<{ w: World, k: Store2Kit, db: Entry, yields: () => number }> {
    const counter = { yields: 0 }
    const page = await startPage(buildSmall(4), {}, { intervalMs: 1, moduleIntervalMs: 1, backstopMs: 0 })
    await settled(page.w)
    vi.stubGlobal('scheduler', { yield: () => { counter.yields += 1; return new Promise<void>(() => {}) } })
    vi.stubGlobal('MessageChannel', class {
        port1 = { onmessage: null as unknown, close() {} }
        port2 = { postMessage() { counter.yields += 1 }, close() {} }
    })
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    let ticks = 0
    vi.spyOn(performance, 'now').mockImplementation(() => (ticks += 10))
    return { ...page, yields: () => counter.yields }
}

describe('the page port ends a yield of a hidden tick on a save request only on the Android transport', () => {
    // Wiring reproducer: without `onRequest` on the page port a hidden Android tick takes no yield (the page rule skips them), or a parked one is never ended.
    test('on the Android transport a hidden tick yields and one save request ends the yield and commits', async () => {
        osBox.os = 'android'
        const page = await pageWithParkedTick()
        await until(() => page.yields() >= 1, 'a yield of the hidden tick', 6000)
        h.parked.add(page.w.id)

        characters(page.db)[2].personality = 'edit while the tick is parked'
        page.w.marks.markCharacterForSave(characters(page.db)[2].chaId)
        page.w.api.requestSaveNow()

        await until(async () => (await savedPersonality(page.k, 2)) === 'edit while the tick is parked', 'the pass after the pre-empted tick', 3000)
    })

    // Guard: on every other transport the page rule never skips, so the tick yields unraced and a request does not end the yield.
    test.each(['other', 'windows', 'linux', 'macos'])('guard: on the %s transport a hidden tick yields unraced and a save request does not end it', async (os) => {
        osBox.os = os
        const page = await pageWithParkedTick()
        await until(() => page.yields() >= 1, 'a yield of the hidden tick', 6000)
        h.parked.add(page.w.id)

        characters(page.db)[2].personality = 'edit while the tick is parked'
        page.w.marks.markCharacterForSave(characters(page.db)[2].chaId)
        page.w.api.requestSaveNow()
        await sleepReal(600)

        expect(await savedPersonality(page.k, 2)).not.toBe('edit while the tick is parked')
    })
})

describe('the page port ends a back-off on a save request only on the Android transport', () => {
    test('on the Android transport one save request ends the back-off and the next pass commits', async () => {
        osBox.os = 'android'
        const page = await pageInBackOff()

        characters(page.db)[2].personality = 'second edit'
        page.w.marks.markCharacterForSave(characters(page.db)[2].chaId)
        page.w.api.requestSaveNow()

        await until(async () => (await savedPersonality(page.k, 2)) === 'second edit', 'the pass after the back-off', 3000)
    })

    // Guard: passes before and after the change; the timed sleep of every other transport is kept.
    test.each(['other', 'windows', 'linux', 'macos'])('guard: on the %s transport a save request leaves the back-off to its timer', async (os) => {
        osBox.os = os
        const page = await pageInBackOff()

        characters(page.db)[2].personality = 'second edit'
        page.w.marks.markCharacterForSave(characters(page.db)[2].chaId)
        page.w.api.requestSaveNow()
        await sleepReal(600)

        expect(await savedPersonality(page.k, 2)).not.toBe('second edit')
    })
})

/**
 * A `MessageChannel` that keeps the first post made after it is installed (the hidden tick's raced yield) and delivers
 * every later post as a task. `release` delivers the kept post; `armAgain` keeps the next post too.
 */
function holdFirstMessage(): { entered(): boolean, release(): void, armAgain(): void } {
    const state = { armed: true, entered: false, held: null as (() => void) | null }
    vi.stubGlobal('MessageChannel', class {
        port1 = { onmessage: null as ((event: unknown) => void) | null, close() {} }
        port2 = {
            postMessage: () => {
                const deliver = (): void => { this.port1.onmessage?.({}) }
                if (state.armed) {
                    state.armed = false
                    state.entered = true
                    state.held = deliver
                    return
                }
                setTimeout(deliver, 0)
            },
            close() {},
        }
    })
    return {
        entered: () => state.entered,
        release: () => state.held?.(),
        armAgain: () => {
            state.armed = true
            state.entered = false
        },
    }
}

/** The database a snapshot of the in-memory store assembles to, through the real decoder. */
async function decodeSnapshot(snapshot: Map<string, Uint8Array>): Promise<Database> {
    const memory = createMemoryBackend()
    for (const [key, bytes] of snapshot) {
        memory.poke(key, bytes)
    }
    return savedDatabase(memory)
}

describe('a cut tick\'s redo keeps the keep-alive token', () => {
    let resetGuard: (() => void) | null = null

    beforeEach(() => {
        // A module edit then makes no mark. It stands in for a missed mark, the case the idle net backstops.
        vi.doMock('src/ts/storage/dbChangeEffects.svelte', () => ({ registerDbChangeEffects: vi.fn() }))
    })

    afterEach(() => {
        vi.useRealTimers()
        resetGuard?.()
        resetGuard = null
    })

    /**
     * A hidden Android page whose idle net takes module scope at every slot and whose slots are 60 s apart on the page's
     * clock; the clock is faked, so a test starts a slot by moving it. The first message yield after this returns is held.
     */
    async function startTickPage(options: { hooks?: Hooks, peer?: PeerDouble } = {}) {
        const page = await startPage(buildSmall(4), options.hooks ?? {}, { intervalMs: 60_000, moduleIntervalMs: 1, backstopMs: 0 }, options.peer)
        // No `settled`: with the change effects inert no boot pass runs, so the loop never reports an iteration committed.
        const inFlight = await import('src/ts/process/inFlightWork')
        const onHide = await import('src/ts/process/saveOnHide')
        const guard = await import('src/ts/process/hiddenReplySaveGuard')
        const loopModule = await import('src/ts/storage/store2/saveLoop')
        const stores = await import('src/ts/stores.svelte')
        resetGuard = guard.resetHiddenReplySaveGuardForTest
        stores.savingStoppedReason.set('')
        vi.useFakeTimers({ toFake: ['Date'] })
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        let reads = 0
        vi.spyOn(performance, 'now').mockImplementation(() => (reads += 10))
        const held = holdFirstMessage()
        const kinds: string[][] = []
        inFlight.subscribeInFlight(() => { kinds.push(inFlight.inFlightKinds()) })
        const startSlot = (): void => { vi.setSystemTime(Date.now() + 61_000) }
        return { page, inFlight, onHide, guard, loopModule, held, kinds, startSlot }
    }

    /** The first module's edit made with no mark: only the idle net can find it. */
    function moduleEdit(page: { w: World, db: Entry }): void {
        ;(page.db.modules as Entry[])[3].description = 'unmarked module edit'
        expect(page.w.api.hasUnsavedSaveMarks()).toBe(false)
    }

    // Reproducer: on the Stage 1 base the tick finishes under the page rule and commits the module edit before the reply.
    test('reproducer: TP1 a reply flushed into a hidden module tick commits first and the redo token holds until the module edit lands', async () => {
        const { page, inFlight, onHide, held, startSlot } = await startTickPage()
        const seedValue = (page.k.seedDb.modules as unknown as Entry[])[3].description
        startSlot()
        await until(() => held.entered(), 'the tick in its first message yield', 8000)
        moduleEdit(page)
        characters(page.db)[2].personality = 'final reply'
        onHide.flushPageReplyEndWhenHidden({ chaId: characters(page.db)[2].chaId as string })
        const atFirst: { value: { snapshot: Map<string, Uint8Array>, kinds: string[] } | null } = { value: null }
        page.w.api.afterNextSaveCommit(() => { atFirst.value = { snapshot: page.k.memory.snapshot(), kinds: inFlight.inFlightKinds() } })
        await until(() => atFirst.value !== null, 'the first commit after the flush', 8000)

        const first = atFirst.value!
        const decoded = await decodeSnapshot(first.snapshot)
        expect((decoded.modules as unknown as Entry[])[3].description).toBe(seedValue)
        expect((decoded.characters as unknown as Entry[])[2].personality).toBe('final reply')
        expect(first.kinds).toEqual(['save'])
        await sleepReal(300)
        expect(inFlight.inFlightKinds()).toEqual(['save'])
        expect(((await page.k.saved()).modules as unknown as Entry[])[3].description).toBe(seedValue)

        startSlot()
        await until(() => inFlight.inFlightKinds().length === 0, 'the redo to end the token', 8000)
        const saved = await page.k.saved()
        expect((saved.modules as unknown as Entry[])[3].description).toBe('unmarked module edit')
        expect((saved.characters as unknown as Entry[])[2].personality).toBe('final reply')
    })

    // Guard (passes on the Stage 1 base and after; red when the token ends early): the reply's commit alone does not end the token.
    test('guard: TP2 the store holds the module edit and the reply when the kinds first become empty', async () => {
        const { page, inFlight, onHide, held, startSlot } = await startTickPage()
        startSlot()
        await until(() => held.entered(), 'the tick in its first message yield', 8000)
        moduleEdit(page)
        characters(page.db)[2].personality = 'final reply'
        onHide.flushPageReplyEndWhenHidden({ chaId: characters(page.db)[2].chaId as string })
        const captured: { value: Map<string, Uint8Array> | null } = { value: null }
        inFlight.subscribeInFlight(() => {
            if (captured.value === null && inFlight.inFlightKinds().length === 0) {
                captured.value = page.k.memory.snapshot()
            }
        })
        await until(async () => (await savedPersonality(page.k, 2)) === 'final reply', 'the reply saved', 8000)
        startSlot()
        await until(() => captured.value !== null, 'the kinds to become empty', 8000)

        const decoded = await decodeSnapshot(captured.value!)
        expect((decoded.modules as unknown as Entry[])[3].description).toBe('unmarked module edit')
        expect((decoded.characters as unknown as Entry[])[2].personality).toBe('final reply')
    })

    // Guard (new mechanism): a stop ends the token; the redo never runs on a parked loop.
    test('guard: TP3 a replaced park ends the token', async () => {
        const { page, inFlight, loopModule, held, kinds, startSlot } = await startTickPage()
        startSlot()
        await until(() => held.entered(), 'the tick in its first message yield', 8000)
        page.k.memory.poke(COMMIT_KEY, null)
        characters(page.db)[0].personality = 'edit before the park'
        page.w.marks.markCharacterForSave(characters(page.db)[0].chaId)
        page.w.api.requestSaveNow()

        await until(() => loopModule.isSaveLoopParked(), 'the loop to park on the missing commit key', 8000)
        await until(() => inFlight.inFlightKinds().length === 0, 'the stop to end the token', 8000)

        expect(kinds[0]).toEqual(['save'])
        expect(kinds[kinds.length - 1]).toEqual([])
    })

    // Guard (new mechanism): the unpark before Save mine clears the stop with an empty reason and must not end the token.
    test('guard: TP4 Save mine keeps the token until the redo ends', async () => {
        const peer = createPeerDouble('save-mine')
        const recorded: { kinds: string[] | null } = { kinds: null }
        let inFlightModule: typeof import('src/ts/process/inFlightWork') | null = null
        const hooks: Hooks = {
            before: async (name) => {
                if (name === 'readCommit' && peer.asked.length >= 1 && recorded.kinds === null && inFlightModule !== null) {
                    recorded.kinds = inFlightModule.inFlightKinds()
                }
            },
        }
        const { page, inFlight, held, startSlot } = await startTickPage({ hooks, peer })
        inFlightModule = inFlight
        startSlot()
        await until(() => held.entered(), 'the tick in its first message yield', 8000)
        await peerCommit(page.k, (peerDb) => { (peerDb.characters as unknown as Entry[])[3].personality = 'the peer edit' })
        characters(page.db)[0].personality = 'my edit'
        page.w.marks.markCharacterForSave(characters(page.db)[0].chaId)
        page.w.api.requestSaveNow()

        await until(() => peer.asked.length >= 1, 'the Save mine prompt', 8000)
        expect(peer.asked[0].offers).toContain('save-mine')
        await until(async () => (await savedPersonality(page.k, 0)) === 'my edit', 'Save mine to land', 8000)

        expect(recorded.kinds).toEqual(['save'])
        expect(inFlight.inFlightKinds()).toEqual(['save'])
        startSlot()
        await until(() => inFlight.inFlightKinds().length === 0, 'the forced redo to end the token', 8000)
    })

    // Guard (new mechanism): one token however many cuts in a row; the third tick ends it; a later streak begins a new one.
    test('guard: TP5 two cuts hold one token, the third tick ends it, a later cut holds a fresh one', async () => {
        const { page, inFlight, held, kinds, startSlot } = await startTickPage()
        const cutWith = async (index: number): Promise<void> => {
            characters(page.db)[index].personality = `cut edit ${index}`
            page.w.marks.markCharacterForSave(characters(page.db)[index].chaId)
            page.w.api.requestSaveNow()
            await until(async () => (await savedPersonality(page.k, index)) === `cut edit ${index}`, `cut ${index} saved`, 8000)
            expect(inFlight.inFlightKinds()).toEqual(['save'])
        }
        startSlot()
        await until(() => held.entered(), 'tick 1 in its first message yield', 8000)
        await cutWith(0)
        held.armAgain()
        startSlot()
        await until(() => held.entered(), 'the redo (tick 2) in its first message yield', 8000)
        await cutWith(1)
        startSlot()
        await until(() => inFlight.inFlightKinds().length === 0, 'the third tick to end the token', 8000)
        // One begin and one end for the whole streak.
        expect(kinds.filter((entry) => entry.length === 1)).toHaveLength(1)

        held.armAgain()
        startSlot()
        await until(() => held.entered(), 'tick 4 in its first message yield', 8000)
        await cutWith(2)
    })
})
