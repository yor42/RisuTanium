/**
 * The explicit write hook (`dbWriteHook.ts`) on a store2 page: the real, unmocked `saveDb()` loop and the real change
 * effects over a reactive `DBState` on which the stores mock calls `installDbWriteHook` itself, as `stores.svelte.ts`
 * does in the application. The store is an in-memory store2 backend (see `store2SaveKit.ts`). A mocked success here is
 * not evidence of native backend behaviour.
 *
 * Labels: guard (passes with or without the change it names), mechanism (fails when the named rule is removed),
 * accepted-behaviour pin (holds only with the hook installed).
 * - T16 (mechanism): a store2 residency load puts the character into its slot with no mark and no pass; a field write
 *   inside the quiet scope, and the same placement on the legacy branch, still mark.
 * - T18b (guard plus one mechanism assertion): a resident, non-selected character put back by the store2 net holds its
 *   id once, takes exactly one pass, and the page is quiet after it; the swap's single `newChar:` mark needs the hook.
 * - T19b (accepted-behaviour pin): a character that streams while not selected holds the debounce for a third
 *   character's edit until the stream ends; one pass then writes both.
 * - SC1 (mechanism): the install-time self-check records a callback that nothing reaches.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeCharacter, makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit, type Store2StartOptions } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall } from 'src/ts/storage/tests/store2/codecFixtures'
import { stubFromEntry } from 'src/ts/storage/store2/codec'
import { buildColdStub } from 'src/ts/process/coldCharacter'
import type { Database } from 'src/ts/storage/database.svelte'
import type { toSaveType } from 'src/ts/storage/risuSave'

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

/** Every mark the installed hook reported, as its label, in order; reset for each test. */
const hookMarks: string[] = []
/** The tracker the loop was given by `installCharacterSaveMarks`; the loop's own, so a test reads what a pass will take. */
const captured: { tracker: toSaveType | null } = { tracker: null }
const units = new Map<string, unknown>()

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
    hookMarks.length = 0
    captured.tracker = null
    units.clear()
    // The real effects: `saveLoopMocks.svelte.ts` replaces them, and the identity tracker is one of the nets the hook sits beside.
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    vi.doMock('src/ts/storage/characterSaveMarks', async (importOriginal) => {
        const original = await importOriginal<typeof import('src/ts/storage/characterSaveMarks')>()
        return {
            ...original,
            installCharacterSaveMarks: (target: Parameters<typeof original.installCharacterSaveMarks>[0]) => {
                captured.tracker = target.tracker
                original.installCharacterSaveMarks(target)
            },
        }
    })
    // The factory runs inside the world's own module graph: the state, the hook, the patched runtime and the marks
    // it reports to must be that graph's copies. The root is a state proxy, what `$state({ db })` compiles to.
    vi.doMock('src/ts/stores.svelte', async () => {
        const { proxy } = await import('svelte/internal/client')
        const { untrack } = await import('svelte')
        const { get, writable } = await import('svelte/store')
        const { installDbWriteHook, describeDbWriteMark } = await import('src/ts/storage/dbWriteHook')
        const { markDbWrite } = await import('src/ts/storage/characterSaveMarks')
        const DBState = proxy({ db: {} as Entry })
        const selectedCharID = writable(-1)
        installDbWriteHook(DBState, {
            selectedChaId: () => untrack(() => (DBState.db.characters as Entry[] | undefined)?.[get(selectedCharID)]?.chaId),
            sink: (mark) => {
                hookMarks.push(describeDbWriteMark(mark))
                markDbWrite(mark)
            },
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
    // The reader of the legacy units: a map. The entity tests unmock it for the real reader.
    vi.doMock('src/ts/process/coldstorage.svelte', async () => {
        const { noteReadSize } = await import('src/ts/process/memory/restoredBytes')
        return {
            getColdStorageItem: vi.fn(),
            writeColdStorageUnit: async (key: string, value: unknown) => {
                units.set(key, JSON.parse(JSON.stringify(value)))
                return 'written'
            },
            readColdStorageItem: async (key: string) => {
                const unit = units.get(key)
                if (unit === undefined) {
                    return { status: 'missing' }
                }
                const json = JSON.stringify(unit)
                const result = { status: 'ok', value: JSON.parse(json) }
                noteReadSize(result, json.length)
                return result
            },
        }
    })
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(() => {
    worlds.parkAll()
    vi.doUnmock('src/ts/storage/characterSaveMarks')
    vi.doUnmock('src/ts/storage/svelteStatePatch')
    vi.doMock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }))
    vi.restoreAllMocks()
})

interface Page {
    w: World
    k: Store2Kit
    /** The database the loop and the change effects read: a reactive proxy. */
    db: Entry
    stores: typeof import('src/ts/stores.svelte')
    flush(): void
}

interface PageOptions extends Partial<Store2StartOptions> {
    /** The database the page runs on, when it differs from the one the store was seeded from. */
    live?: Database
    /** Runs after the page is arranged and before the loop starts. */
    beforeStart?: (page: Page) => void
    /** False leaves the loop unstarted: nothing is installed to receive marks, the hook still reports them. */
    startLoop?: boolean
}

const characters = (db: Entry): Entry[] => db.characters as Entry[]

/** Starts the loop of a store2 session over a reactive `DBState` carrying the hook, as the application runs it. */
async function startPage(db: Database, options: PageOptions = {}): Promise<Page> {
    const { beforeStart, live, startLoop, ...kitOptions } = options
    h.db = (live ?? db) as unknown as Entry
    const k = await startStore2({ db, ...kitOptions })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    const { flushSync } = await import('svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    const page: Page = { w, k, db: h.db, stores, flush: flushSync }
    beforeStart?.(page)
    if (startLoop !== false) {
        w.start()
        await sleepReal(150)
    }
    hookMarks.length = 0
    return page
}

const small = () => buildSmall(4)

describe('T16: a store2 residency load installs the character in its slot without a mark or a pass', () => {
    interface ArchivedPage extends Page {
        slot(): Entry
        /** Restores the archived character 'x' in place, as `changeChar` does, and lets the loop settle. */
        restore(): Promise<{ status: string }>
    }

    /** A page whose list holds the archived character 'x'; `entity` stores it as a store2 entity, else as a legacy unit. */
    async function startArchived(entity: boolean, options: PageOptions = {}): Promise<ArchivedPage> {
        const full = makeCharacter('x')
        full.chats = [{ id: 'x-chat', message: [{ role: 'char', data: 'hello from the unit', time: 1 }], note: '', name: '', localLore: [] }]
        const live = makeDb('p', ['y'])
        let page: Page
        if (entity) {
            // The real cold-storage reader serves the load; it pulls in the chat pipeline for `doingChat` only.
            vi.doUnmock('src/ts/process/coldstorage.svelte')
            vi.doMock('src/ts/process/index.svelte', async () => {
                const { writable } = await import('svelte/store')
                return { doingChat: writable(false) } as unknown as typeof import('src/ts/process/index.svelte')
            })
            const stored = makeDb('p', ['y'])
            ;(stored.characters as unknown[]).unshift(JSON.parse(JSON.stringify(full)))
            page = await startPage(stored as unknown as Database, {
                ...options,
                live: live as unknown as Database,
                stubs: ['x'],
                beforeStart: (started) => {
                    // The page holds the stub of the entity the seeded tree holds for the character.
                    const u = started.k.context.previous.entities.get('x#0') as string
                    const entry = started.k.residency.entryOf(u)
                    if (entry === null) {
                        throw new Error('The seeded tree holds no entity for the character.')
                    }
                    characters(started.db).unshift(stubFromEntry(entry) as Entry)
                },
            })
        } else {
            units.set('unit-x', { character: full })
            ;(live.characters as unknown[]).unshift(buildColdStub(full as never, 'unit-x', []))
            page = await startPage(makeDb('p', ['y']) as unknown as Database, { ...options, live: live as unknown as Database, startLoop: false })
        }
        const slot = () => characters(page.db).find((c) => c.chaId === 'x')!
        return {
            ...page,
            slot,
            restore: async () => {
                const { restoreColdCharacter } = await import('src/ts/process/coldCharacterRestore')
                const outcome = await restoreColdCharacter(slot() as never, { byChaId: true, quiet: true })
                page.flush()
                return outcome
            },
        }
    }

    test('the load of an archived character marks nothing: no hook mark, no scheduled save', async () => {
        const open = await startArchived(true)
        await settled(open.w)
        hookMarks.length = 0
        const marksBefore = open.w.api.getSaveMarkCount()

        const outcome = await open.restore()
        await sleepReal(200)
        await settled(open.w)

        expect(outcome.status).toBe('restored')
        expect(open.slot().coldstorage).toBeUndefined()
        expect(hookMarks).toEqual([])
        expect(open.w.api.getSaveMarkCount()).toBe(marksBefore)

        // Positive control: the hook is live on this page, so the silence above is the quiet scope, not a dead hook.
        characters(open.db).find((c) => c.chaId === 'y')!.name = 'y renamed'
        expect(hookMarks).toContain('char:y')
        expect(open.w.api.getSaveMarkCount()).toBeGreaterThan(marksBefore)
    })

    test('the same placement on the legacy branch is marked: the quiet scope is for a store2 entity load only', async () => {
        const open = await startArchived(false)

        const outcome = await open.restore()

        expect(outcome.status).toBe('restored')
        expect(open.slot().coldstorage).toBeUndefined()
        expect(hookMarks).toContain('newChar:x')
    })

    test('a field write inside the quiet scope still marks; only the placement is silent', async () => {
        const page = await startPage(small())
        const { withQuietCharacterInstall } = await import('src/ts/storage/dbWriteHook')
        const replacement = JSON.parse(JSON.stringify(characters(page.db)[1])) as Entry
        const chaId = String(replacement.chaId)
        const marksBefore = page.w.api.getSaveMarkCount()

        withQuietCharacterInstall(() => { characters(page.db)[1] = replacement })
        expect(hookMarks).toEqual([])
        expect(page.w.api.getSaveMarkCount()).toBe(marksBefore)

        withQuietCharacterInstall(() => { characters(page.db)[1].personality = 'edited inside the scope' })
        expect(hookMarks).toContain('char:' + chaId)
        expect(page.w.api.getSaveMarkCount()).toBeGreaterThan(marksBefore)
    })
})

describe('T18b: a resident character put back by the store2 net takes one pass and the page is quiet after it', () => {
    const idleNet = { intervalMs: 100, moduleIntervalMs: 1_000_000_000, backstopMs: 30_000 }

    test('its id is held once, one pass commits, then two idle intervals pass with no mark and no write', async () => {
        const full = makeCharacter('x')
        full.chats = [{ id: 'x-chat', message: [{ role: 'char', data: 'hello from the unit', time: 1 }], note: '', name: '', localLore: [] }]
        const stored = makeDb('p', ['y'])
        ;(stored.characters as unknown[]).unshift(JSON.parse(JSON.stringify(full)))
        const live = makeDb('p', ['y'])
        // The real reader and the real put-back; the page loads 'x' as a store2 entity and puts it back once the user moves on.
        vi.doUnmock('src/ts/process/coldstorage.svelte')
        vi.doMock('src/ts/process/index.svelte', async () => {
            const { writable } = await import('svelte/store')
            return { doingChat: writable(false) } as unknown as typeof import('src/ts/process/index.svelte')
        })
        const page = await startPage(stored as unknown as Database, {
            idleNet,
            live: live as unknown as Database,
            stubs: ['x'],
            beforeStart: (started) => {
                const u = started.k.context.previous.entities.get('x#0') as string
                const entry = started.k.residency.entryOf(u)
                if (entry === null) {
                    throw new Error('The seeded tree holds no entity for the character.')
                }
                characters(started.db).unshift(stubFromEntry(entry) as Entry)
            },
        })
        const slot = () => characters(page.db).find((c) => c.chaId === 'x')!
        const indexOfX = () => characters(page.db).findIndex((c) => c.chaId === 'x')
        const { restoreColdCharacter } = await import('src/ts/process/coldCharacterRestore')
        const { startCharacterPutBack } = await import('src/ts/process/memory/characterPutBack')
        const stop = startCharacterPutBack()
        try {
            await settled(page.w)
            expect((await restoreColdCharacter(slot() as never, { byChaId: true, quiet: true })).status).toBe('restored')
            page.stores.selectedCharID.set(indexOfX())
            page.flush()
            await sleepReal(100)
            await settled(page.w)
            expect(typeof slot().coldstorage, 'the selected character stays loaded').toBe('undefined')

            let commits = 0
            const countCommits = (): void => { page.w.api.afterNextSaveCommit(() => { commits += 1; countCommits() }) }
            countCommits()
            let scans = 0
            const realScan = page.k.encoder.netScan.bind(page.k.encoder)
            page.k.encoder.netScan = (scanned) => { scans += 1; return realScan(scanned) }
            hookMarks.length = 0

            page.stores.selectedCharID.set(-1)
            page.flush()
            await until(() => typeof slot().coldstorage === 'string', 'the character to be put back')

            // The swap is one placement mark of the hook plus the put-back's own mark; the tracker holds the id once.
            expect(hookMarks.filter((mark) => mark === 'newChar:x')).toHaveLength(1)
            expect(captured.tracker!.character.filter((id) => id === 'x')).toHaveLength(1)
            const commitsAtSwap = commits
            await until(() => commits > commitsAtSwap, 'the pass the swap asks for')
            await settled(page.w)
            expect(commits).toBe(commitsAtSwap + 1)

            const marksAfterPass = page.w.api.getSaveMarkCount()
            page.k.counted.reset()
            const scansAfterPass = scans
            await until(() => scans >= scansAfterPass + 2, 'two idle intervals to pass', 20_000)
            expect(commits).toBe(commitsAtSwap + 1)
            expect(page.w.api.getSaveMarkCount()).toBe(marksAfterPass)
            expect(page.k.counted.writeCalls()).toBe(0)
        } finally {
            stop()
        }
    })
})

describe('T19b: a character that streams while not selected holds the debounce for a third character\'s edit', () => {
    test('nothing is written during the stream; when it ends one pass writes both edits', async () => {
        const page = await startPage(small())
        await settled(page.w)
        let commits = 0
        const countCommits = (): void => { page.w.api.afterNextSaveCommit(() => { commits += 1; countCommits() }) }
        countCommits()
        const streaming = characters(page.db)[2]
        const third = characters(page.db)[3]
        const message = ((streaming.chats as Entry[])[0].message as Entry[])[0]

        // A token every 100 ms: each write marks the streaming character and restarts the 500 ms debounce.
        let tokens = 0
        const timer = setInterval(() => { tokens += 1; message.data = 'streamed ' + tokens }, 100)
        try {
            await sleepReal(300)
            third.personality = 'third character edit'
            await sleepReal(900)
            // The stream has run well past the debounce, yet the pass the debounce asks for has not started.
            expect(tokens).toBeGreaterThanOrEqual(8)
            expect(commits).toBe(0)
            expect(page.w.api.isSaveClean()).toBe(false)
            expect(page.w.api.hasUnsavedSaveMarks()).toBe(true)
            const during = (await page.k.saved()).characters as unknown as Entry[]
            expect(during[3].personality).not.toBe('third character edit')
            expect(((during[2].chats as Entry[])[0].message as Entry[])[0].data).not.toBe(message.data)
        } finally {
            clearInterval(timer)
        }

        await until(() => commits > 0, 'the pass after the stream ended', 5000)
        await settled(page.w)
        expect(commits).toBe(1)
        const after = (await page.k.saved()).characters as unknown as Entry[]
        expect(after[3].personality).toBe('third character edit')
        expect(((after[2].chats as Entry[])[0].message as Entry[])[0].data).toBe(message.data)
    })
})

describe('SC1: the install-time self-check records a write callback that nothing reaches', () => {
    const selfCheckRecords = () => (window.__risuTaniumErrors ?? []).filter((record) => record.site === 'dbWriteHook.selfCheck')

    test('a live hook records nothing; with the callback unregistered the check reports it', async () => {
        await startPage(small())
        const hook = await import('src/ts/storage/dbWriteHook')
        const patch = await import('src/ts/storage/svelteStatePatch')
        expect(selfCheckRecords()).toEqual([])
        expect(hook.selfCheckDbWriteHook()).toBe(true)
        expect(selfCheckRecords()).toEqual([])

        patch.setStateWriteHook(null)
        expect(hook.selfCheckDbWriteHook()).toBe(false)
        expect(selfCheckRecords()).toHaveLength(1)
        expect(selfCheckRecords()[0].message).toContain('did not observe')
    })

    test('installDbWriteHook runs the check itself: a runtime that never calls the callback is recorded at boot', async () => {
        // A patched runtime whose registration is dropped stands for a build that shipped the stock runtime.
        vi.doMock('src/ts/storage/svelteStatePatch', async (importOriginal) => ({
            ...(await importOriginal<typeof import('src/ts/storage/svelteStatePatch')>()),
            setStateWriteHook: () => { },
        }))
        h.db = makeDb('base', ['alpha'])
        await worlds.startWorld({ startLoop: false })
        expect(selfCheckRecords()).toHaveLength(1)
    })
})
