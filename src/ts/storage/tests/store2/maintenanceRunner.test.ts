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
import { firstCommitKey } from 'src/ts/storage/store2/commitKey'
import {
    encodeUnit, newUnitKey, UNIT_TYPE, type DeletionSnapshot, type SnapshotPointer,
} from 'src/ts/storage/store2/format'
import { bootDidNotInstall, resetMaintenanceForTests, startStore2Maintenance, type MaintenanceEnv } from 'src/ts/storage/store2/maintenance'
import { NODE_BATCH_PACE_MS, type OldDataDeletionResult } from 'src/ts/storage/store2/oldData/delete'
import { Store2Session } from 'src/ts/storage/store2/session'
import { createClock, parsedCommit, peerWrite, seedStore, testEnv } from './commitFixtures'

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
        startStore2Maintenance(noStore, { session: () => session, startTrigger: trigger.start, deletion })
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
