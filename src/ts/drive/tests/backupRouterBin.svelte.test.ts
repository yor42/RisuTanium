/**
 * The `.bin` side of the backup router (CHORE-128 S12c): `LoadPickedLocalBackup` and the Settings picker over the real
 * `.bin` restore, with the harness of `binGoldens.test.ts` (in-memory page store, recorded `setDatabase`, mocked dialogs; a
 * pass says nothing about the Tauri or Node backends or a real browser's storage). The files are the committed goldens,
 * written by the real `SaveLocalBackup` (`fork-*`) or assembled in upstream's shape (`upstream-*`), and one account-sync
 * marker file framed by the product's `writeBackupEntry`.
 *
 * Labels: every test is a compatibility guard of a new entry (no pre-fix base: main has no `LoadPickedLocalBackup`); each
 * names the scratch mutant it turns red on.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { gzipSync } from 'fflate'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: false }
})

const setDatabaseMock = vi.hoisted(() => vi.fn())
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const backupSink = vi.hoisted(() => ({ writes: [] as Uint8Array[] }))
const alertConfirmMock = vi.hoisted(() => vi.fn(async (_message: string) => true))
const alertErrorMock = vi.hoisted(() => vi.fn())

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
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: {
                getWriter: () => ({
                    write: async (chunk: Uint8Array) => { backupSink.writes.push(chunk.slice()) },
                    close: async () => { },
                }),
            },
        }),
    },
}))

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

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: alertConfirmMock,
    alertError: alertErrorMock,
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
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

class MockNotFoundError extends Error {
    name = 'NotFoundError'
}

// No legacy OPFS unit file exists: every read falls through to "not found".
Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    value: {
        getDirectory: async () => ({
            async getFileHandle(name: string) {
                throw new MockNotFoundError('not found: ' + name)
            },
            async removeEntry() { },
            entries() {
                return {
                    [Symbol.asyncIterator]() {
                        return { async next() { return { done: true as const, value: undefined } } }
                    },
                }
            },
        }),
    },
})


//#endregion

import { LoadLocalBackup, LoadPickedLocalBackup } from 'src/ts/drive/backuplocal'
import { loadBackupFromPicker } from 'src/ts/drive/backupRouter'
import { restoreFromBinFileAtFirstRun } from 'src/ts/drive/settingsRestore'
import { resetRestoreInProgressForTests, restorePhase } from 'src/ts/drive/restoreInProgress'
import { writeBackupEntry } from 'src/ts/exportWriters'
import { language } from 'src/lang'
import { beginBusy, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { createForageBackedStore } from 'src/ts/storage/tests/forageBackedStore'
import { injectRestoreStore } from './restoreSupport'

const GOLDEN_DIR = path.resolve(process.cwd(), 'src/ts/drive/tests/binGoldens')
const golden = (name: string): Uint8Array<ArrayBuffer> => new Uint8Array(fs.readFileSync(path.join(GOLDEN_DIR, name)))

const assetMem = new Map<string, Uint8Array>()
const unitMem = new Map<string, Uint8Array>()
let captured: HTMLInputElement | null = null

beforeEach(() => {
    platformBox.isTauri = false
    assetMem.clear()
    unitMem.clear()
    resetBusyActionsForTest()
    resetRestoreInProgressForTests()
    setDatabaseMock.mockReset()
    getDatabaseMock.mockImplementation(() => ({}) as unknown as Database)
    alertConfirmMock.mockClear()
    alertErrorMock.mockClear()
    injectRestoreStore(createForageBackedStore({
        getItem: async (key) => key.startsWith('coldstorage/') ? (unitMem.get(key) ?? null) : (assetMem.get(key) ?? null),
        setItem: async (key, value) => {
            if (key.startsWith('coldstorage/')) {
                unitMem.set(key, value)
            } else {
                assetMem.set(key, value)
            }
        },
        keys: async () => [...assetMem.keys(), ...unitMem.keys()].sort(),
        removeItem: async (key) => { unitMem.delete(key); assetMem.delete(key) },
    }))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
    captured = null
    const realCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = realCreateElement(tag)
        if (tag === 'input') {
            captured = el as HTMLInputElement
        }
        return el
    })
})

afterEach(() => {
    resetBusyActionsForTest()
    vi.restoreAllMocks()
})

function installedDatabase(): Record<string, unknown> {
    expect(setDatabaseMock).toHaveBeenCalledTimes(1)
    return setDatabaseMock.mock.calls[0][0] as Record<string, unknown>
}

/** Runs the picker the way the loader suites do: the input's `onchange` is called with a chosen file. */
async function pickAndChange(file: File, before: () => void = () => { }): Promise<void> {
    const input = captured
    if (input === null) {
        throw new Error('no file input was created')
    }
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    before()
    await (input.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
}

describe('R6b: LoadPickedLocalBackup on a fork .bin', () => {
    test('with the first-run option the restored database persists didFirstSetup = true, without it the file keeps its own value (guard; MR11)', async () => {
        const bytes = golden('fork-full.bin')
        await LoadPickedLocalBackup(new File([bytes], 'fork-full.bin'))
        const own = installedDatabase().didFirstSetup
        setDatabaseMock.mockReset()
        const end = await LoadPickedLocalBackup(new File([bytes], 'fork-full.bin'), { completeFirstSetup: true })
        expect(installedDatabase().didFirstSetup).toBe(true)
        expect(own).not.toBe(true)
        expect(end.target).toBe('fork-full.bin')
        expect(alertErrorMock).not.toHaveBeenCalled()
    })
})

describe('R6c: a .bin through the router restores exactly as the picker restore does', () => {
    test.each(['fork-full.bin', 'upstream-kv.bin'])('%s: the same installed database, alerts and outcome (guard; MR11)', async (name) => {
        const bytes = golden(name)
        const direct = LoadLocalBackup()
        await pickAndChange(new File([bytes], name))
        const directEnd = await direct
        const directDb = JSON.stringify(installedDatabase())
        const directAlerts = [alertErrorMock.mock.calls.map((c) => c[0]), alertConfirmMock.mock.calls.map((c) => c[0])]

        setDatabaseMock.mockReset()
        alertErrorMock.mockClear()
        alertConfirmMock.mockClear()
        assetMem.clear()
        unitMem.clear()
        resetBusyActionsForTest()
        const routed = loadBackupFromPicker()
        await pickAndChange(new File([bytes], name))
        const routedEnd = await routed
        expect(JSON.stringify(installedDatabase())).toBe(directDb)
        expect([alertErrorMock.mock.calls.map((c) => c[0]), alertConfirmMock.mock.calls.map((c) => c[0])]).toEqual(directAlerts)
        expect(routedEnd.outcome).toBe(directEnd.outcome)
    })

    test('a busy entry opened between the pick and the restore is refused with backupLoadWorkInProgress on both paths (guard)', async () => {
        const bytes = golden('fork-full.bin')
        for (const start of [() => LoadLocalBackup(), () => loadBackupFromPicker()]) {
            setDatabaseMock.mockReset()
            alertErrorMock.mockClear()
            const done = start()
            let other = { end: () => { } }
            await pickAndChange(new File([bytes], 'fork-full.bin'), () => { other = beginBusy('backupLoad') })
            const end = await done
            other.end()
            expect(end.outcome).toBe('nothing-replaced')
            expect(alertErrorMock.mock.calls.map((c) => c[0])).toContain(language.backupLoadWorkInProgress)
            expect(setDatabaseMock).not.toHaveBeenCalled()
        }
    })
})

/** Starts the Welcome entry and waits for its picker, which opens only after the two confirmations. */
async function startWelcome(): Promise<{ entry: Promise<void> }> {
    captured = null
    const entry = restoreFromBinFileAtFirstRun()
    for (let turn = 0; turn < 200 && captured === null; turn += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
    if (captured === null) {
        throw new Error('the Welcome picker never opened')
    }
    return { entry }
}

describe('W3: the Welcome restore of a .bin goes through the router and restores as the direct first-run call does', () => {
    test('the Welcome picker takes the Settings accept rule (reproducer: the old Welcome picker accepted .bin only; M14)', async () => {
        const { entry } = await startWelcome()
        expect((captured as HTMLInputElement).accept).toBe('.bin,.rtb,application/vnd.risutanium.rtb')
        ;(captured as HTMLInputElement).dispatchEvent(new Event('cancel'))
        await entry
    })

    test.each(['fork-full.bin', 'upstream-kv.bin'])('%s: the same installed database and alerts as the direct first-run call, with didFirstSetup true (guard; M6, M9)', async (name) => {
        const bytes = golden(name)
        const direct = LoadLocalBackup(undefined, undefined, { completeFirstSetup: true })
        await pickAndChange(new File([bytes], name))
        const directEnd = await direct
        const directDb = installedDatabase()
        const directJson = JSON.stringify(directDb)
        const directAlerts = [alertErrorMock.mock.calls.map((c) => c[0]), alertConfirmMock.mock.calls.map((c) => c[0])]
        expect(directDb.didFirstSetup).toBe(true)

        setDatabaseMock.mockReset()
        alertErrorMock.mockClear()
        alertConfirmMock.mockClear()
        assetMem.clear()
        unitMem.clear()
        resetBusyActionsForTest()
        resetRestoreInProgressForTests()
        const { entry } = await startWelcome()
        await pickAndChange(new File([bytes], name))
        await entry
        expect(JSON.stringify(installedDatabase())).toBe(directJson)
        expect(installedDatabase().didFirstSetup).toBe(true)
        // The Welcome flow asks its own two confirmations first; the restore's own alerts are then the same.
        const flowConfirms = [language.backupLoadConfirm, language.backupLoadConfirm2]
        const confirms = alertConfirmMock.mock.calls.map((c) => c[0])
        expect(confirms.slice(0, 2)).toEqual(flowConfirms)
        expect([alertErrorMock.mock.calls.map((c) => c[0]), confirms.slice(2)]).toEqual(directAlerts)
        expect(directEnd.outcome).not.toBe('failed')
    })

    test('a cancel on the Welcome picker ends canceled with no restore run left and nothing written (guard)', async () => {
        const { entry } = await startWelcome()
        ;(captured as HTMLInputElement).dispatchEvent(new Event('cancel'))
        await entry
        expect(restorePhase()).toBe('none')
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(assetMem.size + unitMem.size).toBe(0)
    })
})

describe('R4: an account-sync encrypted .bin is routed to the .bin restore and refused before any write', () => {
    test('the marker file shows encryptedBackupRefused and writes nothing (guard; MR1 inverse)', async () => {
        const parts: Uint8Array[] = []
        const sink = { write: async (piece: Uint8Array) => { parts.push(piece.slice()) } }
        const encoder = new TextEncoder()
        await writeBackupEntry(sink, encoder.encode('encryption.risudat'), encoder.encode('{"time":1,"type":"account"}'))
        await writeBackupEntry(sink, encoder.encode('database.risudat'), new Uint8Array(64).fill(7))
        const file = new File(parts as unknown as Uint8Array<ArrayBuffer>[], 'risuai-account.bin')
        const routed = loadBackupFromPicker()
        await pickAndChange(file)
        const end = await routed
        expect(end.outcome).toBe('nothing-replaced')
        expect(alertErrorMock.mock.calls.map((c) => c[0])).toEqual([language.encryptedBackupRefused])
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(assetMem.size + unitMem.size).toBe(0)
    })
})
