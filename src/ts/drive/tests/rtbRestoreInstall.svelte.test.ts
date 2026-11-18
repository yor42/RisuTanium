/**
 * The install stage of a `.rtb` restore (CHORE-128 S12a-2): `installRtbRestore` over a real page of the application: the
 * real `saveDb()` store2 loop in a world of its own, the real `dbWriteLock`, the real storage tab locks over a fake Web
 * Locks manager, the real `UnsavedGuard`, busy registry and committer over an in-memory store2 backend (the pattern of
 * `rtbRestoreHold.svelte.test.ts`). The file is written by the product's `writeRtb` and prepared by S11's own
 * `prepareRtbRestore`; the asset store is an in-memory byte store and the side stores only log their `clear`. A stub
 * committer answers where a test needs a chosen `CommitResult`; a fake store's success says nothing about a native store.
 *
 * Labels: every test is a compatibility guard of a new contract (no pre-fix base: main has no `.rtb` install); each names
 * the scratch mutant it turns red on.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, peerCommit, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import { language } from 'src/lang'
import { importSourceOfBytes } from 'src/ts/importSource'
import { exportClosure } from 'src/ts/storage/store2/rtb/exportClosure'
import { BULK_UNIT_THRESHOLD } from 'src/ts/storage/store2/backend/types'
import type { AbandonResult, CommitRequest, CommitResult, Committer } from 'src/ts/storage/store2/commit'
import type { BaseManifest } from 'src/ts/storage/store2/legacy/importTree'
import type { Store2Backend, Store2Read } from 'src/ts/storage/store2/backend/types'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Database } from 'src/ts/storage/database.svelte'
import { PLUGIN_PERMISSIONS_STORE } from 'src/ts/drive/rtb/sideStoreConfig'
import type { AssetPlanDeps } from 'src/ts/drive/rtb/rtbAssetPlan'
import type { BusyHandle } from 'src/ts/process/memory/busyActions'
import type { RtbInstallDeps, RtbInstallEnd, RtbInstallPlan } from 'src/ts/drive/rtbRestoreInstall'
import type { RestoreHold } from 'src/ts/drive/rtbRestoreHold'
import type { RestorePlan } from 'src/ts/drive/rtbRestorePlan'
import { encodeUnit, keyOfTail, readUnit, refOfFrame, UNIT_TYPE, type Manifest, type Shard } from 'src/ts/storage/store2/format'
import { repackRtb, withBrokenDeflate, writeRtbFile, type RtbBuild, type WorldLike } from './rtb/rtbRestoreFixtures'
import { committerAnswering, loggingSideBackends, MemoryByteStore } from './rtb/rtbInstallFixtures'

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
const HASH = `${'a1'.repeat(32)}.png`
const ASSET_BYTES = new TextEncoder().encode('a synthetic asset body')
const busyHandles: BusyHandle[] = []

async function baseManifestOf(backend: Store2Backend, read: Store2Read): Promise<BaseManifest> {
    return await (await import('src/ts/storage/store2/legacy/importTree')).baseManifestOf(backend, read)
}
let holdModule: typeof import('src/ts/drive/rtbRestoreHold')
// Loaded with the page: the world resets the module registry, so a class imported statically would not be the one the install sees.
let errors: typeof import('src/ts/storage/store2/backend/errors')
let commitModule: typeof import('src/ts/storage/store2/commit')
let buildModule: typeof import('src/ts/storage/store2/rtb/restoreBuild')

// The install module reaches globalApi.svelte through the copy stage, so it is loaded after the mocks above, as the page's other modules are.
async function installRtbRestore(plan: RtbInstallPlan, hold: RestoreHold, options: Partial<RtbInstallDeps>): Promise<RtbInstallEnd> {
    return await (await import('src/ts/drive/rtbRestoreInstall')).installRtbRestore(plan, hold, options)
}

/** A stop's message with the line that names what the copy already left on this device. */
function withCopiedKept(text: string): string {
    return text + '\n\n' + language.rtbRestoreCopiedKept
}

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
    for (const handle of busyHandles.splice(0)) {
        handle.end()
    }
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
}

async function openPage(options: { taskPresets?: boolean } = {}): Promise<Page> {
    const locks = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(locks, 'this'), configurable: true })
    h.db = makeDb('base', ['alpha', 'beta'])
    if (options.taskPresets === true) {
        h.db.taskPresets = [{ name: 'tp1', x: 1 }, { name: 'tp2', y: 2 }]
    }
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
    }
    holdModule = await import('src/ts/drive/rtbRestoreHold')
    errors = await import('src/ts/storage/store2/backend/errors')
    commitModule = await import('src/ts/storage/store2/commit')
    buildModule = await import('src/ts/storage/store2/rtb/restoreBuild')
    bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer: k.committer } as unknown as Store2Session)
    w.pageMode.setPageStorageMode({ kind: 'store2' })
    vi.mocked(page.alert.alertConfirm).mockImplementation(async () => true)
    w.start()
    await sleepReal(150)
    return page
}

/** Whether `dbWriteLock` can be taken within a moment: false while a restore holds or keeps it closed. */
async function writeLockIsFree(page: Page): Promise<boolean> {
    const taken = page.w.api.dbWriteLock.acquire().then((release) => { release(); return true })
    return await Promise.race([taken, sleepReal(250).then(() => false)])
}

const errorsOf = (page: Page): unknown[] => vi.mocked(page.alert.alertError).mock.calls.map((call) => call[0])
const waitsOf = (page: Page): unknown[] => vi.mocked(page.alert.alertWait).mock.calls.map((call) => call[0])

/** Parks the page's loop on a peer commit and marks the tab dirty, so the tab is never clean: the guard has something to ask about. */
async function parkDirty(page: Page): Promise<void> {
    await peerCommit(page.k, (db) => { db.mainPrompt = 'peer' })
    page.db.mainPrompt = 'mine'
    page.flush()
    await until(() => page.loop.isSaveLoopParked(), 'the loop to park on the peer commit')
}

