/**
 * The `.bin` import of a store2 page decodes the database once to confirm what the file leaves out, and then keeps
 * working for as long as the asset copy and the commit take. The decoded tree of that first decode must not stay
 * reachable from the restore function across that work: only the salvage map it yielded is kept.
 *
 * Runs `LoadLocalBackup()` over the real store2 loop in a world of its own (the harness of `storeImport.svelte.test.ts`),
 * against an in-memory backend. The tree of the first decode is observed through a weak reference while the restore
 * function is running and, after a forced collection, asked whether it was collected. This does not reproduce the
 * memory growth measured on a device, and a mocked world proves nothing about native storage.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import v8 from 'node:v8'
import vm from 'node:vm'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Database } from 'src/ts/storage/database.svelte'
import type { BootImportTarget } from 'src/ts/storage/store2/legacy/bootImport'
import { breakDataChecksum } from 'src/ts/storage/tests/risuSaveBlockFile'

vi.setConfig({ testTimeout: 60_000 })

v8.setFlagsFromString('--expose-gc')
const gc = vm.runInNewContext('gc') as () => void

const platformBox = vi.hoisted(() => ({ isNodeServer: false }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    get isNodeServer() { return platformBox.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/nodeBodyLimit'), () => ({
    NODE_BODY_LIMIT_BYTES: 1024 * 1024,
}) as unknown as typeof import('src/ts/storage/nodeBodyLimit'))

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
    platformBox.isNodeServer = false
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
    // These tests are about the whole commit's decode: the streamed prepare is held off (a file below the threshold of
    // units, as every small library is), so the commit decodes the entry once and the question is what stays reachable
    // across it. The entry is still read in pieces before the copy (P1a), which the tests below pin.
    vi.doMock('src/ts/storage/store2/legacy/importStream', async () => {
        const actual = await vi.importActual<typeof import('src/ts/storage/store2/legacy/importStream')>('src/ts/storage/store2/legacy/importStream')
        return {
            ...actual,
            prepareImportStream: (request: Parameters<typeof actual.prepareImportStream>[0], hooks: Parameters<typeof actual.prepareImportStream>[1]) => actual.prepareImportStream({
                ...request,
                stream: { ...request.stream, minUnits: Number.POSITIVE_INFINITY },
            }, hooks),
        }
    })
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(async () => {
    worlds.parkAll()
    vi.doMock('src/ts/platform', () => ({ isTauri: false, get isNodeServer() { return platformBox.isNodeServer }, isIOS: () => false }))
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
    const page: Page = { w, k, db: h.db, alert: await import('src/ts/alert') }
    bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer: k.committer } as unknown as Store2Session)
    w.pageMode.setPageStorageMode({ kind: 'store2' })
    vi.mocked(page.alert.alertConfirm).mockImplementation(async () => true)
    vi.spyOn(page.alert.alertStore, 'set').mockImplementation(() => { })
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => { })
    w.start()
    await sleepReal(150)
    await settled(w)
    return page
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

function binOf(...entries: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(entries.reduce((total, entry) => total + entry.length, 0))
    let offset = 0
    for (const entry of entries) {
        out.set(entry, offset)
        offset += entry.length
    }
    return out
}

const GOLDEN_DIR = path.resolve(process.env.BIN_GOLDENS_DIR ?? path.join(process.cwd(), 'src/ts/drive/tests/binGoldens'))

function golden(name: string): Uint8Array {
    return new Uint8Array(fs.readFileSync(path.join(GOLDEN_DIR, name)))
}

/** A block-format backup whose last block is damaged: its decode yields a salvage map and the person is asked. */
async function damagedBackup(page: Page): Promise<Uint8Array> {
    const source = makeDb('backup', ['alpha', 'beta', 'gamma'])
    const encoder = new page.w.encoderFixture.RisuSaveEncoder()
    await encoder.init(source as unknown as Database, { compression: false })
    await encoder.set(source as unknown as Database, { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false })
    const damaged = breakDataChecksum(new Uint8Array(encoder.encode()!), 'alpha')
    return binOf(binEntry('golden-avatar.png', new Uint8Array([1, 2, 3, 4])), binEntry('database.risudat', damaged))
}

