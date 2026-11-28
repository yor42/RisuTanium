/**
 * T14a, class CG (compatibility guard; it passes before and after the S6a field edits and pins the upstream shape): a
 * character's `customscript` and a module's `regex` list, edited through the real Studio history service, go through the
 * real `SaveLocalBackup({mode:'inline'})` and the real `LoadLocalBackup` and come back deep-equal to the edited lists.
 * The lists hold an upstream entry with an unknown key (`x_future`), a malformed row (a number in `in`, class M-a) and a
 * `null` element; the editor refuses the malformed row and leaves the null element where it is.
 *
 * Scope: no upstream code runs, so a pass says the fork's own export and import keep the list as the editor left it, which
 * is what an upstream reader of the same bytes sees. It says nothing about the Tauri or Node backends or a real download.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { savedDatabase, startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Database } from 'src/ts/storage/database.svelte'
import type { OwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import type { OwnerKey } from 'src/ts/studio/history/ownerPhase'
import { createFakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'
import { regexAdd, regexCustomFlag, regexDelete, regexDuplicate, regexFieldEdit, regexFlagEdit, regexMove, regexStageEdit, type RegexOp } from '../regexListOps'

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
    vi.doMock('src/ts/persona', () => ({ changeUserPersona: vi.fn() }))
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

type Entry = Record<string, unknown> | null

const CHA = 'alpha'
const MOD = 'mod-1'

/** An upstream entry with an unknown key, a malformed row (M-a: a number in `in`), a null element and a `RegexData` entry. */
const startList = (): Entry[] => [
    { comment: 'up', in: 'a', out: 'b', type: 'editinput', x_future: { a: 1, b: ['c'] } },
    { comment: 'malformed', in: 123, out: 'b', type: 'editinput' },
    null,
    { comment: 'flagged', in: 'x', out: 'y', type: 'editoutput', flag: 'gi', ableFlag: false },
]

/** The list after the edits `editList` makes: the malformed row and the null element are untouched. */
const editedList = (): Entry[] => [
    { comment: 'up', in: 'a', out: 'edited out', type: 'editdisplay', x_future: { a: 1, b: ['c'] } },
    { comment: 'malformed', in: 123, out: 'b', type: 'editinput' },
    null,
    { comment: 'flagged', in: 'x', out: 'y', type: 'editoutput', flag: 'gim', ableFlag: true },
]

/** The list after `editList` and then the list operations: a duplicate of row 0, a move of the flagged row to the top, a delete of the malformed row, an add. */
const listOpsList = (): Entry[] => {
    const [up, malformed, nothing, flagged] = editedList()
    void malformed
    return [flagged, up, structuredClone(up), nothing, { comment: '', in: '', out: '', type: 'editinput' }]
}

function seed(): Record<string, unknown> {
    const db = makeDb('base', [CHA])
    ;(db.characters as Record<string, unknown>[])[0].customscript = startList()
    db.modules = [{ id: MOD, name: 'Module', description: '', regex: startList() }]
    return db
}

/** Edits through the real service: two landed rows, and the malformed row refused. */
function editList(service: OwnerHistoryService, owner: OwnerKey, withListOps: boolean): void {
    const run = (op: RegexOp) => service.objEdit(owner, op.build)
    expect(run(regexFieldEdit(0, 'out', 'edited out', null))).toEqual({ ok: true })
    expect(run(regexStageEdit(0, 'editdisplay'))).toEqual({ ok: true })
    expect(run(regexCustomFlag(3, true))).toEqual({ ok: true })
    expect(run(regexFlagEdit(3, (flag) => flag + 'm', null))).toEqual({ ok: true })
    expect(run(regexFieldEdit(1, 'out', 'refused', null))).toMatchObject({ ok: false, reason: 'precondition' })
    expect(run(regexFieldEdit(2, 'out', 'refused', null))).toMatchObject({ ok: false, reason: 'precondition' })
    if (!withListOps) return
    const rows = editedList()
    expect(run(regexDuplicate(rows[0], 0))).toEqual({ ok: true })
    expect(run(regexMove(rows[3], 4, 'top'))).toEqual({ ok: true })
    expect(run(regexDelete(rows[1], 3))).toEqual({ ok: true })
    expect(run(regexAdd())).toEqual({ ok: true })
}

