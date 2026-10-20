/**
 * What the import and restore shells return as an `OperationEnd`: `LoadLocalBackup` (Settings and boot), `loadBackupAtBoot`'s
 * flow, and `loadStoreRestorePoint` for a restore point and an old numbered backup. The shells keep every alert they had;
 * the end is a returned value only.
 *
 * Runs over the real, unmocked `saveDb()` store2 loop in a world of its own (`saveLoopWorld.ts`, `store2SaveKit.ts`),
 * against an in-memory store2 backend and a fake Web Locks manager, with the page reload replaced. A mocked success here
 * is not evidence of native backend behaviour.
 *
 * Labels: new behaviour (the ends did not exist), guard (the existing alert is unchanged), mutant (a recorded in-memory
 * edit of `backuplocal.ts` that turns the named test red):
 *  - "canceled after a write" mutant: `writeMayHaveBegun = true` removed; fails the post-write decline tests (Settings
 *    and boot).
 *  - "Settings cancel listener" mutant: the picker `cancel` listener registered for a boot import only; fails the
 *    Settings picker-cancel test.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import { breakDataChecksum } from 'src/ts/storage/tests/risuSaveBlockFile'
import { createAssetBatchFake } from './assetBatchFake'
import { language } from 'src/lang'
import type { Committer, CommitResult } from 'src/ts/storage/store2/commit'
import type { WriteResult } from 'src/ts/storage/store2/commit'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Database } from 'src/ts/storage/database.svelte'
import type { BootImportResult, BootImportTarget } from 'src/ts/storage/store2/legacy/bootImport'
import type { IncompleteItem, LegacyEntryReader } from 'src/ts/storage/store2/legacy/resolve'
import type { BootImportEnd } from 'src/ts/storage/store2/legacy/bootImport'
import type { LocalBackupEnd } from 'src/ts/drive/backuplocal'
import type { ExclusiveHoldRelease } from 'src/ts/drive/storeRestore'

vi.setConfig({ testTimeout: 60_000 })

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

const batchFake = createAssetBatchFake()
/** Asset keys the batch transport answers `invalid` for, as the store does for a name it refuses. */
const refusedAssetKeys = new Set<string>()

// The batch transport is answered by the fake over the page's own store; it is available only in the tests that turn it on.
// Every member reaches `batchFake` when called, never when the module is created.
vi.mock('src/ts/storage/tauriAssetBatch', (importOriginal: () => Promise<typeof import('src/ts/storage/tauriAssetBatch')>) => importOriginal().then((original) => ({
    ...original,
    isAssetBatchAvailable: () => batchFake.module.isAssetBatchAvailable(),
    markAssetBatchUnavailable: () => batchFake.module.markAssetBatchUnavailable(),
    readAssetBatch: (keys: readonly string[]) => batchFake.module.readAssetBatch(keys),
    listAssetsSized: () => batchFake.module.listAssetsSized(),
    writeAssetBatch: (entries: Parameters<typeof batchFake.module.writeAssetBatch>[0]) => batchFake.module.writeAssetBatch(entries.filter((entry) => !refusedAssetKeys.has(entry.key))).then((accepted) => {
        let next = 0
        return entries.map((entry) => refusedAssetKeys.has(entry.key) ? { k: 'invalid' as const, reason: 'refused by the test' } : accepted[next++])
    }),
})))

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

afterEach(async () => {
    const { overrideBackupWindowBytes } = await import('src/ts/drive/backupContainer')
    overrideBackupWindowBytes(null)
    batchFake.reset()
    refusedAssetKeys.clear()
    worlds.parkAll()
    vi.doMock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }))
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
    flush(): void
    alert: typeof import('src/ts/alert')
    errors: typeof import('src/ts/storage/store2/backend/errors')
    useCommitter(committer: Committer): void
    /** The options each picker opening showed. */
    shown: string[][]
    reloads: { count: number }
}

