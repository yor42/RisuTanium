// @vitest-environment happy-dom

/**
 * `LoadLocalBackup` (`src/ts/drive/backuplocal.ts`) on an Android page: the
 * restore's asset writes go to `put_assets_batch_b64` in batches, and not one
 * `mkdir` plus one `write_chunk` per asset. The batch command is a recording
 * stand-in that writes through the page's real store, so a refused name, a failed
 * frame and a rejected call can be injected; the chunk commands are answered by
 * the in-memory chunk fake. A mocked command is not evidence about the native
 * backend or the Android bridge; the Rust side is covered by the `asset_batch`
 * tests of `src-tauri`.
 *
 * Pinned: an Android page batches (red when the Android pipeline is missing); a
 * batch carries at most the pipeline's `batchBytes`, and that same number is the
 * size limit handed to the command; an asset above `batchBytes` is streamed and
 * never raises a `RangeError`; the desktop page keeps the raw command; a failed
 * frame or a rejected call stops the restore before any commit, names the failure
 * with the existing message, and leaves the assets that landed in place; a refused
 * name is reported in the skip notice and the restore goes on.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: true }
})
const osBox = vi.hoisted(() => ({ os: 'android' }))
const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))
const desktop = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriDesktopFake')).createDesktopInvoke(fakeFs, { cap: 4 * 1024 * 1024 }))

interface WireBatch {
    command: 'put_assets_batch' | 'put_assets_batch_b64'
    maxEntryBytes: number | undefined
    keys: string[]
    entryBytes: number
}
/** What reached the stand-in batch commands and the chunk command, in order. */
const wire = vi.hoisted(() => ({
    batches: [] as WireBatch[],
    chunkKeys: [] as string[],
    /** The key whose frame is answered `error` without being written. */
    errorKey: null as string | null,
    /** The 0-based call that rejects as a whole, before anything is written. */
    rejectCall: -1,
    rangeErrors: [] as unknown[],
    /** Stand-in batch calls running now; chunk calls made inside one are not the page's own. */
    inBatch: 0,
}))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const setDatabaseMock = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())
const alertNormalWaitMock = vi.hoisted(() => vi.fn(async (_message: string): Promise<void> => { }))
const reloadMark = vi.hoisted(() => ({ marked: false }))

vi.mock(import('src/ts/reloadGuard'), () => ({
    markAppInitiatedReload: () => { reloadMark.marked = true },
    isAppInitiatedReload: () => reloadMark.marked,
}) as unknown as typeof import('src/ts/reloadGuard'))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
            keys: vi.fn(async () => []),
        }),
    },
}))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformBox.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => osBox.os }))

vi.mock('@tauri-apps/plugin-fs', () => ({ ...fakeFs.module }))

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => 'backup-output.bin'),
}))

/**
 * The batch commands as recording stand-ins over the page's store. The real
 * `encodePutFrames` runs first, so a call above its size limit rejects here as
 * it does on the page, and the recorded sizes are those of the real frames.
 */
