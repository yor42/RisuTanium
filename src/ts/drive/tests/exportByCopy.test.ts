/**
 * The export reads a module stub's stored copy and installs nothing (CHORE-205 L3 stage S4d-1b, MC-647). Every row boots a
 * real store2 page through the real dispatch (a real residency over a memory backend, the real loader registered) and runs
 * the real `SaveLocalBackup`, `SavePartialLocalBackup` or `exportThisTabBackup`. Mocked storage says nothing about a
 * native backend.
 *
 * Labels in the titles: R rows reproduce the defect and fail on the base (the export installed every stub, needed a
 * loader, asked the lorebook question or exported a module that moved after the call); M rows pin the new error table
 * and are new behaviour; G rows are compatibility guards that pass before and after.
 *
 * `updateLorebooks` is the transforming mock of the loader's own tests: it sets `bookVersion = 2` in place. An identity
 * mock cannot show a migration, so a row about the unrepaired copy would pass vacuously under it.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => {
    // globalApi.svelte reads navigator.locks once at module evaluation; without it the backup paths take their no-Web-Locks branch.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    // The legacy OPFS stand-in: no legacy unit file exists, so every read falls through to "not found".
    class NotFoundError extends Error {
        name = 'NotFoundError'
    }
    Object.defineProperty(globalThis.navigator, 'storage', {
        configurable: true,
        value: {
            getDirectory: async () => ({
                async getFileHandle(name: string) {
                    throw new NotFoundError(`not found: ${name}`)
                },
                async removeEntry() { },
                entries: () => ({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true as const, value: undefined }) }) }),
            }),
        },
    })
    return {
        // A parser effect reads the live list as soon as it is imported, so the slot is never undefined.
        state: { db: { characters: [], modules: [] } } as { db: unknown },
        platform: { isTauri: false },
        sink: { writes: [] as Uint8Array[] },
    }
})

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
vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return h.platform.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))
vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0, Download: 1 },
    writeFile: vi.fn(async () => { }),
    readFile: vi.fn(async () => {
        throw new Error('the Tauri backend is not under test')
    }),
    readDir: vi.fn(async () => []),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => { }),
    remove: vi.fn(async () => { }),
}))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn(async () => { }) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(async () => 'backup-output.bin') }))
vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: {
                getWriter: () => ({
                    write: async (chunk: Uint8Array) => { h.sink.writes.push(chunk.slice()) },
                    close: async () => { },
                }),
            },
        }),
    },
}))
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: vi.fn((p: string) => p), invoke: vi.fn(async () => undefined) }))
vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn(async () => { }) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })),
}))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn(async () => new Response(null, { status: 404 })) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }))
vi.mock(import('src/ts/update'), () => ({ checkRisuUpdate: vi.fn(async () => { }) }))
vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({ loadPlugins: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/plugins/plugins.svelte'))
vi.mock(import('src/ts/characterCards'), () => ({ characterURLImport: vi.fn(), hubURL: 'https://example.invalid' }) as unknown as typeof import('src/ts/characterCards'))
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({ registerDbChangeEffects: vi.fn() }) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))
vi.mock(import('src/ts/gui/animation'), () => ({ updateAnimationSpeed: vi.fn() }) as unknown as typeof import('src/ts/gui/animation'))
vi.mock(import('src/ts/gui/colorscheme'), () => ({ updateColorScheme: vi.fn(), updateTextThemeAndCSS: vi.fn() }) as unknown as typeof import('src/ts/gui/colorscheme'))
vi.mock(import('src/ts/observer.svelte'), () => ({ startObserveDom: vi.fn() }) as unknown as typeof import('src/ts/observer.svelte'))
vi.mock(import('src/ts/gui/guisize'), () => ({ updateGuisize: vi.fn() }) as unknown as typeof import('src/ts/gui/guisize'))
vi.mock(import('src/ts/hotkey'), () => ({ initMobileGesture: vi.fn() }) as unknown as typeof import('src/ts/hotkey'))
vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        realStorage: unknown = undefined
        getItem = vi.fn(async () => null)
        setItem = vi.fn(async () => { })
        keys = vi.fn(async () => [])
        removeItem = vi.fn(async () => { })
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))
vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    waitAlert: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/alert'))
// The loader's own transforming migration: entries below book version 2 are changed in place, so a migration is visible.
vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((book: { bookVersion?: number }[]) => book.map((entry) => {
        if ((entry.bookVersion ?? 1) >= 2) {
            return entry
        }
        entry.bookVersion = 2
        return entry
    })),
}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/process/index.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return { doingChat: writable(false) } as unknown as typeof import('src/ts/process/index.svelte')
})
vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: h.state,
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
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/process/modules'), () => ({
    refreshModules: vi.fn(),
    bumpModuleGui: vi.fn(),
    moduleUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/process/modules'))

import type { Database } from 'src/ts/storage/database.svelte'
import { exportThisTabBackup, SaveLocalBackup, SavePartialLocalBackup } from 'src/ts/drive/backuplocal'
import { ExportModuleUnreadableError, type ExportModuleFailure } from 'src/ts/drive/exportModules'
import type { ExportOutcome } from 'src/ts/drive/operationEnd'
import { language } from 'src/lang'
import { alertConfirm, alertError, waitAlert } from 'src/ts/alert'
import { updateLorebooks } from 'src/ts/characters'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { bumpModuleGui, refreshModules } from 'src/ts/process/modules'
import { isBusy } from 'src/ts/process/memory/busyActions'
import { crc32 } from 'src/ts/storage/blockFrame'
import { decodeRisuSave } from 'src/ts/storage/risuSave'
import { isModuleStub } from 'src/ts/storage/moduleStub'
import { resetPageBlockOwnerForTests } from 'src/ts/storage/pageBlockOwner'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'
import { Store2BackendFailureError } from 'src/ts/storage/store2/backend/errors'
import { resetStore2BootForTest, type Store2BootResult } from 'src/ts/storage/store2/bootActive'
import { previousFrom } from 'src/ts/storage/store2/codec'
import { keyOfRef, type ModuleEntry } from 'src/ts/storage/store2/format'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
import { acquireModule, unregisterModuleLoader } from 'src/ts/storage/store2/moduleAcquire'
import { getResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { getActiveStore2Save, resetStore2SaveForTest } from 'src/ts/storage/store2/saveActive'
import { bootThroughDispatch, countedBackend, createClock, savedDatabase, seedTree, testEnv, type CountedBackend, type DispatchedBoot } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'

type Plain = Record<string, unknown>

interface Rig {
    counted: CountedBackend
    entries: ModuleEntry[]
    /** The seed as the plain assembler gives it back, before any boot. */
    seeded: Database
}

