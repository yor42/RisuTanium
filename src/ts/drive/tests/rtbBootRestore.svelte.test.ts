/**
 * The start-up `.rtb` restore end to end (CHORE-128 S14b): a `.rtb` written by the product's `writeRtb` from a real store2
 * page is picked through the real `loadBackupAtBoot`, routed by content, restored by the real shell (real hold, verification,
 * copy, planner and grant clear) and installed by the real boot target over a memory backend that also holds the old
 * upstream files. The world is the page of `storeImportBoot.svelte.test.ts` (fake Web Locks, in-memory byte store); a
 * spied `location.reload` stands for the reload. A fake store's success says nothing about a native store, and a spied
 * reload says nothing about a real navigation.
 *
 * Labels: INT1 and INT2 are regression reproducers (DESIGNED; on the base a `.rtb` goes into the `.bin` walk and is
 * refused, so the end is `cancelled`, the reload spy is never called and the commit key stays absent).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, sleepReal, settled, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import { hooked, parsedCommit } from 'src/ts/storage/tests/store2/commitFixtures'
import { createMemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { exportClosure } from 'src/ts/storage/store2/rtb/exportClosure'
import { firstLifeGrant } from 'src/ts/storage/store2/firstLife'
import { createListDerivation } from 'src/ts/storage/store2/lists'
import { freshOwnerId } from 'src/ts/storage/store2/owner'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { createBootImportTarget, type BootImportEntry, type BootImportEnd, type BootImportTarget } from 'src/ts/storage/store2/legacy/bootImport'
import { createClock as storeClock, testEnv as storeEnv } from 'src/ts/storage/tests/store2SaveKit'
import { language } from 'src/lang'
import { withCopiedKept } from 'src/ts/drive/rtbRestoreCopy'
import type { Database } from 'src/ts/storage/database.svelte'
import { inlayFixture, writeRtbFile, type WorldLike } from './rtb/rtbRestoreFixtures'
import { FakeForage, MemoryByteStore } from './rtb/rtbInstallFixtures'
import { IRIS_STORE, PLUGIN_PERMISSIONS_STORE, RESTORED_KEYS_STORE, type ForageStoreConfig } from 'src/ts/drive/rtb/sideStoreConfig'
import type { BusyHandle } from 'src/ts/process/memory/busyActions'

vi.setConfig({ testTimeout: 60_000 })

// The commit fixtures reach a Node-server fixture this test never starts.
vi.mock('src/ts/storage/tests/nodeServerFixture', () => ({ startNodeServer: vi.fn() }))

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
const HASH = `${'a1'.repeat(32)}.png`
const ASSET_BYTES = new TextEncoder().encode('a synthetic asset body')
const INLAY_ID = '0123abcd-0123-4123-a123-0123456789ab'
const MOTION_KEY = 'risuChatShell.reducedMotion'
const MAIN = 'database/database.bin'
const backupKey = (time: number) => `database/dbbackup-${time}.bin`

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
    localStorage.clear()
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
    vi.doUnmock('src/ts/storage/store/appStore')
    vi.doUnmock('src/ts/drive/rtb/sideStores')
    vi.restoreAllMocks()
    if (originalLocks) {
        Object.defineProperty(window.navigator, 'locks', originalLocks)
    } else {
        Object.defineProperty(window.navigator, 'locks', { value: undefined, configurable: true })
    }
})

interface Boot {
    w: World
    k: Store2Kit
    alert: typeof import('src/ts/alert')
    /** The page's byte store as the copy writes it: the world's own store has no piece writer. */
    bytes: MemoryByteStore
}

/** A forage store that records which store was cleared and how many backend calls had been made at that moment. */
class LoggedForage extends FakeForage {
    constructor(private readonly store: string) {
        super()
    }

    override async clear(): Promise<void> {
        forageClears.push({ store: this.store, writesBefore: observedWrites.length })
        await super.clear()
    }
}

/** The connection-key staging store of the current boot: one instance, so its records survive between the calls that open it. */
class StagingLogged extends FakeForage {
    override async setItem(key: string, value: unknown): Promise<unknown> {
        stagingOps.push({ op: `set:${key}`, writesBefore: observedWrites.length })
        return await super.setItem(key, value)
    }

    override async clear(): Promise<void> {
        stagingOps.push({ op: 'clear', writesBefore: observedWrites.length })
        await super.clear()
    }
}

/** Every write to the staging store of the current boot, in order, with the backend call count at that moment. */
const stagingOps: { op: string, writesBefore: number }[] = []
let stagingStore = new StagingLogged()

