/**
 * The measurement notes of a local `.bin` export (`describeReadMeasure` and `describeWriteMeasure` in
 * `drive/backuplocal.ts`, `takeExportWriteStats`, `takeStubReadStats`, `takeRangeReadStats`) on a Tauri-shaped writer.
 *
 * Vitest runs as a measurement build (`MEASURE` is true), and a note reaches the `__risuImportPhases` ring only when
 * `risu-measure-import` is `on`. The clocks of the three recorders are the tests' own, so the figures are exact. The
 * Tauri file system is a mock that copies every `writeFile` argument at call time (the writer reuses its buffer); a pass
 * here is not evidence about the native writer, the Android bridge or the phone.
 *
 * Labels in the titles:
 * - `new behaviour`: exercises notes that exist only with this change; its failure modes are shown by mutating the
 *   implementation, not by being red on an earlier base (the fields do not exist there).
 * - `guard`: holds with and without the notes.
 *
 * The harness is the one `exportStubForm.test.ts` documents, with `isTauri` on and `uuid` made deterministic.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: true }
})

/** Every `writeFile` call the Tauri writer made, copied at call time. */
const fsBox = vi.hoisted(() => ({ calls: [] as Array<{ append: boolean, data: Uint8Array }> }))

/** A deterministic `uuid` v4: the same sequence after `reset`, so two exports of one page are comparable byte for byte. */
const uuidBox = vi.hoisted(() => {
    let next = 0
    return {
        reset: () => { next = 0 },
        v4: () => `00000000-0000-4000-8000-${(next++).toString(16).padStart(12, '0')}`,
    }
})

const forageKeysMock = vi.hoisted(() => vi.fn(async (): Promise<string[]> => []))
const forageGetItemMock = vi.hoisted(() => vi.fn(async (_key: string): Promise<Uint8Array | null> => null))
const forageSetItemMock = vi.hoisted(() => vi.fn(async (_key: string, _data: Uint8Array): Promise<void> => {}))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const alertConfirmMock = vi.hoisted(() => vi.fn(async (_message: string) => true))
const alertErrorMock = vi.hoisted(() => vi.fn())
const alertMdMock = vi.hoisted(() => vi.fn())
const alertNormalMock = vi.hoisted(() => vi.fn())
const saveDialogMock = vi.hoisted(() => vi.fn(async (): Promise<string | null> => 'backup-output.bin'))

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

vi.mock('uuid', async (importOriginal) => ({
    ...(await importOriginal<typeof import('uuid')>()),
    v4: uuidBox.v4,
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformBox.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0, Download: 1 },
    writeFile: vi.fn(async (_path: string, data: Uint8Array, options?: { append?: boolean }) => {
        fsBox.calls.push({ append: options?.append === true, data: data.slice() })
    }),
    readFile: vi.fn(async () => {
        throw new Error('the Tauri backend is not under test')
    }),
    readDir: vi.fn(async () => []),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => { }),
    remove: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: saveDialogMock,
}))

vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: {
                getWriter: () => ({
                    write: async () => { throw new Error('the browser writer is not under test') },
                    close: async () => { },
                }),
            },
        }),
    },
}))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: getDatabaseMock,
    setDatabase: vi.fn(),
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

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: alertConfirmMock,
    alertError: alertErrorMock,
    alertWait: vi.fn(),
    alertMd: alertMdMock,
    alertNormal: alertNormalMock,
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
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
    invoke: vi.fn(async () => undefined),
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
        realStorage: unknown = undefined
        getItem = forageGetItemMock
        setItem = forageSetItemMock
        keys = forageKeysMock
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

//#endregion

//#region units and the legacy OPFS stand-in

const unitMem = new Map<string, Uint8Array>()

function isUnitKey(key: string): boolean {
    return key.startsWith('coldstorage/')
}

class MockNotFoundError extends Error {
    name = 'NotFoundError'
}

const mockDirectoryHandle = {
    async getFileHandle(name: string) {
        throw new MockNotFoundError("not found: " + name)
    },
    async removeEntry() { },
    entries() {
        return {
            [Symbol.asyncIterator]() {
                return {
                    async next() {
                        return { done: true as const, value: undefined }
                    },
                }
            },
        }
    },
}
Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    value: {
        getDirectory: async () => mockDirectoryHandle,
    },
})

//#endregion

