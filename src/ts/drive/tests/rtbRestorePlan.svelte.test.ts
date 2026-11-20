/**
 * The page-target front half of a `.rtb` restore (CHORE-128 S11): `prepareRtbRestore` over a real page of the application,
 * in the way `storeRestore.svelte.test.ts` drives the restore-point shell: the real, unmocked `saveDb()` store2 loop in a
 * world of its own (`saveLoopWorld.ts`, `store2SaveKit.ts`), the real `dbWriteLock`, the real storage tab locks over a fake
 * Web Locks manager, the real `UnsavedGuard` and busy registry, and an in-memory store2 backend. The file is written by the
 * product's `writeRtb`. The asset store's listing and limits are injected (`assetDeps`): the page's byte store is not part
 * of this test, and a mocked listing says nothing about a native store (the device rows cover that).
 *
 * Labels: every test is a compatibility guard of a new contract (no pre-fix base: main has no `.rtb` restore); each turns
 * red on a named scratch mutant, not on a pre-fix run.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView, makeSimulatedTab } from 'src/ts/storage/tests/fakeWebLocks'
import { language } from 'src/lang'
import { encodeUnit, UNIT_TYPE, type CommitKey } from 'src/ts/storage/store2/format'
import { classifyCommitRead, nextCommitKey } from 'src/ts/storage/store2/commitKey'
import { importSourceOfBytes } from 'src/ts/importSource'
import type { Committer } from 'src/ts/storage/store2/commit'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Database } from 'src/ts/storage/database.svelte'
import type { AssetPlanDeps, SizedListing } from 'src/ts/drive/rtb/rtbAssetPlan'
import type { RtbPrepareDeps, RtbPrepareEnd } from 'src/ts/drive/rtbRestorePlan'
import { invoke } from '@tauri-apps/api/core'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { exportClosure } from 'src/ts/storage/store2/rtb/exportClosure'
import { inlayFixture, repackRtb, withBrokenCrc, writeRtbFile, type RtbBuild, type WorldLike } from './rtb/rtbRestoreFixtures'

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

/** The store of the page opened last, as a file is written from it. */
let world: WorldLike
const HASH = `${'a1'.repeat(32)}.png`
const INLAY_ID = '0123abcd-0123-4123-a123-0123456789ab'

beforeAll(async () => {
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
    delete (window as unknown as Record<string, unknown>).__TAURI_OS_PLUGIN_INTERNALS__
    if (originalLocks) {
        Object.defineProperty(window.navigator, 'locks', originalLocks)
    } else {
        Object.defineProperty(window.navigator, 'locks', { value: undefined, configurable: true })
    }
})

/** The units the page's current manifest reaches, handed over by the product's own export walk, as a file is written from them. */
async function worldOfKit(k: Store2Kit): Promise<WorldLike> {
    const store = new Map<string, Uint8Array>()
    const closure = await exportClosure(k.counted.memory, { onUnits: async (batch) => { for (const unit of batch) { store.set(unit.key, unit.bytes) } } })
    return { store, manifestKey: closure.manifestKey, refsByRow: new Map(closure.refRows.map((row) => [row, []])) }
}

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
    locks: FakeLockManagerCore
    /** The committer and backend the page's session uses. */
    useCommitter(committer: Committer): void
}

async function openPage(options: { webLocks?: boolean, tauri?: boolean, hooks?: Parameters<typeof startStore2>[0]['hooks'] } = {}): Promise<Page> {
    platformBox.isTauri = options.tauri === true
    const locks = new FakeLockManagerCore()
    const manager = options.webLocks === false ? undefined : new FakeTabLockManagerView(locks, 'this')
    Object.defineProperty(window.navigator, 'locks', { value: manager, configurable: true })
    h.db = makeDb('base', ['alpha', 'beta'])
    const k = await startStore2({ db: h.db as unknown as Database, hooks: options.hooks })
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
        locks,
        useCommitter(committer) {
            bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer } as unknown as Store2Session)
        },
    }
    page.useCommitter(k.committer)
    w.pageMode.setPageStorageMode({ kind: 'store2' })
    vi.mocked(page.alert.alertConfirm).mockImplementation(async () => true)
    w.start()
    await sleepReal(150)
    world = await worldOfKit(k)
    return page
}

/** Whether `dbWriteLock` can be taken within a moment: false while a restore holds or keeps it closed. */
async function writeLockIsFree(page: Page): Promise<boolean> {
    const taken = page.w.api.dbWriteLock.acquire().then((release) => { release(); return true })
    return await Promise.race([taken, sleepReal(250).then(() => false)])
}

const alertErrorTexts = (page: Page): unknown[] => vi.mocked(page.alert.alertError).mock.calls.map((call) => call[0])
const confirmTexts = (page: Page): unknown[] => vi.mocked(page.alert.alertConfirm).mock.calls.map((call) => call[0])

async function pick(bytes: Uint8Array) {
    return { name: 'backup.rtb', size: bytes.length, lastModified: 1_700_000_000_000, source: importSourceOfBytes('backup.rtb', bytes) }
}

async function fileOf(build: Partial<RtbBuild> = {}): Promise<Uint8Array> {
    return (await writeRtbFile({ world, ...build })).bytes
}

function assetDeps(over: Partial<AssetPlanDeps> & { listing?: SizedListing | null } = {}): () => AssetPlanDeps {
    const { listing, ...rest } = over
    return () => ({
        isNodeStore: () => false,
        probePieceStore: async () => { },
        assetLimit: () => Number.MAX_SAFE_INTEGER,
        inlayLimit: () => Number.MAX_SAFE_INTEGER,
        rule: async () => ({ kind: 'indexeddb', platform: 'posix' }),
        sizedListing: async () => listing ?? null,
        ...rest,
    })
}