/** Every forage-store clear of the current boot, in order. The side stores of this page are fakes; nothing reaches IndexedDB. */
const forageClears: { store: string, writesBefore: number }[] = []
/** The commit backend's call log of the current rig, reads included; its length is what `writesBefore` counts. */
let observedWrites: string[] = []

/** The forage clears of the plugin-permissions store, the grant clear. */
function grantClears(): { store: string, writesBefore: number }[] {
    return forageClears.filter((clear) => clear.store === PLUGIN_PERMISSIONS_STORE.name)
}

/** A page as a boot sees it: no page mode and no residency; its own store2 profile is what the `.rtb` is written from. */
async function openBoot(): Promise<Boot> {
    forageClears.length = 0
    observedWrites = []
    stagingOps.length = 0
    stagingStore = new StagingLogged()
    vi.doMock('src/ts/drive/rtb/sideStores', async (importOriginal) => ({
        ...await importOriginal<typeof import('src/ts/drive/rtb/sideStores')>(),
        defaultSideBackends: {
            forage: (config: ForageStoreConfig) => (config.name === RESTORED_KEYS_STORE.name ? stagingStore : new LoggedForage(config.name)) as unknown as LocalForage,
            local: () => localStorage,
        },
    }))
    const bytes = new MemoryByteStore()
    vi.doMock('src/ts/storage/store/appStore', async (importOriginal) => ({
        ...await importOriginal<typeof import('src/ts/storage/store/appStore')>(),
        getAppStore: async () => bytes,
    }))
    const locks = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(locks, 'this'), configurable: true })
    h.db = makeDb('base', ['alpha'])
    const k = await startStore2({ db: h.db as unknown as Database })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const alert = await import('src/ts/alert')
    vi.mocked(alert.alertConfirm).mockImplementation(async () => true)
    vi.spyOn(alert.alertStore, 'set').mockImplementation(() => { })
    w.pageMode.setPageStorageMode({ kind: 'unset' })
    ;(await import('src/ts/storage/store2/residencyActive')).resetResidencyForTest()
    w.start()
    await sleepReal(100)
    await settled(w)
    return { w, k, alert, bytes }
}

/** The units the page's current manifest reaches, handed over by the product's own export walk. */
async function worldOfKit(k: Store2Kit): Promise<WorldLike> {
    const store = new Map<string, Uint8Array>()
    const closure = await exportClosure(k.counted.memory, { onUnits: async (batch) => { for (const unit of batch) { store.set(unit.key, unit.bytes) } } })
    return { store, manifestKey: closure.manifestKey, refsByRow: new Map(closure.refRows.map((row) => [row, []])) }
}

async function* records(...pairs: [string, string][]): AsyncGenerator<{ key: string, value: unknown }> {
    for (const [key, value] of pairs) {
        yield { key, value }
    }
}

/** A producer `.rtb` with an asset, an inlay and two side sections, one of which differs from the device. */
async function producerFile(k: Store2Kit): Promise<File> {
    const built = await writeRtbFile({
        world: await worldOfKit(k),
        assets: { [HASH]: ASSET_BYTES },
        inlays: [inlayFixture(INLAY_ID, 'a synthetic inlay body')],
        sides: { 'side.ui-prefs': { records: records([MOTION_KEY, 'true']) }, 'side.plugin-permissions': { records: records() } },
    })
    return new File([built.bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.rtb')
}

interface BootRig {
    memory: MemoryBackend
    store: ReturnType<typeof createMemoryByteStore>
    writes: string[]
    target: BootImportTarget
}

/** The boot's own installer over a memory backend that holds the old upstream files, as a first start or the recovery exit sees it. */
async function bootRig(entryKind: 'first-life' | 'exit'): Promise<BootRig> {
    const memory = createMemoryBackend()
    const store = createMemoryByteStore()
    store.files.set(MAIN, new Uint8Array([1, 2, 3]))
    store.files.set(backupKey(100), new Uint8Array([4]))
    store.files.set(backupKey(200), new Uint8Array([5]))
    const recorded = hooked(memory)
    const commitRead = await memory.readCommit()
    let entry: BootImportEntry
    if (entryKind === 'exit') {
        entry = { kind: 'exit', commitRead }
    } else {
        const granted = firstLifeGrant({ decision: { row: 1, mode: 'first-life', action: 'seed' }, commitRead, startupClear: null }, { label: 'import' })
        if (granted.status !== 'granted') {
            throw new Error('No first-life grant.')
        }
        entry = { kind: 'first-life', grant: granted.grant }
    }
    const target = createBootImportTarget({
        backend: recorded.backend,
        entry,
        owner: freshOwnerId(storeEnv(storeClock(), 1)),
        lists: createListDerivation(),
        env: storeEnv(storeClock(), 4242),
        oldData: {
            store,
            listBackupTimes: async () => [...store.files.keys()]
                .map((key) => /^database\/dbbackup-(\d+)\.bin$/.exec(key))
                .filter((match): match is RegExpExecArray => match !== null)
                .map((match) => Number(match[1]))
                .sort((a, b) => b - a),
        },
        upstreamMainFile: async () => store.files.has(MAIN),
    }, async () => ({ status: 'missing' }))
    observedWrites = recorded.log
    return { memory, store, writes: recorded.log, target }
}

/** Opens the real picker over `target`, chooses `file` and starts the route without awaiting it. */
async function pick(target: BootImportTarget, file: File): Promise<{ ended: Promise<BootImportEnd> }> {
    const { loadBackupAtBoot } = await import('src/ts/drive/backuplocal')
    const realCreateElement = document.createElement.bind(document)
    let input: HTMLInputElement | null = null
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const element = realCreateElement(tag)
        if (tag === 'input') {
            input = element as HTMLInputElement
        }
        return element
    })
    try {
        const ended = loadBackupAtBoot(target)
        const chosen = input as HTMLInputElement | null
        if (chosen === null) {
            throw new Error('loadBackupAtBoot did not create a file input')
        }
        Object.defineProperty(chosen, 'files', { value: [file], configurable: true })
        void (chosen.onchange as unknown as () => Promise<void>)()
        return { ended }
    } finally {
        spy.mockRestore()
    }
}

