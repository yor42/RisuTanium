/**
 * A `.bin` whose database entry decodes with more blocks left out at the commit than were confirmed at the probe is refused
 * as a changed file, and nothing is committed.
 *
 * The import decodes the database entry twice: once before the asset copy, where the blocks it leaves out are named to the
 * person and confirmed, and once more at the commit. A character stored as a remote pointer is read from the page's store at
 * each decode. When that read succeeded at the probe and fails (or finds the key gone) at the commit, the second decode
 * leaves out a block nobody was asked about; landing it would drop that character silently. The commit refuses it with the
 * file-changed text: on a page, nothing is committed and the page does not reload; at boot the installer is never called
 * and the flow ends cancelled. A commit decode that leaves out fewer blocks than were confirmed lands.
 *
 * Runs `LoadLocalBackup()` and `loadBackupAtBoot()` over the real store2 loop, with the harness of
 * `storeImportFileChanged.svelte.test.ts`. The file's database entry is the application encoder's block file with its remote
 * characters rewritten as pointers; their payloads live in the page's app store.
 *
 * Labels: regression (red on the base, which lands what the commit decode kept), guard (passes with or without the change).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import { withRemoteCharacters } from 'src/ts/storage/tests/remoteFileFixture'
import { language } from 'src/lang'
import { leftOutQuestion } from 'src/ts/drive/restoreReplace'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { BootImportTarget } from 'src/ts/storage/store2/legacy/bootImport'
import type { Database } from 'src/ts/storage/database.svelte'

vi.setConfig({ testTimeout: 60_000 })

const platformBox = vi.hoisted(() => ({ isNodeServer: false }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    get isNodeServer() { return platformBox.isNodeServer },
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
    const page: Page = { w, k, alert: await import('src/ts/alert') }
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
    return { w, k, alert }
}

// ---- the file ----

const REMOTE_ID = 'remote-a'
const DATABASE_NAME = 'database.risudat'

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

interface RemoteBin {
    file: File
    /** The remote payload as the page's app store must hold it, by key. */
    remotes: Map<string, Uint8Array>
    /** Puts the remote payloads in the page's app store. */
    plant(): void
}

/**
 * A `.bin` whose only entry is the database: the application encoder's uncompressed block file of one plain character and one
 * character stored as a remote pointer. The remote payload is not in the app store until `plant` runs.
 */
async function remoteBin(page: Page): Promise<RemoteBin> {
    const db = makeDb('imported', ['plain', REMOTE_ID])
    const encoder = new page.w.risuSave.RisuSaveEncoder()
    await encoder.init(db as unknown as Database, { compression: false })
    const block = new Uint8Array(encoder.encode()!)
    const remotes = new Map<string, Uint8Array>()
    const withPointer = await withRemoteCharacters(block, [REMOTE_ID], (key, bytes) => { remotes.set(key, bytes) })
    const bytes = binEntry(DATABASE_NAME, withPointer)
    return {
        file: new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin'),
        remotes,
        plant: () => {
            for (const [key, data] of remotes) {
                page.w.store.plant(key, data)
            }
        },
    }
}

async function loadFile(file: File): Promise<void> {
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
        Object.defineProperty(chosen, 'files', { value: [file], configurable: true })
        await (chosen.onchange as unknown as (event: Event) => Promise<void>).call(chosen, new Event('change'))
    } finally {
        spy.mockRestore()
    }
}

async function pickAtBoot(target: BootImportTarget, file: File) {
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
        await (chosen.onchange as unknown as (event: Event) => Promise<void>).call(chosen, new Event('change'))
        return await ended
    } finally {
        spy.mockRestore()
    }
}

// ---- what happens to the remote payload between the probe and the commit ----

/** read-fails: a read of a remote key fails. key-gone: the key is no longer in the store. */
type Drift = 'read-fails' | 'key-gone'

function driftAction(page: Page, bin: RemoteBin, drift: Drift): () => void {
    return () => {
        const store = page.w.store
        if (drift === 'read-fails') {
            const original = store.read
            store.read = async (key) => {
                if (key.startsWith('remotes/')) {
                    throw new Error('Injected: the remote read failed.')
                }
                return original(key)
            }
            return
        }
        for (const key of bin.remotes.keys()) {
            store.unplant(key)
        }
    }
}

/** Runs `action` when the import reaches the commit stage; answers how many store writes had been made by then. */
function atCommit(page: Page, action: () => void): { writesAtFlip: () => number } {
    let writesAtFlip = -1
    vi.mocked(page.alert.alertWait).mockImplementation((text: string) => {
        if (text === 'Loading backup...') {
            action()
            writesAtFlip = page.k.counted.writes.length
        }
        return { type: 'wait', msg: text }
    })
    return { writesAtFlip: () => writesAtFlip }
}

const alertErrorTexts = (page: Page): unknown[] => vi.mocked(page.alert.alertError).mock.calls.map((call) => call[0])

