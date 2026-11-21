// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync } from 'svelte'

vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: {} },
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        loadedStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/process/index.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return { doingChat: writable(false) } as unknown as typeof import('src/ts/process/index.svelte')
})
vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertNormal: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/characters'), () => ({
    characterFormatUpdate: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: vi.fn(async () => ({
        read: async () => ({ bytes: null, version: null }),
        has: async () => false,
    })),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

import type { Database } from 'src/ts/storage/database.svelte'
import {
    installCharacterSaveMarks, markCharacterForSave, markDbWrite, resetCharacterSaveMarksForTest, type SaveMarkKind,
} from 'src/ts/storage/characterSaveMarks'
import { registerDbChangeEffects } from 'src/ts/storage/dbChangeEffects.svelte'
import { DBState } from 'src/ts/stores.svelte'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import type { Committer } from 'src/ts/storage/store2/commit'
import type { FastForwardOutcome } from 'src/ts/storage/store2/fastForward'
import { runStore2SaveLoop, PARK_CHECK_MAX_MS, type IdleNetOptions, type Store2LoopPort } from 'src/ts/storage/store2/saveLoop'
import type { Store2SaveContext } from 'src/ts/storage/store2/saveActive'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { withQuietCharacterInstall } from 'src/ts/storage/dbWriteHook'
import { chaIdOf, chars, clone, olderBuildCommit, until } from './lineFixtures'
import { bootB, ffSetup, ffTeardown, ffWorldOver, runSpyOf, signal, useFfHost, type PageB } from './ffFixtures'

/**
 * The fast-forward takes of a peer commit that changes view state or settings, then an immediate park: the page must show
 * the clean prompt (MC-2266, MC-2298), because the marks a take raises are judged by value and the take advanced the
 * acknowledged encoding to the peer's tree. The page is dispatch-booted over a store seeded the way the fast-forward suites
 * seed it; the host's marks, the write hook and the change effects are the real ones, and the loop's port follows the
 * page's port contract (the content flag, the mark count, `requestPass(content)`), which Gate 2 diffs against
 * `saveDbStore2`. Labels: reproducer (fails on the base for the defect itself), guard (passes with or without the change).
 */

type Slots = unknown[]
type Seed = (db: Database) => void

let hostHandle: ReturnType<typeof ffSetup>
let cleanups: Array<() => void> = []

beforeEach(() => { hostHandle = ffSetup() })
afterEach(() => {
    cleanups.forEach(cleanup => cleanup())
    cleanups = []
    resetCharacterSaveMarksForTest()
    ffTeardown()
})

interface ViewLoop {
    tracker: toSaveType
    state: { due: boolean, dirty: boolean, content: boolean, marks: number, saved: number, peerHeard: boolean }
    crashed: unknown[]
    stop(): void
}

/** The page's `saveTimeoutExecute` and port over `context`: a dirty mark is due 200 ms later, as a debounce is. */
function runViewLoop(context: Store2SaveContext, db: Database, idleNet: IdleNetOptions | null = null): ViewLoop {
    let stopped = false
    let tail: Promise<void> = Promise.resolve()
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    const view: ViewLoop = {
        tracker,
        state: { due: false, dirty: false, content: false, marks: 0, saved: 0, peerHeard: false },
        crashed: [],
        stop() { stopped = true },
    }
    context.idleNet = idleNet
    const idle = () => new Promise<void>((resolve) => {
        if (!stopped) {
            setTimeout(resolve, 2)
        }
    })
    const port: Store2LoopPort = {
        tracker,
        reloadFlag: { state: false },
        getDatabase: () => db,
        mergeBack(live, snapshot) {
            for (const chaId of snapshot.character) {
                if (!live.character.includes(chaId)) {
                    live.character.push(chaId)
                }
            }
        },
        liveCheck: () => { },
        sweep: () => { },
        isDue: () => view.state.due,
        isDirty: () => view.state.dirty,
        contentState: () => ({ unsaved: view.state.content, marks: view.state.marks }),
        hasDrafts: () => false,
        beginIteration() {
            view.state.due = false
        },
        endIteration() { },
        snapshotTaken() {
            view.state.dirty = false
            view.state.content = false
        },
        requestPass(content = true) {
            view.state.dirty = true
            view.state.due = true
            view.state.marks += 1
            if (content) {
                view.state.content = true
            }
        },
        markUnsaved() {
            view.state.dirty = true
            view.state.content = true
        },
        unsavable() { },
        saved() {
            view.state.saved += 1
        },
        broadcast() { },
        peerHeard() {
            const heard = view.state.peerHeard
            view.state.peerHeard = false
            return heard
        },
        setStopped() { },
        notifyTooLarge() { },
        reportFailure: () => 1,
        reportUncountedFailure: () => 1,
        async withWriteLock(run) {
            const before = tail
            let release: () => void = () => { }
            tail = new Promise<void>((resolve) => { release = resolve })
            await before
            try {
                return await run()
            } finally {
                release()
            }
        },
        wait: idle,
        // The deadline of a judgement never elapses here: a 2 ms sleep would answer every judgement dirty.
        sleep: (ms) => ms === PARK_CHECK_MAX_MS ? new Promise<void>(() => { }) : idle(),
        sleepForever: () => new Promise<never>(() => { }),
        now: () => Date.now(),
    }
    runStore2SaveLoop(context, port).catch((error: unknown) => {
        view.crashed.push(error)
    })
    return view
}