async function lockIsClosed(): Promise<boolean> {
    const { dbWriteLock } = await import('src/ts/globalApi.svelte')
    const taken = dbWriteLock.acquire().then((release) => { release(); return false })
    return await Promise.race([taken, sleepReal(50).then(() => true)])
}

async function currentManifest(memory: MemoryBackend) {
    const key = (await parsedCommit(memory)).current
    if (key === null) {
        throw new Error('No manifest is current.')
    }
    const read = await readTreeBytes(memory, key.key)
    if (read.status !== 'ok') {
        throw new Error(`The stored tree reads ${read.status}.`)
    }
    return read.tree.manifest
}

describe('the first-life restore of a .rtb (INT1)', () => {
    test('regression reproducer: the .rtb is installed over the old files, the side data is restored, the page reloads once with the write lock kept closed and the end never settles (M2, M8, M9, M12, M14, M22, M29, M32)', async () => {
        const boot = await openBoot()
        const file = await producerFile(boot.k)
        localStorage.setItem(MOTION_KEY, 'false')
        const rig = await bootRig('first-life')
        const oldBytes = new Map(rig.store.files)
        const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => { })
        const { isAppInitiatedReload } = await import('src/ts/reloadGuard')
        const { isBusy } = await import('src/ts/process/memory/busyActions')
        let markedAtReload: boolean | null = null
        reload.mockImplementation(() => { markedAtReload = isAppInitiatedReload() })

        const { ended } = await pick(rig.target, file)
        let settledEnd = false
        void ended.then(() => { settledEnd = true })
        await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1), { timeout: 20_000 })
        await sleepReal(100)

        expect(markedAtReload).toBe(true)
        expect(settledEnd).toBe(false)
        const key = await parsedCommit(rig.memory)
        expect(key.current).not.toBeNull()
        expect(key.convertedFrom).toBe('import')
        expect(Object.hasOwn(key, 'staging') ? (key as { staging: unknown }).staging : null).toBeNull()
        const manifest = await currentManifest(rig.memory)
        expect(Object.fromEntries((manifest.fixed.legacyKeep?.files ?? []).map((item) => [item.key, item.status]))).toEqual({
            [MAIN]: 'unreadable', [backupKey(100)]: 'unreadable', [backupKey(200)]: 'unreadable',
        })
        expect(rig.store.files).toEqual(oldBytes)
        expect(boot.bytes.files.get(`assets/${HASH}`)).toEqual(ASSET_BYTES)
        expect([...boot.bytes.files.keys()].some((name) => name.includes(INLAY_ID))).toBe(true)
        expect(localStorage.getItem(MOTION_KEY)).toBe('true')
        expect(await lockIsClosed()).toBe(true)
        expect(isBusy()).toBe(true)
        // The grant clear is the gate's: the side restore clears the same store again after the commit, so only a clear that
        // came before the first commit write is the gate's.
        expect(rig.writes.indexOf('casCommit')).toBeGreaterThanOrEqual(0)
        expect(grantClears().length).toBeGreaterThanOrEqual(1)
        expect(grantClears()[0].writesBefore).toBeLessThanOrEqual(rig.writes.indexOf('casCommit'))
        const shown = [
            ...vi.mocked(boot.alert.alertWait).mock.calls.map((call) => call[0]),
            ...vi.mocked(boot.alert.alertConfirm).mock.calls.map((call) => call[0]),
            ...vi.mocked(boot.alert.alertNormalWait).mock.calls.map((call) => call[0]),
        ]
        expect(shown).toContain(language.store2Boot.recoveryInstalledBody)
        expect(shown).not.toContain(language.store2ImportDone)
        expect(shown).not.toContain(language.store2ImportNotFlushed)
        expect(shown.some((text) => typeof text === 'string' && text.includes('Test device'))).toBe(false)
    })
})

