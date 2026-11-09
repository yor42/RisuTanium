/**
 * T-BIN1 (I6, AS11): Studio history never reaches the `.bin`. The real `SaveLocalBackup` runs on a store2 world
 * whose database holds one character. Control first: two exports of the untouched world are byte-identical, so
 * any later difference is the Studio's. Then a real edit session through the service and the IndexedDB adapter
 * (fake-indexeddb) changes the character, the export differs (so the equality below is not vacuous), and after
 * the session is undone the export is byte-identical to the untouched one while the Studio store holds the
 * session's records. Records for other owners written straight into the store change nothing either.
 *
 * The Studio adapter uses the page's own `indexedDB` here, the only database an export could enumerate; nothing in
 * the export path opens `risuStudio`, so a change that made it do so would put the stored records into the file.
 *
 * Harness: the save-loop world of `betaMobileGUIBinRoundTrip.svelte.test.ts` (in-memory store2 backend, fake Web
 * Locks for the profile). A pass says nothing about the Tauri or Node backends or a real browser's download.
 */
import 'fake-indexeddb/auto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Database } from 'src/ts/storage/database.svelte'
import { createFakeClock } from './historyTestKit.test-helpers'
import { createLocksWorld } from './studioLocksFake'
import { expectedOwnerKeys, storedRecord } from './studioStoreDoubles'

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

const originalLocks = Object.getOwnPropertyDescriptor(window.navigator, 'locks')

// msgpackr 1.10.1 passes a length past the buffer's end to `Buffer.prototype.utf8Write` for a string of 64 or more
// characters, which the Node running the tests rejects; the browser build has no `Buffer`, so production is unaffected.
// Clamping the length to the room left changes no byte written.
interface Utf8Writer {
    utf8Write(this: Uint8Array, text: string, position: number, length: number): number
}
const utf8WriterProto = Buffer.prototype as unknown as Utf8Writer
const nativeUtf8Write = utf8WriterProto.utf8Write

beforeAll(() => {
    utf8WriterProto.utf8Write = function (text, position, length) {
        return nativeUtf8Write.call(this, text, position, Math.min(length, this.length - position))
    }
    class FakeChannel {
        onmessage: ((event: { data: unknown }) => void) | null = null
        constructor(public name: string) { h.channels.push(this) }
        postMessage(data: unknown) { h.broadcasts.push(data) }
        close() { }
    }
    Object.defineProperty(window, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
})

afterAll(() => { utf8WriterProto.utf8Write = nativeUtf8Write })

beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    h.broadcasts.length = 0
    h.channels.length = 0
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    vi.doMock('src/ts/stores.svelte', async () => {
        const { proxy } = await import('svelte/internal/client')
        const { writable } = await import('svelte/store')
        return {
            DBState: proxy({ db: {} as Record<string, unknown> }),
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
            hotReloading: [] as string[],
        } as unknown as typeof import('src/ts/stores.svelte')
    })
    vi.doMock('src/ts/process/coldstorage.svelte', async () => ({
        getColdStorageItem: vi.fn(),
        getColdStorageBackupKey: (await import('src/ts/process/coldstorageData')).getColdStorageBackupKey,
        readColdStorageItem: async () => ({ status: 'missing' }),
        setColdStorageItem: vi.fn(async () => false),
        collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
        confirmIncompleteColdStorageOperation: vi.fn(async () => true),
        isColdStorageBackupData: vi.fn(() => false),
        listColdDataKeys: vi.fn(async () => []),
    }))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(() => {
    worlds.parkAll()
    vi.restoreAllMocks()
    if (originalLocks) {
        Object.defineProperty(window.navigator, 'locks', originalLocks)
    } else {
        Object.defineProperty(window.navigator, 'locks', { value: undefined, configurable: true })
    }
})

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((byte, index) => byte === b[index])
}

const CHA_ID = 'alpha'

interface Session {
    exportBytes(): Promise<Uint8Array>
    service: import('../ownerHistory.svelte').OwnerHistoryService
    owner: import('../ownerPhase').OwnerKey
    clock: ReturnType<typeof createFakeClock>
    factory: IDBFactory
    adapter: import('../studioHistoryStore').StudioHistoryStore
}

