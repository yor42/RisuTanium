/**
 * The legacy deleters are unreachable on a store2 page. A world with page mode `store2` and a registered residency
 * sits over a recording byte store holding 22 numbered backups, cold-storage units and assets; every legacy entry that
 * could be reached there is called, and the store records no delete, no removeItem is made and no inlay is removed.
 * The same calls on a block page (the control) do delete or reach past the refusal, so the guard is not vacuous.
 *
 * Labels: regression reproducers are the cases red on the base commit. The 22-backup case, the read-only case and the
 * `unset` case are reproducers through a deletion (the base prunes two backups on each). The inlay case and the whole
 * sweep are reproducers through a deletion as well (the whole sweep also contains the 22-backup prune). The manual
 * clean-up and `cleanColdStorage` cases, on the store2 and on the `unset` page, are reproducers of the accidental
 * path only: on the base they are red because the clean-up alerts or the call is made, not because anything is
 * deleted (the memory store records no `has`, and no load-time listing is seeded). The store2 entries that were
 * already refused (`deleteColdStorageUnits`, the restore replace) and the control cases are compatibility guards
 * that pass before and after; the startup clean-up and load-time listing decisions are guards (the decisions are new
 * functions). One mutant per disabled row forces the predicate true at that one site; a site that refuses only
 * `store2` is killed by the `unset` cases.
 *
 * A memory byte store and mocked inlay removal say nothing about a native store.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import type { Residency } from 'src/ts/storage/store2/residency'

const h = vi.hoisted(() => ({
    db: undefined as undefined | Record<string, unknown>,
    keyPair: null as CryptoKeyPair | null,
    removeInlay: vi.fn(async (_id: string): Promise<void> => { }),
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => h.db),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(-1),
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

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 1))),
    sleepForever: vi.fn(() => new Promise<void>(() => { })),
    asBuffer: (value: Uint8Array) => value,
    base64url: (source: Uint8Array | ArrayBuffer) => Buffer.from(source as Uint8Array).toString('base64url'),
    getKeypairStore: vi.fn(async () => {
        h.keyPair ??= await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
        return h.keyPair
    }),
    saveKeypairStore: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: vi.fn(async () => undefined),
}))
vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn(async () => { }) }))
vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: { getWriter: () => ({ write: async () => { }, close: async () => { } }) },
        }),
    },
}))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })),
}))
vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0 },
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => { }),
    readFile: vi.fn(async () => { throw new Error('no file system on the web') }),
    writeFile: vi.fn(async () => { }),
    readDir: vi.fn(async () => []),
    remove: vi.fn(async () => { }),
}))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn(async () => new Response(null, { status: 404 })) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'linux' }))

vi.mock(import('src/ts/update'), () => ({ checkRisuUpdate: vi.fn(async () => { }) }))
vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({ loadPlugins: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/plugins/plugins.svelte'))
vi.mock(import('src/ts/parser/parser.svelte'), () => ({ hasher: vi.fn((s: string) => s) }) as unknown as typeof import('src/ts/parser/parser.svelte'))
vi.mock(import('src/ts/characterCards'), () => ({ characterURLImport: vi.fn(), hubURL: 'https://example.invalid' }) as unknown as typeof import('src/ts/characterCards'))
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({ registerDbChangeEffects: vi.fn() }) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))
vi.mock(import('src/ts/gui/animation'), () => ({ updateAnimationSpeed: vi.fn() }) as unknown as typeof import('src/ts/gui/animation'))
vi.mock(import('src/ts/gui/colorscheme'), () => ({ updateColorScheme: vi.fn(), updateTextThemeAndCSS: vi.fn() }) as unknown as typeof import('src/ts/gui/colorscheme'))
vi.mock(import('src/ts/observer.svelte'), () => ({ startObserveDom: vi.fn() }) as unknown as typeof import('src/ts/observer.svelte'))
vi.mock(import('src/ts/gui/guisize'), () => ({ updateGuisize: vi.fn() }) as unknown as typeof import('src/ts/gui/guisize'))
vi.mock(import('src/ts/characters'), () => ({ updateLorebooks: vi.fn((v: unknown) => v) }) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/hotkey'), () => ({ initMobileGesture: vi.fn() }) as unknown as typeof import('src/ts/hotkey'))
vi.mock(import('src/ts/process/modules'), () => ({ moduleUpdate: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/process/modules'))
vi.mock(import('src/ts/process/index.svelte'), () => ({ doingChat: writable(false) }) as unknown as typeof import('src/ts/process/index.svelte'))

// The save loop reports a clean state so the inlay batch runs; the rest of the module is the real one.
vi.mock(import('src/ts/globalApi.svelte'), async (importOriginal) => ({
    ...await importOriginal(),
    afterNextSaveCommit: vi.fn(),
    getSaveMarkCount: vi.fn(() => 0),
    isSaveClean: vi.fn(() => true),
    locksSupported: true,
}))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    removeInlayAsset: h.removeInlay,
}) as unknown as typeof import('src/ts/process/files/inlays'))

// `runManualCleanup` is observed through a pass-through so that `cleanColdStorage` can be told apart from its callee.
vi.mock(import('src/ts/storage/manualCleanup'), async (importOriginal) => {
    const original = await importOriginal()
    return { ...original, runManualCleanup: vi.fn(original.runManualCleanup) }
})

import { forageStorage, getDbBackups } from 'src/ts/globalApi.svelte'
import { cleanColdStorage, deleteColdStorageUnits } from 'src/ts/process/coldstorage.svelte'
import { runManualCleanup } from 'src/ts/storage/manualCleanup'
import { queueInlayCleanupForCharacters, getInlayCleanupState, resetInlayCleanupRefusalForTests } from 'src/ts/process/files/inlayCleanup'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { disablePageBlockOwner, resetPageBlockOwnerForTests } from 'src/ts/storage/pageBlockOwner'
import { replaceWithRestoredSet } from 'src/ts/drive/restoreReplace'
import { recordsLoadTimeListing, resetPageStorageModeForTests, setPageStorageMode, startsLegacyStartupCleanup, type PageStorageMode } from 'src/ts/storage/pageStorageMode'
import { registerResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { getLoadTimeListing, recordLoadTimeListing, resetLoadTimeListingForTests } from 'src/ts/storage/loadTimeListing'
import { STORAGE_TAB_LOCK_NAME } from 'src/ts/storage/storageTabLocks'
import { alertError } from 'src/ts/alert'
import { language } from 'src/lang'

const BACKUP_PREFIX = 'database/dbbackup-'
const UNIT = '3f2b8c1e-5a47-4d9e-8b61-0c7a9d2e4f10'
const INLAY = 'aaaaaaaa-0000-4000-8000-0000000000a1'

let store: MemoryByteStore
let removeItem: ReturnType<typeof vi.spyOn>

/** The world: 22 numbered backups, one cold unit, one asset, over a recording store. */
function seedWorld(): void {
    store = createMemoryByteStore()
    for (let n = 1; n <= 22; n++) {
        store.files.set(`${BACKUP_PREFIX}${1000 + n}.bin`, Uint8Array.from([n]))
    }
    store.files.set(`coldstorage/${UNIT}`, Uint8Array.from([1]))
    store.files.set('assets/a.png', Uint8Array.from([2]))
    injectAppStore(store, 'indexeddb')
}