describe('the recovery-exit restore of a .rtb (INT2)', () => {
    test('regression reproducer: the fence is written before the marker, the profile is installed, the side data is restored, the shell does not reload and releases the lock (M2, M10, M12b, M14)', async () => {
        const boot = await openBoot()
        const file = await producerFile(boot.k)
        localStorage.setItem(MOTION_KEY, 'false')
        const rig = await bootRig('exit')
        const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => { })
        const { isBusy } = await import('src/ts/process/memory/busyActions')

        const end = await (await pick(rig.target, file)).ended

        expect(vi.mocked(boot.alert.alertError).mock.calls.map((call) => call[0])).toEqual([])
        expect(end.kind).toBe('finished')
        expect(end.kind === 'finished' && end.result.status).toBe('installed')
        expect(rig.writes.indexOf('casFence')).toBeGreaterThanOrEqual(0)
        expect(rig.writes.indexOf('casFence')).toBeLessThan(rig.writes.indexOf('casCommit'))
        // The gate's grant clear comes before the fence, the first write of the exit entry.
        expect(grantClears().length).toBeGreaterThanOrEqual(1)
        expect(grantClears()[0].writesBefore).toBeLessThanOrEqual(rig.writes.indexOf('casFence'))
        expect((await parsedCommit(rig.memory)).current).not.toBeNull()
        expect(boot.bytes.files.get(`assets/${HASH}`)).toEqual(ASSET_BYTES)
        expect(localStorage.getItem(MOTION_KEY)).toBe('true')
        expect(reload).not.toHaveBeenCalled()
        expect(await lockIsClosed()).toBe(false)
        expect(isBusy()).toBe(false)
    })
})