async function startSession(): Promise<Session> {
    const locks = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(locks, 'this'), configurable: true })
    h.db = makeDb('base', [CHA_ID])
    const character = (h.db.characters as Record<string, unknown>[])[0]
    character.desc = 'original description'
    character.alternateGreetings = ['first', 'second']
    const k: Store2Kit = await startStore2({ db: h.db as unknown as Database })
    const w: World = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Record<string, unknown>
    stores.selIdState.selId = 0
    const bootActive = await import('src/ts/storage/store2/bootActive')
    bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer: k.committer } as unknown as Store2Session)
    w.pageMode.setPageStorageMode({ kind: 'store2' })
    const alertWithoutNotice = await import('src/ts/alert')
    vi.doMock('src/ts/alert', () => ({ ...alertWithoutNotice, waitUnreadNotice: async () => { } }))
    vi.spyOn(alertWithoutNotice.alertStore, 'set').mockImplementation(() => { })
    w.start()
    await sleepReal(150)
    await settled(w)

    const streamSaver = (await import('src/ts/vendor/streamSaver')).default
    const written: Uint8Array[] = []
    vi.spyOn(streamSaver, 'createWriteStream').mockImplementation((() => ({
        ready: Promise.resolve(),
        writable: { getWriter: () => ({ write: async (chunk: Uint8Array) => { written.push(chunk.slice()) }, close: async () => { } }) },
    })) as never)
    const { SaveLocalBackup } = await import('src/ts/drive/backuplocal')

    const screen = await import('src/ts/studio/studioScreen.svelte')
    screen.studioScreen.chaId = CHA_ID
    const phase = await import('../ownerPhase')
    const history = await import('../ownerHistory.svelte')
    const idb = await import('../studioStoreIdb')
    const claimLocks = await import('../studioClaimLocks')
    // The page's own `indexedDB`, the one an export could reach; a database left by an earlier case is
    // dropped first so each case starts empty.
    await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('risuStudio')
        request.onsuccess = () => resolve()
        request.onerror = () => resolve()
        request.onblocked = () => resolve()
    })
    const factory = indexedDB
    const adapter = idb.createStudioStoreIdb()
    const clock = createFakeClock()
    const tab = createLocksWorld().createTab()
    const owner = phase.characterOwnerKey(CHA_ID)
    const service = history.createOwnerHistoryService({
        store: adapter,
        claim: claimLocks.createStudioClaimLocks(() => tab),
        clock,
        pageSession: 'bin',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
    })
    await service.whenReady(owner)
    return {
        async exportBytes() {
            written.length = 0
            await SaveLocalBackup({ mode: 'inline' })
            return concat(written)
        },
        service,
        owner,
        clock,
        factory,
        adapter,
    }
}

async function storedKeys(factory: IDBFactory): Promise<string[]> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = factory.open('risuStudio', 1)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
    const keys = await new Promise<IDBValidKey[]>((resolve) => {
        const request = db.transaction('records', 'readonly').objectStore('records').getAllKeys()
        request.onsuccess = () => resolve(request.result)
    })
    db.close()
    return keys.map(String).sort()
}

// Every stored key and value of the Studio database, as the double's reader takes them.
async function storedMap(factory: IDBFactory): Promise<Map<string, string>> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = factory.open('risuStudio', 1)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
    const objects = db.transaction('records', 'readonly').objectStore('records')
    const keys = await new Promise<IDBValidKey[]>((resolve) => {
        const request = objects.getAllKeys()
        request.onsuccess = () => resolve(request.result)
    })
    const values = await new Promise<unknown[]>((resolve) => {
        const request = objects.getAll()
        request.onsuccess = () => resolve(request.result)
    })
    db.close()
    return new Map(keys.map((key, index) => [String(key), String(values[index])]))
}

describe('T-BIN1 the .bin is identical with the Studio store populated or empty', () => {
    test('control: two exports of the untouched world are byte-identical', async () => {
        const session = await startSession()
        const first = await session.exportBytes()
        const second = await session.exportBytes()
        expect(first.length).toBeGreaterThan(0)
        expect(sameBytes(first, second)).toBe(true)
    })

    test('an edit session leaves the export unchanged after undo, with the store populated', async () => {
        const session = await startSession()
        const { service, owner, clock } = session
        const untouched = await session.exportBytes()
        expect(await storedKeys(session.factory)).toEqual([])

        // The session: description, an optional flag that starts absent, a greeting added, edited and deleted.
        expect(service.editField(owner, 'desc', 'changed description').ok).toBe(true)
        expect(service.editField(owner, 'hideChatIcon', true).ok).toBe(true)
        expect(service.greetingAdd(owner).ok).toBe(true)
        expect(service.greetingEdit(owner, 2, 'third').ok).toBe(true)
        expect(service.greetingDelete(owner, 0).ok).toBe(true)
        await clock.advance(6000)
        const edited = await session.exportBytes()
        // The export does carry the edits, so the equality after undo is not vacuous.
        expect(sameBytes(edited, untouched)).toBe(false)

        for (let i = 0; i < 20 && service.undo(owner).ok; i++) {
            // Each undo is one step; the loop ends when the stack is empty.
        }
        await clock.advance(6000)
        // The adapter's transaction runs on real ticks; the fake clock only started it.
        await sleepReal(150)
        // The owner is stored as its header plus its generation's keys, nothing else.
        const stored = storedRecord(await storedMap(session.factory), session.owner)
        expect(stored).not.toBeNull()
        expect(stored?.record.undone.length).toBeGreaterThan(0)
        expect(stored?.record.done).toEqual([])
        expect(await storedKeys(session.factory)).toEqual(expectedOwnerKeys(stored!.header, stored!.record))
        const undone = await session.exportBytes()
        expect(sameBytes(undone, untouched)).toBe(true)
    })

    test('records written straight into the store for other owners change nothing', async () => {
        const session = await startSession()
        const untouched = await session.exportBytes()
        const phase = await import('../ownerPhase')
        const other = phase.characterOwnerKey('beta')
        await session.adapter.load(other)
        await session.adapter.save(
            other,
            {
                ownerKey: other,
                touchedAt: 1,
                done: [{ id: 'p:1', at: 1, label: { kind: 'field', field: 'desc' }, ops: [{ op: 'set', path: 'desc', before: { had: false }, after: { had: true, value: 'x' } }] }],
                undone: [],
                deleted: [],
                restore: null,
            },
            new Set([other]),
        )
        const stored = storedRecord(await storedMap(session.factory), other)
        expect(stored).not.toBeNull()
        expect(await storedKeys(session.factory)).toEqual(expectedOwnerKeys(stored!.header, stored!.record))
        expect(sameBytes(await session.exportBytes(), untouched)).toBe(true)
    })
})