async function worldOfPage(page: Page): Promise<WorldLike> {
    const store = new Map<string, Uint8Array>()
    const closure = await exportClosure(page.k.counted.memory, { onUnits: async (batch) => { for (const unit of batch) { store.set(unit.key, unit.bytes) } } })
    return { store, manifestKey: closure.manifestKey, refsByRow: new Map(closure.refRows.map((row) => [row, []])) }
}

function assetDeps(): () => AssetPlanDeps {
    return () => ({
        isNodeStore: () => false,
        probePieceStore: async () => { },
        assetLimit: () => Number.MAX_SAFE_INTEGER,
        inlayLimit: () => Number.MAX_SAFE_INTEGER,
        rule: async () => ({ kind: 'indexeddb', platform: 'posix' }),
        sizedListing: async () => null,
    })
}

interface Prepared {
    plan: RestorePlan
    hold: RestoreHold
    bytes: Uint8Array
}

/** The page's own profile as an `.rtb` file, prepared by S11 into the plan and the hold the install consumes. */
async function prepared(page: Page, build: Partial<RtbBuild> = {}, bytesOf?: (file: Uint8Array) => Promise<Uint8Array>): Promise<Prepared> {
    const written = (await writeRtbFile({ world: await worldOfPage(page), ...build })).bytes
    const bytes = bytesOf === undefined ? written : await bytesOf(written)
    const busy = page.busy.beginBusy('backupLoad')
    busyHandles.push(busy)
    const end = await page.plan.prepareRtbRestore(
        { name: 'a.rtb', size: bytes.length, lastModified: 1, source: importSourceOfBytes('a.rtb', bytes) },
        busy,
        { saveBoundMs: 100, deps: { assetDeps: assetDeps(), confirmScale: async () => true } },
    )
    if (end.kind !== 'ready') {
        throw new Error(`the preparation ended ${end.kind}`)
    }
    return { plan: end.plan, hold: end.hold, bytes }
}

interface Setup {
    store: MemoryByteStore
    sideLog: string[]
}

/** Runs the install with the asset store in memory, no pipeline, and the side stores logging their clear. */
async function install(prep: { plan: RtbInstallPlan, hold: RestoreHold }, setup: Setup, options: Partial<RtbInstallDeps> = {}): Promise<RtbInstallEnd> {
    return await installRtbRestore(prep.plan, prep.hold, {
        copyDeps: { store: async () => setup.store, createPipeline: async () => null, noteAndSettle: async () => { } },
        sideBackends: loggingSideBackends(setup.sideLog),
        ...options,
    })
}

const setupOf = (): Setup => ({ store: new MemoryByteStore(), sideLog: [] })

function stoppedOf(end: RtbInstallEnd) {
    if (end.kind !== 'stopped') {
        throw new Error(`the install ended ${end.kind}`)
    }
    return end
}

/** A hold whose `release` is a spy over the real one. */
function spiedHold(hold: RestoreHold): { hold: RestoreHold, release: ReturnType<typeof vi.fn<(keep: boolean) => Promise<void>>> } {
    const release = vi.fn((keep: boolean) => hold.release(keep))
    return { hold: { ...hold, release }, release }
}

function withCommitter(plan: RtbInstallPlan, committer: Committer): RtbInstallPlan {
    return { ...plan, target: { ...plan.target, committer } }
}

const committedKey = async (page: Page) => (await page.k.commitKey()).current?.key ?? null