import { SaveLocalBackup, SavePartialLocalBackup, type BackupExportOptions } from 'src/ts/drive/backuplocal'
import { setStubReadClockForTest } from 'src/ts/drive/exportInline'
import { resetExportWriteStatsForTest, setExportWriteClockForTest } from 'src/ts/exportWriters'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { setRangeReadClockForTest } from 'src/ts/storage/tauriByteTransport'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { assembleCharacter, assembleDatabase, stubFromEntry } from 'src/ts/storage/store2/codec'
import { previousOfTree } from 'src/ts/storage/store2/previousOfTree'
import { createResidency } from 'src/ts/storage/store2/residency'
import { registerResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { createSaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { createClock, seedTree, testEnv } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall, fakeLists, seededEnv, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'

//#region helpers

const NOW = 1_700_000_000_000
const MIB = 1024 * 1024
const MEASURE_KEY = 'risu-measure-import'

interface PhaseRing {
    snapshot(): Array<{ phase: string }>
    reset(): void
}

const ring = (): PhaseRing | undefined => (globalThis as { __risuImportPhases?: PhaseRing }).__risuImportPhases

/** The phase notes since the ring was last reset. */
const notes = (): string[] => ring()?.snapshot().map((record) => record.phase) ?? []

/** The one note that starts with `prefix`, whole. */
function noteOf(prefix: string): string {
    const found = notes().filter((note) => note.startsWith(prefix))
    if (found.length !== 1) {
        throw new Error(`expected one note starting "${prefix}", found ${found.length} among ${JSON.stringify(notes())}`)
    }
    return found[0]
}

/** `name=value` of a note as a number. */
function numberIn(note: string, name: string): number {
    const match = new RegExp(`(?:^| )${name}=(-?[0-9.]+)`).exec(note)
    if (match === null) {
        throw new Error(`"${note}" has no ${name}`)
    }
    return Number(match[1])
}

/** The per-call list of a note: `bytes:syncMs:waitMs` with `:new` on the call that created the file. */
function callsIn(note: string): Array<{ bytes: number, syncMs: number, waitMs: number, created: boolean }> {
    const match = /writeList=(\S*)/.exec(note)
    if (match === null) {
        throw new Error(`"${note}" has no writeList`)
    }
    return match[1] === '' ? [] : match[1].split(',').map((item) => {
        const [bytes, syncMs, waitMs, flag] = item.split(':')
        return { bytes: Number(bytes), syncMs: Number(syncMs), waitMs: Number(waitMs), created: flag === 'new' }
    })
}

/** A clock that reads 1, 2, 3, ... */
function counting(): () => number {
    let at = 0
    return () => ++at
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

/** The file the Tauri writer produced: every call's bytes in order. */
const fileOfCalls = (): Uint8Array => concat(fsBox.calls.map((call) => call.data))

/** The summed length of the bodies of the stub unit entries (`coldstorage_<uuid>.json`) of a container. */
function unitBodyBytes(file: Uint8Array): number {
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
    let total = 0
    let offset = 0
    while (offset + 4 <= file.length) {
        const nameLength = view.getUint32(offset, true)
        offset += 4
        const name = new TextDecoder().decode(file.subarray(offset, offset + nameLength))
        offset += nameLength
        const dataLength = view.getUint32(offset, true)
        offset += 4 + dataLength
        if (/^coldstorage_[0-9a-f-]{36}\.json$/.test(name)) {
            total += dataLength
        }
    }
    return total
}

/** msgpackr 1.10.1 under Node rejects strings of 64 or more characters (the goldens README records it), so the fixture keeps them short. */
function shortened(value: unknown): unknown {
    if (typeof value === 'string') {
        return value.slice(0, 50)
    }
    if (Array.isArray(value)) {
        return value.map(shortened)
    }
    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shortened(inner)]))
    }
    return value
}

/**
 * A store2 page of three characters: the first resident, the other two stubs of their entities. `grow` makes the first
 * chat of a character at least that many bytes of JSON by repeating its first message (short strings only).
 */