vi.mock('src/ts/storage/tauriAssetBatch', async (importOriginal) => {
    const original = await importOriginal<typeof import('src/ts/storage/tauriAssetBatch')>()
    const { getAppStore } = await import('src/ts/storage/store/appStore')
    const { StoreInvalidKeyError } = await import('src/ts/storage/store/errors')
    async function run(command: WireBatch['command'], entries: readonly { key: string, data: Uint8Array }[], maxEntryBytes: number | undefined) {
        const callIndex = wire.batches.length
        try {
            original.encodePutFrames(entries, maxEntryBytes)
        } catch (error) {
            wire.rangeErrors.push(error)
            throw error
        }
        wire.batches.push({
            command,
            maxEntryBytes,
            keys: entries.map((entry) => entry.key),
            entryBytes: entries.reduce((sum, entry) => sum + entry.data.length, 0),
        })
        await Promise.resolve()
        if (callIndex === wire.rejectCall) {
            throw new Error('scratch: the bridge went away')
        }
        const store = await getAppStore()
        const results: Awaited<ReturnType<typeof original.writeAssetBatch>> = []
        // The stand-in writes through the store, whose chunk calls are the native command's own work here.
        wire.inBatch += 1
        try {
            for (const entry of entries) {
                if (entry.key === wire.errorKey) {
                    results.push({ k: 'error', message: 'scratch: disk full' })
                    continue
                }
                try {
                    await store.write(entry.key, entry.data, 'unconditional')
                    results.push({ k: 'ok' })
                } catch (error) {
                    if (error instanceof StoreInvalidKeyError) {
                        results.push({ k: 'invalid', reason: error.message })
                    } else {
                        throw error
                    }
                }
            }
        } finally {
            wire.inBatch -= 1
        }
        return results
    }
    return {
        ...original,
        writeAssetBatch: (entries: readonly { key: string, data: Uint8Array }[], maxEntryBytes?: number) => run('put_assets_batch', entries, maxEntryBytes),
        writeAssetBatchB64: (entries: readonly { key: string, data: Uint8Array }[], maxEntryBytes: number) => run('put_assets_batch_b64', entries, maxEntryBytes),
    }
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: getDatabaseMock,
    setDatabase: setDatabaseMock,
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as unknown as Database },
    selectedCharID: writable(-1),
    selIdState: { selId: -1 },
    alertStore: writable({ type: 'none', msg: '' }),
    MobileGUI: writable(false),
    botMakerMode: writable(false),
    loadedStore: writable(false),
    LoadingStatusState: { text: '' },
    ReloadGUIPointer: writable(0),
    bodyIntercepterStore: writable(null),
    savingStoppedReason: writable(null),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: alertErrorMock,
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: alertNormalWaitMock,
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(async () => { }),
    sleepForever: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: async (command: string, args?: unknown, options?: unknown) => {
        if (command === 'write_chunk' && wire.inBatch === 0) {
            wire.chunkKeys.push((args as { key: string }).key)
        }
        return (desktop.invoke as (command: string, args?: unknown, options?: unknown) => Promise<unknown>)(command, args, options)
    },
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
    open: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({
        listen: vi.fn(),
        setTitle: vi.fn(),
    })),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => vi.fn()),
}))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        getItem = vi.fn(async () => null)
        setItem = vi.fn(async () => { })
        keys = vi.fn(async () => [])
        removeItem = vi.fn(async () => { })
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/observer.svelte'), () => ({
    startObserveDom: vi.fn(),
}) as unknown as typeof import('src/ts/observer.svelte'))

vi.mock(import('src/ts/gui/guisize'), () => ({
    updateGuisize: vi.fn(),
}) as unknown as typeof import('src/ts/gui/guisize'))

vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((v: unknown) => v),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('src/ts/hotkey'))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/coldstorage.svelte'), async () => {
    const { getColdStorageBackupKey } = await import('src/ts/process/coldstorageData')
    return {
        collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
        readColdStorageItem: vi.fn(async () => ({ status: 'missing' })),
        confirmIncompleteColdStorageOperation: vi.fn(async () => true),
        getColdStorageBackupKey,
        getColdStorageItem: vi.fn(async () => null),
        isColdStorageBackupData: vi.fn(() => true),
        listColdDataKeys: vi.fn(async () => []),
        setColdStorageItem: vi.fn(async () => true),
    } as unknown as typeof import('src/ts/process/coldstorage.svelte')
})

//#endregion