interface ViewWorld {
    memory: MemoryBackend
    page: Awaited<ReturnType<typeof ffWorldOver>>['page']
    b: PageB
    view: ViewLoop
    run: ReturnType<typeof runSpyOf>
    /** Every mark the hook reported and every `schedule` the marks made, as labels. */
    hookMarks: string[]
    /** The kinds the page's marks and effects scheduled with, in order; `markChanged(false)` is not a dirty mark. */
    kinds: SaveMarkKind[]
}

const DEBOUNCE_MS = 200

interface ViewWorldOptions {
    count?: number
    seed?: Seed
    idleNet?: IdleNetOptions
    /** Runs once, inside the loop's first commit and before it: a peer's commit that lands while the pass is in flight. */
    beforeFirstCommit?: (memory: MemoryBackend, page: ViewWorld['page']) => Promise<void>
}

async function viewWorld(options: ViewWorldOptions = {}): Promise<ViewWorld> {
    const memory = createMemoryBackend()
    const world = await ffWorldOver(memory, { mintLine: true, count: options.count })
    if (options.seed !== undefined) {
        await world.page.commitEdit(options.seed)
    }
    const hookMarks: string[] = []
    const kinds: SaveMarkKind[] = []
    const b = await bootB(memory, { sink: (mark) => { hookMarks.push(JSON.stringify(mark)); markDbWrite(mark) } })
    const landing = options.beforeFirstCommit
    if (landing !== undefined) {
        // The loop reads its committer once, when it starts: the wrap goes in before it does.
        const real = b.context.session.committer
        let landed = false
        const scripted: Committer = {
            ...real,
            async commit(read, request) {
                if (!landed) {
                    landed = true
                    await landing(memory, world.page)
                }
                return real.commit(read, request)
            },
        }
        b.context.session = { ...b.context.session, committer: scripted }
    }
    const view = runViewLoop(b.context, b.db, options.idleNet ?? null)
    let timer: ReturnType<typeof setTimeout> | undefined
    const mark = (markDirty: boolean, kind: SaveMarkKind): void => {
        view.state.marks += 1
        if (!markDirty) {
            return
        }
        kinds.push(kind)
        view.state.dirty = true
        if (kind === 'content') {
            view.state.content = true
        }
        timer ??= setTimeout(() => {
            timer = undefined
            view.state.due = true
        }, DEBOUNCE_MS)
    }
    installCharacterSaveMarks({ tracker: view.tracker, schedule: (kind) => mark(true, kind ?? 'content') })
    hostHandle.host.state.onMark = (chaId) => markCharacterForSave(chaId)
    DBState.db = b.db
    cleanups.push($effect.root(() => {
        registerDbChangeEffects({
            tracker: view.tracker,
            markChanged: (markDirty) => mark(markDirty, 'judged'),
            markContentChanged: (markDirty) => mark(markDirty, 'content'),
        })
    }))
    flushSync()
    cleanups.push(() => { view.stop(); if (timer !== undefined) { clearTimeout(timer) } })
    view.tracker.character.length = 0
    view.state.dirty = false
    view.state.content = false
    view.state.due = false
    hookMarks.length = 0
    kinds.length = 0
    return { memory, page: world.page, b, view, run: runSpyOf(b), hookMarks, kinds }
}