/** The whole of localStorage as text: a write through any channel, a bound or cached method included, changes it. */
function snapshotLocalStorage(): string {
    const entries: [string, string | null][] = []
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) as string
        entries.push([key, localStorage.getItem(key)])
    }
    return JSON.stringify(entries.sort())
}

interface Run {
    end: RtbPrepareEnd
    /** Whether the grant hook fired: the write assertions below are vacuous without it. */
    granted: boolean
    /** The store2 backend's write calls made from the lock's grant to the end. */
    writesAfterGrant: number
    /** Whether localStorage differs between the lock's grant and the end. */
    storageChangedAfterGrant: boolean
    /** The storage epoch token before the run and at the grant. */
    epoch: { before: string | null, atGrant: string | null }
}

/**
 * Runs `prepareRtbRestore` for the page with the fail-closed spy armed: the lock's grant flips it, and from then on a
 * write to the page's backend or to localStorage is a violation. The only write the grant itself
 * may make is the storage epoch token.
 */
async function prepare(page: Page, bytes: Uint8Array, options: { deps?: Partial<RtbPrepareDeps>, saveBoundMs?: number, firstRun?: boolean } = {}): Promise<Run> {
    const file = await pick(bytes)
    const busy = page.busy.beginBusy('backupLoad')
    let writesAtGrant = -1
    let storageAtGrant: string | null = null
    const epoch = { before: localStorage.getItem('risu-storage-epoch'), atGrant: null as string | null }
    try {
        const end = await page.plan.prepareRtbRestore(file, busy, {
            saveBoundMs: options.saveBoundMs ?? 3000,
            firstRun: options.firstRun,
            onHoldGranted: () => {
                writesAtGrant = page.k.counted.writeCalls()
                storageAtGrant = snapshotLocalStorage()
                epoch.atGrant = localStorage.getItem('risu-storage-epoch')
            },
            deps: { assetDeps: assetDeps(), confirmScale: async () => true, ...options.deps },
        })
        return {
            end,
            granted: writesAtGrant >= 0 && storageAtGrant !== null,
            writesAfterGrant: writesAtGrant < 0 ? 0 : page.k.counted.writeCalls() - writesAtGrant,
            storageChangedAfterGrant: storageAtGrant !== null && snapshotLocalStorage() !== storageAtGrant,
            epoch,
        }
    } finally {
        busy.end()
    }
}

async function cleanup(run: Run): Promise<void> {
    if (run.end.kind === 'ready') {
        await run.end.hold.release(false)
    }
}

const ended = (run: Run) => run.end.kind === 'ended' ? run.end : null

