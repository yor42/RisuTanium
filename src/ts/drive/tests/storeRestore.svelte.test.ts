/**
 * The internal-backup load of a store2 page (`loadInternalBackup` -> `loadStoreRestorePoint`): a picker over the page's
 * restore points and a restore that points the commit key at the chosen one.
 *
 * Runs over the real, unmocked `saveDb()` store2 loop in a world of its own (`saveLoopWorld.ts`, `store2SaveKit.ts`),
 * against an in-memory store2 backend and a fake Web Locks manager. A mocked success here is not evidence of native
 * backend behaviour. The outcome table replaces `Committer.restore` with a double that answers a fixed result; the
 * library's own mapping of a real write is `restorePoints.test.ts`.
 *
 * Labels: regression (red on the base the named change fixes; only the dispatch test), new behaviour pinned by mutants, guard (passes with or without the change), mutant (a
 * recorded temporary edit that turns the named test red).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, peerCommit, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView, makeSimulatedTab } from 'src/ts/storage/tests/fakeWebLocks'
import { language } from 'src/lang'
import { COMMIT_KEY } from 'src/ts/storage/store2/format/keys'
import { encodeUnit, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import type { Committer } from 'src/ts/storage/store2/commit'
import type { WriteResult } from 'src/ts/storage/store2/commit'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Database } from 'src/ts/storage/database.svelte'
import type { ExclusiveHoldRelease } from 'src/ts/drive/storeRestore'
import { assembleDatabase } from 'src/ts/storage/store2/codec'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { breakDataChecksum } from 'src/ts/storage/tests/risuSaveBlockFile'

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
    // The shared mock module offers only the legacy reader's old name; an old backup's units are read through `readColdStorageItem`.
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
    if (originalLocks) {
        Object.defineProperty(window.navigator, 'locks', originalLocks)
    } else {
        Object.defineProperty(window.navigator, 'locks', { value: undefined, configurable: true })
    }
})

interface Page {
    w: World
    k: Store2Kit
    /** The database the loop and the change effects read: a reactive proxy. */
    db: Entry
    flush(): void
    alert: typeof import('src/ts/alert')
    busy: typeof import('src/ts/process/memory/busyActions')
    loop: typeof import('src/ts/storage/store2/saveLoop')
    restore: typeof import('src/ts/drive/storeRestore')
    internal: typeof import('src/ts/drive/internalBackup')
    errors: typeof import('src/ts/storage/store2/backend/errors')
    /** The fake Web Locks origin this page's tab lives in. */
    locks: FakeLockManagerCore
    /** The options the picker was opened with, one entry per opening. */
    shown: string[][]
    /** What the page put on the non-dismissible wait screen. */
    waitScreens: Array<{ type: string, msg: string }>
    /** Makes the page's session use this committer. */
    useCommitter(committer: Committer): void
}

/** The page as the application runs it: a store2 session over a reactive `DBState`, in the `store2` page mode. */
async function openPage(options: { webLocks?: boolean } = {}): Promise<Page> {
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
    const page: Page = {
        w,
        k,
        db: h.db,
        flush: flushSync,
        alert: await import('src/ts/alert'),
        busy: await import('src/ts/process/memory/busyActions'),
        loop: await import('src/ts/storage/store2/saveLoop'),
        restore: await import('src/ts/drive/storeRestore'),
        internal: await import('src/ts/drive/internalBackup'),
        errors: await import('src/ts/storage/store2/backend/errors'),
        locks,
        shown: [],
        waitScreens: [],
        useCommitter(committer) {
            bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer } as unknown as Store2Session)
        },
    }
    page.useCommitter(k.committer)
    w.pageMode.setPageStorageMode({ kind: 'store2' })
    // The mocked alert module is shared by every world of the file: each page starts from the answers a person gives by default.
    vi.mocked(page.alert.alertConfirm).mockImplementation(async () => true)
    vi.spyOn(page.alert.alertStore, 'set').mockImplementation((data) => { page.waitScreens.push({ type: data.type, msg: data.msg }) })
    vi.mocked(page.alert.alertSelect).mockImplementation(async (options: string[]) => {
        page.shown.push(options)
        return '1'
    })
    w.start()
    await sleepReal(150)
    await settled(w)
    return page
}

/** An edit the loop commits: the seed becomes the one restore point. */
async function commitEdit(page: Page, prompt: string): Promise<void> {
    await nextCommit(page.w, () => {
        page.db.mainPrompt = prompt
        page.flush()
    })
}

