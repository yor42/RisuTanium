/**
 * A `.bin` that changes on disk between the asset copy and the commit is refused, and nothing is committed.
 *
 * The import validates the database entry once (before the copy), keeps nothing of its bytes across the copy, and reads the
 * entry again when it commits. The re-read checks the entry's header against the walk (its name, its length fields and the
 * encryption marker) and the read itself. A file that no longer matches ends the import with the file-changed text: on a
 * page, nothing is committed, the commit key is the one the page had, and the page does not reload; at boot, the installer
 * is never called and the flow ends cancelled.
 *
 * What is detected: an unreadable range, a short read, the header fields, the name and the marker at the database offset.
 * A same-length body change with an intact header is not detected by the re-read: it is refused only where the platform's
 * File snapshot rejects the read (the `unreadable` case below); otherwise the commit decodes the new body.
 *
 * Runs `LoadLocalBackup()` and `loadBackupAtBoot()` over the real store2 loop of `storeImportRetention.svelte.test.ts`. The
 * chosen file serves the golden's bytes until the import shows 'Loading backup...' (the commit stage) and the changed
 * ones after; only the database entry changes, every unit entry stays readable. A mocked File proves nothing about a phone.
 *
 * Labels: regression (red on the base, which commits the bytes it kept from before the copy), guard (passes with or without the change).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import { language } from 'src/lang'
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

const GOLDEN_DIR = path.resolve(process.env.BIN_GOLDENS_DIR ?? path.join(process.cwd(), 'src/ts/drive/tests/binGoldens'))

function golden(name: string): Uint8Array {
    return new Uint8Array(fs.readFileSync(path.join(GOLDEN_DIR, name)))
}

// ---- the changing file ----

const DATABASE_NAME = 'database.risudat'

interface DatabaseEntry {
    headerOffset: number
    nameLength: number
    /** The database entry's header and body, as a byte range of the file. */
    rangeEnd: number
}

/** The last entry named `database.risudat`, read from the file's own framing and not from the code under test. */
function locateDatabase(bytes: Uint8Array): DatabaseEntry {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let found: DatabaseEntry | null = null
    let offset = 0
    while (offset + 4 <= bytes.length) {
        const headerOffset = offset
        const nameLength = view.getUint32(offset, true)
        const name = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 4 + nameLength))
        const dataLength = view.getUint32(offset + 4 + nameLength, true)
        offset += 8 + nameLength + dataLength
        if (name === DATABASE_NAME) {
            found = { headerOffset, nameLength, rangeEnd: offset }
        }
    }
    if (found === null) {
        throw new Error('the golden holds no database entry')
    }
    return found
}

/**
 * header: the database entry's dataLength field is rewritten (a different length, a different file).
 * name: the last byte of its name is changed at the same length.
 * unreadable: no byte changes; a read that overlaps the database entry rejects the way a browser's File does once its snapshot is stale.
 */
type Change = 'header' | 'name' | 'unreadable'

interface ChangingFile {
    file: File
    /** From now on the file serves its changed form. */
    change(): void
}