describe('a landed install (U12, U24)', () => {
    test('the real committer lands the file: commit request, retained base, kept legacy keep, unioned req, hold kept and grants cleared once (guard; MU14 fails the request check)', async () => {
        const page = await openPage()
        const setup = setupOf()
        const before = await page.k.commitKey()
        const baseAt = await baseManifestOf(page.k.counted.backend, await page.k.committer.readCommit())
        if (baseAt.status !== 'ok') {
            throw new Error('the page has no base manifest')
        }
        const seen: CommitRequest[] = []
        const committer = committerAnswering(page.k.committer, async (read, request) => {
            seen.push(request)
            return await page.k.committer.commit(read, request)
        })
        const prep = await prepared(page, { assets: { [HASH]: ASSET_BYTES } })
        const spied = spiedHold(prep.hold)
        const end = await install({ plan: withCommitter(prep.plan, committer), hold: spied.hold }, setup)
        if (end.kind !== 'landed') {
            throw new Error(`the install ended ${end.kind}`)
        }
        expect(spied.release).not.toHaveBeenCalled()
        expect(waitsOf(page)).toContain(language.rtbRestoreInstalling)
        expect(end.facts.assetsWritten).toBe(1)
        expect(setup.store.files.get(`assets/${HASH}`)).toEqual(ASSET_BYTES)
        expect(seen).toHaveLength(1)
        expect(seen[0].label).toBe('import')
        expect(seen[0].force).toBe(true)
        expect(seen[0].carry).toBe(commitModule.IMPORT_REPLACES_BASE)
        const after = await page.k.commitKey()
        expect(after.seq).toBeGreaterThan(before.seq)
        expect(after.retained.map((entry) => entry.key)).toContain(before.current?.key)
        const installed = await baseManifestOf(page.k.counted.backend, await page.k.committer.readCommit())
        if (installed.status !== 'ok') {
            throw new Error('the installed manifest does not read')
        }
        expect(installed.manifest.fixed.legacyKeep).toEqual(baseAt.manifest.fixed.legacyKeep)
        expect(installed.manifest.req).toEqual(expect.arrayContaining([...baseAt.manifest.req]))
        expect(installed.manifest.seq).toBe(after.seq)
        expect(setup.sideLog).toEqual([`clear:${PLUGIN_PERMISSIONS_STORE.name}`])
        expect(errorsOf(page)).toEqual([])
        expect(await writeLockIsFree(page)).toBe(false)
    })

    test.each([['ordinary', false], ['bulk', true]] as const)('the %s commit goes through the guarded commit: commitStreamed is never called, and a busy entry begun after the copy is refused at the flip (guard; MU24 and MU13 fail it)', async (_name, bulk) => {
        {
            const page = await openPage()
            const setup = setupOf()
            const streamed = vi.fn(async (): Promise<CommitResult> => { throw new Error('commitStreamed must not be called') })
            // The page's committer was built before the world reset the module registry, so the abort it throws is another copy of the class the install checks: it is re-raised as the install's own.
            const committer: Committer = {
                ...page.k.committer,
                commitStreamed: streamed,
                commit: async (read, request) => {
                    try {
                        return await page.k.committer.commit(read, request)
                    } catch (error) {
                        if (error instanceof Error && error.name === 'Store2BulkAbortError') {
                            const abort = error as Error & { original: unknown, cleared: AbandonResult | null }
                            throw new commitModule.Store2BulkAbortError(abort.original, abort.cleared)
                        }
                        throw error
                    }
                },
            }
            const prep = await prepared(page)
            const before = await page.k.commitKey()
            let work: BusyHandle | null = null
            const end = await install({ ...prep, plan: withCommitter(prep.plan, committer) }, setup, {
                baseManifest: async (backend, read) => {
                    work = page.busy.beginBusy('export')
                    return await baseManifestOf(backend, read)
                },
                planRestore: (input) => {
                    const request = buildModule.planRestore(input)
                    return bulk ? { newUnits: BULK_UNIT_THRESHOLD + 1, build: request.build } : request
                },
            })
            work?.end()
            const stop = stoppedOf(end)
            expect(stop).toMatchObject({ outcome: 'nothing-replaced', cause: 'busy' })
            expect(errorsOf(page).at(-1)).toBe(withCopiedKept(language.backupLoadWorkInProgress))
            expect(streamed).not.toHaveBeenCalled()
            const after = await page.k.commitKey()
            expect(after.current?.key).toBe(before.current?.key)
            expect(after.staging).toBeNull()
            expect(await writeLockIsFree(page)).toBe(true)
        }
    })

    test('commitStreamed present on a committer that lands normally is still not used (guard; MU24 fails it)', async () => {
        const page = await openPage()
        const streamed = vi.fn(async (): Promise<CommitResult> => { throw new Error('commitStreamed must not be called') })
        const prep = await prepared(page)
        const end = await install({ ...prep, plan: withCommitter(prep.plan, { ...page.k.committer, commitStreamed: streamed }) }, setupOf())
        expect(end.kind).toBe('landed')
        expect(streamed).not.toHaveBeenCalled()
    })
})

