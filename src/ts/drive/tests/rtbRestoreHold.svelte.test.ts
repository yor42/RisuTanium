/**
 * The tab hold of a `.rtb` restore and the helpers its commit step calls before the flip (CHORE-128 S11, R0.3-R0.4 and the
 * I-gate helpers), over a real page of the application: the real `saveDb()` store2 loop in a world of its own, the real
 * `dbWriteLock`, the real storage tab locks over a fake Web Locks manager, the real `UnsavedGuard` and busy registry, and an
 * in-memory store2 backend (the pattern of `storeRestore.svelte.test.ts`). A mocked lock manager says nothing about a
 * browser's Web Locks.
 *
 * Labels: every test is a compatibility guard of a new contract (no pre-fix base); each turns red on a named scratch
 * mutant, not on a pre-fix run.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, peerCommit, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView, makeSimulatedTab } from 'src/ts/storage/tests/fakeWebLocks'
import { language } from 'src/lang'
import { encodeUnit, UNIT_TYPE, type CommitKey } from 'src/ts/storage/store2/format'
import { IMPORT_REPLACES_BASE, type BuildContext, type CommitRequest, type Committer } from 'src/ts/storage/store2/commit'
import { BULK_UNIT_THRESHOLD } from 'src/ts/storage/store2/backend/types'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Database } from 'src/ts/storage/database.svelte'
import { importSourceOfBytes } from 'src/ts/importSource'
import { exportClosure } from 'src/ts/storage/store2/rtb/exportClosure'
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
    loop: typeof import('src/ts/storage/store2/saveLoop')
    plan: typeof import('src/ts/drive/rtbRestorePlan')
    hold: typeof import('src/ts/drive/rtbRestoreHold')
    reloadGuard: typeof import('src/ts/reloadGuard')
    locks: FakeLockManagerCore
}

async function openPage(options: { webLocks?: boolean, tauri?: boolean } = {}): Promise<Page> {
    platformBox.isTauri = options.tauri === true
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
        plan: await import('src/ts/drive/rtbRestorePlan'),
        hold: await import('src/ts/drive/rtbRestoreHold'),
        reloadGuard: await import('src/ts/reloadGuard'),
        locks,
    }
    bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer: k.committer } as unknown as Store2Session)
    w.pageMode.setPageStorageMode({ kind: 'store2' })
    vi.mocked(page.alert.alertConfirm).mockImplementation(async () => true)
    w.start()
    await sleepReal(150)
    return page
}

async function writeLockIsFree(page: Page): Promise<boolean> {
    const taken = page.w.api.dbWriteLock.acquire().then((release) => { release(); return true })
    return await Promise.race([taken, sleepReal(250).then(() => false)])
}

const alertErrorTexts = (page: Page): unknown[] => vi.mocked(page.alert.alertError).mock.calls.map((call) => call[0])
const confirmTexts = (page: Page): unknown[] => vi.mocked(page.alert.alertConfirm).mock.calls.map((call) => call[0])

/** Parks the page's loop on a peer commit and marks the tab dirty, so the tab is never clean: the guard has something to ask about. */
async function parkDirty(page: Page): Promise<void> {
    await peerCommit(page.k, (db) => { db.mainPrompt = 'peer' })
    page.db.mainPrompt = 'mine'
    page.flush()
    await until(() => page.loop.isSaveLoopParked(), 'the loop to park on the peer commit')
}

