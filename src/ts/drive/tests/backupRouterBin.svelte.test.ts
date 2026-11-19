/**
 * The `.bin` side of the backup router (CHORE-128 S12c): `LoadPickedLocalBackup` and the Welcome entry
 * (`restoreFromBinFileAtFirstRun`, which goes through `loadBackupFromPicker`) over the real `.bin` restore of a store2
 * page. The files are the committed goldens, written by the real `SaveLocalBackup` (`fork-*`) or assembled in upstream's
 * shape (`upstream-*`). The router restoring exactly as the picker does, its busy refusal and its encrypted-backup refusal
 * are asserted in `storeImportPorts.svelte.test.ts` (T4-P10).
 *
 * Harness: the save-loop world of `storeImport.svelte.test.ts` (`saveLoopWorld.ts`, `store2SaveKit.ts`) over an in-memory
 * store2 backend and a fake Web Locks manager; what a restore leaves is read from the committed tree. A pass says nothing
 * about the Tauri or Node backends or a real browser's storage.
 *
 * Labels: every test is a compatibility guard of a new entry (no pre-fix base: main has no `LoadPickedLocalBackup`); each
 * names the scratch mutant it turns red on.
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
import { assembleDatabase } from 'src/ts/storage/store2/codec'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { toPlainJson } from 'src/ts/storage/store2/codec/normalize'
import * as kitCommit from 'src/ts/storage/store2/commit'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Database } from 'src/ts/storage/database.svelte'

vi.setConfig({ testTimeout: 60_000 })

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
    // The page's unit store is a double that holds nothing: every unit a restore needs is in the file.
    vi.doMock('src/ts/process/coldstorage.svelte', async () => ({
        getColdStorageItem: vi.fn(),
        getColdStorageBackupKey: (await import('src/ts/process/coldstorageData')).getColdStorageBackupKey,
        readColdStorageItem: async () => ({ status: 'missing' }),
        setColdStorageItem: vi.fn(async () => false),
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
    reloads: { count: number }
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
    const reloads = { count: 0 }
    const page: Page = { w, k, alert: await import('src/ts/alert'), reloads }
    bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer: k.committer } as unknown as Store2Session)
    w.pageMode.setPageStorageMode({ kind: 'store2' })
    vi.mocked(page.alert.alertConfirm).mockImplementation(async () => true)
    vi.spyOn(page.alert.alertStore, 'set').mockImplementation(() => { })
    vi.spyOn(window.location, 'reload').mockImplementation(() => { reloads.count++ })
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => { })
    w.start()
    await sleepReal(150)
    await settled(w)
    return page
}

const GOLDEN_DIR = path.resolve(process.cwd(), 'src/ts/drive/tests/binGoldens')
const golden = (name: string): Uint8Array<ArrayBuffer> => new Uint8Array(fs.readFileSync(path.join(GOLDEN_DIR, name)))

const alertErrorTexts = (page: Page): unknown[] => vi.mocked(page.alert.alertError).mock.calls.map((call) => call[0])
const confirmTexts = (page: Page): unknown[] => vi.mocked(page.alert.alertConfirm).mock.calls.map((call) => call[0])

async function committed(page: Page): Promise<Database> {
    const key = (await page.k.commitKey()).current?.key as string
    const read = await readTreeBytes(page.k.memory, key)
    if (read.status !== 'ok') {
        throw new Error(`The stored tree reads ${read.status}.`)
    }
    return assembleDatabase(read.tree.manifest, read.tree.source)
}

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

/** The committed tree as plain JSON with each uuid replaced by its order of first appearance. */
function normalized(db: Database): string {
    const seen = new Map<string, string>()
    return JSON.stringify(toPlainJson(db)).replace(UUID_PATTERN, (uuid) => {
        if (!seen.has(uuid)) {
            seen.set(uuid, `<uuid${seen.size}>`)
        }
        return seen.get(uuid) as string
    })
}

/** Starts a restore (which creates its file input at once or after its confirmations) and hands the input `chosen`. */
async function chooseFile(start: () => Promise<unknown>, chosen: File): Promise<unknown> {
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
        const pending = start()
        for (let turn = 0; turn < 200 && input === null; turn += 1) {
            await new Promise((resolve) => setTimeout(resolve, 0))
        }
        const created = input as HTMLInputElement | null
        if (created === null) {
            throw new Error('the restore never opened its picker')
        }
        Object.defineProperty(created, 'files', { value: [chosen], configurable: true })
        await (created.onchange as unknown as (event: Event) => Promise<void>).call(created, new Event('change'))
        return await pending
    } finally {
        spy.mockRestore()
    }
}