describe('I0 to I3: stops before the commit (U8 to U10, U13, U18 to U20)', () => {
    test('T28: a block of the file that no longer reads, or no longer matches what the check saw, stops before the commit with the file-changed text (guard; MU9 fails it)', async () => {
        const page = await openPage()
        const setup = setupOf()
        const prep = await prepared(page)
        const blockName = prep.plan.index.entry(prep.plan.store2.blocks[0]).name
        const broken = await withBrokenDeflate(prep.bytes, blockName)
        const commit = vi.fn(async (): Promise<CommitResult> => { throw new Error('no commit expected') })
        const changedBytes = { ...prep.plan, source: (await import('./rtb/sparseSource')).rangeSourceOfBytes(broken), target: { ...prep.plan.target, committer: committerAnswering(page.k.committer, commit) } }
        const end = stoppedOf(await install({ ...prep, plan: changedBytes }, setup))
        expect(end).toMatchObject({ outcome: 'nothing-replaced', cause: 'could-not-read' })
        expect(errorsOf(page).at(-1)).toBe(language.backupFileChangedWhileReading)
        expect(commit).not.toHaveBeenCalled()
        expect(await writeLockIsFree(page)).toBe(true)

        const second = await openPage()
        const again = await prepared(second)
        const [tail, info] = [...again.plan.store2.tails][0]
        const tails = new Map(again.plan.store2.tails).set(tail, { ...info, crc: info.crc ^ 1 })
        const mismatch = await install({ ...again, plan: { ...again.plan, store2: { ...again.plan.store2, tails } } }, setupOf())
        expect(stoppedOf(mismatch)).toMatchObject({ outcome: 'nothing-replaced', cause: 'could-not-read' })
        expect(errorsOf(second).at(-1)).toBe(language.backupFileChangedWhileReading)
    })

    test('a commit by another committer after the preparation gives the not-happened text with the copied-kept line; an unreadable or throwing commit key stops with its text; nothing is committed (guard; MU10 fails it)', async () => {
        const page = await openPage()
        const setup = setupOf()
        const prep = await prepared(page)
        await peerCommit(page.k, (db) => { db.mainPrompt = 'peer moved it' })
        const moved = stoppedOf(await install(prep, setup))
        expect(moved).toMatchObject({ outcome: 'nothing-replaced', cause: 'base-moved' })
        expect(errorsOf(page).at(-1)).toBe(withCopiedKept(language.restoreNotHappenedNotice))
        expect(await writeLockIsFree(page)).toBe(true)
        worlds.parkAll()

        const second = await openPage()
        const unreadable = await prepared(second)
        const read = await second.k.committer.readCommit()
        const damaged = committerAnswering({ ...second.k.committer, readCommit: async () => ({ ...read, bytes: null }) }, second.k.committer.commit)
        const refused = stoppedOf(await install({ ...unreadable, plan: withCommitter(unreadable.plan, damaged) }, setupOf()))
        expect(refused).toMatchObject({ outcome: 'nothing-replaced', cause: 'base-unreadable' })
        expect(errorsOf(second).at(-1)).toBe(withCopiedKept(language.store2ImportRefused))
        worlds.parkAll()

        const third = await openPage()
        const failing = await prepared(third)
        const throwing: Committer = { ...third.k.committer, readCommit: async () => { throw new Error('disk gone') } }
        const failed = stoppedOf(await install({ ...failing, plan: withCommitter(failing.plan, throwing) }, setupOf()))
        expect(failed).toMatchObject({ outcome: 'nothing-replaced', cause: 'commit-read-failed' })
        expect(errorsOf(third).at(-1)).toBe(withCopiedKept(language.store2ImportReadFailed))
    })

    test.each([
        ['an unreadable base manifest read', 'read-failed', language.store2ImportReadFailed, async (): Promise<BaseManifest> => ({ status: 'failed', cause: new errors.Store2BackendFailureError('the manifest read broke') })],
        ['an unreadable base manifest', 'base-unreadable', language.store2ImportRefused, async (): Promise<BaseManifest> => ({ status: 'unreadable', detail: 'the manifest does not parse' })],
    ] as const)('%s stops with its text and the copied-kept line, commits nothing and frees the write lock (guard; R19 fails it)', async (_name, cause, message, baseManifest) => {
        const page = await openPage()
        const prep = await prepared(page)
        const commit = vi.fn(async (): Promise<CommitResult> => { throw new Error('no commit expected') })
        const end = await install({ ...prep, plan: withCommitter(prep.plan, committerAnswering(page.k.committer, commit)) }, setupOf(), { baseManifest })
        expect(stoppedOf(end)).toMatchObject({ outcome: 'nothing-replaced', cause })
        expect(errorsOf(page).at(-1)).toBe(withCopiedKept(message))
        expect(commit).not.toHaveBeenCalled()
        expect(await writeLockIsFree(page)).toBe(true)
    })

    test('T47d: the guard is the preparation\'s own and is asked after the authoritative read only when the tab was marked dirty since; a decline commits nothing and shows the copied-kept line alone (guard; MU11 and MU12 fail it)', async () => {
        const page = await openPage()
        await parkDirty(page)
        const prep = await prepared(page)
        const log: string[] = []
        const readCommit = prep.plan.target.committer.readCommit.bind(prep.plan.target.committer)
        const check = prep.hold.guard.check.bind(prep.hold.guard)
        prep.hold.guard.check = async () => { log.push('guard'); return await check() }
        const commit = vi.fn(async (): Promise<CommitResult> => { throw new Error('no commit expected') })
        const committer: Committer = { ...committerAnswering(prep.plan.target.committer, commit), readCommit: async () => { log.push('readCommit'); return await readCommit() } }
        // Marked dirty since the preparation: asked again, after the authoritative read, and a decline commits nothing.
        page.db.mainPrompt = 'edited again'
        page.flush()
        vi.mocked(page.alert.alertConfirm).mockImplementation(async () => false)
        const declined = stoppedOf(await install({ ...prep, plan: withCommitter(prep.plan, committer) }, setupOf()))
        expect(declined).toMatchObject({ outcome: 'nothing-replaced', cause: 'declined' })
        expect(log).toEqual(['readCommit', 'guard'])
        expect(errorsOf(page).at(-1)).toBe(language.rtbRestoreCopiedKept)
        expect(commit).not.toHaveBeenCalled()
        expect(await writeLockIsFree(page)).toBe(true)
    })

    test('the guard ran once for the accepted edits and not again when nothing was marked since (guard; MU12 fails it)', async () => {
        const page = await openPage()
        await parkDirty(page)
        const prep = await prepared(page)
        const confirms = () => vi.mocked(page.alert.alertConfirm).mock.calls.filter((call) => call[0] === language.store2RestoreUnsavedConfirm).length
        expect(confirms()).toBe(1)
        const end = await install(prep, setupOf())
        expect(end.kind).toBe('landed')
        expect(confirms()).toBe(1)
    })

    test('NO-PAGE-KEEP: the restore plan is asked with the file\'s frames and the base\'s keep and req only, so the page\'s theme packs and task presets are never carried (guard; MU15 fails it)', async () => {
        const page = await openPage()
        const prep = await prepared(page)
        const inputs: Parameters<RtbInstallDeps['planRestore']>[0][] = []
        const end = await install(prep, setupOf(), { planRestore: (input) => { inputs.push(input); return buildModule.planRestore(input) } })
        expect(end.kind).toBe('landed')
        expect(inputs).toHaveLength(1)
        expect(Object.keys(inputs[0]).sort()).toEqual(['frames', 'omitted', 'root', 'target'])
        expect(Object.keys(inputs[0].target).sort()).toEqual(['legacyKeep', 'req'])
        expect(inputs[0].frames.size).toBe(prep.plan.store2.tails.size)
    })

    test('a damaged restore plan stops with the damaged text and the copied-kept line, commits nothing and releases the lock (guard)', async () => {
        const page = await openPage()
        const prep = await prepared(page)
        const commit = vi.fn(async (): Promise<CommitResult> => { throw new Error('no commit expected') })
        const end = stoppedOf(await install({ ...prep, plan: withCommitter(prep.plan, committerAnswering(page.k.committer, commit)) }, setupOf(), {
            planRestore: () => { throw new buildModule.RtbRestoreError('unreadable', 'the unit does not read') },
        }))
        expect(end).toMatchObject({ outcome: 'nothing-replaced', cause: 'damaged' })
        expect(errorsOf(page).at(-1)).toBe(withCopiedKept(language.rtbRestoreDamaged))
        expect(commit).not.toHaveBeenCalled()
        expect(await writeLockIsFree(page)).toBe(true)
    })

    test('OQ-3 B: the plugin grants are cleared once, after the guard and the plan and before the commit; a guard decline leaves them (guard; MU19 fails it)', async () => {
        const page = await openPage()
        const setup = setupOf()
        const prep = await prepared(page)
        const log: string[] = []
        const sideBackends = loggingSideBackends(log)
        const committer = committerAnswering(prep.plan.target.committer, async (read, request) => {
            log.push('commit')
            return await prep.plan.target.committer.commit(read, request)
        })
        prep.hold.guard.check = async () => { log.push('guard'); return true }
        const end = await install({ ...prep, plan: withCommitter(prep.plan, committer) }, setup, {
            sideBackends,
            planRestore: (input) => { log.push('plan'); return buildModule.planRestore(input) },
        })
        expect(end.kind).toBe('landed')
        expect(log).toEqual(['guard', 'plan', `clear:${PLUGIN_PERMISSIONS_STORE.name}`, 'commit'])

        const second = await openPage()
        const declining = await prepared(second)
        const declineLog: string[] = []
        declining.hold.guard.check = async () => false
        const stop = stoppedOf(await install(declining, setupOf(), { sideBackends: loggingSideBackends(declineLog) }))
        expect(stop.cause).toBe('declined')
        expect(declineLog).toEqual([])
    })

    test('write order: the asset write comes before the commit key read, no store2 write comes before the commit, and no side write comes before the clear (guard; MU20 fails it)', async () => {
        const page = await openPage()
        const setup = setupOf()
        const prep = await prepared(page, { assets: { [HASH]: ASSET_BYTES } })
        const log: string[] = []
        const writesBefore = page.k.counted.writeCalls()
        const readCommit = prep.plan.target.committer.readCommit.bind(prep.plan.target.committer)
        let writesAtCommit = -1
        const committer: Committer = {
            ...prep.plan.target.committer,
            readCommit: async () => { log.push(setup.store.files.has(`assets/${HASH}`) ? 'readCommit-after-asset' : 'readCommit-before-asset'); return await readCommit() },
            commit: async (read, request) => {
                writesAtCommit = page.k.counted.writeCalls()
                log.push(`commit:${setup.sideLog.length}`)
                return await prep.plan.target.committer.commit(read, request)
            },
        }
        const end = await install({ ...prep, plan: withCommitter(prep.plan, committer) }, setup)
        expect(end.kind).toBe('landed')
        expect(log).toEqual(['readCommit-after-asset', 'commit:1'])
        expect(writesAtCommit).toBe(writesBefore)
    })
})