describe('R0: order and refusals (T1, T21)', () => {
    test('the checks run in the A7 order, the lock comes before the guard, and the classifying read comes last (guard; MS1 and MS2 fail it)', async () => {
        const page = await openPage()
        const log: string[] = []
        const committer = { ...page.k.committer, readCommit: async () => { log.push('readCommit'); return await page.k.committer.readCommit() } }
        const run = await prepare(page, await fileOf(), {
            deps: {
                refuseOnReadOnlyPage: async () => { log.push('read-only'); return false },
                refuseWhileBusy: () => { log.push('busy'); return false },
                pageKind: () => { log.push('mode'); return 'store2' },
                checkImport: async () => { log.push('checkImport'); return { kind: 'ready', target: { committer, backend: page.k.counted.backend } } },
                saveFirst: async () => { log.push('saveFirst') },
                acquireHold: async (busy, options) => {
                    const acquired = await page.hold.acquireRestoreHold(busy, options)
                    log.push('lock')
                    if (acquired.kind === 'held') {
                        const check = acquired.hold.guard.check.bind(acquired.hold.guard)
                        acquired.hold.guard.check = async () => { log.push('guard'); return await check() }
                    }
                    return acquired
                },
            },
        })
        expect(log).toEqual(['read-only', 'busy', 'mode', 'checkImport', 'saveFirst', 'lock', 'guard', 'readCommit'])
        expect(run.end.kind).toBe('ready')
        await cleanup(run)
    })

    test('firstRun leaves the A7 order unchanged: every check still runs, in the same order (guard of a new option; M3a fails it)', async () => {
        const page = await openPage()
        const log: string[] = []
        const committer = { ...page.k.committer, readCommit: async () => { log.push('readCommit'); return await page.k.committer.readCommit() } }
        const run = await prepare(page, await fileOf(), {
            firstRun: true,
            deps: {
                refuseOnReadOnlyPage: async () => { log.push('read-only'); return false },
                refuseWhileBusy: () => { log.push('busy'); return false },
                pageKind: () => { log.push('mode'); return 'store2' },
                checkImport: async () => { log.push('checkImport'); return { kind: 'ready', target: { committer, backend: page.k.counted.backend } } },
                saveFirst: async () => { log.push('saveFirst') },
                acquireHold: async (busy, options) => {
                    const acquired = await page.hold.acquireRestoreHold(busy, options)
                    log.push('lock')
                    if (acquired.kind === 'held') {
                        const check = acquired.hold.guard.check.bind(acquired.hold.guard)
                        acquired.hold.guard.check = async () => { log.push('guard'); return await check() }
                    }
                    return acquired
                },
            },
        })
        expect(log).toEqual(['read-only', 'busy', 'mode', 'checkImport', 'saveFirst', 'lock', 'guard', 'readCommit'])
        expect(run.end.kind).toBe('ready')
        await cleanup(run)
    })

    test('firstRun still asks the scale question: declining it cancels and frees the lock (guard of a new option; M3b fails it)', async () => {
        const page = await openPage()
        const run = await prepare(page, await fileOf(), { firstRun: true, deps: { confirmScale: async () => false } })
        expect(ended(run)).toEqual({ kind: 'ended', outcome: 'canceled', cause: 'declined' })
        expect(await writeLockIsFree(page)).toBe(true)
    })

    test('a read-only page, work in progress and a page that is not in store2 mode refuse with their message, write nothing and hold no lock (guard)', async () => {
        const page = await openPage()
        const readOnly = await prepare(page, await fileOf(), { deps: { refuseOnReadOnlyPage: async () => true } })
        expect(ended(readOnly)).toEqual({ kind: 'ended', outcome: 'nothing-replaced', cause: 'read-only' })

        const work = page.busy.beginBusy('export')
        const busy = await prepare(page, await fileOf())
        work.end()
        expect(ended(busy)).toEqual({ kind: 'ended', outcome: 'nothing-replaced', cause: 'busy' })
        expect(alertErrorTexts(page)).toContain(language.backupLoadWorkInProgress)

        page.w.pageMode.setPageStorageMode({ kind: 'unset' })
        const before = page.k.counted.writeCalls()
        const block = await prepare(page, await fileOf())
        expect(ended(block)).toEqual({ kind: 'ended', outcome: 'nothing-replaced', cause: 'not-store2' })
        expect(alertErrorTexts(page)).toContain(language.rtbRestoreNeedsStore2)
        expect(page.k.counted.writeCalls()).toBe(before)
        expect(block.storageChangedAfterGrant).toBe(false)
        expect(await writeLockIsFree(page)).toBe(true)
        expect(page.busy.isBusy()).toBe(false)
    })

    test.each([
        ['an unreadable commit key', 'commit-read-failed', language.store2ImportReadFailed],
        ['an absent commit key', 'commit-key-unusable', language.store2ImportRefused],
        ['a damaged commit key', 'commit-key-unusable', language.store2ImportRefused],
        ['a commit key that names no manifest', 'no-current-manifest', language.store2ImportRefused],
        ['a commit key written by a newer version', 'too-new', language.store2ImportTooNew],
    ] as const)('%s ends with its cause and message, releases the lock and writes nothing (guard)', async (name, cause, message) => {
        const page = await openPage()
        const key = await page.k.commitKey()
        const answer = (bytes: Uint8Array | null) => async () => ({ ...(await page.k.committer.readCommit()), bytes })
        const reads: Record<string, () => Promise<unknown>> = {
            'an unreadable commit key': async () => { throw new Error('disk gone') },
            'an absent commit key': answer(null),
            'a damaged commit key': answer(encoder.encode('not a commit key')),
            'a commit key that names no manifest': answer(encodeUnit(UNIT_TYPE.commit, { ...key, current: null } as CommitKey)),
            'a commit key written by a newer version': answer(encodeUnit(UNIT_TYPE.commit, { ...key, req: ['x-future-feature'] } as CommitKey)),
        }
        const committer = { ...page.k.committer, readCommit: reads[name] as unknown as Committer['readCommit'] }
        const run = await prepare(page, await fileOf(), {
            deps: { checkImport: async () => ({ kind: 'ready', target: { committer, backend: page.k.counted.backend } }) },
        })
        expect(ended(run)).toEqual({ kind: 'ended', outcome: 'nothing-replaced', cause })
        expect(alertErrorTexts(page)).toContain(message)
        expect(run.granted).toBe(true)
        expect(run.storageChangedAfterGrant).toBe(false)
        expect(run.writesAfterGrant).toBe(0)
        expect(await writeLockIsFree(page)).toBe(true)
    })

    test('without Web Locks the warning is asked and declining it cancels; another open tab refuses with its message (guard)', async () => {
        const noLocks = await openPage({ webLocks: false })
        vi.mocked(noLocks.alert.alertConfirm).mockImplementation(async () => false)
        const declined = await prepare(noLocks, await fileOf())
        expect(ended(declined)).toEqual({ kind: 'ended', outcome: 'canceled', cause: 'declined' })
        expect(confirmTexts(noLocks)).toEqual([language.restoreNoLockWarningConfirm])
        expect(await writeLockIsFree(noLocks)).toBe(true)
        worlds.parkAll()

        const page = await openPage()
        const other = makeSimulatedTab(page.locks, 'other')
        await other.locks.tabPresenceLockAcquired
        const refused = await prepare(page, await fileOf())
        expect(ended(refused)).toEqual({ kind: 'ended', outcome: 'nothing-replaced', cause: 'other-tab' })
        expect(alertErrorTexts(page)).toContain(language.restoreOtherTabRefused)
        expect(await writeLockIsFree(page)).toBe(true)
        other.close()
    })

    test('an accepted file returns the plan and keeps the lock held until released; nothing is written from the grant on (guard)', async () => {
        const page = await openPage()
        const key = await page.k.commitKey()
        const run = await prepare(page, await fileOf())
        if (run.end.kind !== 'ready') {
            throw new Error(`expected ready, got ${JSON.stringify(run.end)}`)
        }
        expect(run.end.plan.kind).toBe('rtb-page')
        expect(run.end.plan.base).toEqual({ seq: key.seq, at: (key.current as { at: number }).at, currentKey: (key.current as { key: string }).key })
        expect(run.end.hold.lock).toBe('web-hold')
        expect(run.writesAfterGrant).toBe(0)
        expect(run.granted).toBe(true)
        expect(run.storageChangedAfterGrant).toBe(false)
        // the epoch token is the one write the grant makes, and it is made before the grant resolves
        expect(run.epoch.atGrant).not.toBeNull()
        expect(run.epoch.atGrant).not.toBe(run.epoch.before)
        expect(await writeLockIsFree(page)).toBe(false)
        await run.end.hold.release(false)
        expect(await writeLockIsFree(page)).toBe(true)
        await run.end.hold.release(false)
    })
})