function moduleBody(id: string, extra: Obj = {}): Obj {
    return { id, name: `Module ${id}`, description: `about ${id}`, lorebook: [{ comment: 'c', content: `text ${id}`, key: 'k', alwaysActive: false, secondkey: '', selective: false, insertorder: 100, mode: 'normal', bookVersion: 2 }], regex: [], trigger: [], assets: [], ...extra }
}

/** Five modules; the global lists of `REFERENCING` keep `ida` and `idb` (by namespace) resident and leave three unreferenced. */
function fiveModules(): Obj[] {
    return [moduleBody('idc'), moduleBody('ida'), moduleBody('idd'), moduleBody('idb', { namespace: 'ns-a' }), moduleBody('ide')]
}

const REFERENCING: Obj = { enabledModules: ['ida'], moduleIntergration: 'ns-a' }
const UNREFERENCED = ['idc', 'idd', 'ide']

/** A lore entry as an older build stored it: no `bookVersion`. */
const OLD_LORE = { comment: 'c', content: 'old', key: 'k', alwaysActive: false, secondkey: '', selective: false, insertorder: 100, mode: 'normal' }

function plain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

/** msgpackr 1.10.1 under Node rejects strings of 64 or more characters, so the fixture keeps them short. */
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

function sourceOf(modules: Obj[], settings: Obj = {}): Database {
    return shortened({ ...(buildSmall(2) as unknown as Obj), archiveCharacters: true, enabledModules: [], moduleIntergration: '', modules, ...settings }) as Database
}

