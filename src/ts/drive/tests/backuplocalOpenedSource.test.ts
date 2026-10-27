// @vitest-environment happy-dom

/**
 * `LoadLocalBackup(undefined, { opened })` on an Android page: the restore of a `.bin` another app opened, read through
 * an `ImportSource` and not a picked `File`. Same harness as `backuplocalAssetBatchAndroid.test.ts` (the desktop invoke
 * fake over a fake file system, with a stand-in for the batch command); a mocked source or command is not evidence about
 * the native bridge or a content provider.
 *
 * Pinned: a restore from a source writes the same assets, inlays and database as the picker `File` path; every read the
 * restore makes of the source (walk, copy-pass header, whole-entry body, streamed asset slice, inlay header and parts) that
 * fails or comes back short ends the restore with an error alert, no database install, no block-store commit and no
 * reload; a file whose size or modification time changed is refused after the copy pass and again before the commit; the
 * source is never read by two readers at once. The store2 side (database re-read, cold units) is in
 * `storeImportOpenedSource.svelte.test.ts`.
 *
 * Labels: guard (File and source agree), reproducer (red against the mutant named at the test).
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: true }
})
const osBox = vi.hoisted(() => ({ os: 'android' }))
const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))
const desktop = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriDesktopFake')).createDesktopInvoke(fakeFs, { cap: 4 * 1024 * 1024 }))

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

/** The batch commands as stand-ins that write through the page's store, as the native command does. */
vi.mock('src/ts/storage/tauriAssetBatch', async (importOriginal) => {
    const original = await importOriginal<typeof import('src/ts/storage/tauriAssetBatch')>()
    const { getAppStore } = await import('src/ts/storage/store/appStore')
    const { StoreInvalidKeyError } = await import('src/ts/storage/store/errors')
    async function run(entries: readonly { key: string, data: Uint8Array }[]) {
        const store = await getAppStore()
        const results: Awaited<ReturnType<typeof original.writeAssetBatch>> = []
        for (const entry of entries) {
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
        return results
    }
    return {
        ...original,
        writeAssetBatch: (entries: readonly { key: string, data: Uint8Array }[]) => run(entries),
        writeAssetBatchB64: (entries: readonly { key: string, data: Uint8Array }[]) => run(entries),
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
    invoke: async (command: string, args?: unknown, options?: unknown) =>
        (desktop.invoke as (command: string, args?: unknown, options?: unknown) => Promise<unknown>)(command, args, options),
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

import { LoadLocalBackup, type LocalBackupEnd } from 'src/ts/drive/backuplocal'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { language } from 'src/lang'
import { alertWait } from 'src/ts/alert'
import { encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { injectRestoreStore } from './restoreSupport'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { resetByteTransportForTests } from 'src/ts/storage/tauriByteTransport'
import { resetAssetBatchAvailabilityForTests } from 'src/ts/storage/tauriAssetBatch'
import { overrideBackupWindowBytes } from 'src/ts/drive/backupContainer'
import { resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { importSourceOfBytes, type ImportSource, type ImportSourceStat } from 'src/ts/importSource'
import { inlayEntryName, inlayIdHash } from 'src/ts/drive/inlayBackupCodec'
import { readAppInlayBody } from 'src/ts/process/files/inlayStore'
import { getAppStore } from 'src/ts/storage/store/appStore'
import { ASSET_PIECE_SAVE_MIN_BYTES } from 'src/ts/assetHash'

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

function patterned(size: number, seed: number): Uint8Array {
    const out = new Uint8Array(size)
    for (let i = 0; i < size; i++) {
        out[i] = (i * 13 + seed) % 251
    }
    return out
}

function databaseChunk(): Uint8Array {
    const database = { characters: [], personas: [], characterOrder: [], botPresets: [] } as unknown as Database
    return buildChunk('database.risudat', encodeRisuSaveLegacy(database, 'noCompression'))
}

interface Placed {
    headerOffset: number
    dataStart: number
    dataLength: number
}

interface Built {
    bytes: Uint8Array
    at: Map<string, Placed>
}

/** The entries framed as a `.bin`, then the database entry; `at` says where each entry's data lies. */
function build(entries: [string, Uint8Array][]): Built {
    const chunks: Uint8Array[] = []
    const at = new Map<string, Placed>()
    let offset = 0
    for (const [name, data] of entries) {
        const chunk = buildChunk(name, data)
        at.set(name, { headerOffset: offset, dataStart: offset + 8 + encoder.encode(name).length, dataLength: data.length })
        chunks.push(chunk)
        offset += chunk.length
    }
    chunks.push(databaseChunk())
    return { bytes: concat(chunks), at }
}

interface InlayFixture {
    id: string
    hash: string
    body: Uint8Array
    headerLength: number
    entries: [string, Uint8Array][]
}

/** An inlay whose body is split over two part entries. */
async function inlayEntries(id: string, bodies: [Uint8Array, Uint8Array]): Promise<InlayFixture> {
    const hash = await inlayIdHash(id)
    const len = bodies[0].length + bodies[1].length
    const header = encoder.encode(JSON.stringify({
        v: 1, id, repr: 'blob', mime: 'image/x', fields: { name: id, ext: 'bin', type: 'image' }, len, parts: 2,
    }))
    return {
        id,
        hash,
        body: concat(bodies),
        headerLength: header.length,
        entries: [
            [inlayEntryName(hash, 0), concat([u32le(header.length), header, bodies[0]])],
            [inlayEntryName(hash, 1), bodies[1]],
        ],
    }
}

interface Read {
    start: number
    end: number
}

type Fault = 'throw' | 'short'

interface Probe {
    source: ImportSource
    reads: Read[]
    closed: () => number
    maxInFlight: () => number
}

/** A source over `bytes`; `fault` may fail or shorten a read, and `stat` may answer something else than the bytes' own size. */
function probeSource(bytes: Uint8Array, options: {
    fault?: (read: Read, index: number) => Fault | null
    stat?: (call: number) => ImportSourceStat
} = {}): Probe {
    const inner = importSourceOfBytes('backup.bin', bytes)
    const reads: Read[] = []
    let closes = 0
    let inFlight = 0
    let most = 0
    let statCalls = 0
    const source: ImportSource = {
        ...inner,
        read: async (start, end) => {
            const index = reads.length
            reads.push({ start, end })
            inFlight++
            most = Math.max(most, inFlight)
            try {
                await Promise.resolve()
                const mode = options.fault?.({ start, end }, index) ?? null
                if (mode === 'throw') {
                    throw new Error('scratch: the provider failed')
                }
                const got = await inner.read(start, end)
                // Short enough to leave a header or a body unresolved wherever the read lands.
                return mode === 'short' ? got.subarray(0, Math.min(1, got.length)) : got
            } finally {
                inFlight--
            }
        },
        stat: async () => options.stat ? options.stat(statCalls++) : inner.stat(),
        close: async () => { closes++ },
    }
    return { source, reads, closed: () => closes, maxInFlight: () => most }
}

let createElementSpy: ReturnType<typeof vi.spyOn>
let capturedInput: HTMLInputElement | null = null
let dbWriteLockSpy: ReturnType<typeof vi.spyOn>

/** The picker path: the File restore the opened path must agree with. */
async function restoreFile(bytes: Uint8Array): Promise<LocalBackupEnd> {
    const pending = LoadLocalBackup()
    const input = capturedInput
    if (!input) {
        throw new Error('LoadLocalBackup did not create a file input')
    }
    Object.defineProperty(input, 'files', { value: [new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')], configurable: true })
    await (input.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
    return await pending
}

function restoreOpened(source: ImportSource): Promise<LocalBackupEnd> {
    return LoadLocalBackup(undefined, { source, name: 'backup.bin', lastModified: 0 })
}

/** Where the restore is: `copy` once the pass over the entries has begun. */
const phase = { value: 'walk' as 'walk' | 'copy' | 'commit' }

function trackPhase(onCommit?: () => void): void {
    phase.value = 'walk'
    vi.mocked(alertWait).mockImplementation((text: string) => {
        if (text.startsWith('Loading local Backup...')) {
            phase.value = 'copy'
        }
        if (text === 'Loading backup...') {
            phase.value = 'commit'
            onCommit?.()
        }
        return { type: 'wait', msg: text }
    })
}

function storedAssets(): Map<string, string> {
    const out = new Map<string, string>()
    for (const [key, value] of fakeFs.files) {
        if (key.startsWith('assets/')) {
            out.set(key, Buffer.from(value).toString('base64'))
        }
    }
    return out
}

async function storedInlay(id: string): Promise<Uint8Array | null> {
    const asset = await readAppInlayBody(await getAppStore(), id)
    return asset === null ? null : new Uint8Array(await (asset.data as Blob).arrayBuffer())
}

function expectNothingInstalled(): void {
    expect(setDatabaseMock).not.toHaveBeenCalled()
    expect(fakeFs.files.has('blocks/head')).toBe(false)
    expect(reloadMark.marked).toBe(false)
}

//#endregion

beforeEach(() => {
    platformBox.isTauri = true
    osBox.os = 'android'
    desktop.reset()
    resetByteTransportForTests()
    resetAssetBatchAvailabilityForTests()
    fakeFs.reset()
    fakeFs.directories.add('assets')
    setDatabaseMock.mockReset()
    alertErrorMock.mockReset()
    alertNormalWaitMock.mockReset().mockImplementation(async () => { })
    reloadMark.marked = false
    phase.value = 'walk'
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
    resetBusyActionsForTest()
    overrideBackupWindowBytes(null)
    vi.mocked(alertWait).mockReset()
    createElementSpy.mockRestore()
    dbWriteLockSpy.mockRestore()
    vi.restoreAllMocks()
})

describe('a restore from an opened source on an Android page', () => {
    // Guard: the source restore and the picker restore write the same things (red if the adapter or the source branch of
    // the inlay writer, or the Blob gating, changes what lands).
    test('guard: writes the assets, the inlay and the database the picker File restore writes', async () => {
        const inlay = await inlayEntries('equal-inlay', [patterned(40, 1), patterned(60, 2)])
        const built = build([
            ['small.png', patterned(500, 3)],
            ['mid.png', patterned(300 * 1024, 4)],
            ['big.bin', patterned(MIB + 5, 5)],
            ...inlay.entries,
        ])

        const fileEnd = await restoreFile(built.bytes)
        const fileAssets = storedAssets()
        const fileInlay = await storedInlay('equal-inlay')
        const fileInstalls = setDatabaseMock.mock.calls.length
        fakeFs.reset()
        fakeFs.directories.add('assets')
        setDatabaseMock.mockReset()
        injectRestoreStore(createTauriFilesStore({ platform: 'posix' }))
        reloadMark.marked = false

        const probe = probeSource(built.bytes)
        const openedEnd = await restoreOpened(probe.source)

        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(fileEnd.outcome).toBe('committed')
        expect(openedEnd.outcome).toBe('committed')
        expect(openedEnd.target).toBe('backup.bin')
        expect(openedEnd.detail.source).toEqual({ kind: 'file', name: 'backup.bin', size: built.bytes.length, lastModified: 0 })
        expect(fileAssets.size).toBe(3)
        expect(storedAssets()).toEqual(fileAssets)
        expect(fileInlay).toEqual(inlay.body)
        expect(await storedInlay('equal-inlay')).toEqual(inlay.body)
        expect(setDatabaseMock).toHaveBeenCalledTimes(fileInstalls)
        expect(openedEnd.detail.assets).toEqual(fileEnd.detail.assets)
        expect(openedEnd.detail.inlays).toEqual(fileEnd.detail.inlays)
    })

    test('the source is never read by two readers at once, and is not closed by the restore (the caller owns it)', async () => {
        const built = build(Array.from({ length: 6 }, (_, index): [string, Uint8Array] => [`l${index}.bin`, patterned(MIB + 1000 + index, index + 1)]))
        const probe = probeSource(built.bytes)

        const end = await restoreOpened(probe.source)

        expect(end.outcome).toBe('committed')
        // Reproducer against the mutant without the adapter's promise queue: the asset pipeline reads while the pass reads.
        expect(probe.maxInFlight()).toBe(1)
        expect(probe.closed()).toBe(0)
    })

    describe('on a page whose store keeps Blobs', () => {
        // The store hands back what it was given, and counts the Blob writes. A page that is not Tauri streams nothing, so
        // an entry of ASSET_PIECE_SAVE_MIN_BYTES or more reaches `writeBlob` as a slice of the file.
        function blobKeepingStore(blobWrites: string[]) {
            const base = createTauriFilesStore({ platform: 'posix' })
            return {
                ...base,
                writeBlob: async (key: string, _blob: Blob) => {
                    blobWrites.push(key)
                    return { version: null }
                },
                readBlob: async () => null,
            }
        }

        // Guard: the picker File reaches the Blob branch on this page, so the test below is not passing for lack of it.
        test('guard: a picked File of an entry that large is stored through writeBlob', async () => {
            platformBox.isTauri = false
            const blobWrites: string[] = []
            injectRestoreStore(blobKeepingStore(blobWrites) as unknown as Parameters<typeof injectRestoreStore>[0], 'tauri')
            const built = build([['huge.bin', patterned(ASSET_PIECE_SAVE_MIN_BYTES, 1)]])

            await restoreFile(built.bytes)

            expect(blobWrites).toEqual(['assets/huge.bin'])
        })

        // Reproducer against the mutant that drops the `instanceof Blob` gate: a source-backed slice is not a Blob, so the
        // store would be handed something it cannot keep and the asset would be lost or the restore would throw.
        test('reproducer: an entry that large from a source is written as bytes and never offered to writeBlob', async () => {
            platformBox.isTauri = false
            const blobWrites: string[] = []
            injectRestoreStore(blobKeepingStore(blobWrites) as unknown as Parameters<typeof injectRestoreStore>[0], 'tauri')
            const data = patterned(ASSET_PIECE_SAVE_MIN_BYTES, 1)
            const built = build([['huge.bin', data]])

            const end = await restoreOpened(probeSource(built.bytes).source)

            expect(end.outcome).toBe('committed')
            expect(blobWrites).toEqual([])
            expect(storedAssets().get('assets/huge.bin')).toBe(Buffer.from(data).toString('base64'))
        })
    })

    describe.each([
        ['throw'],
        ['short'],
    ] as const)('a read that is a %s', (mode) => {
        const inlay = async () => await inlayEntries('fault-inlay', [patterned(40, 1), patterned(60, 2)])

        interface Case {
            label: string
            /** The read to fault, given the layout. */
            pick: (built: Built, inlayFixture: InlayFixture, read: Read, index: number) => boolean
        }

        const cases: Case[] = [
            { label: 'the walk', pick: (_b, _i, _r, index) => index === 0 },
            { label: 'the copy-pass header read', pick: (_b, _i, _r, _index) => phase.value === 'copy' && firstCopyRead() },
            { label: 'the whole-entry body read', pick: (b, _i, r) => phase.value === 'copy' && r.start === b.at.get('body.png')!.dataStart },
            { label: 'a streamed asset slice', pick: (b, _i, r) => phase.value === 'copy' && r.start === b.at.get('big.bin')!.dataStart },
            { label: 'the inlay length bytes', pick: (b, i, r) => phase.value === 'copy' && r.start === b.at.get(i.entries[0][0])!.dataStart && r.end - r.start === 4 },
            { label: 'the inlay header', pick: (b, i, r) => phase.value === 'copy' && r.start === b.at.get(i.entries[0][0])!.dataStart + 4 },
            { label: 'the inlay part 0 body', pick: (b, i, r) => phase.value === 'copy' && r.start === b.at.get(i.entries[0][0])!.dataStart + 4 + i.headerLength },
            { label: 'the inlay part 1 body', pick: (b, i, r) => phase.value === 'copy' && r.start === b.at.get(i.entries[1][0])!.dataStart },
        ]

        let copyReads = 0
        function firstCopyRead(): boolean {
            copyReads++
            return copyReads === 1
        }

        // The inlay cases are reproducers: red against the mutants without a length check in the inlay writer / collector.
        // The rest are guards: an earlier check already refuses a one-byte short read there, so they pass without the
        // check they name. Each ends with an error alert and nothing installed.
        test.each(cases)('$label ends the restore with an error alert and nothing installed', async (picked) => {
            copyReads = 0
            overrideBackupWindowBytes({ walk: 4096, copy: 4096 })
            const fixture = await inlay()
            const built = build([
                ['a.png', patterned(300, 1)],
                ['body.png', patterned(20000, 2)],
                ['big.bin', patterned(MIB + 9, 3)],
                ...fixture.entries,
            ])
            trackPhase()
            const probe = probeSource(built.bytes, { fault: (read, index) => picked.pick(built, fixture, read, index) ? mode : null })

            const end = await restoreOpened(probe.source)

            expect(end.outcome).not.toBe('committed')
            expect(alertErrorMock).toHaveBeenCalled()
            expectNothingInstalled()
            expect(await storedInlay('fault-inlay')).toBeNull()
        })
    })

    describe('a file that changed while it was read', () => {
        const inlayBody = [patterned(40, 1), patterned(60, 2)] as [Uint8Array, Uint8Array]

        // Reproducer against the mutant without the `changed()` check before the inlay restore: the inlay would be written
        // although the file is no longer the one that was walked.
        test('reproducer: a size change seen after the copy pass stops the restore before an inlay is written', async () => {
            const fixture = await inlayEntries('changed-inlay', inlayBody)
            const built = build([['a.png', patterned(300, 1)], ...fixture.entries])
            // The first stat is the open-time figure; the next one is the check after the copy pass.
            const probe = probeSource(built.bytes, { stat: (call) => ({ size: built.bytes.length + (call === 0 ? 0 : 1), modified: 7 }) })

            const end = await restoreOpened(probe.source)

            expect(end.outcome).toBe('nothing-replaced')
            expect(alertErrorMock).toHaveBeenCalledWith(language.backupFileChangedWhileReading)
            expect(await storedInlay('changed-inlay')).toBeNull()
            expectNothingInstalled()
        })

        // Reproducer against the mutant without the `changed()` check before the commit: the restore would install the
        // database although the file changed after the last check of the copy pass.
        test('reproducer: a change that appears only at the commit stage stops the restore before the install', async () => {
            const built = build([['a.png', patterned(300, 1)]])
            let flipped = false
            trackPhase(() => { flipped = true })
            const probe = probeSource(built.bytes, { stat: () => ({ size: built.bytes.length, modified: flipped ? 9 : 7 }) })

            const end = await restoreOpened(probe.source)

            expect(flipped).toBe(true)
            expect(end.outcome).toBe('nothing-replaced')
            expect(alertErrorMock).toHaveBeenCalledWith(language.backupFileChangedWhileReading)
            expectNothingInstalled()
        })

        test('guard: an unchanged file with a modification time restores', async () => {
            const built = build([['a.png', patterned(300, 1)]])
            const probe = probeSource(built.bytes, { stat: () => ({ size: built.bytes.length, modified: 7 }) })

            const end = await restoreOpened(probe.source)

            expect(end.outcome).toBe('committed')
            expect(alertErrorMock).not.toHaveBeenCalled()
        })
    })
})
