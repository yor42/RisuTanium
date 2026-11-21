/**
 * The inlay sweep through the maintenance step on the live path: the runner loads the page's own modules for the pass's
 * facts (the stop rule, the save-mark count, the written set, the id lock, the resident walk of the application's database
 * and the legacy store listing) and hands them to the pass. As in `sweepRunFullChain.test.ts`, the heavy modules with
 * page-level state (`globalApi.svelte`, the save loop) are doubles whose answers each case sets, and `navigator.locks` is a
 * stub with the real snapshot shape; the sole-tab proof, `busyActions`, the inlay store, the resident walk and the
 * database module are the real ones. The legacy LocalForage `inlay` store is a double with the real surface
 * (`keys`, `getItem`, `setItem`, `removeItem`, `clear`) over a map, and every write to it is counted.
 *
 * Inlays are written through the real `writeAppInlay` into a memory byte store, and the closure is the seeded tree of a
 * real `tauri` session (an inlay list with no ids). A mocked store says nothing about a native one.
 *
 * RR3 is a reproducer: before the wiring nothing deletes store2 inlays, so O's metadata is still stored. T23 is a guard
 * (new rule) killed by the mutant that wires the legacy listing as empty.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// The first case loads the real application modules cold; under a loaded full run that alone can pass the default.
vi.setConfig({ testTimeout: 60_000 })

const page = vi.hoisted(() => ({
    saveClean: true,
    saveLoopParked: false,
    ownPresence: true,
    holders: 1,
    /** The save-mark count getSaveMarkCount answers. */
    marks: 0,
}))

const legacy = vi.hoisted(() => {
    const map = new Map<string, unknown>()
    return {
        map,
        getItem: vi.fn(async (key: string) => map.get(key) ?? null),
        setItem: vi.fn(async (key: string, value: unknown) => { map.set(key, value); return value }),
        removeItem: vi.fn(async (key: string) => { map.delete(key) }),
        keys: vi.fn(async (): Promise<string[]> => [...map.keys()]),
        clear: vi.fn(async () => { map.clear() }),
    }
})

vi.mock('localforage', () => ({ default: { createInstance: () => legacy } }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))

