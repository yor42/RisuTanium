// @vitest-environment happy-dom

/**
 * A `.bin` export (full and partial) carries the scheme that turning the theme pack off would restore, never the fork-only
 * name `theme-pack` and never the snapshot (MC-2952). The page's own fields stay as they are, and `customColorScheme` is
 * carried unchanged. The real `SaveLocalBackup` and `SavePartialLocalBackup` run on an Android page over the same stand-ins
 * as `exportThemePacks.svelte.test.ts`, and the file is decoded with `decodeRisuSave`. Titles: `reproducer` fails when the
 * translation is absent; `guard` passes before and after.
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
import { PACK_SCHEME_NAME, colorSchemePresets, defaultColorScheme, type ColorScheme } from 'src/ts/gui/colorscheme'

//#region helpers

const PACK_COPY: ColorScheme = {
    bgcolor: '#21222c', darkbg: '#191a21', borderc: '#bd93f9', selected: '#44475a', draculared: '#ff5555',
    textcolor: '#f8f8f2', textcolor2: '#a0a4b8', darkBorderc: '#343746', darkbutton: '#282a36', type: 'dark',
}
const CUSTOM: ColorScheme = {
    bgcolor: '#101010', darkbg: '#202020', borderc: '#303030', selected: '#404040', draculared: '#505050',
    textcolor: '#606060', textcolor2: '#123456', darkBorderc: '#707070', darkbutton: '#808080', type: 'dark',
}
const STALE_OCEAN: ColorScheme = { ...colorSchemePresets.ocean, bgcolor: '#123456' }
const OWN_COPY: ColorScheme = {
    bgcolor: '#111111', darkbg: '#222222', borderc: '#333333', selected: '#444444', draculared: '#555555',
    textcolor: '#666666', textcolor2: '#777777', darkBorderc: '#888888', darkbutton: '#999999', type: 'light',
}

/** The page's database: the pack scheme as the live profile holds it. */
function page(fields: Record<string, unknown>): Database {
    const db = { characters: [], personas: [], characterOrder: [], botPresets: [], ...fields } as unknown as Database
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

async function decodedDatabase(): Promise<Record<string, unknown>> {
    const entry = exportedEntries().find((candidate) => candidate.name === 'database.risudat')
    expect(entry, 'the file holds a database entry').toBeDefined()
    return await decodeRisuSave(entry!.data) as unknown as Record<string, unknown>
}

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
])('%s of a page on the theme-pack scheme', (_name, run) => {
    test('T24 reproducer: a preset snapshot exports the current preset entry under its name, never theme-pack', async () => {
        const db = page({
            colorSchemeName: 'theme-pack', colorScheme: PACK_COPY, customColorScheme: CUSTOM,
            themePackSchemeSnapshot: { name: 'ocean', scheme: STALE_OCEAN },
        })

        const outcome = await run()

        expect(outcome).toMatchObject({ status: 'saved' })
        const decoded = await decodedDatabase()
        expect(decoded.colorSchemeName).toBe('ocean')
        expect(decoded.colorScheme).toEqual(colorSchemePresets.ocean)
        expect(decoded.customColorScheme).toEqual(CUSTOM)
        // The page keeps its own fields (the export copy is not the page).
        expect(db.colorSchemeName).toBe('theme-pack')
        expect(db.colorScheme).toEqual(PACK_COPY)
        expect(db.themePackSchemeSnapshot).toEqual({ name: 'ocean', scheme: STALE_OCEAN })
    }, 120_000)

    test('T25 reproducer: the snapshot key never reaches the file', async () => {
        page({
            colorSchemeName: 'theme-pack', colorScheme: PACK_COPY, customColorScheme: CUSTOM,
            themePackSchemeSnapshot: { name: 'ocean', scheme: STALE_OCEAN },
        })

        await run()

        const decoded = await decodedDatabase()
        expect('themePackSchemeSnapshot' in decoded).toBe(false)
        expect(JSON.stringify(decoded)).not.toContain('themePackSchemeSnapshot')
    }, 120_000)

    test('T24: a custom snapshot exports custom with the Custom slot', async () => {
        page({
            colorSchemeName: 'theme-pack', colorScheme: PACK_COPY, customColorScheme: CUSTOM,
            themePackSchemeSnapshot: { name: 'custom', scheme: OWN_COPY },
        })

        await run()

        const decoded = await decodedDatabase()
        expect(decoded.colorSchemeName).toBe('custom')
        expect(decoded.colorScheme).toEqual(CUSTOM)
    }, 120_000)

    test('T24: an unknown snapshot name exports that name with its saved copy', async () => {
        page({
            colorSchemeName: 'theme-pack', colorScheme: PACK_COPY, customColorScheme: CUSTOM,
            themePackSchemeSnapshot: { name: 'retired-x', scheme: OWN_COPY },
        })

        await run()

        const decoded = await decodedDatabase()
        expect(decoded.colorSchemeName).toBe('retired-x')
        expect(decoded.colorScheme).toEqual(OWN_COPY)
    }, 120_000)

    test('T24: no snapshot exports default', async () => {
        page({ colorSchemeName: 'theme-pack', colorScheme: PACK_COPY, customColorScheme: CUSTOM })

        await run()

        const decoded = await decodedDatabase()
        expect(decoded.colorSchemeName).toBe('default')
        expect(decoded.colorScheme).toEqual(defaultColorScheme)
    }, 120_000)

    test('T25 reproducer: any other scheme exports as it is, and a stray snapshot is still left out', async () => {
        page({
            colorSchemeName: 'ocean', colorScheme: OWN_COPY, customColorScheme: CUSTOM,
            themePackSchemeSnapshot: { name: 'dark', scheme: STALE_OCEAN },
        })

        await run()

        const decoded = await decodedDatabase()
        expect(decoded.colorSchemeName).toBe('ocean')
        expect(decoded.colorScheme).toEqual(OWN_COPY)
        expect('themePackSchemeSnapshot' in decoded).toBe(false)
    }, 120_000)
})

test('T24 guard: the export names the pack scheme by the literal the colour module owns', () => {
    expect(PACK_SCHEME_NAME).toBe('theme-pack')
})