async function loadBin(bytes: Uint8Array): Promise<void> {
    const { LoadLocalBackup } = await import('src/ts/drive/backuplocal')
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
        LoadLocalBackup()
        const chosen = input as HTMLInputElement | null
        if (chosen === null) {
            throw new Error('LoadLocalBackup did not create a file input')
        }
        Object.defineProperty(chosen, 'files', { value: [new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')], configurable: true })
        await (chosen.onchange as unknown as (event: Event) => Promise<void>).call(chosen, new Event('change'))
    } finally {
        spy.mockRestore()
    }
}

/**
 * Wraps the world's decoders so the tree of the first decode is watched weakly, and answers, at each later
 * `alertWait` of the import, whether a forced collection has reclaimed it.
 */
function watchFirstTree(page: Page): { probes: () => { text: string, collected: boolean }[], watched: () => boolean, decodedAtLoading: () => number | null, probeNow: (text: string) => void } {
    // How many decode calls had begun when the import first showed its load phase.
    let decodedAtLoading: number | null = null
    let held: object | null = null
    let ref: WeakRef<object> | null = null
    const watch = (tree: unknown): void => {
        if (ref !== null || held !== null || typeof tree !== 'object' || tree === null) {
            return
        }
        held = tree
        // A weak reference created in a job stays alive until that job ends: it is created in a later one.
        setTimeout(() => {
            ref = new WeakRef(held as object)
            held = null
        }, 0)
    }
    const risuSave = page.w.risuSave
    const decodeOriginal = risuSave.decodeRisuSave
    const salvageOriginal = risuSave.salvageRisuSave
    const decodeSpy = vi.spyOn(risuSave, 'decodeRisuSave').mockImplementation(async (...args: Parameters<typeof decodeOriginal>) => {
        const tree = await decodeOriginal(...args)
        watch(tree)
        return tree
    })
    const salvageSpy = vi.spyOn(risuSave, 'salvageRisuSave').mockImplementation(async (...args: Parameters<typeof salvageOriginal>) => {
        const salvaged = await salvageOriginal(...args)
        watch(salvaged.db)
        return salvaged
    })
    const probes: { text: string, collected: boolean }[] = []
    const probeNow = (text: string): void => {
        if (ref !== null) {
            // A spy records every argument and result it saw: the decoders' results, and the tree the block
            // decoder logs. Those records would keep the tree alive.
            decodeSpy.mockClear()
            salvageSpy.mockClear()
            vi.mocked(console.log).mockClear()
            gc()
            gc()
            probes.push({ text, collected: ref.deref() === undefined })
        }
    }
    vi.mocked(page.alert.alertWait).mockImplementation((text: string) => {
        if (text === 'Loading backup...' && decodedAtLoading === null) {
            decodedAtLoading = decodeSpy.mock.calls.length + salvageSpy.mock.calls.length
        }
        probeNow(text)
        return { type: 'wait', msg: text }
    })
    return { probes: () => probes, watched: () => ref !== null, decodedAtLoading: () => decodedAtLoading, probeNow }
}

/** A page as a boot sees it: no page mode and no residency. */
async function openBoot(): Promise<Page> {
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
    return { w, k, db: h.db as Entry, alert }
}

async function pickAtBoot(target: BootImportTarget, bytes: Uint8Array) {
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
        Object.defineProperty(chosen, 'files', { value: [new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')], configurable: true })
        await (chosen.onchange as unknown as (event: Event) => Promise<void>).call(chosen, new Event('change'))
        return await ended
    } finally {
        spy.mockRestore()
    }
}

const yieldTask = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0))

interface BytesProbe {
    at: string
    /** The byte arguments of decode calls seen so far. */
    watched: number
    /** How many of them a forced collection did not reclaim. */
    alive: number
}

/**
 * Watches, weakly, the byte argument of EVERY `decodeRisuSave` and `salvageRisuSave` call of the import (the validity
 * probe's and the commit's). `probe` answers how many are still reachable after a forced collection; the spies' own
 * records are cleared first, because they would keep the arguments alive.
 */
function watchDatabaseBytes(page: Page): { probe: (at: string) => void, probes: BytesProbe[], decodedAtLoading: () => number | null } {
    const refs: WeakRef<object>[] = []
    // How many decode calls had begun when the import first showed its load phase, which follows the entry's first read (P1a) and the copy.
    let decodedAtLoading: number | null = null
    let pending: object[] = []
    const watch = (bytes: unknown): void => {
        if (!ArrayBuffer.isView(bytes)) {
            return
        }
        pending.push(bytes)
        // A weak reference created in a job keeps its target to the end of that job: it is created in a later one.
        setTimeout(() => {
            for (const held of pending) {
                refs.push(new WeakRef(held))
            }
            pending = []
        }, 0)
    }
    const risuSave = page.w.risuSave
    const decodeOriginal = risuSave.decodeRisuSave
    const salvageOriginal = risuSave.salvageRisuSave
    const decodeSpy = vi.spyOn(risuSave, 'decodeRisuSave').mockImplementation(async (...args: Parameters<typeof decodeOriginal>) => {
        watch(args[0])
        return decodeOriginal(...args)
    })
    const salvageSpy = vi.spyOn(risuSave, 'salvageRisuSave').mockImplementation(async (...args: Parameters<typeof salvageOriginal>) => {
        watch(args[0])
        return salvageOriginal(...args)
    })
    const probes: BytesProbe[] = []
    // `count` limits the probe to the first arrays seen: a probe made later than the moment it stands for must not count a decode that began since.
    const probe = (at: string, count: number = refs.length): void => {
        decodeSpy.mockClear()
        salvageSpy.mockClear()
        vi.mocked(console.log).mockClear()
        gc()
        gc()
        probes.push({ at, watched: count, alive: refs.slice(0, count).filter((ref) => ref.deref() !== undefined).length })
    }
    vi.mocked(page.alert.alertWait).mockImplementation((text: string) => {
        const seen = refs.length + pending.length
        if (text === 'Loading backup...' && decodedAtLoading === null) {
            decodedAtLoading = seen
        }
        if (pending.length === 0 && seen > 0) {
            probe(text)
        } else if (seen > 0) {
            // The references of a decode this job made are created by a timer already queued; this one runs after it.
            setTimeout(() => probe(text, seen), 0)
        }
        return { type: 'wait', msg: text }
    })
    return { probe, probes, decodedAtLoading: () => decodedAtLoading }
}

/** The sizes of the slices the import takes of the chosen file: the entry's first read is in pieces, none of them longer than this. */
const MAX_SLICE_BYTES = 4 * 1024 * 1024

function watchFileSlices(): number[] {
    const sizes: number[] = []
    const original = Blob.prototype.slice
    vi.spyOn(Blob.prototype, 'slice').mockImplementation(function (this: Blob, ...args: Parameters<typeof original>) {
        const piece = original.apply(this, args)
        sizes.push(piece.size)
        return piece
    })
    return sizes
}

describe('the database bytes of a .bin import are not held across the asset copy or the commit', () => {
    // Regression reproducer: red when the restore function keeps the entry's bytes from the validity probe to the end of the import.
    // Not a measure of device memory.
    interface Observed {
        probes: BytesProbe[]
        /** Decode calls begun when the load phase was first shown; null when it never was. */
        decodedAtLoading: number | null
        /** The sizes of the slices taken of the chosen file. */
        slices: number[]
    }

    // The entry's first read (P1a) takes it in pieces and decodes nothing whole, so before the copy there is nothing to hold.
    // The commit then decodes the entry once, and that decode's bytes must be unreachable while the commit works.
    function expectNotHeld(observed: Observed): void {
        expect(observed.decodedAtLoading, 'the import must have reached its load phase').not.toBeNull()
        expect(observed.decodedAtLoading, 'nothing is decoded whole before the copy').toBe(0)
        expect(observed.slices.length, 'the file must have been read in slices').toBeGreaterThan(0)
        expect(Math.max(...observed.slices), 'no slice of the file is longer than 4 MiB').toBeLessThanOrEqual(MAX_SLICE_BYTES)
        const commit = observed.probes.filter((entry) => entry.at.startsWith('commit window'))
        expect(commit.length, 'the commit window must have been probed').toBeGreaterThan(0)
        expect(commit.every((entry) => entry.watched >= 1), 'the commit decoded the entry').toBe(true)
        expect(observed.probes.filter((entry) => entry.alive > 0).map((entry) => `${entry.at} (${entry.alive} of ${entry.watched} alive)`)).toEqual([])
    }

    async function page(backup: (page: Page) => Promise<Uint8Array>): Promise<Observed> {
        const opened = await openPage()
        const bytes = await backup(opened)
        const slices = watchFileSlices()
        const watcher = watchDatabaseBytes(opened)
        const backend = opened.k.counted.backend
        const putUnit = backend.putUnit.bind(backend)
        backend.putUnit = async (...args: Parameters<typeof putUnit>) => {
            await yieldTask()
            watcher.probe('commit window: putUnit')
            return putUnit(...args)
        }
        const commitOrdinary = backend.commitOrdinary.bind(backend)
        backend.commitOrdinary = async (...args: Parameters<typeof commitOrdinary>) => {
            await yieldTask()
            watcher.probe('commit window: commitOrdinary')
            return commitOrdinary(...args)
        }
        const casCommit = backend.casCommit.bind(backend)
        backend.casCommit = async (...args: Parameters<typeof casCommit>) => {
            await yieldTask()
            watcher.probe('commit window: casCommit')
            return casCommit(...args)
        }

        await loadBin(bytes)

        return { probes: watcher.probes, decodedAtLoading: watcher.decodedAtLoading(), slices }
    }

    async function boot(backup: (page: Page) => Promise<Uint8Array>): Promise<Observed> {
        const opened = await openBoot()
        const bytes = await backup(opened)
        const slices = watchFileSlices()
        const watcher = watchDatabaseBytes(opened)
        const target: BootImportTarget = {
            readColdStorageItem: async () => ({ status: 'missing' }),
            async install(source) {
                // The library releases the tree once it is resolved; a tree of the raw format holds views of the bytes it came from.
                source.tree = null
                await yieldTask()
                await yieldTask()
                watcher.probe('commit window: install')
                return { status: 'blocked', reason: 'install-failed', detail: 'recorded' }
            },
        }

        await pickAtBoot(target, bytes)

        return { probes: watcher.probes, decodedAtLoading: watcher.decodedAtLoading(), slices }
    }

    test('regression: a legacy-format file on a page', async () => {
        expectNotHeld(await page(async () => golden('upstream-full.bin')))
    })

    test('regression: a block-format salvage on a page', async () => {
        expectNotHeld(await page(damagedBackup))
    })

    test('regression: a legacy-format file at boot', async () => {
        expectNotHeld(await boot(async () => golden('upstream-full.bin')))
    })

    test('regression: a block-format salvage at boot', async () => {
        expectNotHeld(await boot(damagedBackup))
    })
})

describe('the decodes of a store2 .bin import', () => {
    // Regression reproducer (red when the restore function awaits the decoded tree itself, or decodes the entry whole
    // before the copy). Not a measure of device memory.
    async function expectTreeCollected(backup: (page: Page) => Promise<Uint8Array>): Promise<void> {
        const page = await openPage()
        const bytes = await backup(page)
        const slices = watchFileSlices()
        const probe = watchFirstTree(page)
        const backend = page.k.counted.backend
        const putUnit = backend.putUnit.bind(backend)
        backend.putUnit = async (...args: Parameters<typeof putUnit>) => {
            await yieldTask()
            probe.probeNow('commit window: putUnit')
            return putUnit(...args)
        }
        const commitOrdinary = backend.commitOrdinary.bind(backend)
        backend.commitOrdinary = async (...args: Parameters<typeof commitOrdinary>) => {
            await yieldTask()
            probe.probeNow('commit window: commitOrdinary')
            return commitOrdinary(...args)
        }
        const casCommit = backend.casCommit.bind(backend)
        backend.casCommit = async (...args: Parameters<typeof casCommit>) => {
            await yieldTask()
            probe.probeNow('commit window: casCommit')
            return casCommit(...args)
        }

        await loadBin(bytes)

        expect(probe.decodedAtLoading(), 'the import must have reached its load phase').not.toBeNull()
        expect(probe.decodedAtLoading(), 'no tree of the entry exists before the copy: its first read decodes nothing whole').toBe(0)
        expect(slices.length, 'the file must have been read in slices').toBeGreaterThan(0)
        expect(Math.max(...slices), 'no slice of the file is longer than 4 MiB').toBeLessThanOrEqual(MAX_SLICE_BYTES)
        expect(probe.watched(), 'the commit must have decoded a tree to watch').toBe(true)
        const commit = probe.probes().filter((entry) => entry.text.startsWith('commit window'))
        expect(commit.length, 'the commit window must have been probed').toBeGreaterThan(0)
        expect(commit.every((entry) => entry.collected), 'the commit\'s decoded tree is unreachable while the commit works').toBe(true)
    }

    test('regression: a legacy-format file has no decoded tree before the copy, and the commit\'s tree is collected while the commit works', async () => {
        await expectTreeCollected(async () => golden('upstream-full.bin'))
    })

    test('regression: a block-format salvage has no decoded tree before the copy, and the commit\'s tree is collected while the commit works', async () => {
        await expectTreeCollected(damagedBackup)
    })

    // Compatibility guard: passes before and after; the left-out question and the import's outcome do not change.
    test('guard: a salvage asks the left-out question exactly once and the import completes', async () => {
        const page = await openPage()
        const bytes = await damagedBackup(page)
        const reload = vi.mocked(window.location.reload)

        await loadBin(bytes)

        expect(vi.mocked(page.alert.alertConfirm).mock.calls).toHaveLength(1)
        expect(reload).toHaveBeenCalledTimes(1)
    })
})
