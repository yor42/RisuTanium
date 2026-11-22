/**
 * The unsent message edits and hint flags (`chatDrafts`, store2 kind 30) over the `.bin` import of a store2 page: a `.bin`
 * carries none (the export leaves them out), so the profile keeps the page's own entries by value (MC-3590) and drops whatever
 * key the file's database entry carries. A page without entries gives the imported profile no field, no unit and no req token,
 * even when the file names one. The import keeps what the page holds as of the import, an unsaved entry included.
 *
 * Runs over the real, unmocked `saveDb()` store2 loop in a world of its own, as `storeImportChroMemory.svelte.test.ts` does, in
 * the whole and the stream arm (the stream arm is the path large files take). A mocked success here is not evidence of native
 * backend behaviour.
 *
 * Titles: `reproducer` fails when the keep or the drop is absent; `guard` passes before and after.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import { assembleDatabase } from 'src/ts/storage/store2/codec'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Committer } from 'src/ts/storage/store2/commit'
import type { Database } from 'src/ts/storage/database.svelte'
import * as kitCommit from 'src/ts/storage/store2/commit'

vi.setConfig({ testTimeout: 60_000 })

type ImportStreamModule = typeof import('src/ts/storage/store2/legacy/importStream')
type Arm = 'whole' | 'stream'

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
    // A streamed commit always runs under a bulk marker and fails with the kit's `Store2BulkAbortError`, which the import
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

async function currentKey(page: Page): Promise<string | undefined> {
    return (await page.k.commitKey()).current?.key
}

async function storedDatabase(page: Page): Promise<Entry> {
    const read = await readTreeBytes(page.k.memory, (await currentKey(page)) as string)
    if (read.status !== 'ok') {
        throw new Error(`The stored tree reads ${read.status}.`)
    }
    return assembleDatabase(read.tree.manifest, read.tree.source) as unknown as Entry
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
}

// ---- fixtures ----

const PAGE_DRAFTS: Entry[] = [
    { cha: 'char-a', chat: 'chat-1', shown: true, drafts: [{ m: 'id:msg-1', text: 'page edit', bh: '00112233445566778899aabbccddeeff', at: 1_700_000_000_000, future: { deep: [1] } }], note: 'extra' },
    { cha: 'char-b', chat: 'chat-9', drafts: [{ m: 'idx:2', text: 'second page edit', bh: 'ffeeddccbbaa99887766554433221100', at: 1_700_000_000_500 }] },
]
const FILE_DRAFTS: Entry[] = [
    { cha: 'char-z', chat: 'chat-0', drafts: [{ m: 'id:other', text: 'file edit', bh: '0123456789abcdef0123456789abcdef', at: 1_600_000_000_000 }] },
]

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

async function storedManifest(page: Page): Promise<{ fixed: Entry, req: string[] }> {
    const read = await readTreeBytes(page.k.memory, (await currentKey(page)) as string)
    if (read.status !== 'ok') {
        throw new Error(`The stored tree reads ${read.status}.`)
    }
    return read.tree.manifest as unknown as { fixed: Entry, req: string[] }
}

for (const arm of ['whole', 'stream'] as const) describe(`Unsent message edits over the .bin import of a store2 page (${arm} arm)`, () => {
    beforeEach(() => { armBox.arm = arm })

    test('T2.5 reproducer: the page keeps its entries by value, extra keys included, and the file\'s other data still lands', async () => {
        const page = await openPage()
        await pageHolds(page, { chatDrafts: PAGE_DRAFTS })

        await loadBin(page, await binWith(page, {}))

        const stored = await storedDatabase(page)
        expect(stored.mainPrompt).toBe('backup')
        expect(stored.chatDrafts).toEqual(PAGE_DRAFTS)
        const manifest = await storedManifest(page)
        expect(manifest.fixed.chatDrafts).toBeDefined()
        expect(manifest.req).toContain('chat-drafts')
        if (arm === 'stream') {
            expect(armBox.verdicts.length).toBeGreaterThan(0)
            expect(armBox.verdicts).not.toContain('whole')
        }
    })

    test('T2.5 reproducer: the file\'s own entries do not survive, whatever the page holds', async () => {
        const page = await openPage()
        await pageHolds(page, { chatDrafts: PAGE_DRAFTS })

        await loadBin(page, await binWith(page, { chatDrafts: FILE_DRAFTS }))

        const stored = await storedDatabase(page)
        expect(stored.chatDrafts).toEqual(PAGE_DRAFTS)
    })

    test('T2.6 guard (passes before and after, the root drop is in resolveLegacyRoot): a page without entries drops the file\'s key, so no field, no unit and no req token follow', async () => {
        const page = await openPage()

        await loadBin(page, await binWith(page, { chatDrafts: FILE_DRAFTS }))

        const stored = await storedDatabase(page)
        expect(stored.mainPrompt).toBe('backup')
        expect(Object.hasOwn(stored, 'chatDrafts')).toBe(false)
        const manifest = await storedManifest(page)
        expect(Object.hasOwn(manifest.fixed, 'chatDrafts')).toBe(false)
        expect(manifest.req).not.toContain('chat-drafts')
    })

    test('T2.6 guard (passes before and after): a page and a file without entries import none', async () => {
        const page = await openPage()

        await loadBin(page, await binWith(page, {}))

        const stored = await storedDatabase(page)
        expect(Object.hasOwn(stored, 'chatDrafts')).toBe(false)
    })

    test('T2.5 guard (passes before and after; the unguarded read fails it): a page value that is not plain JSON is not imported and never stops the file\'s other data', async () => {
        const page = await openPage()
        Object.assign(page.db, { chatDrafts: [{ cha: 'char-a', chat: 'chat-1', drafts: [{ m: 'id:1', text: 'x', bh: '00112233445566778899aabbccddeeff', at: 1, big: 10n }] }] })

        await loadBin(page, await binWith(page, {}))

        const stored = await storedDatabase(page)
        expect(stored.mainPrompt).toBe('backup')
        expect(Object.hasOwn(stored, 'chatDrafts')).toBe(false)
    })

    test('T2.5 guard: the page\'s entries are copied, so a later edit of the page does not reach the import', async () => {
        const page = await openPage()
        await pageHolds(page, { chatDrafts: PAGE_DRAFTS })

        await loadBin(page, await binWith(page, {}))

        const stored = await storedDatabase(page)
        expect(stored.chatDrafts).toEqual(PAGE_DRAFTS)
        expect(stored.chatDrafts).not.toBe(page.db.chatDrafts)
    })

    test('T3.18: the import start writes a draft typed in the last idle window, so the profile keeps it', async () => {
        const page = await openPage()
        await pageHolds(page, { chatDrafts: PAGE_DRAFTS })
        await import('src/ts/chatDraftStore')
        const { draftContentOrphanGate } = await import('src/ts/draftContentOrphanGate')
        draftContentOrphanGate.set({ kind: 'msg', chatKey: 'window', chatId: 'msg-q', index: 0, persist: { chaId: 'char-q', chatId: 'chat-q' } }, 'typed just now', 'the saved text')

        await loadBin(page, await binWith(page, {}))

        const stored = await storedDatabase(page)
        const kept = (stored.chatDrafts as { cha: string, chat: string, drafts?: { text: string }[] }[]).find((entry) => entry.cha === 'char-q')
        expect(kept?.drafts?.[0].text).toBe('typed just now')
        expect((stored.chatDrafts as unknown[]).length).toBe(PAGE_DRAFTS.length + 1)
    })
})

describe('Unsent message edits over the import overlay', () => {
    async function overlay(database: Entry, chatDrafts?: Entry[]): Promise<Entry> {
        const { applyImportOverlay } = await import('src/ts/storage/store2/legacy/importTree')
        applyImportOverlay(database as unknown as Database, chatDrafts === undefined ? {} : { chatDrafts: chatDrafts as never })
        return database
    }

    test('T2.6 reproducer: the overlay deletes the tree\'s key when the request passes none, and an empty list sets none', async () => {
        expect(Object.hasOwn(await overlay({ chatDrafts: FILE_DRAFTS }), 'chatDrafts')).toBe(false)
        expect(Object.hasOwn(await overlay({ chatDrafts: FILE_DRAFTS }, []), 'chatDrafts')).toBe(false)
    })

    test('T2.5 reproducer: the overlay replaces the tree\'s key with a copy of the request\'s entries', async () => {
        const result = await overlay({ chatDrafts: FILE_DRAFTS }, PAGE_DRAFTS)

        expect(result.chatDrafts).toEqual(PAGE_DRAFTS)
        expect(result.chatDrafts).not.toBe(PAGE_DRAFTS)
        expect((result.chatDrafts as Entry[])[0]).not.toBe(PAGE_DRAFTS[0])
    })
})