/** A store2 page; with `boot` it is a page as a boot sees it (no page mode, no residency). */
async function openPage(options: { webLocks?: boolean, boot?: boolean } = {}): Promise<Page> {
    const locks = new FakeLockManagerCore()
    const manager = options.webLocks === false ? undefined : new FakeTabLockManagerView(locks, 'this')
    Object.defineProperty(window.navigator, 'locks', { value: manager, configurable: true })
    h.db = makeDb('base', ['alpha', 'beta'])
    const k = await startStore2({ db: h.db as unknown as Database })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    const { flushSync } = await import('svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    const bootActive = await import('src/ts/storage/store2/bootActive')
    const reloads = { count: 0 }
    const page: Page = {
        w,
        k,
        db: h.db,
        flush: flushSync,
        alert: await import('src/ts/alert'),
        errors: await import('src/ts/storage/store2/backend/errors'),
        useCommitter(committer) {
            bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer } as unknown as Store2Session)
        },
        shown: [],
        reloads,
    }
    page.useCommitter(k.committer)
    w.pageMode.setPageStorageMode(options.boot === true ? { kind: 'unset' } : { kind: 'store2' })
    if (options.boot === true) {
        ;(await import('src/ts/storage/store2/residencyActive')).resetResidencyForTest()
    }
    vi.mocked(page.alert.alertConfirm).mockImplementation(async () => true)
    vi.mocked(page.alert.alertSelect).mockImplementation(async (shown: string[]) => {
        page.shown.push(shown)
        return '0'
    })
    vi.spyOn(page.alert.alertStore, 'set').mockImplementation(() => { })
    vi.spyOn(window.location, 'reload').mockImplementation(() => { reloads.count++ })
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => { })
    w.start()
    await sleepReal(options.boot === true ? 100 : 150)
    await settled(w)
    return page
}

async function commitEdit(page: Page, prompt: string): Promise<void> {
    await nextCommit(page.w, () => {
        page.db.mainPrompt = prompt
        page.flush()
    })
}

const alertErrorTexts = (page: Page): unknown[] => vi.mocked(page.alert.alertError).mock.calls.map((call) => call[0])

// ---- .bin construction ----

const GOLDEN_DIR = path.resolve(process.env.BIN_GOLDENS_DIR ?? path.join(process.cwd(), 'src/ts/drive/tests/binGoldens'))

function golden(name: string): Uint8Array {
    return new Uint8Array(fs.readFileSync(path.join(GOLDEN_DIR, name)))
}

function binEntry(name: string, data: Uint8Array): Uint8Array {
    const nameBytes = new TextEncoder().encode(name)
    const out = new Uint8Array(4 + nameBytes.length + 4 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, nameBytes.length, true)
    out.set(nameBytes, 4)
    view.setUint32(4 + nameBytes.length, data.length, true)
    out.set(data, 8 + nameBytes.length)
    return out
}

function concat(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

type BootRun = NonNullable<Parameters<typeof import('src/ts/drive/backuplocal').LoadLocalBackup>[0]>

/** Opens the picker the way the app does and returns what is needed to answer it. */
async function openPicker(boot?: BootRun) {
    const { LoadLocalBackup } = await import('src/ts/drive/backuplocal')
    const realCreateElement = document.createElement.bind(document)
    let input: HTMLInputElement | null = null
    const created = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const element = realCreateElement(tag)
        if (tag === 'input') {
            input = element as HTMLInputElement
        }
        return element
    })
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => { })
    let ended: Promise<LocalBackupEnd>
    try {
        ended = LoadLocalBackup(boot)
    } finally {
        created.mockRestore()
    }
    // Read before any await: the picker must open in the call's own turn, not a later microtask.
    const clickedInCall = click.mock.calls.length
    const chosen = input as HTMLInputElement | null
    if (chosen === null) {
        throw new Error('LoadLocalBackup did not create a file input')
    }
    return { chosen, ended, clickedInCall }
}

