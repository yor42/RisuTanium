/**
 * What the boot's module mint (CHORE-205 L3 stage S4d-1m) does to the bytes a store holds, and what a stubbed page does
 * with them: the MVP upgrade (a profile written before the entry-fields tag boots whole, is tagged by its first pass and
 * is minted by the next boot), the passes and edits after a minted boot, the plain assembler and the `.bin` encode over a
 * minted profile, an upstream `.bin` imported into a store that then boots stubbed, and two tabs. Every row boots through
 * the real dispatch (`bootThroughDispatch`) with the real list derivation, because `fakeLists` carries no list versions
 * and so mints nothing. Mocked storage says nothing about a native backend.
 *
 * Labels in the titles: M rows need the mint and fail on the base at the "stubs were minted" precondition (or, for the
 * MVP row, at the second boot); G rows are compatibility guards that hold with and without the mint.
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
vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((book: unknown[]) => book),
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

import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import type { Database } from 'src/ts/storage/database.svelte'
import { SaveLocalBackup } from 'src/ts/drive/backuplocal'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { decodeRisuSave } from 'src/ts/storage/risuSave'
import { isModuleStub } from 'src/ts/storage/moduleStub'
import { resetPageBlockOwnerForTests } from 'src/ts/storage/pageBlockOwner'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { resetStore2BootForTest, type Store2BootResult } from 'src/ts/storage/store2/bootActive'
import { assembleDatabase, IDENTITY, previousFrom } from 'src/ts/storage/store2/codec'
import { hasCurrentEntryFields } from 'src/ts/storage/store2/codec/modules'
import { classifyCommitRead, firstCommitKey } from 'src/ts/storage/store2/commitKey'
import { encodeUnit, keyOfRef, readUnit, UNIT_TYPE, type Manifest, type ModuleEntry, type ModuleIndex } from 'src/ts/storage/store2/format'
import { importLegacyTree } from 'src/ts/storage/store2/legacy/importTree'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
import { acquireModule, ModuleLoadError } from 'src/ts/storage/store2/moduleAcquire'
import { isRecordedStub } from 'src/ts/storage/store2/moduleStubMatch'
import { resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { getActiveStore2Save, resetStore2SaveForTest } from 'src/ts/storage/store2/saveActive'
import { runStore2SaveLoop, type Store2LoopPort } from 'src/ts/storage/store2/saveLoop'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { bootThroughDispatch, countedBackend, createClock, peerCommit, savedDatabase, seedTree, startStore2, testEnv, type CountedBackend, type DispatchedBoot } from '../store2SaveKit'
import { buildSmall, type Obj } from './codecFixtures'
import { loadGolden, readerOver } from './legacyFixtures'

type Plain = Record<string, unknown>
type Lists = ReturnType<typeof createListDerivation>

interface Rig {
    counted: CountedBackend
    manifestKey: string
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

function plain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
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

function sourceOf(modules: Obj[], settings: Obj = {}, characters = 2): Database {
    return shortened({ ...(buildSmall(characters) as unknown as Obj), archiveCharacters: true, enabledModules: [], moduleIntergration: '', modules, ...settings }) as Database
}

/** Seeds `source` with the real list derivation (so its module entries are stub-eligible) into a counted backend. */
async function rigOf(modules: Obj[], settings: Obj = {}): Promise<Rig> {
    const counted = countedBackend()
    const seeded = await seedTree(counted.memory, plain(sourceOf(modules, settings)), testEnv(createClock(), 4242), createListDerivation())
    counted.reset()
    return {
        counted,
        manifestKey: seeded.manifestKey,
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

function keysOf(entry: ModuleEntry): string[] {
    return [entry.unit, entry.al, ...(entry.il === null ? [] : [entry.il])].map(ref => keyOfRef(ref as never))
}

/** The booted page: the answer, its database installed as the live one. */
async function boot(backend: Parameters<typeof bootThroughDispatch>[0], lists: Lists = createListDerivation(), env?: ReturnType<typeof testEnv>): Promise<DispatchedBoot & { db: Database }> {
    resetPage()
    const booted = await bootThroughDispatch(backend, { lists, env })
    const db = opened(booted.result).database
    h.state.db = db
    return Object.assign(booted, { db })
}

function resetPage(): void {
    resetStore2SaveForTest()
    resetResidencyForTest()
    resetStore2BootForTest()
    resetPageBlockOwnerForTests()
    resetPageStorageModeForTests()
}

function context() {
    const active = getActiveStore2Save()
    if (active?.encoder === undefined) {
        throw new Error('No save context.')
    }
    return { committer: active.session.committer, encoder: active.encoder }
}

interface Pass {
    unchanged: boolean
    committed: boolean
    carriedUnits: number
}

/** One pass through the active save context: planned, and committed and acknowledged when it is not `unchanged`. */
async function pass(db: Database, scope: { modules: boolean, whole: boolean }): Promise<Pass> {
    const { committer, encoder } = context()
    const plan = await encoder.plan(db, { marked: new Set(), ...scope })
    if (plan.unchanged) {
        return { unchanged: true, committed: false, carriedUnits: plan.carried.units }
    }
    const result = await committer.commit(await committer.readCommit(), plan.commitRequest())
    if (result.status !== 'committed') {
        throw new Error(`The pass came to ${result.status}.`)
    }
    plan.acknowledge()
    return { unchanged: false, committed: true, carriedUnits: plan.carried.units }
}

/** The identities of the three units of each module id (all `#0` handles) that the acknowledged encoding no longer holds. */
function missingFromAcknowledged(ids: readonly string[]): string[] {
    const held = context().encoder.acknowledged().units
    return ids.flatMap(id => [IDENTITY.module, IDENTITY.alModule, IDENTITY.ilModule].map(prefix => `${prefix}${id}#0`)).filter(identity => !held.has(identity))
}

const IDLE = { modules: false, whole: false }
const MODULES = { modules: true, whole: true }

async function storedIndex(memory: MemoryBackend): Promise<ModuleIndex> {
    const classified = classifyCommitRead(await memory.readCommit())
    if (classified.status !== 'parsed' || classified.value.current === null) {
        throw new Error('The commit key names no current manifest.')
    }
    const entries = memory.snapshot()
    const manifest = readUnit(entries.get(classified.value.current.key) as Uint8Array, UNIT_TYPE.manifest)
    if (manifest.status !== 'ok') {
        throw new Error('The manifest does not parse.')
    }
    const index = readUnit(entries.get(keyOfRef((manifest.value.body as Manifest).fixed.moduleIndex)) as Uint8Array, UNIT_TYPE.moduleIndex)
    if (index.status !== 'ok') {
        throw new Error('The module index does not parse.')
    }
    return index.value.body as ModuleIndex
}

function copyOf(memory: MemoryBackend): Map<string, Uint8Array> {
    return new Map([...memory.snapshot()].map(([key, bytes]) => [key, new Uint8Array(bytes)]))
}

function newKeys(before: Map<string, Uint8Array>, memory: MemoryBackend): string[] {
    return [...memory.snapshot().keys()].filter(key => !before.has(key)).sort()
}

const UNIT_TYPE_NAMES = new Map<number, string>(Object.entries(UNIT_TYPE).map(([name, byte]) => [byte, name]))

/** The unit type names (sorted, one per distinct type) of the keys written since `before`, read from each unit's type byte. */
function writtenTypes(before: Map<string, Uint8Array>, memory: MemoryBackend): string[] {
    const stored = memory.snapshot()
    const names = newKeys(before, memory).map((key) => {
        const type = (stored.get(key) as Uint8Array)[5]
        return UNIT_TYPE_NAMES.get(type) ?? `type-${type}`
    })
    return [...new Set(names)].sort()
}

/** The keys whose bytes differ, or that exist on one side only; empty means the two maps are byte for byte equal. */
function differing(before: Map<string, Uint8Array>, memory: MemoryBackend): string[] {
    const after = memory.snapshot()
    const keys = new Set([...before.keys(), ...after.keys()])
    return [...keys].filter((key) => {
        const a = before.get(key)
        const b = after.get(key)
        return a === undefined || b === undefined || a.length !== b.length || a.some((byte, position) => byte !== b[position])
    }).sort()
}

interface Fixture { manifestKey: string, units: { key: string, bytes: string }[], database: Obj }

/** The frozen pre-tag profile (`moduleIndexPreB1.fixture.json`) in a memory backend, committed as a first tree. */
async function mvpBackend(): Promise<{ memory: MemoryBackend, database: Obj }> {
    // `import.meta.url` is not a file URL under this runner, so the fixture is found from the repository root.
    const fixture = JSON.parse(readFileSync(path.join(process.cwd(), 'src/ts/storage/tests/store2/moduleIndexPreB1.fixture.json'), 'utf8')) as Fixture
    const memory = createMemoryBackend()
    for (const unit of fixture.units) {
        await memory.putUnit(unit.key, new Uint8Array(Buffer.from(unit.bytes, 'base64')))
    }
    const manifest = readUnit(memory.snapshot().get(fixture.manifestKey) as Uint8Array, UNIT_TYPE.manifest)
    if (manifest.status !== 'ok') {
        throw new Error('The fixture manifest does not parse.')
    }
    const env = testEnv(createClock(), 7)
    const first = firstCommitKey({ current: { key: fixture.manifestKey, at: env.now() }, staging: null, manifests: [manifest.value.body as Manifest] }, env)
    await memory.casCommit((await memory.readCommit()).token, encodeUnit(UNIT_TYPE.commit, first))
    return { memory, database: fixture.database }
}

//#region the .bin export, as exportStubForm and exportModules drive it

const decoder = new TextDecoder()

interface WrittenEntry {
    name: string
    data: Uint8Array
}

function writtenEntries(): WrittenEntry[] {
    const bytes = new Uint8Array(h.sink.writes.reduce((n, part) => n + part.length, 0))
    let at = 0
    for (const part of h.sink.writes) {
        bytes.set(part, at)
        at += part.length
    }
    const view = new DataView(bytes.buffer)
    const entries: WrittenEntry[] = []
    let offset = 0
    while (offset + 4 <= bytes.length) {
        const nameLength = view.getUint32(offset, true)
        offset += 4
        const name = decoder.decode(bytes.subarray(offset, offset + nameLength))
        offset += nameLength
        const dataLength = view.getUint32(offset, true)
        offset += 4
        entries.push({ name, data: bytes.slice(offset, offset + dataLength) })
        offset += dataLength
    }
    return entries
}

/** The database entry of a real `SaveLocalBackup` (inline form) of the live page, decoded by the legacy decoder. */
async function exportedDatabase(): Promise<Plain> {
    h.sink.writes.length = 0
    const outcome = await SaveLocalBackup({ mode: 'inline' })
    if (outcome.status !== 'saved') {
        throw new Error(`The export came to ${outcome.status}: ${JSON.stringify(outcome, (_key, value: unknown) => value instanceof Error ? `${value.name}: ${value.message}` : value)}`)
    }
    const entry = writtenEntries().find(candidate => candidate.name === 'database.risudat')
    if (entry === undefined) {
        throw new Error('The export wrote no database entry.')
    }
    return await decodeRisuSave(entry.data) as unknown as Plain
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

describe('the MVP upgrade: a profile written before the entry-fields tag', () => {
    // The control passes on the base as well (archiving off mints nothing in either build); the mint row fails there at the second boot.
    test.each([
        ['M mvp-shaped-profile-boots-resident-then-tags-then-mints', true],
        ['G mvp-shaped-profile-with-archiving-off-boots-resident-throughout', false],
    ] as const)(
        '%s',
        async (_label, archive) => {
            const { memory, database } = await mvpBackend()

            // Boot 1: the entries carry no tag, so nothing is stub-eligible and every module is whole.
            const first = await boot(memory)
            expect(slotsOf(first.db)).toHaveLength((database.modules as unknown[]).length)
            expect(stubIdsOf(first.db)).toEqual([])
            const indexBefore = await storedIndex(memory)
            expect(indexBefore.entries.some(hasCurrentEntryFields)).toBe(false)
            const moduleKeysBefore = new Set(indexBefore.entries.flatMap(keysOf))

            // The profile never chose the setting (the fixture omits it), so the choice is made on the live page and the first pass writes it.
            first.db.archiveCharacters = archive
            const before = copyOf(memory)
            const tagging = await pass(first.db, MODULES)
            expect(tagging.committed).toBe(true)
            const indexAfter = await storedIndex(memory)
            const written = newKeys(before, memory)
            // The pass writes exactly a manifest, the rewritten module index and the config (which carries the setting): no
            // module, asset list or inlay list unit, whatever its id. Every entry's units are the reused ones.
            expect(writtenTypes(before, memory)).toEqual(['configRoot', 'manifest', 'moduleIndex'])
            expect(new Set(indexAfter.entries.flatMap(keysOf))).toEqual(moduleKeysBefore)
            expect(written).toContain(keyOfRef((await manifestFixed(memory)).moduleIndex))
            expect(indexAfter.entries.every(hasCurrentEntryFields)).toBe(true)

            // Boot 2 (the minting boot) and everything after it write nothing: the snapshot is taken before it.
            const settled = copyOf(memory)
            const second = await boot(memory)
            const expected = archive ? ['uniq', 'plain'] : []
            expect(stubIdsOf(second.db)).toEqual(expected)
            if (archive) {
                slotsOf(second.db).forEach((slot, position) => {
                    if (stubbed(slot)) {
                        expect(isRecordedStub(plain(slot) as never, indexAfter.entries[position]), String(slot.id)).toBe(true)
                    }
                })
                // The duplicate-id holders stay whole beside the stubs.
                expect(slotsOf(second.db).filter(slot => slot.id === 'dup').every(slot => !stubbed(slot))).toBe(true)
            }

            // An idle pass and a forced module-flagged pass write nothing either.
            const idle = await pass(second.db, IDLE)
            const forced = await pass(second.db, MODULES)
            expect(idle.unchanged).toBe(true)
            expect(forced.unchanged).toBe(true)
            expect(differing(settled, memory)).toEqual([])
            if (archive) {
                expect(forced.carriedUnits).toBeGreaterThan(0)
            }
        },
    )
})

async function manifestFixed(memory: MemoryBackend): Promise<Manifest['fixed']> {
    const classified = classifyCommitRead(await memory.readCommit())
    if (classified.status !== 'parsed' || classified.value.current === null) {
        throw new Error('The commit key names no current manifest.')
    }
    const manifest = readUnit(memory.snapshot().get(classified.value.current.key) as Uint8Array, UNIT_TYPE.manifest)
    if (manifest.status !== 'ok') {
        throw new Error('The manifest does not parse.')
    }
    return (manifest.value.body as Manifest).fixed
}

describe('what a pass and an edit write after a stubbed boot', () => {
    test('M first-pass-after-a-stubbed-boot-keeps-entries-and-units', async () => {
        const rig = await rigOf(fiveModules(), REFERENCING)
        const memory = rig.counted.memory
        const booted = await boot(rig.counted.backend)
        expect(stubIdsOf(booted.db)).toEqual(UNREFERENCED)
        const entriesBefore = plain((await storedIndex(memory)).entries)

        // A module-flagged pass over nothing changed writes nothing and carries every stub's three units.
        const before = copyOf(memory)
        const untouched = await pass(booted.db, MODULES)
        expect(untouched.unchanged).toBe(true)
        expect(untouched.carriedUnits).toBeGreaterThan(0)
        expect(differing(before, memory)).toEqual([])

        // A pass that has something else to write rewrites no module unit and leaves every index entry as it was.
        booted.db.globalNote = 'a changed global note'
        const written = await pass(booted.db, MODULES)
        expect(written.committed).toBe(true)
        expect((await savedDatabase(memory)).globalNote).toBe('a changed global note')
        expect(plain((await storedIndex(memory)).entries)).toEqual(entriesBefore)
        const moduleKeys = new Set(rig.entries.flatMap(keysOf))
        // Judged by unit type: no module, asset list or inlay list unit is written, whatever key it would have.
        expect(writtenTypes(before, memory)).toEqual(['configRoot', 'manifest'])
        for (const key of moduleKeys) {
            expect(memory.snapshot().has(key), key).toBe(true)
        }
        // The committed pass is the acknowledged encoding now: it still holds the stubs' units, so the next module pass carries them again.
        expect(missingFromAcknowledged(UNREFERENCED)).toEqual([])
        expect((await pass(booted.db, MODULES)).unchanged).toBe(true)
    })

    test('M first-edit-after-a-stubbed-boot-carries-the-others', async () => {
        const rig = await rigOf(fiveModules(), REFERENCING)
        const memory = rig.counted.memory
        const booted = await boot(rig.counted.backend)
        expect(stubIdsOf(booted.db)).toEqual(UNREFERENCED)
        const entriesBefore = plain((await storedIndex(memory)).entries)

        const edited = slotsOf(booted.db).find(slot => slot.id === 'ida')
        if (edited === undefined) {
            throw new Error('No resident module ida.')
        }
        edited.name = 'Module ida, edited'
        const before = copyOf(memory)
        const written = await pass(booted.db, MODULES)
        expect(written.committed).toBe(true)

        const index = await storedIndex(memory)
        index.entries.forEach((entry, position) => {
            if (UNREFERENCED.includes(entry.id)) {
                expect(plain(entry), entry.id).toEqual(entriesBefore[position])
            }
        })
        // Only the edited module's own unit is rewritten (one module-type unit), with the index and manifest that name it; no
        // asset list or inlay list unit is written for any module.
        expect(writtenTypes(before, memory)).toEqual(['manifest', 'module', 'moduleIndex'])
        expect(newKeys(before, memory).filter(key => (memory.snapshot().get(key) as Uint8Array)[5] === UNIT_TYPE.module)).toHaveLength(1)
        // The stubs' units are still stored under the keys the entries name, and the edit reads back from the store.
        for (const entry of rig.entries.filter(candidate => UNREFERENCED.includes(candidate.id))) {
            for (const key of keysOf(entry)) {
                expect(memory.snapshot().has(key), key).toBe(true)
            }
        }
        const saved = slotsOf(await savedDatabase(memory))
        expect(saved.map(slot => slot.name)).toEqual(fiveModules().map(slot => slot.name === 'Module ida' ? 'Module ida, edited' : slot.name))
        expect(saved.map(slot => slot.id)).toEqual(rig.entries.map(entry => entry.id))
        // A second pass over the acknowledged edit carries the stubs again and has nothing left to write.
        expect(missingFromAcknowledged(UNREFERENCED)).toEqual([])
        expect((await pass(booted.db, MODULES)).unchanged).toBe(true)
    })

    test('M load-edit-save-of-a-stub: the real loader installs the body, the edit is saved, the other stubs are carried, and a reload reproduces it', async () => {
        const rig = await rigOf(fiveModules(), REFERENCING)
        const memory = rig.counted.memory
        const booted = await boot(rig.counted.backend)
        expect(stubIdsOf(booted.db)).toEqual(UNREFERENCED)
        const entriesBefore = plain((await storedIndex(memory)).entries)

        const handle = await acquireModule('idc')
        expect(handle).not.toBeNull()
        const slot = slotsOf(booted.db).find(candidate => candidate.id === 'idc')
        expect(slot === undefined || stubbed(slot)).toBe(false)
        if (slot === undefined) {
            throw new Error('No slot idc.')
        }
        expect(slot.name).toBe('Module idc')
        slot.name = 'Module idc, edited'
        const written = await pass(booted.db, MODULES)
        expect(written.committed).toBe(true)

        const index = await storedIndex(memory)
        expect(index.entries[0].unit).not.toEqual(entriesBefore[0].unit)
        index.entries.forEach((entry, position) => {
            if (entry.id === 'idd' || entry.id === 'ide') {
                expect(plain(entry), entry.id).toEqual(entriesBefore[position])
            }
        })
        const saved = slotsOf(await savedDatabase(memory))
        expect(saved[0].name).toBe('Module idc, edited')
        expect(saved.slice(1).map(entry => entry.name)).toEqual(fiveModules().slice(1).map(entry => entry.name))

        // The page reloads: the edited module is unreferenced again, so it boots as a stub and loads with the edit.
        const reloaded = await boot(rig.counted.backend)
        expect(stubIdsOf(reloaded.db)).toEqual(UNREFERENCED)
        expect(await acquireModule('idc')).not.toBeNull()
        expect(slotsOf(reloaded.db)[0].name).toBe('Module idc, edited')
    })
})

// The downgrade property is a compatibility guard, but every row here also asserts that the stubs were minted, so on the
// base (which mints nothing) these rows fail at that precondition instead of passing vacuously.
describe('M downgrade-read: a build that does not know the mint reads the store', () => {
    test('M downgrade-read: the store written by a minted boot plus a pass is assembled whole by the plain assembler and equals the seed', async () => {
        const rig = await rigOf(fiveModules(), REFERENCING)
        const memory = rig.counted.memory
        const booted = await boot(rig.counted.backend)
        expect(stubIdsOf(booted.db)).toEqual(UNREFERENCED)

        await pass(booted.db, MODULES)
        const classified = classifyCommitRead(await memory.readCommit())
        if (classified.status !== 'parsed' || classified.value.current === null) {
            throw new Error('The commit key names no current manifest.')
        }
        const manifest = readUnit(memory.snapshot().get(classified.value.current.key) as Uint8Array, UNIT_TYPE.manifest)
        if (manifest.status !== 'ok') {
            throw new Error('The manifest does not parse.')
        }
        const entries = memory.snapshot()
        const assembled = assembleDatabase(manifest.value.body as Manifest, { get: key => entries.get(key) })
        expect(slotsOf(assembled).some(stubbed)).toBe(false)
        expect(plain(assembled)).toEqual(plain(rig.seeded))
    })

    test('M downgrade-read: the MVP profile after its tagging pass and a minted boot assembles whole and equals the seed', async () => {
        const { memory, database } = await mvpBackend()
        const first = await boot(memory)
        first.db.archiveCharacters = true
        await pass(first.db, MODULES)
        const second = await boot(memory)
        expect(stubIdsOf(second.db)).toEqual(['uniq', 'plain'])
        await pass(second.db, MODULES)

        const saved = await savedDatabase(memory)
        expect(slotsOf(saved).some(stubbed)).toBe(false)
        // The whole database equals the seed, except the setting the test chose on the live page.
        expect(plain(saved)).toEqual({ ...plain(database), archiveCharacters: true })
    })

    test.each([['stubs loaded first', true], ['stubs loaded by the export', false]] as const)(
        'M downgrade-read: the .bin encode of a minted profile, %s, equals the all-resident control',
        async (_label, loadFirst) => {
            const control = await rigOf(fiveModules(), REFERENCING)
            const controlBoot = await boot(control.counted.backend, { ...createListDerivation(), moduleListVersions: undefined })
            expect(stubIdsOf(controlBoot.db)).toEqual([])
            const controlExport = await exportedDatabase()

            const rig = await rigOf(fiveModules(), REFERENCING)
            const booted = await boot(rig.counted.backend)
            expect(stubIdsOf(booted.db)).toEqual(UNREFERENCED)
            if (loadFirst) {
                for (const id of UNREFERENCED) {
                    expect(await acquireModule(id)).not.toBeNull()
                }
                expect(stubIdsOf(booted.db)).toEqual([])
            }
            const minted = await exportedDatabase()

            // The export reads the stored copy: the stubs the page booted with are still stubs afterwards.
            expect(stubIdsOf(booted.db)).toEqual(loadFirst ? [] : UNREFERENCED)
            expect((minted.modules as Plain[]).map(slot => slot.name)).toEqual(fiveModules().map(slot => slot.name))
            expect(minted.modules).toEqual(controlExport.modules)
            expect(minted).toEqual(controlExport)
        },
    )
})

// What the export row proves: the export of the minted page equals the export of the same store booted all-resident, and
// its module ids and names equal the imported modules'. That the all-resident export equals the import itself is the
// subject of the composedRoundTrip and storeImport tests, not of this row.
describe('M upstream-bin-import-then-stubbed-boot-then-export-equals-the-all-resident-export', () => {
    test.each([['upstream-full.bin'], ['fork-full.bin']])('M upstream-bin-import-then-stubbed-boot-then-export-equals-the-all-resident-export: %s', async (file) => {
        const golden = await loadGolden(file)
        const importedModules = plain((golden.tree as unknown as { modules: Plain[] }).modules)
        expect(importedModules.length).toBeGreaterThan(0)

        // The page's store holds a small profile that the import replaces; the import tree is planned under the real derivation, as the page's does.
        const kit = await startStore2({ db: plain(buildSmall(1)), lists: createListDerivation() })
        const memory = kit.memory
        kit.clock.advance(1000)
        const outcome = await importLegacyTree({
            source: { tree: golden.tree },
            reader: readerOver(golden.units),
            committer: kit.committer,
            backend: kit.counted.backend,
            lists: createListDerivation(),
            env: testEnv(kit.clock, 300),
            resolve: { newId: () => 'placeholder-chat-id', now: () => 1_700_000_000_001 },
        }, { async confirmIncomplete() { return true } })
        expect(outcome.status).toBe('committed')

        // The control boots the same store under a derivation that mints nothing.
        const controlBoot = await boot(memory, { ...createListDerivation(), moduleListVersions: undefined })
        expect(stubIdsOf(controlBoot.db)).toEqual([])
        const controlExport = await exportedDatabase()

        const booted = await boot(memory)
        // E8: without stubs the export below proves nothing about the mint.
        const index = await storedIndex(memory)
        const stubs = slotsOf(booted.db).filter((slot, position) => stubbed(slot) && isRecordedStub(plain(slot) as never, index.entries[position]))
        expect(stubs.length).toBeGreaterThan(0)
        const stubsBefore = stubIdsOf(booted.db)
        const exported = await exportedDatabase()

        // The export reads the stored copy: the imported modules that booted as stubs are still stubs afterwards.
        expect(stubIdsOf(booted.db)).toEqual(stubsBefore)
        expect(exported.modules).toEqual(controlExport.modules)
        expect(exported).toEqual(controlExport)
        expect((exported.modules as Plain[]).map(slot => ({ id: slot.id, name: slot.name }))).toEqual(importedModules.map(slot => ({ id: slot.id, name: slot.name })))
    })
})

describe('two tabs over one store', () => {
    interface Loop {
        failures: unknown[]
        stop(): void
        tracker: toSaveType
        due(): void
    }

    /** The save loop of the booted page over a hand-built port, as `saveLoop.test.ts` drives it. */
    function runLoop(db: Database, peer: DispatchedBoot['peer']): Loop {
        let stopped = false
        const state = { due: false, dirty: false }
        const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
        const reloadFlag = { state: false }
        let tail: Promise<void> = Promise.resolve()
        const idle = () => new Promise<void>((resolve) => {
            if (!stopped) {
                setTimeout(resolve, 2)
            }
        })
        const loop: Loop = {
            failures: [],
            tracker,
            stop: () => { stopped = true },
            due: () => { state.due = true; state.dirty = true },
        }
        const active = getActiveStore2Save()
        if (active === null) {
            throw new Error('No save context.')
        }
        expect(active.peer).toBe(peer)
        const port: Store2LoopPort = {
            tracker,
            reloadFlag,
            getDatabase: () => db,
            mergeBack() { },
            liveCheck: () => { },
            sweep: () => { },
            isDue: () => state.due,
            isDirty: () => state.dirty,
            hasDrafts: () => false,
            beginIteration() { state.due = false },
            endIteration() { },
            snapshotTaken() { state.dirty = false },
            requestPass() { state.dirty = true; state.due = true },
            unsavable() { },
            saved() { },
            broadcast() { },
            peerHeard: () => false,
            setStopped() { },
            notifyTooLarge() { },
            reportFailure(error) { loop.failures.push(error); return 1 },
            reportUncountedFailure(error) { loop.failures.push(error); return 1 },
            async withWriteLock(run) {
                const before = tail
                let release: () => void = () => { }
                tail = new Promise<void>((resolve) => { release = resolve })
                await before
                try {
                    return await run()
                } finally {
                    release()
                }
            },
            wait: idle,
            sleep: idle,
            sleepForever: () => new Promise<never>(() => { }),
            now: () => Date.now(),
        }
        runStore2SaveLoop(active, port).catch((error: unknown) => { loop.failures.push(error) })
        return loop
    }

    async function until(check: () => boolean, label: string): Promise<void> {
        const deadline = Date.now() + 4000
        while (!check()) {
            if (Date.now() > deadline) {
                throw new Error(`Timed out waiting for ${label}.`)
            }
            await new Promise<void>(resolve => setTimeout(resolve, 5))
        }
    }

    /** Tab A: a store seeded with the real derivation, booted through the dispatch on the kit's clock. Tab B commits through `peerCommit`. */
    async function tabs(characters = 2) {
        const kit = await startStore2({ db: plain(sourceOf(fiveModules(), REFERENCING, characters)), lists: createListDerivation() })
        const a = await boot(kit.counted.backend, createListDerivation(), testEnv(kit.clock, 555))
        expect(stubIdsOf(a.db)).toEqual(UNREFERENCED)
        return { kit, a }
    }

    // No characters, so the minted module stubs are the only stubs of the page: they alone drive the Reload-only prompt.
    test('M a peer commit that drops this tab\'s manifest refuses its carrying commit, and the stubbed page is offered Reload only (MC-621)', async () => {
        const { kit, a } = await tabs(0)
        const stubNames = slotsOf(a.db).filter(stubbed).map(slot => String(slot.name))
        expect(slotsOf(a.db).filter(stubbed).map(slot => String(slot.id))).toEqual(UNREFERENCED)
        expect(a.db.characters).toHaveLength(0)

        // Tab B edits module X and commits; each commit is at least an admission interval after the last, so this tab's manifest leaves the base.
        for (let round = 0; round < 22; round++) {
            kit.clock.advance(6 * 60 * 1000)
            await peerCommit(kit, (peerDb) => { (peerDb.modules as unknown as Plain[])[0].name = `peer edit ${round}` }, 100 + round)
        }

        // Tab A's own carrying commit (it has an edit of its own and carries the stubs' units over the base it loaded).
        a.db.globalNote = 'tab A edit'
        const { committer, encoder } = context()
        const plan = await encoder.plan(a.db, { marked: new Set(), modules: true, whole: true })
        expect(plan.unchanged).toBe(false)
        expect(plan.carried.units).toBeGreaterThan(0)
        const stored = copyOf(kit.memory)
        const result = await committer.commit(await committer.readCommit(), plan.commitRequest())
        expect(result).toMatchObject({ status: 'refused', reason: 'base-unnamed' })
        // The refused commit wrote nothing: the store is byte for byte as tab B left it and still holds tab B's last edit.
        expect(differing(stored, kit.memory)).toEqual([])
        expect(slotsOf(await savedDatabase(kit.memory))[0].name).toBe('peer edit 21')

        // The save loop of the same page judges its base first, parks, and offers Reload only: a page holding stubs over an unnamed base cannot save.
        const loop = runLoop(a.db, a.peer)
        loop.tracker.modules = true
        loop.due()
        await until(() => a.peer.asked.length === 1, 'the park prompt')
        loop.stop()

        expect(a.peer.asked[0].offers).toEqual(['reload'])
        expect(a.peer.asked[0]).toMatchObject({ saveMineUnavailable: 'carries' })
        const blocked = (a.peer.asked[0] as unknown as { blocked: { names: string[], count: number } }).blocked
        expect([...blocked.names].sort()).toEqual([...stubNames].sort())
        expect(loop.failures).toEqual([])
    })

    test('M after a peer commit this tab loads the body its own entry names, never the peer\'s', async () => {
        const { kit, a } = await tabs()
        await peerCommit(kit, (peerDb) => { (peerDb.modules as unknown as Plain[])[0].name = 'the peer\'s idc' })
        expect(slotsOf(await savedDatabase(kit.memory))[0].name).toBe('the peer\'s idc')

        const handle = await acquireModule('idc')
        expect(handle?.module.name).toBe('Module idc')
        expect(slotsOf(a.db)[0].name).toBe('Module idc')
    })

    test('M when the unit this tab\'s entry names is gone the load fails naming the module, and the peer\'s body is not installed', async () => {
        const { kit, a } = await tabs()
        await peerCommit(kit, (peerDb) => { (peerDb.modules as unknown as Plain[])[0].name = 'the peer\'s idc' })
        const mine = (await storedIndexAt(kit.memory, kit.seeded.manifestKey)).entries[0]
        kit.memory.poke(keyOfRef(mine.unit as never), null)

        const error = await acquireModule('idc').then(() => null, (thrown: unknown) => thrown)

        expect(error).toBeInstanceOf(ModuleLoadError)
        expect((error as ModuleLoadError).moduleId).toBe('idc')
        expect((error as ModuleLoadError).reason).toBe('damaged')
        expect(stubbed(slotsOf(a.db)[0])).toBe(true)
        expect(slotsOf(a.db)[0].name).not.toBe('the peer\'s idc')
    })
})

async function storedIndexAt(memory: MemoryBackend, manifestKey: string): Promise<ModuleIndex> {
    const entries = memory.snapshot()
    const manifest = readUnit(entries.get(manifestKey) as Uint8Array, UNIT_TYPE.manifest)
    if (manifest.status !== 'ok') {
        throw new Error('The manifest does not parse.')
    }
    const index = readUnit(entries.get(keyOfRef((manifest.value.body as Manifest).fixed.moduleIndex)) as Uint8Array, UNIT_TYPE.moduleIndex)
    if (index.status !== 'ok') {
        throw new Error('The module index does not parse.')
    }
    return index.value.body as ModuleIndex
}