const field = (db: Database, key: string, value: unknown): void => { (db as unknown as Record<string, unknown>)[key] = value }
const slotField = (db: Database, index: number, key: string, value: unknown): void => { (chars(db)[index] as unknown as Record<string, unknown>)[key] = value }

/** The peer commits `edit`, this page hears it, and the fast-forward's outcome is returned. */
async function peerTakes(w: ViewWorld, edit: (db: Database) => void): Promise<FastForwardOutcome> {
    const before = w.run.mock.calls.length
    await w.page.commitEdit(edit)
    signal(w.view)
    await until(() => w.run.mock.calls.length > before, 'the fast-forward run', 8000)
    const outcome = await w.run.mock.results[before].value as FastForwardOutcome
    flushSync()
    return outcome
}

/** The immediate park: an older build's commit lands before the debounce and this page hears it. */
async function parkNow(w: ViewWorld): Promise<void> {
    await olderBuildCommit(w.memory, w.page, (db) => { chars(db)[2].personality = 'a later older-build edit' })
    signal(w.view)
    await until(() => w.b.peer.clean.length + w.b.peer.asked.length >= 1, 'a prompt', 8000)
}

/** The state host carries the write hook and the reactive effects, so only it raises the take's marks; they are all judged. */
function expectMarked(mode: 'state' | 'plain', w: ViewWorld): void {
    if (mode === 'state') {
        expect(w.view.state.dirty).toBe(true)
        expect(w.kinds.length).toBeGreaterThan(0)
        expect(w.kinds.every(kind => kind === 'judged')).toBe(true)
    }
}

async function expectCleanPrompt(w: ViewWorld): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(w.b.peer.clean.length).toBe(1)
    expect(w.b.peer.clean[0]).toMatchObject({ reason: 'peer-commit', unsaved: false })
    expect(w.b.peer.asked).toEqual([])
    expect(w.view.crashed).toEqual([])
}

function insertAt(db: Database, index: number, chaId: string): void {
    const added = clone(chars(db)[0])
    added.chaId = chaId
    added.name = `Added ${chaId}`
    ;(db.characters as unknown as Slots).splice(index, 0, added)
    db.characterOrder = [...db.characterOrder, chaId]
}
function remove(db: Database, index: number): void {
    const id = chaIdOf(db, index)
    ;(db.characters as unknown as Slots).splice(index, 1)
    db.characterOrder = db.characterOrder.filter(item => item !== id)
}
const repeated: Seed = (db) => {
    const old = chaIdOf(db, 2)
    chars(db)[2].chaId = chaIdOf(db, 1)
    db.characterOrder = db.characterOrder.map(item => item === old ? chaIdOf(db, 1) : item)
}

