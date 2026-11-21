// @vitest-environment node
/**
 * The maintenance runner (`store2/maintenance.ts`): when the old-data deletion may start, and what the page sees of it.
 * It starts only on a store2 page whose own boot found the profile ready (the session's normal row), after the quiet
 * trigger fires; it registers its step as the startup clean-up when the step starts, and that promise always settles; one
 * step runs at a time; nothing starts on a legacy, block, read-only or undecided page.
 *
 * What is a stand-in: the quiet trigger is a double that the test fires by hand (the real one is covered by
 * `putBackQuiet.test.ts`), the sessions are real `Store2Session.open` calls over a memory backend (kind `indexeddb`, which
 * needs no native store), and the deletion is a double except in the one integration case. The engine does not exist on
 * the red base (the W5a commit), so a file here fails at import there, which proves nothing by itself; a "reproducer" is
 * red under the mutant named in the hand-back that removes the rule it pins.
 *
 * The clean-up pass that follows the deletion runs only on a `tauri` session, so its cases open one over a flush-confirming
 * wrapper of the memory backend (`flushConfirmBackend.ts`; the plain memory backend never confirms a flush and a `tauri`
 * session over it is idle). The `indexeddb` and `node` sessions above are the "runs nothing" cases.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// The runner's default trigger drags in the whole save loop; every case here passes its own.
vi.mock(import('src/ts/process/memory/putBackQuiet'), () => ({
    startQuietTrigger: () => { throw new Error('The real quiet trigger is not used in this test.') },
}) as unknown as typeof import('src/ts/process/memory/putBackQuiet'))

import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { inlayMetaKey } from 'src/ts/process/files/inlayKeys'
import { resetPageStorageModeForTests, setPageStorageMode, type PageStorageMode } from 'src/ts/storage/pageStorageMode'
import { getStartupCleanup, resetStartupCleanupForTests } from 'src/ts/storage/startupCleanupState'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { createNodeHttpStore } from 'src/ts/storage/store/nodeHttpStore'
import { createMemoryBackend, createNodeBackend, type MemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { unitDigest } from 'src/ts/storage/store2/codec'
import { ADMISSION_INTERVAL_MS } from 'src/ts/storage/store2/commit'
import { classifyCommitRead, firstCommitKey, RETAINED_MAX } from 'src/ts/storage/store2/commitKey'
import {
    encodeUnit, newUnitKey, UNIT_TYPE, type DeletionSnapshot, type SnapshotPointer,
} from 'src/ts/storage/store2/format'
import {
    bootDidNotInstall, formatSweepResult, resetMaintenanceForTests, runManualCleanUp, startStore2Maintenance as startLiveMaintenance,
    type InlayPageFacts, type MaintenanceEnv, type MaintenanceSeams, type ManualCleanUpPlan, type ManualCleanUpUi, type SweepPageFacts,
} from 'src/ts/storage/store2/maintenance'
import { holdAssetDeletion, resetAssetDeleteHoldForTests } from 'src/ts/storage/assetDeleteHold'
import { readSweepRecord, writeSweepRecord } from 'src/ts/storage/store2/sweep'
import { NODE_BATCH_PACE_MS, type OldDataDeletionResult } from 'src/ts/storage/store2/oldData/delete'
import { listRestorePoints, restorePoint } from 'src/ts/storage/store2/restorePoints'
import { Store2Session } from 'src/ts/storage/store2/session'
import { readTree } from 'src/ts/storage/store2/tree'
import type { AutoGcFacts } from 'src/ts/storage/store2/gc/autoGc'
import { committerOf, createClock, expectInvariant, parsedCommit, peerWrite, seedStore, testEnv, treeRequest } from './commitFixtures'
import { startNodeServer, type NodeServerFixture } from '../nodeServerFixture'
import { flushConfirming, type FlushConfirming } from './flushConfirmBackend'

const clock = createClock()
const env = testEnv(clock, 3)

type Profile = 'empty' | 'ready' | 'seed-marker' | 'no-current'

async function openSession(profile: Profile): Promise<{ session: Store2Session, backend: MemoryBackend, store: MemoryByteStore }> {
    const backend = createMemoryBackend()
    if (profile === 'ready') {
        await seedStore(backend, env)
    } else if (profile === 'seed-marker') {
        const key = firstCommitKey({ current: null, staging: { owner: 'b'.repeat(26), prefix: 'store2/g-0123456789abcdef-', startedAt: clock.now, label: 'seed' }, manifests: [] }, env)
        await backend.casCommit((await backend.readCommit()).token, encodeUnit(UNIT_TYPE.commit, key))
    } else if (profile === 'no-current') {
        const key = firstCommitKey({ current: null, staging: null, manifests: [] }, env)
        await backend.casCommit((await backend.readCommit()).token, encodeUnit(UNIT_TYPE.commit, key))
    }
    const store = createMemoryByteStore()
    const session = await Store2Session.open(store, { kind: 'indexeddb', backend, upstreamMainFile: async () => false })
    return { session, backend, store }
}

function fakeTrigger() {
    let fire: (() => void) | null = null
    const counts = { started: 0, armed: 0, stopped: 0 }
    return {
        counts,
        start: (run: () => void) => {
            counts.started++
            fire = run
            return { arm: () => { counts.armed++ }, stop: () => { counts.stopped++ } }
        },
        fire: () => {
            if (fire === null) {
                throw new Error('No trigger was started.')
            }
            fire()
        },
    }
}

const noStore: MaintenanceEnv = { store: async () => createMemoryByteStore(), listBackupTimes: async () => [] }

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
    return { promise, resolve, reject }
}

const COMPLETED: OldDataDeletionResult = { status: 'completed', deleted: 0, abandoned: 0, flushed: undefined }

/** A quiet page: the clean-up pass sees no data action, a running save loop and a committed save. */
const CLEAN: AutoGcFacts = {
    isBusy: () => false,
    saveLoopParked: () => false,
    isSaveClean: () => true,
    restoreInProgress: () => false,
    peers: async () => 'alone',
    ownBase: () => null,
}

/**
 * The default clean-up facts of the wrapper below: another tab is open, so a web page's pass refuses before any store2
 * read and no case reaches the live facts (and with them `globalApi.svelte`). An app page ignores both web facts.
 */
const REFUSING_GC: AutoGcFacts = { ...CLEAN, restoreInProgress: () => false, peers: async () => 'others', ownBase: () => null }

/**
 * The page's facts for the asset sweep, injected so that no case loads the application's `globalApi.svelte` through the
 * live path. The default stops the pass before it reads anything (a data action is "registered"), so the cases that are
 * about the old-data deletion and the clean-up pass keep their own call logs; the asset-sweep cases pass `ACTIVE_SWEEP`.
 */
const QUIET_SWEEP: SweepPageFacts = {
    residentRefs: () => [],
    writtenCount: () => 0,
    writtenThisPage: () => [],
    peers: async () => 'alone',
    shouldStop: () => true,
    release: () => { },
    hold: remove => remove(),
}

const ACTIVE_SWEEP: SweepPageFacts = { ...QUIET_SWEEP, shouldStop: () => false, hold: remove => holdAssetDeletion(remove) }

/**
 * The page's facts for the inlay sweep, injected for the same reason: the default stops the pass before it reads anything,
 * so no case loads the application's modules through the live path. The inlay cases pass their own facts.
 */
const QUIET_INLAYS: InlayPageFacts = {
    peers: async () => 'alone',
    shouldStop: () => true,
    saveMarks: () => 0,
    writtenThisPage: () => false,
    legacyInlayIds: async () => [],
    residentInlays: async () => null,
    lock: (_id, work) => work(),
}

function startStore2Maintenance(env: MaintenanceEnv, seams: MaintenanceSeams = {}): ReturnType<typeof startLiveMaintenance> {
    return startLiveMaintenance(env, { sweepFacts: QUIET_SWEEP, gcPageFacts: REFUSING_GC, inlayFacts: QUIET_INLAYS, ...seams })
}

beforeEach(() => {
    resetPageStorageModeForTests()
    resetStartupCleanupForTests()
    resetMaintenanceForTests()
    resetAssetDeleteHoldForTests()
    setPageStorageMode({ kind: 'store2' })
})

afterEach(() => {
    vi.restoreAllMocks()
    resetPageStorageModeForTests()
    resetStartupCleanupForTests()
    resetMaintenanceForTests()
})

