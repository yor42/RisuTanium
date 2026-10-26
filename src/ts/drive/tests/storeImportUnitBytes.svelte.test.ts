/**
 * The import size and time questions of a `.bin` whose character and chat data sits in unit entries
 * (`coldstorage_<uuid>.json`): `confirmImportScale` keys the 16 MiB size sentence on the database entry plus a quarter
 * of those unit entries (they are uncompressed JSON, the database entry is compressed), and the long commit tail on the
 * database entry plus the whole unit entries. A stub-form file (the fork's export since stub mode, and an upstream file
 * with archived characters) has a small database entry and most of its bytes in units, yet resolves to the same tree as
 * the inline file. The size is shown in decimal megabytes.
 *
 * The unit total is a name-only estimate over the entry the reader tries first per id; it is not the bytes the resolve
 * reads (it over-counts orphan units and rejected bodies, and under-counts units a fallback serves). The tests therefore
 * assert the prompt text of files whose unit entries are all named and read.
 *
 * Files: the stub-form file is written by the real `SaveLocalBackup({ mode: 'stub' })` in the save-loop world of
 * `composedRoundTrip.svelte.test.ts`, from the `fork-full.bin` golden with its stub character's chat padded to 18 MiB
 * before it is imported: its whole sum is over 16 MiB and its quarter-weighted sum is under it. The upstream-layout
 * file is hand-built from `upstream-full.bin` with `binEntry`: the stub character's unit and the inline character's
 * pointer-chat unit padded to 36 MiB each, the database entry last, so even the quarter-weighted sum is over 16 MiB.
 * No threshold is lowered, and the database entry is asserted to be within 16 MiB.
 *
 * Labels: new behaviour (red on the base, which weighs the units in full and shows binary megabytes), guard (passes
 * with or without the change). A mocked success is not evidence about a phone.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, sleepReal, settled, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, bootThroughDispatch, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import { ID } from 'src/ts/storage/tests/store2/legacyFixtures'
import { getColdStorageBackupKey } from 'src/ts/process/coldstorageData'
import { language } from 'src/lang'
import type { Committer } from 'src/ts/storage/store2/commit'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { BootImportTarget } from 'src/ts/storage/store2/legacy/bootImport'
import type { Database } from 'src/ts/storage/database.svelte'

vi.setConfig({ testTimeout: 120_000 })

const osBox = vi.hoisted(() => ({ os: 'android' as string }))
const thresholdBox = vi.hoisted(() => ({ bytes: 2000 }))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => osBox.os }))

vi.mock('src/ts/drive/importEstimate', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/drive/importEstimate')>()
    return {
        ...actual,
        get IMPORT_TIME_WARNING_BYTES() { return thresholdBox.bytes },
    }
})

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

type Obj = Record<string, unknown>

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
        close() {}
    }
    Object.defineProperty(window, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
})

afterAll(() => {
    utf8WriterProto.utf8Write = nativeUtf8Write
})

beforeEach(() => {
    vi.clearAllMocks()
    osBox.os = 'other'
    thresholdBox.bytes = 2000
    h.broadcasts.length = 0
    h.channels.length = 0
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    vi.doMock('src/ts/stores.svelte', async () => {
        const { proxy } = await import('svelte/internal/client')
        const { writable } = await import('svelte/store')
        return {
            DBState: proxy({ db: {} as Obj }),
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
        // The real reader's two branches: an entity key reads the store2 character through the residency, any other key is a legacy unit, and there are none.
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
    kit: Store2Kit
    alert: typeof import('src/ts/alert')
}

async function openPage(): Promise<Page> {
    const locks = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(locks, 'this'), configurable: true })
    h.db = makeDb('base', ['alpha', 'beta'])
    const kit = await startStore2({ db: h.db as unknown as Database })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(kit) })
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Obj
    const bootActive = await import('src/ts/storage/store2/bootActive')
    const page: Page = { w, kit, alert: await import('src/ts/alert') }
    bootActive.setStore2BootSession({ kind: 'tauri', backend: kit.counted.backend, committer: kit.committer as Committer } as unknown as Store2Session)
    w.pageMode.setPageStorageMode({ kind: 'store2' })
    vi.spyOn(page.alert.alertStore, 'set').mockImplementation(() => { })
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => { })
    w.start()
    await sleepReal(150)
    await settled(w)
    return page
}

/** A page as a boot sees it: no page mode and no residency. */
async function openBoot(): Promise<Page> {
    const locks = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(locks, 'this'), configurable: true })
    h.db = makeDb('base', ['alpha'])
    const kit = await startStore2({ db: h.db as unknown as Database })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(kit) })
    const alert = await import('src/ts/alert')
    vi.spyOn(alert.alertStore, 'set').mockImplementation(() => { })
    w.pageMode.setPageStorageMode({ kind: 'unset' })
    ;(await import('src/ts/storage/store2/residencyActive')).resetResidencyForTest()
    w.start()
    await sleepReal(100)
    await settled(w)
    return { w, kit, alert }
}

