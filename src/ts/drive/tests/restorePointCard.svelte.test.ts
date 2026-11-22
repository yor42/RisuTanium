/**
 * The restore of a restore point or an old numbered backup on the task card (`loadStoreRestorePoint` with `card: true`),
 * and the Cancel that is accepted only before the point of no return (the first write of the restore).
 *
 * Runs over the real, unmocked `saveDb()` store2 loop in a world of its own (`saveLoopWorld.ts`, `store2SaveKit.ts`),
 * against an in-memory store2 backend and a fake Web Locks manager. The world has its own module graph, so the card
 * slot is read through `page.task`, the instance the restore under test opened. A restore result is a committer double
 * where a test needs one (as `storeRestore.svelte.test.ts` does); the library's own mapping of a real write is
 * `restorePoints.test.ts`. A mocked success here is not evidence of native or device behaviour.
 *
 * Labels: RR = regression reproducer (red on the base, where the restore shows wait dialogs and offers no Cancel);
 * CG = compatibility guard (passes before and after).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView, makeSimulatedTab } from 'src/ts/storage/tests/fakeWebLocks'
import { language } from 'src/lang'
import type { Committer, WriteResult } from 'src/ts/storage/store2/commit'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Database } from 'src/ts/storage/database.svelte'
import type { ExclusiveHoldRelease } from 'src/ts/drive/storeRestore'
import type { OperationEnd } from 'src/ts/drive/operationEnd'
import type { ImportFacts } from 'src/ts/drive/operationEnd'

vi.setConfig({ testTimeout: 40_000 })

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

/** The busy re-check of `runExclusively` calls this hook when a test sets it: the turn between the last checkpoint and the lock. */
const guardBox = vi.hoisted(() => ({ onCall: null as ((call: number) => void) | null, calls: 0 }))

/** The seam's `leave` throws when a test sets it (SP-T12). */
const seamBox = vi.hoisted(() => ({ leaveThrows: false }))

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
    guardBox.onCall = null
    guardBox.calls = 0
    seamBox.leaveThrows = false
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
    // The busy guard otherwise behaves as today for these runs (nothing is busy); SP-C3 uses the call hook.
    vi.doMock('src/ts/drive/backupWorkGuard', () => ({
        refuseBackupLoadWhileBusy: () => {
            guardBox.calls += 1
            guardBox.onCall?.(guardBox.calls)
            return false
        },
    }))
    // SP-T12: a card seam whose `leave` throws, over the real module.
    vi.doMock('src/ts/drive/restoreProgress', async (importOriginal) => {
        const actual = await importOriginal<typeof import('src/ts/drive/restoreProgress')>()
        return {
            ...actual,
            cardRestoreProgress: (...args: Parameters<typeof actual.cardRestoreProgress>) => {
                const real = actual.cardRestoreProgress(...args)
                return {
                    ...real,
                    get cancelRequested() { return real.cancelRequested },
                    leave: () => {
                        // Only the first leave throws: the one on the landed path, as a broken card host would.
                        if (seamBox.leaveThrows) {
                            seamBox.leaveThrows = false
                            throw new Error('the seam broke')
                        }
                        real.leave()
                    },
                }
            },
        }
    })
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(() => {
    worlds.parkAll()
    vi.doMock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }))
    vi.doUnmock('src/ts/drive/backupWorkGuard')
    vi.doUnmock('src/ts/drive/restoreProgress')
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
    busy: typeof import('src/ts/process/memory/busyActions')
    restore: typeof import('src/ts/drive/storeRestore')
    internal: typeof import('src/ts/drive/internalBackup')
    /** The card slot of this world. */
    task: typeof import('src/ts/alertTask.svelte')
    locks: FakeLockManagerCore
    /** What the page put on the non-dismissible wait screen. */
    waitScreens: Array<{ type: string, msg: string }>
    useCommitter(committer: Committer): void
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
    const task = await import('src/ts/alertTask.svelte')
    // One second per read, so every card report reaches the published view at once.
    let tick = 0
    task.setTaskClockForTests({ now: () => (tick += 1000), setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (timer) => clearTimeout(timer), hidden: () => false })
    const page: Page = {
        w,
        k,
        db: h.db,
        flush: flushSync,
        alert: await import('src/ts/alert'),
        busy: await import('src/ts/process/memory/busyActions'),
        restore: await import('src/ts/drive/storeRestore'),
        internal: await import('src/ts/drive/internalBackup'),
        task,
        locks,
        waitScreens: [],
        useCommitter(committer) {
            bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer } as unknown as Store2Session)
        },
    }
    page.useCommitter(k.committer)
    w.pageMode.setPageStorageMode({ kind: 'store2' })
    vi.mocked(page.alert.alertConfirm).mockImplementation(async () => true)
    vi.spyOn(page.alert.alertStore, 'set').mockImplementation((data) => { page.waitScreens.push({ type: data.type, msg: data.msg }) })
    vi.mocked(page.alert.alertSelect).mockImplementation(async () => '1')
    w.start()
    await sleepReal(150)
    await settled(w)
    return page
}

