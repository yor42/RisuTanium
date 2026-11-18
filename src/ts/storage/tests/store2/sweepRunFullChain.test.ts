/**
 * The asset sweep through the maintenance step on the live path: the runner loads the page's own modules for its facts
 * (the stop rule, the written set, the resident references, the deletion hold, the object-URL release, the sole-tab proof)
 * and hands them to the pass. The heavy modules with page-level state (`globalApi.svelte`, including this page's own
 * presence claim, and the save loop) are doubles whose answers each case sets, and `navigator.locks` is a stub with the
 * real snapshot shape; the sole-tab proof, `busyActions`, `restoreInProgress` and `assetDeleteHold` are the real ones, so a
 * registered data action or an open restore run is the page's own signal, not a flag of the test.
 *
 * Over a real `indexeddb` session on the seeded memory backend and a page store that holds an orphan a record 25 hours old
 * names. Each case runs the whole step: the live `shouldStop` is true under a busy entry, under a backup load and under an
 * open restore run, and false with none of them. A mocked backend says nothing about a native one.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// The first case loads the real application modules cold; under a loaded full run that alone can pass the default.
vi.setConfig({ testTimeout: 60_000 })

const page = vi.hoisted(() => ({
    saveClean: true,
    saveLoopParked: false,
    written: [] as string[],
    resident: [] as string[],
    /** This page's own presence claim, as `holdsOwnTabPresence` answers it. */
    ownPresence: true,
    /** How many presence-lock holders the lock query shows. */
    holders: 1,
    /** `absent` leaves `navigator.locks` undefined, as plain HTTP does. */
    locks: 'stub' as 'stub' | 'absent',
    released: [] as string[][],
}))

// The runner's default trigger drags in the whole save loop; every case here passes its own.
vi.mock(import('src/ts/process/memory/putBackQuiet'), () => ({
    startQuietTrigger: () => { throw new Error('The real quiet trigger is not used in this test.') },
}) as unknown as typeof import('src/ts/process/memory/putBackQuiet'))
vi.mock(import('src/ts/globalApi.svelte'), async importOriginal => ({
    ...await importOriginal(),
    getUncleanablesSync: () => page.resident,
    listAssetsWrittenThisPage: () => page.written,
    assetsWrittenThisPageCount: () => page.written.length,
    isSaveClean: () => page.saveClean,
    holdsOwnTabPresence: () => page.ownPresence,
    releaseAssetObjectUrl: (keys: Iterable<string>) => { page.released.push([...keys]) },
}))
// The collector reads the application's reactive database, which a case does not populate.
vi.mock('../../../translator/translator', () => ({}))
vi.mock('../../../parser/parser.svelte', () => ({ risuChatParser: vi.fn() }))
vi.mock('../../../process/modules', () => ({ moduleUpdate: vi.fn() }))
vi.mock(import('src/ts/storage/store2/saveLoop'), () => ({
    isSaveLoopParked: () => page.saveLoopParked,
    acknowledgedManifestKey: () => null,
}) as unknown as typeof import('src/ts/storage/store2/saveLoop'))

import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { beginBusy } from 'src/ts/process/memory/busyActions'
import { beginRestoreRun } from 'src/ts/drive/restoreInProgress'
import { isAssetDeletionHeld, resetAssetDeleteHoldForTests } from 'src/ts/storage/assetDeleteHold'
import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { getStartupCleanup, resetStartupCleanupForTests } from 'src/ts/storage/startupCleanupState'
import { createMemoryBackend } from 'src/ts/storage/store2/backend'
import { formatSweepResult, resetMaintenanceForTests, startStore2Maintenance } from 'src/ts/storage/store2/maintenance'
import type { OldDataDeletionResult } from 'src/ts/storage/store2/oldData/delete'
import { Store2Session } from 'src/ts/storage/store2/session'
import { writeSweepRecord } from 'src/ts/storage/store2/sweep'
import type { Database } from 'src/ts/storage/database.svelte'
import { createClock, seedTree, testEnv } from 'src/ts/storage/tests/store2SaveKit'
import { STORAGE_TAB_LOCK_NAME } from 'src/ts/storage/storageTabLocks'

const HOUR = 60 * 60 * 1000
const ORPHAN = 'orphan-chain.png'
const COMPLETED: OldDataDeletionResult = { status: 'completed', deleted: 0, abandoned: 0, flushed: undefined }

