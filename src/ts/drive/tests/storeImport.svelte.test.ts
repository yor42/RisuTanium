/**
 * The `.bin` import of a store2 page (`LoadLocalBackup` -> `storeImport.ts` -> `importLegacyTree`): preconditions before
 * the copy, the database decoded and confirmed before the first asset is written, cold-storage entries read from the
 * file and never stored, one forced commit that keeps the replaced state, and every outcome of that commit.
 *
 * Runs over the real, unmocked `saveDb()` store2 loop in a world of its own (`saveLoopWorld.ts`, `store2SaveKit.ts`),
 * against an in-memory store2 backend and a fake Web Locks manager. The legacy unit store is a double (`coldUnits`).
 * A mocked success here is not evidence of native backend behaviour, and nothing here measures memory on a device.
 *
 * Labels: regression (red on the base the named change fixes), new behaviour pinned by mutants, guard (passes with or
 * without the change), mutant (a recorded temporary edit that turns the named test red).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { bootThroughDispatch, commitActivePass, startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import { language } from 'src/lang'
import { COMMIT_KEY } from 'src/ts/storage/store2/format/keys'
import { decodeFrame, encodeUnit, REQ_MODULE_BUCKETS, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { unitDigest } from 'src/ts/storage/store2/codec'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { assembleDatabase } from 'src/ts/storage/store2/codec'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import * as kitCommit from 'src/ts/storage/store2/commit'
import type { CommitRequest, Committer, CommitResult, StreamedCommitRequest } from 'src/ts/storage/store2/commit'
import type { Store2Read } from 'src/ts/storage/store2/backend/types'
import { toPlainJson } from 'src/ts/storage/store2/codec/normalize'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Database } from 'src/ts/storage/database.svelte'
import { BACKUP_ENCRYPTION_MARKER_NAME, indexBackupEntries } from 'src/ts/drive/backupContainer'
import { loadGolden, readerOver } from 'src/ts/storage/tests/store2/legacyFixtures'
import { readBaseContentIndex } from 'src/ts/storage/store2/baseContent'
import { importLegacyTree } from 'src/ts/storage/store2/legacy/importTree'
import { createListDerivation } from 'src/ts/storage/store2/lists'
import { breakDataChecksum } from 'src/ts/storage/tests/risuSaveBlockFile'

vi.setConfig({ testTimeout: 60_000 })

const platformBox = vi.hoisted(() => ({ isNodeServer: false }))

type ImportStreamModule = typeof import('src/ts/storage/store2/legacy/importStream')
type Arm = 'whole' | 'stream'

/** The arm the running test is in, and what the streamed prepare decided in it (`onPrepared`, once per attempt that reached it). */
const armBox = vi.hoisted(() => ({ arm: 'whole' as 'whole' | 'stream', verdicts: [] as string[] }))

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

/** The page's legacy cold units, by unit id; what `readColdStorageItem` answers. */
const coldUnits = new Map<string, unknown>()
const setColdStorageItemMock = vi.fn(async () => false)

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
    coldUnits.clear()
    armBox.verdicts = []
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
    // The unit store of the page is a double: the shared mock module offers only the legacy reader's old name.
    vi.doMock('src/ts/process/coldstorage.svelte', async () => ({
        getColdStorageItem: vi.fn(),
        getColdStorageBackupKey: (await import('src/ts/process/coldstorageData')).getColdStorageBackupKey,
        readColdStorageItem: async (key: string) => coldUnits.has(key) ? { status: 'ok', value: coldUnits.get(key) } : { status: 'missing' },
        setColdStorageItem: setColdStorageItemMock,
    }))
    // The shared world mock of the database module has no `presetFromWorkingSettings`, which the botPresetsId repair of an
    // import calls; the stand-in keeps the working prompt so the appended preset is recognisable.
    vi.doMock('src/ts/storage/database.svelte', () => ({
        getDatabase: vi.fn(() => h.db),
        setDatabase: vi.fn(),
        presetTemplate: { name: 'test-preset' },
        defaultSdDataFunc: vi.fn(() => ({})),
        appVer: 'test',
        appSubVer: 'test',
        getCurrentCharacter: vi.fn(),
        presetFromWorkingSettings: (db: Entry, name: string) => ({ name, mainPrompt: db.mainPrompt }),
    }))
    // The arm seam: production never passes `minUnits`, so the streamed prepare is steered here, through the module the
    // page's import loads. The whole arm never reaches the threshold; the stream arm always does.
    vi.doMock('src/ts/storage/store2/legacy/importStream', async () => {
        const actual = await vi.importActual<ImportStreamModule>('src/ts/storage/store2/legacy/importStream')
        return {
            ...actual,
            prepareImportStream: (request: Parameters<ImportStreamModule['prepareImportStream']>[0], hooks: Parameters<ImportStreamModule['prepareImportStream']>[1]) => actual.prepareImportStream({
                ...request,
                stream: {
                    ...request.stream,
                    minUnits: armBox.arm === 'stream' ? 0 : Number.POSITIVE_INFINITY,
                    onPrepared: (verdict) => {
                        armBox.verdicts.push(verdict)
                        request.stream.onPrepared?.(verdict)
                    },
                },
            }, hooks),
        }
    })
    // The committer of the page is built by the kit in this file's module graph, the import code runs in the world's: a
    // streamed commit always runs under a bulk marker and fails with the kit's `Store2BulkAbortError`, which the import
    // must recognise by class as it does in the one graph of the app.
    vi.doMock('src/ts/storage/store2/commit', async () => ({
        ...await vi.importActual<typeof import('src/ts/storage/store2/commit')>('src/ts/storage/store2/commit'),
        Store2BulkAbortError: kitCommit.Store2BulkAbortError,
    }))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(async () => {
    const { overrideBackupWindowBytes } = await import('src/ts/drive/backupContainer')
    overrideBackupWindowBytes(null)
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
    flush(): void
    alert: typeof import('src/ts/alert')
    busy: typeof import('src/ts/process/memory/busyActions')
    loop: typeof import('src/ts/storage/store2/saveLoop')
    errors: typeof import('src/ts/storage/store2/backend/errors')
    useCommitter(committer: Committer): void
    /** What the page's reload did: how many times, and which busy entries were registered at that moment. */
    reloads: { count: number, busyAtReload: string[][] }
}

async function openPage(options: { webLocks?: boolean, characters?: readonly string[] } = {}): Promise<Page> {
    const locks = new FakeLockManagerCore()
    const manager = options.webLocks === false ? undefined : new FakeTabLockManagerView(locks, 'this')
    Object.defineProperty(window.navigator, 'locks', { value: manager, configurable: true })
    h.db = makeDb('base', options.characters ?? ['alpha', 'beta'])
    const k = await startStore2({ db: h.db as unknown as Database })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    const { flushSync } = await import('svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    const bootActive = await import('src/ts/storage/store2/bootActive')
    const busy = await import('src/ts/process/memory/busyActions')
    const reloads: Page['reloads'] = { count: 0, busyAtReload: [] }
    const page: Page = {
        w,
        k,
        db: h.db,
        flush: flushSync,
        alert: await import('src/ts/alert'),
        busy,
        loop: await import('src/ts/storage/store2/saveLoop'),
        errors: await import('src/ts/storage/store2/backend/errors'),
        useCommitter(committer) {
            bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer } as unknown as Store2Session)
        },
        reloads,
    }
    page.useCommitter(k.committer)
    w.pageMode.setPageStorageMode({ kind: 'store2' })
    vi.mocked(page.alert.alertConfirm).mockImplementation(async () => true)
    vi.spyOn(page.alert.alertStore, 'set').mockImplementation(() => { })
    vi.spyOn(window.location, 'reload').mockImplementation(() => {
        reloads.count++
        reloads.busyAtReload.push(busy.busyKinds())
    })
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => { })
    w.start()
    await sleepReal(150)
    await settled(w)
    return page
}