import { LoadLocalBackup } from 'src/ts/drive/backuplocal'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { language } from 'src/lang'
import { alertWait } from 'src/ts/alert'
import { encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { injectRestoreStore } from './restoreSupport'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { CHUNK_MAX, resetByteTransportForTests, WRITE_CHUNK_BYTES } from 'src/ts/storage/tauriByteTransport'
import { resetAssetBatchAvailabilityForTests } from 'src/ts/storage/tauriAssetBatch'

//#region helpers

const encoder = new TextEncoder()
const MIB = 1024 * 1024

function u32le(n: number): Uint8Array {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
}

function buildChunk(name: string, data: Uint8Array): Uint8Array {
    const nameBuf = encoder.encode(name)
    const out = new Uint8Array(4 + nameBuf.length + 4 + data.length)
    out.set(u32le(nameBuf.length), 0)
    out.set(nameBuf, 4)
    out.set(u32le(data.length), 4 + nameBuf.length)
    out.set(data, 8 + nameBuf.length)
    return out
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

function filled(size: number, fill: number): Uint8Array {
    return new Uint8Array(size).fill(fill)
}

function databaseChunk(): Uint8Array {
    const database = { characters: [], personas: [], characterOrder: [], botPresets: [] } as unknown as Database
    return buildChunk('database.risudat', encodeRisuSaveLegacy(database, 'noCompression'))
}

function backupOf(entries: [string, Uint8Array][]): Uint8Array {
    return concat([...entries.map(([name, data]) => buildChunk(name, data)), databaseChunk()])
}

function storedBytes(name: string): Uint8Array | undefined {
    return fakeFs.files.get(`assets/${name}`)
}

function sameBytes(actual: Uint8Array | undefined, expected: Uint8Array): boolean {
    return actual !== undefined && Buffer.compare(Buffer.from(actual), Buffer.from(expected)) === 0
}

let capturedInput: HTMLInputElement | null = null
let createElementSpy: ReturnType<typeof vi.spyOn>
let dbWriteLockSpy: ReturnType<typeof vi.spyOn>

function restoreBytes(bytes: Uint8Array): Promise<void> {
    LoadLocalBackup()
    const input = capturedInput
    if (!input) {
        throw new Error('LoadLocalBackup did not create a file input')
    }
    Object.defineProperty(input, 'files', { value: [new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')], configurable: true })
    return (input.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
}

/** The asset keys written by a per-asset `write_chunk`, as the Android store does without a batch. */
function perAssetChunkKeys(): string[] {
    return wire.chunkKeys.filter((key) => key.startsWith('assets/'))
}

//#endregion

beforeEach(() => {
    platformBox.isTauri = true
    osBox.os = 'android'
    desktop.reset()
    wire.batches.length = 0
    wire.chunkKeys.length = 0
    wire.errorKey = null
    wire.rejectCall = -1
    wire.rangeErrors.length = 0
    wire.inBatch = 0
    resetByteTransportForTests()
    resetAssetBatchAvailabilityForTests()
    fakeFs.reset()
    fakeFs.directories.add('assets')
    setDatabaseMock.mockReset()
    alertErrorMock.mockReset()
    alertNormalWaitMock.mockReset().mockImplementation(async () => { })
    reloadMark.marked = false
    vi.spyOn(console, 'error').mockImplementation(() => { })
    injectRestoreStore(createTauriFilesStore({ platform: 'posix' }))
    getDatabaseMock.mockImplementation(() => ({ characters: [], personas: [], characterOrder: [], botPresets: [] }) as unknown as Database)
    dbWriteLockSpy = vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })

    capturedInput = null
    const realCreateElement = document.createElement.bind(document)
    createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = realCreateElement(tag)
        if (tag === 'input') {
            capturedInput = el as HTMLInputElement
        }
        return el
    })
})

afterEach(() => {
    vi.mocked(alertWait).mockReset()
    createElementSpy.mockRestore()
    dbWriteLockSpy.mockRestore()
    vi.restoreAllMocks()
})

describe('a restore on an Android page', () => {
    // Regression reproducer: without an Android pipeline every asset is its own store write (a chunk call each),
    // and no batch call is made.
    test('writes many small assets in batch calls and not one chunk write per asset', async () => {
        const names = Array.from({ length: 40 }, (_, index) => `s${index}.png`)

        await restoreBytes(backupOf(names.map((name, index): [string, Uint8Array] => [name, filled(1000 + index, index + 1)])))

        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(perAssetChunkKeys()).toEqual([])
        expect(wire.batches.length).toBeGreaterThanOrEqual(1)
        expect(wire.batches.length).toBeLessThan(names.length / 4)
        expect(wire.batches.every((batch) => batch.command === 'put_assets_batch_b64')).toBe(true)
        expect(wire.batches.flatMap((batch) => batch.keys).sort()).toEqual(names.map((name) => `assets/${name}`).sort())
        for (const [index, name] of names.entries()) {
            expect(sameBytes(storedBytes(name), filled(1000 + index, index + 1))).toBe(true)
        }
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })

    test('hands the command exactly the pipeline batch size, and no call carries more entry bytes than that', async () => {
        const names = Array.from({ length: 12 }, (_, index) => `m${index}.png`)

        await restoreBytes(backupOf(names.map((name, index): [string, Uint8Array] => [name, filled(300 * 1024, index + 1)])))

        expect(wire.batches.length).toBeGreaterThan(1)
        for (const batch of wire.batches) {
            expect(batch.maxEntryBytes).toBe(WRITE_CHUNK_BYTES)
            expect(batch.entryBytes).toBeLessThanOrEqual(WRITE_CHUNK_BYTES)
        }
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    // The loop used to compare with CHUNK_MAX: a 1 MiB to 4 MiB asset would reach `add` and throw a RangeError.
    test('streams every asset above the batch size, so an asset between 1 and 4 MiB raises no RangeError', async () => {
        const sizes: [string, number][] = [
            ['below.bin', MIB - 1],
            ['exact.bin', MIB],
            ['above.bin', MIB + 1],
            ['huge.bin', CHUNK_MAX + 1],
        ]
        const entries = sizes.map(([name, size], index): [string, Uint8Array] => [name, filled(size, index + 10)])

        await restoreBytes(backupOf([['tiny.png', filled(5, 1)], ...entries]))

        expect(wire.rangeErrors).toEqual([])
        expect(alertErrorMock).not.toHaveBeenCalled()
        const batched = wire.batches.flatMap((batch) => batch.keys)
        expect(batched).toContain('assets/tiny.png')
        expect(batched).toContain('assets/below.bin')
        expect(batched).toContain('assets/exact.bin')
        expect(batched).not.toContain('assets/above.bin')
        expect(batched).not.toContain('assets/huge.bin')
        for (const [index, [name, size]] of sizes.entries()) {
            expect(sameBytes(storedBytes(name), filled(size, index + 10))).toBe(true)
        }
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })

    test('a frame answered error stops the restore with the existing message, commits nothing and leaves the assets that landed', async () => {
        const names = Array.from({ length: 12 }, (_, index) => `e${index}.png`)
        wire.errorKey = 'assets/e1.png'

        await restoreBytes(backupOf(names.map((name, index): [string, Uint8Array] => [name, filled(300 * 1024, index + 1)])))

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith('Failed, Is file corrupted?')
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(fakeFs.files.has('blocks/head')).toBe(false)
        // The frames of the failing batch around the failed one landed; the failed one did not.
        expect(storedBytes('e0.png')).toBeDefined()
        expect(storedBytes('e2.png')).toBeDefined()
        expect(storedBytes('e1.png')).toBeUndefined()
        // Nothing is sent after the failure was seen: at most the call in flight beside the first.
        expect(wire.batches.length).toBeLessThanOrEqual(2)
    })

    test('a call that rejects as a whole stops the restore the same way', async () => {
        const names = Array.from({ length: 12 }, (_, index) => `r${index}.png`)
        wire.rejectCall = 0

        await restoreBytes(backupOf(names.map((name, index): [string, Uint8Array] => [name, filled(300 * 1024, index + 1)])))

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith('Failed, Is file corrupted?')
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(fakeFs.files.has('blocks/head')).toBe(false)
        expect(wire.batches.length).toBeLessThanOrEqual(2)
    })

    test('a name the store refuses is named in the skip notice and the restore goes on', async () => {
        await restoreBytes(backupOf([['.badA', filled(20, 1)], ['good.png', filled(20, 2)], ['.badB', filled(20, 3)]]))

        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(alertNormalWaitMock).toHaveBeenCalledWith(language.restoreAssetsSkipped(2, ['.badA', '.badB']))
        expect(sameBytes(storedBytes('good.png'), filled(20, 2))).toBe(true)
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })

    // Regression reproducer: a streamed asset (above batchBytes) skips the batch path, and the Android chunked
    // writer does not apply the page key rule, so the refusal used to surface as a whole-import failure.
    test('a streamed asset whose name the store refuses is named in the skip notice and the restore goes on', async () => {
        await restoreBytes(backupOf([['.bigbad', filled(MIB + 1, 7)], ['good.png', filled(20, 2)]]))

        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(alertNormalWaitMock).toHaveBeenCalledWith(language.restoreAssetsSkipped(1, ['.bigbad']))
        expect(storedBytes('.bigbad')).toBeUndefined()
        expect(sameBytes(storedBytes('good.png'), filled(20, 2))).toBe(true)
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })

    test('a batch hands the sender distinct frames in file order with the key rules of the page store', async () => {
        await restoreBytes(backupOf([['one.png', filled(4, 1)], ['two.png', filled(4, 2)], ['three.png', filled(4, 3)]]))

        expect(wire.batches).toHaveLength(1)
        expect(wire.batches[0].keys).toEqual(['assets/one.png', 'assets/two.png', 'assets/three.png'])
    })
})

describe('a restore on a desktop page', () => {
    // Compatibility guard: passes before and after. The desktop keeps the raw command and its 4 MiB batches.
    test('guard: keeps the raw command with the CHUNK_MAX size limit and never the base64 command', async () => {
        osBox.os = 'windows'

        await restoreBytes(backupOf([['d1.png', filled(10, 1)], ['d2.png', filled(10, 2)]]))

        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(wire.batches.length).toBeGreaterThanOrEqual(1)
        for (const batch of wire.batches) {
            expect(batch.command).toBe('put_assets_batch')
            expect(batch.maxEntryBytes).toBe(CHUNK_MAX)
        }
    })

    // Compatibility guard: passes before and after. The desktop chunked writer applies the page key rule itself.
    test('guard: a streamed asset whose name the store refuses is named in the skip notice', async () => {
        osBox.os = 'windows'

        await restoreBytes(backupOf([['.bigbad', filled(CHUNK_MAX + 1, 7)], ['good.png', filled(20, 2)]]))

        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(alertNormalWaitMock).toHaveBeenCalledWith(language.restoreAssetsSkipped(1, ['.bigbad']))
        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    })
})