describe('the newer-data warning (T8)', () => {
    const textOf = (page: Page) => confirmTexts(page).find((text) => typeof text === 'string' && text.includes('Test device'))

    test('the warning comes before any restore write, and declining it cancels with nothing written and the lock free (guard)', async () => {
        const page = await openPage()
        const at = (await page.k.commitKey()).current?.at as number
        vi.mocked(page.alert.alertConfirm).mockImplementation(async (text) => !(typeof text === 'string' && text.includes('Test device')))
        const before = page.k.counted.writeCalls()
        const run = await prepare(page, await fileOf({ createdAt: at - 5000 }))
        expect(ended(run)).toEqual({ kind: 'ended', outcome: 'canceled', cause: 'declined' })
        expect(page.k.counted.writeCalls()).toBe(before)
        expect(run.granted).toBe(true)
        expect(run.storageChangedAfterGrant).toBe(false)
        expect(await writeLockIsFree(page)).toBe(true)
    })

    test('a page whose save commit is newer than the backup gets the warning: the classifying read is taken after saveFirst (guard; MS1 fails it)', async () => {
        const page = await openPage()
        const at = (await page.k.commitKey()).current?.at as number
        page.k.clock.advance(10_000)
        page.db.mainPrompt = 'unsaved edit'
        page.flush()
        const run = await prepare(page, await fileOf({ createdAt: at + 5000 }))
        expect(run.end.kind).toBe('ready')
        expect(textOf(page)).toBeDefined()
        expect(run.end.kind === 'ready' && run.end.plan.newer?.targetAt).toBeGreaterThan(at + 5000)
        await cleanup(run)
    })

    test('a backup that left unsaved changes out is compared on its committed time, and the prompt shows both times and the device label (guard; MS3 fails it)', async () => {
        const page = await openPage()
        const at = (await page.k.commitKey()).current?.at as number
        const createdAt = at + 10 * 24 * 3600 * 1000
        const committedAt = at - 1000
        const run = await prepare(page, await fileOf({ createdAt, source: { unsavedExcluded: true, committedAt } }))
        expect(run.end.kind).toBe('ready')
        expect(confirmTexts(page)).toContain(language.rtbRestoreTargetNewerConfirm(
            new Date(at).toLocaleString(), new Date(committedAt).toLocaleString(), new Date(createdAt).toLocaleString(), 'Test device',
        ))
        await cleanup(run)
    })

    test('the Welcome restore (firstRun) is not asked the newer-data question: a backup older than the target is ready with no plan.newer and no prompt (guard of a new option; M1 fails it)', async () => {
        const page = await openPage()
        const key = await page.k.commitKey()
        const at = (key.current as { at: number }).at
        vi.mocked(page.alert.alertConfirm).mockImplementation(async (text) => !(typeof text === 'string' && text.includes('Test device')))
        const run = await prepare(page, await fileOf({ createdAt: at - 5000 }), { firstRun: true })
        if (run.end.kind !== 'ready') {
            throw new Error(`expected ready, got ${JSON.stringify(run.end)}`)
        }
        expect(run.end.plan.newer).toBeNull()
        expect(textOf(page)).toBeUndefined()
        expect(run.end.plan.base).toEqual({ seq: key.seq, at, currentKey: (key.current as { key: string }).key })
        await cleanup(run)
    })

    test('verifyAndConfirm with no newer base (the start-up restore) never asks the newer-data question, though the file is older than the page (guard of a new rule; T-V1)', async () => {
        const page = await openPage()
        const at = (await page.k.commitKey()).current?.at as number
        vi.mocked(page.alert.alertConfirm).mockImplementation(async (text) => !(typeof text === 'string' && text.includes('Test device')))
        const scale = vi.fn(async () => true)
        const end = await page.plan.verifyAndConfirm(await pick(await fileOf({ createdAt: at - 5000 })), {
            ...page.plan.realVerifyDeps(), assetDeps: assetDeps(), confirmScale: scale,
        }, { newerBase: null })
        if (end.kind !== 'ok') {
            throw new Error(`expected ok, got ${JSON.stringify(end)}`)
        }
        expect(end.verified.newer).toBeNull()
        expect(textOf(page)).toBeUndefined()
        expect(scale).toHaveBeenCalledTimes(1)
    })

    test('a backup newer than the target is not warned about (guard)', async () => {
        const page = await openPage()
        const at = (await page.k.commitKey()).current?.at as number
        const run = await prepare(page, await fileOf({ createdAt: at + 5000 }))
        expect(run.end.kind === 'ready' && run.end.plan.newer).toBeNull()
        expect(textOf(page)).toBeUndefined()
        await cleanup(run)
    })

    test('saveFirst that returns at its bound while the loop\'s commit still holds the write lock: the read sees that commit (guard; MS2 fails it)', async () => {
        const slow = { on: false }
        const page = await openPage({
            hooks: {
                before: async (name) => {
                    if (slow.on && name === 'commitOrdinary') {
                        // longer than the saveFirst bound, so the commit still holds the write lock when saveFirst gives up
                        await sleepReal(600)
                    }
                },
            },
        })
        const at = (await page.k.commitKey()).current?.at as number
        slow.on = true
        page.k.clock.advance(10_000)
        page.db.mainPrompt = 'slow edit'
        page.flush()
        const run = await prepare(page, await fileOf({ createdAt: at + 5000 }), { saveBoundMs: 100 })
        slow.on = false
        expect(run.end.kind).toBe('ready')
        expect(run.end.kind === 'ready' && run.end.plan.newer?.targetAt).toBeGreaterThan(at + 5000)
        await cleanup(run)
    })
})

