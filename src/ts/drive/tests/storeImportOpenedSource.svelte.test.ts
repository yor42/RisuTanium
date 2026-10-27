/**
 * The Settings-style import of a store2 page from a `.bin` another app opened: `LoadLocalBackup(undefined, { opened })`
 * over an `ImportSource`, against the same real store2 loop as `storeImportFileChanged.svelte.test.ts`. A mocked source
 * proves nothing about a content provider or a phone.
 *
 * Pinned: the page ends in the same state as after the picker `File` restore of the same golden; a read of the source that
 * fails or comes back short at any later stage (the walk, the copy-pass header, the database decode before the copy, the
 * commit's database re-read, a cold-storage unit read) ends the import with an error alert and no commit, and no reload;
 * a source whose size or modification time changed by the commit is refused with the file-changed text.
 *
 * Labels: guard (File and source agree), reproducer (red against the mutant named at the test).
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
import { importSourceOfBytes, type ImportSource, type ImportSourceStat } from 'src/ts/importSource'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Database } from 'src/ts/storage/database.svelte'
import type { LocalBackupEnd } from 'src/ts/drive/backuplocal'

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

const GOLDEN_DIR = path.resolve(process.env.BIN_GOLDENS_DIR ?? path.join(process.cwd(), 'src/ts/drive/tests/binGoldens'))

function golden(name: string): Uint8Array {
    return new Uint8Array(fs.readFileSync(path.join(GOLDEN_DIR, name)))
}

// ---- the file and its source ----

const DATABASE_NAME = 'database.risudat'

interface DatabaseEntry {
    headerOffset: number
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
            found = { headerOffset, rangeEnd: offset }
        }
    }
    if (found === null) {
        throw new Error('the golden holds no database entry')
    }
    return found
}

interface Read {
    start: number
    end: number
}

type Stage = 'walk' | 'copy' | 'decode' | 'commit'

/** Where the import is, from the progress texts it shows. */
function followStage(page: Page, onStage?: (stage: Stage) => void): { current: () => Stage } {
    let stage: Stage = 'walk'
    vi.mocked(page.alert.alertWait).mockImplementation((text: string) => {
        const next: Stage | null = text === 'Reading the database in the backup...' ? 'decode'
            : text === 'Loading backup...' ? 'commit'
                : text.startsWith('Loading local Backup...') && stage !== 'commit' ? 'copy'
                    : null
        if (next !== null) {
            stage = next
            onStage?.(next)
        }
        return { type: 'wait', msg: text }
    })
    return { current: () => stage }
}

interface Probe {
    source: ImportSource
    /** How many reads were faulted. */
    faulted: () => number
}

function probeSource(bytes: Uint8Array, options: {
    fault?: (read: Read, index: number) => 'throw' | 'short' | null
    stat?: () => ImportSourceStat
} = {}): Probe {
    const inner = importSourceOfBytes('backup.bin', bytes)
    let count = 0
    let faulted = 0
    const source: ImportSource = {
        ...inner,
        read: async (start, end) => {
            const mode = options.fault?.({ start, end }, count++) ?? null
            if (mode !== null) {
                faulted++
            }
            if (mode === 'throw') {
                throw new Error('scratch: the provider failed')
            }
            const got = await inner.read(start, end)
            return mode === 'short' ? got.subarray(0, Math.min(1, got.length)) : got
        },
        stat: async () => options.stat ? options.stat() : inner.stat(),
    }
    return { source, faulted: () => faulted }
}

function restoreOpened(source: ImportSource): Promise<LocalBackupEnd> {
    return import('src/ts/drive/backuplocal').then(({ LoadLocalBackup }) => LoadLocalBackup(undefined, { source, name: 'backup.bin', lastModified: 0 }))
}

