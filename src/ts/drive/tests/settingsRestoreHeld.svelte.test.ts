/**
 * A card another Android app opens in the pre-pick moments of a Settings internal-backup restore
 * (`restoreFromInternalBackup`), where no question of the restore is on screen: the store2 save-first wait with a held
 * commit (R-W), the legacy read-only check held open (R-W2), and the store2 restore that another tab refuses (R-N).
 * Per the answered picker question the card stays queued then: it is neither taken, nor refused, nor imported while the
 * restore asks, and the same page imports it once the restore ends live.
 *
 * Runs over the real, unmocked `saveDb()` store2 loop in a world of its own (`saveLoopWorld.ts`, `store2SaveKit.ts`),
 * against an in-memory store2 backend and a fake Web Locks manager; the card host is a fake that empties one queue, and
 * the reload that ends a landed restore is a double. A mocked host and reload are not evidence of a content provider or
 * a WebView; the device re-check covers those.
 *
 * Labels: R-W and R-W2 are regression reproducers (red on the base, where the hook drains in any wait before the pick);
 * R-N is a compatibility guard for the new live-end re-drain (on base the card is imported earlier, so a base failure
 * does not count). Each "not imported" reading is paired with the positive "imported once after the live end".
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { get } from 'svelte/store'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView, makeSimulatedTab } from 'src/ts/storage/tests/fakeWebLocks'
import { language } from 'src/lang'
import type { Committer } from 'src/ts/storage/store2/commit'
import type { Database } from 'src/ts/storage/database.svelte'
import type { Store2Session } from 'src/ts/storage/store2/session'

vi.setConfig({ testTimeout: 40_000 })

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

/** The read-only check waits here when a test sets it: the legacy pre-pick moment. */
const readOnlyBox = vi.hoisted(() => ({ hold: null as Promise<void> | null }))

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
    readOnlyBox.hold = null
    h.broadcasts.length = 0
    h.channels.length = 0
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
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
    vi.doMock('src/ts/storage/readOnlyPage', () => ({
        refuseOnReadOnlyPage: async () => {
            if (readOnlyBox.hold !== null) { await readOnlyBox.hold }
            return false
        },
    }))
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
    busy: typeof import('src/ts/process/memory/busyActions')
    locks: FakeLockManagerCore
    /** What the page put on the alert store, in order. */
    screens: Array<{ type: string, msg: string }>
}

async function openPage(options: { loopCommitter?: (real: Committer) => Committer } = {}): Promise<Page> {
    const locks = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(locks, 'this'), configurable: true })
    h.db = makeDb('base', ['alpha', 'beta'])
    const k = await startStore2({ db: h.db as unknown as Database })
    if (options.loopCommitter !== undefined) {
        // The save loop reads its committer once, when it starts: the replacement is in place before `w.start()`.
        k.context.session = { ...k.context.session, committer: options.loopCommitter(k.committer) }
    }
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    const { flushSync } = await import('svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    const bootActive = await import('src/ts/storage/store2/bootActive')
    const page: Page = { w, k, db: h.db, flush: flushSync, alert: await import('src/ts/alert'), busy: await import('src/ts/process/memory/busyActions'), locks, screens: [] }
    bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer: k.committer } as unknown as Store2Session)
    w.pageMode.setPageStorageMode({ kind: 'store2' })
    vi.mocked(page.alert.alertConfirm).mockImplementation(async () => true)
    vi.spyOn(page.alert.alertStore, 'set').mockImplementation((data) => { page.screens.push({ type: data.type, msg: data.msg }) })
    w.start()
    await sleepReal(150)
    await settled(w)
    return page
}

function gateOf(): { gate: Promise<void>, open: () => void } {
    let open: () => void = () => { }
    const gate = new Promise<void>((resolve) => { open = resolve })
    return { gate, open }
}

const settleFew = async () => { for (let i = 0; i < 20; i++) { await sleepReal(10) } }