async function commitEdit(page: Page, prompt: string): Promise<void> {
    await nextCommit(page.w, () => {
        page.db.mainPrompt = prompt
        page.flush()
    })
}

function gateOf(): { gate: Promise<void>, open: () => void } {
    let open: () => void = () => { }
    const gate = new Promise<void>((resolve) => { open = resolve })
    return { gate, open }
}

interface Started {
    flow: Promise<OperationEnd<ImportFacts>>
    reload: ReturnType<typeof vi.fn<(hold: ExclusiveHoldRelease | null) => Promise<void>>>
}

function startRestore(page: Page, options: { card?: true, reloadThrows?: boolean } = {}): Started {
    const reload = vi.fn(async (hold: ExclusiveHoldRelease | null) => {
        if (options.reloadThrows === true) {
            throw new Error('reload failed')
        }
        if (hold) {
            await hold(true)
        }
    })
    const flow = page.restore.loadStoreRestorePoint({ reload, saveBoundMs: 3000, ...(options.card === true ? { card: true as const } : {}) })
    return { flow, reload }
}

async function writeLockIsFree(page: Page): Promise<boolean> {
    const taken = page.w.api.dbWriteLock.acquire().then((release) => { release(); return true })
    return await Promise.race([taken, sleepReal(250).then(() => false)])
}

const view = (page: Page) => page.task.taskHostView()
const waitTexts = (page: Page): unknown[] => vi.mocked(page.alert.alertWait).mock.calls.map((call) => call[0])
const alertErrorTexts = (page: Page): unknown[] => vi.mocked(page.alert.alertError).mock.calls.map((call) => call[0])

/** A committer that answers `result` to every restore after `before` ran, and otherwise behaves as the page's. */
function answering(page: Page, result: WriteResult | 'real' | 'unflushed', before: () => void = () => { }): Committer {
    return {
        ...page.k.committer,
        restore: async (...args: Parameters<Committer['restore']>) => {
            before()
            if (result === 'real') return await page.k.committer.restore(...args)
            if (result === 'unflushed') {
                const real = await page.k.committer.restore(...args)
                return real.status === 'committed' ? { ...real, flushed: false } : real
            }
            return result
        },
    }
}

/** A restore with one restore point listed and a held save: the unsaved edit makes the first step wait. */
async function pageWithHeldSave(): Promise<{ page: Page, commitGate: ReturnType<typeof gateOf>, held: () => number }> {
    const commitGate = gateOf()
    let held = 0
    const page = await openPage({
        loopCommitter: (real) => ({
            ...real,
            async commit(...args: Parameters<Committer['commit']>) {
                held += 1
                await commitGate.gate
                return await real.commit(...args)
            },
        }),
    })
    page.db.mainPrompt = 'unsaved edit'
    page.flush()
    return { page, commitGate, held: () => held }
}