describe('only a boot that did not install starts the runner', () => {
    test('reproducer: the boot that installed the profile (row 1) starts nothing', async () => {
        const { session } = await openSession('empty')
        const trigger = fakeTrigger()

        const started = startStore2Maintenance(noStore, { session: () => session, startTrigger: trigger.start })

        expect(session.decision).toMatchObject({ row: 1 })
        expect(bootDidNotInstall(session)).toBe(false)
        expect(started).toBeNull()
        expect(trigger.counts.started).toBe(0)
    })

    test('reproducer: the boot that re-ran an interrupted install (row 9) starts nothing', async () => {
        const { session } = await openSession('seed-marker')
        const trigger = fakeTrigger()

        const started = startStore2Maintenance(noStore, { session: () => session, startTrigger: trigger.start })

        expect(session.decision).toMatchObject({ row: 9 })
        expect(started).toBeNull()
        expect(trigger.counts.started).toBe(0)
    })

    test('reproducer: a boot that went to recovery (row 7) starts nothing', async () => {
        const { session } = await openSession('no-current')
        const trigger = fakeTrigger()

        const started = startStore2Maintenance(noStore, { session: () => session, startTrigger: trigger.start })

        expect(session.decision).toMatchObject({ row: 7 })
        expect(started).toBeNull()
        expect(trigger.counts.started).toBe(0)
    })

    test('reproducer: the next boot over the installed profile (row 5) arms the trigger', async () => {
        const { session } = await openSession('ready')
        const trigger = fakeTrigger()

        const started = startStore2Maintenance(noStore, { session: () => session, startTrigger: trigger.start })

        expect(session.decision).toMatchObject({ row: 5, mode: 'normal' })
        expect(started).not.toBeNull()
        expect(trigger.counts).toEqual({ started: 1, armed: 1, stopped: 0 })
    })

    test.each<[string, PageStorageMode]>([
        ['read-only', { kind: 'read-only', reason: 'backend-unavailable' }],
        ['undecided', { kind: 'unset' }],
    ])('reproducer: a %s page starts nothing even with a ready session in hand', async (_name, mode) => {
        const { session } = await openSession('ready')
        setPageStorageMode(mode)
        const trigger = fakeTrigger()

        const started = startStore2Maintenance(noStore, { session: () => session, startTrigger: trigger.start })

        expect(started).toBeNull()
        expect(trigger.counts.started).toBe(0)
    })

    test('guard: a page with no store2 session starts nothing', () => {
        const trigger = fakeTrigger()

        const started = startStore2Maintenance(noStore, { session: () => null, startTrigger: trigger.start })

        expect(started).toBeNull()
        expect(trigger.counts.started).toBe(0)
    })

    test('guard: a trigger that cannot be started is logged and the page goes on', async () => {
        const { session } = await openSession('ready')
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})

        const started = startStore2Maintenance(noStore, { session: () => session, startTrigger: () => { throw new Error('no document') } })

        expect(started).toBeNull()
        expect(error).toHaveBeenCalledTimes(1)
    })
})

describe('the step', () => {
    test('reproducer: nothing is registered or run before the trigger fires; then the step runs once with the session and the page store, and the registered promise settles when it ends', async () => {
        const { session } = await openSession('ready')
        const trigger = fakeTrigger()
        const ended = deferred<OldDataDeletionResult>()
        const deletion = vi.fn(() => ended.promise)
        const store = createMemoryByteStore()

        startStore2Maintenance({ store: async () => store, listBackupTimes: async () => [] }, { session: () => session, startTrigger: trigger.start, deletion })

        expect(getStartupCleanup()).toBeNull()
        expect(deletion).not.toHaveBeenCalled()

        trigger.fire()
        await vi.waitFor(() => expect(deletion).toHaveBeenCalledTimes(1))
        expect(trigger.counts.stopped).toBe(1)
        expect(deletion.mock.calls[0]).toMatchObject([session, { store }])
        const registered = getStartupCleanup()
        expect(registered).not.toBeNull()

        let settled = false
        void registered?.then(() => { settled = true })
        await Promise.resolve()
        expect(settled).toBe(false)

        ended.resolve(COMPLETED)
        await registered
        expect(settled).toBe(true)
        expect(getStartupCleanup()).toBeNull()
    })

    test('reproducer: a step that fails is logged, its registered promise still settles, and a later step may run', async () => {
        const { session } = await openSession('ready')
        const trigger = fakeTrigger()
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        const deletion = vi.fn<() => Promise<OldDataDeletionResult>>()
        deletion.mockRejectedValueOnce(new Error('The store went away.'))
        deletion.mockResolvedValueOnce(COMPLETED)
        startStore2Maintenance(noStore, { session: () => session, startTrigger: trigger.start, deletion })

        trigger.fire()
        await vi.waitFor(() => expect(deletion).toHaveBeenCalledTimes(1))
        await getStartupCleanup()

        expect(error).toHaveBeenCalledTimes(1)
        expect(getStartupCleanup()).toBeNull()

        trigger.fire()
        await vi.waitFor(() => expect(deletion).toHaveBeenCalledTimes(2))
    })

    test('reproducer: a store that cannot be opened is logged and its registered promise still settles', async () => {
        const { session } = await openSession('ready')
        const trigger = fakeTrigger()
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        const deletion = vi.fn(async () => COMPLETED)
        startStore2Maintenance({ store: async () => { throw new Error('No store.') }, listBackupTimes: async () => [] }, { session: () => session, startTrigger: trigger.start, deletion })

        trigger.fire()
        // The old-data deletion, the clean-up pass, the asset sweep and the inlay sweep each open the store: each failure is logged on its own.
        await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(4))
        await getStartupCleanup()

        expect(deletion).not.toHaveBeenCalled()
        expect(getStartupCleanup()).toBeNull()
    })

    test('reproducer: one step runs at a time: a second trigger firing while the first step is pending runs nothing', async () => {
        const { session } = await openSession('ready')
        const first = fakeTrigger()
        const second = fakeTrigger()
        const ended = deferred<OldDataDeletionResult>()
        const deletion = vi.fn(() => ended.promise)
        startStore2Maintenance(noStore, { session: () => session, startTrigger: first.start, deletion })
        startStore2Maintenance(noStore, { session: () => session, startTrigger: second.start, deletion })

        first.fire()
        await vi.waitFor(() => expect(deletion).toHaveBeenCalledTimes(1))
        second.fire()
        await Promise.resolve()
        await Promise.resolve()

        expect(deletion).toHaveBeenCalledTimes(1)
        ended.resolve(COMPLETED)
        await getStartupCleanup()
    })
})

describe('the pace the runner gives the deletion', () => {
    /** The ready session read as a Node page: the runner reads only its decision and kind. */
    async function readyAs(kind: Store2Session['kind']): Promise<Store2Session> {
        const { session } = await openSession('ready')
        return Object.create(session, { kind: { value: kind } }) as Store2Session
    }

    async function paceGiven(session: Store2Session): Promise<(() => Promise<void>) | undefined> {
        const trigger = fakeTrigger()
        const deletion = vi.fn(async () => COMPLETED)
        // The facts are injected: a tauri page reaches the clean-up pass, whose default facts load the whole application.
        startStore2Maintenance(noStore, { session: () => session, startTrigger: trigger.start, deletion, gcPageFacts: CLEAN })
        trigger.fire()
        await vi.waitFor(() => expect(deletion).toHaveBeenCalledTimes(1))
        await getStartupCleanup()
        const deps = (deletion.mock.calls[0] as unknown as [unknown, { pace?: () => Promise<void> }])[1]
        return deps.pace
    }

    afterEach(() => {
        vi.useRealTimers()
    })

    test('reproducer: a Node page gives the deletion the Node floor between batches', async () => {
        const pace = await paceGiven(await readyAs('node'))
        expect(pace).toBeDefined()
        vi.useFakeTimers()

        let waited = false
        void pace?.().then(() => { waited = true })
        await vi.advanceTimersByTimeAsync(NODE_BATCH_PACE_MS - 1)
        expect(waited).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(waited).toBe(true)
    })

    test.each<Store2Session['kind']>(['indexeddb', 'tauri'])('guard: a %s page gives no pace (the deletion only yields, as before)', async kind => {
        expect(await paceGiven(await readyAs(kind))).toBeUndefined()
    })
})

