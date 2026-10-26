/**
 * A full and a partial local export (`SaveLocalBackup`, `SavePartialLocalBackup`, `src/ts/drive/backuplocal.ts`) read
 * every module body before anything is opened (`snapshotModuleList`, `src/ts/drive/exportModules.ts`) and write that
 * snapshot, not the live list, as the database entry's `modules`. A module that cannot be read stops the export before
 * the file or the save dialog, naming the module. The harness is the one `exportStreamedEntry.test.ts` documents; the
 * loader double installs a body by replacing the stub slot of its id in the live list, as the real loader does.
 * A passing test here is not evidence about the Tauri or Node backends.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import { decompressSync } from 'fflate'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation:
    // without it restore takes its no-Web-Locks branch and never waits on
    // another tab, which is outside what this file exercises.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

const backupSink = vi.hoisted(() => ({ writes: [] as Uint8Array[], opened: 0 }))
const releaseLog = vi.hoisted(() => ({ released: [] as string[] }))
const forageKeysMock = vi.hoisted(() => vi.fn(async (): Promise<string[]> => []))
const forageGetItemMock = vi.hoisted(() => vi.fn(async (_key: string): Promise<Uint8Array | null> => null))
const forageSetItemMock = vi.hoisted(() => vi.fn(async (_key: string, _data: Uint8Array): Promise<void> => {}))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const alertConfirmMock = vi.hoisted(() => vi.fn(async (_message: string) => true))
const alertErrorMock = vi.hoisted(() => vi.fn())
const alertMdMock = vi.hoisted(() => vi.fn())
const alertNormalMock = vi.hoisted(() => vi.fn())

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
    get isTauri() { return platformBox.isTauri },
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

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => 'backup-output.bin'),
}))

/** The real acquire with each handle's release recorded, so a test sees which handles were let go. */
vi.mock(import('src/ts/storage/store2/moduleAcquire'), async (importOriginal) => {
    const original = await importOriginal()
    return {
        ...original,
        acquireModule: async (id: string, signal?: AbortSignal) => {
            const acquired = await original.acquireModule(id, signal)
            if (acquired === null) {
                return null
            }
            return {
                module: acquired.module,
                release: () => {
                    releaseLog.released.push(id)
                    acquired.release()
                },
            }
        },
    }
})

vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => {
            backupSink.opened++
            return {
                ready: Promise.resolve(),
                writable: {
                    getWriter: () => ({
                        write: async (chunk: Uint8Array) => { backupSink.writes.push(chunk) },
                        close: async () => { },
                    }),
                },
            }
        },
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

/** The characters a store2 entity stub reads back, by entity key; any other stub reads through the real unit store. */
const entityBox = vi.hoisted(() => ({ characters: new Map<string, unknown>() }))

vi.mock(import('src/ts/process/coldCharacterRestore'), async (importOriginal) => {
    const original = await importOriginal()
    return {
        ...original,
        readColdCharacterCopy: async (stub: Parameters<typeof original.readColdCharacterCopy>[0]) => {
            const entity = entityBox.characters.get(String(stub.coldstorage))
            return entity === undefined
                ? original.readColdCharacterCopy(stub)
                : { status: 'ok' as const, character: structuredClone(entity) as typeof stub }
        },
    }
})

//#endregion

//#region units and the legacy OPFS stand-in

/** The page store's units (coldstorage/<key>), kept apart from the assets, and every unit key read from it. */
const unitMem = new Map<string, Uint8Array>()
const unitReadLog: string[] = []

function isUnitKey(key: string): boolean {
    return key.startsWith('coldstorage/')
}

/** Places raw bytes as the page store's unit key. */
function putRawUnit(key: string, bytes: Uint8Array): void {
    unitMem.set('coldstorage/' + key, bytes)
}

class MockNotFoundError extends Error {
    name = 'NotFoundError'
}

/** The legacy OPFS unit files: no test here places one, so every read falls through to "not found". */
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

