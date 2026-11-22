// @vitest-environment jsdom
/**
 * The saved "always for this workspace" grants are device-local (MC-3371): neither export format carries them. A grant is
 * saved through the real grants store into a store2 page's byte store, then the real `SaveLocalBackup` writes a `.bin`, and
 * the real `.rtb` writer writes a file from the page's own units and the real side-store readers. No exported entry names
 * the consent key, and neither the workspace id nor the tool of the grant appears in any entry or in the decoded database.
 *
 * Compatibility guard: it passes on the base (no grants existed there) and after; it turns red only when a writer starts
 * carrying the consent key. Harness: the save-loop world of `mcpStdioBinRoundTrip.svelte.test.ts` over an in-memory store2
 * backend; a pass says nothing about the Tauri or Node backends or about an upstream build opening the file.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import { exportClosure } from 'src/ts/storage/store2/rtb/exportClosure'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Database } from 'src/ts/storage/database.svelte'
import { writeRtbFile } from './rtb/rtbRestoreFixtures'

vi.setConfig({ testTimeout: 60_000 })

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('localforage', () => {
    const instance = () => ({
        getItem: async () => null,
        setItem: async () => { },
        removeItem: async () => { },
        keys: async () => [],
        length: async () => 0,
        key: async () => null,
        iterate: async () => undefined,
        clear: async () => { },
    })
    return { default: { createInstance: instance, config: () => { }, setDriver: async () => { }, ready: async () => { } } }
})

const worlds = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

const originalLocks = Object.getOwnPropertyDescriptor(window.navigator, 'locks')

// msgpackr 1.10.1 passes a length past the buffer's end to `Buffer.prototype.utf8Write` for a string of 64 or more
// characters, which the Node running the tests rejects; the browser build has no `Buffer`. Clamping changes no byte written.
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

interface BinEntry { name: string, data: Uint8Array }

/** The `.bin` container: `[nameLength][name][dataLength][data]` per entry, lengths little-endian u32. */
function parseEntries(bytes: Uint8Array): BinEntry[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const entries: BinEntry[] = []
    let offset = 0
    while (offset + 4 <= bytes.length) {
        const nameLength = view.getUint32(offset, true)
        offset += 4
        const name = new TextDecoder().decode(bytes.subarray(offset, offset + nameLength))
        offset += nameLength
        const dataLength = view.getUint32(offset, true)
        offset += 4
        entries.push({ name, data: bytes.slice(offset, offset + dataLength) })
        offset += dataLength
    }
    return entries
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

const WORKSPACE_ID = 'ws-grant-marker-7f3a91'
const TOOL = 'write_file'
const GRANTS_KEY = 'consent/workspace-tool-grants.json'

async function exportsWithAGrant() {
    const locks = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(locks, 'this'), configurable: true })
    h.db = makeDb('base', ['alpha'])
    const k: Store2Kit = await startStore2({ db: h.db as unknown as Database })
    const w: World = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Record<string, unknown>
    const bootActive = await import('src/ts/storage/store2/bootActive')
    bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer: k.committer } as unknown as Store2Session)
    w.pageMode.setPageStorageMode({ kind: 'store2' })
    const alert = await import('src/ts/alert')
    vi.spyOn(alert.alertStore, 'set').mockImplementation(() => { })
    w.start()
    await sleepReal(150)
    await settled(w)

    const { addToolGrant } = await import('src/ts/process/mcp/toolGrants')
    expect(await addToolGrant(WORKSPACE_ID, TOOL)).toBe(true)
    const { getAppStore } = await import('src/ts/storage/store/appStore')
    const store = await getAppStore()
    expect(await store.has(GRANTS_KEY)).toBe(true)

    const streamSaver = (await import('src/ts/vendor/streamSaver')).default
    const written: Uint8Array[] = []
    vi.spyOn(streamSaver, 'createWriteStream').mockImplementation((() => ({
        ready: Promise.resolve(),
        writable: { getWriter: () => ({ write: async (chunk: Uint8Array) => { written.push(chunk.slice()) }, close: async () => { } }) },
    })) as never)
    const { SaveLocalBackup } = await import('src/ts/drive/backuplocal')
    await SaveLocalBackup({ mode: 'inline' })
    const bin = parseEntries(concat(written))
    const database = bin.find((entry) => entry.name === 'database.risudat')
    if (database === undefined) {
        throw new Error('The export holds no database entry.')
    }
    const { decodeRisuSave } = await import('src/ts/storage/risuSave')
    const databaseText = JSON.stringify(await decodeRisuSave(database.data))

    const unitStore = new Map<string, Uint8Array>()
    const closure = await exportClosure(k.counted.memory, { onUnits: async (batch) => { for (const unit of batch) { unitStore.set(unit.key, unit.bytes) } } })
    const { readSideStores } = await import('src/ts/drive/rtb/sideStores')
    const sides = await readSideStores()
    const rtb = (await writeRtbFile({
        world: { store: unitStore, manifestKey: closure.manifestKey, refsByRow: new Map(closure.refRows.map((row) => [row, []])) },
        sides,
    })).bytes
    return { bin, databaseText, rtb, sideIds: Object.keys(sides) }
}

describe('the saved tool grants are in neither export format', () => {
    test('a .bin export and an .rtb file name no consent key and hold neither the workspace id nor the tool of the grant', async () => {
        const result = await exportsWithAGrant()
        const latin1 = new TextDecoder('latin1')

        expect(result.bin.length).toBeGreaterThan(0)
        for (const entry of result.bin) {
            expect(entry.name).not.toContain('consent')
            expect(latin1.decode(entry.data)).not.toContain('consent/')
            expect(latin1.decode(entry.data)).not.toContain(WORKSPACE_ID)
        }
        expect(result.databaseText).not.toContain(WORKSPACE_ID)
        expect(result.databaseText).not.toContain('workspace-tool-grants')

        const rtbText = latin1.decode(result.rtb)
        expect(result.rtb.length).toBeGreaterThan(0)
        expect(rtbText).not.toContain('consent/')
        expect(rtbText).not.toContain('workspace-tool-grants')
        expect(rtbText).not.toContain(WORKSPACE_ID)
        expect(result.sideIds.join(',')).not.toContain('grant')
    })
})