/** Seeds the source with the real list derivation (so its module entries are stub-eligible) into a counted backend. */
async function rigOf(modules: Obj[], settings: Obj = REFERENCING): Promise<Rig> {
    const counted = countedBackend()
    const seeded = await seedTree(counted.memory, plain(sourceOf(modules, settings)), testEnv(createClock(), 4242), createListDerivation())
    counted.reset()
    return {
        counted,
        entries: previousFrom(seeded.tree).objects?.moduleIndex?.entries ?? [],
        seeded: await savedDatabase(counted.memory),
    }
}

function opened(result: Store2BootResult): Extract<Store2BootResult, { kind: 'store2' }> {
    if (result.kind !== 'store2') {
        throw new Error(`The boot answered ${result.kind}.`)
    }
    return result
}

function slotsOf(db: Database): Plain[] {
    return db.modules as unknown as Plain[]
}

const stubbed = (slot: Plain): boolean => isModuleStub(slot as never)

function stubIdsOf(db: Database): string[] {
    return slotsOf(db).filter(stubbed).map(slot => String(slot.id))
}

function entryOf(rig: Rig, id: string): ModuleEntry {
    const found = rig.entries.find(entry => entry.id === id)
    if (found === undefined) {
        throw new Error(`The seed holds no module ${id}.`)
    }
    return found
}

function resetPage(): void {
    resetStore2SaveForTest()
    resetResidencyForTest()
    resetStore2BootForTest()
    resetPageBlockOwnerForTests()
    resetPageStorageModeForTests()
}

/** The booted page: the answer, its database installed as the live one, the real loader registered by the boot. */
async function boot(rig: Rig): Promise<DispatchedBoot & { db: Database }> {
    resetPage()
    const booted = await bootThroughDispatch(rig.counted.backend, { lists: createListDerivation() })
    const db = opened(booted.result).database
    h.state.db = db
    return Object.assign(booted, { db })
}

/** One module-flagged save pass through the active save context, committed and acknowledged. */
async function pass(db: Database): Promise<boolean> {
    const active = getActiveStore2Save()
    if (active?.encoder === undefined) {
        throw new Error('No save context.')
    }
    const { committer, encoder } = { committer: active.session.committer, encoder: active.encoder }
    const plan = await encoder.plan(db, { marked: new Set(), modules: true, whole: true })
    if (plan.unchanged) {
        return false
    }
    const result = await committer.commit(await committer.readCommit(), plan.commitRequest())
    if (result.status !== 'committed') {
        throw new Error(`The pass came to ${result.status}.`)
    }
    plan.acknowledge()
    return true
}

//#region the .bin export, as exportStubForm and exportModules drive it

const decoder = new TextDecoder()

function databaseEntryWritten(): Uint8Array {
    const bytes = new Uint8Array(h.sink.writes.reduce((n, part) => n + part.length, 0))
    let at = 0
    for (const part of h.sink.writes) {
        bytes.set(part, at)
        at += part.length
    }
    const view = new DataView(bytes.buffer)
    let offset = 0
    while (offset + 4 <= bytes.length) {
        const nameLength = view.getUint32(offset, true)
        offset += 4
        const name = decoder.decode(bytes.subarray(offset, offset + nameLength))
        offset += nameLength
        const dataLength = view.getUint32(offset, true)
        offset += 4
        if (name === 'database.risudat') {
            return bytes.slice(offset, offset + dataLength)
        }
        offset += dataLength
    }
    throw new Error('The export wrote no database entry.')
}

