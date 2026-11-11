/**
 * The page's store2 loop port runs `liveCheck` (the walk of `db.characters`) through `createLiveCheckGate`. Runs the real
 * loop over the in-memory kit; every loop sleep ends within a few milliseconds, so the port is asked about a hundred
 * times a second and a window of a few hundred milliseconds stands for a quiet idle page. The walk is counted at its
 * only reader of the first character's id (`liveCharacterCheck`); the readings the port hands the gate are recorded
 * through a pass-through wrapper of the real gate. Mocked store; not native WebView evidence.
 * Labels: wiring reproducer for "a quiet page does not walk on every call" (fails on the base, where the walk runs on
 * every call); the rest are new-rule tests of the glue (they read the gate's readings, so they fail on the base, which
 * has no gate) and stay red when a trigger or the failed-pass input is lost.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { createWorldKit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Hooks, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall } from 'src/ts/storage/tests/store2/codecFixtures'
import type { Database } from 'src/ts/storage/database.svelte'
import type { LiveCheckSignal } from 'src/ts/storage/store2/liveCheckGate'

vi.setConfig({ testTimeout: 40_000 })

const walkBox = vi.hoisted(() => ({ firstId: null as unknown, walks: 0 }))
const gateBox = vi.hoisted(() => ({ signals: [] as LiveCheckSignal[] }))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

// One call with the first character's id from inside `liveCharacterCheck` is one clean walk of the list.
vi.mock('src/ts/storage/characterIds', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/storage/characterIds')>()
    return {
        ...actual,
        isUsableCharacterId: ((id: unknown) => {
            if (walkBox.firstId !== null && id === walkBox.firstId && new Error().stack?.includes('liveCharacterCheck')) {
                walkBox.walks += 1
            }
            return actual.isUsableCharacterId(id)
        }) as typeof actual.isUsableCharacterId,
    }
})

vi.mock('src/ts/storage/store2/liveCheckGate', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/storage/store2/liveCheckGate')>()
    return {
        ...actual,
        createLiveCheckGate: (options?: { intervalMs?: number }) => {
            const gate = actual.createLiveCheckGate(options)
            return {
                due: (signal: LiveCheckSignal, now: number) => {
                    gateBox.signals.push({ ...signal })
                    return gate.due(signal, now)
                },
                walked: gate.walked,
            }
        },
    }
})

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
    walkBox.firstId = null
    walkBox.walks = 0
    gateBox.signals.length = 0
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

async function startPage(db: Database, hooks: Hooks): Promise<{ w: World, k: Store2Kit, db: Entry }> {
    h.db = db as unknown as Entry
    const k = await startStore2({ db, hooks })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    w.start()
    await sleepReal(150)
    return { w, k, db: h.db }
}

/** An idle page: the loop is clean, the walk is counted from here, and the readings recorded so far are dropped. */
async function idlePage(hooks: Hooks = {}): Promise<{ w: World, k: Store2Kit, db: Entry }> {
    const page = await startPage(buildSmall(20), hooks)
    await settled(page.w)
    walkBox.firstId = characters(page.db)[0].chaId
    await sleepReal(100)
    walkBox.walks = 0
    gateBox.signals.length = 0
    return page
}

function lastSignal(): LiveCheckSignal {
    return gateBox.signals[gateBox.signals.length - 1]
}

/** The reading of the loop's next liveCheck call. */
async function readingNow(): Promise<LiveCheckSignal> {
    await until(() => gateBox.signals.length > 0, 'a liveCheck call', 5000)
    return lastSignal()
}

describe('a quiet page does not walk its character list on every liveCheck call', () => {
    // Reproducer: on the base the port walks on every call, so the count in the window is in the dozens.
    test('reproducer: nothing changed, so no walk in a window of many loop turns', async () => {
        await idlePage()
        await sleepReal(400)

        expect(walkBox.walks).toBe(0)
        expect(gateBox.signals.length).toBeGreaterThan(5)
        const stores = await import('src/ts/stores.svelte')
        expect(gateBox.signals.every((signal) => signal.db === (stores.DBState as { db: unknown }).db)).toBe(true)
    })
})