/** The confirm texts that ask about blocks the file leaves out. */
function leftOutAsked(page: Page): string[] {
    const probe = leftOutQuestion(['@@line@@'])
    const head = probe.slice(0, probe.indexOf('- @@line@@'))
    return vi.mocked(page.alert.alertConfirm).mock.calls.map((call) => String(call[0])).filter((text) => text.startsWith(head))
}

const DRIFTS: readonly (readonly [Drift, string])[] = [
    ['read-fails', 'the read of the remote payload failing'],
    ['key-gone', 'the remote payload\'s key gone'],
]

describe('a page import whose commit decode leaves out a block nobody confirmed', () => {
    test.each(DRIFTS)('regression: %s at the commit is refused with the file-changed text and nothing is committed', async (drift) => {
        const page = await openPage()
        const before = await page.k.commitKey()
        const bin = await remoteBin(page)
        bin.plant()
        const flip = atCommit(page, driftAction(page, bin, drift))

        await loadFile(bin.file)

        expect(flip.writesAtFlip(), 'the import must have reached the commit stage').toBeGreaterThanOrEqual(0)
        expect(leftOutAsked(page), 'the probe read the remote, so no left-out question is asked').toEqual([])
        expect(alertErrorTexts(page)).toEqual([language.backupFileChangedWhileReading])
        expect(vi.mocked(window.location.reload)).not.toHaveBeenCalled()
        expect(await page.k.commitKey()).toEqual(before)
        expect(page.k.counted.writes.slice(flip.writesAtFlip())).toEqual([])
    })

    test('guard: the remote readable throughout lands with its character', async () => {
        const page = await openPage()
        const before = await page.k.commitKey()
        const bin = await remoteBin(page)
        bin.plant()

        await loadFile(bin.file)

        expect(leftOutAsked(page)).toEqual([])
        expect(alertErrorTexts(page)).toEqual([])
        expect(vi.mocked(window.location.reload)).toHaveBeenCalledTimes(1)
        expect(await page.k.commitKey()).not.toEqual(before)
        expect((await page.k.saved()).characters.map((entry) => entry.chaId)).toEqual(['plain', REMOTE_ID])
    })

    test('guard: a remote missing at the probe and at the commit, left out by the person, lands without it', async () => {
        const page = await openPage()
        const before = await page.k.commitKey()
        const bin = await remoteBin(page)

        await loadFile(bin.file)

        expect(leftOutAsked(page)).toHaveLength(1)
        expect(alertErrorTexts(page)).toEqual([])
        expect(vi.mocked(window.location.reload)).toHaveBeenCalledTimes(1)
        expect(await page.k.commitKey()).not.toEqual(before)
        expect((await page.k.saved()).characters.map((entry) => entry.chaId)).toEqual(['plain'])
    })

    test('guard: a remote missing at the probe and present at the commit lands, because it was confirmed left out and now reads', async () => {
        const page = await openPage()
        const before = await page.k.commitKey()
        const bin = await remoteBin(page)
        // The payload appears when the import reaches the commit stage.
        atCommit(page, () => bin.plant())

        await loadFile(bin.file)

        expect(leftOutAsked(page)).toHaveLength(1)
        expect(alertErrorTexts(page)).toEqual([])
        expect(await page.k.commitKey()).not.toEqual(before)
    })
})

describe('a boot import whose commit decode leaves out a block nobody confirmed', () => {
    function recordingTarget(installs: boolean[]): BootImportTarget {
        return {
            readColdStorageItem: async () => ({ status: 'missing' }),
            async install(installed) {
                installs.push(installed.tree !== null)
                return { status: 'blocked', reason: 'install-failed', detail: 'recorded' }
            },
        }
    }

    test.each(DRIFTS)('regression: %s at the commit shows the file-changed text, installs nothing and ends cancelled', async (drift) => {
        const boot = await openBoot()
        const installs: boolean[] = []
        const bin = await remoteBin(boot)
        bin.plant()
        const flip = atCommit(boot, driftAction(boot, bin, drift))

        const end = await pickAtBoot(recordingTarget(installs), bin.file)

        expect(flip.writesAtFlip(), 'the import must have reached the commit stage').toBeGreaterThanOrEqual(0)
        expect(leftOutAsked(boot), 'the probe read the remote, so no left-out question is asked').toEqual([])
        expect(alertErrorTexts(boot)).toEqual([language.backupFileChangedWhileReading])
        expect(installs).toEqual([])
        expect(end).toEqual({ kind: 'cancelled' })
    })

    test('guard: the remote readable throughout reaches the installer', async () => {
        const boot = await openBoot()
        const installs: boolean[] = []
        const bin = await remoteBin(boot)
        bin.plant()

        const end = await pickAtBoot(recordingTarget(installs), bin.file)

        expect(alertErrorTexts(boot)).toEqual([])
        expect(installs).toEqual([true])
        expect(end.kind).toBe('finished')
    })
})