/** The page's restore, with a reload double that records which entries were registered at the moment of the reload. */
async function runRestore(page: Page, options: { saveBoundMs?: number } = {}) {
    const registeredAtReload: string[][] = []
    const reload = vi.fn(async (hold: ExclusiveHoldRelease | null) => {
        registeredAtReload.push(page.busy.busyKinds())
        if (hold) {
            await hold(true)
        }
    })
    await page.restore.loadStoreRestorePoint({ reload, saveBoundMs: options.saveBoundMs ?? 3000 })
    return { reload, registeredAtReload }
}

async function currentKey(page: Page): Promise<string | undefined> {
    return (await page.k.commitKey()).current?.key
}

/** Whether `dbWriteLock` can be taken within a moment: false while a restore keeps it closed. */
async function writeLockIsFree(page: Page): Promise<boolean> {
    const taken = page.w.api.dbWriteLock.acquire().then((release) => { release(); return true })
    return await Promise.race([taken, sleepReal(250).then(() => false)])
}

const alertErrorTexts = (page: Page): unknown[] => vi.mocked(page.alert.alertError).mock.calls.map((call) => call[0])

describe('restore of a point on a store2 page', () => {
    // New behaviour, pinned by mutants: the restore keeps the write lock closed, so the page's own loop neither parks on the restore nor
    // saves its pre-restore state over it.
    test.each([
        ['with Web Locks', true],
        ['without Web Locks (the warning is asked first)', false],
    ])('the restore holds dbWriteLock, %s: the loop never commits afterwards and does not park', async (_name, webLocks) => {
        const page = await openPage({ webLocks })
        await commitEdit(page, 'second')
        const seedKey = page.k.seeded.manifestKey

        const { reload } = await runRestore(page)

        expect(reload).toHaveBeenCalledTimes(1)
        expect(vi.mocked(page.alert.alertConfirm).mock.calls.map((call) => call[0])).toEqual(webLocks ? [] : [language.restoreNoLockWarningConfirm])
        expect(await currentKey(page)).toBe(seedKey)
        page.k.counted.reset()
        page.db.mainPrompt = 'after the restore'
        page.flush()
        await sleepReal(400)
        expect(page.k.counted.writeCalls(), 'the loop wrote after the restore').toBe(0)
        expect(await currentKey(page)).toBe(seedKey)
        expect(page.loop.isSaveLoopParked()).toBe(false)
        expect(page.k.peer.clean.length + page.k.peer.asked.length, 'the loop raised a peer prompt').toBe(0)
        expect(await writeLockIsFree(page)).toBe(false)
    })

    test('the restored point becomes current, the previous current is kept as a restore point, and a clean tab is asked nothing', async () => {
        const page = await openPage()
        const seedKey = page.k.seeded.manifestKey
        const seedJson = JSON.stringify(await page.k.saved())
        await commitEdit(page, 'second')
        const before = await currentKey(page) as string

        const { reload } = await runRestore(page)

        expect(await currentKey(page)).toBe(seedKey)
        expect(JSON.stringify(await page.k.saved())).toBe(seedJson)
        expect((await page.k.commitKey()).retained.map((entry) => entry.key)).toContain(before)
        expect(reload).toHaveBeenCalledTimes(1)
        expect(page.alert.alertConfirm, 'a confirmation was asked of a saved tab').not.toHaveBeenCalled()
        expect(page.alert.alertWait).toHaveBeenCalledWith(language.store2RestoreDone)
    })
})

describe('the picker', () => {
    test('rows are the restore points as local date-times, newest first, without the current one; Cancel restores nothing', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        page.k.clock.advance(6 * 60 * 1000)
        await commitEdit(page, 'third')
        const key = await page.k.commitKey()
        vi.mocked(page.alert.alertSelect).mockImplementation(async (options: string[]) => {
            page.shown.push(options)
            return '0'
        })

        const { reload } = await runRestore(page)

        expect(page.shown).toHaveLength(1)
        const options = page.shown[0]
        expect(options).toHaveLength(1 + key.retained.length)
        expect(options[0]).toBe('Cancel')
        expect(key.retained).toHaveLength(2)
        expect(options.slice(1).every((text) => !text.includes('damaged'))).toBe(true)
        expect(reload).not.toHaveBeenCalled()
        expect(await writeLockIsFree(page)).toBe(true)
        expect((await page.k.commitKey()).current?.key).toBe(key.current?.key)
    })

    test('an empty list says why and asks nothing', async () => {
        const page = await openPage()

        const { reload } = await runRestore(page)

        expect(page.alert.alertNormal).toHaveBeenCalledWith(language.store2RestoreNone)
        expect(page.alert.alertSelect).not.toHaveBeenCalled()
        expect(reload).not.toHaveBeenCalled()
        expect(page.busy.isBusy()).toBe(false)
    })

    // The row stays listed and restorable-and-refused: the tree check is the one authority on whether a point is whole.
    test('a damaged point is listed as damaged and refused at the pick with nothing changed', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        const seedKey = page.k.seeded.manifestKey
        const before = await currentKey(page)
        page.k.memory.poke(seedKey, null)

        const { reload } = await runRestore(page)

        expect(page.shown[0][1]).toContain('(damaged)')
        expect(alertErrorTexts(page)[0]).toMatch(/^That saved version is incomplete \(\d+ parts? missing\)\. Nothing was changed\.$/)
        expect(reload).not.toHaveBeenCalled()
        expect(await currentKey(page)).toBe(before)
        expect(await writeLockIsFree(page)).toBe(true)
        expect(page.busy.isBusy()).toBe(false)
    })
})

