/**
 * A full and a partial local export (`SaveLocalBackup`, `SavePartialLocalBackup`, `src/ts/drive/backuplocal.ts`) read
 * every module body before anything is opened (`snapshotModuleList`, `src/ts/drive/exportModules.ts`) and write that
 * snapshot, not the live list, as the database entry's `modules`. A module that cannot be read stops the export before
 * the file or the save dialog, naming the module. A module stub is read as a copy of its stored body through the page's
 * real residency (`createResidency` over a seeded memory backend, booted through the real dispatch), so the rows here
 * exercise the real read, not a loader double; the rows that pin what the copy read installs (nothing) and the race
 * outcomes live in `exportByCopy.test.ts`. A passing test is not evidence about the Tauri or Node backends.
 *
 * Labels in the titles: G rows are compatibility guards that pass before and after the copy read (the snapshot of a
 * list with no stub, the V0 bytes, the alert wording); the stub rows are re-hosted on the real residency from the
 * loader-double rows they replace, so they keep the property the old row pinned and are not reproducers.
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
        sink: { writes: [] as Uint8Array[], opened: 0 },
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
        createWriteStream: () => {
            h.sink.opened++
            return {
                ready: Promise.resolve(),
                writable: {
                    getWriter: () => ({
                        write: async (chunk: Uint8Array) => { h.sink.writes.push(chunk.slice()) },
                        close: async () => { },
                    }),
                },
            }
        },
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
vi.mock(import('src/ts/characters'), () => ({ updateLorebooks: vi.fn((book: unknown) => book) }) as unknown as typeof import('src/ts/characters'))
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
import { SaveLocalBackup, SavePartialLocalBackup } from 'src/ts/drive/backuplocal'
import { ExportModuleUnreadableError, snapshotModuleList, type ExportModuleFailure } from 'src/ts/drive/exportModules'
import type { ExportOutcome } from 'src/ts/drive/operationEnd'
import { alertError } from 'src/ts/alert'
import { dbWriteLock, LocalWriter } from 'src/ts/globalApi.svelte'
import { language } from 'src/lang'
import { isBusy } from 'src/ts/process/memory/busyActions'
import { crc32 } from 'src/ts/storage/blockFrame'
import { decodeRisuSave } from 'src/ts/storage/risuSave'
import { writeRisuSaveV0 } from 'src/ts/storage/risuSaveV0'
import { isModuleStub, MODULE_STUB_KEY, MODULE_STUB_VALUE, ModuleStubRefusal } from 'src/ts/storage/moduleStub'
import { resetPageBlockOwnerForTests } from 'src/ts/storage/pageBlockOwner'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'
import { Store2BackendFailureError } from 'src/ts/storage/store2/backend/errors'
import { resetStore2BootForTest, type Store2BootResult } from 'src/ts/storage/store2/bootActive'
import { previousFrom } from 'src/ts/storage/store2/codec'
import { keyOfRef, type ModuleEntry } from 'src/ts/storage/store2/format'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
import { acquireModule, ModuleAmbiguousError, ModuleLoadError, type ModuleLoadFailure } from 'src/ts/storage/store2/moduleAcquire'
import { resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { getActiveStore2Save, resetStore2SaveForTest } from 'src/ts/storage/store2/saveActive'
import { bootThroughDispatch, countedBackend, createClock, seedTree, testEnv, type CountedBackend, type DispatchedBoot } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'

type Plain = Record<string, unknown>

//#region the real-residency page

interface Rig {
    counted: CountedBackend
    entries: ModuleEntry[]
}

function moduleBody(id: string, extra: Obj = {}): Obj {
    return { id, name: `Module ${id}`, description: `about ${id}`, lorebook: [{ comment: 'c', content: `text ${id}`, key: 'k', alwaysActive: false, secondkey: '', selective: false, insertorder: 100, mode: 'normal', bookVersion: 2 }], regex: [{ comment: 'r', in: 'x', out: 'y', type: 'editinput' }], trigger: [], assets: [], cjs: `body of ${id}`, ...extra }
}

/** Five modules; the global lists of `REFERENCING` keep `ida` and `idb` (by namespace) resident and leave three unreferenced. */
function fiveModules(): Obj[] {
    return [moduleBody('idc'), moduleBody('ida'), moduleBody('idd'), moduleBody('idb', { namespace: 'ns-a' }), moduleBody('ide')]
}