/** Drives the real `LoadLocalBackup()` with `bytes` as the chosen file and returns what it came to. */
async function loadBin(bytes: Uint8Array, boot?: BootRun, name = 'backup.bin'): Promise<LocalBackupEnd> {
    const picker = await openPicker(boot)
    Object.defineProperty(picker.chosen, 'files', { value: [new File([bytes as unknown as Uint8Array<ArrayBuffer>], name)], configurable: true })
    await (picker.chosen.onchange as unknown as (event: Event) => Promise<void>).call(picker.chosen, new Event('change'))
    return await picker.ended
}

/** The boot's file flow with `target` as the installer; `bootEnd` is what the boot is told. */
async function loadAtBoot(target: BootImportTarget, bytes: Uint8Array): Promise<{ end: LocalBackupEnd, bootEnd: BootImportEnd }> {
    let told: BootImportEnd | null = null
    const end = await loadBin(bytes, { target, done: (bootEnd) => { told = bootEnd } })
    return { end, bootEnd: told ?? { kind: 'cancelled' } }
}

function recordingTarget(result: BootImportResult, onInstall?: (hooks: Parameters<BootImportTarget['install']>[2]) => Promise<void>): BootImportTarget {
    return {
        readColdStorageItem: async () => ({ status: 'missing' }),
        async install(_source, _reader: LegacyEntryReader, hooks) {
            await onInstall?.(hooks)
            return result
        },
    }
}

async function blockFileBytes(page: Page, db: Entry): Promise<Uint8Array> {
    const encoder = new page.w.risuSave.RisuSaveEncoder()
    await encoder.init(db as unknown as Database, { compression: false })
    await encoder.set(db as unknown as Database, { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false })
    return new Uint8Array(encoder.encode()!)
}

const installedResult: BootImportResult ={ status: 'installed', manifestKey: 'm', flushed: true, repair: { dropped: 1, changed: 2, recovered: 3 } }

const REFUSED_ASSET = new Uint8Array([1, 2, 3, 4])

/** Makes the batch pipeline carry the restore's assets over the page's store; the store refuses `refusedKey` by name. */
async function hostAssetPipeline(refusedKey: string): Promise<void> {
    const { getAppStore } = await import('src/ts/storage/store/appStore')
    batchFake.useStore(() => getAppStore())
    batchFake.ctl.available = true
    refusedAssetKeys.add(refusedKey)
}

const incompleteItem: IncompleteItem ={ kind: 'chat', chaId: 'c', name: 'Chat', chatIndex: 0, key: 'unit-1', reason: 'missing' }

