/**
 * The Cancel of the `.rtb` preparation (`prepareRtbRestore` with `cancel`) on the real page of the application: the real
 * `saveDb()` store2 loop in a world of its own, the real restore hold over a fake Web Locks manager, the real file
 * verification over a file the real writer produced from the page's own profile. The preparation's Cancel is a gate
 * (`cancelRequested`, `lockCancel`) that a test drives directly; the card that supplies it is covered by
 * `rtbRestoreCard.svelte.test.ts`. A fake store's success says nothing about a native store.
 *
 * Labels: RR = regression reproducer (red on the base, where `prepareRtbRestore` has no `cancel` option and runs on to
 * `ready`); CG = compatibility guard (passes before and after).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import { language } from 'src/lang'
import { importSourceOfBytes } from 'src/ts/importSource'
import { exportClosure } from 'src/ts/storage/store2/rtb/exportClosure'
import type { Committer } from 'src/ts/storage/store2/commit'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Database } from 'src/ts/storage/database.svelte'
import type { AssetPlanDeps } from 'src/ts/drive/rtb/rtbAssetPlan'
import type { RestoreCancelGate } from 'src/ts/drive/restoreProgress'
import type { RtbPrepareDeps, RtbPrepareEnd } from 'src/ts/drive/rtbRestorePlan'
import { writeRtbFile, type WorldLike } from './rtb/rtbRestoreFixtures'

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
    alert: typeof import('src/ts/alert')
    busy: typeof import('src/ts/process/memory/busyActions')
    plan: typeof import('src/ts/drive/rtbRestorePlan')
    hold: typeof import('src/ts/drive/rtbRestoreHold')
    world: WorldLike
    useCommitter(committer: Committer): void
}

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
    const store = new Map<string, Uint8Array>()
    const closure = await exportClosure(k.counted.memory, { onUnits: async (batch) => { for (const unit of batch) { store.set(unit.key, unit.bytes) } } })
    const page: Page = {
        w,
        k,
        alert: await import('src/ts/alert'),
        busy: await import('src/ts/process/memory/busyActions'),
        plan: await import('src/ts/drive/rtbRestorePlan'),
        hold: await import('src/ts/drive/rtbRestoreHold'),
        world: { store, manifestKey: closure.manifestKey, refsByRow: new Map(closure.refRows.map((row) => [row, []])) },
        useCommitter(committer) {
            bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer } as unknown as Store2Session)
        },
    }
    page.useCommitter(k.committer)
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

const errorsOf = (page: Page): unknown[] => vi.mocked(page.alert.alertError).mock.calls.map((call) => call[0])

async function fileOf(page: Page): Promise<Uint8Array> {
    return (await writeRtbFile({ world: page.world })).bytes
}

const assetDeps = (over: Partial<AssetPlanDeps> = {}): (() => AssetPlanDeps) => () => ({
    isNodeStore: () => false,
    probePieceStore: async () => { },
    assetLimit: () => Number.MAX_SAFE_INTEGER,
    inlayLimit: () => Number.MAX_SAFE_INTEGER,
    rule: async () => ({ kind: 'indexeddb', platform: 'posix' }),
    sizedListing: async () => null,
    ...over,
})

/** A Cancel gate a test presses; the lock is refused after a press, and `lock` can refuse it earlier. */
function gateOf(lock: () => boolean = () => true): RestoreCancelGate & { pressed: boolean, locks: number } {
    const gate = {
        pressed: false,
        locks: 0,
        get cancelRequested() { return gate.pressed },
        lockCancel() {
            gate.locks += 1
            return !gate.pressed && lock()
        },
    }
    return gate
}

async function prepare(page: Page, bytes: Uint8Array, options: { cancel?: RestoreCancelGate, deps?: Partial<RtbPrepareDeps> } = {}): Promise<RtbPrepareEnd> {
    const busy = page.busy.beginBusy('backupLoad')
    try {
        return await page.plan.prepareRtbRestore(
            { name: 'backup.rtb', size: bytes.length, lastModified: 1_700_000_000_000, source: importSourceOfBytes('backup.rtb', bytes) },
            busy,
            { saveBoundMs: 3000, cancel: options.cancel, deps: { assetDeps: assetDeps(), confirmScale: async () => true, ...options.deps } },
        )
    } finally {
        busy.end()
    }
}