const FORMS = [
    ['full', () => SaveLocalBackup({ mode: 'inline' })],
    ['partial', () => SavePartialLocalBackup({ mode: 'inline' })],
    ['exportThisTab', () => exportThisTabBackup({ mode: 'inline' })],
] as const

type Form = () => Promise<ExportOutcome>

async function runExport(run: Form): Promise<ExportOutcome> {
    h.sink.writes.length = 0
    return await run()
}

/** The database entry of a saved export, decoded by the legacy decoder. */
async function exportedBy(run: Form): Promise<Plain> {
    const outcome = await runExport(run)
    if (outcome.status !== 'saved') {
        throw new Error(`The export came to ${outcome.status}: ${JSON.stringify(outcome, (_key, value: unknown) => value instanceof Error ? `${value.name}: ${value.message}` : value)}`)
    }
    return await decodeRisuSave(databaseEntryWritten()) as unknown as Plain
}

function byId(modules: unknown): Map<string, Plain> {
    return new Map((modules as Plain[]).map(slot => [String(slot.id), slot]))
}

function seededById(rig: Rig): Map<string, Plain> {
    return byId(plain(rig.seeded.modules))
}

interface Stopped {
    status: string
    error: string | undefined
    reason: ExportModuleFailure | undefined
    module: string | undefined
    inner: unknown
}

/** What a failed export says: the error type, the reason a person is told, the module it names and the inner load reason. */
function stoppedBy(outcome: ExportOutcome): Stopped {
    const cause = outcome.status === 'failed' ? outcome.cause : undefined
    const unreadable = cause instanceof ExportModuleUnreadableError ? cause : undefined
    const inner = unreadable?.cause as { reason?: string } | undefined
    return { status: outcome.status, error: cause instanceof Error ? cause.name : undefined, reason: unreadable?.reason, module: unreadable?.moduleId, inner: inner?.reason }
}

/** Runs `race` once, inside the first unit read the export makes (the read of the first stub, `idc`). */
async function exportRacing(rig: Rig, run: Form, race: () => Promise<void>): Promise<ExportOutcome> {
    const backend = rig.counted.backend
    const realRead = backend.readUnits
    let raced = false
    let inRace = false
    backend.readUnits = async (keys) => {
        if (!raced && !inRace) {
            inRace = true
            await race()
            inRace = false
            raced = true
        }
        return realRead(keys)
    }
    try {
        return await runExport(run)
    } finally {
        backend.readUnits = realRead
        expect(raced, 'the race ran inside the first read').toBe(true)
    }
}

/** An export is nothing but reads: no module is installed, hydrated or refreshed and the live slots are the same objects. */
function expectNothingInstalled(db: Database, before: Plain[], hydrated: { mock: { calls: unknown[] } }): void {
    expect(vi.mocked(bumpModuleGui).mock.calls.length, 'bumpModuleGui calls').toBe(0)
    expect(vi.mocked(refreshModules).mock.calls.length, 'refreshModules calls').toBe(0)
    expect(hydrated.mock.calls.length, 'hydrateModule calls').toBe(0)
    expect(slotsOf(db)).toHaveLength(before.length)
    expect(slotsOf(db).every((slot, position) => slot === before[position]), 'the live slots are the same objects').toBe(true)
}

/** The partial export asks its own two explanation questions; the corrupted-lorebook questions are the loader's. */
function expectNoLorebookQuestion(): void {
    const asked = vi.mocked(alertConfirm).mock.calls.map(call => call[0])
    expect(asked, 'the report question').not.toContain(language.bootstrap.reportErrorQuestion)
    expect(asked, 'the reset question').not.toContain(language.bootstrap.resetLorebookQuestion)
}

function hydrateSpy() {
    const residency = getResidency()
    if (residency === null) {
        throw new Error('The booted page has no residency.')
    }
    return vi.spyOn(residency, 'hydrateModule')
}

//#endregion