describe('the prompts after the file is verified (T9, T11, T12)', () => {
    test('confirmImportScale is asked once with the copied bytes and entries (inlays and compare items included) and the store2 bytes (guard)', async () => {
        const page = await openPage()
        const listing: SizedListing = { kind: 'node-sized', items: [{ key: `assets/${HASH}`, size: 5 }, { key: 'assets/literal.png', size: 3 }] }
        const bytes = await fileOf({
            assets: { [HASH]: encoder.encode('hello'), 'literal.png': encoder.encode('abc'), 'other.png': encoder.encode('wxyz') },
            inlays: [inlayFixture(INLAY_ID, 'inlay-body')],
        })
        const asked: number[][] = []
        const run = await prepare(page, bytes, {
            deps: {
                assetDeps: assetDeps({ listing }),
                confirmScale: async (...args) => { asked.push(args); return true },
            },
        })
        if (run.end.kind !== 'ready') {
            throw new Error('expected ready')
        }
        const plan = run.end.plan
        // HASH is present (hash name, equal size); literal.png is compared; other.png is written; the inlay is two entries
        expect(plan.assets.present).toBe(1)
        expect(asked).toEqual([[3 + 4 + 'inlay-body'.length + plan.store2.bytes, 2 + 2, plan.store2.bytes, 0]])
        await cleanup(run)
    })

    test('Node oversize: the existing prompt names the items, declining cancels, accepting lists them in the plan (guard)', async () => {
        const page = await openPage()
        const bytes = await fileOf({ assets: { 'big.png': encoder.encode('0123456789') }, inlays: [inlayFixture(INLAY_ID, 'inlay-body')] })
        const node = assetDeps({ isNodeStore: () => true, assetLimit: () => 5, inlayLimit: () => 4 })
        vi.mocked(page.alert.alertConfirm).mockImplementation(async (text) => !(typeof text === 'string' && text.includes('big.png')))
        const declined = await prepare(page, bytes, { deps: { assetDeps: node } })
        expect(ended(declined)).toEqual({ kind: 'ended', outcome: 'canceled', cause: 'declined' })
        expect(confirmTexts(page)).toContain(language.restoreOversizedWithInlaysConfirm(1, ['big.png'], 1, [INLAY_ID], 4))
        expect(await writeLockIsFree(page)).toBe(true)

        vi.mocked(page.alert.alertConfirm).mockImplementation(async () => true)
        const accepted = await prepare(page, bytes, { deps: { assetDeps: node } })
        if (accepted.end.kind !== 'ready') {
            throw new Error('expected ready')
        }
        expect(accepted.end.plan.assets.oversize.map((item) => item.key)).toEqual(['big.png'])
        expect(accepted.end.plan.inlays.oversize.map((pair) => pair.id)).toEqual([INLAY_ID])
        await cleanup(accepted)

        vi.mocked(page.alert.alertConfirm).mockClear()
        const off = await prepare(page, bytes)
        expect(confirmTexts(page).some((text) => typeof text === 'string' && text.includes('big.png'))).toBe(false)
        await cleanup(off)
    })

    test('uncreatable names are asked about, a decline cancels and an accept excludes and lists them (guard; MS10 fails it)', async () => {
        const page = await openPage()
        const bytes = await fileOf({ assets: { '.hidden': encoder.encode('x'), 'fine.png': encoder.encode('y') } })
        vi.mocked(page.alert.alertConfirm).mockImplementation(async (text) => !(typeof text === 'string' && text.includes('.hidden')))
        const declined = await prepare(page, bytes)
        expect(ended(declined)).toEqual({ kind: 'ended', outcome: 'canceled', cause: 'declined' })
        expect(confirmTexts(page)).toContain(language.rtbRestoreUncreatableConfirm(1, ['.hidden']))
        vi.mocked(page.alert.alertConfirm).mockImplementation(async () => true)
        const accepted = await prepare(page, bytes)
        if (accepted.end.kind !== 'ready') {
            throw new Error('expected ready')
        }
        expect(accepted.end.plan.assets.uncreatable.map((item) => item.key)).toEqual(['.hidden'])
        expect(accepted.end.plan.assets.copy.length).toBe(1)
        await cleanup(accepted)
    })

    test('the plan holds no frame, body or listing: its typed arrays are the asset arrays and the block list, within nine bytes per entry (guard)', async () => {
        const page = await openPage()
        const run = await prepare(page, await fileOf({ assets: { [HASH]: encoder.encode('hello'), 'a.png': encoder.encode('bb') } }))
        if (run.end.kind !== 'ready') {
            throw new Error('expected ready')
        }
        const plan = run.end.plan
        const typed: string[] = []
        const found = JSON.stringify({ ...plan, index: null, source: null, target: null }, (key, value) => {
            if (value instanceof Uint8Array || value instanceof Uint32Array) {
                typed.push(key)
                return null
            }
            return value
        })
        expect(found).not.toContain('"frame"')
        expect(typed.sort()).toEqual(['blocks', 'copy', 'mode'])
        const bytes = plan.store2.blocks.byteLength + plan.assets.copy.byteLength + plan.assets.mode.byteLength
        expect(bytes).toBeLessThanOrEqual(9 * plan.index.count)
        await cleanup(run)
    })
})