describe('the outcome mapping (U14, U14b)', () => {
    async function stubbed(result: (page: Page) => Promise<CommitResult>) {
        const page = await openPage()
        const prep = await prepared(page)
        const answer = await result(page)
        const commit = vi.fn(async (): Promise<CommitResult> => answer)
        const end = await install({ ...prep, plan: withCommitter(prep.plan, committerAnswering(page.k.committer, commit)) }, setupOf())
        return { page, end, commit }
    }

    test.each([
        ['stale page', 'failed', 'stale-page', language.restoreNotHappenedNotice, async () => ({ status: 'failed', cause: new errors.Store2StalePageError('replaced') }) as CommitResult],
        ['another backend failure', 'failed', 'write-failed', language.internalBackupWriteFailed, async () => ({ status: 'failed', cause: new errors.Store2BackendFailureError('no') }) as CommitResult],
        ['abandoned', 'failed', 'abandoned', language.store2ImportAbandoned, async () => ({ status: 'abandoned', reason: 'upload-failed', cleared: null }) as CommitResult],
        ['marker present', 'nothing-replaced', 'marker-standing', language.store2RestoreBulkMarker, async () => ({ status: 'refused', reason: 'marker-present', detail: 'x' }) as CommitResult],
        ['too new', 'nothing-replaced', 'too-new', language.store2ImportTooNew, async () => ({ status: 'refused', reason: 'too-new', detail: 'x' }) as CommitResult],
        ['any other refusal', 'nothing-replaced', 'library-refused', language.store2ImportRefused, async () => ({ status: 'refused', reason: 'not-named', detail: 'x' }) as CommitResult],
    ] as const)('%s stops with its message and the copied-kept line, the write lock is free (guard; M-z16 fails the table)', async (_name, outcome, cause, message, result) => {
        const { page, end } = await stubbed(result)
        expect(stoppedOf(end)).toMatchObject({ outcome, cause })
        expect(errorsOf(page).at(-1)).toBe(withCopiedKept(message))
        expect(await writeLockIsFree(page)).toBe(true)
    })

    test.each([
        ['conflict', async (page: Page) => ({ status: 'conflict', current: await page.k.committer.readCommit() }) as CommitResult],
        ['unknown', async () => ({ status: 'unknown', cause: new errors.Store2BackendFailureError('no') }) as CommitResult],
    ] as const)('%s ends unconfirmed: the wait alert, the hold released with the write lock kept closed (guard; MU16 fails the conflict row, MU17 fails it)', async (_name, result) => {
        const { page, end } = await stubbed(result)
        expect(end).toMatchObject({ kind: 'unconfirmed' })
        expect(waitsOf(page).at(-1)).toBe(language.store2ImportUnconfirmed)
        expect(errorsOf(page)).toEqual([])
        expect(await writeLockIsFree(page)).toBe(false)
    })

    test('committed ends landed with the flushed state, no message, and the hold still held (guard)', async () => {
        const { page, end } = await stubbed(async (p) => ({ status: 'committed', value: await p.k.commitKey(), bytes: new Uint8Array(), flushed: false, manifestKey: 'm', mode: 'ordinary' }) as CommitResult)
        expect(end).toMatchObject({ kind: 'landed', flushed: false })
        expect(waitsOf(page)).not.toContain(language.store2ImportUnconfirmed)
        expect(errorsOf(page)).toEqual([])
        expect(await writeLockIsFree(page)).toBe(false)
    })

    test.each([
        ['a backend Error', 'unconfirmed', () => new Error('upload failed')],
        ['a Store2BulkAbortError of a TypeError', 'unconfirmed', () => new commitModule.Store2BulkAbortError(new TypeError('x'), null)],
        ['a Store2BulkAbortError of the busy error (control)', 'busy', () => new commitModule.Store2BulkAbortError(new holdModule.RtbRestoreBusyError(), null)],
        ['the busy error itself (control)', 'busy', () => new holdModule.RtbRestoreBusyError()],
    ] as const)('commit() rejecting with %s ends %s, and only a busy abort leaves the write lock free (guard; MU21 fails it)', async (_name, ending, make) => {
        const page = await openPage()
        const prep = await prepared(page)
        const commit = vi.fn(async (): Promise<CommitResult> => { throw make() })
        const end = await install({ ...prep, plan: withCommitter(prep.plan, committerAnswering(page.k.committer, commit)) }, setupOf())
        if (ending === 'unconfirmed') {
            expect(end.kind).toBe('unconfirmed')
            expect(waitsOf(page).at(-1)).toBe(language.store2ImportUnconfirmed)
            expect(await writeLockIsFree(page)).toBe(false)
        } else {
            expect(stoppedOf(end)).toMatchObject({ outcome: 'nothing-replaced', cause: 'busy' })
            expect(errorsOf(page).at(-1)).toBe(withCopiedKept(language.backupLoadWorkInProgress))
            expect(await writeLockIsFree(page)).toBe(true)
        }
    })
})