beforeEach(() => {
    vi.clearAllMocks()
    h.state.db = { characters: [], modules: [] }
    h.platform.isTauri = false
    h.sink.writes.length = 0
    resetPage()
    injectAppStore(createForageBackedStore({
        getItem: async () => null,
        setItem: async () => { },
        keys: async () => [],
        removeItem: async () => { },
    }))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
})

afterEach(() => {
    resetPage()
    vi.restoreAllMocks()
})

describe('an export of a minted page reads the stored copy and installs nothing', () => {
    test.each(FORMS)('R1 export-leaves-every-stub-%s: nothing is installed, the stubs stay the same stubs, and the copy equals the stored bodies', async (_form, run) => {
        const rig = await rigOf(fiveModules())
        const booted = await boot(rig)
        expect(stubIdsOf(booted.db)).toEqual(UNREFERENCED)
        const before = slotsOf(booted.db).slice()
        const hydrated = hydrateSpy()
        const writesBefore = rig.counted.writeCalls()

        const exported = await exportedBy(run)

        expectNothingInstalled(booted.db, before, hydrated)
        expect(stubIdsOf(booted.db)).toEqual(UNREFERENCED)
        expect(rig.counted.writeCalls(), 'the export writes nothing to the store').toBe(writesBefore)
        expect(byId(exported.modules)).toEqual(seededById(rig))
    })

    test.each(FORMS)('R1 export-needs-no-loader-%s: a minted page exports with no loader registered and the stubs stay stubs', async (_form, run) => {
        const rig = await rigOf(fiveModules())
        const booted = await boot(rig)
        expect(stubIdsOf(booted.db)).toEqual(UNREFERENCED)
        const before = slotsOf(booted.db).slice()
        unregisterModuleLoader()

        const exported = await exportedBy(run)

        expect(stubIdsOf(booted.db)).toEqual(UNREFERENCED)
        expect(slotsOf(booted.db).every((slot, position) => slot === before[position])).toBe(true)
        expect(byId(exported.modules)).toEqual(seededById(rig))
    })

    test.each(FORMS)('G the-resident-slots-are-kept-as-the-same-objects-%s: resident modules are exported as the page holds them, in list order', async (_form, run) => {
        const rig = await rigOf(fiveModules())
        const booted = await boot(rig)
        const resident = slotsOf(booted.db).find(slot => slot.id === 'ida') as Plain
        resident.description = 'edited on the page'

        const exported = await exportedBy(run)

        expect((exported.modules as Plain[]).map(slot => slot.id)).toEqual(['idc', 'ida', 'idd', 'idb', 'ide'])
        expect(byId(exported.modules).get('ida')?.description).toBe('edited on the page')
    })

    test('G the-export-reads-each-stub-once: a stub is read as units and never written back', async () => {
        const rig = await rigOf(fiveModules())
        const booted = await boot(rig)
        expect(stubIdsOf(booted.db)).toEqual(UNREFERENCED)
        rig.counted.reset()

        await exportedBy(FORMS[0][1])

        for (const id of UNREFERENCED) {
            const unitKey = keyOfRef(entryOf(rig, id).unit as never)
            expect(rig.counted.reads.filter(key => key === unitKey), `reads of the unit of ${id}`).toHaveLength(1)
        }
        expect(rig.counted.writeCalls()).toBe(0)
    })
})