describe('the real engine through the runner', () => {
    test('reproducer: on the next boot the first quiet moment deletes the listed keys and drops the pointer, and the registered promise settles', async () => {
        const { session, backend } = await openSession('ready')
        const store = createMemoryByteStore()
        const keys = ['blocks/head', 'blocks/000000000001-aaaaaaaa/root', 'database/database.pre-blocks.1']
        for (const key of [...keys, 'assets/x']) {
            store.files.set(key, new Uint8Array([1]))
        }
        const body: DeletionSnapshot = { v: 1, kind: 'fork-format-only', upstream: { main: false, backups: [] }, keys }
        const unit = newUnitKey(env)
        const bytes = encodeUnit(UNIT_TYPE.deletionSnapshot, body)
        await backend.putUnit(unit, bytes)
        const pointer: SnapshotPointer = { key: unit, digest: unitDigest(bytes), count: keys.length }
        await peerWrite(backend, env, { snapshot: pointer })
        const trigger = fakeTrigger()

        startStore2Maintenance({ store: async () => store, listBackupTimes: async () => [] }, { session: () => session, startTrigger: trigger.start })
        trigger.fire()
        await vi.waitFor(() => expect(getStartupCleanup()).not.toBeNull())
        await getStartupCleanup()

        expect([...store.files.keys()]).toEqual(['assets/x'])
        expect((await parsedCommit(backend)).snapshot).toBeUndefined()
    })
})

async function orphansLeft(page: { memory: MemoryBackend, orphans: string[] }): Promise<number> {
    const read = await page.memory.readUnits(page.orphans)
    return page.orphans.filter(key => read.get(key) !== null).length
}

/** The clean-up pass's result lines; the asset sweep's and the inlay sweep's own lines are read by their own cases. */
function infoLines(info: { mock: { calls: unknown[][] } }): string[] {
    return info.mock.calls.map(call => String(call[0])).filter(line => !line.startsWith('store2 asset sweep') && !line.startsWith('store2 inlay sweep'))
}

function inlayLines(info: { mock: { calls: unknown[][] } }): string[] {
    return info.mock.calls.map(call => String(call[0])).filter(line => line.startsWith('store2 inlay sweep'))
}

function sweepLines(info: { mock: { calls: unknown[][] } }): string[] {
    return info.mock.calls.map(call => String(call[0])).filter(line => line.startsWith('store2 asset sweep'))
}

/** Fires the quiet trigger once and waits for the step to end. */
async function fireOnce(page: { session: Store2Session }, seams: Partial<Parameters<typeof startStore2Maintenance>[1]> = {}): Promise<void> {
    const trigger = fakeTrigger()
    startStore2Maintenance(noStore, { session: () => page.session, startTrigger: trigger.start, deletion: vi.fn(async () => COMPLETED), gcPageFacts: CLEAN, ...seams })
    trigger.fire()
    await vi.waitFor(() => expect(getStartupCleanup()).not.toBeNull())
    await getStartupCleanup()
}

