// @vitest-environment node
/**
 * CHORE-166 stage 2B: a save pass that completes on a frozen page. The save loop runs over the real Tauri backend on the
 * real `createTauriFilesStore` with the Android transport, on the Android stand-ins (`androidTauriWorld`), while the page
 * is hidden and frozen: no timer, `scheduler.yield` or MessageChannel message is ever delivered, a raw reply of 1 KiB or
 * more and a `{`/`[` JSON reply of 8 KiB or more never settles, and only microtasks run. A pass is not evidence about the
 * native bridge or about how long a real page stays unfrozen.
 * Labels: reproducer (fails on the code before the change, for the stated cause), guard (passes before and after).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = await vi.hoisted(async () => (await import('src/ts/storage/tests/store2/androidTauriWorld')).createAndroidTauriWorld())
/** The measurement switch the suite runs under; a release-build test turns it off (the getter below reads it on every use). */
const measure = vi.hoisted(() => ({ on: true }))

vi.mock('src/ts/process/memory/measureFlag', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/process/memory/measureFlag')>()),
    get MEASURE() {
        return measure.on
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => h.fs.module)
vi.mock('@tauri-apps/api/path', () => h.paths.pathModule)
vi.mock('@tauri-apps/api/core', () => ({ ...h.paths.coreModule, invoke: h.invoke }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'android' }))

import { createTauriBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { createCommitter } from 'src/ts/storage/store2/commit'
import { classifyCommitRead, nextCommitKey } from 'src/ts/storage/store2/commitKey'
import { previousFrom } from 'src/ts/storage/store2/codec'
import { encodeUnit, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { freshOwnerId } from 'src/ts/storage/store2/owner'
import { runStore2SaveLoop, type Store2LoopPort } from 'src/ts/storage/store2/saveLoop'
import type { Store2SaveContext } from 'src/ts/storage/store2/saveActive'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { shouldBypassFrozenPagePaths } from 'src/ts/storage/tauriByteTransport'
import type { Database } from 'src/ts/storage/database.svelte'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createClock, createPeerDouble, seedTree, testEnv } from '../store2SaveKit'
import { buildSmall, fakeLists } from './codecFixtures'

/** A commit key of this many bytes or more makes its read reply (plus the 56-byte trailer) a raw reply of 1 KiB or more. */
const FROZEN_READ_KEY_BYTES = 1024 - 56

type Entry = Record<string, unknown>

interface FrozenLoop {
    backend: Store2Backend
    db: Database
    saved(): number
    failures: unknown[]
    crashed: unknown[]
    editAndMark(): void
    commitBytes(): Promise<Uint8Array>
    stop(): void
}

const stops: Array<() => void> = []

beforeEach(() => {
    h.reset()
    measure.on = true
})

afterEach(() => {
    for (const stop of stops) {
        stop()
    }
    stops.length = 0
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

/** Adds pins with incompressible reasons until the stored commit key is at least `bytes` long. */
async function padCommitKey(backend: Store2Backend, bytes: number): Promise<void> {
    let counter = 1
    for (let pins = 0; (await backend.readCommit()).bytes!.length < bytes; pins++) {
        const read = await backend.readCommit()
        const parsed = classifyCommitRead(read)
        if (parsed.status !== 'parsed') {
            throw new Error(`The commit key is ${parsed.status}.`)
        }
        const reason = Array.from({ length: 24 }, () => (counter = (Math.imul(counter, 1103515245) + 12345) >>> 0).toString(16)).join('')
        const next = nextCommitKey(parsed.value, { pins: [...parsed.value.pins, { key: `store2/pin-${pins}`, reason }] }, testEnv(createClock(), pins + 1))
        await backend.casCommit(read.token, encodeUnit(UNIT_TYPE.commit, next))
    }
}

/** The loop over the Tauri backend, idle and waiting for a mark. Nothing is frozen until the caller says so. */
async function startFrozenLoop(options: { padCommitTo?: number }): Promise<FrozenLoop> {
    const db = JSON.parse(JSON.stringify(buildSmall(4))) as Database
    const seedDb = JSON.parse(JSON.stringify(db)) as Database
    const clock = createClock()
    const backend = await createTauriBackend(createTauriFilesStore({ platform: 'posix' }))
    const seeded = await seedTree(backend, seedDb, testEnv(clock, 4242), fakeLists)
    if (options.padCommitTo !== undefined) {
        await padCommitKey(backend, options.padCommitTo)
    }
    const context: Store2SaveContext = {
        session: { kind: 'tauri', committer: createCommitter(backend, { owner: freshOwnerId(testEnv(clock, 778)), env: testEnv(clock, 777) }) },
        previous: previousFrom(seeded.tree),
        lists: fakeLists,
        env: testEnv(clock, 99),
        peer: createPeerDouble(),
        idleNet: null,
    }
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    const state = { due: false, dirty: false, saved: 0 }
    const failures: unknown[] = []
    const crashed: unknown[] = []
    // A wait ends only when a pass is requested: the frozen page delivers no timer, so none is used.
    let waiters: Array<() => void> = []
    const wake = () => {
        const woken = waiters
        waiters = []
        for (const resolve of woken) {
            resolve()
        }
    }
    let tail: Promise<void> = Promise.resolve()
    const port: Store2LoopPort = {
        tracker,
        reloadFlag: { state: false },
        getDatabase: () => db,
        mergeBack() {},
        liveCheck: () => {},
        sweep: () => {},
        isDue: () => state.due,
        isDirty: () => state.dirty,
        hasDrafts: () => false,
        beginIteration() {
            state.due = false
        },
        endIteration() {},
        snapshotTaken() {
            state.dirty = false
        },
        requestPass() {
            state.dirty = true
            state.due = true
        },
        unsavable() {},
        saved() {
            state.saved += 1
        },
        broadcast() {},
        peerHeard: () => false,
        setStopped() {},
        notifyTooLarge() {},
        reportFailure(error) {
            failures.push(error)
            return 1
        },
        reportUncountedFailure(error) {
            failures.push(error)
            return 1
        },
        async withWriteLock(run) {
            const before = tail
            let release: () => void = () => {}
            tail = new Promise<void>((resolve) => { release = resolve })
            await before
            try {
                return await run()
            } finally {
                release()
            }
        },
        wait: () => new Promise<void>((resolve) => { waiters.push(resolve) }),
        sleep: () => new Promise<void>(() => {}),
        sleepForever: () => new Promise<never>(() => {}),
        now: () => Date.now(),
        pageHidden: () => true,
        yieldImmediately: shouldBypassFrozenPagePaths,
    }
    runStore2SaveLoop(context, port).catch((error: unknown) => {
        crashed.push(error)
    })
    const loop: FrozenLoop = {
        backend,
        db,
        saved: () => state.saved,
        failures,
        crashed,
        editAndMark() {
            ;(db.characters[0] as unknown as Entry).personality = 'an edit made while hidden'
            tracker.character.push(String((db.characters[0] as unknown as Entry).chaId))
            state.dirty = true
            state.due = true
            wake()
        },
        async commitBytes() {
            return (await backend.readCommit()).bytes!
        },
        stop() {
            state.due = false
            waiters = []
        },
    }
    stops.push(loop.stop)
    return loop
}

/** The page freezes: hidden, no timer or message delivered, and the replies of `h.frozen` never arrive. */
function freezePage(): void {
    vi.stubGlobal('document', { visibilityState: 'hidden' })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'Date'] })
    vi.stubGlobal('scheduler', { yield: () => new Promise<void>(() => {}) })
    vi.stubGlobal('MessageChannel', class {
        port1 = { onmessage: null as unknown, close() {} }
        port2 = { postMessage() {}, close() {} }
    })
    h.frozen.on = true
}