describe('the copy is the stored body: no lorebook repair and no question', () => {
    function oldLoreModules(): Obj[] {
        return [moduleBody('idc', { lorebook: [OLD_LORE] }), moduleBody('ida'), moduleBody('idd'), moduleBody('idb', { namespace: 'ns-a' }), moduleBody('ide')]
    }

    test.each(FORMS)('R3a stub-lorebook-is-exported-as-stored-%s: lore entries without bookVersion are not migrated and migrate is never called', async (_form, run) => {
        const rig = await rigOf(oldLoreModules())
        const booted = await boot(rig)
        expect(stubIdsOf(booted.db)).toContain('idc')
        vi.mocked(updateLorebooks).mockClear()

        const exported = await exportedBy(run)

        expect(vi.mocked(updateLorebooks).mock.calls.length, 'migrate calls during the export').toBe(0)
        expect(byId(exported.modules).get('idc')?.lorebook).toEqual([OLD_LORE])
    })

    test('G R3a-control: the same module loaded first is migrated once and exports migrated (the difference is the residency)', async () => {
        const rig = await rigOf(oldLoreModules())
        const booted = await boot(rig)
        expect(stubIdsOf(booted.db)).toContain('idc')
        vi.mocked(updateLorebooks).mockClear()

        expect(await acquireModule('idc')).not.toBeNull()
        expect(vi.mocked(updateLorebooks).mock.calls.length, 'migrate calls at the load').toBe(1)
        const exported = await exportedBy(FORMS[0][1])

        expect(byId(exported.modules).get('idc')?.lorebook).toEqual([{ ...OLD_LORE, bookVersion: 2 }])
    })

    test.each(FORMS)('R3b a-stored-lorebook-that-is-not-a-list-asks-nothing-%s: the export is silent and holds the value as stored', async (_form, run) => {
        const rig = await rigOf([moduleBody('idc', { lorebook: { bad: true } }), moduleBody('ida'), moduleBody('idd'), moduleBody('idb', { namespace: 'ns-a' }), moduleBody('ide')])
        const booted = await boot(rig)
        expect(stubIdsOf(booted.db)).toContain('idc')

        const exported = await exportedBy(run)

        expectNoLorebookQuestion()
        expect(vi.mocked(alertError).mock.calls.length, 'alertError calls').toBe(0)
        expect(vi.mocked(waitAlert).mock.calls.length, 'waitAlert calls').toBe(0)
        expect(byId(exported.modules).get('idc')?.lorebook).toEqual({ bad: true })
    })
})

describe('a module that moves after the call stops the export as changed', () => {
    test.each(FORMS)('R-race-edit-%s: a later stub loaded, edited and saved while an earlier stub is read ends changed, names it and writes nothing', async (_form, run) => {
        const rig = await rigOf(fiveModules())
        const booted = await boot(rig)
        expect(stubIdsOf(booted.db)).toEqual(UNREFERENCED)

        const outcome = await exportRacing(rig, run, async () => {
            await acquireModule('idd')
            const slot = slotsOf(booted.db).find(one => one.id === 'idd') as Plain
            expect(stubbed(slot)).toBe(false)
            slot.description = 'edited during the export'
            expect(await pass(booted.db)).toBe(true)
        })

        expect(stoppedBy(outcome)).toEqual({ status: 'failed', error: 'ExportModuleUnreadableError', reason: 'changed', module: 'idd', inner: 'stale' })
        expect(h.sink.writes.length, 'bytes written').toBe(0)
        expect(stubIdsOf(booted.db)).toEqual(['idc', 'ide'])
    })

    test.each(FORMS)('R-race-delete-%s: a later stub deleted and the delete saved while an earlier stub is read ends changed, names it and writes nothing', async (_form, run) => {
        const rig = await rigOf(fiveModules())
        const booted = await boot(rig)
        expect(stubIdsOf(booted.db)).toEqual(UNREFERENCED)

        const outcome = await exportRacing(rig, run, async () => {
            const at = slotsOf(booted.db).findIndex(one => one.id === 'idd')
            booted.db.modules.splice(at, 1)
            expect(await pass(booted.db)).toBe(true)
        })

        expect(stoppedBy(outcome)).toEqual({ status: 'failed', error: 'ExportModuleUnreadableError', reason: 'changed', module: 'idd', inner: 'stale' })
        expect(h.sink.writes.length, 'bytes written').toBe(0)
        expect(stubIdsOf(booted.db)).toEqual(['idc', 'ide'])
    })

    test.each(FORMS)('M entry-moved-during-its-own-read-%s: the stub being read is loaded, edited and saved before its read ends, so the export ends changed and writes nothing (pinned by the post-read entry check, not a base reproducer)', async (_form, run) => {
        const rig = await rigOf(fiveModules())
        const booted = await boot(rig)
        expect(stubIdsOf(booted.db)).toEqual(UNREFERENCED)

        const outcome = await exportRacing(rig, run, async () => {
            await acquireModule('idc')
            const slot = slotsOf(booted.db).find(one => one.id === 'idc') as Plain
            slot.description = 'edited during its own read'
            expect(await pass(booted.db)).toBe(true)
        })

        expect(stoppedBy(outcome)).toEqual({ status: 'failed', error: 'ExportModuleUnreadableError', reason: 'changed', module: 'idc', inner: 'stale' })
        expect(h.sink.writes.length, 'bytes written').toBe(0)
    })

    test('G a-stub-loaded-but-not-edited-while-another-is-read-still-exports-the-stored-body', async () => {
        const rig = await rigOf(fiveModules())
        const booted = await boot(rig)
        let committed: boolean | undefined

        const outcome = await exportRacing(rig, FORMS[0][1], async () => {
            await acquireModule('idd')
            committed = await pass(booted.db)
        })

        expect(outcome.status).toBe('saved')
        expect(committed).toBeDefined()
        expect(byId((await decodeRisuSave(databaseEntryWritten()) as unknown as Plain).modules)).toEqual(seededById(rig))
    })
})