describe('the Settings .bin import ends', () => {
    test('new behaviour: a landed import is committed and carries its source, assets, inlays, repair and flush facts', async () => {
        const page = await openPage()
        const bytes = golden('upstream-full.bin')

        const end = await loadBin(bytes, undefined, 'my backup.bin')

        expect(end).toMatchObject({ operation: 'import', target: 'my backup.bin', outcome: 'committed', cause: null })
        expect(end.detail.source).toMatchObject({ kind: 'file', name: 'my backup.bin', size: bytes.length })
        expect(typeof (end.detail.source as { lastModified: number }).lastModified).toBe('number')
        expect(end.detail.assets).toEqual({ written: 1, skipped: [] })
        expect(end.detail.inlays).toMatchObject({ skipped: [], changed: false })
        expect(end.detail.repair).toEqual({ dropped: 0, changed: 0, recovered: 0 })
        expect(end.detail.incomplete).toEqual([])
        expect(end.detail.omitted.size).toBe(0)
        expect(typeof end.detail.flushed === 'boolean' || end.detail.flushed === undefined).toBe(true)
        // Guard: the existing messages are unchanged.
        expect(page.reloads.count).toBe(1)
        expect(page.alert.alertWait).toHaveBeenCalledWith(language.store2ImportDone)
        expect(alertErrorTexts(page)).toEqual([])
    })

    test('new behaviour: a refused commit is nothing-replaced and names its cause; the existing message is unchanged', async () => {
        const page = await openPage()
        page.useCommitter({ ...page.k.committer, commit: async () => ({ status: 'refused', reason: 'too-new', detail: 'newer' }) as CommitResult })

        const end = await loadBin(golden('upstream-full.bin'))

        expect(end).toMatchObject({ operation: 'import', outcome: 'nothing-replaced', cause: 'too-new' })
        expect(alertErrorTexts(page)).toContain(language.store2ImportTooNew)
        expect(page.reloads.count).toBe(0)
    })

    test('new behaviour: an unconfirmed commit is unknown', async () => {
        const page = await openPage()
        page.useCommitter({ ...page.k.committer, commit: async () => ({ status: 'unknown', cause: new page.errors.Store2UnknownOutcomeError('lost') }) as CommitResult })

        const end = await loadBin(golden('upstream-full.bin'))

        expect(end).toMatchObject({ outcome: 'unknown', cause: null })
        expect(page.reloads.count).toBe(0)
    })

    test('new behaviour: a precondition refusal is nothing-replaced and names the check\'s cause; the existing message is unchanged', async () => {
        const page = await openPage()
        const bootActive = await import('src/ts/storage/store2/bootActive')
        bootActive.setStore2BootSession(null)

        const end = await loadBin(golden('upstream-full.bin'))

        expect(end).toMatchObject({ outcome: 'nothing-replaced', cause: 'no-writable-session' })
        expect(alertErrorTexts(page)).toContain(language.store2Boot.readOnlyRefusal)
    })

    test('new behaviour: a file with no database entry is nothing-replaced, not canceled', async () => {
        const page = await openPage()

        const end = await loadBin(new Uint8Array([0, 0, 0, 0]))

        expect(end).toMatchObject({ outcome: 'nothing-replaced', cause: null })
        expect(alertErrorTexts(page)).toContain('Failed, Is file corrupted?')
    })

    test('new behaviour: declining the no-Web-Locks warning before any write is canceled', async () => {
        const page = await openPage({ webLocks: false })
        vi.mocked(page.alert.alertConfirm).mockImplementation(async (text: string) => text !== language.restoreNoLockWarningConfirm)

        const end = await loadBin(golden('upstream-full.bin'))

        expect(end).toMatchObject({ operation: 'import', outcome: 'canceled', cause: null })
        expect(page.w.store.mutating()).toEqual([])
    })

    // Mutant "canceled after a write": with the flag never set this decline, made after the assets were copied, reads canceled.
    test('new behaviour: declining the unsaved-edits question after the assets were copied is nothing-replaced, not canceled', async () => {
        const page = await openPage({ webLocks: false })
        vi.mocked(page.alert.alertConfirm).mockImplementation(async (text: string) => text !== language.store2RestoreUnsavedConfirm)
        const release = await page.w.api.dbWriteLock.acquire()

        const running = loadBin(golden('upstream-full.bin'))
        await until(() => page.w.store.peek('assets/golden-avatar.png') !== null, 'the assets to be copied')
        await sleepReal(150)
        page.db.mainPrompt = 'late edit'
        page.flush()
        await sleepReal(50)
        release()
        const end = await running

        expect(end).toMatchObject({ operation: 'import', outcome: 'nothing-replaced' })
        expect(page.w.store.peek('assets/golden-avatar.png')).not.toBeNull()
        expect(page.reloads.count).toBe(0)
    })

    // Mutant "Settings cancel listener": the listener registered for a boot import only leaves this promise pending.
    test('new behaviour: dismissing the picker settles canceled, and the picker was opened in the call\'s own turn', async () => {
        await openPage()

        const picker = await openPicker()
        expect(picker.clickedInCall).toBe(1)
        picker.chosen.dispatchEvent(new Event('cancel'))
        const result = await Promise.race([picker.ended, sleepReal(300).then(() => 'pending' as const)])

        expect(result).toMatchObject({ operation: 'import', target: null, outcome: 'canceled', cause: null })
    })

    // Mutant "cancel does not settle": the later change runs a real import and its committed end would be the one returned.
    test('new behaviour: the settled end is not replaced by a later event that would end differently', async () => {
        await openPage()

        const picker = await openPicker()
        picker.chosen.dispatchEvent(new Event('cancel'))
        Object.defineProperty(picker.chosen, 'files', { value: [new File([golden('upstream-full.bin') as unknown as Uint8Array<ArrayBuffer>], 'later.bin')], configurable: true })
        await (picker.chosen.onchange as unknown as (event: Event) => Promise<void>).call(picker.chosen, new Event('change'))

        expect(await picker.ended).toMatchObject({ operation: 'import', target: null, outcome: 'canceled' })
    })

    // Mutant "omitted dropped": the salvage map is not carried onto the end.
    test('new behaviour: the blocks the person agreed to leave out are carried on the landed end', async () => {
        const page = await openPage()
        const damaged = breakDataChecksum(await blockFileBytes(page, makeDb('backup', ['alpha', 'beta', 'gamma'])), 'alpha')

        const end = await loadBin(concat(binEntry('golden-avatar.png', REFUSED_ASSET), binEntry('database.risudat', damaged)))

        expect(end).toMatchObject({ operation: 'import', outcome: 'committed' })
        expect(end.detail.omitted.size).toBeGreaterThan(0)
    })

    // Mutant "accepted dropped": the items accepted at the incomplete-data question are not kept for the landed end.
    test('new behaviour: the units the person accepted being incomplete are carried on the landed end', async () => {
        await openPage()

        const end = await loadBin(golden('upstream-stub-missing-entry.bin'))

        expect(end).toMatchObject({ operation: 'import', outcome: 'committed' })
        expect(end.detail.incomplete).toHaveLength(1)
        expect(JSON.stringify(end.detail.incomplete)).toContain('Stub Bob')
    })

    // Mutant "refused names counted": the written count is the number handed to the store, not less the names it refused.
    test('new behaviour: an asset the store refuses by name is skipped and is not counted as written', async () => {
        await openPage()
        await hostAssetPipeline('assets/refused.png')

        const end = await loadBin(concat(binEntry('refused.png', REFUSED_ASSET), golden('upstream-full.bin')))

        expect(batchFake.ctl.calls.length, 'the batch pipeline must have carried the assets').toBeGreaterThan(0)
        expect(end).toMatchObject({ operation: 'import', outcome: 'committed' })
        expect(end.detail.assets).toEqual({ written: 1, skipped: [{ name: 'refused.png', reason: 'invalidName' }] })
    })
})