describe('the clean-up pass after the old-data deletion', () => {
    interface TauriPage {
        session: Store2Session
        memory: MemoryBackend
        over: FlushConfirming
        orphans: string[]
    }

    /** A `tauri` session over the seeded store with `orphanCount` units that no manifest names; its call log starts empty. */
    async function openTauri(orphanCount: number): Promise<TauriPage> {
        const memory = createMemoryBackend()
        await seedStore(memory, env)
        const orphans: string[] = []
        for (let i = 0; i < orphanCount; i++) {
            const key = newUnitKey(env)
            await memory.putUnit(key, encodeUnit(UNIT_TYPE.preset, { v: 1, orphan: key }))
            orphans.push(key)
        }
        const over = flushConfirming(memory)
        const session = await Store2Session.open(createMemoryByteStore(), { kind: 'tauri', backend: over.backend, upstreamMainFile: async () => false })
        expect(session.decision).toMatchObject({ row: 5, mode: 'normal' })
        expect(session.idleReason).toBeNull()
        over.calls.length = 0
        return { session, memory, over, orphans }
    }

    test('reproducer R1: after the deletion the first quiet moment deletes the orphan units, keeps every unit of the tree, and logs one result line', async () => {
        const page = await openTauri(30)
        const treeBefore = (await page.memory.listStore2()).filter(key => !page.orphans.includes(key))
        const order: string[] = []
        const info = vi.spyOn(console, 'info').mockImplementation(line => {
            if (!String(line).startsWith('store2 asset sweep') && !String(line).startsWith('store2 inlay sweep')) {
                order.push('pass')
            }
        })
        const deletion = vi.fn(async () => { order.push('deletion'); return COMPLETED })

        await fireOnce(page, { deletion })

        expect(await orphansLeft(page)).toBe(0)
        expect(await page.memory.listStore2()).toEqual(treeBefore)
        await expectInvariant(page.memory)
        expect(order, 'the pass starts after the deletion settled').toEqual(['deletion', 'pass'])
        const lines = infoLines(info)
        expect(lines).toHaveLength(1)
        expect(lines[0]).toContain('status=done deleted=30 batches=2')
        expect(lines[0]).not.toContain('stopped=')
    })

    test.each<[string, AutoGcFacts]>([
        ['a data action is registered', { ...CLEAN, isBusy: () => true }],
        ['the save loop is parked', { ...CLEAN, saveLoopParked: () => true }],
        ['the save has not committed', { ...CLEAN, isSaveClean: () => false }],
    ])('guard R2: no pass runs while %s', async (_name, facts) => {
        const page = await openTauri(30)
        vi.spyOn(console, 'info').mockImplementation(() => {})

        await fireOnce(page, { gcPageFacts: facts })

        expect(page.over.calls, 'not even a read reaches the backend').toEqual([])
        expect(await orphansLeft(page)).toBe(30)
    })

    test('guard R3: a session that turned idle after the trigger fired deletes nothing and does not retry', async () => {
        const page = await openTauri(30)
        const info = vi.spyOn(console, 'info').mockImplementation(() => {})
        // The flip lands on the next fence read after the deletion settled, which is the pass's own: after the runner took
        // the session and before the gate reads `idleReason`. It is a commit-key rewrite through the session's tracker that
        // reports no flush, never a fence write (that would refuse the gate for another reason).
        const deletion = vi.fn(async () => {
            let armed = true
            page.over.before = async name => {
                if (name !== 'readFence' || !armed) {
                    return
                }
                armed = false
                page.over.flushed = false
                const backend = page.session.backend as NonNullable<Store2Session['backend']>
                const read = await backend.readCommit()
                await backend.casCommit(read.token, read.bytes as Uint8Array)
                page.over.flushed = true
            }
            return COMPLETED
        })

        await fireOnce(page, { deletion })

        expect(page.session.idleReason).not.toBeNull()
        expect(infoLines(info)).toHaveLength(1)
        expect(infoLines(info)[0]).toContain('status=refused reason=idle')
        expect(page.over.count('removeBatch')).toBe(0)
        expect(page.over.count('listStore2')).toBe(0)
        expect(await orphansLeft(page)).toBe(30)
    })

    test('reproducer R4: the pass stops between batches once a data action is registered; the first batch stays applied', async () => {
        const page = await openTauri(60)
        const info = vi.spyOn(console, 'info').mockImplementation(() => {})

        await fireOnce(page, { gcPageFacts: { ...CLEAN, isBusy: () => page.over.count('removeBatch') >= 1 } })

        expect(page.over.count('removeBatch')).toBe(1)
        expect(await orphansLeft(page)).toBe(35)
        expect(infoLines(info)[0]).toContain('status=done deleted=25 batches=1 stopped=yielded')
        await expectInvariant(page.memory)
    })

    test('reproducer R4: a page that turns busy after the listing stops before the first batch', async () => {
        const page = await openTauri(30)
        vi.spyOn(console, 'info').mockImplementation(() => {})

        await fireOnce(page, { gcPageFacts: { ...CLEAN, isBusy: () => page.over.count('listStore2') >= 1 } })

        expect(page.over.count('listStore2')).toBe(1)
        expect(page.over.count('removeBatch')).toBe(0)
        expect(await orphansLeft(page)).toBe(30)
    })

    test('reproducer R4: a rebuild round that starts on a busy page ends without reading again', async () => {
        const page = await openTauri(60)
        const info = vi.spyOn(console, 'info').mockImplementation(() => {})
        // A peer commit lands under the second batch: the batch conflicts and the pass would rebuild from a fresh read.
        page.over.before = async (name, count) => {
            if (name === 'removeBatch' && count === 2) {
                page.over.before = null
                const peer = committerOf(page.memory, createClock(), 77)
                expect((await peer.commit(await page.memory.readCommit(), treeRequest(0, { tag: 'peer' }))).status).toBe('committed')
            }
        }

        await fireOnce(page, { gcPageFacts: { ...CLEAN, isBusy: () => page.over.count('removeBatch') >= 2 } })

        expect(infoLines(info)[0]).toContain('status=done deleted=25 batches=1 stopped=yielded')
        expect(page.over.count('listStore2'), 'the second round never listed').toBe(1)
        await expectInvariant(page.memory)
    })

    test('guard B6: a page whose save is no longer committed after the first batch gets no further batch', async () => {
        const page = await openTauri(60)
        vi.spyOn(console, 'info').mockImplementation(() => {})

        await fireOnce(page, { gcPageFacts: { ...CLEAN, isSaveClean: () => page.over.count('removeBatch') < 1 } })

        expect(page.over.count('removeBatch')).toBe(1)
        expect(await orphansLeft(page)).toBe(35)
    })

    test('guard: a page that left store2 mode before the trigger fired runs the deletion and no pass', async () => {
        const page = await openTauri(30)
        const trigger = fakeTrigger()
        const deletion = vi.fn(async () => COMPLETED)
        startStore2Maintenance(noStore, { session: () => page.session, startTrigger: trigger.start, deletion, gcPageFacts: CLEAN })
        setPageStorageMode({ kind: 'unset' })

        trigger.fire()
        await getStartupCleanup()

        expect(deletion).toHaveBeenCalledTimes(1)
        expect(page.over.calls).toEqual([])
        expect(await orphansLeft(page)).toBe(30)
    })

    test('guard K: a node session over a store without the guarded routes lists nothing, logs the capability refusal and the orphan stays', async () => {
        const { session, backend } = await openSession('ready')
        const orphan = newUnitKey(env)
        await backend.putUnit(orphan, encodeUnit(UNIT_TYPE.preset, { v: 1, orphan }))
        const listing = vi.spyOn(backend, 'listStore2')
        const info = vi.spyOn(console, 'info').mockImplementation(() => {})
        const asKind = Object.create(session, { kind: { value: 'node' } }) as Store2Session

        await fireOnce({ session: asKind })

        expect(listing).not.toHaveBeenCalled()
        expect(infoLines(info)).toEqual(['store2 clean-up: status=refused reason=capability-missing'])
        expect((await backend.readUnits([orphan])).get(orphan)).not.toBeNull()
    })

    describe('on a Node server (real server process)', () => {
        const servers: NodeServerFixture[] = []

        afterEach(async () => {
            await Promise.all(servers.splice(0).map(server => server.stop()))
        })

        const DAY = 24 * 60 * 60 * 1000

        interface NodePage {
            session: Store2Session
            store: ByteStore
            backend: Store2Backend
            orphans: string[]
            base: string | null
        }

        async function openNode(orphanCount: number): Promise<NodePage> {
            const fixture = await startNodeServer()
            servers.push(fixture)
            const store = createNodeHttpStore({ baseUrl: fixture.baseUrl, authHeader: () => fixture.authHeader() })
            const backend = createNodeBackend(store)
            await seedStore(backend, env)
            const orphans: string[] = []
            for (let i = 0; i < orphanCount; i++) {
                const key = newUnitKey(env)
                await backend.putUnit(key, encodeUnit(UNIT_TYPE.preset, { v: 1, orphan: key }))
                orphans.push(key)
            }
            const session = await Store2Session.open(store, { kind: 'node', backend, upstreamMainFile: async () => false })
            expect(session.decision).toMatchObject({ row: 5, mode: 'normal' })
            const parsed = classifyCommitRead(await backend.readCommit())
            const base = parsed.status === 'parsed' && parsed.value.current !== null ? parsed.value.current.key : null
            return { session, store, backend, orphans, base }
        }

        /** The record as the pass writes it, planted under the literal key: every orphan already seen once, a day and an hour ago. */
        async function plantSeenRecord(page: NodePage, ageMs: number): Promise<void> {
            const items = page.orphans.map((key): [string, null, number] => [key, null, 1])
            await page.store.write('store2-gc-age', encodeUnit(UNIT_TYPE.sweepRecord, { v: 1, at: Date.now() - ageMs, items }), 'unconditional')
        }

        async function orphansLeftOn(page: NodePage): Promise<number> {
            const read = await page.backend.readUnits(page.orphans)
            return page.orphans.filter(key => read.get(key) !== null).length
        }

        async function fireNode(page: NodePage, facts: Partial<AutoGcFacts>, seams: MaintenanceSeams = {}): Promise<void> {
            const trigger = fakeTrigger()
            startStore2Maintenance(
                { store: async () => page.store, listBackupTimes: async () => [] },
                { session: () => page.session, startTrigger: trigger.start, deletion: vi.fn(async () => COMPLETED), gcPageFacts: { ...CLEAN, ownBase: () => page.base, ...facts }, ...seams },
            )
            trigger.fire()
            await vi.waitFor(() => expect(getStartupCleanup()).not.toBeNull())
            await getStartupCleanup()
        }

        test('reproducer RR1: a node page deletes the orphans a record from 25 hours ago named as seen before, and logs one result line', async () => {
            const page = await openNode(6)
            await plantSeenRecord(page, DAY + 60 * 60 * 1000)
            const info = vi.spyOn(console, 'info').mockImplementation(() => {})

            await fireNode(page, { peers: async () => 'unsupported' })

            expect(infoLines(info)).toEqual([expect.stringMatching(/^store2 clean-up: status=done deleted=6 batches=1 phase=swept candidates=6 /)])
            expect(await orphansLeftOn(page)).toBe(0)
            await expectInvariant(page.backend)
        })

        /** A hash-shaped asset stored through the page's store, and the revision the server lists it at. */
        async function plantAsset(page: NodePage, name: string): Promise<number | null> {
            await page.store.write(`assets/${name}`, new Uint8Array([1, 2, 3]), 'unconditional')
            const listed = await page.store.listRevisions?.('assets/')
            return listed?.find(row => row.key === `assets/${name}`)?.rev ?? null
        }

        test('reproducer RR2: a node page removes an orphan asset that a record from 25 hours ago names as seen before at its revision, and logs one sweep line', async () => {
            const page = await openNode(0)
            const name = 'a'.repeat(64) + '.png'
            const rev = await plantAsset(page, name)
            expect(rev).not.toBeNull()
            await page.store.write(
                'store2-sweep',
                encodeUnit(UNIT_TYPE.sweepRecord, { v: 1, at: Date.now() - DAY - 60 * 60 * 1000, items: [[name, rev, 1]] }),
                'unconditional',
            )
            const info = vi.spyOn(console, 'info').mockImplementation(() => {})

            await fireNode(page, { peers: async () => 'unsupported' }, { sweepFacts: ACTIVE_SWEEP })

            expect(await page.store.has(`assets/${name}`)).toBe(false)
            const lines = sweepLines(info)
            expect(lines).toHaveLength(1)
            expect(lines[0]).toMatch(/^store2 asset sweep: status=done phase=swept candidates=1 deleted=1 failed=0 kept-live=0 batches=1 recorded=true$/)
            expect(lines[0], 'counts only').not.toContain(name)
        })

        test('guard: a node page whose step is not quiet reads nothing for the sweep and logs a yielded line', async () => {
            const page = await openNode(0)
            const name = 'b'.repeat(64) + '.png'
            const rev = await plantAsset(page, name)
            await page.store.write(
                'store2-sweep',
                encodeUnit(UNIT_TYPE.sweepRecord, { v: 1, at: Date.now() - DAY - 60 * 60 * 1000, items: [[name, rev, 1]] }),
                'unconditional',
            )
            const info = vi.spyOn(console, 'info').mockImplementation(() => {})

            await fireNode(page, { peers: async () => 'unsupported' })

            expect(await page.store.has(`assets/${name}`)).toBe(true)
            expect(sweepLines(info)).toEqual([expect.stringMatching(/^store2 asset sweep: status=done phase=none candidates=0 deleted=0 .* recorded=false stopped=yielded$/)])
        })

        test('guard: a node page with another tab open (peers others) deletes nothing and writes no record', async () => {
            const page = await openNode(6)
            await plantSeenRecord(page, DAY + 60 * 60 * 1000)
            const before = await page.store.read('store2-gc-age')
            const info = vi.spyOn(console, 'info').mockImplementation(() => {})

            await fireNode(page, { peers: async () => 'others' })

            expect(infoLines(info)).toEqual([expect.stringMatching(/^store2 clean-up: status=refused reason=other-tab/)])
            expect(await orphansLeftOn(page)).toBe(6)
            expect((await page.store.read('store2-gc-age')).version).toBe(before.version)
        })

        /** The manual clean-up's planted Node page: one asset a record from 25 hours ago names as seen before at its revision. */
        async function plantManualNode(): Promise<{ page: NodePage, name: string }> {
            const page = await openNode(0)
            const name = 'c'.repeat(64) + '.png'
            const rev = await plantAsset(page, name)
            expect(rev).not.toBeNull()
            await page.store.write(
                'store2-sweep',
                encodeUnit(UNIT_TYPE.sweepRecord, { v: 1, at: Date.now() - DAY - 60 * 60 * 1000, items: [[name, rev, 1]] }),
                'unconditional',
            )
            return { page, name }
        }

        const UNSUPPORTED_SWEEP: SweepPageFacts = { ...ACTIVE_SWEEP, peers: async () => 'unsupported' }

        function manualSeams(page: NodePage) {
            return { session: () => page.session, store: async () => page.store, sweepFacts: UNSUPPORTED_SWEEP }
        }

        function answering(answer: boolean | (() => Promise<boolean>)): ManualCleanUpUi & {
            progress: ReturnType<typeof vi.fn<ManualCleanUpUi['progress']>>
            confirm: ReturnType<typeof vi.fn<(plan: ManualCleanUpPlan) => Promise<boolean>>>
        } {
            return { progress: vi.fn(), confirm: vi.fn(async () => (typeof answer === 'boolean' ? answer : await answer())) }
        }

        test('guard G16: the automatic node step on plain HTTP (peers unsupported) still refuses no-web-locks and keeps the asset', async () => {
            const { page, name } = await plantManualNode()
            const info = vi.spyOn(console, 'info').mockImplementation(() => {})

            await fireNode(page, { peers: async () => 'unsupported' }, { sweepFacts: UNSUPPORTED_SWEEP })

            expect(sweepLines(info)).toEqual(['store2 asset sweep: status=refused reason=no-web-locks'])
            expect(await page.store.has(`assets/${name}`)).toBe(true)
        })

        test('E2(a): manual clean-up on a plain-HTTP node page: Yes deletes the approved aged asset, rewrites the record and reports its size', async () => {
            const { page, name } = await plantManualNode()
            const sizes = await page.store.listSized?.('assets/', 0)
            const size = sizes?.find(row => row.key === `assets/${name}`)?.size
            expect(size).toBe(3)
            const before = await page.store.read('store2-sweep')
            vi.spyOn(console, 'info').mockImplementation(() => {})
            const ui = answering(true)

            const outcome = await runManualCleanUp(ui, manualSeams(page))

            expect(ui.confirm).toHaveBeenCalledTimes(1)
            expect(ui.confirm).toHaveBeenCalledWith({ kind: 'node', deletable: 1, later: 0, bytes: size })
            expect(outcome).toMatchObject({ status: 'ended', approved: 1, result: { status: 'done', phase: 'swept', deleted: 1, recorded: true } })
            expect(await page.store.has(`assets/${name}`)).toBe(false)
            const after = await page.store.read('store2-sweep')
            expect(after.version).not.toBe(before.version)
            expect(await readSweepRecord(page.store)).toMatchObject({ status: 'ok', value: { items: [] } })
        })

        test('E2(b): No on the node confirm changes nothing and never starts the delete step', async () => {
            const { page, name } = await plantManualNode()
            const before = await page.store.read('store2-sweep')
            const info = vi.spyOn(console, 'info').mockImplementation(() => {})

            const outcome = await runManualCleanUp(answering(false), manualSeams(page))

            expect(outcome).toEqual({ status: 'declined' })
            expect(await page.store.has(`assets/${name}`)).toBe(true)
            const after = await page.store.read('store2-sweep')
            expect(after.version).toBe(before.version)
            expect(after.bytes).toEqual(before.bytes)
            expect(sweepLines(info)).toEqual([expect.stringMatching(/^store2 asset sweep: status=planned /)])
        })

        test('E2(c): a record another device wrote between the plan and the Yes gives wait, deletes nothing and leaves that record', async () => {
            const { page, name } = await plantManualNode()
            vi.spyOn(console, 'info').mockImplementation(() => {})
            const fresh = encodeUnit(UNIT_TYPE.sweepRecord, { v: 1, at: Date.now(), items: [] })

            const outcome = await runManualCleanUp(answering(async () => {
                await page.store.write('store2-sweep', fresh, 'unconditional')
                return true
            }), manualSeams(page))

            expect(outcome).toEqual({ status: 'wait' })
            expect(await page.store.has(`assets/${name}`)).toBe(true)
            expect((await page.store.read('store2-sweep')).bytes).toEqual(fresh)
        })

        test('E2(d): a repeat press within a day finds the young record at the plan: wait, no confirm, nothing deleted, record unchanged', async () => {
            const { page, name } = await plantManualNode()
            vi.spyOn(console, 'info').mockImplementation(() => {})
            expect(await runManualCleanUp(answering(true), manualSeams(page))).toMatchObject({ status: 'ended' })
            const written = await page.store.read('store2-sweep')
            await plantAsset(page, 'd'.repeat(64) + '.png')
            const ui = answering(true)

            const outcome = await runManualCleanUp(ui, manualSeams(page))

            expect(outcome).toEqual({ status: 'wait' })
            expect(ui.confirm).not.toHaveBeenCalled()
            expect(await page.store.has(`assets/${'d'.repeat(64)}.png`)).toBe(true)
            expect(await page.store.has(`assets/${name}`)).toBe(false)
            const after = await page.store.read('store2-sweep')
            expect(after.version).toBe(written.version)
            expect(after.bytes).toEqual(written.bytes)
        })

        test('E2(f): a young record that appears after one approved delete went through ends as done young with deleted=1, not as wait', async () => {
            const page = await openNode(0)
            const names = ['f', '1'].map(char => char.repeat(64) + '.png')
            const items: [string, number | null, number][] = []
            for (const name of names) {
                const rev = await plantAsset(page, name)
                expect(rev).not.toBeNull()
                items.push([name, rev, 1])
            }
            await page.store.write('store2-sweep', encodeUnit(UNIT_TYPE.sweepRecord, { v: 1, at: Date.now() - DAY - 60 * 60 * 1000, items }), 'unconditional')
            vi.spyOn(console, 'info').mockImplementation(() => {})
            const fresh = encodeUnit(UNIT_TYPE.sweepRecord, { v: 1, at: Date.now(), items: [] })
            const peer = committerOf(page.backend, clock, 99)
            let holds = 0
            const moving: SweepPageFacts = {
                ...UNSUPPORTED_SWEEP,
                hold: async remove => {
                    if (++holds === 2) {
                        expect((await peer.commit(await page.backend.readCommit(), treeRequest(0))).status).toBe('committed')
                        await page.store.write('store2-sweep', fresh, 'unconditional')
                    }
                    await remove()
                },
            }

            const outcome = await runManualCleanUp(answering(true), { ...manualSeams(page), sweepFacts: moving })

            expect(outcome).toMatchObject({ status: 'ended', approved: 2, result: { status: 'done', phase: 'young', deleted: 1 } })
            const remaining = await Promise.all(names.map(name => page.store.has(`assets/${name}`)))
            expect(remaining.filter(present => !present)).toHaveLength(1)
            expect((await page.store.read('store2-sweep')).bytes).toEqual(fresh)
        })

        test('E2(e): a Cancel pressed during the plan on the note path (nothing deletable yet, one later) gives cancelled(0) and never asks the confirm', async () => {
            const page = await openNode(0)
            const name = 'e'.repeat(64) + '.png'
            await plantAsset(page, name)
            vi.spyOn(console, 'info').mockImplementation(() => {})
            let cancel: () => void = () => {}
            const ui = answering(true)
            ui.progress.mockImplementation((_step: string, onCancel: () => void) => { cancel = onCancel })
            const cancelling: SweepPageFacts = {
                ...UNSUPPORTED_SWEEP,
                peers: async () => {
                    cancel()
                    return 'unsupported'
                },
            }

            const outcome = await runManualCleanUp(ui, { ...manualSeams(page), sweepFacts: cancelling })

            expect(outcome).toEqual({ status: 'cancelled', deleted: 0 })
            expect(ui.confirm).not.toHaveBeenCalled()
            expect(await page.store.has(`assets/${name}`)).toBe(true)
        })

        test('E2(g): a Cancel pressed while the confirm size is measured (deletable asset, Node listSized) gives cancelled(0) and never asks the confirm', async () => {
            const { page, name } = await plantManualNode()
            vi.spyOn(console, 'info').mockImplementation(() => {})
            let cancel: () => void = () => {}
            const ui = answering(true)
            ui.progress.mockImplementation((_step, onCancel) => { cancel = onCancel })
            const listSized = page.store.listSized?.bind(page.store)
            expect(listSized).toBeDefined()
            const store = {
                ...page.store,
                listSized: async (prefix: string, limit: number) => {
                    const rows = await listSized?.(prefix, limit)
                    cancel()
                    return rows ?? []
                },
            }

            const outcome = await runManualCleanUp(ui, { ...manualSeams(page), store: async () => store })

            expect(outcome).toEqual({ status: 'cancelled', deleted: 0 })
            expect(ui.confirm).not.toHaveBeenCalled()
            expect(await page.store.has(`assets/${name}`)).toBe(true)
        })
    })

    test('reproducer K-web (a): an indexeddb session alone on its own base deletes the orphan and logs one result line', async () => {
        const { session, backend } = await openSession('ready')
        const orphan = newUnitKey(env)
        await backend.putUnit(orphan, encodeUnit(UNIT_TYPE.preset, { v: 1, orphan }))
        const parsed = classifyCommitRead(await backend.readCommit())
        const base = parsed.status === 'parsed' && parsed.value.current !== null ? parsed.value.current.key : null
        const info = vi.spyOn(console, 'info').mockImplementation(() => {})

        await fireOnce({ session }, { gcPageFacts: { ...CLEAN, ownBase: () => base } })

        expect(infoLines(info)).toEqual([expect.stringMatching(/^store2 clean-up: status=done deleted=1 batches=1/)])
        expect((await backend.readUnits([orphan])).get(orphan)).toBeNull()
    })

    test('reproducer K-web (b): an indexeddb session with another tab open lists nothing, logs the refusal and keeps the orphan', async () => {
        const { session, backend } = await openSession('ready')
        const orphan = newUnitKey(env)
        await backend.putUnit(orphan, encodeUnit(UNIT_TYPE.preset, { v: 1, orphan }))
        const listing = vi.spyOn(backend, 'listStore2')
        const info = vi.spyOn(console, 'info').mockImplementation(() => {})

        await fireOnce({ session }, { gcPageFacts: REFUSING_GC })

        expect(listing).not.toHaveBeenCalled()
        expect(infoLines(info)).toEqual([expect.stringMatching(/^store2 clean-up: status=refused reason=other-tab/)])
        expect((await backend.readUnits([orphan])).get(orphan)).not.toBeNull()
    })

    test('guard A6: a deletion that fails is logged and the pass still runs; a pass that throws is logged and the registered promise settles', async () => {
        const page = await openTauri(30)
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.spyOn(console, 'info').mockImplementation(() => {})
        const refused = vi.fn<() => Promise<OldDataDeletionResult>>().mockRejectedValueOnce(new Error('The store went away.'))

        await fireOnce(page, { deletion: refused })

        expect(error).toHaveBeenCalledTimes(1)
        expect(await orphansLeft(page)).toBe(0)

        const broken = await openTauri(30)
        const failure = new Error('The backend broke.')
        broken.over.before = name => {
            if (name === 'readCommit') {
                throw failure
            }
        }
        error.mockClear()

        await fireOnce(broken)

        expect(error).toHaveBeenCalledTimes(1)
        expect(error).toHaveBeenCalledWith(failure)
        expect(getStartupCleanup()).toBeNull()
        expect(await orphansLeft(broken)).toBe(30)
    })
})