beforeEach(() => {
    page.saveClean = true
    page.saveLoopParked = false
    page.written = []
    page.resident = []
    page.ownPresence = true
    page.holders = 1
    page.locks = 'stub'
    page.released = []
    resetPageStorageModeForTests()
    resetStartupCleanupForTests()
    resetMaintenanceForTests()
    resetAssetDeleteHoldForTests()
    setPageStorageMode({ kind: 'store2' })
    // The lock query shows the real snapshot shape; the request never grants, so no other presence claim is made.
    Object.defineProperty(globalThis.navigator, 'locks', {
        configurable: true,
        get: () => page.locks === 'absent' ? undefined : {
            query: async () => ({
                held: Array.from({ length: page.holders }, () => ({ name: STORAGE_TAB_LOCK_NAME, mode: 'shared' })),
                pending: [],
            }),
            request: () => new Promise(() => { }),
        },
    })
})

afterEach(() => {
    delete (globalThis.navigator as unknown as Record<string, unknown>).locks
    vi.restoreAllMocks()
    resetPageStorageModeForTests()
    resetStartupCleanupForTests()
    resetMaintenanceForTests()
    resetAssetDeleteHoldForTests()
})

async function openIndexedDbSession(): Promise<Store2Session> {
    const backend = createMemoryBackend()
    const db = {
        formatversion: 5, botPresetsId: 0, botPresets: [{ name: 'test-preset' }], modules: [], loadouts: [], plugins: [],
        pluginCustomStorage: {}, mainPrompt: 'chain', characters: [],
    }
    await seedTree(backend, db as unknown as Database, testEnv(createClock(), 3))
    return Store2Session.open(createMemoryByteStore(), { kind: 'indexeddb', backend, upstreamMainFile: async () => false })
}

async function plantedStore(): Promise<MemoryByteStore> {
    const store = createMemoryByteStore()
    store.files.set(`assets/${ORPHAN}`, new Uint8Array([1]))
    await writeSweepRecord(store, { v: 1, at: Date.now() - 25 * HOUR, items: [[ORPHAN, null]] })
    return store
}

/** Runs the step once with the live facts and returns the sweep's log line. */
async function runStep(store: MemoryByteStore): Promise<string> {
    const session = await openIndexedDbSession()
    const info = vi.spyOn(console, 'info').mockImplementation(() => { })
    const error = vi.spyOn(console, 'error').mockImplementation(() => { })
    // A case may run the step twice: the spies are shared, the calls are this run's.
    info.mockClear()
    error.mockClear()
    let fire: (() => void) | null = null
    startStore2Maintenance(
        { store: async () => store, listBackupTimes: async () => [] },
        {
            session: () => session,
            startTrigger: run => { fire = run; return { arm: () => { }, stop: () => { } } },
            deletion: async () => COMPLETED,
        },
    )
    ;(fire as (() => void) | null)?.()
    await vi.waitFor(() => expect(getStartupCleanup()).not.toBeNull())
    await getStartupCleanup()
    const lines = info.mock.calls.map(call => String(call[0])).filter(line => line.startsWith('store2 asset sweep'))
    expect(error.mock.calls, 'no step failure is logged').toEqual([])
    expect(lines).toHaveLength(1)
    return lines[0]
}

describe('the result line', () => {
    test('a refusal that follows deletions of an earlier round shows their tally; a plain refusal shows none', () => {
        expect(formatSweepResult({ status: 'refused', reason: 'staging', deleted: 25, failed: 1 }))
            .toBe('store2 asset sweep: status=refused reason=staging deleted=25 failed=1')
        expect(formatSweepResult({ status: 'refused', reason: 'staging' })).toBe('store2 asset sweep: status=refused reason=staging')
    })
})