describe('never rejects (U14c, U14d, U17)', () => {
    const committedStub = async (page: Page): Promise<Committer> => {
        const value = await page.k.commitKey()
        return committerAnswering(page.k.committer, async () => ({ status: 'committed', value, bytes: new Uint8Array(), flushed: true, manifestKey: 'm', mode: 'ordinary' }))
    }

    test('(i) a throw after the commit returned committed resolves unconfirmed: release(true) once and never release(false), the wait alert, the lock closed (guard; MU22 and MU25 fail it)', async () => {
        const page = await openPage()
        const prep = await prepared(page)
        const spied = spiedHold(prep.hold)
        const end = installRtbRestore(withCommitter(prep.plan, await committedStub(page)), spied.hold, {
            copyDeps: { store: async () => new MemoryByteStore(), createPipeline: async () => null, noteAndSettle: async () => { } },
            sideBackends: loggingSideBackends([]),
            facts: () => { throw new Error('the facts builder broke after the commit') },
        })
        await expect(end).resolves.toMatchObject({ kind: 'unconfirmed' })
        expect(spied.release.mock.calls).toEqual([[true]])
        expect(waitsOf(page).at(-1)).toBe(language.store2ImportUnconfirmed)
        expect(await writeLockIsFree(page)).toBe(false)
    })

    test('(ii) a release that rejects is logged, the install still resolves unconfirmed, and the wait alert is shown after the release attempt (guard; MU25b fails it)', async () => {
        const page = await openPage()
        const prep = await prepared(page)
        const release = vi.fn(async () => { throw new Error('the release broke') })
        const wait = vi.fn()
        const end = await installRtbRestore(withCommitter(prep.plan, await committedStub(page)), { ...prep.hold, release }, {
            copyDeps: { store: async () => new MemoryByteStore(), createPipeline: async () => null, noteAndSettle: async () => { } },
            sideBackends: loggingSideBackends([]),
            facts: () => { throw new Error('the facts builder broke after the commit') },
            wait,
        })
        expect(end.kind).toBe('unconfirmed')
        const shown = wait.mock.calls.findIndex((call) => call[0] === language.store2ImportUnconfirmed)
        expect(shown).toBeGreaterThanOrEqual(0)
        expect(release).toHaveBeenCalledWith(true)
        expect(release.mock.invocationCallOrder[0]).toBeLessThan(wait.mock.invocationCallOrder[shown])
    })

    test('(iii) an alert that throws is logged, the install still resolves unconfirmed, and the release ran first (guard; an unwrapped alert fails it)', async () => {
        const page = await openPage()
        const prep = await prepared(page)
        const spied = spiedHold(prep.hold)
        const wait = vi.fn((text: string) => {
            if (text === language.store2ImportUnconfirmed) {
                throw new Error('the alert broke')
            }
        })
        const end = await installRtbRestore(withCommitter(prep.plan, await committedStub(page)), spied.hold, {
            copyDeps: { store: async () => new MemoryByteStore(), createPipeline: async () => null, noteAndSettle: async () => { } },
            sideBackends: loggingSideBackends([]),
            facts: () => { throw new Error('the facts builder broke after the commit') },
            wait,
        })
        expect(end.kind).toBe('unconfirmed')
        const attempt = wait.mock.calls.findIndex((call) => call[0] === language.store2ImportUnconfirmed)
        expect(spied.release.mock.invocationCallOrder[0]).toBeLessThan(wait.mock.invocationCallOrder[attempt])
        expect(await writeLockIsFree(page)).toBe(false)
    })

    test.each([
        ['(i) the restore plan throws a TypeError after the copy wrote one asset', true],
        ['(ii) the copy itself rejects', false],
    ] as const)('%s: resolves stopped write-failed with the failed text last, release(false) once, nothing committed, the next save can commit (guard; MU25 fails it)', async (_name, afterCopy) => {
        const page = await openPage()
        const setup = setupOf()
        const prep = await prepared(page, { assets: { [HASH]: ASSET_BYTES } })
        const spied = spiedHold(prep.hold)
        const commit = vi.fn(async (): Promise<CommitResult> => { throw new Error('no commit expected') })
        const options: Partial<RtbInstallDeps> = afterCopy
            ? { planRestore: () => { throw new TypeError('the plan broke') } }
            : { copy: async () => { throw new Error('the copy broke') } }
        const end = installRtbRestore(withCommitter(prep.plan, committerAnswering(page.k.committer, commit)), spied.hold, {
            copyDeps: { store: async () => setup.store, createPipeline: async () => null, noteAndSettle: async () => { } },
            sideBackends: loggingSideBackends(setup.sideLog),
            ...options,
        })
        await expect(end).resolves.toMatchObject({ kind: 'stopped', outcome: 'failed', cause: 'write-failed' })
        expect(errorsOf(page).at(-1)).toBe(language.restoreWriteFailed)
        expect(spied.release.mock.calls).toEqual([[false]])
        expect(commit).not.toHaveBeenCalled()
        expect(setup.store.files.has(`assets/${HASH}`)).toBe(afterCopy)
        expect(await writeLockIsFree(page)).toBe(true)
    })

    test.each([
        ['already shown by the copy', true, []],
        ['not shown by the copy (its own alert failed)', false, [language.restoreWriteFailed]],
    ] as const)('a handled copy stop %s keeps its outcome and cause, releases(false) once, and the generic text is the only alert when the copy showed none (guard; R14 and MX-copy-unshown-silent fail it)', async (_name, shown, alerts) => {
        const page = await openPage()
        const prep = await prepared(page)
        const spied = spiedHold(prep.hold)
        const commit = vi.fn(async (): Promise<CommitResult> => { throw new Error('no commit expected') })
        const facts = { assetsWritten: 0, assetsPresent: 0, skippedAssets: [], inlays: { written: 0, skipped: [], changed: false } }
        const end = await installRtbRestore(withCommitter(prep.plan, committerAnswering(page.k.committer, commit)), spied.hold, {
            copy: async () => ({ kind: 'stopped', outcome: 'nothing-replaced', cause: 'corrupt-entry', facts, shown }),
            sideBackends: loggingSideBackends([]),
        })
        expect(stoppedOf(end)).toMatchObject({ outcome: 'nothing-replaced', cause: 'corrupt-entry' })
        expect(errorsOf(page)).toEqual(alerts)
        expect(spied.release.mock.calls).toEqual([[false]])
        expect(commit).not.toHaveBeenCalled()
        expect(await writeLockIsFree(page)).toBe(true)
    })

    test('a store that throws a TypeError mid-copy ends failed with the failed text once, release(false) once, and the next save can commit (guard; MU18 fails it)', async () => {
        const page = await openPage()
        const store = new MemoryByteStore({ failWrite: () => new TypeError('the store broke') })
        const prep = await prepared(page, { assets: { [HASH]: ASSET_BYTES } })
        const spied = spiedHold(prep.hold)
        const end = await installRtbRestore(prep.plan, spied.hold, {
            copyDeps: { store: async () => store, createPipeline: async () => null, noteAndSettle: async () => { } },
            sideBackends: loggingSideBackends([]),
        })
        expect(stoppedOf(end)).toMatchObject({ outcome: 'failed', cause: 'write-failed' })
        expect(errorsOf(page)).toEqual([language.restoreWriteFailed])
        expect(spied.release.mock.calls).toEqual([[false]])
        expect(await writeLockIsFree(page)).toBe(true)
    })
})