describe('saving first', () => {
    // New behaviour, pinned by mutants: the state kept as a restore point is the committed one, so the tab's edits are saved before the list is
    // read. Saved after the pick, the list would be empty here (nothing is retained until the edit commits).
    test('unsaved edits are committed before the list is read', async () => {
        const page = await openPage()
        page.db.mainPrompt = 'unsaved edit'
        page.flush()
        let promptWhenListed: string | undefined
        vi.mocked(page.alert.alertSelect).mockImplementation(async (options: string[]) => {
            page.shown.push(options)
            promptWhenListed = (await page.k.saved()).mainPrompt
            return '0'
        })

        await runRestore(page)

        expect(promptWhenListed).toBe('unsaved edit')
        expect(page.shown).toHaveLength(1)
        expect(page.shown[0]).toHaveLength(2)
        expect(page.alert.alertWait).toHaveBeenCalledWith(language.store2RestoreSaving)
    })

    // New behaviour, pinned by mutants: a parked loop is not asked to save. `requestSaveNow` would mark the tab dirty and raise the peer prompt.
    test('a parked loop skips the save: no save is requested and no prompt is raised', async () => {
        const page = await openPage()
        await peerCommit(page.k, (db) => { db.mainPrompt = 'peer' })
        page.db.mainPrompt = 'mine'
        page.flush()
        await until(() => page.loop.isSaveLoopParked(), 'the loop to park on the peer commit')
        await sleepReal(100)
        const marks = page.w.api.getSaveMarkCount()
        const prompts = page.k.peer.asked.length + page.k.peer.clean.length
        vi.mocked(page.alert.alertSelect).mockImplementation(async (options: string[]) => {
            page.shown.push(options)
            return '0'
        })

        await runRestore(page)

        expect(page.shown, 'the picker was reached').toHaveLength(1)
        expect(page.w.api.getSaveMarkCount()).toBe(marks)
        expect(page.k.peer.asked.length + page.k.peer.clean.length).toBe(prompts)
    })

    test('a save that never commits is waited for no longer than the bound, and the restore goes on', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        // A frozen id keeps the tab from ever being clean without parking the loop.
        const stores = await import('src/ts/stores.svelte')
        stores.frozenSaveKeysStore.set([{ chaId: 'frozen', names: ['frozen'] }])
        const started = Date.now()

        await runRestore(page, { saveBoundMs: 300 })

        stores.frozenSaveKeysStore.set([])
        expect(Date.now() - started).toBeLessThan(5000)
        expect(page.shown).toHaveLength(1)
    })
})