describe('the live facts of the asset sweep', () => {
    test('guard: with no data action, no restore and a committed save the step deletes the orphan, under the deletion hold, and releases its URL', async () => {
        const store = await plantedStore()
        const heldDuringDelete: boolean[] = []
        const remove = store.delete.bind(store)
        vi.spyOn(store, 'delete').mockImplementation(async (key, condition) => {
            heldDuringDelete.push(isAssetDeletionHeld())
            return remove(key, condition)
        })

        const line = await runStep(store)

        expect(line).toContain('status=done phase=swept')
        expect(line).toContain('deleted=1')
        expect(store.files.has(`assets/${ORPHAN}`)).toBe(false)
        expect(heldDuringDelete, 'the live hold wraps the delete').toEqual([true])
        expect(page.released).toEqual([[`assets/${ORPHAN}`]])
    })

    // Each starter returns what ends its condition; the page-state doubles are reset before every case.
    test.each<[string, () => (() => void) | void]>([
        ['a data action is registered', () => { const handle = beginBusy('cleanup'); return () => handle.end() }],
        ['a backup load is registered', () => { const handle = beginBusy('backupLoad'); return () => handle.end() }],
        ['a restore run is open', () => { const run = beginRestoreRun(); return () => run.end('nothing-replaced') }],
        ['the save has not committed', () => { page.saveClean = false }],
        ['the save loop is parked', () => { page.saveLoopParked = true }],
    ])('guard D6: the live stop rule ends the pass before its first delete while %s', async (_name, start) => {
        const store = await plantedStore()
        const end = start()

        const line = await runStep(store)
        if (end) {
            end()
        }

        expect(line).toContain('stopped=yielded')
        expect(store.files.has(`assets/${ORPHAN}`), 'nothing was deleted').toBe(true)
        expect(page.released).toEqual([])
    })

    test('guard: an asset this page wrote, and an asset the resident database refers to, are kept by the live facts', async () => {
        const store = await plantedStore()
        page.written = [`assets/${ORPHAN}`]

        // Both enter the keep-set the pass builds, so the orphan is no candidate at all.
        const written = await runStep(store)
        expect(written).toContain('candidates=0')
        expect(store.files.has(`assets/${ORPHAN}`)).toBe(true)

        resetMaintenanceForTests()
        resetStartupCleanupForTests()
        page.written = []
        page.resident = [ORPHAN]
        await writeSweepRecord(store, { v: 1, at: Date.now() - 25 * HOUR, items: [[ORPHAN, null]] })

        const resident = await runStep(store)
        expect(resident).toContain('candidates=0')
        expect(store.files.has(`assets/${ORPHAN}`)).toBe(true)
    })

    test('guard: an asset this page writes after the keep-set was built is kept at its delete (the live written count)', async () => {
        const store = await plantedStore()
        const second = 'orphan-second.png'
        store.files.set(`assets/${second}`, new Uint8Array([2]))
        await writeSweepRecord(store, { v: 1, at: Date.now() - 25 * HOUR, items: [[ORPHAN, null], [second, null]] })
        const remove = store.delete.bind(store)
        let first = true
        vi.spyOn(store, 'delete').mockImplementation(async (key, condition) => {
            if (first) {
                first = false
                // The page notes the other orphan while the first delete is in flight.
                page.written.push(key === `assets/${ORPHAN}` ? `assets/${second}` : `assets/${ORPHAN}`)
            }
            return remove(key, condition)
        })

        const line = await runStep(store)

        expect(line).toContain('deleted=1')
        expect(line).toContain('kept-live=1')
        const present = [ORPHAN, second].filter(name => store.files.has(`assets/${name}`))
        expect(present, 'exactly the asset noted during the first delete survives').toHaveLength(1)
        expect(`assets/${present[0]}`).toBe(page.written[0])
    })

    test('guard: another tab ends a web pass before it lists anything', async () => {
        const store = await plantedStore()
        store.lists.length = 0
        page.holders = 2

        const line = await runStep(store)

        expect(line).toBe('store2 asset sweep: status=refused reason=other-tab')
        expect(store.lists).toEqual([])
        expect(store.files.has(`assets/${ORPHAN}`)).toBe(true)
    })

    test('guard: a page without Web Locks refuses the pass before it lists anything', async () => {
        const store = await plantedStore()
        store.lists.length = 0
        page.locks = 'absent'

        const line = await runStep(store)

        expect(line).toBe('store2 asset sweep: status=refused reason=no-web-locks')
        expect(store.lists).toEqual([])
        expect(store.files.has(`assets/${ORPHAN}`)).toBe(true)
    })

    test('new behaviour: a page whose own presence claim is false refuses even when the snapshot shows one holder', async () => {
        const store = await plantedStore()
        store.lists.length = 0
        page.ownPresence = false
        page.holders = 1

        const line = await runStep(store)

        expect(line).toBe('store2 asset sweep: status=refused reason=other-tab')
        expect(store.lists).toEqual([])
        expect(store.files.has(`assets/${ORPHAN}`)).toBe(true)
    })

    test('new behaviour: a snapshot with no presence holder is not alone, even with the own claim true', async () => {
        const store = await plantedStore()
        store.lists.length = 0
        page.ownPresence = true
        page.holders = 0

        const line = await runStep(store)

        expect(line).toBe('store2 asset sweep: status=refused reason=other-tab')
        expect(store.lists).toEqual([])
        expect(store.files.has(`assets/${ORPHAN}`)).toBe(true)
    })

    test('new behaviour: an own claim that goes false after the first delete stops the pass before the second', async () => {
        const store = await plantedStore()
        const second = 'orphan-second.png'
        store.files.set(`assets/${second}`, new Uint8Array([2]))
        await writeSweepRecord(store, { v: 1, at: Date.now() - 25 * HOUR, items: [[ORPHAN, null], [second, null]] })
        const remove = store.delete.bind(store)
        vi.spyOn(store, 'delete').mockImplementation(async (key, condition) => {
            page.ownPresence = false
            return remove(key, condition)
        })

        const line = await runStep(store)

        expect(line).toContain('deleted=1')
        expect(line).toContain('stopped=other-tab')
        const present = [ORPHAN, second].filter(name => store.files.has(`assets/${name}`))
        expect(present, 'exactly one orphan survives').toHaveLength(1)
    })
})