async function restoreFile(bytes: Uint8Array): Promise<LocalBackupEnd> {
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
        const pending = LoadLocalBackup()
        const chosen = input as HTMLInputElement | null
        if (chosen === null) {
            throw new Error('LoadLocalBackup did not create a file input')
        }
        Object.defineProperty(chosen, 'files', { value: [new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')], configurable: true })
        await (chosen.onchange as unknown as (event: Event) => Promise<void>).call(chosen, new Event('change'))
        return await pending
    } finally {
        spy.mockRestore()
    }
}

/** An import mints ids for chats the file gives none; they differ per run and say nothing about the route. */
function withoutMintedIds(text: string): string {
    return text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g, '<id>')
}

const alertErrorTexts =(page: Page): unknown[] => vi.mocked(page.alert.alertError).mock.calls.map((call) => call[0])

const SOURCES = ['fork-full.bin', 'upstream-full.bin'] as const

describe.each(SOURCES)('a page import of %s from an opened source', (name) => {
    // Guard: passes before and after the feature only in the sense that both routes agree; red if the source route differs.
    test('guard: the page ends in the state the picker File restore leaves', async () => {
        const viaFile = await openPage()
        const fileEnd = await restoreFile(golden(name))
        const fileUnitCount = [...viaFile.k.memory.snapshot()].length
        const fileSaved = withoutMintedIds(JSON.stringify(await viaFile.k.saved()))
        worlds.parkAll()

        const viaSource = await openPage()
        const probe = probeSource(golden(name))
        const sourceEnd = await restoreOpened(probe.source)

        expect(alertErrorTexts(viaFile)).toEqual([])
        expect(alertErrorTexts(viaSource)).toEqual([])
        expect(fileEnd.outcome).toBe('committed')
        expect(sourceEnd.outcome).toBe('committed')
        expect(sourceEnd.detail.source).toEqual({ kind: 'file', name: 'backup.bin', size: golden(name).length, lastModified: 0 })
        expect(withoutMintedIds(JSON.stringify(await viaSource.k.saved()))).toBe(fileSaved)
        expect([...viaSource.k.memory.snapshot()].length).toBe(fileUnitCount)
    })

    interface FaultCase {
        label: string
        /** Whether the read is the one to fault, given where the import is. */
        pick: (stage: Stage, read: Read, database: DatabaseEntry, firstOfStage: boolean) => boolean
    }

    const overlaps = (read: Read, database: DatabaseEntry): boolean => read.start < database.rangeEnd && read.end > database.headerOffset

    const CASES: FaultCase[] = [
        { label: 'the walk', pick: (stage, _read, _db, first) => stage === 'walk' && first },
        { label: 'the copy-pass header', pick: (stage, _read, _db, first) => stage === 'copy' && first },
        { label: 'the database decode before the copy (readBinDatabaseOmitted)', pick: (stage, read, db) => stage === 'decode' && overlaps(read, db) },
        { label: 'the commit\'s re-read of the database entry', pick: (stage, read, db) => stage === 'commit' && overlaps(read, db) },
        { label: 'a cold-storage unit read during the commit', pick: (stage, read, db, first) => stage === 'commit' && !overlaps(read, db) && first },
    ]

    // Guards: a failed or short read of the source at each site ends with an error alert, no commit and no reload.
    describe.each(['throw', 'short'] as const)('a read that is a %s', (mode) => {
        test.each(CASES)('$label ends the import with an error alert and no commit', async (picked) => {
            const page = await openPage()
            const before = await page.k.commitKey()
            const bytes = golden(name)
            const database = locateDatabase(bytes)
            const firstOfStage = new Set<Stage>()
            const stage = followStage(page)
            const probe = probeSource(bytes, {
                fault: (read) => {
                    const now = stage.current()
                    const first = !firstOfStage.has(now)
                    // A stage's first read that does not touch the database entry is a cold-storage unit read at the commit.
                    if (picked.pick(now, read, database, first)) {
                        return mode
                    }
                    if (!(now === 'commit' && overlaps(read, database))) {
                        firstOfStage.add(now)
                    }
                    return null
                },
            })

            const end = await restoreOpened(probe.source)

            expect(probe.faulted(), 'the harness must have faulted a read').toBeGreaterThan(0)
            expect(end.outcome).not.toBe('committed')
            expect(alertErrorTexts(page).length).toBeGreaterThan(0)
            expect(vi.mocked(window.location.reload)).not.toHaveBeenCalled()
            expect(await page.k.commitKey()).toEqual(before)
        })
    })

    describe('a file that changed', () => {
        // Reproducer against the mutant without the `changed()` check before `commitStore2Import`: the commit would decode
        // and install whatever the source serves now.
        // The stat calls are: the open-time figure, the check after the copy pass, then the check before the commit; only
        // the last one sees the change.
        test.each([
            ['size', (call: number): ImportSourceStat => ({ size: golden(name).length + (call >= 2 ? 1 : 0), modified: 5 })],
            ['modification time', (call: number): ImportSourceStat => ({ size: golden(name).length, modified: call >= 2 ? 6 : 5 })],
        ] as const)('reproducer: a changed %s seen only before the commit is refused with the file-changed text and nothing is committed', async (_label, statOf) => {
            const page = await openPage()
            const before = await page.k.commitKey()
            let statCalls = 0
            const probe = probeSource(golden(name), { stat: () => statOf(statCalls++) })

            const end = await restoreOpened(probe.source)

            expect(statCalls).toBeGreaterThanOrEqual(3)
            expect(end.outcome).toBe('nothing-replaced')
            expect(alertErrorTexts(page)).toEqual([language.backupFileChangedWhileReading])
            expect(vi.mocked(window.location.reload)).not.toHaveBeenCalled()
            expect(await page.k.commitKey()).toEqual(before)
        })

        test('guard: a source that reports the same size and time lands', async () => {
            const page = await openPage()
            const before = await page.k.commitKey()
            const probe = probeSource(golden(name), { stat: () => ({ size: golden(name).length, modified: 5 }) })

            const end = await restoreOpened(probe.source)

            expect(end.outcome).toBe('committed')
            expect(alertErrorTexts(page)).toEqual([])
            expect(await page.k.commitKey()).not.toEqual(before)
        })
    })
})