describe('restore points under the wired pass', () => {
    /**
     * A tauri page over the seeded store whose restore points are listed, then the wired pass runs, then the point is
     * restored. `m0Keys` are the units of the seed tree, the only tree stored before the first commit.
     */
    async function listedPoint() {
        const memory = createMemoryBackend()
        const m0 = await seedStore(memory, env)
        const m0Keys = await memory.listStore2()
        const committer = committerOf(memory, clock, 5)
        const commitNext = async (tag: string): Promise<void> => {
            expect((await committer.commit(await committer.readCommit(), treeRequest(0, { tag }))).status).toBe('committed')
        }
        clock.advance(ADMISSION_INTERVAL_MS + 1)
        await commitNext('first')
        const listed = await listRestorePoints(memory, await memory.readCommit())
        expect(listed.status).toBe('ok')
        expect(listed.status === 'ok' ? listed.rows.map(row => row.key) : []).toContain(m0)
        const orphans: string[] = []
        for (let i = 0; i < 10; i++) {
            const key = newUnitKey(env)
            await memory.putUnit(key, encodeUnit(UNIT_TYPE.preset, { v: 1, orphan: key }))
            orphans.push(key)
        }
        const over = flushConfirming(memory)
        const session = await Store2Session.open(createMemoryByteStore(), { kind: 'tauri', backend: over.backend, upstreamMainFile: async () => false })
        return { memory, m0, m0Keys, committer, commitNext, session, over, orphans }
    }

    test('guard plus reproducer clause A7 (i): a listed point that is still retained restores after the pass, with its whole tree', async () => {
        const { memory, m0, committer, session, orphans } = await listedPoint()
        vi.spyOn(console, 'info').mockImplementation(() => {})

        await fireOnce({ session })

        expect(await orphansLeft({ memory, orphans })).toBe(0)
        const outcome = await restorePoint(committer, memory, m0)
        expect(outcome.status).toBe('restored')
        expect((await parsedCommit(memory)).current?.key).toBe(m0)
        expect((await readTree(memory, m0)).status).toBe('ok')
        await expectInvariant(memory)
    })

    test('guard plus reproducer clause A7 (ii): a listed point pushed out of retained loses its unique units to the pass and refuses not-named, leaving the commit key unchanged', async () => {
        const { memory, m0, m0Keys, committer, commitNext, session, orphans } = await listedPoint()
        vi.spyOn(console, 'info').mockImplementation(() => {})
        for (let i = 0; i < RETAINED_MAX + 2; i++) {
            clock.advance(ADMISSION_INTERVAL_MS + 1)
            await commitNext(`n${i}`)
        }
        expect((await parsedCommit(memory)).retained.map(entry => entry.key)).not.toContain(m0)

        await fireOnce({ session })

        const stored = new Set(await memory.listStore2())
        expect(m0Keys.filter(key => stored.has(key)), 'the pass deleted the seed tree\'s units').toEqual([])
        expect(await orphansLeft({ memory, orphans })).toBe(0)
        const before = await memory.readCommit()
        const outcome = await restorePoint(committer, memory, m0)
        expect(outcome.status).toBe('not-named')
        expect((await memory.readCommit()).bytes).toEqual(before.bytes)
        await expectInvariant(memory)
    })
})

