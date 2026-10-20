// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    db: undefined as undefined | Record<string, unknown>,
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))
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
vi.mock(import('src/ts/process/index.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return { doingChat: writable(false) } as unknown as typeof import('src/ts/process/index.svelte')
})
vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => h.db),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    afterNextSaveCommit: vi.fn(),
    getSaveMarkCount: vi.fn(() => 0),
    isSaveClean: vi.fn(() => true),
    locksSupported: true,
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/process/files/inlays'), () => ({
    removeInlayAsset: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/process/files/inlays'))

import type { Database } from 'src/ts/storage/database.svelte'
import type { Residency } from 'src/ts/storage/store2/residency'
import { queueInlayCleanupForCharacters, getInlayCleanupState, resetInlayCleanupRefusalForTests } from 'src/ts/process/files/inlayCleanup'
import { removeInlayAsset } from 'src/ts/process/files/inlays'
import { registerResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { resetPageStorageModeForTests, setPageStorageMode, type PageStorageMode } from 'src/ts/storage/pageStorageMode'
import { STORAGE_TAB_LOCK_NAME } from 'src/ts/storage/storageTabLocks'

/**
 * The inlay clean-up deletes nothing on a page that is not a legacy or block page: a store2 page (its keep set knows
 * only the legacy data), a read-only page and a page whose mode boot has not decided. A legacy or block page deletes as
 * before. A character removed whole, whose inlay nothing in the profile shows, is the candidate in every case.
 *
 * Labels: the store2, read-only and unset cases are regression reproducers (the base commit deletes the inlay on
 * each); the legacy and block cases are compatibility guards (they pass before and after); the announcement case is a
 * guard for the once-per-page warning, which the base does not have. Memory doubles only: nothing here says what a real
 * inlay store does.
 */

const X = 'aaaaaaaa-0000-4000-8000-0000000000a1'
const W = 'aaaaaaaa-0000-4000-8000-0000000000a2'

let logs: Array<Record<string, unknown>> = []
let warnSpy: ReturnType<typeof vi.spyOn>

function removedCharacter(id: string): never {
    return { chats: [{ message: [{ data: `{{inlayed::${id}}}` }] }] } as never
}

/** Queues the removal and waits for the batch to finish; returns what the batch logged. */
async function runCleanup(id: string): Promise<Record<string, unknown>> {
    const before = logs.length
    queueInlayCleanupForCharacters([removedCharacter(id)])
    await vi.waitFor(() => { expect(logs.length).toBe(before + 1) }, { timeout: 8000, interval: 20 })
    expect(getInlayCleanupState()).toEqual({ pending: 0, running: false })
    return logs[logs.length - 1]
}

const deleted = () => vi.mocked(removeInlayAsset).mock.calls.map(call => call[0])

function resetPage(): void {
    resetResidencyForTest()
    resetPageStorageModeForTests()
    resetInlayCleanupRefusalForTests()
}

beforeEach(() => {
    logs = []
    vi.mocked(removeInlayAsset).mockClear()
    resetPage()
    h.db = { characters: [] } as unknown as Database as unknown as Record<string, unknown>
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
        if (args[0] === 'inlay cleanup') {
            logs.push({ ...(args[1] as Record<string, unknown>) })
        }
    })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { })
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: { query: async () => ({ held: [{ name: STORAGE_TAB_LOCK_NAME, mode: 'shared', clientId: 'this' }], pending: [] }) },
    })
})

afterEach(() => {
    resetPage()
    vi.restoreAllMocks()
})

describe('a page that is not a legacy or block page deletes no inlay', () => {
    test('reproducer: a store2 page (page mode and residency) deletes nothing for an inlay no profile data shows', async () => {
        setPageStorageMode({ kind: 'store2' })
        registerResidency({} as unknown as Residency)

        const log = await runCleanup(X)

        expect(log.candidates).toBe(1)
        expect(deleted()).toEqual([])
        expect(log).toMatchObject({ deleted: 0, skipped: 'inlay deletion is off on this page' })
    })

    test.each<[string, PageStorageMode]>([
        ['legacy', { kind: 'legacy', convertedFrom: null }],
        ['block', { kind: 'block' }],
    ])('reproducer: a registered residency refuses even while the page mode still reads %s', async (_label, mode) => {
        // The store2 boot registers the residency before it moves the page mode.
        setPageStorageMode(mode)
        registerResidency({} as unknown as Residency)

        await runCleanup(X)

        expect(deleted()).toEqual([])
    })

    test.each<[string, PageStorageMode]>([
        ['read-only', { kind: 'read-only', reason: 'opfs-transitional' }],
        ['unset', { kind: 'unset' }],
    ])('reproducer: a %s page with no residency deletes nothing', async (_label, mode) => {
        setPageStorageMode(mode)

        await runCleanup(X)

        expect(deleted()).toEqual([])
    })

    test.each<[string, PageStorageMode]>([
        ['legacy', { kind: 'legacy', convertedFrom: null }],
        ['block', { kind: 'block' }],
    ])('guard: a %s page still deletes the unreferenced inlay', async (_label, mode) => {
        setPageStorageMode(mode)

        const log = await runCleanup(X)

        expect(deleted()).toEqual([X])
        expect(log).toMatchObject({ deleted: 1, skipped: null })
    })

    test('guard: the refusal is announced once per page, not once per batch', async () => {
        setPageStorageMode({ kind: 'store2' })
        registerResidency({} as unknown as Residency)

        await runCleanup(X)
        await runCleanup(W)

        const announcements = warnSpy.mock.calls.filter(call => call[0] === 'Inlay clean-up deletes nothing on this page.')
        expect(announcements).toHaveLength(1)
    })
})