describe('the connection-key staging of the start-up restore (R2, R2b)', () => {
    const KEY_ENVELOPES = ['SYNTH-ENV-1', 'SYNTH-ENV-2', 'SYNTH-ENV-3']

    /** The producer file with the connection-keys section the real producer lists for three connections (`rtbKeyRecords`). */
    async function keyFile(k: Store2Kit, withIris = false): Promise<File> {
        const { rtbKeyRecords } = await import('src/ts/drive/exportKeys')
        const connections = KEY_ENVELOPES.map((envelope, at) => ({ id: `conn-${at + 1}`, name: `c${at + 1}`, provider: 'openai' as const, key: '', keyWrapped: envelope }))
        const snapshot = {
            values: new Map(KEY_ENVELOPES.map((envelope, at) => [envelope, `SYNTH-PLAIN-${at + 1}`] as const)),
            unreadable: new Set<string>(),
            unavailableNow: new Set<string>(),
            unreadableNames: [],
            unavailableNames: [],
        }
        const lines = rtbKeyRecords(connections, snapshot).records
        const built = await writeRtbFile({
            world: await worldOfKit(k),
            sides: {
                'side.connection-keys': { records: (async function* () { yield* lines })() },
                ...(withIris ? { 'side.iris': { records: (async function* () { yield { key: 'k1', value: { a: 1 } } })() } } : {}),
            },
        })
        return new File([built.bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.rtb')
    }

    async function restoreOnExit(withIris = false): Promise<{ rig: BootRig, notices: unknown[] }> {
        const boot = await openBoot()
        const file = await keyFile(boot.k, withIris)
        const rig = await bootRig('exit')
        vi.spyOn(window.location, 'reload').mockImplementation(() => { })
        const end = await (await pick(rig.target, file)).ended
        expect(end.kind === 'finished' && end.result.status).toBe('installed')
        return { rig, notices: vi.mocked(boot.alert.alertNormalWait).mock.calls.map((call) => call[0]) }
    }

    test('R2 regression reproducer: every staging record is written before the commit key is written', async () => {
        const { rig } = await restoreOnExit()
        const commitAt = rig.writes.indexOf('casCommit')

        expect(commitAt).toBeGreaterThanOrEqual(0)
        const before = stagingOps.filter((entry) => entry.op.startsWith('set:') && entry.writesBefore <= commitAt).map((entry) => entry.op).sort()
        expect(before).toEqual(KEY_ENVELOPES.map((envelope) => `set:${envelope}`).sort())
    })

    test('R2b regression reproducer: no staging write follows the commit and no connection-keys line is named', async () => {
        const { rig, notices } = await restoreOnExit()
        const commitAt = rig.writes.indexOf('casCommit')

        expect(commitAt).toBeGreaterThanOrEqual(0)
        expect(stagingOps.filter((entry) => entry.writesBefore > commitAt)).toEqual([])
        expect([...stagingStore.data.keys()].sort()).toEqual([...KEY_ENVELOPES].sort())
        expect(notices.some((text) => typeof text === 'string' && text.includes(language.rtbRestoreSideNames.connectionKeys))).toBe(false)
    })

    test('G3b: every other side section is still restored after the commit (guard of a new rule)', async () => {
        const { rig } = await restoreOnExit(true)
        const commitAt = rig.writes.indexOf('casCommit')

        expect(commitAt).toBeGreaterThanOrEqual(0)
        const irisClears = forageClears.filter((entry) => entry.store === IRIS_STORE.name)
        expect(irisClears).toHaveLength(1)
        expect(irisClears[0].writesBefore).toBeGreaterThan(commitAt)
    })
})

describe('the real busy checks of the start-up restore (INT3)', () => {
    /** The end of the route, or `'pending'` when it never settles (a first-life install that went on to reload). */
    async function endOf(ended: Promise<BootImportEnd>): Promise<BootImportEnd | 'pending'> {
        return await Promise.race([ended, sleepReal(4000).then(() => 'pending' as const)])
    }

    test('guard of a new rule: other work already busy before the call is refused at the first check, before the hold, the copy and every write (kills a busy check that never refuses)', async () => {
        const boot = await openBoot()
        const file = await producerFile(boot.k)
        const rig = await bootRig('first-life')
        const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => { })
        const { beginBusy } = await import('src/ts/process/memory/busyActions')
        const rival: BusyHandle = beginBusy('import')
        try {
            // The router is called directly: the picker's own busy check would end the route before the shell is reached.
            const { routeBootPickedBackup } = await import('src/ts/drive/backupRouter')
            const end = await endOf(routeBootPickedBackup(file, rig.target))

            expect(end).toEqual({ kind: 'cancelled' })
            expect(vi.mocked(boot.alert.alertError).mock.calls.map((call) => call[0])).toEqual([language.backupLoadWorkInProgress])
            // The first check refuses before the verification shows any progress text.
            expect(vi.mocked(boot.alert.alertWait)).not.toHaveBeenCalled()
            expect(boot.bytes.files.has(`assets/${HASH}`)).toBe(false)
            expect(rig.writes).not.toContain('casCommit')
            expect(forageClears).toEqual([])
            expect(reload).not.toHaveBeenCalled()
        } finally {
            rival.end()
        }
    })

    test('guard of a new rule: work begun after the first check stops the install at the gate with the copied-kept message, no grant cleared and no commit key (kills a gate that never refuses)', async () => {
        const boot = await openBoot()
        const file = await producerFile(boot.k)
        const rig = await bootRig('first-life')
        const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => { })
        const { beginBusy } = await import('src/ts/process/memory/busyActions')
        let rival: BusyHandle | null = null
        // The installing text is the last alert before the installer call, so the rival begins after the first check and before the gate.
        vi.mocked(boot.alert.alertWait).mockImplementation((text: string) => {
            if (text === language.rtbRestoreInstalling) {
                rival ??= beginBusy('import')
            }
            return { type: 'none', msg: '' }
        })
        try {
            const end = await endOf((await pick(rig.target, file)).ended)

            expect(rival).not.toBeNull()
            expect(end).toEqual({ kind: 'cancelled' })
            expect(vi.mocked(boot.alert.alertError).mock.calls.map((call) => call[0])).toContain(withCopiedKept(language.backupLoadWorkInProgress))
            expect(rig.writes).not.toContain('casCommit')
            expect(rig.writes).not.toContain('casFence')
            expect(forageClears).toEqual([])
            expect(reload).not.toHaveBeenCalled()
        } finally {
            (rival as BusyHandle | null)?.end()
        }
    })
})
