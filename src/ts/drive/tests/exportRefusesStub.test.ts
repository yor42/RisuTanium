/**
 * A full and a partial local export (`SaveLocalBackup`, `SavePartialLocalBackup`, `src/ts/drive/backuplocal.ts`) whose
 * live `modules` list holds a module stub marker stop at the start: no cold collection, no store listing or read, no
 * writer open, no entry written. The failure is the generic "nothing was written" alert, never the module's name.
 *
 * New-behaviour tests: red without the early check (with only the encoder's refusal it fails after the assets were
 * written; with no refusal at all the stub is saved into the entry), pinned by scratch mutants (each early line deleted; the check moved after the cold collection; the check
 * moved after `writer.init`). The positive control passes before and after: the same fixture without the stub writes the
 * asset, which is what makes "the asset was not written" mean something. The harness is the one
 * `exportStreamedEntry.test.ts` documents. A passing test here is not evidence about the Tauri or Node backends.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

const backupSink = vi.hoisted(() => ({ writes: [] as Uint8Array[], opened: 0 }))
const forageKeysMock = vi.hoisted(() => vi.fn(async (): Promise<string[]> => []))
const forageGetItemMock = vi.hoisted(() => vi.fn(async (_key: string): Promise<Uint8Array | null> => null))
const forageSetItemMock = vi.hoisted(() => vi.fn(async (_key: string, _data: Uint8Array): Promise<void> => {}))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const alertConfirmMock = vi.hoisted(() => vi.fn(async (_message: string) => true))
const alertErrorMock = vi.hoisted(() => vi.fn())
const alertMdMock = vi.hoisted(() => vi.fn())
const alertNormalMock = vi.hoisted(() => vi.fn())
const collectSpy = vi.hoisted(() => vi.fn())

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

vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => {
            backupSink.opened++
            return {
                ready: Promise.resolve(),
                writable: {
                    getWriter: () => ({
                        write: async (chunk: Uint8Array) => { backupSink.writes.push(chunk.slice()) },
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

/** The cold collection, counted: the export's first heavy read, which the early check must precede. */
vi.mock(import('src/ts/drive/exportInline'), async (importOriginal) => {
    const original = await importOriginal()
    return {
        ...original,
        collectBackupColdStorage: (...args: Parameters<typeof original.collectBackupColdStorage>) => {
            collectSpy()
            return original.collectBackupColdStorage(...args)
        },
    }
})

//#endregion

//#region units and the legacy OPFS stand-in

/** The page store's units (coldstorage/<key>). */
const unitMem = new Map<string, Uint8Array>()

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

//#endregion

import { SaveLocalBackup, SavePartialLocalBackup } from 'src/ts/drive/backuplocal'
import { dbWriteLock, LocalWriter } from 'src/ts/globalApi.svelte'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE, ModuleStubRefusal } from 'src/ts/storage/moduleStub'
import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'

//#region helpers

const decoder = new TextDecoder()
const ASSET_KEY = 'assets/avatar-one'
const MODULE_NAME = 'Stub Module Name'

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

/** The entry names in the sink, parsed from the length-prefixed layout the writer produces. */
function writtenNames(): string[] {
    const bytes = concat(backupSink.writes)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const names: string[] = []
    let offset = 0
    while (offset + 4 <= bytes.length) {
        const nameLength = view.getUint32(offset, true)
        offset += 4
        names.push(decoder.decode(bytes.subarray(offset, offset + nameLength)))
        offset += nameLength
        const dataLength = view.getUint32(offset, true)
        offset += 4 + dataLength
    }
    return names
}

/**
 * A live database with one character whose `image` is a stored asset: both exports write that asset before
 * `database.risudat`. `modules` holds one normal module and, when asked, one module stub.
 */