for (const mode of ['state', 'plain'] as const) {
    describe(`a take, then an immediate park, shows the clean prompt (${mode} host)`, () => {
        useFfHost(mode)

        test('TK1 guard: a replacement take (a peer personality on an untouched character) raises no mark', async () => {
            const w = await viewWorld()
            expect(await peerTakes(w, (db) => { chars(db)[1].personality = 'peer edit' })).toEqual({ kind: 'applied' })
            expect(w.kinds).toEqual([])
            await parkNow(w)
            await expectCleanPrompt(w)
        })

        test('TK2 reproducer: an insertion take', async () => {
            const w = await viewWorld()
            expect(await peerTakes(w, (db) => { insertAt(db, 1, 'dm-ins') })).toEqual({ kind: 'applied' })
            expectMarked(mode, w)
            await parkNow(w)
            await expectCleanPrompt(w)
        })

        test('TK3 reproducer: an append take (a repeated seed)', async () => {
            const w = await viewWorld({ seed: repeated })
            expect(await peerTakes(w, (db) => { insertAt(db, db.characters.length, 'dm-app') })).toEqual({ kind: 'applied' })
            await parkNow(w)
            await expectCleanPrompt(w)
        })

        test('TK4 reproducer: a removal take', async () => {
            const w = await viewWorld()
            expect(await peerTakes(w, (db) => { remove(db, 1) })).toEqual({ kind: 'applied' })
            await parkNow(w)
            await expectCleanPrompt(w)
        })

        test('TK5 reproducer: a unit-path take (the character is in use)', async () => {
            const w = await viewWorld()
            hostHandle.host.state.inUse.add(chaIdOf(w.b.db, 1))
            expect(await peerTakes(w, (db) => { chars(db)[1].personality = 'peer edit' })).toEqual({ kind: 'applied' })
            expectMarked(mode, w)
            await parkNow(w)
            await expectCleanPrompt(w)
        })

        test('TK6 reproducer: a fields take (lastInteraction on every character)', async () => {
            const w = await viewWorld()
            expect(await peerTakes(w, (db) => { chars(db).forEach((_slot, index) => { slotField(db, index, 'lastInteraction', 1_800_000_000_000 + index) }) })).toEqual({ kind: 'applied' })
            expectMarked(mode, w)
            await parkNow(w)
            await expectCleanPrompt(w)
        })

        test('TK7 reproducer: a settings take (username)', async () => {
            const w = await viewWorld()
            expect(await peerTakes(w, (db) => { field(db, 'username', 'peer name') })).toEqual({ kind: 'applied' })
            expectMarked(mode, w)
            await parkNow(w)
            await expectCleanPrompt(w)
        })

        test('TK8 reproducer: a characterOrder-only take', async () => {
            const w = await viewWorld()
            expect(await peerTakes(w, (db) => { db.characterOrder = [...db.characterOrder].reverse() })).toEqual({ kind: 'applied' })
            expectMarked(mode, w)
            await parkNow(w)
            await expectCleanPrompt(w)
        })

        test('P847-1 reproducer: a peer firstMsgIndex is taken, then an immediate park', async () => {
            const w = await viewWorld()
            expect(await peerTakes(w, (db) => { slotField(db, 1, 'firstMsgIndex', 3) })).toEqual({ kind: 'applied' })
            await parkNow(w)
            await expectCleanPrompt(w)
        })

        test('P847-2 reproducer: a peer trashTime is taken, then an immediate park', async () => {
            const w = await viewWorld()
            expect(await peerTakes(w, (db) => { slotField(db, 1, 'trashTime', 1_800_000_000_000) })).toEqual({ kind: 'applied' })
            await parkNow(w)
            await expectCleanPrompt(w)
        })

        test('P847-3 reproducer: an own chatPage on one character and a peer personality on the same character, taken field-wise', async () => {
            const w = await viewWorld()
            slotField(w.b.db, 1, 'chatPage', 1)
            flushSync()
            expect(await peerTakes(w, (db) => { chars(db)[1].personality = 'peer edit' })).toEqual({ kind: 'applied' })
            expect(chars(w.b.db)[1].chatPage).toBe(1)
            expect(chars(w.b.db)[1].personality).toBe('peer edit')
            await parkNow(w)
            await expectCleanPrompt(w)
        })

        // The plain host has no write hook, so an own edit there raises no mark: the rows below that need one run on the state host.
        test.skipIf(mode !== 'state')('P847-4 guard: an own personality on one character and a peer personality on another is taken and the page keeps its edit unsaved', async () => {
            const w = await viewWorld()
            w.b.peer.hold = new Promise<void>(() => { })
            chars(w.b.db)[2].personality = 'own edit'
            flushSync()
            expect(await peerTakes(w, (db) => { chars(db)[1].personality = 'peer edit' })).toEqual({ kind: 'applied' })
            await parkNow(w)
            await until(() => w.b.peer.asked.length >= 1, 'the unsaved question', 8000)
            expect(w.b.peer.asked[0]).toMatchObject({ unsaved: true })
            expect(chars(w.b.db)[2].personality).toBe('own edit')
        })

        test('P847-5 reproducer: a peer username is taken, then an immediate park', async () => {
            const w = await viewWorld()
            expect(await peerTakes(w, (db) => { field(db, 'username', 'peer name') })).toEqual({ kind: 'applied' })
            await parkNow(w)
            await expectCleanPrompt(w)
        })

        test('P847-6 guard: a peer message pushed onto an untouched resident is taken with no mark, then an immediate park', async () => {
            const w = await viewWorld()
            const push = (db: Database): void => {
                const slot = chars(db)[1] as unknown as { chats: Array<{ message: Array<{ role: string, data: string }> }> }
                slot.chats[0].message.push({ role: 'char', data: 'peer reply' })
            }
            expect(await peerTakes(w, push)).toEqual({ kind: 'applied' })
            expect(w.kinds).toEqual([])
            await parkNow(w)
            await expectCleanPrompt(w)
        })

        test('P847-7 guard: a peer list swap parks (membership:not-append); with nothing own the prompt is clean', async () => {
            const w = await viewWorld()
            const outcome = await peerTakes(w, (db) => {
                const list = db.characters as unknown as Slots
                const first = list[1]
                list[1] = list[2]
                list[2] = first
            })
            expect(outcome).toEqual({ kind: 'park', reason: 'membership:not-append' })
            await until(() => w.b.peer.clean.length + w.b.peer.asked.length >= 1, 'a prompt', 8000)
            await expectCleanPrompt(w)
        })
    })

    describe(`view writes and the debounce (${mode} host)`, () => {
        useFfHost(mode)

        test.skipIf(mode !== 'state')('D1 guard: a taken lastInteraction leaves the next pass due, and the pass runs and leaves the page clean', async () => {
            const w = await viewWorld()
            expect(await peerTakes(w, (db) => { chars(db).forEach((_slot, index) => { slotField(db, index, 'lastInteraction', 1_800_000_000_000 + index) }) })).toEqual({ kind: 'applied' })
            expectMarked(mode, w)
            await until(() => w.view.state.due || w.view.state.dirty === false, 'the debounce', 4000)
            await until(() => w.view.state.dirty === false, 'the pass', 8000)
            expect(w.view.state.content).toBe(false)
            expect(w.view.crashed).toEqual([])
        })

        test('D2 reproducer: AS8 d0 path, a taken lastInteraction and a park before the debounce', async () => {
            const w = await viewWorld()
            expect(await peerTakes(w, (db) => { chars(db).forEach((_slot, index) => { slotField(db, index, 'lastInteraction', 1_800_000_000_000 + index) }) })).toEqual({ kind: 'applied' })
            expect(w.view.state.due).toBe(false)
            await parkNow(w)
            await expectCleanPrompt(w)
        })

        test.skipIf(mode !== 'state')('D3 reproducer: AS8 d5 path, the marked pass took its snapshot and parked on a peer commit that landed during its commit', async () => {
            // The peer's older-build commit lands inside the pass's commit, so the pass has taken its snapshot and then parks.
            const w = await viewWorld({
                beforeFirstCommit: async (memory, page) => {
                    await olderBuildCommit(memory, page, (db) => { chars(db)[3].personality = 'a later older-build edit' })
                },
            })
            expect(await peerTakes(w, (db) => { slotField(db, 1, 'lastInteraction', 1_800_000_000_000) })).toEqual({ kind: 'applied' })
            // An own chatPage keeps the pass from skipping its commit.
            slotField(w.b.db, 2, 'chatPage', 1)
            flushSync()
            await until(() => w.b.peer.clean.length + w.b.peer.asked.length >= 1, 'a prompt', 8000)
            await expectCleanPrompt(w)
        })

        test.skipIf(mode !== 'state')('D4 guard: an own newer lastInteraction survives a descending older peer one', async () => {
            const w = await viewWorld()
            const newer = 1_900_000_000_000
            slotField(w.b.db, 1, 'lastInteraction', newer)
            flushSync()
            expect(await peerTakes(w, (db) => { slotField(db, 1, 'lastInteraction', 1_700_000_000_000) })).toEqual({ kind: 'applied' })
            expect((chars(w.b.db)[1] as unknown as { lastInteraction: number }).lastInteraction).toBe(newer)
        })

        test.skipIf(mode !== 'state')('T3 diagnostic: a chatPage no mark saw, found by the idle net whose pass parks, leaves the page unsaved (residual (a))', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => { })
            const w = await viewWorld({
                idleNet: { intervalMs: 50, moduleIntervalMs: 1_000_000_000, backstopMs: 0 },
                beforeFirstCommit: async (memory, page) => {
                    await olderBuildCommit(memory, page, (db) => { chars(db)[3].personality = 'a later older-build edit' })
                },
            })
            w.b.peer.hold = new Promise<void>(() => { })
            // A write inside a quiet scope reaches no mark: the idle net is the only reader of it.
            withQuietCharacterInstall(() => { slotField(w.b.db, 1, 'chatPage', 1) })
            await until(() => w.b.peer.asked.length >= 1, 'the unsaved question', 8000)
            expect(w.b.peer.asked[0]).toMatchObject({ unsaved: true })
        })
    })
}