async function pageOf(grow: Record<number, number> = {}): Promise<MemoryBackend> {
    const memory = createMemoryBackend()
    const clock = createClock()
    const env = testEnv(clock, 4242)
    const fixture = { ...(shortened(buildSmall(3)) as Obj), archiveCharacters: true } as unknown as Database
    for (const [index, bytes] of Object.entries(grow)) {
        const firstChat = ((fixture.characters[Number(index)] as unknown as Obj).chats as Obj[])[0]
        const messages = firstChat.message as Obj[]
        const template = JSON.stringify(messages[0])
        const extra = Math.ceil(bytes / template.length)
        for (let i = 0; i < extra; i++) {
            messages.push(JSON.parse(template) as Obj)
        }
    }
    const seeded = await seedTree(memory, JSON.parse(JSON.stringify(fixture)) as Database, env, fakeLists)
    const residentId = (fixture.characters[0] as unknown as Obj).chaId
    const read = await readTreeBytes(memory, seeded.manifestKey, {
        resident: (input) => new Set(input.entries.filter((entry) => entry.chaId === residentId).map((entry) => entry.u)),
    })
    if (read.status !== 'ok') {
        throw new Error(`The seeded tree read ${read.status}.`)
    }
    const db = assembleDatabase(read.tree.manifest, read.tree.source, {
        character: (entry, units) => (entry.chaId === residentId ? assembleCharacter(entry, units) : stubFromEntry(entry)),
    })
    const previous = previousOfTree(read.tree)
    const context = { lists: fakeLists, env: seededEnv(77), encoder: createSaveEncoder({ previous, lists: fakeLists, env: seededEnv(77), now: () => NOW }) }
    registerResidency(createResidency({ backend: memory, context }))
    getDatabaseMock.mockImplementation(() => db)
    return memory
}

const STUB: BackupExportOptions = { mode: 'stub' }

// Two stubs: one of 1 MiB or more, one over 4 MiB, so the writer makes several calls (the larger body goes out directly).
const GROWN = { 1: 1.2 * MIB, 2: 4.6 * MIB }

//#endregion

beforeEach(() => {
    platformBox.isTauri = true
    fsBox.calls.length = 0
    uuidBox.reset()
    unitMem.clear()
    forageKeysMock.mockReset()
    forageGetItemMock.mockReset()
    forageSetItemMock.mockClear()
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    alertErrorMock.mockClear()
    alertMdMock.mockClear()
    alertNormalMock.mockClear()
    saveDialogMock.mockReset()
    saveDialogMock.mockImplementation(async () => 'backup-output.bin')
    resetResidencyForTest()
    resetExportWriteStatsForTest()
    forageKeysMock.mockImplementation(async () => [])
    forageGetItemMock.mockImplementation(async () => null)
    forageSetItemMock.mockImplementation(async () => { })
    injectAppStore(createForageBackedStore({
        getItem: async (key) => (isUnitKey(key) ? (unitMem.get(key) ?? null) : forageGetItemMock(key)),
        setItem: async (key, value) => {
            if (isUnitKey(key)) {
                unitMem.set(key, value)
                return
            }
            await forageSetItemMock(key, value)
        },
        keys: async () => [...(await forageKeysMock()), ...unitMem.keys()],
        removeItem: async (key) => { unitMem.delete(key) },
    }))
    getDatabaseMock.mockImplementation(() => ({}) as unknown as Database)
    ring()?.reset()
    localStorage.removeItem(MEASURE_KEY)
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'info').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
})

afterEach(() => {
    setExportWriteClockForTest(null)
    setStubReadClockForTest(null)
    setRangeReadClockForTest(null)
    localStorage.removeItem(MEASURE_KEY)
    resetResidencyForTest()
    vi.restoreAllMocks()
})