const REFERENCING: Obj = { enabledModules: ['ida'], moduleIntergration: 'ns-a' }
const UNREFERENCED = ['idc', 'idd', 'ide']
const ORDER = ['idc', 'ida', 'idd', 'idb', 'ide']

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

/** Seeds the source with the real list derivation (so its module entries are stub-eligible) into a counted backend. */
async function rigOf(modules: Obj[]): Promise<Rig> {
    const counted = countedBackend()
    const source = shortened({ ...(buildSmall(2) as unknown as Obj), archiveCharacters: true, enabledModules: [], moduleIntergration: '', modules, ...REFERENCING }) as Database
    const seeded = await seedTree(counted.memory, plain(source), testEnv(createClock(), 4242), createListDerivation())
    counted.reset()
    return { counted, entries: previousFrom(seeded.tree).objects?.moduleIndex?.entries ?? [] }
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

function stubIdsOf(db: Database): string[] {
    return slotsOf(db).filter(slot => isModuleStub(slot as never)).map(slot => String(slot.id))
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

/** The booted page: its database installed as the live one, the real residency and loader registered by the boot. */
async function boot(rig: Rig): Promise<DispatchedBoot & { db: Database }> {
    resetPage()
    const booted = await bootThroughDispatch(rig.counted.backend, { lists: createListDerivation() })
    const db = opened(booted.result).database
    h.state.db = db
    return Object.assign(booted, { db })
}

/** One module-flagged save pass through the active save context, committed and acknowledged. */
async function pass(db: Database): Promise<void> {
    const active = getActiveStore2Save()
    if (active?.encoder === undefined) {
        throw new Error('No save context.')
    }
    const plan = await active.encoder.plan(db, { marked: new Set(), modules: true, whole: true })
    const result = await active.session.committer.commit(await active.session.committer.readCommit(), plan.commitRequest())
    if (result.status !== 'committed') {
        throw new Error(`The pass came to ${result.status}.`)
    }
    plan.acknowledge()
}

const withHeader = (bytes: Uint8Array, edit: (header: Uint8Array) => void): Uint8Array => {
    const out = new Uint8Array(bytes)
    edit(out.subarray(0, 12))
    new DataView(out.buffer, out.byteOffset + 12, 4).setUint32(0, crc32(out.subarray(0, 12)), true)
    return out
}

/** The stored module unit of `id` is gone, so the module reads as damaged. */
function dropUnit(rig: Rig, id: string): void {
    rig.counted.memory.poke(keyOfRef(entryOf(rig, id).unit as never), null)
}

/** The stored module unit of `id` is in a frame format newer than this build's. */
function makeUnitNewer(rig: Rig, id: string): void {
    const key = keyOfRef(entryOf(rig, id).unit as never)
    rig.counted.memory.poke(key, withHeader(rig.counted.memory.snapshot().get(key) as Uint8Array, header => { header[4] = 9 }))
}

/** Runs `race` once, inside the first unit read the export makes (the read of the first stub, `idc`). */
async function racingRead<T>(rig: Rig, race: () => Promise<void>, run: () => Promise<T>): Promise<T> {
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
        return await run()
    } finally {
        backend.readUnits = realRead
        expect(raced, 'the race ran inside the first read').toBe(true)
    }
}

//#endregion

//#region the .bin export

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

async function decodedDatabase(): Promise<Plain> {
    return await decodeRisuSave(databaseEntryWritten()) as unknown as Plain
}

interface Profile {
    name: string
    run: () => Promise<ExportOutcome>
    kv: boolean
}

const KV = { 'kv:bar': { version: 1, entries: [] } }

const PROFILES: Profile[] = [
    { name: 'full writer', run: () => SaveLocalBackup({ mode: 'inline' }), kv: false },
    { name: 'partial writer', run: () => SavePartialLocalBackup({ mode: 'inline' }), kv: false },
    { name: 'kv-block (V0)', run: () => SaveLocalBackup({ mode: 'inline' }), kv: true },
]

function makeLiveCharacter(chaId: unknown, name: string): Database['characters'][number] {
    return { chaId, name, type: 'character', chatPage: 0, chats: [] } as unknown as Database['characters'][number]
}

const CHARACTER_SETS: [string, boolean][] = [
    ['no repair', false],
    ['repair needed', true],
]

/** The profile's extra field and, for a repair run, a character that has no id (the export mints one for it). */
function applyProfile(db: Database, profile: Profile, repairNeeded = false): void {
    if (profile.kv) {
        (db as unknown as Plain).upstreamKvBlocks = KV
    }
    if (repairNeeded) {
        db.characters.push(makeLiveCharacter(undefined, 'No Id'))
    }
}

/** The repair mints a random id for a character that has none; the comparison sees a fixed one instead. */
function withoutMintedIds(tree: Plain): Plain {
    const characters = (tree.characters as { chaId: string, name: string }[]).map(c => c.name === 'No Id' ? { ...c, chaId: 'minted' } : c)
    return { ...tree, characters }
}

async function exportedTree(profile: Profile): Promise<Plain> {
    h.sink.writes.length = 0
    const outcome = await profile.run()
    expect(outcome.status).toBe('saved')
    return withoutMintedIds(await decodedDatabase())
}

function stoppedReason(outcome: ExportOutcome): ExportModuleFailure | undefined {
    return outcome.status === 'failed' && outcome.cause instanceof ExportModuleUnreadableError ? outcome.cause.reason : undefined
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

/** Whether the console received an error whose message holds `text`. */
function consoleErrorMentions(text: string): boolean {
    return consoleErrorSpy.mock.calls.some(call => call.some(arg => arg instanceof Error && arg.message.includes(text)))
}

/** A list with no stub and no residency: the shapes the snapshot passes through untouched. */
function databaseWith(fields: Plain): Database {
    return { characters: [makeLiveCharacter('a', 'A')], personas: [], characterOrder: ['a'], botPresets: [], ...fields } as unknown as Database
}

function useDatabase(db: Database): void {
    h.state.db = db
}

function fullModule(id: string, name: string, extra: Plain = {}): Plain {
    return { id, name, description: `${name} description`, ...extra }
}

function stubSlot(id: string, name: string): Plain {
    return { id, name, [MODULE_STUB_KEY]: MODULE_STUB_VALUE }
}

//#endregion

beforeEach(() => {
    vi.clearAllMocks()
    h.state.db = { characters: [], modules: [] }
    h.platform.isTauri = false
    h.sink.writes.length = 0
    h.sink.opened = 0
    resetPage()
    injectAppStore(createForageBackedStore({
        getItem: async () => null,
        setItem: async () => { },
        keys: async () => [],
        removeItem: async () => { },
    }))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
})

afterEach(() => {
    resetPage()
    vi.restoreAllMocks()
})

describe.each(PROFILES)('$name', (profile) => {
    describe.each(CHARACTER_SETS)('%s', (_label, repairNeeded) => {
        test('export-unpacks-equal-with-stub: a module stub in the list unpacks equal to an all-full export', async () => {
            const rig = await rigOf(fiveModules())
            const full = await boot(rig)
            for (const id of UNREFERENCED) {
                const acquired = await acquireModule(id)
                expect(acquired, `the control loads ${id}`).not.toBeNull()
                acquired?.release()
            }
            expect(stubIdsOf(full.db)).toEqual([])
            applyProfile(full.db, profile, repairNeeded)
            const control = await exportedTree(profile)

            const stubbed = await boot(rig)
            expect(stubIdsOf(stubbed.db)).toEqual(UNREFERENCED)
            applyProfile(stubbed.db, profile, repairNeeded)
            // The live list is emptied once the writer is open, so only the list read before it opened can supply the modules.
            const realInit = LocalWriter.prototype.init
            vi.spyOn(LocalWriter.prototype, 'init').mockImplementation(async function (this: LocalWriter, ...args: Parameters<LocalWriter['init']>) {
                const result = await realInit.apply(this, args)
                slotsOf(stubbed.db).splice(0, slotsOf(stubbed.db).length)
                return result
            })
            const exported = await exportedTree(profile)

            expect((exported.modules as Plain[]).map(slot => slot.id)).toEqual(ORDER)
            expect(exported.modules).toEqual(control.modules)
            expect(exported).toEqual(control)
        })
    })

    test('guard: duplicate resident ids are kept as separate slots, in order', async () => {
        const db = databaseWith({ modules: [fullModule('dup', 'First', { cjs: '1' }), fullModule('dup', 'Second', { cjs: '2' })] })
        applyProfile(db, profile)
        useDatabase(db)

        const exported = await exportedTree(profile)

        expect((exported.modules as { name: string }[]).map(m => m.name)).toEqual(['First', 'Second'])
    })

    test('unreadable-module-stops-before-open: a module whose unit is gone names the module in the console and nothing is opened', async () => {
        const rig = await rigOf(fiveModules())
        const booted = await boot(rig)
        applyProfile(booted.db, profile)
        dropUnit(rig, 'idd')
        const openSpy = vi.spyOn(LocalWriter.prototype, 'init')

        const outcome = await profile.run()

        expect(outcome.status).toBe('failed')
        expect(outcome.status === 'failed' ? outcome.file : undefined).toBe('untouched')
        expect(openSpy).not.toHaveBeenCalled()
        expect(h.sink.opened).toBe(0)
        expect(h.sink.writes.length).toBe(0)
        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        const shown = String(vi.mocked(alertError).mock.calls[0][0])
        // The alert names the module and is not the generic text.
        expect(shown).toContain('Module idd')
        expect(shown).not.toBe(language.backupFailedNothingWritten())
        expect(shown).toBe(language.backupFailedModuleUnreadable('Module idd', 'damaged'))
        expect(consoleErrorMentions('Module idd')).toBe(true)
    })

    test('a stub removed from the live list and the removal saved during an earlier read stops the export before anything opens and is named in the console', async () => {
        const rig = await rigOf(fiveModules())
        const booted = await boot(rig)
        applyProfile(booted.db, profile)
        const openSpy = vi.spyOn(LocalWriter.prototype, 'init')

        const outcome = await racingRead(rig, async () => {
            const at = slotsOf(booted.db).findIndex(slot => slot.id === 'idd')
            slotsOf(booted.db).splice(at, 1)
            await pass(booted.db)
        }, () => profile.run())

        expect(outcome.status).toBe('failed')
        expect(stoppedReason(outcome)).toBe('changed')
        expect(openSpy).not.toHaveBeenCalled()
        expect(h.sink.writes.length).toBe(0)
        expect(consoleErrorMentions('Module idd')).toBe(true)
    })

    test('guard: a kept stub that has left the live list is refused from the snapshot before anything opens', async () => {
        // No residency: the snapshot keeps the stub as it was at the call. The first read of the list (the snapshot)
        // sees the stub; every later read (the live check) sees it gone, so only the snapshot-list check can refuse it.
        const stub = stubSlot('m-b', 'Foreign Marker')
        const db = databaseWith({})
        let reads = 0
        Object.defineProperty(db, 'modules', { get: () => (reads++ === 0 ? [stub] : []), configurable: true })
        useDatabase(db)
        const openSpy = vi.spyOn(LocalWriter.prototype, 'init')

        const outcome = await profile.run()

        expect(outcome.status).toBe('failed')
        expect(outcome.status === 'failed' ? outcome.cause : undefined).toBeInstanceOf(ModuleStubRefusal)
        expect(openSpy).not.toHaveBeenCalled()
        expect(h.sink.writes.length).toBe(0)
    })

    test('a marker on a page with no residency reaches the live check and is refused as any marker', async () => {
        useDatabase(databaseWith({ modules: [fullModule('m-a', 'Module A'), stubSlot('m-b', 'Foreign Marker')] }))
        const openSpy = vi.spyOn(LocalWriter.prototype, 'init')

        const outcome = await profile.run()

        expect(outcome.status).toBe('failed')
        expect(outcome.status === 'failed' ? outcome.cause : undefined).toBeInstanceOf(ModuleStubRefusal)
        expect(openSpy).not.toHaveBeenCalled()
        expect(h.sink.writes.length).toBe(0)
        expect(String(vi.mocked(alertError).mock.calls[0][0])).toBe(language.backupFailedNothingWritten())
    })
})

describe('unreadable module on the Tauri backend', () => {
    test('unreadable-module-stops-before-open: the save dialog is never shown', async () => {
        const { save } = await import('@tauri-apps/plugin-dialog')
        const rig = await rigOf(fiveModules())
        await boot(rig)
        dropUnit(rig, 'idd')
        h.platform.isTauri = true

        const outcome = await SaveLocalBackup({ mode: 'inline' })

        expect(outcome.status).toBe('failed')
        expect(save).not.toHaveBeenCalled()
        const shown = String(vi.mocked(alertError).mock.calls[0][0])
        expect(shown).toContain('Module idd')
        expect(shown).not.toBe(language.backupFailedNothingWritten())
        expect(shown).toBe(language.backupFailedModuleUnreadable('Module idd', 'damaged'))
    })
})

describe('module list changes after the export started', () => {
    test.each([['full writer', () => SaveLocalBackup({ mode: 'inline' })], ['partial writer', () => SavePartialLocalBackup({ mode: 'inline' })]])('module-deleted-after-start-still-exported (%s)', async (_name, run) => {
        const rig = await rigOf(fiveModules())
        const booted = await boot(rig)
        expect(stubIdsOf(booted.db)).toEqual(UNREFERENCED)
        const realInit = LocalWriter.prototype.init
        vi.spyOn(LocalWriter.prototype, 'init').mockImplementation(async function (this: LocalWriter, ...args: Parameters<LocalWriter['init']>) {
            const result = await realInit.apply(this, args)
            slotsOf(booted.db).splice(0, slotsOf(booted.db).length)
            return result
        })

        const outcome = await run()

        expect(outcome.status).toBe('saved')
        const exported = await decodedDatabase()
        expect((exported.modules as { id: string }[]).map(m => m.id)).toEqual(ORDER)
        expect((exported.modules as { cjs?: string }[])[0].cjs).toBe('body of idc')
    })
})

describe('busy state during the snapshot', () => {
    test('auto-gc-off-during-export: the export is busy while a module is read and while the database entry is written', async () => {
        const rig = await rigOf(fiveModules())
        await boot(rig)
        const seen: boolean[] = []
        const backend = rig.counted.backend
        const realRead = backend.readUnits
        backend.readUnits = async (keys) => {
            seen.push(isBusy())
            return realRead(keys)
        }
        const realWrite = LocalWriter.prototype.writeBackupHeader
        const atDatabaseEntry: boolean[] = []
        vi.spyOn(LocalWriter.prototype, 'writeBackupHeader').mockImplementation(function (this: LocalWriter, ...args: Parameters<LocalWriter['writeBackupHeader']>) {
            if (args[0] === 'database.risudat') {
                atDatabaseEntry.push(isBusy())
            }
            return realWrite.apply(this, args)
        })

        const outcome = await SaveLocalBackup({ mode: 'inline' })

        expect(outcome.status).toBe('saved')
        expect(seen.length, 'unit reads made by the export').toBeGreaterThan(0)
        expect(seen.every(busy => busy), 'busy at every unit read').toBe(true)
        expect(atDatabaseEntry).toEqual([true])
        expect(isBusy()).toBe(false)
    })
})

describe('v0-path-unchanged', () => {
    test('guard: resident modules in the kv-block profile are the V0 bytes of the same tree', async () => {
        const modules = [fullModule('m-r', 'Resident', { cjs: 'x' })]
        const db = databaseWith({ modules, upstreamKvBlocks: KV })
        useDatabase(db)

        await SaveLocalBackup({ mode: 'inline' })

        const { upstreamKvBlocks: _field, ...withoutKv } = db as unknown as Plain
        const expected = writeRisuSaveV0({ ...withoutKv, account: undefined }, KV)
        expect(Buffer.from(databaseEntryWritten()).equals(Buffer.from(expected))).toBe(true)
    })

    test('guard: no module list adds no modules key', async () => {
        const db = databaseWith({ upstreamKvBlocks: KV })
        delete (db as unknown as Plain).modules
        useDatabase(db)

        await SaveLocalBackup({ mode: 'inline' })

        const { upstreamKvBlocks: _field, ...withoutKv } = db as unknown as Plain
        const expected = writeRisuSaveV0({ ...withoutKv, account: undefined }, KV)
        expect(Buffer.from(databaseEntryWritten()).equals(Buffer.from(expected))).toBe(true)
        expect(Object.hasOwn(await decodedDatabase(), 'modules')).toBe(false)
    })
})

describe('snapshotModuleList', () => {
    async function bootedPage(): Promise<{ rig: Rig, db: Database }> {
        const rig = await rigOf(fiveModules())
        const booted = await boot(rig)
        expect(stubIdsOf(booted.db)).toEqual(UNREFERENCED)
        rig.counted.reset()
        return { rig, db: booted.db }
    }

    async function errorOf(db: Database): Promise<ExportModuleUnreadableError> {
        const error = await snapshotModuleList(db).catch((caught: unknown) => caught)
        expect(error).toBeInstanceOf(ExportModuleUnreadableError)
        return error as ExportModuleUnreadableError
    }

    test('guard: a stub with no stored entry on a page with a residency is a read failure naming it', async () => {
        const { db } = await bootedPage()
        slotsOf(db).push(stubSlot('gone', 'Gone'))
        const error = await errorOf(db)
        expect(error.moduleName).toBe('Gone')
        expect(error.reason).toBe('unreadable')
    })

    test('a stub whose id another slot holds is refused without a read', async () => {
        const { rig, db } = await bootedPage()
        slotsOf(db).push(fullModule('idc', 'Other'))
        const error = await errorOf(db)
        expect(error.moduleName).toBe('Module idc')
        expect(rig.counted.reads, 'unit reads').toEqual([])
    })

    test('a stub after a resident module of the same id is refused without a read', async () => {
        const { rig, db } = await bootedPage()
        slotsOf(db).unshift(fullModule('idc', 'Other'))
        const error = await errorOf(db)
        expect(error.moduleName).toBe('Module idc')
        expect(rig.counted.reads, 'unit reads').toEqual([])
    })

    const readRows: [string, (rig: Rig, db: Database) => void, ExportModuleFailure, string | undefined][] = [
        ['unreadable (the store fails the read)', (rig) => {
            rig.counted.backend.readUnits = async () => {
                throw new Store2BackendFailureError('the backend failed')
            }
        }, 'unreadable', 'unreadable'],
        ['damaged (the unit is gone)', (rig) => dropUnit(rig, 'idc'), 'damaged', 'damaged'],
        ['newer (the unit is in a newer frame format)', (rig) => makeUnitNewer(rig, 'idc'), 'newer', 'too-new'],
        ['unreadable (no entry for the stub id at the call)', (_rig, db) => {
            slotsOf(db)[slotsOf(db).findIndex(slot => slot.id === 'idc')] = stubSlot('idz', 'Module idz')
        }, 'unreadable', 'no-entry'],
        ['unreadable (an edited marker)', (_rig, db) => {
            const at = slotsOf(db).findIndex(slot => slot.id === 'idc')
            slotsOf(db)[at] = { ...slotsOf(db)[at], name: 'Renamed' }
        }, 'unreadable', 'edited'],
    ]

    test.each(readRows)('unreadable-reason: a stub that reads %s maps to its reason through the real residency', async (_label, damage, reason, inner) => {
        const { rig, db } = await bootedPage()
        damage(rig, db)
        const error = await errorOf(db)
        expect(error.reason).toBe(reason)
        expect((error.cause as ModuleLoadError).reason).toBe(inner)
    })

    const mappingRows: [string, ModuleLoadFailure, ExportModuleFailure][] = [
        ['unreadable', 'unreadable', 'unreadable'],
        ['damaged', 'damaged', 'damaged'],
        ['too-new', 'too-new', 'newer'],
        ['no-entry', 'no-entry', 'unreadable'],
        ['edited', 'edited', 'unreadable'],
        ['stale', 'stale', 'changed'],
        ['replaced', 'replaced', 'changed'],
        ['ambiguous', 'ambiguous', 'duplicate'],
    ]

    test.each(mappingRows)('guard unreadable-reason: the loader failure %s maps to its reason (the table the copy read shares with the loader)', (_label, failure, reason) => {
        expect(new ExportModuleUnreadableError('m-x', 'Broken Module', new ModuleLoadError(failure, 'm-x', 'Broken Module')).reason).toBe(reason)
        expect(new ExportModuleUnreadableError('m-x', 'Broken Module', new Error('read failed')).reason).toBe('unreadable')
    })

    test('unreadable-reason: a real two-slot duplicate list is duplicate', async () => {
        const { db } = await bootedPage()
        slotsOf(db).push(fullModule('idc', 'Other'))
        const error = await errorOf(db)
        expect(error.cause).toBeInstanceOf(ModuleAmbiguousError)
        expect(error.reason).toBe('duplicate')
    })

    test('unreadable-reason: every reason words a different alert that names the module and never advises reload', () => {
        const reasons: ExportModuleFailure[] = ['damaged', 'missing', 'newer', 'changed', 'duplicate', 'unreadable']
        const texts = reasons.map(reason => language.backupFailedModuleUnreadable('Broken Module', reason))
        expect(new Set(texts).size).toBe(reasons.length)
        for (const text of texts) {
            expect(text).toContain('"Broken Module"')
            expect(text.toLowerCase()).not.toContain('reload')
        }
        const duplicate = language.backupFailedModuleUnreadable('Broken Module', 'duplicate')
        expect(duplicate).not.toContain('changed')
    })

    test('unreadable-reason: a duplicate list stops a full export with the duplicate text', async () => {
        const { db } = await bootedPage()
        slotsOf(db).push(fullModule('idc', 'Other'))
        const outcome = await SaveLocalBackup({ mode: 'inline' })
        expect(outcome.status).toBe('failed')
        expect(String(vi.mocked(alertError).mock.calls[0][0])).toBe(language.backupFailedModuleUnreadable('Module idc', 'duplicate'))
    })

    test('guard: resident slots are the same objects, in order, in a new array', async () => {
        const one = fullModule('x', 'One')
        const two = fullModule('x', 'Two')
        const db = databaseWith({ modules: [one, two] })
        useDatabase(db)
        const snapshot = await snapshotModuleList(db)
        expect(snapshot.modules).not.toBe(db.modules)
        expect(snapshot.modules?.[0]).toBe(one)
        expect(snapshot.modules?.[1]).toBe(two)
    })
})