describe('a signal makes the next liveCheck call walk', () => {
    test('a save mark and a save request', async () => {
        const page = await idlePage()
        const marksBefore = (await readingNow()).marks

        walkBox.walks = 0
        characters(page.db)[2].personality = 'marked edit'
        page.w.marks.markCharacterForSave(characters(page.db)[2].chaId)
        page.w.api.requestSaveNow()

        await until(() => walkBox.walks >= 1, 'a walk after the mark', 5000)
        expect(gateBox.signals.some((signal) => signal.marks !== marksBefore)).toBe(true)
        expect(gateBox.signals.some((signal) => signal.dirty)).toBe(true)
        expect(gateBox.signals.some((signal) => signal.due)).toBe(true)
    })

    test('a longer character list', async () => {
        const page = await idlePage()
        const added = JSON.parse(JSON.stringify(characters(page.db)[0])) as Entry
        added.chaId = 'added-character'

        walkBox.walks = 0
        characters(page.db).push(added)

        await until(() => walkBox.walks >= 1, 'a walk after the push', 5000)
        expect(gateBox.signals.some((signal) => signal.length === 21)).toBe(true)
    })

    test('a replaced character array of the same length', async () => {
        const page = await idlePage()
        const arrayBefore = (await readingNow()).characters

        walkBox.walks = 0
        page.db.characters = [...characters(page.db)]

        await until(() => walkBox.walks >= 1, 'a walk after the replacement', 5000)
        expect(lastSignal().characters).not.toBe(arrayBefore)
        expect(lastSignal().length).toBe(20)
    })

    test('a failed save pass: the walk runs with no other signal, keeps running while the failure stands and stops after it clears', async () => {
        await idlePage()
        const { saveFailureStore } = await import('src/ts/storage/store2/saveFailure')

        saveFailureStore.set({ class: 'other', attempts: 1 })

        await until(() => walkBox.walks >= 1, 'a walk right after the failed pass', 5000)
        const first = walkBox.walks
        await until(() => walkBox.walks >= first + 2, 'further walks while the failure stands', 5000)
        expect(lastSignal()).toMatchObject({ failed: true, dirty: false, due: false })

        saveFailureStore.set(null)
        await sleepReal(100)
        walkBox.walks = 0
        await sleepReal(300)
        expect(walkBox.walks).toBe(0)
        expect(lastSignal().failed).toBe(false)
    })

    test('a real failed pass reaches the signal and the recovery clears it', async () => {
        const fault = failingCommit()
        const page = await idlePage(fault.hooks)
        fault.on = true

        characters(page.db)[2].personality = 'edit that fails to commit'
        page.w.marks.markCharacterForSave(characters(page.db)[2].chaId)
        page.w.api.requestSaveNow()
        await until(() => fault.hits >= 1, 'the failed pass', 5000)
        await until(() => gateBox.signals.some((signal) => signal.failed), 'the failed signal', 5000)

        fault.on = false
        await until(async () => ((await page.k.saved()).characters[2] as unknown as Entry).personality === 'edit that fails to commit', 'the retry to commit', 8000)
        await until(() => lastSignal().failed === false, 'the failed signal to clear', 5000)
    })
})

describe('a quiet page walks again after 30 s', () => {
    test('no walk at 29 s, a walk past 30 s, and the interval restarts at that walk', async () => {
        await idlePage()
        vi.useFakeTimers({ toFake: ['Date'] })

        vi.setSystemTime(Date.now() + 29_000)
        await sleepReal(300)
        expect(walkBox.walks).toBe(0)

        vi.setSystemTime(Date.now() + 2_000)
        await until(() => walkBox.walks >= 1, 'the walk after 31 s', 5000)

        await sleepReal(100)
        walkBox.walks = 0
        await sleepReal(300)
        expect(walkBox.walks).toBe(0)
    })
})
