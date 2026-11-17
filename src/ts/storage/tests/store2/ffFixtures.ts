/**
 * Test-only fixtures of the fast-forward loop suites: a dispatch-booted page over a shared memory backend with the
 * fast-forward host a test supplies in place of the page modules, and the helpers that read what a page holds. The
 * peer is built by `peerPage` from the committer and encoder APIs only. Mocked storage here says nothing about a native
 * backend.
 */
import { expect, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import { resetPageBlockOwnerForTests } from 'src/ts/storage/pageBlockOwner'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { createMemoryBackend, createNodeBackend, type MemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { resetStore2BootForTest, type Store2BootNotice } from 'src/ts/storage/store2/bootActive'
import type { Store2BootUi } from 'src/ts/storage/store2/bootDispatch'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { createNodeHttpStore } from 'src/ts/storage/store/nodeHttpStore'
import { setFastForwardHostForTest, type ConflictChoice, type ConflictRecord, type FastForwardHost, type FastForwardOutcome } from 'src/ts/storage/store2/fastForward'
import { PERSONA_OPS } from 'src/ts/storage/store2/fastForward/records'
import { resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { getActiveStore2Save, resetStore2SaveForTest, type Store2SaveContext } from 'src/ts/storage/store2/saveActive'
import { runStore2SaveLoop, type IdleNetOptions, type Store2LoopPort } from 'src/ts/storage/store2/saveLoop'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetRetainedForTest } from 'src/ts/process/coldRetained'
import { bootThroughDispatch, createClock, createPeerDouble, seedTree, testEnv, type DispatchedBoot, type PeerDouble } from '../store2SaveKit'
import { fakeLists } from './codecFixtures'
import type { Hooks } from './commitFixtures'
import type { OpenedBackend } from './fenceFixtures'
import {
    chaIdOf, chars, lineSeededStore, parsedKey, peerPage, plantBytes, runLoopOver, seedProfile, stopAllLoops, until, type LoopHandle,
} from './lineFixtures'

export function resetPage(): void {
    resetStore2SaveForTest()
    resetResidencyForTest()
    resetStore2BootForTest()
    resetPageBlockOwnerForTests()
    resetPageStorageModeForTests()
    resetRetainedForTest()
}

export interface HostState {
    inUse: Set<string>
    writing: Set<string>
    busy: boolean
    sending: boolean
    /** The chats written, by owner `chaId`; the owners also belong to `writing`. */
    writingChats?: Map<string, Set<string>>
    /** The selected character's index (-1 for none); the host's `select` sets it. */
    selected?: number
    /** Called by the host's mark, so a loop world can take the mark as a real page would. */
    onMark?: (chaId: string) => void
    /** What the host was asked to do, in order. */
    calls?: { marked: string[], forgotten: unknown[], selects: number[] }
}


let lastHostState: HostState | null = null

export function testHost(state: HostState = { inUse: new Set(), writing: new Set(), busy: false, sending: false }): { host: FastForwardHost, state: HostState } {
    const calls = state.calls ?? { marked: [], forgotten: [], selects: [] }
    state.calls = calls
    state.selected ??= -1
    lastHostState = state
    const host: FastForwardHost = {
        inUse: () => state.inUse,
        writing: chaId => state.writing.has(chaId),
        writingTargets: () => ({ chars: state.writing, chats: state.writingChats ?? new Map<string, Set<string>>() }),
        busy: () => state.busy,
        sending: () => state.sending,
        installQuietly: fn => fn(),
        forgetLoaded: (slot) => { calls.forgotten.push(slot) },
        mark: (chaId) => {
            calls.marked.push(chaId)
            state.onMark?.(chaId)
        },
        selection: () => state.selected ?? -1,
        select: (index) => {
            state.selected = index
            calls.selects.push(index)
        },
        presetOps: () => PERSONA_OPS,
    }
    return { host, state }
}

export interface PageB {
    db: Database
    context: Store2SaveContext & { encoder: NonNullable<Store2SaveContext['encoder']> }
    peer: PeerDouble
}

/**
 * The kit's dispatch boot over the byte store a real Node page holds: the dispatch probes the store's guarded operations,
 * which the kit's memory byte store does not have. The UI port declines every question, as the kit's does.
 */
async function bootNodeDispatch(backend: Store2Backend, store: ByteStore): Promise<DispatchedBoot> {
    const { dispatchStore2Boot } = await import('src/ts/storage/store2/bootDispatch')
    const notices: Store2BootNotice[] = []
    const peer = createPeerDouble()
    const ui: Store2BootUi = {
        notice: (notice) => { notices.push(notice) },
        blocked: async () => { },
        offerRestoreOrImport: async () => 'import',
        confirmConvert: async () => false,
        declined: async () => 'import',
        confirmConvertWithout: async () => 'decline',
        confirmFromBackup: async () => 'decline',
        confirmIncomplete: async () => false,
        confirmFlaggedOpen: async () => 'decline',
        foreignMarker: async () => 'wait',
        recovery: async () => { },
        peer,
    }
    const result = await dispatchStore2Boot({
        store,
        upstreamMainFile: async () => false,
        readColdStorageItem: async () => ({ status: 'missing' }),
        listBackupTimes: async () => [],
    }, { ui, kind: 'node', backend: async () => backend, lists: fakeLists })
    return { result, notices, peer, foreignMarkerAsked: 0 }
}

/** The byte store of the Node server a test opened with `openNamed('node')`; set by that call. */
let nodeStore: ByteStore | null = null

export async function bootB(memory: Store2Backend, kind: 'indexeddb' | 'node' = 'indexeddb'): Promise<PageB> {
    resetPage()
    if (kind === 'node' && nodeStore === null) {
        throw new Error('A node page needs the byte store of the Node server opened with openNamed.')
    }
    const booted = kind === 'node' && nodeStore !== null
        ? await bootNodeDispatch(memory, nodeStore)
        : await bootThroughDispatch(memory, { lists: fakeLists, kind })
    if (booted.result.kind !== 'store2') {
        throw new Error(`The boot answered ${booted.result.kind}.`)
    }
    const context = getActiveStore2Save()
    if (context?.encoder === undefined) {
        throw new Error('No save context.')
    }
    return { db: booted.result.database, context: context as PageB['context'], peer: booted.peer }
}

/** A line-seeded store, a host with nothing busy, and the cleanup of both; call `ffSetup()` in `beforeEach`. */
export function ffSetup(): { host: ReturnType<typeof testHost> } {
    const host = testHost()
    resetPage()
    setFastForwardHostForTest(host.host)
    vi.spyOn(console, 'error').mockImplementation(() => { })
    return { host }
}

export function ffTeardown(): void {
    stopAllLoops()
    stopAllWorlds()
    resetPage()
    setFastForwardHostForTest(null)
    vi.restoreAllMocks()
}

export async function ffWorld(options: { mintLine: boolean, count?: number } = { mintLine: true }) {
    const memory = createMemoryBackend()
    const clock = createClock()
    const store = await lineSeededStore(memory, clock, options)
    return { memory, clock, ...store }
}

/** The text a character holds in the page's live database. */
export function personalityOf(db: Database, index: number): unknown {
    return (db.characters as unknown as Array<Record<string, unknown>>)[index].personality
}

export const signal = (loop: { state: { peerHeard: boolean } }): void => { loop.state.peerHeard = true }

export const sleepMs = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface LoopWorldOptions {
    /** Keeps the page's idle net with these options (the other loop worlds switch it off). */
    idleNet?: IdleNetOptions
    /** The back-off after a retry; the default is a 2 ms sleep. */
    sleep?: (ms: number) => Promise<void>
    /** The reply owners the page lists to the fast-forward. */
    replyOwners?: () => ReadonlySet<string>
}

export interface LoopWorld extends LoopHandle {
    /** Every failure the loop reported through `reportFailure`, in order. */
    failures: Array<{ error: unknown, attempts: number }>
    /** Every reason the loop passed to `setStopped`, in order (the empty reason clears). */
    stoppedLog: string[]
    /** Whether the loop's waiting line is on now, and every value it set, in order. */
    peerWaiting: boolean
    peerWaitingLog: boolean[]
    /** Whether the loop holds its write lock right now. */
    locked: boolean
}

const worlds: LoopWorld[] = []

export function stopAllWorlds(): void {
    for (const world of worlds) {
        world.stop()
    }
    worlds.length = 0
}

/**
 * The real save loop over `context` and `db` with a hand-built port, as `runLoopOver`, but one that records the failures
 * and stops the loop reports, can keep the idle net, and takes the back-off and the reply owners from the test.
 */
export function runLoopWorld(context: Store2SaveContext, db: Database, options: LoopWorldOptions = {}): LoopWorld {
    let stopped = false
    let tail: Promise<void> = Promise.resolve()
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    const world: LoopWorld = {
        tracker,
        state: { due: false, dirty: false, saved: 0, peerHeard: false, stopped: '' },
        crashed: [],
        failures: [],
        stoppedLog: [],
        peerWaiting: false,
        peerWaitingLog: [],
        locked: false,
        mark(chaId) {
            tracker.character.push(chaId)
            world.state.dirty = true
            world.state.due = true
        },
        stop() {
            stopped = true
        },
    }
    context.idleNet = options.idleNet ?? null
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
        isDue: () => world.state.due,
        isDirty: () => world.state.dirty,
        hasDrafts: () => false,
        beginIteration() {
            world.state.due = false
        },
        endIteration() { },
        snapshotTaken() {
            world.state.dirty = false
        },
        requestPass() {
            world.state.dirty = true
            world.state.due = true
        },
        unsavable() { },
        saved() {
            world.state.saved += 1
        },
        broadcast() { },
        peerHeard() {
            const heard = world.state.peerHeard
            world.state.peerHeard = false
            return heard
        },
        setStopped(reason) {
            world.state.stopped = reason
            world.stoppedLog.push(reason)
        },
        setPeerWaiting(waiting) {
            world.peerWaiting = waiting
            world.peerWaitingLog.push(waiting)
        },
        notifyTooLarge() { },
        reportFailure(error, attempts) {
            world.failures.push({ error, attempts })
            return 1
        },
        reportUncountedFailure() {
            return 1
        },
        async withWriteLock(run) {
            const before = tail
            let release: () => void = () => { }
            tail = new Promise<void>((resolve) => { release = resolve })
            await before
            world.locked = true
            try {
                return await run()
            } finally {
                world.locked = false
                release()
            }
        },
        wait: idle,
        sleep: options.sleep ?? idle,
        sleepForever: () => new Promise<never>(() => { }),
        now: () => Date.now(),
        replyOwners: options.replyOwners,
    }
    runStore2SaveLoop(context, port).catch((error: unknown) => {
        world.crashed.push(error)
    })
    worlds.push(world)
    return world
}

export type BackendName = 'memory' | 'indexedDb' | 'node'

/** The memory, fake-IndexedDB or real-Node-server backend of the fence suites, opened fresh; the caller closes it. */
export async function openNamed(name: BackendName): Promise<OpenedBackend> {
    if (name === 'node') {
        const { startNodeServer } = await import('../nodeServerFixture')
        const fixture = await startNodeServer()
        const store = createNodeHttpStore({ baseUrl: fixture.baseUrl, authHeader: () => fixture.authHeader() })
        nodeStore = store
        return {
            backend: createNodeBackend(store),
            close: async () => {
                nodeStore = null
                await fixture.stop()
            },
        }
    }
    const { FENCE_BACKENDS } = await import('./fenceFixtures')
    const found = FENCE_BACKENDS.find((item) => item.name === name)
    if (found === undefined) {
        throw new Error(`No backend named ${name}.`)
    }
    return found.open()
}

/** The session kind a page over `name` is booted as: the Node server is a node page, every other store an indexeddb page. */
export const kindOfBackend = (name: BackendName): 'indexeddb' | 'node' => name === 'node' ? 'node' : 'indexeddb'

/** `ffWorld` over any backend: the kit seed plus, optionally, one descending commit by a peer page that mints the line. */
export async function ffWorldOver(memory: Store2Backend, options: { mintLine: boolean, count?: number } = { mintLine: true }) {
    const clock = createClock()
    const seeded = await seedTree(memory, seedProfile(options.count), testEnv(clock, 4242), fakeLists)
    const page = peerPage(memory, clock, 7)
    if (options.mintLine) {
        clock.advance(10 * 60_000)
        await page.commitEdit((db) => { chars(db)[3].personality = 'line minting edit' })
    }
    return { memory, clock, page, firstManifest: seeded.manifestKey }
}

/** Waits until `b`'s acknowledged encoding names the manifest the store holds: the peer's tree was taken. */
export async function takenBy(b: PageB, backend: Store2Backend, timeoutMs = 8000): Promise<void> {
    await until(async () => b.context.encoder.manifestKey === (await parsedKey(backend)).current?.key, 'the page to take the peer tree', timeoutMs)
}

export async function ownEdit(loop: LoopHandle, b: PageB, index: number, text: string): Promise<void> {
    const before = loop.state.saved
    chars(b.db)[index].personality = text
    loop.mark(chaIdOf(b.db, index))
    await until(() => loop.state.saved > before, 'the own commit', 8000)
}

export function runSpyOf(b: PageB) {
    const fastForward = b.context.fastForward
    if (fastForward === undefined) {
        throw new Error('The page has no fast-forward.')
    }
    return vi.spyOn(fastForward, 'run')
}

const EXPORT_FIRST = ['reload', 'export-first']

/**
 * A bulk final that lands over this page's ordinary commit made under its marker: the descent is unproven, so the clean
 * page parks with Reload and Export this tab first, keeps its edit and never calls the fast-forward.
 */
export async function scenarioR25(name: BackendName, backend: Store2Backend): Promise<void> {
    // Loaded here: the module re-exports the fence fixtures, which need a Node environment that a page-module test lacks.
    const { hooked } = await import('./commitFixtures')
    const { clock } = await ffWorldOver(backend)
    const b = await bootB(backend, kindOfBackend(name))
    const run = runSpyOf(b)
    let markerSeen = false
    let gate: () => void = () => { }
    const held = new Promise<void>((resolve) => { gate = resolve })
    const hooks: Hooks = {
        async before(call, count) {
            if (call === 'putUnit' && count === 1) {
                markerSeen = (await parsedKey(backend)).staging !== null
                await held
            }
        },
    }
    const bulker = peerPage(hooked(backend, hooks).backend, clock, 13)
    const more = (db: Database): void => {
        for (let index = 0; index < 15; index++) {
            const added = JSON.parse(JSON.stringify(chars(db)[0])) as Record<string, unknown>
            added.chaId = `bulk-added-${index}`
            added.name = `Bulk ${index}`
            chars(db).push(added)
        }
    }
    const bulk = bulker.commitEdit(more)
    await until(() => markerSeen, 'the marker under the held upload', 8000)
    const loop = runLoopOver(b.context, b.db)
    await ownEdit(loop, b, 1, 'B edit under the marker')
    gate()
    const landed = await bulk
    expect(landed.staging).toBeNull()
    signal(loop)
    await until(() => b.peer.clean.length >= 1, 'the clean notice', 8000)
    expect(b.peer.clean[0]).toMatchObject({ reason: 'peer-commit' })
    expect(b.peer.clean[0].offers).toEqual(EXPORT_FIRST)
    expect(chars(b.db)[1].personality).toBe('B edit under the marker')
    expect(run).not.toHaveBeenCalled()
    expect(loop.crashed).toEqual([])
}

/**
 * Two fast-forwards, then the commit key is planted back to the first of them: the first read after the rollback parks,
 * applies nothing and does not call the fast-forward again.
 */
export async function scenarioR29(name: BackendName, backend: Store2Backend): Promise<void> {
    const { page } = await ffWorldOver(backend)
    const b = await bootB(backend, kindOfBackend(name))
    const loop = runLoopOver(b.context, b.db)
    await ownEdit(loop, b, 0, 'my edit')
    await page.commitEdit((db) => { chars(db)[1].personality = 'peer one' })
    signal(loop)
    await takenBy(b, backend)
    const captured = (await backend.readCommit()).bytes
    await page.commitEdit((db) => { chars(db)[2].personality = 'peer two' })
    signal(loop)
    await takenBy(b, backend)
    if (captured === null) {
        throw new Error('No commit key bytes.')
    }
    await plantBytes(backend, captured)
    const run = runSpyOf(b)
    const before = JSON.stringify(b.db.characters)
    signal(loop)
    await until(() => b.peer.clean.length >= 1, 'the clean notice', 8000)
    expect(b.peer.clean[0].offers).toEqual(EXPORT_FIRST)
    expect(run).not.toHaveBeenCalled()
    expect(JSON.stringify(b.db.characters)).toBe(before)
}

/** Alternating disjoint commits by a peer page and the booted page: every one is taken and none parks. */
export async function scenarioR30(name: BackendName, backend: Store2Backend): Promise<void> {
    const { page } = await ffWorldOver(backend)
    const b = await bootB(backend, kindOfBackend(name))
    const loop = runLoopOver(b.context, b.db)
    for (const [index, text] of ['a1', 'b1', 'a2', 'b2', 'a3', 'b3'].entries()) {
        if (index % 2 === 0) {
            await page.commitEdit((db) => { chars(db)[1].personality = text })
            signal(loop)
            await takenBy(b, backend)
        } else {
            await ownEdit(loop, b, 0, text)
        }
    }
    expect(b.peer.asked).toEqual([])
    expect(b.peer.clean).toEqual([])
    const final = await page.freeze()
    expect(personalityOf(final.db, 0)).toBe('b3')
    expect(personalityOf(final.db, 1)).toBe('a3')
    expect(loop.crashed).toEqual([])
}

/** The chats of the live or assembled character at `index`. */
export function chatsAt(db: Database, index: number): Array<Record<string, unknown>> {
    return chars(db)[index].chats as Array<Record<string, unknown>>
}

export interface MergeWorld {
    memory: Store2Backend
    /** The clock the store's peer pages run on; another peer page over `memory` takes it. */
    clock: ReturnType<typeof createClock>
    page: ReturnType<typeof peerPage>
    b: PageB
    world: LoopWorld
    run: ReturnType<typeof runSpyOf>
}

/** A dispatch-booted page over a line-seeded store with its save loop, and a spy on the fast-forward's runs. */
export async function mergeWorld(options: { count?: number, backend?: Store2Backend, kind?: 'indexeddb' | 'node', before?: (page: ReturnType<typeof peerPage>) => Promise<void> } = {}): Promise<MergeWorld> {
    const memory = options.backend ?? createMemoryBackend()
    const seeded = await ffWorldOver(memory, { mintLine: true, count: options.count })
    await options.before?.(seeded.page)
    const b = await bootB(memory, options.kind ?? 'indexeddb')
    const world = runLoopWorld(b.context, b.db)
    if (lastHostState !== null) {
        lastHostState.onMark = chaId => world.mark(chaId)
    }
    return { memory, clock: seeded.clock, page: seeded.page, b, world, run: runSpyOf(b) }
}

export interface BootedPage {
    b: PageB
    world: LoopWorld
    run: ReturnType<typeof runSpyOf>
}

/**
 * A page dispatch-booted over a store that already holds a tree, with its save loop and a spy on its fast-forward runs. It
 * replaces the page-global state of an earlier booted page, so the earlier page's loop must be stopped first. The host's
 * mark callback now feeds this page's loop.
 */
export async function bootPageOver(backend: Store2Backend, kind: 'indexeddb' | 'node' = 'indexeddb'): Promise<BootedPage> {
    const b = await bootB(backend, kind)
    const world = runLoopWorld(b.context, b.db)
    if (lastHostState !== null) {
        lastHostState.onMark = chaId => world.mark(chaId)
    }
    return { b, world, run: runSpyOf(b) }
}

export interface Resolver {
    /** The records of each `resolve` call, in call order. */
    calls: ConflictRecord[][]
    /** Lets a held dialog answer. */
    release(): void
}

/**
 * Installs a `resolve` handler on the page's peer double, so the fast-forward asks instead of parking with today's
 * prompt. `choose` gives the answer per record (a record it leaves out keeps its preselection); `held` keeps the dialog
 * open until `release()`.
 */
export function resolver(w: MergeWorld, choose: (record: ConflictRecord) => ConflictChoice | undefined = () => undefined, options: { held?: boolean } = {}): Resolver {
    const calls: ConflictRecord[][] = []
    let release: () => void = () => { }
    const gate = options.held === true ? new Promise<void>((resolve) => { release = resolve }) : Promise.resolve()
    w.b.peer.resolve = async ({ conflicts }) => {
        calls.push([...conflicts])
        await gate
        const answer: Record<string, ConflictChoice> = {}
        for (const record of conflicts) {
            const choice = choose(record)
            if (choice !== undefined) {
                answer[record.id] = choice
            }
        }
        return answer
    }
    return { calls, release: () => release() }
}

/** The peer commits `edit`, this page hears it, and the next fast-forward run's outcome is returned. */
export async function peerCommits(w: MergeWorld, edit: (db: Database) => void): Promise<FastForwardOutcome> {
    const before = w.run.mock.calls.length
    await w.page.commitEdit(edit)
    signal(w.world)
    await until(() => w.run.mock.calls.length > before, 'the fast-forward run', 8000)
    return await w.run.mock.results[before].value
}