// The runner's default trigger drags in the whole save loop; every case here passes its own.
vi.mock(import('src/ts/process/memory/putBackQuiet'), () => ({
    startQuietTrigger: () => { throw new Error('The real quiet trigger is not used in this test.') },
}) as unknown as typeof import('src/ts/process/memory/putBackQuiet'))
vi.mock(import('src/ts/globalApi.svelte'), async importOriginal => ({
    ...await importOriginal(),
    // The asset sweep that runs before the inlay sweep reads the resident references and the written assets.
    getUncleanablesSync: () => [],
    listAssetsWrittenThisPage: () => [],
    assetsWrittenThisPageCount: () => 0,
    releaseAssetObjectUrl: () => { },
    isSaveClean: () => page.saveClean,
    getSaveMarkCount: () => page.marks,
    holdsOwnTabPresence: () => page.ownPresence,
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
import { inlayMetaKey } from 'src/ts/process/files/inlayKeys'
import { beginBusy } from 'src/ts/process/memory/busyActions'
import { beginRestoreRun } from 'src/ts/drive/restoreInProgress'
import * as inlayStore from 'src/ts/process/files/inlayStore'
import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { getStartupCleanup, resetStartupCleanupForTests } from 'src/ts/storage/startupCleanupState'
import { createMemoryBackend } from 'src/ts/storage/store2/backend'
import { resetMaintenanceForTests, startStore2Maintenance } from 'src/ts/storage/store2/maintenance'
import type { OldDataDeletionResult } from 'src/ts/storage/store2/oldData/delete'
import { Store2Session } from 'src/ts/storage/store2/session'
import type { Database } from 'src/ts/storage/database.svelte'
import { createClock, seedTree, testEnv } from 'src/ts/storage/tests/store2SaveKit'
import { STORAGE_TAB_LOCK_NAME } from 'src/ts/storage/storageTabLocks'
import { flushConfirming } from './flushConfirmBackend'

const COMPLETED: OldDataDeletionResult = { status: 'completed', deleted: 0, abandoned: 0, flushed: undefined }
const O = '0a1b2c3d-1111-4222-8333-000000000003'

/** The value of an inlay as the application stores one; the writer's parameter type names `data` only. */
function inlayValue(data: string) {
    return { name: 'n', ext: 'txt', type: 'image', data }
}

/** The written set exists only once the inlay store has one; a tree without it has nothing to clear. */
function clearWrittenSet(): void {
    if (typeof inlayStore.resetInlaysWrittenForTests === 'function') {
        inlayStore.resetInlaysWrittenForTests()
    }
}

beforeEach(() => {
    page.saveClean = true
    page.saveLoopParked = false
    page.ownPresence = true
    page.holders = 1
    page.marks = 0
    legacy.map.clear()
    for (const fn of [legacy.getItem, legacy.setItem, legacy.removeItem, legacy.keys, legacy.clear]) {
        fn.mockClear()
    }
    resetPageStorageModeForTests()
    resetStartupCleanupForTests()
    resetMaintenanceForTests()
    clearWrittenSet()
    setPageStorageMode({ kind: 'store2' })
    // The lock query shows the real snapshot shape; the request never grants, so no other presence claim is made.
    Object.defineProperty(globalThis.navigator, 'locks', {
        configurable: true,
        get: () => ({
            query: async () => ({
                held: Array.from({ length: page.holders }, () => ({ name: STORAGE_TAB_LOCK_NAME, mode: 'shared' })),
                pending: [],
            }),
            request: () => new Promise(() => { }),
        }),
    })
})

afterEach(() => {
    delete (globalThis.navigator as unknown as Record<string, unknown>).locks
    vi.restoreAllMocks()
    resetPageStorageModeForTests()
    resetStartupCleanupForTests()
    resetMaintenanceForTests()
})

/** A `tauri` session over the seeded tree; the backend confirms its flushes, so the session is not idle. */
async function openTauriSession(): Promise<Store2Session> {
    const backend = createMemoryBackend()
    const db = {
        formatversion: 5, botPresetsId: 0, botPresets: [{ name: 'test-preset' }], modules: [], loadouts: [], plugins: [],
        pluginCustomStorage: {}, mainPrompt: 'chain', characters: [],
    }
    await seedTree(backend, db as unknown as Database, testEnv(createClock(), 3))
    const session = await Store2Session.open(createMemoryByteStore(), { kind: 'tauri', backend: flushConfirming(backend).backend, upstreamMainFile: async () => false })
    expect(session.idleReason, 'a flush-confirming tauri session is not idle').toBeNull()
    return session
}

/** A page store holding O, written by the real writer and then forgotten by the page's written set. */
async function storeWithO(keepWritten = false): Promise<{ store: MemoryByteStore, body: string }> {
    const store = createMemoryByteStore()
    await inlayStore.writeAppInlay(store, O, inlayValue('payload'))
    if (!keepWritten) {
        clearWrittenSet()
    }
    const record = await inlayStore.readAppInlayRecord(store, O)
    return { store, body: (record as { body: string }).body }
}

/** Runs the step once with the live facts and returns the inlay sweep's log lines and whether the step logged an error. */
async function runStep(store: MemoryByteStore): Promise<{ lines: string[], errors: unknown[][] }> {
    const session = await openTauriSession()
    const info = vi.spyOn(console, 'info').mockImplementation(() => { })
    const error = vi.spyOn(console, 'error').mockImplementation(() => { })
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
    return {
        lines: info.mock.calls.map(call => String(call[0])).filter(line => line.startsWith('store2 inlay sweep')),
        errors: error.mock.calls,
    }
}

describe('the live facts of the inlay sweep', () => {
    test('reproducer RR3: with the live facts and an empty legacy store the step deletes the unreferenced inlay and its body, and logs no error', async () => {
        const { store, body } = await storeWithO()

        const { lines, errors } = await runStep(store)

        expect(await store.has(inlayMetaKey(O)!)).toBe(false)
        expect(store.files.has(body)).toBe(false)
        expect(errors, 'no step failure is logged').toEqual([])
        expect(lines).toEqual(['store2 inlay sweep: status=done candidates=1 deleted=1 bodies=1 failed=0 kept-live=0 kept-legacy=0 batches=1'])
        expect(legacy.keys).toHaveBeenCalledTimes(1)
    })

    test('guard T23: an id the legacy store still lists is kept, the legacy store is only listed, and no error is logged', async () => {
        const { store, body } = await storeWithO()
        legacy.map.set(O, 'a legacy entry')

        const { lines, errors } = await runStep(store)

        expect(await store.has(inlayMetaKey(O)!)).toBe(true)
        expect(store.files.has(body)).toBe(true)
        expect(lines).toEqual(['store2 inlay sweep: status=done candidates=0 deleted=0 bodies=0 failed=0 kept-live=0 kept-legacy=1 batches=0'])
        expect(errors, 'no step failure is logged').toEqual([])
        expect(legacy.keys, 'one listing per round').toHaveBeenCalledTimes(1)
        expect(legacy.setItem).not.toHaveBeenCalled()
        expect(legacy.removeItem).not.toHaveBeenCalled()
        expect(legacy.clear).not.toHaveBeenCalled()
        expect(legacy.map.has(O), 'the legacy entry is untouched').toBe(true)
    })

    // Each starter returns what ends its condition; the page-state doubles are reset before every case.
    test.each<[string, () => (() => void) | void]>([
        ['a data action is registered', () => { const handle = beginBusy('cleanup'); return () => handle.end() }],
        ['a restore run is open', () => { const run = beginRestoreRun(); return () => run.end('nothing-replaced') }],
        ['the save has not committed', () => { page.saveClean = false }],
        ['the save loop is parked', () => { page.saveLoopParked = true }],
    ])('guard: the live stop rule ends the pass before its first delete while %s', async (_name, start) => {
        const { store, body } = await storeWithO()
        const end = start()

        const { lines } = await runStep(store)
        if (end) {
            end()
        }

        expect(lines).toEqual(['store2 inlay sweep: status=done candidates=0 deleted=0 bodies=0 failed=0 kept-live=0 kept-legacy=0 batches=0 stopped=yielded'])
        expect(await store.has(inlayMetaKey(O)!)).toBe(true)
        expect(store.files.has(body)).toBe(true)
    })

    test('guard: an inlay this page wrote is kept by the live written set', async () => {
        const { store, body } = await storeWithO(true)

        const { lines } = await runStep(store)

        expect(lines).toEqual(['store2 inlay sweep: status=done candidates=1 deleted=0 bodies=0 failed=0 kept-live=1 kept-legacy=0 batches=1'])
        expect(await store.has(inlayMetaKey(O)!)).toBe(true)
        expect(store.files.has(body)).toBe(true)
    })

    test('guard: a save mark that lands after the pass took its snapshot ends the pass before the delete', async () => {
        const { store, body } = await storeWithO()
        // The legacy listing is read after the snapshot and before the resident walk.
        legacy.keys.mockImplementationOnce(async () => { page.marks++; return [] })

        const { lines } = await runStep(store)

        expect(lines).toEqual(['store2 inlay sweep: status=done candidates=1 deleted=0 bodies=0 failed=0 kept-live=0 kept-legacy=0 batches=1 stopped=changed'])
        expect(await store.has(inlayMetaKey(O)!)).toBe(true)
        expect(store.files.has(body)).toBe(true)
    })

    test('guard: the pass takes the inlay id lock, so a writer holding it is waited for and its write is then seen as this page\'s own', async () => {
        const { store } = await storeWithO()
        let release: () => void = () => { }
        const gate = new Promise<void>(resolve => { release = resolve })
        const writer = inlayStore.withInlayLock(O, async () => {
            await gate
            await inlayStore.writeAppInlay(store, O, inlayValue('rewritten'))
        })

        const running = runStep(store)
        await vi.waitFor(() => expect(legacy.keys).toHaveBeenCalled())
        await new Promise(resolve => setTimeout(resolve, 20))
        expect(await store.has(inlayMetaKey(O)!), 'the pass waits for the lock').toBe(true)
        release()
        await writer
        const { lines } = await running

        expect(lines).toEqual(['store2 inlay sweep: status=done candidates=1 deleted=0 bodies=0 failed=0 kept-live=1 kept-legacy=0 batches=1'])
        expect(await store.has(inlayMetaKey(O)!)).toBe(true)
    })

    test('guard: a tauri page never asks for the sole-tab proof: other tabs open do not stop its pass', async () => {
        const { store, body } = await storeWithO()
        page.holders = 2

        const { lines } = await runStep(store)

        expect(lines).toEqual(['store2 inlay sweep: status=done candidates=1 deleted=1 bodies=1 failed=0 kept-live=0 kept-legacy=0 batches=1'])
        expect(store.files.has(body)).toBe(false)
    })
})