describe('verification refusals reach the person (T2, the shell part)', () => {
    test.each([
        ['a file that is not an .rtb', 'not-an-rtb', language.rtbRestoreNotRtb],
        ['a damaged block', 'damaged', language.rtbRestoreDamaged],
        ['a file of a newer format', 'newer', language.rtbRestoreNewer('file format 2')],
        ['a sealed file', 'encrypted', language.rtbRestoreEncrypted],
    ] as const)('%s ends with one message, writes nothing and releases the lock (guard)', async (name, cause, message) => {
        const page = await openPage()
        const sealed = new Uint8Array(80)
        sealed.set([0x52, 0x54, 0x42, 0x58, 0x0D, 0x0A, 0x1A, 0x0A, 1, 0])
        const bytes = name === 'a file that is not an .rtb' ? encoder.encode('plain text '.repeat(20))
            : name === 'a damaged block' ? await withBrokenCrc(await fileOf(), 'u/3/0.blk')
                : name === 'a sealed file' ? sealed
                    : await repackRtb(await fileOf(), { manifest: (m) => { m.rtb = 2 } })
        const run = await prepare(page, bytes)
        expect(ended(run)).toEqual({ kind: 'ended', outcome: 'nothing-replaced', cause })
        expect(alertErrorTexts(page)).toEqual([message])
        expect(run.granted).toBe(true)
        expect(run.writesAfterGrant).toBe(0)
        expect(run.storageChangedAfterGrant).toBe(false)
        expect(await writeLockIsFree(page)).toBe(true)
    })

    test('a newer unit is named in plain words and its raw reason stays out of the message (guard; returning the reason fails it)', async () => {
        const page = await openPage()
        const reason = 'u-abc: Unit type 99 is unknown to this build.'
        const text = page.plan.describeNewer({ why: 'unit', reason })
        expect(text).toBe('a kind of saved data this version does not know')
        expect(language.rtbRestoreNewer(text)).not.toContain('u-abc')
    })

    test('a read that cannot complete is could-not-read with its message and nothing is written (guard)', async () => {
        const page = await openPage()
        const bytes = await fileOf()
        const file = await pick(bytes)
        const failing = { ...file, source: { ...file.source, read: async () => { throw new Error('the file went away') } } }
        const busy = page.busy.beginBusy('backupLoad')
        const end = await page.plan.prepareRtbRestore(failing, busy, { deps: { assetDeps: assetDeps() } })
        busy.end()
        expect(end).toEqual({ kind: 'ended', outcome: 'nothing-replaced', cause: 'could-not-read' })
        expect(alertErrorTexts(page)).toContain(language.backupFileUnreadable)
        expect(await writeLockIsFree(page)).toBe(true)
    })
})

describe('the Tauri shell (T13)', () => {
    test('a save requested while a prompt is open does not commit until the hold is released, and commits after a decline (guard; a hold that takes no write lock or is released at the grant fails it)', async () => {
        const page = await openPage({ tauri: true })
        const at = (await page.k.commitKey()).current?.at as number
        let answer: (value: boolean) => void = () => { }
        vi.mocked(page.alert.alertConfirm).mockImplementation(() => new Promise<boolean>((resolve) => { answer = resolve }))
        const running = prepare(page, await fileOf({ createdAt: at - 5000 }))
        await until(() => confirmTexts(page).length > 0, 'the newer-data prompt to open')
        const before = page.k.counted.writeCalls()
        page.k.clock.advance(1000)
        page.db.mainPrompt = 'edit during the prompt'
        page.flush()
        page.w.api.requestSaveNow()
        await sleepReal(1500)
        expect(page.k.counted.writeCalls(), 'the loop committed under the hold').toBe(before)
        answer(false)
        const run = await running
        expect(ended(run)).toEqual({ kind: 'ended', outcome: 'canceled', cause: 'declined' })
        await until(() => page.k.counted.writeCalls() > before, 'the save to commit once the hold is released')
        expect((await page.k.saved()).mainPrompt).toBe('edit during the prompt')
    })

    test('a V refusal releases the hold: the next save commits (guard; MS5 fails it)', async () => {
        const page = await openPage({ tauri: true })
        const run = await prepare(page, encoder.encode('plain text '.repeat(20)))
        expect(ended(run)?.cause).toBe('not-an-rtb')
        const before = page.k.counted.writeCalls()
        await nextCommit(page.w, () => {
            page.db.mainPrompt = 'after the refusal'
            page.flush()
        })
        expect(page.k.counted.writeCalls()).toBeGreaterThan(before)
    })

    test('after ready the lock is held; release(false) frees it and release(true) keeps it closed (guard)', async () => {
        const first = await openPage({ tauri: true })
        const run = await prepare(first, await fileOf())
        if (run.end.kind !== 'ready') {
            throw new Error('expected ready')
        }
        expect(run.end.hold.lock).toBe('write-lock')
        expect(await writeLockIsFree(first)).toBe(false)
        await run.end.hold.release(false)
        expect(await writeLockIsFree(first)).toBe(true)
        worlds.parkAll()

        const second = await openPage({ tauri: true })
        const kept = await prepare(second, await fileOf())
        if (kept.end.kind !== 'ready') {
            throw new Error('expected ready')
        }
        await kept.end.hold.release(true)
        expect(await writeLockIsFree(second)).toBe(false)
    })

    test('a throw outside the walk ends failed with the read-failed message and a console error, releases the lock, and the save commits (guard; MS5 fails it)', async () => {
        const page = await openPage({ tauri: true })
        const run = await prepare(page, await fileOf(), {
            deps: { verify: async () => { throw new TypeError('an unexpected defect') } },
        })
        expect(ended(run)).toEqual({ kind: 'ended', outcome: 'failed', cause: 'unexpected' })
        expect(alertErrorTexts(page)).toEqual([language.store2ImportReadFailed])
        const logged = vi.mocked(console.error).mock.calls.map((call) => call[0])
        expect(logged.some((entry) => entry instanceof TypeError)).toBe(true)
        const before = page.k.counted.writeCalls()
        await nextCommit(page.w, () => {
            page.db.mainPrompt = 'after the failure'
            page.flush()
        })
        expect(page.k.counted.writeCalls()).toBeGreaterThan(before)
    })
})