describe('the confirmation after the pick', () => {
    // The tab is dirty for good here (parked): one confirmation names the loss, a refusal restores nothing and frees the lock.
    test('a tab that is still not saved is asked once, and a refusal changes nothing', async () => {
        const page = await openPage()
        await peerCommit(page.k, (db) => { db.mainPrompt = 'peer' })
        page.db.mainPrompt = 'mine'
        page.flush()
        await until(() => page.loop.isSaveLoopParked(), 'the loop to park on the peer commit')
        const before = await currentKey(page)
        vi.mocked(page.alert.alertConfirm).mockImplementation(async () => false)

        const { reload } = await runRestore(page)

        expect(page.alert.alertConfirm).toHaveBeenCalledTimes(1)
        expect(page.alert.alertConfirm).toHaveBeenCalledWith(language.store2RestoreUnsavedConfirm)
        expect(reload).not.toHaveBeenCalled()
        expect(await currentKey(page)).toBe(before)
        expect(await writeLockIsFree(page)).toBe(true)
        expect(page.busy.isBusy()).toBe(false)
    })

    test('a tab that is still not saved goes on after the person confirms', async () => {
        const page = await openPage()
        await peerCommit(page.k, (db) => { db.mainPrompt = 'peer' })
        page.db.mainPrompt = 'mine'
        page.flush()
        await until(() => page.loop.isSaveLoopParked(), 'the loop to park on the peer commit')

        const { reload } = await runRestore(page)

        expect(page.alert.alertConfirm).toHaveBeenCalledTimes(1)
        expect(reload).toHaveBeenCalledTimes(1)
        expect(await currentKey(page)).toBe(page.k.seeded.manifestKey)
    })

    // New behaviour, pinned by mutants: dirtiness is judged under the lock. An edit made while the restore waits for the lock is not saved
    // (the lock keeps the loop out), so it is asked about; a check made before the lock would not see it.
    test('an edit made while the restore waits for the write lock is asked about', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        let release: (() => void) | null = null
        vi.mocked(page.alert.alertSelect).mockImplementation(async (options: string[]) => {
            page.shown.push(options)
            release = await page.w.api.dbWriteLock.acquire()
            return '1'
        })

        const running = runRestore(page)
        await until(() => release !== null, 'the test to hold the write lock')
        await sleepReal(80)
        page.db.mainPrompt = 'late edit'
        page.flush()
        ;(release as unknown as () => void)()
        const { reload } = await running

        expect(page.alert.alertConfirm).toHaveBeenCalledTimes(1)
        expect(page.alert.alertConfirm).toHaveBeenCalledWith(language.store2RestoreUnsavedConfirm)
        expect(reload).toHaveBeenCalledTimes(1)
    })
})

describe('the busy entry and the tab lock', () => {
    test('the entry exists from the pick to the end, not while the picker is open, and is ended', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        let duringPicker: string[] = []
        vi.mocked(page.alert.alertSelect).mockImplementation(async (options: string[]) => {
            page.shown.push(options)
            duringPicker = page.busy.busyKinds()
            return '1'
        })

        const { registeredAtReload } = await runRestore(page)

        expect(duringPicker).toEqual([])
        expect(registeredAtReload).toEqual([['backupLoad']])
        expect(page.busy.isBusy()).toBe(false)
    })

    test('work that starts while the picker is open refuses the restore, which leaves no entry behind', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        const before = await currentKey(page)
        let end = () => {}
        vi.mocked(page.alert.alertSelect).mockImplementation(async (options: string[]) => {
            page.shown.push(options)
            const handle = page.busy.beginBusy('import')
            end = () => handle.end()
            return '1'
        })

        const { reload } = await runRestore(page)

        expect(alertErrorTexts(page)).toContain(language.backupLoadWorkInProgress)
        expect(reload).not.toHaveBeenCalled()
        expect(await currentKey(page)).toBe(before)
        expect(page.busy.busyKinds()).toEqual(['import'])
        end()
        expect(page.busy.isBusy()).toBe(false)
    })

    test('work in progress refuses the restore before anything is asked', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        const handle = page.busy.beginBusy('export')

        await runRestore(page)

        expect(alertErrorTexts(page)).toContain(language.backupLoadWorkInProgress)
        expect(page.alert.alertSelect).not.toHaveBeenCalled()
        handle.end()
    })

    test('another tab of the app refuses the restore: nothing changes, the lock is free and the loop saves on', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        const before = await currentKey(page)
        const other = makeSimulatedTab(page.locks, 'other')
        await other.locks.tabPresenceLockAcquired

        const { reload } = await runRestore(page)

        expect(alertErrorTexts(page)).toContain(language.restoreOtherTabRefused)
        expect(reload).not.toHaveBeenCalled()
        expect(await currentKey(page)).toBe(before)
        expect(page.busy.isBusy()).toBe(false)
        expect(await writeLockIsFree(page)).toBe(true)
        other.close()
        await commitEdit(page, 'saved after the refusal')
        expect((await page.k.saved()).mainPrompt).toBe('saved after the refusal')
    })

    test('a page without a session refuses before anything is asked', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        const bootActive = await import('src/ts/storage/store2/bootActive')
        bootActive.setStore2BootSession(null)

        const { reload } = await runRestore(page)

        expect(alertErrorTexts(page)).toContain(language.store2Boot.readOnlyRefusal)
        expect(page.alert.alertSelect).not.toHaveBeenCalled()
        expect(reload).not.toHaveBeenCalled()
    })
})

