/**
 * A module with a `stdio:` MCP through the composed `.bin` round trip: an upstream-format file whose database holds
 * the module goes through the real `LoadLocalBackup` into a store2 page, a fresh boot over what that committed, the real
 * consent gate (`admitStdio`, which persists the approval to the page's byte store), and the real `SaveLocalBackup`.
 *
 * Invariants: the module (its `mcp.url`, env included) exports exactly as it was imported, so a fork export carries
 * the same module fields as the upstream file; and the approval is device-local, so no exported entry names the
 * approvals key or holds the approval hash, while the approval is in the page's byte store; and the export holds exactly
 * the entry names the import held.
 *
 * Reach of the exclusion half: `SaveLocalBackup` exports `getDatabase()`, which this harness mocks as `h.db`, while the
 * boot result is also exposed through the `DBState.db` proxy; a write through that proxy does not reach the exported
 * object. The half therefore catches a leak into the store listing, an entry, or `getDatabase()`; a leak into a
 * database field written through `DBState.db` is pinned by the consent guard in `mcpStdioConsent.svelte.test.ts`.
 *
 * Harness: the save-loop world of `v21RoundTrip.svelte.test.ts` over an in-memory store2 backend and a fake Web Locks
 * manager; the database entry is the `upstream-missing-unit.bin` golden's, re-encoded in the fork's own export encoding
 * around the extra module (the same method as that suite). A pass says nothing about the Tauri or Node backends, a
 * real browser's download, or an upstream build opening the file.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
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
        readColdStorageItem: async (key: string) => {
            const { getResidency, isEntityUnitKey } = await import('src/ts/storage/store2/residencyActive')
            const residency = getResidency()
            if (!isEntityUnitKey(key) || residency === null) {
                return { status: 'missing' }
            }
            const read = await residency.readCharacter(key)
            return read.status === 'error' ? { status: 'error', error: read.error, kind: read.kind } : { status: 'ok', value: read.value }
        },
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

const GOLDEN_DIR = path.resolve(process.env.BIN_GOLDENS_DIR ?? path.join(process.cwd(), 'src/ts/drive/tests/binGoldens'))
const GOLDEN_FILE = 'upstream-missing-unit.bin'

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

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

const SPEC = { command: 'npx', args: ['-y', '@x/server'], env: { NODE_ENV: 'production' } }
const STDIO_URL = `stdio:${JSON.stringify(SPEC)}`

/** An upstream-shaped module: the fields a module carries there, the MCP a plain `{ url }`. */
const STDIO_MODULE = {
    name: 'Stdio Tools',
    description: 'tools over stdio',
    id: '11111111-1111-4111-8111-1111111111c1',
    mcp: { url: STDIO_URL },
    lorebook: [],
}

/** The golden with its database entry re-encoded, in the fork's own export encoding, around the extra module. */
async function upstreamBin(): Promise<Uint8Array> {
    const { decodeRisuSave, encodeRisuSaveLegacy } = await import('src/ts/storage/risuSave')
    const entries = parseEntries(new Uint8Array(fs.readFileSync(path.join(GOLDEN_DIR, GOLDEN_FILE))))
    const out: Uint8Array[] = []
    for (const entry of entries) {
        if (entry.name === 'database.risudat') {
            const db = await decodeRisuSave(entry.data) as { modules?: unknown[] }
            db.modules = [...(db.modules ?? []), structuredClone(STDIO_MODULE)]
            out.push(binEntry(entry.name, new Uint8Array(encodeRisuSaveLegacy(db as Record<string, unknown>, 'compression'))))
        } else {
            out.push(binEntry(entry.name, entry.data))
        }
    }
    return concat(out)
}

type Trip = {
    exported: BinEntry[]
    importedNames: string[]
    /** The decoded database entry as JSON: the entry itself is compressed, so a plain search of its bytes proves nothing. */
    databaseText: string
    exportedModule: unknown
    approvalKeyInStore: boolean
    approvalHash: string
    prompts: number
}

