// @vitest-environment node
/**
 * A `.rtb` restore on a Node page holds its own bulk marker from before the asset listing to its final write: the real
 * `server/node/server.cjs` (a child process) behind `createNodeHttpStore` and the real committer, the file written by the
 * product's `writeRtb` from a store2 tree the product's encoder made, and the real `prepareRtbRestore` and
 * `installRtbRestore`. The page, its locks and its dialogs are doubles (a hold whose `release` is a spy, recorded alerts, a
 * busy answer the test flips); the copy stage is replaced by an empty one, because the file carries no assets here. A pass
 * says nothing about a browser, the Web Locks of several origins or the Tauri store.
 *
 * The last block runs the real Node asset sweep (`runAssetSweep` over the same server) against a restore that holds its
 * marker: the asset X is stored under its hash name through the page's store, the file carries the same bytes under the
 * same name, so the asset plan skips it outright (a literal name would be copied under a CRC compare and hide the order).
 *
 * Labels: every test of the first blocks is a guard of the held-marker contract (no pre-fix base: the Node restore
 * opened no marker); each names the scratch mutant it turns red on. RR5 and RR5c are regression reproducers: on a copy
 * whose `commit.ts`, `rtbRestoreHold.ts`, `rtbRestorePlan.ts` and `rtbRestoreInstall.ts` are as before the held marker,
 * the sweep deletes X and the `has(X)` assertion fails.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.hoisted(() => {
    const memory = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => memory.get(key) ?? null,
            setItem: (key: string, value: string) => { memory.set(key, String(value)) },
            removeItem: (key: string) => { memory.delete(key) },
            clear: () => memory.clear(),
            key: (index: number) => Array.from(memory.keys())[index] ?? null,
            get length() { return memory.size },
        },
    })
})

const h = vi.hoisted(() => ({
    permissive: (): Record<string, unknown> => new Proxy({} as Record<string, unknown>, {
        get: (_target, key) => (key === 'then' ? undefined : vi.fn()),
        has: () => true,
    }),
}))

/** What the busy guard answers; the test flips it after the preparation. */
const busyBox = vi.hoisted(() => ({ refuse: false }))

vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }), keys: vi.fn(async () => []) }) } }))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: true, isIOS: () => false }) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
    selIdState: { selId: -1 },
    alertStore: writable({ type: 'none', msg: '' }),
    MobileGUI: writable(false),
    botMakerMode: writable(false),
    loadedStore: writable(false),
    LoadingStatusState: { text: '' },
    ReloadGUIPointer: writable(0),
    bodyIntercepterStore: writable(null),
    savingStoppedReason: writable(null),
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => h.permissive() as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/drive/backuplocal'), () => h.permissive() as unknown as typeof import('src/ts/drive/backuplocal'))
vi.mock(import('src/ts/drive/backupWorkGuard'), () => new Proxy(h.permissive(), {
    get: (target, key) => (key === 'refuseBackupLoadWhileBusy' ? () => busyBox.refuse : target[key as string]),
    has: () => true,
}) as unknown as typeof import('src/ts/drive/backupWorkGuard'))
vi.mock(import('src/ts/drive/storeImport'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        UnsavedGuard: class { async check() { return true } },
        checkStore2Import: vi.fn(),
        confirmImportScale: vi.fn(async () => true),
        // The Wait or Clear helper is the product's: the tests exercise its consent rule against the real server.
        askToClearForeignMarker: actual.askToClearForeignMarker,
    } as unknown as typeof import('src/ts/drive/storeImport')
})
vi.mock(import('src/ts/drive/storeRestore'), () => ({ saveFirst: vi.fn(async () => { }), SAVE_FIRST_BOUND_MS: 1000 }) as unknown as typeof import('src/ts/drive/storeRestore'))
vi.mock(import('src/ts/alert'), () => h.permissive() as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/model/modellist'), () => ({ getModelInfo: vi.fn() }) as unknown as typeof import('src/ts/model/modellist'))
vi.mock(import('src/ts/characters'), () => ({ updateLorebooks: vi.fn((v: unknown) => v) }) as unknown as typeof import('src/ts/characters'))
vi.mock('@tauri-apps/api/core', () => h.permissive())
vi.mock('@tauri-apps/plugin-os', () => h.permissive())
vi.mock('@tauri-apps/plugin-fs', () => h.permissive())
vi.mock('@tauri-apps/plugin-dialog', () => h.permissive())

import { createHash } from 'node:crypto'
import { language } from 'src/lang'
import { importSourceOfBytes } from 'src/ts/importSource'
import { holdAssetDeletion } from 'src/ts/storage/assetDeleteHold'
import { createMemoryBackend, createNodeBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { openDeleterGate } from 'src/ts/storage/store2/boot'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { createNodeHttpStore } from 'src/ts/storage/store/nodeHttpStore'
import { createCommitter, type Committer } from 'src/ts/storage/store2/commit'
import { encodeUnit, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { gcPass } from 'src/ts/storage/store2/gc/pass'
import { buildNodeGcAge } from 'src/ts/storage/store2/gc/unitAge'
import { createListDerivation } from 'src/ts/storage/store2/lists'
import { exportClosure } from 'src/ts/storage/store2/rtb/exportClosure'
import { freshOwnerId } from 'src/ts/storage/store2/owner'
import { SWEEP_MIN_AGE_MS, runAssetSweep, type AssetSweepEnv } from 'src/ts/storage/store2/sweep'
import { createBackendClosureReader } from 'src/ts/storage/store2/sweep/backendReader'
import { buildClosureAssetKeepSet } from 'src/ts/storage/store2/sweep/keepSet'
import type { Database } from 'src/ts/storage/database.svelte'
import type { Store2Session } from 'src/ts/storage/store2/session'
import { createClock, seedTree, testEnv } from 'src/ts/storage/tests/store2SaveKit'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { parsedCommit, treeRequest } from 'src/ts/storage/tests/store2/commitFixtures'
import { startNodeServer, type NodeServerFixture } from 'src/ts/storage/tests/nodeServerFixture'
import type { AssetPlanDeps, SizedListing } from 'src/ts/drive/rtb/rtbAssetPlan'
import type { RestoreHold } from 'src/ts/drive/rtbRestoreHold'
import type { RtbPrepareDeps, RtbPrepareEnd } from 'src/ts/drive/rtbRestorePlan'
import type { RtbInstallEnd } from 'src/ts/drive/rtbRestoreInstall'
import type { BusyHandle } from 'src/ts/process/memory/busyActions'
import { loggingSideBackends } from './rtb/rtbInstallFixtures'
import { writeRtbFile } from './rtb/rtbRestoreFixtures'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 })

interface NodeWorld {
    fixture: NodeServerFixture
    /** The page's byte store over the server: the assets and the sweep's record. */
    store: ByteStore
    backend: Store2Backend
    /** The restoring page's committer. */
    page: Committer
    /** Another page's committer over the same server. */
    peer: Committer
    rtb: Uint8Array
}

let world: NodeWorld | null = null

beforeEach(async () => {
    busyBox.refuse = false
    vi.spyOn(console, 'error').mockImplementation(() => { })
    const fixture = await startNodeServer()
    const store = createNodeHttpStore({ baseUrl: fixture.baseUrl, authHeader: () => fixture.authHeader() })
    const backend = createNodeBackend(store)
    const clock = createClock()
    await seedTree(backend, makeDb('base', ['alpha', 'beta']) as unknown as Database, testEnv(clock, 4242))
    const units = new Map<string, Uint8Array>()
    const closure = await exportClosure(backend, { onUnits: async (batch) => { for (const unit of batch) { units.set(unit.key, unit.bytes) } } })
    const file = await writeRtbFile({ world: { store: units, manifestKey: closure.manifestKey, refsByRow: new Map(closure.refRows.map((row) => [row, []])) } })
    world = {
        fixture,
        store,
        backend,
        page: createCommitter(backend, { owner: freshOwnerId(testEnv(clock, 1)), env: testEnv(clock, 777) }),
        peer: createCommitter(backend, { owner: freshOwnerId(testEnv(clock, 2)), env: testEnv(clock, 888) }),
        rtb: file.bytes,
    }
})

afterEach(async () => {
    vi.restoreAllMocks()
    await world?.fixture.stop()
    world = null
})

function node(): NodeWorld {
    if (world === null) {
        throw new Error('The world is not open.')
    }
    return world
}

const stagingOf = async () => (await parsedCommit(node().backend)).staging
const currentOf = async () => (await parsedCommit(node().backend)).current?.key ?? null

/** The unsaved-edits guard of a page with nothing unsaved. */
class OpenGuard {
    async check(): Promise<boolean> {
        return true
    }
}

interface Page {
    hold: RestoreHold
    release: ReturnType<typeof vi.fn<(keep: boolean) => Promise<void>>>
    errors: string[]
}

function openPage(): Page {
    const release = vi.fn(async (_keep: boolean) => { })
    const busy: BusyHandle = { kind: 'backupLoad', end: () => { } }
    return { hold: { busy, guard: new OpenGuard() as RestoreHold['guard'], lock: 'write-lock', release }, release, errors: [] }
}

const assetDeps = (over: Partial<AssetPlanDeps> = {}): (() => AssetPlanDeps) => () => ({
    isNodeStore: () => false,
    probePieceStore: async () => { },
    assetLimit: () => Number.MAX_SAFE_INTEGER,
    inlayLimit: () => Number.MAX_SAFE_INTEGER,
    rule: async () => ({ kind: 'node', platform: 'posix' }),
    sizedListing: async () => null,
    ...over,
})

async function prepare(page: Page, deps: Partial<RtbPrepareDeps> = {}): Promise<RtbPrepareEnd> {
    const { prepareRtbRestore } = await import('src/ts/drive/rtbRestorePlan')
    const { backend, page: committer, rtb } = node()
    const busy: BusyHandle = { kind: 'backupLoad', end: () => { } }
    return await prepareRtbRestore(
        { name: 'a.rtb', size: rtb.length, lastModified: 1, source: importSourceOfBytes('a.rtb', rtb) },
        busy,
        {
            saveBoundMs: 100,
            deps: {
                refuseOnReadOnlyPage: async () => false,
                refuseWhileBusy: () => false,
                pageKind: () => 'store2',
                heldMarker: () => true,
                checkImport: async () => ({ kind: 'ready', target: { committer, backend } }),
                saveFirst: async () => { },
                acquireHold: async () => ({ kind: 'held', hold: page.hold }),
                assetDeps: assetDeps(),
                confirmScale: async () => true,
                confirm: async () => true,
                error: (text) => { page.errors.push(text) },
                wait: () => { },
                ...deps,
            },
        },
    )
}

function readyOf(end: RtbPrepareEnd) {
    if (end.kind !== 'ready') {
        throw new Error(`the preparation ended ${end.outcome} ${end.cause}`)
    }
    return end
}

async function install(ready: ReturnType<typeof readyOf>, page: Page): Promise<RtbInstallEnd> {
    const { installRtbRestore } = await import('src/ts/drive/rtbRestoreInstall')
    return await installRtbRestore(ready.plan, page.hold, {
        copy: async () => ({ kind: 'copied', facts: { assetsWritten: 0, assetsPresent: 0, skippedAssets: [], inlays: { written: 0, skipped: [], changed: false } } }),
        sideBackends: loggingSideBackends([]),
        error: (text) => { page.errors.push(text) },
        wait: () => { },
    })
}

/** Origin 2's import check, which puts a foreign marker to the person and clears it on Clear. */
async function originTwoClears(): Promise<void> {
    const { peer, backend } = node()
    const { checkStore2Import } = await vi.importActual<typeof import('src/ts/drive/storeImport')>('src/ts/drive/storeImport')
    const { setStore2BootSession } = await import('src/ts/storage/store2/bootActive')
    setStore2BootSession({ kind: 'node', committer: peer, backend } as unknown as Store2Session)
    try {
        const asked: Array<string | undefined> = []
        const check = await checkStore2Import({ ask: async (marker) => { asked.push(marker.label); return 'clear' } })
        expect(check.kind).toBe('ready')
        expect(asked).toEqual(['restore'])
    } finally {
        setStore2BootSession(null)
    }
}

describe('the marker stands through the preparation and never outlives a restore that did not land', () => {
    test('T-R1: the restore marker is on the commit key while the asset listing and the scale question run, and a decline or a throw after it leaves none and releases the hold (guard; MR2 fails it)', async () => {
        const seen: { listing: string | null, scale: string | null } = { listing: null, scale: null }
        const declined = openPage()
        const first = await prepare(declined, {
            assetDeps: assetDeps({ sizedListing: async () => { seen.listing = (await stagingOf())?.label ?? null; return null } }),
            confirmScale: async () => { seen.scale = (await stagingOf())?.label ?? null; return false },
        })
        expect(first).toEqual({ kind: 'ended', outcome: 'canceled', cause: 'declined' })
        expect(seen).toEqual({ listing: 'restore', scale: 'restore' })
        expect(await stagingOf()).toBeNull()
        expect(declined.release).toHaveBeenCalledWith(false)

        const thrown = openPage()
        const second = await prepare(thrown, {
            confirmScale: async () => {
                expect((await stagingOf())?.label).toBe('restore')
                throw new Error('the scale question failed')
            },
        })
        expect(second).toEqual({ kind: 'ended', outcome: 'failed', cause: 'unexpected' })
        expect(await stagingOf()).toBeNull()
        expect(thrown.release).toHaveBeenCalledWith(false)
    })

    test('T-R2: a second committer commits under the marker; the install stops base-moved, clears its own marker, keeps the peer\'s manifest and replaces nothing (guard; MR2 fails it)', async () => {
        const page = openPage()
        const ready = readyOf(await prepare(page))
        const marked = await stagingOf()
        expect(marked?.label).toBe('restore')
        const { peer } = node()
        const landed = await peer.commit(await peer.readCommit(), treeRequest(0))
        expect(landed.status).toBe('committed')
        const peerCurrent = await currentOf()
        const end = await install(ready, page)
        expect(end).toMatchObject({ kind: 'stopped', outcome: 'nothing-replaced', cause: 'base-moved' })
        expect(await stagingOf()).toBeNull()
        expect(await currentOf()).toBe(peerCurrent)
        expect(page.release).toHaveBeenCalledWith(false)
        expect(page.errors.at(-1)).toContain(language.restoreNotHappenedNotice)
    })

    test('T-R3: the held restore lands: the final write installs the file\'s manifest and clears the marker in one step, over the marker\'s read-back as the base (guard; MR3 and MR6 fail it)', async () => {
        const page = openPage()
        const before = await currentOf()
        const ready = readyOf(await prepare(page))
        expect(ready.plan.held).not.toBeNull()
        const marker = await parsedCommit(node().backend)
        expect(ready.plan.base.seq).toBe(marker.seq)
        const end = await install(ready, page)
        expect(end.kind).toBe('landed')
        const after = await parsedCommit(node().backend)
        expect(after.staging).toBeNull()
        expect(after.current?.key).not.toBe(before)
        expect(after.retained.map((entry) => entry.key)).toContain(before)
        expect(page.release).not.toHaveBeenCalled()
    })

    test('T-R8: the busy check fires in the held commit\'s build: the own marker is cleared, the end is busy and the current manifest is untouched (guard; MR4 fails it)', async () => {
        const page = openPage()
        const before = await currentOf()
        const ready = readyOf(await prepare(page))
        busyBox.refuse = true
        const end = await install(ready, page)
        expect(end).toMatchObject({ kind: 'stopped', outcome: 'nothing-replaced', cause: 'busy' })
        expect(await stagingOf()).toBeNull()
        expect(await currentOf()).toBe(before)
        expect(page.release).toHaveBeenCalledWith(false)
    })
})

describe('a marker this page load left behind (E6)', () => {
    /** An earlier bulk of this page's committer that opened its marker and never cleared it. */
    async function leaveOwnMarker(): Promise<void> {
        const { page } = node()
        const opened = await page.openHeldBulk?.(await page.readCommit(), { label: 'bulk' })
        expect(opened?.status).toBe('opened')
        expect((await stagingOf())?.label).toBe('bulk')
    }

    test('T-R9: another committer\'s commit lands before P.1b: the own marker is cleared, the changed current ends base-moved and no marker stands (guard; MR10 fails it)', async () => {
        await leaveOwnMarker()
        const { peer } = node()
        const { verifyRtb } = await import('src/ts/drive/rtb/rtbVerify')
        const page = openPage()
        const end = await prepare(page, {
            verify: async (source, options) => {
                const verdict = await verifyRtb(source, options)
                expect((await peer.commit(await peer.readCommit(), treeRequest(0))).status).toBe('committed')
                return verdict
            },
        })
        expect(end).toEqual({ kind: 'ended', outcome: 'nothing-replaced', cause: 'base-moved' })
        expect(page.errors.at(-1)).toBe(language.restoreNotHappenedNotice)
        expect(await stagingOf()).toBeNull()
        expect(page.release).toHaveBeenCalledWith(false)
    })

    test('T-R9 without the peer commit: the retry opens over the cleared key and the restore lands (guard)', async () => {
        await leaveOwnMarker()
        const page = openPage()
        const ready = readyOf(await prepare(page))
        expect((await stagingOf())?.label).toBe('restore')
        expect((await install(ready, page)).kind).toBe('landed')
        expect(await stagingOf()).toBeNull()
    })
})

describe('another operation\'s marker met while the restore opens its own (Wait or Clear)', () => {
    /** Another origin's bulk that opened its marker before the restore's open and has not ended. */
    const peerMarkerBeforeOpen = async (): Promise<void> => {
        const { peer } = node()
        expect((await peer.openHeldBulk?.(await peer.readCommit(), { label: 'bulk' }))?.status).toBe('opened')
    }

    test('T-Q5: Clear clears exactly that marker, the retry opens over the re-checked base and the restore lands; Wait ends nothing-replaced foreign-marker with no error text and the marker stands (guard; MQ5 fails both)', async () => {
        const cleared = openPage()
        const asked: Array<string | undefined> = []
        const ready = readyOf(await prepare(cleared, {
            saveFirst: peerMarkerBeforeOpen,
            askForeignMarker: async (marker) => { asked.push(marker.label); return 'clear' },
        }))
        expect(asked).toEqual(['bulk'])
        expect((await stagingOf())?.owner).toBe(node().page.owner)
        expect((await install(ready, cleared)).kind).toBe('landed')
        expect(await stagingOf()).toBeNull()
        expect(cleared.errors).toEqual([])

        // The first run left the store as a restore does; a fresh bulk of the peer is the foreign marker for the Wait run.
        const waited = openPage()
        await peerMarkerBeforeOpen()
        const standing = await stagingOf()
        const end = await prepare(waited, { askForeignMarker: async () => 'wait' })
        expect(end).toEqual({ kind: 'ended', outcome: 'nothing-replaced', cause: 'foreign-marker' })
        expect(waited.errors).toEqual([])
        expect(await stagingOf()).toEqual(standing)
        expect(waited.release).toHaveBeenCalledWith(false)
    })

    test('T-Q6 (diagnostic): another origin\'s Clear of a running restore\'s marker stops that restore base-moved before its commit, and its stopped end writes nothing to the commit key', async () => {
        const page = openPage()
        const ready = readyOf(await prepare(page))
        expect((await stagingOf())?.label).toBe('restore')
        await originTwoClears()
        const afterClear = await parsedCommit(node().backend)
        expect(afterClear.staging).toBeNull()
        const end = await install(ready, page)
        expect(end).toMatchObject({ kind: 'stopped', outcome: 'nothing-replaced', cause: 'base-moved' })
        expect(await parsedCommit(node().backend)).toEqual(afterClear)
        expect(page.release).toHaveBeenCalledWith(false)
    })

    test('T-Q6 (diagnostic, during the copy): a Clear that lands while the copy runs also ends base-moved, because the install re-checks the base after the copy; nothing is replaced and the stopped end writes nothing to the commit key', async () => {
        const page = openPage()
        const ready = readyOf(await prepare(page))
        const { installRtbRestore } = await import('src/ts/drive/rtbRestoreInstall')
        let afterClear: Awaited<ReturnType<typeof parsedCommit>> | null = null
        const end = await installRtbRestore(ready.plan, page.hold, {
            copy: async () => {
                await originTwoClears()
                afterClear = await parsedCommit(node().backend)
                return { kind: 'copied', facts: { assetsWritten: 0, assetsPresent: 0, skippedAssets: [], inlays: { written: 0, skipped: [], changed: false } } }
            },
            sideBackends: loggingSideBackends([]),
            error: (text) => { page.errors.push(text) },
            wait: () => { },
        })
        expect(afterClear).not.toBeNull()
        expect(end).toMatchObject({ kind: 'stopped', outcome: 'nothing-replaced', cause: 'base-moved' })
        expect(await parsedCommit(node().backend)).toEqual(afterClear)
    })
})

describe('the Node asset sweep against a restore that holds its marker', () => {
    const HOUR = 60 * 60 * 1000
    /** An asset of a hash name: its content is its name, so the restore's asset plan skips it outright, never by CRC. */
    const X_BYTES = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2])
    const X = `${createHash('sha256').update(X_BYTES).digest('hex')}.png`

    const deferred = () => {
        let resolve!: () => void
        const promise = new Promise<void>((done) => { resolve = done })
        return { promise, resolve }
    }

    /** A file of the real writer whose tree names X in a character's additional assets and which carries X's bytes. */
    async function fileNamingX(): Promise<Uint8Array> {
        const memory = createMemoryBackend()
        const db = makeDb('restored', ['gamma'])
        const characters = db.characters as Record<string, unknown>[]
        characters[0].additionalAssets = [['x', `assets/${X}`]]
        await seedTree(memory, db as unknown as Database, testEnv(createClock(), 5151), createListDerivation())
        const units = new Map<string, Uint8Array>()
        const closure = await exportClosure(memory, { onUnits: async (batch) => { for (const unit of batch) { units.set(unit.key, unit.bytes) } } })
        const file = await writeRtbFile({
            world: { store: units, manifestKey: closure.manifestKey, refsByRow: new Map(closure.refRows.map((row) => [row, []])) },
            assets: { [X]: X_BYTES },
        })
        return file.bytes
    }

    /** X on the server, referred to by nothing, and a record that names it as seen before at its revision, 25 hours old. */
    async function plantDeletableOrphan(): Promise<void> {
        const { store } = node()
        await store.write(`assets/${X}`, X_BYTES, 'unconditional')
        const rev = (await store.listRevisions?.('assets/'))?.find((row) => row.key === `assets/${X}`)?.rev ?? null
        expect(rev).not.toBeNull()
        await store.write(
            'store2-sweep',
            encodeUnit(UNIT_TYPE.sweepRecord, { v: 1, at: Date.now() - SWEEP_MIN_AGE_MS - HOUR, items: [[X, rev, 1]] }),
            'unconditional',
        )
    }

    function sweepEnv(over: Partial<AssetSweepEnv> = {}): AssetSweepEnv {
        const { store, backend } = node()
        return {
            session: { kind: 'node', backend, idleReason: null, openGate: (deleter) => openDeleterGate(backend, deleter) },
            store,
            residentRefs: () => [],
            writtenCount: () => 0,
            writtenThisPage: () => [],
            peers: async () => 'alone',
            shouldStop: () => false,
            release: () => { },
            hold: (remove) => holdAssetDeletion(remove),
            sampleClock: buildNodeGcAge(store)?.sampleClock,
            ...over,
        }
    }

    /** The target's real sized listing, as the page's own asset plan reads it. */
    const realListing = async (): Promise<SizedListing | null> => ({ kind: 'node-sized', items: await node().store.listSized?.('assets/', 0) ?? [] })

    const hasX = (): Promise<boolean> => node().store.has(`assets/${X}`)

    /** Whether the manifests the commit key now names keep X. */
    async function treeKeepsX(): Promise<boolean> {
        const { backend } = node()
        const keep = await buildClosureAssetKeepSet({
            commitKey: await parsedCommit(backend), reader: createBackendClosureReader(backend), residentRefs: [], writtenThisPage: [],
        })
        return keep.status !== 'incomplete' && keep.keep.holds(X)
    }

    test('RR5: after the preparation a sweep pass refuses staging and the asset survives; the landed tree names it (reproducer: without the held marker the pass deletes it and the restore lands a tree naming a missing asset)', async () => {
        node().rtb = await fileNamingX()
        await plantDeletableOrphan()
        const page = openPage()
        const ready = readyOf(await prepare(page, { assetDeps: assetDeps({ sizedListing: realListing }) }))
        expect(ready.plan.assets.present, 'the asset plan skips X outright').toBe(1)

        const swept = await runAssetSweep(sweepEnv())
        const end = await install(ready, page)

        expect(end.kind).toBe('landed')
        expect(await hasX()).toBe(true)
        expect(await treeKeepsX()).toBe(true)
        expect(swept).toEqual({ status: 'refused', reason: 'staging' })
    })

    test('RR5c: a sweep round that has decided to delete X and waits at its delete when the asset listing of the restore returns X present: the marker, opened before that listing, conflicts the delete, the next round refuses staging and X survives the landed restore (reproducer; MR1 fails it)', async () => {
        node().rtb = await fileNamingX()
        await plantDeletableOrphan()
        const reached = deferred()
        const latch = deferred()
        const sweeping = runAssetSweep(sweepEnv({
            hold: async (remove) => {
                reached.resolve()
                await latch.promise
                await holdAssetDeletion(remove)
            },
        }))
        await reached.promise
        const page = openPage()
        const ready = readyOf(await prepare(page, {
            assetDeps: assetDeps({
                sizedListing: async () => {
                    const listing = await realListing()
                    // The listing has answered X present; only now may the sweep's delete go out.
                    latch.resolve()
                    await sweeping
                    return listing
                },
            }),
        }))
        expect(ready.plan.assets.present).toBe(1)
        const end = await install(ready, page)

        expect(end.kind).toBe('landed')
        expect(await hasX()).toBe(true)
        expect(await treeKeepsX()).toBe(true)
        expect(await sweeping).toEqual({ status: 'refused', reason: 'staging' })
    })

    test('RR5b: a sweep round whose gate was read before the marker: the marker conflicts its delete when it goes out right after the restore opened the marker, the rebuild refuses staging and X is present (guard; MR1 fails it)', async () => {
        node().rtb = await fileNamingX()
        await plantDeletableOrphan()
        const reached = deferred()
        const latch = deferred()
        const sweeping = runAssetSweep(sweepEnv({
            hold: async (remove) => {
                reached.resolve()
                await latch.promise
                await holdAssetDeletion(remove)
            },
        }))
        await reached.promise
        const page = openPage()
        const ready = readyOf(await prepare(page, {
            assetDeps: assetDeps({
                sizedListing: async () => {
                    // The first call of P.2: the marker already stands, and the delete goes out before the listing is read.
                    expect((await stagingOf())?.label).toBe('restore')
                    latch.resolve()
                    const swept = await sweeping
                    expect(swept).toEqual({ status: 'refused', reason: 'staging' })
                    return await realListing()
                },
            }),
        }))
        expect(ready.plan.assets.present).toBe(1)

        expect((await install(ready, page)).kind).toBe('landed')
        expect(await hasX()).toBe(true)
    })

    test('T-R5 (diagnostic): a restore abandoned after its marker without a clear leaves a restore marker that a fresh owner sees; the Node sweep and the unit pass both refuse staging, and Clear at a Node import removes it', async () => {
        node().rtb = await fileNamingX()
        const page = openPage()
        readyOf(await prepare(page))
        // The page goes away here: nothing installs and nothing clears.
        const standing = await stagingOf()
        expect(standing?.label).toBe('restore')
        expect(standing?.owner).not.toBe(node().peer.owner)

        expect(await runAssetSweep(sweepEnv())).toEqual({ status: 'refused', reason: 'staging' })
        const { store, backend } = node()
        const age = buildNodeGcAge(store)
        expect(age).not.toBeNull()
        const unitPass = await gcPass({
            backend, kind: 'node', idleReason: () => null, probe: () => (store.guarded as NonNullable<ByteStore['guarded']>).probe(), age: age ?? undefined,
        })
        expect(unitPass).toMatchObject({ status: 'refused', reason: 'staging' })
        expect(await stagingOf()).toEqual(standing)

        await originTwoClears()
        expect(await stagingOf()).toBeNull()
    })
})