interface CardWorld {
    imported: ReturnType<typeof vi.fn>
    takes: () => number
    queued: () => number
    /** Another app opens a card: the host queues it and calls the page's hook. */
    arrive: () => void
    refusals: () => number
}

/** The card host and the importer double, with the page's hook installed. */
async function installCards(page: Page): Promise<CardWorld> {
    const imported = vi.fn(async (_batch: unknown): Promise<void> => { })
    vi.doMock('src/ts/characterCards', () => ({
        characterURLImport: vi.fn(),
        hubURL: 'https://example.invalid',
        importOpenedSources: imported,
        isOpenedSourceImportable: (name: string) => /\.(charx|risum|risup)$/i.test(name),
    }))
    page.db.didFirstSetup = true
    let native: unknown[] = []
    let takes = 0
    ;(window as unknown as { __risuTaniumOpenedFilesHost?: { take: () => string } }).__risuTaniumOpenedFilesHost = {
        take: () => { takes += 1; const payload = JSON.stringify(native); native = []; return payload },
    }
    const opened = await import('src/ts/android/openedFiles')
    opened.androidOpenedFilesImport()
    await settleFew()
    const baseline = takes
    return {
        imported,
        takes: () => takes - baseline,
        queued: () => native.length,
        arrive: () => {
            native = [[{ uri: 'content://p/card1.charx', name: 'card1.charx' }]]
            window.__risuTaniumOpenedFiles?.()
        },
        refusals: () => page.screens.filter((screen) => screen.type === 'error' && screen.msg === language.backupLoadWorkInProgress).length,
    }
}