describe('the error table through the real residency: each stops before a file opens, names the module and installs nothing', () => {
    interface Case {
        label: string
        reason: ExportModuleFailure
        inner: string | undefined
        module: string
        /** Damages the store or the page after the boot; the stubs `idc`, `idd` and `ide` are read in that order. */
        damage(rig: Rig, db: Database): void
    }

    const withHeader = (bytes: Uint8Array, edit: (header: Uint8Array) => void): Uint8Array => {
        const out = new Uint8Array(bytes)
        edit(out.subarray(0, 12))
        new DataView(out.buffer, out.byteOffset + 12, 4).setUint32(0, crc32(out.subarray(0, 12)), true)
        return out
    }

    const cases: Case[] = [
        {
            label: 'M a missing module unit is damaged, never missing',
            reason: 'damaged',
            inner: 'damaged',
            module: 'idd',
            damage: (rig) => rig.counted.memory.poke(keyOfRef(entryOf(rig, 'idd').unit as never), null),
        },
        {
            label: 'M a module unit that fails its check is damaged',
            reason: 'damaged',
            inner: 'damaged',
            module: 'idd',
            damage: (rig) => {
                const key = keyOfRef(entryOf(rig, 'idd').unit as never)
                const bytes = new Uint8Array(rig.counted.memory.snapshot().get(key) as Uint8Array)
                bytes[bytes.length - 1] ^= 0xff
                rig.counted.memory.poke(key, bytes)
            },
        },
        {
            label: 'M a module unit in a newer frame format is newer',
            reason: 'newer',
            inner: 'too-new',
            module: 'idd',
            damage: (rig) => {
                const key = keyOfRef(entryOf(rig, 'idd').unit as never)
                rig.counted.memory.poke(key, withHeader(rig.counted.memory.snapshot().get(key) as Uint8Array, header => { header[4] = 9 }))
            },
        },
        {
            label: 'M an asset list in a newer frame format is newer',
            reason: 'newer',
            inner: 'too-new',
            module: 'idd',
            damage: (rig) => {
                const key = keyOfRef(entryOf(rig, 'idd').al as never)
                rig.counted.memory.poke(key, withHeader(rig.counted.memory.snapshot().get(key) as Uint8Array, header => { header[4] = 9 }))
            },
        },
        {
            label: 'G a store that fails the read is unreadable (the loader reported the same)',
            reason: 'unreadable',
            inner: 'unreadable',
            module: 'idc',
            damage: (rig) => {
                rig.counted.backend.readUnits = async () => {
                    throw new Store2BackendFailureError('the backend failed')
                }
            },
        },
        {
            label: 'M MC-670 a stub whose marker is not the recorded one is unreadable and named',
            reason: 'unreadable',
            inner: 'edited',
            module: 'idd',
            damage: (_rig, db) => {
                const slot = slotsOf(db).find(one => one.id === 'idd') as Plain
                slot.description = 'edited stub'
            },
        },
        {
            label: 'M MC-670 a stub with no stored entry is unreadable and named',
            reason: 'unreadable',
            inner: 'no-entry',
            module: 'idz',
            damage: (_rig, db) => {
                const stub = slotsOf(db).find(one => one.id === 'idd') as Plain
                slotsOf(db).push({ ...plain(stub), id: 'idz', name: 'Module idz' })
            },
        },
        {
            label: 'M a stub that cannot be read as JSON is unreadable',
            reason: 'unreadable',
            inner: undefined,
            module: 'idd',
            damage: (_rig, db) => {
                const slot = slotsOf(db).find(one => one.id === 'idd') as Plain
                slot.unrepresentable = 1n
            },
        },
        {
            label: 'G an id shared with another slot is a duplicate and is never read (the loader reported the same)',
            reason: 'duplicate',
            inner: undefined,
            module: 'idc',
            damage: (_rig, db) => {
                const stub = slotsOf(db).find(one => one.id === 'idc') as Plain
                slotsOf(db).push({ ...plain(stub) })
            },
        },
    ]

    test.each(FORMS.flatMap(([form, run]) => cases.map(one => [form, one.label, one, run] as const)))('%s-form %s', async (_form, _label, one, run) => {
        const rig = await rigOf(fiveModules())
        const booted = await boot(rig)
        expect(stubIdsOf(booted.db)).toEqual(UNREFERENCED)
        const hydrated = hydrateSpy()
        one.damage(rig, booted.db)
        const before = slotsOf(booted.db).slice()

        const outcome = await runExport(run)

        expect(outcome.status).toBe('failed')
        const stopped = stoppedBy(outcome)
        expect(stopped).toMatchObject({ error: 'ExportModuleUnreadableError', reason: one.reason, module: one.module })
        if (one.inner !== undefined) {
            expect(stopped.inner).toBe(one.inner)
        }
        expect(h.sink.writes.length, 'bytes written').toBe(0)
        expectNothingInstalled(booted.db, before, hydrated)
        expectNoLorebookQuestion()
    })

    test.each(FORMS)('M %s-form the-read-error-detail-reaches-the-load-error: a store that fails the read keeps the backend message in the cause for the diagnostics', async (_form, run) => {
        const rig = await rigOf(fiveModules())
        await boot(rig)
        rig.counted.backend.readUnits = async () => {
            throw new Store2BackendFailureError('the backend failed')
        }

        const outcome = await runExport(run)

        expect(outcome.status).toBe('failed')
        const cause = outcome.status === 'failed' ? outcome.cause : undefined
        expect(cause).toBeInstanceOf(ExportModuleUnreadableError)
        const inner = (cause as ExportModuleUnreadableError).cause
        expect(inner).toBeInstanceOf(Error)
        expect((inner as Error).message).toContain('the backend failed')
    })
})

describe('the export is busy while the stored copy is read', () => {
    test('G auto-gc-off-during-the-read: every unit read of the export happens while the page is busy', async () => {
        const rig = await rigOf(fiveModules())
        const booted = await boot(rig)
        expect(stubIdsOf(booted.db)).toEqual(UNREFERENCED)
        const backend = rig.counted.backend
        const realRead = backend.readUnits
        const seen: boolean[] = []
        backend.readUnits = async (keys) => {
            seen.push(isBusy())
            return realRead(keys)
        }

        try {
            await exportedBy(FORMS[0][1])
        } finally {
            backend.readUnits = realRead
        }

        expect(seen.length).toBeGreaterThan(0)
        expect(seen.every(Boolean)).toBe(true)
        expect(isBusy()).toBe(false)
    })
})