interface Trip {
    /** The fork export's database entry, decoded. */
    exported: Database
    /** The tree the real import committed, every entity assembled whole. */
    saved: Database
    /** The page's lists as they stood after the edits. */
    pageCharacter: unknown
    pageModule: unknown
}

async function trip(withListOps = false, importFile: Uint8Array | null = null): Promise<Trip> {
    const locks = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(locks, 'this'), configurable: true })
    h.db = seed()
    const k: Store2Kit = await startStore2({ db: h.db as unknown as Database })
    const w: World = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Record<string, unknown>
    const bootActive = await import('src/ts/storage/store2/bootActive')
    bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer: k.committer } as unknown as Store2Session)
    w.pageMode.setPageStorageMode({ kind: 'store2' })
    const alertWithoutNotice = await import('src/ts/alert')
    vi.doMock('src/ts/alert', () => ({ ...alertWithoutNotice, waitUnreadNotice: async () => { } }))
    vi.mocked(alertWithoutNotice.alertConfirm).mockImplementation(async () => true)
    vi.spyOn(alertWithoutNotice.alertStore, 'set').mockImplementation(() => { })
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => { })
    w.start()
    await sleepReal(150)
    await settled(w)

    // The edits go through the real service over the page's live database, as the Studio form's builders do.
    // The service modules load after the store replacement above, so they read this page's `DBState` and `selIdState`.
    ;(stores.selIdState as { selId: number }).selId = 0
    const { studioScreen } = await import('src/ts/studio/studioScreen.svelte')
    studioScreen.chaId = CHA
    const { createOwnerHistoryService } = await import('src/ts/studio/history/ownerHistory.svelte')
    const { characterOwnerKey, moduleOwnerKey } = await import('src/ts/studio/history/ownerPhase')
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        openModuleId: () => MOD,
    })
    await service.whenReady(characterOwnerKey(CHA))
    await service.whenReady(moduleOwnerKey(MOD))
    editList(service, characterOwnerKey(CHA), withListOps)
    editList(service, moduleOwnerKey(MOD), withListOps)
    if (importFile !== null) {
        const { runRegexImport } = await import('../regexFileActions')
        for (const owner of [characterOwnerKey(CHA), moduleOwnerKey(MOD)]) {
            await runRegexImport(() => true, (op) => service.objEdit(owner, op.build), {
                pick: async () => ({ name: 'regex.json', data: importFile }),
                toast: () => { },
            })
        }
    }
    const live = h.db as unknown as { characters: { customscript: unknown }[]; modules: { regex: unknown }[] }
    const pageCharacter = JSON.parse(JSON.stringify(live.characters[0].customscript))
    const pageModule = JSON.parse(JSON.stringify(live.modules[0].regex))

    const { LoadLocalBackup, SaveLocalBackup } = await import('src/ts/drive/backuplocal')
    const { decodeRisuSave } = await import('src/ts/storage/risuSave')
    const streamSaver = (await import('src/ts/vendor/streamSaver')).default
    const written: Uint8Array[] = []
    vi.spyOn(streamSaver, 'createWriteStream').mockImplementation((() => ({
        ready: Promise.resolve(),
        writable: { getWriter: () => ({ write: async (chunk: Uint8Array) => { written.push(chunk.slice()) }, close: async () => { } }) },
    })) as never)
    await SaveLocalBackup({ mode: 'inline' })
    const bytes = concat(written)
    const entries = parseEntries(bytes)
    const database = entries.find((entry) => entry.name === 'database.risudat')
    if (database === undefined) {
        throw new Error('The export holds no database entry.')
    }
    const exported = await decodeRisuSave(database.data) as unknown as Database

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
    return { exported, saved: await savedDatabase(k.memory), pageCharacter, pageModule }
}

