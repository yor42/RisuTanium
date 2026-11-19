// @vitest-environment happy-dom

/**
 * A `.bin` export (full and partial) leaves a fork-only `hypaModel` value (`multiE5Small`) out of the database entry,
 * without a prompt, and leaves the page's own value alone. Every value upstream can read, and every value the fork does
 * not list at all, is carried unchanged.
 *
 * `SaveLocalBackup` and `SavePartialLocalBackup` run for real on an Android page over an `invoke` stand-in that follows
 * the frame rules of the Rust command; the entry is read back with the real `decodeRisuSave`. A mocked command is not
 * evidence about the native backend. The comment above each case marks it: a regression
 * reproducer fails when the omission is absent; a compatibility guard passes before and after.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: true }
})
const BACKUP_PATH = vi.hoisted(() => 'backup-output.bin')
const backupSink = vi.hoisted(() => ({ writes: [] as Uint8Array[] }))

/** The file-system and desktop-command stand-ins, built once on first use (a `.svelte.test.ts` file has no top-level await). */
const kit = vi.hoisted(() => {
    interface Kit {
        fakeFs: ReturnType<typeof import('src/ts/storage/tests/tauriFsFake').createFakeTauriFs>
        desktop: ReturnType<typeof import('src/ts/storage/tests/tauriDesktopFake').createDesktopInvoke>
    }
    let built: Promise<Kit> | undefined
    return {
        get(): Promise<Kit> {
            built ??= (async () => {
                const fakeFs = (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true })
                const desktop = (await import('src/ts/storage/tests/tauriDesktopFake')).createDesktopInvoke(fakeFs, { cap: 8 * 1024 * 1024 })
                return { fakeFs, desktop }
            })()
            return built
        },
    }
})

/** The Android bridge stand-in: what it was asked, and the sizes its listing reports instead of the files' own. */
const bridge = vi.hoisted(() => ({
    calls: [] as { command: string, keys: string[] }[],
    listedSizes: new Map<string, number>(),
    sizedAnswers: true,
}))

const RUST_RESPONSE_MAX = 4 * 1024 * 1024

vi.mock(import('src/ts/reloadGuard'), () => ({
    markAppInitiatedReload: () => { },
    isAppInitiatedReload: () => false,
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

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'android' }))

vi.mock('@tauri-apps/plugin-fs', async () => {
    const { fakeFs } = await kit.get()
    return {
        ...fakeFs.module,
        writeFile: async (path: string, data: Uint8Array, options?: { createNew?: boolean, baseDir?: number }) => {
            if (path === BACKUP_PATH) {
                backupSink.writes.push(data.slice())
                return
            }
            await fakeFs.module.writeFile(path, data, options)
        },
    }
})

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => BACKUP_PATH),
}))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ characters: [], personas: [], characterOrder: [], botPresets: [] })),
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

const alertConfirmMock = vi.hoisted(() => vi.fn(async (_message: string) => true))
const alertMdMock = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: alertConfirmMock,
    alertError: alertErrorMock,
    alertWait: vi.fn(),
    alertMd: alertMdMock,
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(async () => { }),
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

/** Answers one `get_assets_batch` call with the frame rules of the Rust command. */
function batchReply(fakeFs: Awaited<ReturnType<typeof kit.get>>['fakeFs'], keys: readonly string[]): ArrayBuffer {
    const frames: Uint8Array[] = []
    let served = 0
    let exhausted = false
    const push = (status: number, body: Uint8Array) => {
        const frame = new Uint8Array(5 + body.length)
        frame[0] = status
        new DataView(frame.buffer).setUint32(1, body.length, true)
        frame.set(body, 5)
        frames.push(frame)
    }
    for (const key of keys) {
        const file = fakeFs.files.get(key)
        if (exhausted) {
            push(5, new Uint8Array(0))
        } else if (file === undefined) {
            push(1, new Uint8Array(0))
        } else if (file.length > RUST_RESPONSE_MAX) {
            push(4, new Uint8Array(0))
        } else if (served > 0 && served + file.length > RUST_RESPONSE_MAX) {
            exhausted = true
            push(5, new Uint8Array(0))
        } else {
            served += file.length
            push(0, file)
        }
    }
    const out = new Uint8Array(frames.reduce((n, frame) => n + frame.length, 0))
    let offset = 0
    for (const frame of frames) {
        out.set(frame, offset)
        offset += frame.length
    }
    return out.buffer
}

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: async (command: string, args?: unknown, options?: unknown) => {
        const { fakeFs, desktop } = await kit.get()
        if (command === 'list_assets_sized') {
            bridge.calls.push({ command, keys: [] })
            if (!bridge.sizedAnswers) {
                throw new Error('the sized listing does not answer')
            }
            return fakeFs.listing('assets').map((name) => {
                const key = `assets/${name}`
                return [key, bridge.listedSizes.get(key) ?? fakeFs.files.get(key)?.length ?? 0]
            })
        }
        if (command === 'get_assets_batch') {
            const keys = (args as { keys: string[] }).keys
            bridge.calls.push({ command, keys: [...keys] })
            await Promise.resolve()
            return batchReply(fakeFs, keys)
        }
        return (desktop.invoke as (command: string, args?: unknown, options?: unknown) => Promise<unknown>)(command, args, options)
    },
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
        setColdStorageItem: vi.fn(async () => true),
    } as unknown as typeof import('src/ts/process/coldstorage.svelte')
})