async function commitEdit(page: Page, prompt: string): Promise<void> {
    await nextCommit(page.w, () => {
        page.db.mainPrompt = prompt
        page.flush()
    })
}

async function currentKey(page: Page): Promise<string | undefined> {
    return (await page.k.commitKey()).current?.key
}

/** Whether `dbWriteLock` can be taken within a moment: false while an import keeps it closed. */
async function writeLockIsFree(page: Page): Promise<boolean> {
    const taken = page.w.api.dbWriteLock.acquire().then((release) => { release(); return true })
    return await Promise.race([taken, sleepReal(250).then(() => false)])
}

const alertErrorTexts = (page: Page): unknown[] => vi.mocked(page.alert.alertError).mock.calls.map((call) => call[0])
const confirmTexts = (page: Page): string[] => vi.mocked(page.alert.alertConfirm).mock.calls.map((call) => String(call[0]))

// ---- .bin construction ----

const GOLDEN_DIR = path.resolve(process.env.BIN_GOLDENS_DIR ?? path.join(process.cwd(), 'src/ts/drive/tests/binGoldens'))

function golden(name: string): Uint8Array {
    return new Uint8Array(fs.readFileSync(path.join(GOLDEN_DIR, name)))
}

/** The goldens run at the default windows and again at windows so small that every golden crosses window edges in both passes. */
const GOLDEN_WINDOWS: readonly (number | undefined)[] = [undefined, 4, 64]

