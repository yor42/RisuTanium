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
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import { language } from 'src/lang'
import { COMMIT_KEY } from 'src/ts/storage/store2/format/keys'
import { encodeUnit, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { assembleDatabase } from 'src/ts/storage/store2/codec'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import type { Committer, CommitResult } from 'src/ts/storage/store2/commit'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Database } from 'src/ts/storage/database.svelte'
import { BACKUP_ENCRYPTION_MARKER_NAME } from 'src/ts/drive/backupContainer'
import { loadGolden } from 'src/ts/storage/tests/store2/legacyFixtures'
import { breakDataChecksum } from 'src/ts/storage/tests/risuSaveBlockFile'

vi.setConfig({ testTimeout: 60_000 })

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
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(() => {
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
    const encoder = new page.w.risuSave.RisuSaveEncoder()
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
    void page
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

describe('the .bin import of a store2 page', () => {
    // Regression: on the base a store2 page copies the assets, fails every cold-storage write, and throws at the missing
    // block store, so nothing is installed.
    test('regression: upstream-full.bin becomes current and the pre-import manifest is the newest retained one', async () => {
        const page = await openPage()
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
    test('cold-storage entries are never written or attempted', async () => {
        const page = await openPage()

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

describe('preconditions are checked before the first asset is written', () => {
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

    test('a file with no database entry is refused before any asset is written', async () => {
        const page = await openPage()
        page.w.store.ops.length = 0

        await loadBin(page, binOf(binEntry('golden-avatar.png', AVATAR)))

        expect(alertErrorTexts(page)).toContain('Failed, Is file corrupted?')
        expect(mutations(page)).toEqual([])
    })

    // New behaviour, pinned by mutants: a large database is announced, naming its size, before it is decoded.
    test('a database entry over the size limit is announced before it is decoded, and a decline writes nothing', async () => {
        const page = await openPage()
        const megabytes = 17
        const bytes = binOf(binEntry('golden-avatar.png', AVATAR), binEntry('database.risudat', new Uint8Array(megabytes * 1024 * 1024)))
        vi.mocked(page.alert.alertConfirm).mockImplementation(async () => false)
        page.w.store.ops.length = 0

        await loadBin(page, bytes)

        expect(confirmTexts(page)).toEqual([language.store2ImportSizeWarning(megabytes)])
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

describe('the database is decoded and confirmed before the copy', () => {
    /** A block-format backup of three characters with its last block damaged: the intact blocks can be salvaged. */
    async function damagedBackup(page: Page): Promise<{ bytes: Uint8Array, lines: string[] }> {
        const source = makeDb('backup', ['alpha', 'beta', 'gamma'])
        const damaged = breakDataChecksum(await blockFileBytes(page, source), 'alpha')
        const salvaged = await page.w.risuSave.salvageRisuSave(damaged)
        const { describeOmitted } = await import('src/ts/storage/bootBlockLoad')
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

describe('busy work', () => {
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

describe('the commit and its outcomes', () => {
    /** The page's committer with `commit` replaced; the library calls it once per attempt. */
    function committingWith(page: Page, commit: (real: Committer, read: Parameters<Committer['commit']>[0], request: Parameters<Committer['commit']>[1], call: number) => Promise<CommitResult>) {
        const real = page.k.committer
        const calls: number[] = []
        page.useCommitter({
            ...real,
            commit: async (read, request) => {
                calls.push(calls.length + 1)
                return await commit(real, read, request, calls.length)
            },
        })
        return calls
    }

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
        const real = page.k.committer
        const calls = committingWith(page, async (_real, read, request, call) => {
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

describe('the write lock is taken before the commit key is read (no Web Locks)', () => {
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

describe('a bulk marker this page load left behind', () => {
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

describe('Gate 2 pins', () => {
    // New behaviour, pinned by mutants: only this page load's own marker is cleared. A foreign marker that appears after
    // the up-front check (so the clear path really runs) is refused and left standing, after a single commit attempt.
    test('a foreign marker that appears after the up-front check is refused and never cleared', async () => {
        const page = await openPage()
        const before = await currentKey(page) as string
        const names = Array.from({ length: 70 }, (_, index) => `bulk-${index}`)
        const bytes = binOf(binEntry('golden-avatar.png', AVATAR), binEntry('database.risudat', await blockFileBytes(page, makeDb('bulk', names))))
        const foreign = 'q'.repeat(26)
        const real = page.k.committer
        let calls = 0
        page.useCommitter({
            ...real,
            commit: async (_read, request) => {
                calls++
                if (calls === 1) {
                    const parsed = classifyCommitRead(await page.k.counted.backend.readCommit())
                    if (parsed.status !== 'parsed') {
                        throw new Error('the commit key did not parse')
                    }
                    page.k.memory.poke(COMMIT_KEY, encodeUnit(UNIT_TYPE.commit, { ...parsed.value, staging: { owner: foreign, prefix: 'store2/g-0000000000000000-', startedAt: 5, label: 'bulk' } }))
                }
                return await real.commit(await real.readCommit(), request)
            },
        })

        await loadBin(page, bytes)

        const key = await page.k.commitKey()
        expect(alertErrorTexts(page)).toContain(language.store2RestoreBulkMarker)
        expect(key.current?.key).toBe(before)
        expect(key.staging?.owner).toBe(foreign)
        expect(calls).toBe(1)
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
    })
})