describe('a file from a later writer (U15, U13)', () => {
    interface Plant {
        replace: Map<string, Uint8Array | null>
        omitted: { kind: string, name: string, reason: string }[]
        /** The type 15 list at v 2, as the file holds it, and the tail the file names it by. */
        listFrame: Uint8Array
        listTail: string
        /** The task preset (type 26) left out of the file, and how many the page holds. */
        presetTail: string
        presetCount: number
    }

    const unknownEntry = { name: 'x/unknown/one', bytes: new TextEncoder().encode('unknown-entry-bytes'.repeat(40)) }

    async function* irisRecords(): AsyncGenerator<{ key: string, value: unknown }> {
        yield { key: 'k1', value: { a: 1 } }
    }

    /** The page's own store with an asset list raised to v 2 and one task preset left out, as another writer's file would hold them. */
    function plantOf(world: WorldLike): Plant {
        const manifestFrame = world.store.get(world.manifestKey)
        const parsedManifest = manifestFrame === undefined ? null : readUnit(manifestFrame, UNIT_TYPE.manifest)
        if (parsedManifest === null || (parsedManifest.status !== 'ok' && parsedManifest.status !== 'stale')) {
            throw new Error('the page manifest does not read')
        }
        const manifest = structuredClone(parsedManifest.value.body) as Manifest
        const presets = manifest.fixed.taskPresets ?? []
        if (presets.length < 2) {
            throw new Error('the page holds fewer than two task presets')
        }
        const presetTail = presets[0][0]
        const replace = new Map<string, Uint8Array | null>([[keyOfTail(presetTail), null]])
        const listFrame = encodeUnit(UNIT_TYPE.assetList, { v: 2, h: '', l: [] })
        let listTail = ''
        for (const [position, shardRef] of manifest.shards.entries()) {
            const key = keyOfTail(shardRef[0])
            const parsed = readUnit(world.store.get(key) as Uint8Array, UNIT_TYPE.shard)
            if (parsed.status !== 'ok' && parsed.status !== 'stale') {
                continue
            }
            const shard = structuredClone(parsed.value.body) as Shard
            if (shard.entries.length === 0) {
                continue
            }
            const entry = shard.entries[0]
            listTail = entry.al[0]
            const listKey = keyOfTail(listTail)
            replace.set(listKey, listFrame)
            const ref = refOfFrame(listKey, listFrame)
            entry.al = [ref[0], ref[1], ref[2], 2]
            const shardBytes = encodeUnit(UNIT_TYPE.shard, shard)
            replace.set(key, shardBytes)
            manifest.shards[position] = refOfFrame(key, shardBytes)
            break
        }
        if (listTail === '') {
            throw new Error('the page holds no shard entry to plant a list in')
        }
        replace.set(world.manifestKey, encodeUnit(UNIT_TYPE.manifest, manifest))
        return { replace, omitted: [{ kind: 'unit', name: presetTail, reason: 'damaged' }], listFrame, listTail, presetTail, presetCount: presets.length }
    }

    /** The prepared file: the planted store, one asset, side.iris at v 2, an unknown optional row with an entry, and an omitted type 26 unit. */
    async function preparedPlanted(page: Page): Promise<{ prep: Prepared, plant: Plant }> {
        const world = await worldOfPage(page)
        const plant = plantOf(world)
        const prep = await prepared(
            page,
            { world, replace: plant.replace, omitted: plant.omitted, assets: { [HASH]: ASSET_BYTES }, sides: { 'side.iris': { records: irisRecords() } } },
            (file) => repackRtb(file, {
                manifest: (manifest) => {
                    const rows = manifest.sections as { id: string, v: number }[]
                    ;(rows as unknown[]).push({ id: 'x-test.unknown', v: 1, required: false, prefix: 'x/unknown/', entries: 0, bytes: 0 })
                    const iris = rows.find((row) => row.id === 'side.iris')
                    if (iris === undefined) {
                        throw new Error('the file has no side.iris row')
                    }
                    iris.v = 2
                },
                add: [unknownEntry],
            }),
        )
        return { prep, plant }
    }

    async function installedManifest(page: Page): Promise<Manifest> {
        const base = await baseManifestOf(page.k.counted.backend, await page.k.committer.readCommit())
        if (base.status !== 'ok') {
            throw new Error('the installed manifest does not read')
        }
        return base.manifest
    }

    test('AS-GOLDEN: a type 15 list at v 2 installs byte-equal under a new key, the omitted type 26 unit is gone from the installed list, every a/ entry is written, nothing is written under x/ or to a side store but the grants (guard; M-z17 turns the preparation red, M-z41 and MU20 fail the write checks)', async () => {
        const page = await openPage({ taskPresets: true })
        const setup = setupOf()
        const { prep, plant } = await preparedPlanted(page)
        expect(prep.plan.side.find((item) => item.action.id === 'side.iris')?.action).toMatchObject({ kind: 'clear', status: 'newer', v: 2 })
        expect(prep.plan.notice.unknownOptionalRows).toEqual(expect.arrayContaining([{ id: 'side.iris', v: 2 }, { id: 'x-test.unknown', v: 1 }]))
        expect(prep.plan.notice.omittedUnits).toEqual([plant.presetTail])
        const writes = page.k.counted.writes.length
        const end = await install(prep, setup)
        if (end.kind !== 'landed') {
            throw new Error(`the install ended ${end.kind}`)
        }
        expect(setup.store.files.get(`assets/${HASH}`)).toEqual(ASSET_BYTES)
        expect(end.facts.assetsWritten).toBe(1)
        expect(page.k.counted.writes.slice(writes).filter((record) => record.key.includes('x/'))).toEqual([])
        expect(setup.store.log.filter((line) => line.includes('x/'))).toEqual([])
        expect(setup.sideLog).toEqual([`clear:${PLUGIN_PERMISSIONS_STORE.name}`])

        const installed = await installedManifest(page)
        let found: { tail: string } | null = null
        for (const shardRef of installed.shards) {
            const key = keyOfTail(shardRef[0])
            const bytes = (await page.k.counted.backend.readUnits([key])).get(key) ?? null
            const parsed = bytes === null ? null : readUnit(bytes, UNIT_TYPE.shard)
            if (parsed === null || (parsed.status !== 'ok' && parsed.status !== 'stale')) {
                continue
            }
            for (const entry of (parsed.value.body as Shard).entries) {
                if (entry.al[3] === 2) {
                    found = { tail: entry.al[0] }
                }
            }
        }
        if (found === null) {
            throw new Error('the installed shards name no list at v 2')
        }
        const listKey = keyOfTail(found.tail)
        expect(found.tail).not.toBe(plant.listTail)
        expect((await page.k.counted.backend.readUnits([listKey])).get(listKey)).toEqual(plant.listFrame)
        expect(installed.fixed.taskPresets).toHaveLength(plant.presetCount - 1)
    })

    test('NO-PAGE-KEEP read-back: the installed manifest holds the file\'s task presets (one left out), not the page\'s two, and the base\'s legacy keep (guard; MU15 fails it)', async () => {
        const page = await openPage({ taskPresets: true })
        const before = await installedManifest(page)
        expect(before.fixed.taskPresets).toHaveLength(2)
        const { prep } = await preparedPlanted(page)
        const end = await install(prep, setupOf())
        expect(end.kind).toBe('landed')
        const installed = await installedManifest(page)
        expect(installed.fixed.taskPresets).toHaveLength(1)
        expect(installed.fixed.legacyKeep).toEqual(before.fixed.legacyKeep)
    })

    test('an omitted entry that names a unit the file holds is refused by the preparation, so nothing reaches the install (guard; M-z49 fails it)', async () => {
        const page = await openPage({ taskPresets: true })
        const world = await worldOfPage(page)
        const { presetTail } = plantOf(world)
        const bytes = (await writeRtbFile({ world, omitted: [{ kind: 'unit', name: presetTail, reason: 'damaged' }] })).bytes
        const busy = page.busy.beginBusy('backupLoad')
        busyHandles.push(busy)
        const end = await page.plan.prepareRtbRestore(
            { name: 'a.rtb', size: bytes.length, lastModified: 1, source: importSourceOfBytes('a.rtb', bytes) },
            busy,
            { saveBoundMs: 100, deps: { assetDeps: assetDeps(), confirmScale: async () => true } },
        )
        expect(end).toMatchObject({ kind: 'ended', outcome: 'nothing-replaced', cause: 'damaged' })
        expect(await writeLockIsFree(page)).toBe(true)
    })
})