describe('R6b: LoadPickedLocalBackup on a fork .bin', () => {
    test('with the first-run option the committed database persists didFirstSetup = true, without it the file keeps its own value (guard; MR11)', async () => {
        const bytes = golden('fork-full.bin')

        // Each page imports the module again after its world started, so the restore runs in that world's graph.
        const plain = await openPage()
        const plainEnd = await (await import('src/ts/drive/backuplocal')).LoadPickedLocalBackup(new File([bytes], 'fork-full.bin'))
        const own = (await committed(plain)).didFirstSetup
        expect(plainEnd.outcome).toBe('committed')
        worlds.parkAll()

        const first = await openPage()
        const end = await (await import('src/ts/drive/backuplocal')).LoadPickedLocalBackup(new File([bytes], 'fork-full.bin'), { completeFirstSetup: true })

        expect((await committed(first)).didFirstSetup).toBe(true)
        expect(own).not.toBe(true)
        expect(end.target).toBe('fork-full.bin')
        expect(end.outcome).toBe('committed')
        expect(alertErrorTexts(first)).toEqual([])
    })
})

/** Starts the Welcome entry and waits for its picker, which opens only after the two confirmations. */
async function startWelcome(chosen: File | null): Promise<unknown> {
    const { restoreFromBinFileAtFirstRun } = await import('src/ts/drive/settingsRestore')
    if (chosen === null) {
        return await openWelcomePicker(restoreFromBinFileAtFirstRun)
    }
    return await chooseFile(restoreFromBinFileAtFirstRun, chosen)
}

/** The Welcome picker's input, left open: the entry's promise and the input it created. */
async function openWelcomePicker(entry: () => Promise<void>): Promise<{ entry: Promise<void>, input: HTMLInputElement }> {
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
        const started = entry()
        for (let turn = 0; turn < 200 && input === null; turn += 1) {
            await new Promise((resolve) => setTimeout(resolve, 0))
        }
        if (input === null) {
            throw new Error('the Welcome picker never opened')
        }
        return { entry: started, input }
    } finally {
        spy.mockRestore()
    }
}

describe('W3: the Welcome restore of a .bin goes through the router and restores as the direct first-run call does', () => {
    test('the Welcome picker takes the Settings accept rule (reproducer: the old Welcome picker accepted .bin only; M14)', async () => {
        await openPage()

        const opened = await startWelcome(null) as { entry: Promise<void>, input: HTMLInputElement }

        expect(opened.input.accept).toBe('.bin,.rtb,application/vnd.risutanium.rtb')
        opened.input.dispatchEvent(new Event('cancel'))
        await opened.entry
    })

    test.each(['fork-full.bin', 'upstream-kv.bin'])('%s: the same committed database and alerts as the direct first-run call, with didFirstSetup true (guard; M6, M9)', async (name) => {
        const bytes = golden(name)
        const direct = await openPage()
        const { LoadLocalBackup } = await import('src/ts/drive/backuplocal')
        const directEnd = await chooseFile(() => LoadLocalBackup(undefined, undefined, { completeFirstSetup: true }), new File([bytes], name)) as { outcome: string }
        const directDb = await committed(direct)
        const directTree = normalized(directDb)
        const directAlerts = [alertErrorTexts(direct), confirmTexts(direct)]
        expect(directDb.didFirstSetup).toBe(true)
        worlds.parkAll()

        const welcome = await openPage()
        await startWelcome(new File([bytes], name))

        const welcomeDb = await committed(welcome)
        expect(normalized(welcomeDb)).toBe(directTree)
        expect(welcomeDb.didFirstSetup).toBe(true)
        // The Welcome flow asks its own two confirmations first; the restore's own alerts are then the same.
        const confirms = confirmTexts(welcome)
        expect(confirms.slice(0, 2)).toEqual([language.backupLoadConfirm, language.backupLoadConfirm2])
        expect([alertErrorTexts(welcome), confirms.slice(2)]).toEqual(directAlerts)
        expect(directEnd.outcome).not.toBe('failed')
    })

    test('a cancel on the Welcome picker ends canceled with no restore run left and nothing written (guard)', async () => {
        const page = await openPage()
        const before = await page.k.commitKey()
        const keysBefore = [...page.k.memory.snapshot().keys()].sort()
        page.w.store.ops.length = 0

        const opened = await startWelcome(null) as { entry: Promise<void>, input: HTMLInputElement }
        opened.input.dispatchEvent(new Event('cancel'))
        await opened.entry

        const { restorePhase } = await import('src/ts/drive/restoreInProgress')
        expect(restorePhase()).toBe('none')
        expect(await page.k.commitKey()).toEqual(before)
        expect([...page.k.memory.snapshot().keys()].sort()).toEqual(keysBefore)
        expect(page.w.store.mutating()).toEqual([])
    })
})