describe('the asset sweep after the clean-up pass', () => {
    const HOUR = 60 * 60 * 1000
    const ORPHAN = 'orphan-d1.png'
    const YOUNG = 'young-d1.png'

    /** A page store holding an orphan that a record 25 hours old names, and one asset no record names. */
    async function plantedStore(): Promise<MemoryByteStore> {
        const store = createMemoryByteStore()
        store.files.set(`assets/${ORPHAN}`, new Uint8Array([1]))
        store.files.set(`assets/${YOUNG}`, new Uint8Array([2]))
        await writeSweepRecord(store, { v: 1, at: Date.now() - 25 * HOUR, items: [[ORPHAN, null]] })
        return store
    }

    /** A `tauri` session over the seeded store that confirms its flushes, with a few orphan units for the clean-up pass. */
    async function openTauriPage(): Promise<{ session: Store2Session }> {
        const memory = createMemoryBackend()
        await seedStore(memory, env)
        for (let i = 0; i < 3; i++) {
            const key = newUnitKey(env)
            await memory.putUnit(key, encodeUnit(UNIT_TYPE.preset, { v: 1, orphan: key }))
        }
        const session = await Store2Session.open(createMemoryByteStore(), { kind: 'tauri', backend: flushConfirming(memory).backend, upstreamMainFile: async () => false })
        expect(session.idleReason).toBeNull()
        return { session }
    }

    async function fireSweep(page: { session: Store2Session }, store: MemoryByteStore, seams: MaintenanceSeams = {}): Promise<void> {
        const trigger = fakeTrigger()
        startStore2Maintenance(
            { store: async () => store, listBackupTimes: async () => [] },
            { session: () => page.session, startTrigger: trigger.start, deletion: vi.fn(async () => COMPLETED), gcPageFacts: CLEAN, sweepFacts: ACTIVE_SWEEP, ...seams },
        )
        trigger.fire()
        await vi.waitFor(() => expect(getStartupCleanup()).not.toBeNull())
        await getStartupCleanup()
    }

    test('reproducer D1: on an indexeddb session the step deletes the orphan a day-old record names and keeps the asset no record names', async () => {
        const page = await openSession('ready')
        const store = await plantedStore()
        const info = vi.spyOn(console, 'info').mockImplementation(() => {})

        await fireSweep(page, store)

        expect(store.files.has(`assets/${ORPHAN}`)).toBe(false)
        expect(store.files.has(`assets/${YOUNG}`)).toBe(true)
        const lines = sweepLines(info)
        expect(lines).toHaveLength(1)
        expect(lines[0]).toContain('status=done phase=swept')
        expect(lines[0]).toContain('deleted=1')
        expect(lines[0], 'counts only').not.toContain(ORPHAN)
    })

    test('reproducer D1: on a tauri session the step deletes the orphan after the clean-up pass', async () => {
        const page = await openTauriPage()
        const store = await plantedStore()
        const order: string[] = []
        vi.spyOn(console, 'info').mockImplementation(line => { order.push(String(line).startsWith('store2 asset sweep') ? 'sweep' : String(line).startsWith('store2 inlay sweep') ? 'inlays' : 'clean-up') })

        await fireSweep(page, store)

        expect(store.files.has(`assets/${ORPHAN}`)).toBe(false)
        expect(store.files.has(`assets/${YOUNG}`)).toBe(true)
        expect(order, 'the inlay sweep is the last deleter of the step, after the asset sweep').toEqual(['clean-up', 'sweep', 'inlays'])
    })

    test('guard D2: a node session over a store without the server clock ends the sweep no-server-time before it reads or lists anything', async () => {
        const { session } = await openSession('ready')
        const store = await plantedStore()
        store.lists.length = 0
        store.reads.length = 0
        store.writes.length = 0
        const info = vi.spyOn(console, 'info').mockImplementation(() => {})
        const asNode = Object.create(session, { kind: { value: 'node' } }) as Store2Session

        await fireSweep({ session: asNode }, store)

        expect(store.lists).toEqual([])
        expect(store.reads).toEqual([])
        expect(store.writes).toEqual([])
        expect(sweepLines(info)).toEqual(['store2 asset sweep: status=refused reason=no-server-time'])
        expect(store.files.has(`assets/${ORPHAN}`)).toBe(true)
    })

    test('guard D3: the registered startup clean-up covers the sweep until its asset listing resolves', async () => {
        const page = await openSession('ready')
        const store = await plantedStore()
        vi.spyOn(console, 'info').mockImplementation(() => {})
        const listed = deferred<void>()
        const list = store.list.bind(store)
        let asked = false
        vi.spyOn(store, 'list').mockImplementation(async prefix => {
            if (prefix === 'assets/') {
                asked = true
                await listed.promise
            }
            return list(prefix)
        })
        const trigger = fakeTrigger()
        startStore2Maintenance(
            { store: async () => store, listBackupTimes: async () => [] },
            { session: () => page.session, startTrigger: trigger.start, deletion: vi.fn(async () => COMPLETED), gcPageFacts: CLEAN, sweepFacts: ACTIVE_SWEEP },
        )

        trigger.fire()
        await vi.waitFor(() => expect(asked).toBe(true))
        const registered = getStartupCleanup()
        expect(registered).not.toBeNull()
        let settled = false
        void registered?.then(() => { settled = true })
        await new Promise(resolve => setTimeout(resolve, 10))
        expect(settled).toBe(false)

        listed.resolve()
        await registered
        expect(settled).toBe(true)
        expect(store.files.has(`assets/${ORPHAN}`)).toBe(false)
    })

    test('guard: a sweep that throws is logged and swallowed, and the registered promise settles', async () => {
        const page = await openSession('ready')
        const store = await plantedStore()
        vi.spyOn(console, 'info').mockImplementation(() => {})
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        const failure = new Error('The record write failed.')
        store.failWrite = key => (key.startsWith('store2-sweep') ? failure : null)

        await fireSweep(page, store)

        expect(error).toHaveBeenCalledWith(failure)
        expect(getStartupCleanup()).toBeNull()
    })

    test('guard: a page that left store2 mode before the trigger fired never lists assets', async () => {
        const page = await openSession('ready')
        const store = await plantedStore()
        store.lists.length = 0
        const trigger = fakeTrigger()
        startStore2Maintenance(
            { store: async () => store, listBackupTimes: async () => [] },
            { session: () => page.session, startTrigger: trigger.start, deletion: vi.fn(async () => COMPLETED), gcPageFacts: CLEAN, sweepFacts: ACTIVE_SWEEP },
        )
        setPageStorageMode({ kind: 'unset' })

        trigger.fire()
        await getStartupCleanup()

        expect(store.lists).toEqual([])
    })
})