//#endregion

import { SaveLocalBackup, SavePartialLocalBackup, type BackupExportOptions, type ExportOutcome } from 'src/ts/drive/backuplocal'
import { getDatabase } from 'src/ts/storage/database.svelte'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { injectRestoreStore } from './restoreSupport'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { resetByteTransportForTests } from 'src/ts/storage/tauriByteTransport'
import { resetAssetBatchAvailabilityForTests } from 'src/ts/storage/tauriAssetBatch'
import { resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { decodeRisuSave } from 'src/ts/storage/risuSave'

//#region helpers

/** The page's database, carrying the embedding model value under test (absent when `hypaModel` is undefined). */
function page(hypaModel?: string): Database {
    const db = { characters: [], personas: [], characterOrder: [], botPresets: [] } as unknown as Database
    if (hypaModel !== undefined) {
        (db as unknown as { hypaModel: string }).hypaModel = hypaModel
    }
    vi.mocked(getDatabase).mockImplementation(() => db)
    return db
}

function exportedEntries(): { name: string, data: Uint8Array }[] {
    const total = backupSink.writes.reduce((n, part) => n + part.length, 0)
    const bytes = new Uint8Array(total)
    let at = 0
    for (const part of backupSink.writes) {
        bytes.set(part, at)
        at += part.length
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const out: { name: string, data: Uint8Array }[] = []
    let offset = 0
    while (offset + 4 <= bytes.length) {
        const nameLength = view.getUint32(offset, true)
        offset += 4
        const name = new TextDecoder().decode(bytes.subarray(offset, offset + nameLength))
        offset += nameLength
        const dataLength = view.getUint32(offset, true)
        offset += 4
        out.push({ name, data: bytes.subarray(offset, offset + dataLength) })
        offset += dataLength
    }
    return out
}

/** The decoded database entry of the written file. */
async function exportedDatabase(): Promise<Record<string, unknown>> {
    const entry = exportedEntries().find((candidate) => candidate.name === 'database.risudat')
    expect(entry, 'the file holds a database entry').toBeDefined()
    return await decodeRisuSave(entry!.data) as unknown as Record<string, unknown>
}

/** The upstream `HypaModel` union, written as literals so the base copy of the code can run them. */
const UPSTREAM_VALUES = [
    'custom', 'ada', 'openai3small', 'openai3large', 'MiniLM', 'MiniLMGPU', 'nomic', 'nomicGPU', 'bgeSmallEn',
    'bgeSmallEnGPU', 'bgem3', 'bgem3GPU', 'multiMiniLM', 'multiMiniLMGPU', 'bgeM3Ko', 'bgeM3KoGPU', 'voyageContext3',
]

const embeddingPrompts = (): string[] => alertConfirmMock.mock.calls.map((call) => String(call[0])).filter((text) => /embedding|multiE5Small/i.test(text))

type Runner = (options?: BackupExportOptions) => Promise<ExportOutcome>

//#endregion

let dbWriteLockSpy: ReturnType<typeof vi.spyOn>
let fakeFs: Awaited<ReturnType<typeof kit.get>>['fakeFs']
let desktop: Awaited<ReturnType<typeof kit.get>>['desktop']

beforeEach(async () => {
    ;({ fakeFs, desktop } = await kit.get())
    platformBox.isTauri = true
    backupSink.writes.length = 0
    desktop.reset()
    bridge.calls.length = 0
    bridge.listedSizes.clear()
    bridge.sizedAnswers = true
    resetByteTransportForTests()
    resetAssetBatchAvailabilityForTests()
    fakeFs.reset()
    fakeFs.directories.add('assets')
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    alertMdMock.mockClear()
    alertErrorMock.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    injectRestoreStore(createTauriFilesStore({ platform: 'posix' }))
    dbWriteLockSpy = vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
})

afterEach(() => {
    resetBusyActionsForTest()
    dbWriteLockSpy.mockRestore()
    vi.restoreAllMocks()
})

describe.each([
    ['SaveLocalBackup', SaveLocalBackup as Runner],
    ['SavePartialLocalBackup', SavePartialLocalBackup as Runner],
])('%s of a page with an embedding model setting', (_name, run) => {
    // regression reproducer: T7
    test('a fork-only value is left out of the database entry, silently, and the page keeps it', async () => {
        const db = page('multiE5Small')

        const outcome = await run()

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(await exportedDatabase()).not.toHaveProperty('hypaModel')
        expect(getDatabase().hypaModel).toBe('multiE5Small')
        expect((db as unknown as { hypaModel: string }).hypaModel).toBe('multiE5Small')
        expect(embeddingPrompts()).toEqual([])
    }, 120_000)

    // compatibility guard: T8, passes before and after
    test.each(UPSTREAM_VALUES)('an upstream value %s is carried unchanged', async (value) => {
        page(value)

        const outcome = await run()

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(await exportedDatabase()).toHaveProperty('hypaModel', value)
    }, 120_000)

    // compatibility guard: T8b, passes before and after
    test('a value the fork does not list is carried unchanged', async () => {
        page('futureUpstreamModel')

        const outcome = await run()

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(await exportedDatabase()).toHaveProperty('hypaModel', 'futureUpstreamModel')
    }, 120_000)
})