function databaseWith(withStub: boolean): Database {
    const modules: Array<Record<string, unknown>> = [{ id: 'full-id-1', name: 'Full Module', lorebook: [] }]
    if (withStub) {
        modules.push({ id: 'stub-id-1', name: MODULE_NAME, [MODULE_STUB_KEY]: MODULE_STUB_VALUE })
    }
    return {
        characters: [{ chaId: 'a', name: 'A', type: 'character', chatPage: 0, chats: [], image: ASSET_KEY }],
        personas: [],
        characterOrder: ['a'],
        botPresets: [],
        modules,
    } as unknown as Database
}

//#endregion

beforeEach(() => {
    platformBox.isTauri = false
    backupSink.writes.length = 0
    backupSink.opened = 0
    collectSpy.mockClear()
    unitMem.clear()
    forageKeysMock.mockReset()
    forageGetItemMock.mockReset()
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    alertErrorMock.mockClear()
    forageKeysMock.mockImplementation(async () => [ASSET_KEY])
    forageGetItemMock.mockImplementation(async (key: string) => (key === ASSET_KEY ? new Uint8Array([1, 2, 3, 4]) : null))
    injectAppStore(createForageBackedStore({
        getItem: async (key) => (key.startsWith('coldstorage/') ? (unitMem.get(key) ?? null) : forageGetItemMock(key)),
        setItem: async (key, value) => {
            if (key.startsWith('coldstorage/')) {
                unitMem.set(key, value)
                return
            }
            await forageSetItemMock(key, value)
        },
        keys: async () => [...(await forageKeysMock()), ...unitMem.keys()],
        removeItem: async (key) => { unitMem.delete(key) },
    }))
    getDatabaseMock.mockImplementation(() => databaseWith(false))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe.each([
    ['writeLocalBackup', SaveLocalBackup],
    ['writePartialLocalBackup', SavePartialLocalBackup],
])('%s and a module stub in the live list', (functionName, run) => {
    test('guard: without a stub the fixture\'s asset is written before the database entry (the positive control)', async () => {
        getDatabaseMock.mockImplementation(() => databaseWith(false))
        const initSpy = vi.spyOn(LocalWriter.prototype, 'init')

        const outcome = await run()

        expect(outcome.status).toBe('saved')
        expect(initSpy).toHaveBeenCalledTimes(1)
        expect(collectSpy).toHaveBeenCalledTimes(1)
        expect(forageGetItemMock).toHaveBeenCalledWith(ASSET_KEY)
        const names = writtenNames()
        expect(names.some((name) => name.includes('avatar-one'))).toBe(true)
        expect(names.at(-1)).toBe('database.risudat')
    })

    test('new behaviour: the export fails with the refusal before anything is collected, listed, read, opened or written', async () => {
        const db = databaseWith(true)
        getDatabaseMock.mockImplementation(() => db)
        DBState.db = db
        const initSpy = vi.spyOn(LocalWriter.prototype, 'init')

        const outcome = await run()

        expect(outcome.status).toBe('failed')
        if (outcome.status !== 'failed') {
            throw new Error('unreachable')
        }
        expect(outcome.cause).toBeInstanceOf(ModuleStubRefusal)
        expect((outcome.cause as ModuleStubRefusal).where).toBe(functionName)
        expect(outcome.file).toBe('untouched')
        // The generic wording only: the module's name stays in the error message for the console.
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        const shown = String(alertErrorMock.mock.calls[0][0])
        expect(shown).toBe(language.backupFailedNothingWritten())
        expect(shown).not.toContain(MODULE_NAME)
        // Nothing started: the cold collection, the store listing and reads, the writer and the file.
        expect(collectSpy).not.toHaveBeenCalled()
        expect(forageKeysMock).not.toHaveBeenCalled()
        expect(forageGetItemMock).not.toHaveBeenCalled()
        expect(initSpy).not.toHaveBeenCalled()
        expect(backupSink.opened).toBe(0)
        expect(backupSink.writes).toEqual([])
    })
})