describe('the boot .bin import ends', () => {
    test('new behaviour: an installed profile is committed with its repair, flush and accepted incomplete items; the boot is told as before', async () => {
        await openPage({ boot: true })
        const target = recordingTarget(installedResult, async (hooks) => { await hooks.confirmIncomplete([incompleteItem]) })

        const { end, bootEnd } = await loadAtBoot(target, golden('upstream-full.bin'))

        expect(end).toMatchObject({ operation: 'boot-import', target: 'backup.bin', outcome: 'committed', cause: null })
        expect(end.detail.repair).toEqual({ dropped: 1, changed: 2, recovered: 3 })
        expect(end.detail.flushed).toBe(true)
        expect(end.detail.incomplete).toEqual([incompleteItem])
        expect(end.detail.assets).toEqual({ written: 1, skipped: [] })
        expect(bootEnd).toEqual({ kind: 'finished', result: installedResult })
    })

    test.each([
        ['install-failed', 'nothing-replaced'],
        ['install-unknown', 'unknown'],
        ['no-backend', 'unknown'],
    ] as const)('new behaviour: blocked %s ends %s and names its reason', async (reason, outcome) => {
        await openPage({ boot: true })

        const { end, bootEnd } = await loadAtBoot(recordingTarget({ status: 'blocked', reason, detail: 'recorded' }), golden('upstream-full.bin'))

        expect(end).toMatchObject({ operation: 'boot-import', outcome, cause: reason })
        expect(bootEnd.kind).toBe('finished')
    })

    test('new behaviour: a reclassify is unknown', async () => {
        await openPage({ boot: true })

        const { end } = await loadAtBoot(recordingTarget({ status: 'reclassify' }), golden('upstream-full.bin'))

        expect(end).toMatchObject({ outcome: 'unknown', cause: null })
    })

    // Mutant "canceled after a write": the installer answers after the assets were copied, so a decline is nothing-replaced.
    test('new behaviour: the installer declining after the assets were copied is nothing-replaced, and the boot is told cancelled', async () => {
        const page = await openPage({ boot: true })

        const { end, bootEnd } = await loadAtBoot(recordingTarget({ status: 'declined' }), golden('upstream-full.bin'))

        expect(page.w.store.peek('assets/golden-avatar.png')).not.toBeNull()
        expect(end).toMatchObject({ operation: 'boot-import', outcome: 'nothing-replaced' })
        expect(bootEnd).toEqual({ kind: 'cancelled' })
    })

    // Mutant "finished boot end ignored": a throw after the install landed ends failed while the boot is told installed.
    test('new behaviour: a throw after the install landed keeps the end committed, as the boot is told', async () => {
        const page = await openPage({ boot: true })
        await hostAssetPipeline('assets/refused.png')
        vi.mocked(page.alert.alertNormalWait).mockRejectedValue(new Error('the notice could not be shown'))

        const { end, bootEnd } = await loadAtBoot(recordingTarget(installedResult), concat(binEntry('refused.png', REFUSED_ASSET), golden('upstream-full.bin')))

        expect(bootEnd).toEqual({ kind: 'finished', result: installedResult })
        expect(end).toMatchObject({ operation: 'boot-import', outcome: 'committed', cause: null })
        expect(alertErrorTexts(page)).toEqual(['Failed, Is file corrupted?'])
    })

    test('new behaviour: dismissing the picker at boot is canceled and the boot is told cancelled', async () => {
        await openPage({ boot: true })
        let told: BootImportEnd | null = null

        const picker = await openPicker({ target: recordingTarget({ status: 'declined' }), done: (bootEnd) => { told = bootEnd } })
        picker.chosen.dispatchEvent(new Event('cancel'))

        expect(await picker.ended).toMatchObject({ operation: 'boot-import', outcome: 'canceled' })
        expect(told).toEqual({ kind: 'cancelled' })
    })
})