function enterStore2Page(): void {
    setPageStorageMode({ kind: 'store2' })
    registerResidency({} as unknown as Residency)
}

function enterPage(mode: PageStorageMode): void {
    setPageStorageMode(mode)
}

async function inlayCleanup(): Promise<void> {
    const infoBefore = infoLogs
    queueInlayCleanupForCharacters([{ chats: [{ message: [{ data: `{{inlayed::${INLAY}}}` }] }] } as never])
    await vi.waitFor(() => { expect(infoLogs).toBeGreaterThan(infoBefore) }, { timeout: 8000, interval: 20 })
    expect(getInlayCleanupState()).toEqual({ pending: 0, running: false })
}

let infoLogs = 0

beforeEach(() => {
    seedWorld()
    resetResidencyForTest()
    resetPageStorageModeForTests()
    resetPageBlockOwnerForTests()
    resetLoadTimeListingForTests()
    resetInlayCleanupRefusalForTests()
    h.db = { characters: [] }
    infoLogs = 0
    h.removeInlay.mockClear()
    vi.mocked(runManualCleanup).mockClear()
    vi.mocked(alertError).mockClear()
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
        if (args[0] === 'inlay cleanup') {
            infoLogs++
        }
    })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    removeItem = vi.spyOn(forageStorage, 'removeItem').mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: { query: async () => ({ held: [{ name: STORAGE_TAB_LOCK_NAME, mode: 'shared', clientId: 'this' }], pending: [] }) },
    })
})

afterEach(() => {
    injectAppStore(null)
    resetPageBlockOwnerForTests()
    resetResidencyForTest()
    resetPageStorageModeForTests()
    vi.restoreAllMocks()
})