describe('T14a (class CG) edited regex lists through the real .bin export and import', () => {
    test('the page lists hold the edits, the export holds them equal, and the import commits them equal', async () => {
        const result = await trip()
        expect(result.pageCharacter).toEqual(editedList())
        expect(result.pageModule).toEqual(editedList())

        const exportedCharacter = result.exported.characters.find((slot) => slot.chaId === CHA) as unknown as { customscript: unknown }
        const exportedModule = result.exported.modules.find((module) => module.id === MOD) as unknown as { regex: unknown }
        expect(exportedCharacter.customscript).toEqual(editedList())
        expect(exportedModule.regex).toEqual(editedList())

        const savedCharacter = result.saved.characters.find((slot) => slot.chaId === CHA) as unknown as { customscript: unknown }
        const savedModule = result.saved.modules.find((module) => module.id === MOD) as unknown as { regex: unknown }
        expect(savedCharacter.customscript).toEqual(editedList())
        expect(savedModule.regex).toEqual(editedList())
    })
})

describe('T14b (class CG) add, duplicate, move and delete through the real .bin export and import', () => {
    test('the page lists, the export and the import hold the same list, with the deleted row gone and the others unchanged', async () => {
        const result = await trip(true)
        expect(result.pageCharacter).toEqual(listOpsList())
        expect(result.pageModule).toEqual(listOpsList())
        const exportedCharacter = result.exported.characters.find((slot) => slot.chaId === CHA) as unknown as { customscript: unknown }
        const exportedModule = result.exported.modules.find((module) => module.id === MOD) as unknown as { regex: unknown }
        expect(exportedCharacter.customscript).toEqual(listOpsList())
        expect(exportedModule.regex).toEqual(listOpsList())
        const savedCharacter = result.saved.characters.find((slot) => slot.chaId === CHA) as unknown as { customscript: unknown }
        const savedModule = result.saved.modules.find((module) => module.id === MOD) as unknown as { regex: unknown }
        expect(savedCharacter.customscript).toEqual(listOpsList())
        expect(savedModule.regex).toEqual(listOpsList())
    })
})

/** The bytes `exportRegex` writes (`{type:'regex', data}` as UTF-8 JSON), built the same way: the harness has no download. */
const importedFile = (): Uint8Array => new TextEncoder().encode(JSON.stringify({ type: 'regex', data: importedEntries() }))

/** Two upstream-shaped entries: one with an unknown key and one with a stage this build does not know. */
const importedEntries = (): Entry[] => [
    { comment: 'imp1', in: 'a', out: 'b', type: 'editinput', x_future: { k: [1, 'two'] } },
    { comment: 'imp2', in: 'c', out: 'd', type: 'edit_future' },
]

describe('T14c (class CG) a Studio import through the real .bin export and import', () => {
    test('the imported entries, unknown key and unknown stage included, follow the edited list in the export and in the import', async () => {
        const result = await trip(false, importedFile())
        const expected = [...editedList(), ...importedEntries()]
        expect(result.pageCharacter).toEqual(expected)
        expect(result.pageModule).toEqual(expected)
        const exportedCharacter = result.exported.characters.find((slot) => slot.chaId === CHA) as unknown as { customscript: unknown }
        const exportedModule = result.exported.modules.find((module) => module.id === MOD) as unknown as { regex: unknown }
        expect(exportedCharacter.customscript).toEqual(expected)
        expect(exportedModule.regex).toEqual(expected)
        const savedCharacter = result.saved.characters.find((slot) => slot.chaId === CHA) as unknown as { customscript: unknown }
        const savedModule = result.saved.modules.find((module) => module.id === MOD) as unknown as { regex: unknown }
        expect(savedCharacter.customscript).toEqual(expected)
        expect(savedModule.regex).toEqual(expected)
    })
})
