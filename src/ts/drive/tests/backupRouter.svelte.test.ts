/**
 * The picker and the `.rtb` route of the backup router (CHORE-128 S12c) on a real page of the application: the real
 * `saveDb()` store2 loop in a world of its own, the real `dbWriteLock`, storage tab locks over a fake Web Locks manager, the
 * real busy registry and restore run, and the real `runRtbRestore` over S11's real preparation (the pattern of
 * `rtbRestoreInstall.svelte.test.ts`). The picker's input is the real element with `click` replaced by a capture and `files`
 * set by the test, as the existing loader suites drive it. A fake store's success says nothing about a native store.
 *
 * Labels: every test is a compatibility guard of a new module (no pre-fix base: main has no router); each names the scratch
 * mutant it turns red on.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import { language } from 'src/lang'
import { exportClosure } from 'src/ts/storage/store2/rtb/exportClosure'
import type { CommitResult, Committer } from 'src/ts/storage/store2/commit'
import type { Database } from 'src/ts/storage/database.svelte'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { OperationOutcome } from 'src/ts/drive/operationEnd'
import { writeRtbFile, type WorldLike } from './rtb/rtbRestoreFixtures'

vi.setConfig({ testTimeout: 40_000 })

const platformBox = vi.hoisted(() => ({ isTauri: false }))
vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformBox.isTauri },
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
const encoder = new TextEncoder()
const GENERIC_FAILURE = 'Failed, Is file corrupted?'

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
    platformBox.isTauri = false
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
    platformBox.isTauri = false
    delete (window as unknown as Record<string, unknown>).__TAURI_OS_PLUGIN_INTERNALS__
    vi.doUnmock('src/ts/drive/rtbRestoreCopy')
    vi.doUnmock('src/ts/drive/rtbRestoreHold')
    vi.doUnmock('src/ts/storage/store/appStore')
    vi.restoreAllMocks()
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
    alert: typeof import('src/ts/alert')
    busy: typeof import('src/ts/process/memory/busyActions')
    run: typeof import('src/ts/drive/restoreInProgress')
    router: typeof import('src/ts/drive/backupRouter')
    settings: typeof import('src/ts/drive/settingsRestore')
}

// The page's modules are loaded after the world starts: the world resets the module registry.
async function openPage(): Promise<Page> {
    const locks = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(locks, 'this'), configurable: true })
    h.db = makeDb('base', ['alpha', 'beta'])
    const k = await startStore2({ db: h.db as unknown as Database })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    const bootActive = await import('src/ts/storage/store2/bootActive')
    const page: Page = {
        w,
        k,
        db: h.db,
        alert: await import('src/ts/alert'),
        busy: await import('src/ts/process/memory/busyActions'),
        run: await import('src/ts/drive/restoreInProgress'),
        router: await import('src/ts/drive/backupRouter'),
        settings: await import('src/ts/drive/settingsRestore'),
    }
    bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer: k.committer } as unknown as Store2Session)
    w.pageMode.setPageStorageMode({ kind: 'store2' })
    vi.mocked(page.alert.alertConfirm).mockImplementation(async () => true)
    w.start()
    await sleepReal(150)
    return page
}

const errorsOf = (page: Page): unknown[] => vi.mocked(page.alert.alertError).mock.calls.map((call) => call[0])
const waitsOf = (page: Page): unknown[] => vi.mocked(page.alert.alertWait).mock.calls.map((call) => call[0])

async function worldOfPage(page: Page): Promise<WorldLike> {
    const store = new Map<string, Uint8Array>()
    const closure = await exportClosure(page.k.counted.memory, { onUnits: async (batch) => { for (const unit of batch) { store.set(unit.key, unit.bytes) } } })
    return { store, manifestKey: closure.manifestKey, refsByRow: new Map(closure.refRows.map((row) => [row, []])) }
}

/** The page's own profile as a real `.rtb` file. */
async function rtbOfPage(page: Page): Promise<Uint8Array> {
    return (await writeRtbFile({ world: await worldOfPage(page) })).bytes
}

interface Opened {
    input: () => HTMLInputElement
    clicks: () => number
}