describe('the restore of a store2 page ends', () => {
    async function restore(page: Page, pick: (shown: string[]) => number) {
        vi.mocked(page.alert.alertSelect).mockImplementation(async (shown: string[]) => {
            page.shown.push(shown)
            return String(pick(shown))
        })
        const { loadStoreRestorePoint } = await import('src/ts/drive/storeRestore')
        const reload = vi.fn(async (hold: ExclusiveHoldRelease | null) => { if (hold) { await hold(true) } })
        const end = await loadStoreRestorePoint({ reload, saveBoundMs: 3000 })
        return { end, reload }
    }

    test('new behaviour: a restored point is committed, named by its row label', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')

        const { end, reload } = await restore(page, () => 1)

        expect(reload).toHaveBeenCalledTimes(1)
        expect(end).toMatchObject({ operation: 'restore-point', target: page.shown[0][1], outcome: 'committed', cause: null })
        expect(end.detail.source).toEqual({ kind: 'restore-point', label: page.shown[0][1] })
        expect(page.alert.alertWait).toHaveBeenCalledWith(language.store2RestoreDone)
    })

    test('new behaviour: choosing Cancel is canceled before any target exists', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')

        const { end, reload } = await restore(page, () => 0)

        expect(end).toMatchObject({ operation: 'restore-point', target: null, outcome: 'canceled' })
        expect(reload).not.toHaveBeenCalled()
    })

    test('new behaviour: a restore point that is no longer named is nothing-replaced; the existing message is unchanged', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        const seedKey = page.k.seeded.manifestKey
        const { loadStoreRestorePoint } = await import('src/ts/drive/storeRestore')
        vi.mocked(page.alert.alertSelect).mockImplementation(async () => {
            await page.k.committer.restore(await page.k.committer.readCommit(), seedKey)
            return '1'
        })

        const end = await loadStoreRestorePoint({ reload: async () => { }, saveBoundMs: 3000 })

        expect(end).toMatchObject({ operation: 'restore-point', outcome: 'nothing-replaced' })
        expect(alertErrorTexts(page)).toContain(language.store2RestoreListChanged)
    })

    test.each([
        ['unknown', 'unknown', null],
        ['failed', 'failed', 'write-failed'],
        ['stale', 'nothing-replaced', 'stale-page'],
    ] as const)('new behaviour: a restore answered %s ends %s', async (kind, outcome, cause) => {
        const page = await openPage()
        await commitEdit(page, 'second')
        const result: WriteResult = kind === 'unknown'
            ? { status: 'unknown', cause: new page.errors.Store2UnknownOutcomeError('lost') }
            : { status: 'failed', cause: kind === 'failed' ? new page.errors.Store2BackendFailureError('no') : new page.errors.Store2StalePageError('replaced') }
        page.useCommitter({ ...page.k.committer, restore: async () => result })

        const { end } = await restore(page, () => 1)

        expect(end).toMatchObject({ operation: 'restore-point', outcome, cause })
    })

    test('new behaviour: an error thrown after the restore began is unknown', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        page.useCommitter({ ...page.k.committer, restore: async () => { throw new Error('unexpected') } })

        const { end } = await restore(page, () => 1)

        expect(end).toMatchObject({ outcome: 'unknown' })
    })

    const OLD_TIME = 1700000000

    test('new behaviour: a restored old numbered backup is committed, with its time as an ISO 8601 target and its source', async () => {
        const page = await openPage()
        page.w.store.plant(`database/dbbackup-${OLD_TIME}.bin`, await blockFileBytes(page, makeDb('old prompt', ['old-one'])))

        const { end, reload } = await restore(page, (shown) => shown.findIndex((label) => label.startsWith('Old: ')))

        expect(reload).toHaveBeenCalledTimes(1)
        expect(end).toMatchObject({ operation: 'restore-numbered', target: new Date(OLD_TIME * 100).toISOString(), outcome: 'committed' })
        expect(end.detail.source).toEqual({ kind: 'numbered', time: OLD_TIME })
        expect(end.detail.repair).toEqual({ dropped: 0, changed: 0, recovered: 0 })
        expect(page.alert.alertWait).toHaveBeenCalledWith(language.store2ImportDone)
    })

    test('new behaviour: declining the no-Web-Locks warning for an old backup is canceled', async () => {
        const page = await openPage({ webLocks: false })
        page.w.store.plant(`database/dbbackup-${OLD_TIME}.bin`, await blockFileBytes(page, makeDb('old prompt', ['old-one'])))
        vi.mocked(page.alert.alertConfirm).mockImplementation(async (text: string) => text !== language.restoreNoLockWarningConfirm)

        const { end } = await restore(page, (shown) => shown.findIndex((label) => label.startsWith('Old: ')))

        expect(end).toMatchObject({ operation: 'restore-numbered', outcome: 'canceled' })
    })
})