function changingFile(original: Uint8Array, change: Change): ChangingFile {
    const database = locateDatabase(original)
    const altered = original.slice()
    if (change === 'header') {
        new DataView(altered.buffer).setUint32(database.headerOffset + 4 + database.nameLength, 0x7fffff, true)
    } else if (change === 'name') {
        altered[database.headerOffset + 4 + database.nameLength - 1] ^= 0x01
    }
    const first = new File([original as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')
    const second = new File([altered as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')
    let changed = false
    Object.defineProperty(first, 'slice', {
        value: (start?: number, end?: number, type?: string): Blob => {
            if (!changed) {
                return File.prototype.slice.call(first, start, end, type)
            }
            const blob = second.slice(start, end, type)
            if (change === 'unreadable' && (start ?? 0) < database.rangeEnd && (end ?? original.length) > database.headerOffset) {
                Object.defineProperty(blob, 'arrayBuffer', {
                    value: () => Promise.reject(new DOMException('The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.', 'NotReadableError')),
                    configurable: true,
                })
            }
            return blob
        },
        configurable: true,
    })
    return { file: first, change: () => { changed = true } }
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

/** Flips the file to its changed form when the import reaches the commit stage; answers how many store writes had been made by then. */
function changeAtCommit(page: Page, changing: ChangingFile): { writesAtFlip: () => number } {
    let writesAtFlip = -1
    vi.mocked(page.alert.alertWait).mockImplementation((text: string) => {
        if (text === 'Loading backup...') {
            changing.change()
            writesAtFlip = page.k.counted.writes.length
        }
        return { type: 'wait', msg: text }
    })
    return { writesAtFlip: () => writesAtFlip }
}

const alertErrorTexts = (page: Page): unknown[] => vi.mocked(page.alert.alertError).mock.calls.map((call) => call[0])

const SOURCES = ['fork-full.bin', 'upstream-full.bin'] as const
const CHANGES: readonly (readonly [Change, string])[] = [
    ['header', 'the database header\'s dataLength field rewritten'],
    ['unreadable', 'reads of the database entry rejecting with NotReadableError'],
    ['name', 'the database entry\'s name changed at the same length'],
]

describe.each(SOURCES)('a page import of %s', (source) => {
    test('guard: the file left as it is lands, so a refusal below is the change and not the harness', async () => {
        const page = await openPage()
        const before = await page.k.commitKey()
        const unchanged = changingFile(golden(source), 'unreadable')
        changeAtCommit(page, { file: unchanged.file, change: () => { } })

        await loadFile(unchanged.file)

        expect(alertErrorTexts(page)).toEqual([])
        expect(vi.mocked(window.location.reload)).toHaveBeenCalledTimes(1)
        expect(await page.k.commitKey()).not.toEqual(before)
    })

    test.each(CHANGES)('regression: %s after the copy is refused with the file-changed text and nothing is committed', async (change) => {
        const page = await openPage()
        const before = await page.k.commitKey()
        const changing = changingFile(golden(source), change)
        const flip = changeAtCommit(page, changing)

        await loadFile(changing.file)

        expect(flip.writesAtFlip(), 'the import must have reached the commit stage').toBeGreaterThanOrEqual(0)
        expect(alertErrorTexts(page)).toEqual([language.backupFileChangedWhileReading])
        expect(vi.mocked(window.location.reload)).not.toHaveBeenCalled()
        expect(await page.k.commitKey()).toEqual(before)
        expect(page.k.counted.writes.slice(flip.writesAtFlip())).toEqual([])
    })
})

describe.each(SOURCES)('a boot import of %s', (source) => {
    function recordingTarget(installs: boolean[]): BootImportTarget {
        return {
            readColdStorageItem: async () => ({ status: 'missing' }),
            async install(installed) {
                installs.push(installed.tree !== null)
                return { status: 'blocked', reason: 'install-failed', detail: 'recorded' }
            },
        }
    }

    test('guard: the file left as it is reaches the installer', async () => {
        const boot = await openBoot()
        const installs: boolean[] = []
        const unchanged = changingFile(golden(source), 'unreadable')

        const end = await pickAtBoot(recordingTarget(installs), unchanged.file)

        expect(vi.mocked(boot.alert.alertError).mock.calls).toEqual([])
        expect(installs).toEqual([true])
        expect(end.kind).toBe('finished')
    })

    test.each(CHANGES)('regression: %s after the copy shows the file-changed text, installs nothing and ends cancelled', async (change) => {
        const boot = await openBoot()
        const installs: boolean[] = []
        const changing = changingFile(golden(source), change)
        const flip = changeAtCommit(boot, changing)

        const end = await pickAtBoot(recordingTarget(installs), changing.file)

        expect(flip.writesAtFlip(), 'the import must have reached the commit stage').toBeGreaterThanOrEqual(0)
        expect(alertErrorTexts(boot)).toEqual([language.backupFileChangedWhileReading])
        expect(installs).toEqual([])
        expect(end).toEqual({ kind: 'cancelled' })
    })
})
