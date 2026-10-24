/**
 * V2.1 plugin entries through the composed `.bin` round trip: an upstream-format file whose database holds a V2.1
 * entry enabled, a V2.1 entry disabled with a saved argument value, a version 2 entry and a 3.0 entry goes through the
 * real `LoadLocalBackup` into a store2 page, a fresh boot over what that committed, the real `loadPlugins`, and the real
 * `SaveLocalBackup`; the legacy decoder then reads the exported `plugins` list.
 *
 * Invariant: a V2.1 entry is data that is never changed by the app. Every field and value of every entry, `enabled`
 * true and false included, equals the input (`toStrictEqual`: value and type, key order ignored). Key order is not part
 * of the invariant: the store2 tree writes keys in canonical order for every record, plugin or not.
 *
 * Labels: the plain variant is a compatibility guard (it passes before and after the V2.1 retirement). The strike
 * variant is the reproducer: with two unfinished restores recorded and an archived character in the booted database,
 * the pre-retirement `loadPlugins` switched the enabled V2.1 entry off, so the exported `enabled` differed. Both tests
 * assert that `loadPlugins` is the real module and that the booted database holds an archived character, so neither can
 * pass on a mock or on a database the strike branch would not read.
 * Harness: the save-loop world of `composedRoundTrip.svelte.test.ts` over an in-memory store2 backend and a fake Web
 * Locks manager. The import is a forced store2 commit that the boot reads back, so store2 write-and-read of the plugin
 * entries is exercised; no store2 save after `loadPlugins` is claimed. A pass says nothing about the Tauri or Node
 * backends, a real browser's download, or an upstream build opening the file.
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
    // `saveLoopMocks.svelte` replaces `plugins.svelte` with a `loadPlugins` that does nothing; this suite needs the
    // real module, with only its V3 loader and transpiler replaced.
    vi.doUnmock('src/ts/plugins/plugins.svelte')
    vi.doMock('src/ts/plugins/apiV3/v3.svelte', () => ({ loadV3Plugins: vi.fn(async () => { }) }))
    vi.doMock('src/ts/plugins/apiV3/transpiler', () => ({ pluginCodeTranspiler: vi.fn((code: string) => code) }))
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

const PLUGINS = [
    { name: 'v21on', script: "addProvider('v21on', async () => ({ success: true, content: '' }))", version: '2.1', enabled: true, arguments: { mode: ['a', 'b'] }, realArg: {}, customLink: [], argMeta: {} },
    { name: 'v21off', script: '', version: '2.1', enabled: false, arguments: {}, realArg: { k: 'v' }, customLink: [], argMeta: {} },
    { name: 'v2', script: '', version: 2, enabled: true, arguments: {}, realArg: {}, customLink: [], argMeta: {} },
    { name: 'v3', script: '//@api 3.0', version: '3.0', enabled: true, arguments: {}, realArg: {}, customLink: [], argMeta: {} },
]

/** The golden with its database entry re-encoded, in the fork's own export encoding, around the four plugins. */
async function upstreamBin(): Promise<Uint8Array> {
    const { decodeRisuSave, encodeRisuSaveLegacy } = await import('src/ts/storage/risuSave')
    const entries = parseEntries(new Uint8Array(fs.readFileSync(path.join(GOLDEN_DIR, GOLDEN_FILE))))
    const out: Uint8Array[] = []
    for (const entry of entries) {
        if (entry.name === 'database.risudat') {
            const db = await decodeRisuSave(entry.data) as Record<string, unknown>
            db.plugins = structuredClone(PLUGINS)
            out.push(binEntry(entry.name, new Uint8Array(encodeRisuSaveLegacy(db, 'compression'))))
        } else {
            out.push(binEntry(entry.name, entry.data))
        }
    }
    return concat(out)
}

async function trip(strikes: boolean): Promise<unknown[]> {
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
    vi.mocked(alert.alertConfirm).mockImplementation(async () => true)
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
    // The strike branch of the pre-retirement `loadPlugins` reads `DBState.db.characters`; without this assignment it
    // would see the scaffold's database, which holds no archived character.
    h.db = boot.result.database as unknown as Record<string, unknown>
    ;(stores.DBState as { db: unknown }).db = h.db

    const real = await import('src/ts/plugins/plugins.svelte')
    expect(vi.isMockFunction(real.loadPlugins)).toBe(false)
    const characters = ((stores.DBState as { db: { characters?: { coldstorage?: string }[] } }).db.characters ?? [])
    expect(characters.filter((character) => character?.coldstorage).length).toBeGreaterThan(0)
    if (strikes) {
        localStorage.setItem('v21RestoreAllStrikes', '2')
    }
    await real.loadPlugins()

    const streamSaver = (await import('src/ts/vendor/streamSaver')).default
    const written: Uint8Array[] = []
    vi.spyOn(streamSaver, 'createWriteStream').mockImplementation((() => ({
        ready: Promise.resolve(),
        writable: { getWriter: () => ({ write: async (chunk: Uint8Array) => { written.push(chunk.slice()) }, close: async () => { } }) },
    })) as never)
    await SaveLocalBackup({ mode: 'inline' })
    const database = parseEntries(concat(written)).find((entry) => entry.name === 'database.risudat')
    if (database === undefined) {
        throw new Error('The export holds no database entry.')
    }
    const { decodeRisuSave } = await import('src/ts/storage/risuSave')
    return (await decodeRisuSave(database.data) as { plugins: unknown[] }).plugins
}

describe('V2.1 plugin entries through an upstream .bin import, a boot, loadPlugins and an export', () => {
    test('guard: with no restore count recorded every entry exports with every field and value equal', async () => {
        expect(await trip(false)).toStrictEqual(PLUGINS)
    })

    test('reproducer: with two unfinished restores recorded and an archived character, the enabled V2.1 entry still exports enabled', async () => {
        expect(await trip(true)).toStrictEqual(PLUGINS)
    })
})