describe('the listing gates of the real asset calls (T10)', () => {
    function storeWith(listed: { key: string, size: number }[] | null): { store: ByteStore, listSized: ReturnType<typeof vi.fn>, has: ReturnType<typeof vi.fn> } {
        const listSized = vi.fn(async () => listed)
        const has = vi.fn(async () => false)
        return { store: { listSized, has } as unknown as ByteStore, listSized, has }
    }

    afterEach(async () => {
        const { injectAppStore } = await import('src/ts/storage/store/appStore')
        injectAppStore(null)
    })

    test('on a Node store the plan makes one sized listing of assets/ and asks nothing per asset (guard; a per-asset has() or a second listing fails it)', async () => {
        const page = await openPage()
        const { injectAppStore } = await import('src/ts/storage/store/appStore')
        const { store, listSized, has } = storeWith([{ key: 'assets/a.png', size: 3 }])
        injectAppStore(store, 'node')
        vi.mocked(invoke).mockClear()
        const deps = page.plan.realAssetDeps()
        expect(deps.isNodeStore()).toBe(true)
        expect(await deps.sizedListing()).toEqual({ kind: 'node-sized', items: [{ key: 'assets/a.png', size: 3 }] })
        expect(listSized.mock.calls).toEqual([['assets/', 0]])
        expect(has).not.toHaveBeenCalled()
        expect(vi.mocked(invoke)).not.toHaveBeenCalled()
    })

    test('the Tauri listing is taken only when the batched read is available and the page\'s store is the Tauri store (guard)', async () => {
        const page = await openPage({ tauri: true })
        const { injectAppStore } = await import('src/ts/storage/store/appStore')
        ;(window as unknown as Record<string, unknown>).__TAURI_OS_PLUGIN_INTERNALS__ = { os_type: 'windows' }
        const { store, listSized } = storeWith(null)
        injectAppStore(store, 'tauri')
        vi.mocked(invoke).mockClear()
        vi.mocked(invoke).mockResolvedValueOnce([['assets/a.png', 3]])
        expect(await page.plan.realAssetDeps().sizedListing()).toEqual({ kind: 'tauri-sized', items: [{ key: 'assets/a.png', size: 3 }] })
        expect(vi.mocked(invoke).mock.calls.map((call) => call[0])).toEqual(['list_assets_sized'])
        expect(listSized).not.toHaveBeenCalled()

        // the page's store is not the Tauri store: no Tauri listing
        injectAppStore(store, 'indexeddb')
        vi.mocked(invoke).mockClear()
        expect(await page.plan.realAssetDeps().sizedListing()).toBeNull()
        expect(vi.mocked(invoke)).not.toHaveBeenCalled()

        // the batched read is off (outside the apps): no Tauri listing even for the Tauri store
        injectAppStore(store, 'tauri')
        platformBox.isTauri = false
        expect(await page.plan.realAssetDeps().sizedListing()).toBeNull()
        expect(vi.mocked(invoke)).not.toHaveBeenCalled()
    })
})

describe('the write spy (T22)', () => {
    test('the spy reads the page\'s write channels as state: a write after the grant moves them, the epoch token written before it does not (guard; a fail-open spy fails it)', async () => {
        const page = await openPage()
        const storage = window.localStorage
        const before = snapshotLocalStorage()
        storage.setItem('risu-storage-epoch', 'token')
        const atGrant = snapshotLocalStorage()
        expect(atGrant).not.toBe(before)
        expect(snapshotLocalStorage()).toBe(atGrant)
        storage.setItem('x', '1')
        expect(snapshotLocalStorage()).not.toBe(atGrant)
        storage.removeItem('x')
        expect(snapshotLocalStorage()).toBe(atGrant)
        // the backend's write count is what "zero writes after the grant" reads: a save moves it
        const writes = page.k.counted.writeCalls()
        await nextCommit(page.w, () => {
            page.db.mainPrompt = 'a save'
            page.flush()
        })
        expect(page.k.counted.writeCalls()).toBeGreaterThan(writes)
    })
})