async function trip(): Promise<Trip> {
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
    const alertWithoutNotice = await import('src/ts/alert')
    // The shared save-loop alert mock has no `waitUnreadNotice`; no notice is ever up in this harness.
    vi.doMock('src/ts/alert', () => ({ ...alertWithoutNotice, waitUnreadNotice: async () => { } }))
    const alert = alertWithoutNotice
    const confirm = vi.mocked(alert.alertConfirm)
    confirm.mockImplementation(async () => true)
    vi.spyOn(alert.alertStore, 'set').mockImplementation(() => { })
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => { })
    w.start()
    await sleepReal(150)
    await settled(w)

    const { LoadLocalBackup, SaveLocalBackup } = await import('src/ts/drive/backuplocal')
    const bytes = await upstreamBin()
    const realCreateElement = document.createElement.bind(document)
    let input: HTMLInputElement | null = null
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const element = realCreateElement(tag)
        if (tag === 'input') {
            input = element as HTMLInputElement
        }
        return element
    })
    LoadLocalBackup()
    const chosen = input as unknown as HTMLInputElement
    Object.defineProperty(chosen, 'files', { value: [new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')], configurable: true })
    await (chosen.onchange as unknown as (event: Event) => Promise<void>).call(chosen, new Event('change'))
    createElementSpy.mockRestore()

    const { bootThroughDispatch } = await import('src/ts/storage/tests/store2SaveKit')
    const boot = await bootThroughDispatch(k.counted.backend)
    if (boot.result.kind !== 'store2') {
        throw new Error(`The boot answered ${boot.result.kind}.`)
    }
    h.db = boot.result.database as unknown as Record<string, unknown>
    ;(stores.DBState as { db: unknown }).db = h.db

    // The consent gate of the imported module, as a send would reach it; the prompt is answered yes.
    const { admitStdio, MCP_STDIO_APPROVALS_KEY } = await import('src/ts/process/mcp/stdioApproval')
    const { stdioSpecHash } = await import('src/ts/process/mcp/stdioSpec')
    const confirmsBefore = confirm.mock.calls.length
    expect(await admitStdio(SPEC, [{ moduleId: STDIO_MODULE.id, moduleName: STDIO_MODULE.name }])).toBe(true)
    const prompts = confirm.mock.calls.length - confirmsBefore
    const { getAppStore } = await import('src/ts/storage/store/appStore')
    const store = await getAppStore()
    await vi.waitFor(async () => { expect(await store.has(MCP_STDIO_APPROVALS_KEY)).toBe(true) })

    const streamSaver = (await import('src/ts/vendor/streamSaver')).default
    const written: Uint8Array[] = []
    vi.spyOn(streamSaver, 'createWriteStream').mockImplementation((() => ({
        ready: Promise.resolve(),
        writable: { getWriter: () => ({ write: async (chunk: Uint8Array) => { written.push(chunk.slice()) }, close: async () => { } }) },
    })) as never)
    await SaveLocalBackup({ mode: 'inline' })
    const exported = parseEntries(concat(written))
    const database = exported.find((entry) => entry.name === 'database.risudat')
    if (database === undefined) {
        throw new Error('The export holds no database entry.')
    }
    const { decodeRisuSave } = await import('src/ts/storage/risuSave')
    const decodedDatabase = await decodeRisuSave(database.data) as { modules: Array<{ id: string }> }
    const modules = decodedDatabase.modules
    return {
        exported,
        importedNames: parseEntries(bytes).map((entry) => entry.name),
        databaseText: JSON.stringify(decodedDatabase),
        exportedModule: modules.find((m) => m.id === STDIO_MODULE.id),
        approvalKeyInStore: await store.has(MCP_STDIO_APPROVALS_KEY),
        approvalHash: await stdioSpecHash(SPEC),
        prompts,
    }
}

describe('a stdio MCP module through an upstream .bin import, a consent and an export', () => {
    test('the module exports as imported and the export carries no approval', async () => {
        const result = await trip()

        expect(result.prompts).toBe(1)
        expect(result.approvalKeyInStore).toBe(true)
        expect(result.exportedModule).toStrictEqual(STDIO_MODULE)
        expect((result.exportedModule as typeof STDIO_MODULE).mcp.url).toBe(STDIO_URL)

        expect(result.databaseText).not.toContain(result.approvalHash)
        expect(result.databaseText).not.toContain('mcpStdioApprovals')
        expect(result.exported.map((entry) => entry.name).sort()).toEqual([...result.importedNames].sort())
        const decoder = new TextDecoder('latin1')
        for (const entry of result.exported) {
            expect(entry.name).not.toContain('consent')
            expect(decoder.decode(entry.data)).not.toContain('consent/')
            expect(decoder.decode(entry.data)).not.toContain(result.approvalHash)
        }
    })
})