describe('on a store2 page no legacy deleter deletes', () => {
    test('reproducer: getDbBackups lists all 22 numbered backups and prunes none', async () => {
        enterStore2Page()

        const times = await getDbBackups()

        expect(times).toHaveLength(22)
        expect(store.deletes).toEqual([])
    })

    test.each<[string, PageStorageMode]>([
        ['read-only', { kind: 'read-only', reason: 'opfs-transitional' }],
        ['unset', { kind: 'unset' }],
    ])('reproducer: getDbBackups on a %s page lists the backups and prunes none', async (_label, mode) => {
        enterPage(mode)

        expect(await getDbBackups()).toHaveLength(22)
        expect(store.deletes).toEqual([])
    })

    test('reproducer (alert path only): the manual clean-up returns before any store read, with no refusal alert and no delete', async () => {
        enterStore2Page()

        await runManualCleanup()

        expect(store.reads).toEqual([])
        expect(store.lists).toEqual([])
        expect(store.deletes).toEqual([])
        expect(alertError).not.toHaveBeenCalled()
    })

    test('reproducer (call path only): cleanColdStorage returns without calling the manual clean-up and without a store read', async () => {
        enterStore2Page()

        await cleanColdStorage()

        expect(runManualCleanup).not.toHaveBeenCalled()
        expect(store.reads).toEqual([])
        expect(store.lists).toEqual([])
        expect(store.deletes).toEqual([])
    })

    test('reproducer (alert path only): the manual clean-up on an unset page returns before any store read, alert or delete', async () => {
        enterPage({ kind: 'unset' })

        await runManualCleanup()

        expect(store.reads).toEqual([])
        expect(store.lists).toEqual([])
        expect(store.deletes).toEqual([])
        expect(alertError).not.toHaveBeenCalled()
    })

    test('reproducer (call path only): cleanColdStorage on an unset page does not call the manual clean-up and reads no store', async () => {
        enterPage({ kind: 'unset' })

        await cleanColdStorage()

        expect(runManualCleanup).not.toHaveBeenCalled()
        expect(store.reads).toEqual([])
        expect(store.lists).toEqual([])
        expect(store.deletes).toEqual([])
    })

    test('guard: deleteColdStorageUnits reports every key as not deleted and deletes nothing', async () => {
        enterStore2Page()

        const failed = await deleteColdStorageUnits([UNIT])

        expect(failed.map((entry) => entry.key)).toEqual([UNIT])
        expect(store.deletes).toEqual([])
    })

    test('guard: the main-file rename finish is unreachable: the restore replace has no block owner and touches no key', async () => {
        // The store2 boot disables the block owner before it registers the residency.
        disablePageBlockOwner()
        enterStore2Page()
        store.files.set('database/database.bin', Uint8Array.from([9]))
        const writesBefore = store.writes.length

        await expect(replaceWithRestoredSet({} as unknown as Parameters<typeof replaceWithRestoredSet>[0], () => false)).rejects.toThrow('no block store')

        expect(store.deletes).toEqual([])
        expect(store.writes).toHaveLength(writesBefore)
        expect(store.files.has('database/database.bin')).toBe(true)
    })

    test('guard: the startup clean-up does not start and the load-time listing is not recorded', async () => {
        enterStore2Page()

        expect(startsLegacyStartupCleanup()).toBe(false)
        expect(recordsLoadTimeListing()).toBe(false)
        expect(getLoadTimeListing()).toBeNull()
        expect(store.lists).toEqual([])
    })

    test('reproducer: the inlay clean-up removes no inlay although nothing shows it', async () => {
        enterStore2Page()

        await inlayCleanup()

        expect(h.removeInlay).not.toHaveBeenCalled()
    })

    test('reproducer: the whole sweep of entries leaves no delete, no removeItem and no inlay removal', async () => {
        enterStore2Page()

        await getDbBackups()
        await runManualCleanup()
        await cleanColdStorage()
        await deleteColdStorageUnits([UNIT])
        await inlayCleanup()

        expect(store.deletes).toEqual([])
        expect(removeItem).not.toHaveBeenCalled()
        expect(h.removeInlay).not.toHaveBeenCalled()
        expect(store.files.size).toBe(22 + 2)
    })
})

describe('control: on a block page the same entries delete or reach past the refusal', () => {
    test('guard: getDbBackups prunes the two oldest backups', async () => {
        enterPage({ kind: 'block' })

        expect(await getDbBackups()).toHaveLength(20)
        expect(store.deletes).toEqual([`${BACKUP_PREFIX}1001.bin`, `${BACKUP_PREFIX}1002.bin`])
    })

    test('guard: deleteColdStorageUnits removes the unit', async () => {
        enterPage({ kind: 'block' })

        expect(await deleteColdStorageUnits([UNIT])).toEqual([])
        expect(store.deletes).toEqual([`coldstorage/${UNIT}`])
    })

    test('guard: the startup clean-up starts and the load-time listing reads the store', async () => {
        enterPage({ kind: 'block' })

        expect(startsLegacyStartupCleanup()).toBe(true)
        expect(recordsLoadTimeListing()).toBe(true)
        await recordLoadTimeListing()
        expect(getLoadTimeListing()?.assets.has('assets/a.png')).toBe(true)
    })

    test('guard: the manual clean-up goes past the page refusal (it stops for the missing listing)', async () => {
        enterPage({ kind: 'block' })

        await runManualCleanup()

        expect(alertError).toHaveBeenCalledWith(language.errors.coldStorageCleanupNoListing)
    })

    test('guard: cleanColdStorage hands on to the manual clean-up', async () => {
        enterPage({ kind: 'legacy', convertedFrom: null })

        await cleanColdStorage()

        expect(runManualCleanup).toHaveBeenCalledTimes(1)
    })

    test('guard: the inlay clean-up removes the unreferenced inlay', async () => {
        enterPage({ kind: 'block' })

        await inlayCleanup()

        expect(h.removeInlay).toHaveBeenCalledWith(INLAY)
    })
})