/** Answers every confirm with `decision`, and turns the box back to `other` so an accepted import runs as the world's page. */
function answer(page: Page, decision: boolean): void {
    vi.mocked(page.alert.alertConfirm).mockImplementation(async () => {
        osBox.os = 'other'
        return decision
    })
}

const confirmTexts = (page: Page): string[] => vi.mocked(page.alert.alertConfirm).mock.calls.map((call) => String(call[0]))
const alertErrorTexts = (page: Page): unknown[] => vi.mocked(page.alert.alertError).mock.calls.map((call) => call[0])

// ---- .bin construction ----

const MIB = 1024 * 1024

interface WrittenEntry {
    name: string
    data: Uint8Array
}

function parseEntries(bytes: Uint8Array): WrittenEntry[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const entries: WrittenEntry[] = []
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

function binOf(...entries: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(entries.reduce((total, entry) => total + entry.length, 0))
    let offset = 0
    for (const entry of entries) {
        out.set(entry, offset)
        offset += entry.length
    }
    return out
}

function goldenEntries(file: string): WrittenEntry[] {
    const dir = path.resolve(process.env.BIN_GOLDENS_DIR ?? path.join(process.cwd(), 'src/ts/drive/tests/binGoldens'))
    return parseEntries(new Uint8Array(fs.readFileSync(path.join(dir, file))))
}

/** The golden with the named units' chat text replaced by `pad` bytes of text; every other entry and the entry order are the golden's. */
function paddedGolden(file: string, pads: Record<string, (body: Obj, text: string) => void>, pad: number): Uint8Array {
    const text = 'x'.repeat(pad)
    const seen = new Set<string>()
    const out = goldenEntries(file).map((entry) => {
        const key = getColdStorageBackupKey(entry.name)
        const edit = key === null ? undefined : pads[key]
        if (key === null || edit === undefined) {
            return binEntry(entry.name, entry.data)
        }
        seen.add(key)
        const body = JSON.parse(new TextDecoder().decode(entry.data)) as Obj
        edit(body, text)
        return binEntry(entry.name, new TextEncoder().encode(JSON.stringify(body)))
    })
    expect([...seen].sort()).toEqual(Object.keys(pads).sort())
    return binOf(...out)
}

const padStubCharacter = (body: Obj, text: string): void => {
    const chats = (body.character as { chats: { message: { data: string }[] }[] }).chats
    chats[0].message[0].data = text
}
const padChatUnit = (body: Obj, text: string): void => {
    ;(body.message as { data: string }[])[0].data = text
}

/** The sizes the size sentence and the long tail key on, read from the file's own entries and not from the code under test. */
function measure(bytes: Uint8Array) {
    const entries = parseEntries(bytes)
    const database = entries.filter((entry) => entry.name === 'database.risudat').at(-1)
    if (database === undefined) {
        throw new Error('the file holds no database entry')
    }
    const unitBytes = entries.filter((entry) => getColdStorageBackupKey(entry.name) !== null).reduce((total, entry) => total + entry.data.length, 0)
    const assetOnlyBytes = bytes.length - database.data.length - unitBytes
    // Units count at a quarter in the figure shown, which is in decimal megabytes.
    const weightedBytes = database.data.length + unitBytes / 4
    return { entryCount: entries.length, databaseBytes: database.data.length, unitBytes, assetOnlyBytes, weightedBytes, databaseClassMegabytes: Math.ceil(weightedBytes / 1_000_000) }
}

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

async function pickAtBoot(target: BootImportTarget, bytes: Uint8Array) {
    const { loadBackupAtBoot } = await import('src/ts/drive/backuplocal')
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
        const ended = loadBackupAtBoot(target)
        const chosen = input as HTMLInputElement | null
        if (chosen === null) {
            throw new Error('loadBackupAtBoot did not create a file input')
        }
        Object.defineProperty(chosen, 'files', { value: [new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')], configurable: true })
        await (chosen.onchange as unknown as (event: Event) => Promise<void>).call(chosen, new Event('change'))
        return await ended
    } finally {
        spy.mockRestore()
    }
}

/**
 * The stub-form file of the real exporter: the padded `fork-full.bin` is imported on a store2 page, the page is booted
 * again over what the import committed, and `SaveLocalBackup({ mode: 'stub' })` writes the file.
 */
async function exportStubFile(): Promise<Uint8Array> {
    osBox.os = 'other'
    const page = await openPage()
    answer(page, true)
    await loadBin(paddedGolden('fork-full.bin', { [ID.stubBlob]: padStubCharacter }, 18 * MIB))
    expect(alertErrorTexts(page)).toEqual([])
    const boot = await bootThroughDispatch(page.kit.counted.backend)
    if (boot.result.kind !== 'store2') {
        throw new Error(`the boot after the import came to ${boot.result.kind}`)
    }
    h.db = boot.result.database as unknown as Obj
    const { SaveLocalBackup } = await import('src/ts/drive/backuplocal')
    const streamSaver = (await import('src/ts/vendor/streamSaver')).default
    const written: Uint8Array[] = []
    vi.spyOn(streamSaver, 'createWriteStream').mockImplementation((() => ({
        ready: Promise.resolve(),
        writable: { getWriter: () => ({ write: async (chunk: Uint8Array) => { written.push(chunk.slice()) }, close: async () => { } }) },
    })) as never)
    const outcome = await SaveLocalBackup({ mode: 'stub' }) as { status: string }
    expect(outcome.status).not.toBe('failed')
    const bytes = binOf(...written)
    // The producer's own import asked its questions on this page; the tests below read only their own.
    vi.mocked(page.alert.alertConfirm).mockClear()
    worlds.parkAll()
    return bytes
}

let stubFile: Uint8Array | null = null
async function stubFileOnce(): Promise<Uint8Array> {
    stubFile ??= await exportStubFile()
    return stubFile
}

function expectStubShape(bytes: Uint8Array) {
    const sizes = measure(bytes)
    // The base weighs the units in full: the whole sum is over the threshold and the weighted sum is not, so the base fails on the extra prompt.
    expect(sizes.databaseBytes).toBeLessThanOrEqual(16 * MIB)
    expect(sizes.databaseBytes + sizes.unitBytes).toBeGreaterThan(16 * MIB)
    expect(sizes.weightedBytes).toBeLessThanOrEqual(16 * MIB)
    expect(parseEntries(bytes).some((entry) => entry.name.startsWith('coldstorage_'))).toBe(true)
    return sizes
}

describe('the import questions of a stub-form file written by the real exporter', () => {
    test('new behaviour: a quarter of the unit entries keeps the weighted sum within 16 MiB, so no size question is asked', async () => {
        const bytes = await stubFileOnce()
        expectStubShape(bytes)
        const page = await openPage()
        answer(page, false)

        await loadBin(bytes)

        expect(confirmTexts(page)).toEqual([])
    })

    test('new behaviour: on Android the time notice has no database sentence, and the minutes still follow the whole unit entries', async () => {
        const bytes = await stubFileOnce()
        const sizes = expectStubShape(bytes)
        const page = await openPage()
        answer(page, false)
        osBox.os = 'android'

        await loadBin(bytes)

        // About 19 MB of units at 4.4 MB/s plus the long tail is 8 minutes, rounded to 10; the short tail would give 5. The estimate
        // is the same as with the units weighed in full, so this pins that the weight does not reach the time estimate (the minutes
        // part passes before and after the change; the null database sentence is red on the base).
        expect(confirmTexts(page)).toEqual([language.store2ImportTimeWarning(sizes.entryCount, 10, 0.6, null)])
    })

    test('new behaviour: unit bytes stay in the asset bytes, so a threshold between the asset-only and the asset-plus-unit bytes gives the time notice', async () => {
        const bytes = await stubFileOnce()
        const sizes = expectStubShape(bytes)
        thresholdBox.bytes = sizes.assetOnlyBytes + 1024
        expect(sizes.assetOnlyBytes + 1024).toBeLessThan(sizes.assetOnlyBytes + sizes.unitBytes)
        const page = await openPage()
        answer(page, false)
        osBox.os = 'android'

        await loadBin(bytes)

        expect(confirmTexts(page)).toEqual([language.store2ImportTimeWarning(sizes.entryCount, 10, 0.6, null)])
    })

    test('new behaviour: a threshold above the asset-plus-unit bytes asks nothing on Android', async () => {
        const bytes = await stubFileOnce()
        expectStubShape(bytes)
        thresholdBox.bytes = bytes.length
        const page = await openPage()
        answer(page, false)
        osBox.os = 'android'

        await loadBin(bytes)

        expect(confirmTexts(page)).toEqual([])
    })
})

describe('the import questions of an upstream-layout file built by hand', () => {
    const upstreamFile = () => paddedGolden('upstream-full.bin', { [ID.stubBlob]: padStubCharacter, [ID.inlineChatUnit]: padChatUnit }, 36 * MIB)

    test('new behaviour: the size sentence shows the database plus a quarter of the units in decimal megabytes, and accepting imports the file', async () => {
        const bytes = upstreamFile()
        const sizes = measure(bytes)
        expect(sizes.databaseBytes).toBeLessThanOrEqual(16 * MIB)
        expect(sizes.weightedBytes).toBeGreaterThan(16 * MIB)
        const page = await openPage()
        answer(page, true)

        await loadBin(bytes)

        expect(confirmTexts(page)).toEqual([language.store2ImportSizeWarning(sizes.databaseClassMegabytes, true)])
        expect(alertErrorTexts(page)).toEqual([])
    })

    test('new behaviour: the boot import asks the same question, and a decline ends cancelled with the installer never called', async () => {
        const bytes = upstreamFile()
        const sizes = measure(bytes)
        const page = await openBoot()
        answer(page, false)
        const installs: unknown[] = []
        const target: BootImportTarget = {
            readColdStorageItem: async () => ({ status: 'missing' }),
            async install(source) {
                installs.push(source)
                return { status: 'blocked', reason: 'install-failed', detail: 'recorded' }
            },
        }

        const end = await pickAtBoot(target, bytes)

        expect(confirmTexts(page)).toEqual([language.store2ImportSizeWarning(sizes.databaseClassMegabytes, true)])
        expect(end).toEqual({ kind: 'cancelled' })
        expect(installs).toEqual([])
    })

    test('new behaviour: on Android the time notice shows the weighted decimal figure, and the minutes follow the whole sum', async () => {
        const bytes = upstreamFile()
        const sizes = measure(bytes)
        thresholdBox.bytes = sizes.assetOnlyBytes + 1024
        const page = await openPage()
        answer(page, false)
        osBox.os = 'android'

        await loadBin(bytes)

        // 72 MiB of units at 4.2 MiB/s plus the long tail is about 8.4 minutes, rounded to 10; the free space is sized from the asset bytes, which include the units.
        expect(confirmTexts(page)).toEqual([language.store2ImportTimeWarning(sizes.entryCount, 10, 0.7, sizes.databaseClassMegabytes)])
    })

    test('guard: a file without unit entries and a small database entry asks nothing', async () => {
        const page = await openPage()
        answer(page, false)

        await loadBin(binOf(binEntry('asset.png', new Uint8Array(2000)), binEntry('database.risudat', new Uint8Array(100))))

        expect(confirmTexts(page)).toEqual([])
    })
})