import { SaveLocalBackup, SavePartialLocalBackup } from 'src/ts/drive/backuplocal'
import { ExportModuleUnreadableError, snapshotModuleList, type ExportModuleFailure } from 'src/ts/drive/exportModules'
import { dbWriteLock, LocalWriter } from 'src/ts/globalApi.svelte'
import { isBusy } from 'src/ts/process/memory/busyActions'
import { writeRisuSaveV0 } from 'src/ts/storage/risuSaveV0'
import { decodeRisuSave } from 'src/ts/storage/risuSave'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE } from 'src/ts/storage/moduleStub'
import { ModuleAmbiguousError, ModuleLoadError, registerModuleLoader, unregisterModuleLoader, type ModuleLoadFailure } from 'src/ts/storage/store2/moduleAcquire'
import { DBState } from 'src/ts/stores.svelte'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'
import { save } from '@tauri-apps/plugin-dialog'
import { language } from 'src/lang'
import { ModuleStubRefusal } from 'src/ts/storage/moduleStub'

//#region helpers

const decoder = new TextDecoder()

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

/** The entries in the sink, parsed strictly from the bytes written. */
function writtenEntries(): { name: string, data: Uint8Array }[] {
    const bytes = concat(backupSink.writes)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const entries: { name: string, data: Uint8Array }[] = []
    let offset = 0
    while (offset < bytes.length) {
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

function databaseEntry(): Uint8Array {
    const entries = writtenEntries()
    expect(entries.at(-1)?.name).toBe('database.risudat')
    return entries.at(-1)!.data
}

async function decodedDatabase(): Promise<Record<string, unknown>> {
    return await decodeRisuSave(databaseEntry()) as Record<string, unknown>
}

type Slot = Database['modules'][number]

function fullModule(id: string, name: string, extra: Record<string, unknown> = {}): Slot {
    return { id, name, description: `${name} description`, ...extra } as unknown as Slot
}

function stubSlot(id: string, name: string): Slot {
    return { id, name, [MODULE_STUB_KEY]: MODULE_STUB_VALUE } as unknown as Slot
}

function makeLiveCharacter(chaId: unknown, name: string): Database['characters'][number] {
    return { chaId, name, type: 'character', chatPage: 0, chats: [] } as unknown as Database['characters'][number]
}

function databaseWith(fields: Record<string, unknown>): Database {
    return { characters: [makeLiveCharacter('a', 'A')], personas: [], characterOrder: ['a'], botPresets: [], ...fields } as unknown as Database
}

function useDatabase(db: Database): void {
    getDatabaseMock.mockImplementation(() => db)
    DBState.db = db
}

/** The bodies a loader double installs, by module id. */
const bodies = new Map<string, Slot>()
const loadLog: string[] = []

/** Replaces the stub slot of the handle's id in the live list with its body and returns the slot read back. */
function installBody(id: string): Slot | null {
    const modules = DBState.db.modules
    const index = modules.findIndex((slot) => slot.id === id)
    if (index === -1) {
        return null
    }
    modules[index] = bodies.get(id)!
    return modules[index]
}

/** Registers a loader that installs the body of the handle's id into the live list through `installBody`; `duringLoad` runs first. */
function installLoaderDouble(duringLoad?: () => void): void {
    registerModuleLoader(async (handle) => {
        const id = handle.replace(/#0$/, '')
        loadLog.push(id)
        duringLoad?.()
        if (!bodies.has(id)) {
            throw new Error(`no body for ${id}`)
        }
        return installBody(id)
    })
}

interface Profile {
    name: string
    run: () => Promise<unknown>
    kv: boolean
}

const PROFILES: Profile[] = [
    { name: 'full writer', run: () => SaveLocalBackup(), kv: false },
    { name: 'partial writer', run: () => SavePartialLocalBackup(), kv: false },
    { name: 'kv-block (V0)', run: () => SaveLocalBackup(), kv: true },
]

//#endregion

beforeEach(() => {
    platformBox.isTauri = false
    backupSink.writes.length = 0
    backupSink.opened = 0
    releaseLog.released.length = 0
    loadLog.length = 0
    bodies.clear()
    unitMem.clear()
    forageKeysMock.mockReset()
    forageGetItemMock.mockReset()
    alertConfirmMock.mockClear()
    alertErrorMock.mockClear()
    vi.mocked(save).mockClear()
    forageKeysMock.mockImplementation(async () => [])
    forageGetItemMock.mockImplementation(async () => null)
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
    getDatabaseMock.mockImplementation(() => databaseWith({}))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
})

afterEach(() => {
    unregisterModuleLoader()
    vi.restoreAllMocks()
})

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

/** Whether the console received an error whose message holds `text`. */
function consoleErrorMentions(text: string): boolean {
    return consoleErrorSpy.mock.calls.some((call) => call.some((arg) => arg instanceof Error && arg.message.includes(text)))
}

const BODY_A = fullModule('m-a', 'Module A', { cjs: 'a-body' })
const BODY_B = fullModule('m-b', 'Module B', { regex: [{ comment: 'r', in: 'x', out: 'y', type: 'editinput' }] })

/** The same tree with every module a body: the all-full control the stub export must unpack equal to. */
function treeFor(profile: Profile, modules: Slot[], characters: unknown[]): Database {
    return databaseWith({
        modules,
        characters,
        characterOrder: ['a'],
        ...(profile.kv ? { upstreamKvBlocks: { 'kv:bar': { version: 1, entries: [] } } } : {}),
    })
}

async function exportedTree(profile: Profile, modules: Slot[], characters: unknown[]): Promise<Record<string, unknown>> {
    backupSink.writes.length = 0
    useDatabase(treeFor(profile, modules, characters))
    const outcome = await profile.run() as { status: string }
    expect(outcome.status).toBe('saved')
    return withoutMintedIds(await decodedDatabase())
}

/** The repair mints a random id for a character that has none; the comparison sees a fixed one instead. */
function withoutMintedIds(tree: Record<string, unknown>): Record<string, unknown> {
    const characters = (tree.characters as { chaId: string, name: string }[]).map((c) => c.name === 'No Id' ? { ...c, chaId: 'minted' } : c)
    return { ...tree, characters }
}

const CHARACTER_SETS: [string, () => unknown[]][] = [
    ['no repair', () => [makeLiveCharacter('a', 'A')]],
    ['repair needed', () => [makeLiveCharacter('a', 'A'), makeLiveCharacter(undefined, 'No Id')]],
]

describe.each(PROFILES)('$name', (profile) => {
    describe.each(CHARACTER_SETS)('%s', (_label, characters) => {
        test('export-unpacks-equal-with-stub: a module stub in the list unpacks equal to an all-full export', async () => {
            const control = await exportedTree(profile, [fullModule('m-r', 'Resident'), BODY_A, BODY_B], characters())

            bodies.set('m-a', BODY_A)
            bodies.set('m-b', BODY_B)
            installLoaderDouble()
            // The live list is emptied once the writer is open, so only the list read before it opened can supply the modules.
            const realInit = LocalWriter.prototype.init
            vi.spyOn(LocalWriter.prototype, 'init').mockImplementation(async function (this: LocalWriter, ...args: Parameters<LocalWriter['init']>) {
                const result = await realInit.apply(this, args)
                DBState.db.modules.splice(0, DBState.db.modules.length)
                return result
            })
            const exported = await exportedTree(profile, [fullModule('m-r', 'Resident'), stubSlot('m-a', 'Module A'), stubSlot('m-b', 'Module B')], characters())

            expect(loadLog).toEqual(['m-a', 'm-b'])
            expect(exported.modules).toEqual(control.modules)
            expect(exported).toEqual(control)
        })
    })

    test('guard: duplicate resident ids are kept as separate slots, in order', async () => {
        const first = fullModule('dup', 'First', { cjs: '1' })
        const second = fullModule('dup', 'Second', { cjs: '2' })
        const exported = await exportedTree(profile, [first, second], [makeLiveCharacter('a', 'A')])

        expect((exported.modules as { name: string }[]).map((m) => m.name)).toEqual(['First', 'Second'])
    })

    test('unreadable-module-stops-before-open: a failing loader names the module in the console and nothing is opened', async () => {
        useDatabase(treeFor(profile, [stubSlot('m-a', 'Module A'), stubSlot('m-b', 'Broken Module')], [makeLiveCharacter('a', 'A')]))
        bodies.set('m-a', BODY_A)
        registerModuleLoader(async (handle) => {
            if (handle === 'm-b#0') {
                throw new Error('read failed')
            }
            return installBody('m-a')
        })
        const openSpy = vi.spyOn(LocalWriter.prototype, 'init')

        const outcome = await profile.run() as { status: string, file?: string }

        expect(outcome.status).toBe('failed')
        expect(outcome.file).toBe('untouched')
        expect(openSpy).not.toHaveBeenCalled()
        expect(backupSink.opened).toBe(0)
        expect(backupSink.writes.length).toBe(0)
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        const shown = String(alertErrorMock.mock.calls[0][0])
        // The alert names the module and is not the generic text; a plain loader failure claims no cause.
        expect(shown).toContain('Broken Module')
        expect(shown).not.toBe(language.backupFailedNothingWritten())
        expect(shown).toBe(language.backupFailedModuleUnreadable('Broken Module', 'unreadable'))
        expect(consoleErrorMentions('Broken Module')).toBe(true)
        expect(releaseLog.released).toEqual(['m-a'])
    })

    test('a stub removed from the live list during an earlier load stops the export before anything opens and is named in the console', async () => {
        const db = treeFor(profile, [stubSlot('m-a', 'Module A'), stubSlot('m-b', 'Vanished')], [makeLiveCharacter('a', 'A')])
        useDatabase(db)
        bodies.set('m-a', BODY_A)
        installLoaderDouble(() => {
            const index = DBState.db.modules.findIndex((slot) => slot.id === 'm-b')
            if (index !== -1) {
                DBState.db.modules.splice(index, 1)
            }
        })
        const openSpy = vi.spyOn(LocalWriter.prototype, 'init')

        const outcome = await profile.run() as { status: string }

        expect(outcome.status).toBe('failed')
        expect(openSpy).not.toHaveBeenCalled()
        expect(backupSink.writes.length).toBe(0)
        expect(consoleErrorMentions('Vanished')).toBe(true)
    })

    test('guard: a kept stub that has left the live list is refused from the snapshot before anything opens', async () => {
        const stub = stubSlot('m-b', 'Foreign Marker')
        const db = treeFor(profile, [], [makeLiveCharacter('a', 'A')])
        // The first read (the snapshot) sees the stub; every later read (the early check) sees it gone.
        let reads = 0
        Object.defineProperty(db, 'modules', { get: () => (reads++ === 0 ? [stub] : []), configurable: true })
        getDatabaseMock.mockImplementation(() => db)
        DBState.db = { modules: [stub] } as unknown as Database
        const openSpy = vi.spyOn(LocalWriter.prototype, 'init')

        const outcome = await profile.run() as { status: string, cause?: unknown }

        expect(outcome.status).toBe('failed')
        expect(outcome.cause).toBeInstanceOf(ModuleStubRefusal)
        expect(openSpy).not.toHaveBeenCalled()
        expect(backupSink.writes.length).toBe(0)
    })

    test('a marker with no module loader registered reaches the early check and is refused as any marker', async () => {
        useDatabase(treeFor(profile, [BODY_A, stubSlot('m-b', 'Foreign Marker')], [makeLiveCharacter('a', 'A')]))
        const openSpy = vi.spyOn(LocalWriter.prototype, 'init')

        const outcome = await profile.run() as { status: string, cause?: unknown }

        expect(outcome.status).toBe('failed')
        expect(outcome.cause).toBeInstanceOf(ModuleStubRefusal)
        expect(openSpy).not.toHaveBeenCalled()
        expect(backupSink.writes.length).toBe(0)
        expect(String(alertErrorMock.mock.calls[0][0])).toBe(language.backupFailedNothingWritten())
    })
})

describe('unreadable module on the Tauri backend', () => {
    test('unreadable-module-stops-before-open: the save dialog is never shown', async () => {
        platformBox.isTauri = true
        useDatabase(databaseWith({ modules: [stubSlot('m-b', 'Broken Module')] }))
        registerModuleLoader(async () => null)

        const outcome = await SaveLocalBackup() as { status: string }

        expect(outcome.status).toBe('failed')
        expect(save).not.toHaveBeenCalled()
        const shown = String(alertErrorMock.mock.calls[0][0])
        expect(shown).toContain('Broken Module')
        expect(shown).not.toBe(language.backupFailedNothingWritten())
        expect(shown).toBe(language.backupFailedModuleUnreadable('Broken Module', 'missing'))
    })
})

describe('module list changes after the export started', () => {
    test.each([['full writer', () => SaveLocalBackup()], ['partial writer', () => SavePartialLocalBackup()]])('module-deleted-after-start-still-exported (%s)', async (_name, run) => {
        const db = databaseWith({ modules: [fullModule('m-r', 'Resident'), stubSlot('m-a', 'Module A'), fullModule('m-z', 'Last')] })
        useDatabase(db)
        bodies.set('m-a', BODY_A)
        installLoaderDouble()
        const realInit = LocalWriter.prototype.init
        vi.spyOn(LocalWriter.prototype, 'init').mockImplementation(async function (this: LocalWriter, ...args: Parameters<LocalWriter['init']>) {
            const result = await realInit.apply(this, args)
            db.modules.splice(0, db.modules.length)
            return result
        })

        const outcome = await run() as { status: string }

        expect(outcome.status).toBe('saved')
        const exported = await decodedDatabase()
        expect((exported.modules as { id: string }[]).map((m) => m.id)).toEqual(['m-r', 'm-a', 'm-z'])
        expect((exported.modules as { cjs?: string }[])[1].cjs).toBe('a-body')
    })
})

describe('busy state during the snapshot', () => {
    test('auto-gc-off-during-export: the export is busy while a module loads and while the database entry is written', async () => {
        const seen: boolean[] = []
        useDatabase(databaseWith({ modules: [stubSlot('m-a', 'Module A')] }))
        bodies.set('m-a', BODY_A)
        installLoaderDouble(() => { seen.push(isBusy()) })
        const realWrite = LocalWriter.prototype.writeBackupHeader
        vi.spyOn(LocalWriter.prototype, 'writeBackupHeader').mockImplementation(function (this: LocalWriter, ...args: Parameters<LocalWriter['writeBackupHeader']>) {
            if (args[0] === 'database.risudat') {
                seen.push(isBusy())
            }
            return realWrite.apply(this, args)
        })

        await SaveLocalBackup()

        expect(seen).toEqual([true, true])
        expect(isBusy()).toBe(false)
    })
})

describe('v0-path-unchanged', () => {
    test('guard: resident modules in the kv-block profile are the V0 bytes of the same tree', async () => {
        const kv = { 'kv:bar': { version: 1, entries: [] } }
        const modules = [fullModule('m-r', 'Resident', { cjs: 'x' })]
        const db = databaseWith({ modules, upstreamKvBlocks: kv })
        useDatabase(db)

        await SaveLocalBackup()

        const { upstreamKvBlocks: _field, ...withoutKv } = db as unknown as Record<string, unknown>
        const expected = writeRisuSaveV0({ ...withoutKv, account: undefined }, kv)
        expect(Buffer.from(databaseEntry()).equals(Buffer.from(expected))).toBe(true)
    })

    test('guard: no module list adds no modules key', async () => {
        const kv = { 'kv:bar': { version: 1, entries: [] } }
        const db = databaseWith({ upstreamKvBlocks: kv })
        delete (db as unknown as Record<string, unknown>).modules
        useDatabase(db)

        await SaveLocalBackup()

        const { upstreamKvBlocks: _field, ...withoutKv } = db as unknown as Record<string, unknown>
        const expected = writeRisuSaveV0({ ...withoutKv, account: undefined }, kv)
        expect(Buffer.from(databaseEntry()).equals(Buffer.from(expected))).toBe(true)
        expect(Object.hasOwn(await decodedDatabase(), 'modules')).toBe(false)
    })
})

describe('release-on-every-exit', () => {
    function arrange(): void {
        useDatabase(databaseWith({ modules: [stubSlot('m-a', 'Module A'), stubSlot('m-b', 'Module B')] }))
        bodies.set('m-a', BODY_A)
        bodies.set('m-b', BODY_B)
        installLoaderDouble()
    }

    test('success releases every acquired handle', async () => {
        arrange()
        await SaveLocalBackup()
        expect(releaseLog.released).toEqual(['m-a', 'm-b'])
    })

    test('a failure after the snapshot releases every acquired handle', async () => {
        arrange()
        vi.spyOn(LocalWriter.prototype, 'writeBackupHeader').mockRejectedValue(new Error('disk full'))
        const outcome = await SaveLocalBackup() as { status: string }
        expect(outcome.status).toBe('failed')
        expect(releaseLog.released).toEqual(['m-a', 'm-b'])
    })

    test('a cancelled save dialog releases every acquired handle', async () => {
        arrange()
        vi.spyOn(LocalWriter.prototype, 'init').mockResolvedValue(false)
        const outcome = await SaveLocalBackup() as { status: string, cause?: string }
        expect(outcome.cause).toBe('save-dialog-cancelled')
        expect(releaseLog.released).toEqual(['m-a', 'm-b'])
    })

    test('a snapshot that fails part way releases the handles it acquired and none twice', async () => {
        useDatabase(databaseWith({ modules: [stubSlot('m-a', 'Module A'), stubSlot('m-b', 'Module B')] }))
        bodies.set('m-a', BODY_A)
        installLoaderDouble()
        const snapshotError = await snapshotModuleList(DBState.db).catch((error: unknown) => error)
        expect(snapshotError).toMatchObject({ name: 'ExportModuleUnreadableError', moduleId: 'm-b', moduleName: 'Module B' })
        expect(releaseLog.released).toEqual(['m-a'])
    })

    test('release() lets go once however often it is called', async () => {
        useDatabase(databaseWith({ modules: [stubSlot('m-a', 'Module A')] }))
        bodies.set('m-a', BODY_A)
        installLoaderDouble()
        const snapshot = await snapshotModuleList(DBState.db)
        snapshot.release()
        snapshot.release()
        expect(releaseLog.released).toEqual(['m-a'])
    })
})

describe('snapshotModuleList', () => {
    test('guard: a loader that returns null for a stub still in the list is a read failure', async () => {
        useDatabase(databaseWith({ modules: [stubSlot('gone', 'Gone')] }))
        registerModuleLoader(async () => null)
        await expect(snapshotModuleList(DBState.db)).rejects.toMatchObject({ name: 'ExportModuleUnreadableError', moduleName: 'Gone' })
    })

    test('a stub whose id another slot holds is refused without a load', async () => {
        useDatabase(databaseWith({ modules: [stubSlot('dup', 'Stub'), fullModule('dup', 'Other')] }))
        installLoaderDouble()
        await expect(snapshotModuleList(DBState.db)).rejects.toMatchObject({ name: 'ExportModuleUnreadableError', moduleName: 'Stub' })
        expect(loadLog).toEqual([])
    })

    test('a stub after a resident module of the same id is refused without a load', async () => {
        useDatabase(databaseWith({ modules: [fullModule('dup', 'Other'), stubSlot('dup', 'Stub')] }))
        installLoaderDouble()
        await expect(snapshotModuleList(DBState.db)).rejects.toMatchObject({ name: 'ExportModuleUnreadableError', moduleName: 'Stub' })
        expect(loadLog).toEqual([])
    })

    type Reason = ExportModuleFailure

    /** The reason a snapshot of one stub gives when the loader fails with `thrown`, or resolves null for `null`. */
    async function reasonFor(thrown: Error | null): Promise<unknown> {
        useDatabase(databaseWith({ modules: [stubSlot('m-x', 'Broken Module')] }))
        registerModuleLoader(async () => {
            if (thrown === null) {
                return null
            }
            throw thrown
        })
        const error = await snapshotModuleList(DBState.db).catch((caught: unknown) => caught)
        expect(error).toBeInstanceOf(ExportModuleUnreadableError)
        return (error as ExportModuleUnreadableError).reason
    }

    const loaderRows: [string, ModuleLoadFailure, Reason][] = [
        ['unreadable', 'unreadable', 'unreadable'],
        ['damaged', 'damaged', 'damaged'],
        ['too-new', 'too-new', 'newer'],
        ['no-entry', 'no-entry', 'unreadable'],
        ['edited', 'edited', 'unreadable'],
        ['stale', 'stale', 'changed'],
        ['replaced', 'replaced', 'changed'],
        // Double-driven: the snapshot's own duplicate check preempts the loader's ambiguous answer in production.
        ['ambiguous (loader double)', 'ambiguous', 'duplicate'],
    ]

    test.each(loaderRows)('unreadable-reason: loader failure %s maps to its reason', async (_label, failure, reason) => {
        expect(await reasonFor(new ModuleLoadError(failure, 'm-x', 'Broken Module'))).toBe(reason)
    })

    test('unreadable-reason: a real two-slot duplicate list is duplicate', async () => {
        useDatabase(databaseWith({ modules: [stubSlot('dup', 'Broken Module'), fullModule('dup', 'Other')] }))
        installLoaderDouble()
        const error = await snapshotModuleList(DBState.db).catch((caught: unknown) => caught)
        expect((error as ExportModuleUnreadableError).cause).toBeInstanceOf(ModuleAmbiguousError)
        expect((error as ExportModuleUnreadableError).reason).toBe('duplicate')
    })

    test('unreadable-reason: a null body is missing and a plain error is unreadable', async () => {
        expect(await reasonFor(null)).toBe('missing')
        expect(await reasonFor(new Error('read failed'))).toBe('unreadable')
    })

    test('unreadable-reason: every reason words a different alert that names the module and never advises reload', () => {
        const reasons: Reason[] = ['damaged', 'missing', 'newer', 'changed', 'duplicate', 'unreadable']
        const texts = reasons.map((reason) => language.backupFailedModuleUnreadable('Broken Module', reason))
        expect(new Set(texts).size).toBe(reasons.length)
        for (const text of texts) {
            expect(text).toContain('"Broken Module"')
            expect(text.toLowerCase()).not.toContain('reload')
        }
        const duplicate = language.backupFailedModuleUnreadable('Broken Module', 'duplicate')
        expect(duplicate).not.toContain('changed')
    })

    test('unreadable-reason: a duplicate list stops a full export with the duplicate text', async () => {
        useDatabase(databaseWith({ modules: [stubSlot('dup', 'Broken Module'), stubSlot('dup', 'Twin')] }))
        installLoaderDouble()
        const outcome = await SaveLocalBackup() as { status: string }
        expect(outcome.status).toBe('failed')
        expect(String(alertErrorMock.mock.calls[0][0])).toBe(language.backupFailedModuleUnreadable('Broken Module', 'duplicate'))
    })

    test('resident slots are the same objects, in order, in a new array', async () => {
        const one = fullModule('x', 'One')
        const two = fullModule('x', 'Two')
        useDatabase(databaseWith({ modules: [one, two] }))
        const snapshot = await snapshotModuleList(DBState.db)
        expect(snapshot.modules).not.toBe(DBState.db.modules)
        expect(snapshot.modules?.[0]).toBe(one)
        expect(snapshot.modules?.[1]).toBe(two)
    })
})