/** Lets only microtasks run, as a frozen page does; resolves once `done` holds, or after `limit` turns. */
async function runMicrotasks(done: () => boolean, limit = 400_000): Promise<void> {
    for (let turn = 0; turn < limit && !done(); turn++) {
        await Promise.resolve()
    }
}

describe('a save pass on a frozen page', () => {
    // Reproducer: before the change the commit key read is a raw reply of 1 KiB or more, which a frozen page never receives.
    test('reproducer: a commit key of 968 bytes or more is read over the text command and the pass commits', async () => {
        const loop = await startFrozenLoop({ padCommitTo: FROZEN_READ_KEY_BYTES })
        const before = await loop.commitBytes()
        expect(before.length).toBeGreaterThanOrEqual(FROZEN_READ_KEY_BYTES)
        freezePage()

        loop.editAndMark()
        await runMicrotasks(() => loop.saved() >= 1)

        expect(loop.saved()).toBe(1)
        expect(Array.from(await loop.commitBytes())).not.toEqual(Array.from(before))
        expect(h.chunk.callsOf('read_range_text').length).toBeGreaterThan(0)
        expect(h.frozen.hung).toEqual([])
        expect(loop.failures).toEqual([])
        expect(loop.crashed).toEqual([])
    })

    // Reproducer: before the change an encode past the 8 ms budget yields through `scheduler.yield`, which a frozen page never resumes.
    test('reproducer: a small commit key and an encode past the yield budget commit without yielding', async () => {
        const loop = await startFrozenLoop({})
        const before = await loop.commitBytes()
        expect(before.length).toBeLessThan(FROZEN_READ_KEY_BYTES)
        freezePage()
        // Every clock read advances 10 ms, so each budget check finds the 8 ms budget spent.
        let ticks = 0
        vi.spyOn(performance, 'now').mockImplementation(() => (ticks += 10))

        loop.editAndMark()
        await runMicrotasks(() => loop.saved() >= 1)

        expect(loop.saved()).toBe(1)
        expect(Array.from(await loop.commitBytes())).not.toEqual(Array.from(before))
        expect(h.frozen.hung).toEqual([])
        expect(loop.failures).toEqual([])
        expect(loop.crashed).toEqual([])
    })

    // Reproducer: the same stall as above in a release build (no measurement), whose budget is the plain one that carries only `skip`.
    test('reproducer: in a release build a small commit key and an encode past the yield budget commit without yielding', async () => {
        measure.on = false
        const loop = await startFrozenLoop({})
        const before = await loop.commitBytes()
        expect(before.length).toBeLessThan(FROZEN_READ_KEY_BYTES)
        freezePage()
        let ticks = 0
        vi.spyOn(performance, 'now').mockImplementation(() => (ticks += 10))

        loop.editAndMark()
        await runMicrotasks(() => loop.saved() >= 1)

        expect(loop.saved()).toBe(1)
        expect(Array.from(await loop.commitBytes())).not.toEqual(Array.from(before))
        expect(h.frozen.hung).toEqual([])
        expect(loop.failures).toEqual([])
        expect(loop.crashed).toEqual([])
    })

    // Guard: the stand-in really freezes a raw read of that size, so the two reproducers above rest on a world that bites.
    test('guard: the frozen world never answers a raw read of the padded commit key', async () => {
        const loop = await startFrozenLoop({ padCommitTo: FROZEN_READ_KEY_BYTES })
        freezePage()
        let answered = false
        void h.invoke('read_range', { key: 'store2-commit', offset: 0, len: 8 * 1024 * 1024 }).then(() => { answered = true })

        await runMicrotasks(() => answered, 2000)

        expect(answered).toBe(false)
        expect(h.frozen.hung).toEqual(['read_range'])
        loop.stop()
    })
})