describe('the restore point on the task card', () => {
    test('SP-T1/SP-T2 (RR): save is shown with Cancel, the commit with the MC-2620 lock, then no card and only the done wait', async () => {
        const { page, commitGate, held } = await pageWithHeldSave()
        let atCommit: { shown: boolean, cancelOffered: boolean | undefined, title: string | undefined } | null = null
        page.useCommitter(answering(page, 'real', () => {
            atCommit = { shown: page.task.taskShown(), cancelOffered: view(page)?.cancelOffered, title: view(page)?.title }
        }))
        const { flow, reload } = startRestore(page, { card: true })

        await until(() => held() >= 1 && page.task.taskShown(), 'the save-first card')
        expect(view(page)?.title).toBe(language.restorePointTaskTitle)
        expect(view(page)?.stepIndex).toBe(0)
        expect(view(page)?.cancelOffered).toBe(true)
        commitGate.open()
        await flow

        expect(atCommit).toEqual({ shown: true, cancelOffered: false, title: language.restorePointTaskTitle })
        expect(page.task.taskShown()).toBe(false)
        expect(page.task.taskResultShowing()).toBe(false)
        expect(waitTexts(page)).toEqual([language.store2RestoreDone])
        expect(reload).toHaveBeenCalledTimes(1)
        expect(await writeLockIsFree(page)).toBe(false)
    })

    test('SP-T3 (RR): a landed restore the device did not confirm leaves the card before its notice and shows no result card', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        const seen: boolean[] = []
        vi.mocked(page.alert.alertNormalWait).mockImplementation(async () => { seen.push(page.task.taskShown()) })
        const stillShown: boolean[] = []
        page.useCommitter(answering(page, 'unflushed', () => { stillShown.push(page.task.taskShown()) }))
        const { flow } = startRestore(page, { card: true })
        await flow

        expect(stillShown).toEqual([true])
        expect(seen).toEqual([false])
        expect(page.task.taskResultShowing()).toBe(false)
    })

    test('SP-T4 (RR): an unconfirmed outcome posts the closeless wait, leaves the card and keeps the write lock closed', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        const errors = await import('src/ts/storage/store2/backend/errors')
        page.useCommitter(answering(page, { status: 'unknown', cause: new errors.Store2UnknownOutcomeError('lost') }))
        const { flow, reload } = startRestore(page, { card: true })
        await flow

        expect(page.waitScreens).toEqual([{ type: 'wait', msg: language.store2RestoreUnconfirmed }])
        expect(page.task.taskShown()).toBe(false)
        expect(reload).not.toHaveBeenCalled()
        expect(await writeLockIsFree(page)).toBe(false)
    })

    test('SP-T5 (RR): a reload that throws after landing, and a throw after started, end on today\'s surfaces with no card', async () => {
        const landed = await openPage()
        await commitEdit(landed, 'second')
        const first = startRestore(landed, { card: true, reloadThrows: true })
        await first.flow
        expect(waitTexts(landed)).toContain(language.restoreSavedReloadOrRestart)
        expect(landed.task.taskShown()).toBe(false)
        expect(await writeLockIsFree(landed)).toBe(false)
    })

    test('SP-T5b (RR): a throw after started is unconfirmed, with no card and the lock closed', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        page.useCommitter({ ...page.k.committer, restore: async () => { throw new Error('unexpected') } })
        const { flow } = startRestore(page, { card: true })
        await flow

        expect(page.waitScreens).toEqual([{ type: 'wait', msg: language.store2RestoreUnconfirmed }])
        expect(page.task.taskShown()).toBe(false)
        expect(await writeLockIsFree(page)).toBe(false)
    })

    test('SP-T6 (RR): the other-tab refusal and a stale page show today\'s message, leave no card and free the lock', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        const errors = await import('src/ts/storage/store2/backend/errors')
        const other = makeSimulatedTab(page.locks, 'other')
        await other.locks.tabPresenceLockAcquired
        const refused = startRestore(page, { card: true })
        await refused.flow

        expect(alertErrorTexts(page)).toContain(language.restoreOtherTabRefused)
        expect(page.task.taskShown()).toBe(false)
        expect(await writeLockIsFree(page)).toBe(true)
        other.close()

        page.useCommitter(answering(page, { status: 'failed', cause: new errors.Store2StalePageError('replaced') }))
        const stale = startRestore(page, { card: true })
        await stale.flow
        expect(alertErrorTexts(page)).toContain(language.restoreNotHappenedNotice)
        expect(page.task.taskShown()).toBe(false)
        expect(await writeLockIsFree(page)).toBe(true)
    })

    test('SP-T7 (RR): the picker\'s Cancel row ends silently: the card is behind the picker, then gone with no result', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        const atPicker: boolean[] = []
        vi.mocked(page.alert.alertSelect).mockImplementation(async () => {
            atPicker.push(page.task.taskShown())
            return '0'
        })
        const { flow, reload } = startRestore(page, { card: true })
        const end = await flow

        expect(atPicker).toEqual([true])
        expect(end.outcome).toBe('canceled')
        expect(page.task.taskShown()).toBe(false)
        expect(page.task.taskResultShowing()).toBe(false)
        expect(reload).not.toHaveBeenCalled()
        expect(alertErrorTexts(page)).toEqual([])
    })

    test('SP-T9 (CG): without the card flag the legacy waits are shown and no card opens', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        const shown: boolean[] = []
        page.useCommitter(answering(page, 'real', () => { shown.push(page.task.taskShown()) }))
        const { flow } = startRestore(page)
        await flow

        expect(shown).toEqual([false])
        expect(waitTexts(page)).toContain(language.backupRestoreLoading)
        expect(waitTexts(page)).toContain(language.store2RestoreDone)
    })

    test('SP-T10 (RR): Back while the commit is held at load does nothing: the card stays, offers no Cancel, and the restore lands', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        const commitGate = gateOf()
        let atCommit = false
        page.useCommitter({
            ...page.k.committer,
            restore: async (...args: Parameters<Committer['restore']>) => {
                atCommit = true
                await commitGate.gate
                return await page.k.committer.restore(...args)
            },
        })
        const { flow, reload } = startRestore(page, { card: true })
        await until(() => atCommit, 'the commit')
        page.task.requestTaskCancel()
        page.task.taskBackPress()

        expect(page.task.taskShown()).toBe(true)
        expect(view(page)?.cancelOffered).toBe(false)
        expect(view(page)?.state).toBe('running')
        commitGate.open()
        await flow
        expect(reload).toHaveBeenCalledTimes(1)
        expect(page.task.taskResultShowing()).toBe(false)
    })

    test('SP-T11 (RR): a newer task replaces the card mid-restore: the restore lands, the done wait is posted and the newer card stays', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        const commitGate = gateOf()
        let atCommit = false
        page.useCommitter({
            ...page.k.committer,
            restore: async (...args: Parameters<Committer['restore']>) => {
                atCommit = true
                await commitGate.gate
                return await page.k.committer.restore(...args)
            },
        })
        const { flow, reload } = startRestore(page, { card: true })
        await until(() => atCommit, 'the commit')
        page.task.alertTask({ title: 'Newer task', steps: [{ label: 'Step' }] })
        commitGate.open()
        await flow

        expect(reload).toHaveBeenCalledTimes(1)
        expect(waitTexts(page)).toContain(language.store2RestoreDone)
        expect(view(page)?.title).toBe('Newer task')
    })

    test('SP-T11b (RR): a newer task replacing the card during the held save does not cancel the restore: it commits and the newer card stays', async () => {
        const { page, commitGate, held } = await pageWithHeldSave()
        const { flow, reload } = startRestore(page, { card: true })
        await until(() => held() >= 1 && page.task.taskShown(), 'the save-first card')
        let resultSeen = false
        const spyResult = setInterval(() => { resultSeen = resultSeen || page.task.taskResultShowing() }, 2)
        page.task.alertTask({ title: 'Newer task', steps: [{ label: 'Step' }] })
        commitGate.open()
        const end = await flow
        clearInterval(spyResult)

        expect(end.outcome).toBe('committed')
        expect(reload).toHaveBeenCalledTimes(1)
        expect(view(page)?.title).toBe('Newer task')
        expect(resultSeen).toBe(false)
        expect(page.task.taskResultShowing()).toBe(false)
    })

    test('SP-T12 (RR): a seam whose leave throws on the landed path still ends committed with the lock closed, never as a failed write', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        seamBox.leaveThrows = true
        const { flow } = startRestore(page, { card: true })
        const end = await flow

        expect(end.outcome).toBe('committed')
        expect(alertErrorTexts(page)).not.toContain(language.internalBackupWriteFailed)
        expect(waitTexts(page)).toContain(language.restoreSavedReloadOrRestart)
        expect(await writeLockIsFree(page)).toBe(false)
    })
})