describe('CHORE-398 a card opened on Android before the restore point or snapshot is picked', () => {
    test('R-W (regression reproducer): during the store2 save-first wait with a held commit the card stays queued, and imports once when the picker is cancelled', async () => {
        const commitGate = gateOf()
        let commitsHeld = 0
        const page = await openPage({
            loopCommitter: (real) => ({
                ...real,
                async commit(...args: Parameters<Committer['commit']>) {
                    commitsHeld += 1
                    await commitGate.gate
                    return await real.commit(...args)
                },
            }),
        })
        const cards = await installCards(page)
        page.db.mainPrompt = 'unsaved edit'
        page.flush()
        vi.mocked(page.alert.alertSelect).mockImplementation(async () => '0')
        const { restoreFromInternalBackup } = await import('src/ts/drive/settingsRestore')

        const flow = restoreFromInternalBackup()
        await until(() => vi.mocked(page.alert.alertWait).mock.calls.some((call) => call[0] === language.store2RestoreSaving), 'the save-first wait')
        await until(() => commitsHeld >= 1, 'the commit to be held')
        // Precondition: the wait is real and nothing of the restore is registered as work yet.
        expect(page.busy.busyKinds()).toEqual([])
        cards.arrive()
        await settleFew()
        const during = { takes: cards.takes(), imported: cards.imported.mock.calls.length, queued: cards.queued(), refusals: cards.refusals() }
        commitGate.open()
        await flow
        await until(() => cards.imported.mock.calls.length >= 1, 'the card to be imported after the live end')
        await settleFew()

        expect(during, 'what the hook did during the save-first wait').toEqual({ takes: 0, imported: 0, queued: 1, refusals: 0 })
        expect(vi.mocked(page.alert.alertSelect), 'the restore reached the picker and was cancelled').toHaveBeenCalledTimes(1)
        expect(cards.imported).toHaveBeenCalledTimes(1)
        expect(cards.queued()).toBe(0)
    })

    test('R-W2 (regression reproducer): on a legacy page with the read-only check held, the card stays queued, and imports once when the restore ends live', async () => {
        const page = await openPage()
        page.w.pageMode.setPageStorageMode({ kind: 'legacy', convertedFrom: null })
        const cards = await installCards(page)
        const hold = gateOf()
        readOnlyBox.hold = hold.gate
        vi.mocked(page.alert.alertSelect).mockImplementation(async () => '0')
        const { restoreFromInternalBackup } = await import('src/ts/drive/settingsRestore')

        const flow = restoreFromInternalBackup()
        await settleFew()
        // Precondition: the flow is waiting in the read-only check: no question was asked and nothing is registered as work.
        expect(vi.mocked(page.alert.alertSelect)).not.toHaveBeenCalled()
        expect(page.busy.busyKinds()).toEqual([])
        cards.arrive()
        await settleFew()
        const during = { takes: cards.takes(), imported: cards.imported.mock.calls.length, queued: cards.queued(), refusals: cards.refusals() }
        hold.open()
        await flow
        await until(() => cards.imported.mock.calls.length >= 1, 'the card to be imported after the live end')
        await settleFew()

        expect(during, 'what the hook did while the read-only check was held').toEqual({ takes: 0, imported: 0, queued: 1, refusals: 0 })
        expect(cards.imported).toHaveBeenCalledTimes(1)
        expect(cards.queued()).toBe(0)
    })

    // Stays last: it replaces the alert module of the file's mocks for the rest of the file.
    test('R-N (compatibility guard): another tab holds the lock, so the refusal stays the shown alert and the waiting card imports only after it is closed', async () => {
        // The module under test waits for the notice a restore left on screen; the kit's alert double has no such wait, so
        // this one waits while the page's alert store shows an error.
        vi.doMock('src/ts/alert', async () => {
            const { writable } = await import('svelte/store')
            const stores = await import('src/ts/stores.svelte')
            return {
                alertClear: vi.fn(),
                alertConfirm: vi.fn(async () => true),
                alertError: vi.fn((message: string) => { stores.alertStore.set({ type: 'error', msg: message }) }),
                alertWait: vi.fn(),
                alertMd: vi.fn(),
                alertNormal: vi.fn(),
                alertSelect: vi.fn(async () => '1'),
                alertToast: vi.fn(),
                alertInput: vi.fn(),
                alertNormalWait: vi.fn(),
                alertAddCharacter: vi.fn(),
                alertStore: writable({ type: 'none', msg: '' }),
                waitAlert: vi.fn(async () => { }),
                waitUnreadNotice: async () => {
                    while (get(stores.alertStore).type === 'error') { await new Promise((resolve) => setTimeout(resolve, 5)) }
                },
            }
        })
        const page = await openPage()
        const stores = await import('src/ts/stores.svelte')
        const cards = await installCards(page)
        // Seed a restore point so the picker is reached.
        page.db.mainPrompt = 'second'
        page.flush()
        await sleepReal(300)
        await settled(page.w)
        const other = makeSimulatedTab(page.locks, 'other')
        await other.locks.tabPresenceLockAcquired
        const { restoreFromInternalBackup } = await import('src/ts/drive/settingsRestore')

        const flow = restoreFromInternalBackup()
        await until(() => page.busy.busyKinds().includes('backupLoad'), 'the restore to register its work')
        cards.arrive()
        await settleFew()
        const during = { takes: cards.takes(), imported: cards.imported.mock.calls.length, queued: cards.queued(), refusals: cards.refusals() }
        await flow
        await settleFew()
        const afterEnd = { shown: get(stores.alertStore), imported: cards.imported.mock.calls.length, queued: cards.queued() }
        stores.alertStore.set({ type: 'none', msg: '' })
        await until(() => cards.imported.mock.calls.length >= 1, 'the card to be imported after the refusal is closed')
        other.close()

        expect(during, 'what the hook did while the restore worked').toEqual({ takes: 0, imported: 0, queued: 1, refusals: 0 })
        expect(afterEnd.shown, 'the refusal stays on screen').toEqual({ type: 'error', msg: language.restoreOtherTabRefused })
        expect(afterEnd.imported, 'the import waits for the refusal to be closed').toBe(0)
        expect(afterEnd.queued).toBe(1)
        expect(cards.imported).toHaveBeenCalledTimes(1)
    })
})
