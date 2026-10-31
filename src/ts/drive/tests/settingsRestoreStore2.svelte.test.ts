/**
 * A card another Android app opens while the store2 restore-point picker is on screen, through the Settings flow
 * `restoreFromInternalBackup` (-> `loadInternalBackup` -> `loadStoreRestorePoint`).
 *
 * Runs over the real, unmocked `saveDb()` store2 loop in a world of its own (`saveLoopWorld.ts`, `store2SaveKit.ts`),
 * against an in-memory store2 backend and a fake Web Locks manager. The reload that ends a landed restore is a double; a
 * mocked reload and a mocked success are not evidence of native behaviour. The device re-check covers the real picker.
 *
 * Labels: regression (red on the base the named change fixes).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import { language } from 'src/lang'
import type { Database } from 'src/ts/storage/database.svelte'
import type { Store2Session } from 'src/ts/storage/store2/session'

vi.setConfig({ testTimeout: 40_000 })

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

const worlds = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

type Entry = Record<string, unknown>

const originalLocks = Object.getOwnPropertyDescriptor(window.navigator, 'locks')

beforeAll(() => {
    class FakeChannel {
        onmessage: ((event: { data: unknown }) => void) | null = null
        constructor(public name: string) { h.channels.push(this) }
        postMessage(data: unknown) { h.broadcasts.push(data) }
        close() {}
    }
    Object.defineProperty(window, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
})

beforeEach(() => {
    vi.clearAllMocks()
    h.broadcasts.length = 0
    h.channels.length = 0
    // The real effects: `saveLoopMocks.svelte.ts` replaces them, and an edit is noticed only by them.
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    // The kit gives each world a fresh module graph with its own copy of Svelte's runtime; the state and the effects
    // must share one runtime, so the factory runs inside the world's graph.
    vi.doMock('src/ts/stores.svelte', async () => {
        const { proxy } = await import('svelte/internal/client')
        const { writable } = await import('svelte/store')
        return {
            DBState: proxy({ db: {} as Entry }),
            selectedCharID: writable(-1),
            selIdState: { selId: -1 },
            alertStore: writable({ type: 'none', msg: '' }),
            MobileGUI: writable(false),
            botMakerMode: writable(false),
            loadedStore: writable(false),
            LoadingStatusState: { text: '' },
            ReloadGUIPointer: writable(0),
            bodyIntercepterStore: writable(null),
            savingStoppedReason: writable(''),
            frozenSaveKeysStore: writable([]),
        } as unknown as typeof import('src/ts/stores.svelte')
    })
    vi.doMock('src/ts/drive/restoreReload', () => ({ reloadAfterRestore: vi.fn(async () => { }) }))
    vi.doMock('src/ts/process/coldstorage.svelte', async () => ({
        getColdStorageItem: vi.fn(),
        getColdStorageBackupKey: (await import('src/ts/process/coldstorageData')).getColdStorageBackupKey,
        readColdStorageItem: async () => ({ status: 'missing' }),
        setColdStorageItem: vi.fn(async () => false),
    }))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(() => {
    worlds.parkAll()
    vi.doMock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }))
    vi.restoreAllMocks()
    delete (window as unknown as { __risuTaniumOpenedFilesHost?: unknown }).__risuTaniumOpenedFilesHost
    delete (window as unknown as { __risuTaniumOpenedFiles?: unknown }).__risuTaniumOpenedFiles
    if (originalLocks) {
        Object.defineProperty(window.navigator, 'locks', originalLocks)
    } else {
        Object.defineProperty(window.navigator, 'locks', { value: undefined, configurable: true })
    }
})

interface Page {
    w: World
    k: Store2Kit
    db: Entry
    flush(): void
    alert: typeof import('src/ts/alert')
    /** What the page put on the alert store, in order. */
    screens: Array<{ type: string, msg: string }>
}

/** The page as the application runs it: a store2 session over a reactive `DBState`, in the `store2` page mode. */
async function openPage(): Promise<Page> {
    const locks = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(locks, 'this'), configurable: true })
    h.db = makeDb('base', ['alpha', 'beta'])
    const k = await startStore2({ db: h.db as unknown as Database })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    const { flushSync } = await import('svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    const bootActive = await import('src/ts/storage/store2/bootActive')
    const page: Page = { w, k, db: h.db, flush: flushSync, alert: await import('src/ts/alert'), screens: [] }
    bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer: k.committer } as unknown as Store2Session)
    w.pageMode.setPageStorageMode({ kind: 'store2' })
    vi.mocked(page.alert.alertConfirm).mockImplementation(async () => true)
    vi.spyOn(page.alert.alertStore, 'set').mockImplementation((data) => { page.screens.push({ type: data.type, msg: data.msg }) })
    w.start()
    await sleepReal(150)
    await settled(w)
    return page
}

describe('CHORE-398 R-C: a card opened on Android while the restore-point picker is open', () => {
    test('R-C: over the picker the card is taken and refused once, never imported; the restore point still lands', async () => {
        const page = await openPage()
        await nextCommit(page.w, () => {
            page.db.mainPrompt = 'second'
            page.flush()
        })
        const imported = vi.fn(async (_batch: unknown): Promise<void> => { })
        vi.doMock('src/ts/characterCards', () => ({
            characterURLImport: vi.fn(),
            hubURL: 'https://example.invalid',
            importOpenedSources: imported,
            isOpenedSourceImportable: (name: string) => /\.(charx|risum|risup)$/i.test(name),
        }))
        page.db.didFirstSetup = true
        let native: unknown[] = []
        ;(window as unknown as { __risuTaniumOpenedFilesHost?: { take: () => string } }).__risuTaniumOpenedFilesHost = {
            take: () => { const payload = JSON.stringify(native); native = []; return payload },
        }
        const opened = await import('src/ts/android/openedFiles')
        opened.androidOpenedFilesImport()
        for (let i = 0; i < 20; i++) { await sleepReal(10) }
        const stores = await import('src/ts/stores.svelte')
        let during = { refusals: -1, imported: -1, queued: -1 }
        vi.mocked(page.alert.alertSelect).mockImplementation(async () => {
            // The restore point's own question is on screen.
            stores.alertStore.set({ type: 'select', msg: 'pick' })
            native = [[{ uri: 'content://p/card1.charx', name: 'card1.charx' }]]
            window.__risuTaniumOpenedFiles?.()
            for (let i = 0; i < 20; i++) { await sleepReal(10) }
            during = {
                refusals: page.screens.filter((screen) => screen.type === 'error' && screen.msg === language.backupLoadWorkInProgress).length,
                imported: imported.mock.calls.length,
                queued: native.length,
            }
            stores.alertStore.set({ type: 'none', msg: '' })
            return '1'
        })
        const { restoreFromInternalBackup } = await import('src/ts/drive/settingsRestore')
        const { reloadAfterRestore } = await import('src/ts/drive/restoreReload')

        await restoreFromInternalBackup()

        // Positive pairing: the restore point did land and request its reload.
        expect(reloadAfterRestore).toHaveBeenCalledTimes(1)
        expect(during, 'what the hook did over the picker').toEqual({ refusals: 1, imported: 0, queued: 0 })
        expect(imported).not.toHaveBeenCalled()
    })
})
