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
import { resetPageStorageModeForTests, setPageStorageMode, type PageStorageMode } from 'src/ts/storage/pageStorageMode'
import { getStartupCleanup, resetStartupCleanupForTests } from 'src/ts/storage/startupCleanupState'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { unitDigest } from 'src/ts/storage/store2/codec'
import { ADMISSION_INTERVAL_MS } from 'src/ts/storage/store2/commit'
import { firstCommitKey, RETAINED_MAX } from 'src/ts/storage/store2/commitKey'
import {
    encodeUnit, newUnitKey, UNIT_TYPE, type DeletionSnapshot, type SnapshotPointer,
} from 'src/ts/storage/store2/format'
import { bootDidNotInstall, resetMaintenanceForTests, startStore2Maintenance, type MaintenanceEnv } from 'src/ts/storage/store2/maintenance'
import { NODE_BATCH_PACE_MS, type OldDataDeletionResult } from 'src/ts/storage/store2/oldData/delete'
import { listRestorePoints, restorePoint } from 'src/ts/storage/store2/restorePoints'
import { Store2Session } from 'src/ts/storage/store2/session'
import { readTree } from 'src/ts/storage/store2/tree'
import type { AutoGcFacts } from 'src/ts/storage/store2/gc/autoGc'
import { committerOf, createClock, expectInvariant, parsedCommit, peerWrite, seedStore, testEnv, treeRequest } from './commitFixtures'
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
const CLEAN: AutoGcFacts = { isBusy: () => false, saveLoopParked: () => false, isSaveClean: () => true }

beforeEach(() => {
    resetPageStorageModeForTests()
    resetStartupCleanupForTests()
    resetMaintenanceForTests()
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
        ['legacy', { kind: 'legacy', convertedFrom: null }],
        ['block', { kind: 'block' }],
        ['read-only', { kind: 'read-only', reason: 'opfs-transitional' }],
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
        await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1))
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

function infoLines(info: { mock: { calls: unknown[][] } }): string[] {
    return info.mock.calls.map(call => String(call[0]))
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
        const info = vi.spyOn(console, 'info').mockImplementation(() => { order.push('pass') })
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
        setPageStorageMode({ kind: 'block' })

        trigger.fire()
        await getStartupCleanup()

        expect(deletion).toHaveBeenCalledTimes(1)
        expect(page.over.calls).toEqual([])
        expect(await orphansLeft(page)).toBe(30)
    })

    test.each<Store2Session['kind']>(['indexeddb', 'node'])('guard K: a %s session runs nothing: no listing, no result line, the orphan stays', async kind => {
        const { session, backend } = await openSession('ready')
        const orphan = newUnitKey(env)
        await backend.putUnit(orphan, encodeUnit(UNIT_TYPE.preset, { v: 1, orphan }))
        const listing = vi.spyOn(backend, 'listStore2')
        const info = vi.spyOn(console, 'info').mockImplementation(() => {})
        const asKind = Object.create(session, { kind: { value: kind } }) as Store2Session

        await fireOnce({ session: asKind })

        expect(listing).not.toHaveBeenCalled()
        expect(infoLines(info)).toEqual([])
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