describe('P.1b: the restore\'s own bulk marker (T-V2, T-R6, T-R12)', () => {
    type OpenHeld = NonNullable<Committer['openHeldBulk']>

    /** The page's committer with `openHeldBulk` logged to `log` and answered by `open` (the page's own when absent). */
    function spied(page: Page, log: string[], open?: OpenHeld): Committer {
        const own = page.k.committer.openHeldBulk
        if (own === undefined) {
            throw new Error('The page\'s committer has no openHeldBulk.')
        }
        return { ...page.k.committer, openHeldBulk: async (read, request) => { log.push('openHeldBulk'); return await (open ?? own)(read, request) } }
    }

    const target = (page: Page, committer: Committer): Partial<RtbPrepareDeps> => ({
        checkImport: async () => ({ kind: 'ready', target: { committer, backend: page.k.counted.backend } }),
    })

    test('T-V2: on a Node page the hook runs once, between the newer-data question and the first asset listing, and the plan carries the held marker (guard; MR12 fails it)', async () => {
        const page = await openPage()
        const at = (await page.k.commitKey()).current?.at as number
        const log: string[] = []
        vi.mocked(page.alert.alertConfirm).mockImplementation(async (text) => {
            log.push(typeof text === 'string' && text.includes('Test device') ? 'newer-question' : 'confirm')
            return true
        })
        const run = await prepare(page, await fileOf({ createdAt: at - 5000 }), {
            deps: {
                ...target(page, spied(page, log)),
                heldMarker: () => true,
                assetDeps: assetDeps({ sizedListing: async () => { log.push('sizedListing'); return null } }),
            },
        })
        expect(log).toEqual(['newer-question', 'openHeldBulk', 'sizedListing'])
        expect(run.end.kind === 'ready' && run.end.plan.held).toBeTruthy()
        expect((await page.k.commitKey()).staging?.label).toBe('restore')
        await cleanup(run)
    })

    test('T-V2: the start-up path (verifyAndConfirm with no hook) opens no marker and makes no commit-key write; a hook that answers ends the run before the asset listing (guard; MR12 fails the second half)', async () => {
        const page = await openPage()
        const key = await page.k.commitKey()
        const writes = page.k.counted.writeCalls()
        const listing = vi.fn(async () => null)
        const deps = { ...page.plan.realVerifyDeps(), assetDeps: assetDeps({ sizedListing: listing }), confirmScale: async () => true }
        const bytes = await fileOf()
        const plain = await page.plan.verifyAndConfirm(await pick(bytes), deps, { newerBase: null })
        expect(plain.kind).toBe('ok')
        expect(listing).toHaveBeenCalledTimes(1)
        expect(page.k.counted.writeCalls()).toBe(writes)
        expect((await page.k.commitKey()).seq).toBe(key.seq)

        listing.mockClear()
        const stopped = await page.plan.verifyAndConfirm(await pick(bytes), deps, { newerBase: null, beforeAssetPlan: async () => ({ kind: 'ended', outcome: 'nothing-replaced', cause: 'marker-standing' }) })
        expect(stopped).toEqual({ kind: 'ended', outcome: 'nothing-replaced', cause: 'marker-standing' })
        expect(listing).not.toHaveBeenCalled()
    })

    test.each([['the web or desktop page', false], ['the Tauri page', true]] as const)('T-R6: %s opens no marker and writes nothing after the grant: the hook is not passed when heldMarker is false (compatibility guard; passes before and after; MR5 fails it)', async (_name, tauri) => {
        const page = await openPage({ tauri })
        const key = await page.k.commitKey()
        const log: string[] = []
        const run = await prepare(page, await fileOf(), { deps: target(page, spied(page, log)) })
        expect(run.end.kind).toBe('ready')
        expect(log).toEqual([])
        expect(run.end.kind === 'ready' && run.end.plan.held).toBeFalsy()
        expect(run.writesAfterGrant).toBe(0)
        expect((await page.k.commitKey()).seq).toBe(key.seq)
        await cleanup(run)
    })

    test('T-R12: a refusal that is not marker-present ends library-refused after one open, and a committer without the held calls ends the same way, each with the hold released (guard; MR14 fails it)', async () => {
        const page = await openPage()
        const log: string[] = []
        const refusing: OpenHeld = async () => ({ status: 'refused', reason: 'damaged', detail: 'The commit key is damaged.' })
        const first = await prepare(page, await fileOf(), { deps: { ...target(page, spied(page, log, refusing)), heldMarker: () => true } })
        expect(ended(first)).toEqual({ kind: 'ended', outcome: 'nothing-replaced', cause: 'library-refused' })
        expect(log).toEqual(['openHeldBulk'])
        expect(alertErrorTexts(page)).toContain(language.store2ImportRefused)
        expect(await writeLockIsFree(page)).toBe(true)

        const bare: Committer = { ...page.k.committer, openHeldBulk: undefined, clearHeld: undefined }
        const second = await prepare(page, await fileOf(), { deps: { ...target(page, bare), heldMarker: () => true } })
        expect(ended(second)).toEqual({ kind: 'ended', outcome: 'nothing-replaced', cause: 'library-refused' })
        expect(await writeLockIsFree(page)).toBe(true)
    })

    test('a foreign marker ends foreign-marker with the marker text and leaves it standing (guard)', async () => {
        const page = await openPage()
        const log: string[] = []
        await plantMarker(page, 'p'.repeat(26))
        const run = await prepare(page, await fileOf(), { deps: { ...target(page, spied(page, log)), heldMarker: () => true } })
        expect(ended(run)).toEqual({ kind: 'ended', outcome: 'nothing-replaced', cause: 'foreign-marker' })
        expect(alertErrorTexts(page)).toContain(language.store2RestoreBulkMarker)
        expect(log).toEqual(['openHeldBulk'])
        expect((await page.k.commitKey()).staging?.owner).toBe('p'.repeat(26))
        expect(await writeLockIsFree(page)).toBe(true)
    })

    test('an own marker is cleared once and the open retried once: a second marker-present ends marker-standing (guard)', async () => {
        const page = await openPage()
        const log: string[] = []
        await plantMarker(page, page.k.committer.owner)
        const standing: OpenHeld = async () => ({ status: 'refused', reason: 'marker-present', detail: 'A bulk marker already stands on the commit key.' })
        const run = await prepare(page, await fileOf(), { deps: { ...target(page, spied(page, log, standing)), heldMarker: () => true } })
        expect(ended(run)).toEqual({ kind: 'ended', outcome: 'nothing-replaced', cause: 'marker-standing' })
        expect(alertErrorTexts(page)).toContain(language.store2RestoreBulkMarker)
        expect(log).toEqual(['openHeldBulk', 'openHeldBulk'])
        expect((await page.k.commitKey()).staging).toBeNull()
        expect(await writeLockIsFree(page)).toBe(true)
    })
})

/** Plants a bulk marker of `owner` on the page's commit key, as a page that is mid-bulk (or died mid-bulk) leaves it. */
async function plantMarker(page: Page, owner: string): Promise<void> {
    const read = await page.k.committer.readCommit()
    const parsed = classifyCommitRead(read)
    if (parsed.status !== 'parsed') {
        throw new Error('The page\'s commit key does not parse.')
    }
    const next = nextCommitKey(parsed.value, { staging: { owner, prefix: 'store2/g-1111111111111111-', startedAt: 5, label: 'bulk' } }, page.k.context.env)
    await page.k.counted.backend.casCommit(read.token, encodeUnit(UNIT_TYPE.commit, next))
}