describe('an old numbered backup on the card', () => {
    const OLD_TIME = 1700000000
    const oldKey = (time: number) => `database/dbbackup-${time}.bin`

    async function blockFileBytes(page: Page, db: Entry): Promise<Uint8Array> {
        const encoder = new page.w.encoderFixture.RisuSaveEncoder()
        await encoder.init(db as unknown as Database, { compression: false })
        await encoder.set(db as unknown as Database, { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false })
        return new Uint8Array(encoder.encode()!)
    }

    const oldIndex = (options: string[]) => options.findIndex((label) => label.startsWith('Old: '))

    test('SP-T8 (RR): after the pick the card is the older-backup card at Read the backup, the commit is locked, and the run lands with no card', async () => {
        const page = await openPage()
        page.w.store.plant(oldKey(OLD_TIME), await blockFileBytes(page, makeDb('old prompt', ['old-one', 'old-two'])))
        vi.mocked(page.alert.alertSelect).mockImplementation(async (options: string[]) => String(oldIndex(options)))
        const atAnnounce: { title: string | undefined, step: number | undefined }[] = []
        // The first surface after the commit is the import's done wait: the card is gone by then.
        vi.mocked(page.alert.alertWait).mockImplementation((msg) => {
            atAnnounce.push({ title: view(page)?.title, step: view(page)?.stepIndex })
            return { type: 'wait', msg }
        })
        const titles: Array<string | undefined> = []
        const unsubscribe = setInterval(() => { titles.push(view(page)?.title) }, 5)
        const { flow, reload } = startRestore(page, { card: true })
        await flow
        clearInterval(unsubscribe)

        expect(titles).toContain(language.restoreOldTaskTitle)
        expect(page.task.taskShown()).toBe(false)
        expect(page.task.taskResultShowing()).toBe(false)
        expect(reload).toHaveBeenCalledTimes(1)
        expect(waitTexts(page)).toContain(language.store2ImportDone)
        expect(atAnnounce.every((entry) => entry.title === undefined)).toBe(true)
    })

    test('SP-C5 (RR): a Cancel pending when an old backup is picked ends on the cancelled older-backup card with no commit and no hold', async () => {
        const page = await openPage()
        page.w.store.plant(oldKey(OLD_TIME), await blockFileBytes(page, makeDb('old prompt', ['old-one', 'old-two'])))
        vi.mocked(page.alert.alertSelect).mockImplementation(async (options: string[]) => {
            page.task.requestTaskCancel()
            return String(oldIndex(options))
        })
        const before = (await page.k.commitKey()).current?.key
        const { flow, reload } = startRestore(page, { card: true })
        const end = await flow

        expect(end.outcome).toBe('canceled')
        expect(page.task.taskResultShowing()).toBe(true)
        expect(view(page)?.title).toBe(language.restoreOldTaskTitle)
        expect(view(page)?.cancelled).toBe(true)
        expect((await page.k.commitKey()).current?.key).toBe(before)
        expect(reload).not.toHaveBeenCalled()
        expect(page.busy.isBusy()).toBe(false)
        expect(await writeLockIsFree(page)).toBe(true)
    })
})