describe('the inlay sweep in the step', () => {
    const O = '0a1b2c3d-1111-4222-8333-000000000003'
    const metaKey = inlayMetaKey(O) as string

    /** The facts of a quiet page that is the sole tab, with an empty resident database and an empty legacy store. */
    function activeInlays(over: Partial<InlayPageFacts> = {}): InlayPageFacts {
        return {
            ...QUIET_INLAYS,
            shouldStop: () => false,
            residentInlays: async () => ({ mentioned: new Set<string>(), sameDatabase: () => true }),
            ...over,
        }
    }

    /** A page store holding the metadata key of an inlay nothing names; the pass lists keys before it reads any record. */
    function storeWithO(): MemoryByteStore {
        const store = createMemoryByteStore()
        store.files.set(metaKey, new Uint8Array([1]))
        return store
    }

    async function fireWith(session: Store2Session, store: MemoryByteStore, seams: MaintenanceSeams): Promise<void> {
        const trigger = fakeTrigger()
        startStore2Maintenance(
            { store: async () => store, listBackupTimes: async () => [] },
            { session: () => session, startTrigger: trigger.start, deletion: vi.fn(async () => COMPLETED), gcPageFacts: CLEAN, ...seams },
        )
        trigger.fire()
        await vi.waitFor(() => expect(getStartupCleanup()).not.toBeNull())
        await getStartupCleanup()
    }

    test('guard G4: a Node page whose facts would allow a delete (sole tab, complete keep-set, nothing resident) lists no inlays, opens no inlay gate, reads no legacy store and logs no inlay line', async () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {})
        const { session } = await openSession('ready')
        const gates = vi.spyOn(session, 'openGate')
        const asNode = Object.create(session, { kind: { value: 'node' } }) as Store2Session
        const nodeStore = storeWithO()
        const legacyInlayIds = vi.fn(async (): Promise<string[]> => [])

        await fireWith(asNode, nodeStore, { inlayFacts: activeInlays({ legacyInlayIds }) })

        expect(nodeStore.files.has(metaKey)).toBe(true)
        expect(inlayLines(info)).toEqual([])
        expect(nodeStore.lists).not.toContain('inlays/')
        expect(legacyInlayIds).not.toHaveBeenCalled()
        expect(gates.mock.calls.filter(call => call[0] === 'inlay-cleanup')).toEqual([])
    })

    test('guard T21: a manual clean-up asked while the inlay pass is mid-walk is refused busy, and the step then ends', async () => {
        const { session } = await openSession('ready')
        const store = storeWithO()
        const walking = deferred<null>()
        const walks = vi.fn(() => walking.promise)
        vi.spyOn(console, 'info').mockImplementation(() => {})
        const trigger = fakeTrigger()
        startStore2Maintenance(
            { store: async () => store, listBackupTimes: async () => [] },
            { session: () => session, startTrigger: trigger.start, deletion: vi.fn(async () => COMPLETED), gcPageFacts: CLEAN, inlayFacts: activeInlays({ residentInlays: walks }) },
        )
        trigger.fire()
        await vi.waitFor(() => expect(walks).toHaveBeenCalledTimes(1))
        const asking = { progress: vi.fn(), confirm: vi.fn(async () => true) }

        expect(await runManualCleanUp(asking, { session: () => session, store: async () => store, sweepFacts: ACTIVE_SWEEP })).toEqual({ status: 'busy' })

        expect(asking.progress).not.toHaveBeenCalled()
        walking.resolve(null)
        await getStartupCleanup()
        expect(store.files.has(metaKey), 'a walk that could not finish deletes nothing').toBe(true)
    })

    test('guard: a manual clean-up never runs the inlay pass (MC-2866)', async () => {
        const { session } = await openSession('ready')
        const store = storeWithO()
        store.files.set('assets/manual-orphan.png', new Uint8Array([1, 2, 3]))
        vi.spyOn(console, 'info').mockImplementation(() => {})

        const outcome = await runManualCleanUp({ progress: vi.fn(), confirm: vi.fn(async () => true) }, { session: () => session, store: async () => store, sweepFacts: ACTIVE_SWEEP })

        expect(outcome).toMatchObject({ status: 'ended', result: { status: 'done', deleted: 1 } })
        expect(store.files.has('assets/manual-orphan.png')).toBe(false)
        expect(store.files.has(metaKey)).toBe(true)
        expect(store.lists).not.toContain('inlays/')
    })
})