/** Set after `openPage()`: the world re-imports the app's modules, and the seam must be the one the world's `backuplocal` reads. */
async function useGoldenWindows(windowBytes: number | undefined): Promise<void> {
    const { overrideBackupWindowBytes } = await import('src/ts/drive/backupContainer')
    overrideBackupWindowBytes(windowBytes === undefined ? null : { walk: windowBytes, copy: windowBytes })
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

/** A block-format save of `db`, as the world's encoder writes the main file. */
async function blockFileBytes(page: Page, db: Entry): Promise<Uint8Array> {
    const encoder = new page.w.encoderFixture.RisuSaveEncoder()
    await encoder.init(db as unknown as Database, { compression: false })
    await encoder.set(db as unknown as Database, { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false })
    return new Uint8Array(encoder.encode()!)
}

const AVATAR = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

/** Drives the real `LoadLocalBackup()` with `bytes` as the chosen file and awaits its change handler. */
async function loadBin(page: Page, bytes: Uint8Array): Promise<void> {
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
    await observeArm(page)
}

async function databaseOf(page: Page, manifestKey: string): Promise<Database> {
    const read = await readTreeBytes(page.k.memory, manifestKey)
    if (read.status !== 'ok') {
        throw new Error(`The stored tree reads ${read.status}.`)
    }
    return assembleDatabase(read.tree.manifest, read.tree.source)
}

const namesOf = (db: Database): string[] => (db.characters as unknown as { name: string }[]).map((character) => character.name).sort()

/** The store operations that wrote or deleted anything. */
const mutations = (page: Page) => page.w.store.mutating()

// ---- the whole and the stream arm ----

/** What one import showed: the fields the two arms must give alike. The commit mode and the commit key's seq and epoch are left out. */
interface ArmView {
    confirms: string[]
    errors: string[]
    waits: string[]
    reloads: number
    /** The committed current tree as plain JSON with each uuid replaced by its order of first appearance; null when it cannot be read. */
    tree: string | null
}

interface ArmRecord {
    view: ArmView
    verdicts: string[]
}

/** By test name without the arm: the last import of the test in each arm. */
const observed = new Map<string, Partial<Record<Arm, ArmRecord>>>()

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

function normalizeUuids(text: string): string {
    const seen = new Map<string, string>()
    return text.replace(UUID_PATTERN, (uuid) => {
        if (!seen.has(uuid)) {
            seen.set(uuid, `<uuid${seen.size}>`)
        }
        return seen.get(uuid) as string
    })
}

/** Records what the import that just ended showed, under the running test's name, for the arm agreement test at the end of the file. */
async function observeArm(page: Page): Promise<void> {
    let tree: string | null = null
    try {
        const key = await currentKey(page)
        if (key !== undefined) {
            tree = normalizeUuids(JSON.stringify(toPlainJson(await databaseOf(page, key))))
        }
    } catch {
        tree = null
    }
    const view: ArmView = {
        confirms: confirmTexts(page),
        errors: alertErrorTexts(page).map((text) => String(text)),
        waits: [...vi.mocked(page.alert.alertWait).mock.calls, ...vi.mocked(page.alert.alertNormalWait).mock.calls].map((call) => String(call[0])),
        reloads: page.reloads.count,
        tree,
    }
    const name = (expect.getState().currentTestName ?? '').replace(/ \((whole|stream) arm\)/, '')
    observed.set(name, { ...observed.get(name), [armBox.arm]: { view, verdicts: [...armBox.verdicts] } })
}

/** Runs `body` once per arm: the same tests with the streamed prepare held off (whole) and with it always taken when the file allows (stream). */
function armed(name: string, body: () => void): void {
    for (const arm of ['whole', 'stream'] as const) {
        describe(`${name} (${arm} arm)`, () => {
            beforeEach(() => { armBox.arm = arm })
            body()
        })
    }
}

armed('the .bin import of a store2 page', () => {
    // Regression: on the base a store2 page copies the assets, fails every cold-storage write, and throws at the missing
    // block store, so nothing is installed.
    test.each(GOLDEN_WINDOWS)('regression: upstream-full.bin becomes current and the pre-import manifest is the newest retained one (windows: %s)', async (windowBytes) => {
        const page = await openPage()
        await useGoldenWindows(windowBytes)
        const before = await currentKey(page) as string
        const expected = await loadGolden('upstream-full.bin')

        await loadBin(page, golden('upstream-full.bin'))

        const key = await page.k.commitKey()
        expect(key.current?.key).not.toBe(before)
        expect(key.retained[0].key).toBe(before)
        expect(namesOf(await databaseOf(page, key.current?.key as string))).toEqual(namesOf(expected.tree))
        expect(page.w.store.peek('assets/golden-avatar.png')).not.toBeNull()
        expect(page.reloads.count).toBe(1)
        expect(page.alert.alertWait).toHaveBeenCalledWith(language.store2ImportDone)
        expect(confirmTexts(page)).toEqual([])
        expect(alertErrorTexts(page)).toEqual([])
    })

    // New behaviour, pinned by mutants: the cold-storage entries are indexed and read from the file; none is stored or even attempted.
    test.each(GOLDEN_WINDOWS)('cold-storage entries are never written or attempted (windows: %s)', async (windowBytes) => {
        const page = await openPage()
        await useGoldenWindows(windowBytes)

        await loadBin(page, golden('upstream-full.bin'))

        expect(mutations(page).filter((op) => op.key.startsWith('coldstorage/'))).toEqual([])
        expect(setColdStorageItemMock).not.toHaveBeenCalled()
        expect(vi.mocked(console.error).mock.calls.map((call) => String(call[0])).filter((text) => text.includes('cold storage item'))).toEqual([])
    })

    // New behaviour, pinned by mutants: the import keeps the write lock closed and the page registered as busy until it reloads.
    test('the busy entry exists until the reload, and the write lock stays closed: the loop never commits afterwards', async () => {
        const page = await openPage()

        await loadBin(page, golden('upstream-full.bin'))

        expect(page.reloads.busyAtReload).toEqual([['backupLoad']])
        expect(page.busy.isBusy()).toBe(false)
        const landed = await currentKey(page)
        page.k.counted.reset()
        page.db.mainPrompt = 'after the import'
        page.flush()
        await sleepReal(400)
        expect(page.k.counted.writeCalls(), 'the loop wrote after the import').toBe(0)
        expect(await currentKey(page)).toBe(landed)
        expect(await writeLockIsFree(page)).toBe(false)
    })

    test('without Web Locks the warning is asked first, then the import lands and the write lock stays closed', async () => {
        const page = await openPage({ webLocks: false })

        await loadBin(page, golden('upstream-full.bin'))

        expect(confirmTexts(page)).toEqual([language.restoreNoLockWarningConfirm])
        expect(page.alert.alertConfirm).toHaveBeenCalledWith(language.restoreNoLockWarningConfirm, { ownScheme: 'saveGuard' })
        expect(page.reloads.count).toBe(1)
        expect((await page.k.commitKey()).retained).toHaveLength(1)
        expect(await writeLockIsFree(page)).toBe(false)
    })

    // New behaviour, pinned by mutants: the tab's own unsaved edits are saved before the file is read, so the kept state holds them.
    test('an unsaved edit is committed first, so the state kept as an earlier version includes it', async () => {
        const page = await openPage()
        page.db.mainPrompt = 'unsaved edit'
        page.flush()

        await loadBin(page, golden('upstream-full.bin'))

        const key = await page.k.commitKey()
        expect((await databaseOf(page, key.retained[0].key)).mainPrompt).toBe('unsaved edit')
        expect(confirmTexts(page)).not.toContain(language.store2RestoreUnsavedConfirm)
        expect(page.alert.alertWait).toHaveBeenCalledWith(language.store2RestoreSaving)
    })
})

armed('preconditions are checked before the first asset is written', () => {
    test('another page\'s bulk marker refuses the import with nothing written', async () => {
        const page = await openPage()
        await commitEdit(page, 'second')
        const parsed = classifyCommitRead(await page.k.counted.backend.readCommit())
        if (parsed.status !== 'parsed') {
            throw new Error('the commit key did not parse')
        }
        const marker = { owner: 'q'.repeat(26), prefix: 'store2/g-0000000000000000-', startedAt: 5, label: 'bulk' } as const
        page.k.memory.poke(COMMIT_KEY, encodeUnit(UNIT_TYPE.commit, { ...parsed.value, staging: marker }))
        page.k.counted.reset()
        page.w.store.ops.length = 0

        await loadBin(page, golden('upstream-full.bin'))

        expect(alertErrorTexts(page)).toContain(language.store2RestoreBulkMarker)
        expect(mutations(page)).toEqual([])
        expect(page.k.counted.writeCalls()).toBe(0)
        expect(page.reloads.count).toBe(0)
        expect(page.busy.isBusy()).toBe(false)
    })

    test('a page without a session refuses with nothing written', async () => {
        const page = await openPage()
        const bootActive = await import('src/ts/storage/store2/bootActive')
        bootActive.setStore2BootSession(null)
        page.w.store.ops.length = 0

        await loadBin(page, golden('upstream-full.bin'))

        expect(alertErrorTexts(page)).toContain(language.store2Boot.readOnlyRefusal)
        expect(mutations(page)).toEqual([])
        expect(page.reloads.count).toBe(0)
    })

    // Guard: the encryption marker stops a store2 import before any write, as it stops every restore.
    test('guard: an encryption marker stops the import before any write', async () => {
        const page = await openPage()
        const bytes = binOf(
            binEntry('golden-avatar.png', AVATAR),
            binEntry(BACKUP_ENCRYPTION_MARKER_NAME, new Uint8Array([1])),
            binEntry('database.risudat', new Uint8Array([1, 2, 3])),
        )
        page.w.store.ops.length = 0

        await loadBin(page, bytes)

        expect(alertErrorTexts(page)).toContain(language.encryptedBackupRefused)
        expect(mutations(page)).toEqual([])
        expect(page.reloads.count).toBe(0)
    })

    test('a file with entries but no database entry is refused as cut short before any asset is written', async () => {
        const page = await openPage()
        page.w.store.ops.length = 0

        await loadBin(page, binOf(binEntry('golden-avatar.png', AVATAR)))

        expect(alertErrorTexts(page)).toContain(language.backupFileEndsEarly)
        expect(mutations(page)).toEqual([])
    })

    // Message test: the store2 route already refused a truncated file without a database before any write.
    test('message test: a file cut inside an entry, with no database, says it is cut short', async () => {
        const page = await openPage()
        page.w.store.ops.length = 0

        await loadBin(page, binEntry('golden-avatar.png', AVATAR).slice(0, 12))

        expect(alertErrorTexts(page)).toContain(language.backupFileEndsEarly)
        expect(mutations(page)).toEqual([])
    })

    test('write reproducer: a complete database followed by a partial extra entry is refused with nothing written', async () => {
        const page = await openPage()
        page.w.store.ops.length = 0

        await loadBin(page, binOf(golden('upstream-full.bin'), binEntry('extra.png', AVATAR).slice(0, 12)))

        expect(alertErrorTexts(page)).toContain(language.backupFileEndsEarly)
        expect(mutations(page)).toEqual([])
        expect(page.reloads.count).toBe(0)
    })

    // New behaviour, pinned by mutants: a large database is announced, naming its size, before it is decoded.
    test('a database entry over the size limit is announced before it is decoded, and a decline writes nothing', async () => {
        const page = await openPage()
        // 17 MiB is 17,825,792 bytes: the warning names decimal megabytes, so 18.
        const megabytes = 18
        const bytes = binOf(binEntry('golden-avatar.png', AVATAR), binEntry('database.risudat', new Uint8Array(17 * 1024 * 1024)))
        vi.mocked(page.alert.alertConfirm).mockImplementation(async () => false)
        page.w.store.ops.length = 0

        await loadBin(page, bytes)

        expect(confirmTexts(page)).toEqual([language.store2ImportSizeWarning(megabytes, true)])
        // The import copies the backup's files before its commit, so a same-name file is replaced first.
        expect(language.store2ImportSizeWarning(megabytes, true)).toContain('replace any stored file with the same name')
        // With the decline ignored the zero-filled entry would fail to decode and write nothing anyway; the error text is what shows the decline stopped it.
        expect(alertErrorTexts(page)).toEqual([])
        expect(mutations(page)).toEqual([])
        expect(page.reloads.count).toBe(0)
        expect(await writeLockIsFree(page)).toBe(true)
    })

    // Guard: a Node server's oversize prompt is still asked on a store2 page, before anything is written.
    test('guard: the Node oversize prompt is asked first and a decline writes nothing', async () => {
        platformBox.isNodeServer = true
        const page = await openPage()
        // The oversize question follows the page's selected store; this world's store stands in for a Node store without recorded pieces.
        // The page runs in its own module graph, so the registry is taken from that graph.
        const { noteSelectedStore } = await import('src/ts/storage/assetLimit')
        noteSelectedStore('node', page.w.store)
        const big = new Uint8Array(1024 * 1024 + 1)
        const bytes = binOf(binEntry('big-asset.png', big), ...[golden('upstream-full.bin')])
        vi.mocked(page.alert.alertConfirm).mockImplementation(async () => false)
        page.w.store.ops.length = 0

        await loadBin(page, bytes)

        expect(confirmTexts(page)).toHaveLength(1)
        expect(confirmTexts(page)[0]).toContain('big-asset.png')
        expect(mutations(page)).toEqual([])
    })
})

armed('task presets over the .bin import of a store2 page', () => {
    // The page's `getDatabase` is the reactive `DBState.db` object, so the list read for the import is a `$state` proxy.
    const OWN = [{ id: 'own-0', name: 'From the file', instructions: 'x', model: 'm' }]

    async function storedPresets(page: Page): Promise<Record<string, unknown>[]> {
        const stored = await databaseOf(page, (await currentKey(page)) as string)
        return ((stored as unknown as { taskPresets?: Record<string, unknown>[] }).taskPresets ?? [])
    }

    async function committedTaskPresetKeys(page: Page, manifestKey: string): Promise<string[]> {
        const read = await readTreeBytes(page.k.memory, manifestKey)
        if (read.status !== 'ok') {
            throw new Error(`The stored tree reads ${read.status}.`)
        }
        return (read.tree.manifest.fixed.taskPresets ?? []).map(ref => ref[0])
    }

    async function binWith(page: Page, own: unknown): Promise<Uint8Array> {
        const source = makeDb('backup', ['alpha'])
        if (own !== undefined) {
            source.taskPresets = own
        }
        return binOf(binEntry('golden-avatar.png', AVATAR), binEntry('database.risudat', await blockFileBytes(page, source)))
    }

    test('regression reproducer: the page\'s presets, an unknown key and an unsaved edit included, are kept; an unchanged one keeps its unit key and an edited one gets a new key; the file\'s own list adds nothing', async () => {
        const page = await openPage()
        await nextCommit(page.w, () => {
            page.db.taskPresets = [
                { id: 'live-0', name: 'Live', instructions: 'a', model: 'm', futureKey: { n: [1] } },
                { id: 'live-1', name: 'Second', instructions: 'b', model: 'm' },
            ]
            page.flush()
        })
        const before = await currentKey(page) as string
        const keysBefore = await committedTaskPresetKeys(page, before)
        expect(keysBefore).toHaveLength(2)
        ;(page.db.taskPresets as Record<string, unknown>[])[1].name = 'Unsaved edit'

        await loadBin(page, await binWith(page, OWN))

        const kept = await storedPresets(page)
        expect(kept.map(preset => preset.id)).toEqual(['live-0', 'live-1'])
        expect(kept[0].futureKey).toEqual({ n: [1] })
        expect(kept[1].name).toBe('Unsaved edit')
        const keysAfter = await committedTaskPresetKeys(page, await currentKey(page) as string)
        expect(keysAfter).toHaveLength(2)
        // Content reuse on both arms: the unchanged preset keeps its stored unit, the edited one is written anew.
        expect(keysAfter[0]).toBe(keysBefore[0])
        expect(keysBefore).not.toContain(keysAfter[1])
        expect(alertErrorTexts(page)).toEqual([])
    })

    test('regression reproducer: with no presets on the page, the file\'s own list creates none and no token', async () => {
        const page = await openPage()

        await loadBin(page, await binWith(page, OWN))

        const manifestKey = await currentKey(page) as string
        expect(await storedPresets(page)).toEqual([])
        const read = await readTreeBytes(page.k.memory, manifestKey)
        // The page has modules, so the bucketed module index's token is the only one: no task-presets token.
        expect(read.status === 'ok' && read.tree.manifest.req).toEqual([REQ_MODULE_BUCKETS])
    })
})

armed('fork-only chat keys over the .bin import of a store2 page', () => {
    // Compatibility guard (passes before and after the export leave-out): an import changes nothing about these keys. A
    // `.bin` an earlier fork build wrote still carries them, and they come back with the chat.
    test('guard (G4): a fork .bin whose chat holds alt, a coverage pointer and an interrupted reply imports with all three kept', async () => {
        const page = await openPage()
        const source = makeDb('backup', ['alpha'])
        const chat = ((source.characters as Record<string, unknown>[])[0].chats as Record<string, unknown>[])[0]
        chat.message = [{ role: 'char', data: 'cut off', chatId: 'reply-1', interrupted: true }]
        chat.supaMemoryData = 'FIRST\nrest'
        chat.supaMemoryCoveredId = 'FIRST'
        chat.alt = [{ m: { time: 5, data: 'ALT', role: 'char' }, p: null, a: 1 }]

        await loadBin(page, binOf(binEntry('golden-avatar.png', AVATAR), binEntry('database.risudat', await blockFileBytes(page, source))))

        const stored = await databaseOf(page, (await currentKey(page)) as string)
        const kept = (stored.characters[0] as unknown as { chats: Record<string, unknown>[] }).chats[0]
        expect(kept.supaMemoryCoveredId).toBe('FIRST')
        expect(kept.alt).toEqual([{ m: { time: 5, data: 'ALT', role: 'char' }, p: null, a: 1 }])
        expect((kept.message as Record<string, unknown>[])[0]).toMatchObject({ data: 'cut off', interrupted: true })
        expect(alertErrorTexts(page)).toEqual([])
    })
})

armed('the database is decoded and confirmed before the copy', () => {
    /** A block-format backup of three characters with its last block damaged: the intact blocks can be salvaged. */
    async function damagedBackup(page: Page): Promise<{ bytes: Uint8Array, lines: string[] }> {
        const source = makeDb('backup', ['alpha', 'beta', 'gamma'])
        const damaged = breakDataChecksum(await blockFileBytes(page, source), 'alpha')
        const salvaged = await page.w.risuSave.salvageRisuSave(damaged)
        const { describeOmitted } = await import('src/ts/drive/describeOmitted')
        const lines = describeOmitted(salvaged.omitted)
        expect(lines.length, 'the fixture must leave something out').toBeGreaterThan(0)
        return { bytes: binOf(binEntry('golden-avatar.png', AVATAR), binEntry('database.risudat', damaged)), lines }
    }

    // New behaviour, pinned by mutants: every block the file lacks is named in the question.
    test('the question names every block the file lacks, and a decline writes nothing', async () => {
        const page = await openPage()
        const { bytes, lines } = await damagedBackup(page)
        vi.mocked(page.alert.alertConfirm).mockImplementation(async () => false)
        const before = await currentKey(page)
        page.w.store.ops.length = 0

        await loadBin(page, bytes)

        const questions = confirmTexts(page)
        expect(questions).toHaveLength(1)
        for (const line of lines) {
            expect(questions[0], `the question must name ${line}`).toContain(line)
        }
        expect(mutations(page)).toEqual([])
        expect(await currentKey(page)).toBe(before)
        expect(page.reloads.count).toBe(0)
        expect(await writeLockIsFree(page)).toBe(true)
    })

    test('after the person accepts, the intact parts are imported and the assets are copied', async () => {
        const page = await openPage()
        const { bytes } = await damagedBackup(page)
        const before = await currentKey(page) as string

        await loadBin(page, bytes)

        const key = await page.k.commitKey()
        expect(key.current?.key).not.toBe(before)
        expect(key.retained[0].key).toBe(before)
        expect(page.w.store.peek('assets/golden-avatar.png')).not.toBeNull()
        expect(page.reloads.count).toBe(1)
    })

    // New behaviour, pinned by mutants: what the resolve could not bring in is named and confirmed once.
    test('a unit the file does not hold is confirmed by name once; a decline writes nothing', async () => {
        const page = await openPage()
        vi.mocked(page.alert.alertConfirm).mockImplementation(async () => false)
        const before = await currentKey(page)
        page.w.store.ops.length = 0

        await loadBin(page, golden('upstream-stub-missing-entry.bin'))

        expect(confirmTexts(page)).toHaveLength(1)
        expect(confirmTexts(page)[0]).toContain('Stub Bob')
        expect(await currentKey(page)).toBe(before)
        expect(page.reloads.count).toBe(0)
        expect(await writeLockIsFree(page)).toBe(true)
    })
})

armed('busy work', () => {
    test('guard: work in progress refuses the import before anything is read or written', async () => {
        const page = await openPage()
        const handle = page.busy.beginBusy('export')
        page.w.store.ops.length = 0
        const { LoadLocalBackup } = await import('src/ts/drive/backuplocal')

        LoadLocalBackup()

        expect(alertErrorTexts(page)).toContain(language.backupLoadWorkInProgress)
        expect(mutations(page)).toEqual([])
        expect(page.reloads.count).toBe(0)
        handle.end()
    })

    // New behaviour, pinned by mutants: work that starts while the import prepares refuses it at the flip, and nothing is committed.
    test('work that starts before the commit refuses the import at the flip', async () => {
        const page = await openPage()
        const before = await currentKey(page)
        let end = () => { }
        vi.mocked(page.alert.alertConfirm).mockImplementation(async () => {
            const handle = page.busy.beginBusy('import')
            end = () => handle.end()
            return true
        })

        await loadBin(page, golden('upstream-stub-missing-entry.bin'))

        expect(alertErrorTexts(page)).toContain(language.backupLoadWorkInProgress)
        expect(await currentKey(page)).toBe(before)
        expect(page.reloads.count).toBe(0)
        expect(await writeLockIsFree(page)).toBe(true)
        end()
    })
})

/** The real committer as one entry point of it reaches it: `commit` delegates to the same entry point the double stands in for. */
interface Delegate {
    readCommit(): Promise<Store2Read>
    commit(read: Store2Read, request: CommitRequest | StreamedCommitRequest): Promise<CommitResult>
}

/**
 * The page's committer with both commit entry points replaced by one double, so the scenario reaches the same outcome
 * whichever path the import takes (the whole commit, or the streamed commit of a file over the bulk threshold); the
 * library calls one of them once per attempt. The `real` it hands the double delegates to the entry point being doubled.
 */
function committingWith(page: Page, commit: (real: Delegate, read: Store2Read, request: CommitRequest | StreamedCommitRequest, call: number) => Promise<CommitResult>) {
    const real = page.k.committer
    const calls: number[] = []
    const wholeDelegate: Delegate = {
        readCommit: () => real.readCommit(),
        commit: (read, request) => real.commit(read, request as CommitRequest),
    }
    const streamedDelegate: Delegate = {
        readCommit: () => real.readCommit(),
        commit: (read, request) => real.commitStreamed!(read, request as StreamedCommitRequest),
    }
    page.useCommitter({
        ...real,
        commit: async (read, request) => {
            calls.push(calls.length + 1)
            return await commit(wholeDelegate, read, request, calls.length)
        },
        commitStreamed: async (read, request) => {
            calls.push(calls.length + 1)
            return await commit(streamedDelegate, read, request, calls.length)
        },
    })
    return calls
}

armed('the commit and its outcomes', () => {

    test('an unknown outcome is not claimed as nothing imported: told to reload, no reload made, the write lock stays closed', async () => {
        const page = await openPage()
        const calls = committingWith(page, async () => ({ status: 'unknown', cause: new page.errors.Store2UnknownOutcomeError('lost') }))
        const waits: string[] = []
        vi.mocked(page.alert.alertStore.set).mockImplementation((data) => { waits.push(String((data as { msg: string }).msg)) })

        await loadBin(page, golden('upstream-full.bin'))

        expect(calls).toHaveLength(1)
        expect(waits).toEqual([language.store2ImportUnconfirmed])
        expect(page.reloads.count).toBe(0)
        expect(await writeLockIsFree(page)).toBe(false)
        expect(page.busy.isBusy()).toBe(false)
    })

    test('a conflict is answered by one rebuild and a fresh read, which lands', async () => {
        const page = await openPage()
        const reads: number[] = []
        const calls = committingWith(page, async (real, read, request, call) => {
            if (call === 1) {
                return { status: 'conflict', current: read }
            }
            reads.push(call)
            return await real.commit(await real.readCommit(), request)
        })

        await loadBin(page, golden('upstream-full.bin'))

        expect(calls).toHaveLength(2)
        expect(page.reloads.count).toBe(1)
        expect((await page.k.commitKey()).retained).toHaveLength(1)
    })

    // The committer is a double (conflict, then the real commit); the import, the resolve and the question's signature are real.
    test('reproducer: a conflict does not repeat the question about a plugin storage entry that is not JSON', async () => {
        const page = await openPage()
        const pointer = '00000000-0000-4000-8000-0000000000a1'
        const index = { type: 'risu-plugin-storage-index', version: 1, entries: [{ k: 'badKey', s: '{not json' }], trash: [] }
        const source = makeDb('indexed', ['alpha'])
        source.pluginCustomStorage = { _coldpluginIndex: pointer }
        const bytes = binOf(
            binEntry('database.risudat', await blockFileBytes(page, source)),
            binEntry(`coldstorage_${pointer}.json`, new TextEncoder().encode(JSON.stringify(index))),
        )
        const calls = committingWith(page, async (real, read, request, call) => {
            if (call === 1) {
                return { status: 'conflict', current: read }
            }
            return await real.commit(await real.readCommit(), request)
        })

        await loadBin(page, bytes)

        expect(calls).toHaveLength(2)
        expect(confirmTexts(page)).toHaveLength(1)
        expect(confirmTexts(page)[0]).toContain('badKey')
        expect(page.reloads.count).toBe(1)
    })

    // New behaviour, pinned by mutants: the retry is one. A conflict that keeps coming ends unconfirmed, never in a loop.
    test('a conflict that repeats is retried once and then unconfirmed', async () => {
        const page = await openPage()
        const calls = committingWith(page, async (_real, read) => ({ status: 'conflict', current: read }))
        const waits: string[] = []
        vi.mocked(page.alert.alertStore.set).mockImplementation((data) => { waits.push(String((data as { msg: string }).msg)) })

        await loadBin(page, golden('upstream-full.bin'))

        expect(calls).toHaveLength(2)
        expect(waits).toEqual([language.store2ImportUnconfirmed])
        expect(page.reloads.count).toBe(0)
        expect(await writeLockIsFree(page)).toBe(false)
    })

    // Regression reproducer (red before the retry: one commit call and the refusal text): another writer dropped the base the
    // content index was read from, so the import is rebuilt once over a fresh read without a word.
    test('a base-unnamed refusal is answered by one quiet rebuild, which lands', async () => {
        const page = await openPage()
        const calls = committingWith(page, async (real, read, request, call) => {
            if (call === 1) {
                return { status: 'refused', reason: 'base-unnamed', detail: 'The commit key no longer names the base.' }
            }
            return await real.commit(await real.readCommit(), request)
        })

        await loadBin(page, golden('upstream-full.bin'))

        expect(calls).toHaveLength(2)
        expect(page.reloads.count).toBe(1)
        expect(alertErrorTexts(page)).toEqual([])
    })

    // Regression reproducer (red before the retry: one call): the retry is one, from the conflict's budget; the second
    // refusal shows the library refusal and the page reloads nothing.
    test('a base-unnamed refusal that repeats is retried once and then shown as the library refusal', async () => {
        const page = await openPage()
        const calls = committingWith(page, async () => ({ status: 'refused', reason: 'base-unnamed', detail: 'again' }))

        await loadBin(page, golden('upstream-full.bin'))

        expect(calls).toHaveLength(2)
        expect(alertErrorTexts(page)).toEqual([language.store2ImportRefused])
        expect(page.reloads.count).toBe(0)
        expect(await writeLockIsFree(page)).toBe(true)
    })

    test('a conflict and then a base-unnamed refusal share one budget: two commits, then the library refusal', async () => {
        const page = await openPage()
        const calls = committingWith(page, async (_real, read, _request, call) => call === 1
            ? { status: 'conflict', current: read }
            : { status: 'refused', reason: 'base-unnamed', detail: 'after the conflict' })

        await loadBin(page, golden('upstream-full.bin'))

        expect(calls).toHaveLength(2)
        expect(alertErrorTexts(page)).toEqual([language.store2ImportRefused])
        expect(page.reloads.count).toBe(0)
    })

    // A refusal after the bulk marker whose own-marker clear did not succeed is not retried: the rebuild would meet this
    // page's own marker.
    test.each([
        ['the clear failed', { status: 'failed', cause: new Error('disk') }],
        ['the clear is unknown', null],
    ] as const)('a base-unnamed refusal whose marker may still stand is not retried (%s)', async (_name, cleared) => {
        const page = await openPage()
        const calls = committingWith(page, async () => ({ status: 'refused', reason: 'base-unnamed', detail: 'marker', cleared } as unknown as CommitResult))

        await loadBin(page, golden('upstream-full.bin'))

        expect(calls).toHaveLength(1)
        expect(alertErrorTexts(page)).toEqual([language.store2ImportRefused])
    })

    test('a base-unnamed refusal whose marker is gone (nothing stood to clear) is retried', async () => {
        const page = await openPage()
        const calls = committingWith(page, async (real, _read, request, call) => call === 1
            ? { status: 'refused', reason: 'base-unnamed', detail: 'marker', cleared: { status: 'nothing' } } as unknown as CommitResult
            : await real.commit(await real.readCommit(), request))

        await loadBin(page, golden('upstream-full.bin'))

        expect(calls).toHaveLength(2)
        expect(page.reloads.count).toBe(1)
    })

    test('a landed import the device did not confirm is told to the person and reloads once', async () => {
        const page = await openPage()
        committingWith(page, async (real, read, request) => {
            const result = await real.commit(read, request)
            return result.status === 'committed' ? { ...result, flushed: false } : result
        })

        await loadBin(page, golden('upstream-full.bin'))

        expect(page.alert.alertNormalWait).toHaveBeenCalledWith(language.store2ImportNotFlushed)
        expect(page.reloads.count).toBe(1)
        expect(await writeLockIsFree(page)).toBe(false)
    })

    test.each([
        ['an abandoned bulk commit', { status: 'abandoned', reason: 'upload-failed', cleared: null }, language.store2ImportAbandoned],
        ['a commit key written by a newer version', { status: 'refused', reason: 'too-new', detail: 'newer' }, language.store2ImportTooNew],
        ['a commit key that cannot be used', { status: 'refused', reason: 'no-current', detail: 'none' }, language.store2ImportRefused],
        ['a failed write', { status: 'failed', cause: new Error('disk') }, language.internalBackupWriteFailed],
    ] as const)('%s: says nothing was imported, reloads nothing and frees the write lock', async (_name, result, text) => {
        const page = await openPage()
        committingWith(page, async () => result as unknown as CommitResult)

        await loadBin(page, golden('upstream-full.bin'))

        expect(alertErrorTexts(page)).toContain(text)
        expect(page.reloads.count).toBe(0)
        expect(await writeLockIsFree(page)).toBe(true)
        expect(page.busy.isBusy()).toBe(false)
    })
})

armed('re-importing one file reuses what the page already stores', () => {
    // Regression reproducer: before the content index every unit of the second load was written again under a new key.
    test('the second load of the same .bin adds no unit whose content is already stored', async () => {
        const page = await openPage()
        const bytes = golden('upstream-full.bin')
        // The first import is made through the library over the page's store: a landed page import keeps the write lock closed for its reload.
        const first = await loadGolden('upstream-full.bin')
        const landed = await importLegacyTree(
            { source: { tree: first.tree }, reader: readerOver(first.units), committer: page.k.committer, backend: page.k.memory, lists: createListDerivation() },
            { async confirmIncomplete() { return true } },
        )
        expect(landed.status).toBe('committed')
        const stored = page.k.memory.snapshot()
        // What the current tree names: a unit only an older manifest names is not a candidate.
        const known = new Set((await readBaseContentIndex(page.k.memory, await page.k.memory.readCommit())).units.keys())
        const keep = new Set<number>([UNIT_TYPE.manifest, UNIT_TYPE.shard, UNIT_TYPE.order])

        await loadBin(page, bytes)

        const after = page.k.memory.snapshot()
        const duplicates = [...after.entries()]
            .filter(([key]) => !stored.has(key))
            .filter(([, unit]) => {
                const frame = decodeFrame(unit)
                return frame.status === 'ok' && !keep.has(frame.type) && known.has(unitDigest(unit))
            })
            .map(([key]) => key)
        expect(duplicates).toEqual([])
        expect(page.reloads.count).toBe(1)
        expect(alertErrorTexts(page)).toEqual([])
    })
})

armed('the write lock is taken before the commit key is read (no Web Locks)', () => {
    // New behaviour, pinned by mutants: on a page that took no tab hold, the write lock comes before the fresh commit-key
    // read, the unsaved-edits check and the build, so the loop cannot commit between the read and the commit.
    test('while another holder has the write lock the import has read the commit key no more than before the copy', async () => {
        const page = await openPage({ webLocks: false })
        const real = page.k.committer
        let reads = 0
        page.useCommitter({ ...real, readCommit: async () => { reads++; return await real.readCommit() } })
        const release = await page.w.api.dbWriteLock.acquire()

        const running = loadBin(page, golden('upstream-full.bin'))
        await until(() => page.w.store.peek('assets/golden-avatar.png') !== null, 'the assets to be copied')
        await sleepReal(150)
        const readsWhileHeld = reads
        expect(page.reloads.count).toBe(0)
        expect(await currentKey(page)).toBe(page.k.seeded.manifestKey)
        release()
        await running

        expect(readsWhileHeld, 'only the up-front check read the commit key').toBe(1)
        expect(reads).toBeGreaterThan(readsWhileHeld)
        expect(page.reloads.count).toBe(1)
    })
})

armed('a bulk marker this page load left behind', () => {
    /** More characters than one ordinary commit can carry, so the import is a bulk commit. */
    async function bulkBackup(page: Page): Promise<Uint8Array> {
        const names = Array.from({ length: 70 }, (_, index) => `bulk-${index}`)
        return binOf(binEntry('golden-avatar.png', AVATAR), binEntry('database.risudat', await blockFileBytes(page, makeDb('bulk', names))))
    }

    function standingMarker(page: Page, owner: string) {
        return async () => {
            const parsed = classifyCommitRead(await page.k.counted.backend.readCommit())
            if (parsed.status !== 'parsed') {
                throw new Error('the commit key did not parse')
            }
            const marker = { owner, prefix: 'store2/g-0000000000000000-', startedAt: 5, label: 'bulk' } as const
            page.k.memory.poke(COMMIT_KEY, encodeUnit(UNIT_TYPE.commit, { ...parsed.value, staging: marker }))
        }
    }

    test('a bulk import lands', async () => {
        const page = await openPage()
        const before = await currentKey(page) as string

        await loadBin(page, await bulkBackup(page))

        const key = await page.k.commitKey()
        expect(key.current?.key).not.toBe(before)
        expect(key.retained[0].key).toBe(before)
        expect(key.staging).toBeNull()
        expect((await databaseOf(page, key.current?.key as string)).characters).toHaveLength(70)
    })

    // New behaviour, pinned by mutants: a marker this page load set and could not clear would refuse every bulk; the import clears it once and goes on.
    test('the import clears its own stale marker once and lands', async () => {
        const page = await openPage()
        const before = await currentKey(page) as string
        await standingMarker(page, page.k.committer.owner)()

        await loadBin(page, await bulkBackup(page))

        const key = await page.k.commitKey()
        expect(alertErrorTexts(page)).toEqual([])
        expect(key.current?.key).not.toBe(before)
        expect(key.staging).toBeNull()
        expect(page.reloads.count).toBe(1)
    })
})

describe('unit: hasDatabaseEntry answers presence only', () => {
    function entryAt(headerOffset: number, nameLength: number): { headerOffset: number, nameLength: number, dataLength: number, headerLength: number } {
        return { headerOffset, nameLength, dataLength: 1, headerLength: 8 + nameLength }
    }

    test('finds the database among kept names and ignores the others', async () => {
        const { hasDatabaseEntry } = await import('src/ts/drive/storeImport')
        const entries = [entryAt(0, 9), entryAt(30, 16)]
        expect(hasDatabaseEntry(entries, new Map([[0, 'first.png'], [30, 'database.risudat']]))).toBe(true)
        expect(hasDatabaseEntry(entries, new Map([[0, 'first.png'], [30, 'other.risudat']]))).toBe(false)
        expect(hasDatabaseEntry([], new Map())).toBe(false)
    })

    test('never throws: an entry without a kept name is skipped, and a name over 64 bytes is not looked at', async () => {
        const { hasDatabaseEntry } = await import('src/ts/drive/storeImport')
        const entries = [entryAt(0, 9), entryAt(30, 100), entryAt(200, 16)]
        expect(hasDatabaseEntry(entries, new Map())).toBe(false)
        expect(hasDatabaseEntry(entries, new Map([[30, 'database.risudat']]))).toBe(false)
        expect(hasDatabaseEntry(entries, new Map([[200, 'database.risudat']]))).toBe(true)
    })
})

armed('Gate 2 pins', () => {
    // New behaviour, pinned by mutants: only this page load's own marker is cleared. A foreign marker that appears after
    // the up-front check (so the clear path really runs) is refused and left standing, after a single commit attempt.
    test('a foreign marker that appears after the up-front check is refused and never cleared', async () => {
        const page = await openPage()
        const before = await currentKey(page) as string
        const names = Array.from({ length: 70 }, (_, index) => `bulk-${index}`)
        const bytes = binOf(binEntry('golden-avatar.png', AVATAR), binEntry('database.risudat', await blockFileBytes(page, makeDb('bulk', names))))
        const foreign = 'q'.repeat(26)
        const calls = committingWith(page, async (real, _read, request, call) => {
            if (call === 1) {
                const parsed = classifyCommitRead(await page.k.counted.backend.readCommit())
                if (parsed.status !== 'parsed') {
                    throw new Error('the commit key did not parse')
                }
                page.k.memory.poke(COMMIT_KEY, encodeUnit(UNIT_TYPE.commit, { ...parsed.value, staging: { owner: foreign, prefix: 'store2/g-0000000000000000-', startedAt: 5, label: 'bulk' } }))
            }
            return await real.commit(await real.readCommit(), request)
        })

        await loadBin(page, bytes)

        const key = await page.k.commitKey()
        expect(alertErrorTexts(page)).toContain(language.store2RestoreBulkMarker)
        expect(key.current?.key).toBe(before)
        expect(key.staging?.owner).toBe(foreign)
        expect(calls).toHaveLength(1)
        expect(page.reloads.count).toBe(0)
        expect(await writeLockIsFree(page)).toBe(true)
    })

    // New behaviour, pinned by mutants (C4): with no tab hold the order is the write lock, then the unsaved-edits check,
    // then the fresh read and the build; an edit made while the import waits for the lock is asked about.
    test('without Web Locks an edit made while the import waits for the write lock is asked about', async () => {
        const page = await openPage({ webLocks: false })
        const release = await page.w.api.dbWriteLock.acquire()

        const running = loadBin(page, golden('upstream-full.bin'))
        await until(() => page.w.store.peek('assets/golden-avatar.png') !== null, 'the assets to be copied')
        await sleepReal(150)
        page.db.mainPrompt = 'late edit'
        page.flush()
        await sleepReal(50)
        release()
        await running

        expect(confirmTexts(page)).toContain(language.store2RestoreUnsavedConfirm)
        expect(page.alert.alertConfirm).toHaveBeenCalledWith(language.store2RestoreUnsavedConfirm, { ownScheme: 'saveGuard' })
    })
})

// ---- the order of the entries in the file ----

/** The content a store2 import hydrates from the cold units: every chat message text and the cold-backed plugin value. */
function coldOutcome(db: Database): { names: string[], texts: string[], plugin: unknown } {
    const characters = db.characters as unknown as { chats?: { message: { data: string }[] }[] }[]
    const texts = characters.flatMap((character) => (character.chats ?? []).flatMap((chat) => chat.message.map((message) => message.data)))
    return { names: namesOf(db), texts: texts.sort(), plugin: db.pluginCustomStorage['00000000-0000-4000-8000-0000000000a4'] }
}

/** What importing upstream-full.bin lands, whatever the order of its entries. */
async function fullOutcome(): Promise<{ names: string[], texts: string[], plugin: unknown }> {
    return { names: namesOf((await loadGolden('upstream-full.bin')).tree), texts: ['archived blob chat', 'archived error-text chat', 'archived inline chat', 'blob hello', 'inline hello'], plugin: ['dark', 3] }
}

/** Splits a `.bin` into its entries, each with its name and its own bytes. */
async function splitBin(bytes: Uint8Array): Promise<{ name: string, bytes: Uint8Array }[]> {
    const walk = await indexBackupEntries(new Blob([bytes as unknown as Uint8Array<ArrayBuffer>]))
    return walk.entries.map((entry) => ({
        name: new TextDecoder().decode(bytes.subarray(entry.headerOffset + 4, entry.headerOffset + 4 + entry.nameLength)),
        bytes: bytes.slice(entry.headerOffset, entry.headerOffset + entry.headerLength + entry.dataLength),
    }))
}

// Guards of the new contract (the walk's kept names, not runnable on the old reader): no writer of upstream or of this fork
// places the marker, the cold units and the database anywhere but the usual order, but a hand-made or future file may, and
// the import must carry the same content whatever the order. The character names, every chat message text (the cold-backed
// chats included) and the plugin value must equal the golden's. Each case is also run at windows so small that entries
// straddle edges.
for (const windowBytes of [undefined, 16] as const) armed(`the order of the entries does not change what a store2 import carries (windows: ${windowBytes})`, () => {
    /** Imports `entries` and returns what landed, after the import has finished cleanly. */
    async function landed(entries: Uint8Array[]): Promise<{ page: Page, database: Database }> {
        const page = await openPage()
        await useGoldenWindows(windowBytes)
        const before = await currentKey(page) as string
        await loadBin(page, binOf(...entries))
        const key = await page.k.commitKey()
        expect(key.current?.key).not.toBe(before)
        expect(page.w.store.peek('assets/golden-avatar.png')).not.toBeNull()
        expect(alertErrorTexts(page)).toEqual([])
        expect(confirmTexts(page)).toEqual([])
        expect(page.alert.alertWait).toHaveBeenCalledWith(language.store2ImportDone)
        return { page, database: await databaseOf(page, key.current?.key as string) }
    }

    test('the database first, then the cold units, then the asset', async () => {
        const split = await splitBin(golden('upstream-full.bin'))
        const database = split.filter((entry) => entry.name === 'database.risudat')
        const rest = split.filter((entry) => entry.name !== 'database.risudat')

        const { database: landedTree } = await landed([...database, ...rest.reverse()].map((entry) => entry.bytes))

        expect(coldOutcome(landedTree)).toEqual(await fullOutcome())
    })

    test('cold units interleaved with the asset, the database last', async () => {
        const split = await splitBin(golden('upstream-full.bin'))
        const asset = split.filter((entry) => entry.name === 'golden-avatar.png')
        const cold = split.filter((entry) => entry.name.startsWith('coldstorage_'))
        const database = split.filter((entry) => entry.name === 'database.risudat')
        expect(cold.length).toBeGreaterThan(1)

        const { database: landedTree } = await landed([cold[0], ...asset, ...cold.slice(1), ...database].map((entry) => entry.bytes))

        expect(coldOutcome(landedTree)).toEqual(await fullOutcome())
    })

    test('two database entries: the last one is the one imported', async () => {
        const split = await splitBin(golden('upstream-full.bin'))
        const other = (await splitBin(golden('upstream-missing-unit.bin'))).filter((entry) => entry.name === 'database.risudat')
        const { database: landedTree } = await landed([...other, ...split].map((entry) => entry.bytes))

        expect(namesOf((await loadGolden('upstream-missing-unit.bin')).tree)).not.toEqual(namesOf((await loadGolden('upstream-full.bin')).tree))
        expect(coldOutcome(landedTree)).toEqual(await fullOutcome())
    })

    test('a marker after the database refuses the import with nothing written', async () => {
        const page = await openPage()
        await useGoldenWindows(windowBytes)
        page.w.store.ops.length = 0

        await loadBin(page, binOf(golden('upstream-full.bin'), binEntry(BACKUP_ENCRYPTION_MARKER_NAME, new Uint8Array([1]))))

        expect(alertErrorTexts(page)).toContain(language.encryptedBackupRefused)
        expect(mutations(page)).toEqual([])
        expect(page.reloads.count).toBe(0)
    })

    test('a marker whose header is cut off at the end of the file refuses the import with nothing written', async () => {
        const page = await openPage()
        await useGoldenWindows(windowBytes)
        page.w.store.ops.length = 0
        const cutOff = binEntry(BACKUP_ENCRYPTION_MARKER_NAME, new Uint8Array(0)).slice(0, 4 + BACKUP_ENCRYPTION_MARKER_NAME.length + 2)

        await loadBin(page, binOf(golden('upstream-full.bin'), cutOff))

        expect(alertErrorTexts(page)).toContain(language.encryptedBackupRefused)
        expect(mutations(page)).toEqual([])
        expect(page.reloads.count).toBe(0)
    })
})

armed('a first-run restore completes first setup in the committed tree (store2 path)', () => {
    async function flaggedBin(page: Page, flag: boolean | undefined): Promise<Uint8Array> {
        const source = makeDb('backup', ['alpha'])
        if (flag !== undefined) {
            source.didFirstSetup = flag
        }
        return binOf(binEntry('golden-avatar.png', AVATAR), binEntry('database.risudat', await blockFileBytes(page, source)))
    }

    /** The picker restore with the first-run option. */
    async function loadBinAtFirstRun(page: Page, bytes: Uint8Array): Promise<void> {
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
            LoadLocalBackup(undefined, undefined, { completeFirstSetup: true })
            const chosen = input as HTMLInputElement | null
            if (chosen === null) {
                throw new Error('LoadLocalBackup did not create a file input')
            }
            Object.defineProperty(chosen, 'files', { value: [new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')], configurable: true })
            await (chosen.onchange as unknown as (event: Event) => Promise<void>).call(chosen, new Event('change'))
        } finally {
            spy.mockRestore()
        }
        await observeArm(page)
    }

    test.each([false, undefined] as const)('regression reproducer: a file whose flag is %s commits true when restored with the option', async (flag) => {
        const page = await openPage()

        await loadBinAtFirstRun(page, await flaggedBin(page, flag))

        expect(page.reloads.count).toBe(1)
        expect(alertErrorTexts(page)).toEqual([])
        expect((await databaseOf(page, await currentKey(page) as string)).didFirstSetup).toBe(true)
    })

    test.each([false, undefined] as const)('guard: the same file (flag %s) restored without the option keeps the file\'s own value', async (flag) => {
        const page = await openPage()

        await loadBin(page, await flaggedBin(page, flag))

        expect(page.reloads.count).toBe(1)
        expect((await databaseOf(page, await currentKey(page) as string)).didFirstSetup).toBe(flag)
    })

    test('a conflict on the first attempt still commits the mark on the second', async () => {
        const page = await openPage()
        const calls = committingWith(page, async (real, read, request, call) => {
            if (call === 1) {
                return { status: 'conflict', current: read }
            }
            return await real.commit(await real.readCommit(), request)
        })

        await loadBinAtFirstRun(page, await flaggedBin(page, false))

        expect(calls).toHaveLength(2)
        expect(page.reloads.count).toBe(1)
        expect((await databaseOf(page, await currentKey(page) as string)).didFirstSetup).toBe(true)
    })
})

armed('a database whose botPresetsId names no preset', () => {
    // Both prepares repair the root through the one shared step, so the working settings come back as an appended preset
    // and the id points at it, whichever path read the file.
    test('the working settings are appended as a preset and the id points at it', async () => {
        const page = await openPage()
        const source = makeDb('backup', ['alpha'])
        source.botPresetsId = 9
        const presetsInFile = (source.botPresets as unknown[]).length

        // The entry is upstream's legacy msgpack, as the real producer writes it; the block encoder would not keep the dangling id.
        await loadBin(page, binOf(binEntry('golden-avatar.png', AVATAR), binEntry('database.risudat', await page.w.risuSave.encodeRisuSaveLegacy(source, 'compression'))))

        const stored = await databaseOf(page, await currentKey(page) as string)
        expect(stored.botPresets).toHaveLength(presetsInFile + 1)
        expect(stored.botPresetsId).toBe(presetsInFile)
        expect((stored.botPresets[presetsInFile] as { name: string }).name).toBe('New Preset')
        expect(alertErrorTexts(page)).toEqual([])
        expect(page.reloads.count).toBe(1)
    })
})

armed('a .bin whose database has no archive key, restored in the app, is told once over two boots', () => {
    // Compatibility guard (passes with or without the boot notice queue): the import and the restore write no
    // `archiveCharacters`, so the next boot, a reload in a fresh module graph over the same store, still finds it absent,
    // raises `archive-enabled` once and sets the key in memory; the first pass it commits saves the key, and the boot after
    // that raises none.
    // Both producers' database entries: upstream's legacy msgpack, and this fork's block format.
    test.each(['legacy', 'block'] as const)('guard: the restored tree (%s entry) has no key, the next boot raises archive-enabled once, and after its first pass the boot after raises none', async (format) => {
        const page = await openPage()
        const source = makeDb('backup', ['alpha'])
        expect(Object.hasOwn(source, 'archiveCharacters'), 'the file\'s database carries no archive key').toBe(false)
        const entry = format === 'legacy' ? await page.w.risuSave.encodeRisuSaveLegacy(source, 'compression') : await blockFileBytes(page, source)

        await loadBin(page, binOf(binEntry('golden-avatar.png', AVATAR), binEntry('database.risudat', entry)))

        expect(page.reloads.count).toBe(1)
        expect(alertErrorTexts(page)).toEqual([])
        const stored = await databaseOf(page, await currentKey(page) as string)
        expect(namesOf(stored)).toEqual(['alpha'])
        expect(stored.archiveCharacters, 'the import wrote no key').toBeUndefined()

        // The reload: the page that imported is done, and the next one is a fresh module graph over the same store.
        worlds.parkAll()
        vi.resetModules()
        const first = await bootThroughDispatch(page.k.counted.backend, { kind: 'tauri' })
        expect(first.result.kind).toBe('store2')
        expect(first.notices.filter((notice) => notice.name === 'archive-enabled')).toHaveLength(1)
        await commitActivePass((first.result as Extract<typeof first.result, { kind: 'store2' }>).database, [])
        expect((await databaseOf(page, await currentKey(page) as string)).archiveCharacters, 'the first pass saved the key').toBe(true)

        vi.resetModules()
        const second = await bootThroughDispatch(page.k.counted.backend, { kind: 'tauri' })
        expect(second.result.kind).toBe('store2')
        expect(second.notices.filter((notice) => notice.name === 'archive-enabled')).toEqual([])
        expect((second.result as Extract<typeof second.result, { kind: 'store2' }>).database.archiveCharacters).toBe(true)
    })
})

// The arm tests above ran first (one file, tests in order): what each import showed in the two arms must be equal.
describe('the whole arm and the stream arm agree', () => {
    test('every import showed the same confirmations, error texts, waits, reload count and read-back tree in both arms', () => {
        const compared: string[] = []
        for (const [name, arms] of observed) {
            if (arms.whole === undefined || arms.stream === undefined) {
                continue
            }
            compared.push(name)
            expect(arms.whole.verdicts.filter((verdict) => verdict === 'stream'), `${name}: the whole arm streamed`).toEqual([])
            expect(arms.stream.verdicts.filter((verdict) => verdict === 'whole'), `${name}: the stream arm fell back to the whole path`).toEqual([])
            expect(arms.stream.view, name).toEqual(arms.whole.view)
        }
        expect(compared.length).toBeGreaterThan(0)
        expect([...observed.values()].some((arms) => arms.stream?.verdicts.includes('stream')), 'no import took the streamed path').toBe(true)
    })
})