describe('SaveLocalBackup measurement notes', () => {
    test('new behaviour: the cold-collected note carries the stub read split, and the three write notes carry the exact calls the file system saw', async () => {
        await pageOf(GROWN)
        localStorage.setItem(MEASURE_KEY, 'on')
        setExportWriteClockForTest(counting())
        setStubReadClockForTest(counting())
        setRangeReadClockForTest(counting())

        const outcome = await SaveLocalBackup(STUB)

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        // Two stubs, each read and encoded between two readings of the test's clock: one millisecond each.
        const collected = noteOf('export cold collected')
        expect(numberIn(collected, 'stubChars')).toBe(2)
        expect(numberIn(collected, 'stubReadMs')).toBe(2)
        expect(numberIn(collected, 'stubEncodeMs')).toBe(2)
        expect(numberIn(collected, 'stubEncodeMsMax')).toBe(1)
        // The raw figure is the bodies the file carries; the grown characters repeat one message, so they pack far smaller.
        const rawWritten = unitBodyBytes(fileOfCalls())
        expect(rawWritten).toBeGreaterThan(5 * MIB)
        expect(numberIn(collected, 'stubRawBytes')).toBe(rawWritten)
        expect(numberIn(collected, 'stubPackedBytes')).toBeGreaterThan(0)
        expect(numberIn(collected, 'stubPackedBytes')).toBeLessThan(rawWritten / 2)
        // The memory backend makes no read_range invoke.
        for (const name of ['rangeReads', 'rangeMs', 'rangeWallMs', 'store2Reads', 'store2Ms']) {
            expect(numberIn(collected, name), name).toBe(0)
        }

        // The notes after the encode partition the writes: their lists, joined, are the calls the mock saw, in order.
        const stubAndLate = noteOf('export stub and late payloads done')
        const written = noteOf('export database written')
        const closed = noteOf('export closed')
        const listed = [stubAndLate, written, closed].flatMap(callsIn)
        expect(listed.map((call) => call.bytes)).toEqual(fsBox.calls.map((call) => call.data.length))
        expect(fsBox.calls.length).toBeGreaterThanOrEqual(3)
        expect(listed.map((call) => call.created)).toEqual(fsBox.calls.map((call) => !call.append))
        expect(listed.filter((call) => call.created)).toHaveLength(1)
        // Each call took one reading to return its promise and one more to settle.
        expect(listed.every((call) => call.syncMs === 1 && call.waitMs === 1)).toBe(true)
        for (const [name, total] of [
            ['writeCalls', fsBox.calls.length],
            ['writeBytes', fsBox.calls.reduce((n, call) => n + call.data.length, 0)],
            ['writeSyncMs', fsBox.calls.length],
            ['writeWaitMs', fsBox.calls.length],
            ['writeCreates', 1],
        ] as const) {
            expect([stubAndLate, written, closed].reduce((n, note) => n + numberIn(note, name), 0), name).toBe(total)
        }
        // The body over 4 MiB was written in more than one call, so the first note alone holds several.
        expect(numberIn(stubAndLate, 'writeCalls')).toBeGreaterThanOrEqual(2)
    }, 120_000)

    test('new behaviour: the stub read figures cover this export only, even after a partial export that takes none', async () => {
        await pageOf()
        localStorage.setItem(MEASURE_KEY, 'on')
        setStubReadClockForTest(counting())

        expect((await SavePartialLocalBackup(STUB)).status).toBe('saved')
        ring()?.reset()
        expect((await SaveLocalBackup(STUB)).status).toBe('saved')

        expect(numberIn(noteOf('export cold collected'), 'stubChars')).toBe(2)
    }, 120_000)

    test('new behaviour: with the key off nothing is noted, and the export still saves', async () => {
        await pageOf()

        const outcome = await SaveLocalBackup(STUB)

        expect(outcome.status).toBe('saved')
        expect(notes()).toEqual([])
    }, 120_000)

    test('new behaviour: a recorder whose clock throws never fails the export: it saves, and the notes carry no figures', async () => {
        await pageOf(GROWN)
        localStorage.setItem(MEASURE_KEY, 'on')
        const failing = () => { throw new Error('the clock failed') }
        setExportWriteClockForTest(failing)
        setStubReadClockForTest(failing)
        setRangeReadClockForTest(failing)

        const outcome = await SaveLocalBackup(STUB)

        expect(outcome).toMatchObject({ status: 'saved', notices: [] })
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(fsBox.calls.length).toBeGreaterThanOrEqual(3)
        const collected = noteOf('export cold collected')
        expect(numberIn(collected, 'stubReadMs')).toBe(0)
        expect(numberIn(collected, 'stubEncodeMs')).toBe(0)
        expect(numberIn(collected, 'stubEncodeMsMax')).toBe(0)
        expect(numberIn(noteOf('export closed'), 'writeCalls')).toBe(0)
    }, 120_000)

    test('guard: the file is byte for byte the same with the measurement key on and off', async () => {
        await pageOf(GROWN)

        uuidBox.reset()
        expect((await SaveLocalBackup(STUB)).status).toBe('saved')
        const without = fileOfCalls()
        expect(notes()).toEqual([])

        fsBox.calls.length = 0
        uuidBox.reset()
        localStorage.setItem(MEASURE_KEY, 'on')
        expect((await SaveLocalBackup(STUB)).status).toBe('saved')
        const withKey = fileOfCalls()
        expect(notes().length).toBeGreaterThan(0)

        expect(withKey.length).toBe(without.length)
        expect(Buffer.from(withKey).equals(Buffer.from(without))).toBe(true)
    }, 120_000)
})

describe('SavePartialLocalBackup', () => {
    test('guard: the partial export reads stubs through the same stats and still writes the same file with the key on and off', async () => {
        await pageOf(GROWN)

        uuidBox.reset()
        expect((await SavePartialLocalBackup(STUB)).status).toBe('saved')
        const without = fileOfCalls()

        fsBox.calls.length = 0
        uuidBox.reset()
        localStorage.setItem(MEASURE_KEY, 'on')
        expect((await SavePartialLocalBackup(STUB)).status).toBe('saved')

        expect(Buffer.from(fileOfCalls()).equals(Buffer.from(without))).toBe(true)
        expect(without.length).toBeGreaterThan(5 * MIB)
    }, 120_000)
})