describe('the manual clean-up (runManualCleanUp)', () => {
    const MANUAL_ORPHAN = 'manual-orphan.png'

    function ui(over: Partial<ManualCleanUpUi> = {}): ManualCleanUpUi & { progress: ReturnType<typeof vi.fn>, confirm: ReturnType<typeof vi.fn<(plan: ManualCleanUpPlan) => Promise<boolean>>> } {
        return { progress: vi.fn(), confirm: vi.fn(async () => true), ...over } as ManualCleanUpUi & { progress: ReturnType<typeof vi.fn>, confirm: ReturnType<typeof vi.fn<(plan: ManualCleanUpPlan) => Promise<boolean>>> }
    }

    /** An indexeddb page over the seeded tree and a page store holding one asset nothing refers to, with a stored-size member. */
    async function manualPage() {
        const page = await openSession('ready')
        const store = createMemoryByteStore()
        store.files.set(`assets/${MANUAL_ORPHAN}`, new Uint8Array([1, 2, 3]))
        store.readValue = async key => store.files.get(key) ?? null
        return { page, store, seams: { session: () => page.session, store: async () => store, sweepFacts: ACTIVE_SWEEP } }
    }

    test('E1: the confirm receives the plan; Yes deletes the orphan with no record, No deletes nothing and never starts the delete step', async () => {
        const { store, seams } = await manualPage()
        const info = vi.spyOn(console, 'info').mockImplementation(() => {})
        const declining = ui({ confirm: vi.fn(async () => false) })

        expect(await runManualCleanUp(declining, seams)).toEqual({ status: 'declined' })
        expect(declining.confirm).toHaveBeenCalledWith({ kind: 'indexeddb', deletable: 1, later: 0, bytes: 3 })
        expect(store.files.has(`assets/${MANUAL_ORPHAN}`)).toBe(true)
        expect(sweepLines(info)).toEqual([expect.stringMatching(/^store2 asset sweep: status=planned /)])
        expect(declining.progress.mock.calls.map(call => call[0])).toEqual(['measuring'])

        const accepting = ui()
        const outcome = await runManualCleanUp(accepting, seams)

        expect(outcome).toMatchObject({ status: 'ended', approved: 1, result: { status: 'done', deleted: 1, recorded: false } })
        expect(store.files.has(`assets/${MANUAL_ORPHAN}`)).toBe(false)
        expect(store.writes).toEqual([])
        expect(accepting.progress.mock.calls.map(call => call[0])).toEqual(['measuring', 'deleting'])
    })

    test('E1: Cancel during measuring gives cancelled(0) and deletes nothing', async () => {
        const { store, seams } = await manualPage()
        vi.spyOn(console, 'info').mockImplementation(() => {})
        const cancelling = ui({ progress: vi.fn((_step, cancel: () => void) => cancel()) })

        expect(await runManualCleanUp(cancelling, seams)).toEqual({ status: 'cancelled', deleted: 0 })
        expect(cancelling.confirm).not.toHaveBeenCalled()
        expect(store.files.has(`assets/${MANUAL_ORPHAN}`)).toBe(true)
    })

    test('P1: while the automatic step is pending the manual run answers busy and lists nothing', async () => {
        const { store, seams } = await manualPage()
        const page = await openSession('ready')
        const held = deferred<OldDataDeletionResult>()
        const trigger = fakeTrigger()
        startStore2Maintenance(noStore, { session: () => page.session, startTrigger: trigger.start, deletion: vi.fn(async () => held.promise), gcPageFacts: CLEAN })
        trigger.fire()
        await vi.waitFor(() => expect(getStartupCleanup()).not.toBeNull())
        store.lists.length = 0
        const asking = ui()

        expect(await runManualCleanUp(asking, seams)).toEqual({ status: 'busy' })

        expect(store.lists).toEqual([])
        expect(asking.progress).not.toHaveBeenCalled()
        held.resolve(COMPLETED)
        await getStartupCleanup()
    })

    test('P2: a trigger that fires while the manual run awaits its confirm starts its step once the run ends, and not before', async () => {
        const { seams } = await manualPage()
        const page = await openSession('ready')
        vi.spyOn(console, 'info').mockImplementation(() => {})
        const answer = deferred<boolean>()
        const deletion = vi.fn(async () => COMPLETED)
        const trigger = fakeTrigger()
        startStore2Maintenance(noStore, { session: () => page.session, startTrigger: trigger.start, deletion, gcPageFacts: CLEAN })
        const running = runManualCleanUp(ui({ confirm: () => answer.promise }), seams)
        await vi.waitFor(() => expect(trigger.counts.started).toBe(1))

        trigger.fire()
        await new Promise(resolve => setTimeout(resolve, 10))
        expect(deletion).not.toHaveBeenCalled()

        answer.resolve(true)
        await running
        await vi.waitFor(() => expect(deletion).toHaveBeenCalledTimes(1))
        await getStartupCleanup()
        expect(deletion).toHaveBeenCalledTimes(1)
    })

    test('P3: a session whose boot installed the profile (row 1) answers unavailable and reads nothing', async () => {
        const page = await openSession('empty')
        expect(bootDidNotInstall(page.session)).toBe(false)
        const asking = ui()
        const storeSeam = vi.fn(async () => createMemoryByteStore())

        const outcome = await runManualCleanUp(asking, { session: () => page.session, store: storeSeam, sweepFacts: ACTIVE_SWEEP })

        expect(outcome).toEqual({ status: 'unavailable' })
        expect(storeSeam).not.toHaveBeenCalled()
        expect(asking.progress).not.toHaveBeenCalled()
    })

    test('P4: a confirm that rejects still clears the exclusion, so the next run reaches its confirm', async () => {
        const { seams } = await manualPage()
        vi.spyOn(console, 'info').mockImplementation(() => {})
        const failure = new Error('The confirm failed.')

        await expect(runManualCleanUp(ui({ confirm: async () => { throw failure } }), seams)).rejects.toBe(failure)

        const next = ui({ confirm: vi.fn(async () => false) })
        expect(await runManualCleanUp(next, seams)).toEqual({ status: 'declined' })
        expect(next.confirm).toHaveBeenCalledTimes(1)
    })

    test('P4: a step deferred during a manual run that then throws is started by the end of that run', async () => {
        const { seams } = await manualPage()
        const page = await openSession('ready')
        vi.spyOn(console, 'info').mockImplementation(() => {})
        const answer = deferred<boolean>()
        const deletion = vi.fn(async () => COMPLETED)
        const trigger = fakeTrigger()
        startStore2Maintenance(noStore, { session: () => page.session, startTrigger: trigger.start, deletion, gcPageFacts: CLEAN })
        const running = runManualCleanUp(ui({ confirm: () => answer.promise }), seams)
        await vi.waitFor(() => expect(trigger.counts.started).toBe(1))
        trigger.fire()

        answer.reject(new Error('The confirm failed.'))
        await expect(running).rejects.toThrow('The confirm failed.')

        await vi.waitFor(() => expect(deletion).toHaveBeenCalledTimes(1))
        await getStartupCleanup()
    })

    test('G15: the planned sweep line carries counts and no asset name', () => {
        const line = formatSweepResult({ status: 'planned', phase: 'swept', candidates: 3, deletable: ['secret-name.png'], later: 2 })

        expect(line).toBe('store2 asset sweep: status=planned phase=swept candidates=3 deletable=1 later=2')
        expect(line).not.toContain('secret-name')
    })
})