describe('outcomes', () => {
    /** A committer that answers `result` to every restore and otherwise behaves as the page's. */
    function answering(page: Page, result: WriteResult): Committer {
        return { ...page.k.committer, restore: async () => result }
    }

    async function pickWith(page: Page, result: WriteResult) {
        await commitEdit(page, 'second')
        page.useCommitter(answering(page, result))
        return await runRestore(page)
    }

    test('a point that is already current, or no longer named, says the list changed and restores nothing', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        const seedKey = page.k.seeded.manifestKey
        vi.mocked(page.alert.alertSelect).mockImplementation(async (options: string[]) => {
            page.shown.push(options)
            // The list changes under the picker: the chosen point becomes current.
            await page.k.committer.restore(await page.k.committer.readCommit(), seedKey)
            return '1'
        })

        const { reload } = await runRestore(page)

        expect(alertErrorTexts(page)).toContain(language.store2RestoreListChanged)
        expect(reload).not.toHaveBeenCalled()
        expect(await writeLockIsFree(page)).toBe(true)
        expect(page.busy.isBusy()).toBe(false)
    })

    test('a standing bulk marker says another save is in progress and writes nothing', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        const parsed = classifyCommitRead(await page.k.counted.backend.readCommit())
        if (parsed.status !== 'parsed') {
            throw new Error('the commit key did not parse')
        }
        const marker = { owner: 'q'.repeat(26), prefix: 'store2/g-0000000000000000-', startedAt: 5, label: 'bulk' } as const
        page.k.memory.poke(COMMIT_KEY, encodeUnit(UNIT_TYPE.commit, { ...parsed.value, staging: marker }))
        page.k.counted.reset()

        const { reload } = await runRestore(page)

        expect(alertErrorTexts(page)).toContain(language.store2RestoreBulkMarker)
        expect(reload).not.toHaveBeenCalled()
        expect(page.k.counted.writeCalls()).toBe(0)
        expect(await writeLockIsFree(page)).toBe(true)
    })

    // After a conflict or an unconfirmed write the restore may or may not have landed. The page does not claim
    // that nothing was restored, does not reload, and keeps the write lock closed.
    test.each([
        ['conflict', { status: 'conflict' }],
        ['unknown', { status: 'unknown' }],
    ] as const)('%s: the person is told to reload and nothing is claimed; the write lock stays closed; no reload is made', async (_name, shape) => {
        const page = await openPage()
        const result: WriteResult = shape.status === 'conflict'
            ? { status: 'conflict', current: await page.k.counted.backend.readCommit() } as unknown as WriteResult
            : { status: 'unknown', cause: new page.errors.Store2UnknownOutcomeError('lost') }

        const { reload } = await pickWith(page, result)

        expect(page.waitScreens).toEqual([{ type: 'wait', msg: language.store2RestoreUnconfirmed }])
        expect(alertErrorTexts(page)).not.toContain(language.store2RestoreListChanged)
        expect(reload).not.toHaveBeenCalled()
        expect(await writeLockIsFree(page)).toBe(false)
        expect(page.busy.isBusy()).toBe(false)
    })

    test('an error thrown after the restore began is treated as unconfirmed, with the write lock closed', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        page.useCommitter({ ...page.k.committer, restore: async () => { throw new Error('unexpected') } })

        const { reload } = await runRestore(page)

        expect(page.waitScreens).toEqual([{ type: 'wait', msg: language.store2RestoreUnconfirmed }])
        expect(reload).not.toHaveBeenCalled()
        expect(await writeLockIsFree(page)).toBe(false)
        expect(page.busy.isBusy()).toBe(false)
    })

    test('a failed write says nothing was changed, reloads nothing and frees the lock', async () => {
        const page = await openPage()

        const { reload } = await pickWith(page, { status: 'failed', cause: new page.errors.Store2BackendFailureError('no') })

        expect(alertErrorTexts(page)).toContain(language.internalBackupWriteFailed)
        expect(reload).not.toHaveBeenCalled()
        expect(await writeLockIsFree(page)).toBe(true)
        expect(page.busy.isBusy()).toBe(false)
    })

    test('a page that a newer page replaced says so and frees the lock', async () => {
        const page = await openPage()

        const { reload } = await pickWith(page, { status: 'failed', cause: new page.errors.Store2StalePageError('replaced') })

        expect(alertErrorTexts(page)).toContain(language.restoreNotHappenedNotice)
        expect(reload).not.toHaveBeenCalled()
        expect(await writeLockIsFree(page)).toBe(true)
    })

    // A Tauri commit that the device did not confirm as flushed is reported to the person and the page reloads; the
    // start-up re-flush of the commit key finishes it. The write lock stays closed like any landed restore.
    test('a landed restore the device did not confirm is told to the person and reloads once', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        const real = page.k.committer
        page.useCommitter({
            ...real,
            restore: async (read, key) => {
                const result = await real.restore(read, key)
                return result.status === 'committed' ? { ...result, flushed: false } : result
            },
        })

        const { reload } = await runRestore(page)

        expect(page.alert.alertNormalWait).toHaveBeenCalledWith(language.store2RestoreNotFlushed)
        expect(reload).toHaveBeenCalledTimes(1)
        expect(await currentKey(page)).toBe(page.k.seeded.manifestKey)
        expect(await writeLockIsFree(page)).toBe(false)
    })
})