describe('acquireRestoreHold', () => {
    test.each([
        ['with Web Locks', { webLocks: true, tauri: false }, 'web-hold'],
        ['on the desktop and Android apps', { webLocks: true, tauri: true }, 'write-lock'],
        ['without Web Locks, after the warning is accepted', { webLocks: false, tauri: false }, 'write-lock'],
    ] as const)('%s the hold closes dbWriteLock, tells when it was granted, and releases once (guard)', async (_name, options, lock) => {
        const page = await openPage(options)
        const busy = page.busy.beginBusy('backupLoad')
        const granted = vi.fn()
        const result = await page.hold.acquireRestoreHold(busy, { onGranted: granted })
        if (result.kind !== 'held') {
            throw new Error(`expected a hold, got ${result.kind}`)
        }
        expect(result.hold.lock).toBe(lock)
        expect(result.hold.busy).toBe(busy)
        expect(granted).toHaveBeenCalledTimes(1)
        expect(await writeLockIsFree(page)).toBe(false)
        await result.hold.release(false)
        expect(await writeLockIsFree(page)).toBe(true)
        await result.hold.release(false)
        await result.hold.release(true)
        expect(await writeLockIsFree(page)).toBe(true)
        busy.end()
    })

    test.each([
        ['with Web Locks', { webLocks: true, tauri: false }],
        ['on the desktop and Android apps', { webLocks: true, tauri: true }],
        ['without Web Locks', { webLocks: false, tauri: false }],
    ] as const)('%s a granted callback that throws gives no hold and leaves no lock taken (guard; calling it before the hold exists fails it)', async (_name, options) => {
        const page = await openPage(options)
        const busy = page.busy.beginBusy('backupLoad')
        await expect(page.hold.acquireRestoreHold(busy, { onGranted: () => { throw new Error('callback failed') } })).rejects.toThrow('callback failed')
        expect(await writeLockIsFree(page)).toBe(true)
        busy.end()
    })

    test('release(true) keeps dbWriteLock closed for the life of the page, with Web Locks and without (guard)', async () => {
        for (const options of [{ webLocks: true, tauri: false }, { webLocks: true, tauri: true }]) {
            const page = await openPage(options)
            const busy = page.busy.beginBusy('backupLoad')
            const result = await page.hold.acquireRestoreHold(busy)
            if (result.kind !== 'held') {
                throw new Error('expected a hold')
            }
            await result.hold.release(true)
            expect(await writeLockIsFree(page)).toBe(false)
            busy.end()
            worlds.parkAll()
        }
    })

    test('declining the no-lock warning gives no hold and takes no lock; another open tab refuses with its message; a reload in flight is silent (guard)', async () => {
        const noLocks = await openPage({ webLocks: false })
        vi.mocked(noLocks.alert.alertConfirm).mockImplementation(async () => false)
        const busy = noLocks.busy.beginBusy('backupLoad')
        expect((await noLocks.hold.acquireRestoreHold(busy)).kind).toBe('declined')
        expect(confirmTexts(noLocks)).toEqual([language.restoreNoLockWarningConfirm])
        expect(await writeLockIsFree(noLocks)).toBe(true)
        busy.end()
        worlds.parkAll()

        const page = await openPage()
        const other = makeSimulatedTab(page.locks, 'other')
        await other.locks.tabPresenceLockAcquired
        const second = page.busy.beginBusy('backupLoad')
        const granted = vi.fn()
        expect((await page.hold.acquireRestoreHold(second, { onGranted: granted })).kind).toBe('refused')
        expect(granted).not.toHaveBeenCalled()
        expect(alertErrorTexts(page)).toEqual([language.restoreOtherTabRefused])
        expect(await writeLockIsFree(page)).toBe(true)
        page.reloadGuard.markAppInitiatedReload()
        vi.mocked(page.alert.alertError).mockClear()
        expect((await page.hold.acquireRestoreHold(second)).kind).toBe('refused')
        expect(alertErrorTexts(page)).toEqual([])
        other.close()
        second.end()
    })
})

describe('the unsaved-edits guard (T14)', () => {
    test('the hold\'s guard asks once for edits that cannot be saved, not again until the tab is marked dirty once more, and a decline is false (guard)', async () => {
        const page = await openPage()
        await parkDirty(page)
        const busy = page.busy.beginBusy('backupLoad')
        const result = await page.hold.acquireRestoreHold(busy)
        if (result.kind !== 'held') {
            throw new Error('expected a hold')
        }
        expect(await result.hold.guard.check()).toBe(true)
        expect(confirmTexts(page)).toEqual([language.store2RestoreUnsavedConfirm])
        expect(await result.hold.guard.check()).toBe(true)
        expect(confirmTexts(page)).toHaveLength(1)
        page.db.mainPrompt = 'edited again'
        page.flush()
        vi.mocked(page.alert.alertConfirm).mockImplementation(async () => false)
        expect(await result.hold.guard.check()).toBe(false)
        expect(confirmTexts(page)).toHaveLength(2)
        await result.hold.release(false)
        busy.end()
    })

    test('the guard of the preparation is the one the hold carries: edits accepted at R0 are not asked about again at the flip (guard; MS12 fails it)', async () => {
        const page = await openPage()
        await parkDirty(page)
        const bytes = await fileOfPage(page)
        const busy = page.busy.beginBusy('backupLoad')
        const end = await page.plan.prepareRtbRestore(
            { name: 'a.rtb', size: bytes.length, lastModified: 1, source: importSourceOfBytes('a.rtb', bytes) },
            busy,
            { saveBoundMs: 100, deps: { confirmScale: async () => true } },
        )
        if (end.kind !== 'ready') {
            throw new Error(`expected ready, got ${JSON.stringify(end)}`)
        }
        expect(confirmTexts(page).filter((text) => text === language.store2RestoreUnsavedConfirm)).toHaveLength(1)
        expect(await end.hold.guard.check()).toBe(true)
        expect(confirmTexts(page).filter((text) => text === language.store2RestoreUnsavedConfirm)).toHaveLength(1)
        await end.hold.release(false)
        busy.end()
    })
})

async function fileOfPage(page: Page): Promise<Uint8Array> {
    const store = new Map<string, Uint8Array>()
    const closure = await exportClosure(page.k.counted.memory, { onUnits: async (batch) => { for (const unit of batch) { store.set(unit.key, unit.bytes) } } })
    const world: WorldLike = { store, manifestKey: closure.manifestKey, refsByRow: new Map(closure.refRows.map((row) => [row, []])) }
    return (await writeRtbFile({ world })).bytes
}