/** Replaces the picker's `click` with a capture of the input, so the test chooses the file. */
function capturePicker(): Opened {
    let captured: HTMLInputElement | null = null
    let clicks = 0
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
        captured = this
        clicks++
    })
    return { input: () => captured as unknown as HTMLInputElement, clicks: () => clicks }
}

function choose(input: HTMLInputElement, file: File | null): Promise<void> {
    Object.defineProperty(input, 'files', { value: file === null ? [] : [file], configurable: true })
    return (input.onchange as unknown as (event: Event) => Promise<void>).call(input, new Event('change'))
}

function held<T>(): { promise: Promise<T>, resolve: (value: T) => void } {
    let resolve: (value: T) => void = () => { }
    const promise = new Promise<T>((r) => { resolve = r })
    return { promise, resolve }
}

describe('the picker (R7, R8)', () => {
    test('R7: the accept filter is .bin and .rtb off Android and absent on Android (guard; MR10)', async () => {
        const page = await openPage()
        const view = capturePicker()
        void page.router.loadBackupFromPicker({ loadBin: vi.fn(), loadRtb: vi.fn() })
        expect(view.input().accept).toBe('.bin,.rtb,application/vnd.risutanium.rtb')
        view.input().dispatchEvent(new Event('cancel'))

        ;(window as unknown as Record<string, unknown>).__TAURI_OS_PLUGIN_INTERNALS__ = { os_type: 'windows' }
        void page.router.loadBackupFromPicker({ loadBin: vi.fn(), loadRtb: vi.fn() })
        expect(view.input().accept).toBe('.bin,.rtb,application/vnd.risutanium.rtb')
        view.input().dispatchEvent(new Event('cancel'))

        ;(window as unknown as Record<string, unknown>).__TAURI_OS_PLUGIN_INTERNALS__ = { os_type: 'android' }
        void page.router.loadBackupFromPicker({ loadBin: vi.fn(), loadRtb: vi.fn() })
        expect(view.input().accept).toBe('')
        view.input().dispatchEvent(new Event('cancel'))
    })

    test('R8: the picker opens before the call returns, cancel gives canceled with no busy entry, and onchange outlasts the routed restore (guard; MR7)', async () => {
        const page = await openPage()
        const view = capturePicker()
        const created = vi.spyOn(document, 'createElement')
        const opened = page.router.loadBackupFromPicker({ loadBin: vi.fn(), loadRtb: vi.fn() })
        expect(created).toHaveBeenCalledWith('input')
        expect(view.clicks()).toBe(1)
        expect(page.busy.isBusy()).toBe(false)
        view.input().dispatchEvent(new Event('cancel'))
        expect(await opened).toEqual({ outcome: 'canceled' })
        expect(page.busy.isBusy()).toBe(false)

        const restore = held<{ outcome: OperationOutcome }>()
        const loadBin = vi.fn(() => restore.promise)
        const second = page.router.loadBackupFromPicker({ loadBin, loadRtb: vi.fn() })
        const bin = new File([framedBin()], 'x.bin')
        let changeDone = false
        const change = choose(view.input(), bin).then(() => { changeDone = true })
        await until(() => loadBin.mock.calls.length === 1, 'the routed restore to start')
        expect(page.busy.isBusy()).toBe(false)
        expect(changeDone).toBe(false)
        restore.resolve({ outcome: 'committed' })
        await change
        expect(changeDone).toBe(true)
        expect(await second).toEqual({ outcome: 'committed' })
    })

    test('R8: a busy entry opened before the call refuses it with no picker (guard; MR12)', async () => {
        const page = await openPage()
        const view = capturePicker()
        const busy = page.busy.beginBusy('backupLoad')
        const end = await page.router.loadBackupFromPicker({ loadBin: vi.fn(), loadRtb: vi.fn() })
        busy.end()
        expect(end).toEqual({ outcome: 'nothing-replaced' })
        expect(view.clicks()).toBe(0)
        expect(errorsOf(page)).toContain(language.backupLoadWorkInProgress)
    })

    test('a throw while the picker is being set up ends failed with the generic message (guard)', async () => {
        const page = await openPage()
        vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => { throw new Error('no picker') })
        expect(await page.router.loadBackupFromPicker({ loadBin: vi.fn(), loadRtb: vi.fn() })).toEqual({ outcome: 'failed' })
        expect(errorsOf(page)).toEqual([GENERIC_FAILURE])
    })
})