describe('loadInternalBackup on a store2 page', () => {
    // Regression: on the base, a store2 page lists the numbered backups, reads the chosen one, strictly decodes and
    // rebuilds it before the old flow reports it cannot keep a copy. A store2 page lists them (as Old rows) but never
    // reads, writes or deletes one that is not picked.
    test('lists a numbered backup without reading it, shows the restore points and reloads once through the shared tail', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        page.w.store.plant('database/dbbackup-1700000000.bin', new Uint8Array([1, 2, 3, 4]))
        page.w.store.ops.length = 0
        const reloadSpy = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
        const replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})

        await page.internal.loadInternalBackup()

        const touched = page.w.store.ops.filter((op) => op.key.startsWith('database/dbbackup-') && op.kind !== 'list')
        expect(touched, 'numbered backups touched').toEqual([])
        expect(page.shown).toHaveLength(1)
        expect(page.shown[0]).toHaveLength(3)
        expect(page.shown[0][2]).toMatch(/^Old: /)
        expect(reloadSpy).toHaveBeenCalledTimes(1)
        expect(replaceStateSpy).toHaveBeenCalledTimes(1)
        expect(await currentKey(page)).toBe(page.k.seeded.manifestKey)
        expect(alertErrorTexts(page)).not.toContain(language.internalBackupCopyFailed)
        // The shared tail keeps the write lock closed for the life of the page.
        page.k.counted.reset()
        page.db.mainPrompt = 'after the restore'
        page.flush()
        await sleepReal(400)
        expect(page.k.counted.writeCalls(), 'the loop wrote after the restore').toBe(0)
        expect(await writeLockIsFree(page)).toBe(false)
        reloadSpy.mockRestore()
        replaceStateSpy.mockRestore()
    })
})

