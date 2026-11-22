/**
 * Utility workspaces over the `.bin` import of a store2 page (#202 S1a-2): a `.bin` carries no workspace (the export leaves
 * them out), so the profile keeps the page's own `utilityWorkspaces`, by value and as they are now with every text, and drops
 * whatever the file's database entry carries under that key, so a hand-edited or future `.bin` can never become type 28 and
 * 29 units. A boot import has no page and installs none.
 *
 * Runs over the real, unmocked `saveDb()` store2 loop in a world of its own (`saveLoopWorld.ts`, `store2SaveKit.ts`) against
 * an in-memory store2 backend and a fake Web Locks manager, as `storeImportThemePacks.svelte.test.ts` does, through the real
 * `LoadLocalBackup()`. A mocked success here is not evidence of native backend behaviour.
 *
 * Titles: `R` fails when the carry or the drop is absent; `G` passes before and after.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import { assembleDatabase } from 'src/ts/storage/store2/codec'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import type { Manifest } from 'src/ts/storage/store2/format'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Committer } from 'src/ts/storage/store2/commit'
import type { Database } from 'src/ts/storage/database.svelte'
import * as kitCommit from 'src/ts/storage/store2/commit'

vi.setConfig({ testTimeout: 60_000 })

type ImportStreamModule = typeof import('src/ts/storage/store2/legacy/importStream')

/** The arm the running test is in, and what the streamed prepare decided in it (`onPrepared`, once per attempt that reached it). */
const armBox = vi.hoisted(() => ({ arm: 'whole' as 'whole' | 'stream', verdicts: [] as string[] }))

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
    armBox.verdicts = []
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
    worlds.parkAll()
    vi.doMock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }))
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
}

async function openPage(): Promise<Page> {
    const locks = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(locks, 'this'), configurable: true })
    h.db = makeDb('base', ['alpha', 'beta'])
    const k = await startStore2({ db: h.db as unknown as Database })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    const { flushSync } = await import('svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    const bootActive = await import('src/ts/storage/store2/bootActive')
    const page: Page = { w, k, db: h.db, flush: flushSync, alert: await import('src/ts/alert') }
    bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer: k.committer as Committer } as unknown as Store2Session)
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

async function currentTree(page: Page): Promise<{ manifest: Manifest, stored: Entry }> {
    const key = (await page.k.commitKey()).current?.key as string
    const read = await readTreeBytes(page.k.memory, key)
    if (read.status !== 'ok') {
        throw new Error(`The stored tree reads ${read.status}.`)
    }
    return { manifest: read.tree.manifest, stored: assembleDatabase(read.tree.manifest, read.tree.source) as unknown as Entry }
}

// ---- .bin construction ----

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

async function blockFileBytes(page: Page, db: Entry): Promise<Uint8Array> {
    const encoder = new page.w.encoderFixture.RisuSaveEncoder()
    await encoder.init(db as unknown as Database, { compression: false })
    await encoder.set(db as unknown as Database, { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false })
    return new Uint8Array(encoder.encode()!)
}

const AVATAR = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

/** Drives the real `LoadLocalBackup()` with `bytes` as the chosen file and awaits its change handler. */
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

// ---- fixtures ----

function file(id: string, path: string, text: string, extra: Entry = {}): Entry {
    return { id, path, text, size: new TextEncoder().encode(text).length, mtime: 5, ...extra }
}

/** The page's workspaces: an unknown key on a record and on a file, and a text with a newline and non-ASCII characters. */
function pageWorkspaces(): Entry[] {
    return [
        { id: 'page-w1', name: 'Page workspace', createdAt: 1000, futureWs: { n: [1] }, files: [file('pf1', 'AGENTS.md', 'rules\n한국어'), file('pf2', 'notes/a.md', 'note', { futureFile: true })] },
        { id: 'page-w2', name: 'Second', createdAt: 2000, files: [file('pf3', 'x.txt', 'ex')] },
    ]
}

/** The file's own list, in a `.bin` database entry. */
function fileWorkspaces(): Entry[] {
    return [{ id: 'file-w1', name: 'FROM-FILE', createdAt: 3000, files: [file('ff1', 'AGENTS.md', 'FROM-FILE-TEXT')] }]
}

/** A `.bin` whose database entry is a block-format save of a profile holding `fileFields`. */
async function binWith(page: Page, fileFields: Entry): Promise<Uint8Array> {
    const source = { ...makeDb('backup', ['alpha']), ...fileFields } as Entry
    return binOf(binEntry('golden-avatar.png', AVATAR), binEntry('database.risudat', await blockFileBytes(page, source)))
}

async function pageHolds(page: Page, fields: Entry): Promise<void> {
    await nextCommit(page.w, () => {
        Object.assign(page.db, fields)
        page.flush()
    })
}

for (const arm of ['whole', 'stream'] as const) describe(`utility workspaces over the .bin import of a store2 page (${arm} arm)`, () => {
    beforeEach(() => { armBox.arm = arm })
    afterEach(() => {
        // The arm really ran: the stream arm took the streamed prepare, the whole arm never did.
        const streamed = armBox.verdicts.includes('stream')
        expect(streamed).toBe(arm === 'stream')
    })

    test('T7 R: the page\'s workspaces are kept by value with every key and text; the file\'s own are dropped', async () => {
        const page = await openPage()
        await pageHolds(page, { utilityWorkspaces: pageWorkspaces() })

        await loadBin(await binWith(page, { utilityWorkspaces: fileWorkspaces() }))

        const { manifest, stored } = await currentTree(page)
        expect(stored.mainPrompt).toBe('backup')
        expect(stored.utilityWorkspaces).toEqual(pageWorkspaces())
        expect(JSON.stringify(stored)).not.toContain('FROM-FILE')
        expect(manifest.fixed.workspaces).toHaveLength(2)
        expect(manifest.req).toContain('utility-workspaces')
    })

    test('T7 R: with no workspaces on the page, the file\'s own list creates no unit, no field and no token', async () => {
        const page = await openPage()

        await loadBin(await binWith(page, { utilityWorkspaces: fileWorkspaces() }))

        const { manifest, stored } = await currentTree(page)
        expect(stored.mainPrompt).toBe('backup')
        expect(Object.hasOwn(stored, 'utilityWorkspaces')).toBe(false)
        expect(Object.hasOwn(manifest.fixed, 'workspaces')).toBe(false)
        expect(manifest.req).not.toContain('utility-workspaces')
        expect(JSON.stringify(stored)).not.toContain('FROM-FILE')
    })

    test('T7 G: a page with workspaces and a file with none keeps the page\'s', async () => {
        const page = await openPage()
        await pageHolds(page, { utilityWorkspaces: pageWorkspaces() })

        await loadBin(await binWith(page, {}))

        const { stored } = await currentTree(page)
        expect(stored.mainPrompt).toBe('backup')
        expect(stored.utilityWorkspaces).toEqual(pageWorkspaces())
    })

    test('T7 G: a page with none and a file with none leaves the profile without the key', async () => {
        const page = await openPage()

        await loadBin(await binWith(page, {}))

        const { manifest, stored } = await currentTree(page)
        expect(Object.hasOwn(stored, 'utilityWorkspaces')).toBe(false)
        expect(manifest.req).not.toContain('utility-workspaces')
    })
})