/** One well-formed `.bin` entry: a name, a length and the body (the real framing of `writeBackupEntry`). */
function framedBin(): Uint8Array<ArrayBuffer> {
    const name = encoder.encode('database.risudat')
    const body = encoder.encode('db')
    const out = new Uint8Array(8 + name.length + body.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, name.length, true)
    out.set(name, 4)
    view.setUint32(4 + name.length, body.length, true)
    out.set(body, 8 + name.length)
    return out
}

/** Picks `file` through the Settings button and waits for the whole flow. */
async function restoreVia(page: Page, file: File): Promise<void> {
    const view = capturePicker()
    const flow = page.settings.restoreFromBinFile()
    await until(() => view.clicks() === 1, 'the picker to open')
    await choose(view.input(), file)
    await flow
}

describe('R5: a sealed or broken-magic RTBX file reaches the .rtb restore through the real shell', () => {
    test.each([
        ['a sealed file', new Uint8Array([0x52, 0x54, 0x42, 0x58, 0x0D, 0x0A, 0x1A, 0x0A, 1, 0, 0, 0, 0, 0, 0, 0]), () => language.rtbRestoreEncrypted],
        ['a file with a broken magic', new Uint8Array([0x52, 0x54, 0x42, 0x58, 0x00, 0x0A, 0x1A, 0x0A, 1, 0, 0, 0, 0, 0, 0, 0]), () => language.rtbRestoreDamaged],
    ])('%s shows its own refusal and replaces nothing (guard)', async (_label, bytes, text) => {
        const page = await openPage()
        await restoreVia(page, new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin'))
        expect(errorsOf(page)).toEqual([text()])
        expect(page.busy.isBusy()).toBe(false)
        expect(page.run.restorePhase()).toBe('none')
    })

})

describe('B6b: a throw after the commit ends unknown, never the generic failure', () => {
    test('the commit lands and the facts builder throws: the run is pageEnding, the last wait is store2ImportUnconfirmed and the generic failure is never shown (guard; kills the pair MU25 + MB7a)', async () => {
        // The commit answers `committed` and the facts builder throws, but only once the commit stub has run.
        const commitRan = { value: false }
        // The page's real store has no piece writer; the restore copies into a store that has one (nothing is copied: the file holds no assets).
        vi.doMock('src/ts/storage/store/appStore', async (importOriginal) => {
            const original = await importOriginal<typeof import('src/ts/storage/store/appStore')>()
            const { MemoryByteStore } = await import('./rtb/rtbInstallFixtures')
            const memory = new MemoryByteStore()
            return { ...original, getAppStore: async () => memory }
        })
        vi.doMock('src/ts/drive/rtbRestoreHold', async (importOriginal) => {
            const original = await importOriginal<typeof import('src/ts/drive/rtbRestoreHold')>()
            return {
                ...original,
                rtbGuardedCommitter: (committer: Committer): Committer => ({
                    ...committer,
                    commit: async (): Promise<CommitResult> => {
                        commitRan.value = true
                        return { status: 'committed', value: await committer.readCommit() as never, bytes: new Uint8Array(), flushed: true, manifestKey: 'm', mode: 'ordinary' } as unknown as CommitResult
                    },
                }),
            }
        })
        vi.doMock('src/ts/drive/rtbRestoreCopy', async (importOriginal) => {
            const original = await importOriginal<typeof import('src/ts/drive/rtbRestoreCopy')>()
            return {
                ...original,
                landedFactsOf: (facts: Parameters<typeof original.landedFactsOf>[0]) => {
                    if (commitRan.value) {
                        throw new Error('the facts builder broke after the commit')
                    }
                    return original.landedFactsOf(facts)
                },
            }
        })
        const page = await openPage()
        const bytes = await rtbOfPage(page)
        const endedLive = vi.fn()
        const stop = page.run.onRestoreEndedLive(endedLive)
        await restoreVia(page, new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin'))
        stop()
        expect(commitRan.value).toBe(true)
        expect(page.run.restorePhase()).toBe('pageEnding')
        expect(waitsOf(page).at(-1)).toBe(language.store2ImportUnconfirmed)
        expect(errorsOf(page)).not.toContain(GENERIC_FAILURE)
        expect(endedLive).not.toHaveBeenCalled()
    })
})