describe('Cancel before the point of no return', () => {
    test.each([['SP-C1', false], ['SP-C1b', true]])('%s (RR): a Cancel (or Back) during the held save ends on the cancelled card: no picker, no busy entry, nothing restored', async (_id, viaBack) => {
        {
            const { page, commitGate, held } = await pageWithHeldSave()
            const restoreSpy = vi.fn()
            page.useCommitter(answering(page, 'real', restoreSpy))
            const { flow, reload } = startRestore(page, { card: true })
            await until(() => held() >= 1 && page.task.taskShown(), 'the save-first card')
            if (viaBack) {
                page.task.taskBackPress()
            } else {
                page.task.requestTaskCancel()
            }
            commitGate.open()
            const end = await flow

            expect(end.outcome).toBe('canceled')
            expect(page.task.taskResultShowing()).toBe(true)
            expect(view(page)?.cancelled).toBe(true)
            expect(vi.mocked(page.alert.alertSelect)).not.toHaveBeenCalled()
            expect(page.busy.busyKinds()).toEqual([])
            expect(restoreSpy).not.toHaveBeenCalled()
            expect(reload).not.toHaveBeenCalled()
            expect(await writeLockIsFree(page)).toBe(true)
            page.task.answerTask({ kind: 'ok' })
            expect(page.task.taskShown()).toBe(false)
        }
    })

    test('SP-C2 (RR): a Cancel at Check other tabs ends cancelled and the exclusive hold is released', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        const restoreSpy = vi.fn()
        page.useCommitter(answering(page, 'real', restoreSpy))
        const other = makeSimulatedTab(page.locks, 'other')
        await other.locks.tabPresenceLockAcquired
        const { flow, reload } = startRestore(page, { card: true })
        await until(() => view(page)?.stepIndex === 1, 'the tabs step')
        page.task.requestTaskCancel()
        other.close()
        const end = await flow

        expect(end.outcome).toBe('canceled')
        expect(page.task.taskResultShowing()).toBe(true)
        expect(restoreSpy).not.toHaveBeenCalled()
        expect(reload).not.toHaveBeenCalled()
        expect(alertErrorTexts(page)).toEqual([])
        expect(await writeLockIsFree(page)).toBe(true)
    })

    test('SP-C2b (RR): on a page without the tabs step a Cancel while the write lock is awaited ends cancelled and frees it', async () => {
        vi.doMock('src/ts/platform', () => ({ isTauri: true, isNodeServer: false, isIOS: () => false }))
        const page = await openPage()
        await commitEdit(page, 'second')
        const restoreSpy = vi.fn()
        page.useCommitter(answering(page, 'real', restoreSpy))
        const releaseOther = await page.w.api.dbWriteLock.acquire()
        const { flow } = startRestore(page, { card: true })
        await until(() => page.task.taskShown() && guardBox.calls >= 2, 'the restore waiting for the write lock')
        page.task.requestTaskCancel()
        releaseOther()
        const end = await flow

        expect(end.outcome).toBe('canceled')
        expect(page.task.taskResultShowing()).toBe(true)
        expect(restoreSpy).not.toHaveBeenCalled()
        expect(await writeLockIsFree(page)).toBe(true)
    })

    test('SP-C3 (RR): a Cancel in the turn between the last checkpoint and the lock refuses the lock: nothing restored, locks released', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        const restoreSpy = vi.fn()
        page.useCommitter(answering(page, 'real', restoreSpy))
        // Calls: the entry guard, the busy check of `runExclusively`, then its re-check at the flip.
        guardBox.onCall = (call) => { if (call === 3) page.task.requestTaskCancel() }
        const { flow, reload } = startRestore(page, { card: true })
        const end = await flow

        expect(guardBox.calls).toBeGreaterThanOrEqual(3)
        expect(end.outcome).toBe('canceled')
        expect(page.task.taskResultShowing()).toBe(true)
        expect(restoreSpy).not.toHaveBeenCalled()
        expect(reload).not.toHaveBeenCalled()
        expect(await writeLockIsFree(page)).toBe(true)
    })

    test('SP-C4 (RR): a Cancel and Back right after the lock are refused: the restore lands and no result card ever shows', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        let resultSeen = false
        let afterCancel: { cancelOffered: boolean | undefined, state: string | undefined } | null = null
        const spyResult = setInterval(() => { resultSeen = resultSeen || page.task.taskResultShowing() }, 2)
        page.useCommitter(answering(page, 'real', () => {
            page.task.requestTaskCancel()
            page.task.taskBackPress()
            afterCancel = { cancelOffered: view(page)?.cancelOffered, state: view(page)?.state }
        }))
        const { flow, reload } = startRestore(page, { card: true })
        const end = await flow
        clearInterval(spyResult)

        expect(afterCancel).toEqual({ cancelOffered: false, state: 'running' })
        expect(end.outcome).toBe('committed')
        expect(resultSeen).toBe(false)
        expect(page.task.taskResultShowing()).toBe(false)
        expect(waitTexts(page)).toContain(language.store2RestoreDone)
        expect(reload).toHaveBeenCalledTimes(1)
    })
})