/** The real hold with its `release` logged. */
function loggedHold(page: Page, log: string[], afterHold?: () => void): RtbPrepareDeps['acquireHold'] {
    return async (busy, options) => {
        const acquired = await page.hold.acquireRestoreHold(busy, options)
        if (acquired.kind !== 'held') {
            return acquired
        }
        const real = acquired.hold
        afterHold?.()
        return { kind: 'held', hold: { ...real, release: async (keep) => { log.push(`release(${keep})`); await real.release(keep) } } }
    }
}

const cancelledEnd: RtbPrepareEnd = { kind: 'ended', outcome: 'canceled', cause: 'cancelled' }

describe('Cancel before the point of no return ends canceled with nothing held', () => {
    // RR: base ignores `cancel`, so the press changes nothing and the run ends `ready`.
    test('RR-C2: a Cancel pressed in the verify progress ends cancelled, posts no read-failure error and releases the hold', async () => {
        const page = await openPage()
        const gate = gateOf()
        const log: string[] = []
        let reports = 0
        const end = await prepare(page, await fileOf(page), {
            cancel: gate,
            deps: { acquireHold: loggedHold(page, log), wait: () => { reports += 1; gate.pressed = true } },
        })
        expect(end).toEqual(cancelledEnd)
        // The verification stops at the report the Cancel was pressed in, not at a later checkpoint.
        expect(reports).toBe(1)
        expect(errorsOf(page)).toEqual([])
        expect(log).toEqual(['release(false)'])
        expect(await writeLockIsFree(page)).toBe(true)
        expect(gate.locks).toBe(0)
    })

    // RR: base ignores `cancel`.
    test('a Cancel pressed during the save ends cancelled before the hold is asked for', async () => {
        const page = await openPage()
        const gate = gateOf()
        const acquire = vi.fn(loggedHold(page, []))
        const end = await prepare(page, await fileOf(page), { cancel: gate, deps: { saveFirst: async () => { gate.pressed = true }, acquireHold: acquire } })
        expect(end).toEqual(cancelledEnd)
        expect(acquire).not.toHaveBeenCalled()
    })

    // RR: base ignores `cancel`. The checkpoint after the hold sits inside the try whose finally releases it.
    test('a Cancel pressed while the hold is granted ends cancelled and releases that hold (the checkpoint is inside the try)', async () => {
        const page = await openPage()
        const gate = gateOf()
        const log: string[] = []
        const verify = vi.fn()
        let reads = 0
        const committer: Committer = { ...page.k.committer, readCommit: async () => { reads += 1; return await page.k.committer.readCommit() } }
        const end = await prepare(page, await fileOf(page), {
            cancel: gate,
            deps: { acquireHold: loggedHold(page, log, () => { gate.pressed = true }), verify, checkImport: async () => ({ kind: 'ready', target: { committer, backend: page.k.counted.backend } }) },
        })
        expect(end).toEqual(cancelledEnd)
        const readsBeforeHold = reads
        expect(readsBeforeHold).toBe(0)
        expect(log).toEqual(['release(false)'])
        expect(verify).not.toHaveBeenCalled()
        expect(await writeLockIsFree(page)).toBe(true)
    })

    // RR: base ignores `cancel`.
    test('a Cancel pressed while the commit key is read ends cancelled before the file is opened', async () => {
        const page = await openPage()
        const gate = gateOf()
        const verify = vi.fn()
        const committer: Committer = { ...page.k.committer, readCommit: async () => { gate.pressed = true; return await page.k.committer.readCommit() } }
        const end = await prepare(page, await fileOf(page), {
            cancel: gate,
            deps: { checkImport: async () => ({ kind: 'ready', target: { committer, backend: page.k.counted.backend } }), verify },
        })
        expect(end).toEqual(cancelledEnd)
        expect(verify).not.toHaveBeenCalled()
        expect(await writeLockIsFree(page)).toBe(true)
    })

    // RR: base ignores `cancel`.
    test('a Cancel pressed while the scale question is answered ends cancelled before the lock is asked', async () => {
        const page = await openPage()
        const gate = gateOf()
        const end = await prepare(page, await fileOf(page), { cancel: gate, deps: { confirmScale: async () => { gate.pressed = true; return true } } })
        expect(end).toEqual(cancelledEnd)
        expect(gate.locks).toBe(0)
        expect(await writeLockIsFree(page)).toBe(true)
    })

    // RR: base ignores `cancel`, so the oversize question is asked.
    test('a Cancel pressed while the scale question is answered asks no oversize question (a Node page whose limit the asset exceeds)', async () => {
        const page = await openPage()
        const gate = gateOf()
        const confirm = vi.fn(async () => true)
        const bytes = (await writeRtbFile({ world: page.world, assets: { [`${'a1'.repeat(32)}.png`]: new Uint8Array(512).fill(7) } })).bytes
        const end = await prepare(page, bytes, {
            cancel: gate,
            deps: {
                assetDeps: assetDeps({ isNodeStore: () => true, assetLimit: () => 100 }),
                confirmScale: async () => { gate.pressed = true; return true },
                confirm,
            },
        })
        expect(end).toEqual(cancelledEnd)
        expect(confirm).not.toHaveBeenCalled()
        expect(gate.locks).toBe(0)
    })
    // RR: base has no `cancel` option, so a Node run ends `ready` with its marker held.
    test('RR-C3: on a Node page a Cancel pressed during the asset listing clears the restore\'s own marker before the hold is released', async () => {
        const page = await openPage()
        const gate = gateOf()
        const log: string[] = []
        const own = page.k.committer
        const committer: Committer = {
            ...own,
            openHeldBulk: async (read, request) => { log.push('openHeldBulk'); return await (own.openHeldBulk as NonNullable<Committer['openHeldBulk']>)(read, request) },
            clearHeld: async (held) => { log.push('clearHeld'); return await (own.clearHeld as NonNullable<Committer['clearHeld']>)(held) },
        }
        const scale = vi.fn(async () => true)
        const end = await prepare(page, await fileOf(page), {
            cancel: gate,
            deps: {
                checkImport: async () => ({ kind: 'ready', target: { committer, backend: page.k.counted.backend } }),
                heldMarker: () => true,
                acquireHold: loggedHold(page, log),
                assetDeps: assetDeps({ sizedListing: async () => { gate.pressed = true; return null } }),
                confirmScale: scale,
            },
        })
        expect(end).toEqual(cancelledEnd)
        expect(scale).not.toHaveBeenCalled()
        expect(log).toEqual(['openHeldBulk', 'clearHeld', 'release(false)'])
        expect(errorsOf(page)).toEqual([])
        expect((await page.k.commitKey()).staging).toBeNull()
    })

    // RR: base has no `cancel` option, so the refused lock changes nothing and the run ends `ready`.
    test('RR-C4: a refused lock ends cancelled with the cleanup done and never returns ready', async () => {
        const page = await openPage()
        const gate = gateOf(() => false)
        const log: string[] = []
        const end = await prepare(page, await fileOf(page), { cancel: gate, deps: { acquireHold: loggedHold(page, log) } })
        expect(end).toEqual(cancelledEnd)
        expect(gate.locks).toBe(1)
        expect(log).toEqual(['release(false)'])
        expect(await writeLockIsFree(page)).toBe(true)
    })

    // RR: the catch converts an ExportCancelledError only for a Cancel that was pressed; any other one is a read failure.
    test('an ExportCancelledError that no Cancel caused still posts the read-failure error', async () => {
        const page = await openPage()
        // The class of the page's own module graph: the preparation tests instanceof against it.
        const { ExportCancelledError } = await import('src/ts/exportCancel')
        const gate = gateOf()
        const end = await prepare(page, await fileOf(page), { cancel: gate, deps: { wait: () => { throw new ExportCancelledError() } } })
        expect(end).toEqual({ kind: 'ended', outcome: 'failed', cause: 'unexpected' })
        expect(errorsOf(page)).toEqual([language.store2ImportReadFailed])
    })
})

describe('the lock and the legacy run', () => {
    // RR: base has no lock call.
    test('a granted lock is asked once, after the file was verified and every prompt answered, and the run ends ready', async () => {
        const page = await openPage()
        const order: string[] = []
        const gate = gateOf(() => { order.push('lock'); return true })
        const end = await prepare(page, await fileOf(page), { cancel: gate, deps: { confirmScale: async () => { order.push('scale'); return true } } })
        expect(end.kind).toBe('ready')
        expect(order).toEqual(['scale', 'lock'])
        expect(gate.locks).toBe(1)
        if (end.kind === 'ready') {
            await end.hold.release(false)
        }
    })

    // CG: passes before and after (the start-up restore and a direct call pass no cancel).
    test('without a cancel option the run ends ready and every checkpoint is inert', async () => {
        const page = await openPage()
        const waits: string[] = []
        const end = await prepare(page, await fileOf(page), { deps: { wait: (text) => { waits.push(text) } } })
        expect(end.kind).toBe('ready')
        expect(waits.length).toBeGreaterThan(0)
        if (end.kind === 'ready') {
            await end.hold.release(false)
        }
    })
})