describe('the authoritative base (T14)', () => {
    test('the read must parse, name a current manifest and carry the planned seq; otherwise it stops with its reason (guard)', async () => {
        const page = await openPage()
        const key = await page.k.commitKey()
        const read = await page.k.committer.readCommit()
        const based = page.hold.baseOfRead(read)
        if (based.kind !== 'ok') {
            throw new Error('the page\'s commit key does not read')
        }
        expect(based.base).toEqual({ seq: key.seq, at: (key.current as { at: number }).at, currentKey: (key.current as { key: string }).key })
        expect(page.hold.checkAuthoritativeBase(based.base, read)).toEqual({ kind: 'ok' })

        await peerCommit(page.k, (db) => { db.mainPrompt = 'peer moved it' })
        const moved = await page.k.committer.readCommit()
        expect(page.hold.checkAuthoritativeBase(based.base, moved)).toEqual({ kind: 'base-moved' })

        const unreadable = [
            { ...read, bytes: null },
            { ...read, bytes: new TextEncoder().encode('damaged') },
            { ...read, bytes: encodeUnit(UNIT_TYPE.commit, { ...key, current: null } as CommitKey) },
            { ...read, bytes: encodeUnit(UNIT_TYPE.commit, { ...key, req: ['x-future-feature'] } as CommitKey) },
        ]
        for (const candidate of unreadable) {
            expect(page.hold.checkAuthoritativeBase(based.base, candidate)).toEqual({ kind: 'base-unreadable' })
        }
    })
})

describe('the committer that asks the busy guard at the flip (T14)', () => {
    const request = (newUnits: number, build: (context: BuildContext) => never): CommitRequest => ({ newUnits, build, label: 'import', force: true, carry: IMPORT_REPLACES_BASE })

    test('an ordinary commit throws the busy error from build when other work started, writes nothing and leaves the commit key alone (guard)', async () => {
        const page = await openPage()
        const busy = page.busy.beginBusy('backupLoad')
        const guarded: Committer = page.hold.rtbGuardedCommitter(page.k.committer, busy)
        const work = page.busy.beginBusy('export')
        const before = await page.k.commitKey()
        const built = vi.fn()
        let caught: unknown = null
        try {
            await guarded.commit(await guarded.readCommit(), request(1, (context) => { built(context); throw new Error('the build ran') }))
        } catch (error) {
            caught = error
        }
        expect(caught).toBeInstanceOf(page.hold.RtbRestoreBusyError)
        expect(page.hold.isRtbBusyAbort(caught)).toBe(true)
        expect(built).not.toHaveBeenCalled()
        expect((await page.k.commitKey()).seq).toBe(before.seq)
        expect(page.hold.isRtbBusyAbort(new Error('another failure'))).toBe(false)
        work.end()
        busy.end()
    })

    test('a bulk commit wraps the error of build, and the abort is unwrapped to the busy error (guard)', async () => {
        const page = await openPage()
        const { Store2BulkAbortError } = await import('src/ts/storage/store2/commit')
        const busy = page.busy.beginBusy('backupLoad')
        // The bulk path of the committer wraps what build throws once its marker is set; this double does the same with the page's own error class.
        const bulk: Committer = {
            ...page.k.committer,
            commit: async (_read, asked) => {
                try {
                    asked.build({} as BuildContext)
                } catch (error) {
                    throw new Store2BulkAbortError(error, null)
                }
                throw new Error('the build did not throw')
            },
        }
        const guarded = page.hold.rtbGuardedCommitter(bulk, busy)
        const work = page.busy.beginBusy('export')
        let caught: unknown = null
        try {
            await guarded.commit(await guarded.readCommit(), request(BULK_UNIT_THRESHOLD + 1, () => { throw new Error('the build ran') }))
        } catch (error) {
            caught = error
        }
        expect(caught).toBeInstanceOf(Store2BulkAbortError)
        expect(page.hold.isRtbBusyAbort(caught)).toBe(true)
        expect(page.hold.isRtbBusyAbort(new Store2BulkAbortError(new Error('another failure'), null))).toBe(false)
        work.end()
        busy.end()
    })

    test('without other work the build runs, and its own error is not a busy abort (guard)', async () => {
        const page = await openPage()
        const busy = page.busy.beginBusy('backupLoad')
        const guarded: Committer = page.hold.rtbGuardedCommitter(page.k.committer, busy)
        const built = vi.fn()
        let caught: unknown = null
        try {
            await guarded.commit(await guarded.readCommit(), request(1, (context) => { built(context); throw new Error('the build ran') }))
        } catch (error) {
            caught = error
        }
        expect(built).toHaveBeenCalledTimes(1)
        expect(caught).not.toBeNull()
        expect(page.hold.isRtbBusyAbort(caught)).toBe(false)
        busy.end()
    })
})