describe('old numbered backups as rows of the picker', () => {
    const OLD_TIME = 1700000000
    const NEWER_OLD_TIME = 1700000500
    const oldKey = (time: number) => `database/dbbackup-${time}.bin`

    /** The block-format main file of `db`, as the world's encoder writes it. */
    async function blockFileBytes(page: Page, db: Entry): Promise<Uint8Array> {
        const encoder = new page.w.risuSave.RisuSaveEncoder()
        await encoder.init(db as unknown as Database, { compression: false })
        await encoder.set(db as unknown as Database, { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false })
        return new Uint8Array(encoder.encode()!)
    }

    async function databaseOf(page: Page, manifestKey: string): Promise<Database> {
        const read = await readTreeBytes(page.k.memory, manifestKey)
        if (read.status !== 'ok') {
            throw new Error(`The stored tree reads ${read.status}.`)
        }
        return assembleDatabase(read.tree.manifest, read.tree.source)
    }

    const namesOf = (db: Database): string[] => (db.characters as unknown as { name: string }[]).map((character) => character.name).sort()

    /** Picks the row with the label `wanted` (the picker is shown once). */
    function pickLabelled(page: Page, wanted: (options: string[]) => number) {
        vi.mocked(page.alert.alertSelect).mockImplementation(async (options: string[]) => {
            page.shown.push(options)
            return String(wanted(options))
        })
    }

    const oldIndex = (options: string[]) => options.findIndex((label) => label.startsWith('Old: '))

    // Regression: on the base the picker lists restore points only, so a numbered backup cannot be chosen on a store2 page.
    test('regression: old backups follow the restore points, newest first, labelled Old with their date-time', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        page.w.store.plant(oldKey(OLD_TIME), new Uint8Array([1]))
        page.w.store.plant(oldKey(NEWER_OLD_TIME), new Uint8Array([1]))
        pickLabelled(page, () => 0)

        await runRestore(page)

        expect(page.shown).toHaveLength(1)
        const options = page.shown[0]
        expect(options).toHaveLength(1 + 1 + 2)
        expect(options[0]).toBe('Cancel')
        expect(options[1]).not.toMatch(/^Old: /)
        expect(options[2]).toBe(language.store2RestoreOldRow(new Date(NEWER_OLD_TIME * 100).toLocaleString()))
        expect(options[3]).toBe(language.store2RestoreOldRow(new Date(OLD_TIME * 100).toLocaleString()))
    })

    // Regression: on the base a chosen old row cannot be restored on a store2 page.
    test('regression: picking an old row imports it, keeps the previous state as the newest restore point and leaves the backup alone', async () => {
        const page = await openPage()
        const before = await currentKey(page) as string
        const bytes = await blockFileBytes(page, makeDb('old prompt', ['old-one', 'old-two']))
        page.w.store.plant(oldKey(OLD_TIME), bytes)
        pickLabelled(page, (options) => oldIndex(options))
        page.w.store.ops.length = 0

        const { reload, registeredAtReload } = await runRestore(page)

        const key = await page.k.commitKey()
        expect(key.current?.key).not.toBe(before)
        expect(key.retained[0].key).toBe(before)
        const stored = await databaseOf(page, key.current?.key as string)
        expect(namesOf(stored)).toEqual(['old-one', 'old-two'])
        expect(stored.mainPrompt).toBe('old prompt')
        expect(reload).toHaveBeenCalledTimes(1)
        expect(registeredAtReload).toEqual([['backupLoad']])
        expect(page.alert.alertWait).toHaveBeenCalledWith(language.store2ImportDone)
        expect(page.w.store.mutating().filter((op) => op.key.startsWith('database/dbbackup-'))).toEqual([])
        expect(page.w.store.peek(oldKey(OLD_TIME))).toEqual(bytes)
        expect(await writeLockIsFree(page)).toBe(false)
    })

    test('the empty message is shown only when there are neither restore points nor old backups', async () => {
        const page = await openPage()
        page.w.store.plant(oldKey(OLD_TIME), new Uint8Array([1]))
        pickLabelled(page, () => 0)

        await runRestore(page)

        expect(page.alert.alertNormal).not.toHaveBeenCalledWith(language.store2RestoreNone)
        expect(page.shown[0]).toHaveLength(2)
    })

    // New behaviour, pinned by mutants: a backup in an older format decodes strictly; only a file that does not is salvaged.
    test('an old backup in an older msgpack format imports', async () => {
        const page = await openPage()
        const before = await currentKey(page) as string
        const db = makeDb('legacy format', ['legacy-one']) as unknown as Database
        page.w.store.plant(oldKey(OLD_TIME), new Uint8Array(await page.w.risuSave.encodeRisuSaveLegacy(db, 'noCompression')))
        pickLabelled(page, (options) => oldIndex(options))

        const { reload } = await runRestore(page)

        expect(alertErrorTexts(page)).toEqual([])
        expect(reload).toHaveBeenCalledTimes(1)
        const key = await page.k.commitKey()
        expect(key.retained[0].key).toBe(before)
        expect(namesOf(await databaseOf(page, key.current?.key as string))).toEqual(['legacy-one'])
    })

    test('an old backup that holds no database is refused whole with nothing changed', async () => {
        const page = await openPage()
        const before = await currentKey(page)
        page.w.store.plant(oldKey(OLD_TIME), new Uint8Array([1, 2, 3, 4]))
        pickLabelled(page, (options) => oldIndex(options))
        page.w.store.ops.length = 0

        const { reload } = await runRestore(page)

        expect(alertErrorTexts(page)).toContain(language.internalBackupUnreadable)
        expect(reload).not.toHaveBeenCalled()
        expect(await currentKey(page)).toBe(before)
        expect(page.w.store.mutating()).toEqual([])
        expect(await writeLockIsFree(page)).toBe(true)
        expect(page.busy.isBusy()).toBe(false)
    })

    // New behaviour, pinned by mutants: a salvaged backup names everything it leaves out, and a decline changes nothing.
    test('a partly damaged old backup names what it leaves out, and a decline changes nothing', async () => {
        const page = await openPage()
        const before = await currentKey(page)
        page.w.store.plant(oldKey(OLD_TIME), breakDataChecksum(await blockFileBytes(page, makeDb('old', ['alpha', 'omega'])), 'omega'))
        pickLabelled(page, (options) => oldIndex(options))
        vi.mocked(page.alert.alertConfirm).mockImplementation(async () => false)
        page.w.store.ops.length = 0

        const { reload } = await runRestore(page)

        const questions = vi.mocked(page.alert.alertConfirm).mock.calls.map((call) => String(call[0]))
        expect(questions).toHaveLength(1)
        expect(questions[0]).toContain('omega')
        expect(reload).not.toHaveBeenCalled()
        expect(await currentKey(page)).toBe(before)
        expect(page.w.store.mutating()).toEqual([])
        expect(await writeLockIsFree(page)).toBe(true)
    })

    test('after the person accepts, the intact parts of a damaged old backup are imported', async () => {
        const page = await openPage()
        page.w.store.plant(oldKey(OLD_TIME), breakDataChecksum(await blockFileBytes(page, makeDb('old', ['alpha', 'omega'])), 'omega'))
        pickLabelled(page, (options) => oldIndex(options))

        const { reload } = await runRestore(page)

        expect(reload).toHaveBeenCalledTimes(1)
        expect(namesOf(await databaseOf(page, (await currentKey(page)) as string))).toEqual(['alpha'])
    })

    // New behaviour, pinned by mutants: a large database is announced, naming its size, before it is decoded.
    test('a large old backup is announced before it is decoded, and a decline changes nothing', async () => {
        const page = await openPage()
        const before = await currentKey(page)
        // 81,000,000 bytes is 77.2 MiB but 81 decimal megabytes, the figure the warning must name.
        page.w.store.plant(oldKey(OLD_TIME), new Uint8Array(81_000_000))
        pickLabelled(page, (options) => oldIndex(options))
        vi.mocked(page.alert.alertConfirm).mockImplementation(async () => false)
        page.w.store.ops.length = 0

        const { reload } = await runRestore(page)

        expect(vi.mocked(page.alert.alertConfirm).mock.calls.map((call) => String(call[0]))).toEqual([language.store2ImportSizeWarning(81)])
        // The decline, not a failed decode of the zero-filled bytes, is what stopped it.
        expect(alertErrorTexts(page)).toEqual([])
        expect(reload).not.toHaveBeenCalled()
        expect(await currentKey(page)).toBe(before)
        expect(page.w.store.mutating()).toEqual([])
    })

    // New behaviour, pinned by mutants: with no tab hold the landed Old-row import keeps dbWriteLock closed (a hold would close it anyway).
    test('without Web Locks a landed old row keeps the write lock closed', async () => {
        const page = await openPage({ webLocks: false })
        page.w.store.plant(oldKey(OLD_TIME), await blockFileBytes(page, makeDb('old prompt', ['old-one'])))
        pickLabelled(page, (options) => oldIndex(options))

        const { reload } = await runRestore(page)

        expect(reload).toHaveBeenCalledTimes(1)
        expect(namesOf(await databaseOf(page, (await currentKey(page)) as string))).toEqual(['old-one'])
        expect(await writeLockIsFree(page)).toBe(false)
    })
    test('a backup that was removed after the list was shown says the list changed', async () => {
        const page = await openPage()
        const before = await currentKey(page)
        page.w.store.plant(oldKey(OLD_TIME), new Uint8Array([1]))
        vi.mocked(page.alert.alertSelect).mockImplementation(async (options: string[]) => {
            page.shown.push(options)
            page.w.store.unplant(oldKey(OLD_TIME))
            return String(oldIndex(options))
        })

        const { reload } = await runRestore(page)

        expect(alertErrorTexts(page)).toContain(language.store2RestoreListChanged)
        expect(reload).not.toHaveBeenCalled()
        expect(await currentKey(page)).toBe(before)
    })

    test('work that starts while the picker is open refuses an old row too, which leaves no entry behind', async () => {
        const page = await openPage()
        const before = await currentKey(page)
        page.w.store.plant(oldKey(OLD_TIME), await blockFileBytes(page, makeDb('old', ['old-one'])))
        let end = () => { }
        vi.mocked(page.alert.alertSelect).mockImplementation(async (options: string[]) => {
            page.shown.push(options)
            const handle = page.busy.beginBusy('import')
            end = () => handle.end()
            return String(oldIndex(options))
        })

        const { reload } = await runRestore(page)

        expect(alertErrorTexts(page)).toContain(language.backupLoadWorkInProgress)
        expect(reload).not.toHaveBeenCalled()
        expect(await currentKey(page)).toBe(before)
        end()
        expect(page.busy.isBusy()).toBe(false)
    })
})
